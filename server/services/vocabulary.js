import { transliterate, validateTamil, normalizeText, romanKey, stripDiacritics, levenshtein, hasTamil } from '../../shared/tamil.js';
import { bad, notFound, conflict, parseJSON, j, seedFrom, mulberry32, shuffle, localDate } from '../util.js';

export const PARTS_OF_SPEECH = ['noun', 'verb', 'adjective', 'adverb', 'pronoun', 'postposition', 'conjunction', 'interjection', 'particle', 'idiom'];
export const REGISTERS = ['common', 'spoken', 'formal', 'literary', 'colloquial'];
export const VERB_FORMS = ['present1s', 'past1s', 'future1s', 'inf'];

export const normKey = (tamil, english) => `${normalizeText(tamil)}|${normalizeText(english)}`;

const strList = (v, max = 20) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[;,\n]/) : [])
  .map((s) => String(s).trim()).filter(Boolean).slice(0, max);

/** Ensure a context sentence marks the target with [[ ]] when it contains it verbatim. */
export function markTarget(ta, tamil) {
  const s = String(ta || '').normalize('NFC').trim();
  if (!s || /\[\[.+?\]\]/.test(s) || !tamil) return s;
  const i = s.indexOf(tamil);
  return i >= 0 ? `${s.slice(0, i)}[[${tamil}]]${s.slice(i + tamil.length)}` : s;
}

function contextList(v, tamil, problems, label) {
  const arr = Array.isArray(v) ? v : [];
  const out = [];
  arr.slice(0, 12).forEach((c, i) => {
    if (!c || typeof c !== 'object') return;
    const ta = markTarget(c.ta, tamil);
    const en = String(c.en || '').trim().slice(0, 300);
    if (!ta) return;
    const p = validateTamil(ta.replace(/\[\[|\]\]/g, ''));
    if (p.length) { problems.push(`${label} ${i + 1}: ${p.join(', ')}`); return; }
    const item = { ta: ta.slice(0, 300), en };
    if (c.form && VERB_FORMS.includes(c.form)) item.form = c.form;
    out.push(item);
  });
  return out;
}

/**
 * Validate & normalise a vocabulary payload. Returns { value, problems }.
 * `problems` are blocking errors; `warnings` are shown to reviewers.
 */
export function validateVocabInput(input, { levels, topicsById, topicsBySlug }) {
  const problems = [];
  const warnings = [];
  const tamil = String(input.tamil || '').normalize('NFC').trim();
  const english = String(input.english || '').trim();
  if (!tamil) problems.push('Tamil word is required');
  else { const p = validateTamil(tamil); if (p.length) problems.push(`Tamil word: ${p.join(', ')}`); }
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
    const byId = topicsById.get(Number(t));
    const bySlug = topicsBySlug.get(String(t).toLowerCase());
    const found = byId || bySlug;
    if (!found) problems.push(`Unknown topic "${t}"`); else topicId = found.id;
  }
  const hindi = String(input.hindi || '').trim();
  const malayalam = String(input.malayalam || '').trim();
  if (hindi && !/[\u0900-\u097F]/.test(hindi)) warnings.push('Hindi translation is not in Devanagari script');
  if (malayalam && !/[\u0D00-\u0D7F]/.test(malayalam)) warnings.push('Malayalam translation is not in Malayalam script');
  const examples = contextList(input.examples, tamil, problems, 'Example');
  const collocations = contextList(input.collocations, tamil, problems, 'Collocation');
  if (!examples.length) warnings.push('No example sentence: sentence-completion exercises will be replaced by other types');
  if (!collocations.length) warnings.push('No collocation: collocation exercises will be replaced by other types');
  let forms = {};
  if (input.forms && typeof input.forms === 'object') {
    for (const f of VERB_FORMS) if (input.forms[f]) {
      const v = String(input.forms[f]).normalize('NFC').trim();
      if (validateTamil(v).length) problems.push(`Verb form ${f} is not valid Tamil`); else forms[f] = v;
    }
  }
  const value = {
    tamil,
    transliteration: String(input.transliteration || '').trim() || transliterate(tamil),
    pronunciation: String(input.pronunciation || '').trim().slice(0, 120),
    english: english.slice(0, 200),
    alt_english: strList(input.alt_english ?? input.altEnglish),
    hindi: hindi.slice(0, 200),
    malayalam: malayalam.slice(0, 200),
    part_of_speech: pos,
    level,
    topic_id: topicId,
    register,
    dialect: String(input.dialect || '').trim().slice(0, 200),
    examples,
    collocations,
    synonyms: strList(input.synonyms),
    antonyms: strList(input.antonyms),
    related: strList(input.related),
    forms,
  };
  return { value, problems, warnings };
}

