import { normalizeText, romanKey } from '../../shared/tamil.js';
import { transliterateAny, validateNative, isLang } from '../../shared/indic.js';
import { bad, notFound, conflict, parseJSON, j, seedFrom, mulberry32, shuffle, localDate } from '../util.js';

export const PARTS_OF_SPEECH = ['noun', 'verb', 'adjective', 'adverb', 'pronoun', 'postposition', 'conjunction', 'interjection', 'particle', 'idiom'];
export const REGISTERS = ['common', 'spoken', 'formal', 'literary', 'colloquial'];
export const VERB_FORMS = ['present1s', 'past1s', 'future1s', 'inf'];

/** Duplicate guard. Includes the language so identical spellings in different languages never merge. */
export const normKey = (native, english, lang = 'ta') => `${lang}|${normalizeText(native)}|${normalizeText(english)}`;

const strList = (v, max = 20) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[;,\n]/) : [])
  .map((s) => String(s).trim()).filter(Boolean).slice(0, max);

/** Ensure a context sentence marks the target with [[ ]] when it contains it verbatim. */
export function markTarget(text, word) {
  const s = String(text || '').normalize('NFC').trim();
  if (!s || /\[\[.+?\]\]/.test(s) || !word) return s;
  const i = s.indexOf(word);
  return i >= 0 ? `${s.slice(0, i)}[[${word}]]${s.slice(i + word.length)}` : s;
}

function contextList(v, word, lang, problems, label) {
  const out = [];
  (Array.isArray(v) ? v : []).slice(0, 12).forEach((c, i) => {
    if (!c || typeof c !== 'object') return;
    const ta = markTarget(c.ta ?? c.native, word);
    if (!ta) return;
    const p = validateNative(ta.replace(/\[\[|\]\]/g, ''), lang);
    if (p.length) { problems.push(`${label} ${i + 1}: ${p.join(', ')}`); return; }
    const item = { ta: ta.slice(0, 300), en: String(c.en || '').trim().slice(0, 300) };
    if (c.form && VERB_FORMS.includes(c.form)) item.form = c.form;
    out.push(item);
  });
  return out;
}

/** Validate & normalise a vocabulary payload for `lang`. Returns { value, problems, warnings }. */
export function validateVocabInput(input, { levels, topicsById, topicsBySlug }, lang = 'ta') {
  const problems = [];
  const warnings = [];
  if (!isLang(lang)) problems.push(`Unknown language "${lang}"`);
  const native = String(input.native ?? input.tamil ?? '').normalize('NFC').trim();
  const english = String(input.english || '').trim();
  if (!native) problems.push('Word in the learning language is required');
  else { const p = validateNative(native, lang); if (p.length) problems.push(`Word: ${p.join(', ')}`); }
  if (!english) problems.push('English translation is required');
  const pos = String(input.part_of_speech || input.partOfSpeech || '').toLowerCase().trim();
  if (!PARTS_OF_SPEECH.includes(pos)) problems.push(`Part of speech must be one of: ${PARTS_OF_SPEECH.join(', ')}`);
  const level = String(input.level || '').toUpperCase().trim();
  if (!levels.has(level)) problems.push(`Unknown level "${input.level || ''}"`);
  const register = String(input.register || 'common').toLowerCase().trim();
  if (!REGISTERS.includes(register)) problems.push(`Register must be one of: ${REGISTERS.join(', ')}`);
  let topicId = null;
  const t = input.topic_id ?? input.topicId ?? input.topic;
  if (t !== undefined && t !== null && t !== '') {
    const found = topicsById.get(Number(t)) || topicsBySlug.get(String(t).toLowerCase());
    if (!found) problems.push(`Unknown topic "${t}"`); else topicId = found.id;
  }
  const hindi = String(input.hindi || '').trim();
  const malayalam = String(input.malayalam || '').trim();
  if (hindi && !/[\u0900-\u097F]/.test(hindi)) warnings.push('Hindi translation is not in Devanagari script');
  if (malayalam && !/[\u0D00-\u0D7F]/.test(malayalam)) warnings.push('Malayalam translation is not in Malayalam script');
  const examples = contextList(input.examples, native, lang, problems, 'Example');
  const collocations = contextList(input.collocations, native, lang, problems, 'Collocation');
  if (!examples.length) warnings.push('No example sentence: sentence-completion exercises will be replaced by other types');
  if (!collocations.length) warnings.push('No collocation: collocation exercises will be replaced by other types');
  const forms = {};
  if (input.forms && typeof input.forms === 'object') {
    for (const f of VERB_FORMS) if (input.forms[f]) {
      const v = String(input.forms[f]).normalize('NFC').trim();
      if (validateNative(v, lang).length) problems.push(`Verb form ${f} is not valid in this script`); else forms[f] = v;
    }
  }
  const synonyms = strList(input.synonyms).filter((s) => !validateNative(s, lang).length);
  const antonyms = strList(input.antonyms).filter((s) => !validateNative(s, lang).length);
  return {
    problems, warnings,
    value: {
      lang, tamil: native, transliteration: String(input.transliteration || '').trim() || transliterateAny(native),
      pronunciation: String(input.pronunciation || '').trim().slice(0, 120), english: english.slice(0, 200),
      alt_english: strList(input.alt_english ?? input.altEnglish), hindi: hindi.slice(0, 200), malayalam: malayalam.slice(0, 200),
      part_of_speech: pos, level, topic_id: topicId, register, dialect: String(input.dialect || '').trim().slice(0, 200),
      definition: String(input.definition || '').trim().slice(0, 1000), concept_key: input.concept_key || input.conceptKey || null,
      examples, collocations, synonyms, antonyms, related: strList(input.related), forms,
    },
  };
}

