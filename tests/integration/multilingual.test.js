import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startTestServer, registerUser, finishSession } from '../helpers.js';
import { openDatabase } from '../../server/db.js';
import { ROOT } from '../../server/config.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });
const DAY = 86400_000;
const vid = (lang, native) => srv.app.db.get('SELECT id FROM vocabulary WHERE lang = ? AND tamil = ?', lang, native).id;
async function admin(s = srv) { const c = s.client(); const u = await registerUser(c); s.app.db.run("UPDATE users SET role = 'admin' WHERE email = ?", u.email); return c; }

// ------------------------------------------------------------------ language profiles & isolation
test('each language keeps its own level, collections and preferences; switching never loses data', async () => {
  const c = srv.client(); await registerUser(c);
  assert.equal((await c.get('/api/profile')).data.activeLanguage, 'ta');
  await c.patch('/api/profile', { level: 'B2', dailyGoal: 40, onboarded: true });
  const taCol = (await c.post('/api/collections', { title: 'Tamil 500' })).data.id;
  await c.post(`/api/collections/${taCol}/words`, { vocabularyIds: [vid('ta', 'வீடு'), vid('ta', 'மரம்')] });
  let p = (await c.put('/api/profile/language', { lang: 'ml' })).data;
  assert.equal(p.activeLanguage, 'ml'); assert.equal(p.level, 'A1'); assert.equal(p.onboarded, false, 'a new language starts with its own onboarding');
  await c.patch('/api/profile', { level: 'C1', onboarded: true });
  assert.deepEqual((await c.get('/api/collections')).data.collections, [], 'Tamil collections are not shown in Malayalam');
  const mlCol = (await c.post('/api/collections', { title: 'Malayalam 100' })).data.id;
  assert.equal((await c.post(`/api/collections/${mlCol}/words`, { vocabularyIds: [vid('ta', 'வீடு')] })).status, 400, 'Tamil words cannot enter a Malayalam collection');
  await c.post(`/api/collections/${mlCol}/words`, { vocabularyIds: [vid('ml', 'വീട്')] });
  assert.equal((await c.post(`/api/collections/${mlCol}/words`, { tamil: 'தமிழ்', english: 'Tamil' })).status, 400, 'manual words are validated in the collection language');
  await c.put('/api/profile/language', { lang: 'te' });
  await c.patch('/api/profile', { level: 'B1' });
  p = (await c.put('/api/profile/language', { lang: 'ta' })).data;
  assert.equal(p.level, 'B2'); assert.equal(p.dailyGoal, 40);
  assert.deepEqual({ ml: p.languages.ml.level, te: p.languages.te.level, kn: p.languages.kn.level }, { ml: 'C1', te: 'B1', kn: 'A1' });
  const ta = (await c.get('/api/collections')).data.collections;
  assert.equal(ta.length, 1); assert.equal(ta[0].wordCount, 2);
  assert.equal((await c.get('/api/collections?lang=ml')).data.collections[0].title, 'Malayalam 100');
});

