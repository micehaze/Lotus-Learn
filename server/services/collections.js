import crypto from 'node:crypto';
import { transliterate, validateTamil, normalizeText } from '../../shared/tamil.js';
import { bad, notFound, conflict, parseJSON, j } from '../util.js';
import { masteryView } from './mastery.js';
import { markTarget } from './vocabulary.js';
import { SESSION_MAX_WORDS } from './meta.js';

const SOURCES = ['manual', 'library', 'story', 'video', 'dictionary', 'list'];

function rowToWord(r) {
  return {
    id: r.id, collectionId: r.collection_id, vocabularyId: r.vocabulary_id, wordKey: r.word_key,
    tamil: r.tamil, transliteration: r.transliteration, english: r.english, hindi: r.hindi, malayalam: r.malayalam,
    partOfSpeech: r.part_of_speech, topicId: r.topic_id, topic: r.topic_name || null,
    examples: parseJSON(r.examples, []), collocations: parseJSON(r.collocations, []), synonyms: parseJSON(r.synonyms, []),
    forms: parseJSON(r.forms, {}), notes: r.notes, source: r.source, sourceRef: r.source_ref,
    selected: !!r.selected, mastery: masteryView(r), createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const WORD_SELECT = `SELECT cw.*, t.name AS topic_name, m.successful_days, m.current_correct, m.total_correct, m.total_incorrect, m.last_reward_date,
  (SELECT 1 FROM selections s WHERE s.user_id = cw.user_id AND s.collection_word_id = cw.id) AS selected
  FROM collection_words cw LEFT JOIN topics t ON t.id = cw.topic_id
  LEFT JOIN word_mastery m ON m.user_id = cw.user_id AND m.word_key = cw.word_key`;

/** Validate a learner-entered word (manual add / edit / saved from reading). */
export function validateCustomWord(input) {
  const problems = [];
  const tamil = String(input.tamil || '').normalize('NFC').trim();
  const english = String(input.english || '').trim();
  if (!tamil) problems.push('Tamil word is required');
  else { const p = validateTamil(tamil); if (p.length) problems.push(`Tamil word: ${p.join(', ')}`); }
  if (tamil.length > 120) problems.push('Tamil word is too long');
  if (!english) problems.push('English translation is required');
  const examples = [];
  const exIn = Array.isArray(input.examples) ? input.examples : input.exampleTa ? [{ ta: input.exampleTa, en: input.exampleEn }] : [];
  for (const e of exIn.slice(0, 5)) {
    const ta = markTarget(e?.ta, tamil);
    if (!ta) continue;
    if (validateTamil(ta.replace(/\[\[|\]\]/g, '')).length) { problems.push('Example sentence must be written in Tamil script'); continue; }
    examples.push({ ta: ta.slice(0, 300), en: String(e.en || '').trim().slice(0, 300) });
  }
  const collocations = [];
  const coIn = Array.isArray(input.collocations) ? input.collocations : typeof input.collocations === 'string' ? input.collocations.split('\n') : [];
  for (const c of coIn.slice(0, 8)) {
    let ta = '', en = '';
    if (typeof c === 'string') { [ta, en = ''] = c.split(/\s[—–-]\s|\|/); } else if (c) { ta = c.ta; en = c.en; }
    ta = markTarget(String(ta || '').trim(), tamil);
    if (!ta) continue;
    if (validateTamil(ta.replace(/\[\[|\]\]/g, '')).length) { problems.push('Collocations must be written in Tamil script'); continue; }
    collocations.push({ ta: ta.slice(0, 200), en: String(en || '').trim().slice(0, 200) });
  }
  const synonyms = (Array.isArray(input.synonyms) ? input.synonyms : String(input.synonyms || '').split(/[,;\n]/))
    .map((s) => String(s).trim()).filter(Boolean).slice(0, 10);
  if (problems.length) throw bad('Word is invalid', { problems });
  return {
    tamil, english: english.slice(0, 200),
    transliteration: String(input.transliteration || '').trim().slice(0, 120) || transliterate(tamil),
    hindi: String(input.hindi || '').trim().slice(0, 200), malayalam: String(input.malayalam || '').trim().slice(0, 200),
    notes: String(input.notes || '').trim().slice(0, 500), examples, collocations, synonyms,
  };
}

export function createCollectionsService({ db, clock, meta, vocabulary }) {
  const now = () => clock.now().toISOString();
  const own = (userId, id) => {
    const c = db.get('SELECT * FROM collections WHERE id = ? AND user_id = ?', id, userId);
    if (!c) throw notFound('Collection not found');
    return c;
  };

  function list(userId, q = '') {
    const rows = db.all(`SELECT c.*, COUNT(cw.id) AS word_count,
        SUM(CASE WHEN COALESCE(m.successful_days,0) = 0 THEN 1 ELSE 0 END) AS no_lotus,
        SUM(CASE WHEN m.successful_days BETWEEN 1 AND 4 THEN 1 ELSE 0 END) AS growing,
        SUM(CASE WHEN m.successful_days >= 5 THEN 1 ELSE 0 END) AS bloomed
      FROM collections c LEFT JOIN collection_words cw ON cw.collection_id = c.id
      LEFT JOIN word_mastery m ON m.user_id = c.user_id AND m.word_key = cw.word_key
      WHERE c.user_id = ? GROUP BY c.id ORDER BY c.updated_at DESC, c.id DESC`, userId);
    let items = rows.map((c) => ({
      id: c.id, title: c.title, description: c.description, wordCount: c.word_count,
      lotus: { none: c.no_lotus || 0, growing: c.growing || 0, bloomed: c.bloomed || 0 }, createdAt: c.created_at, updatedAt: c.updated_at,
    }));
    const preview = db.all(`SELECT collection_id, tamil FROM (SELECT collection_id, tamil, ROW_NUMBER() OVER (PARTITION BY collection_id ORDER BY id DESC) AS rn FROM collection_words WHERE user_id = ?) WHERE rn <= 4`, userId);
    const byC = new Map();
    for (const p of preview) { if (!byC.has(p.collection_id)) byC.set(p.collection_id, []); byC.get(p.collection_id).push(p.tamil); }
    items.forEach((c) => { c.preview = byC.get(c.id) || []; });
    let matches = [];
    if (q && q.trim()) {
      const qq = q.trim();
      matches = searchWords(userId, qq);
      const hit = new Set(matches.map((m) => m.collectionId));
      items = items.filter((c) => normalizeText(c.title).includes(normalizeText(qq)) || hit.has(c.id));
    }
    return { collections: items, matches, limit: meta.getSettings().collection_word_limit };
  }

  function searchWords(userId, q) {
    const like = `%${String(q).trim().toLowerCase()}%`;
    return db.all(`${WORD_SELECT} WHERE cw.user_id = ? AND (cw.tamil LIKE ? OR lower(cw.english) LIKE ? OR lower(cw.transliteration) LIKE ?) ORDER BY cw.tamil LIMIT 100`,
      userId, `%${String(q).trim()}%`, like, like).map(rowToWord)
      .map((w) => ({ ...w, collectionTitle: db.get('SELECT title FROM collections WHERE id = ?', w.collectionId)?.title }));
  }

  function create(userId, { title, description = '', words = [] }) {
    const t = String(title || '').trim();
    if (!t) throw bad('Collection name is required');
    if (t.length > 80) throw bad('Collection name is too long (80 characters max)');
    return db.tx(() => {
      const ts = now();
      const r = db.run('INSERT INTO collections(user_id, title, description, created_at, updated_at) VALUES (?,?,?,?,?)', userId, t, String(description).trim().slice(0, 500), ts, ts);
      const id = Number(r.lastInsertRowid);
      if (Array.isArray(words) && words.length) for (const w of words) addCustom(userId, id, w);
      return id;
    });
  }

  function get(userId, id, q = '') {
    const c = own(userId, id);
    let words = db.all(`${WORD_SELECT} WHERE cw.collection_id = ? AND cw.user_id = ? ORDER BY cw.created_at DESC, cw.id DESC`, id, userId).map(rowToWord);
    if (q && q.trim()) {
      const n = normalizeText(q);
      words = words.filter((w) => normalizeText(w.tamil).includes(n) || normalizeText(w.english).includes(n) || normalizeText(w.transliteration).includes(n));
    }
    return { id: c.id, title: c.title, description: c.description, createdAt: c.created_at, updatedAt: c.updated_at, words, limit: meta.getSettings().collection_word_limit };
  }

  function update(userId, id, { title, description }) {
    const c = own(userId, id);
    const t = title === undefined ? c.title : String(title).trim();
    if (!t) throw bad('Collection name is required');
    if (t.length > 80) throw bad('Collection name is too long (80 characters max)');
    db.run('UPDATE collections SET title = ?, description = ?, updated_at = ? WHERE id = ?', t, description === undefined ? c.description : String(description).trim().slice(0, 500), now(), id);
  }

  function remove(userId, id) {
    own(userId, id);
    db.run('DELETE FROM collections WHERE id = ? AND user_id = ?', id, userId);
  }

  function assertCapacity(collectionId, adding) {
    const limit = meta.getSettings().collection_word_limit;
    const n = db.get('SELECT COUNT(*) AS n FROM collection_words WHERE collection_id = ?', collectionId).n;
    if (n + adding > limit) throw conflict(`This collection can hold ${limit} words. It has ${n}, so ${Math.max(0, limit - n)} more can be added.`, { limit, current: n, attempted: adding });
  }

  function addCustom(userId, collectionId, input) {
    own(userId, collectionId);
    const w = validateCustomWord(input);
    const source = SOURCES.includes(input.source) ? input.source : 'manual';
    return db.tx(() => {
      assertCapacity(collectionId, 1);
      const ts = now();
      const dup = db.get('SELECT id FROM collection_words WHERE collection_id = ? AND tamil = ? AND lower(english) = lower(?)', collectionId, w.tamil, w.english);
      if (dup) throw conflict('This word is already in the collection', { duplicate: true, wordId: dup.id });
      const r = db.run(`INSERT INTO collection_words(collection_id, user_id, vocabulary_id, word_key, tamil, transliteration, english, hindi, malayalam, part_of_speech, examples, collocations, synonyms, notes, source, source_ref, created_at, updated_at)
        VALUES (?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, collectionId, userId, `m:${crypto.randomUUID()}`, w.tamil, w.transliteration, w.english, w.hindi, w.malayalam,
        String(input.partOfSpeech || ''), j(w.examples), j(w.collocations), j(w.synonyms), w.notes, source, input.sourceRef ? String(input.sourceRef).slice(0, 200) : null, ts, ts);
      db.run('UPDATE collections SET updated_at = ? WHERE id = ?', ts, collectionId);
      return Number(r.lastInsertRowid);
    });
  }

  function addFromLibrary(userId, collectionId, vocabularyIds, { source = 'library', sourceRef = null } = {}) {
    own(userId, collectionId);
    const ids = [...new Set((vocabularyIds || []).map(Number).filter(Number.isInteger))];
    if (!ids.length) throw bad('No words to add');
    const words = ids.map((id) => vocabulary.get(id)).filter(Boolean);
    if (words.length !== ids.length) throw notFound('One or more library words were not found');
    return db.tx(() => {
      const existing = new Set(db.all('SELECT word_key FROM collection_words WHERE collection_id = ?', collectionId).map((r) => r.word_key));
      const fresh = words.filter((v) => !existing.has(`v${v.id}`));
      assertCapacity(collectionId, fresh.length);
      const ts = now();
      for (const v of fresh) {
        db.run(`INSERT INTO collection_words(collection_id, user_id, vocabulary_id, word_key, tamil, transliteration, english, hindi, malayalam, part_of_speech, topic_id, examples, collocations, synonyms, forms, source, source_ref, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, collectionId, userId, v.id, `v${v.id}`, v.tamil, v.transliteration, v.english, v.hindi, v.malayalam,
          v.partOfSpeech, v.topicId, j(v.examples), j(v.collocations), j(v.synonyms), j(v.forms), SOURCES.includes(source) ? source : 'library', sourceRef, ts, ts);
      }
      db.run('UPDATE collections SET updated_at = ? WHERE id = ?', ts, collectionId);
      return { added: fresh.length, skipped: words.length - fresh.length };
    });
  }

  function updateWord(userId, collectionId, wordId, input) {
    own(userId, collectionId);
    const cur = db.get('SELECT * FROM collection_words WHERE id = ? AND collection_id = ? AND user_id = ?', wordId, collectionId, userId);
    if (!cur) throw notFound('Word not found');
    const merged = {
      tamil: cur.tamil, english: cur.english, transliteration: cur.transliteration, hindi: cur.hindi, malayalam: cur.malayalam, notes: cur.notes,
      examples: parseJSON(cur.examples, []), collocations: parseJSON(cur.collocations, []), synonyms: parseJSON(cur.synonyms, []), ...input,
    };
    if (input.tamil !== undefined && input.transliteration === undefined && input.tamil !== cur.tamil) merged.transliteration = '';
    const w = validateCustomWord(merged);
    db.run(`UPDATE collection_words SET tamil=?, transliteration=?, english=?, hindi=?, malayalam=?, examples=?, collocations=?, synonyms=?, notes=?, updated_at=? WHERE id=?`,
      w.tamil, w.transliteration, w.english, w.hindi, w.malayalam, j(w.examples), j(w.collocations), j(w.synonyms), w.notes, now(), wordId);
  }

  function deleteWord(userId, collectionId, wordId) {
    own(userId, collectionId);
    const r = db.run('DELETE FROM collection_words WHERE id = ? AND collection_id = ? AND user_id = ?', wordId, collectionId, userId);
    if (!r.changes) throw notFound('Word not found');
  }

  // ------------------------------------------------------------- selection (persisted server-side)
  function getSelection(userId) {
    const items = db.all(`SELECT cw.*, c.title AS collection_title, m.successful_days, m.current_correct, m.total_correct, m.total_incorrect, m.last_reward_date, 1 AS selected
      FROM selections s JOIN collection_words cw ON cw.id = s.collection_word_id AND cw.user_id = s.user_id
      JOIN collections c ON c.id = cw.collection_id
      LEFT JOIN word_mastery m ON m.user_id = cw.user_id AND m.word_key = cw.word_key
      WHERE s.user_id = ? ORDER BY s.created_at, s.collection_word_id`, userId)
      .map((r) => ({ ...rowToWord(r), collectionTitle: r.collection_title }));
    return { items, count: items.length, max: SESSION_MAX_WORDS, expectedQuestions: items.length * 10 };
  }

  function addToSelection(userId, ids) {
    const want = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
    if (!want.length) throw bad('Nothing to select');
    return db.tx(() => {
      const rows = want.map((id) => db.get('SELECT id, word_key FROM collection_words WHERE id = ? AND user_id = ?', id, userId));
      if (rows.some((r) => !r)) throw notFound('One or more words were not found');
      const current = db.all('SELECT cw.word_key FROM selections s JOIN collection_words cw ON cw.id = s.collection_word_id WHERE s.user_id = ?', userId);
      const keys = new Set(current.map((r) => r.word_key));
      const fresh = []; let duplicates = 0;
      for (const r of rows) { if (keys.has(r.word_key)) { duplicates++; continue; } keys.add(r.word_key); fresh.push(r); }
      if (current.length + fresh.length > SESSION_MAX_WORDS) {
        throw conflict(`A session can contain at most ${SESSION_MAX_WORDS} words. You have ${current.length} selected, so you can add ${SESSION_MAX_WORDS - current.length} more. Nothing was changed.`,
          { max: SESSION_MAX_WORDS, current: current.length, attempted: fresh.length, remaining: SESSION_MAX_WORDS - current.length });
      }
      const ts = now();
      for (const r of fresh) db.run('INSERT OR IGNORE INTO selections(user_id, collection_word_id, created_at) VALUES (?,?,?)', userId, r.id, ts);
      return { added: fresh.length, duplicates, count: current.length + fresh.length };
    });
  }

  function selectCollection(userId, collectionId) {
    own(userId, collectionId);
    const ids = db.all('SELECT id FROM collection_words WHERE collection_id = ? AND user_id = ? ORDER BY id', collectionId, userId).map((r) => r.id);
    if (!ids.length) throw bad('This collection has no words yet');
    return addToSelection(userId, ids);
  }

  function removeFromSelection(userId, ids) {
    for (const id of [].concat(ids)) db.run('DELETE FROM selections WHERE user_id = ? AND collection_word_id = ?', userId, Number(id));
    return { count: db.get('SELECT COUNT(*) AS n FROM selections WHERE user_id = ?', userId).n };
  }
  function clearSelection(userId) {
    db.run('DELETE FROM selections WHERE user_id = ?', userId);
    return { count: 0 };
  }

  return { list, searchWords, create, get, update, remove, addCustom, addFromLibrary, updateWord, deleteWord, getSelection, addToSelection, selectCollection, removeFromSelection, clearSelection, own };
}
