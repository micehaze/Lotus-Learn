import { bad, notFound, parseJSON, seedFrom, addDays, j } from '../util.js';
import { strip } from './vocabulary.js';
import { isLang } from '../../shared/indic.js';

/** Closely related subject areas used to widen a narrow topic (semantic expansion). */
export const RELATED = {
  'food-and-cooking': ['health', 'shopping'], nature: ['weather', 'animals'], animals: ['nature'], weather: ['nature', 'time'], family: ['relationships', 'love-and-emotions'],
  relationships: ['family', 'love-and-emotions', 'personality'], 'love-and-emotions': ['relationships', 'personality'], 'daily-routines': ['time', 'food-and-cooking'],
  travel: ['transportation', 'culture'], transportation: ['travel'], education: ['communication', 'literature'], 'work-and-business': ['money', 'technology'],
  money: ['shopping', 'work-and-business'], shopping: ['money', 'food-and-cooking'], health: ['body-parts', 'food-and-cooking'], 'body-parts': ['health'],
  culture: ['religion', 'arts', 'music', 'literature'], religion: ['culture'], arts: ['culture', 'music'], music: ['arts', 'entertainment'], literature: ['education', 'arts'],
  communication: ['education', 'society'], society: ['politics', 'communication'], politics: ['society'], technology: ['communication', 'work-and-business'],
  entertainment: ['music', 'arts'], personality: ['appearance', 'love-and-emotions'], appearance: ['personality', 'body-parts'], time: ['daily-routines'], philosophy: ['literature', 'religion'],
};
/** Sub-areas used to guide generation when a topic needs more words. */
export const SUBTOPICS = {
  'food-and-cooking': ['foods and dishes', 'ingredients', 'fruits', 'vegetables', 'spices and seasonings', 'cooking utensils', 'kitchen equipment', 'cooking techniques', 'food textures and tastes', 'food verbs', 'storage', 'dining and serving'],
  nature: ['plants and trees', 'flowers', 'landforms', 'water bodies', 'sky and weather', 'animals', 'seasons'], family: ['relatives', 'family roles', 'home life', 'family events'],
  education: ['school places', 'subjects', 'study verbs', 'classroom objects', 'exams', 'people at school'],
};

/**
 * Daily Topic: one cohesive topic per language per (UTC) calendar day, built ONLY from published
 * library words tagged with that topic. If fewer than the minimum verified words exist, the topic is
 * published with an honest shortfall and is topped up later as new words are approved.
 */