test('lotus mastery, statistics and sessions are separated by language; sessions keep their original language', async () => {
  const c = srv.client(); await registerUser(c);
  const taCol = (await c.post('/api/collections', { title: 'ta' })).data.id;
  await c.post(`/api/collections/${taCol}/words`, { vocabularyIds: [vid('ta', 'பூ'), vid('ta', 'கடல்')] });
  await c.post('/api/selection', { collectionId: taCol });
  const taSession = (await c.post('/api/sessions')).data.id;
  await c.put('/api/profile/language', { lang: 'kn' });
  const knCol = (await c.post('/api/collections', { title: 'kn' })).data.id;
  await c.post(`/api/collections/${knCol}/words`, { vocabularyIds: [vid('kn', 'ಹೂವು'), vid('kn', 'ಮನೆ'), vid('kn', 'ನೀರು')] });
  assert.equal((await c.get('/api/selection')).data.count, 0, 'selections are per language');
  const taWord = srv.app.db.get('SELECT id FROM collection_words WHERE collection_id = ?', taCol).id;
  assert.equal((await c.post('/api/selection', { ids: [taWord] })).status, 400, 'cannot mix languages in one lesson');
  await c.post('/api/selection', { collectionId: knCol });
  const knSession = (await c.post('/api/sessions')).data.id;
  assert.equal((await c.get(`/api/sessions/${taSession}`)).data.lang, 'ta', 'the Tamil lesson stays Tamil while Kannada is active');
  const q = (await c.get(`/api/sessions/${taSession}/question`)).data.question;
  assert.ok(q.options.every((o) => !/[\u0C80-\u0CFF]/.test(o)), 'Tamil lesson questions never use Kannada words');
  await finishSession(c, taSession, srv.app);
  await finishSession(c, knSession, srv.app);
  const ta = (await c.get('/api/stats/overview?lang=ta')).data; const kn = (await c.get('/api/stats/overview?lang=kn')).data;
  assert.equal(ta.totals.lotuses, 2); assert.equal(kn.totals.lotuses, 3);
  assert.equal(ta.totals.correct, 20); assert.equal(kn.totals.correct, 30);
  assert.equal((await c.get('/api/stats/overview?lang=te')).data.totals.lotuses, 0);
  const kc = (await c.get(`/api/collections/${knCol}`)).data;
  assert.ok(kc.words.every((w) => w.mastery.lotus === 1));
  const rewards = srv.app.db.all('SELECT DISTINCT lang FROM lotus_rewards WHERE session_id IN (?, ?)', taSession, knSession).map((r) => r.lang).sort();
  assert.deepEqual(rewards, ['kn', 'ta']);
  // one active lesson per language is allowed at the same time
  await c.post('/api/selection', { collectionId: knCol });
  const kn2 = (await c.post('/api/sessions')).data.id;
  await c.put('/api/profile/language', { lang: 'ta' });
  await c.post('/api/selection', { collectionId: taCol });
  assert.equal((await c.post('/api/sessions')).status, 200, 'a Tamil lesson can run while a Kannada lesson is open');
  assert.equal((await c.get('/api/sessions/active?lang=kn')).data.session.id, kn2);
});

test('legacy Tamil data survives the multilingual migration, with a backup taken first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lotus-mig-'));
  const file = path.join(dir, 'legacy.db');
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
  raw.exec(fs.readFileSync(path.join(ROOT, 'server/migrations/001_init.sql'), 'utf8'));
  raw.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run('001_init.sql', 'x');
  raw.exec(`INSERT INTO levels VALUES ('A1','Beginner','',0),('B2','Upper','',3);
    INSERT INTO users(id, email, password_hash, created_at) VALUES (1,'old@example.com','scrypt$x','2026-01-01');
    INSERT INTO user_profiles(user_id, display_name, proficiency_level, daily_goal, onboarded, updated_at) VALUES (1,'Old','B2',35,1,'2026-01-01');
    INSERT INTO vocabulary(id, tamil, transliteration, english, part_of_speech, level, norm_key, created_at, updated_at) VALUES (1,'வீடு','vīṭu','house','noun','A1','வீடு|house','x','x');
    INSERT INTO collections(id, user_id, title, created_at, updated_at) VALUES (1,1,'Old words','x','x');
    INSERT INTO collection_words(id, collection_id, user_id, vocabulary_id, word_key, tamil, english, created_at, updated_at) VALUES (1,1,1,1,'v1','வீடு','house','x','x');
    INSERT INTO word_mastery(user_id, word_key, successful_days, updated_at) VALUES (1,'v1',4,'x');
    INSERT INTO lotus_rewards(user_id, word_key, reward_date, session_id, created_at) VALUES (1,'v1','2026-01-01',1,'x');
    INSERT INTO learning_sessions(id, user_id, status, word_count, started_at, last_activity_at) VALUES (1,1,'completed',1,'x','x');
    INSERT INTO content_jobs(job_type, idempotency_key, created_at) VALUES ('story','story:2026-01-01:0','x');`);
  raw.close();
  const db = openDatabase(file);
  assert.equal(db.get('SELECT lang FROM collections WHERE id = 1').lang, 'ta');
  assert.equal(db.get('SELECT lang FROM vocabulary WHERE id = 1').lang, 'ta');
  assert.equal(db.get("SELECT successful_days, lang FROM word_mastery WHERE word_key = 'v1'").successful_days, 4, 'lotus progress untouched');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM lotus_rewards').n, 1);
  assert.equal(db.get('SELECT lang FROM learning_sessions WHERE id = 1').lang, 'ta');
  const lp = db.get('SELECT * FROM user_language_profiles WHERE user_id = 1');
  assert.deepEqual([lp.lang, lp.proficiency_level, lp.daily_goal, lp.onboarded], ['ta', 'B2', 35, 1]);
  assert.equal(db.get("SELECT active_language FROM user_profiles WHERE user_id = 1").active_language, 'ta');
  assert.equal(db.get('SELECT norm_key FROM vocabulary WHERE id = 1').norm_key, 'ta|வீடு|house');
  assert.equal(db.get('SELECT lang FROM content_jobs').lang, 'ta', 'job history kept through the table rebuild');
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).some((f) => f.startsWith('pre-002_multilingual')), 'backup written before migrating');
  db.close();
});

