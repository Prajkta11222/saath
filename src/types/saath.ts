export const CATEGORIES = [
  'road_hazard',
  'accident',
  'fire',
  'water_issue',
  'streetlight_outage',
  'suspicious_activity',
  'theft',
  'harassment',
  'medical_emergency',
  'missing_person',
  'other',
] as const;

export type IncidentCategory = (typeof CATEGORIES)[number];

export const STATUSES = [
  'pending',
  'community_confirmed',
  'reviewed',
  'resolved',
  'dismissed',
] as const;

export type IncidentStatus = (typeof STATUSES)[number];

export const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type AiPriority = (typeof PRIORITIES)[number];

export type Freshness = 'fresh' | 'aging' | 'stale';
export type UserRole = 'citizen' | 'operator';

export const CATEGORY_LABELS: Record<IncidentCategory, string> = {
  road_hazard: 'Road hazard',
  accident: 'Traffic accident',
  fire: 'Fire / smoke',
  water_issue: 'Water logging / leak',
  streetlight_outage: 'Streetlight outage',
  suspicious_activity: 'Suspicious activity',
  theft: 'Theft / snatching',
  harassment: 'Harassment',
  medical_emergency: 'Medical emergency',
  missing_person: 'Missing person',
  other: 'Other civic issue',
};

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  pending: 'Unverified',
  community_confirmed: 'Community-confirmed',
  reviewed: 'Reviewed',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

export const TTL_HOURS: Record<IncidentCategory, number> = {
  accident: 3,
  fire: 3,
  medical_emergency: 3,
  suspicious_activity: 12,
  theft: 12,
  harassment: 12,
  missing_person: 12,
  road_hazard: 48,
  water_issue: 48,
  streetlight_outage: 48,
  other: 24,
};

export const VALID_STATUS_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  pending: ['community_confirmed', 'reviewed', 'dismissed'],
  community_confirmed: ['reviewed', 'dismissed'],
  reviewed: ['resolved', 'dismissed'],
  resolved: [],
  dismissed: [],
};

export interface PresetDestination {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
}

export const PRESET_DESTINATIONS: PresetDestination[] = [
  { id: 'sitabuldi', name: 'Sitabuldi Main Market', area: 'Central Nagpur', lat: 21.1436, lng: 79.0806 },
  { id: 'dharampeth', name: 'Dharampeth Square', area: 'West Nagpur', lat: 21.1404, lng: 79.0604 },
  { id: 'railway', name: 'Nagpur Railway Station', area: 'East Central', lat: 21.1528, lng: 79.0882 },
  { id: 'ambazari', name: 'Ambazari Lake Gate', area: 'South West', lat: 21.1277, lng: 79.0445 },
];

export interface PublicIncident {
  id: number;
  category: IncidentCategory;
  description: string;
  lat: number;
  lng: number;
  location_approximate: boolean;
  location_label: string | null;
  occurred_at: string;
  reported_at: string;
  expires_at: string;
  status: IncidentStatus;
  status_label: string;
  evidence_url: string | null;
  sensitive: boolean;
  confirmations_count: number;
  freshness: Freshness;
  distance_km?: number;
  ai_summary: string | null;
  safety_guidance?: string;
  timeline?: TimelineEntry[];
}

export interface OperatorIncident extends PublicIncident {
  exact_lat: number;
  exact_lng: number;
  ai_category: string | null;
  ai_priority: AiPriority | null;
  ai_triage: string | null;
  ai_confidence: number | null;
  ai_flags: string[];
  ai_source: 'gemini' | 'rules' | null;
}

export interface TimelineEntry {
  id: number;
  action: string;
  label: string;
  detail: Record<string, unknown>;
  created_at: string;
  actor_role?: string;
}

export interface UserProfile {
  id: number;
  display_name: string;
  contact: string | null;
  role: UserRole;
  alerts_opt_in: boolean;
  alert_radius_km: number;
  help_opt_in: boolean;
  last_lat: number | null;
  last_lng: number | null;
  last_seen_at: string | null;
}

export interface TrustedContact {
  id: number;
  user_id: number;
  name: string;
  contact: string;
}

export interface SosSession {
  id: number;
  user_id: number;
  lat: number;
  lng: number;
  started_at: string;
  sharing_expires_at: string;
  status: 'active' | 'cancelled' | 'resolved';
  expired: boolean;
  notified_contacts: Array<{ id: number; name: string }>;
}

export interface PublicHelpRequest {
  id: number;
  sos_id: number;
  approx_lat: number;
  approx_lng: number;
  status: 'open' | 'closed';
  distance_km?: number;
  created_at: string;
  guidance: string;
}

export interface RouteAlternative {
  id: 'A' | 'B';
  label: string;
  summary: string;
  polyline: Array<[number, number]>;
  distance_km: number;
  estimated_minutes: number;
  incidents_near_route: number;
  nearby_incidents: PublicIncident[];
}

export interface RouteResponse {
  is_demo: true;
  disclaimer: string;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  routes: RouteAlternative[];
  recent_incidents: PublicIncident[];
}

export interface CameraReference {
  id: number;
  name: string;
  lat: number;
  lng: number;
  mock_source_url: string;
  is_simulated: boolean;
  distance_km?: number;
}

export interface AuditLogEntry {
  id: number;
  actor_id: number | null;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface DemoPhoneState {
  id: number;
  display_name: string;
  alerts_opt_in: boolean;
  alert_radius_km: number;
  help_opt_in: boolean;
  last_lat: number;
  last_lng: number;
  distance_from_center_km: number;
}
