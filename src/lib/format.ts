import { AiPriority, Freshness, IncidentCategory, IncidentStatus } from '../types/saath';

export const DEFAULT_CENTER = { lat: 21.1458, lng: 79.0882 };

export function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function formatTimeStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getMarkerColor(category: IncidentCategory, freshness: Freshness): string {
  if (freshness === 'stale') return '#94a3b8';
  switch (category) {
    case 'fire':
    case 'accident':
    case 'medical_emergency':
      return '#dc2626'; // crimson
    case 'road_hazard':
    case 'water_issue':
    case 'streetlight_outage':
      return '#d97706'; // amber
    case 'harassment':
    case 'theft':
    case 'suspicious_activity':
    case 'missing_person':
      return '#1d4ed8'; // civic cobalt
    default:
      return '#334155'; // slate
  }
}

export function getStatusTextClass(status: IncidentStatus): string {
  switch (status) {
    case 'community_confirmed':
      return 'text-amber-700 font-semibold';
    case 'reviewed':
      return 'text-blue-700 font-semibold';
    case 'resolved':
      return 'text-emerald-700 font-semibold';
    case 'dismissed':
      return 'text-slate-500 font-medium';
    default:
      return 'text-slate-800 font-semibold';
  }
}

export function getFreshnessLabel(freshness: Freshness): string {
  switch (freshness) {
    case 'fresh':
      return 'Fresh';
    case 'aging':
      return 'Aging';
    case 'stale':
      return 'Stale';
  }
}

export function getPriorityTextClass(priority: AiPriority | null): string {
  switch (priority) {
    case 'critical':
      return 'text-red-700 font-semibold';
    case 'high':
      return 'text-amber-700 font-semibold';
    case 'medium':
      return 'text-blue-700 font-semibold';
    default:
      return 'text-slate-600 font-medium';
  }
}

export function isDisplayableImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('/uploads/')) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
