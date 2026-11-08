import { hasTamil, validateTamil, transliterate, normalizeText } from '../../shared/tamil.js';
import { bad, notFound, parseJSON, j, seedFrom, HttpError } from '../util.js';
import { ServiceUnavailable } from '../integrations/index.js';
import { PARTS_OF_SPEECH, REGISTERS, normKey } from './vocabulary.js';
import { STORY_CATEGORIES, VIDEO_CATEGORIES } from './meta.js';
import { assessDifficulty } from './library.js';

const SYSTEM = `You are an expert Tamil linguist and teacher writing learning material for English-speaking learners.
Use natural, correct modern Tamil in Unicode. Mark register honestly ("spoken" for colloquial forms, "formal" for written/standard).
Never invent words. If unsure about a translation, leave that field empty.`;

const VIDEO_QUERIES = ['learn Tamil conversation', 'Tamil language lesson beginners', 'spoken Tamil phrases', 'Tamil cooking recipe', 'Tamil travel vlog', 'Tamil short story for kids', 'Tamil podcast interview', 'Tamil street interview', 'Tamil culture documentary', 'Tamil news explained'];

// ------------------------------------------------------------------ CSV
export function parseCSV(text) {
  const rows = []; let row = []; let field = ''; let q = false;
  const s = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
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
  if (Array.isArray(r.examples) || Array.isArray(r.collocations)) return r; // JSON objects pass through
  return {
    tamil: r.tamil, transliteration: r.transliteration, pronunciation: r.pronunciation, english: r.english, alt_english: r.alt_english,
    hindi: r.hindi, malayalam: r.malayalam, part_of_speech: r.part_of_speech || r.pos, level: r.level, topic: r.topic, register: r.register || 'common',
    dialect: r.dialect, synonyms: r.synonyms, antonyms: r.antonyms,
    examples: r.example_ta ? [{ ta: r.example_ta, en: r.example_en }] : pairs(r.examples), collocations: pairs(r.collocations),
  };
}

