import { localDate, addDays } from '../util.js';
import { masteryScore, lotusStage } from './mastery.js';

export function computeStreak(dates, today) {
  const set = new Set(dates);
  let current = 0;
  let d = set.has(today) ? today : addDays(today, -1);
  while (set.has(d)) { current++; d = addDays(d, -1); }
  const sorted = [...set].sort();
  let longest = 0, run = 0, prev = null;
  for (const x of sorted) { run = prev && addDays(prev, 1) === x ? run + 1 : 1; longest = Math.max(longest, run); prev = x; }
  return { current, longest, activeToday: set.has(today) };
}

export function createStatsService({ db, clock, collections }) {
  const tzOf = (userId) => db.get('SELECT timezone FROM user_profiles WHERE user_id = ?', userId)?.timezone || 'UTC';

  function summarize(words) {
    const total = words.length;
    const none = words.filter((w) => w.lotus === 0).length;
    const growing = words.filter((w) => w.lotus >= 1 && w.lotus <= 4).length;
    const bloomed = words.filter((w) => w.lotus >= 5).length;
    const avg = total ? Math.round(words.reduce((a, w) => a + w.score, 0) / total) : 0;
    return { totalWords: total, withoutLotus: none, growing, bloomed, averageMastery: avg };
  }

  function collectionStats(userId, id) {
    const c = collections.own(userId, id);
    const words = db.all(`SELECT cw.id, cw.tamil, cw.transliteration, cw.english, cw.word_key, m.successful_days, m.current_correct, m.total_correct, m.total_incorrect
      FROM collection_words cw LEFT JOIN word_mastery m ON m.user_id = cw.user_id AND m.word_key = cw.word_key
      WHERE cw.collection_id = ? AND cw.user_id = ? ORDER BY cw.tamil`, id, userId).map((r) => ({
      id: r.id, tamil: r.tamil, transliteration: r.transliteration, english: r.english,
      lotus: lotusStage(r.successful_days), score: masteryScore(r), totalCorrect: r.total_correct || 0, totalIncorrect: r.total_incorrect || 0,
    }));
    return { collection: { id: c.id, title: c.title }, summary: summarize(words), words };
  }

  function globalStats(userId, lang = 'ta') {
    const rows = db.all(`SELECT c.id, c.title, cw.word_key, m.successful_days, m.current_correct
      FROM collections c LEFT JOIN collection_words cw ON cw.collection_id = c.id
      LEFT JOIN word_mastery m ON m.user_id = c.user_id AND m.word_key = cw.word_key
      WHERE c.user_id = ? AND c.lang = ? ORDER BY c.title`, userId, lang);
    const byC = new Map();
    const uniqueWords = new Map();
    for (const r of rows) {
      if (!byC.has(r.id)) byC.set(r.id, { id: r.id, title: r.title, words: [] });
      if (r.word_key) {
        const w = { lotus: lotusStage(r.successful_days), score: masteryScore(r) };
        byC.get(r.id).words.push(w);
        uniqueWords.set(r.word_key, w);
      }
    }
    const cols = [...byC.values()].map((c) => ({ id: c.id, title: c.title, wordCount: c.words.length, score: c.words.length ? Math.round(c.words.reduce((a, w) => a + w.score, 0) / c.words.length) : 0, bloomed: c.words.filter((w) => w.lotus >= 5).length }));
    const nonEmpty = cols.filter((c) => c.wordCount > 0);
    const sorted = [...nonEmpty].sort((a, b) => b.score - a.score);
    const all = [...uniqueWords.values()];
    return {
      collections: cols,
      summary: {
        collections: cols.length,
        vocabularySize: all.length,
        bloomed: all.filter((w) => w.lotus >= 5).length,
        averageMastery: all.length ? Math.round(all.reduce((a, w) => a + w.score, 0) / all.length) : 0,
        strongest: sorted[0] || null,
        needsPractice: sorted.length > 1 ? sorted[sorted.length - 1] : null,
      },
    };
  }

  function overview(userId, lang = 'ta') {
    const tz = tzOf(userId);
    const today = localDate(clock.now(), tz);
    const answers = db.all('SELECT a.answered_at, a.is_correct, a.question_type FROM learning_answers a JOIN learning_sessions s ON s.id = a.session_id WHERE a.user_id = ? AND s.lang = ? ORDER BY a.answered_at', userId, lang);
    const days = new Map();
    const byType = {};
    for (const a of answers) {
      const d = localDate(a.answered_at, tz);
      const e = days.get(d) || { date: d, correct: 0, incorrect: 0 };
      e[a.is_correct ? 'correct' : 'incorrect']++;
      days.set(d, e);
      byType[a.question_type] = byType[a.question_type] || { correct: 0, incorrect: 0 };
      byType[a.question_type][a.is_correct ? 'correct' : 'incorrect']++;
    }
    const activeDates = [...days.values()].filter((d) => d.correct > 0).map((d) => d.date);
    const streak = computeStreak(activeDates, today);
    const last30 = [];
    for (let i = 29; i >= 0; i--) { const d = addDays(today, -i); last30.push(days.get(d) || { date: d, correct: 0, incorrect: 0 }); }
    const rewards = db.all('SELECT reward_date, COUNT(*) AS n FROM lotus_rewards WHERE user_id = ? AND lang = ? GROUP BY reward_date', userId, lang);
    const rewardsByDate = Object.fromEntries(rewards.map((r) => [r.reward_date, r.n]));
    last30.forEach((d) => { d.lotuses = rewardsByDate[d.date] || 0; });
    const sessions = db.get("SELECT COUNT(*) AS total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed FROM learning_sessions WHERE user_id = ? AND lang = ?", userId, lang);
    const mastery = db.all('SELECT successful_days FROM word_mastery WHERE user_id = ? AND lang = ?', userId, lang);
    const correct = answers.filter((a) => a.is_correct).length;
    const todayRow = days.get(today) || { correct: 0, incorrect: 0 };
    return {
      lang, today, streak,
      totals: {
        answers: answers.length, correct, accuracy: answers.length ? Math.round((correct / answers.length) * 100) : 0,
        sessions: sessions.total || 0, completedSessions: sessions.completed || 0,
        lotuses: rewards.reduce((a, r) => a + r.n, 0), bloomed: mastery.filter((m) => m.successful_days >= 5).length,
        wordsStudied: mastery.length, todayCorrect: todayRow.correct, todayAnswers: todayRow.correct + todayRow.incorrect,
      },
      last30, byType,
    };
  }

  return { collectionStats, globalStats, overview };
}
