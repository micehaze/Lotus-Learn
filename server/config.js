import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnvFile(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const int = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export function buildConfig(overrides = {}) {
  const env = process.env;
  const cfg = {
    root: ROOT,
    port: int(env.PORT, 3000),
    host: env.HOST || '127.0.0.1',
    publicUrl: env.PUBLIC_URL || `http://localhost:${int(env.PORT, 3000)}`,
    databaseFile: env.DATABASE_FILE ? path.resolve(ROOT, env.DATABASE_FILE) : path.join(ROOT, 'data', 'lotus.db'),
    secureCookies: bool(env.SECURE_COOKIES, false),
    sessionDays: int(env.SESSION_DAYS, 30),
    adminEmail: (env.ADMIN_EMAIL || '').toLowerCase(),
    seedDemoUser: bool(env.SEED_DEMO_USER, true),
    automationEnabled: bool(env.AUTOMATION_ENABLED, true),
    automationIntervalMinutes: int(env.AUTOMATION_INTERVAL_MINUTES, 30),
    testMode: bool(env.TEST_MODE, false),
    authRateLimit: int(env.AUTH_RATE_LIMIT, 20),
    ai: {
      provider: (env.AI_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : env.OPENAI_API_KEY ? 'openai' : 'none')).toLowerCase(),
      anthropicKey: env.ANTHROPIC_API_KEY || '',
      anthropicModel: env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
      openaiKey: env.OPENAI_API_KEY || '',
      openaiBaseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      openaiModel: env.OPENAI_MODEL || 'gpt-4o-mini',
      timeoutMs: int(env.AI_TIMEOUT_MS, 45000),
    },
    youtubeApiKey: env.YOUTUBE_API_KEY || '',
    mail: {
      provider: (env.MAIL_PROVIDER || (env.RESEND_API_KEY ? 'resend' : 'console')).toLowerCase(),
      resendKey: env.RESEND_API_KEY || '',
      from: env.MAIL_FROM || 'Lotus Learn <no-reply@localhost>',
    },
  };
  return deepMerge(cfg, overrides);
}

function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') a[k] = deepMerge({ ...a[k] }, v);
    else a[k] = v;
  }
  return a;
}
