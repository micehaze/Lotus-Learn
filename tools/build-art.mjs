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
