// "Learnt" vocabulary: a word is learnt once the learner answered it correctly at least 10 times
// on each of 3 distinct calendar learning days (≥ 30 correct answers). Incorrect answers never count,
// and 30 correct answers on a single day are still only one qualifying day.
import { localDate, parseJSON, j } from '../util.js';
import { masteryView } from './mastery.js';

export const LEARNT_DAYS = 3;
export const LEARNT_PER_DAY = 10;

export function createLearntService({ db, clock }) {
  const tzOf = (userId) => db.get('SELECT timezone FROM user_profiles WHERE user_id = ?', userId)?.timezone || 'UTC';

  function recompute(userId, lang) {
    const tz = tzOf(userId);
    const rows = db.all(`SELECT sw.word_key, a.answered_at FROM learning_answers a JOIN session_words sw ON sw.id = a.session_word_id
      JOIN learning_sessions s ON s.id = a.session_id WHERE a.user_id = ? AND s.lang = ? AND a.is_correct = 1`, userId, lang);
    const per = new Map();
    for (const r of rows) {
      const d = localDate(r.answered_at, tz);
      if (!per.has(r.word_key)) per.set(r.word_key, new Map());
      const m = per.get(r.word_key); m.set(d, (m.get(d) || 0) + 1);
    }
    let added = 0;
    db.tx(() => {
      for (const [key, days] of per) {
        const qualifying = [...days.entries()].filter(([, n]) => n >= LEARNT_PER_DAY).sort(([a], [b]) => a.localeCompare(b));
        if (qualifying.length < LEARNT_DAYS) continue;
        const total = qualifying.reduce((a, [, n]) => a + n, 0);
        const r = db.run(`INSERT INTO word_learnt(user_id, word_key, lang, qualified_at, qualifying_days, total_correct, updated_at) VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(user_id, word_key) DO UPDATE SET qualifying_days = excluded.qualifying_days, total_correct = excluded.total_correct, updated_at = excluded.updated_at`,
          userId, key, lang, qualifying[LEARNT_DAYS - 1][0], j(qualifying.map(([d, n]) => ({ date: d, correct: n }))), total, clock.now().toISOString());
        if (r.changes && !db.get('SELECT 1 FROM word_learnt WHERE user_id = ? AND word_key = ? AND updated_at != qualified_at', userId, key)) added++;
      }
    });
    return added;
  }

  /** Learnt words with their (unchanged) collections and lotus progress. Words are never copied. */
  function list(userId, lang) {
    recompute(userId, lang);
    return db.all('SELECT * FROM word_learnt WHERE user_id = ? AND lang = ? ORDER BY qualified_at DESC', userId, lang).map((l) => {
      const words = db.all(`SELECT cw.*, c.title AS collection_title FROM collection_words cw JOIN collections c ON c.id = cw.collection_id WHERE cw.user_id = ? AND cw.word_key = ?`, userId, l.word_key);
      const m = db.get('SELECT * FROM word_mastery WHERE user_id = ? AND word_key = ?', userId, l.word_key);
      const w = words[0];
      return {
        wordKey: l.word_key, qualifiedAt: l.qualified_at, qualifyingDays: parseJSON(l.qualifying_days, []), totalCorrect: l.total_correct,
        tamil: w?.tamil || '', transliteration: w?.transliteration || '', english: w?.english || '', vocabularyId: w?.vocabulary_id || null,
        collections: words.map((x) => ({ id: x.collection_id, title: x.collection_title })), mastery: masteryView(m),
      };
    });
  }
  /** Re-evaluate historical records for everyone (run at start-up). */
  function backfill() {
    let n = 0;
    for (const r of db.all('SELECT DISTINCT a.user_id, s.lang FROM learning_answers a JOIN learning_sessions s ON s.id = a.session_id')) n += recompute(r.user_id, r.lang);
    return n;
  }
  return { recompute, list, backfill };
}