// ------------------------------------------------------------------ dictionary
test('dictionary: both directions in every language, transliteration, Unicode and cross-script search', async () => {
  const c = srv.client(); await registerUser(c);
  const words = { ta: ['தண்ணீர்', 'thanneer'], ml: ['വെള്ളം', 'vellam'], kn: ['ನೀರು', 'neeru'], te: ['నీళ్ళు', 'neellu'] };
  for (const [lang, [native, roman]] of Object.entries(words)) {
    const fromEn = (await c.get(`/api/dictionary/search?dict=${lang}&direction=from_en&q=water`)).data;
    assert.equal(fromEn.results[0].native, native, `${lang}: English → native`);
    const toEn = (await c.get(`/api/dictionary/search?dict=${lang}&direction=to_en&q=${encodeURIComponent(native)}`)).data;
    assert.equal(toEn.results[0].english, 'water', `${lang}: native → English (Unicode input)`);
    const tr = (await c.get(`/api/dictionary/search?dict=${lang}&direction=to_en&q=${roman}`)).data;
    assert.equal(tr.results[0].native, native, `${lang}: transliteration search`);
    assert.equal((await c.get(`/api/dictionary/search?dict=${lang}&direction=to_en&q=water`)).data.results.length, 0, `${lang}: to_en does not match English glosses`);
  }
  assert.equal((await c.get('/api/dictionary/search?dict=te&q=watr')).data.results[0].native, 'నీళ్ళు', 'typo tolerance');
  assert.equal((await c.get(`/api/dictionary/search?dict=kn&q=${encodeURIComponent('ಕುಡಿದೆ')}`)).data.results[0].native, 'ಕುಡಿ', 'alternative word forms');
  assert.equal((await c.get('/api/dictionary/search?dict=ml&q=come%20and%20eat')).data.results[0].native, 'കഴിക്കുക', 'multiword expressions');
  const cross = (await c.get(`/api/dictionary/search?dict=te&q=${encodeURIComponent('ನೀರು')}`)).data;
  assert.equal(cross.results[0].native, 'నీళ్ళు'); assert.equal(cross.results[0].match.type, 'Kannada equivalent');
  assert.equal((await c.get(`/api/dictionary/search?dict=ml&q=${encodeURIComponent('पानी')}`)).data.results[0].native, 'വെള്ളം', 'Hindi input');
  assert.equal((await c.get(`/api/dictionary/lookup?dict=te&w=${encodeURIComponent('ఇల్లు')}`)).data.entry.english, 'house');
});

