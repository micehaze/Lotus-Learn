// Starts the free local dictionary service (Python) and the LotusLearn web server together.
//   npm run start:all
// Set PYTHON=python on Windows if `python3` is not available. Ollama runs as its own app/service (`ollama serve`).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const kids = [];
function run(name, cmd, args, cwd) {
  const p = spawn(cmd, args, { cwd, stdio: 'inherit', env: process.env });
  p.on('exit', (code) => { console.log(`[${name}] exited with ${code}`); if (name === 'web') shutdown(code ?? 0); });
  kids.push(p);
}
function shutdown(code = 0) { for (const k of kids) { try { k.kill(); } catch { /* ignore */ } } process.exit(code); }
process.on('SIGINT', () => shutdown(0)); process.on('SIGTERM', () => shutdown(0));

run('dictionary', PY, ['-m', 'lotus_dict.server'], path.join(ROOT, 'local-dictionary'));
const url = process.env.LOCAL_DICT_URL || 'http://127.0.0.1:8765';
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(`${url}/health`); if (r.ok) { console.log('[dictionary] ready'); break; } } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 500));
}
run('web', process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], ROOT);
