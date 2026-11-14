import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phonetic, scriptLang } from '../../shared/phonetic.js';

const check = (cases) => { for (const [native, easy] of cases) assert.equal(phonetic(native), easy, native); };

test('Malayalam reads like everyday Manglish', () => check([
  ['എന്റെ പേര്', 'ente peru'],
  ['നന്ദി', 'nandi'],
  ['എന്താ വിശേഷം?', 'enthaa vishesham?'],
  ['ഞാൻ മലയാളം പഠിക്കുന്നു', 'njaan malayaalam padikkunnu'],
  ['വീട്', 'veedu'],
  ['രണ്ട്', 'randu'],
  ['അമ്പലം', 'ambalam'],
  ['തിരുവനന്തപുരം', 'thiruvananthapuram'],
  ['കൃഷ്ണൻ', 'krishnan'],
  ['ഞങ്ങൾ', 'njangal'],
  ['മഴ', 'mazha'],
  ['വെള്ളം', 'vellam'],
  ['കറ്റ', 'katta'],
]));

test('Tamil follows how letters sound in their position', () => check([
  ['வணக்கம்', 'vanakkam'],
  ['என் பெயர் அமித்', 'en peyar amith'],
  ['நன்றி', 'nandri'],
  ['தமிழ்', 'thamizh'],
  ['சாப்பாடு', 'saappaadu'],
  ['தண்ணீர்', 'thanneer'],
  ['எங்கே', 'enge'],
  ['மகன்', 'magan'],
  ['வீடு', 'veedu'],
  ['தங்கம்', 'thangam'],
  ['மஞ்சள்', 'manjal'],
  ['காற்று', 'kaatru'],
  ['பெண்கள்', 'pengal'],
  ['அது', 'adhu'],
  ['வந்து', 'vandhu'],
  ['தம்பி', 'thambi'],
  ['ஃப்ரெஷ்', 'fresh'],
  ['முப்பத்தஞ்சு', 'muppatthanju'],
  ['நீங்கள் எப்படி இருக்கிறீர்கள்?', 'neengal eppadi irukkireergal?'],
]));

test('Kannada and Telugu, including anusvara before consonants', () => check([
  ['ನಮಸ್ಕಾರ', 'namaskaara'],
  ['ಕನ್ನಡ', 'kannada'],
  ['ನನ್ನ ಹೆಸರು', 'nanna hesaru'],
  ['ಅಂಗಡಿ', 'angadi'],
  ['ಕಂಬ', 'kamba'],
  ['ಧನ್ಯವಾದಗಳು', 'dhanyavaadagalu'],
  ['నమస్కారం', 'namaskaaram'],
  ['తెలుగు', 'telugu'],
  ['నా పేరు', 'naa peru'],
  ['మీరు ఎలా ఉన్నారు?', 'meeru elaa unnaaru?'],
  ['అమ్మ', 'amma'],
]));

test('Hindi equivalents drop the final inherent vowel', () => check([
  ['नमस्ते', 'namaste'],
  ['कमल', 'kamal'],
]));

test('mixed text keeps English, punctuation and spacing', () => {
  assert.equal(phonetic('Say “வணக்கம்” (hello)!'), 'Say “vanakkam” (hello)!');
  assert.equal(phonetic(''), '');
  assert.equal(phonetic(null), '');
  assert.equal(phonetic('plain English'), 'plain English');
});

test('old-style Malayalam chillu (virama + ZWJ) gets no extra u', () => {
  assert.equal(phonetic('അവന്‍'), 'avan');
  assert.equal(phonetic('അവൻ'), 'avan');
});

test('scriptLang detects the script', () => {
  assert.equal(scriptLang('hello வணக்கம்'), 'ta');
  assert.equal(scriptLang('നന്ദി'), 'ml');
  assert.equal(scriptLang('ಕನ್ನಡ'), 'kn');
  assert.equal(scriptLang('తెలుగు'), 'te');
  assert.equal(scriptLang('hello'), null);
});
