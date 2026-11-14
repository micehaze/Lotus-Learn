// Centralised content lifecycle for all four languages:
//   check last run → decide what is due (incl. missed days) → generate/discover → validate →
//   dedupe → hold for review (or auto-publish validated items if the admin enabled it) →
//   store → notify open browser tabs. Idempotency keys make every step safe to repeat.
import { hasTamil, validateTamil, transliterate, normalizeText } from '../../shared/tamil.js';
import { LANGUAGES, LANG_CODES, isLang, validateNative, transliterateAny, hasNative } from '../../shared/indic.js';
import { bad, notFound, parseJSON, j, seedFrom, HttpError, addDays } from '../util.js';
import { ServiceUnavailable } from '../integrations/index.js';
import { PARTS_OF_SPEECH, REGISTERS, normKey } from './vocabulary.js';
import { STORY_CATEGORIES, VIDEO_CATEGORIES } from './meta.js';
import { assessDifficulty, MIN_STORY_SENTENCES } from './library.js';
import { LIBRARY_TOPIC_WORDS } from './offlineTopicWords.js';
import { phonetic } from '../../shared/phonetic.js';

const sys = (lang) => `You are an expert ${LANGUAGES[lang].name} linguist and teacher writing learning material for English-speaking learners.
Use natural, correct modern ${LANGUAGES[lang].name} in Unicode ${LANGUAGES[lang].name} script. Mark register honestly ("spoken" for colloquial forms, "formal" for written/standard).
Never invent words, senses or examples. If you are unsure, leave the field out instead of guessing.`;
const VIDEO_QUERIES = {
  ta: ['learn Tamil conversation', 'Tamil language lesson beginners', 'spoken Tamil phrases', 'Tamil cooking recipe', 'Tamil short story for kids', 'Tamil podcast interview'],
  ml: ['learn Malayalam conversation', 'Malayalam language lesson beginners', 'spoken Malayalam phrases', 'Malayalam cooking recipe', 'Malayalam short story for kids', 'Malayalam podcast interview'],
  kn: ['learn Kannada conversation', 'Kannada language lesson beginners', 'spoken Kannada phrases', 'Kannada cooking recipe', 'Kannada short story for kids', 'Kannada podcast interview'],
  te: ['learn Telugu conversation', 'Telugu language lesson beginners', 'spoken Telugu phrases', 'Telugu cooking recipe', 'Telugu short story for kids', 'Telugu podcast interview'],
};
const TRANSIENT = new Set(['network_error', 'rate_limited', 'upstream_error', 'empty_response', 'bad_output']);
const MAX_ATTEMPTS = 3;
const JOB_TYPES = ['vocabulary', 'story', 'video_discovery', 'classify', 'grammar', 'daily_topic', 'enrich_entry'];

export function parseCSV(text) {
  const rows = []; let row = []; let field = ''; let q = false;
  const s = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((x) => x.trim()));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}
function rowToVocabInput(r) {
  const pairs = (v) => String(v || '').split(';').map((x) => x.trim()).filter(Boolean).map((x) => { const [ta, en = ''] = x.split('|'); return { ta: ta.trim(), en: en.trim() }; });
  if (Array.isArray(r.examples) || Array.isArray(r.collocations)) return r;
  return {
    tamil: r.native || r.tamil, transliteration: r.transliteration, pronunciation: r.pronunciation, english: r.english, alt_english: r.alt_english,
    hindi: r.hindi, malayalam: r.malayalam, part_of_speech: r.part_of_speech || r.pos, level: r.level, topic: r.topic, register: r.register || 'common',
    dialect: r.dialect, synonyms: r.synonyms, antonyms: r.antonyms, concept_key: r.concept_key || null,
    examples: r.example_ta || r.example ? [{ ta: r.example_ta || r.example, en: r.example_en }] : pairs(r.examples), collocations: pairs(r.collocations),
  };
}