test('dictionary entries: sense-attached relations, categorised collocations, equivalents, examples, honest gaps', async () => {
  const c = srv.client(); await registerUser(c);
  const love = (await c.get(`/api/dictionary/entries/${vid('ta', 'காதல்')}`)).data;
  const s1 = love.senses[0];
  assert.equal(s1.gloss, 'love (romantic)');
  const anbu = s1.relations.nearSynonyms.find((r) => r.native === 'அன்பு');
  assert.ok(anbu && anbu.difference.includes('romantic'), 'synonyms carry nuance and difference');
  assert.ok(s1.relations.related.some((r) => r.native === 'பாசம்'), 'related words are kept apart from true synonyms');
  assert.equal(new Set(s1.relations.related.map((r) => r.english)).size, s1.relations.related.length, 'distinct meanings get distinct translations');
  assert.ok(s1.relations.contextualOpposites.some((r) => r.native === 'வெறுப்பு'));
  assert.ok(s1.collocations.adj_noun.some((x) => x.native === 'உண்மையான காதல்'));
  assert.ok(s1.collocations.noun_verb.some((x) => x.native === 'காதல் மலர்ந்தது'));
  assert.equal(s1.collocations.adv_verb.length, 0, 'no adverb+verb collocation is invented for this noun');
  assert.ok(s1.examples.every((e) => e.native.includes('[[') && e.transliteration && e.english), 'examples carry highlight, transliteration and translation');
  assert.equal(s1.diagnostics, undefined, 'editorial diagnostics stay out of the public entry');
  assert.equal(s1.notes, undefined);
  const joy = (await c.get(`/api/dictionary/entries/${vid('ta', 'மகிழ்ச்சி')}`)).data.senses[0];
  assert.ok(joy.collocations.adv_verb.some((x) => x.native === 'மகிழ்ச்சியாக இரு' && /adverbial/.test(x.explanation)), 'non-English constructions are labelled');
  assert.equal(joy.relations.synonyms.filter((r) => r.native === 'சந்தோஷம்').length + joy.relations.nearSynonyms.filter((r) => r.native === 'சந்தோஷம்').length, 1, 'no duplicate legacy + editor rows');
  const water = (await c.get(`/api/dictionary/entries/${vid('ta', 'தண்ணீர்')}`)).data.senses[0];
  const eq = Object.fromEntries(water.equivalents.map((e) => [e.lang, e.native]));
  assert.deepEqual(eq, { kn: 'ನೀರು', ml: 'വെള്ളം', te: 'నీళ్ళు', hi: 'पानी' });
  for (const e of water.equivalents.filter((x) => x.vocabularyId)) assert.equal(srv.app.db.get('SELECT concept_key FROM vocabulary WHERE id = ?', e.vocabularyId).concept_key, 'water', 'equivalents preserve the sense');
  const padi = (await c.get(`/api/dictionary/entries/${vid('ta', 'படி')}`)).data;
  assert.equal(padi.homonyms[0].meaning.includes('step'), true);
  assert.equal((await c.get(`/api/dictionary/entries/${vid('ta', 'வீடு')}`)).data.homonyms.length, 0, 'homonym section only when legitimate');
  const malHouse = (await c.get(`/api/dictionary/entries/${vid('ml', 'വീട്')}`)).data.senses[0];
  assert.ok(malHouse.equivalents.some((e) => e.lang === 'ta' && e.native === 'வீடு'));
});

