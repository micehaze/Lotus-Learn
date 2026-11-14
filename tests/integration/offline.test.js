// Every feature must work with no local AI model (no Ollama). The dictionary service is a
// stand-in with the same API as local-dictionary/ so these tests run without downloaded data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerUser } from '../helpers.js';

// Script-valid stand-in words. Tests check the software path, not linguistic content.
const WORDS = { ta: ['பால்', 'தண்ணீர்', 'அரிசி', 'உப்பு', 'சர்க்கரை', 'தேநீர்', 'பழம்', 'காய்', 'மீன்', 'முட்டை', 'ரொட்டி', 'கறி', 'சமை', 'சாப்பிடு', 'குடி'] };
const ENGLISH = ['milk', 'water', 'rice', 'salt', 'sugar', 'tea', 'fruit', 'vegetable', 'fish', 'egg', 'bread', 'curry', 'cook', 'eat', 'drink'];
const calls = [];
const providers = {
  enabled: true, configured: () => true, anyTranslator: () => true, status: () => [], health: async () => ({ ok: true }),
  async lookupEnglish(gloss, lang) {
    calls.push(['lookupEnglish', gloss, lang]);
    const i = ENGLISH.indexOf(gloss);
    if (i < 0 || lang !== 'ta') return { candidates: [] };
    return { candidates: [{ native: WORDS.ta[i], english: gloss, basis: 'Wiktionary translation table', score: 80, pos: 'noun', sense: `a ${gloss}` }] };
  },
  async lookupNative(word, lang) {
    calls.push(['lookupNative', word, lang]);
    const i = WORDS.ta.indexOf(word);
    return { entries: i < 0 ? [] : [{ word, source: 'Wiktionary', senses: [{ gloss: ENGLISH[i] }] }] };
  },
  async equivalents({ targets }) { return { equivalents: Object.fromEntries(targets.map((l) => [l, l === 'hi' ? [{ native: 'दूध', basis: 'Wiktionary translation table' }] : []])) }; },
  async enrich() { return { lexicon: [], similar_words: [] }; },
  async suggest() { return []; },
  async translate() { throw new Error('no translator'); },
};

let srv, admin;
before(async () => {
  srv = await startTestServer({ deps: { providers } });
  admin = srv.client();
  const u = await registerUser(admin);
  srv.app.db.run("UPDATE users SET role = 'admin' WHERE email = ?", u.email);
});
after(() => srv.close());

test('the app reports that no AI model is configured', async () => {
  const meta = await admin.get('/api/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.data.features.ai, false);
});

test('practice stories are added offline, on demand and at most weekly from the scheduler', async () => {
  const before = srv.app.db.get("SELECT COUNT(*) n FROM stories WHERE lang = 'ta'").n;
  const r = await admin.post('/api/admin/jobs', { type: 'story' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'succeeded', r.data.error);
  assert.equal(r.data.result.offline, true);
  assert.ok(r.data.result.published > 0);
  assert.ok(srv.app.db.get("SELECT COUNT(*) n FROM stories WHERE lang = 'ta'").n > before);
  // A scheduled run in the same week adds nothing more.
  const sched = await admin.post('/api/admin/jobs', { type: 'story', payload: { offline: true, date: '2099-01-01' } });
  assert.equal(sched.data.result.published, 0);
});

test('new vocabulary lists come from the offline dictionary as pending entries for review', async () => {
  const r = await admin.post('/api/admin/jobs', { type: 'vocabulary', payload: { topic: 'food-and-cooking', count: 6 } });
  assert.equal(r.data.status, 'succeeded', r.data.error);
  assert.equal(r.data.result.offline, true);
  assert.ok(r.data.result.created > 0, JSON.stringify(r.data.result));
  const rows = srv.app.db.all("SELECT tamil, english, status, source, pronunciation FROM vocabulary WHERE origin = '' AND source = 'import' AND lang = 'ta' AND status = 'pending'");
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(WORDS.ta[ENGLISH.indexOf(row.english)], row.tamil, 'each word matches its dictionary sense');
    assert.ok(row.pronunciation, 'easy pronunciation is filled in');
  }
  assert.ok(srv.app.db.get("SELECT id FROM vocabulary_lists WHERE source = 'import' AND status = 'pending'"));
});

test('grammar generation explains that editors write lessons when there is no model', async () => {
  const r = await admin.post('/api/admin/jobs', { type: 'grammar' });
  assert.equal(r.data.status, 'failed');
  assert.match(r.data.error, /Admin → Grammar/);
});

test('admin word form fills meaning, Hindi and pronunciation from the offline dictionary', async () => {
  const r = await admin.post('/api/admin/ai/translate', { tamil: 'பால்' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.provider, 'offline-dictionary');
  assert.equal(r.data.suggestion.english, 'milk');
  assert.equal(r.data.suggestion.hindi, 'दूध');
  assert.equal(r.data.suggestion.pronunciation, 'paal');
});

test('dictionary suggestions work offline in both directions', async () => {
  const en = await admin.post('/api/dictionary/ai-suggest', { q: 'milk', lang: 'en' });
  assert.equal(en.status, 200, JSON.stringify(en.data));
  assert.equal(en.data.label, 'From the offline dictionary');
  assert.equal(en.data.items[0].native, 'பால்');
  const ta = await admin.post('/api/dictionary/ai-suggest', { q: 'பால்', lang: 'ta' });
  assert.equal(ta.data.items[0].english, 'milk');
});

test('"enrich" on a dictionary entry uses offline sources instead of failing', async () => {
  const v = srv.app.db.get("SELECT id FROM vocabulary WHERE lang = 'ta' AND status = 'published' LIMIT 1");
  const r = await admin.post(`/api/dictionary/entries/${v.id}/enrich`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.entry, 'returns the completed entry');
});

test('the scheduler plans offline work and never asks for Ollama', async () => {
  const plan = srv.app.services.content.planToday ? srv.app.services.content.planToday() : null;
  if (!plan) return; // planner not exported in this build
  assert.ok(plan.plan.some((p) => p.type === 'story'));
  assert.ok(plan.plan.some((p) => p.type === 'vocabulary'));
  assert.ok(!plan.skipped.some((s) => /AI provider not configured/.test(s.reason)));
});
