import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerUser, libraryIds, makeClient } from '../helpers.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });
const makeAdmin = (email) => srv.app.db.run("UPDATE users SET role = 'admin' WHERE email = ?", email);
async function adminClient(s = srv) {
  const c = s.client(); const u = await registerUser(c); s.app.db.run("UPDATE users SET role = 'admin' WHERE email = ?", u.email); return c;
}

// ------------------------------------------------------------------ auth
test('registration, login, logout, validation and CSRF protection', async () => {
  const c = srv.client();
  const u = await registerUser(c);
  assert.equal((await c.get('/api/auth/me')).data.user.email, u.email);
  assert.equal((await srv.client().post('/api/auth/register', { email: u.email, password: 'another-pass-1' })).status, 409);
  assert.equal((await srv.client().post('/api/auth/register', { email: 'x@example.com', password: 'short' })).status, 400);
  assert.equal((await srv.client().post('/api/auth/register', { email: 'not-an-email', password: 'long-enough-1' })).status, 400);
  const other = srv.client();
  assert.equal((await other.post('/api/auth/login', { email: u.email, password: 'wrong-password' })).status, 401);
  assert.equal((await other.post('/api/auth/login', { email: u.email, password: u.password })).status, 200);
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/auth/me')).data.user, null);
  // state-changing request without our custom header is rejected (CSRF)
  const r = await fetch(`${srv.base}/api/collections`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: other.cookie }, body: '{"title":"x"}' });
  assert.equal(r.status, 403);
  const r2 = await fetch(`${srv.base}/api/collections`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: other.cookie, 'x-requested-with': 'lotus', origin: 'https://evil.example' }, body: '{"title":"x"}' });
  assert.equal(r2.status, 403);
  // session token is stored hashed, never in plain text
  const token = decodeURIComponent(other.cookie.split('=')[1]);
  assert.equal(srv.app.db.get('SELECT COUNT(*) AS n FROM auth_sessions WHERE id = ?', token).n, 0);
  const hash = srv.app.db.get('SELECT password_hash FROM users WHERE email = ?', u.email).password_hash;
  assert.match(hash, /^scrypt\$/);
});

test('password reset flow and password change', async () => {
  const c = srv.client();
  const u = await registerUser(c);
  const r = await srv.client().post('/api/auth/forgot', { email: u.email });
  assert.equal(r.status, 200);
  assert.equal((await srv.client().post('/api/auth/forgot', { email: 'nobody@example.com' })).status, 200, 'does not reveal unknown emails');
  const mail = (await c.get('/api/__test/outbox')).data.filter((m) => m.to === u.email).pop();
  const token = decodeURIComponent(mail.text.match(/token=([^\s]+)/)[1]);
  assert.equal((await srv.client().post('/api/auth/reset', { token, password: 'brand-new-pass-1' })).status, 200);
  assert.equal((await srv.client().post('/api/auth/reset', { token, password: 'again-new-pass-1' })).status, 400, 'tokens are single-use');
  assert.equal((await c.get('/api/auth/me')).data.user, null, 'reset signs out other sessions');
  const n = srv.client();
  assert.equal((await n.post('/api/auth/login', { email: u.email, password: 'brand-new-pass-1' })).status, 200);
  assert.equal((await n.post('/api/auth/change-password', { current: 'nope', next: 'x-new-pass-123' })).status, 400);
  assert.equal((await n.post('/api/auth/change-password', { current: 'brand-new-pass-1', next: 'x-new-pass-123' })).status, 200);
});

