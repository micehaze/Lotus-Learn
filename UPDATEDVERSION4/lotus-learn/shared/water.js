// Shared pixel-art water renderer.
// Used by tools/build-art.mjs (to bake frame t=0 into the static scene)
// and by public/js/scene.js (to animate the same water live in a canvas).
// All maths is deterministic so the static fallback == first animated frame.

export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Render animated water into `out` (RGBA, W*H*4) using `src` (the scene without
 * water) as the reflection source.
 * spec = { line, segments:[[y,x0,x1]], shallow:[r,g,b], deep:[r,g,b], tint, amp,
 *          speed, squash, glint:[r,g,b], glint2:[r,g,b], glintDensity, flow }
 */
export function renderWater(out, src, W, H, spec, t) {
  const bottom = spec.bottom ?? H;
  const span = Math.max(1, bottom - spec.line);
  const amp = spec.amp ?? 2;
  const speed = spec.speed ?? 1.6;
  const squash = spec.squash ?? 0.85;
  const tint = spec.tint ?? 0.35;
  const density = spec.glintDensity ?? 0.08;
  const flow = spec.flow ?? 6;
  for (const [y, x0, x1] of spec.segments) {
    const d = y - spec.line;
    const depthT = Math.min(1, d / span);
    const rowPhase = Math.sin(t * speed + y * 0.55 + Math.sin(t * 0.7 + y * 0.13) * 1.5);
    const off = Math.round(rowPhase * amp * (0.45 + depthT * 0.9));
    const sy = spec.line - 1 - Math.floor(d * squash);
    const water = lerp3(spec.shallow, spec.deep, depthT);
    const mix = Math.min(1, tint + depthT * 0.45);
    // rows drift in alternating directions -> gentle current
    const dir = (y & 1) ? 1 : -1;
    const drift = Math.floor(t * flow * (0.6 + depthT)) * dir;
    for (let x = x0; x <= x1; x++) {
      let r, g, b;
      const sx = Math.min(W - 1, Math.max(0, x + off));
      const useWater = mix * 16 > BAYER4[y & 3][x & 3];
      if (!useWater && sy >= 0) {
        const si = (sy * W + sx) * 4;
        // reflection is slightly darkened and tinted towards the water colour
        r = src[si] * 0.82 + water[0] * 0.18;
        g = src[si + 1] * 0.82 + water[1] * 0.18;
        b = src[si + 2] * 0.85 + water[2] * 0.15;
      } else {
        [r, g, b] = water;
      }
      // ripple bands: thin brighter/darker lines that slide with the current
      const band = Math.sin((x + drift) * 0.09 + y * 1.7 - t * 0.9);
      if (band > 0.93) { r += 26; g += 30; b += 28; }
      else if (band < -0.95) { r -= 18; g -= 14; b -= 8; }
      // glints: short horizontal dashes that twinkle on and off
      const gx = (x + drift) >> 2;
      const hv = hash2(gx, y);
      if (hv < density * (1 - depthT * 0.6)) {
        const tw = Math.sin(t * (2 + hv * 9) + hv * 40);
        if (tw > 0.35) {
          const c = hv < density * 0.4 && spec.glint2 ? spec.glint2 : spec.glint;
          r = c[0]; g = c[1]; b = c[2];
        }
      }
      const i = (y * W + x) * 4;
      out[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      out[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      out[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      out[i + 3] = 255;
    }
  }
}

/**
 * Waterfall: vertical streaks scrolling downward, with flickering mist at the foot.
 * fall = { x, y, w, h, colors:[[r,g,b]x3], speed, mist:[r,g,b] }
 */
export function renderFall(out, W, H, fall, t) {
  const [c0, c1, c2] = fall.colors;
  const speed = fall.speed ?? 24;
  for (let yy = 0; yy < fall.h; yy++) {
    const y = fall.y + yy;
    if (y < 0 || y >= H) continue;
    // slight widening towards the bottom
    const widen = Math.floor((yy / fall.h) * (fall.spread ?? 2));
    for (let xx = -widen; xx < fall.w + widen; xx++) {
      const x = fall.x + xx;
      if (x < 0 || x >= W) continue;
      const colSeed = hash2(xx + 100, 7) * 9;
      const v = Math.floor((yy - t * speed + colSeed * 3) / 3);
      const k = ((v % 4) + 4) % 4;
      let c = k === 0 ? c2 : k === 1 ? c0 : k === 2 ? c1 : c0;
      if (xx < 0 || xx >= fall.w) c = hash2(x, Math.floor(yy + t * speed)) > 0.5 ? c1 : null;
      if (!c) continue;
      const i = (y * W + x) * 4;
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
    }
  }
  // mist / splash
  const mist = fall.mist || c2;
  const baseY = fall.y + fall.h;
  for (let k = 0; k < 18; k++) {
    const hv = hash2(k, Math.floor(t * 6));
    const mx = Math.round(fall.x - 4 + hv * (fall.w + 8));
    const my = Math.round(baseY - 2 + hash2(k + 50, Math.floor(t * 6)) * 4);
    if (mx < 0 || mx >= W || my < 0 || my >= H) continue;
    const i = (my * W + mx) * 4;
    out[i] = mist[0]; out[i + 1] = mist[1]; out[i + 2] = mist[2]; out[i + 3] = 255;
  }
}
