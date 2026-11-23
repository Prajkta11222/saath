import type Database from 'better-sqlite3';
import { Router } from 'express';
import { PRESET_DESTINATIONS } from '../../src/types/saath.js';
import { config } from '../config.js';
import { computeDemoRoutes } from '../services/routing.js';
import { parseCoordinate } from '../validate.js';

export function createRoutesApiRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/routes/presets', (_req, res) => {
    res.json({ destinations: PRESET_DESTINATIONS });
  });

  router.get('/routes', (req, res) => {
    const fromLat = parseCoordinate(req.query.from_lat, -90, 90) ?? config.defaultLat;
    const fromLng = parseCoordinate(req.query.from_lng, -180, 180) ?? config.defaultLng;
    const destLat = parseCoordinate(req.query.dest_lat, -90, 90);
    const destLng = parseCoordinate(req.query.dest_lng, -180, 180);

    if (destLat === null || destLng === null) {
      res.status(400).json({
        error: 'Valid destination coordinates (dest_lat, dest_lng) are required.',
        code: 'invalid_destination',
      });
      return;
    }

    const result = computeDemoRoutes(db, fromLat, fromLng, destLat, destLng);
    res.json(result);
  });

  return router;
}