test('profile, avatar validation and account deletion cascade', async () => {
  const c = srv.client(); await registerUser(c);
  const p = await c.patch('/api/profile', { level: 'B1', preferredTopics: ['nature', 'not-a-topic'], timezone: 'Asia/Kolkata', motion: 'reduced' });
  assert.equal(p.data.level, 'B1'); assert.deepEqual(p.data.preferredTopics, ['nature']); assert.equal(p.data.motion, 'reduced');
  assert.equal((await c.patch('/api/profile', { timezone: 'Mars/Olympus' })).status, 400);
  assert.equal((await c.patch('/api/profile', { level: 'Z9' })).status, 400);
  assert.equal((await c.put('/api/profile/avatar', { dataUrl: 'data:text/html;base64,PGgxPg==' })).status, 400);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  assert.equal((await c.put('/api/profile/avatar', { dataUrl: png })).data.avatar, png);
  const col = await c.post('/api/collections', { title: 'Temp' });
  const uid = srv.app.db.get('SELECT user_id FROM collections WHERE id = ?', col.data.id).user_id;
  assert.equal((await c.post('/api/auth/delete-account', { password: 'wrong' })).status, 400);
  assert.equal((await c.post('/api/auth/delete-account', { password: 'correct-horse-9' })).status, 200);
  assert.equal(srv.app.db.get('SELECT COUNT(*) AS n FROM collections WHERE user_id = ?', uid).n, 0);
  assert.equal(srv.app.db.get('SELECT COUNT(*) AS n FROM user_profiles WHERE user_id = ?', uid).n, 0);
});

// ------------------------------------------------------------------ collections & selection
test('collections CRUD, manual words, validation, search and ownership', async () => {
  const c = srv.client(); await registerUser(c);
  assert.equal((await c.post('/api/collections', { title: '' })).status, 400);
  const id = (await c.post('/api/collections', { title: 'Kitchen', description: 'Food words', words: [{ tamil: 'அரிசி', english: 'rice' }] })).data.id;
  const w = await c.post(`/api/collections/${id}/words`, { tamil: 'பால்', english: 'milk', hindi: 'दूध', collocations: 'பால் குடி — drink milk', exampleTa: 'பூனை பால் குடிக்கிறது.', exampleEn: 'The cat drinks milk.' });
  assert.equal(w.status, 200);
  const bad = await c.post(`/api/collections/${id}/words`, { tamil: 'milk', english: 'milk' });
  assert.equal(bad.status, 400); assert.ok(bad.data.details.problems[0].includes('Tamil'));
  assert.equal((await c.post(`/api/collections/${id}/words`, { tamil: 'பால்', english: 'milk' })).status, 409, 'duplicate in same collection');
  const detail = (await c.get(`/api/collections/${id}`)).data;
  const milk = detail.words.find((x) => x.tamil === 'பால்');
  assert.equal(milk.transliteration, 'pāl');
  assert.equal(milk.collocations[0].ta, '[[பால்]] குடி', 'target is marked for exercises');
  assert.equal(milk.mastery.lotus, 0);
  assert.equal((await c.patch(`/api/collections/${id}/words/${milk.id}`, { english: 'cow milk' })).status, 200);
  assert.equal((await c.patch(`/api/collections/${id}`, { title: 'Kitchen words' })).status, 200);
  assert.equal((await c.get('/api/collections?q=cow')).data.matches[0].english, 'cow milk');
  assert.equal((await c.get(`/api/collections/${id}?q=rice`)).data.words.length, 1);
  // another user cannot touch it
  const o = srv.client(); await registerUser(o);
  for (const [m, p, b] of [['get', `/api/collections/${id}`], ['patch', `/api/collections/${id}`, { title: 'x' }], ['del', `/api/collections/${id}`], ['post', `/api/collections/${id}/words`, { tamil: 'பால்', english: 'm' }], ['get', `/api/collections/${id}/stats`], ['del', `/api/collections/${id}/words/${milk.id}`]]) {
    assert.equal((await o[m](p, b)).status, 404, `${m} ${p}`);
  }
  assert.equal((await o.post('/api/selection', { ids: [milk.id] })).status, 404);
  assert.equal((await c.del(`/api/collections/${id}/words/${milk.id}`)).status, 200);
  assert.equal((await c.del(`/api/collections/${id}`)).status, 200);
  assert.equal((await c.get(`/api/collections/${id}`)).status, 404);
});

