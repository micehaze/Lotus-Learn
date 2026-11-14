// Start both required services; never silently fall back to the tiny seed dictionary.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../server/config.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnvFile();
const localPython = path.join(ROOT, 'local-dictionary', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const PY = process.env.PYTHON || (fs.existsSync(localPython) ? localPython : process.platform === 'win32' ? 'python' : 'python3');
const children = [];
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
function run(name, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' }, windowsHide: true });
  children.push(child);
  child.on('error', (e) => { console.error(`${name} failed to start: ${e.message}`); shutdown(1); });
  child.on('exit', (code) => { if (!stopping) { console.error(`${name} stopped (${code}).`); shutdown(code || 1); } });
  return child;
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
if (process.env.OLLAMA_MODEL || !/^(0|false|off)$/i.test(process.env.DAILY_TOPIC_ENABLED || 'true')) {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
  try { await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1500) }); }
  catch {
    if (['127.0.0.1', 'localhost'].includes(new URL(ollamaUrl).hostname)) {
      const ollama = spawn('ollama', ['serve'], { cwd: ROOT, windowsHide: true, stdio: 'ignore' });
      children.push(ollama);
      ollama.on('error', () => console.warn('Ollama could not start. Dictionary sources still work; install/start Ollama for generated examples.'));
    }
  }
}
const enabled = !/^(0|false|off)$/i.test(process.env.LOCAL_DICT_ENABLED || 'true');
if (enabled) {
  const url = process.env.LOCAL_DICT_URL || 'http://127.0.0.1:8766';
  const port = new URL(url).port || '8766';
  let ready = false;
  try { ready = (await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })).ok; } catch { /* service not running */ }
  if (!ready) {
    run('dictionary', PY, ['-m', 'lotus_dict.server', '--port', port], path.join(ROOT, 'local-dictionary'));
    // The first start can be slow (large dictionary index, Python ML libraries, Windows network timeouts),
    // so allow each health check 15 s and keep trying for up to 3 minutes.
    console.log('Starting the offline dictionary…');
    const deadline = Date.now() + 180_000;
    while (!stopping && Date.now() < deadline) {
      try { if ((await fetch(`${url}/health`, { signal: AbortSignal.timeout(15_000) })).ok) { ready = true; break; } } catch { /* starting */ }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!ready) { console.error('Dictionary could not start. Check Python and the error above.'); shutdown(1); }
}
if (!stopping) run('web', process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], ROOT);