function enrichAI() {
  let calls = 0;
  return { configured: true, provider: 'mock', model: 'm', get calls() { return calls; },
    async completeJSON() { calls++; return { senses: [{ gloss: 'house', definition: 'A building where people live.', synonyms: [{ native: 'ഭവനം', english: 'dwelling (formal)', difference: 'formal' }, { native: 'house', english: 'invalid Latin' }], collocations: { adj_noun: [{ native: 'പഴയ വീട്', english: 'old house' }] }, examples: [{ native: 'ഇത് പഴയ [[വീട്]] ആണ്.', english: 'This is an old house.' }], equivalents: [{ lang: 'hi', native: 'मकान', english: 'house (building)' }] }], homonyms: [] }; } };
}
test('AI dictionary enrichment is cached, validated, and hidden until approved', async () => {
  const ai = enrichAI();
  const s = await startTestServer({ deps: { ai } });
  try {
    const c = s.client(); await registerUser(c);
    const id = s.app.db.get("SELECT id FROM vocabulary WHERE lang = 'ml' AND tamil = 'വീട്'").id;
    const j = (await c.post(`/api/dictionary/entries/${id}/enrich`)).data;
    assert.equal(j.status, 'succeeded'); assert.equal(j.result.rejected.length, 1, 'non-Malayalam synonym rejected');
    await c.post(`/api/dictionary/entries/${id}/enrich`);
    assert.equal(ai.calls, 1, 'repeated requests reuse the stored result');
    let e = (await c.get(`/api/dictionary/entries/${id}`)).data.senses[0];
    assert.ok(e.relations.synonyms.some((r) => r.native === 'ഭവനം' && r.aiAssisted), 'automatically validated AI rows are shown, flagged as AI-assisted');
    const a = await admin(s);
    await a.post(`/api/admin/dictionary/${id}/review`, { approve: true });
    e = (await c.get(`/api/dictionary/entries/${id}`)).data.senses[0];
    assert.ok(e.relations.synonyms.some((r) => r.native === 'ഭവനം'));
    assert.ok(e.collocations.adj_noun.some((x) => x.native === 'പഴയ വീട്'));
  } finally { await s.close(); }
});

// ------------------------------------------------------------------ content automation
test('daily topic: canonical theme is shared across languages and concurrent browser requests', async () => {
  const c = srv.client(); await registerUser(c);
  const a = await admin();
  assert.equal((await a.patch('/api/admin/settings', { daily_topic_words_min: 5 })).status,400);
  const t1 = (await c.get('/api/daily-topic/today?lang=ta&all=1')).data;
  assert.ok(t1.title);assert.equal(t1.status,'pending');assert.equal(t1.words.length,0);
  assert.equal(new Set(t1.words.map((w) => w.id)).size, t1.words.length, 'distinct words');
  await c.post('/api/__test/clock', { offsetMs: DAY });
  await Promise.all([1, 2, 3, 4, 5].map(() => c.get('/api/daily-topic/today?lang=ta')));
  const date = srv.app.services.dailyTopics.dateOf();
  assert.equal(srv.app.db.get('SELECT COUNT(*) AS n FROM daily_topic_dates WHERE topic_date = ?',date).n,1);
  const arch = (await c.get('/api/daily-topic/archive?lang=ta')).data;
  assert.ok(arch.pending.some(x=>x.topic_date===t1.date),'incomplete dates are tracked, not falsely archived as published');
  const tamil=(await c.get('/api/daily-topic/today?lang=ta&all=1')).data;
  const telugu=(await c.get('/api/daily-topic/today?lang=te&all=1')).data;
  assert.equal(tamil.title,telugu.title);assert.equal(tamil.canonicalId,telugu.canonicalId);
  await c.post('/api/__test/clock', { offsetMs: 0 });
  assert.equal((await a.patch('/api/admin/settings', { daily_topic_words_min: 60 })).status,400);
});

