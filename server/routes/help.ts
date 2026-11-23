import type Database from 'better-sqlite3';
import { Router } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import { AuthedRequest, SessionStore, createAuthMiddlewares } from '../auth.js';
import { config } from '../config.js';
import { UserRow, toPublicHelpRequest } from '../serializers.js';
import { haversineKm, roundCoords } from '../services/geo.js';
import { parseCoordinate } from '../validate.js';

interface HelpRow {
  id: number;
  sos_id: number;
  approx_lat: number;
  approx_lng: number;
  status: 'open' | 'closed';
  opt_in_recipients: string;
  created_at: string;
}

export function createHelpRouter(
  db: Database.Database,
  store: SessionStore,
  io: SocketIOServer | null,
): Router {
  const router = Router();
  const { attachUser, requireAuth } = createAuthMiddlewares(db, store);

  router.post('/help-requests', attachUser, requireAuth, (req: AuthedRequest, res) => {
    const sosId = Number.parseInt(String(req.body?.sos_id ?? ''), 10);
    if (!Number.isFinite(sosId)) {
      res.status(400).json({ error: 'Valid sos_id is required.', code: 'invalid_sos_id' });
      return;
    }

    const sos = db.prepare('SELECT * FROM sos_sessions WHERE id = ?').get(sosId) as
      | {
          id: number;
          user_id: number;
          lat: number;
          lng: number;
          status: string;
          sharing_expires_at: string;
        }
      | undefined;

    if (!sos) {
      res.status(404).json({ error: 'SOS session not found.', code: 'not_found' });
      return;
    }
    if (sos.user_id !== req.user!.id) {
      res.status(403).json({ error: 'You can only request help for your own SOS.', code: 'forbidden' });
      return;
    }
    if (sos.status !== 'active' || Date.now() >= new Date(sos.sharing_expires_at).getTime()) {
      res.status(409).json({
        error: 'SOS session must be active and unexpired to request nearby help.',
        code: 'sos_inactive',
      });
      return;
    }

    // Reuse existing open help request for this SOS if present
    const existing = db
      .prepare("SELECT * FROM help_requests WHERE sos_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1")
      .get(sosId) as HelpRow | undefined;

    if (existing) {
      res.status(200).json({
        help_request: toPublicHelpRequest(existing),
        recipients_count: JSON.parse(existing.opt_in_recipients || '[]').length,
      });
      return;
    }

    // Round location to ~300 m before persisting and broadcasting
    const approx = roundCoords(sos.lat, sos.lng, 300);

    const helpers = db
      .prepare(
        `SELECT * FROM users
         WHERE help_opt_in = 1
           AND id != ?
           AND last_lat IS NOT NULL
           AND last_lng IS NOT NULL`,
      )
      .all(req.user!.id) as UserRow[];

    const matchedIds: number[] = [];
    for (const helper of helpers) {
      if (helper.last_lat === null || helper.last_lng === null) continue;
      const dist = haversineKm(helper.last_lat, helper.last_lng, approx.lat, approx.lng);
      if (dist <= 2.0) {
        matchedIds.push(helper.id);
      }
    }

    const nowIso = new Date().toISOString();
    const result = db
      .prepare(
        `INSERT INTO help_requests (sos_id, approx_lat, approx_lng, status, opt_in_recipients, created_at)
         VALUES (?, ?, ?, 'open', ?, ?)`,
      )
      .run(sosId, approx.lat, approx.lng, JSON.stringify(matchedIds), nowIso);

    db.prepare(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at)
       VALUES (?, 'help_requested', 'sos', ?, ?, ?)`,
    ).run(req.user!.id, sosId, JSON.stringify({ helpers_notified: matchedIds.length }), nowIso);

    const created = db
      .prepare('SELECT * FROM help_requests WHERE id = ?')
      .get(result.lastInsertRowid) as HelpRow;
    const publicPayload = toPublicHelpRequest(created);

    if (io) {
      for (const helperId of matchedIds) {
        const helper = helpers.find((h) => h.id === helperId);
        const distKm =
          helper && helper.last_lat !== null && helper.last_lng !== null
            ? Number(haversineKm(helper.last_lat, helper.last_lng, approx.lat, approx.lng).toFixed(2))
            : undefined;
        io.to(`user:${helperId}`).emit('help:request', {
          ...publicPayload,
          distance_km: distKm,
        });
      }
      io.to('operators').emit('help:request', publicPayload);
    }

    res.status(201).json({
      help_request: publicPayload,
      recipients_count: matchedIds.length,
    });
  });

  router.get('/help-requests/nearby', attachUser, requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (!user.help_opt_in) {
      res.json({
        opted_in: false,
        requests: [],
        message: 'Enable Nearby Helper opt-in in your settings to receive help requests.',
      });
      return;
    }

    const lat = parseCoordinate(req.query.lat, -90, 90) ?? user.last_lat ?? config.defaultLat;
    const lng = parseCoordinate(req.query.lng, -180, 180) ?? user.last_lng ?? config.defaultLng;
    const nowIso = new Date().toISOString();

    const rows = db
      .prepare(
        `SELECT hr.*
         FROM help_requests hr
         JOIN sos_sessions s ON s.id = hr.sos_id
         WHERE hr.status = 'open'
           AND s.status = 'active'
           AND s.sharing_expires_at > ?
           AND s.user_id != ?
         ORDER BY hr.created_at DESC`,
      )
      .all(nowIso, user.id) as HelpRow[];

    const requests = rows
      .map((row) => {
        const dist = haversineKm(lat, lng, row.approx_lat, row.approx_lng);
        return { row, dist };
      })
      .filter((item) => item.dist <= 2.0)
      .map((item) => toPublicHelpRequest(item.row, item.dist));

    res.json({
      opted_in: true,
      requests,
    });
  });

  router.post('/help-requests/:id/respond', attachUser, requireAuth, (req: AuthedRequest, res) => {
    const helpId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(helpId)) {
      res.status(400).json({ error: 'Invalid help request id.', code: 'invalid_id' });
      return;
    }

    const action = req.body?.action === 'called_112' ? 'called_112' : 'dismissed';
    const row = db.prepare('SELECT * FROM help_requests WHERE id = ?').get(helpId) as HelpRow | undefined;
    if (!row) {
      res.status(404).json({ error: 'Help request not found.', code: 'not_found' });
      return;
    }

    db.prepare(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at)
       VALUES (?, ?, 'help_request', ?, ?, ?)`,
    ).run(req.user!.id, `helper_${action}`, helpId, JSON.stringify({ action }), new Date().toISOString());

    res.json({ ok: true, action });
  });

  return router;
}