export function rowToVocab(r) {
  if (!r) return null;
  return {
    id: r.id, lang: r.lang || 'ta', native: r.tamil, tamil: r.tamil, transliteration: r.transliteration, pronunciation: r.pronunciation,
    english: r.english, altEnglish: parseJSON(r.alt_english, []), hindi: r.hindi, malayalam: r.malayalam, definition: r.definition || '',
    conceptKey: r.concept_key || null, partOfSpeech: r.part_of_speech, level: r.level, topicId: r.topic_id, topic: r.topic_name || null,
    topicSlug: r.topic_slug || null, register: r.register, dialect: r.dialect, examples: parseJSON(r.examples, []),
    collocations: parseJSON(r.collocations, []), synonyms: parseJSON(r.synonyms, []), antonyms: parseJSON(r.antonyms, []),
    related: parseJSON(r.related, []), forms: parseJSON(r.forms, {}), status: r.status, source: r.source, reviewStatus: r.review_status,
    validation: parseJSON(r.validation, {}), createdAt: r.created_at, origin: r.origin || '',
  };
}

const VOCAB_SELECT = 'SELECT v.*, t.name AS topic_name, t.slug AS topic_slug FROM vocabulary v LEFT JOIN topics t ON t.id = v.topic_id';
const LEVEL_ORDER = "CASE v.level WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 ELSE 6 END";