test('collection word limit is configurable by the administrator', async () => {
  const admin = await adminClient();
  assert.equal((await admin.patch('/api/admin/settings', { collection_word_limit: 3 })).status, 200);
  const c = srv.client(); await registerUser(c);
  const id = (await c.post('/api/collections', { title: 'Small' })).data.id;
  assert.equal((await c.post(`/api/collections/${id}/words`, { vocabularyIds: await libraryIds(srv.app, ['பூ', 'மரம்']) })).data.added, 2);
  const tooMany = await c.post(`/api/collections/${id}/words`, { vocabularyIds: await libraryIds(srv.app, ['மழை', 'கடல்']) });
  assert.equal(tooMany.status, 409); assert.equal(tooMany.data.details.limit, 3);
  assert.equal((await c.get(`/api/collections/${id}`)).data.words.length, 2, 'nothing partially added');
  assert.equal((await c.post(`/api/collections/${id}/words`, { tamil: 'இலை', english: 'leaf' })).status, 200);
  assert.equal((await c.post(`/api/collections/${id}/words`, { tamil: 'வேர்', english: 'root' })).status, 409);
  await admin.patch('/api/admin/settings', { collection_word_limit: 1000 });
});

test('selection spans collections, prevents duplicates and enforces the 50-word maximum', async () => {
  const c = srv.client(); await registerUser(c);
  const a = (await c.post('/api/collections', { title: 'A' })).data.id;
  const b = (await c.post('/api/collections', { title: 'B' })).data.id;
  await c.post(`/api/collections/${a}/words`, { vocabularyIds: await libraryIds(srv.app, ['வீடு', 'அம்மா']) });
  await c.post(`/api/collections/${b}/words`, { vocabularyIds: await libraryIds(srv.app, ['வீடு', 'அப்பா']) });
  const wa = (await c.get(`/api/collections/${a}`)).data.words;
  await c.post('/api/selection', { ids: [wa[0].id] });
  const r = await c.post('/api/selection', { collectionId: b });
  assert.equal(r.data.count, 3); assert.equal(r.data.duplicates, wa[0].tamil === 'வீடு' ? 1 : 0);
  const sel = (await c.get('/api/selection')).data;
  assert.deepEqual(new Set(sel.items.map((x) => x.collectionTitle)), new Set(['A', 'B']));
  assert.equal(sel.expectedQuestions, sel.count * 10);
  assert.equal(new Set(sel.items.map((x) => x.wordKey)).size, sel.count, 'no duplicate vocabulary items');
  // 50 limit
  await c.post('/api/selection/clear');
  const big = (await c.post('/api/collections', { title: 'Everything' })).data.id;
  const all = srv.app.db.all("SELECT id FROM vocabulary WHERE status='published' AND lang = 'ta'").map((x) => x.id);
  assert.ok(all.length > 50);
  await c.post(`/api/collections/${big}/words`, { vocabularyIds: all });
  const over = await c.post('/api/selection', { collectionId: big });
  assert.equal(over.status, 409); assert.equal(over.data.details.remaining, 50);
  assert.equal((await c.get('/api/selection')).data.count, 0, 'previous selection untouched, nothing silently trimmed');
  const ids = (await c.get(`/api/collections/${big}`)).data.words.map((w) => w.id);
  assert.equal((await c.post('/api/selection', { ids: ids.slice(0, 48) })).data.count, 48);
  const over2 = await c.post('/api/selection', { ids: ids.slice(48, 51) });
  assert.equal(over2.status, 409); assert.equal(over2.data.details.remaining, 2);
  assert.equal((await c.post('/api/selection', { ids: ids.slice(48, 50) })).data.count, 50);
  assert.equal((await c.post('/api/selection/remove', { ids: [ids[0]] })).data.count, 49);
  assert.equal((await c.post('/api/sessions')).status, 200, 'a 49-word session can start');
  assert.equal((await c.post('/api/sessions')).status, 409);
});

