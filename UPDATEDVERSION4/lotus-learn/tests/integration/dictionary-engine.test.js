import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { startTestServer, registerUser, finishSession } from '../helpers.js';
import { createDictionaryProviders } from '../../server/integrations/dictionaryProviders.js';

// NO MOCKS: these tests start the real Python local-dictionary service (real HTTP, real SQLite lexicon, real query code)
// with a lexicon built from Kaikki/Wikidata-format fixtures. IndicTrans2 weights and Ollama are not available in the
// build sandbox, so machine translation reports itself unavailable — exercising the honest-failure path.
async function startLocalDictionary() {
  const proc = spawn('python3', ['local-dictionary/tests/fixture_server.py'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const [line] = await once(proc.stdout, 'data');
  const { port } = JSON.parse(String(line));
  return { url: `http://127.0.0.1:${port}`, stop: () => { proc.stdin.end(); proc.kill(); } };
}

let srv, dict, providers;
before(async () => {
  dict = await startLocalDictionary();
  providers = createDictionaryProviders({ LOCAL_DICT_URL: dict.url, LOCAL_DICT_TIMEOUT_MS: '20000' });
  srv = await startTestServer({ deps: { providers } });
});
after(async () => { await srv.close(); dict.stop(); });
const q = (c, dictLang, query, direction = 'auto') => c.get(`/api/dictionary/search?dict=${dictLang}&direction=${direction}&q=${encodeURIComponent(query)}`);

test('English → Tamil/Malayalam/Kannada/Telugu through the local lexicon; results are stored permanently', async () => {
  const c = srv.client(); await registerUser(c);
  const love = (await q(c, 'ta', 'love', 'from_en')).data;
  const natives = love.results.map((r) => r.native);
  assert.ok(natives.includes('அன்பு') && natives.includes('காதல்'), '"love" → Tamil gives both senses');
  assert.ok(love.results.some((r) => r.native === 'காதல்' && /romantic/.test(r.definition)), 'sense kept: காதல் = romantic love');
  assert.ok((await q(c, 'ml', 'discover', 'from_en')).data.results.some((r) => r.native === 'കണ്ടെത്തുക'), '"discover" → Malayalam');
  assert.equal((await q(c, 'kn', 'go', 'from_en')).data.results[0].native, 'ಹೋಗು', '"go" → Kannada');
  const beautiful = (await q(c, 'te', 'beautiful', 'from_en')).data;
  assert.ok(beautiful.results.some((r) => r.native === 'అందమైన'), '"beautiful" → Telugu');
  const row = srv.app.db.get("SELECT origin, status FROM vocabulary WHERE lang = 'te' AND tamil = 'అందమైన'");
  assert.deepEqual([row.origin, row.status], ['wiktionary', 'pending'], 'stored with its source, kept out of curated lists');
  const calls = providers.calls;
  assert.ok((await q(c, 'te', 'beautiful', 'from_en')).data.results.some((r) => r.native === 'అందమైన'));
  assert.equal(providers.calls, calls, 'repeat searches come from the database cache, not the service');
});

test('inflected words: morphology + local lexicon resolve கிராமத்தில் → கிராமம் (Dictionary and Reader)', async () => {
  const c = srv.client(); await registerUser(c);
  const r = (await q(c, 'ta', 'கிராமத்தில்', 'to_en')).data;
  const hit = r.results.find((x) => x.native === 'கிராமம்');
  assert.ok(hit, 'கிராமத்தில் → கிராமம்'); assert.match(hit.english, /village/);
  const look = (await c.get(`/api/dictionary/lookup?dict=ta&w=${encodeURIComponent('கிராமத்தில்,')}`)).data;
  assert.equal(look.entry.native, 'கிராமம்'); assert.equal(look.match, 'inflected');
  assert.match(look.analysis.gloss, /village/i, 'explains “in the village”');
  const entry = (await c.get(`/api/dictionary/entries/${look.entry.id}`)).data.senses[0];
  assert.ok(entry.examples.some((x) => x.kind === 'sentence' && x.english === 'This is a beautiful village.'), 'Wiktionary example stored as a sentence');
  assert.ok(entry.relations.synonyms.some((x) => x.native === 'ஊர்'), 'Wiktionary synonym stored on the sense');
  for (const [lang, w, lemma] of [['ta', 'வீட்டில்', 'வீடு'], ['ml', 'വീട്ടിൽ', 'വീട്'], ['kn', 'ಮನೆಯಲ್ಲಿ', 'ಮನೆ'], ['te', 'ఇంట్లో', 'ఇల్లు']]) {
    assert.equal((await c.get(`/api/dictionary/lookup?dict=${lang}&w=${encodeURIComponent(w)}`)).data.entry.native, lemma, `${lang}: ${w} → ${lemma}`);
  }
});

test('cross-language equivalents come from Wikidata sense links and the English pivot, as readable words', async () => {
  const c = srv.client(); await registerUser(c);
  const id = srv.app.db.get("SELECT id FROM vocabulary WHERE lang = 'ta' AND tamil = 'அன்பு'")?.id
    ?? (await q(c, 'ta', 'love', 'from_en')).data.results.find((r) => r.native === 'அன்பு').id;
  const done = (await c.post(`/api/dictionary/entries/${id}/complete`)).data;
  const eq = Object.fromEntries(done.entry.senses[0].equivalents.map((e) => [e.lang, e.native]));
  assert.equal(eq.kn, 'ಪ್ರೀತಿ'); assert.equal(eq.te, 'ప్రేమ'); assert.equal(eq.hi, 'प्यार');
  for (const e of done.entry.senses[0].equivalents) assert.equal(e.kind, 'equivalent');
});

test('unknown words with no local data and no translation model report “unavailable” — nothing is invented', async () => {
  const c = srv.client(); await registerUser(c);
  const r = (await q(c, 'te', 'zebra', 'from_en')).data;
  assert.equal(r.results.length, 0);
  const down = await startTestServer({ deps: { providers: createDictionaryProviders({ LOCAL_DICT_URL: 'http://127.0.0.1:9', LOCAL_DICT_TIMEOUT_MS: '2000' }) } });
  try {
    const d = down.client(); await registerUser(d);
    const x = (await q(d, 'ml', 'discover', 'from_en')).data;
    assert.equal(x.results.length, 0); assert.equal(x.status, 'unavailable');
    assert.equal((await q(d, 'ml', 'water', 'from_en')).data.results[0].native, 'വെള്ളം', 'local library still works while the service is down');
  } finally { await down.close(); }
});

test('no paid or cloud API is configured or reachable from the code', async () => {
  const fs = await import('node:fs');
  const code = ['server/integrations/index.js', 'server/integrations/dictionaryProviders.js', 'server/services/lookup.js', 'server/config.js'].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const host of ['api.anthropic.com', 'api.openai.com', 'translation.googleapis.com', 'googleapis.com/youtube', 'cognitive.microsofttranslator.com', 'libretranslate']) assert.ok(!code.includes(host), `${host} is not referenced`);
  const meta = (await srv.client().get('/api/meta')).data;
  assert.equal(meta.features.youtubeDiscovery, false);
});

test('public entries: sentences are sentences, equivalents are words, editorial diagnostics stay internal', async () => {
  const c = srv.client(); await registerUser(c);
  const id = srv.app.db.get("SELECT id FROM vocabulary WHERE lang = 'kn' AND tamil = 'ಹೋಗು'").id;
  const e = (await c.get(`/api/dictionary/entries/${id}`)).data;
  for (const s of e.senses) {
    assert.equal(s.diagnostics, undefined);
    for (const x of s.examples) { assert.equal(x.kind, 'sentence'); assert.ok(/[\u0C80-\u0CFF]/.test(x.native) && x.native.split(/\s+/).length >= 2, 'example is a sentence in Kannada'); assert.equal(x.vocabularyId, undefined); }
    for (const x of s.equivalents) { assert.equal(x.kind, 'equivalent'); assert.ok(x.native && x.lang !== 'kn'); }
  }
  assert.ok(e.senses[0].equivalents.some((x) => x.lang === 'ml' && x.native === 'പോകുക'));
  const lists = (await c.get('/api/vocabulary/lists?lang=ta')).data;
  assert.ok(lists.every((l) => l.wordCount >= 40), 'only lists with at least 40 words are published');
  const t = (await c.get('/api/daily-topic/today?lang=te&all=1')).data;
  assert.ok(!t?.words || t.words.length >= 60, 'a Daily Topic is never published with fewer than 60 words');
});

test('Learnt: 10 correct answers on 3 distinct days; 30 on one day is not enough; per language', async () => {
  const c = srv.client(); await registerUser(c);
  const col = (await c.post('/api/collections', { title: 'Learnt test' })).data.id;
  await c.post(`/api/collections/${col}/words`, { vocabularyIds: [srv.app.db.get("SELECT id FROM vocabulary WHERE lang='ta' AND tamil='மரம்'").id] });
  const DAY = 86400_000;
  const lesson = async () => { await c.post('/api/selection', { collectionId: col }); const sid = (await c.post('/api/sessions')).data.id; await finishSession(c, sid, srv.app); };
  for (let i = 0; i < 3; i++) await lesson(); // 30 correct answers on day 1
  assert.equal((await c.get('/api/learnt?lang=ta')).data.length, 0, '30 answers on one day = one qualifying day');
  await c.post('/api/__test/clock', { offsetMs: DAY }); await lesson();
  assert.equal((await c.get('/api/learnt?lang=ta')).data.length, 0, 'two days are not enough');
  await c.post('/api/__test/clock', { offsetMs: 2 * DAY }); await lesson();
  const learnt = (await c.get('/api/learnt?lang=ta')).data;
  assert.equal(learnt.length, 1); assert.equal(learnt[0].tamil, 'மரம்'); assert.equal(learnt[0].qualifyingDays.length, 3);
  assert.equal(learnt[0].collections[0].title, 'Learnt test', 'word stays in its original collection');
  assert.equal(learnt[0].mastery.lotus, 3, 'lotus progress preserved (one per day)');
  assert.equal((await c.get('/api/learnt?lang=ml')).data.length, 0, 'Learnt lists are separate per language');
  await c.post('/api/__test/clock', { offsetMs: 0 });
});