test('general content catch-up preserves its state and does not create per-language Daily Topics', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lotus-run-'));
  const file = path.join(dir, 'lotus.db');
  let s = await startTestServer({ overrides: { databaseFile: file } });
  const a = await admin(s);
  const today = new Date().toISOString().slice(0, 10);
  const three = new Date(Date.now() - 3 * DAY).toISOString().slice(0, 10);
  s.app.db.run("INSERT INTO content_state(lang, content_type, last_run_date) VALUES ('ml', 'daily', ?) ON CONFLICT(lang, content_type) DO UPDATE SET last_run_date = excluded.last_run_date", three);
  await Promise.all([a.post('/api/admin/jobs/run-scheduler'), a.post('/api/admin/jobs/run-scheduler'), a.post('/api/content/catchup')]);
  assert.equal(s.app.db.get('SELECT COUNT(*) n FROM daily_topics').n,0,'general automation no longer creates language-specific daily records');
  assert.equal(s.app.db.get("SELECT last_run_date FROM content_state WHERE lang = 'ml' AND content_type = 'daily'").last_run_date, today);
  const counts = () => ({ stories: s.app.db.get('SELECT COUNT(*) AS n FROM stories').n, topics: s.app.db.get('SELECT COUNT(*) AS n FROM daily_topics').n, grammar: s.app.db.get('SELECT COUNT(*) AS n FROM grammar_lessons').n, notes: s.app.db.get('SELECT COUNT(*) AS n FROM learning_notes').n });
  await a.post('/api/notes', { date: today, body: 'persist me', lang: 'ml' });
  const before = counts();
  await s.close();
  s = await startTestServer({ overrides: { databaseFile: file } });
  assert.deepEqual(counts(), before, 'a restart (with the idempotent seed) neither deletes nor duplicates content');
  await s.close();
});

test('admin content lands in the right language library; validation and duplicates enforced', async () => {
  const a = await admin();
  const c = srv.client(); await registerUser(c);
  const lesson = { lang: 'kn', category: 'mood', level: 'A2', title: 'Requests with -ಇ', rule: 'Polite requests often use the respectful imperative form ending in -ಇ.',
    examples: [{ native: 'ದಯವಿಟ್ಟು ಒಳಗೆ ಬನ್ನಿ.', en: 'Please come in.' }, { native: 'ಕುಳಿತುಕೊಳ್ಳಿ.', en: 'Please sit down.' }],
    variations: [{ name: 'Informal', description: 'To friends', examples: [{ native: 'ಒಳಗೆ ಬಾ.', en: 'Come in.' }] }] };
  const bad = await a.post('/api/admin/grammar', { ...lesson, variations: [{ name: 'Empty', examples: [] }] });
  assert.equal(bad.status, 400); assert.ok(bad.data.details.problems.some((p) => /at least one example/.test(p)));
  assert.equal((await a.post('/api/admin/grammar', { ...lesson, examples: [{ native: 'Please come', en: 'x' }, lesson.examples[1]] })).status, 400, 'examples must be in the lesson language');
  const id = (await a.post('/api/admin/grammar', { ...lesson, status: 'published' })).data.id;
  assert.equal((await a.post('/api/admin/grammar', lesson)).status, 409);
  assert.ok((await c.get('/api/grammar?lang=kn')).data.items.some((l) => l.id === id));
  assert.ok(!(await c.get('/api/grammar?lang=te')).data.items.some((l) => l.id === id));
  const cat = (await c.get('/api/grammar/categories?lang=kn')).data.find((x) => x.slug === 'verbs');
  assert.ok(cat.children.find((ch) => ch.slug === 'mood').lessons >= 1, 'lesson filed under its parent category');
  assert.deepEqual((await c.put(`/api/grammar/${id}/progress`, { bookmarked: true, studied: true })).data.bookmarked, true);
  assert.equal((await c.get('/api/grammar?lang=kn&bookmarked=true')).data.items.length, 1);
  assert.equal((await c.get('/api/grammar?lang=ta&bookmarked=true')).data.items.length, 0, 'grammar progress is per language');
  const v = await a.post('/api/admin/videos', { lang: 'te', url: 'https://example.org/videos/telugu-lesson-1', title: 'Telugu lesson 1', level: 'A1', category: 'educational', status: 'published' });
  assert.equal(v.status, 200);
  assert.equal((await a.post('/api/admin/videos', { lang: 'te', url: 'https://example.org/videos/telugu-lesson-1#t=3', title: 'dup' })).status, 409, 'duplicate links rejected');
  await a.post(`/api/admin/videos/${v.data.id}/status`, { status: 'published' });
  assert.ok((await c.get('/api/videos?lang=te')).data.some((x) => x.id === v.data.id && x.watchUrl.startsWith('https://example.org')));
  assert.ok(!(await c.get('/api/videos?lang=ta')).data.some((x) => x.id === v.data.id));
  const stories = (await c.get('/api/stories?lang=ml')).data.items;
  assert.ok(stories.length >= 1 && stories.every((x) => x.lang === 'ml'));
  const full = (await c.get(`/api/stories/${stories[0].id}`)).data;
  assert.ok(full.sentenceCount >= 20, 'published stories have at least 20 sentences'); assert.ok(full.readingMinutes >= 1);
  const ta = (await c.get('/api/stories?lang=ta')).data.items;
  for (const s of ta) assert.ok((await c.get(`/api/stories/${s.id}`)).data.sentenceCount >= 20, `${s.titleEn} extended to 20+ sentences`);
});