// ------------------------------------------------------------------ dictionary & vocabulary
test('multilingual dictionary: exact, partial, fuzzy, transliteration, phrase, verb forms, reader lookup', async () => {
  const c = srv.client(); await registerUser(c);
  const top = async (q, lang) => (await c.get(`/api/dictionary/search?q=${encodeURIComponent(q)}${lang ? `&lang=${lang}` : ''}`)).data;
  let r = await top('water');
  assert.equal(r.results[0].tamil, 'தண்ணீர்'); assert.equal(r.results[0].match.type, 'exact English');
  r = await top('पानी'); assert.equal(r.lang, 'hi'); assert.equal(r.results[0].tamil, 'தண்ணீர்'); assert.equal(r.results[0].translation, 'पानी');
  r = await top('വെള്ളം'); assert.equal(r.lang, 'ml'); assert.equal(r.results[0].tamil, 'தண்ணீர்');
  r = await top('thanneer'); assert.equal(r.results[0].tamil, 'தண்ணீர்'); assert.match(r.results[0].match.type, /transliteration/);
  r = await top('frie'); assert.equal(r.results[0].tamil, 'நண்பன்'); assert.match(r.results[0].match.type, /partial/);
  r = await top('watr'); assert.equal(r.results[0].tamil, 'தண்ணீர்'); assert.match(r.results[0].match.type, /fuzzy/);
  r = await top('drink coffee'); assert.equal(r.results[0].tamil, 'குடி'); assert.equal(r.results[0].match.type, 'phrase');
  r = await top('குடித்தேன்'); assert.equal(r.results[0].tamil, 'குடி'); assert.equal(r.results[0].match.type, 'verb form');
  r = await top('happiness'); assert.ok(r.results.some((x) => x.tamil === 'மகிழ்ச்சி') && r.results.some((x) => x.tamil === 'சந்தோஷம்'), 'synonyms surface together');
  assert.equal((await top('zzqqxx')).results.length, 0);
  assert.equal((await c.get('/api/dictionary/lookup?ta=' + encodeURIComponent('வீட்டில்'))).data.entry.tamil, 'வீடு');
  assert.ok((await c.get('/api/dictionary/suggest?q=tre')).data.some((s) => s.tamil === 'மரம்'));
  const ai = await c.post('/api/dictionary/ai-suggest', { q: 'umbrella', lang: 'en' });
  assert.equal(ai.status, 503, 'AI unavailable is reported, not a crash'); assert.equal(ai.data.code, 'not_configured');
  // browsing + filters + daily recommendations exclude collected words
  const b = (await c.get('/api/vocabulary?level=A1&topic=family&pos=noun')).data;
  assert.ok(b.items.length > 0 && b.items.every((v) => v.level === 'A1' && v.partOfSpeech === 'noun' && v.topicSlug === 'family'));
  assert.ok((await c.get('/api/vocabulary?register=spoken')).data.items.every((v) => v.register === 'spoken'));
  const d1 = (await c.get('/api/vocabulary/daily')).data;
  const col = (await c.post('/api/collections', { title: 'D' })).data.id;
  await c.post(`/api/collections/${col}/words`, { vocabularyIds: d1.words.slice(0, 3).map((w) => w.id) });
  const d2 = (await c.get('/api/vocabulary/daily')).data;
  for (const w of d1.words.slice(0, 3)) assert.ok(!d2.words.some((x) => x.id === w.id));
  srv.app.services.meta.updateSettings({ list_min_words: 1 }); // seed lists are small; the 40-word public minimum is tested in dictionary-engine.test.js
  const lists = (await c.get('/api/vocabulary/lists')).data;
  assert.ok(lists.length >= 5);
  const lid = lists[0].id;
  const saved = await c.post(`/api/collections/${col}/words`, { listId: lid });
  assert.ok(saved.data.added + saved.data.skipped === (await c.get(`/api/vocabulary/lists/${lid}`)).data.words.length);
  srv.app.services.meta.updateSettings({ list_min_words: 40 });
});

