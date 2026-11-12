// Static checks (no dependencies): syntax of every JS file, missing art assets,
// forbidden patterns, and unfinished-work markers.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', 'data', '.git', 'screenshots'].includes(f.name)) continue; const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(m?js)$/.test(f.name)) files.push(p); } };
walk(ROOT);
let problems = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { problems++; console.error(`syntax: ${path.relative(ROOT, f)}\n${e.stderr}`); }
  const src = fs.readFileSync(f, 'utf8');
  if (!f.endsWith('check.mjs') && /\b(TODO|FIXME|XXX)\b/.test(src)) { problems++; console.error(`unfinished marker in ${path.relative(ROOT, f)}`); }
  if (f.includes(`${path.sep}public${path.sep}`) && /\b(localStorage|sessionStorage|innerHTML\s*=\s*[`'"][^`'"]*\$\{)/.test(src)) { problems++; console.error(`unsafe browser pattern in ${path.relative(ROOT, f)}`); }
}
const scenes = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/art/scenes.json'), 'utf8'));
for (const [name, s] of Object.entries(scenes.scenes)) {
  for (const a of [s.base, s.full, s.src, s.over, ...s.sprites.map((x) => x.sheet)].filter(Boolean)) {
    if (!fs.existsSync(path.join(ROOT, 'public', a))) { problems++; console.error(`missing asset for scene ${name}: ${a}`); }
  }
}
console.log(`${files.length} JS files checked, ${Object.keys(scenes.scenes).length} scenes verified.`);
if (problems) { console.error(`${problems} problem(s) found`); process.exit(1); }
console.log('All checks passed.');
