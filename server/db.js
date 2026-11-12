import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from './config.js';

const MIGRATIONS_DIR = path.join(ROOT, 'server', 'migrations');

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  migrate(db);
  return wrap(db);
}

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(f, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${f} failed: ${e.message}`);
    }
  }
}

/** Small convenience wrapper with cached statements and nested transactions. */
function wrap(raw) {
  const cache = new Map();
  let depth = 0;
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const norm = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
  return {
    raw,
    get: (sql, ...p) => stmt(sql).get(...norm(p)),
    all: (sql, ...p) => stmt(sql).all(...norm(p)),
    run: (sql, ...p) => stmt(sql).run(...norm(p)),
    exec: (sql) => raw.exec(sql),
    tx(fn) {
      const sp = `sp${depth}`;
      if (depth === 0) raw.exec('BEGIN IMMEDIATE'); else raw.exec(`SAVEPOINT ${sp}`);
      depth++;
      try {
        const r = fn();
        depth--;
        if (depth === 0) raw.exec('COMMIT'); else raw.exec(`RELEASE ${sp}`);
        return r;
      } catch (e) {
        depth--;
        if (depth === 0) raw.exec('ROLLBACK'); else { raw.exec(`ROLLBACK TO ${sp}`); raw.exec(`RELEASE ${sp}`); }
        throw e;
      }
    },
    close: () => raw.close(),
  };
}