// ------------------------------------------------------------------ reading & videos
test('reading library: progress, pending stories hidden, licensing and duplicate checks', async () => {
  const c = srv.client(); await registerUser(c);
  const list = (await c.get('/api/stories')).data;
  assert.equal(list.total, 3);
  const id = list.items[0].id;
  const s = (await c.get(`/api/stories/${id}`)).data;
  assert.ok(s.paragraphs.length >= 5 && s.paragraphs.every((p) => p.ta && p.en));
  assert.equal((await c.put(`/api/stories/${id}/progress`, { paragraph: 2, progress: 60 })).data.progress, 60);
  assert.equal((await c.put(`/api/stories/${id}/progress`, { paragraph: 1, progress: 20 })).data.progress, 60, 'progress never goes backwards');
  assert.equal((await c.get('/api/reading/history')).data[0].id, id);
  assert.equal((await c.get('/api/stories?level=B1')).data.items.every((x) => x.level === 'B1'), true);
  const admin = await adminClient();
  const sentences = Array.from({ length: 20 }, (_, i) => `ராமு ${i + 1} முறை பள்ளிக்குப் போனான்.`).join(' ');
  const story = { title: 'சிறிய கதை', title_en: 'A small story', level: 'A1', category: 'everyday', source_type: 'original', paragraphs: [{ ta: sentences, en: 'Ramu went to school (twenty times).' }] };
  assert.equal((await admin.post('/api/admin/stories', { ...story, title: 'குறுகிய கதை', paragraphs: [{ ta: 'ராமு பள்ளிக்குப் போனான்.', en: 'Ramu went to school.' }] })).status, 400, 'stories under 20 sentences are rejected');
  const created = await admin.post('/api/admin/stories', story);
  assert.equal(created.status, 200);
  assert.equal((await c.get(`/api/stories/${created.data.id}`)).status, 404, 'pending stories are not visible to learners');
  assert.equal((await admin.post('/api/admin/stories', story)).status, 409, 'duplicate text rejected');
  assert.equal((await admin.post('/api/admin/stories', { ...story, paragraphs: [{ ta: sentences.replace(/ராமு/g, 'சோமு') }], source_type: 'public-domain' })).status, 400, 'public domain needs licence + citation');
  assert.equal((await admin.post('/api/admin/stories', { ...story, paragraphs: [{ ta: 'English only text' }] })).status, 400);
  await admin.post(`/api/admin/stories/${created.data.id}/status`, { status: 'published' });
  assert.equal((await c.get(`/api/stories/${created.data.id}`)).status, 200);
});

test('video library: admin adds, review gate, favourites, watched, transcripts need a source', async () => {
  const admin = await adminClient();
  const c = srv.client(); await registerUser(c);
  const add = await admin.post('/api/admin/videos', { url: 'https://youtu.be/AbCdEfGhIjK', title: 'Tamil market conversation', level: 'A2', category: 'conversation' });
  assert.equal(add.status, 200);
  const id = add.data.id;
  assert.equal((await admin.post('/api/admin/videos', { url: 'https://www.youtube.com/watch?v=AbCdEfGhIjK', title: 'dup' })).status, 409);
  assert.equal((await admin.post('/api/admin/videos', { url: 'not a video' })).status, 400);
  assert.equal((await c.get(`/api/videos/${id}`)).status, 404);
  assert.equal((await admin.patch(`/api/admin/videos/${id}`, { transcript: [{ ta: 'வணக்கம்', en: 'Hello' }] })).status, 400);
  assert.equal((await admin.patch(`/api/admin/videos/${id}`, { transcript: [{ ta: 'வணக்கம்', en: 'Hello' }], transcript_source: 'Creator permission (email, 2026)' })).status, 200);
  await admin.post(`/api/admin/videos/${id}/status`, { status: 'published' });
  const v = (await c.get(`/api/videos/${id}`)).data;
  assert.equal(v.embedUrl, 'https://www.youtube-nocookie.com/embed/AbCdEfGhIjK');
  assert.equal(v.transcript[0].ta, 'வணக்கம்');
  assert.deepEqual((await c.put(`/api/videos/${id}/state`, { favorite: true })).data, { favorite: true, watched: false });
  assert.deepEqual((await c.put(`/api/videos/${id}/state`, { watched: true })).data, { favorite: true, watched: true });
  assert.equal((await c.get('/api/videos?favorite=true')).data.length, 1);
  assert.equal((await c.get('/api/videos?watched=false')).data.length, 0);
});

// ------------------------------------------------------------------ admin & automation
test('admin routes are enforced on the server', async () => {
  const c = srv.client(); await registerUser(c);
  for (const p of ['/api/admin/overview', '/api/admin/jobs', '/api/admin/review', '/api/admin/users', '/api/admin/settings']) assert.equal((await c.get(p)).status, 403, p);
  assert.equal((await c.post('/api/admin/vocabulary', { tamil: 'பூ', english: 'x' })).status, 403);
  assert.equal((await srv.client().get('/api/admin/overview')).status, 401);
  assert.equal((await srv.client().get('/api/collections')).status, 401);
});

