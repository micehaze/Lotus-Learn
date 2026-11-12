import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const moduleRun = args.includes('lotus_dict.server');
const venv = path.join(root,'local-dictionary','.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const child = spawn(process.env.PYTHON || (fs.existsSync(venv)?venv:process.platform === 'win32' ? 'python' : 'python3'), args,
  { cwd: moduleRun ? path.join(root, 'local-dictionary') : root, stdio: 'inherit', windowsHide: true });
child.on('error', (e) => { console.error(`Python could not start: ${e.message}. Install Python 3.10+ and add it to PATH.`); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
