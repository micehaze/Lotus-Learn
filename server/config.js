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
    seedDemoUser: bool(env.SEED_DEMO_USER, false),
    automationEnabled: bool(env.AUTOMATION_ENABLED, true),
    dailyTopicEnabled: bool(env.DAILY_TOPIC_ENABLED, true),
    dailyTopicScanMs: 60000,
    appTimezone: env.APP_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
    dailyTopicTarget: int(env.DAILY_TOPIC_TARGET, 30),
    dailyTopicBatchSize: int(env.DAILY_TOPIC_BATCH_SIZE, 5),
    dailyTopicSimilarityWindow: int(env.DAILY_TOPIC_SIMILARITY_WINDOW, 365),
    dailyTopicAi: {
      provider: 'ollama',
      ollamaUrl: env.OLLAMA_URL || 'http://127.0.0.1:11434',
      ollamaModel: env.DAILY_TOPIC_MODEL || 'qwen3:4b',
      timeoutMs: int(env.DAILY_TOPIC_TIMEOUT_MS, 300000),
    },
    automationIntervalMinutes: int(env.AUTOMATION_INTERVAL_MINUTES, 30),
    testMode: bool(env.TEST_MODE, false),
    authRateLimit: int(env.AUTH_RATE_LIMIT, 20),
    ai: {
      // local only: Ollama. Paid/cloud providers (OpenAI, Anthropic, Google, Azure) are not supported.
      provider: env.OLLAMA_MODEL ? 'ollama' : 'none',
      ollamaUrl: env.OLLAMA_URL || 'http://127.0.0.1:11434',
      ollamaModel: env.OLLAMA_MODEL || '',
      timeoutMs: int(env.AI_TIMEOUT_MS, 300000),
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
