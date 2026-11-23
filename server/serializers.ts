import {
  AiPriority,
  AuditLogEntry,
  IncidentCategory,
  IncidentStatus,
  OperatorIncident,
  PublicHelpRequest,
  PublicIncident,
  STATUS_LABELS,
  SosSession,
  TimelineEntry,
  UserProfile,
} from '../src/types/saath.js';
import { computeFreshness, haversineKm, roundCoords } from './services/geo.js';

export interface IncidentRow {
  id: number;
  category: IncidentCategory;
  description: string;
  lat: number;
  lng: number;
  location_label: string | null;
  occurred_at: string;
  reported_at: string;
  expires_at: string;
  status: IncidentStatus;
  reporter_id: number | null;
  evidence_url: string | null;
  sensitive: number;
  confirmations_count: number;
  ai_category: string | null;
  ai_priority: AiPriority | null;
  ai_summary: string | null;
  ai_triage: string | null;
  ai_confidence: number | null;
  ai_flags: string;
  ai_source: 'gemini' | 'rules' | null;
}

export interface UserRow {
  id: number;
  display_name: string;
  contact: string | null;
  role: 'citizen' | 'operator';
  alerts_opt_in: number;
  alert_radius_km: number;
  help_opt_in: number;
  last_lat: number | null;
  last_lng: number | null;
  last_seen_at: string | null;
  created_at: string;
}

const SAFETY_GUIDANCE: Record<IncidentCategory, string> = {
  road_hazard: 'Slow down near the reported spot and follow local traffic signage.',
  accident: 'Keep lanes clear for emergency responders. Call 112 if anyone appears injured.',
  fire: 'Keep a safe distance upwind from smoke or flames. Call 101 or 112 immediately.',
  water_issue: 'Avoid walking or driving through deep standing water due to hidden hazards.',
  streetlight_outage: 'Use well-lit paths where available and stay alert at intersections.',
  suspicious_activity: 'Observe from a safe distance only. Do not confront anyone; report emergencies to 112.',
  theft: 'Secure belongings and report lost items or emergencies to local police (112).',
  harassment: 'Move to a well-lit public space and contact 112 or Women Helpline (1091) if needed.',
  medical_emergency: 'Call 108 or 112 for medical dispatch; assist only if trained and safe to do so.',
  missing_person: 'Do not share unverified personal claims; relay credible sightings to 112.',
  other: 'This is an unverified or civic report. Exercise normal caution and check official updates.',
};

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Strict allow-list public incident serializer.
 * NEVER includes reporter_id, contacts, AI priority/confidence, or exact coordinates for sensitive reports.
 */
export function toPublicIncident(
  row: IncidentRow,
  viewerLat?: number,
  viewerLng?: number,
  timeline?: TimelineEntry[],
): PublicIncident {
  const isSensitive = Boolean(row.sensitive);
  const coords = isSensitive ? roundCoords(row.lat, row.lng, 500) : { lat: row.lat, lng: row.lng };
  const freshness = computeFreshness(row.category, row.reported_at, row.expires_at);
  const distanceKm =
    typeof viewerLat === 'number' && typeof viewerLng === 'number'
      ? Number(haversineKm(viewerLat, viewerLng, coords.lat, coords.lng).toFixed(2))
      : undefined;

  const result: PublicIncident = {
    id: row.id,
    category: row.category,
    description: row.description,
    lat: coords.lat,
    lng: coords.lng,
    location_approximate: isSensitive,
    location_label: row.location_label,
    occurred_at: row.occurred_at,
    reported_at: row.reported_at,
    expires_at: row.expires_at,
    status: row.status,
    status_label: STATUS_LABELS[row.status] ?? row.status,
    evidence_url: row.evidence_url,
    sensitive: isSensitive,
    confirmations_count: row.confirmations_count,
    freshness,
    ai_summary: row.ai_summary,
    safety_guidance: SAFETY_GUIDANCE[row.category] ?? SAFETY_GUIDANCE.other,
  };

  if (distanceKm !== undefined) {
    result.distance_km = distanceKm;
  }
  if (timeline !== undefined) {
    result.timeline = timeline;
  }
  return result;
}

/**
 * Operator serializer: includes exact coordinates and full AI suggestion fields,
 * while still withholding reporter contact details.
 */
export function toOperatorIncident(
  row: IncidentRow,
  viewerLat?: number,
  viewerLng?: number,
): OperatorIncident {
  const base = toPublicIncident(row, viewerLat, viewerLng);
  return {
    ...base,
    exact_lat: row.lat,
    exact_lng: row.lng,
    ai_category: row.ai_category,
    ai_priority: row.ai_priority,
    ai_triage: row.ai_triage,
    ai_confidence: row.ai_confidence,
    ai_flags: parseJsonArray<string>(row.ai_flags),
    ai_source: row.ai_source,
  };
}

export function toOwnUserProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    display_name: row.display_name,
    contact: row.contact,
    role: row.role,
    alerts_opt_in: Boolean(row.alerts_opt_in),
    alert_radius_km: row.alert_radius_km,
    help_opt_in: Boolean(row.help_opt_in),
    last_lat: row.last_lat,
    last_lng: row.last_lng,
    last_seen_at: row.last_seen_at,
  };
}

export function toSosSession(row: {
  id: number;
  user_id: number;
  lat: number;
  lng: number;
  started_at: string;
  sharing_expires_at: string;
  status: 'active' | 'cancelled' | 'resolved';
  notified_contacts: string;
}): SosSession {
  const expired = Date.now() >= new Date(row.sharing_expires_at).getTime();
  return {
    id: row.id,
    user_id: row.user_id,
    lat: row.lat,
    lng: row.lng,
    started_at: row.started_at,
    sharing_expires_at: row.sharing_expires_at,
    status: row.status,
    expired,
    notified_contacts: parseJsonArray<{ id: number; name: string }>(row.notified_contacts),
  };
}

export function toPublicHelpRequest(
  row: {
    id: number;
    sos_id: number;
    approx_lat: number;
    approx_lng: number;
    status: 'open' | 'closed';
    created_at: string;
  },
  distanceKm?: number,
): PublicHelpRequest {
  const rounded = roundCoords(row.approx_lat, row.approx_lng, 300);
  return {
    id: row.id,
    sos_id: row.sos_id,
    approx_lat: rounded.lat,
    approx_lng: rounded.lng,
    status: row.status,
    distance_km: distanceKm !== undefined ? Number(distanceKm.toFixed(2)) : undefined,
    created_at: row.created_at,
    guidance:
      'Call emergency services first (112). Assist only from a safe distance. Do not confront anyone or enter unsafe places.',
  };
}

export function toAuditEntry(row: {
  id: number;
  actor_id: number | null;
  actor_name?: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  detail: string;
  created_at: string;
}): AuditLogEntry {
  return {
    id: row.id,
    actor_id: row.actor_id,
    actor_name: row.actor_name || (row.actor_id === null ? 'System (Community)' : 'Operator'),
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    detail: parseJsonObject(row.detail),
    created_at: row.created_at,
  };
}
