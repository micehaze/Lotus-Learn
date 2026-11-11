import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transliterate, validateTamil, romanKey, levenshtein, tokenize, stripMarkers } from '../../shared/tamil.js';

test('transliterates Tamil Unicode (ISO 15919 style)', () => {
  assert.equal(transliterate('தண்ணீர்'), 'taṇṇīr');
  assert.equal(transliterate('வீடு'), 'vīṭu');
  assert.equal(transliterate('தமிழ்'), 'tamiḻ');
  assert.equal(transliterate('நன்றி'), 'naṉṟi');
  assert.equal(transliterate('கொடுக்கிறேன்'), 'koṭukkiṟēṉ');
  // decomposed o-sign (ெ + ா) is normalised first
  assert.equal(transliterate('க\u0BC6\u0BBE'), 'ko');
  assert.equal(transliterate('Hello தமிழ்!'), 'Hello tamiḻ!');
});

test('validates Tamil script', () => {
  assert.deepEqual(validateTamil('வீடு'), []);
  assert.ok(validateTamil('hello').length);
  assert.ok(validateTamil('ாவீடு').length, 'vowel sign without consonant is rejected');
  assert.ok(validateTamil('').length);
});

test('romanized search keys tolerate common spellings', () => {
  for (const [a, b] of [['thanneer', 'taṇṇīr'], ['saappaadu', 'cāppāṭu'], ['veedu', 'vīṭu'], ['nandri', 'naṉṟi'], ['tamizh', 'tamiḻ']]) {
    assert.equal(romanKey(a), romanKey(b), `${a} ~ ${b}`);
  }
});

test('levenshtein with early exit', () => {
  assert.equal(levenshtein('water', 'watr'), 1);
  assert.equal(levenshtein('house', 'hose'), 1);
  assert.ok(levenshtein('abcdef', 'uvwxyz', 2) > 2);
});

test('tokenizes Tamil prose and strips exercise markers', () => {
  const t = tokenize('மீனா காலையில் எழுந்தாள்.');
  assert.deepEqual(t.filter((x) => x.trim()), ['மீனா', 'காலையில்', 'எழுந்தாள்', '.']);
  assert.equal(stripMarkers('இது என் [[வீடு]].'), 'இது என் வீடு.');
});
