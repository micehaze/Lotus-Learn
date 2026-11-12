import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './util.js';

export class Router {
  constructor() { this.routes = []; }
  on(method, pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^\\/]+)'; })}\\/?$`);
    this.routes.push({ method, re, keys, handler, opts });
  }
  get(p, h, o) { this.on('GET', p, h, o); }
  post(p, h, o) { this.on('POST', p, h, o); }
  put(p, h, o) { this.on('PUT', p, h, o); }
  patch(p, h, o) { this.on('PATCH', p, h, o); }
  del(p, h, o) { this.on('DELETE', p, h, o); }
  match(method, pathname) {
    let wrongMethod = false;
    for (const r of this.routes) {
      const m = pathname.match(r.re);
      if (!m) continue;
      if (r.method !== method) { wrongMethod = true; continue; }
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return wrongMethod ? { methodNotAllowed: true } : null;
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(JSON.parse(text)); } catch { reject(new HttpError(400, 'Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

export function sendJSON(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

export class RateLimiter {
  constructor() { this.buckets = new Map(); }
  hit(key, limit, windowMs, now = Date.now()) {
    let b = this.buckets.get(key);
    if (!b || b.reset <= now) { b = { count: 0, reset: now + windowMs }; this.buckets.set(key, b); }
    b.count++;
    if (this.buckets.size > 20000) for (const [k, v] of this.buckets) if (v.reset <= now) this.buckets.delete(k);
    return { allowed: b.count <= limit, retryAfter: Math.ceil((b.reset - now) / 1000) };
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

export function serveStatic(req, res, roots, pathname) {
  // roots: [{ prefix: '/', dir }, { prefix: '/shared/', dir }]
  for (const { prefix, dir } of roots) {
    if (!pathname.startsWith(prefix)) continue;
    const rel = decodeURIComponent(pathname.slice(prefix.length));
    const full = path.resolve(dir, `.${path.sep}${rel}`);
    if (!full.startsWith(path.resolve(dir) + path.sep)) continue; // traversal guard
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (!st.isFile()) continue;
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const ext = path.extname(full).toLowerCase();
    const longCache = ext === '.png' || ext === '.ttf';
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      ETag: etag,
      'Cache-Control': longCache ? 'public, max-age=86400' : 'no-cache',
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') { res.end(); return true; }
    fs.createReadStream(full).pipe(res);
    return true;
  }
  return false;
}

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https://i.ytimg.com https://img.youtube.com",
    "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};
