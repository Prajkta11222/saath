import { Freshness, IncidentCategory, TTL_HOURS } from '../../src/types/saath.js';

const EARTH_RADIUS_KM = 6371.0;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export function boundingBox(lat: number, lng: number, radiusKm: number) {
  const latDelta = radiusKm / 111.0;
  const cosLat = Math.max(0.1, Math.cos(toRad(lat)));
  const lngDelta = radiusKm / (111.0 * cosLat);
  return {
    minLat: Math.max(-90, lat - latDelta),
    maxLat: Math.min(90, lat + latDelta),
    minLng: Math.max(-180, lng - lngDelta),
    maxLng: Math.min(180, lng + lngDelta),
  };
}

/**
 * Deterministic grid rounding so sensitive incident locations (~500 m) and
 * help request locations (~300 m) do not expose exact coordinates publicly.
 */
export function roundCoords(lat: number, lng: number, meters: number): { lat: number; lng: number } {
  const degPerMeterLat = 1 / 111320;
  const degPerMeterLng = 1 / (111320 * Math.max(0.2, Math.cos(toRad(lat))));
  const stepLat = meters * degPerMeterLat;
  const stepLng = meters * degPerMeterLng;
  return {
    lat: Number((Math.round(lat / stepLat) * stepLat).toFixed(4)),
    lng: Number((Math.round(lng / stepLng) * stepLng).toFixed(4)),
  };
}

export function computeExpiresAt(category: IncidentCategory, reportedAtIso: string): string {
  const ttlHours = TTL_HOURS[category] ?? 24;
  const reportedMs = new Date(reportedAtIso).getTime();
  return new Date(reportedMs + ttlHours * 3600 * 1000).toISOString();
}

export function computeFreshness(
  category: IncidentCategory,
  reportedAtIso: string,
  expiresAtIso: string,
  nowMs = Date.now(),
): Freshness {
  const expiresMs = new Date(expiresAtIso).getTime();
  if (nowMs >= expiresMs) {
    return 'stale';
  }
  const ttlMs = (TTL_HOURS[category] ?? 24) * 3600 * 1000;
  const ageMs = Math.max(0, nowMs - new Date(reportedAtIso).getTime());
  if (ageMs < ttlMs / 3) {
    return 'fresh';
  }
  return 'aging';
}

/**
 * Approximate shortest distance (in km) from a point P to line segment AB
 * using local equirectangular projection (accurate at city scale).
 */
export function distancePointToSegmentKm(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const meanLat = toRad((aLat + bLat) / 2);
  const kx = 111.32 * Math.cos(meanLat);
  const ky = 111.32;

  const ax = aLng * kx;
  const ay = aLat * ky;
  const bx = bLng * kx;
  const by = bLat * ky;
  const px = pLng * kx;
  const py = pLat * ky;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

export function formatRelativeTime(iso: string, nowMs = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 48) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} d ago`;
}
