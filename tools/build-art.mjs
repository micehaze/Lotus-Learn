// Original pixel-art generator for Lotus Learn.
// Produces every illustration used by the app from code (no third-party art):
//   public/art/<scene>-base.png   scene without moving parts (animated mode)
//   public/art/<scene>-full.png   complete static scene (no-JS / reduced motion)
//   public/art/sprites/*.png      sprite sheets for swaying plants & flowers
//   public/art/ui/*.png           lotus stages, frame ornaments, icons
//   public/art/scenes.json        manifest consumed by public/js/scene.js
// Run:  node tools/build-art.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { renderWater, renderFall, BAYER4 } from '../shared/water.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'art');
fs.mkdirSync(path.join(OUT, 'sprites'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'ui'), { recursive: true });

// ---------------------------------------------------------------- PNG encoder
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- helpers
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const P = Object.fromEntries(Object.entries({
  ink: '#12303A', inkTeal: '#173F4A', tealDeep: '#0B5560', teal: '#006D6F', tropTeal: '#51B8B5',
  cyanDeep: '#1597A8', cyan: '#2FD3E0', cyanLight: '#89FAF6', aqua: '#64E3C7', aquaDeep: '#3DBCA8',
  green: '#399E5A', greenMid: '#2E7D4F', greenDark: '#26532B', greenDeep: '#173A22', leaf: '#4CAF50',
  lime: '#8FD14F', limeLight: '#C6EC7A', limePale: '#E2F7A8',
  salmon: '#FF8A73', salmonLight: '#FFB4A2', salmonPale: '#FFD9CC', coral: '#FF6F61', coralDeep: '#D9483F',
  pink: '#FF4D8D', pinkLight: '#FF9EC4', pinkPale: '#FFD3E5', magenta: '#C21E5E', wine: '#7E1240',
  orange: '#FF9F43', sun: '#FFC857', sunPale: '#FFE7A8', sand: '#F6D2B0', sandDark: '#E0A989',
  white: '#FFFFFF', mist: '#E8FFFD', bark: '#8A4B3C', barkDark: '#5A2F2A', barkLight: '#C4785E',
  stone: '#D9B48F', stoneDark: '#9C7458', blue: '#2F7BFF', blueLight: '#9CC8FF', blueDark: '#163E9A',
}).map(([k, v]) => [k, hex(v)]));

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function noise1(seed, scale) {
  const r = rng(seed); const pts = Array.from({ length: 512 }, () => r());
  return (x) => {
    const p = x / scale; const i = Math.floor(p); const f = p - i; const s = f * f * (3 - 2 * f);
    const a = pts[((i % 512) + 512) % 512]; const b = pts[(((i + 1) % 512) + 512) % 512];
    return a + (b - a) * s;
  };
}
const mixc = (a, b, t) => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];

class Px {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
  set(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (!c || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4; this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = 255;
  }
  get(x, y) { const i = (y * this.w + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
  alpha(x, y) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0; return this.d[(y * this.w + x) * 4 + 3]; }
  dset(x, y, c1, c2, t) { // ordered-dither between c1 (t=0) and c2 (t=1)
    x = Math.round(x); y = Math.round(y);
    this.set(x, y, t * 16 > BAYER4[((y % 4) + 4) % 4][((x % 4) + 4) % 4] ? c2 : c1);
  }
  rect(x, y, w, h, c) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c); }
  vgrad(y0, y1, stops, x0 = 0, x1 = this.w - 1) {
    for (let y = y0; y <= y1; y++) {
      const t = (y - y0) / Math.max(1, y1 - y0);
      let k = 0; while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
      const [ta, ca] = stops[k]; const [tb, cb] = stops[k + 1];
      const lt = Math.min(1, Math.max(0, (t - ta) / Math.max(1e-6, tb - ta)));
      for (let x = x0; x <= x1; x++) this.dset(x, y, ca, cb, lt);
    }
  }
  ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry; if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
  }
  shadedBlob(cx, cy, rx, ry, dark, mid, light, outline) {
    if (outline) this.ellipse(cx, cy + 0.5, rx + 1, ry + 1, outline);
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry; const dd = dx * dx + dy * dy; if (dd > 1) continue;
        const l = (-dx * 0.6 - dy * 0.8) * 0.5 + 0.5 - dd * 0.25; // light from top-left
        if (l > 0.62) this.dset(x, y, mid, light, Math.min(1, (l - 0.62) * 5));
        else if (l < 0.32) this.dset(x, y, mid, dark, Math.min(1, (0.32 - l) * 5));
        else this.set(x, y, mid);
      }
  }
  dcloud(cx, cy, rx, ry, c, strength = 1) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry; const dd = dx * dx + dy * dy; if (dd > 1) continue;
        const dens = (1 - dd) * strength * 1.4;
        if (dens * 16 > BAYER4[((y % 4) + 4) % 4][((x % 4) + 4) % 4]) this.set(x, y, c);
      }
  }
  line(x0, y0, x1, y1, c, th = 1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      for (let a = 0; a < th; a++) for (let b = 0; b < th; b++) this.set(x + a - (th >> 1), y + b - (th >> 1), c);
    }
  }
  poly(pts, c) {
    const ys = pts.map((p) => p[1]); const y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
    for (let y = y0; y <= y1; y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= y + 0.5 && by > y + 0.5) || (by <= y + 0.5 && ay > y + 0.5)) xs.push(ax + ((y + 0.5 - ay) * (bx - ax)) / (by - ay));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this.set(x, y, c);
    }
  }
  outline(c) { // 1px outline around opaque pixels (for sprites)
    const src = new Uint8ClampedArray(this.d);
    const a = (x, y) => (x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : src[(y * this.w + x) * 4 + 3]);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++)
      if (!a(x, y) && (a(x + 1, y) || a(x - 1, y) || a(x, y + 1) || a(x, y - 1))) this.set(x, y, c);
  }
  blit(o, dx, dy) { for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) if (o.alpha(x, y)) this.set(dx + x, dy + y, o.get(x, y)); }
  clone() { const c = new Px(this.w, this.h); c.d.set(this.d); return c; }
  save(rel) { fs.writeFileSync(path.join(OUT, rel), encodePNG(this.w, this.h, this.d)); return rel; }
}

// ---------------------------------------------------------------- organic shapes
function leafShape(px, bx, by, angle, len, width, cols, curl = 0.25) {
  const { dark, mid, light, rib } = cols;
  const pts = [];
  const steps = Math.max(6, Math.round(len));
  const left = [], right = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps; const a = angle + curl * s * s;
    const cx = bx + Math.cos(angle) * len * s + Math.cos(a) * 0; const cy = by + Math.sin(angle) * len * s + curl * len * s * s * 0.6;
    const w = Math.pow(Math.sin(Math.PI * Math.min(0.999, s * 0.92 + 0.04)), 0.8) * width;
    const nx = -Math.sin(a), ny = Math.cos(a);
    left.push([cx + nx * w, cy + ny * w]); right.push([cx - nx * w, cy - ny * w]); pts.push([cx, cy]);
  }
  px.poly([...left, ...right.reverse()], dark);
  const inL = [], inR = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps; const [cx, cy] = pts[i]; const a = angle + curl * s * s;
    const w = Math.max(0, Math.pow(Math.sin(Math.PI * Math.min(0.999, s * 0.92 + 0.04)), 0.8) * width - 1);
    const nx = -Math.sin(a), ny = Math.cos(a);
    inL.push([cx + nx * w, cy + ny * w]); inR.push([cx, cy]);
  }
  px.poly([...inL, ...inR.reverse()], light);
  const inL2 = [], inR2 = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps; const [cx, cy] = pts[i]; const a = angle + curl * s * s;
    const w = Math.max(0, Math.pow(Math.sin(Math.PI * Math.min(0.999, s * 0.92 + 0.04)), 0.8) * width - 1);
    const nx = -Math.sin(a), ny = Math.cos(a);
    inL2.push([cx, cy]); inR2.push([cx - nx * w, cy - ny * w]);
  }
  px.poly([...inL2, ...inR2.reverse()], mid);
  for (let i = 1; i < steps - 1; i++) px.set(pts[i][0], pts[i][1], rib);
}

function frond(px, cx, cy, angle, len, droop, cols, leafletLen = 4) {
  // palm frond: spine with leaflets hanging down
  let x = cx, y = cy, a = angle;
  const steps = Math.round(len);
  for (let i = 0; i < steps; i++) {
    const s = i / steps;
    a += droop / steps * (Math.cos(a) >= 0 ? 1 : -1);
    x += Math.cos(a); y += Math.sin(a);
    px.set(x, y, cols.spine);
    const ll = Math.max(1, Math.round(leafletLen * (1 - s * 0.7)));
    if (i > 1) {
      const side = Math.cos(a) >= 0 ? 1 : -1;
      for (let k = 1; k <= ll; k++) {
        px.set(x - side * k * 0.5, y + k, k === ll ? cols.dark : cols.mid);
        if (i % 2 === 0) px.set(x + side * k * 0.4, y + k * 0.9, k < 2 ? cols.light : cols.mid);
      }
    }
  }
}

function fernFrond(px, bx, by, angle, len, bend, cols) {
  let x = bx, y = by, a = angle;
  const steps = Math.round(len);
  for (let i = 0; i < steps; i++) {
    const s = i / steps;
    a += (0.9 + bend) / steps * (Math.cos(angle) >= 0 ? 1 : -1);
    x += Math.cos(a); y += Math.sin(a);
    px.set(x, y, cols.spine);
    const ll = Math.max(1, Math.round(5 * Math.sin(Math.PI * Math.min(1, s * 1.05 + 0.05))));
    const nx = -Math.sin(a), ny = Math.cos(a);
    if (i % 2 === 0) for (let k = 1; k <= ll; k++) {
      px.set(x + nx * k + Math.cos(a) * k * 0.4, y + ny * k + Math.sin(a) * k * 0.4, k === ll ? cols.dark : cols.light);
      px.set(x - nx * k + Math.cos(a) * k * 0.4, y - ny * k + Math.sin(a) * k * 0.4, k === ll ? cols.dark : cols.mid);
    }
  }
}

function petal(px, bx, by, angle, len, width, fill, edge) {
  const L = [], R = [];
  const steps = Math.max(4, Math.round(len * 1.5));
  for (let i = 0; i <= steps; i++) {
    const s = i / steps; const w = Math.pow(Math.sin(Math.PI * s), 0.75) * width * (1 - s * 0.25);
    const cx = bx + Math.cos(angle) * len * s, cy = by + Math.sin(angle) * len * s;
    const nx = -Math.sin(angle), ny = Math.cos(angle);
    L.push([cx + nx * w, cy + ny * w]); R.push([cx - nx * w, cy - ny * w]);
  }
  if (edge) {
    const LE = L.map(([x, y], i) => [x + (x - bx) * 0.08, y + (y - by) * 0.08]);
    const RE = R.map(([x, y]) => [x + (x - bx) * 0.08, y + (y - by) * 0.08]);
    px.poly([...LE, ...RE.reverse()], edge);
  }
  px.poly([...L, ...R.reverse()], fill);
}

// ---------------------------------------------------------------- sprites
const FRAMES = [-1, -0.35, 0.35, 1];
function sheet(name, fw, fh, drawFrame, frames = FRAMES, outlineColor = null) {
  const s = new Px(fw * frames.length, fh);
  frames.forEach((b, i) => {
    const f = new Px(fw, fh); drawFrame(f, b, i);
    if (outlineColor) f.outline(outlineColor);
    s.blit(f, i * fw, 0);
  });
  s.save(`sprites/${name}.png`);
  return { sheet: `sprites/${name}.png`, fw, fh, frames: frames.length };
}

const PALM = { spine: P.greenDark, dark: P.greenDeep, mid: P.green, light: P.lime };
const PALM_DUSK = { spine: [40, 46, 62], dark: [24, 28, 44], mid: [58, 72, 84], light: [96, 112, 104] };
function palmCrown(name, cols = PALM, size = 1) {
  const W = Math.round(64 * size), H = Math.round(40 * size);
  return sheet(name, W, H, (f, b) => {
    const cx = W / 2, cy = H * 0.35;
    const angles = [-3.0, -2.55, -2.05, -1.35, -0.75, -0.2, 3.35];
    angles.forEach((a, k) => frond(f, cx, cy, a + b * 0.07 * (k % 2 ? 1 : 0.6), (20 + (k % 3) * 4) * size, 1.1 + b * 0.18, cols, 4 * size));
    f.shadedBlob(cx, cy + 1, 2.5, 2, cols.dark, cols === PALM ? P.barkDark : cols.dark, cols === PALM ? P.bark : cols.mid);
  });
}
function broadLeafPlant(name, flip = false) {
  const W = 72, H = 64;
  return sheet(name, W, H, (f, b) => {
    const bx = W / 2, by = H - 1;
    const cols = { dark: P.greenDark, mid: P.leaf, light: P.lime, rib: P.limePale };
    const leaves = [[-2.35, 30, 7], [-1.85, 36, 8], [-1.3, 34, 8], [-0.75, 28, 7], [-2.8, 22, 6]];
    leaves.forEach(([a, len, w], k) => {
      const ang = (flip ? -Math.PI - a : a) + b * 0.06 * (k % 2 ? 1 : -0.7);
      f.line(bx, by, bx + Math.cos(ang) * 8, by + Math.sin(ang) * 8, P.greenDark);
      leafShape(f, bx + Math.cos(ang) * 6, by + Math.sin(ang) * 6, ang, len, w, cols, (flip ? -1 : 1) * (0.35 + b * 0.05));
    });
  });
}
function fernClump(name, cols, W = 80, H = 48) {
  return sheet(name, W, H, (f, b) => {
    const bx = W / 2, by = H - 1;
    const angs = [-2.9, -2.5, -2.1, -1.7, -1.4, -1.05, -0.65, -0.25];
    angs.forEach((a, k) => fernFrond(f, bx + (k - 4), by, a + b * 0.05 * ((k % 3) - 1), 22 + ((k * 7) % 5) * 3, b * 0.25, cols));
  });
}
function hibiscusFlower(f, cx, cy, r, b, cols) {
  for (let k = 0; k < 5; k++) {
    const a = k * (Math.PI * 2 / 5) - Math.PI / 2 + b * 0.09;
    const px = cx + Math.cos(a) * r * 0.62, py = cy + Math.sin(a) * r * 0.62;
    f.shadedBlob(px, py, r * 0.55 + (k === 2 ? b * 0.3 : 0), r * 0.5, cols.dark, cols.mid, cols.light, cols.edge);
  }
  f.ellipse(cx, cy, r * 0.28, r * 0.28, cols.core);
  const sx = cx + r * 0.5, sy = cy - r * 0.75;
  f.line(cx, cy, sx, sy, P.orange);
  f.set(sx, sy, P.sun); f.set(sx + 1, sy, P.sun); f.set(sx, sy - 1, P.sun); f.set(sx - 1, sy + 1, P.sunPale);
}
const HIB = { dark: P.magenta, mid: P.pink, light: P.pinkLight, edge: P.wine, core: P.wine };
const HIB_CORAL = { dark: P.coralDeep, mid: P.coral, light: P.salmonLight, edge: P.wine, core: P.wine };
function hibiscusBush(name, cols = HIB, W = 64, H = 48) {
  return sheet(name, W, H, (f, b) => {
    const lc = { dark: P.greenDeep, mid: P.greenMid, light: P.green, rib: P.lime };
    [[-2.6, 22], [-2.0, 26], [-1.2, 24], [-0.5, 20], [-3.0, 16]].forEach(([a, l], k) =>
      leafShape(f, W / 2, H - 1, a + b * 0.05 * (k % 2 ? 1 : -1), l, 5, lc, 0.3));
    hibiscusFlower(f, W / 2 - 12 + b, H - 26, 8, b, cols);
    hibiscusFlower(f, W / 2 + 12 + b * 0.6, H - 20, 6.5, -b, cols);
    hibiscusFlower(f, W / 2 + 1 + b * 0.8, H - 34, 6, b * 0.5, cols);
  });
}
function lotusBloom(f, cx, cy, s, open = 1) {
  // back petals
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k - 2) * (0.55 * open + 0.12);
    petal(f, cx, cy, a, 9 * s, 3.2 * s, P.pink, P.magenta);
  }
  // front petals
  for (let k = 0; k < 4; k++) {
    const a = -Math.PI / 2 + (k - 1.5) * (0.75 * open + 0.1);
    petal(f, cx, cy + 1 * s, a, 7 * s, 2.8 * s, P.pinkLight, P.pink);
  }
  if (open > 0.3) {
    f.ellipse(cx, cy - 2 * s, 2.6 * s * open, 1.4 * s, P.sun);
    f.set(cx - 1, cy - 2 * s, P.orange); f.set(cx + 1, cy - 2 * s - 1, P.orange);
  }
}
function lotusBud(f, cx, cy, s) {
  petal(f, cx, cy, -Math.PI / 2, 7 * s, 2.4 * s, P.pink, P.magenta);
  petal(f, cx, cy, -Math.PI / 2 - 0.2, 5 * s, 1.6 * s, P.pinkLight, null);
  f.line(cx, cy, cx, cy + 4 * s, P.greenMid);
  f.set(cx - 1, cy, P.green); f.set(cx + 1, cy, P.green);
}
function lilyPad(f, cx, cy, rx, ry) {
  f.ellipse(cx, cy, rx, ry, P.greenDark);
  f.ellipse(cx, cy - 0.5, rx - 1, ry - 1, P.green);
  f.ellipse(cx - rx * 0.3, cy - 1, rx * 0.4, ry * 0.4, P.lime);
  f.line(cx, cy, cx + rx, cy - 1, P.greenDark);
}
function lotusSprite(name, cx = 16, cy = 18) {
  return sheet(name, 32, 40, (f, b) => { lilyPad(f, cx, 34, 11, 3.5); f.line(cx, 33, cx + b * 0.6, 22, P.greenMid); lotusBloom(f, cx + b * 0.6, 22, 1, 1); });
}

