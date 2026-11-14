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
import { createDictionaryService } from './services/dictionary.js';
import { createGrammarService } from './services/grammar.js';
import { createNotesService } from './services/notes.js';
import { createDailyTopicsService } from './services/dailyTopics.js';
import { createEventBus } from './services/events.js';
import { createDictionaryProviders } from './integrations/dictionaryProviders.js';
import { createLookupService } from './services/lookup.js';
import { createLearntService } from './services/learnt.js';
import { LANGUAGES, LANG_CODES, isLang } from '../shared/indic.js';
import { createDailyTopicAutomation } from './services/dailyTopicAutomation.js';

const STREAM = Symbol('stream');
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
  const dailyAI=deps.dailyAI||deps.ai||createAI({ai:config.dailyTopicAi},deps.fetch);
  const youtube = deps.youtube || createYouTube(config, deps.fetch);
  const meta = createMetaService({ db });
  const vocabulary = createVocabularyService({ db, clock, meta });
  const collections = createCollectionsService({ db, clock, meta, vocabulary });
  const learning = createLearningService({ db, clock, vocabulary, rand: deps.rand });
  const stats = createStatsService({ db, clock, collections });
  const library = createLibraryService({ db, clock, meta, youtube });
  const events = createEventBus();
  const dictionary = createDictionaryService({ db, vocabulary });
  const grammar = createGrammarService({ db, clock, meta });
  const notes = createNotesService({ db, clock });
  const providers = deps.providers || createDictionaryProviders(process.env, deps.fetch);
  const legacyDailyTopics = createDailyTopicsService({ db, clock, meta, vocabulary });
  const dailyTopics = createDailyTopicAutomation({ db, clock, meta, vocabulary, ai:dailyAI, events, config, providers, legacy: legacyDailyTopics });
  const profile = createProfileService({ db, clock, meta, vocabulary, library, learning, stats, collections, grammar, dailyTopics, notes });
  const auth = createAuthService({ db, clock, config, mailer });
  const content = createContentService({ db, clock, config, meta, vocabulary, library, grammar, dailyTopics, dictionary, ai, youtube, events, providers, logger });
  const lookup = createLookupService({ db, clock, meta, vocabulary, dictionary, ai, providers, content });
  const learnt = createLearntService({ db, clock });
  learning.onFinalize((userId, lang) => learnt.recompute(userId, lang)); // Learnt updates whenever a lesson completes
  try { learnt.backfill(); } catch (e) { logger.warn('[learnt] backfill skipped:', e.message); } // evaluate historical records
  const services = { auth, meta, vocabulary, collections, learning, stats, library, profile, content, dictionary, grammar, notes, dailyTopics, events, lookup, learnt, providers };
  const limiter = new RateLimiter();
  const router = new Router();
  const R = router;
  const id = (p) => { const n = Number(p); if (!Number.isInteger(n) || n < 1) throw bad('Invalid id'); return n; };
  const U = { auth: 'user' };
  /** Language of a request: explicit ?lang / body.lang, else the user's active learning language. */
  const langOf = (ctx) => {
    const l = ctx.query.lang || ctx.body?.lang || (ctx.user ? profile.activeLang(ctx.user.id) : 'ta');
    if (!isLang(l)) throw bad('Unknown learning language');
    return l;
  };
  const A = { auth: 'admin' };

  // ------------------------------------------------------------ public
  R.get('/api/health', () => ({ ok: true, time: clock.now().toISOString() }));
  R.get('/api/meta', () => ({
    ...meta.publicMeta(), languages: LANG_CODES.map((c) => ({ code: c, name: LANGUAGES[c].name, native: LANGUAGES[c].native })), partsOfSpeech: PARTS_OF_SPEECH, registers: REGISTERS, storyCategories: STORY_CATEGORIES, videoCategories: VIDEO_CATEGORIES,
    limits: { sessionMaxWords: SESSION_MAX_WORDS, correctPerWord: CORRECT_PER_WORD, collectionWordLimit: meta.getSettings().collection_word_limit, storyMinSentences: 20, dailyTopicWords: [meta.getSettings().daily_topic_words_min, meta.getSettings().daily_topic_words_max] },
    dictionaryProviders: providers.status(),
    features: { externalDictionary: lookup.configured(), ai: ai.configured, youtubeDiscovery: youtube.configured, email: mailer.provider !== 'console' },
  }));
  R.get('/api/public/showcase', () => ({
    words: vocabulary.published('ta').filter((v) => v.level === 'A1').slice(0, 6).map((v) => ({ tamil: v.tamil, transliteration: v.transliteration, english: v.english })),
    perLanguage: LANG_CODES.map((c) => ({ code: c, name: LANGUAGES[c].name, native: LANGUAGES[c].native, words: vocabulary.published(c).length, sample: vocabulary.published(c).find((v) => v.conceptKey === 'water') ? { native: vocabulary.published(c).find((v) => v.conceptKey === 'water').tamil } : null })),
    counts: { words: LANG_CODES.reduce((a, c) => a + vocabulary.published(c).length, 0), stories: library.listStories(null).total, videos: library.listVideos(null).length },
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
  R.put('/api/profile/language', (ctx) => profile.update(ctx.user.id, { activeLanguage: ctx.body.lang }), U);
  R.get('/api/home', (ctx) => profile.home(ctx.user.id, langOf(ctx)), U);

  // ------------------------------------------------------------ vocabulary & dictionary
  R.get('/api/vocabulary', (ctx) => vocabulary.browse({ ...ctx.query, lang: langOf(ctx) }), U);
  R.get('/api/vocabulary/daily', (ctx) => { const l = langOf(ctx); return vocabulary.daily(ctx.user.id, profile.legacyRow(ctx.user.id, l), 12, l); }, U);
  R.get('/api/vocabulary/lists', (ctx) => vocabulary.lists({ ...ctx.query, lang: langOf(ctx) }), U);
  R.get('/api/vocabulary/lists/:id', (ctx) => vocabulary.listDetail(id(ctx.params.id)), U);
  R.get('/api/vocabulary/:id', (ctx) => { const v = vocabulary.get(id(ctx.params.id)); if (!v) throw new HttpError(404, 'Word not found'); return v; }, U);
  // ?dict = dictionary language (defaults to the active language); ?direction = to_en | from_en | auto
  const dictLang = (ctx) => { const l = ctx.query.dict || ctx.body?.dict || profile.activeLang(ctx.user.id); if (!isLang(l)) throw bad('Unknown dictionary language'); return l; };
  R.get('/api/dictionary/search', (ctx) => lookup.search(ctx.query.q, { lang: dictLang(ctx), direction: ctx.query.direction || 'auto', admin: ctx.user.role === 'admin' }), { ...U, rate: { name: 'dict', limit: 600, windowMs: 60 * 60_000 } });
  R.get('/api/dictionary/status', async () => {
    const health = await providers.health();
    return { available: !!health.ok, entries: health.lexicon?.entries || {}, sources: health.lexicon?.sources || [],
      attestedForms: health.lexicon?.attested_forms || {},
      ai: health.llm?.available || false, model: health.llm?.model || '', message: health.error || health.llm?.reason || '',
      translation: health.translator?.available || false };
  }, U);
  R.get('/api/dictionary/suggest', (ctx) => lookup.suggest(ctx.query.q, { lang: dictLang(ctx), direction: ctx.query.direction || 'auto' }), U);
  R.get('/api/dictionary/lookup', (ctx) => lookup.lookupToken(ctx.query.ta || ctx.query.w, dictLang(ctx), { context: ctx.query.context }), U);
  R.get('/api/dictionary/entries/:id', (ctx) => dictionary.entry(id(ctx.params.id), { admin: ctx.user.role === 'admin' }), U);
  R.post('/api/dictionary/entries/:id/complete', (ctx) => lookup.completeEntry(id(ctx.params.id)), { ...U, rate: { name: 'complete', limit: 60, windowMs: 60 * 60_000 } });
  R.get('/api/learnt', (ctx) => learnt.list(ctx.user.id, langOf(ctx)), U);
  // Without a local model, "enrich" uses the offline sources (lexicon, Wikipedia usage, other-language equivalents).
  R.post('/api/dictionary/entries/:id/enrich', (ctx) => (ai.configured ? content.requestEnrichment(id(ctx.params.id), `user:${ctx.user.id}`) : lookup.completeEntry(id(ctx.params.id))), { ...U, rate: { name: 'enrich', limit: 10, windowMs: 60 * 60_000 } });
  R.post('/api/dictionary/ai-suggest', (ctx) => content.dictionarySuggest(ctx.body.q, ctx.body.lang, dictLang(ctx)), { ...U, rate: { name: 'ai', limit: 20, windowMs: 60 * 60_000 } });

  // ------------------------------------------------------------ collections
  R.get('/api/collections', (ctx) => collections.list(ctx.user.id, ctx.query.q, langOf(ctx)), U);
  R.post('/api/collections', (ctx) => ({ id: collections.create(ctx.user.id, ctx.body, langOf(ctx)) }), U);
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
  R.get('/api/words/search', (ctx) => collections.searchWords(ctx.user.id, String(ctx.query.q || ''), langOf(ctx)), U);

  // ------------------------------------------------------------ selection & sessions
  R.get('/api/selection', (ctx) => collections.getSelection(ctx.user.id, langOf(ctx)), U);
  R.post('/api/selection', (ctx) => (ctx.body.collectionId ? collections.selectCollection(ctx.user.id, id(ctx.body.collectionId)) : collections.addToSelection(ctx.user.id, ctx.body.ids, langOf(ctx))), U);
  R.post('/api/selection/remove', (ctx) => collections.removeFromSelection(ctx.user.id, ctx.body.ids || [], langOf(ctx)), U);
  R.post('/api/selection/clear', (ctx) => collections.clearSelection(ctx.user.id, langOf(ctx)), U);
  R.get('/api/sessions', (ctx) => learning.history(ctx.user.id, Number(ctx.query.limit) || 20, langOf(ctx)), U);
  R.post('/api/sessions', (ctx) => ({ id: learning.start(ctx.user.id, langOf(ctx)) }), U);
  R.get('/api/sessions/active', (ctx) => ({ session: learning.active(ctx.user.id, langOf(ctx)) }), U);
  R.get('/api/sessions/:id', (ctx) => learning.state(ctx.user.id, id(ctx.params.id)), U);
  R.get('/api/sessions/:id/question', (ctx) => learning.nextQuestion(ctx.user.id, id(ctx.params.id)), U);
  R.post('/api/sessions/:id/answer', (ctx) => learning.answer(ctx.user.id, id(ctx.params.id), ctx.body), U);
  R.post('/api/sessions/:id/abandon', (ctx) => learning.abandon(ctx.user.id, id(ctx.params.id)), U);
  R.get('/api/sessions/:id/summary', (ctx) => learning.summary(ctx.user.id, id(ctx.params.id)), U);

  // ------------------------------------------------------------ statistics
  R.get('/api/stats/overview', (ctx) => stats.overview(ctx.user.id, langOf(ctx)), U);
  R.get('/api/stats/collections', (ctx) => stats.globalStats(ctx.user.id, langOf(ctx)), U);

  // ------------------------------------------------------------ reading & videos
  R.get('/api/stories', (ctx) => library.listStories(ctx.user.id, { ...ctx.query, lang: langOf(ctx), status: 'published' }), U);
  R.post('/api/stories/update', (ctx) => ({ items: library.refreshStories(ctx.user.id, langOf(ctx)) }), U);
  R.get('/api/stories/:id', (ctx) => library.getStory(id(ctx.params.id), ctx.user.id), U);
  R.put('/api/stories/:id/progress', (ctx) => library.saveProgress(ctx.user.id, id(ctx.params.id), ctx.body), U);
  R.get('/api/reading/history', (ctx) => library.readingHistory(ctx.user.id, langOf(ctx)), U);
  R.get('/api/videos', (ctx) => library.listVideos(ctx.user.id, { ...ctx.query, lang: langOf(ctx), status: 'published' }), U);
  R.post('/api/videos/update', (ctx) => ({ items: library.refreshVideos(ctx.user.id, langOf(ctx), ctx.body?.previous) }), U);
  R.get('/api/videos/:id', (ctx) => library.getVideo(id(ctx.params.id), ctx.user.id), U);
  R.put('/api/videos/:id/state', (ctx) => library.setVideoState(ctx.user.id, id(ctx.params.id), ctx.body), U);

  // ------------------------------------------------------------ grammar, notes, daily topic, live content
  R.get('/api/grammar/categories', (ctx) => grammar.categories(langOf(ctx)), U);
  R.get('/api/grammar', (ctx) => grammar.list(langOf(ctx), { ...ctx.query, userId: ctx.user.id }), U);
  R.get('/api/grammar/:id', (ctx) => grammar.get(id(ctx.params.id), { userId: ctx.user.id }), U);
  R.put('/api/grammar/:id/progress', (ctx) => grammar.setProgress(ctx.user.id, id(ctx.params.id), ctx.body), U);
  R.get('/api/notes/month', (ctx) => notes.month(ctx.user.id, langOf(ctx), ctx.query.ym), U);
  R.get('/api/notes/year', (ctx) => notes.year(ctx.user.id, langOf(ctx), String(ctx.query.y || '')), U);
  R.get('/api/notes/day', (ctx) => notes.byDate(ctx.user.id, langOf(ctx), ctx.query.date), U);
  R.get('/api/notes/search', (ctx) => notes.search(ctx.user.id, langOf(ctx), ctx.query.q), U);
  R.get('/api/notes/recent', (ctx) => notes.recent(ctx.user.id, langOf(ctx)), U);
  R.post('/api/notes', (ctx) => notes.create(ctx.user.id, langOf(ctx), ctx.body), U);
  R.get('/api/notes/:id', (ctx) => notes.get(ctx.user.id, id(ctx.params.id)), U);
  R.patch('/api/notes/:id', (ctx) => notes.update(ctx.user.id, id(ctx.params.id), ctx.body), U);
  R.del('/api/notes/:id', (ctx) => { notes.remove(ctx.user.id, id(ctx.params.id)); return { ok: true }; }, U);
  R.get('/api/daily-topic/today', (ctx) => { const l = langOf(ctx); const lv = ctx.query.all ? null : profile.get(ctx.user.id).languages[l].level; return dailyTopics.today(l, { level: lv }); }, U);
  R.get('/api/daily-topic/archive', (ctx) => dailyTopics.archive(langOf(ctx), ctx.query), U);
  R.get('/api/daily-topic/status', () => dailyTopics.status(), U);
  R.get('/api/daily-topic/:id', (ctx) => { const t = dailyTopics.get(id(ctx.params.id), { lang: langOf(ctx) }); const lv = ctx.query.all ? null : profile.get(ctx.user.id).languages[t.lang].level; return dailyTopics.get(t.id, { level: lv, lang: langOf(ctx) }); }, U);
  R.get('/api/content/version', (ctx) => content.version(langOf(ctx)), U);
  R.post('/api/content/catchup', () => content.catchUp(), { ...U, rate: { name: 'catchup', limit: 30, windowMs: 60 * 60_000 } });
  R.get('/api/events', (ctx) => { events.subscribe(ctx.req, ctx.res); return STREAM; }, U);

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
  R.get('/api/admin/vocabulary', (ctx) => vocabulary.browse({ ...ctx.query, lang: langOf(ctx), status: ctx.query.status || 'published', pageSize: 50 }), A);
  R.post('/api/admin/vocabulary', (ctx) => ({ id: vocabulary.create(ctx.body, { lang: langOf(ctx), status: ctx.body.status === 'pending' ? 'pending' : 'published', source: 'admin' }) }), A);
  R.get('/api/admin/vocabulary/:id', (ctx) => vocabulary.get(id(ctx.params.id), { any: true }), A);
  R.patch('/api/admin/vocabulary/:id', (ctx) => { vocabulary.update(id(ctx.params.id), ctx.body); return { ok: true }; }, A);
  R.post('/api/admin/vocabulary/:id/status', (ctx) => {
    const st = ctx.body.status;
    if (!['published', 'pending', 'rejected'].includes(st)) throw bad('Invalid status');
    vocabulary.setStatus(id(ctx.params.id), st, ctx.body.reviewStatus);
    if (st === 'published') { const v = vocabulary.get(id(ctx.params.id)); if (v && dailyTopics.topUpToday(v.lang)) events.publish('content', { type: 'daily_topic', lang: v.lang }); }
    return { ok: true };
  }, A);
  R.del('/api/admin/vocabulary/:id', (ctx) => { vocabulary.remove(id(ctx.params.id)); return { ok: true }; }, A);
  R.post('/api/admin/vocabulary/import', (ctx) => content.importVocabulary({ ...ctx.body, lang: langOf(ctx) }), { ...A, bodyLimit: 4_000_000 });
  R.post('/api/admin/vocabulary/validate', (ctx) => { const r = vocabulary.validate(ctx.body, langOf(ctx)); return { problems: r.problems, warnings: r.warnings, value: r.value }; }, A);
  R.get('/api/admin/lists', (ctx) => ctx.db.all('SELECT l.*, (SELECT COUNT(*) FROM vocabulary_list_items i WHERE i.list_id = l.id) AS word_count FROM vocabulary_lists l WHERE l.lang = ? ORDER BY l.created_at DESC, l.id DESC', langOf(ctx)), A);
  R.get('/api/admin/lists/:id', (ctx) => vocabulary.listDetail(id(ctx.params.id), { any: true }), A);
  R.post('/api/admin/lists', (ctx) => {
    const { title, description = '', level = null, topicId = null, vocabularyIds = [], status = 'published' } = ctx.body;
    if (!String(title || '').trim()) throw bad('Title is required');
    return ctx.db.tx(() => {
      const r = ctx.db.run('INSERT INTO vocabulary_lists(lang, title, description, level, topic_id, status, source, created_at) VALUES (?,?,?,?,?,?,?,?)', langOf(ctx), String(title).trim().slice(0, 120), String(description).slice(0, 500), level || null, topicId || null, status, 'admin', clock.now().toISOString());
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
  R.get('/api/admin/stories', (ctx) => library.listStories(null, { ...ctx.query, lang: langOf(ctx), status: ctx.query.status || 'published' }), A);
  R.get('/api/admin/stories/:id', (ctx) => library.getStory(id(ctx.params.id), null, { any: true }), A);
  R.post('/api/admin/stories', (ctx) => ({ id: library.createStory({ ...ctx.body, lang: langOf(ctx) }, { status: ctx.body.status === 'published' ? 'published' : 'pending' }) }), A);
  R.patch('/api/admin/stories/:id', (ctx) => { library.updateStory(id(ctx.params.id), ctx.body); return { ok: true }; }, A);
  R.post('/api/admin/stories/:id/status', (ctx) => {
    if (!['published', 'pending', 'rejected'].includes(ctx.body.status)) throw bad('Invalid status');
    if (ctx.body.status === 'published') { const st = library.getStory(id(ctx.params.id), null, { any: true }); if (st.sentenceCount < 20) throw bad(`This story has ${st.sentenceCount} sentences; published stories need at least 20.`); }
    library.setStoryStatus(id(ctx.params.id), ctx.body.status, ctx.body.reviewStatus);
    if (ctx.body.status === 'published') events.publish('content', { type: 'story', id: id(ctx.params.id) });
    return { ok: true };
  }, A);
  R.del('/api/admin/stories/:id', (ctx) => { library.deleteStory(id(ctx.params.id)); return { ok: true }; }, A);
  R.get('/api/admin/videos', (ctx) => library.listVideos(null, { ...ctx.query, lang: langOf(ctx), status: ctx.query.status || 'published' }), A);
  R.get('/api/admin/videos/:id', (ctx) => library.getVideo(id(ctx.params.id), null, { any: true }), A);
  R.post('/api/admin/videos', async (ctx) => ({ id: await library.addVideo(ctx.body, { lang: langOf(ctx), status: ctx.body.status === 'published' ? 'published' : 'pending' }) }), A);
  R.patch('/api/admin/videos/:id', (ctx) => { library.updateVideo(id(ctx.params.id), ctx.body); return { ok: true }; }, A);
  R.post('/api/admin/videos/:id/status', (ctx) => { if (!['published', 'pending', 'rejected'].includes(ctx.body.status)) throw bad('Invalid status'); library.setVideoStatus(id(ctx.params.id), ctx.body.status); if (ctx.body.status === 'published') events.publish('content', { type: 'video', id: id(ctx.params.id) }); return { ok: true }; }, A);
  R.get('/api/admin/grammar', (ctx) => grammar.list(langOf(ctx), { ...ctx.query, status: ctx.query.status || 'published' }), A);
  R.get('/api/admin/grammar/categories', (ctx) => grammar.leafCategories(langOf(ctx)), A);
  R.get('/api/admin/grammar/:id', (ctx) => grammar.get(id(ctx.params.id), { any: true }), A);
  R.post('/api/admin/grammar', (ctx) => ({ id: grammar.create({ ...ctx.body, lang: langOf(ctx) }, { status: ctx.body.status === 'published' ? 'published' : 'pending', source: 'admin' }) }), A);
  R.patch('/api/admin/grammar/:id', (ctx) => { grammar.update(id(ctx.params.id), ctx.body); return { ok: true }; }, A);
  R.post('/api/admin/grammar/:id/status', (ctx) => { if (!['published', 'pending', 'rejected'].includes(ctx.body.status)) throw bad('Invalid status'); grammar.setStatus(id(ctx.params.id), ctx.body.status, ctx.body.reviewStatus); if (ctx.body.status === 'published') events.publish('content', { type: 'grammar', id: id(ctx.params.id) }); return { ok: true }; }, A);
  R.del('/api/admin/grammar/:id', (ctx) => { grammar.remove(id(ctx.params.id)); return { ok: true }; }, A);
  R.get('/api/admin/daily-topics', (ctx) => dailyTopics.archive(langOf(ctx), ctx.query), A);
  R.get('/api/admin/daily-topic-automation', () => dailyTopics.status({admin:true}), A);
  R.post('/api/admin/daily-topic-automation/publish', (ctx) => ({published:dailyTopics.publish(id(String(ctx.body.dateId)))}), A);
  R.get('/api/admin/daily-topic-automation/:id', (ctx) => dailyTopics.inspect(id(ctx.params.id)), A);
  R.put('/api/admin/daily-topic-automation/:id/entries', (ctx) => dailyTopics.reviewSet(id(ctx.params.id),langOf(ctx),ctx.body.entries,ctx.user.id), A);
  R.post('/api/admin/daily-topic-automation/override', (ctx) => ({ id: dailyTopics.override(ctx.body) }), A);
  R.post('/api/admin/daily-topic-automation/run', () => dailyTopics.tick(), A);
  R.post('/api/admin/daily-topic-automation/retry', (ctx) => { dailyTopics.retry(Number(ctx.body.dateId),ctx.body.lang); return {ok:true}; }, A);
  R.post('/api/admin/daily-topics', (ctx) => { const tid = dailyTopics.adminSet(langOf(ctx), ctx.body); events.publish('content', { type: 'daily_topic', id: tid }); return { id: tid }; }, A);
  R.post('/api/admin/dictionary/:id/review', (ctx) => dictionary.reviewEnrichment(id(ctx.params.id), !!ctx.body.approve), A);
  R.del('/api/admin/videos/:id', (ctx) => { library.deleteVideo(id(ctx.params.id)); return { ok: true }; }, A);
  R.get('/api/admin/review', (ctx) => content.reviewQueue(ctx.query.lang && isLang(ctx.query.lang) ? ctx.query.lang : undefined), A);
  R.get('/api/admin/jobs', (ctx) => ({ jobs: content.listJobs({ status: ctx.query.status, lang: ctx.query.lang }), automation: content.automationStatus() }), A);
  R.post('/api/admin/jobs', (ctx) => content.trigger(ctx.body.type, ctx.body.payload || {}, `admin:${ctx.user.email}`, langOf(ctx)), { ...A, rate: { name: 'jobs', limit: 60, windowMs: 60 * 60_000 } });
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
      if (data === STREAM) return; // server-sent events keep the connection open
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
  let topicTimer = null;
  let startupTimer = null;
  function startScheduler() {
    if(topicTimer)return;
    // Server-owned scan: startup, within a minute of local midnight, and after wake.
    const topics = () => {
      if(!config.dailyTopicEnabled)return;
      void dailyTopics.tick().then(r=>{if(r.plannerError)logger.warn('[daily-topic planner]',r.plannerError);}).catch(e=>logger.warn('[daily-topic]',e.message));
    };
    topics();
    topicTimer = setInterval(topics, Math.max(10,config.dailyTopicScanMs)); topicTimer.unref();
    if (!config.automationEnabled) return;
    const run = () => content.tick().catch((e) => logger.warn('[scheduler]', e.message));
    startupTimer=setTimeout(run, 5000);startupTimer.unref();
    timer = setInterval(run, config.automationIntervalMinutes * 60_000);
    timer.unref();
  }
  async function close() {
    if (timer) clearInterval(timer);
    if (topicTimer) clearInterval(topicTimer);
    if(startupTimer)clearTimeout(startupTimer);
    await dailyTopics.drain();
    events.closeAll();
    return new Promise((resolve) => { server.close(() => { db.close(); resolve(); }); server.closeAllConnections?.(); });
  }
  return { config, db, clock, services, server, mailer, startScheduler, close };
}
