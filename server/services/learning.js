import { normalizeText, stripMarkers } from '../../shared/tamil.js';
import { bad, notFound, conflict, parseJSON, j, shuffle, weightedPick, localDate } from '../util.js';
import { CORRECT_PER_WORD, SESSION_MAX_WORDS } from './meta.js';
import { lotusStage, masteryView } from './mastery.js';

export const DEFAULT_PLAN = { collocation: 3, ta_en: 2, en_ta: 2, sentence: 3 };
export const TYPES = Object.keys(DEFAULT_PLAN);
export const BLANK = '＿＿＿';

/** Usable gap-fill contexts for a word (collocations or example sentences). */
export function contextsFor(snap, kind) {
  const list = kind === 'collocation' ? snap.collocations : snap.examples;
  const out = [];
  (list || []).forEach((c, i) => {
    if (!c?.ta) return;
    const m = c.ta.match(/\[\[(.+?)\]\]/);
    let answer, display;
    if (m) { answer = m[1]; display = c.ta.replace(m[0], BLANK); }
    else if (snap.tamil && c.ta.includes(snap.tamil)) { answer = snap.tamil; display = c.ta.replace(snap.tamil, BLANK); }
    else return;
    out.push({ ref: `${kind}:${i}`, answer, display: stripMarkers(display), en: c.en || '', form: c.form || null });
  });
  return out;
}

/** Default 3/2/2/3 distribution; unavailable types are redistributed to valid ones (PRD §10.3). */
export function buildPlan(snap) {
  const avail = {
    collocation: contextsFor(snap, 'collocation').length > 0,
    sentence: contextsFor(snap, 'sentence').length > 0,
    ta_en: !!snap.english,
    en_ta: !!snap.english,
  };
  const plan = {};
  let leftover = 0;
  for (const [t, n] of Object.entries(DEFAULT_PLAN)) { if (avail[t]) plan[t] = n; else { plan[t] = 0; leftover += n; } }
  const order = ['sentence', 'collocation', 'ta_en', 'en_ta'].filter((t) => avail[t]);
  for (let k = 0; leftover > 0 && order.length; k++, leftover--) plan[order[k % order.length]]++;
  return plan;
}

function meaningSet(w) {
  return new Set([w.english, ...(w.altEnglish || [])].map(normalizeText).filter(Boolean));
}
/** True when candidate could also be a correct answer for the target (synonym / shared meaning). */
function overlaps(target, cand) {
  if (normalizeText(cand.tamil) === normalizeText(target.tamil)) return true;
  if ((target.synonyms || []).some((s) => normalizeText(s) === normalizeText(cand.tamil))) return true;
  if ((cand.synonyms || []).some((s) => normalizeText(s) === normalizeText(target.tamil))) return true;
  const a = meaningSet(target), b = meaningSet(cand);
  for (const x of a) if (b.has(x)) return true;
  return false;
}

function pickDistractors(target, answer, pool, valueOf, rand, n = 3) {
  const same = [], other = [];
  const seen = new Set([normalizeText(answer)]);
  for (const c of shuffle(pool, rand)) {
    if (overlaps(target, c)) continue;
    const v = valueOf(c);
    if (!v) continue;
    const k = normalizeText(v);
    if (seen.has(k)) continue;
    seen.add(k);
    (c.partOfSpeech && c.partOfSpeech === target.partOfSpeech ? same : other).push(v);
  }
  return [...same, ...other].slice(0, n);
}

/**
 * Build one question of `type` for `snap`. Returns null when the type cannot be
 * generated reliably (caller then reallocates the quota to another type).
 */