test('admin vocabulary management, validation, duplicates and CSV import', async () => {
  const admin = await adminClient();
  const ok = await admin.post('/api/admin/vocabulary', { tamil: 'கண்', english: 'eye', part_of_speech: 'noun', level: 'A1', topic: 'body-parts', hindi: 'आँख', malayalam: 'കണ്ണ്', examples: [{ ta: 'என் கண் வலிக்கிறது.', en: 'My eye hurts.' }] });
  assert.equal(ok.status, 200);
  const v = (await admin.get(`/api/admin/vocabulary/${ok.data.id}`)).data;
  assert.equal(v.examples[0].ta, 'என் [[கண்]] வலிக்கிறது.');
  assert.equal(v.transliteration, 'kaṇ');
  assert.equal((await admin.post('/api/admin/vocabulary', { tamil: 'கண்', english: 'eye', part_of_speech: 'noun', level: 'A1' })).status, 409);
  const bad = await admin.post('/api/admin/vocabulary', { tamil: 'eye', english: '', part_of_speech: 'thing', level: 'Q9' });
  assert.equal(bad.status, 400); assert.ok(bad.data.details.problems.length >= 4);
  assert.equal((await admin.post(`/api/admin/vocabulary/${ok.data.id}/status`, { status: 'published', reviewStatus: 'native-reviewed' })).status, 200);
  const csv = 'tamil,english,part_of_speech,level,topic,example_ta,example_en,collocations,synonyms\nகை,hand,noun,A1,body-parts,என் கை சுத்தமாக இருக்கிறது.,My hand is clean.,கை கழுவு|wash hands,\nகண்,eye,noun,A1,body-parts,,,,\nhello,hi,noun,A1,,,,,\nகால்,leg,noun,A9,,,,,\n';
  const rep = (await admin.post('/api/admin/vocabulary/import', { format: 'csv', content: csv, publish: false })).data;
  assert.equal(rep.created, 1); assert.equal(rep.duplicates, 1); assert.equal(rep.errors.length, 2);
  assert.equal(rep.errors[0].row, 4);
  const pending = (await admin.get('/api/admin/review')).data.vocabulary;
  assert.ok(pending.some((x) => x.tamil === 'கை'));
  const json = JSON.stringify([{ tamil: 'மூக்கு', english: 'nose', part_of_speech: 'noun', level: 'A1' }]);
  assert.equal((await admin.post('/api/admin/vocabulary/import', { format: 'json', content: json, publish: true })).data.created, 1);
  assert.equal((await admin.patch('/api/admin/settings', { daily_videos_min: 5, daily_videos_max: 2 })).status, 400);
  const t = await admin.post('/api/admin/topics', { name: 'Festivals' });
  assert.equal(t.status, 200);
  assert.ok((await admin.get('/api/meta')).data.topics.some((x) => x.slug === 'festivals'));
  assert.equal((await admin.patch('/api/admin/levels/A1', { name: 'Absolute beginner' })).status, 200);
  await admin.patch('/api/admin/levels/A1', { name: 'Beginner' });
});

test('AI jobs fail gracefully without a provider and can be retried', async () => {
  const admin = await adminClient();
  const j = (await admin.post('/api/admin/jobs', { type: 'vocabulary' })).data;
  assert.equal(j.status, 'failed'); assert.equal(j.errorCode, 'not_configured');
  const again = (await admin.post(`/api/admin/jobs/${j.id}/retry`)).data;
  assert.equal(again.attempts, 2); assert.equal(again.status, 'failed');
  const status = (await admin.get('/api/admin/overview')).data.automation;
  assert.equal(status.ai.configured, false); assert.ok(status.skipped.length >= 2);
  assert.equal((await admin.get('/api/health')).status, 200, 'server keeps working');
});

