// Pronunciation helpers for every piece of native-script text in the app:
//  1. an easy English-letter spelling under it (Manglish/Tanglish style, see shared/phonetic.js)
//  2. a 🔊 button that reads it aloud with the browser's built-in speech voices.
// Pages don't need to do anything: a MutationObserver finds `.ta` elements as they render.
import { phonetic, scriptLang } from '/shared/phonetic.js';
import { transliterateAny } from '/shared/indic.js';

const LEARNING = new Set(['ta', 'ml', 'kn', 'te', 'hi']);
const NAMES = { ta: 'Tamil', ml: 'Malayalam', kn: 'Kannada', te: 'Telugu', hi: 'Hindi' };
const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
export const canSpeak = !!(synth && typeof SpeechSynthesisUtterance !== 'undefined');

// ------------------------------------------------------------------ speech
let voices = [];
const loadVoices = () => { voices = canSpeak ? synth.getVoices() : []; };
if (canSpeak) { loadVoices(); synth.addEventListener?.('voiceschanged', loadVoices); }

function pickVoice(lang) {
  const match = (v, re) => re.test(v.lang.replace('_', '-'));
  const exact = new RegExp(`^${lang}(-|$)`, 'i');
  const all = voices.filter((v) => match(v, exact));
  // Prefer natural/online voices (Edge "Online (Natural)", Chrome "Google ...") over robotic offline ones.
  return all.find((v) => /natural|online|google/i.test(v.name)) || all[0] || null;
}
const fallbackVoice = () => pickVoice('en-IN') || voices.find((v) => /^en-IN/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang)) || null;

const warned = new Set();
let current = null; // the button whose text is playing

function setPlaying(btn, on) {
  if (!btn) return;
  btn.classList.toggle('say--on', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

/**
 * Read native text aloud. Uses a voice for the language when the device has one;
 * otherwise reads the easy spelling with an Indian-English voice (close, not perfect).
 * Returns 'native' | 'fallback' | 'unsupported'.
 */
export function speak(text, lang = scriptLang(text), { btn, onFallback } = {}) {
  if (!canSpeak || !text) return 'unsupported';
  if (!voices.length) loadVoices();
  const wasPlaying = current;
  synth.cancel();
  setPlaying(wasPlaying, false);
  current = null;
  if (btn && wasPlaying === btn) return 'native'; // second click on the same button stops it

  const voice = pickVoice(lang);
  const u = new SpeechSynthesisUtterance();
  let mode = 'native';
  if (voice) {
    u.text = text; u.voice = voice; u.lang = voice.lang;
  } else {
    mode = 'fallback';
    const fb = fallbackVoice();
    u.text = phonetic(text);
    u.lang = fb?.lang || 'en-IN';
    if (fb) u.voice = fb;
    if (!warned.has(lang)) { warned.add(lang); onFallback?.(lang); }
  }
  u.rate = 0.85; // a little slower than conversation, for learners
  current = btn || null;
  setPlaying(btn, true);
  const done = () => { if (current === btn) { setPlaying(btn, false); current = null; } };
  u.onend = done; u.onerror = done;
  synth.speak(u);
  return mode;
}

export const fallbackMessage = (lang) => `This device has no ${NAMES[lang] || 'voice for this language'} voice, so the easy spelling is read with an English voice. For real ${NAMES[lang] || ''} pronunciation, add the voice in your system speech settings (on Windows: Settings → Time & language → Speech → Add voices), or open Lotus Learn in Microsoft Edge, which has natural Indian-language voices.`;

// ------------------------------------------------------------------ automatic enhancement
// A <button> can't sit inside these. Inside links it's allowed: the click handler stops navigation.
const NO_BUTTON_INSIDE = 'button, label, summary, .opt, [data-no-say]';
const SKIP = 'option, select, textarea, svg, [data-no-ph]';
const MAX_SPEAK = 2000;

function langFor(el, text) {
  const a = (el.getAttribute('lang') || '').slice(0, 2).toLowerCase();
  return scriptLang(text) || (LEARNING.has(a) ? a : null);
}

/** Add/refresh the easy spelling and 🔊 button for one native-text element. */
export function enhance(el) {
  const text = (el.textContent || '').trim();
  if (!text || el.dataset.phSrc === text || el.closest(SKIP)) return;
  const lang = langFor(el, text);
  if (!lang) return; // English or empty: nothing to pronounce
  el.dataset.phSrc = text;
  const easy = phonetic(text).replace(/\s+/g, ' ').trim();

  const scholarly = transliterateAny(text).replace(/\s+/g, ' ').trim();
  const inLink = !!el.closest('a');

  // Spelling line: reuse the .tr the page rendered (it may hold a stored scholarly spelling), or add one.
  let tr = el.nextElementSibling?.classList.contains('tr') ? el.nextElementSibling : null;
  if (!tr && inLink) el.title = easy; // link titles (stories, history): hover shows the spelling, no extra line
  else {
    if (!tr) {
      tr = document.createElement('span');
      tr.className = 'tr tr--easy';
      el.after(tr);
    }
    tr.textContent = easy;
    tr.dataset.phFor = '1';
    if (scholarly && scholarly !== easy) tr.title = `Scholarly spelling: ${scholarly}`;
  }
  const anchor = tr || el;

  // Listen button, outside interactive controls (a button can't contain a button).
  if (!canSpeak || text.length > MAX_SPEAK || el.closest(NO_BUTTON_INSIDE)) return;
  let btn = anchor.nextElementSibling?.classList.contains('say') ? anchor.nextElementSibling : null;
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'say';
    btn.textContent = '🔊';
    btn.setAttribute('aria-pressed', 'false');
    anchor.after(btn);
  }
  btn._sayTarget = el;
  btn.dataset.lang = lang;
  const label = `Listen: ${easy.length > 60 ? `${easy.slice(0, 57)}…` : easy}`;
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

const SELECTOR = '.ta';
function scan(root) {
  if (!(root instanceof Element)) return;
  if (root.matches(SELECTOR)) enhance(root);
  for (const el of root.querySelectorAll(SELECTOR)) enhance(el);
}

/** Watch the page so every native word, phrase or paragraph gets its spelling and listen button. */
export function startPronunciationHelpers({ notify } = {}) {
  scan(document.body);
  new MutationObserver((records) => {
    const touched = new Set();
    for (const r of records) {
      if (r.type === 'characterData') { const t = r.target.parentElement?.closest(SELECTOR); if (t) touched.add(t); continue; }
      for (const n of r.addedNodes) {
        if (n.nodeType === 1) { if (n.dataset?.phFor || n.classList?.contains('say')) continue; touched.add(n); const t = n.parentElement?.closest(SELECTOR); if (t) touched.add(t); }
        else if (n.nodeType === 3) { const t = n.parentElement?.closest(SELECTOR); if (t) touched.add(t); }
      }
    }
    for (const el of touched) { if (el.isConnected) scan(el); }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('button.say');
    if (!btn || !btn._sayTarget) return;
    e.preventDefault();
    e.stopPropagation();
    const target = btn._sayTarget;
    speak((target.textContent || '').trim(), btn.dataset.lang, { btn, onFallback: (l) => notify?.(fallbackMessage(l)) });
  }, true);
  if (canSpeak) addEventListener('pagehide', () => synth.cancel());
}
