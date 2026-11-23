import {
  AuditLogEntry,
  CameraReference,
  DemoPhoneState,
  IncidentCategory,
  IncidentStatus,
  OperatorIncident,
  PresetDestination,
  PublicHelpRequest,
  PublicIncident,
  RouteResponse,
  SosSession,
  TrustedContact,
  UserProfile,
} from '../types/saath';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = 'api_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const TOKEN_STORAGE_KEY = 'saath_tab_token';

function readStoredToken(): string | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage.getItem(TOKEN_STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

let inMemoryToken: string | null = readStoredToken();

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
  try {
    if (typeof window !== 'undefined') {
      if (token) {
        window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      } else {
        window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore storage restriction in sandboxed environments
  }
}

export function getAuthToken(): string | null {
  return inMemoryToken;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (inMemoryToken) {
    headers.set('Authorization', `Bearer ${inMemoryToken}`);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }

  if (!res.ok) {
    const message =
      typeof data.error === 'string' ? data.error : `Request failed (${res.status})`;
    const code = typeof data.code === 'string' ? data.code : 'request_failed';
    throw new ApiError(message, res.status, code);
  }

  return data as T;
}

export const api = {
  // Auth & Profile
  operatorStatus: () => request<{ mode: 'env' | 'claimed' | 'unclaimed' }>('/api/auth/operator-status'),
  claimOperator: (password: string) =>
    request<{ mode: 'claimed' }>('/api/auth/claim-operator', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  demoLogin: (payload: { display_name: string; role: 'citizen' | 'operator'; password?: string }) =>
    request<{ token: string; user: UserProfile }>('/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  getMe: () => request<UserProfile>('/api/me'),
  updateMe: (patch: Partial<Pick<UserProfile, 'alerts_opt_in' | 'alert_radius_km' | 'help_opt_in' | 'contact' | 'last_lat' | 'last_lng'>>) =>
    request<UserProfile>('/api/me', { method: 'PATCH', body: JSON.stringify(patch) }),
  getContacts: () => request<{ contacts: TrustedContact[] }>('/api/me/contacts'),
  addContact: (name: string, contact: string) =>
    request<TrustedContact>('/api/me/contacts', {
      method: 'POST',
      body: JSON.stringify({ name, contact }),
    }),
  deleteContact: (id: number) => request<{ ok: boolean }>(`/api/me/contacts/${id}`, { method: 'DELETE' }),
  getDemoPhones: () => request<{ phones: DemoPhoneState[] }>('/api/demo/phones'),

  // Incidents
  getIncidents: (params: {
    lat: number;
    lng: number;
    radius_km: number;
    category?: string;
    status?: string;
    include_stale?: boolean;
  }) => {
    const q = new URLSearchParams({
      lat: String(params.lat),
      lng: String(params.lng),
      radius_km: String(params.radius_km),
      include_stale: String(Boolean(params.include_stale)),
    });
    if (params.category) q.set('category', params.category);
    if (params.status) q.set('status', params.status);
    return request<{ center: { lat: number; lng: number }; radius_km: number; incidents: PublicIncident[] }>(
      `/api/incidents?${q.toString()}`,
    );
  },
  getIncident: (id: number, lat?: number, lng?: number) => {
    const q = new URLSearchParams();
    if (lat !== undefined && lng !== undefined) {
      q.set('lat', String(lat));
      q.set('lng', String(lng));
    }
    const qs = q.toString();
    return request<{ incident: PublicIncident }>(`/api/incidents/${id}${qs ? `?${qs}` : ''}`);
  },
  uploadEvidence: (file: File) => {
    const form = new FormData();
    form.append('evidence', file);
    return request<{ url: string }>('/api/uploads', {
      method: 'POST',
      body: form,
    });
  },
  createIncident: (payload: {
    category: IncidentCategory;
    description: string;
    lat: number;
    lng: number;
    location_label?: string;
    occurred_at?: string;
    evidence_url?: string;
    sensitive?: boolean;
  }) =>
    request<{ incident: PublicIncident; alerts_dispatched: number }>('/api/incidents', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  confirmIncident: (id: number) =>
    request<{ incident: PublicIncident; status_flipped: boolean }>(`/api/incidents/${id}/confirm`, {
      method: 'POST',
    }),
  updateIncidentStatus: (id: number, status: IncidentStatus, note?: string) =>
    request<{ incident: PublicIncident }>(`/api/incidents/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, note }),
    }),

  // Routes
  getPresetDestinations: () => request<{ destinations: PresetDestination[] }>('/api/routes/presets'),
  getRoutes: (fromLat: number, fromLng: number, destLat: number, destLng: number) => {
    const q = new URLSearchParams({
      from_lat: String(fromLat),
      from_lng: String(fromLng),
      dest_lat: String(destLat),
      dest_lng: String(destLng),
    });
    return request<RouteResponse>(`/api/routes?${q.toString()}`);
  },

  // SOS & Help
  getActiveSos: () => request<{ sos: SosSession | null }>('/api/sos/active'),
  startSos: (lat: number, lng: number) =>
    request<{ sos: SosSession; existing: boolean }>('/api/sos', {
      method: 'POST',
      body: JSON.stringify({ lat, lng }),
    }),
  updateSosLocation: (id: number, lat: number, lng: number) =>
    request<{ sos: SosSession }>(`/api/sos/${id}/location`, {
      method: 'POST',
      body: JSON.stringify({ lat, lng }),
    }),
  cancelSos: (id: number, status: 'cancelled' | 'resolved' = 'cancelled') =>
    request<{ sos: SosSession }>(`/api/sos/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
  createHelpRequest: (sosId: number) =>
    request<{ help_request: PublicHelpRequest; recipients_count: number }>('/api/help-requests', {
      method: 'POST',
      body: JSON.stringify({ sos_id: sosId }),
    }),
  getNearbyHelpRequests: (lat?: number, lng?: number) => {
    const q = new URLSearchParams();
    if (lat !== undefined && lng !== undefined) {
      q.set('lat', String(lat));
      q.set('lng', String(lng));
    }
    const qs = q.toString();
    return request<{ opted_in: boolean; requests: PublicHelpRequest[]; message?: string }>(
      `/api/help-requests/nearby${qs ? `?${qs}` : ''}`,
    );
  },
  respondHelpRequest: (id: number, action: 'called_112' | 'dismissed') =>
    request<{ ok: boolean; action: string }>(`/api/help-requests/${id}/respond`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  // Operator
  getOperatorIncidents: () => request<{ incidents: OperatorIncident[] }>('/api/operator/incidents'),
  getOperatorAudit: () => request<{ logs: AuditLogEntry[] }>('/api/operator/audit'),
  getOperatorCameras: (lat?: number, lng?: number) => {
    const q = new URLSearchParams();
    if (lat !== undefined && lng !== undefined) {
      q.set('lat', String(lat));
      q.set('lng', String(lng));
    }
    const qs = q.toString();
    return request<{ cameras: CameraReference[] }>(`/api/operator/cameras${qs ? `?${qs}` : ''}`);
  },
  openCameraFeed: (id: number, incidentId?: number) =>
    request<{ camera: CameraReference & { banner: string } }>(`/api/operator/cameras/${id}/open`, {
      method: 'POST',
      body: JSON.stringify({ incident_id: incidentId }),
    }),
  resetDemo: () => request<{ ok: boolean; reset_at: string }>('/api/demo/reset', { method: 'POST' }),
};