// ------------------------------------------------------------------ automation with mocked providers
function mockAI({ fail = false } = {}) {
  let calls = 0;
  return {
    configured: true, provider: 'mock', model: 'mock-1',
    async completeJSON({ prompt }) {
      calls++;
      if (fail) { const { ServiceUnavailable } = await import('../../server/integrations/index.js'); throw new ServiceUnavailable('ai', 'AI provider unreachable: ECONNRESET', 'network_error'); }
      if (prompt.startsWith('Create')) return [
        { tamil: 'சூரியன்', english: 'sun', part_of_speech: 'noun', register: 'common', hindi: 'सूरज', malayalam: 'സൂര്യൻ', examples: [{ ta: '[[சூரியன்]] உதிக்கிறது.', en: 'The sun is rising.' }], collocations: [{ ta: 'காலைச் [[சூரியன்]]', en: 'morning sun' }] },
        { tamil: 'நிலா', english: 'moon', part_of_speech: 'noun', examples: [{ ta: '[[நிலா]] அழகாக இருக்கிறது.', en: 'The moon is beautiful.' }] },
        { tamil: 'moon', english: 'moon', part_of_speech: 'noun' },
        { tamil: 'தண்ணீர்', english: 'water', part_of_speech: 'noun' },
      ];
      if (prompt.startsWith('Review these')) return [{ index: 0, ok: true, issues: [] }, { index: 1, ok: false, issues: ['check register'] }];
      if (prompt.startsWith('Write an ORIGINAL')) return { title: 'நிலாவும் குழந்தையும்', title_en: 'The moon and the child', summary: 'A child talks to the moon.', register: 'formal',
        paragraphs: Array.from({ length: 11 }, (_, i) => ({ ta: `ஒரு குழந்தை ${i + 1} முறை நிலாவைப் பார்த்தது. நிலா சிரித்தது.`, en: `A child looked at the moon (${i + 1}). The moon smiled.` })) };
      if (prompt.startsWith('Review this Tamil learner story')) return { ok: true, issues: [], suggested_level: 'A1' };
      if (prompt.startsWith('Classify')) return { level: 'A2', category: 'cooking', topic: 'food-and-cooking', register: 'spoken', accent: 'Chennai' };
      return {};
    },
    get calls() { return calls; },
  };
}
function mockYouTube() {
  const items = {
    vid00000001: { title: 'தமிழ் சமையல்: easy sambar recipe', description: 'Tamil cooking', durationSeconds: 600 },
    vid00000002: { title: 'Learn Tamil: greetings', description: 'Spoken Tamil lesson', durationSeconds: 420 },
    vid00000003: { title: 'Random gaming stream', description: 'just games', durationSeconds: 3000 },
    vid00000004: { title: 'Tamil short', description: 'தமிழ்', durationSeconds: 20 },
  };
  return {
    configured: true,
    async search() { return Object.keys(items); },
    async details(ids) { return ids.map((id) => ({ externalId: id, channel: 'Channel', thumbnailUrl: '', publishedAt: '2026-01-01T00:00:00Z', language: '', ...items[id] })); },
    async oembed() { return null; },
  };
}

