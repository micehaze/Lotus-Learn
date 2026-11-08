import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

/** Minimal .env loader (no dependency). Existing process.env values win. */
export function loadEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnv();

const env = (k, d = '') => (process.env[k] ?? '') !== '' ? process.env[k] : d;
const resolvePath = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

export function buildConfig(overrides = {}) {
  return {
    port: Number(env('PORT', '3000')),
    host: env('HOST', '127.0.0.1'),
    appUrl: env('APP_URL', 'http://localhost:3000').replace(/\/$/, ''),
    production: env('NODE_ENV', 'development') === 'production',
    sessionDays: Number(env('SESSION_DAYS', '30')),
    databasePath: resolvePath(env('DATABASE_PATH', './data/lotus.db')),
    uploadDir: resolvePath(env('UPLOAD_DIR', './data/uploads')),
    backupDir: resolvePath(env('BACKUP_DIR', './data/backups')),
    ai: {
      provider: env('AI_PROVIDER', 'none'),
      anthropicKey: env('ANTHROPIC_API_KEY'),
      anthropicModel: env('ANTHROPIC_MODEL', 'claude-sonnet-4-5'),
      openaiKey: env('OPENAI_API_KEY'),
      openaiBaseUrl: env('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, ''),
      openaiModel: env('OPENAI_MODEL', 'gpt-4o-mini'),
      timeoutMs: Number(env('AI_TIMEOUT_MS', '60000')),
    },
    youtubeKey: env('YOUTUBE_API_KEY'),
    email: { provider: env('EMAIL_PROVIDER', 'console'), resendKey: env('RESEND_API_KEY'), from: env('EMAIL_FROM', 'Lotus Learn <no-reply@example.com>') },
    scheduler: { enabled: env('SCHEDULER_ENABLED', 'true') === 'true', intervalMinutes: Number(env('SCHEDULER_INTERVAL_MINUTES', '15')) },
    ...overrides,
  };
}
