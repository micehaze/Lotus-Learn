import { createApp } from '../server/app.js';
import { seed } from '../server/seed/seed.js';
import { mulberry32 } from '../server/util.js';

export async function startTestServer({ seedData = true, deps = {}, overrides = {} } = {}) {
  const app = createApp({ databaseFile: ':memory:', automationEnabled: false, testMode: true, authRateLimit: 1000, ...overrides }, { rand: mulberry32(42), logger: { log() {}, warn() {}, error: console.error }, ...deps });
  if (seedData) await seed(app, { demoUsers: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { app, base, close: () => app.close(), client: () => makeClient(base) };
}

export function makeClient(base) {
  let cookie = '';
  async function req(method, path, body) {
    const headers = { 'x-requested-with': 'lotus' };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) {
      const [pair] = c.split(';');
      if (pair.startsWith('lotus_session=')) cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  return {
    get: (p) => req('GET', p),
    post: (p, b = {}) => req('POST', p, b),
    put: (p, b = {}) => req('PUT', p, b),
    patch: (p, b = {}) => req('PATCH', p, b),
    del: (p) => req('DELETE', p),
    raw: req,
    get cookie() { return cookie; },
  };
}

let n = 0;
export async function registerUser(client, extra = {}) {
  n++;
  const email = `learner${n}_${Date.now()}@example.com`;
  const r = await client.post('/api/auth/register', { email, password: 'correct-horse-9', displayName: `Learner ${n}`, ...extra });
  if (r.status !== 200) throw new Error(`register failed ${r.status} ${JSON.stringify(r.data)}`);
  return { email, password: 'correct-horse-9', id: r.data.user.id };
}

/** Answer the current question; `correct` decides whether we pick the right option. */
export async function answerOnce(client, sessionId, app, correct = true) {
  const q = await client.get(`/api/sessions/${sessionId}/question`);
  if (!q.data.question) return { done: true, q };
  const row = app.db.get('SELECT correct_answer FROM learning_questions WHERE id = ?', q.data.question.id);
  const pick = correct ? row.correct_answer : q.data.question.options.find((o) => o !== row.correct_answer);
  const a = await client.post(`/api/sessions/${sessionId}/answer`, { questionId: q.data.question.id, answer: pick });
  return { q, a };
}

export async function finishSession(client, sessionId, app, { wrongEvery = 0, max = 2000 } = {}) {
  let i = 0, last;
  for (; i < max; i++) {
    const wrong = wrongEvery && i % wrongEvery === wrongEvery - 1;
    last = await answerOnce(client, sessionId, app, !wrong);
    if (last.done || last.a?.data?.completed) break;
  }
  return { steps: i + 1, last };
}

export async function libraryIds(app, tamilWords) {
  return tamilWords.map((t) => app.db.get('SELECT id FROM vocabulary WHERE tamil = ?', t).id);
}
