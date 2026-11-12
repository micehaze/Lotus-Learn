import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { buildConfig, ROOT } from './config.js';
import { openDatabase } from './db.js';
import { Router, parseCookies, readBody, sendJSON, RateLimiter, serveStatic, SECURITY_HEADERS } from './http.js';
import { HttpError, bad, forbidden } from './util.js';
import { createMailer, createAI, createYouTube, ServiceUnavailable } from './integrations/index.js';
import { createAuthService, SESSION_COOKIE } from './services/auth.js';
import { createMetaService, STORY_CATEGORIES, VIDEO_CATEGORIES, SESSION_MAX_WORDS, CORRECT_PER_WORD } from './services/meta.js';
import { createVocabularyService, PARTS_OF_SPEECH, REGISTERS } from './services/vocabulary.js';
import { createCollectionsService } from './services/collections.js';
import { createLearningService } from './services/learning.js';
import { createStatsService } from './services/stats.js';
import { createLibraryService } from './services/library.js';
import { createProfileService } from './services/profile.js';
import { createContentService } from './services/content.js';

export function createClock() {
  let offset = 0;
  return { now: () => new Date(Date.now() + offset), setOffset: (ms) => { offset = ms; }, getOffset: () => offset };
}

export function createApp(overrides = {}, deps = {}) {
  const config = buildConfig(overrides);
  const logger = deps.logger || console;
  const db = openDatabase(config.databaseFile);
  const clock = deps.clock || createClock();
  const mailer = createMailer(config, logger);
  const ai = deps.ai || createAI(config, deps.fetch);
  const youtube = deps.youtube || createYouTube(config, deps.fetch);
  const meta = createMetaService({ db });
  const vocabulary = createVocabularyService({ db, clock, meta });
  const collections = createCollectionsService({ db, clock, meta, vocabulary });
  const learning = createLearningService({ db, clock, vocabulary, rand: deps.rand });
  const stats = createStatsService({ db, clock, collections });
  const library = createLibraryService({ db, clock, meta, youtube });
  const profile = createProfileService({ db, clock, meta, vocabulary, library, learning, stats, collections });
  const auth = createAuthService({ db, clock, config, mailer });
  const content = createContentService({ db, clock, config, meta, vocabulary, library, ai, youtube, logger });
  const services = { auth, meta, vocabulary, collections, learning, stats, library, profile, content };
  const limiter = new RateLimiter();
  const router = new Router();
  const R = router;
  const id = (p) => { const n = Number(p); if (!Number.isInteger(n) || n < 1) throw bad('Invalid id'); return n; };
  const U = { auth: 'user' };
  const A = { auth: 'admin' };

  // ------------------------------------------------------------ public
  R.get('/api/health', () => ({ ok: true, time: clock.now().toISOString() }));
  R.get('/api/meta', () => ({
    ...meta.publicMeta(), partsOfSpeech: PARTS_OF_SPEECH, registers: REGISTERS, storyCategories: STORY_CATEGORIES, videoCategories: VIDEO_CATEGORIES,
    limits: { sessionMaxWords: SESSION_MAX_WORDS, correctPerWord: CORRECT_PER_WORD, collectionWordLimit: meta.getSettings().collection_word_limit },
    features: { ai: ai.configured, youtubeDiscovery: youtube.configured, email: mailer.provider !== 'console' },
  }));
  R.get('/api/public/showcase', () => ({
    words: vocabulary.published().filter((v) => v.level === 'A1').slice(0, 6).map((v) => ({ tamil: v.tamil, transliteration: v.transliteration, english: v.english })),
    counts: { words: vocabulary.published().length, stories: library.listStories(null).total, videos: library.listVideos(null).length },
  }));

  // ------------------------------------------------------------ auth
  const authRate = { rate: { name: 'auth', limit: config.authRateLimit, windowMs: 15 * 60_000 } };
  R.post('/api/auth/register', async (ctx) => {
    const userId = await auth.register(ctx.body);
    const { token, expires } = auth.createSession(userId, ctx.req.headers['user-agent']);
    ctx.setCookie(auth.sessionCookie(token, expires));
    return { user: { id: userId }, profile: profile.get(userId) };
  }, authRate);
  R.post('/api/auth/login', async (ctx) => {
    const userId = await auth.login(ctx.body);
    const { token, expires } = auth.createSession(userId, ctx.req.headers['user-agent']);
    ctx.setCookie(auth.sessionCookie(token, expires));
    return { user: { id: userId }, profile: profile.get(userId) };
  }, authRate);
  R.post('/api/auth/logout', (ctx) => { auth.destroySession(ctx.token); ctx.setCookie(auth.sessionCookie('', null)); return { ok: true }; });
  R.get('/api/auth/me', (ctx) => (ctx.user ? { user: ctx.user, profile: profile.get(ctx.user.id) } : { user: null }));
  R.post('/api/auth/forgot', async (ctx) => { await auth.requestPasswordReset(ctx.body.email); return { ok: true, message: 'If an account exists for that email, a reset link has been sent.' }; }, { rate: { name: 'forgot', limit: Math.max(5, Math.floor(config.authRateLimit / 4)), windowMs: 15 * 60_000 } });
  R.post('/api/auth/reset', async (ctx) => { await auth.resetPassword(ctx.body); return { ok: true }; }, authRate);
  R.post('/api/auth/change-password', async (ctx) => { await auth.changePassword(ctx.user.id, ctx.body); return { ok: true }; }, { ...U, ...authRate });
  R.post('/api/auth/delete-account', async (ctx) => { await auth.deleteAccount(ctx.user.id, ctx.body.password); ctx.setCookie(auth.sessionCookie('', null)); return { ok: true }; }, U);

  // ------------------------------------------------------------ profile & home
  R.get('/api/profile', (ctx) => profile.get(ctx.user.id), U);
  R.patch('/api/profile', (ctx) => profile.update(ctx.user.id, ctx.body), U);
  R.put('/api/profile/avatar', (ctx) => profile.setAvatar(ctx.user.id, ctx.body.dataUrl ?? null), U);
  R.get('/api/home', (ctx) => profile.home(ctx.user.id), U);

  // ------------------------------------------------------------ vocabulary & dictionary
  R.get('/api/vocabulary', (ctx) => vocabulary.browse(ctx.query), U);
  R.get('/api/vocabulary/daily', (ctx) => vocabulary.daily(ctx.user.id, ctx.db.get('SELECT * FROM user_profiles WHERE user_id = ?', ctx.user.id), 12), U);
  R.get('/api/vocabulary/lists', (ctx) => vocabulary.lists(ctx.query), U);
  R.get('/api/vocabulary/lists/:id', (ctx) => vocabulary.listDetail(id(ctx.params.id)), U);
  R.get('/api/vocabulary/:id', (ctx) => { const v = vocabulary.get(id(ctx.params.id)); if (!v) throw new HttpError(404, 'Word not found'); return v; }, U);
  R.get('/api/dictionary/search', (ctx) => vocabulary.search(ctx.query.q, ctx.query.lang || 'auto'), U);
  R.get('/api/dictionary/suggest', (ctx) => vocabulary.suggest(ctx.query.q, ctx.query.lang || 'auto'), U);
  R.get('/api/dictionary/lookup', (ctx) => vocabulary.lookup(ctx.query.ta), U);
  R.post('/api/dictionary/ai-suggest', (ctx) => content.dictionarySuggest(ctx.body.q, ctx.body.lang), { ...U, rate: { name: 'ai', limit: 20, windowMs: 60 * 60_000 } });

  // ------------------------------------------------------------ collections
  R.get('/api/collections', (ctx) => collections.list(ctx.user.id, ctx.query.q), U);
  R.post('/api/collections', (ctx) => ({ id: collections.create(ctx.user.id, ctx.body) }), U);
  R.get('/api/collections/:id', (ctx) => collections.get(ctx.user.id, id(ctx.params.id), ctx.query.q), U);
  R.patch('/api/collections/:id', (ctx) => { collections.update(ctx.user.id, id(ctx.params.id), ctx.body); return { ok: true }; }, U);
  R.del('/api/collections/:id', (ctx) => { collections.remove(ctx.user.id, id(ctx.params.id)); return { ok: true }; }, U);
  R.post('/api/collections/:id/words', (ctx) => {
    const cid = id(ctx.params.id);
    if (Array.isArray(ctx.body.vocabularyIds)) return collections.addFromLibrary(ctx.user.id, cid, ctx.body.vocabularyIds, { source: ctx.body.source, sourceRef: ctx.body.sourceRef });
    if (ctx.body.listId) return collections.addFromLibrary(ctx.user.id, cid, vocabulary.listDetail(id(ctx.body.listId)).words.map((w) => w.id), { source: 'list', sourceRef: String(ctx.body.listId) });
    return { id: collections.addCustom(ctx.user.id, cid, ctx.body.word || ctx.body), added: 1 };
  }, U);
  R.patch('/api/collections/:id/words/:wid', (ctx) => { collections.updateWord(ctx.user.id, id(ctx.params.id), id(ctx.params.wid), ctx.body); return { ok: true }; }, U);
  R.del('/api/collections/:id/words/:wid', (ctx) => { collections.deleteWord(ctx.user.id, id(ctx.params.id), id(ctx.params.wid)); return { ok: true }; }, U);
  R.get('/api/collections/:id/stats', (ctx) => stats.collectionStats(ctx.user.id, id(ctx.params.id)), U);
  R.get('/api/words/search', (ctx) => collections.searchWords(ctx.user.id, String(ctx.query.q || '')), U);

  // ------------------------------------------------------------ selection & sessions
  R.get('/api/selection', (ctx) => collections.getSelection(ctx.user.id), U);
  R.post('/api/selection', (ctx) => (ctx.body.collectionId ? collections.selectCollection(ctx.user.id, id(ctx.body.collectionId)) : collections.addToSelection(ctx.user.id, ctx.body.ids)), U);
  R.post('/api/selection/remove', (ctx) => collections.removeFromSelection(ctx.user.id, ctx.body.ids || []), U);
  R.post('/api/selection/clear', (ctx) => collections.clearSelection(ctx.user.id), U);
  R.get('/api/sessions', (ctx) => learning.history(ctx.user.id, Number(ctx.query.limit) || 20), U);
  R.post('/api/sessions', (ctx) => ({ id: learning.start(ctx.user.id) }), U);
  R.get('/api/sessions/active', (ctx) => ({ session: learning.active(ctx.user.id) }), U);
  R.get('/api/sessions/:id', (ctx) => learning.state(ctx.user.id, id(ctx.params.id)), U);
  R.get('/api/sessions/:id/question', (ctx) => learning.nextQuestion(ctx.user.id, id(ctx.params.id)), U);
  R.post('/api/sessions/:id/answer', (ctx) => learning.answer(ctx.user.id, id(ctx.params.id), ctx.body), U);
  R.post('/api/sessions/:id/abandon', (ctx) => learning.abandon(ctx.user.id, id(ctx.params.id)), U);
  R.get('/api/sessions/:id/summary', (ctx) => learning.summary(ctx.user.id, id(ctx.params.id)), U);

  // ------------------------------------------------------------ statistics
  R.get('/api/stats/overview', (ctx) => stats.overview(ctx.user.id), U);
  R.get('/api/stats/collections', (ctx) => stats.globalStats(ctx.user.id), U);

  // ------------------------------------------------------------ reading & videos
  R.get('/api/stories', (ctx) => library.listStories(ctx.user.id, { ...ctx.query, status: 'published' }), U);
  R.get('/api/stories/:id', (ctx) => library.getStory(id(ctx.params.id), ctx.user.id), U);
  R.put('/api/stories/:id/progress', (ctx) => library.saveProgress(ctx.user.id, id(ctx.params.id), ctx.body), U);
  R.get('/api/reading/history', (ctx) => library.readingHistory(ctx.user.id), U);
  R.get('/api/videos', (ctx) => library.listVideos(ctx.user.id, { ...ctx.query, status: 'published' }), U);
  R.get('/api/videos/:id', (ctx) => library.getVideo(id(ctx.params.id), ctx.user.id), U);
  R.put('/api/videos/:id/state', (ctx) => library.setVideoState(ctx.user.id, id(ctx.params.id), ctx.body), U);

  // ------------------------------------------------------------ admin (role enforced server-side)
  R.get('/api/admin/overview', (ctx) => ({
    counts: {
      users: ctx.db.get('SELECT COUNT(*) AS n FROM users').n,
      vocabulary: Object.fromEntries(ctx.db.all('SELECT status, COUNT(*) AS n FROM vocabulary GROUP BY status').map((r) => [r.status, r.n])),
      stories: Object.fromEntries(ctx.db.all('SELECT status, COUNT(*) AS n FROM stories GROUP BY status').map((r) => [r.status, r.n])),
      videos: Object.fromEntries(ctx.db.all('SELECT status, COUNT(*) AS n FROM videos GROUP BY status').map((r) => [r.status, r.n])),
      sessions: ctx.db.get('SELECT COUNT(*) AS n FROM learning_sessions').n,
    },
    automation: content.automationStatus(),
    settings: meta.getSettings(),
  }), A);
  R.get('/api/admin/vocabulary', (ctx) => vocabulary.browse({ ...ctx.query, status: ctx.query.status || 'published', pageSize: 50 }), A);
  R.post('/api/admin/vocabulary', (ctx) => ({ id: vocabulary.create(ctx.body, { status: ctx.body.status === 'pending' ? 'pending' : 'published', source: 'admin' }) }), A);
  R.get('/api/admin/vocabulary/:id', (ctx) => vocabulary.get(id(ctx.params.id), { any: true }), A);
  R.patch('/api/admin/vocabulary/:id', (ctx) => { vocabulary.update(id(ctx.params.id), ctx.body); return { ok: true }; }, A);
  R.post('/api/admin/vocabulary/:id/status', (ctx) => {
    const st = ctx.body.status;
    if (!['published', 'pending', 'rejected'].includes(st)) throw bad('Invalid status');
    vocabulary.setStatus(id(ctx.params.id), st, ctx.body.reviewStatus);
    return { ok: true };
  }, A);
  R.del('/api/admin/vocabulary/:id', (ctx) => { vocabulary.remove(id(ctx.params.id)); return { ok: true }; }, A);
  R.post('/api/admin/vocabulary/import', (ctx) => content.importVocabulary(ctx.body), { ...A, bodyLimit: 4_000_000 });
  R.post('/api/admin/vocabulary/validate', (ctx) => { const r = vocabulary.validate(ctx.body); return { problems: r.problems, warnings: r.warnings, value: r.value }; }, A);
  R.get('/api/admin/lists', (ctx) => ctx.db.all('SELECT l.*, (SELECT COUNT(*) FROM vocabulary_list_items i WHERE i.list_id = l.id) AS word_count FROM vocabulary_lists l ORDER BY l.created_at DESC, l.id DESC'), A);
  R.get('/api/admin/lists/:id', (ctx) => vocabulary.listDetail(id(ctx.params.id), { any: true }), A);
  R.post('/api/admin/lists', (ctx) => {
    const { title, description = '', level = null, topicId = null, vocabularyIds = [], status = 'published' } = ctx.body;
    if (!String(title || '').trim()) throw bad('Title is required');
    return ctx.db.tx(() => {
      const r = ctx.db.run('INSERT INTO vocabulary_lists(title, description, level, topic_id, status, source, created_at) VALUES (?,?,?,?,?,?,?)', String(title).trim().slice(0, 120), String(description).slice(0, 500), level || null, topicId || null, status, 'admin', clock.now().toISOString());
      const lid = Number(r.lastInsertRowid);
      vocabularyIds.forEach((v, i) => ctx.db.run('INSERT OR IGNORE INTO vocabulary_list_items(list_id, vocabulary_id, position) VALUES (?,?,?)', lid, Number(v), i));
      return { id: lid };
    });
  }, A);
  R.patch('/api/admin/lists/:id', (ctx) => {
    const lid = id(ctx.params.id);
    const cur = ctx.db.get('SELECT * FROM vocabulary_lists WHERE id = ?', lid);
    if (!cur) throw new HttpError(404, 'List not found');
    const b = ctx.body;
    ctx.db.tx(() => {
      ctx.db.run('UPDATE vocabulary_lists SET title = ?, description = ?, level = ?, topic_id = ?, status = ? WHERE id = ?', b.title ?? cur.title, b.description ?? cur.description, b.level ?? cur.level, b.topicId ?? cur.topic_id, b.status ?? cur.status, lid);
      if (Array.isArray(b.vocabularyIds)) {
        ctx.db.run('DELETE FROM vocabulary_list_items WHERE list_id = ?', lid);
        b.vocabularyIds.forEach((v, i) => ctx.db.run('INSERT OR IGNORE INTO vocabulary_list_items(list_id, vocabulary_id, position) VALUES (?,?,?)', lid, Number(v), i));
      }
      if (b.status === 'published' && b.publishWords) ctx.db.run("UPDATE vocabulary SET status = 'published' WHERE id IN (SELECT vocabulary_id FROM vocabulary_list_items WHERE list_id = ?) AND status = 'pending'", lid);
    });
    vocabulary.invalidate();
    return { ok: true };
  }, A);
  R.del('/api/admin/lists/:id', (ctx) => { ctx.db.run('DELETE FROM vocabulary_lists WHERE id = ?', id(ctx.params.id)); return { ok: true }; }, A);
  R.post('/api/admin/topics', (ctx) => ({ id: meta.createTopic(ctx.body) }), A);
  R.patch('/api/admin/topics/:id', (ctx) => { meta.updateTopic(id(ctx.params.id), ctx.body); vocabulary.invalidate(); return { ok: true }; }, A);
  R.del('/api/admin/topics/:id', (ctx) => { meta.deleteTopic(id(ctx.params.id)); vocabulary.invalidate(); return { ok: true }; }, A);
  R.post('/api/admin/levels', (ctx) => { meta.createLevel(ctx.body); return { ok: true }; }, A);
  R.patch('/api/admin/levels/:code', (ctx) => { meta.updateLevel(ctx.params.code, ctx.body); return { ok: true }; }, A);
  R.get('/api/admin/stories', (ctx) => library.listStories(null, { ...ctx.query, status: ctx.query.status || 'published' }), A);
  R.get('/api/admin/stories/:id', (ctx) => library.getStory(id(ctx.params.id), null, { any: true }), A);
  R.post('/api/admin/stories', (ctx) => ({ id: library.createStory(ctx.body, { status: ctx.body.status === 'published' ? 'published' : 'pending' }) }), A);
  R.patch('/api/admin/stories/:id', (ctx) => { library.updateStory(id(ctx.params.id), ctx.body); return { ok: true }; }, A);
  R.post('/api/admin/stories/:id/status', (ctx) => { if (!['published', 'pending', 'rejected'].includes(ctx.body.status)) throw bad('Invalid status'); library.setStoryStatus(id(ctx.params.id), ctx.body.status, ctx.body.reviewStatus); return { ok: true }; }, A);
  R.del('/api/admin/stories/:id', (ctx) => { library.deleteStory(id(ctx.params.id)); return { ok: true }; }, A);
  R.get('/api/admin/videos', (ctx) => library.listVideos(null, { ...ctx.query, status: ctx.query.status || 'published' }), A);
  R.get('/api/admin/videos/:id', (ctx) => library.getVideo(id(ctx.params.id), null, { any: true }), A);
  R.post('/api/admin/videos', async (ctx) => ({ id: await library.addVideo(ctx.body, { status: ctx.body.status === 'published' ? 'published' : 'pending' }) }), A);
  R.patch('/api/admin/videos/:id', (ctx) => { library.updateVideo(id(ctx.params.id), ctx.body); return { ok: true }; }, A);
  R.post('/api/admin/videos/:id/status', (ctx) => { if (!['published', 'pending', 'rejected'].includes(ctx.body.status)) throw bad('Invalid status'); library.setVideoStatus(id(ctx.params.id), ctx.body.status); return { ok: true }; }, A);
  R.del('/api/admin/videos/:id', (ctx) => { library.deleteVideo(id(ctx.params.id)); return { ok: true }; }, A);
  R.get('/api/admin/review', () => content.reviewQueue(), A);
  R.get('/api/admin/jobs', (ctx) => ({ jobs: content.listJobs({ status: ctx.query.status }), automation: content.automationStatus() }), A);
  R.post('/api/admin/jobs', (ctx) => content.trigger(ctx.body.type, ctx.body.payload || {}, `admin:${ctx.user.email}`), { ...A, rate: { name: 'jobs', limit: 30, windowMs: 60 * 60_000 } });
  R.post('/api/admin/jobs/run-scheduler', () => content.tick({ force: true }), A);
  R.post('/api/admin/jobs/:id/retry', (ctx) => content.retry(id(ctx.params.id)), A);
  R.get('/api/admin/settings', () => meta.getSettings(), A);
  R.patch('/api/admin/settings', (ctx) => meta.updateSettings(ctx.body), A);
  R.post('/api/admin/ai/translate', (ctx) => content.translateAssist(ctx.body), { ...A, rate: { name: 'ai', limit: 60, windowMs: 60 * 60_000 } });
  R.get('/api/admin/users', (ctx) => ctx.db.all('SELECT u.id, u.email, u.role, u.created_at, p.display_name, p.proficiency_level FROM users u JOIN user_profiles p ON p.user_id = u.id ORDER BY u.id DESC LIMIT 500'), A);
  R.patch('/api/admin/users/:id', (ctx) => {
    if (!['learner', 'admin'].includes(ctx.body.role)) throw bad('Invalid role');
    if (id(ctx.params.id) === ctx.user.id && ctx.body.role !== 'admin') throw bad('You cannot remove your own admin role');
    ctx.db.run('UPDATE users SET role = ? WHERE id = ?', ctx.body.role, id(ctx.params.id));
    return { ok: true };
  }, A);

  if (config.testMode) {
    R.post('/api/__test/clock', (ctx) => { clock.setOffset(Number(ctx.body.offsetMs) || 0); return { now: clock.now().toISOString() }; });
    R.get('/api/__test/outbox', () => mailer.outbox);
  }

  // ------------------------------------------------------------ request handling
  const staticRoots = [{ prefix: '/shared/', dir: path.join(ROOT, 'shared') }, { prefix: '/', dir: path.join(ROOT, 'public') }];
  const indexHtml = path.join(ROOT, 'public', 'index.html');

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJSON(res, 405, { error: 'Method not allowed' });
      if (serveStatic(req, res, staticRoots, pathname)) return;
      if (path.extname(pathname)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(indexHtml).pipe(res);
    }
    const ip = req.socket.remoteAddress || 'unknown';
    try {
      const m = router.match(req.method, pathname);
      if (!m) throw new HttpError(404, 'Not found');
      if (m.methodNotAllowed) throw new HttpError(405, 'Method not allowed');
      const { route, params } = m;
      // CSRF: state-changing requests must come from our own pages (custom header + same origin)
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (req.headers['x-requested-with'] !== 'lotus') throw forbidden('Missing request header');
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw forbidden('Cross-origin request blocked');
      }
      if (route.opts.rate) {
        const r = limiter.hit(`${route.opts.rate.name}:${ip}`, route.opts.rate.limit, route.opts.rate.windowMs);
        if (!r.allowed) { res.setHeader('Retry-After', r.retryAfter); throw new HttpError(429, 'Too many requests. Please wait a moment and try again.'); }
      }
      const cookies = parseCookies(req.headers.cookie);
      const token = cookies[SESSION_COOKIE];
      const user = auth.userFromToken(token);
      if (route.opts.auth && !user) throw new HttpError(401, 'Please sign in.');
      if (route.opts.auth === 'admin' && user.role !== 'admin') throw forbidden('Administrator access required.');
      const body = req.method === 'GET' ? {} : await readBody(req, route.opts.bodyLimit || 1_000_000);
      const outCookies = [];
      const ctx = { req, res, params, query: Object.fromEntries(url.searchParams), body, user, token, db, setCookie: (c) => outCookies.push(c) };
      const data = await route.handler(ctx);
      if (outCookies.length) res.setHeader('Set-Cookie', outCookies);
      sendJSON(res, 200, data ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return sendJSON(res, e.status, { error: e.message, details: e.details });
      if (e instanceof ServiceUnavailable) return sendJSON(res, 503, { error: e.message, service: e.service, code: e.code });
      logger.error('[server] unhandled error', e);
      sendJSON(res, 500, { error: 'Something went wrong on the server.' });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res).catch((e) => { logger.error(e); try { sendJSON(res, 500, { error: 'Server error' }); } catch { /* ignore */ } }); });
  let timer = null;
  function startScheduler() {
    if (!config.automationEnabled) return;
    const run = () => content.tick().catch((e) => logger.warn('[scheduler]', e.message));
    setTimeout(run, 5000).unref();
    timer = setInterval(run, config.automationIntervalMinutes * 60_000);
    timer.unref();
  }
  function close() {
    if (timer) clearInterval(timer);
    return new Promise((resolve) => server.close(() => { db.close(); resolve(); }));
  }
  return { config, db, clock, services, server, mailer, startScheduler, close };
}
