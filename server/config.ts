import path from 'node:path';

const DEFAULT_LAT = Number.parseFloat(process.env.DEFAULT_LAT || '21.1458');
const DEFAULT_LNG = Number.parseFloat(process.env.DEFAULT_LNG || '79.0882');

const PROHIBITED_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
]);

function resolveGeminiModel(): string {
  const configured = (process.env.GEMINI_MODEL || '').trim();
  if (!configured || PROHIBITED_MODELS.has(configured)) {
    return 'gemini-4-hydrogen';
  }
  return configured;
}

export const config = {
  port: Number.parseInt(process.env.PORT || '3000', 10) || 3000,
  defaultLat: Number.isFinite(DEFAULT_LAT) ? DEFAULT_LAT : 21.1458,
  defaultLng: Number.isFinite(DEFAULT_LNG) ? DEFAULT_LNG : 79.0882,
  sqlitePath: process.env.SQLITE_PATH || path.resolve(process.cwd(), 'saath.db'),
  uploadsDir: process.env.UPLOADS_DIR || path.resolve(process.cwd(), 'uploads'),
  geminiApiKey: (process.env.GEMINI_API_KEY || '').trim(),
  geminiModel: resolveGeminiModel(),
  operatorPasswordEnv: (process.env.OPERATOR_PASSWORD || '').trim(),
  maxUploadBytes: 2 * 1024 * 1024, // 2 MB
  sosDurationMinutes: 15,
};
