import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import multer from 'multer';
import type { Server as SocketIOServer } from 'socket.io';
import {
  IncidentStatus,
  STATUSES,
  STATUS_LABELS,
  TimelineEntry,
  VALID_STATUS_TRANSITIONS,
} from '../../src/types/saath.js';
import { AuthedRequest, SessionStore, createAuthMiddlewares } from '../auth.js';
import { config } from '../config.js';
import { IncidentRow, toPublicIncident } from '../serializers.js';
import { checkPossibleDuplicate, triageIncident } from '../services/ai_triage.js';
import { fanoutAlertsForIncident } from '../services/alerts.js';
import { boundingBox, computeExpiresAt, computeFreshness, haversineKm } from '../services/geo.js';
import {
  isSafeEvidenceUrl,
  isValidCategory,
  parseCoordinate,
  parseIsoOrNow,
  sanitizeText,
} from '../validate.js';

export function buildIncidentTimeline(db: Database.Database, incident: IncidentRow): TimelineEntry[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.action, a.detail, a.created_at, u.role AS actor_role
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.entity_type = 'incident'
         AND a.entity_id = ?
         AND a.action IN ('community_confirmed', 'status_change')
       ORDER BY a.created_at ASC, a.id ASC`,
    )
    .all(incident.id) as Array<{
    id: number;
    action: string;
    detail: string;
    created_at: string;
    actor_role: string | null;
  }>;

  const timeline: TimelineEntry[] = [
    {
      id: 0,
      action: 'reported',
      label: 'Reported (Unverified)',
      detail: { status: 'pending' },
      created_at: incident.reported_at,
    },
  ];

  for (const r of rows) {
    let parsedDetail: Record<string, unknown> = {};
    try {
      parsedDetail = JSON.parse(r.detail);
    } catch {
      parsedDetail = {};
    }
    const toStatus = typeof parsedDetail.to === 'string' ? (parsedDetail.to as IncidentStatus) : undefined;
    const label =
      r.action === 'community_confirmed'
        ? 'Community-confirmed (2 citizen confirmations)'
        : toStatus && STATUS_LABELS[toStatus]
          ? `Marked ${STATUS_LABELS[toStatus]} by operator`
          : r.action;

    timeline.push({
      id: r.id,
      action: r.action,
      label,
      detail: parsedDetail,
      created_at: r.created_at,
      actor_role: r.actor_role ?? undefined,
    });
  }

  return timeline;
}

export function createIncidentsRouter(
  db: Database.Database,
  store: SessionStore,
  io: SocketIOServer | null,
  options?: { enableRateLimit?: boolean },
): Router {
  const router = Router();
  const { attachUser, requireAuth, requireOperator } = createAuthMiddlewares(db, store);

  fs.mkdirSync(config.uploadsDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, config.uploadsDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() === '.png' ? '.png' : '.jpg';
        cb(null, `${crypto.randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: config.maxUploadBytes },
    fileFilter: (_req, file, cb) => {
      const allowedMime = file.mimetype === 'image/jpeg' || file.mimetype === 'image/png';
      const ext = path.extname(file.originalname).toLowerCase();
      const allowedExt = ext === '.jpg' || ext === '.jpeg' || ext === '.png';
      if (allowedMime && allowedExt) {
        cb(null, true);
      } else {
        cb(new Error('Only JPG and PNG images under 2 MB are permitted.'));
      }
    },
  });

  const reportLimiter =
    options?.enableRateLimit === false
      ? (_req: AuthedRequest, _res: unknown, next: () => void) => next()
      : rateLimit({
          windowMs: 60 * 60 * 1000,
          limit: 5,
          standardHeaders: true,
          legacyHeaders: false,
          keyGenerator: (req) => {
            const authed = req as AuthedRequest;
            return authed.user
              ? `user:${authed.user.id}`
              : ipKeyGenerator(req.ip || '127.0.0.1');
          },
          handler: (_req, res) => {
            res.status(429).json({
              error: 'Report rate limit reached (max 5 reports per hour). Please wait before submitting another.',
              code: 'rate_limit_exceeded',
            });
          },
        });

  // Upload optional evidence photo (max 2 MB, jpg/png)
  router.post('/uploads', attachUser, requireAuth, (req, res) => {
    upload.single('evidence')(req, res, (err) => {
      if (err) {
        res.status(400).json({
          error: err.message || 'Invalid image upload.',
          code: 'invalid_upload',
        });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No image file provided.', code: 'missing_file' });
        return;
      }
      res.status(201).json({ url: `/uploads/${req.file.filename}` });
    });
  });

  // Create incident report
  router.post(
    '/incidents',
    attachUser,
    requireAuth,
    reportLimiter,
    async (req: AuthedRequest, res) => {
      const category = req.body?.category;
      const description = sanitizeText(req.body?.description, 500);
      const lat = parseCoordinate(req.body?.lat, -90, 90);
      const lng = parseCoordinate(req.body?.lng, -180, 180);
      const locationLabel = sanitizeText(req.body?.location_label, 120) || null;
      const occurredAt = parseIsoOrNow(req.body?.occurred_at);
      const sensitive = Boolean(req.body?.sensitive);
      const rawEvidenceUrl = req.body?.evidence_url;

      if (!isValidCategory(category)) {
        res.status(400).json({ error: 'Invalid incident category.', code: 'invalid_category' });
        return;
      }
      if (description.length < 10 || description.length > 500) {
        res.status(400).json({
          error: 'Description must be between 10 and 500 characters.',
          code: 'invalid_description',
        });
        return;
      }
      if (lat === null || lng === null) {
        res.status(400).json({
          error: 'Valid latitude and longitude coordinates are required.',
          code: 'invalid_coordinates',
        });
        return;
      }

      let evidenceUrl: string | null = null;
      if (typeof rawEvidenceUrl === 'string' && rawEvidenceUrl.trim() !== '') {
        evidenceUrl = isSafeEvidenceUrl(rawEvidenceUrl);
        if (!evidenceUrl) {
          res.status(400).json({
            error: 'Evidence URL must be a valid http(s) URL or uploaded image path.',
            code: 'invalid_evidence_url',
          });
          return;
        }
      }

      const reportedAt = new Date().toISOString();
      const expiresAt = computeExpiresAt(category, reportedAt);

      // Run AI triage (with automatic fallback to keyword rules)
      const ai = await triageIncident(description, category, sensitive);
      const isDuplicate = checkPossibleDuplicate(db, category, lat, lng);
      const flags = isDuplicate
        ? Array.from(new Set([...ai.flags, 'possible_duplicate']))
        : ai.flags;

      const insertResult = db
        .prepare(
          `INSERT INTO incidents (
            category, description, lat, lng, location_label, occurred_at, reported_at, expires_at,
            status, reporter_id, evidence_url, sensitive, confirmations_count,
            ai_category, ai_priority, ai_summary, ai_triage, ai_confidence, ai_flags, ai_source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          category,
          description,
          lat,
          lng,
          locationLabel,
          occurredAt,
          reportedAt,
          expiresAt,
          req.user!.id,
          evidenceUrl,
          sensitive ? 1 : 0,
          ai.category,
          ai.priority,
          ai.summary,
          ai.triage,
          ai.confidence,
          JSON.stringify(flags),
          ai.ai_source,
        );

      const createdRow = db
        .prepare('SELECT * FROM incidents WHERE id = ?')
        .get(insertResult.lastInsertRowid) as IncidentRow;

      // Fan out real-time socket events and opt-in nearby alerts
      const dispatchedAlerts = fanoutAlertsForIncident(db, io, createdRow);

      res.status(201).json({
        incident: toPublicIncident(createdRow, lat, lng),
        alerts_dispatched: dispatchedAlerts.length,
      });
    },
  );

  // List nearby incidents
  router.get('/incidents', (req, res) => {
    const lat = parseCoordinate(req.query.lat, -90, 90) ?? config.defaultLat;
    const lng = parseCoordinate(req.query.lng, -180, 180) ?? config.defaultLng;
    const radiusRaw = Number(req.query.radius_km);
    const radiusKm = Number.isFinite(radiusRaw) ? Math.min(20, Math.max(0.5, radiusRaw)) : 5;
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const includeStale = req.query.include_stale === 'true' || req.query.include_stale === '1';

    if (category && !isValidCategory(category)) {
      res.status(400).json({ error: 'Invalid category filter.', code: 'invalid_category' });
      return;
    }
    if (status && !(STATUSES as readonly string[]).includes(status)) {
      res.status(400).json({ error: 'Invalid status filter.', code: 'invalid_status' });
      return;
    }

    const box = boundingBox(lat, lng, radiusKm);
    const clauses = ['lat BETWEEN ? AND ?', 'lng BETWEEN ? AND ?'];
    const params: unknown[] = [box.minLat, box.maxLat, box.minLng, box.maxLng];

    if (category) {
      clauses.push('category = ?');
      params.push(category);
    }
    if (status) {
      clauses.push('status = ?');
      params.push(status);
    } else {
      clauses.push("status != 'dismissed'");
    }

    const rows = db
      .prepare(`SELECT * FROM incidents WHERE ${clauses.join(' AND ')} ORDER BY reported_at DESC LIMIT 200`)
      .all(...params) as IncidentRow[];

    const nowMs = Date.now();
    const incidents = rows
      .map((row) => {
        const freshness = computeFreshness(row.category, row.reported_at, row.expires_at, nowMs);
        return { row, freshness, pub: toPublicIncident(row, lat, lng) };
      })
      .filter((item) => {
        if (!includeStale && item.freshness === 'stale') return false;
        const dist = haversineKm(lat, lng, item.pub.lat, item.pub.lng);
        return dist <= radiusKm;
      })
      .map((item) => item.pub);

    res.json({
      center: { lat, lng },
      radius_km: radiusKm,
      incidents,
    });
  });

  // Get single incident public detail + timeline
  router.get('/incidents/:id', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid incident id.', code: 'invalid_id' });
      return;
    }

    const row = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as IncidentRow | undefined;
    if (!row) {
      res.status(404).json({ error: 'Incident not found.', code: 'not_found' });
      return;
    }

    const viewerLat = parseCoordinate(req.query.lat, -90, 90) ?? undefined;
    const viewerLng = parseCoordinate(req.query.lng, -180, 180) ?? undefined;
    const timeline = buildIncidentTimeline(db, row);

    res.json({
      incident: toPublicIncident(row, viewerLat, viewerLng, timeline),
    });
  });

  // Community confirmation
  router.post('/incidents/:id/confirm', attachUser, requireAuth, (req: AuthedRequest, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid incident id.', code: 'invalid_id' });
      return;
    }

    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as IncidentRow | undefined;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found.', code: 'not_found' });
      return;
    }

    if (incident.reporter_id !== null && incident.reporter_id === req.user!.id) {
      res.status(403).json({
        error: 'Reporters cannot confirm their own report.',
        code: 'self_confirm_forbidden',
      });
      return;
    }

    if (incident.status === 'resolved' || incident.status === 'dismissed') {
      res.status(409).json({
        error: 'Cannot confirm an incident that is already resolved or dismissed.',
        code: 'incident_closed',
      });
      return;
    }

    const existing = db
      .prepare('SELECT id FROM incident_confirmations WHERE incident_id = ? AND user_id = ?')
      .get(id, req.user!.id);
    if (existing) {
      res.status(409).json({
        error: 'You have already confirmed this report.',
        code: 'already_confirmed',
      });
      return;
    }

    const nowIso = new Date().toISOString();
    let statusFlipped = false;

    const tx = db.transaction(() => {
      db.prepare('INSERT INTO incident_confirmations (incident_id, user_id, created_at) VALUES (?, ?, ?)').run(
        id,
        req.user!.id,
        nowIso,
      );

      const newCount = incident.confirmations_count + 1;
      let nextStatus = incident.status;
      if (incident.status === 'pending' && newCount >= 2) {
        nextStatus = 'community_confirmed';
        statusFlipped = true;
      }

      db.prepare('UPDATE incidents SET confirmations_count = ?, status = ? WHERE id = ?').run(
        newCount,
        nextStatus,
        id,
      );

      if (statusFlipped) {
        db.prepare(
          `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at)
           VALUES (NULL, 'community_confirmed', 'incident', ?, ?, ?)`,
        ).run(
          id,
          JSON.stringify({ confirmations_count: newCount, from: 'pending', to: 'community_confirmed' }),
          nowIso,
        );
      }
    });

    tx();

    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as IncidentRow;
    const timeline = buildIncidentTimeline(db, updated);
    const pub = toPublicIncident(updated, undefined, undefined, timeline);

    if (io) {
      io.to('public').emit('incident:status', {
        id: pub.id,
        status: pub.status,
        status_label: pub.status_label,
        confirmations_count: pub.confirmations_count,
        timeline,
      });
    }

    res.json({ incident: pub, status_flipped: statusFlipped });
  });

  // Operator-only status transition
  router.patch('/incidents/:id/status', attachUser, requireOperator, (req: AuthedRequest, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid incident id.', code: 'invalid_id' });
      return;
    }

    const nextStatus = req.body?.status;
    const note = sanitizeText(req.body?.note, 240);

    if (typeof nextStatus !== 'string' || !(STATUSES as readonly string[]).includes(nextStatus)) {
      res.status(400).json({ error: 'Invalid target status.', code: 'invalid_status' });
      return;
    }

    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as IncidentRow | undefined;
    if (!incident) {
      res.status(404).json({ error: 'Incident not found.', code: 'not_found' });
      return;
    }

    const allowedNext = VALID_STATUS_TRANSITIONS[incident.status] || [];
    if (!allowedNext.includes(nextStatus as IncidentStatus)) {
      res.status(409).json({
        error: `Cannot transition status from ${incident.status} to ${nextStatus}.`,
        code: 'invalid_status_transition',
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare('UPDATE incidents SET status = ? WHERE id = ?').run(nextStatus, id);
      db.prepare(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at)
         VALUES (?, 'status_change', 'incident', ?, ?, ?)`,
      ).run(
        req.user!.id,
        id,
        JSON.stringify({
          from: incident.status,
          to: nextStatus,
          note: note || undefined,
        }),
        nowIso,
      );
    });

    tx();

    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as IncidentRow;
    const timeline = buildIncidentTimeline(db, updated);
    const pub = toPublicIncident(updated, undefined, undefined, timeline);

    if (io) {
      io.to('public').emit('incident:status', {
        id: pub.id,
        status: pub.status,
        status_label: pub.status_label,
        confirmations_count: pub.confirmations_count,
        timeline,
      });
    }

    res.json({ incident: pub });
  });

  return router;
}