export function createDailyTopicsService({ db, clock, meta, vocabulary }) {
  const today = () => clock.now().toISOString().slice(0, 10);
  const targets = () => { const s = meta.getSettings(); return { min: s.daily_topic_words_min, max: s.daily_topic_words_max }; };

  const slugToId = (slug) => meta.snapshot().topicsBySlug.get(slug)?.id;
  /** topic + its closely related subject areas, in priority order */
  const family = (topicId) => { const t = meta.snapshot().topicsById.get(topicId); return [topicId, ...(RELATED[t?.slug] || []).map(slugToId).filter(Boolean)]; };
  function candidates(lang) {
    const counts = new Map(db.all("SELECT topic_id, COUNT(*) AS n FROM vocabulary WHERE lang = ? AND status = 'published' AND topic_id IS NOT NULL GROUP BY topic_id", lang).map((r) => [r.topic_id, r.n]));
    return [...counts.keys()].map((tid) => ({ topic_id: tid, n: family(tid).reduce((a, f) => a + (counts.get(f) || 0), 0), own: counts.get(tid) })).filter((c) => c.own >= 4).sort((a, b) => b.n - a.n || b.own - a.own);
  }
  function wordsFor(lang, topicId, max) {
    const ids = [];
    for (const tid of family(topicId)) {
      for (const r of db.all(`SELECT id FROM vocabulary WHERE lang = ? AND status = 'published' AND topic_id = ? ORDER BY CASE level WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 ELSE 6 END, id`, lang, tid)) { if (ids.length >= max) break; if (!ids.includes(r.id)) ids.push(r.id); }
    }
    return ids;
  }

  /** Idempotent: UNIQUE(lang, topic_date) means concurrent tabs/schedulers can never create two topics. */
  function ensureFor(lang, date = today()) {
    if (!isLang(lang)) throw bad('Unknown language');
    const existing = db.get('SELECT * FROM daily_topics WHERE lang = ? AND topic_date = ?', lang, date);
    const { min, max } = targets();
    if (existing) { const wasPending = existing.status !== 'published'; topUp(existing, max, min); const now2 = db.get('SELECT * FROM daily_topics WHERE id = ?', existing.id); return { created: wasPending && now2.status === 'published', published: now2.status === 'published', id: existing.id, shortfall: now2.shortfall, topicId: now2.topic_id }; }
    const cands = candidates(lang);
    if (!cands.length) return { created: false, id: null, reason: 'no topic with enough words yet' };
    // prefer topics that are already complete (≥ min words incl. related subtopics)
    const complete = cands.filter((c) => c.n >= min);
    const recent = new Set(db.all('SELECT topic_id FROM daily_topics WHERE lang = ? AND topic_date >= ? AND topic_date < ?', lang, addDays(date, -Math.min(7, cands.length - 1)), date).map((r) => r.topic_id));
    const base = complete.length ? complete : cands.slice(0, 1);
    const pool = base.filter((c) => !recent.has(c.topic_id));
    const choice = (pool.length ? pool : base)[seedFrom(`${lang}:${date}`) % (pool.length || base.length)];
    const topic = meta.snapshot().topicsById.get(choice.topic_id);
    const ids = wordsFor(lang, choice.topic_id, max);
    const subs = family(choice.topic_id).slice(1).map((t) => meta.snapshot().topicsById.get(t)?.name).filter(Boolean);
    const status = ids.length >= min ? 'published' : 'pending'; // never publish an incomplete Daily Topic
    const ins = db.run('INSERT OR IGNORE INTO daily_topics(lang, topic_date, topic_id, title, description, word_count, target_min, shortfall, status, subtopics, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      lang, date, choice.topic_id, topic.name, `Everyday ${topic.name.toLowerCase()} vocabulary${subs.length ? `, with related words about ${subs.join(', ').toLowerCase()}` : ''}.`, ids.length, min, Math.max(0, min - ids.length), status, j(subs), clock.now().toISOString());
    if (!ins.changes) return { created: false, id: db.get('SELECT id FROM daily_topics WHERE lang = ? AND topic_date = ?', lang, date).id };
    const id = Number(ins.lastInsertRowid);
    ids.forEach((v, i) => db.run('INSERT OR IGNORE INTO daily_topic_words(daily_topic_id, vocabulary_id, position) VALUES (?,?,?)', id, v, i));
    return { created: status === 'published', published: status === 'published', id, shortfall: Math.max(0, min - ids.length), topic: topic.name, topicId: choice.topic_id };
  }

  function topUp(row, max, min) {
    if (row.word_count >= max || !row.topic_id) { if (row.word_count >= min && row.status !== 'published') db.run("UPDATE daily_topics SET status = 'published' WHERE id = ?", row.id); return 0; }
    const have = new Set(db.all('SELECT vocabulary_id FROM daily_topic_words WHERE daily_topic_id = ?', row.id).map((r) => r.vocabulary_id));
    const fresh = wordsFor(row.lang, row.topic_id, max).filter((v) => !have.has(v)).slice(0, max - row.word_count);
    fresh.forEach((v, i) => db.run('INSERT OR IGNORE INTO daily_topic_words(daily_topic_id, vocabulary_id, position) VALUES (?,?,?)', row.id, v, row.word_count + i));
    const n = db.get('SELECT COUNT(*) AS n FROM daily_topic_words WHERE daily_topic_id = ?', row.id).n;
    db.run("UPDATE daily_topics SET word_count = ?, shortfall = ?, status = CASE WHEN ? >= ? THEN 'published' ELSE status END WHERE id = ?", n, Math.max(0, min - n), n, min, row.id);
    return fresh.length;
  }

  function view(row, { level, limit } = {}) {
    if (!row) return null;
    let words = db.all(`SELECT v.*, t.name AS topic_name, t.slug AS topic_slug FROM daily_topic_words w JOIN vocabulary v ON v.id = w.vocabulary_id LEFT JOIN topics t ON t.id = v.topic_id
      WHERE w.daily_topic_id = ? AND v.status = 'published' ORDER BY w.position`, row.id).map((r) => strip(vocabulary.get(r.id) || {}));
    const order = meta.levelOrder();
    const all = words.length;
    if (level) { const i = order.indexOf(level); words = words.filter((w) => Math.abs(order.indexOf(w.level) - i) <= 1); }
    return {
      id: row.id, lang: row.lang, date: row.topic_date, title: row.title, description: row.description, topicId: row.topic_id,
      wordCount: row.word_count, subtopics: parseJSON(row.subtopics, []), levelFiltered: !!level, totalWords: all,
      words: limit ? words.slice(0, limit) : words, isToday: row.topic_date === today(),
    };
  }

  function todayTopic(lang, opts = {}) {
    ensureFor(lang);
    // only complete (published) topics are shown; if today's is still being prepared, show the latest complete one
    return view(db.get("SELECT * FROM daily_topics WHERE lang = ? AND status = 'published' AND topic_date <= ? ORDER BY topic_date DESC LIMIT 1", lang, today()), opts);
  }
  function get(id, opts) { const r = db.get("SELECT * FROM daily_topics WHERE id = ? AND status = 'published'", id); if (!r) throw notFound('Daily topic not found'); return view(r, opts); }
  const pendingFor = (lang) => db.get("SELECT * FROM daily_topics WHERE lang = ? AND topic_date = ? AND status != 'published'", lang, today());
  function archive(lang, { q, from, to, page = 1 } = {}) {
    const where = ['lang = ?', "status = 'published'"]; const args = [lang];
    if (q) { where.push('lower(title) LIKE ?'); args.push(`%${String(q).toLowerCase()}%`); }
    if (from) { where.push('topic_date >= ?'); args.push(from); }
    if (to) { where.push('topic_date <= ?'); args.push(to); }
    const size = 30; const p = Math.max(1, Number(page) || 1);
    const total = db.get(`SELECT COUNT(*) AS n FROM daily_topics WHERE ${where.join(' AND ')}`, ...args).n;
    const items = db.all(`SELECT * FROM daily_topics WHERE ${where.join(' AND ')} ORDER BY topic_date DESC LIMIT ? OFFSET ?`, ...args, size, (p - 1) * size)
      .map((r) => ({ id: r.id, date: r.topic_date, title: r.title, wordCount: r.word_count, shortfall: r.shortfall, isToday: r.topic_date === today() }));
    return { items, total, page: p, pages: Math.max(1, Math.ceil(total / size)) };
  }
  /** Administrator: create or replace the topic for a date with hand-picked library words. */
  function adminSet(lang, { date, topicId, title, description = '', vocabularyIds = [] }) {
    if (!isLang(lang)) throw bad('Unknown language');
    const d = String(date || today());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw bad('Date must look like YYYY-MM-DD');
    const topic = meta.snapshot().topicsById.get(Number(topicId));
    if (!topic) throw bad('Choose a topic');
    const ids = [...new Set(vocabularyIds.map(Number))];
    const rows = ids.map((i) => db.get("SELECT id, lang, topic_id FROM vocabulary WHERE id = ? AND status = 'published'", i));
    if (rows.some((r) => !r || r.lang !== lang)) throw bad('Every word must be a published library word of this language');
    const { min, max } = targets();
    if (ids.length > max) throw bad(`A daily topic holds at most ${max} words`);
    if (ids.length < min) throw bad(`A published Daily Topic needs at least ${min} words (this has ${ids.length}).`);
    return db.tx(() => {
      db.run('DELETE FROM daily_topics WHERE lang = ? AND topic_date = ?', lang, d);
      const r = db.run('INSERT INTO daily_topics(lang, topic_date, topic_id, title, description, word_count, target_min, shortfall, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        lang, d, topic.id, String(title || topic.name).slice(0, 120), String(description).slice(0, 500), ids.length, min, Math.max(0, min - ids.length), 'admin', clock.now().toISOString());
      const id = Number(r.lastInsertRowid);
      ids.forEach((v, i) => db.run('INSERT INTO daily_topic_words(daily_topic_id, vocabulary_id, position) VALUES (?,?,?)', id, v, i));
      return id;
    });
  }
  return { pendingFor, family, ensureFor, today: todayTopic, get, archive, adminSet, topUpToday: (lang) => { const r = db.get('SELECT * FROM daily_topics WHERE lang = ? AND topic_date = ?', lang, today()); const t = targets(); return r ? topUp(r, t.max, t.min) : 0; } };
}