export function makeQuestion(type, snap, pool, rand, usage = {}) {
  const others = pool.filter((p) => p.key !== snap.key);
  if (type === 'ta_en') {
    const d = pickDistractors(snap, snap.english, others, (c) => c.english, rand);
    if (d.length < 3) return null;
    return { type, ref: 'word', prompt: { instruction: 'Choose the correct English translation', text: snap.tamil, lang: 'ta', pos: snap.partOfSpeech }, answer: snap.english, options: shuffle([snap.english, ...d], rand) };
  }
  if (type === 'en_ta') {
    const d = pickDistractors(snap, snap.tamil, others, (c) => c.tamil, rand);
    if (d.length < 3) return null;
    return { type, ref: 'word', prompt: { instruction: 'Choose the correct Tamil translation', text: snap.english, lang: 'en', pos: snap.partOfSpeech }, answer: snap.tamil, options: shuffle([snap.tamil, ...d], rand) };
  }
  const kind = type === 'collocation' ? 'collocation' : 'sentence';
  const ctxs = contextsFor(snap, kind);
  if (!ctxs.length) return null;
  // least-used context first, so repeated practice varies the context
  const minUse = Math.min(...ctxs.map((c) => usage[c.ref] || 0));
  const fresh = shuffle(ctxs.filter((c) => (usage[c.ref] || 0) === minUse), rand);
  for (const ctx of [...fresh, ...shuffle(ctxs, rand)]) {
    let d;
    if (normalizeText(ctx.answer) === normalizeText(snap.tamil)) d = pickDistractors(snap, ctx.answer, others, (c) => c.tamil, rand);
    else if (ctx.form) d = pickDistractors(snap, ctx.answer, others.filter((c) => c.forms?.[ctx.form]), (c) => c.forms[ctx.form], rand);
    else d = [];
    if (d.length < 3) continue;
    return {
      type, ref: ctx.ref,
      prompt: { instruction: type === 'collocation' ? 'Complete the collocation' : 'Complete the sentence', text: ctx.display, hint: ctx.en, lang: 'ta' },
      answer: ctx.answer, options: shuffle([ctx.answer, ...d], rand),
    };
  }
  return null;
}

function snapshotFromRow(cw, vocab) {
  return {
    key: cw.word_key,
    tamil: cw.tamil, transliteration: cw.transliteration, english: cw.english,
    altEnglish: vocab?.altEnglish || [], partOfSpeech: cw.part_of_speech || vocab?.partOfSpeech || '',
    examples: parseJSON(cw.examples, []), collocations: parseJSON(cw.collocations, []),
    synonyms: parseJSON(cw.synonyms, []), forms: parseJSON(cw.forms, {}),
  };
}

