import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerUser, answerOnce, finishSession, libraryIds } from '../helpers.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

const DAY = 86400_000;
async function learnerWithCollection(words) {
  const c = srv.client();
  await registerUser(c);
  const col = await c.post('/api/collections', { title: 'Test words' });
  await c.post(`/api/collections/${col.data.id}/words`, { vocabularyIds: await libraryIds(srv.app, words) });
  return { c, collectionId: col.data.id };
}
async function startWith(c, collectionId) {
  const s = await c.post('/api/selection', { collectionId });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  const r = await c.post('/api/sessions');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.id;
}

test('each word needs exactly 10 correct answers; distribution follows the 3/2/2/3 plan', async () => {
  const { c, collectionId } = await learnerWithCollection(['தண்ணீர்', 'வீடு', 'குடி']);
  const sid = await startWith(c, collectionId);
  const st = await c.get(`/api/sessions/${sid}`);
  assert.equal(st.data.required, 30);
  const { last } = await finishSession(c, sid, srv.app);
  assert.equal(last.a.data.completed, true);
  const answers = srv.app.db.all('SELECT a.*, sw.word_key FROM learning_answers a JOIN session_words sw ON sw.id = a.session_word_id WHERE a.session_id = ?', sid);
  assert.equal(answers.length, 30, 'all-correct run takes exactly 30 answers');
  const byWord = {};
  for (const a of answers) { byWord[a.word_key] = byWord[a.word_key] || {}; byWord[a.word_key][a.question_type] = (byWord[a.word_key][a.question_type] || 0) + 1; }
  for (const types of Object.values(byWord)) assert.deepEqual(types, { collocation: 3, ta_en: 2, en_ta: 2, sentence: 3 });
  const sum = await c.get(`/api/sessions/${sid}/summary`);
  assert.equal(sum.data.totals.correct, 30);
  assert.equal(sum.data.totals.accuracy, 100);
  assert.equal(sum.data.totals.lotusesEarned, 3);
});

test('incorrect answers never count toward the 10, and questions are mixed across words', async () => {
  const { c, collectionId } = await learnerWithCollection(['பூ', 'மரம்', 'மழை', 'கடல்']);
  const sid = await startWith(c, collectionId);
  await finishSession(c, sid, srv.app, { wrongEvery: 3 });
  const sws = srv.app.db.all('SELECT * FROM session_words WHERE session_id = ?', sid);
  for (const w of sws) { assert.equal(w.correct_count, 10); assert.ok(w.incorrect_count > 0); }
  const answers = srv.app.db.all('SELECT * FROM learning_answers WHERE session_id = ? ORDER BY id', sid);
  const correct = answers.filter((a) => a.is_correct).length;
  assert.equal(correct, 40);
  assert.ok(answers.length > 40);
  // mixing: while ≥2 words remain incomplete the same word is never asked twice in a row
  const seq = srv.app.db.all('SELECT session_word_id FROM learning_questions WHERE session_id = ? ORDER BY id', sid).map((r) => r.session_word_id);
  let repeats = 0;
  for (let i = 1; i < seq.length - 12; i++) if (seq[i] === seq[i - 1]) repeats++;
  assert.equal(repeats, 0, 'questions must alternate between words');
  // attempt numbers are tracked per word
  const first = answers.filter((a) => a.session_word_id === sws[0].id).map((a) => a.attempt_number);
  assert.deepEqual(first, first.map((_, i) => i + 1));
});

test('session is resumable: the same pending question is returned; answers are idempotent', async () => {
  const { c, collectionId } = await learnerWithCollection(['அம்மா', 'அப்பா']);
  const sid = await startWith(c, collectionId);
  const q1 = await c.get(`/api/sessions/${sid}/question`);
  const q2 = await c.get(`/api/sessions/${sid}/question`);
  assert.equal(q1.data.question.id, q2.data.question.id, 'reloading does not skip the question');
  assert.equal(q1.data.question.correct_answer, undefined, 'answer is never sent to the browser');
  const active = await c.get('/api/sessions/active');
  assert.equal(active.data.session.id, sid);
  const row = srv.app.db.get('SELECT correct_answer FROM learning_questions WHERE id = ?', q1.data.question.id);
  const a1 = await c.post(`/api/sessions/${sid}/answer`, { questionId: q1.data.question.id, answer: row.correct_answer });
  const a2 = await c.post(`/api/sessions/${sid}/answer`, { questionId: q1.data.question.id, answer: row.correct_answer });
  assert.equal(a1.data.word.correct, 1);
  assert.equal(a2.data.duplicate, true);
  assert.equal(a2.data.word.correct, 1, 'double submit does not double count');
  const bogus = await c.post(`/api/sessions/${sid}/answer`, { questionId: (await c.get(`/api/sessions/${sid}/question`)).data.question.id, answer: 'not an option' });
  assert.equal(bogus.status, 400);
  // only one active session at a time
  await c.post('/api/selection', { collectionId });
  const second = await c.post('/api/sessions');
  assert.equal(second.status, 409);
  assert.equal(second.data.details.sessionId, sid);
  const ab = await c.post(`/api/sessions/${sid}/abandon`);
  assert.equal(ab.data.status, 'abandoned');
  assert.equal(srv.app.db.get('SELECT COUNT(*) AS n FROM lotus_rewards WHERE session_id = ?', sid).n, 0, 'abandoned sessions award nothing');
});

