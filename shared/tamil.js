// Tamil script utilities shared by server and browser.

const VOWELS = { 'அ': 'a', 'ஆ': 'ā', 'இ': 'i', 'ஈ': 'ī', 'உ': 'u', 'ஊ': 'ū', 'எ': 'e', 'ஏ': 'ē', 'ஐ': 'ai', 'ஒ': 'o', 'ஓ': 'ō', 'ஔ': 'au' };
const CONSONANTS = {
  'க': 'k', 'ங': 'ṅ', 'ச': 'c', 'ஞ': 'ñ', 'ட': 'ṭ', 'ண': 'ṇ', 'த': 't', 'ந': 'n', 'ப': 'p', 'ம': 'm',
  'ய': 'y', 'ர': 'r', 'ல': 'l', 'வ': 'v', 'ழ': 'ḻ', 'ள': 'ḷ', 'ற': 'ṟ', 'ன': 'ṉ', 'ஜ': 'j', 'ஷ': 'ṣ',
  'ஸ': 's', 'ஹ': 'h', 'ஶ': 'ś',
};
const SIGNS = { 'ா': 'ā', 'ி': 'i', 'ீ': 'ī', 'ு': 'u', 'ூ': 'ū', 'ெ': 'e', 'ே': 'ē', 'ை': 'ai', 'ொ': 'o', 'ோ': 'ō', 'ௌ': 'au', 'ௗ': '' };
const VIRAMA = '்';
const AYTHAM = 'ஃ';

export const TAMIL_RE = /[\u0B80-\u0BFF]/;
const TAMIL_LETTER_RE = /[\u0B85-\u0BB9]/;

/** ISO 15919-style transliteration of Tamil Unicode text. Non-Tamil passes through. */
export function transliterate(text) {
  if (!text) return '';
  const chars = [...String(text).normalize('NFC')];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (VOWELS[ch] !== undefined) out += VOWELS[ch];
    else if (CONSONANTS[ch] !== undefined) {
      const nx = chars[i + 1];
      if (nx === VIRAMA) { out += CONSONANTS[ch]; i++; }
      else if (nx !== undefined && SIGNS[nx] !== undefined) { out += CONSONANTS[ch] + SIGNS[nx]; i++; }
      else out += `${CONSONANTS[ch]}a`;
    } else if (ch === AYTHAM) out += 'ḵ';
    else if (SIGNS[ch] !== undefined || ch === VIRAMA) { /* stray mark: skip */ }
    else out += ch;
  }
  return out;
}

/** Validate that a string is well-formed Tamil script. Returns a list of problems. */
export function validateTamil(text, { minRatio = 0.6 } = {}) {
  const problems = [];
  const s = String(text || '').normalize('NFC').trim();
  if (!s) return ['empty'];
  const letters = [...s].filter((c) => /\p{L}|\p{M}/u.test(c));
  const tamil = letters.filter((c) => TAMIL_RE.test(c));
  if (!tamil.length) problems.push('no Tamil script');
  else if (tamil.length / letters.length < minRatio) problems.push('mostly non-Tamil characters');
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const prev = chars[i - 1];
    const isMark = SIGNS[c] !== undefined || c === VIRAMA;
    if (isMark && (prev === undefined || CONSONANTS[prev] === undefined)) {
      problems.push(`vowel sign or pulli without a consonant at position ${i + 1}`);
      break;
    }
  }
  return problems;
}
export const isTamil = (s) => validateTamil(s).length === 0;
export const hasTamil = (s) => TAMIL_RE.test(String(s || ''));

export function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Loose phonetic key so learners can type romanized Tamil any common way:
 * "thanneer", "tannir", "taṇṇīr" -> "tanir".
 */
export function romanKey(s) {
  let k = stripDiacritics(s).replace(/[^a-z]/g, '');
  k = k.replace(/ndr/g, 'nr').replace(/t+r/g, 'r');
  k = k.replace(/zh/g, 'l').replace(/th|dh/g, 't').replace(/ch|sh/g, 'c').replace(/ng/g, 'n')
    .replace(/ee|ii/g, 'i').replace(/oo|uu/g, 'u').replace(/aa/g, 'a')
    .replace(/s/g, 'c').replace(/b/g, 'p').replace(/d/g, 't').replace(/g/g, 'k').replace(/w/g, 'v').replace(/j/g, 'c')
    .replace(/h/g, '');
  return k.replace(/(.)\1+/g, '$1');
}

export function normalizeText(s) {
  let text=String(s || '').normalize('NFC');
  for (const [old,modern] of [['ണ്\u200d','ൺ'],['ന്\u200d','ൻ'],['ര്\u200d','ർ'],['ല്\u200d','ൽ'],['ള്\u200d','ൾ'],['ക്\u200d','ൿ']]) text=text.replaceAll(old,modern);
  return text.replace(/[\u200c\u200d]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
}

export function levenshtein(a, b, max = Infinity) {
  if (a === b) return 0;
  const A = [...a], B = [...b];
  if (Math.abs(A.length - B.length) > max) return max + 1;
  let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let k = 1; k <= B.length; k++) {
      cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (A[i - 1] === B[k - 1] ? 0 : 1));
      if (cur[k] < rowMin) rowMin = cur[k];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[B.length];
}

/** Split Tamil prose into tokens, keeping punctuation/spaces as separate tokens. */
export function tokenize(text) {
  // all four South Indian scripts (Tamil, Telugu, Kannada, Malayalam) + ZWJ/ZWNJ
  return String(text || '').normalize('NFC').match(/[\u0B80-\u0BFF\u0C00-\u0D7F\u200C\u200D]+|[A-Za-z']+|\s+|[^\s\u0B80-\u0BFF\u0C00-\u0D7FA-Za-z']/g) || [];
}

/** Replace [[target]] markers with a blank (for exercises) or strip them (for display). */
export function stripMarkers(s) {
  return String(s || '').replace(/\[\[(.+?)\]\]/g, '$1');
}

export function looksTamilLetter(c) {
  return TAMIL_LETTER_RE.test(c);
}