export function createContentService({ db, clock, config, meta, vocabulary, library, grammar, dailyTopics, dictionary, ai, youtube, events, providers, logger = console }) {
  // Everything below works without a local model. When Ollama is configured it adds generated content on top.
  const dictionaryReady = () => !!(providers?.configured?.() && providers.lookupEnglish);
  const englishTerms = (t) => (String(t || '').toLowerCase().match(/[a-z]{3,}/g) || []);
  const senseMatches = (english, gloss) => { const have = new Set(englishTerms(english)); return englishTerms(gloss).every((w) => have.has(w) || have.has(`${w}s`) || have.has(w.replace(/s$/, ''))); };
  /** Best dictionary sense for an English word in `lang`, from sourced data only (Wiktionary, glossaries). */
  async function sourcedNative(gloss, lang, { exclude = new Set() } = {}) {
    let r;
    try { r = await providers.lookupEnglish(gloss, lang, { lexiconOnly: true, disambiguate: false, timeout: 4000 }); } catch { return null; }
    return (r?.candidates || []).find((c) => c && c.score >= 60 && typeof c.native === 'string' && typeof c.basis === 'string'
      && /(?:definition|translation table|glossary|datuk|alar|olam|wikidata)/i.test(c.basis) && senseMatches(c.english, gloss)
      && !validateNative(c.native, lang, { minRatio: 1 }).length && !exclude.has(c.native.normalize('NFC').trim())) || null;
  }
  const now = () => clock.now().toISOString();
  const today = () => clock.now().toISOString().slice(0, 10);
  let running = false;
  let lastTick = 0;

  // ------------------------------------------------------------------ jobs
  function enqueue(type, key, payload = {}, triggeredBy = 'scheduler', lang = 'ta') {
    db.run('INSERT OR IGNORE INTO content_jobs(job_type, lang, idempotency_key, status, payload, triggered_by, created_at) VALUES (?,?,?,?,?,?,?)', type, lang, key, 'queued', j(payload), triggeredBy, now());
    return db.get('SELECT * FROM content_jobs WHERE idempotency_key = ?', key);
  }
  function jobView(r) {
    return { id: r.id, type: r.job_type, lang: r.lang, key: r.idempotency_key, status: r.status, payload: parseJSON(r.payload, {}), result: parseJSON(r.result, null), error: r.error, errorCode: r.error_code, attempts: r.attempts, triggeredBy: r.triggered_by, createdAt: r.created_at, startedAt: r.started_at, completedAt: r.completed_at, nextRetryAt: r.next_retry_at };
  }
  function listJobs({ status, lang, limit = 150 } = {}) {
    const where = []; const args = [];
    if (status) { where.push('status = ?'); args.push(status); }
    if (lang) { where.push('lang = ?'); args.push(lang); }
    return db.all(`SELECT * FROM content_jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`, ...args, limit).map(jobView);
  }

  async function runJob(id) {
    const claimed = db.tx(() => {
      const r = db.get('SELECT * FROM content_jobs WHERE id = ?', id);
      if (!r) throw notFound('Job not found');
      if (r.status === 'running' || r.status === 'succeeded') return null; // another tab/scheduler already has it
      db.run("UPDATE content_jobs SET status = 'running', attempts = attempts + 1, started_at = ?, error = NULL, error_code = NULL, next_retry_at = NULL WHERE id = ? AND status IN ('queued','failed')", now(), id);
      return r;
    });
    if (!claimed) return jobView(db.get('SELECT * FROM content_jobs WHERE id = ?', id));
    try {
      const payload = parseJSON(claimed.payload, {});
      const handler = { vocabulary: genVocabulary, daily_topic: genVocabulary, story: genStory, video_discovery: discoverVideos, classify: classifyItem, grammar: genGrammar, enrich_entry: enrichEntry }[claimed.job_type];
      const result = await handler({ ...payload, lang: claimed.lang }, claimed);
      db.run("UPDATE content_jobs SET status = 'succeeded', result = ?, completed_at = ? WHERE id = ?", j(result), now(), id);
      if (result?.published) events?.publish('content', { lang: claimed.lang, type: claimed.job_type, published: result.published });
    } catch (e) {
      const code = e instanceof ServiceUnavailable ? e.code : e instanceof HttpError ? `http_${e.status}` : 'error';
      const attempts = claimed.attempts + 1;
      const retry = TRANSIENT.has(code) && attempts < MAX_ATTEMPTS;
      db.run('UPDATE content_jobs SET status = ?, error = ?, error_code = ?, completed_at = ?, next_retry_at = ? WHERE id = ?', retry ? 'queued' : 'failed', String(e.message).slice(0, 1000), code, now(),
        retry ? new Date(clock.now().getTime() + attempts * 15 * 60_000).toISOString() : null, id);
      if (!config.testMode) logger.warn(`[jobs] job ${id} (${claimed.lang}/${claimed.job_type}) ${retry ? 'will retry' : 'failed'}: ${e.message}`);
    }
    return jobView(db.get('SELECT * FROM content_jobs WHERE id = ?', id));
  }

  function retry(id) {
    const r = db.get('SELECT * FROM content_jobs WHERE id = ?', id);
    if (!r) throw notFound('Job not found');
    if (r.status !== 'failed' && !(r.status === 'queued' && r.error)) throw bad('Only failed jobs can be retried');
    db.run("UPDATE content_jobs SET status = 'queued', next_retry_at = NULL WHERE id = ?", id);
    return runJob(id);
  }

  async function trigger(type, payload = {}, by = 'admin', lang = 'ta') {
    if (!JOB_TYPES.includes(type)) throw bad('Unknown job type');
    if (!isLang(lang)) throw bad('Unknown language');
    const job = enqueue(type, `${type}:${lang}:manual:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, payload, by, lang);
    return runJob(job.id);
  }

  // ------------------------------------------------------------------ planning & scheduling
  const pickIn = (min, max, salt) => min + (seedFrom(salt) % (Math.max(0, max - min) + 1));
  function planFor(lang, date) {
    const s = meta.getSettings();
    const plan = []; const skipped = [];
    const add = (type, n, payloadFn) => { for (let i = 0; i < n; i++) plan.push({ type, lang, key: `${type}:${lang}:${date}:${i}`, payload: payloadFn(i) }); };
    if (ai.configured) {
      add('story', pickIn(s.daily_stories_min, s.daily_stories_max, `${date}:${lang}:stories`), (i) => ({ index: i, date }));
      add('grammar', pickIn(s.daily_grammar_min, s.daily_grammar_max, `${date}:${lang}:grammar`), (i) => ({ index: i, date }));
      add('vocabulary', s.daily_vocab_lists, () => ({ count: 12, date }));
    } else {
      add('story', 1, () => ({ offline: true, date }));
      if (dictionaryReady()) add('vocabulary', s.daily_vocab_lists, () => ({ count: 12, date, offline: true }));
      else skipped.push({ lang, type: 'vocabulary', reason: 'Offline dictionary not running (START-LOTUS.cmd starts it)' });
      skipped.push({ lang, type: 'grammar', reason: 'No local model: editors add grammar lessons in Admin → Grammar' });
    }
    if (youtube.configured) add('video_discovery', 1, () => ({ count: pickIn(s.daily_videos_min, s.daily_videos_max, `${date}:${lang}:videos`), date }));
    else skipped.push({ lang, type: 'video_discovery', reason: 'YOUTUBE_API_KEY not configured' });
    return { plan, skipped };
  }
  function planToday() {
    const date = today();
    const out = { date, plan: [], skipped: [] };
    for (const l of LANG_CODES) { const p = planFor(l, date); out.plan.push(...p.plan); out.skipped.push(...p.skipped); }
    return out;
  }
  /** Dates still to process for a language: missed days since the last run (max N) plus today. */
  function dueDates(lang) {
    const st = db.get("SELECT last_run_date FROM content_state WHERE lang = ? AND content_type = 'daily'", lang);
    const t = today();
    if (!st?.last_run_date) return [t];
    const days = []; const maxBack = meta.getSettings().catchup_days;
    for (let d = addDays(st.last_run_date, 1); d <= t && days.length < maxBack; d = addDays(d, 1)) days.push(d);
    if (!days.includes(t) && st.last_run_date !== t) days.push(t);
    return days.length ? days : [t];
  }
  function recordState(lang, type, fields) {
    db.run(`INSERT INTO content_state(lang, content_type, last_checked_at) VALUES (?,?,?) ON CONFLICT(lang, content_type) DO UPDATE SET last_checked_at = excluded.last_checked_at`, lang, type, now());
    const keys = Object.keys(fields);
    if (keys.length) db.run(`UPDATE content_state SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE lang = ? AND content_type = ?`, ...keys.map((k) => fields[k]), lang, type);
  }

  async function tick({ force = false } = {}) {
    const s = meta.getSettings();
    if (running || (!force && (!config.automationEnabled || !s.automation_enabled))) return { ran: 0, skipped: true };
    running = true; lastTick = Date.now();
    const report = { ran: 0, topics: [], dates: {} };
    try {
      for (const lang of LANG_CODES) {
        const dates = dueDates(lang);
        report.dates[lang] = dates;
        for (const date of dates) {
          for (const p of planFor(lang, date).plan) enqueue(p.type, p.key, p.payload, 'scheduler', lang);
        }
        recordState(lang, 'daily', { last_run_date: today() });
        const added = dailyTopics.topUpToday(lang);
        if (added) events?.publish('content', { lang, type: 'daily_topic', added });
      }
      const due = db.all("SELECT id FROM content_jobs WHERE status = 'queued' AND (next_retry_at IS NULL OR next_retry_at <= ?) ORDER BY id LIMIT 60", now());
      for (const q of due) { await runJob(q.id); report.ran++; }
      // record per-type production and shortfall for today
      for (const lang of LANG_CODES) for (const type of ['story', 'grammar', 'video_discovery']) {
        const rows = db.all('SELECT status, result FROM content_jobs WHERE lang = ? AND job_type = ? AND idempotency_key LIKE ?', lang, type, `${type}:${lang}:${today()}:%`);
        const target = rows.length || (type === 'story' ? s.daily_stories_min : type === 'grammar' ? s.daily_grammar_min : s.daily_videos_min);
        const produced = rows.filter((r) => r.status === 'succeeded').reduce((a, r) => a + (type === 'video_discovery' ? (parseJSON(r.result, {}).added || 0) : 1), 0);
        const note = !rows.length ? (type === 'video_discovery' ? (youtube.configured ? '' : 'YouTube discovery not configured') : (ai.configured ? '' : 'AI provider not configured')) : '';
        recordState(lang, type, { last_run_date: today(), produced_today: produced, target_today: target, shortfall: Math.max(0, target - produced), note, ...(produced ? { last_success_at: now() } : {}) });
      }
      return report;
    } finally { running = false; }
  }
  /** Called when a browser opens the app: safe, throttled catch-up (no duplicates thanks to job keys). */
  async function catchUp() {
    if (Date.now() - lastTick < 10 * 60_000 && lastTick) return { skipped: 'recently checked' };
    return tick({ force: config.automationEnabled && meta.getSettings().automation_enabled });
  }

  function automationStatus() {
    const { date, plan, skipped } = planToday();
    return {
      enabled: config.automationEnabled && meta.getSettings().automation_enabled,
      ai: { configured: ai.configured, provider: ai.provider, model: ai.model }, youtube: { configured: youtube.configured },
      today: date,
      plannedJobs: plan.map((p) => ({ type: p.type, lang: p.lang, key: p.key, status: db.get('SELECT status FROM content_jobs WHERE idempotency_key = ?', p.key)?.status || 'not yet queued' })),
      skipped,
      state: db.all('SELECT * FROM content_state ORDER BY lang, content_type'),
      counts: Object.fromEntries(db.all('SELECT status, COUNT(*) AS n FROM content_jobs GROUP BY status').map((r) => [r.status, r.n])),
    };
  }

  /** Version stamp the browser polls as a fallback to the live event stream. */
  function version(lang) {
    const one = (sql) => db.get(sql, lang);
    return {
      lang,
      stories: one("SELECT COUNT(*) AS n, MAX(id) AS m FROM stories WHERE lang = ? AND status = 'published'"),
      videos: one("SELECT COUNT(*) AS n, MAX(id) AS m FROM videos WHERE lang = ? AND status = 'published'"),
      grammar: one("SELECT COUNT(*) AS n, MAX(id) AS m FROM grammar_lessons WHERE lang = ? AND status = 'published'"),
      topics: one('SELECT COUNT(*) AS n, MAX(id) AS m, SUM(word_count) AS w FROM daily_topics WHERE lang = ?'),
      microtopics: one("SELECT COUNT(*) AS n,MAX(d.id) AS m FROM daily_topic_dates d JOIN daily_topic_language_sets s ON s.date_id=d.id WHERE s.language_code=? AND d.status='published'"),
      topicDate: dailyTopics.dateOf(),
      vocabulary: one("SELECT COUNT(*) AS n, MAX(id) AS m FROM vocabulary WHERE lang = ? AND status = 'published'"),
    };
  }

  const autoPublish = () => meta.getSettings().auto_publish_validated;
  const decide = (review) => (autoPublish() && review?.ok === true ? 'published' : 'pending');

  // ------------------------------------------------------------------ generators
  function leastCovered(lang) {
    const m = meta.snapshot();
    const counts = new Map(db.all("SELECT topic_id, level, COUNT(*) AS n FROM vocabulary WHERE lang = ? AND status != 'rejected' GROUP BY topic_id, level", lang).map((r) => [`${r.topic_id}:${r.level}`, r.n]));
    let best = null;
    for (const t of m.topics) for (const l of m.levelsList) {
      const score = (counts.get(`${t.id}:${l.code}`) || 0) + (seedFrom(`${lang}${t.slug}${l.code}${today()}`) % 100) / 1000;
      if (!best || score < best.score) best = { topic: t, level: l, score };
    }
    return best;
  }

  async function genVocabulary(payload, job) {
    const lang = payload.lang;
    const m = meta.snapshot();
    let target;
    if (payload.topic) {
      const topic = m.topicsBySlug.get(payload.topic) || m.topicsById.get(Number(payload.topic));
      target = { topic, level: m.levelsList.find((l) => l.code === payload.level) || null };
    } else target = leastCovered(lang);
    if (!target?.topic) throw bad('Unknown topic');
    const count = Math.min(20, Math.max(4, Number(payload.count) || 12));
    if (!ai.configured) return offlineVocabulary(lang, target, count, job);
    const existing = vocabulary.published(lang).filter((v) => v.topicId === target.topic.id).map((v) => v.tamil).slice(0, 120);
    const levelText = target.level ? `at CEFR-style level ${target.level.code} (${target.level.name})` : 'across beginner to advanced levels (label each with its level)';
    const items = await ai.completeJSON({
      system: sys(lang), maxTokens: 6000,
      prompt: `Create ${count} ${LANGUAGES[lang].name} vocabulary entries ${levelText} that are all clearly about the topic "${target.topic.name}".
Avoid these existing words: ${existing.join(', ') || '(none)'}.
Return a JSON array. Each item:
{"native": "word in ${LANGUAGES[lang].name} script", "pronunciation": "simple English-letter respelling", "english": "main meaning", "alt_english": ["other meanings"],
 "level": "A1".."C2", "hindi": "Devanagari or empty", "part_of_speech": one of ${JSON.stringify(PARTS_OF_SPEECH)}, "register": one of ${JSON.stringify(REGISTERS)},
 "synonyms": ["${LANGUAGES[lang].name}"], "antonyms": ["${LANGUAGES[lang].name}"],
 "collocations": [{"ta": "phrase with the exact target form wrapped like [[word]]", "en": "English meaning"}],
 "examples": [{"ta": "natural sentence with the exact target form wrapped like [[word]]", "en": "English translation"}]}
Give 2 collocations and 2 examples per word.`,
    });
    if (!Array.isArray(items)) throw new ServiceUnavailable('ai', 'AI did not return a list', 'bad_output');
    let review = [];
    try {
      review = await ai.completeJSON({ system: sys(lang), maxTokens: 3000, prompt: `Review these ${LANGUAGES[lang].name} learner entries for correctness. For each index return {"index": n, "ok": true|false, "issues": ["..."]}.
Check spelling, morphology, translation accuracy, natural examples, collocation naturalness and word order, register, and that each word really belongs to the topic "${target.topic.name}".
Entries: ${JSON.stringify(items.map((x, i) => ({ index: i, native: x.native ?? x.tamil, english: x.english, examples: x.examples, collocations: x.collocations })))}` });
    } catch { review = []; }
    const reviewBy = new Map((Array.isArray(review) ? review : []).map((r) => [Number(r.index), r]));
    const created = [], rejected = [], duplicates = [];
    let published = 0;
    for (const [i, raw] of items.entries()) {
      const input = { ...raw, tamil: raw.native ?? raw.tamil, level: target.level?.code || raw.level, topic_id: target.topic.id };
      const { value, problems } = vocabulary.validate(input, lang);
      const rv = reviewBy.get(i) || { ok: null, issues: ['AI review unavailable'] };
      if (problems.length) { rejected.push({ native: input.tamil, problems }); continue; }
      if (db.get('SELECT id FROM vocabulary WHERE norm_key = ?', normKey(value.tamil, value.english, lang))) { duplicates.push(value.tamil); continue; }
      try {
        const st = decide(rv);
        created.push(vocabulary.create(input, { lang, status: st, source: 'ai', reviewStatus: 'ai-unreviewed', extraValidation: { aiReview: rv, scriptCheck: 'passed', jobId: job.id } }));
        if (st === 'published') published++;
      } catch (e) { rejected.push({ native: input.tamil, problems: [e.message] }); }
    }
    if (created.length && job.job_type === 'vocabulary') {
      const r = db.run('INSERT OR IGNORE INTO vocabulary_lists(lang, title, description, level, topic_id, status, source, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        lang, `${target.topic.name}${target.level ? ` · ${target.level.code}` : ''}`, `AI-assisted list (job ${job.id}) awaiting review`, target.level?.code || null, target.topic.id, 'pending', 'ai', job.idempotency_key, now());
      const listId = Number(r.lastInsertRowid) || db.get('SELECT id FROM vocabulary_lists WHERE idempotency_key = ?', job.idempotency_key)?.id;
      created.forEach((vid, pos) => db.run('INSERT OR IGNORE INTO vocabulary_list_items(list_id, vocabulary_id, position) VALUES (?,?,?)', listId, vid, pos));
    }
    if (published) dailyTopics.topUpToday(lang);
    return { lang, topic: target.topic.name, level: target.level?.code || 'mixed', created: created.length, published, rejected, duplicates };
  }

  /** No model: add dictionary-sourced words to a thin topic as a pending list for an editor to approve. */
  async function offlineVocabulary(lang, target, count, job) {
    if (!dictionaryReady()) throw new ServiceUnavailable('local-dictionary', 'New word lists without a local model come from the offline dictionary. Start it with START-LOTUS.cmd (or npm start).', 'not_configured');
    const seeds = LIBRARY_TOPIC_WORDS[target.topic.name] || englishTerms(target.topic.name);
    const known = new Set(db.all("SELECT tamil FROM vocabulary WHERE lang = ? AND status != 'rejected'", lang).map((r) => r.tamil.normalize('NFC').trim()));
    const created = [], duplicates = [], rejected = [];
    for (const gloss of seeds) {
      if (created.length >= count) break;
      const c = await sourcedNative(gloss, lang, { exclude: known });
      if (!c) continue;
      const native = c.native.normalize('NFC').trim();
      const pos = PARTS_OF_SPEECH.includes(String(c.pos || '').toLowerCase()) ? String(c.pos).toLowerCase() : 'noun';
      const input = { tamil: native, english: gloss, pronunciation: phonetic(native), part_of_speech: pos, level: target.level?.code || 'A1', topic_id: target.topic.id, register: 'common', definition: String(c.sense || '').slice(0, 300) };
      if (db.get('SELECT id FROM vocabulary WHERE norm_key = ?', normKey(native, gloss, lang))) { duplicates.push(native); continue; }
      try { created.push(vocabulary.create(input, { lang, status: 'pending', source: 'import', reviewStatus: 'ai-unreviewed', extraValidation: { origin: 'offline-dictionary', basis: c.basis, jobId: job.id } })); known.add(native); }
      catch (e) { rejected.push({ native, problems: e.details?.problems || [e.message] }); }
    }
    if (created.length && job.job_type === 'vocabulary') {
      const r = db.run('INSERT OR IGNORE INTO vocabulary_lists(lang, title, description, level, topic_id, status, source, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        lang, `${target.topic.name}${target.level ? ` · ${target.level.code}` : ''}`, `Words from the offline dictionary (job ${job.id}) awaiting review`, target.level?.code || null, target.topic.id, 'pending', 'import', job.idempotency_key, now());
      const listId = Number(r.lastInsertRowid) || db.get('SELECT id FROM vocabulary_lists WHERE idempotency_key = ?', job.idempotency_key)?.id;
      created.forEach((vid, pos) => db.run('INSERT OR IGNORE INTO vocabulary_list_items(list_id, vocabulary_id, position) VALUES (?,?,?)', listId, vid, pos));
    }
    return { lang, topic: target.topic.name, level: target.level?.code || 'mixed', created: created.length, published: 0, rejected, duplicates, offline: true };
  }

  async function genStory(payload) {
    const lang = payload.lang;
    if (!ai.configured || payload.offline) {
      // No model: a fresh batch of the built-in parallel practice stories, at most once a week per language.
      const recent = db.get("SELECT id FROM stories WHERE lang = ? AND idempotency_key GLOB 'practice-story:*' AND created_at > ?", lang, addDays(today(), -6));
      if (recent && payload.date) return { lang, offline: true, published: 0, note: 'A practice story batch was added in the last 7 days.' }; // scheduler only; editors can add more any time
      const items = library.refreshStories(null, lang);
      return { lang, offline: true, published: items.length, ids: items.map((x) => x.id) };
    }
    const levels = meta.snapshot().levelsList.map((l) => l.code);
    const level = levels.includes(payload.level) ? payload.level : levels[seedFrom(`${lang}:${payload.date || today()}:${payload.index}`) % Math.min(4, levels.length)];
    const category = STORY_CATEGORIES.includes(payload.category) ? payload.category : STORY_CATEGORIES[seedFrom(`${lang}${payload.date || today()}c${payload.index}`) % 8];
    const guidance = { A1: 'very short simple sentences, present/past tense, everyday words', A2: 'short sentences, common verbs, simple connectors', B1: 'longer sentences, varied vocabulary, some subordinate clauses', B2: 'nuanced vocabulary, idioms, complex sentences', C1: 'literary expressions, sophisticated structure', C2: 'rich literary language' }[level] || '';
    const recent = db.all("SELECT title FROM stories WHERE lang = ? ORDER BY id DESC LIMIT 30", lang).map((r) => r.title);
    const story = await ai.completeJSON({ system: sys(lang), maxTokens: 6000, prompt: `Write an ORIGINAL ${category.replace(/-/g, ' ')} in ${LANGUAGES[lang].name} for learners at level ${level}: ${guidance}.
It must contain at least ${MIN_STORY_SENTENCES + 2} complete sentences in ${LANGUAGES[lang].name}, split into 6-10 paragraphs. Do not reproduce or adapt existing copyrighted text. Avoid these titles: ${recent.join(' | ') || 'none'}.
Return JSON: {"title": "title in ${LANGUAGES[lang].name}", "title_en": "English title", "summary": "one English sentence", "register": "formal"|"spoken",
"paragraphs": [{"ta": "${LANGUAGES[lang].name} paragraph", "en": "faithful English translation"}]}` });
    let review = null;
    try { review = await ai.completeJSON({ system: sys(lang), maxTokens: 1500, prompt: `Review this ${LANGUAGES[lang].name} learner story for grammatical correctness, natural language, translation accuracy and suitability for level ${level}. Return {"ok": true|false, "issues": ["..."], "suggested_level": "A1".."C2"}.\n${JSON.stringify(story.paragraphs || [])}` }); }
    catch { review = { ok: null, issues: ['AI review unavailable'] }; }
    const st = decide(review);
    const id = library.createStory({ ...story, lang, level, category, source_type: 'ai-generated', source_note: `Generated by ${ai.provider}/${ai.model}; ${st === 'published' ? 'automatically validated, not human-reviewed' : 'requires editorial approval'}`, license: 'Original (AI-assisted)' },
      { status: st, reviewStatus: 'ai-unreviewed', extraValidation: { aiReview: review } });
    return { lang, storyId: id, level, category, status: st, published: st === 'published' ? 1 : 0 };
  }

  async function genGrammar(payload) {
    const lang = payload.lang;
    const cats = grammar.leafCategories(lang);
    const have = grammar.titles(lang);
    const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
    const level = levels.includes(payload.level) ? payload.level : levels[seedFrom(`${lang}:${payload.date || today()}:g${payload.index}`) % levels.length];
    if (!ai.configured) throw new ServiceUnavailable('ai', 'Grammar lessons are written by editors when no local model is configured (Admin → Grammar → Add lesson).', 'not_configured');
    const lesson = await ai.completeJSON({ system: sys(lang), maxTokens: 4000, prompt: `Write ONE new ${LANGUAGES[lang].name} grammar lesson for level ${level} that is not already covered by these lessons: ${have.join(' | ') || 'none'}.
Choose a category slug from: ${cats.map((c) => `${c.slug} (${c.parent ? `${c.parent} › ` : ''}${c.name})`).join(', ')}.
Describe the real structure of ${LANGUAGES[lang].name}; do not force English categories (e.g. it has postpositions/case suffixes, no articles).
Return JSON: {"title": "", "category": "slug", "level": "${level}", "rule": "concise rule", "nuances": "subtleties and exceptions",
"variations": [{"name": "", "description": "", "examples": [{"native": "${LANGUAGES[lang].name} sentence", "en": "translation"}]}],
"examples": [{"native": "", "en": "", "note": ""}], "comparison": [["form", "meaning"]]}. Give 4-6 examples; every variation needs at least one example.` });
    let review = null;
    try { review = await ai.completeJSON({ system: sys(lang), maxTokens: 1200, prompt: `Check this ${LANGUAGES[lang].name} grammar lesson: is the rule correct, are all example sentences grammatical and natural, are translations faithful? Return {"ok": true|false, "issues": []}.\n${JSON.stringify(lesson)}` }); }
    catch { review = { ok: null, issues: ['AI review unavailable'] }; }
    const st = decide(review);
    const id = grammar.create({ ...lesson, lang, level: lesson.level || level }, { status: st, source: 'ai', reviewStatus: 'ai-unreviewed', extraValidation: { aiReview: review } });
    return { lang, lessonId: id, status: st, published: st === 'published' ? 1 : 0 };
  }

  async function discoverVideos(payload) {
    const lang = payload.lang;
    const want = Math.min(10, Math.max(1, Number(payload.count) || 3));
    const date = payload.date || today();
    const s = meta.getSettings();
    const added = [], skipped = [];
    const qs = VIDEO_QUERIES[lang];
    const name = LANGUAGES[lang].name;
    for (let qi = 0; qi < qs.length && added.length < want; qi++) {
      const query = qs[(seedFrom(`${lang}${date}`) + qi) % qs.length];
      const ids = await youtube.search(query, 10, lang);
      const fresh = ids.filter((id) => !db.get("SELECT id FROM videos WHERE platform = 'youtube' AND external_id = ?", id));
      skipped.push(...ids.filter((id) => !fresh.includes(id)).map((id) => ({ id, reason: 'duplicate' })));
      for (const d of await youtube.details(fresh)) {
        if (added.length >= want) break;
        const text = `${d.title} ${d.description}`;
        const signal = hasNative(text, lang) || new RegExp(name, 'i').test(text) || d.language?.startsWith(lang);
        if (!signal) { skipped.push({ id: d.externalId, reason: `no ${name}-language signal` }); continue; }
        if (d.durationSeconds && (d.durationSeconds < 45 || d.durationSeconds > 3 * 3600)) { skipped.push({ id: d.externalId, reason: 'duration out of range' }); continue; }
        const cls = await classifyVideo(d, lang);
        try {
          added.push(await library.addVideo({ externalId: d.externalId, title: d.title, channel: d.channel, description: d.description, durationSeconds: d.durationSeconds, publishedAt: d.publishedAt, ...cls.fields, validation: { classification: cls.how, query } },
            { status: s.auto_publish_videos ? 'published' : 'pending', source: 'discovery', lang }));
        } catch (e) { skipped.push({ id: d.externalId, reason: e.message }); }
      }
    }
    return { lang, added: added.length, ids: added, skipped: skipped.slice(0, 50), published: s.auto_publish_videos ? added.length : 0 };
  }
  function heuristicVideo(d) {
    const t = `${d.title} ${d.description}`.toLowerCase();
    const cat = [['cooking', /recipe|cook|சமையல்|പാചക|ಅಡುಗೆ|వంట/], ['travel', /travel|vlog|trip/], ['news', /news/], ['podcast', /podcast/], ['interview', /interview/],
      ['children', /kids|children|rhymes/], ['music', /song|music/], ['educational', /learn|lesson|class|grammar/], ['documentary', /documentary/]].find(([, re]) => re.test(t))?.[0] || 'cultural';
    const level = /beginner|basic|learn |for kids|rhymes/.test(t) ? 'A1' : /lesson|conversation/.test(t) ? 'A2' : 'B1';
    return { fields: { category: cat, level, register: /spoken|colloquial|conversation|vlog/.test(t) ? 'spoken' : 'formal' }, how: 'heuristic' };
  }
  async function classifyVideo(d, lang) {
    const base = heuristicVideo(d);
    if (!ai.configured) return base;
    try {
      const m = meta.snapshot();
      const r = await ai.completeJSON({ system: sys(lang), maxTokens: 400, prompt: `Classify this ${LANGUAGES[lang].name} video for a learner library. Return {"level": "A1".."C2", "category": one of ${JSON.stringify(VIDEO_CATEGORIES)}, "topic": one of ${JSON.stringify(m.topics.map((t) => t.slug))}, "register": "spoken"|"formal"|"mixed", "accent": "region or empty"}.\nTitle: ${d.title}\nChannel: ${d.channel}\nDescription: ${d.description.slice(0, 800)}` });
      const topic = m.topicsBySlug.get(r.topic);
      return { fields: { level: m.levels.has(r.level) ? r.level : base.fields.level, category: VIDEO_CATEGORIES.includes(r.category) ? r.category : base.fields.category, topic_id: topic?.id || null, register: ['spoken', 'formal', 'mixed'].includes(r.register) ? r.register : base.fields.register, accent: String(r.accent || '').slice(0, 60) }, how: 'ai' };
    } catch { return base; }
  }

  async function classifyItem(payload) {
    if (payload.kind === 'story') {
      const st = library.getStory(Number(payload.id), null, { any: true });
      const heur = assessDifficulty(st.paragraphs);
      let aiResult = null;
      if (ai.configured) aiResult = await ai.completeJSON({ system: sys(st.lang), maxTokens: 400, prompt: `Estimate the CEFR-style level (A1..C2) of this ${LANGUAGES[st.lang].name} text for learners. Return {"level": "..", "reason": ".."}.\n${st.paragraphs.map((p) => p.ta).join('\n')}` }).catch(() => null);
      db.run('UPDATE stories SET validation = ? WHERE id = ?', j({ ...st.validation, difficulty: heur, aiLevel: aiResult }), st.id);
      return { heuristic: heur, ai: aiResult };
    }
    throw bad('Unsupported classification target');
  }

  /** Dictionary enrichment for one entry; stored permanently so repeated searches never regenerate it. */
  async function enrichEntry(payload) {
    const v = vocabulary.get(Number(payload.vocabularyId), { any: true });
    if (!v) throw notFound('Entry not found');
    const L = LANGUAGES[v.lang].name;
    const others = ['ta', 'ml', 'kn', 'te', 'hi'].filter((x) => x !== v.lang);
    const data = await ai.completeJSON({ system: sys(v.lang), maxTokens: 8000, prompt: `Build a careful dictionary entry for the ${L} word "${v.tamil}" (${v.partOfSpeech}; main English meaning "${v.english}").
List each DISTINCT meaning as its own sense. Only include items you are confident are real, natural ${L}; fewer good items are better than padding.
For each sense: {"gloss": "", "definition": "detailed meaning", "part_of_speech": "", "register": "", "grammar_notes": "", "usage_notes": "",
"synonyms": [{"native": "", "english": "", "nuance": "", "difference": "how it differs from ${v.tamil}", "context": ""}] (true synonyms only, up to 15),
"near_synonyms": [...same shape], "related": [...same shape] (related but NOT synonyms),
"antonyms": [{"native": "", "english": "", "nuance": "", "context": "where the opposition applies"}], "contextual_opposites": [...], "contrasts": [...],
"collocations": {"adj_noun": [{"native": "", "english": "", "explanation": "", "structure": "label the real construction if it is not literally adjective+noun"}], "noun_verb": [...], "adv_verb": [...], "common": [...]} (up to 15 each, respecting ${L} word order),
"examples": [{"native": "sentence with the word wrapped as [[word-form]]", "english": "", "register": "spoken|formal", "note": ""}] (5-7, varied contexts),
"equivalents": [{"lang": one of ${JSON.stringify(others)}, "native": "", "english": "explains the matching sense"}]}
Also "homonyms": [{"kind": "homophone"|"homonym", "native": "", "meaning": "", "example": "", "example_en": ""}] ONLY if legitimate ones exist, else [].
Return {"senses": [...], "homonyms": [...]}.` });
    const report = dictionary.storeEnrichment(v.id, data, { validateFn: (t, l) => (l === 'hi' ? (/[\u0900-\u097F]/.test(t) ? [] : ['not Devanagari']) : validateNative(t, l)) });
    return { vocabularyId: v.id, ...report };
  }
  function requestEnrichment(vocabularyId, by = 'learner') {
    const v = vocabulary.get(Number(vocabularyId), { any: true });
    if (!v) throw notFound('Entry not found');
    if (!ai.configured) throw new ServiceUnavailable('ai', 'No local AI model is configured. Install Ollama and set OLLAMA_MODEL (see local-dictionary/README.md).');
    const job = enqueue('enrich_entry', `enrich_entry:${v.lang}:${v.id}`, { vocabularyId: v.id }, by, v.lang);
    return job.status === 'succeeded' ? jobView(job) : runJob(job.id);
  }

  // ------------------------------------------------------------------ import & assists
  function importVocabulary({ format, content, publish = false, lang = 'ta' }) {
    if (!isLang(lang)) throw bad('Unknown language');
    let rows;
    if (format === 'json') { try { rows = JSON.parse(content); } catch { throw bad('Invalid JSON'); } if (!Array.isArray(rows)) throw bad('JSON must be an array of entries'); }
    else if (format === 'csv') rows = parseCSV(content);
    else throw bad('Format must be csv or json');
    if (rows.length > 2000) throw bad('Import at most 2000 rows at a time');
    const report = { created: 0, duplicates: 0, errors: [] };
    rows.forEach((r, i) => {
      try { vocabulary.create(rowToVocabInput(r), { lang, status: publish ? 'published' : 'pending', source: 'import', reviewStatus: 'editor' }); report.created++; }
      catch (e) { if (e.details?.duplicate) report.duplicates++; else report.errors.push({ row: i + 2, problems: e.details?.problems || [e.message] }); }
    });
    if (report.created && publish) dailyTopics.topUpToday(lang);
    return report;
  }
  async function translateAssist({ tamil, native, english, lang = 'ta' }) {
    const word = native || tamil;
    if (!word || validateNative(word, lang).length) throw bad('Enter a valid word in the learning language first');
    if (!ai.configured) {
      // No model: fill what the offline dictionary actually records, plus the easy pronunciation spelling.
      const suggestion = { pronunciation: phonetic(word) };
      if (dictionaryReady() && providers.lookupNative) {
        try {
          const r = await providers.lookupNative(word, lang, { lexiconOnly: true, timeout: 4000 });
          const gloss = (r?.entries || []).flatMap((e) => (e.senses || []).map((x) => x.gloss)).find(Boolean);
          if (gloss) suggestion.english = String(gloss).slice(0, 200);
        } catch { /* dictionary unavailable: pronunciation only */ }
        const meaning = english || suggestion.english;
        if (meaning && providers.equivalents) {
          try {
            const q = await providers.equivalents({ word, lang, gloss: meaning, targets: ['hi', 'ml'].filter((x) => x !== lang) });
            const pick = (l) => (q?.equivalents?.[l] || []).find((x) => x?.native && !/IndicTrans2|Ollama/i.test(x.basis || ''))?.native;
            if (pick('hi')) suggestion.hindi = pick('hi');
            if (pick('ml')) suggestion.malayalam = pick('ml');
          } catch { /* keep what we have */ }
        }
      }
      return { unverified: false, provider: 'offline-dictionary', suggestion };
    }
    const r = await ai.completeJSON({ system: sys(lang), maxTokens: 1200, prompt: `For the ${LANGUAGES[lang].name} word "${word}"${english ? ` (English: ${english})` : ''} return {"english": "", "hindi": "Devanagari", "pronunciation": "", "part_of_speech": "", "register": "", "collocations": [{"ta": "with [[target]]", "en": ""}], "examples": [{"ta": "with [[target]]", "en": ""}], "synonyms": [], "antonyms": []}` });
    return { unverified: true, provider: ai.provider, suggestion: r };
  }
  async function dictionarySuggest(q, lang, dictLang = 'ta') {
    const query = String(q || '').trim().slice(0, 80);
    if (!query) throw bad('Enter a word to translate');
    const from = lang === 'hi' ? 'Hindi' : isLang(lang) ? LANGUAGES[lang].name : 'English';
    if (!ai.configured) {
      if (!dictionaryReady()) throw new ServiceUnavailable('local-dictionary', 'Start the offline dictionary (START-LOTUS.cmd) to look words up without a local model.', 'not_configured');
      let found = [];
      if (from === 'English') {
        const r = await providers.lookupEnglish(query, dictLang, { lexiconOnly: true, disambiguate: false, timeout: 4000 }).catch(() => null);
        found = (r?.candidates || []).filter((c) => c?.native && !validateNative(c.native, dictLang).length).slice(0, 3).map((c) => ({ native: c.native, english: c.english || query, note: c.basis || '' }));
      } else {
        const r = await providers.lookupNative(query, dictLang, { lexiconOnly: true, timeout: 4000 }).catch(() => null);
        found = (r?.entries || []).slice(0, 3).map((e) => ({ native: e.word || e.native || query, english: (e.senses || []).map((x) => x.gloss).filter(Boolean).slice(0, 2).join('; '), note: e.source || '' }));
      }
      const items = found.filter((x) => x.native && !validateNative(x.native, dictLang).length).map((x) => ({ tamil: String(x.native).normalize('NFC'), native: String(x.native).normalize('NFC'),
        transliteration: transliterateAny(x.native), english: String(x.english || query), register: '', note: String(x.note || '').slice(0, 200) }));
      return { unverified: false, label: 'From the offline dictionary', items };
    }
    const r = await ai.completeJSON({ system: sys(dictLang), maxTokens: 800, prompt: `Translate the ${from} word or phrase "${query}" into ${LANGUAGES[dictLang].name}. Return a JSON array (max 3) of {"native": "", "english": "", "register": "spoken|formal|common", "note": "usage note"}.` });
    const items = (Array.isArray(r) ? r : []).map((x) => ({ ...x, native: x.native || x.tamil })).filter((x) => x.native && !validateNative(x.native, dictLang).length).slice(0, 3)
      .map((x) => ({ tamil: String(x.native).normalize('NFC'), native: String(x.native).normalize('NFC'), transliteration: transliterateAny(x.native), english: String(x.english || query), register: x.register || '', note: String(x.note || '').slice(0, 200) }));
    return { unverified: true, label: 'AI suggestion — not a verified dictionary entry', items };
  }

  function reviewQueue(lang) {
    const lw = lang ? ' AND lang = ?' : '';
    const la = lang ? [lang] : [];
    return {
      vocabulary: db.all(`SELECT id FROM vocabulary WHERE status = 'pending'${lw} ORDER BY created_at DESC LIMIT 200`, ...la).map((r) => vocabulary.get(r.id, { any: true })),
      stories: library.listStories(null, { status: 'pending', lang }).items,
      videos: library.listVideos(null, { status: 'pending', lang }),
      grammar: grammar.list(lang || 'ta', { status: 'pending' }).items.concat(lang ? [] : LANG_CODES.filter((l) => l !== 'ta').flatMap((l) => grammar.list(l, { status: 'pending' }).items)),
      lists: db.all(`SELECT * FROM vocabulary_lists WHERE status = 'pending'${lw} ORDER BY created_at DESC`, ...la).map((l) => ({ id: l.id, lang: l.lang, title: l.title, level: l.level, createdAt: l.created_at })),
      enrichments: dictionary.pendingEnrichments().filter((e) => !lang || e.lang === lang),
    };
  }

  return { enqueue, listJobs, runJob, retry, trigger, tick, catchUp, planToday, planFor, automationStatus, version, importVocabulary, translateAssist, dictionarySuggest, reviewQueue, requestEnrichment };
}

export { normalizeText, hasTamil, validateTamil, transliterate };