test('one lotus per word per day; five learning days give a full bloom that stays bloomed', async () => {
  const { c, collectionId } = await learnerWithCollection(['நண்பன்', 'பள்ளி']);
  const key = `v${srv.app.db.get("SELECT id FROM vocabulary WHERE tamil = 'நண்பன்'").id}`;
  const lotus = () => srv.app.db.get('SELECT successful_days FROM word_mastery WHERE word_key = ? AND user_id = (SELECT user_id FROM collections WHERE id = ?)', key, collectionId)?.successful_days || 0;
  const runDay = async (dayOffset) => {
    await c.post('/api/__test/clock', { offsetMs: dayOffset * DAY });
    const sid = await startWith(c, collectionId);
    const { last } = await finishSession(c, sid, srv.app);
    return last.a.data;
  };
  let r = await runDay(0);
  assert.equal(lotus(), 1);
  assert.ok(r.rewards.every((x) => x.earned));
  r = await runDay(0); // same calendar day again
  assert.equal(lotus(), 1, 'repeating on the same day grants nothing');
  assert.ok(r.rewards.every((x) => !x.earned));
  for (let d = 1; d <= 4; d++) await runDay(d);
  assert.equal(lotus(), 5);
  const col = await c.get(`/api/collections/${collectionId}`);
  const card = col.data.words.find((w) => w.tamil === 'நண்பன்');
  assert.equal(card.mastery.lotus, 5);
  assert.equal(card.mastery.score, 100);
  await runDay(5);
  const again = await c.get(`/api/collections/${collectionId}`);
  assert.equal(again.data.words.find((w) => w.tamil === 'நண்பன்').mastery.lotus, 5, 'display stays at the full bloom');
  assert.equal(lotus(), 6, 'later reviews keep being tracked');
  // database constraint makes duplicate rewards impossible even outside the service
  const uid = srv.app.db.get('SELECT user_id FROM collections WHERE id = ?', collectionId).user_id;
  const today = srv.app.db.get('SELECT reward_date FROM lotus_rewards WHERE user_id = ? AND word_key = ? ORDER BY reward_date DESC', uid, key).reward_date;
  assert.throws(() => srv.app.db.run('INSERT INTO lotus_rewards(user_id, word_key, reward_date, session_id, created_at) VALUES (?,?,?,?,?)', uid, key, today, 1, 'x'));
  // statistics reflect the real data
  const stats = await c.get(`/api/collections/${collectionId}/stats`);
  assert.equal(stats.data.summary.bloomed, 2);
  assert.equal(stats.data.summary.averageMastery, 100);
  const overview = await c.get('/api/stats/overview');
  assert.equal(overview.data.streak.current, 6);
  assert.equal(overview.data.totals.lotuses, 12);
  const global = await c.get('/api/stats/collections');
  assert.equal(global.data.summary.bloomed, 2);
  await c.post('/api/__test/clock', { offsetMs: 0 });
});

test('words without collocations or sentences still get 10 valid questions', async () => {
  const { c, collectionId } = await learnerWithCollection(['ஆமாம்', 'கடுகு சிறுத்தாலும் காரம் குறையாது']);
  const sid = await startWith(c, collectionId);
  const { last } = await finishSession(c, sid, srv.app);
  assert.equal(last.a.data.completed, true);
  const types = srv.app.db.all('SELECT DISTINCT question_type FROM learning_answers WHERE session_id = ?', sid).map((r) => r.question_type).sort();
  assert.ok(!types.includes('collocation'));
  for (const w of srv.app.db.all('SELECT correct_count FROM session_words WHERE session_id = ?', sid)) assert.equal(w.correct_count, 10);
});

test('custom words entered by the learner can be studied', async () => {
  const c = srv.client();
  await registerUser(c);
  const col = await c.post('/api/collections', { title: 'Mine' });
  for (const w of [
    { tamil: 'கோயில்', english: 'temple', exampleTa: 'இது ஒரு பெரிய கோயில்.', exampleEn: 'This is a big temple.' },
    { tamil: 'நிலா', english: 'moon' }, { tamil: 'சூரியன்', english: 'sun' }, { tamil: 'நட்சத்திரம்', english: 'star' },
  ]) assert.equal((await c.post(`/api/collections/${col.data.id}/words`, w)).status, 200);
  const sid = await startWith(c, col.data.id);
  const { last } = await finishSession(c, sid, srv.app);
  assert.equal(last.a.data.completed, true);
  assert.equal(last.a.data.rewards.filter((r) => r.earned).length, 4);
});

test('another learner cannot read or answer someone else\'s session', async () => {
  const { c, collectionId } = await learnerWithCollection(['வானம்']);
  const sid = await startWith(c, collectionId);
  const q = await c.get(`/api/sessions/${sid}/question`);
  const intruder = srv.client();
  await registerUser(intruder);
  assert.equal((await intruder.get(`/api/sessions/${sid}`)).status, 404);
  assert.equal((await intruder.post(`/api/sessions/${sid}/answer`, { questionId: q.data.question.id, answer: q.data.question.options[0] })).status, 404);
  assert.equal((await intruder.get(`/api/sessions/${sid}/summary`)).status, 404);
  assert.equal((await srv.client().get(`/api/sessions/${sid}`)).status, 401);
  void answerOnce;
});