// ---------------------------------------------------------------- scenes
const W = 320, H = 180;
const manifest = { width: W, height: H, scenes: {} };

function segmentsFromMask(maskFn, y0, y1) {
  const segs = [];
  for (let y = y0; y < y1; y++) {
    let start = -1;
    for (let x = 0; x <= W; x++) {
      const inside = x < W && maskFn(x, y);
      if (inside && start < 0) start = x;
      if (!inside && start >= 0) { segs.push([y, start, x - 1]); start = -1; }
    }
  }
  return segs;
}
function finishScene(id, base, cfg) {
  // base = scene behind the water; cfg.over = objects standing in front of the water
  const srcPx = base.clone(); if (cfg.over) srcPx.blit(cfg.over, 0, 0);
  const src = new Uint8ClampedArray(srcPx.d);
  const baked = base.clone();
  if (cfg.water) renderWater(baked.d, src, W, H, cfg.water, 0);
  for (const fall of cfg.falls || []) renderFall(baked.d, W, H, fall, 0);
  if (cfg.over) { cfg.over.save(`${id}-over.png`); baked.blit(cfg.over, 0, 0); }
  baked.save(`${id}-base.png`);
  // full static composite = baked + sprites at frame 1 (rest pose)
  const full = baked.clone();
  for (const s of cfg.sprites) {
    const sheetPx = loadedSheets[s.sheet];
    const fr = new Px(s.fw, s.fh);
    for (let y = 0; y < s.fh; y++) for (let x = 0; x < s.fw; x++) {
      const sx = s.fw * 1 + x; const a = sheetPx.alpha(sx, y); if (a) fr.set(x, y, sheetPx.get(sx, y));
    }
    if (s.flip) {
      const fl = new Px(s.fw, s.fh);
      for (let y = 0; y < s.fh; y++) for (let x = 0; x < s.fw; x++) if (fr.alpha(x, y)) fl.set(s.fw - 1 - x, y, fr.get(x, y));
      full.blit(fl, s.x, s.y);
    } else full.blit(fr, s.x, s.y);
  }
  full.save(`${id}-full.png`);
  manifest.scenes[id] = {
    base: `art/${id}-base.png`, full: `art/${id}-full.png`, src: `art/${id}-src.png`, over: cfg.over ? `art/${id}-over.png` : null,
    water: cfg.water || null, falls: cfg.falls || [], sprites: cfg.sprites.map((s) => ({ ...s, sheet: `art/${s.sheet}` })),
    focus: cfg.focus || '50% 50%',
  };
  srcPx.save(`${id}-src.png`); // reflection source (no water, no sprites)
}
const loadedSheets = {};
function reg(meta) {
  // keep sheet pixels so finishScene can composite the static version
  const file = path.join(OUT, meta.sheet);
  loadedSheets[meta.sheet] = decodeOwnPNG(file, meta.fw * meta.frames, meta.fh);
  return meta;
}
// tiny decoder for PNGs we produced ourselves (filter 0 only)
function decodeOwnPNG(file, w, h) {
  const buf = fs.readFileSync(file); let off = 8; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)); const px = new Px(w, h);
  for (let y = 0; y < h; y++) px.d.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
  return px;
}
const sprite = (meta, x, y, opts = {}) => ({ ...meta, x, y, layer: opts.layer || 'front', dur: opts.dur || 3.2, delay: opts.delay || 0, flip: !!opts.flip, kind: opts.kind || 'sway' });

// shared sprite sheets
const S = {
  palmA: reg(palmCrown('palm-a')),
  palmSmall: reg(palmCrown('palm-small', PALM, 0.6)),
  palmDusk: reg(palmCrown('palm-dusk', PALM_DUSK)),
  leafL: reg(broadLeafPlant('broadleaf-l')),
  leafR: reg(broadLeafPlant('broadleaf-r', true)),
  fernLime: reg(fernClump('fern-lime', { spine: P.greenDark, dark: P.greenDeep, mid: P.leaf, light: P.lime })),
  fernTeal: reg(fernClump('fern-teal', { spine: P.tealDeep, dark: P.inkTeal, mid: P.aquaDeep, light: P.aqua }, 64, 40)),
  hibPink: reg(hibiscusBush('hibiscus-pink')),
  hibCoral: reg(hibiscusBush('hibiscus-coral', HIB_CORAL)),
  lotus: reg(lotusSprite('lotus-pad')),
};

function palmTrunk(px, x0, y0, x1, y1, curve, light = P.barkLight, dark = P.bark) {
  const n = Math.round(Math.hypot(x1 - x0, y1 - y0));
  for (let i = 0; i <= n; i++) {
    const s = i / n; const x = x0 + (x1 - x0) * s + Math.sin(s * Math.PI) * curve; const y = y0 + (y1 - y0) * s;
    const c = (i >> 1) % 2 ? light : dark;
    px.set(x, y, c); px.set(x + 1, y, dark); if (s > 0.5) px.set(x - 1, y, c);
  }
}
function canopyBand(px, seed, yTop, yBot, cols, count, rMin = 5, rMax = 11, x0 = -10, x1 = W + 10) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = x0 + r() * (x1 - x0); const y = yTop + r() * (yBot - yTop); const rad = rMin + r() * (rMax - rMin);
    px.shadedBlob(x, y, rad, rad * 0.8, cols.dark, cols.mid, cols.light, cols.outline);
  }
}
function ridge(px, seed, baseY, amp, scale, color, top, x0 = 0, x1 = W - 1, bottom = H - 1) {
  const n = noise1(seed, scale); const n2 = noise1(seed + 9, scale / 4);
  for (let x = x0; x <= x1; x++) {
    const y = Math.round(baseY - amp * n(x) - amp * 0.25 * n2(x));
    for (let yy = y; yy <= bottom; yy++) px.set(x, yy, color);
    if (top) { px.set(x, y, top); }
  }
}

// ---------- Scene 1: LAGOON (home; inspired by ref 1 atmosphere, cyan+salmon) ----------
{
  const px = new Px(W, H); const line = 118;
  px.vgrad(0, line, [[0, P.cyanDeep], [0.3, P.cyan], [0.55, P.cyanLight], [0.78, P.salmonPale], [1, P.salmonLight]]);
  const r = rng(11);
  for (let i = 0; i < 26; i++) { // radiating streak clouds
    const cy = 8 + r() * 82; const cx = r() * W; const rx = 18 + r() * 46; const ry = 1.5 + r() * 3.5;
    px.dcloud(cx, cy, rx, ry, cy < 45 ? P.white : r() > 0.5 ? P.salmonPale : P.white, 0.75);
    if (cy > 40) px.dcloud(cx + 4, cy + 2, rx * 0.6, ry * 0.6, P.salmonLight, 0.7);
  }
  // distant hazy islands
  ridge(px, 3, 113, 10, 40, mixc(P.tropTeal, P.salmonLight, 0.35), null, 0, 100, line);
  ridge(px, 5, 114, 8, 30, mixc(P.tropTeal, P.salmonLight, 0.35), null, 280, W - 1, line);
  // main dramatic island
  const peak = (x) => {
    const pk = [[96, 106], [116, 74], [134, 42], [148, 22], [160, 32], [170, 20], [182, 40], [196, 34], [214, 54], [238, 66], [262, 88], [288, 110]];
    for (let i = 0; i < pk.length - 1; i++) if (x >= pk[i][0] && x <= pk[i + 1][0]) {
      const t = (x - pk[i][0]) / (pk[i + 1][0] - pk[i][0]); return pk[i][1] + (pk[i + 1][1] - pk[i][1]) * t;
    }
    return 999;
  };
  const jag = noise1(21, 3);
  for (let x = 94; x <= 290; x++) {
    const top = Math.round(peak(x) + (jag(x) - 0.5) * 4);
    for (let y = top; y < line; y++) {
      const t = (y - top) / Math.max(1, line - top);
      const leftFace = x < 160 ? 0.25 : x > 200 ? -0.05 : 0.08;
      if (t < 0.55 + leftFace * 0.2) px.dset(x, y, P.ink, P.inkTeal, Math.min(1, 0.3 + leftFace + (jag(x * 3 + y) - 0.5)));
      else px.dset(x, y, P.greenDark, P.greenMid, Math.min(1, (t - 0.5) * 2));
    }
    px.set(x, top, P.tropTeal);
  }
  canopyBand(px, 31, 84, 114, { dark: P.greenDeep, mid: P.greenMid, light: P.green }, 60, 3, 7, 104, 282);
  canopyBand(px, 32, 98, 116, { dark: P.greenDark, mid: P.green, light: P.lime }, 40, 2, 4, 108, 276);
  // rocky sand shelves at the waterline
  for (const [x0, x1] of [[112, 146], [190, 214], [244, 270]]) for (let x = x0; x <= x1; x++) {
    const h = Math.round(3 * Math.sin(((x - x0) / (x1 - x0)) * Math.PI)) + 1;
    for (let y = line - h; y < line; y++) px.dset(x, y, P.sand, P.sandDark, (y - (line - h)) / h);
  }
  // left islet with palm
  for (let x = 20; x <= 78; x++) { const h = Math.round(6 * Math.sin(((x - 20) / 58) * Math.PI)); for (let y = line - h; y < line; y++) px.dset(x, y, P.sand, P.greenMid, y < line - 3 ? 0.7 : 0.1); }
  palmTrunk(px, 46, line - 4, 54, line - 34, 5);
  palmTrunk(px, 34, line - 3, 30, line - 24, -3);
  const water = { line, segments: segmentsFromMask(() => true, line, H), shallow: P.cyan, deep: P.tealDeep, tint: 0.3, amp: 2, speed: 1.4, squash: 0.9, glint: P.white, glint2: P.salmonPale, glintDensity: 0.1, flow: 5 };
  const falls = [{ x: 168, y: 44, w: 5, h: line - 44, colors: [P.cyanLight, P.white, P.aqua], speed: 22, spread: 2, mist: P.white }];
  finishScene('lagoon', px, {
    water, falls, focus: '55% 60%',
    sprites: [
      sprite(S.palmA, 54 - 32, line - 34 - 14, { layer: 'mid', dur: 4.6 }),
      sprite(S.palmSmall, 30 - 19, line - 24 - 8, { layer: 'mid', dur: 3.9, delay: -1.2 }),
      sprite(S.leafL, -14, H - 62, { layer: 'front', dur: 3.4 }),
      sprite(S.leafL, 30, H - 50, { layer: 'front', dur: 4.1, delay: -0.8 }),
      sprite(S.hibCoral, W - 70, H - 46, { layer: 'front', dur: 3.7, delay: -1.6 }),
      sprite(S.leafR, W - 40, H - 60, { layer: 'front', dur: 4.4, delay: -2.1 }),
      sprite(S.lotus, 210, H - 30, { layer: 'front', dur: 5.2, kind: 'bob' }),
    ],
  });
}

// ---------- Scene 2: CASCADE (auth / dashboard; inspired by ref 4 jungle waterfall) ----------
{
  const px = new Px(W, H);
  px.vgrad(0, 70, [[0, P.tropTeal], [0.5, P.aqua], [1, P.salmonPale]]);
  const r = rng(41);
  for (let i = 0; i < 10; i++) px.dcloud(r() * W, 6 + r() * 40, 20 + r() * 30, 3 + r() * 4, P.white, 0.6);
  ridge(px, 42, 70, 30, 50, mixc(P.tropTeal, P.green, 0.3), null);
  // cliffs either side of the fall
  for (let x = 0; x < W; x++) {
    const left = x < 130, right = x > 156;
    if (!left && !right) continue;
    const top = left ? 26 + Math.round(10 * Math.sin(x * 0.05)) : 30 + Math.round(8 * Math.cos(x * 0.04));
    for (let y = top; y < 150; y++) px.dset(x, y, P.greenDark, P.inkTeal, ((y + x) % 7) / 14 + 0.1);
  }
  canopyBand(px, 43, 20, 140, { dark: P.greenDeep, mid: P.greenMid, light: P.green }, 70, 6, 13, -10, 128);
  canopyBand(px, 44, 24, 140, { dark: P.greenDeep, mid: P.greenMid, light: P.green }, 70, 6, 13, 158, W + 10);
  canopyBand(px, 45, 30, 150, { dark: P.greenDark, mid: P.green, light: P.lime }, 46, 4, 8, -10, 124);
  canopyBand(px, 46, 34, 150, { dark: P.greenDark, mid: P.green, light: P.lime }, 46, 4, 8, 160, W + 10);
  // rock behind the fall
  px.rect(130, 22, 27, 126, P.inkTeal);
  // stepped stone stairs (original, salmon-tinted stone) on the right
  canopyBand(px, 47, 120, 150, { dark: P.greenDeep, mid: P.leaf, light: P.lime }, 30, 4, 7);
  const line = 150;
  const water = { line, segments: segmentsFromMask((x, y) => x > 60 + (y - line) * -2 && x < 250 - (y - line) * -1, line, H), shallow: P.aqua, deep: P.teal, tint: 0.45, amp: 1, speed: 2, squash: 0.8, glint: P.mist, glint2: P.cyanLight, glintDensity: 0.12, flow: 3 };
  // rocks framing the pool
  for (let x = 0; x < W; x++) for (let y = line; y < H; y++) if (!(x > 60 + (y - line) * -2 && x < 250 - (y - line) * -1)) px.dset(x, y, P.greenDeep, P.inkTeal, 0.5);
  finishScene('cascade', px, {
    water, focus: '45% 55%',
    falls: [{ x: 136, y: 22, w: 14, h: line - 22, colors: [P.cyanLight, P.white, P.aqua], speed: 30, spread: 4, mist: P.white }],
    sprites: [
      sprite(S.fernLime, -20, H - 48, { dur: 3.6 }),
      sprite(S.fernLime, W - 70, H - 46, { dur: 4.2, delay: -1.4 }),
      sprite(S.hibPink, 40, H - 44, { dur: 3.9, delay: -0.6 }),
      sprite(S.leafR, W - 30, H - 64, { dur: 4.6, delay: -2.3 }),
    ],
  });
}

// ---------- Scene 3: FERN (vocabulary/dictionary/collections; inspired by ref 5 forest floor) ----------
{
  const px = new Px(W, H);
  px.vgrad(0, H - 1, [[0, P.cyanLight], [0.4, P.aqua], [1, P.tropTeal]]);
  canopyBand(px, 51, -6, 60, { dark: P.tropTeal, mid: P.aquaDeep, light: P.aqua }, 60, 8, 16);
  canopyBand(px, 52, 40, 110, { dark: P.teal, mid: P.tropTeal, light: P.aquaDeep }, 50, 7, 14);
  // trunks (salmon-bark)
  for (const [x, w] of [[22, 16], [96, 10], [208, 14], [282, 18]]) {
    for (let y = 0; y < H; y++) for (let i = 0; i < w; i++) {
      const t = i / w; px.set(x + i + Math.round(Math.sin(y * 0.05 + x) * 1.5), y, t < 0.25 ? P.barkLight : t < 0.7 ? P.bark : P.barkDark);
    }
    for (let y = 6; y < H; y += 9) px.line(x + 2, y, x + w - 3, y + 2, P.barkDark);
  }
  canopyBand(px, 53, 90, 150, { dark: P.greenDark, mid: P.greenMid, light: P.green }, 50, 6, 12);
  canopyBand(px, 54, 120, 170, { dark: P.greenDeep, mid: P.leaf, light: P.lime }, 40, 5, 10);
  const line = 166;
  const water = { line, segments: segmentsFromMask((x, y) => x > 120 - (y - line) * 3 && x < 210 + (y - line) * 3, line, H), shallow: P.aqua, deep: P.teal, tint: 0.4, amp: 1, speed: 1.8, squash: 0.7, glint: P.mist, glint2: P.salmonPale, glintDensity: 0.1, flow: 4 };
  finishScene('fern', px, {
    water, focus: '50% 70%',
    sprites: [
      sprite(S.fernTeal, 60, 70, { layer: 'mid', dur: 5.4 }),
      sprite(S.fernTeal, 230, 64, { layer: 'mid', dur: 4.7, delay: -2.2 }),
      sprite(S.fernLime, -16, H - 48, { dur: 3.5 }),
      sprite(S.fernLime, 70, H - 44, { dur: 4.0, delay: -1.1 }),
      sprite(S.fernLime, 200, H - 46, { dur: 3.8, delay: -2.4 }),
      sprite(S.leafR, W - 64, H - 64, { dur: 4.3, delay: -0.4 }),
    ],
  });
}

// ---------- Scene 4: RIVER (reading; inspired by ref 6 river + hibiscus) ----------
{
  const px = new Px(W, H); const line = 104;
  px.vgrad(0, line, [[0, P.cyanDeep], [0.55, P.cyan], [1, P.cyanLight]]);
  const r = rng(61);
  for (let i = 0; i < 7; i++) { const cx = r() * W, cy = 40 + r() * 40; for (let k = 0; k < 5; k++) px.dcloud(cx + (k - 2) * 9, cy - Math.sin(k) * 5, 12 + r() * 6, 7 + r() * 3, P.white, 0.9); }
  canopyBand(px, 62, 84, 104, { dark: P.greenMid, mid: P.green, light: P.lime }, 46, 4, 9);
  for (const [x, h] of [[84, 30], [112, 36], [150, 28], [196, 34], [236, 30]]) palmTrunk(px, x, line - 4, x + 4, line - h, 2, P.salmon, P.coralDeep);
  for (let x = 0; x < W; x++) for (let y = line - 2; y < line + 1; y++) px.dset(x, y, P.salmon, P.coralDeep, 0.4); // salmon riverbank
  const water = { line, segments: segmentsFromMask(() => true, line, H), shallow: [64, 120, 214], deep: [36, 64, 160], tint: 0.4, amp: 2, speed: 1.3, squash: 0.85, glint: P.white, glint2: P.cyanLight, glintDensity: 0.12, flow: 7 };
  water.shallow = mixc(P.blue, P.cyan, 0.45); water.deep = mixc(P.blueDark, P.teal, 0.3);
  finishScene('river', px, {
    water, focus: '50% 55%',
    sprites: [
      ...[[84, 30], [112, 36], [150, 28], [196, 34], [236, 30]].map(([x, h], i) => sprite(S.palmSmall, x + 4 - 19, line - h - 8, { layer: 'mid', dur: 4 + i * 0.37, delay: -i * 0.9 })),
      sprite(S.hibPink, -6, H - 70, { dur: 3.6 }),
      sprite(S.hibPink, 24, H - 46, { dur: 4.1, delay: -1.5 }),
      sprite(S.leafL, -20, H - 40, { dur: 3.3, delay: -0.7 }),
      sprite(S.leafR, W - 56, H - 62, { dur: 4.5, delay: -2 }),
      sprite(S.lotus, 230, H - 34, { kind: 'bob', dur: 5 }),
    ],
  });
}

