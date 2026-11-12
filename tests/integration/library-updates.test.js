import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LANG_CODES, transliterateAny, validateNative } from '../../shared/indic.js';
import { registerUser, startTestServer } from '../helpers.js';

test('learner updates immediately publish three stories and return three curated links in each language', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const learner = server.client();
  for (const path of ['/api/stories/update', '/api/videos/update']) {
    assert.equal((await learner.post(path)).status, 401);
  }
  await registerUser(learner);
  assert.equal((await learner.post('/api/stories/update', { lang: 'fr' })).status, 400);
  const jobsBefore = server.app.db.get('SELECT COUNT(*) AS total FROM content_jobs').total;

  for (const lang of LANG_CODES) {
    const update = async (kind, body) => {
      const response = await learner.post('/api/' + kind + '/update', { lang, ...body });
      assert.equal(response.status, 200, JSON.stringify(response.data));
      assert.equal(response.data.items.length, 3);
      assert.ok(response.data.items.every((item) => item.lang === lang && item.status === 'published'));
      return response.data.items;
    };
    const first = await update('stories');
    const second = await update('stories');
    assert.equal(new Set([...first, ...second].map((story) => story.id)).size, 6);
    const listed = await learner.get('/api/stories?lang=' + lang);
    for (const story of [...first, ...second]) {
      assert.ok(listed.data.items.some(({ id }) => id === story.id));
      const details = (await learner.get('/api/stories/' + story.id)).data;
      assert.ok(details.sentenceCount >= 20);
      for (const paragraph of details.paragraphs) {
        assert.deepEqual(validateNative(paragraph.ta, lang), []);
        assert.match(transliterateAny(paragraph.ta), /\p{Script=Latin}/u);
        assert.match(paragraph.en, /[A-Za-z]/);
      }
    }

    const videos = await update('videos');
    assert.equal(new Set(videos.map((v) => v.watchUrl)).size, 3);
    for (const video of videos) assert.match(video.watchUrl, /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/);
    const previous = videos.map((video) => video.externalId);
    const more = await update('videos', { previous });
    assert.ok(more.some((video) => !previous.includes(video.externalId)));
    assert.equal((await learner.put('/api/videos/' + videos[0].id + '/state', { favorite: true, watched: true })).status, 200);
    const saved = (await learner.get('/api/videos?favorite=true&lang=' + lang)).data;
    assert.ok(saved.some((video) => video.id === videos[0].id && video.watched));
  }
  assert.equal(server.app.db.get('SELECT COUNT(*) AS total FROM content_jobs').total, jobsBefore);
});
