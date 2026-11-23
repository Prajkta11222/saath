import type Database from 'better-sqlite3';
import { Router } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import { AuthedRequest, SessionStore, createAuthMiddlewares } from '../auth.js';
import { seedDatabase } from '../seed.js';
import { IncidentRow, toAuditEntry, toOperatorIncident } from '../serializers.js';
import { haversineKm } from '../services/geo.js';
import { parseCoordinate } from '../validate.js';

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function createOperatorRouter(
  db: Database.Database,
  store: SessionStore,
  io: SocketIOServer | null,
): Router {
  const router = Router();
  const { attachUser, requireOperator } = createAuthMiddlewares(db, store);

  router.get('/operator/incidents', attachUser, requireOperator, (_req: AuthedRequest, res) => {
    const rows = db
      .prepare('SELECT * FROM incidents ORDER BY reported_at DESC LIMIT 200')
      .all() as IncidentRow[];

    const mapped = rows.map((row) => toOperatorIncident(row));
    mapped.sort((a, b) => {
      const rankA = PRIORITY_RANK[a.ai_priority || 'low'] ?? 4;
      const rankB = PRIORITY_RANK[b.ai_priority || 'low'] ?? 4;
      if (rankA !== rankB) return rankA - rankB;
      return new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime();
    });

    res.json({ incidents: mapped });
  });

  router.get('/operator/audit', attachUser, requireOperator, (_req: AuthedRequest, res) => {
    const rows = db
      .prepare(
        `SELECT a.*, u.display_name AS actor_name
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_id
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT 100`,
      )
      .all() as Array<{
      id: number;
      actor_id: number | null;
      actor_name: string | null;
      action: string;
      entity_type: string;
      entity_id: number | null;
      detail: string;
      created_at: string;
    }>;

    res.json({ logs: rows.map(toAuditEntry) });
  });

  router.get('/operator/cameras', attachUser, requireOperator, (req: AuthedRequest, res) => {
    const lat = parseCoordinate(req.query.lat, -90, 90);
    const lng = parseCoordinate(req.query.lng, -180, 180);

    const rows = db.prepare('SELECT * FROM camera_references ORDER BY id ASC').all() as Array<{
      id: number;
      name: string;
      lat: number;
      lng: number;
      mock_source_url: string;
      is_simulated: number;
    }>;

    const cameras = rows.map((c) => ({
      id: c.id,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      mock_source_url: c.mock_source_url,
      is_simulated: Boolean(c.is_simulated),
      distance_km:
        lat !== null && lng !== null
          ? Number(haversineKm(lat, lng, c.lat, c.lng).toFixed(2))
          : undefined,
    }));

    if (lat !== null && lng !== null) {
      cameras.sort((a, b) => (a.distance_km ?? 999) - (b.distance_km ?? 999));
    }

    res.json({ cameras });
  });

  router.post('/operator/cameras/:id/open', attachUser, requireOperator, (req: AuthedRequest, res) => {
    const camId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(camId)) {
      res.status(400).json({ error: 'Invalid camera id.', code: 'invalid_id' });
      return;
    }

    const cam = db.prepare('SELECT * FROM camera_references WHERE id = ?').get(camId) as
      | {
          id: number;
          name: string;
          lat: number;
          lng: number;
          mock_source_url: string;
          is_simulated: number;
        }
      | undefined;

    if (!cam) {
      res.status(404).json({ error: 'Camera reference not found.', code: 'not_found' });
      return;
    }

    const nowIso = new Date().toISOString();
    const incidentId = req.body?.incident_id ? Number.parseInt(String(req.body.incident_id), 10) : null;

    db.prepare(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at)
       VALUES (?, 'camera_open', 'camera', ?, ?, ?)`,
    ).run(
      req.user!.id,
      cam.id,
      JSON.stringify({
        camera_name: cam.name,
        incident_id: Number.isFinite(incidentId) ? incidentId : null,
        simulated: true,
      }),
      nowIso,
    );

    res.json({
      camera: {
        id: cam.id,
        name: cam.name,
        lat: cam.lat,
        lng: cam.lng,
        mock_source_url: cam.mock_source_url,
        is_simulated: true,
        banner: 'SIMULATED FEED — authorized demo only',
      },
    });
  });

  router.post('/demo/reset', attachUser, requireOperator, (req: AuthedRequest, res) => {
    seedDatabase(db, true);

    const stillExists = db.prepare('SELECT id FROM users WHERE id = ?').get(req.user!.id) as
      | { id: number }
      | undefined;
    const fallbackOp = db
      .prepare("SELECT id FROM users WHERE role = 'operator' ORDER BY id ASC LIMIT 1")
      .get() as { id: number } | undefined;
    const actorId = stillExists?.id ?? fallbackOp?.id ?? null;

    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at)
       VALUES (?, 'demo_reset', 'system', NULL, ?, ?)`,
    ).run(actorId, JSON.stringify({ reset_by: req.user!.display_name }), nowIso);

    if (io) {
      io.to('public').emit('demo:reset', { at: nowIso });
    }

    res.json({ ok: true, reset_at: nowIso });
  });

  return router;
}