// ---------- Scene 5: DUSK (videos; inspired by ref 7 sunset beach hut) ----------
{
  const px = new Px(W, H); const line = 100;
  px.vgrad(0, line, [[0, [70, 70, 120]], [0.35, [150, 92, 140]], [0.62, P.salmon], [0.85, P.orange], [1, P.sun]]);
  const r = rng(71);
  for (let i = 0; i < 18; i++) px.dcloud(r() * W, 14 + r() * 60, 20 + r() * 40, 2 + r() * 3, r() > 0.5 ? P.salmonLight : [196, 110, 140], 0.8);
  px.ellipse(160, line - 6, 13, 13, P.sun); px.ellipse(160, line - 6, 9, 9, P.sunPale);
  for (let x = 0; x < W; x++) px.set(x, line - 1, P.salmonPale);
  // beach (lilac-salmon sand) and hut
  const beach = (x, y) => y > 132 - Math.round(Math.sin(x * 0.02) * 6);
  for (let y = line; y < H; y++) for (let x = 0; x < W; x++) if (beach(x, y)) px.dset(x, y, [196, 150, 190], P.salmonLight, ((y - 128) / 52));
  // hut on stilts + palm trunks: drawn on an "over" layer so the water passes behind them
  const over = new Px(W, H);
  over.rect(118, 116, 2, 24, P.barkDark); over.rect(156, 116, 2, 24, P.barkDark); over.rect(137, 116, 2, 26, P.barkDark);
  over.rect(114, 104, 48, 14, P.bark); over.rect(118, 107, 8, 6, P.sun); over.rect(150, 107, 8, 6, P.sun); over.rect(134, 106, 8, 12, P.orange);
  over.rect(110, 117, 56, 2, P.barkDark); // deck
  over.poly([[106, 106], [170, 106], [138, 74]], P.barkDark); over.poly([[110, 104], [166, 104], [138, 78]], [196, 134, 92]);
  for (let x = 112; x < 166; x += 3) over.line(x, 104, 138 + (x - 138) * 0.2, 82, [170, 112, 76]);
  over.line(138, 74, 138, 62, P.barkDark);
  palmTrunk(over, 40, 150, 52, 64, 6, P.barkLight, P.barkDark); palmTrunk(over, 286, 156, 272, 70, -6, P.barkLight, P.barkDark);
  const water = { line, segments: segmentsFromMask((x, y) => !beach(x, y), line, H), shallow: P.salmon, deep: [60, 80, 140], tint: 0.35, amp: 2, speed: 1.2, squash: 0.95, glint: P.sunPale, glint2: P.white, glintDensity: 0.14, flow: 4 };
  finishScene('dusk', px, {
    water, over, focus: '50% 60%',
    sprites: [
      sprite(S.palmDusk, 52 - 32, 64 - 14, { layer: 'mid', dur: 4.4 }),
      sprite(S.palmDusk, 272 - 32, 70 - 14, { layer: 'mid', dur: 5, delay: -1.7 }),
      sprite(S.hibCoral, 4, H - 44, { dur: 3.8 }),
      sprite(S.fernTeal, W - 60, H - 38, { dur: 4.2, delay: -1 }),
    ],
  });
}

// ---------- Scene 6: VALLEY (statistics/profile; inspired by ref 8 rainbow valley) ----------
{
  const px = new Px(W, H); const line = 150;
  px.vgrad(0, 110, [[0, [120, 90, 190]], [0.35, P.pinkLight], [0.7, P.salmonLight], [1, P.salmonPale]]);
  const r = rng(81);
  for (let i = 0; i < 14; i++) px.dcloud(r() * W, 10 + r() * 50, 24 + r() * 30, 6 + r() * 6, r() > 0.4 ? P.pinkPale : P.white, 0.85);
  // pixel rainbow arc
  const bands = [P.coral, P.orange, P.sun, P.lime, P.cyan, P.blue, [150, 100, 220]];
  for (let y = 20; y < 130; y++) for (let x = 120; x < 320; x++) {
    const d = Math.hypot(x - 236, (y - 150) * 1.15); const k = Math.floor((d - 96) / 3);
    if (k >= 0 && k < bands.length) px.dset(x, y, px.get(x, y), bands[k], 0.7);
  }
  ridge(px, 82, 100, 40, 60, mixc(P.green, P.tropTeal, 0.5), P.lime);
  ridge(px, 83, 118, 34, 50, P.greenMid, P.lime);
  ridge(px, 84, 136, 22, 40, P.green, P.limeLight);
  canopyBand(px, 85, 130, 150, { dark: P.greenDark, mid: P.green, light: P.lime }, 40, 3, 7);
  const lake = (x, y) => x > 44 + (y - line) * 1.6 + Math.sin(y * 0.6) * 2 && x < 278 - (y - line) * 1.2 + Math.cos(y * 0.5) * 2;
  const water = { line, segments: segmentsFromMask(lake, line, H), shallow: P.cyan, deep: P.teal, tint: 0.35, amp: 2, speed: 1.5, squash: 0.85, glint: P.white, glint2: P.pinkPale, glintDensity: 0.1, flow: 5 };
  for (let y = line; y < H; y++) for (let x = 0; x < W; x++) if (!lake(x, y)) px.dset(x, y, P.greenDark, P.greenMid, 0.4);
  canopyBand(px, 86, 152, 178, { dark: P.greenDeep, mid: P.greenMid, light: P.green }, 10, 4, 8, -10, 40);
  canopyBand(px, 87, 152, 178, { dark: P.greenDeep, mid: P.greenMid, light: P.green }, 10, 4, 8, 284, W + 10);
  finishScene('valley', px, {
    water, focus: '50% 60%',
    sprites: [
      sprite(S.hibPink, -10, H - 48, { dur: 3.7 }),
      sprite(S.hibCoral, W - 62, H - 48, { dur: 4.1, delay: -1.2 }),
      sprite(S.fernLime, 230, H - 40, { dur: 3.9, delay: -2 }),
      sprite(S.lotus, 150, H - 32, { kind: 'bob', dur: 5.4 }),
    ],
  });
}

// ================================================================= LANGUAGE THEMES (extension)
// Tamil: refs 1–8 (art) + 9–10 (colour). Malayalam: refs 11–17 (art) + 18–19 (colour).
// Kannada & Telugu: no reference images supplied — built only from the written brief and its hex colours.
const X = Object.fromEntries(Object.entries({
  // Tamil palette (refs 9–10)
  rouge: '#E27396', pinkMist: '#EB9AB2', frost: '#EFCFE3', beige: '#ECF2D8', lblue: '#B3DEE2',
  agent: '#F06936', placid: '#1BACB2', parakeet: '#76A846', berries: '#F3B5CF', xpink: '#E44587',
  jasG1: '#5E7A2E', jasG2: '#86A13F', jasG3: '#B5C76A', jasW: '#FFFBEA', jasC: '#EDE6C0', jasS: '#CBBF93',
  wood: '#8A5A3A', woodL: '#B47E52', woodD: '#5A3822', gold: '#E2B23A', goldL: '#FCE38A', goldD: '#A87A1E',
  kur1: '#7C6FD0', kur2: '#A79BEE', kur3: '#5C4FAE', kurB: '#B98DB8',
  // Malayalam palette (refs 18–19)
  softCyan: '#89FAF6', turq: '#64E3C7', ttea: '#51B8B5', sham: '#399E5A', spruce: '#26532B', depths: '#0B6D6E', aquaC: '#24A9B8',
  verdant: '#63C48E', lime2: '#A7D76F', sunlit: '#DDE88E', mist2: '#F3FBF7', smoke1: '#EEF2F0', smoke2: '#DCE3E0', smoke3: '#C7D1CE',
  rock1: '#8E9693', rock2: '#6C7471', rock3: '#B4BAB7', moss: '#7FB04A', banY: '#F2D33D', banG: '#B9C84A', banP: '#7E2A55',
  // Kannada (brief)
  k1: '#C51605', k2: '#EB3031', k3: '#F85726', k4: '#FD9029', k5: '#684C26', k6: '#5B7B11', k7: '#404B1E', k8: '#8F6F16', k9: '#437826', k10: '#2C5918', k11: '#6C993F', k12: '#2F6156',
  // Telugu (brief)
  t1: '#F7B720', t2: '#D8CF00', t3: '#FFF6B7', t4: '#F3F871', t5: '#C1D653', t6: '#FFF8E0', t7: '#FEE08E', tSalmon: '#F9A88A', tAqua: '#4CC9B0', tAquaD: '#2E9E8A', tGreen: '#8DBF4A', tGreenD: '#4E7E2A', tMango: '#F5A623',
}).map(([k, v]) => [k, hex(v)]));

// ---------- sprites
function jasmineBranch(name, W = 56, H = 48, flip = false) {
  return sheet(name, W, H, (f, b, fi) => {
    const pts = [];
    for (let i = 0; i <= 30; i++) { const s = i / 30; pts.push([4 + s * (W - 14) + Math.sin(s * 3) * 3 + b * s * 1.2, H - 3 - s * (H - 12) - Math.sin(s * 5) * 2]); }
    pts.forEach(([x, y], i) => { if (i % 1 === 0) f.set(x, y, X.jasG1); if (i % 2) f.set(x, y + 1, X.woodD); });
    const lc = { dark: X.jasG1, mid: X.jasG2, light: X.jasG3, rib: X.jasG3 };
    [[6, -2.3, 9], [12, -0.6, 10], [18, -2.6, 8], [22, -0.4, 9], [27, -2.0, 7]].forEach(([i, a, l], k) => leafShape(f, pts[i][0], pts[i][1], a + b * 0.06 * (k % 2 ? 1 : -1), l, 2.6, lc, 0.2));
    // jasmine buds and open flowers (Image 1): buds sway, some open in alternate frames
    [[8, 0], [14, 1], [20, 2], [25, 3], [29, 4], [16, 5], [24, 6]].forEach(([i, k]) => {
      const [x, y] = pts[i]; const dx = ((k + fi) % 2 ? 1 : 0) * Math.sign(b || 1);
      const bx = x + dx + (k % 2 ? 3 : -3), by = y - 3 - (k % 3);
      const open = (k + fi) % 4 === 0;
      if (open) { for (const [ox, oy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1]]) f.set(bx + ox, by + oy, X.jasW); f.set(bx, by, X.sun); }
      else { f.set(bx, by, X.jasW); f.set(bx, by - 1, X.jasW); f.set(bx + 1, by, X.jasC); f.set(bx, by + 1, X.jasS); }
    });
    if (flip) { const c = f.clone(); f.d.fill(0); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (c.alpha(x, y)) f.set(W - 1 - x, y, c.get(x, y)); }
  });
}
function kurinjiBush(name, W = 64, H = 44) {
  return sheet(name, W, H, (f, b, fi) => {
    const r = rng(77);
    for (let i = 0; i < 14; i++) f.shadedBlob(6 + r() * (W - 12), H - 8 - r() * 10, 6 + r() * 5, 4 + r() * 3, P.greenDeep, P.greenMid, P.green);
    for (let i = 0; i < 26; i++) {
      const x = 4 + r() * (W - 8), y = H - 14 - r() * (H - 20); const sh = ((i + fi) % 2 ? 1 : -1) * (Math.abs(b) > 0.5 ? 1 : 0);
      for (let k = 0; k < 4; k++) f.set(x + sh, y - k, k < 1 ? X.kurB : k % 2 ? X.kur1 : X.kur2);
      f.set(x + sh + 1, y - 2, X.kur3); f.set(x + sh - 1, y - 1, X.kur2);
    }
  });
}
function tropicalBush(name, W = 72, H = 64) {
  return sheet(name, W, H, (f, b) => {
    const cols = [{ dark: P.greenDeep, mid: P.greenMid, light: P.green, rib: P.lime }, { dark: P.greenDark, mid: P.leaf, light: P.lime, rib: P.limePale }];
    [[-1.9, 30, 7], [-1.5, 34, 8], [-1.2, 28, 7], [-2.3, 26, 6], [-0.8, 24, 6], [-2.6, 20, 5], [-1.0, 18, 5]].forEach(([a, l, w], k) =>
      leafShape(f, W / 2 + (k - 3) * 2, H - 1, a + b * 0.045 * (k % 2 ? 1 : -1), l, w, cols[k % 2], k % 2 ? 0.25 : -0.2));
  });
}
function pinkFlowers(name, W = 56, H = 34) {
  return sheet(name, W, H, (f, b, fi) => {
    for (let x = 0; x < W; x += 2) f.line(x, H - 1, x + ((x + fi) % 3) - 1, H - 6 - (x % 5), x % 4 ? P.green : P.greenMid);
    const r = rng(88);
    for (let i = 0; i < 8; i++) {
      const cx = 5 + r() * (W - 10), cy = 6 + r() * (H - 16); const sh = (i + fi) % 2 ? 1 : 0;
      f.line(cx, cy + 3, cx, H - 2, P.greenMid);
      for (let k = 0; k < 6; k++) { const a = k * 1.047 + b * 0.2; f.set(cx + sh + Math.round(Math.cos(a) * 2.4), cy + Math.round(Math.sin(a) * 2.4), k % 2 ? X.xpink : X.berries); f.set(cx + sh + Math.round(Math.cos(a) * 1.4), cy + Math.round(Math.sin(a) * 1.4), X.xpink); }
      f.set(cx + sh, cy, X.t1);
    }
  });
}
function sunSheet(name, R, cols) {
  const S = R * 2 + 24;
  return sheet(name, S, S, (f, b, fi) => {
    const c = S / 2;
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2 + fi * 0.13; for (let d = R + 3; d < R + 9 + (k % 2) * 3; d++) f.dset(c + Math.cos(a) * d, c + Math.sin(a) * d, cols.ray, cols.ray, 1 - (d - R) / 14); }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const d = Math.hypot(x - c, y - c); if (d < R + 2 && d >= R) f.dset(x, y, cols.glow, cols.glow, 0.5 + (fi % 2) * 0.2); }
    f.ellipse(c, c, R, R, cols.disc); f.ellipse(c - R * 0.15, c - R * 0.15, R * 0.6, R * 0.6, cols.core);
  }, [0, 1, 2, 3]);
}
function bananaPlant(name, W = 84, H = 100) {
  return sheet(name, W, H, (f, b) => {
    const x0 = W / 2;
    for (let y = H - 1; y > H * 0.45; y--) { f.set(x0 - 1, y, P.greenDark); f.set(x0, y, X.banG); f.set(x0 + 1, y, P.greenMid); f.set(x0 + 2, y, y % 7 ? P.greenDark : X.wood); }
    const top = [x0, Math.round(H * 0.45)];
    const lc = { dark: P.greenDark, mid: P.leaf, light: P.lime, rib: P.limePale };
    [[-2.6, 36, 6], [-2.1, 40, 7], [-1.6, 38, 7], [-1.1, 40, 7], [-0.55, 36, 6], [-3.0, 30, 5], [-0.15, 30, 5]].forEach(([a, l, w], k) => {
      leafShape(f, top[0], top[1], a + b * 0.05 * (k % 2 ? 1 : -1), l, w, lc, a < -1.6 ? -0.5 : 0.5);
      // torn banana-leaf edges
      for (let s = 6; s < l; s += 4) { const xx = top[0] + Math.cos(a) * s, yy = top[1] + Math.sin(a) * s; f.d[(Math.round(yy + 3) * W + Math.round(xx)) * 4 + 3] = 0; }
    });
    // hanging bunch (Image 17) + purple bud
    for (let r = 0; r < 4; r++) for (let k = -2; k <= 2; k++) { const bx = x0 + 6 + k * 2 + b, by = top[1] + 8 + r * 4; f.set(bx, by, X.banY); f.set(bx, by + 1, X.banG); f.set(bx + 1, by + 1, X.banY); }
    f.line(x0 + 6 + b, top[1] + 2, x0 + 6 + b, top[1] + 26, P.greenDark);
    f.shadedBlob(x0 + 6 + b, top[1] + 30, 2.5, 3.5, X.banP, '#A0406E' && hex('#A0406E'), hex('#C66A92'));
  });
}
function bananaBunch(name) {
  return sheet(name, 16, 24, (f, b) => {
    f.line(8, 0, 8 + b * 0.5, 6, P.greenDark);
    for (let r = 0; r < 4; r++) for (let k = -2; k <= 2; k++) { const x = 8 + k * 2 + b * 0.5, y = 6 + r * 3; f.set(x, y, X.banY); f.set(x, y + 1, k % 2 ? X.banG : X.banY); }
    f.shadedBlob(8 + b * 0.6, 20, 2, 2.5, X.banP, hex('#A0406E'), hex('#C66A92'));
  }, [-1, 0, 1, 0]);
}
function whiteFlowers(name, W = 40, H = 24) {
  return sheet(name, W, H, (f, b, fi) => {
    const r = rng(99);
    for (let i = 0; i < 6; i++) f.shadedBlob(4 + r() * (W - 8), H - 4 - r() * 5, 4, 2.6, P.greenDeep, X.sham, X.verdant);
    for (let i = 0; i < 7; i++) {
      const cx = 4 + r() * (W - 8), cy = 4 + r() * (H - 12); const open = 1.6 + ((i + fi) % 2) * 0.6;
      for (let k = 0; k < 5; k++) { const a = k * 1.2566 - 1.57 + b * 0.15; f.set(cx + Math.round(Math.cos(a) * open), cy + Math.round(Math.sin(a) * open), P.white); }
      f.set(cx, cy, X.sunlit);
    }
  });
}
function frangipaniCorner(name, S = 22) {
  return sheet(name, S, S, (f, b, fi) => {
    leafShape(f, 2, S - 2, -0.5, 14, 3, { dark: X.k10, mid: X.k9, light: X.k11, rib: X.k11 }, 0.2);
    for (const [cx, cy, sc] of [[8, 8, 1], [15, 12, 0.8]]) {
      for (let k = 0; k < 5; k++) { const a = k * 1.2566 + fi * 0.12 + b * 0.1; f.shadedBlob(cx + Math.cos(a) * 3 * sc, cy + Math.sin(a) * 3 * sc, 2.4 * sc, 1.8 * sc, hex('#F0D9C2'), P.white, P.white, hex('#E3B98C')); }
      f.ellipse(cx, cy, 1.4 * sc, 1.4 * sc, P.sun); f.set(cx, cy, X.k4);
    }
  });
}
function mangoBranch(name, W = 100, H = 58) {
  return sheet(name, W, H, (f, b) => {
    for (let x = 0; x < W - 8; x++) { const y = 6 + Math.sin(x / 18) * 3 + (x / W) * 6 + b * (x / W) * 2; f.set(x, y, X.k5); f.set(x, y + 1, P.barkDark); }
    const lc = { dark: X.tGreenD, mid: X.tGreen, light: X.t5, rib: X.t4 };
    for (let k = 0; k < 9; k++) { const x = 6 + k * 10; leafShape(f, x, 8 + Math.sin(x / 18) * 3, (k % 2 ? 0.9 : 2.2) + b * 0.06, 16, 2.6, lc, 0.15); }
    for (const [x, dy] of [[24, 18], [50, 24], [78, 20]]) { f.line(x, 10, x + b, 10 + dy - 8, X.k5); f.shadedBlob(x + b, 10 + dy, 4, 5.5, X.k4, X.tMango, X.t7); f.set(x + b - 2, 10 + dy - 3, X.tGreen); }
  });
}
function leafCluster(name, cols, W = 40, H = 30) {
  return sheet(name, W, H, (f, b) => { const r = rng(55); for (let i = 0; i < 9; i++) f.shadedBlob(6 + r() * (W - 12) + b * (i % 2 ? 1 : -1), 6 + r() * (H - 12), 5 + r() * 3, 4 + r() * 2, cols.dark, cols.mid, cols.light); });
}
function hangingPalm(name, W = 90, H = 50) {
  return sheet(name, W, H, (f, b) => frond(f, 2, 2, 0.35 + b * 0.05, 80, 0.5, { spine: X.spruce, dark: X.spruce, mid: X.sham, light: X.lime2 }, 7));
}

