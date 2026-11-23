import type Database from 'better-sqlite3';
import type { PublicIncident, RouteAlternative, RouteResponse } from '../../src/types/saath.js';
import { IncidentRow, toPublicIncident } from '../serializers.js';
import { computeFreshness, distancePointToSegmentKm, haversineKm, toRad } from './geo.js';

function polylineDistanceKm(points: Array<[number, number]>): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineKm(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return Number(total.toFixed(2));
}

function interpolateLine(
  fromLat: number,
  fromLng: number,
  destLat: number,
  destLng: number,
  steps = 8,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push([
      Number((fromLat + (destLat - fromLat) * t).toFixed(5)),
      Number((fromLng + (destLng - fromLng) * t).toFixed(5)),
    ]);
  }
  return points;
}

function incidentsNearPolyline(
  incidents: Array<{ row: IncidentRow; pub: PublicIncident }>,
  polyline: Array<[number, number]>,
  thresholdKm = 0.2,
): PublicIncident[] {
  const matched: PublicIncident[] = [];
  for (const item of incidents) {
    let minD = Infinity;
    for (let i = 1; i < polyline.length; i += 1) {
      const d = distancePointToSegmentKm(
        item.pub.lat,
        item.pub.lng,
        polyline[i - 1][0],
        polyline[i - 1][1],
        polyline[i][0],
        polyline[i][1],
      );
      if (d < minD) minD = d;
    }
    if (minD <= thresholdKm) {
      matched.push(item.pub);
    }
  }
  return matched;
}

export function computeDemoRoutes(
  db: Database.Database,
  fromLat: number,
  fromLng: number,
  destLat: number,
  destLng: number,
): RouteResponse {
  const nowIso = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT * FROM incidents
       WHERE expires_at > ?
         AND status NOT IN ('resolved', 'dismissed')`,
    )
    .all(nowIso) as IncidentRow[];

  const activeIncidents = rows
    .map((row) => ({ row, pub: toPublicIncident(row) }))
    .filter((item) => {
      const freshness = computeFreshness(item.row.category, item.row.reported_at, item.row.expires_at);
      return freshness === 'fresh' || freshness === 'aging';
    });

  // Route A: direct interpolated polyline
  const routeAPolyline = interpolateLine(fromLat, fromLng, destLat, destLng, 10);
  const routeAIncidents = incidentsNearPolyline(activeIncidents, routeAPolyline, 0.2);

  // Route B: if Route A passes within 200 m of any fresh/aging incident, shift waypoints perpendicular
  let routeBPolyline: Array<[number, number]> = [];
  if (routeAIncidents.length > 0) {
    const meanLat = toRad((fromLat + destLat) / 2);
    const kx = 111.32 * Math.cos(meanLat);
    const ky = 111.32;

    const dx = (destLng - fromLng) * kx;
    const dy = (destLat - fromLat) * ky;
    const len = Math.max(0.001, Math.hypot(dx, dy));
    // Unit perpendicular vector in km-space
    const perpX = -dy / len;
    const perpY = dx / len;

    // Choose side (+1 or -1) that produces fewer nearby incidents
    const buildShifted = (side: 1 | -1): Array<[number, number]> => {
      const pts: Array<[number, number]> = [];
      const basePts = interpolateLine(fromLat, fromLng, destLat, destLng, 10);
      for (let i = 0; i < basePts.length; i += 1) {
        if (i === 0 || i === basePts.length - 1) {
          pts.push(basePts[i]);
          continue;
        }
        const [pLat, pLng] = basePts[i];
        const nearHere = routeAIncidents.some(
          (inc) => haversineKm(pLat, pLng, inc.lat, inc.lng) <= 0.45,
        );
        // Smooth bell curve shift so Route B cleanly bends around reported spots (~450 m offset)
        const t = i / (basePts.length - 1);
        const envelope = Math.sin(Math.PI * t);
        const shiftKm = (nearHere ? 0.55 : 0.28) * envelope * side;
        const shiftedLat = pLat + (shiftKm * perpY) / ky;
        const shiftedLng = pLng + (shiftKm * perpX) / kx;
        pts.push([Number(shiftedLat.toFixed(5)), Number(shiftedLng.toFixed(5))]);
      }
      return pts;
    };

    const candidatePos = buildShifted(1);
    const candidateNeg = buildShifted(-1);
    const posHits = incidentsNearPolyline(activeIncidents, candidatePos, 0.2);
    const negHits = incidentsNearPolyline(activeIncidents, candidateNeg, 0.2);

    routeBPolyline = posHits.length <= negHits.length ? candidatePos : candidateNeg;
  } else {
    // Still provide an alternate parallel corridor (~200 m offset) as Route B
    const meanLat = toRad((fromLat + destLat) / 2);
    const kx = 111.32 * Math.cos(meanLat);
    const ky = 111.32;
    const dx = (destLng - fromLng) * kx;
    const dy = (destLat - fromLat) * ky;
    const len = Math.max(0.001, Math.hypot(dx, dy));
    const perpX = -dy / len;
    const perpY = dx / len;
    routeBPolyline = interpolateLine(fromLat, fromLng, destLat, destLng, 10).map(([lat, lng], idx, arr) => {
      if (idx === 0 || idx === arr.length - 1) return [lat, lng];
      const env = Math.sin((Math.PI * idx) / (arr.length - 1));
      return [
        Number((lat + (0.18 * env * perpY) / ky).toFixed(5)),
        Number((lng + (0.18 * env * perpX) / kx).toFixed(5)),
      ];
    });
  }

  const routeBIncidents = incidentsNearPolyline(activeIncidents, routeBPolyline, 0.2);
  const distA = polylineDistanceKm(routeAPolyline);
  const distB = polylineDistanceKm(routeBPolyline);

  const routeA: RouteAlternative = {
    id: 'A',
    label: 'Route A (Direct)',
    summary:
      routeAIncidents.length > 0
        ? `Direct path passes within 200 m of ${routeAIncidents.length} recent report(s).`
        : 'Direct path with no recent reports within 200 m.',
    polyline: routeAPolyline,
    distance_km: distA,
    estimated_minutes: Math.max(2, Math.round((distA / 24) * 60)),
    incidents_near_route: routeAIncidents.length,
    nearby_incidents: routeAIncidents,
  };

  const routeB: RouteAlternative = {
    id: 'B',
    label: 'Route B (Avoids recent reports)',
    summary:
      routeAIncidents.length > 0
        ? `Detours around ${routeAIncidents.length} recent report(s) along the direct corridor.`
        : 'Alternate parallel corridor avoiding main intersections.',
    polyline: routeBPolyline,
    distance_km: distB,
    estimated_minutes: Math.max(2, Math.round((distB / 24) * 60)),
    incidents_near_route: routeBIncidents.length,
    nearby_incidents: routeBIncidents,
  };

  return {
    is_demo: true,
    disclaimer: 'Demo routes based on community reports. Not a safety guarantee.',
    origin: { lat: fromLat, lng: fromLng },
    destination: { lat: destLat, lng: destLng },
    routes: [routeA, routeB],
    recent_incidents: activeIncidents.map((i) => i.pub),
  };
}
