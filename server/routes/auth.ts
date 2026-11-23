import type Database from 'better-sqlite3';
import { Router } from 'express';
import { config } from '../config.js';
import {
  AuthedRequest,
  SessionStore,
  createAuthMiddlewares,
  hashPassword,
  isOperatorPasswordConfigured,
  verifyOperatorPasscode,
} from '../auth.js';
import { UserRow, toOwnUserProfile } from '../serializers.js';
import { haversineKm } from '../services/geo.js';
import { parseCoordinate, sanitizeText } from '../validate.js';

export function createAuthRouter(db: Database.Database, store: SessionStore): Router {
  const router = Router();
  const { attachUser, requireAuth } = createAuthMiddlewares(db, store);

  router.get('/auth/operator-status', (_req, res) => {
    const status = isOperatorPasswordConfigured(db);
    res.json(status);
  });

  router.post('/auth/claim-operator', (req, res) => {
    const status = isOperatorPasswordConfigured(db);
    if (status.mode !== 'unclaimed') {
      res.status(409).json({
        error: 'Operator passcode is already configured.',
        code: 'operator_already_claimed',
      });
      return;
    }

    const passcode = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (passcode.length < 4 || passcode.length > 64) {
      res.status(400).json({
        error: 'Passcode must be between 4 and 64 characters.',
        code: 'invalid_passcode',
      });
      return;
    }

    const hash = hashPassword(passcode);
    try {
      db.prepare('INSERT INTO operator_credentials (id, password_hash) VALUES (1, ?)').run(hash);
      res.status(201).json({ mode: 'claimed' });
    } catch {
      res.status(409).json({
        error: 'Operator passcode was already claimed.',
        code: 'operator_already_claimed',
      });
    }
  });

  router.post('/auth/demo-login', (req, res) => {
    const displayName = sanitizeText(req.body?.display_name, 60);
    const roleRaw = req.body?.role === 'operator' ? 'operator' : 'citizen';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!displayName || displayName.length < 1 || displayName.length > 60) {
      res.status(400).json({
        error: 'Display name is required (1 to 60 characters).',
        code: 'invalid_display_name',
      });
      return;
    }

    if (roleRaw === 'operator') {
      const opStatus = isOperatorPasswordConfigured(db);
      if (opStatus.mode === 'unclaimed') {
        res.status(403).json({
          error: 'Operator passcode is not set yet. Complete initial operator setup first.',
          code: 'operator_unclaimed',
        });
        return;
      }
      if (!verifyOperatorPasscode(db, password)) {
        res.status(403).json({
          error: 'Invalid operator passcode.',
          code: 'invalid_operator_password',
        });
        return;
      }
    }

    let user = db
      .prepare('SELECT * FROM users WHERE display_name = ? AND role = ?')
      .get(displayName, roleRaw) as UserRow | undefined;

    const nowIso = new Date().toISOString();
    if (!user) {
      const result = db
        .prepare(
          `INSERT INTO users (display_name, role, alerts_opt_in, alert_radius_km, help_opt_in, last_lat, last_lng, last_seen_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          displayName,
          roleRaw,
          roleRaw === 'citizen' ? 1 : 0,
          2.0,
          0,
          config.defaultLat,
          config.defaultLng,
          nowIso,
          nowIso,
        );
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as UserRow;
    } else {
      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowIso, user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    }

    const token = store.create(user.id, user.role);
    res.json({
      token,
      user: toOwnUserProfile(user),
    });
  });

  router.post('/auth/logout', attachUser, (req: AuthedRequest, res) => {
    store.delete(req.authToken);
    res.json({ ok: true });
  });

  router.get('/me', attachUser, (req: AuthedRequest, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Not signed in.', code: 'unauthorized' });
      return;
    }
    res.json(toOwnUserProfile(req.user));
  });

  router.patch('/me', attachUser, requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const updates: string[] = [];
    const params: unknown[] = [];

    if (typeof req.body?.alerts_opt_in === 'boolean') {
      updates.push('alerts_opt_in = ?');
      params.push(req.body.alerts_opt_in ? 1 : 0);
    }
    if (req.body?.alert_radius_km !== undefined) {
      const radius = Number(req.body.alert_radius_km);
      if (!Number.isFinite(radius) || radius < 0.5 || radius > 5) {
        res.status(400).json({
          error: 'alert_radius_km must be between 0.5 and 5.',
          code: 'invalid_radius',
        });
        return;
      }
      updates.push('alert_radius_km = ?');
      params.push(radius);
    }
    if (typeof req.body?.help_opt_in === 'boolean') {
      updates.push('help_opt_in = ?');
      params.push(req.body.help_opt_in ? 1 : 0);
    }
    if (req.body?.contact !== undefined) {
      const contact = sanitizeText(req.body.contact, 60);
      updates.push('contact = ?');
      params.push(contact || null);
    }
    if (req.body?.last_lat !== undefined && req.body?.last_lng !== undefined) {
      const lat = parseCoordinate(req.body.last_lat, -90, 90);
      const lng = parseCoordinate(req.body.last_lng, -180, 180);
      if (lat === null || lng === null) {
        res.status(400).json({ error: 'Invalid coordinates.', code: 'invalid_coordinates' });
        return;
      }
      updates.push('last_lat = ?', 'last_lng = ?');
      params.push(lat, lng);
    }

    updates.push('last_seen_at = ?');
    params.push(new Date().toISOString());
    params.push(user.id);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    res.json(toOwnUserProfile(updated));
  });

  router.get('/me/contacts', attachUser, requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare('SELECT id, user_id, name, contact FROM trusted_contacts WHERE user_id = ? ORDER BY id ASC')
      .all(req.user!.id);
    res.json({ contacts: rows });
  });

  router.post('/me/contacts', attachUser, requireAuth, (req: AuthedRequest, res) => {
    const name = sanitizeText(req.body?.name, 60);
    const contact = sanitizeText(req.body?.contact, 60);
    if (!name || !contact) {
      res.status(400).json({
        error: 'Contact name and phone/email are required.',
        code: 'invalid_contact',
      });
      return;
    }

    const result = db
      .prepare('INSERT INTO trusted_contacts (user_id, name, contact) VALUES (?, ?, ?)')
      .run(req.user!.id, name, contact);

    const created = db
      .prepare('SELECT id, user_id, name, contact FROM trusted_contacts WHERE id = ?')
      .get(result.lastInsertRowid);
    res.status(201).json(created);
  });

  router.delete('/me/contacts/:id', attachUser, requireAuth, (req: AuthedRequest, res) => {
    const contactId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(contactId)) {
      res.status(400).json({ error: 'Invalid contact id.', code: 'invalid_id' });
      return;
    }
    const result = db
      .prepare('DELETE FROM trusted_contacts WHERE id = ? AND user_id = ?')
      .run(contactId, req.user!.id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Trusted contact not found.', code: 'not_found' });
      return;
    }
    res.json({ ok: true });
  });

  // Public demo-phones overview (strictly non-PII: only display_name, opt-ins, radius, and seeded demo coords)
  router.get('/demo/phones', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, display_name, alerts_opt_in, alert_radius_km, help_opt_in, last_lat, last_lng
         FROM users
         WHERE role = 'citizen' AND display_name IN ('Asha', 'Ravi', 'Meera', 'Karan')
         ORDER BY id ASC
         LIMIT 4`,
      )
      .all() as Array<{
      id: number;
      display_name: string;
      alerts_opt_in: number;
      alert_radius_km: number;
      help_opt_in: number;
      last_lat: number | null;
      last_lng: number | null;
    }>;

    const phones = rows.map((r) => {
      const lat = r.last_lat ?? config.defaultLat;
      const lng = r.last_lng ?? config.defaultLng;
      return {
        id: r.id,
        display_name: r.display_name,
        alerts_opt_in: Boolean(r.alerts_opt_in),
        alert_radius_km: r.alert_radius_km,
        help_opt_in: Boolean(r.help_opt_in),
        last_lat: lat,
        last_lng: lng,
        distance_from_center_km: Number(
          haversineKm(config.defaultLat, config.defaultLng, lat, lng).toFixed(2),
        ),
      };
    });

    res.json({ phones });
  });

  return router;
}