const T = {
  jasmine: reg(jasmineBranch('jasmine-branch')), jasmineFlip: reg(jasmineBranch('jasmine-branch-r', 56, 48, true)),
  kurinji: reg(kurinjiBush('kurinji-bush')), tbush: reg(tropicalBush('tropical-bush')), pinkf: reg(pinkFlowers('pink-flowers')),
  sunTa: reg(sunSheet('sun-ta', 14, { disc: X.agent, core: hex('#FFB38A'), glow: X.berries, ray: hex('#FFD8C8') })),
  sunKn: reg(sunSheet('sun-kn', 20, { disc: X.k3, core: X.k4, glow: X.k2, ray: hex('#FDB46A') })),
  sunTe: reg(sunSheet('sun-te', 24, { disc: X.t1, core: X.t3, glow: X.t7, ray: X.t6 })),
  banana: reg(bananaPlant('banana-plant')), bunch: reg(bananaBunch('banana-bunch')), whitef: reg(whiteFlowers('white-flowers')),
  frangi: reg(frangipaniCorner('frangipani-anim')), mango: reg(mangoBranch('mango-branch')), hpalm: reg(hangingPalm('hanging-palm')),
  banyanLeaves: reg(leafCluster('banyan-leaves', { dark: X.k10, mid: X.k9, light: X.k11 })),
  mangoLeaves: reg(leafCluster('mango-leaves', { dark: X.tGreenD, mid: X.tGreen, light: X.t5 })),
};
// UI ornaments for theme frames (animated sheets used by CSS)
// frame ornaments sized for 2× integer scaling on window corners
const UIJ = reg(jasmineBranch('jasmine-corner', 32, 28)); const UIW = reg(whiteFlowers('white-corner', 24, 16));
for (const [n, m] of [['jasmine-corner', UIJ], ['white-corner', UIW], ['frangipani-corner-anim', T.frangi], ['banana-hang', T.bunch]]) fs.copyFileSync(path.join(OUT, m.sheet), path.join(OUT, 'ui', `${n}.png`));
reg(sheet('mango-corner', 28, 24, (f, b) => { leafShape(f, 2, 4, 0.5, 18, 3, { dark: X.tGreenD, mid: X.tGreen, light: X.t5, rib: X.t4 }, 0.2); f.line(10, 5, 12 + b, 12, X.k5); f.shadedBlob(12 + b, 16, 3.5, 4.5, X.k4, X.tMango, X.t7); }));
fs.copyFileSync(path.join(OUT, 'sprites', 'mango-corner.png'), path.join(OUT, 'ui', 'mango-corner.png'));

// ---------- static drawing helpers
function pillar(px, x, w, top, bottom, c) {
  for (let y = top; y < bottom; y++) for (let i = 0; i < w; i++) {
    const t = i / w; const band = ((y - top) % 26) < 4;
    let col = t < 0.2 ? c.l : t > 0.78 ? c.d : c.m;
    if (!band && i > 2 && i < w - 3 && i % 4 === 1) col = c.d; // fluting
    if (band) col = (y + i) % 3 ? c.l : c.m;
    px.set(x + i, y, col);
  }
  for (const [yy, ext] of [[top - 6, 4], [top - 10, 6], [top - 13, 3], [bottom, 4], [bottom + 4, 6]]) for (let i = -ext; i < w + ext; i++) for (let k = 0; k < 4; k++) px.set(x + i, yy + k, k === 0 ? c.l : k === 3 ? c.d : c.m);
}
function garland(px, x, y0, len, seed) {
  for (let k = 0; k < len; k++) { const y = y0 + k * 2; const col = k % 9 === 4 ? X.agent : k % 9 === 5 ? X.xpink : (k % 2 ? X.jasW : X.jasC); px.set(x, y, col); px.set(x + 1, y, k % 2 ? X.jasS : X.jasW); }
  px.set(x, y0 + len * 2, X.xpink); px.set(x + 1, y0 + len * 2 + 1, X.agent);
  void seed;
}
function kalash(px, cx, by) {
  px.shadedBlob(cx, by - 8, 9, 8, X.goldD, X.gold, X.goldL, hex('#6E4E10'));
  px.rect(cx - 5, by - 1, 10, 2, X.goldD); px.rect(cx - 6, by + 1, 12, 2, X.gold);
  px.rect(cx - 6, by - 16, 12, 3, X.goldD); px.rect(cx - 8, by - 9, 16, 1, X.agent);
  [[-1.0, -8], [-2.2, -8], [-0.4, -6], [-2.7, -6], [-1.6, -9]].forEach(([a, l]) => leafShape(px, cx, by - 16, a, -l * -1, 2.2, { dark: P.greenDark, mid: P.green, light: P.lime, rib: P.limePale }, 0));
  px.shadedBlob(cx, by - 22, 4.5, 6, P.barkDark, P.bark, P.barkLight); px.rect(cx - 4, by - 20, 9, 1, X.agent);
}
function tree(px, x, top, trunkH, rx, ry, cols, trunk, seed, fruit) {
  px.rect(x - 2, top + ry, 5, trunkH, trunk.m); px.rect(x - 2, top + ry, 1, trunkH, trunk.l); px.rect(x + 2, top + ry, 1, trunkH, trunk.d);
  canopyBand(px, seed, top, top + ry * 1.4, cols, 22, Math.max(3, rx * 0.3), Math.max(5, rx * 0.55), x - rx, x + rx);
  if (fruit) { const r = rng(seed + 1); for (let i = 0; i < 14; i++) { const fx = x - rx * 0.8 + r() * rx * 1.6, fy = top + r() * ry * 1.3; px.set(fx, fy, fruit[0]); px.set(fx, fy + 1, fruit[1]); } }
}

// ---------- Scene: Tamil sunrise (refs 1, 2–3, 4–5, 6, 7, 9–10)
{
  const px = new Px(W, H); const line = 146;
  px.vgrad(0, 132, [[0, X.lblue], [0.35, hex('#D6E9EC')], [0.6, X.frost], [0.82, X.berries], [1, X.pinkMist]]);
  const r = rng(201);
  for (let i = 0; i < 12; i++) px.dcloud(r() * W, 10 + r() * 60, 20 + r() * 34, 2 + r() * 3, r() > 0.5 ? P.white : X.frost, 0.75);
  ridge(px, 202, 108, 22, 46, hex('#9FB3D9'), hex('#B8C8E6'));          // blue kurinji hills (ref 5)
  ridge(px, 203, 122, 14, 34, hex('#7E9BC8'), null);
  ridge(px, 204, 134, 10, 30, X.parakeet, P.lime);
  px.vgrad(134, H - 1, [[0, X.parakeet], [1, P.greenMid]], 0, W - 1);
  for (let y = 136; y < H; y++) for (let x = 0; x < W; x++) if (rng(x * 7 + y)() > 0.985) px.set(x, y, (x + y) % 2 ? X.xpink : X.berries);
  const pond = (x, y) => Math.hypot((x - 160) / 58, (y - 160) / 13) < 1;
  // temple pillars at the sides with jasmine garlands (refs 2–3), drawn in front
  const over = new Px(W, H);
  pillar(over, 6, 18, 26, 150, { l: X.woodL, m: X.wood, d: X.woodD });
  pillar(over, 296, 18, 26, 150, { l: X.goldL, m: X.gold, d: X.goldD });
  for (let y = 0; y < 14; y++) for (let x = 0; x < W; x++) if (x < 44 || x > 276) over.set(x, y, y > 9 ? X.woodD : (x + y) % 5 ? X.wood : X.woodL);
  garland(over, 30, 14, 34, 1); garland(over, 38, 14, 26, 2); garland(over, 286, 14, 30, 3); garland(over, 278, 14, 22, 4);
  kalash(over, 56, 156);                                               // Image 6
  const water = { line: 148, segments: segmentsFromMask(pond, 146, H), shallow: X.lblue, deep: X.placid, tint: 0.45, amp: 1, speed: 1.3, squash: 0.7, glint: P.white, glint2: X.berries, glintDensity: 0.1, flow: 3 };
  finishScene('ta-sunrise', px, {
    water, over, focus: '50% 60%',
    sprites: [
      sprite(T.sunTa, 218, 58, { layer: 'mid', dur: 6, kind: 'rise' }),
      sprite(T.kurinji, 70, 100, { layer: 'mid', dur: 2.6 }), sprite(T.kurinji, 186, 104, { layer: 'mid', dur: 2.9, delay: -1 }),
      sprite(S.leafL, -6, 40, { layer: 'mid', dur: 4.2 }), sprite(S.leafR, W - 64, 44, { layer: 'mid', dur: 4.6, delay: -1.3 }),
      sprite(T.tbush, 230, H - 64, { dur: 2.4 }), sprite(T.tbush, 18, H - 60, { dur: 2.7, delay: -0.8 }),
      sprite(T.pinkf, 96, H - 34, { dur: 2.2 }), sprite(T.pinkf, 214, H - 32, { dur: 2.5, delay: -1.2 }),
      sprite(T.jasmine, -2, H - 48, { dur: 3.2 }), sprite(T.jasmineFlip, W - 54, H - 48, { dur: 3.6, delay: -1.7 }),
      sprite(S.lotus, 150, 146, { kind: 'bob', dur: 5 }),
    ],
  });
}
// ---------- Scene: Tamil meadow with moving sun rays (refs 7–8, 5)
{
  const px = new Px(W, H);
  px.vgrad(0, 120, [[0, X.lblue], [0.5, hex('#DDEDEE')], [0.85, X.frost], [1, X.berries]]);
  for (let y = 0; y < 90; y++) for (let x = 180; x < W; x++) { const d = Math.hypot(x - 286, y - 24); if (d > 40 && d < 44) px.dset(x, y, px.get(x, y), hex('#FFE8C8'), 0.5); if (Math.abs(d - 70) < 1.2) px.dset(x, y, px.get(x, y), X.berries, 0.5); }
  ridge(px, 211, 92, 40, 70, hex('#A9BCDF'), hex('#C6D2EC'));
  ridge(px, 212, 108, 26, 50, hex('#86A7C7'), null);
  ridge(px, 213, 124, 18, 40, X.parakeet, P.lime);
  px.vgrad(124, H - 1, [[0, X.parakeet], [1, P.greenMid]]);
  const r = rng(214);
  for (let i = 0; i < 900; i++) { const x = r() * W, y = 126 + r() * 54; const c = [X.xpink, X.berries, X.t1, P.white, X.kur2][Math.floor(r() * 5)]; px.set(x, y, c); if (y > 150) px.set(x + 1, y, c); }
  finishScene('ta-meadow', px, {
    focus: '50% 55%',
    sprites: [
      sprite(T.sunTa, 262, 0, { layer: 'mid', dur: 5, kind: 'rise' }),
      sprite(T.kurinji, 30, 104, { layer: 'mid', dur: 2.8 }), sprite(T.kurinji, 240, 106, { layer: 'mid', dur: 3.1, delay: -1.2 }),
      sprite(T.pinkf, 10, H - 34, { dur: 2.1 }), sprite(T.pinkf, 120, H - 30, { dur: 2.4, delay: -0.6 }), sprite(T.pinkf, 250, H - 34, { dur: 2.6, delay: -1.4 }),
      sprite(T.jasmine, -4, H - 48, { dur: 3.3 }), sprite(T.jasmineFlip, W - 52, H - 48, { dur: 3.5, delay: -1 }),
      sprite(T.tbush, 176, H - 62, { dur: 2.6, delay: -0.4 }),
    ],
  });
}
// ---------- Scene: Kerala hills and waterfall (refs 14–16, 11–13; colours 18–19)
{
  const px = new Px(W, H); const line = 154;
  px.vgrad(0, 110, [[0, X.smoke1], [0.5, X.smoke2], [1, X.smoke3]]);           // smoky, light grey sky
  const r = rng(301);
  for (let i = 0; i < 14; i++) px.dcloud(r() * W, 8 + r() * 60, 26 + r() * 30, 5 + r() * 5, r() > 0.5 ? X.mist2 : hex('#E2E8E6'), 0.8);
  ridge(px, 302, 86, 34, 44, hex('#A9C6C0'), null); ridge(px, 303, 100, 30, 38, hex('#7FA99F'), null);
  for (let y = 92; y < 112; y++) for (let x = 0; x < W; x++) px.dset(x, y, px.get(x, y), X.mist2, 0.35 * Math.sin(((y - 92) / 20) * Math.PI));
  // green cliff with three falls (ref 15) and a mossy rock face (ref 16)
  const cn = noise1(306, 9);
  for (let x = 104; x < 300; x++) {
    const edge = Math.min(x - 104, 300 - x);
    const top = Math.round(36 + 16 * cn(x) + Math.max(0, 30 - edge) * 1.6);
    for (let y = top; y < line; y++) px.dset(x, y, X.spruce, X.sham, ((x * 3 + y) % 9) / 18 + 0.1 + (cn(x + y) - 0.5) * 0.3);
  }
  const jn = noise1(307, 4);
  for (const [cx, w] of [[159, 11], [203, 8], [242, 7]]) for (let y = 44; y < line; y++) {
    const half = w / 2 + 2 + Math.round((jn(y + cx) - 0.5) * 6) + (y - 44) * 0.04;
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) px.dset(x, y, X.rock2, X.rock1, ((x + y) % 5) / 10 + 0.2);
  }
  for (let i = 0; i < 40; i++) px.shadedBlob(150 + r() * 100, 50 + r() * 90, 2 + r() * 2, 1.5 + r(), X.spruce, X.moss, X.lime2);
  canopyBand(px, 304, 106, 152, { dark: X.spruce, mid: X.sham, light: X.verdant }, 60, 5, 11);
  const pool = (x, y) => x > 120 - (y - line) && x < 300 + (y - line);
  for (let y = line; y < H; y++) for (let x = 0; x < W; x++) if (!pool(x, y)) px.dset(x, y, X.spruce, X.sham, 0.4);
  const water = { line, segments: segmentsFromMask(pool, line, H), shallow: X.aquaC, deep: X.depths, tint: 0.45, amp: 1, speed: 1.8, squash: 0.8, glint: X.mist2, glint2: X.softCyan, glintDensity: 0.12, flow: 4 };
  const falls = [[152, 14], [198, 10], [238, 8]].map(([x, w], i) => ({ x, y: 44 + i * 4, w, h: line - 44 - i * 4, colors: [X.softCyan, P.white, X.mist2], speed: 26 + i * 4, spread: 3, mist: P.white }));
  finishScene('ml-hills', px, {
    water, falls, focus: '60% 50%',
    sprites: [
      sprite(S.leafL, -18, H - 64, { dur: 4.4, delay: -2 }),
      sprite(S.fernLime, -16, H - 48, { dur: 3.4 }), sprite(S.fernLime, 70, H - 46, { dur: 3.9, delay: -1.3 }),
      sprite(T.banana, 22, 54, { layer: 'mid', dur: 4.6 }),
      sprite(T.whitef, 100, H - 26, { dur: 2.2 }), sprite(T.whitef, 270, H - 24, { dur: 2.6, delay: -1 }),
      sprite(S.leafR, W - 60, H - 64, { dur: 4.1, delay: -0.6 }),
    ],
  });
}
// ---------- Scene: Kerala banana grove and backwater (refs 17, 11–13)
{
  const px = new Px(W, H); const line = 140;
  px.vgrad(0, line, [[0, X.smoke1], [0.6, X.smoke2], [1, hex('#CFDAD6')]]);
  ridge(px, 311, 104, 18, 40, hex('#9FC0B8'), null);
  canopyBand(px, 312, 96, 138, { dark: X.spruce, mid: X.sham, light: X.verdant }, 70, 5, 12);       // jungle border (ref 11)
  for (let x = 0; x < W; x++) for (let y = line - 3; y < line; y++) px.dset(x, y, X.sham, X.spruce, 0.5);
  const water = { line, segments: segmentsFromMask(() => true, line, H), shallow: X.ttea, deep: X.depths, tint: 0.4, amp: 2, speed: 1.2, squash: 0.85, glint: X.mist2, glint2: X.sunlit, glintDensity: 0.1, flow: 5 };
  finishScene('ml-banana', px, {
    water, focus: '50% 55%',
    sprites: [
      sprite(T.banana, 10, 44, { layer: 'mid', dur: 4.8 }), sprite(T.banana, 120, 40, { layer: 'mid', dur: 5.3, delay: -1.6 }), sprite(T.banana, 236, 46, { layer: 'mid', dur: 4.4, delay: -2.4 }),
      sprite(S.fernLime, -14, H - 46, { dur: 3.6 }), sprite(S.fernTeal, W - 62, H - 40, { dur: 4.2, delay: -0.9 }),
      sprite(T.whitef, 70, H - 24, { dur: 2.3 }), sprite(T.whitef, 180, H - 22, { dur: 2.7, delay: -1.1 }),
    ],
  });
}
// ---------- Scene: Kannada sunset with banyan and fig trees (brief only; no reference images)
{
  const px = new Px(W, H); const line = 142;
  px.vgrad(0, line, [[0, X.k12], [0.3, hex('#7A2A1E')], [0.5, X.k1], [0.68, X.k2], [0.85, X.k3], [1, X.k4]]);
  const r = rng(401);
  for (let i = 0; i < 12; i++) px.dcloud(r() * W, 14 + r() * 70, 22 + r() * 36, 2 + r() * 3, r() > 0.5 ? X.k4 : hex('#F7B48A'), 0.7);
  ridge(px, 402, 128, 14, 40, X.k7, null, 0, W - 1, line);
  // banyan (wide canopy, aerial roots) and fig trees
  canopyBand(px, 403, 40, 92, { dark: X.k10, mid: X.k9, light: X.k11 }, 46, 7, 13, 20, 170);
  px.rect(84, 80, 16, 64, X.k5); px.rect(84, 80, 3, 64, X.k8); px.rect(97, 80, 3, 64, hex('#4A3418'));
  for (let x = 30; x < 166; x += 7) { const len = 20 + Math.round(18 * Math.abs(Math.sin(x))); px.line(x, 82, x + (x % 3) - 1, 82 + len, (x % 2) ? X.k5 : X.k8); }
  tree(px, 236, 70, 64, 30, 28, { dark: X.k10, mid: X.k6, light: X.k11 }, { l: X.k8, m: X.k5, d: hex('#4A3418') }, 404, [X.k2, X.k1]);
  tree(px, 292, 84, 54, 22, 22, { dark: X.k10, mid: X.k9, light: X.k11 }, { l: X.k8, m: X.k5, d: hex('#4A3418') }, 405, [X.k3, X.k1]);
  const pond = (x, y) => Math.hypot((x - 170) / 70, (y - 160) / 16) < 1;
  for (let y = line; y < H; y++) for (let x = 0; x < W; x++) if (!pond(x, y)) px.dset(x, y, X.k9, X.k6, ((x + y) % 7) / 14);
  const water = { line, segments: segmentsFromMask(pond, line, H), shallow: X.k3, deep: X.k12, tint: 0.3, amp: 2, speed: 1.1, squash: 0.9, glint: X.k4, glint2: hex('#FFE0B0'), glintDensity: 0.14, flow: 3 };
  finishScene('kn-sunset', px, {
    water, focus: '50% 55%',
    sprites: [
      sprite(T.sunKn, 150, 14, { layer: 'mid', dur: 7, kind: 'sink' }),
      sprite(T.banyanLeaves, 26, 46, { layer: 'mid', dur: 4.4 }), sprite(T.banyanLeaves, 128, 40, { layer: 'mid', dur: 5, delay: -1.5 }),
      sprite(T.frangi, 6, H - 26, { dur: 3 }), sprite(T.frangi, 40, H - 22, { dur: 3.4, delay: -1 }), sprite(T.frangi, W - 30, H - 26, { dur: 3.2, delay: -0.5 }), sprite(T.frangi, W - 62, H - 22, { dur: 3.7, delay: -1.8 }),
    ],
  });
}
// ---------- Scene: Telugu summer sunrise with mango trees (brief only; no reference images)
{
  const px = new Px(W, H); const line = 148;
  px.vgrad(0, 126, [[0, X.t6], [0.35, X.t3], [0.62, X.t7], [0.86, X.tSalmon], [1, X.t1]]);
  const r = rng(501);
  for (let i = 0; i < 10; i++) px.dcloud(r() * W, 10 + r() * 50, 24 + r() * 30, 2 + r() * 3, r() > 0.5 ? P.white : X.t3, 0.7);
  ridge(px, 502, 120, 10, 50, hex('#E6C79A'), null);
  for (const [x, s] of [[40, 1], [118, 0.8], [204, 1.1], [286, 0.9]]) tree(px, x, Math.round(92 - 18 * s), Math.round(40 * s), Math.round(28 * s), Math.round(22 * s), { dark: X.tGreenD, mid: X.tGreen, light: X.t5 }, { l: X.k8, m: X.k5, d: hex('#4A3418') }, 503 + x, [X.tMango, X.t1]);
  px.vgrad(126, H - 1, [[0, X.t5], [1, X.tGreen]]);
  for (let i = 0; i < 300; i++) px.set(r() * W, 128 + r() * 52, r() > 0.5 ? X.t4 : X.t2);
  const canal = (x, y) => y >= line && y < 164;
  const water = { line, bottom: 164, segments: segmentsFromMask(canal, line, 164), shallow: X.tAqua, deep: X.tAquaD, tint: 0.4, amp: 1, speed: 1.4, squash: 0.6, glint: X.t6, glint2: X.t3, glintDensity: 0.12, flow: 4 };
  finishScene('te-mango', px, {
    water, focus: '45% 55%',
    sprites: [
      sprite(T.sunTe, 128, 2, { layer: 'mid', dur: 6, kind: 'rise' }),
      sprite(T.mangoLeaves, 20, 66, { layer: 'mid', dur: 4.8 }), sprite(T.mangoLeaves, 188, 66, { layer: 'mid', dur: 5.2, delay: -2 }),
      sprite(T.mango, -8, -6, { dur: 4.2 }), sprite(T.mango, W - 92, -4, { dur: 4.6, delay: -1.4, flip: true }),
    ],
  });
}