export function createContentService({ db, clock, config, meta, vocabulary, library, ai, youtube, logger = console }) {
  const now = () => clock.now().toISOString();
  let running = false;

  // ------------------------------------------------------------------ jobs
  function enqueue(type, key, payload = {}, triggeredBy = 'scheduler') {
    db.run('INSERT OR IGNORE INTO content_jobs(job_type, idempotency_key, status, payload, triggered_by, created_at) VALUES (?,?,?,?,?,?)', type, key, 'queued', j(payload), triggeredBy, now());
    return db.get('SELECT * FROM content_jobs WHERE idempotency_key = ?', key);
  }
  function jobView(r) {
    return { id: r.id, type: r.job_type, key: r.idempotency_key, status: r.status, payload: parseJSON(r.payload, {}), result: parseJSON(r.result, null), error: r.error, errorCode: r.error_code, attempts: r.attempts, triggeredBy: r.triggered_by, createdAt: r.created_at, startedAt: r.started_at, completedAt: r.completed_at };
  }
  function listJobs({ status, limit = 100 } = {}) {
    return (status ? db.all('SELECT * FROM content_jobs WHERE status = ? ORDER BY id DESC LIMIT ?', status, limit) : db.all('SELECT * FROM content_jobs ORDER BY id DESC LIMIT ?', limit)).map(jobView);
  }

  async function runJob(id) {
    const claimed = db.tx(() => {
      const r = db.get('SELECT * FROM content_jobs WHERE id = ?', id);
      if (!r) throw notFound('Job not found');
      if (r.status === 'running' || r.status === 'succeeded') return null;
      db.run("UPDATE content_jobs SET status = 'running', attempts = attempts + 1, started_at = ?, error = NULL, error_code = NULL WHERE id = ?", now(), id);
      return r;
    });
    if (!claimed) return jobView(db.get('SELECT * FROM content_jobs WHERE id = ?', id));
    try {
      const payload = parseJSON(claimed.payload, {});
      const handler = { vocabulary: genVocabulary, story: genStory, video_discovery: discoverVideos, classify: classifyItem }[claimed.job_type];
      const result = await handler(payload, claimed);
      db.run("UPDATE content_jobs SET status = 'succeeded', result = ?, completed_at = ? WHERE id = ?", j(result), now(), id);
    } catch (e) {
      const code = e instanceof ServiceUnavailable ? e.code : e instanceof HttpError ? `http_${e.status}` : 'error';
      db.run("UPDATE content_jobs SET status = 'failed', error = ?, error_code = ?, completed_at = ? WHERE id = ?", String(e.message).slice(0, 1000), code, now(), id);
      if (!config.testMode) logger.warn(`[jobs] job ${id} (${claimed.job_type}) failed: ${e.message}`);
    }
    return jobView(db.get('SELECT * FROM content_jobs WHERE id = ?', id));
  }

  function retry(id) {
    const r = db.get('SELECT * FROM content_jobs WHERE id = ?', id);
    if (!r) throw notFound('Job not found');
    if (r.status !== 'failed') throw bad('Only failed jobs can be retried');
    db.run("UPDATE content_jobs SET status = 'queued' WHERE id = ?", id);
    return runJob(id);
  }

  async function trigger(type, payload = {}, by = 'admin') {
    if (!['vocabulary', 'story', 'video_discovery', 'classify'].includes(type)) throw bad('Unknown job type');
    const job = enqueue(type, `${type}:manual:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, payload, by);
    return runJob(job.id);
  }

  /** Daily targets -> idempotent job keys. Re-running on the same day never duplicates work. */
  function planToday() {
    const s = meta.getSettings();
    const date = clock.now().toISOString().slice(0, 10);
    const pickIn = (min, max, salt) => min + (seedFrom(`${date}:${salt}`) % (max - min + 1));
    const plan = [];
    const skipped = [];
    const add = (type, n, payloadFn) => { for (let i = 0; i < n; i++) plan.push({ type, key: `${type}:${date}:${i}`, payload: payloadFn(i) }); };
    if (ai.configured) {
      add('vocabulary', s.daily_vocab_lists, () => ({ count: 12 }));
      add('story', pickIn(s.daily_stories_min, s.daily_stories_max, 'stories'), (i) => ({ index: i }));
    } else skipped.push({ type: 'vocabulary/story', reason: 'AI provider not configured' });
    if (youtube.configured) add('video_discovery', 1, () => ({ count: pickIn(s.daily_videos_min, s.daily_videos_max, 'videos') }));
    else skipped.push({ type: 'video_discovery', reason: 'YOUTUBE_API_KEY not configured' });
    return { date, plan, skipped };
  }

  /** Background runs respect the on/off switches; an admin's manual run (force) always executes. */
  async function tick({ force = false } = {}) {
    const s = meta.getSettings();
    if (running || (!force && (!config.automationEnabled || !s.automation_enabled))) return { ran: 0, skipped: true };
    running = true;
    try {
      const { plan } = planToday();
      for (const p of plan) enqueue(p.type, p.key, p.payload);
      const queued = db.all("SELECT id FROM content_jobs WHERE status = 'queued' ORDER BY id LIMIT 20");
      for (const q of queued) await runJob(q.id);
      return { ran: queued.length };
    } finally { running = false; }
  }

  function automationStatus() {
    const { date, plan, skipped } = planToday();
    return {
      enabled: config.automationEnabled && meta.getSettings().automation_enabled,
      ai: { configured: ai.configured, provider: ai.provider, model: ai.model },
      youtube: { configured: youtube.configured },
      today: date, plannedJobs: plan.map((p) => ({ type: p.type, key: p.key, status: db.get('SELECT status FROM content_jobs WHERE idempotency_key = ?', p.key)?.status || 'not yet queued' })),
      skipped,
      counts: Object.fromEntries(db.all('SELECT status, COUNT(*) AS n FROM content_jobs GROUP BY status').map((r) => [r.status, r.n])),
    };
  }

  // ------------------------------------------------------------------ generators
  function leastCovered() {
    const m = meta.snapshot();
    const counts = new Map(db.all("SELECT topic_id, level, COUNT(*) AS n FROM vocabulary WHERE status != 'rejected' GROUP BY topic_id, level").map((r) => [`${r.topic_id}:${r.level}`, r.n]));
    let best = null;
    for (const t of m.topics) for (const l of m.levelsList) {
      const n = counts.get(`${t.id}:${l.code}`) || 0;
      const score = n + (seedFrom(`${t.slug}${l.code}${clock.now().toISOString().slice(0, 10)}`) % 100) / 1000;
      if (!best || score < best.score) best = { topic: t, level: l, score };
    }
    return best;
  }

  async function genVocabulary(payload, job) {
    const m = meta.snapshot();
    const target = payload.topic && payload.level
      ? { topic: m.topicsBySlug.get(payload.topic) || m.topicsById.get(Number(payload.topic)), level: m.levelsList.find((l) => l.code === payload.level) }
      : leastCovered();
    if (!target?.topic || !target?.level) throw bad('Unknown topic or level');
    const count = Math.min(20, Math.max(5, Number(payload.count) || 12));
    const existing = vocabulary.published().filter((v) => v.topicId === target.topic.id).map((v) => v.tamil).slice(0, 80);
    const items = await ai.completeJSON({
      system: SYSTEM,
      maxTokens: 6000,
      prompt: `Create ${count} Tamil vocabulary entries for learners at CEFR level ${target.level.code} (${target.level.name}) on the topic "${target.topic.name}".
Avoid these existing words: ${existing.join(', ') || '(none)'}.
Return a JSON array. Each item:
{"tamil": "...", "pronunciation": "simple English-letter respelling", "english": "main meaning", "alt_english": ["other meanings"],
 "hindi": "Devanagari or empty", "malayalam": "Malayalam script or empty", "part_of_speech": one of ${JSON.stringify(PARTS_OF_SPEECH)},
 "register": one of ${JSON.stringify(REGISTERS)}, "dialect": "", "synonyms": ["Tamil"], "antonyms": ["Tamil"],
 "collocations": [{"ta": "Tamil phrase with the exact target form wrapped like [[word]]", "en": "English meaning"}],
 "examples": [{"ta": "Natural Tamil sentence with the exact target form wrapped like [[word]]", "en": "English translation"}],
 "forms": {"present1s": "", "past1s": "", "future1s": "", "inf": ""} (verbs only)}
Give 2 collocations and 2 examples per word. For verbs, when the wrapped form is inflected also add "form": "present1s" | "past1s" | "future1s" | "inf" to that collocation/example.`,
    });
    if (!Array.isArray(items)) throw new ServiceUnavailable('ai', 'AI did not return a list', 'bad_output');
    // second pass: independent quality review of the batch
    let review = [];
    try {
      review = await ai.completeJSON({
        system: SYSTEM,
        maxTokens: 3000,
        prompt: `Review these Tamil learner entries for correctness. For each index return {"index": n, "ok": true|false, "issues": ["..."]}.
Check: Tamil spelling, translation accuracy, natural example sentences, correct register, level appropriateness (${target.level.code}).
Entries: ${JSON.stringify(items.map((x, i) => ({ index: i, tamil: x.tamil, english: x.english, examples: x.examples, collocations: x.collocations })))}`,
      });
    } catch (e) { review = []; }
    const reviewBy = new Map((Array.isArray(review) ? review : []).map((r) => [Number(r.index), r]));
    const created = [], rejected = [], duplicates = [];
    for (const [i, raw] of items.entries()) {
      const input = { ...raw, level: target.level.code, topic_id: target.topic.id };
      const { value, problems, warnings } = vocabulary.validate(input);
      const rv = reviewBy.get(i) || { ok: null, issues: ['AI review unavailable'] };
      if (problems.length) { rejected.push({ tamil: raw.tamil, problems }); continue; }
      if (db.get('SELECT id FROM vocabulary WHERE norm_key = ?', normKey(value.tamil, value.english))) { duplicates.push(value.tamil); continue; }
      try {
        const id = vocabulary.create(input, { status: 'pending', source: 'ai', reviewStatus: 'ai-unreviewed', extraValidation: { aiReview: rv, scriptCheck: 'passed', jobId: job.id } });
        created.push(id);
      } catch (e) { rejected.push({ tamil: raw.tamil, problems: [e.message] }); }
      void warnings;
    }
    if (created.length) {
      const r = db.run('INSERT OR IGNORE INTO vocabulary_lists(title, description, level, topic_id, status, source, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?)',
        `${target.topic.name} · ${target.level.code}`, `AI-assisted list (job ${job.id}) awaiting review`, target.level.code, target.topic.id, 'pending', 'ai', job.idempotency_key, now());
      const listId = Number(r.lastInsertRowid) || db.get('SELECT id FROM vocabulary_lists WHERE idempotency_key = ?', job.idempotency_key)?.id;
      created.forEach((vid, pos) => db.run('INSERT OR IGNORE INTO vocabulary_list_items(list_id, vocabulary_id, position) VALUES (?,?,?)', listId, vid, pos));
    }
    return { topic: target.topic.name, level: target.level.code, created: created.length, rejected, duplicates };
  }

  async function genStory(payload) {
    const m = meta.snapshot();
    const levels = m.levelsList.map((l) => l.code);
    const level = levels.includes(payload.level) ? payload.level : levels[seedFrom(`${clock.now().toISOString()}:${payload.index}`) % Math.min(4, levels.length)];
    const category = STORY_CATEGORIES.includes(payload.category) ? payload.category : STORY_CATEGORIES[seedFrom(`${clock.now().toISOString().slice(0, 10)}c${payload.index}`) % 8];
    const guidance = { A1: 'very short simple sentences (4-6 words), present/past tense, everyday words', A2: 'short sentences, common verbs, simple connectors', B1: 'longer sentences, varied vocabulary, some subordinate clauses', B2: 'nuanced vocabulary, idioms, complex sentences', C1: 'literary expressions, sophisticated structure', C2: 'rich literary Tamil' }[level] || '';
    const story = await ai.completeJSON({
      system: SYSTEM,
      maxTokens: 4000,
      prompt: `Write an ORIGINAL ${category.replace('-', ' ')} in Tamil for learners at level ${level}: ${guidance}.
5-8 short paragraphs. Do not reproduce or adapt any existing copyrighted text.
Return JSON: {"title": "Tamil title", "title_en": "English title", "summary": "one English sentence", "register": "formal"|"spoken",
"paragraphs": [{"ta": "Tamil paragraph", "en": "faithful English translation"}]}`,
    });
    let review = null;
    try {
      review = await ai.completeJSON({ system: SYSTEM, maxTokens: 1500, prompt: `Review this Tamil learner story for grammatical correctness, natural Tamil, translation accuracy and suitability for level ${level}. Return {"ok": true|false, "issues": ["..."], "suggested_level": "A1".."C2"}.\n${JSON.stringify(story.paragraphs || [])}` });
    } catch { review = { ok: null, issues: ['AI review unavailable'] }; }
    const id = library.createStory({ ...story, level, category, source_type: 'ai-generated', source_note: `Generated by ${ai.provider}/${ai.model}; requires editorial approval`, license: 'Original (AI-assisted)' },
      { status: 'pending', reviewStatus: 'ai-unreviewed', extraValidation: { aiReview: review } });
    return { storyId: id, level, category };
  }

  async function discoverVideos(payload) {
    const want = Math.min(10, Math.max(1, Number(payload.count) || 3));
    const date = clock.now().toISOString().slice(0, 10);
    const s = meta.getSettings();
    const added = [], skipped = [];
    for (let qi = 0; qi < VIDEO_QUERIES.length && added.length < want; qi++) {
      const query = VIDEO_QUERIES[(seedFrom(date) + qi) % VIDEO_QUERIES.length];
      const ids = await youtube.search(query, 10);
      const fresh = ids.filter((id) => !db.get("SELECT id FROM videos WHERE platform = 'youtube' AND external_id = ?", id));
      skipped.push(...ids.filter((id) => !fresh.includes(id)).map((id) => ({ id, reason: 'duplicate' })));
      const details = await youtube.details(fresh);
      for (const d of details) {
        if (added.length >= want) break;
        const tamilSignal = hasTamil(d.title) || hasTamil(d.description) || /tamil|தமிழ்/i.test(`${d.title} ${d.description}`) || /^ta/.test(d.language);
        if (!tamilSignal) { skipped.push({ id: d.externalId, reason: 'no Tamil-language signal' }); continue; }
        if (d.durationSeconds && (d.durationSeconds < 45 || d.durationSeconds > 3 * 3600)) { skipped.push({ id: d.externalId, reason: 'duration out of range' }); continue; }
        const cls = await classifyVideo(d);
        try {
          const id = await library.addVideo({ externalId: d.externalId, title: d.title, channel: d.channel, description: d.description, durationSeconds: d.durationSeconds, publishedAt: d.publishedAt, ...cls.fields, validation: { classification: cls.how, query } },
            { status: s.auto_publish_videos ? 'published' : 'pending', source: 'discovery' });
          added.push(id);
        } catch (e) { skipped.push({ id: d.externalId, reason: e.message }); }
      }
    }
    return { added: added.length, ids: added, skipped: skipped.slice(0, 50) };
  }

  function heuristicVideo(d) {
    const t = `${d.title} ${d.description}`.toLowerCase();
    const cat = [['cooking', /recipe|cook|சமையல்/], ['travel', /travel|vlog|trip|பயண/], ['news', /news|செய்தி/], ['podcast', /podcast/], ['interview', /interview|பேட்டி/],
      ['children', /kids|children|rhymes|குழந்தை/], ['music', /song|music|பாடல்/], ['educational', /learn|lesson|class|grammar|கற்/], ['documentary', /documentary/]].find(([, re]) => re.test(t))?.[0] || 'cultural';
    const level = /beginner|basic|learn tamil|for kids|rhymes/.test(t) ? 'A1' : /lesson|conversation/.test(t) ? 'A2' : 'B1';
    return { fields: { category: cat, level, register: /spoken|colloquial|conversation|vlog/.test(t) ? 'spoken' : 'formal' }, how: 'heuristic' };
  }
  async function classifyVideo(d) {
    const base = heuristicVideo(d);
    if (!ai.configured) return base;
    try {
      const m = meta.snapshot();
      const r = await ai.completeJSON({ system: SYSTEM, maxTokens: 400, prompt: `Classify this Tamil video for a learner library. Return {"level": "A1".."C2", "category": one of ${JSON.stringify(VIDEO_CATEGORIES)}, "topic": one of ${JSON.stringify(m.topics.map((t) => t.slug))}, "register": "spoken"|"formal"|"mixed", "accent": "region or empty"}.\nTitle: ${d.title}\nChannel: ${d.channel}\nDescription: ${d.description.slice(0, 800)}` });
      const topic = m.topicsBySlug.get(r.topic);
      return { fields: { level: m.levels.has(r.level) ? r.level : base.fields.level, category: VIDEO_CATEGORIES.includes(r.category) ? r.category : base.fields.category, topic_id: topic?.id || null, register: ['spoken', 'formal', 'mixed'].includes(r.register) ? r.register : base.fields.register, accent: String(r.accent || '').slice(0, 60) }, how: 'ai' };
    } catch { return base; }
  }

  async function classifyItem(payload) {
    if (payload.kind === 'story') {
      const st = library.getStory(Number(payload.id), null, { any: true });
      const heur = assessDifficulty(st.paragraphs);
      let aiResult = null;
      if (ai.configured) aiResult = await ai.completeJSON({ system: SYSTEM, maxTokens: 400, prompt: `Estimate the CEFR level (A1..C2) of this Tamil text for learners. Return {"level": "..", "reason": ".."}.\n${st.paragraphs.map((p) => p.ta).join('\n')}` }).catch(() => null);
      const v = { ...st.validation, difficulty: heur, aiLevel: aiResult };
      db.run('UPDATE stories SET validation = ? WHERE id = ?', j(v), st.id);
      return { heuristic: heur, ai: aiResult };
    }
    throw bad('Unsupported classification target');
  }

  // ------------------------------------------------------------------ import & assists
  function importVocabulary({ format, content, publish = false }) {
    let rows;
    if (format === 'json') { try { rows = JSON.parse(content); } catch { throw bad('Invalid JSON'); } if (!Array.isArray(rows)) throw bad('JSON must be an array of entries'); }
    else if (format === 'csv') rows = parseCSV(content);
    else throw bad('Format must be csv or json');
    if (rows.length > 2000) throw bad('Import at most 2000 rows at a time');
    const report = { created: 0, duplicates: 0, errors: [] };
    rows.forEach((r, i) => {
      try {
        vocabulary.create(rowToVocabInput(r), { status: publish ? 'published' : 'pending', source: 'import', reviewStatus: 'editor' });
        report.created++;
      } catch (e) {
        if (e.details?.duplicate) report.duplicates++;
        else report.errors.push({ row: i + 2, problems: e.details?.problems || [e.message] });
      }
    });
    return report;
  }

  async function translateAssist({ tamil, english }) {
    if (!tamil || validateTamil(tamil).length) throw bad('Enter a valid Tamil word first');
    const r = await ai.completeJSON({ system: SYSTEM, maxTokens: 1200, prompt: `For the Tamil word "${tamil}"${english ? ` (English: ${english})` : ''} return {"english": "", "hindi": "Devanagari", "malayalam": "Malayalam script", "pronunciation": "", "part_of_speech": "", "register": "", "collocations": [{"ta": "with [[target]]", "en": ""}], "examples": [{"ta": "with [[target]]", "en": ""}], "synonyms": [], "antonyms": []}` });
    return { unverified: true, provider: ai.provider, suggestion: r };
  }

  async function dictionarySuggest(q, lang) {
    const query = String(q || '').trim().slice(0, 80);
    if (!query) throw bad('Enter a word to translate');
    const r = await ai.completeJSON({ system: SYSTEM, maxTokens: 800, prompt: `Translate the ${lang === 'hi' ? 'Hindi' : lang === 'ml' ? 'Malayalam' : 'English'} word or phrase "${query}" into Tamil. Return a JSON array (max 3) of {"tamil": "", "english": "", "register": "spoken|formal|common", "note": "usage note"}.` });
    const items = (Array.isArray(r) ? r : []).filter((x) => x && x.tamil && !validateTamil(x.tamil).length).slice(0, 3)
      .map((x) => ({ tamil: String(x.tamil).normalize('NFC'), transliteration: transliterate(x.tamil), english: String(x.english || query), register: x.register || '', note: String(x.note || '').slice(0, 200) }));
    return { unverified: true, label: 'AI suggestion — not a verified dictionary entry', items };
  }

  function reviewQueue() {
    return {
      vocabulary: db.all(`SELECT id FROM vocabulary WHERE status = 'pending' ORDER BY created_at DESC LIMIT 200`).map((r) => vocabulary.get(r.id, { any: true })),
      stories: library.listStories(null, { status: 'pending' }).items,
      videos: library.listVideos(null, { status: 'pending' }),
      lists: db.all("SELECT * FROM vocabulary_lists WHERE status = 'pending' ORDER BY created_at DESC").map((l) => ({ id: l.id, title: l.title, level: l.level, createdAt: l.created_at })),
    };
  }

  return { enqueue, listJobs, runJob, retry, trigger, tick, planToday, automationStatus, importVocabulary, translateAssist, dictionarySuggest, reviewQueue };
}

export { normalizeText };
