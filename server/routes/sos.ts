import type Database from 'better-sqlite3';
import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Server as SocketIOServer } from 'socket.io';
import { AuthedRequest, SessionStore, createAuthMiddlewares } from '../auth.js';
import { config } from '../config.js';
import { toSosSession } from '../serializers.js';
import { parseCoordinate } from '../validate.js';

interface SosRow {
  id: number;
  user_id: number;
  lat: number;
  lng: number;
  started_at: string;
  sharing_expires_at: string;
  status: 'active' | 'cancelled' | 'resolved';
  notified_contacts: string;
}

export function createSosRouter(
  db: Database.Database,
  store: SessionStore,
  io: SocketIOServer | null,
  options?: { enableRateLimit?: boolean },
): Router {
  const router = Router();
  const { attachUser, requireAuth } = createAuthMiddlewares(db, store);

  const sosLimiter =
    options?.enableRateLimit === false
      ? (_req: AuthedRequest, _res: unknown, next: () => void) => next()
      : rateLimit({
          windowMs: 60 * 60 * 1000,
          limit: 3,
          standardHeaders: true,
          legacyHeaders: false,
          keyGenerator: (req) => {
            const authed = req as AuthedRequest;
            return authed.user
              ? `sos:user:${authed.user.id}`
              : `sos:${ipKeyGenerator(req.ip || '127.0.0.1')}`;
          },
          handler: (_req, res) => {
            res.status(429).json({
              error: 'SOS trigger limit reached (max 3 per hour). Call 112 directly for immediate emergency response.',
              code: 'rate_limit_exceeded',
            });
          },
        });

  router.get('/sos/active', attachUser, requireAuth, (req: AuthedRequest, res) => {
    const nowIso = new Date().toISOString();
    const row = db
      .prepare(
        `SELECT * FROM sos_sessions
         WHERE user_id = ? AND status = 'active' AND sharing_expires_at > ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(req.user!.id, nowIso) as SosRow | undefined;

    res.json({ sos: row ? toSosSession(row) : null });
  });

  router.post('/sos', attachUser, requireAuth, sosLimiter, (req: AuthedRequest, res) => {
    const lat = parseCoordinate(req.body?.lat, -90, 90) ?? req.user!.last_lat ?? config.defaultLat;
    const lng = parseCoordinate(req.body?.lng, -180, 180) ?? req.user!.last_lng ?? config.defaultLng;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // Return existing active, unexpired SOS instead of creating a duplicate
    const existing = db
      .prepare(
        `SELECT * FROM sos_sessions
         WHERE user_id = ? AND status = 'active' AND sharing_expires_at > ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(req.user!.id, nowIso) as SosRow | undefined;

    if (existing) {
      res.status(200).json({ sos: toSosSession(existing), existing: true });
      return;
    }

    const expiresIso = new Date(nowMs + config.sosDurationMinutes * 60 * 1000).toISOString();
    const contacts = db
      .prepare('SELECT id, name FROM trusted_contacts WHERE user_id = ? ORDER BY id ASC')
      .all(req.user!.id) as Array<{ id: number; name: string }>;

    const result = db
      .prepare(
        `INSERT INTO sos_sessions (user_id, lat, lng, started_at, sharing_expires_at, status, notified_contacts)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      )
      .run(req.user!.id, lat, lng, nowIso, expiresIso, JSON.stringify(contacts));

    db.prepare(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at)
       VALUES (?, 'sos_started', 'sos', ?, ?, ?)`,
    ).run(req.user!.id, result.lastInsertRowid, JSON.stringify({ contacts_count: contacts.length }), nowIso);

    const created = db
      .prepare('SELECT * FROM sos_sessions WHERE id = ?')
      .get(result.lastInsertRowid) as SosRow;
    const sessionDto = toSosSession(created);

    if (io) {
      const notifyPayload = {
        sos_id: sessionDto.id,
        user_display_name: req.user!.display_name,
        lat: sessionDto.lat,
        lng: sessionDto.lng,
        started_at: sessionDto.started_at,
        sharing_expires_at: sessionDto.sharing_expires_at,
        notified_contacts: sessionDto.notified_contacts,
        simulated: true,
      };
      io.to(`user:${req.user!.id}`).emit('sos:notify', notifyPayload);
      io.to('operators').emit('sos:notify', notifyPayload);
    }

    res.status(201).json({ sos: sessionDto, existing: false });
  });

  router.post('/sos/:id/location', attachUser, requireAuth, (req: AuthedRequest, res) => {
    const sosId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(sosId)) {
      res.status(400).json({ error: 'Invalid SOS id.', code: 'invalid_id' });
      return;
    }

    const lat = parseCoordinate(req.body?.lat, -90, 90);
    const lng = parseCoordinate(req.body?.lng, -180, 180);
    if (lat === null || lng === null) {
      res.status(400).json({ error: 'Valid lat/lng required.', code: 'invalid_coordinates' });
      return;
    }

    const sos = db.prepare('SELECT * FROM sos_sessions WHERE id = ?').get(sosId) as SosRow | undefined;
    if (!sos) {
      res.status(404).json({ error: 'SOS session not found.', code: 'not_found' });
      return;
    }
    if (sos.user_id !== req.user!.id) {
      res.status(403).json({ error: 'Not authorized to update this SOS session.', code: 'forbidden' });
      return;
    }

    const expired = Date.now() >= new Date(sos.sharing_expires_at).getTime();
    if (sos.status !== 'active' || expired) {
      res.status(409).json({
        error: 'SOS sharing has expired or ended.',
        code: 'sos_expired_or_inactive',
      });
      return;
    }

    db.prepare('UPDATE sos_sessions SET lat = ?, lng = ? WHERE id = ?').run(lat, lng, sosId);
    const updated = db.prepare('SELECT * FROM sos_sessions WHERE id = ?').get(sosId) as SosRow;
    const dto = toSosSession(updated);

    if (io) {
      io.to(`user:${req.user!.id}`).emit('sos:location', {
        sos_id: dto.id,
        lat: dto.lat,
        lng: dto.lng,
        updated_at: new Date().toISOString(),
      });
      io.to('operators').emit('sos:location', {
        sos_id: dto.id,
        lat: dto.lat,
        lng: dto.lng,
        updated_at: new Date().toISOString(),
      });
    }

    res.json({ sos: dto });
  });

  router.post('/sos/:id/cancel', attachUser, requireAuth, (req: AuthedRequest, res) => {
    const sosId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(sosId)) {
      res.status(400).json({ error: 'Invalid SOS id.', code: 'invalid_id' });
      return;
    }

    const sos = db.prepare('SELECT * FROM sos_sessions WHERE id = ?').get(sosId) as SosRow | undefined;
    if (!sos) {
      res.status(404).json({ error: 'SOS session not found.', code: 'not_found' });
      return;
    }
    if (sos.user_id !== req.user!.id && req.user!.role !== 'operator') {
      res.status(403).json({ error: 'Not authorized to cancel this SOS session.', code: 'forbidden' });
      return;
    }

    const targetStatus = req.body?.status === 'resolved' ? 'resolved' : 'cancelled';
    const nowIso = new Date().toISOString();

    const tx = db.transaction(() => {
      db.prepare('UPDATE sos_sessions SET status = ? WHERE id = ?').run(targetStatus, sosId);
      db.prepare("UPDATE help_requests SET status = 'closed' WHERE sos_id = ?").run(sosId);
      db.prepare(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at)
         VALUES (?, ?, 'sos', ?, ?, ?)`,
      ).run(req.user!.id, `sos_${targetStatus}`, sosId, JSON.stringify({ status: targetStatus }), nowIso);
    });

    tx();

    const updated = db.prepare('SELECT * FROM sos_sessions WHERE id = ?').get(sosId) as SosRow;
    const dto = toSosSession(updated);

    if (io) {
      io.to(`user:${sos.user_id}`).emit('sos:ended', { sos_id: dto.id, status: dto.status });
      io.to('operators').emit('sos:ended', { sos_id: dto.id, status: dto.status });
      io.to('public').emit('help:closed', { sos_id: dto.id });
    }

    res.json({ sos: dto });
  });

  return router;
}