export function createVocabularyService({ db, clock, meta }) {
  const caches = new Map();
  const listeners = [];
  const invalidate = () => { caches.clear(); listeners.forEach((f) => f()); };
  const onInvalidate = (f) => listeners.push(f);

  /** Published entries of one language, with precomputed search keys. */
  function published(lang = 'ta', includeImports = false) {
    const key = includeImports ? lang + ':dictionary' : lang;
    const eligible = includeImports ? "(v.status = 'published' OR (v.status = 'pending' AND v.origin IN ('wiktionary','olam','alar','datuk','indic-glossaries','indictrans2','local-llm','local','daily-topic-ai')))" : "v.status = 'published'";
    if (!caches.has(key)) {
      const rows = db.all(`${VOCAB_SELECT} WHERE ${eligible} AND v.lang = ? ORDER BY v.id`, lang).map(rowToVocab);
      const senses = db.all(`SELECT s.vocabulary_id, s.gloss FROM word_senses s JOIN vocabulary v ON v.id = s.vocabulary_id WHERE v.lang = ? AND ${eligible}`, lang);
      const glosses = new Map();
      for (const s of senses) { if (!glosses.has(s.vocabulary_id)) glosses.set(s.vocabulary_id, []); glosses.get(s.vocabulary_id).push(s.gloss); }
      for (const v of rows) {
        v._ta = normalizeText(v.tamil);
        v._en = [...new Set([v.english, ...v.altEnglish, ...(glosses.get(v.id) || [])].map(normalizeText))];
        v._hi = v.hindi ? v.hindi.split(/[,;/]/).map(normalizeText).filter(Boolean) : [];
        v._ml = v.malayalam ? v.malayalam.split(/[,;/]/).map(normalizeText).filter(Boolean) : [];
        v._rk = romanKey(v.transliteration);
        v._rk2 = v.pronunciation ? romanKey(v.pronunciation) : '';
        v._forms = Object.values(v.forms || {});
      }
      caches.set(key, rows);
    }
    return caches.get(key);
  }

  const validate = (input, lang = input.lang || 'ta') => validateVocabInput(input, meta.snapshot(), lang);

  /** Mirror the legacy single-sense columns into the sense tables (sense 1, source 'legacy'). */
  function syncLegacySense(id) {
    const v = rowToVocab(db.get('SELECT * FROM vocabulary WHERE id = ?', id));
    if (!v) return;
    const now = clock.now().toISOString();
    db.tx(() => {
      db.run(`INSERT INTO word_senses(vocabulary_id, sense_no, gloss, definition, part_of_speech, register, source, review_status, created_at) VALUES (?,1,?,?,?,?,?,?,?)
        ON CONFLICT(vocabulary_id, sense_no) DO UPDATE SET gloss = excluded.gloss, definition = CASE WHEN excluded.definition != '' THEN excluded.definition ELSE word_senses.definition END,
        part_of_speech = excluded.part_of_speech, register = excluded.register, review_status = excluded.review_status`,
        id, v.english, v.definition, v.partOfSpeech, v.register, 'legacy', v.reviewStatus, now);
      const sid = db.get('SELECT id FROM word_senses WHERE vocabulary_id = ? AND sense_no = 1', id).id;
      for (const t of ['sense_relations', 'sense_collocations', 'sense_examples']) db.run(`DELETE FROM ${t} WHERE sense_id = ? AND source = 'legacy'`, sid);
      const rs = v.reviewStatus;
      // legacy synonym/antonym strings are mirrored unless an editor row for the same word already exists
      const addRel = (rel, s) => db.run(`INSERT OR IGNORE INTO sense_relations(sense_id, relation, native, transliteration, source, review_status)
        SELECT ?, ?, ?, ?, 'legacy', ? WHERE NOT EXISTS (SELECT 1 FROM sense_relations WHERE sense_id = ? AND native = ? AND source != 'legacy')`, sid, rel, s, transliterateAny(s), rs, sid, s);
      for (const s of v.synonyms) addRel('synonym', s);
      for (const s of v.antonyms) addRel('antonym', s);
      for (const c of v.collocations) db.run("INSERT OR IGNORE INTO sense_collocations(sense_id, category, native, transliteration, english, source, review_status) VALUES (?, 'common', ?, ?, ?, 'legacy', ?)", sid, c.ta.replace(/\[\[|\]\]/g, ''), transliterateAny(c.ta.replace(/\[\[|\]\]/g, '')), c.en, rs);
      for (const e of v.examples) db.run("INSERT OR IGNORE INTO sense_examples(sense_id, native, transliteration, english, register, source, review_status) VALUES (?,?,?,?,?, 'legacy', ?)", sid, e.ta, transliterateAny(e.ta.replace(/\[\[|\]\]/g, '')), e.en, v.register, rs);
    });
  }
  /** Startup backfill for entries created before the sense model existed. Idempotent. */
  function backfillSenses() {
    const ids = db.all('SELECT v.id FROM vocabulary v LEFT JOIN word_senses s ON s.vocabulary_id = v.id AND s.sense_no = 1 WHERE s.id IS NULL').map((r) => r.id);
    for (const id of ids) syncLegacySense(id);
    if (ids.length) invalidate();
    return ids.length;
  }

  function create(input, { status = 'published', source = 'admin', reviewStatus = 'editor', extraValidation = {}, lang } = {}) {
    const L = lang || input.lang || 'ta';
    const { value, problems, warnings } = validate(input, L);
    if (problems.length) throw bad('Vocabulary entry is invalid', { problems, warnings });
    const key = normKey(value.tamil, value.english, L);
    if (db.get('SELECT id FROM vocabulary WHERE norm_key = ?', key)) throw conflict('This word already exists in the library', { duplicate: true });
    const now = clock.now().toISOString();
    const r = db.run(`INSERT INTO vocabulary(lang, tamil, transliteration, pronunciation, english, alt_english, hindi, malayalam, part_of_speech, level, topic_id, register, dialect, examples, collocations, synonyms, antonyms, related, forms, status, source, review_status, validation, norm_key, concept_key, definition, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      L, value.tamil, value.transliteration, value.pronunciation, value.english, j(value.alt_english), value.hindi, value.malayalam,
      value.part_of_speech, value.level, value.topic_id, value.register, value.dialect, j(value.examples), j(value.collocations),
      j(value.synonyms), j(value.antonyms), j(value.related), j(value.forms), status, source, reviewStatus,
      j({ warnings, ...extraValidation }), key, value.concept_key, value.definition, now, now);
    const id = Number(r.lastInsertRowid);
    syncLegacySense(id);
    invalidate();
    return id;
  }

  function update(id, input) {
    const cur = get(id, { any: true });
    if (!cur) throw notFound('Word not found');
    const merged = { ...toInput(cur), ...input };
    const { value, problems, warnings } = validate(merged, cur.lang);
    if (problems.length) throw bad('Vocabulary entry is invalid', { problems, warnings });
    const key = normKey(value.tamil, value.english, cur.lang);
    if (db.get('SELECT id FROM vocabulary WHERE norm_key = ? AND id != ?', key, id)) throw conflict('Another entry already has this word and English translation', { duplicate: true });
    db.run(`UPDATE vocabulary SET tamil=?, transliteration=?, pronunciation=?, english=?, alt_english=?, hindi=?, malayalam=?, part_of_speech=?, level=?, topic_id=?, register=?, dialect=?, examples=?, collocations=?, synonyms=?, antonyms=?, related=?, forms=?, validation=?, norm_key=?, concept_key=?, definition=?, updated_at=? WHERE id=?`,
      value.tamil, value.transliteration, value.pronunciation, value.english, j(value.alt_english), value.hindi, value.malayalam,
      value.part_of_speech, value.level, value.topic_id, value.register, value.dialect, j(value.examples), j(value.collocations),
      j(value.synonyms), j(value.antonyms), j(value.related), j(value.forms), j({ ...(cur.validation || {}), warnings }), key, value.concept_key, value.definition, clock.now().toISOString(), id);
    syncLegacySense(id);
    invalidate();
  }

  function setStatus(id, status, reviewStatus) {
    const r = db.run('UPDATE vocabulary SET status = ?, review_status = COALESCE(?, review_status), updated_at = ? WHERE id = ?', status, reviewStatus || null, clock.now().toISOString(), id);
    if (!r.changes) throw notFound('Word not found');
    if (reviewStatus) db.run('UPDATE word_senses SET review_status = ? WHERE vocabulary_id = ? AND source = \'legacy\'', reviewStatus, id);
    invalidate();
  }
  function remove(id) { if (!db.run('DELETE FROM vocabulary WHERE id = ?', id).changes) throw notFound('Word not found'); invalidate(); }

  function get(id, { any = false } = {}) {
    return rowToVocab(db.get(`${VOCAB_SELECT} WHERE v.id = ? ${any ? '' : "AND v.status = 'published'"}`, id));
  }

  function browse({ lang = 'ta', level, topic, pos, register, q, page = 1, pageSize = 24, status = 'published' } = {}) {
    const where = ['v.status = ?', 'v.lang = ?'];
    const args = [status, lang];
    if (level) { where.push('v.level = ?'); args.push(String(level).toUpperCase()); }
    if (topic) { where.push('(t.slug = ? OR v.topic_id = ?)'); args.push(String(topic), Number(topic) || -1); }
    if (pos) { where.push('v.part_of_speech = ?'); args.push(String(pos)); }
    if (register) { where.push('v.register = ?'); args.push(String(register)); }
    if (q) {
      const raw = `%${String(q).trim()}%`; const like = `%${String(q).trim().toLowerCase()}%`;
      where.push('(v.tamil LIKE ? OR lower(v.english) LIKE ? OR lower(v.transliteration) LIKE ? OR v.hindi LIKE ? OR v.malayalam LIKE ?)');
      args.push(raw, like, like, raw, raw);
    }
    const size = Math.min(100, Math.max(1, Number(pageSize) || 24));
    const p = Math.max(1, Number(page) || 1);
    const total = db.get(`SELECT COUNT(*) AS n FROM vocabulary v LEFT JOIN topics t ON t.id = v.topic_id WHERE ${where.join(' AND ')}`, ...args).n;
    const rows = db.all(`${VOCAB_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${LEVEL_ORDER}, v.tamil LIMIT ? OFFSET ?`, ...args, size, (p - 1) * size);
    return { items: rows.map(rowToVocab), total, page: p, pageSize: size, pages: Math.max(1, Math.ceil(total / size)) };
  }

  /** Personalised word recommendations for one language (kept for compatibility; Daily Topic is the main surface). */
  function daily(userId, profile, size = 12, lang = 'ta') {
    const today = localDate(clock.now(), profile.timezone);
    const known = new Set(db.all(`SELECT vocabulary_id AS id FROM collection_words WHERE user_id = ? AND lang = ? AND vocabulary_id IS NOT NULL
      UNION SELECT CAST(substr(word_key, 2) AS INTEGER) FROM word_mastery WHERE user_id = ? AND lang = ? AND word_key LIKE 'v%' AND successful_days > 0`, userId, lang, userId, lang).map((r) => r.id));
    const pref = new Set(parseJSON(profile.preferred_topics, []));
    const order = meta.levelOrder();
    const myIdx = order.indexOf(profile.proficiency_level);
    const rand = mulberry32(seedFrom(`${userId}:${lang}:${today}`));
    const scored = shuffle(published(lang).filter((v) => !known.has(v.id)), rand).map((v) => {
      const li = order.indexOf(v.level);
      let s = li === myIdx ? 3 : li === myIdx + 1 ? 1.5 : li === myIdx - 1 ? 1 : -Math.abs(li - myIdx);
      if (v.topicSlug && pref.has(v.topicSlug)) s += 2;
      return { v, s };
    }).sort((a, b) => b.s - a.s);
    return { date: today, words: scored.slice(0, size).map((x) => strip(x.v)), alreadyKnown: known.size };
  }

  function lists({ lang = 'ta', level, topic } = {}) {
    const where = ["l.status = 'published'", 'l.lang = ?']; const args = [lang];
    if (level) { where.push('l.level = ?'); args.push(level); }
    if (topic) { where.push('t.slug = ?'); args.push(topic); }
    return db.all(`SELECT l.*, t.name AS topic_name, t.slug AS topic_slug, (SELECT COUNT(*) FROM vocabulary_list_items i JOIN vocabulary v ON v.id = i.vocabulary_id AND v.status = 'published' WHERE i.list_id = l.id) AS word_count
      FROM vocabulary_lists l LEFT JOIN topics t ON t.id = l.topic_id WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC, l.id DESC`, ...args)
      .filter((l) => l.word_count >= (meta.getSettings().list_min_words ?? 40))
      .map((l) => ({ id: l.id, lang: l.lang, title: l.title, description: l.description, level: l.level, topic: l.topic_name, topicSlug: l.topic_slug, wordCount: l.word_count, createdAt: l.created_at }));
  }
  function listDetail(id, { any = false } = {}) {
    const l = db.get(`SELECT l.*, t.name AS topic_name FROM vocabulary_lists l LEFT JOIN topics t ON t.id = l.topic_id WHERE l.id = ? ${any ? '' : "AND l.status='published'"}`, id);
    if (!l) throw notFound('List not found');
    const words = db.all(`${VOCAB_SELECT} JOIN vocabulary_list_items i ON i.vocabulary_id = v.id WHERE i.list_id = ? ${any ? '' : "AND v.status='published'"} ORDER BY i.position, v.id`, id).map(rowToVocab);
    return { id: l.id, lang: l.lang, title: l.title, description: l.description, level: l.level, topic: l.topic_name, topicId: l.topic_id, status: l.status, words };
  }

  return { forDictionary: (lang) => published(lang, true), published, invalidate, onInvalidate, validate, create, update, setStatus, remove, get, browse, daily, lists, listDetail, syncLegacySense, backfillSenses };
}

export function strip(v) {
  const o = {};
  for (const [k, val] of Object.entries(v)) if (!k.startsWith('_')) o[k] = val;
  return o;
}

export function toInput(v) {
  return {
    tamil: v.tamil, transliteration: v.transliteration, pronunciation: v.pronunciation, english: v.english, alt_english: v.altEnglish,
    hindi: v.hindi, malayalam: v.malayalam, part_of_speech: v.partOfSpeech, level: v.level, topic_id: v.topicId, register: v.register,
    dialect: v.dialect, definition: v.definition, concept_key: v.conceptKey, examples: v.examples, collocations: v.collocations,
    synonyms: v.synonyms, antonyms: v.antonyms, related: v.related, forms: v.forms,
  };
}
