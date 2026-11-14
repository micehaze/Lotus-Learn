// Easy pronunciation spelling ("Manglish" / "Tanglish" style) for Tamil, Malayalam,
// Kannada and Telugu (Hindi too, for equivalents). Unlike the scholarly ISO 15919
// transliteration in indic.js, this uses no diacritics and spells words the way
// people type them in chat, so a learner who can't read the script can say them:
//   എന്റെ പേര് → "ente peru"   வணக்கம் → "vanakkam"   ನಮಸ್ಕಾರ → "namaskaara"
// Shared by the server and the browser.

const BLOCKS = [
  { lang: 'ta', start: 0x0B80, end: 0x0BFF },
  { lang: 'ml', start: 0x0D00, end: 0x0D7F },
  { lang: 'kn', start: 0x0C80, end: 0x0CFF },
  { lang: 'te', start: 0x0C00, end: 0x0C7F },
  { lang: 'hi', start: 0x0900, end: 0x097F },
];
const ZWNJ = 0x200C;
const ZWJ = 0x200D;
const blockOf = (cp) => BLOCKS.find((b) => cp >= b.start && cp <= b.end) || null;

// Offsets inside a block are shared by all five scripts (Unicode keeps the ISCII layout).
const VIRAMA = 0x4D;
const NUKTA = 0x3C;
const ANUSVARA = 0x02;
const VISARGA = 0x03; // Tamil aytham sits here too
const CANDRABINDU = 0x01;
const INDEPENDENT = { 0x05: 'a', 0x06: 'aa', 0x07: 'i', 0x08: 'ii', 0x09: 'u', 0x0A: 'uu', 0x0B: 'r', 0x0C: 'l', 0x0D: 'e', 0x0E: 'e', 0x0F: 'ee', 0x10: 'ai', 0x11: 'o', 0x12: 'o', 0x13: 'oo', 0x14: 'au', 0x60: 'r', 0x61: 'l' };
const SIGN = { 0x3E: 'aa', 0x3F: 'i', 0x40: 'ii', 0x41: 'u', 0x42: 'uu', 0x43: 'r', 0x44: 'r', 0x45: 'e', 0x46: 'e', 0x47: 'ee', 0x48: 'ai', 0x49: 'o', 0x4A: 'o', 0x4B: 'oo', 0x4C: 'au', 0x57: 'au', 0x62: 'l', 0x63: 'l' };
const IGNORED_MARKS = new Set([0x55, 0x56, NUKTA, 0x00]); // length marks, nukta
const ML_CHILLU = { 0x7A: 0x23, 0x7B: 0x28, 0x7C: 0x30, 0x7D: 0x32, 0x7E: 0x33, 0x7F: 0x15 }; // ൺ ൻ ർ ൽ ൾ ൿ
const HI_NUKTA_LETTERS = { 0x58: 'q', 0x59: 'kh', 0x5A: 'gh', 0x5B: 'z', 0x5C: 'r', 0x5D: 'rh', 0x5E: 'f', 0x5F: 'y' };

// Base spelling of each consonant offset.
const BASE = {
  0x15: 'k', 0x16: 'kh', 0x17: 'g', 0x18: 'gh', 0x19: 'ng', 0x1A: 'ch', 0x1B: 'chh', 0x1C: 'j', 0x1D: 'jh', 0x1E: 'nj',
  0x1F: 't', 0x20: 'th', 0x21: 'd', 0x22: 'dh', 0x23: 'n', 0x24: 't', 0x25: 'th', 0x26: 'd', 0x27: 'dh', 0x28: 'n', 0x29: 'n',
  0x2A: 'p', 0x2B: 'ph', 0x2C: 'b', 0x2D: 'bh', 0x2E: 'm', 0x2F: 'y', 0x30: 'r', 0x31: 'r', 0x32: 'l', 0x33: 'l', 0x34: 'zh',
  0x35: 'v', 0x36: 'sh', 0x37: 'sh', 0x38: 's', 0x39: 'h',
};
const PER_LANG = {
  ml: { 0x24: 'th', 0x20: 'd' }, // dental t is "th" (athu, thanne); ഠ is "d" (padikkunnu)
  ta: { 0x24: 'th' }, // ...and so does Tamil: thamizh, thanneer
  kn: { 0x34: 'l', 0x1E: 'n' },
  te: { 0x34: 'l', 0x1E: 'n' },
  hi: { 0x1E: 'n' },
};
const VOWEL = { a: 'a', aa: 'aa', i: 'i', ii: 'ee', u: 'u', uu: 'oo', e: 'e', ee: 'e', ai: 'ai', o: 'o', oo: 'o', au: 'au', l: 'lu' };
const vowelText = (v, lang) => (v === 'r' ? (lang === 'ml' || lang === 'hi' ? 'ri' : 'ru') : VOWEL[v] ?? '');

