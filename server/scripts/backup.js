// Consistent online backup of the SQLite database: node server/scripts/backup.js [target-dir]
import path from 'node:path';
import fs from 'node:fs';
import { loadEnvFile, buildConfig } from '../config.js';
import { DatabaseSync } from 'node:sqlite';
loadEnvFile();
const cfg = buildConfig();
const dir = path.resolve(process.argv[2] || path.join(cfg.root, 'data', 'backups'));
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, `lotus-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
const db = new DatabaseSync(cfg.databaseFile);
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();
console.log(`Backup written to ${target}`);
