import { CATEGORIES, IncidentCategory } from '../src/types/saath.js';

export function parseCoordinate(val: unknown, min: number, max: number): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val >= min && val <= max ? val : null;
  }
  if (typeof val === 'string' && val.trim() !== '') {
    const num = Number(val);
    if (Number.isFinite(num) && num >= min && num <= max) {
      return num;
    }
  }
  return null;
}

export function isValidCategory(val: unknown): val is IncidentCategory {
  return typeof val === 'string' && (CATEGORIES as readonly string[]).includes(val);
}

export function sanitizeText(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

export function isSafeEvidenceUrl(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/uploads/')) {
    return /^\/uploads\/[a-zA-Z0-9._-]+$/.test(trimmed) ? trimmed : null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function parseIsoOrNow(val: unknown): string {
  if (typeof val === 'string' && val.trim()) {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString();
    }
  }
  return new Date().toISOString();
}