test('mocked AI: generated vocabulary & stories are validated, deduplicated and held for review', async () => {
  const s = await startTestServer({ deps: { ai: mockAI(), youtube: mockYouTube() } });
  try {
    const admin = await adminClient(s);
    const learner = s.client(); await registerUser(learner);
    const j = (await admin.post('/api/admin/jobs', { type: 'vocabulary', payload: { topic: 'nature', level: 'A1' } })).data;
    assert.equal(j.status, 'succeeded');
    assert.equal(j.result.created, 2); assert.equal(j.result.rejected.length, 1); assert.deepEqual(j.result.duplicates, ['தண்ணீர்']);
    assert.equal((await learner.get('/api/dictionary/search?q=moon')).data.results.length, 0, 'unapproved AI words are not public');
    const queue = (await admin.get('/api/admin/review')).data;
    const sun = queue.vocabulary.find((v) => v.tamil === 'சூரியன்');
    assert.equal(sun.source, 'ai'); assert.equal(sun.reviewStatus, 'ai-unreviewed'); assert.equal(sun.validation.aiReview.ok, true);
    assert.equal(queue.vocabulary.find((v) => v.tamil === 'நிலா').validation.aiReview.ok, false);
    assert.equal(queue.lists.length, 1);
    await admin.post(`/api/admin/vocabulary/${sun.id}/status`, { status: 'published' });
    assert.equal((await learner.get('/api/dictionary/search?q=sun')).data.results[0].tamil, 'சூரியன்');
    const st = (await admin.post('/api/admin/jobs', { type: 'story', payload: { level: 'A1', category: 'fairy-tale' } })).data;
    assert.equal(st.status, 'succeeded');
    const story = (await admin.get(`/api/admin/stories/${st.result.storyId}`)).data;
    assert.equal(story.sourceType, 'ai-generated'); assert.equal(story.status, 'pending'); assert.ok(story.validation.difficulty);
    assert.equal((await learner.get(`/api/stories/${story.id}`)).status, 404);
    // discovery: Tamil filter, duration filter, AI classification, review gate, dedupe
    const d = (await admin.post('/api/admin/jobs', { type: 'video_discovery', payload: { count: 4 } })).data;
    assert.equal(d.status, 'succeeded'); assert.equal(d.result.added, 2);
    const reasons = d.result.skipped.map((x) => x.reason).join('|');
    assert.match(reasons, /no Tamil-language signal/); assert.match(reasons, /duration out of range/);
    const pendingVideos = (await admin.get('/api/admin/videos?status=pending')).data;
    assert.equal(pendingVideos.length, 2); assert.equal(pendingVideos[0].category, 'cooking'); assert.equal(pendingVideos[0].validation.classification, 'ai');
    const d2 = (await admin.post('/api/admin/jobs', { type: 'video_discovery', payload: { count: 4 } })).data;
    assert.equal(d2.result.added, 0, 'already-known videos are never added twice');
    // scheduler idempotency: running twice on the same day never duplicates jobs
    await admin.post('/api/admin/jobs/run-scheduler');
    const mid = s.app.db.get('SELECT COUNT(*) AS n FROM content_jobs').n;
    await admin.post('/api/admin/jobs/run-scheduler');
    assert.equal(s.app.db.get('SELECT COUNT(*) AS n FROM content_jobs').n, mid, 'a second run (or a second tab) never duplicates jobs');
    const plan = s.app.services.content.planToday();
    for (const p of plan.plan) assert.ok(s.app.db.get('SELECT id FROM content_jobs WHERE idempotency_key = ?', p.key), `planned job ${p.key} was queued`);
    for (const lang of ['ta', 'ml', 'kn', 'te']) {
      const stories = plan.plan.filter((p) => p.type === 'story' && p.lang === lang).length;
      const gram = plan.plan.filter((p) => p.type === 'grammar' && p.lang === lang).length;
      assert.ok(stories >= 3 && stories <= 5, `${lang}: 3–5 stories planned per day`);
      assert.ok(gram >= 3 && gram <= 5, `${lang}: 3–5 grammar lessons planned per day`);
      assert.equal(plan.plan.filter((p) => p.type === 'video_discovery' && p.lang === lang).length, 1);
    }
    assert.ok(s.app.db.get('SELECT COUNT(*) AS n FROM stories WHERE status = \'published\' AND source_type = \'ai-generated\'').n === 0, 'automation never auto-publishes AI stories');
  } finally { await s.close(); }
});

test('mocked AI outage: jobs record the failure and the learning app keeps working', async () => {
  const s = await startTestServer({ deps: { ai: mockAI({ fail: true }) } });
  try {
    const admin = await adminClient(s);
    let j = (await admin.post('/api/admin/jobs', { type: 'story' })).data;
    assert.equal(j.status, 'queued', 'temporary failures are queued for retry'); assert.equal(j.errorCode, 'network_error'); assert.ok(j.nextRetryAt);
    j = (await admin.post(`/api/admin/jobs/${j.id}/retry`)).data;
    j = (await admin.post(`/api/admin/jobs/${j.id}/retry`)).data;
    assert.equal(j.status, 'failed', 'gives up after 3 attempts'); assert.equal(j.attempts, 3);
    const learner = s.client(); await registerUser(learner);
    const r = await learner.post('/api/dictionary/ai-suggest', { q: 'umbrella' });
    assert.equal(r.status, 503);
    assert.equal((await learner.get('/api/dictionary/search?q=water')).data.results[0].tamil, 'தண்ணீர்');
  } finally { await s.close(); }
});

test('login rate limiting', async () => {
  const s = await startTestServer({ seedData: false, overrides: { authRateLimit: 20 } });
  try {
    const c = makeClient(s.base);
    let last;
    for (let i = 0; i < 21; i++) last = await c.post('/api/auth/login', { email: 'a@b.cd', password: 'whatever-123' });
    assert.equal(last.status, 429);
  } finally { await s.close(); }
});
void makeAdmin;
