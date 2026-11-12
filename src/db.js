import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { clock } from './lib/clock.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, 'migrations');

function conv(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  return v;
}
function norm(params) {
  if (params === undefined) return [];
  if (Array.isArray(params)) return params.map(conv);
  if (params && typeof params === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(params)) o[k] = conv(v);
    return [o];
  }
  return [conv(params)];
}

/** Thin synchronous wrapper around node:sqlite with a statement cache and nested transactions (savepoints). */
export class Store {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.file = file;
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
    this.cache = new Map();
    this.depth = 0;
    this.version = 0; // bumped on content writes; used by in-memory search caches
  }
  prep(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.raw.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  get(sql, p) { return this.prep(sql).get(...norm(p)); }
  all(sql, p) { return this.prep(sql).all(...norm(p)); }
  run(sql, p) { return this.prep(sql).run(...norm(p)); }
  exec(sql) { this.raw.exec(sql); }
  tx(fn) {
    if (this.depth > 0) {
      const sp = `sp${this.depth}`;
      this.raw.exec(`SAVEPOINT ${sp}`);
      this.depth++;
      try { const r = fn(); this.depth--; this.raw.exec(`RELEASE ${sp}`); return r; }
      catch (e) { this.depth--; this.raw.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`); throw e; }
    }
    this.raw.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try { const r = fn(); this.depth = 0; this.raw.exec('COMMIT'); return r; }
    catch (e) { this.depth = 0; try { this.raw.exec('ROLLBACK'); } catch {} throw e; }
  }
  close() { this.raw.close(); }
}

export function migrate(store) {
  store.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(store.all('SELECT version FROM schema_migrations').map((r) => r.version));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    store.tx(() => {
      store.exec(sql);
      store.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [f, clock.iso()]);
    });
  }
}

export function openStore(file) {
  const store = new Store(file);
  migrate(store);
  return store;
}

export const J = {
  parse(s, d = null) { if (s === null || s === undefined || s === '') return d; try { return JSON.parse(s); } catch { return d; } },
  str: (v) => JSON.stringify(v ?? null),
};