test('open browser tabs are notified about new content (server-sent events)', async () => {
  const a = await admin();
  const ctrl = new AbortController();
  const res = await fetch(`${srv.base}/api/events`, { headers: { cookie: a.cookie }, signal: ctrl.signal });
  assert.equal(res.headers.get('content-type').split(';')[0], 'text/event-stream');
  const reader = res.body.getReader();
  const lesson = { lang: 'te', category: 'questions', level: 'A2', title: 'Tag questions with కదా', rule: 'కదా at the end of a sentence asks for agreement, like “isn’t it?”.',
    examples: [{ native: 'ఈరోజు వర్షం పడుతోంది కదా?', en: 'It is raining today, isn’t it?' }, { native: 'ఇది నీ పుస్తకం కదా?', en: 'This is your book, right?' }] };
  const id = (await a.post('/api/admin/grammar', lesson)).data.id;
  await a.post(`/api/admin/grammar/${id}/status`, { status: 'published' });
  let text = '';
  const deadline = Date.now() + 3000;
  while (!text.includes('event: content') && Date.now() < deadline) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); }
  ctrl.abort();
  assert.match(text, /event: content/); assert.match(text, /"type":"grammar"/);
});

// ------------------------------------------------------------------ learning notes
test('learning notes: create, edit, append, search, calendar, delete, isolation by language and user', async () => {
  const c = srv.client(); await registerUser(c);
  const n = (await c.post('/api/notes', { lang: 'ta', date: '2026-11-08', title: 'Dative', body: 'எனக்குத் தண்ணீர் வேண்டும் = I want water' })).data;
  assert.equal(n.date, '2026-11-08');
  assert.equal((await c.patch(`/api/notes/${n.id}`, { mode: 'append', body: 'Also: அவனுக்கு' })).data.body, 'எனக்குத் தண்ணீர் வேண்டும் = I want water\n\nAlso: அவனுக்கு');
  assert.equal((await c.patch(`/api/notes/${n.id}`, { body: 'Rewritten' })).data.body, 'Rewritten');
  assert.equal((await c.get('/api/notes/day?lang=ta&date=2026-11-08')).data.length, 1);
  assert.equal((await c.get('/api/notes/day?lang=ml&date=2026-11-08')).data.length, 0, 'a Tamil note never appears in Malayalam');
  assert.deepEqual((await c.get('/api/notes/month?lang=ta&ym=2026-11')).data.days, { '2026-11-08': 1 });
  assert.deepEqual((await c.get('/api/notes/year?lang=ta&y=2026')).data, { '2026-11': 1 });
  assert.equal((await c.get('/api/notes/search?lang=ta&q=Rewrit')).data.length, 1);
  assert.equal((await c.post('/api/notes', { lang: 'ta', date: '2026-02-30', body: 'x' })).status, 400, 'invalid dates rejected');
  const o = srv.client(); await registerUser(o);
  assert.equal((await o.get(`/api/notes/${n.id}`)).status, 404);
  assert.equal((await o.del(`/api/notes/${n.id}`)).status, 404);
  assert.equal((await c.del(`/api/notes/${n.id}`)).status, 200);
  assert.equal((await c.get('/api/notes/day?lang=ta&date=2026-11-08')).data.length, 0);
});