export function rowToVocab(r) {
  if (!r) return null;
  return {
    id: r.id, tamil: r.tamil, transliteration: r.transliteration, pronunciation: r.pronunciation,
    english: r.english, altEnglish: parseJSON(r.alt_english, []), hindi: r.hindi, malayalam: r.malayalam,
    partOfSpeech: r.part_of_speech, level: r.level, topicId: r.topic_id, topic: r.topic_name || null, topicSlug: r.topic_slug || null,
    register: r.register, dialect: r.dialect, examples: parseJSON(r.examples, []), collocations: parseJSON(r.collocations, []),
    synonyms: parseJSON(r.synonyms, []), antonyms: parseJSON(r.antonyms, []), related: parseJSON(r.related, []),
    forms: parseJSON(r.forms, {}), status: r.status, source: r.source, reviewStatus: r.review_status,
    validation: parseJSON(r.validation, {}), createdAt: r.created_at,
  };
}

const VOCAB_SELECT = `SELECT v.*, t.name AS topic_name, t.slug AS topic_slug FROM vocabulary v LEFT JOIN topics t ON t.id = v.topic_id`;

export function createVocabularyService({ db, clock, meta }) {
  let cache = null;
  const invalidate = () => { cache = null; };
  function published() {
    if (!cache) {
      cache = db.all(`${VOCAB_SELECT} WHERE v.status = 'published' ORDER BY v.id`).map(rowToVocab);
      for (const v of cache) {
        v._ta = normalizeText(v.tamil);
        v._en = [v.english, ...v.altEnglish].map(normalizeText);
        v._hi = v.hindi ? v.hindi.split(/[,;/]/).map(normalizeText).filter(Boolean) : [];
        v._ml = v.malayalam ? v.malayalam.split(/[,;/]/).map(normalizeText).filter(Boolean) : [];
        v._rk = romanKey(v.transliteration);
        v._rk2 = v.pronunciation ? romanKey(v.pronunciation) : '';
        v._forms = Object.values(v.forms || {});
      }
    }
    return cache;
  }

  function validate(input) {
    const m = meta.snapshot();
    return validateVocabInput(input, m);
  }

  function create(input, { status = 'published', source = 'admin', reviewStatus = 'editor', extraValidation = {} } = {}) {
    const { value, problems, warnings } = validate(input);
    if (problems.length) throw bad('Vocabulary entry is invalid', { problems, warnings });
    const key = normKey(value.tamil, value.english);
    if (db.get('SELECT id FROM vocabulary WHERE norm_key = ?', key)) throw conflict('This word already exists in the library', { duplicate: true });
    const now = clock.now().toISOString();
    const r = db.run(`INSERT INTO vocabulary(tamil, transliteration, pronunciation, english, alt_english, hindi, malayalam, part_of_speech, level, topic_id, register, dialect, examples, collocations, synonyms, antonyms, related, forms, status, source, review_status, validation, norm_key, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      value.tamil, value.transliteration, value.pronunciation, value.english, j(value.alt_english), value.hindi, value.malayalam,
      value.part_of_speech, value.level, value.topic_id, value.register, value.dialect, j(value.examples), j(value.collocations),
      j(value.synonyms), j(value.antonyms), j(value.related), j(value.forms), status, source, reviewStatus,
      j({ warnings, ...extraValidation }), key, now, now);
    invalidate();
    return Number(r.lastInsertRowid);
  }

  function update(id, input) {
    const cur = get(id, { any: true });
    if (!cur) throw notFound('Word not found');
    const merged = { ...toInput(cur), ...input };
    const { value, problems, warnings } = validate(merged);
    if (problems.length) throw bad('Vocabulary entry is invalid', { problems, warnings });
    const key = normKey(value.tamil, value.english);
    const dup = db.get('SELECT id FROM vocabulary WHERE norm_key = ? AND id != ?', key, id);
    if (dup) throw conflict('Another entry already has this Tamil word and English translation', { duplicate: true });
    const v = cur.validation || {};
    db.run(`UPDATE vocabulary SET tamil=?, transliteration=?, pronunciation=?, english=?, alt_english=?, hindi=?, malayalam=?, part_of_speech=?, level=?, topic_id=?, register=?, dialect=?, examples=?, collocations=?, synonyms=?, antonyms=?, related=?, forms=?, validation=?, norm_key=?, updated_at=? WHERE id=?`,
      value.tamil, value.transliteration, value.pronunciation, value.english, j(value.alt_english), value.hindi, value.malayalam,
      value.part_of_speech, value.level, value.topic_id, value.register, value.dialect, j(value.examples), j(value.collocations),
      j(value.synonyms), j(value.antonyms), j(value.related), j(value.forms), j({ ...v, warnings }), key, clock.now().toISOString(), id);
    invalidate();
  }

  function setStatus(id, status, reviewStatus) {
    const r = db.run('UPDATE vocabulary SET status = ?, review_status = COALESCE(?, review_status), updated_at = ? WHERE id = ?', status, reviewStatus || null, clock.now().toISOString(), id);
    if (!r.changes) throw notFound('Word not found');
    invalidate();
  }

  function remove(id) {
    const r = db.run('DELETE FROM vocabulary WHERE id = ?', id);
    if (!r.changes) throw notFound('Word not found');
    invalidate();
  }

  function get(id, { any = false } = {}) {
    const r = db.get(`${VOCAB_SELECT} WHERE v.id = ? ${any ? '' : "AND v.status = 'published'"}`, id);
    return rowToVocab(r);
  }

  function browse({ level, topic, pos, register, q, page = 1, pageSize = 24, status = 'published' } = {}) {
    const where = ['v.status = ?'];
    const args = [status];
    if (level) { where.push('v.level = ?'); args.push(String(level).toUpperCase()); }
    if (topic) { where.push('(t.slug = ? OR v.topic_id = ?)'); args.push(String(topic), Number(topic) || -1); }
    if (pos) { where.push('v.part_of_speech = ?'); args.push(String(pos)); }
    if (register) { where.push('v.register = ?'); args.push(String(register)); }
    if (q) {
      where.push('(v.tamil LIKE ? OR lower(v.english) LIKE ? OR lower(v.transliteration) LIKE ? OR v.hindi LIKE ? OR v.malayalam LIKE ?)');
      const like = `%${String(q).trim().toLowerCase()}%`;
      args.push(`%${String(q).trim()}%`, like, like, `%${String(q).trim()}%`, `%${String(q).trim()}%`);
    }
    const size = Math.min(100, Math.max(1, Number(pageSize) || 24));
    const p = Math.max(1, Number(page) || 1);
    const total = db.get(`SELECT COUNT(*) AS n FROM vocabulary v LEFT JOIN topics t ON t.id = v.topic_id WHERE ${where.join(' AND ')}`, ...args).n;
    const rows = db.all(`${VOCAB_SELECT} WHERE ${where.join(' AND ')} ORDER BY CASE v.level WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 ELSE 6 END, v.tamil LIMIT ? OFFSET ?`, ...args, size, (p - 1) * size);
    return { items: rows.map(rowToVocab), total, page: p, pageSize: size, pages: Math.max(1, Math.ceil(total / size)) };
  }

  /** Personalised daily list: level + preferred topics, excluding words already collected or studied. */
  function daily(userId, profile, size = 12) {
    const today = localDate(clock.now(), profile.timezone);
    const known = new Set(db.all(`SELECT vocabulary_id AS id FROM collection_words WHERE user_id = ? AND vocabulary_id IS NOT NULL
      UNION SELECT CAST(substr(word_key, 2) AS INTEGER) FROM word_mastery WHERE user_id = ? AND word_key LIKE 'v%' AND successful_days > 0`, userId, userId).map((r) => r.id));
    const pref = new Set(parseJSON(profile.preferred_topics, []));
    const order = meta.levelOrder();
    const myIdx = order.indexOf(profile.proficiency_level);
    const all = published().filter((v) => !known.has(v.id));
    const rand = mulberry32(seedFrom(`${userId}:${today}`));
    const scored = shuffle(all, rand).map((v) => {
      const li = order.indexOf(v.level);
      let s = 0;
      if (li === myIdx) s += 3; else if (li === myIdx + 1) s += 1.5; else if (li === myIdx - 1) s += 1; else s -= Math.abs(li - myIdx);
      if (v.topicSlug && pref.has(v.topicSlug)) s += 2;
      return { v, s };
    }).sort((a, b) => b.s - a.s);
    return { date: today, words: scored.slice(0, size).map((x) => strip(x.v)), alreadyKnown: known.size };
  }

  function lists({ level, topic } = {}) {
    const where = ["l.status = 'published'"]; const args = [];
    if (level) { where.push('l.level = ?'); args.push(level); }
    if (topic) { where.push('t.slug = ?'); args.push(topic); }
    return db.all(`SELECT l.*, t.name AS topic_name, t.slug AS topic_slug, (SELECT COUNT(*) FROM vocabulary_list_items i JOIN vocabulary v ON v.id = i.vocabulary_id AND v.status = 'published' WHERE i.list_id = l.id) AS word_count
      FROM vocabulary_lists l LEFT JOIN topics t ON t.id = l.topic_id WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC, l.id DESC`, ...args)
      .map((l) => ({ id: l.id, title: l.title, description: l.description, level: l.level, topic: l.topic_name, topicSlug: l.topic_slug, wordCount: l.word_count, createdAt: l.created_at }));
  }
  function listDetail(id, { any = false } = {}) {
    const l = db.get(`SELECT l.*, t.name AS topic_name FROM vocabulary_lists l LEFT JOIN topics t ON t.id = l.topic_id WHERE l.id = ? ${any ? '' : "AND l.status='published'"}`, id);
    if (!l) throw notFound('List not found');
    const words = db.all(`${VOCAB_SELECT} JOIN vocabulary_list_items i ON i.vocabulary_id = v.id WHERE i.list_id = ? ${any ? '' : "AND v.status='published'"} ORDER BY i.position, v.id`, id).map(rowToVocab);
    return { id: l.id, title: l.title, description: l.description, level: l.level, topic: l.topic_name, topicId: l.topic_id, status: l.status, words };
  }

  // ------------------------------------------------------------ dictionary
  function detectLang(q) {
    if (hasTamil(q)) return 'ta';
    if (/[\u0900-\u097F]/.test(q)) return 'hi';
    if (/[\u0D00-\u0D7F]/.test(q)) return 'ml';
    return 'en';
  }

  function scoreEntry(v, qn, qk, lang) {
    let best = 0; let how = '';
    const consider = (score, label) => { if (score > best) { best = score; how = label; } };
    const fieldMatch = (values, label, base = 100) => {
      for (const val of values) {
        if (!val) continue;
        if (val === qn) consider(base, `exact ${label}`);
        else if (val.startsWith(qn) && qn.length >= 2) consider(base - 18, `partial ${label}`);
        else if (qn.length >= 3 && new RegExp(`(^|[\\s(/-])${qn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(val)) consider(base - 30, `partial ${label}`);
        else if (qn.length >= 4) {
          const d = levenshtein(val, qn, 2);
          if (d === 1) consider(base - 45, `fuzzy ${label}`);
          else if (d === 2 && qn.length >= 7) consider(base - 55, `fuzzy ${label}`);
        }
      }
    };
    if (lang === 'ta') {
      fieldMatch([v._ta], 'Tamil');
      if (v._forms.some((f) => normalizeText(f) === qn)) consider(92, 'verb form');
      if (v.synonyms.some((s) => normalizeText(s) === qn)) consider(70, 'synonym');
      if (v.collocations.some((c) => normalizeText(c.ta.replace(/\[\[|\]\]/g, '')).includes(qn)) && qn.length >= 3) consider(40, 'phrase');
    } else if (lang === 'hi') fieldMatch(v._hi, 'Hindi');
    else if (lang === 'ml') fieldMatch(v._ml, 'Malayalam');
    else {
      fieldMatch(v._en, 'English');
      // transliteration-based search (romanised Tamil)
      if (qk.length >= 2) {
        if (v._rk === qk || (v._rk2 && v._rk2 === qk)) consider(96, 'transliteration');
        else if (v._rk.startsWith(qk) && qk.length >= 3) consider(72, 'transliteration');
        else if (qk.length >= 4 && levenshtein(v._rk, qk, 1) <= 1) consider(55, 'fuzzy transliteration');
      }
      // phrase search inside collocation / example translations
      if (qn.includes(' ') || qn.length >= 4) {
        if (v.collocations.some((c) => normalizeText(c.en).includes(qn))) consider(42, 'phrase');
        else if (v.examples.some((c) => normalizeText(c.en).split(/\W+/).includes(qn))) consider(30, 'example');
      }
    }
    return { score: best, how };
  }

  function search(q, lang = 'auto', limit = 20) {
    const raw = String(q || '').trim().slice(0, 100);
    if (!raw) return { query: raw, lang: 'en', results: [] };
    const L = lang === 'auto' || !lang ? detectLang(raw) : lang;
    const qn = normalizeText(raw);
    const qk = romanKey(raw);
    const scored = [];
    for (const v of published()) {
      const { score, how } = scoreEntry(v, qn, qk, L);
      if (score > 0) scored.push({ v, score, how });
    }
    scored.sort((a, b) => b.score - a.score || a.v.tamil.localeCompare(b.v.tamil));
    const results = scored.slice(0, limit).map(({ v, score, how }) => ({
      ...strip(v),
      match: { score, type: how },
      translation: L === 'hi' ? v.hindi : L === 'ml' ? v.malayalam : v.english,
      verified: v.reviewStatus === 'native-reviewed' ? 'native-reviewed' : 'library',
    }));
    // synonyms: other entries that list the top result's Tamil word as synonym, or vice versa
    return { query: raw, lang: L, results };
  }

  function suggest(q, lang = 'auto') {
    return search(q, lang, 8).results.map((r) => ({ id: r.id, tamil: r.tamil, transliteration: r.transliteration, label: r.translation || r.english }));
  }

  /** Reader lookup: exact form, verb form, or longest dictionary stem of an inflected token. */
  function lookup(token) {
    const t = normalizeText(token).replace(/[^\u0B80-\u0BFF]/g, '');
    if (!t) return { token, entry: null };
    const all = published();
    const exact = all.find((v) => v._ta === t) || all.find((v) => v._forms.some((f) => normalizeText(f) === t));
    if (exact) return { token: t, entry: strip(exact), match: 'exact' };
    let best = null;
    for (const v of all) {
      const stem = v._ta.replace(/ு$/, ''); // e.g. வீடு -> வீட (வீட்டில்)
      for (const s of [v._ta, stem]) {
        if (s.length >= 2 && t.startsWith(s) && (!best || s.length > best.len)) best = { v, len: s.length };
      }
    }
    if (best && best.len >= Math.min(3, t.length - 1)) return { token: t, entry: strip(best.v), match: 'stem' };
    return { token: t, entry: null };
  }

  return { published, invalidate, validate, create, update, setStatus, remove, get, browse, daily, lists, listDetail, search, suggest, lookup, detectLang };
}

function strip(v) {
  const o = {};
  for (const [k, val] of Object.entries(v)) if (!k.startsWith('_')) o[k] = val;
  return o;
}

export function toInput(v) {
  return {
    tamil: v.tamil, transliteration: v.transliteration, pronunciation: v.pronunciation, english: v.english, alt_english: v.altEnglish,
    hindi: v.hindi, malayalam: v.malayalam, part_of_speech: v.partOfSpeech, level: v.level, topic_id: v.topicId, register: v.register,
    dialect: v.dialect, examples: v.examples, collocations: v.collocations, synonyms: v.synonyms, antonyms: v.antonyms, related: v.related, forms: v.forms,
  };
}

export { stripDiacritics };