// ================================================================= SECTION BACKGROUNDS (5+ per language)
// Original pixel compositions interpreting the user's references (composition, palette, mood) — not copies.
// Tamil ← refs 1–5 · Malayalam ← refs 6–10 · Kannada ← refs 11–15 · Telugu ← refs 16–19 (+1 derived from that set).
const C = (h) => hex(h);
const skyG = (px, y1, stops) => { px.vgrad(0, y1, stops.map(([t, c]) => [t, C(c)])); if (y1 < H - 1) px.rect(0, y1 + 1, W, H - y1 - 1, C(stops[stops.length - 1][1])); };
function forest(px, seed, yTop, yBot, cols, count, rMin = 5, rMax = 11, x0 = -10, x1 = W + 10) {
  const yMid = Math.round(yTop + (yBot - yTop) * 0.45);
  for (let y = Math.max(0, yMid); y <= Math.min(H - 1, yBot); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) px.dset(x, y, cols.dark, cols.mid, ((x * 3 + y * 5) % 9) / 30);
  canopyBand(px, seed, yTop, yBot, cols, count, rMin, rMax, x0, x1);
}
function cloudsG(px, seed, n, y0, y1, cols, rx = [18, 46], ry = [2, 5], s = 0.8) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) px.dcloud(r() * W, y0 + r() * (y1 - y0), rx[0] + r() * (rx[1] - rx[0]), ry[0] + r() * (ry[1] - ry[0]), C(cols[Math.floor(r() * cols.length)]), s);
}
function rays(px, sx, sy, n, col, t = 0.35) {           // god rays from a light source
  const c = C(col);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = Math.atan2(y - sy, x - sx); const band = Math.sin(a * n) ; const d = Math.hypot(x - sx, y - sy);
    if (band > 0.82 && d < 220) px.dset(x, y, px.get(x, y), c, t * (1 - d / 220));
  }
}
function haze(px, y0, y1, col, t) { const c = C(col); for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) px.dset(x, y, px.get(x, y), c, t * Math.sin(((y - y0) / (y1 - y0)) * Math.PI)); }
function glow(px, cx, cy, r, col, t = 0.6) { const c = C(col); for (let y = Math.max(0, cy - r); y < Math.min(H, cy + r); y++) for (let x = Math.max(0, cx - r); x < Math.min(W, cx + r); x++) { const d = Math.hypot(x - cx, y - cy) / r; if (d < 1) px.dset(x, y, px.get(x, y), c, t * (1 - d)); } }
function stars(px, seed, n, y1) { const r = rng(seed); for (let i = 0; i < n; i++) px.set(r() * W, r() * y1, r() > 0.7 ? P.white : C('#C9D4FF')); }
const groundG = (px, y0, stops) => px.vgrad(y0, H - 1, stops.map(([t, c]) => [t, C(c)]));
function palmAt(px, list, x, base, top, curve, sprites, sheet = S.palmA, opts = {}) {
  palmTrunk(px, x, base, x + curve, top, curve / 2, opts.light || P.barkLight, opts.dark || P.bark);
  sprites.push(sprite(sheet, x + curve - Math.round(sheet.fw / 2), top - Math.round(sheet.fh * 0.35), { layer: 'mid', dur: 4 + (x % 7) * 0.3, delay: -(x % 5) }));
  void list;
}
function keralaHouse(px, x, by, w, roof = '#A0442C', wall = '#F1E4CC', tiers = 1) {
  const h = Math.round(w * 0.32);
  px.rect(x + 3, by - h, w - 6, h, C(wall)); px.rect(x + 3, by - 2, w - 6, 2, C('#7A5A3A'));
  for (let i = x + 6; i < x + w - 6; i += 7) px.rect(i, by - h, 2, h, C('#7A3B22'));
  for (let i = x + 9; i < x + w - 9; i += 7) px.rect(i, by - h + 3, 3, 4, C('#FFC870'));
  for (let t = 0; t < tiers; t++) {
    const inset = t * w * 0.2; const ry = by - h - t * h * 0.9; const rh = Math.round(h * 0.75);
    px.poly([[x - 2 + inset, ry], [x + w + 2 - inset, ry], [x + w * 0.72 - inset * 0.6, ry - rh], [x + w * 0.28 + inset * 0.6, ry - rh]], C(roof));
    for (let yy = ry - rh + 1; yy < ry; yy += 2) for (let xx = x + inset; xx < x + w - inset; xx++) if ((xx + yy) % 3 === 0) px.set(xx, yy, C('#7E2E1C'));
    px.poly([[x + w * 0.5 - 6, ry - rh], [x + w * 0.5 + 6, ry - rh], [x + w * 0.5, ry - rh - 7]], C('#B85A34'));
  }
}
function brassLamp(over, x, by, h = 22) {   // nilavilakku; returns the dish y for the flame sprite
  const g = { d: C('#8A5E14'), m: C('#D8A23A'), l: C('#FCE08A') }; const dy = Math.round(by - h * 0.55);
  over.ellipse(x, by - 2, 9, 3, g.d); over.ellipse(x, by - 3, 7, 2, g.m); over.rect(x - 2, by - h, 4, h - 3, g.m); over.rect(x - 2, by - h, 1, h - 3, g.l);
  for (const k of [0.25, 0.75]) over.ellipse(x, by - h * k, 3.5, 1.5, g.l);
  over.ellipse(x, dy, 12, 3, g.d); over.ellipse(x, dy - 1, 11, 2, g.m); over.rect(x - 10, dy - 2, 20, 1, g.l);
  over.poly([[x - 3, by - h], [x + 3, by - h], [x, by - h - 6]], g.m); glowOver(over, x, dy - 4, 14);
  return dy;
}
function glowOver(over, cx, cy, r) { for (let y = cy - r; y < cy + r; y++) for (let x = cx - r; x < cx + r; x++) { const d = Math.hypot(x - cx, y - cy) / r; if (d < 1 && !over.get(x, y)[3] && (x + y) % 3 === 0 && d > 0.3) over.dset(x, y, C('#FFE6A0'), C('#FFC870'), d); } }
function pavilion(over, cx, by, s, c) {                // domed pavilion / mandapa (refs 1–2)
  const w = Math.round(18 * s), ph = Math.round(14 * s);
  over.rect(cx - w / 2 - 3, by - 3, w + 6, 3, c.d); over.rect(cx - w / 2 - 1, by - 5, w + 2, 2, c.m);
  for (let i = 0; i < 4; i++) over.rect(Math.round(cx - w / 2 + 1 + i * (w - 3) / 3), by - 5 - ph, 2, ph, c.m);
  over.rect(cx - w / 2 - 2, by - 8 - ph, w + 4, 3, c.l);
  over.shadedBlob(cx, by - 9 - ph, w * 0.42, ph * 0.45, c.d, c.m, c.l);
  over.line(cx, by - 9 - ph - ph * 0.45, cx, by - 15 - ph - ph * 0.45, c.l);
  for (let i = 0; i < 3; i++) over.set(Math.round(cx - w / 2 + 3 + i * (w - 6) / 2), by - 5 - ph / 2, C('#FFE38A'));
}
function swan(over, x, y, s, flip = false, col = '#F4E3C0', gold = '#D9A441') {
  const f = flip ? -1 : 1; const c = C(col);
  over.ellipse(x, y, 7 * s, 3 * s, c); over.ellipse(x - f * 3 * s, y - 1, 4 * s, 2.2 * s, C(gold));
  for (let k = 0; k < 9 * s; k++) over.set(x + f * (5 * s + Math.sin(k / (3 * s)) * 2), y - k, c);
  over.set(x + f * (6 * s), y - 9 * s, C('#E07A30'));
}
function ruin(over, x, by, w, h, stone = '#8D9488', dark = '#4E5650') {   // ref 5
  over.rect(x, by - h, w, h, C(stone));
  for (let t = 0; t < 4; t++) over.rect(x + t * 4, by - h - (t + 1) * 6, w - t * 8, 6, C(t % 2 ? stone : '#A2A99A'));
  over.rect(x + w / 2 - 6, by - h + 6, 12, h - 6, C(dark));
  for (let s = 0; s < 4; s++) over.rect(x - 6 - s * 3, by - 3 * (s + 1), w + 12 + s * 6, 3, C(s % 2 ? '#7C8478' : stone));
  const r = rng(x); for (let i = 0; i < 70; i++) over.set(x + r() * w, by - h - 24 + r() * (h + 24), C(r() > 0.5 ? '#6B8F4E' : dark));
}
function vimana(over, x, by, w, h, st = '#7E7A70', dk = '#3E3B36', lt = '#B8B2A0') {   // Hoysala-style tower (ref 11)
  let y = by; let cw = w; let cx = x + w / 2; let tier = 0;
  while (cw > 10 && y > by - h) {
    const th = tier === 0 ? Math.round(h * 0.4) : 8 + (tier % 2);
    const x0 = Math.round(cx - cw / 2), x1 = Math.round(cx + cw / 2);
    over.rect(x0, y - th, x1 - x0, th, C(st));
    const step = Math.max(6, Math.round(cw / 7));
    for (let px0 = x0 + 2; px0 < x1 - 3; px0 += step) {           // pilasters with lit edge and shadowed recess
      over.rect(px0, y - th + 1, 2, th - 2, C(lt)); over.rect(px0 + 2, y - th + 1, 1, th - 2, C(dk));
      if (tier === 0) { over.rect(px0 + 3, y - th + 6, Math.max(2, step - 5), 9, C(dk)); over.rect(px0 + 4, y - th + 8, Math.max(1, step - 7), 5, C(st)); over.poly([[px0 + 3, y - th + 6], [px0 + step - 2, y - th + 6], [px0 + step / 2, y - th + 2]], C(lt)); }
    }
    for (let xx = x0; xx < x1; xx += 2) over.set(xx, y - th + (tier ? 3 : th - 4), C((xx >> 1) % 2 ? dk : lt));
    over.rect(x0 - 2, y - th, x1 - x0 + 4, 2, C(lt)); over.rect(x0 - 2, y - th + 2, x1 - x0 + 4, 1, C(dk));
    y -= th; cw *= tier === 0 ? 0.8 : 0.9; tier++;
  }
  over.shadedBlob(cx, y - 3, cw * 0.45, 4, C(dk), C(st), C(lt));
  over.ellipse(cx, y - 2, 3, 2, C(lt)); over.line(cx, y - 4, cx, y - 9, C(dk));
}
function facade(over, x, by, w, h) {   // sandstone temple with pillars & niches (ref 12)
  const sd = C('#B97A52'), sl = C('#E0A877'), sk = C('#6E3E26');
  over.rect(x, by - h, w, h, sd);
  for (let i = 0; i < 5; i++) { const px0 = x + 4 + i * ((w - 8) / 4); over.rect(Math.round(px0) - 2, by - h + 4, 4, h - 8, sl); }
  for (let i = 0; i < 4; i++) { const nx = Math.round(x + 9 + i * ((w - 8) / 4)); over.rect(nx, by - h + 10, 8, 16, sk); over.ellipse(nx + 4, by - h + 10, 4, 3, sk); over.rect(nx + 3, by - h + 14, 2, 10, sl); }
  for (const k of [0, 3, 6]) over.rect(x - 3, by - h - k - 2, w + 6, 2, k ? sd : sl);
  over.shadedBlob(x + w * 0.7, by - h - 12, 10, 6, sk, sd, sl); over.line(x + w * 0.7, by - h - 18, x + w * 0.7, by - h - 23, sk);
  over.rect(x - 2, by - 4, w + 4, 4, sk);
}
function thatchHut(over, x, by, w) {   // ref 19
  const h = Math.round(w * 0.36);
  over.rect(x + 3, by - h, w - 6, h, C('#5A3A22')); for (let i = x + 4; i < x + w - 4; i += 3) over.rect(i, by - h, 1, h, C('#4A2E1A'));
  for (const wx of [x + 8, x + w - 18]) { over.rect(wx, by - h + 5, 9, 7, C('#FFC45A')); over.rect(wx + 4, by - h + 5, 1, 7, C('#8A5A22')); }
  over.poly([[x - 6, by - h], [x + w + 6, by - h], [x + w * 0.62, by - h - h * 0.9], [x + w * 0.38, by - h - h * 0.9]], C('#9C8455'));
  for (let i = x - 6; i < x + w + 6; i += 2) over.line(i, by - h, i + ((i % 4) - 2), by - h + 2, C('#7C6640'));
  over.rect(x, by - 2, w, 2, C('#6E4A2A')); over.rect(x - 4, by, w + 8, 2, C('#7A5A3A'));
}
function terraces(px, y0, rows, rowH, skyc) {   // rice paddies (ref 9)
  for (let r = 0; r < rows; r++) {
    const ya = y0 + r * rowH; const curve = (x) => Math.round(Math.sin(x / 40 + r) * 2);
    for (let x = 0; x < W; x++) for (let y = ya + curve(x); y < ya + rowH + curve(x); y++) {
      if (y < 0 || y >= H) continue;
      const t = (y - ya - curve(x)) / rowH;
      if (t < 0.18) px.set(x, y, C('#3E2A1A')); else if (t < 0.55) px.dset(x, y, C('#7CCB3A'), C('#B6E86A'), ((x + y) % 5) / 6);
      else px.dset(x, y, C(skyc), C('#9ED8B0'), ((x * 3 + y) % 7) / 10);
    }
  }
}
function teaRows(px, y0, y1, seed, cols = ['#2E6B30', '#4C9A3A', '#8FCB5A']) {   // tea hedges (refs 14, 16)
  const r = rng(seed);
  for (let y = y0; y < y1; y += 5) { const ph = r() * 6; for (let x = -10; x < W + 10; x += 5) { const yy = y + Math.sin(x / 30 + ph) * 3; px.shadedBlob(x, yy, 4, 2.4, C(cols[0]), C(cols[1]), C(cols[2])); } }
}
function lights(px, seed, n, maskTop, col = '#FFD27A') { const r = rng(seed); for (let i = 0; i < n; i++) { const x = r() * W, y = maskTop(x) + r() * 40; if (y < H) px.set(x, y, C(r() > 0.85 ? '#FFFFFF' : col)); } }

