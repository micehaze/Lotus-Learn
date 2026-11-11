// Multi-script utilities for the four learning languages (+ Hindi for equivalents).
// Tamil keeps its dedicated transliterator (shared/tamil.js); Malayalam, Kannada
// and Telugu use one Brahmic table because their Unicode blocks share the layout.
import { transliterate as tamilTransliterate, validateTamil, romanKey, stripDiacritics, normalizeText, levenshtein } from './tamil.js';

export const LANGUAGES = {
  ta: { code: 'ta', name: 'Tamil', native: 'தமிழ்', script: 'Taml', start: 0x0B80, end: 0x0BFF },
  ml: { code: 'ml', name: 'Malayalam', native: 'മലയാളം', script: 'Mlym', start: 0x0D00, end: 0x0D7F },
  kn: { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', script: 'Knda', start: 0x0C80, end: 0x0CFF },
  te: { code: 'te', name: 'Telugu', native: 'తెలుగు', script: 'Telu', start: 0x0C00, end: 0x0C7F },
};
export const LANG_CODES = Object.keys(LANGUAGES);
export const isLang = (c) => Object.prototype.hasOwnProperty.call(LANGUAGES, c);

const VOW = { 0x05: 'a', 0x06: 'ā', 0x07: 'i', 0x08: 'ī', 0x09: 'u', 0x0A: 'ū', 0x0B: 'r̥', 0x0C: 'l̥', 0x0E: 'e', 0x0F: 'ē', 0x10: 'ai', 0x12: 'o', 0x13: 'ō', 0x14: 'au', 0x60: 'r̥̄', 0x61: 'l̥̄' };
const CON = { 0x15: 'k', 0x16: 'kh', 0x17: 'g', 0x18: 'gh', 0x19: 'ṅ', 0x1A: 'c', 0x1B: 'ch', 0x1C: 'j', 0x1D: 'jh', 0x1E: 'ñ', 0x1F: 'ṭ', 0x20: 'ṭh', 0x21: 'ḍ', 0x22: 'ḍh', 0x23: 'ṇ', 0x24: 't', 0x25: 'th', 0x26: 'd', 0x27: 'dh', 0x28: 'n', 0x29: 'ṉ', 0x2A: 'p', 0x2B: 'ph', 0x2C: 'b', 0x2D: 'bh', 0x2E: 'm', 0x2F: 'y', 0x30: 'r', 0x31: 'ṟ', 0x32: 'l', 0x33: 'ḷ', 0x34: 'ḻ', 0x35: 'v', 0x36: 'ś', 0x37: 'ṣ', 0x38: 's', 0x39: 'h' };
const SIGN = { 0x3E: 'ā', 0x3F: 'i', 0x40: 'ī', 0x41: 'u', 0x42: 'ū', 0x43: 'r̥', 0x44: 'r̥̄', 0x46: 'e', 0x47: 'ē', 0x48: 'ai', 0x4A: 'o', 0x4B: 'ō', 0x4C: 'au', 0x57: 'au', 0x62: 'l̥', 0x63: 'l̥̄' };
const VIRAMA = 0x4D;
const ML_CHILLU = { 0x0D7A: 'ṇ', 0x0D7B: 'n', 0x0D7C: 'r', 0x0D7D: 'l', 0x0D7E: 'ḷ', 0x0D7F: 'k' };
const DEV = { start: 0x0900, end: 0x097F };

function blockOf(cp) {
  for (const l of Object.values(LANGUAGES)) if (cp >= l.start && cp <= l.end) return l;
  if (cp >= DEV.start && cp <= DEV.end) return { code: 'hi', start: DEV.start };
  return null;
}
export function langOfText(text) {
  const counts = {};
  for (const ch of String(text || '')) { const b = blockOf(ch.codePointAt(0)); if (b) counts[b.code] = (counts[b.code] || 0) + 1; }
  let best = null;
  for (const [k, v] of Object.entries(counts)) if (!best || v > counts[best]) best = k;
  return best; // 'ta' | 'ml' | 'kn' | 'te' | 'hi' | null (Latin / other)
}
export const hasNative = (text, lang) => { const l = LANGUAGES[lang]; return [...String(text || '')].some((c) => { const cp = c.codePointAt(0); return cp >= l.start && cp <= l.end; }); };

function brahmic(chars, i, start) {
  // returns [latin, consumed]
  const cp = chars[i].codePointAt(0);
  const off = cp - start;
  if (ML_CHILLU[cp]) return [ML_CHILLU[cp], 1];
  if (cp === 0x0D4E) return ['r', 1]; // Malayalam dot reph
  if (VOW[off] !== undefined) return [VOW[off], 1];
  if (CON[off] !== undefined) {
    const nx = chars[i + 1] ? chars[i + 1].codePointAt(0) - start : null;
    let skip = 0;
    let nn = nx;
    if (nn === 0x3C) { skip = 1; nn = chars[i + 2] ? chars[i + 2].codePointAt(0) - start : null; } // nukta
    if (nn === VIRAMA) return [CON[off], 2 + skip];
    if (nn !== null && SIGN[nn] !== undefined) {
      let n = 2 + skip;
      // Kannada/Telugu length marks after a sign
      const after = chars[i + n] ? chars[i + n].codePointAt(0) - start : null;
      if (after === 0x55 || after === 0x56) n++;
      return [CON[off] + SIGN[nn], n];
    }
    return [`${CON[off]}a`, 1 + skip];
  }
  if (off === 0x02) return ['ṁ', 1];
  if (off === 0x03) return ['ḥ', 1];
  if (off === 0x01) return ['m̐', 1];
  if (SIGN[off] !== undefined || off === VIRAMA || off === 0x55 || off === 0x56 || off === 0x3C) return ['', 1];
  return [chars[i], 1];
}

/** ISO-15919-style transliteration for any mix of Tamil, Malayalam, Kannada, Telugu or Hindi text. */
export function transliterateAny(text) {
  const chars = [...String(text || '').normalize('NFC')];
  let out = '';
  let i = 0;
  while (i < chars.length) {
    const b = blockOf(chars[i].codePointAt(0));
    if (!b) { out += chars[i]; i++; continue; }
    if (b.code === 'ta') { // hand Tamil runs to the dedicated transliterator
      let j = i; while (j < chars.length && blockOf(chars[j].codePointAt(0))?.code === 'ta') j++;
      out += tamilTransliterate(chars.slice(i, j).join('')); i = j; continue;
    }
    const [lat, n] = brahmic(chars, i, b.start);
    out += lat; i += n;
  }
  return out;
}

/** Validate well-formed text in the script of `lang`. Returns a list of problems (empty = valid). */
export function validateNative(text, lang = 'ta', { minRatio = 0.6 } = {}) {
  if (lang === 'ta') return validateTamil(text, { minRatio });
  const L = LANGUAGES[lang];
  if (!L) return ['unknown language'];
  const problems = [];
  const s = String(text || '').normalize('NFC').trim();
  if (!s) return ['empty'];
  const letters = [...s].filter((c) => /\p{L}|\p{M}/u.test(c));
  const own = letters.filter((c) => { const cp = c.codePointAt(0); return cp >= L.start && cp <= L.end; });
  if (!own.length) problems.push(`no ${L.name} script`);
  else if (own.length / letters.length < minRatio) problems.push(`mostly non-${L.name} characters`);
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const off = chars[i].codePointAt(0) - L.start;
    const isDependent = SIGN[off] !== undefined || off === VIRAMA;
    if (!isDependent) continue;
    const prev = chars[i - 1] ? chars[i - 1].codePointAt(0) - L.start : null;
    const prev2 = chars[i - 2] ? chars[i - 2].codePointAt(0) - L.start : null;
    const okPrev = (prev !== null && CON[prev] !== undefined) || (prev === 0x3C && prev2 !== null && CON[prev2] !== undefined);
    if (!okPrev) { problems.push(`vowel sign or virama without a consonant at position ${i + 1}`); break; }
  }
  return problems;
}

export function validateHindi(text) {
  return /[\u0900-\u097F]/.test(String(text || '')) ? [] : ['not in Devanagari script'];
}

export const NATIVE_RE = /[\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]/;
export function tokenizeAny(text) {
  return String(text || '').normalize('NFC').match(/[\u0B80-\u0BFF\u0C00-\u0D7F\u200C\u200D]+|[A-Za-z']+|\s+|[^\s\u0B80-\u0BFF\u0C00-\u0D7FA-Za-z']/g) || [];
}

/** Rough sentence count used by the 20-sentence minimum for stories. */
export function countSentences(text) {
  return String(text || '').split(/(?<=[.!?।॥])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 1 && /[\p{L}]/u.test(s)).length;
}

export { romanKey, stripDiacritics, normalizeText, levenshtein };