// Two-consonant clusters (first has a virama) whose everyday spelling isn't just the two letters joined.
const CLUSTERS = {
  ta: { '19-15': 'ng', '1E-1A': 'nj' }, // ங்க → ng (thangam), ஞ்ச → nj (manjal)
  ml: { '28-31': 'nt', '31-31': 'tt', '19-19': 'ng', '1E-1E': 'nj', '1E-1A': 'nch', '19-15': 'nk', '2E-2A': 'mb', '1A-1B': 'chh' },
  kn: { '19-15': 'nk', '19-17': 'ng' },
  te: { '19-15': 'nk', '19-17': 'ng' },
  hi: {},
};
const key = (a, b) => `${a.toString(16).toUpperCase()}-${b.toString(16).toUpperCase()}`;

const NASALS = new Set([0x19, 0x1E, 0x23, 0x28, 0x29, 0x2E]);
const VOICELESS = new Set([0x15, 0x1A, 0x1F, 0x24, 0x2A, 0x31]);
const LABIAL = new Set([0x2A, 0x2B, 0x2C, 0x2D, 0x2E]);
const SONORANT_OR_SIBILANT = new Set([0x2F, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]);

// Tamil script has one letter for k/g, ch/s/j, t/d, th/dh, p/b; the sound depends on position.
const TAMIL_SOUND = {
  0x15: { initial: 'k', voiceless: 'k', nasal: 'g', other: 'g' },
  0x1A: { initial: 's', voiceless: 'ch', nasal: 'j', other: 's' },
  0x1F: { initial: 't', voiceless: 't', nasal: 'd', other: 'd' },
  0x24: { initial: 'th', voiceless: 'th', nasal: 'dh', other: 'dh' },
  0x2A: { initial: 'p', voiceless: 'p', nasal: 'b', other: 'p' },
  0x31: { initial: 'r', voiceless: 'r', nasal: 'dr', other: 'r' },
};

/** Split native text into words of units: consonants (with vowel or virama), vowels and signs. */
function parse(text) {
  const out = []; // items: { lang, units } for native words, or a plain string
  let word = null;
  const chars = [...String(text ?? '').normalize('NFC')];
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    const b = blockOf(cp);
    if ((cp === ZWJ || cp === ZWNJ) && word) { const last = word.units[word.units.length - 1]; if (last?.k === 'C' && last.v === null) last.joiner = true; continue; }
    if (!b) { word = null; out.push(ch); continue; }
    if (!word || word.lang !== b.lang) { word = { lang: b.lang, units: [] }; out.push(word); }
    const o = cp - b.start;
    const units = word.units;
    const last = units[units.length - 1];
    if (b.lang === 'ml' && ML_CHILLU[o] !== undefined) units.push({ k: 'C', o: ML_CHILLU[o], v: null, chillu: true });
    else if (b.lang === 'ml' && o === 0x4E) units.push({ k: 'C', o: 0x30, v: null, chillu: true }); // dot reph
    else if (b.lang === 'hi' && HI_NUKTA_LETTERS[o]) units.push({ k: 'C', o: -1, lit: HI_NUKTA_LETTERS[o], v: 'a' });
    else if (BASE[o] !== undefined) units.push({ k: 'C', o, v: 'a' });
    else if (INDEPENDENT[o] !== undefined) units.push({ k: 'V', v: INDEPENDENT[o] });
    else if (SIGN[o] !== undefined) { if (last?.k === 'C' && last.v === 'a') last.v = SIGN[o]; else if (o === 0x57 && last?.k === 'C') last.v = 'au'; }
    else if (o === VIRAMA) { if (last?.k === 'C' && last.v === 'a') last.v = null; }
    else if (o === ANUSVARA || o === CANDRABINDU) units.push({ k: 'N' });
    else if (o === VISARGA) units.push({ k: 'H' });
    else if (IGNORED_MARKS.has(o)) { /* skip */ }
    else if (o >= 0x66 && o <= 0x6F) units.push({ k: 'X', s: String(o - 0x66) }); // native digits
    else units.push({ k: 'X', s: '' });
  }
  return out;
}