// ---------- new animated sprites
const ext = {};
ext.lotusBig = reg(sheet('lotus-big', 48, 52, (f, b) => { lilyPad(f, 24, 46, 20, 5); f.line(24, 44, 24 + b, 26, P.greenMid); lotusBloom(f, 24 + b, 28, 1.7, 0.95 + b * 0.04); }));
ext.blueLotus = reg(sheet('blue-lotus', 32, 40, (f, b) => { lilyPad(f, 16, 34, 12, 3.5); f.line(16, 33, 16 + b * 0.6, 22, P.greenMid);
  for (let k = 0; k < 6; k++) petal(f, 16 + b * 0.6, 22, -Math.PI / 2 + (k - 2.5) * 0.42, 8, 2.4, C(k % 2 ? '#7E8CF0' : '#5C66D6'), C('#3A3E9E')); f.ellipse(16 + b * 0.6, 21, 2, 1.2, P.sun); }));
ext.fireflies = reg(sheet('fireflies', 90, 50, (f, b, fi) => { const r = rng(7); for (let i = 0; i < 26; i++) { const x = r() * 88, y = r() * 48; if ((i + fi) % 3) { f.set(x, y, C('#FFF1A8')); if (i % 4 === 0) f.set(x + 1, y, C('#FFD45A')); } } }, [0, 1, 2, 3]));
ext.sparkle = reg(sheet('sparkle', 90, 40, (f, b, fi) => { const r = rng(9); for (let i = 0; i < 22; i++) { const x = r() * 88, y = r() * 38; if ((i + fi) % 2) { f.set(x, y, P.white); f.set(x + 1, y, C('#E8FFFA')); f.set(x - 1, y, C('#E8FFFA')); } } }, [0, 1, 2, 3]));
ext.petals = reg(sheet('petals', 60, 40, (f, b, fi) => { const r = rng(11); for (let i = 0; i < 12; i++) { const x = (r() * 56 + fi * 2) % 58, y = r() * 36; f.set(x, y, C('#F7B6CC')); f.set(x + (fi % 2), y + 1, C('#FFD9E6')); } }, [0, 1, 2, 3]));
ext.boat = reg(sheet('boat', 44, 12, (f, b) => { f.poly([[2, 5], [42, 5], [36, 10], [8, 10]], C('#5A3A22')); f.rect(4, 4, 36, 1, C('#8A5A32')); f.line(22 + b, 0, 22 + b, 5, C('#3A2414')); }, [-1, 0, 1, 0]));
ext.hens = reg(sheet('hens', 48, 10, (f, b, fi) => { for (const [x, c] of [[4, '#6A2E1A'], [18, '#3A2A22'], [28, '#E7D7B0'], [38, '#8A5A2A']]) { f.ellipse(x, 6, 3, 2, C(c)); f.set(x + 3, (fi + x) % 2 ? 3 : 5, C(c)); f.set(x + 4, (fi + x) % 2 ? 3 : 5, C('#E0A020')); f.set(x - 1, 8, C('#C09020')); f.set(x + 1, 8, C('#C09020')); } }, [0, 1, 2, 3]));
ext.rice = reg(sheet('rice-plants', 96, 24, (f, b) => { for (let x = 1; x < 95; x += 2) { const h = 10 + ((x * 7) % 9); f.line(x, 23, x + b * (h / 10) + ((x % 3) - 1), 23 - h, x % 4 ? C('#7CCB3A') : C('#4E9A2A')); } }));
ext.palmCoco = reg(sheet('palm-coconut', 64, 46, (f, b) => { const cx = 32, cy = 15; [-3.0, -2.55, -2.05, -1.35, -0.75, -0.2, 3.35].forEach((a, k) => frond(f, cx, cy, a + b * 0.07 * (k % 2 ? 1 : 0.6), 20 + (k % 3) * 4, 1.1 + b * 0.18, PALM, 4));
  for (const [dx, dy] of [[-3, 3], [2, 4], [-1, 6], [4, 2]]) f.shadedBlob(cx + dx, cy + dy, 2.2, 2.2, P.barkDark, P.bark, P.barkLight); }));
const HIB_YEL = { dark: C('#C9961A'), mid: C('#F5C518'), light: C('#FFE680'), edge: C('#8A6410'), core: C('#B8321E') };
const HIB_ORA = { dark: C('#C8501A'), mid: C('#F57A1E'), light: C('#FFB060'), edge: C('#7A2E0E'), core: C('#6E1A10') };
ext.hibY = reg(hibiscusBush('hibiscus-yellow', HIB_YEL)); ext.hibO = reg(hibiscusBush('hibiscus-orange', HIB_ORA));
function marigoldHead(f, cx, cy, r, b, outer = '#F57A1E', inner = '#FFC21A') { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = Math.hypot(x, y); if (d <= r) f.dset(cx + x + (d > r * 0.6 ? b * 0.4 : 0), cy + y, C(d > r * 0.55 ? outer : inner), C(d > r * 0.55 ? '#C9480E' : '#FFE070'), ((x * 5 + y * 3) & 7) / 10); } }
ext.marigold = reg(sheet('marigold', 56, 34, (f, b) => { const lc = { dark: P.greenDeep, mid: P.greenMid, light: P.green, rib: P.lime };
  [[-2.4, 16], [-1.6, 18], [-0.8, 16]].forEach(([a, l], k) => leafShape(f, 28, 33, a + b * 0.05 * (k % 2 ? 1 : -1), l, 3, lc, 0.2));
  for (const [x, y, r] of [[14, 14, 5], [28, 8, 6], [42, 14, 5], [22, 22, 4], [36, 22, 4]]) { f.line(x, y + r, 28, 33, P.greenMid); marigoldHead(f, x + b, y, r, b); } }));
ext.bougain = reg(sheet('bougainvillea', 40, 64, (f, b) => { for (let k = 0; k < 4; k++) { let x = 6 + k * 9, y = 0; for (let i = 0; i < 60 - k * 6; i++) { x += Math.sin(i / 6 + k) * 0.6 + b * 0.04; y++; f.set(x, y, P.greenDark); if (i % 2 === 0) { for (const [dx, dy, c] of [[1, 0, '#E0408F'], [-1, 1, '#FF6FB0'], [0, 1, '#C02878'], [2, 1, '#FF8AC4'], [-2, 0, '#E0408F'], [1, 2, '#FF6FB0']]) if ((i + dx) % 3) f.set(x + dx, y + dy, C(c)); f.set(x - 2, y - 1, P.leaf); } } } }));
ext.flame = reg(sheet('flame', 26, 10, (f, b, fi) => { for (const x of [3, 13, 23]) { f.set(x, 6, C('#FFD34A')); f.set(x, 5 - (fi % 2), C('#FF8A1E')); f.set(x + ((fi + x) % 2 ? 1 : -1), 4, C('#FFE9A0')); } }, [0, 1, 2, 3]));
ext.twinkle = reg(sheet('city-twinkle', 120, 40, (f, b, fi) => { const r = rng(21); for (let i = 0; i < 40; i++) { const x = r() * 118, y = r() * 38; if ((i + fi) % 3 === 0) f.set(x, y, C('#FFFFFF')); } }, [0, 1, 2, 3]));

const BG = {};   // id -> veil (readability overlay strength), recorded into the manifest below
function done(id, px, cfg, veil = [0, 0.22]) { finishScene(id, px, cfg); BG[id] = veil; }

// ================= TAMIL (refs 1–5): lotus waters, pavilions, lamps, temple ruins; pink & gold
{ // T1 lotus lake at sunset with a domed pavilion (ref 1)
  const px = new Px(W, H); const over = new Px(W, H); const line = 104; const sp = [];
  skyG(px, line, [[0, '#6E5A9E'], [0.35, '#B07CB8'], [0.62, '#F2A0B8'], [0.85, '#FFC4A0'], [1, '#FFD9A8']]);
  cloudsG(px, 1001, 18, 10, 80, ['#F7C0D0', '#E8A0C0', '#FFD8C0'], [20, 50], [2, 4]);
  glow(px, 200, 90, 26, '#FFF1C8', 0.7); px.ellipse(200, 90, 7, 7, C('#FFF6DA'));
  ridge(px, 1002, 101, 8, 30, C('#5E6478'), null, 0, W - 1, line); forest(px, 1003, 90, 102, { dark: C('#3E5240'), mid: C('#557050'), light: C('#7C9A6A') }, 30, 3, 6, 200, 320);
  forest(px, 1004, 96, 104, { dark: C('#B0507A'), mid: C('#E07AA0'), light: C('#FFB0C8') }, 18, 2, 4, 210, 320);
  pavilion(over, 252, 104, 1.6, { d: C('#7A4E2A'), m: C('#D8A24A'), l: C('#FCE38A') });
  for (let i = 0; i < 40; i++) { const x = 10 + i * 2.2; over.line(x, 0, x + Math.sin(i) * 3, 20 + (i * 13) % 40, P.greenDark); if (i % 3 === 0) over.set(x + 1, 10 + (i * 7) % 30, P.lime); }
  const water = { line, segments: segmentsFromMask(() => true, line, H), shallow: C('#E8A6C0'), deep: C('#5E5A8E'), tint: 0.32, amp: 1, speed: 1.1, squash: 0.9, glint: C('#FFF1C8'), glint2: C('#FFB0C8'), glintDensity: 0.12, flow: 3 };
  sp.push(sprite(ext.lotusBig, 20, 112, { kind: 'bob', dur: 5 }), sprite(ext.lotusBig, 230, 128, { kind: 'bob', dur: 5.6, delay: -2 }), sprite(S.lotus, 120, 112, { kind: 'bob', dur: 4.4 }), sprite(S.lotus, 168, 128, { kind: 'bob', dur: 5.2, delay: -1 }),
    sprite(S.lotus, 80, 136, { kind: 'bob', dur: 4.8, delay: -3 }), sprite(ext.fireflies, 20, 40, { layer: 'mid', dur: 2.4 }), sprite(ext.fireflies, 190, 60, { layer: 'mid', dur: 2.8, delay: -1 }), sprite(S.hibPink, 280, H - 46, { dur: 3.4 }));
  done('ta-lotus-dusk', px, { water, over, sprites: sp, focus: '55% 60%' });
}
{ // T2 golden swan pavilion among giant lotuses (ref 2)
  const px = new Px(W, H); const over = new Px(W, H); const line = 122; const sp = [];
  skyG(px, line, [[0, '#5A4A6A'], [0.4, '#9A7A92'], [0.75, '#E8B08A'], [1, '#FFD9A0']]);
  glow(px, 160, 110, 50, '#FFE6B0', 0.65); cloudsG(px, 1011, 10, 10, 70, ['#C89AA8', '#E8C0B0'], [26, 60], [3, 6], 0.6);
  for (const [cx, cy, s, op] of [[30, 70, 4.2, 1], [290, 64, 4.6, 0.9], [60, 30, 2.4, 0.8], [250, 26, 2.2, 0.7]]) lotusBloom(over, cx, cy, s, op);
  for (let x = 0; x < W; x += 9) over.line(x, line - 2, x + 2, line - 30 - (x * 7) % 24, C('#4E7A3A'));
  over.rect(118, line - 4, 84, 4, C('#8A5E14')); over.rect(122, line - 6, 76, 2, C('#D8A23A'));
  pavilion(over, 160, line - 6, 2.2, { d: C('#8A5E14'), m: C('#E0B040'), l: C('#FFF0A0') });
  swan(over, 104, line + 8, 2.8, false); swan(over, 218, line + 8, 2.8, true);
  const water = { line, segments: segmentsFromMask(() => true, line, H), shallow: C('#D8B488'), deep: C('#4A4A62'), tint: 0.25, amp: 1, speed: 1.1, squash: 0.95, glint: C('#FFF0B0'), glint2: C('#FFC8A0'), glintDensity: 0.14, flow: 3 };
  sp.push(sprite(S.lotus, 20, 134, { kind: 'bob', dur: 5 }), sprite(S.lotus, 270, 136, { kind: 'bob', dur: 4.6, delay: -2 }), sprite(ext.fireflies, 110, 60, { layer: 'mid', dur: 2.6 }), sprite(ext.lotusBig, 262, 124, { kind: 'bob', dur: 5.4, delay: -1 }));
  done('ta-swan-pavilion', px, { water, over, sprites: sp, focus: '50% 60%' }, [0.05, 0.25]);
}
{ // T3 lamp-lit lotus pond, palms and a tiled house (ref 3)
  const px = new Px(W, H); const over = new Px(W, H); const line = 96; const sp = [];
  skyG(px, line, [[0, '#B8B094'], [0.6, '#E8D2A8'], [1, '#F2DDB8']]);
  forest(px, 1021, 60, 96, { dark: C('#2E4A2A'), mid: C('#46663A'), light: C('#6E8A50') }, 50, 6, 12);
  haze(px, 70, 98, '#F2E0C0', 0.5);
  keralaHouse(px, 40, 96, 64, '#7E3E26', '#E8D8B8');
  for (const [x, t, c] of [[12, 20, 6], [126, 10, -4], [290, 14, -6], [258, 26, 5]]) palmAt(px, null, x, 98, t, c, sp, ext.palmCoco);
  const water = { line, segments: segmentsFromMask(() => true, line, 150), bottom: 150, shallow: C('#C9B890'), deep: C('#3E4A3A'), tint: 0.35, amp: 1, speed: 1, squash: 0.8, glint: C('#FFE6B0'), glint2: C('#FFB0C8'), glintDensity: 0.08, flow: 2 };
  const r = rng(1023); for (let i = 0; i < 120; i++) { const x = r() * W, y = 100 + r() * 48; over.ellipse(x, y, 2 + (y - 100) / 20, 0.8 + (y - 100) / 40, C(r() > 0.5 ? '#3E6A3A' : '#557A40')); if (r() > 0.6) { over.set(x, y - 1, C('#FF6FA8')); over.set(x + 1, y - 1, C('#FFB0D0')); } }
  for (let y = 150; y < H; y++) for (let x = 0; x < W; x++) over.dset(x, y, C('#4E4A46'), C('#6E6A62'), ((x >> 3) + (y >> 2)) % 3 / 3);
  const d1 = brassLamp(over, 40, 168, 40), d2 = brassLamp(over, 280, 168, 44);
  sp.push(sprite(ext.flame, 40 - 13, d1 - 9, { dur: 0.8 }), sprite(ext.flame, 280 - 13, d2 - 9, { dur: 0.9 }), sprite(S.lotus, 150, 116, { kind: 'bob', dur: 4.6 }), sprite(S.lotus, 96, 126, { kind: 'bob', dur: 5.2, delay: -2 }), sprite(ext.petals, 120, 150, { dur: 3 }));
  done('ta-lamp-pond', px, { water, over, sprites: sp, focus: '50% 60%' }, [0, 0.25]);
}
{ // T4 violet dusk hills with twinkling town lights (ref 4)
  const px = new Px(W, H); const sp = []; const line = 160;
  skyG(px, 120, [[0, '#3E3458'], [0.4, '#7A5E86'], [0.75, '#D49AB0'], [1, '#F2C0C0']]);
  cloudsG(px, 1031, 14, 6, 70, ['#5E4A72', '#8A6A92', '#B98AA8'], [30, 70], [5, 9], 0.9);
  const pk = noise1(1032, 18);
  for (let x = 0; x < W; x++) { const top = 70 + Math.round(40 * pk(x)); for (let y = top; y < H; y++) px.set(x, y, C(y < top + 3 ? '#4A3E5A' : '#2A2438')); }
  ridge(px, 1033, 128, 30, 26, C('#1E1A2A'), C('#3A3048'));
  lights(px, 1034, 520, (x) => 110 + Math.round(20 * pk(x * 1.3)));
  const water = { line, segments: segmentsFromMask((x, y) => x > 170 + (line - y) * 0, line, H), shallow: C('#5E4A6E'), deep: C('#1E1A2A'), tint: 0.4, amp: 1, speed: 1.2, squash: 0.85, glint: C('#FFD27A'), glint2: C('#FFFFFF'), glintDensity: 0.1, flow: 3 };
  sp.push(sprite(ext.twinkle, 20, 112, { layer: 'mid', dur: 2 }), sprite(ext.twinkle, 170, 118, { layer: 'mid', dur: 2.6, delay: -1 }), sprite(S.hibPink, -6, H - 48, { dur: 3.6 }), sprite(ext.lotusBig, 6, H - 56, { dur: 4.8, kind: 'bob' }));
  done('ta-hill-lights', px, { water, sprites: sp, focus: '50% 55%' }, [0, 0.2]);
}
{ // T5 stone temple ruin in light rays with falling lotus petals (ref 5)
  const px = new Px(W, H); const over = new Px(W, H); const line = 138; const sp = [];
  skyG(px, line, [[0, '#4E6A50'], [0.5, '#6E8A6A'], [1, '#9AB08E']]);
  forest(px, 1041, -6, 84, { dark: C('#2A4A2A'), mid: C('#3E6438'), light: C('#62884E') }, 150, 7, 14);
  rays(px, 40, -10, 11, '#F4FFE0', 0.4);
  ruin(over, 196, 138, 70, 44);
  for (const [x, y, rx] of [[20, 132, 24], [60, 136, 14]]) over.shadedBlob(x, y, rx, 9, C('#3E5A34'), C('#5E7E44'), C('#8AAE5A'));
  const water = { line, segments: segmentsFromMask(() => true, line, H), shallow: C('#6E9080'), deep: C('#2E4A42'), tint: 0.4, amp: 1, speed: 1, squash: 0.8, glint: C('#F4FFE0'), glint2: C('#FFC0D8'), glintDensity: 0.1, flow: 2 };
  sp.push(sprite(ext.lotusBig, 40, 132, { kind: 'bob', dur: 5 }), sprite(ext.lotusBig, 220, 136, { kind: 'bob', dur: 5.8, delay: -2 }), sprite(S.lotus, 130, 140, { kind: 'bob', dur: 4.6 }),
    sprite(ext.petals, 60, 20, { layer: 'mid', kind: 'fall', dur: 9 }), sprite(ext.petals, 170, 0, { layer: 'mid', kind: 'fall', dur: 11, delay: -4 }), sprite(ext.petals, 250, 30, { layer: 'mid', kind: 'fall', dur: 10, delay: -7 }), sprite(S.hibCoral, -10, H - 46, { dur: 3.6 }));
  done('ta-temple-petals', px, { water, over, sprites: sp, focus: '55% 55%' }, [0, 0.25]);
}

