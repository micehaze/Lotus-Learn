import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, contextsFor, makeQuestion, DEFAULT_PLAN } from '../../server/services/learning.js';
import { mulberry32 } from '../../server/util.js';

const verb = (tamil, english, forms, extra = {}) => ({ key: tamil, tamil, english, partOfSpeech: 'verb', forms, altEnglish: [], synonyms: [], examples: [], collocations: [], ...extra });
const pool = [
  verb('குடி', 'drink', { present1s: 'குடிக்கிறேன்', past1s: 'குடித்தேன்' }, {
    examples: [{ ta: 'நான் பால் [[குடிக்கிறேன்]].', en: 'I drink milk.', form: 'present1s' }],
    collocations: [{ ta: 'காபி [[குடி]]', en: 'drink coffee' }],
  }),
  verb('படி', 'read', { present1s: 'படிக்கிறேன்', past1s: 'படித்தேன்' }),
  verb('போ', 'go', { present1s: 'போகிறேன்', past1s: 'போனேன்' }),
  verb('வா', 'come', { present1s: 'வருகிறேன்', past1s: 'வந்தேன்' }),
  { key: 'joy', tamil: 'மகிழ்ச்சி', english: 'joy', altEnglish: ['happiness'], partOfSpeech: 'noun', synonyms: ['சந்தோஷம்'], forms: {}, examples: [], collocations: [] },
  { key: 'hap', tamil: 'சந்தோஷம்', english: 'happiness', altEnglish: ['joy'], partOfSpeech: 'noun', synonyms: ['மகிழ்ச்சி'], forms: {}, examples: [], collocations: [] },
  { key: 'h', tamil: 'வீடு', english: 'house', altEnglish: [], partOfSpeech: 'noun', synonyms: [], forms: {}, examples: [], collocations: [] },
  { key: 't', tamil: 'மரம்', english: 'tree', altEnglish: [], partOfSpeech: 'noun', synonyms: [], forms: {}, examples: [], collocations: [] },
];

test('default plan is 3 collocation / 2 ta→en / 2 en→ta / 3 sentence', () => {
  const p = buildPlan({ english: 'drink', tamil: 'குடி', collocations: [{ ta: '[[குடி]]', en: '' }], examples: [{ ta: 'நான் [[குடி]]', en: '' }] });
  assert.deepEqual(p, DEFAULT_PLAN);
  assert.equal(Object.values(p).reduce((a, b) => a + b, 0), 10);
});

test('missing contexts are redistributed to valid types (still 10)', () => {
  const p = buildPlan({ english: 'yes', tamil: 'ஆமாம்', collocations: [], examples: [] });
  assert.equal(p.collocation, 0);
  assert.equal(p.sentence, 0);
  assert.equal(p.ta_en + p.en_ta, 10);
});

test('contexts use the exact [[marked]] form', () => {
  const c = contextsFor(pool[0], 'sentence');
  assert.equal(c[0].answer, 'குடிக்கிறேன்');
  assert.ok(c[0].display.includes('＿＿＿'));
  assert.equal(c[0].form, 'present1s');
});

test('inflected blanks use same-form distractors from other verbs', () => {
  const q = makeQuestion('sentence', pool[0], pool, mulberry32(1));
  assert.equal(q.answer, 'குடிக்கிறேன்');
  assert.equal(q.options.length, 4);
  for (const o of q.options.filter((x) => x !== q.answer)) assert.ok(['படிக்கிறேன்', 'போகிறேன்', 'வருகிறேன்'].includes(o), o);
});

test('distractors never include synonyms or shared meanings', () => {
  for (let s = 0; s < 30; s++) {
    const q = makeQuestion('en_ta', pool[4], pool, mulberry32(s));
    assert.ok(!q.options.includes('சந்தோஷம்'), 'synonym must not appear as a wrong option');
    const q2 = makeQuestion('ta_en', pool[4], pool, mulberry32(s));
    assert.ok(!q2.options.includes('happiness'));
    assert.equal(new Set(q2.options).size, 4);
  }
});

test('returns null when distractors cannot be built reliably', () => {
  const lonely = { key: 'x', tamil: 'குடி', english: 'drink', partOfSpeech: 'verb', forms: {}, synonyms: [], altEnglish: [], collocations: [], examples: [{ ta: 'நான் [[குடித்தேன்]]', en: 'I drank' }] };
  assert.equal(makeQuestion('sentence', lonely, [lonely], mulberry32(1)), null);
});
