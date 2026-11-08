// Living pixel-art scenes: static fallback image + layered live stage
// (animated water canvas, waterfall, swaying sprite sheets, gentle parallax).
import { renderWater, renderFall } from '/shared/water.js';
import { motionAllowed } from './core.js';

let manifest = null;
let current = null; // { name, stop }
const root = () => document.getElementById('scene');
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

async function getManifest() {
  if (!manifest) manifest = await fetch('/art/scenes.json').then((r) => r.json());
  return manifest;
}

export async function setScene(name) {
  const el = root();
  if (!el) return;
  const live = motionAllowed();
  if (current && current.name === name && current.live === live) return;
  current?.stop?.();
  const m = await getManifest();
  const s = m.scenes[name] || m.scenes.lagoon;
  el.style.setProperty('--focus', s.focus);
  el.className = 'scene--still';
  el.innerHTML = `<div class="scene__static" style="background-image:url('/${s.full}')"></div>`;
  current = { name, live, stop: () => {} };
  if (!live) return;
  const token = current;
  try {
    const [base, src] = await Promise.all([loadImg(`/${s.base}`), loadImg(`/${s.src}`)]);
    if (current !== token) return;
    const W = m.width, H = m.height;
    const stage = document.createElement('div');
    stage.className = 'scene__stage';
    stage.innerHTML = `<img class="scene__img" src="/${s.base}" alt=""><canvas class="scene__canvas" width="${W}" height="${H}"></canvas>${s.over ? `<img class="scene__img" src="/${s.over}" alt="">` : ''}
      <div class="scene__layer scene__layer--mid"></div><div class="scene__layer scene__layer--front"></div>`;
    for (const sp of s.sprites) {
      const d = document.createElement('div');
      d.className = `sprite${sp.flip ? ' sprite--flip' : ''}${sp.kind === 'bob' ? ' sprite--bob' : ''}`;
      d.style.cssText = `left:${sp.x}px;top:${sp.y}px;width:${sp.fw}px;height:${sp.fh}px;background-image:url('/${sp.sheet}');--fw:${sp.fw}px;animation-duration:${sp.dur}s${sp.kind === 'bob' ? `,${sp.dur * 0.8}s` : ''};animation-delay:${sp.delay}s`;
      stage.querySelector(`.scene__layer--${sp.layer === 'mid' ? 'mid' : 'front'}`).append(d);
    }
    el.append(stage);
    // reflection source pixels
    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const octx = off.getContext('2d'); octx.drawImage(src, 0, 0);
    const srcPx = octx.getImageData(0, 0, W, H).data;
    const canvas = stage.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const frame = ctx.createImageData(W, H);
    const lowPower = (navigator.hardwareConcurrency || 4) <= 2 || navigator.connection?.saveData;
    const fps = lowPower ? 7 : 12;
    let t0 = performance.now(), timer = null, running = true;
    const draw = () => {
      const t = (performance.now() - t0) / 1000;
      if (s.water) renderWater(frame.data, srcPx, W, H, s.water, t);
      for (const f of s.falls) renderFall(frame.data, W, H, f, t);
      ctx.putImageData(frame, 0, 0);
    };
    const loop = () => { if (!running) return; draw(); timer = setTimeout(() => requestAnimationFrame(loop), 1000 / fps); };
    const fit = () => {
      const vw = innerWidth, vh = innerHeight;
      const sc = Math.max(vw / W, vh / H);
      const [fx, fy] = s.focus.split(' ').map((p) => parseFloat(p) / 100);
      stage.style.transform = `translate(${(vw - W * sc) * fx}px, ${(vh - H * sc) * fy}px) scale(${sc})`;
    };
    fit();
    const onVis = () => { if (document.hidden) { running = false; clearTimeout(timer); stage.style.setProperty('--paused', 1); stage.querySelectorAll('.sprite').forEach((x) => { x.style.animationPlayState = 'paused'; }); } else if (!running) { running = true; stage.querySelectorAll('.sprite').forEach((x) => { x.style.animationPlayState = 'running'; }); loop(); } };
    let raf = 0;
    const onMove = (e) => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; stage.style.setProperty('--px', ((e.clientX / innerWidth) - 0.5).toFixed(2)); stage.style.setProperty('--py', ((e.clientY / innerHeight) - 0.5).toFixed(2)); }); };
    const fine = matchMedia('(pointer: fine)').matches;
    addEventListener('resize', fit);
    document.addEventListener('visibilitychange', onVis);
    if (fine) addEventListener('pointermove', onMove, { passive: true });
    draw();
    el.className = 'scene--live';
    loop();
    token.stop = () => { running = false; clearTimeout(timer); removeEventListener('resize', fit); document.removeEventListener('visibilitychange', onVis); removeEventListener('pointermove', onMove); };
  } catch (e) {
    console.warn('Scene animation unavailable, showing static art', e);
  }
}
export function refreshScene() { const n = current?.name; current = null; if (n) setScene(n); }