function consonant(lang, units, i, o) {
  const prev = units[i - 1];
  if (lang === 'ta' && TAMIL_SOUND[o]) {
    let ctx = 'other';
    const nx = units[i + 1];
    if (!prev || prev.k === 'X') ctx = 'initial';
    // A stop that ends the word keeps its hard sound: அமித் → amith, not amidh.
    else if (units[i].v === null && (!nx || nx.k === 'X') && o !== 0x31) ctx = 'voiceless';
    else if (prev.k === 'C' && prev.v === null) ctx = NASALS.has(prev.o) ? 'nasal' : VOICELESS.has(prev.o) ? 'voiceless' : 'other';
    return TAMIL_SOUND[o][ctx];
  }
  // Malayalam softens a single ട between vowels or after a nasal: veedu, randu.
  if (lang === 'ml' && o === 0x1F && prev && !(prev.k === 'C' && prev.v === null && !NASALS.has(prev.o))) return 'd';
  return PER_LANG[lang]?.[o] ?? BASE[o];
}

function geminate(s) {
  if (s === 'ng' || s === 'nj') return s;
  if (s.length > 1 && s.endsWith('h')) return s[0] + s; // ch → cch, th → tth
  if (s === 'r') return 'tr'; // Tamil ற்ற: kaatru
  return s + s;
}

function renderWord({ lang, units }) {
  let out = '';
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.k === 'V') { out += vowelText(u.v, lang); continue; }
    if (u.k === 'X') { out += u.s; continue; }
    if (u.k === 'H') {
      // Tamil writes foreign f and z as ஃப and ஃஜ: ஃப்ரெஷ் → fresh.
      const nx = units[i + 1];
      if (lang === 'ta' && nx?.k === 'C' && (nx.o === 0x2A || nx.o === 0x1C)) { out += (nx.o === 0x2A ? 'f' : 'z') + (nx.v === null ? '' : vowelText(nx.v, lang)); i++; continue; }
      out += 'h'; continue;
    }
    if (u.k === 'N') {
      // Anusvara takes the sound of the next consonant: ಅಂಗಡಿ → angadi, ಕಂಬ → kamba, ending → m.
      const nx = units[i + 1];
      out += lang !== 'ml' && nx?.k === 'C' && nx.o >= 0 && !LABIAL.has(nx.o) && !SONORANT_OR_SIBILANT.has(nx.o) ? 'n' : 'm';
      continue;
    }
    // consonant
    if (u.o < 0) { out += u.lit + vowelText(u.v, lang); continue; }
    const nx = units[i + 1];
    if (u.v === null && !u.joiner && !u.chillu && nx?.k === 'C' && nx.o >= 0) {
      const cluster = CLUSTERS[lang]?.[key(u.o, nx.o)];
      if (cluster !== undefined) { out += cluster + vowelText(nx.v, lang); i++; if (nx.v === null) out += finalVowel(lang, units, i, nx); continue; }
      if (nx.o === u.o) { out += geminate(consonant(lang, units, i + 1, nx.o)) + vowelText(nx.v, lang); i++; if (nx.v === null) out += finalVowel(lang, units, i, nx); continue; }
    }
    out += consonant(lang, units, i, u.o);
    if (u.v !== null) {
      const last = i === units.length - 1;
      // Hindi drops the final inherent vowel: kamal, not kamala.
      out += lang === 'hi' && last && u.v === 'a' && units.length > 1 ? '' : vowelText(u.v, lang);
    } else out += finalVowel(lang, units, i, u);
  }
  return out;
}

// Malayalam words that end in a consonant + virama are said with a short "u": അത് → athu, വീട് → veedu.
function finalVowel(lang, units, i, u) {
  return lang === 'ml' && i === units.length - 1 && !u.joiner && !u.chillu ? 'u' : '';
}

/** Easy English-letter spelling of any Tamil/Malayalam/Kannada/Telugu/Hindi text. Other text passes through. */
export function phonetic(text) {
  return parse(text).map((w) => (typeof w === 'string' ? w : renderWord(w))).join('');
}

/** Language code of the first native script found in `text` ('ta' | 'ml' | 'kn' | 'te' | 'hi'), or null. */
export function scriptLang(text) {
  for (const ch of String(text ?? '')) { const b = blockOf(ch.codePointAt(0)); if (b) return b.lang; }
  return null;
}