export function createLearningService({ db, clock, vocabulary, rand = Math.random }) {
  const now = () => clock.now().toISOString();
  const tzOf = (userId) => db.get('SELECT timezone FROM user_profiles WHERE user_id = ?', userId)?.timezone || 'UTC';

  function ownSession(userId, id) {
    const s = db.get('SELECT * FROM learning_sessions WHERE id = ? AND user_id = ?', id, userId);
    if (!s) throw notFound('Session not found');
    return s;
  }
  function sessionWords(sessionId) {
    return db.all('SELECT * FROM session_words WHERE session_id = ? ORDER BY id', sessionId);
  }

  function active(userId) {
    const s = db.get("SELECT id FROM learning_sessions WHERE user_id = ? AND status = 'active'", userId);
    return s ? state(userId, s.id) : null;
  }

  function start(userId) {
    return db.tx(() => {
      const existing = db.get("SELECT id FROM learning_sessions WHERE user_id = ? AND status = 'active'", userId);
      if (existing) throw conflict('You already have a lesson in progress. Resume or end it first.', { sessionId: existing.id });
      const sel = db.all(`SELECT cw.*, c.title AS collection_title FROM selections s
        JOIN collection_words cw ON cw.id = s.collection_word_id AND cw.user_id = s.user_id
        JOIN collections c ON c.id = cw.collection_id WHERE s.user_id = ? ORDER BY s.created_at, cw.id`, userId);
      const seen = new Set();
      const words = sel.filter((w) => (seen.has(w.word_key) ? false : (seen.add(w.word_key), true)));
      if (words.length < 1) throw bad('Select at least one word to start a lesson.');
      if (words.length > SESSION_MAX_WORDS) throw bad(`A lesson can contain at most ${SESSION_MAX_WORDS} words.`);
      const ts = now();
      const r = db.run('INSERT INTO learning_sessions(user_id, status, word_count, started_at, last_activity_at) VALUES (?,?,?,?,?)', userId, 'active', words.length, ts, ts);
      const sessionId = Number(r.lastInsertRowid);
      for (const w of words) {
        const snap = snapshotFromRow(w, w.vocabulary_id ? vocabulary.get(w.vocabulary_id) : null);
        db.run('INSERT INTO session_words(session_id, word_key, collection_word_id, collection_id, collection_title, snapshot, plan) VALUES (?,?,?,?,?,?,?)',
          sessionId, w.word_key, w.id, w.collection_id, w.collection_title, j(snap), j(buildPlan(snap)));
      }
      db.run('DELETE FROM selections WHERE user_id = ?', userId);
      return sessionId;
    });
  }

  function state(userId, id) {
    const s = ownSession(userId, id);
    const words = sessionWords(id).map((w) => {
      const snap = parseJSON(w.snapshot, {});
      return { id: w.id, wordKey: w.word_key, tamil: snap.tamil, transliteration: snap.transliteration, english: snap.english, collectionTitle: w.collection_title, correct: w.correct_count, incorrect: w.incorrect_count, completed: !!w.completed_at };
    });
    const correct = words.reduce((a, w) => a + w.correct, 0);
    const answered = db.get('SELECT COUNT(*) AS n FROM learning_answers WHERE session_id = ?', id).n;
    return {
      id: s.id, status: s.status, startedAt: s.started_at, completedAt: s.completed_at, wordCount: s.word_count,
      required: s.word_count * CORRECT_PER_WORD, correct, answered, incorrect: answered - correct,
      wordsCompleted: words.filter((w) => w.completed).length, words,
    };
  }

  function publicQuestion(q, sw) {
    const snap = parseJSON(sw.snapshot, {});
    return {
      id: q.id, type: q.question_type, prompt: parseJSON(q.prompt, {}), options: parseJSON(q.options, []),
      word: { sessionWordId: sw.id, correct: sw.correct_count, required: CORRECT_PER_WORD, transliteration: snap.transliteration },
    };
  }

  function buildPool(words) {
    const pool = words.map((w) => parseJSON(w.snapshot, {}));
    const keys = new Set(pool.map((p) => p.key));
    for (const v of vocabulary.published()) {
      const key = `v${v.id}`;
      if (keys.has(key)) continue;
      pool.push({ key, tamil: v.tamil, english: v.english, altEnglish: v.altEnglish, partOfSpeech: v.partOfSpeech, synonyms: v.synonyms, forms: v.forms });
    }
    return pool;
  }

  function nextQuestion(userId, id) {
    return db.tx(() => {
      const s = ownSession(userId, id);
      if (s.status !== 'active') return { status: s.status, question: null };
      if (s.current_question_id) {
        const q = db.get('SELECT * FROM learning_questions WHERE id = ? AND answered_at IS NULL', s.current_question_id);
        if (q) return { status: 'active', question: publicQuestion(q, db.get('SELECT * FROM session_words WHERE id = ?', q.session_word_id)) };
      }
      const words = sessionWords(id);
      const incomplete = words.filter((w) => w.correct_count < CORRECT_PER_WORD);
      if (!incomplete.length) return { status: s.status, question: null };
      // mix words: avoid asking the same word twice in a row when there is a choice
      const candidates = incomplete.length > 1 ? incomplete.filter((w) => w.id !== s.last_session_word_id) : incomplete;
      const pool = buildPool(words);
      for (let attempt = 0; attempt < candidates.length + 2; attempt++) {
        const sw = weightedPick(candidates, (w) => CORRECT_PER_WORD - w.correct_count + 2, rand);
        const snap = parseJSON(sw.snapshot, {});
        const plan = parseJSON(sw.plan, DEFAULT_PLAN);
        const done = parseJSON(sw.type_correct, {});
        const usage = Object.fromEntries(db.all('SELECT context_ref, COUNT(*) AS n FROM learning_questions WHERE session_word_id = ? GROUP BY context_ref', sw.id).map((r) => [r.context_ref, r.n]));
        let types = TYPES.filter((t) => (plan[t] || 0) - (done[t] || 0) > 0);
        let q = null;
        while (types.length && !q) {
          const t = weightedPick(types, (x) => (plan[x] || 0) - (done[x] || 0), rand);
          q = makeQuestion(t, snap, pool, rand, usage);
          if (!q) {
            // cannot build this type reliably: move its remaining quota elsewhere
            const remaining = (plan[t] || 0) - (done[t] || 0);
            plan[t] = done[t] || 0;
            const alt = ['ta_en', 'en_ta', 'collocation', 'sentence'].find((x) => x !== t && types.includes(x)) || (t !== 'ta_en' ? 'ta_en' : 'en_ta');
            plan[alt] = (plan[alt] || 0) + remaining;
            db.run('UPDATE session_words SET plan = ? WHERE id = ?', j(plan), sw.id);
            types = TYPES.filter((x) => x !== t && (plan[x] || 0) - (done[x] || 0) > 0);
          }
        }
        if (!q) continue;
        const r = db.run('INSERT INTO learning_questions(session_id, session_word_id, question_type, prompt, options, correct_answer, context_ref, created_at) VALUES (?,?,?,?,?,?,?,?)',
          id, sw.id, q.type, j(q.prompt), j(q.options), q.answer, q.ref, now());
        const qid = Number(r.lastInsertRowid);
        db.run('UPDATE learning_sessions SET current_question_id = ?, last_session_word_id = ? WHERE id = ?', qid, sw.id, id);
        return { status: 'active', question: publicQuestion(db.get('SELECT * FROM learning_questions WHERE id = ?', qid), sw) };
      }
      throw conflict('Could not build questions for the remaining words. Add more words to your library or collections so distractors can be generated.');
    });
  }

  function answer(userId, id, { questionId, answer: given }) {
    return db.tx(() => {
      const s = ownSession(userId, id);
      const q = db.get('SELECT * FROM learning_questions WHERE id = ? AND session_id = ?', Number(questionId), id);
      if (!q) throw notFound('Question not found');
      const prior = db.get('SELECT * FROM learning_answers WHERE question_id = ?', q.id);
      if (prior) {
        // idempotent: a double-click or retry never counts twice
        const sw = db.get('SELECT * FROM session_words WHERE id = ?', q.session_word_id);
        return { duplicate: true, correct: !!prior.is_correct, correctAnswer: q.correct_answer, word: { correct: sw.correct_count, required: CORRECT_PER_WORD, completed: !!sw.completed_at }, session: state(userId, id) };
      }
      if (s.status !== 'active') throw conflict('This lesson is no longer active.');
      const text = String(given ?? '');
      if (!parseJSON(q.options, []).includes(text)) throw bad('Answer must be one of the offered options');
      const correct = text === q.correct_answer;
      const ts = now();
      const sw = db.get('SELECT * FROM session_words WHERE id = ?', q.session_word_id);
      const attempt = db.get('SELECT COUNT(*) AS n FROM learning_answers WHERE session_word_id = ?', sw.id).n + 1;
      db.run('INSERT INTO learning_answers(question_id, session_id, session_word_id, user_id, question_type, user_answer, is_correct, attempt_number, answered_at) VALUES (?,?,?,?,?,?,?,?,?)',
        q.id, id, sw.id, userId, q.question_type, text, correct ? 1 : 0, attempt, ts);
      db.run('UPDATE learning_questions SET answered_at = ? WHERE id = ?', ts, q.id);
      let newCorrect = sw.correct_count;
      if (correct && sw.correct_count < CORRECT_PER_WORD) {
        newCorrect = sw.correct_count + 1;
        const tc = parseJSON(sw.type_correct, {});
        tc[q.question_type] = (tc[q.question_type] || 0) + 1;
        db.run('UPDATE session_words SET correct_count = ?, type_correct = ?, completed_at = ? WHERE id = ?', newCorrect, j(tc), newCorrect >= CORRECT_PER_WORD ? ts : null, sw.id);
      } else if (!correct) {
        db.run('UPDATE session_words SET incorrect_count = incorrect_count + 1 WHERE id = ?', sw.id);
      }
      db.run(`INSERT INTO word_mastery(user_id, word_key, current_correct, total_correct, total_incorrect, updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(user_id, word_key) DO UPDATE SET current_correct = excluded.current_correct, total_correct = total_correct + excluded.total_correct, total_incorrect = total_incorrect + excluded.total_incorrect, updated_at = excluded.updated_at`,
        userId, sw.word_key, newCorrect, correct ? 1 : 0, correct ? 0 : 1, ts);
      db.run('UPDATE learning_sessions SET current_question_id = NULL, last_activity_at = ? WHERE id = ?', ts, id);
      let rewards = null;
      const remaining = db.get('SELECT COUNT(*) AS n FROM session_words WHERE session_id = ? AND correct_count < ?', id, CORRECT_PER_WORD).n;
      if (remaining === 0) rewards = finalize(userId, id);
      return {
        correct, correctAnswer: q.correct_answer,
        word: { correct: newCorrect, required: CORRECT_PER_WORD, completed: newCorrect >= CORRECT_PER_WORD },
        session: state(userId, id), completed: remaining === 0, rewards,
      };
    });
  }

  /** Complete the session and award lotuses. Runs inside the caller's transaction. */
  function finalize(userId, id) {
    const ts = now();
    const rewardDate = localDate(clock.now(), tzOf(userId));
    db.run("UPDATE learning_sessions SET status = 'completed', completed_at = ?, reward_date = ?, current_question_id = NULL WHERE id = ? AND status = 'active'", ts, rewardDate, id);
    const out = [];
    for (const sw of sessionWords(id)) {
      const snap = parseJSON(sw.snapshot, {});
      let earned = false;
      if (sw.correct_count >= CORRECT_PER_WORD) {
        const ins = db.run('INSERT OR IGNORE INTO lotus_rewards(user_id, word_key, reward_date, session_id, created_at) VALUES (?,?,?,?,?)', userId, sw.word_key, rewardDate, id, ts);
        if (ins.changes === 1) {
          earned = true;
          db.run(`INSERT INTO word_mastery(user_id, word_key, successful_days, last_reward_date, updated_at) VALUES (?,?,1,?,?)
            ON CONFLICT(user_id, word_key) DO UPDATE SET successful_days = successful_days + 1, last_reward_date = excluded.last_reward_date, updated_at = excluded.updated_at`,
            userId, sw.word_key, rewardDate, ts);
        }
      }
      db.run('UPDATE word_mastery SET current_correct = 0 WHERE user_id = ? AND word_key = ?', userId, sw.word_key);
      const m = db.get('SELECT * FROM word_mastery WHERE user_id = ? AND word_key = ?', userId, sw.word_key);
      out.push({ wordKey: sw.word_key, tamil: snap.tamil, english: snap.english, earned, lotus: lotusStage(m?.successful_days), bloomed: earned && lotusStage(m?.successful_days) === 5 && m.successful_days === 5 });
    }
    return out;
  }

  function abandon(userId, id) {
    return db.tx(() => {
      const s = ownSession(userId, id);
      if (s.status !== 'active') throw conflict('This lesson is not active.');
      db.run("UPDATE learning_sessions SET status = 'abandoned', completed_at = ?, current_question_id = NULL WHERE id = ?", now(), id);
      for (const sw of sessionWords(id)) db.run('UPDATE word_mastery SET current_correct = 0 WHERE user_id = ? AND word_key = ?', userId, sw.word_key);
      return { status: 'abandoned' };
    });
  }

  /** Active study time: gaps between answers, each capped at 2 minutes. */
  function activeMs(s, answers) {
    let t = 0;
    let prev = new Date(s.started_at).getTime();
    for (const a of answers) {
      const at = new Date(a.answered_at).getTime();
      t += Math.min(120_000, Math.max(0, at - prev));
      prev = at;
    }
    return t;
  }

  function summary(userId, id) {
    const s = ownSession(userId, id);
    const answers = db.all('SELECT * FROM learning_answers WHERE session_id = ? ORDER BY answered_at, id', id);
    const rewarded = new Set(db.all('SELECT word_key FROM lotus_rewards WHERE session_id = ?', id).map((r) => r.word_key));
    const words = sessionWords(id).map((w) => {
      const snap = parseJSON(w.snapshot, {});
      const m = db.get('SELECT * FROM word_mastery WHERE user_id = ? AND word_key = ?', userId, w.word_key);
      const total = w.correct_count + w.incorrect_count;
      const byType = {};
      for (const a of answers.filter((x) => x.session_word_id === w.id)) {
        byType[a.question_type] = byType[a.question_type] || { correct: 0, incorrect: 0 };
        byType[a.question_type][a.is_correct ? 'correct' : 'incorrect']++;
      }
      return {
        id: w.id, wordKey: w.word_key, tamil: snap.tamil, transliteration: snap.transliteration, english: snap.english, collectionTitle: w.collection_title,
        correct: w.correct_count, incorrect: w.incorrect_count, accuracy: total ? Math.round((w.correct_count / total) * 100) : 0,
        completed: !!w.completed_at, earnedLotus: rewarded.has(w.word_key), mastery: masteryView(m), byType,
      };
    });
    const correct = answers.filter((a) => a.is_correct).length;
    const ranked = [...words].sort((a, b) => b.accuracy - a.accuracy || a.incorrect - b.incorrect);
    return {
      id: s.id, status: s.status, startedAt: s.started_at, completedAt: s.completed_at,
      totals: {
        words: words.length, questions: answers.length, correct, incorrect: answers.length - correct,
        accuracy: answers.length ? Math.round((correct / answers.length) * 100) : 0,
        activeMs: activeMs(s, answers), wordsCompleted: words.filter((w) => w.completed).length, lotusesEarned: rewarded.size,
      },
      words,
      strongest: ranked.slice(0, 3).filter((w) => w.correct > 0),
      weakest: [...ranked].reverse().filter((w) => w.incorrect > 0).slice(0, 3),
    };
  }

  function history(userId, limit = 20) {
    return db.all(`SELECT s.*, (SELECT COUNT(*) FROM learning_answers a WHERE a.session_id = s.id) AS answered,
      (SELECT COUNT(*) FROM learning_answers a WHERE a.session_id = s.id AND a.is_correct = 1) AS correct,
      (SELECT COUNT(*) FROM lotus_rewards r WHERE r.session_id = s.id) AS lotuses
      FROM learning_sessions s WHERE s.user_id = ? ORDER BY s.started_at DESC LIMIT ?`, userId, Math.min(100, limit))
      .map((s) => ({ id: s.id, status: s.status, startedAt: s.started_at, completedAt: s.completed_at, words: s.word_count, answered: s.answered, correct: s.correct, lotuses: s.lotuses }));
  }

  return { start, state, active, nextQuestion, answer, abandon, summary, history };
}