// ================= MALAYALAM (refs 6–10): lagoons, falls, backwaters, paddies, tharavad; coconuts & blue lotus
{ // M1 emerald lagoon with waterfall and boat (ref 6)
  const px = new Px(W, H); const line = 112; const sp = [];
  skyG(px, line, [[0, '#E8F0C8'], [0.5, '#A8C49A'], [1, '#5E8A6E']]);
  for (let x = 0; x < W; x++) { const top = 20 + Math.round(14 * Math.sin(x / 26)); for (let y = top; y < line; y++) px.dset(x, y, C('#2E5A42'), C('#46705A'), ((x + y) % 7) / 10); }
  forest(px, 1101, 30, 110, { dark: C('#1E4A34'), mid: C('#2E6A48'), light: C('#5E9A60') }, 60, 5, 10);
  glow(px, 30, 10, 60, '#FFF6C8', 0.6); rays(px, 20, 0, 9, '#FFF6D0', 0.25);
  const water = { line, segments: segmentsFromMask(() => true, line, H), shallow: C('#2EA89A'), deep: C('#0E4A48'), tint: 0.35, amp: 1, speed: 1.2, squash: 0.85, glint: C('#FFFFFF'), glint2: C('#FFF6C8'), glintDensity: 0.14, flow: 3 };
  const falls = [{ x: 186, y: 36, w: 5, h: line - 36, colors: [C('#DFFFF8'), P.white, C('#A8E8DA')], speed: 26, spread: 2, mist: P.white }];
  sp.push(sprite(ext.boat, 140, line + 6, { kind: 'bob', dur: 4 }), sprite(ext.sparkle, 40, line + 20, { dur: 2.2 }), sprite(ext.sparkle, 160, line + 30, { dur: 2.6, delay: -1 }),
    sprite(ext.palmCoco, -14, -14, { dur: 4.8 }), sprite(ext.palmCoco, W - 52, -10, { dur: 5.2, delay: -2 }), sprite(S.leafL, -18, H - 60, { dur: 4 }), sprite(ext.blueLotus, 250, line + 30, { kind: 'bob', dur: 5 }));
  done('ml-lagoon-falls', px, { water, falls, sprites: sp, focus: '55% 55%' }, [0, 0.25]);
}
{ // M2 misty jungle waterfall pool (ref 7)
  const px = new Px(W, H); const line = 128; const sp = [];
  skyG(px, line, [[0, '#C8D8C8'], [1, '#7E9A82']]);
  forest(px, 1111, -10, 120, { dark: C('#163A26'), mid: C('#24543A'), light: C('#3E7A50') }, 90, 6, 13, -10, 130);
  forest(px, 1112, -10, 120, { dark: C('#163A26'), mid: C('#24543A'), light: C('#3E7A50') }, 90, 6, 13, 190, W + 10);
  for (let y = 30; y < line; y++) for (let x = 130; x < 190; x++) px.dset(x, y, C('#3A4A44'), C('#566660'), ((x + y) % 5) / 8);
  haze(px, 20, 120, '#E8F4EC', 0.45);
  for (let i = 0; i < 26; i++) px.shadedBlob(100 + i * 4, 136 + Math.sin(i) * 3, 6, 3, C('#3A4A34'), C('#5E6E48'), C('#8A9A62'));
  const water = { line, segments: segmentsFromMask(() => true, line, H), shallow: C('#5E8A7A'), deep: C('#163A34'), tint: 0.45, amp: 1, speed: 1, squash: 0.8, glint: C('#E8FFF6'), glint2: C('#C8E8DA'), glintDensity: 0.08, flow: 2 };
  const falls = [{ x: 150, y: 34, w: 18, h: line - 34, colors: [C('#E8FFF8'), P.white, C('#B8E0D4')], speed: 30, spread: 5, mist: P.white }];
  sp.push(sprite(S.fernLime, -20, H - 48, { dur: 3.6 }), sprite(S.fernTeal, W - 64, H - 40, { dur: 4.2, delay: -1 }), sprite(ext.palmCoco, 20, -8, { layer: 'mid', dur: 5 }), sprite(ext.blueLotus, 80, line + 12, { kind: 'bob', dur: 5 }), sprite(ext.blueLotus, 230, line + 20, { kind: 'bob', dur: 4.6, delay: -2 }));
  done('ml-jungle-falls', px, { water, falls, sprites: sp, focus: '50% 55%' }, [0, 0.2]);
}
{ // M3 golden misty backwater with leaning palms (ref 8)
  const px = new Px(W, H); const line = 104; const sp = [];
  skyG(px, line, [[0, '#F2EAD0'], [0.6, '#E8D8B0'], [1, '#D8C49A']]);
  glow(px, 210, 60, 70, '#FFF8E0', 0.7);
  forest(px, 1121, 80, 104, { dark: C('#7A8A6A'), mid: C('#9AA888'), light: C('#B8C4A4') }, 40, 4, 9);
  haze(px, 70, 106, '#FFF6E0', 0.55);
  for (const [x, t, c] of [[30, 8, 34], [70, 24, 22], [270, 18, -20], [300, 30, -12]]) palmAt(px, null, x, 106, t, c, sp, ext.palmCoco, { light: C('#8A7A5A'), dark: C('#5A4E3A') });
  const water = { line, segments: segmentsFromMask(() => true, line, H), shallow: C('#E8DAB8'), deep: C('#8A8A72'), tint: 0.3, amp: 1, speed: 0.9, squash: 0.95, glint: C('#FFFFFF'), glint2: C('#FFF0C0'), glintDensity: 0.1, flow: 2 };
  sp.push(sprite(ext.boat, 180, line + 14, { kind: 'bob', dur: 5 }), sprite(ext.blueLotus, 40, line + 34, { kind: 'bob', dur: 4.8 }), sprite(ext.blueLotus, 120, line + 44, { kind: 'bob', dur: 5.4, delay: -2 }), sprite(ext.blueLotus, 250, line + 40, { kind: 'bob', dur: 5, delay: -3 }));
  done('ml-backwater-mist', px, { water, sprites: sp, focus: '50% 55%' }, [0, 0.22]);
}
{ // M4 rice terraces with coconut palms and hens (ref 9)
  const px = new Px(W, H); const sp = [];
  skyG(px, 60, [[0, '#F4F8E8'], [1, '#DDEFC8']]);
  forest(px, 1131, 30, 80, { dark: C('#2E6A2A'), mid: C('#4E9A3A'), light: C('#8ACB5A') }, 60, 5, 10);
  for (const [x, t, c] of [[20, 6, 4], [64, 14, -3], [110, 2, 3], [170, 10, -2], [214, 4, 4], [262, 12, -4], [300, 6, 2]]) palmAt(px, null, x, 82, t, c, sp, ext.palmCoco);
  terraces(px, 80, 6, 17, '#DDEFC8');
  sp.push(sprite(ext.hens, 90, 112, { dur: 1.6 }), sprite(ext.hens, 200, 129, { dur: 1.9, delay: -0.5 }), sprite(ext.rice, -4, H - 24, { dur: 3 }), sprite(ext.rice, 92, H - 24, { dur: 3.4, delay: -1 }), sprite(ext.rice, 188, H - 24, { dur: 3.2, delay: -2 }), sprite(ext.rice, 284, H - 24, { dur: 3.6 }));
  done('ml-rice-terraces', px, { sprites: sp, focus: '50% 60%' }, [0.05, 0.25]);
}
{ // M5 tharavad house with layered tiled roofs among coconut palms (ref 10)
  const px = new Px(W, H); const sp = [];
  skyG(px, 70, [[0, '#A8D4F0'], [1, '#E8F4F8']]);
  cloudsG(px, 1141, 6, 6, 40, ['#FFFFFF'], [20, 40], [4, 7], 0.8);
  forest(px, 1142, 20, 92, { dark: C('#1E5A2A'), mid: C('#3A8A3A'), light: C('#6ABA4E') }, 70, 6, 12);
  for (const [x, t, c] of [[18, 4, 4], [60, 10, -2], [244, 6, 3], [292, 2, -4]]) palmAt(px, null, x, 110, t, c, sp, ext.palmCoco);
  groundG(px, 92, [[0, '#4E9A34'], [0.3, '#5EAA3A'], [1, '#3E8A2A']]);
  keralaHouse(px, 108, 124, 110, '#B0502E', '#C8704A', 3);
  for (let i = 0; i < 10; i++) px.shadedBlob(20 + i * 30, 150 + (i % 3) * 6, 7, 4, C('#2E6A2A'), C('#4E9A3A'), C('#8ACB5A'));
  px.shadedBlob(212, 148, 5, 6, C('#4A2A1A'), C('#6A3A22'), C('#8A5A3A'));
  sp.push(sprite(S.hibCoral, 20, H - 46, { dur: 3.6 }), sprite(ext.blueLotus, 150, H - 40, { kind: 'bob', dur: 5 }), sprite(S.leafR, W - 50, H - 60, { dur: 4.2 }));
  done('ml-tharavad', px, { sprites: sp, focus: '50% 55%' }, [0.05, 0.22]);
}

// ================= KANNADA (refs 11–15): carved stone, sandstone, coast & green hills, misty peaks; yellow/orange hibiscus
{ // K1 carved stone vimana under a golden cloudy sky (ref 11)
  const px = new Px(W, H); const over = new Px(W, H); const sp = [];
  skyG(px, 150, [[0, '#7E8288'], [0.5, '#B8B4AA'], [0.8, '#F2D29A'], [1, '#FFC878']]);
  cloudsG(px, 1201, 22, 4, 110, ['#9A9CA0', '#C8C4BA', '#E8DCC0'], [26, 60], [5, 9], 0.9);
  palmAt(px, null, 60, 150, 96, 4, sp, S.palmA, { light: C('#4A4A40'), dark: C('#2E2E28') });
  vimana(over, 168, 168, 150, 150);
  groundG(px, 150, [[0, '#4E6A34'], [1, '#2E4A22']]);
  forest(px, 1202, 146, 176, { dark: C('#2E4A22'), mid: C('#4E6E34'), light: C('#7E9A4A') }, 30, 6, 12, -10, 170);
  sp.push(sprite(ext.hibY, 6, H - 48, { dur: 3.4 }), sprite(ext.hibO, 70, H - 46, { dur: 3.8, delay: -1 }), sprite(ext.hibY, 120, H - 44, { dur: 3.6, delay: -2 }), sprite(T.banana, -20, 60, { layer: 'mid', dur: 4.8 }));
  done('kn-hoysala', px, { over, sprites: sp, focus: '60% 60%' }, [0, 0.25]);
}
{ // K2 sandstone temple with bougainvillea in golden mist (ref 12)
  const px = new Px(W, H); const over = new Px(W, H); const sp = [];
  skyG(px, H - 1, [[0, '#F2DCA8'], [0.4, '#C8B88A'], [1, '#6E7A4A']]);
  ridge(px, 1211, 70, 30, 50, C('#8A9A6A'), null); ridge(px, 1212, 100, 30, 40, C('#5E7A46'), null);
  forest(px, 1213, 70, 170, { dark: C('#3E5A2A'), mid: C('#5E7E3A'), light: C('#8AA858') }, 50, 6, 12, -10, 120);
  haze(px, 20, 140, '#FFE8B8', 0.45);
  facade(over, 120, 172, 190, 92);
  sp.push(sprite(ext.bougain, 268, 70, { layer: 'mid', dur: 4.6 }), sprite(ext.bougain, 228, 76, { layer: 'mid', dur: 5.2, delay: -2 }), sprite(ext.hibO, 4, H - 48, { dur: 3.6 }), sprite(ext.hibY, 60, H - 46, { dur: 3.9, delay: -1 }), sprite(ext.palmCoco, -16, -8, { layer: 'mid', dur: 5 }));
  done('kn-bougainvillea', px, { over, sprites: sp, focus: '60% 55%' }, [0, 0.25]);
}
{ // K3 palm-framed green hills down to the sea (ref 13)
  const px = new Px(W, H); const sp = []; const line = 78;
  skyG(px, line, [[0, '#2E7AD8'], [0.6, '#6EAAF0'], [1, '#C8E4FA']]);
  cloudsG(px, 1221, 9, 6, 50, ['#FFFFFF', '#EEF6FF'], [22, 46], [5, 9], 1);
  const water = { line, bottom: 92, segments: segmentsFromMask(() => true, line, 92), shallow: C('#4EC8D8'), deep: C('#1E6AB0'), tint: 0.5, amp: 1, speed: 1, squash: 0.5, glint: P.white, glint2: C('#C8F4FF'), glintDensity: 0.1, flow: 4 };
  ridge(px, 1226, 94, 6, 30, C('#3E7A3A'), C('#5E9A4E')); ridge(px, 1222, 84, 26, 18, C('#4E7A4A'), C('#6E9A5E'), 40, 140, 96);
  ridge(px, 1223, 120, 34, 70, C('#5EA03E'), C('#8ACB5A'));
  ridge(px, 1224, 150, 20, 50, C('#3E8A2E'), C('#6EB84A'));
  forest(px, 1225, 130, 176, { dark: C('#2E6A22'), mid: C('#4E9A34'), light: C('#7ECB4E') }, 50, 4, 9);
  sp.push(sprite(ext.palmCoco, -14, -10, { dur: 4.8 }), sprite(S.palmA, -28, 40, { dur: 5.4, delay: -1 }), sprite(S.leafR, W - 56, H - 64, { dur: 4 }), sprite(ext.hibY, 120, H - 46, { dur: 3.4 }), sprite(ext.hibO, 200, H - 46, { dur: 3.8, delay: -2 }), sprite(T.banana, 250, 70, { layer: 'mid', dur: 5 }));
  done('kn-palm-coast', px, { water, sprites: sp, focus: '50% 55%' }, [0, 0.2]);
}
{ // K4 rolling green hills and tea slopes (ref 14)
  const px = new Px(W, H); const sp = [];
  skyG(px, 110, [[0, '#2E86D8'], [0.6, '#6EB0EC'], [1, '#B8DCF4']]);
  ridge(px, 1231, 72, 30, 40, C('#4E7E52'), C('#6E9A68'));
  ridge(px, 1232, 100, 26, 60, C('#3E8A3A'), C('#6EBA4E'));
  teaRows(px, 112, 182, 1233, ['#2E6A22', '#4E9A2E', '#9ACB4E']);
  sp.push(sprite(ext.hibY, -6, H - 48, { dur: 3.4 }), sprite(ext.hibO, 40, H - 46, { dur: 3.8, delay: -1 }), sprite(ext.hibY, 250, H - 48, { dur: 3.6, delay: -2 }), sprite(ext.hibO, 290, H - 44, { dur: 4 }), sprite(T.banana, 200, 54, { layer: 'mid', dur: 5 }), sprite(ext.palmCoco, 140, 40, { layer: 'mid', dur: 4.6 }));
  done('kn-green-hills', px, { sprites: sp, focus: '50% 55%' }, [0, 0.2]);
}
{ // K5 misty cone peaks over a green valley (ref 15)
  const px = new Px(W, H); const sp = [];
  skyG(px, 120, [[0, '#9AA0A0'], [0.6, '#C4C8C4'], [1, '#D8DCD4']]);
  for (const [cx, base, hgt, wd] of [[70, 120, 60, 50], [160, 118, 76, 60], [250, 120, 64, 50], [300, 124, 40, 34]]) {
    for (let x = cx - wd; x < cx + wd; x++) { const t = Math.abs(x - cx) / wd; const top = base - Math.round(hgt * (1 - t * t)); for (let y = top; y < base + 10; y++) px.dset(x, y, C('#3E6A44'), C('#5E8A58'), ((x + y) % 6) / 10); }
  }
  haze(px, 30, 120, '#E8ECE6', 0.55);
  groundG(px, 120, [[0, '#7EAA5A'], [1, '#3E6A2E']]);
  forest(px, 1241, 130, 180, { dark: C('#2E5A26'), mid: C('#4E8A3A'), light: C('#7EB85A') }, 40, 5, 10);
  sp.push(sprite(T.banana, 4, 60, { layer: 'mid', dur: 4.8 }), sprite(T.banana, 250, 66, { layer: 'mid', dur: 5.3, delay: -2 }), sprite(ext.palmCoco, 120, 70, { layer: 'mid', dur: 4.6 }),
    sprite(ext.hibY, 60, H - 48, { dur: 3.4 }), sprite(ext.hibO, 170, H - 46, { dur: 3.8, delay: -1 }), sprite(ext.hibY, 290, H - 48, { dur: 3.6 }));
  done('kn-misty-karst', px, { sprites: sp, focus: '50% 55%' }, [0, 0.22]);
}

