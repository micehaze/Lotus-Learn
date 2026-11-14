import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies, Router } from '../../server/http.js';
import { startTestServer, registerUser } from '../helpers.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(() => srv.close());

const raw = (path, init = {}) => fetch(srv.base + path, init);

test('parseCookies skips badly encoded cookies instead of throwing', () => {
  assert.deepEqual(parseCookies('other_app=100%; lotus_session=abc; x=%E0%A4'), { lotus_session: 'abc' });
  assert.deepEqual(parseCookies('a=hello%20world'), { a: 'hello world' });
  assert.deepEqual(parseCookies(''), {});
});

test('router rejects malformed path parameters with 400', () => {
  const r = new Router();
  r.get('/api/items/:id', () => ({}));
  assert.equal(r.match('GET', '/api/items/caf%C3%A9').params.id, 'café');
  assert.throws(() => r.match('GET', '/api/items/%E0'), (e) => e.status === 400);
});

test('a stray malformed cookie from another localhost app does not break the API', async () => {
  const res = await raw('/api/auth/me', { headers: { cookie: 'other_app=100%' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { user: null });
});

test('a signed-in user stays signed in next to a malformed cookie', async () => {
  const c = srv.client();
  const { email } = await registerUser(c);
  const res = await raw('/api/auth/me', { headers: { cookie: `junk=%zz; ${c.cookie}` } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).user.email, email);
});

test('malformed URLs return a client error, not a server error', async () => {
  const api = await raw('/api/collections/%E0');
  assert.ok(api.status < 500, `API path gave ${api.status}`);
  const page = await raw('/%E0');
  assert.ok(page.status < 500, `page path gave ${page.status}`);
});

test('an unparseable Origin header is rejected with 403, not 500', async () => {
  const res = await raw('/api/auth/login', {
    method: 'POST',
    headers: { 'x-requested-with': 'lotus', 'content-type': 'application/json', origin: 'null' },
    body: JSON.stringify({ email: 'a@example.com', password: 'whatever123' }),
  });
  assert.equal(res.status, 403);
});