// ================= TELUGU (refs 16–19 + 1 derived): tea estate, moonlit jungle, palm pond, thatched hut; marigolds & bananas
{ // E1 tea estate path under misty mountains (ref 16)
  const px = new Px(W, H); const sp = [];
  skyG(px, 90, [[0, '#8A9A9A'], [0.6, '#C8D0C4'], [1, '#E8E4C8']]);
  ridge(px, 1301, 60, 40, 40, C('#6A8076'), null); ridge(px, 1302, 84, 30, 50, C('#4E6E5A'), null);
  haze(px, 40, 100, '#F2F0DC', 0.5);
  forest(px, 1303, 80, 110, { dark: C('#2E5A2A'), mid: C('#4E7E3A'), light: C('#7EA858') }, 40, 6, 11);
  teaRows(px, 104, 182, 1304, ['#3E7A22', '#6EAA2E', '#A8D850']);
  for (let y = 110; y < H; y++) { const x = 170 + Math.round(Math.sin(y / 14) * 14) + (y - 110) * 0.3; for (let k = -2 - (y - 110) / 30; k < 2 + (y - 110) / 30; k++) px.set(x + k, y, C(k % 2 ? '#8A8A7A' : '#A8A894')); }
  sp.push(sprite(ext.marigold, 4, H - 34, { dur: 3 }), sprite(ext.marigold, 80, H - 30, { dur: 3.4, delay: -1 }), sprite(ext.marigold, 230, H - 34, { dur: 3.2, delay: -2 }), sprite(T.banana, -20, 60, { layer: 'mid', dur: 4.8 }), sprite(T.banana, 260, 56, { layer: 'mid', dur: 5.2, delay: -2 }));
  done('te-tea-estate', px, { sprites: sp, focus: '50% 55%' }, [0, 0.22]);
}
{ // E2 moonlit twilight jungle with small falls and orange blooms (ref 17)
  const px = new Px(W, H); const sp = [];
  skyG(px, 110, [[0, '#1E2A58'], [0.5, '#4A4E88'], [0.8, '#C88AA8'], [1, '#F7B08A']]);
  stars(px, 1311, 90, 80); glow(px, 90, 36, 20, '#E8ECFF', 0.6); px.ellipse(90, 36, 7, 7, C('#F4F6FF')); px.set(87, 34, C('#C8CCE0')); px.set(92, 38, C('#C8CCE0'));
  for (const [x, t] of [[40, 50], [120, 40], [150, 46], [190, 52]]) palmAt(px, null, x, 120, t, 2, sp, S.palmSmall, { light: C('#3A4A3A'), dark: C('#22302A') });
  forest(px, 1312, 80, 180, { dark: C('#12301E'), mid: C('#1E4A2E'), light: C('#2E6A40') }, 80, 6, 12);
  const falls = [{ x: 236, y: 92, w: 4, h: 30, colors: [C('#C8E8FF'), P.white, C('#9AC0E0')], speed: 20, spread: 1, mist: P.white }, { x: 150, y: 124, w: 3, h: 20, colors: [C('#C8E8FF'), P.white, C('#9AC0E0')], speed: 18, spread: 1, mist: P.white }];
  sp.push(sprite(ext.marigold, -2, H - 34, { dur: 3 }), sprite(ext.marigold, 60, H - 30, { dur: 3.3, delay: -1 }), sprite(ext.marigold, 150, H - 34, { dur: 3.1, delay: -2 }), sprite(ext.marigold, 250, H - 32, { dur: 3.5 }), sprite(ext.fireflies, 100, 100, { layer: 'mid', dur: 2.6 }), sprite(T.banana, 270, 70, { layer: 'mid', dur: 5 }));
  done('te-moon-jungle', px, { falls, sprites: sp, focus: '45% 55%' }, [0.05, 0.25]);
}
{ // E3 lily pond under two tall palms in a pink morning mist (ref 18)
  const px = new Px(W, H); const over = new Px(W, H); const line = 112; const sp = [];
  skyG(px, line, [[0, '#D8C8E0'], [0.6, '#F0D8E0'], [1, '#F4E8D8']]);
  forest(px, 1321, 86, 112, { dark: C('#6A8A6A'), mid: C('#8AA888'), light: C('#B0C4A8') }, 40, 4, 9);
  for (let x = 0; x < 120; x += 2) px.line(x, line, x + 1, line - 14 - (x * 7) % 10, C('#8AA86A'));
  for (const [x, t, c] of [[90, 18, 10], [140, 6, -6]]) palmAt(px, null, x, line + 2, t, c, sp, S.palmA, { light: C('#7A6A4A'), dark: C('#4A3E2A') });
  const water = { line, segments: segmentsFromMask(() => true, line, H), shallow: C('#C8C0C8'), deep: C('#5E6A5E'), tint: 0.35, amp: 1, speed: 1, squash: 0.9, glint: P.white, glint2: C('#FFB0D0'), glintDensity: 0.08, flow: 2 };
  const r = rng(1322); for (let i = 0; i < 110; i++) { const x = r() * W, y = 116 + r() * 60; over.ellipse(x, y, 2.5 + (y - 116) / 16, 1 + (y - 116) / 30, C(r() > 0.5 ? '#4E7A44' : '#6E9A52')); if (r() > 0.75) { over.set(x, y - 2, C('#FF4D8D')); over.set(x + 1, y - 2, C('#FF8AB8')); over.set(x, y - 3, C('#FF4D8D')); } }
  sp.push(sprite(S.lotus, 180, 140, { kind: 'bob', dur: 5 }), sprite(ext.marigold, 270, H - 34, { dur: 3.2 }), sprite(T.banana, 236, 52, { layer: 'mid', dur: 5 }), sprite(T.banana, -24, 60, { layer: 'mid', dur: 4.6, delay: -2 }));
  done('te-palm-pond', px, { water, over, sprites: sp, focus: '45% 60%' }, [0.05, 0.22]);
}
{ // E4 thatched hut glowing at dusk in a coconut grove (ref 19)
  const px = new Px(W, H); const over = new Px(W, H); const sp = [];
  skyG(px, 120, [[0, '#6A6A6A'], [0.6, '#8A867A'], [1, '#A89A80']]);
  for (const [x, t, c] of [[14, 10, 2], [60, 4, -3], [240, 6, 4], [296, 12, -2], [190, 20, 2]]) palmAt(px, null, x, 140, t, c, sp, ext.palmCoco, { light: C('#5A4A3A'), dark: C('#3A3028') });
  haze(px, 30, 130, '#C8BCA4', 0.5);
  forest(px, 1331, 100, 150, { dark: C('#1E3A22'), mid: C('#2E5432'), light: C('#4E7A48') }, 50, 6, 12);
  groundG(px, 150, [[0, '#4E6A34'], [0.5, '#8A6A44'], [1, '#5A4A2A']]);
  thatchHut(over, 130, 152, 96); glow(px, 178, 136, 40, '#FFC870', 0.35);
  sp.push(sprite(T.banana, -16, 70, { layer: 'mid', dur: 4.8 }), sprite(T.banana, 250, 64, { layer: 'mid', dur: 5.2, delay: -2 }), sprite(ext.marigold, 20, H - 34, { dur: 3 }), sprite(ext.marigold, 260, H - 34, { dur: 3.4, delay: -1 }), sprite(ext.fireflies, 60, 110, { dur: 2.4 }));
  done('te-thatch-hut', px, { over, sprites: sp, focus: '55% 60%' }, [0.05, 0.25]);
}
{ // E5 (derived from refs 16–19) marigold fields and banana groves at sunrise
  const px = new Px(W, H); const sp = []; const line = 150;
  skyG(px, 110, [[0, '#FFF8E0'], [0.5, '#FEE08E'], [0.85, '#F9A88A'], [1, '#F7B720']]);
  glow(px, 230, 96, 40, '#FFF6B7', 0.7); px.ellipse(230, 96, 16, 16, C('#F7B720')); px.ellipse(228, 94, 10, 10, C('#FFF6B7'));
  ridge(px, 1341, 104, 20, 40, C('#C1A86A'), null); ridge(px, 1342, 118, 16, 50, C('#8DBF4A'), C('#C1D653'));
  groundG(px, 118, [[0, '#C1D653'], [1, '#769F13']]);
  for (let y = 122; y < line; y += 4) for (let x = (y % 8) * 2; x < W; x += 6) { marigoldHead(px, x, y, 1.6, 0); }
  const water = { line, bottom: 162, segments: segmentsFromMask(() => true, line, 162), shallow: C('#4CC9B0'), deep: C('#2E9E8A'), tint: 0.4, amp: 1, speed: 1.3, squash: 0.6, glint: C('#FFF8E0'), glint2: C('#FEE08E'), glintDensity: 0.12, flow: 3 };
  sp.push(sprite(T.banana, 0, 50, { layer: 'mid', dur: 4.8 }), sprite(T.banana, 70, 56, { layer: 'mid', dur: 5.2, delay: -1 }), sprite(T.banana, 140, 48, { layer: 'mid', dur: 5, delay: -2 }), sprite(T.mango, W - 96, -6, { dur: 4.6, flip: true }),
    sprite(ext.marigold, 10, H - 34, { dur: 3 }), sprite(ext.marigold, 110, H - 34, { dur: 3.4, delay: -1 }), sprite(ext.marigold, 210, H - 34, { dur: 3.2, delay: -2 }));
  done('te-marigold-fields', px, { water, sprites: sp, focus: '50% 55%' }, [0, 0.2]);
}
for (const [id, v] of Object.entries(BG)) manifest.scenes[id].veil = v;

// ---------- animated UI ornaments for buttons and frames (4 frames each)
const uiSheet = (name, fw, fh, fn) => { const m = reg(sheet(name, fw, fh, fn)); fs.copyFileSync(path.join(OUT, m.sheet), path.join(OUT, 'ui', `${name}.png`)); };
uiSheet('orn-lotus', 16, 16, (f, b) => { f.line(8, 15, 8 + b * 0.5, 11, P.greenMid); lotusBloom(f, 8 + b * 0.5, 11, 0.55, 0.8 + (b + 1) * 0.1); });
uiSheet('orn-hibiscus', 16, 16, (f, b) => hibiscusFlower(f, 8, 8.5, 5.4, b, HIB));
uiSheet('orn-coconut', 16, 16, (f, b) => { leafShape(f, 2, 3, 0.5 + b * 0.05, 10, 2, { dark: P.greenDark, mid: P.leaf, light: P.lime, rib: P.limePale }, 0.2); f.shadedBlob(9 + b * 0.4, 10, 5, 4.6, P.barkDark, P.bark, P.barkLight, C('#2A1410')); f.set(8, 8, P.barkLight); });
uiSheet('orn-bluelotus', 16, 16, (f, b) => { for (let k = 0; k < 6; k++) petal(f, 8 + b * 0.4, 12, -Math.PI / 2 + (k - 2.5) * (0.36 + (b + 1) * 0.03), 6, 1.8, C(k % 2 ? '#7E8CF0' : '#5C66D6'), C('#3A3E9E')); f.ellipse(8 + b * 0.4, 11, 1.4, 1, P.sun); });
uiSheet('orn-yhibiscus', 16, 16, (f, b) => hibiscusFlower(f, 8, 8.5, 5.4, b, HIB_YEL));
uiSheet('orn-ohibiscus', 16, 16, (f, b) => hibiscusFlower(f, 8, 8.5, 5.4, b, HIB_ORA));
uiSheet('orn-marigold', 16, 16, (f, b) => { f.line(8, 15, 8, 12, P.greenMid); marigoldHead(f, 8, 7.5, 5.5, b); });
uiSheet('orn-banana', 16, 16, (f, b) => { f.line(8, 0, 8 + b * 0.5, 3, P.greenDark); for (let r = 0; r < 3; r++) for (let k = -2; k <= 2; k++) { const x = 8 + k * 2 + b * 0.5, y = 4 + r * 3; f.set(x, y, C('#F2D33D')); f.set(x, y + 1, k % 2 ? C('#B9C84A') : C('#F2D33D')); } f.shadedBlob(8 + b * 0.6, 14, 1.6, 1.8, C('#7E2A55'), C('#A0406E'), C('#C66A92')); });

// ---------------------------------------------------------------- UI art
// lotus mastery stages 0..5 (32x32 each) + 4 bloom-animation frames
{
  const sh = new Px(32 * 10, 32);
  const stage = (i, fn) => { const f = new Px(32, 32); fn(f); sh.blit(f, i * 32, 0); };
  stage(0, (f) => { f.ellipse(16, 25, 11, 4, [190, 230, 214]); f.ellipse(16, 24.5, 9, 2.6, [222, 246, 236]); f.line(16, 25, 27, 24, [190, 230, 214]); });
  stage(1, (f) => { lilyPad(f, 16, 26, 11, 3.5); lotusBloom(f, 16, 22, 0.6, 0.8); });
  stage(2, (f) => { lilyPad(f, 16, 26, 12, 3.5); lotusBud(f, 11, 21, 0.85); lotusBud(f, 21, 20, 0.95); });
  stage(3, (f) => { lilyPad(f, 16, 26, 13, 3.5); lotusBud(f, 8, 22, 0.75); lotusBud(f, 16, 18, 1); lotusBud(f, 24, 22, 0.75); });
  stage(4, (f) => { lilyPad(f, 16, 27, 14, 3.5); lotusBud(f, 6, 23, 0.65); lotusBud(f, 12, 19, 0.85); lotusBud(f, 20, 19, 0.85); lotusBud(f, 26, 23, 0.65); });
  stage(5, (f) => { lilyPad(f, 16, 27, 14, 3.5); lotusBloom(f, 16, 23, 1.15, 1); });
  [0.05, 0.35, 0.7, 1].forEach((o, k) => stage(6 + k, (f) => { lilyPad(f, 16, 27, 14, 3.5); if (o < 0.2) lotusBud(f, 16, 22, 1.1); else lotusBloom(f, 16, 23, 0.8 + o * 0.35, o); }));
  sh.save('ui/lotus.png');
}
// frame corner ornaments (ref 9 / 10 / 11 inspired, original)
{
  const mini = (name, draw, w = 12, h = 12) => { const f = new Px(w, h); draw(f); f.save(`ui/${name}.png`); };
  mini('corner-hibiscus', (f) => hibiscusFlower(f, 6, 6.5, 4.6, 0, HIB));
  mini('corner-coral', (f) => hibiscusFlower(f, 6, 6.5, 4.6, 0, HIB_CORAL));
  mini('corner-frangipani', (f) => {
    for (let k = 0; k < 5; k++) { const a = k * 1.2566 - 1.57; f.shadedBlob(6 + Math.cos(a) * 2.6, 6 + Math.sin(a) * 2.6, 2.4, 2, P.salmonLight, P.white, P.white, P.salmon); }
    f.ellipse(6, 6, 1.4, 1.4, P.sun);
  });
  mini('corner-lotus', (f) => lotusBloom(f, 6, 9, 0.55, 1));
  mini('sprig', (f) => { leafShape(f, 1, 10, -0.6, 10, 2.5, { dark: P.greenDark, mid: P.leaf, light: P.lime, rib: P.limePale }, 0.2); leafShape(f, 3, 11, -0.1, 8, 2, { dark: P.greenDark, mid: P.leaf, light: P.lime, rib: P.limePale }, 0.2); }, 14, 12);
  mini('star', (f) => {
    const pts = []; for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5; const rr = k % 2 ? 2.3 : 5.4; pts.push([6 + Math.cos(a) * rr, 6.2 + Math.sin(a) * rr]); }
    f.poly(pts, P.blue); f.set(5, 4, P.blueLight); f.set(5, 5, P.blueLight); f.set(4, 6, P.blueLight); f.outline(P.blueDark);
  });
  mini('coconut', (f) => { f.shadedBlob(7, 8, 6, 5.5, P.barkDark, P.bark, P.barkLight, [42, 20, 16]); f.ellipse(10, 9, 3, 3, P.white); f.ellipse(10, 9, 1.6, 1.8, [220, 205, 190]); }, 16, 16);
  mini('favicon', (f) => { lotusBloom(f, 8, 12, 0.75, 1); }, 16, 16);
  mini('hibiscus-big', (f) => hibiscusFlower(f, 16, 18, 9.5, 0, HIB), 32, 32);
}

fs.writeFileSync(path.join(OUT, 'scenes.json'), JSON.stringify(manifest));
console.log('Art generated:', Object.keys(manifest.scenes).join(', '));
