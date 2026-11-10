// Core client utilities: escaping templates, API, state, router helpers, UI primitives.
import { transliterateAny as transliterate, LANGUAGES } from '/shared/indic.js';

export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
function val(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  return esc(v);
}
/** Tagged template: every interpolation is HTML-escaped unless wrapped in raw()/h``. */
export function h(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += val(v) + strings[i + 1]; });
  return new Raw(out);
}

// ------------------------------------------------------------------ API
export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'x-requested-with': 'lotus' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    const e = new Error('Cannot reach the server. Check your connection and try again.'); e.status = 0; throw e;
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const e = new Error(data?.error || `Request failed (${res.status})`);
    e.status = res.status; e.details = data?.details; e.code = data?.code;
    throw e;
  }
  return data;
}
export const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v); const s = p.toString(); return s ? `?${s}` : ''; };

// ------------------------------------------------------------------ state
export const state = { user: null, profile: null, meta: null, get lang() { return this.profile?.activeLanguage || 'ta'; } };
export const langName = (c = state.lang) => (c === 'hi' ? 'Hindi' : LANGUAGES[c]?.name || c);
export const langNative = (c = state.lang) => LANGUAGES[c]?.native || '';
export function applyPrefs() {
  const p = state.profile;
  document.body.classList.toggle('hide-tr', p ? !p.showTransliteration : false);
  const theme = state.user && p ? p.activeLanguage : '';
  if ((document.body.dataset.theme || '') !== theme) {
    document.body.classList.add('theme-switching');
    setTimeout(() => document.body.classList.remove('theme-switching'), 450);
    if (theme) document.body.dataset.theme = theme; else delete document.body.dataset.theme;
  }
  document.documentElement.dataset.learning = theme || 'ta';
  const sysReduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motion = p?.motion || 'full';
  document.body.classList.toggle('motion-off', motion === 'off');
  document.body.classList.toggle('motion-reduced', motion === 'reduced' || sysReduce);
}
export function motionAllowed() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return (state.profile?.motion || 'full') === 'full';
}

// ------------------------------------------------------------------ navigation
let navigateImpl = (p) => { location.href = p; };
export const setNavigator = (fn) => { navigateImpl = fn; };
export const go = (path, opts) => navigateImpl(path, opts);

// ------------------------------------------------------------------ UI primitives
export function win({ title, body, variant = '', corner, cornerBr = false, icon, cls = '', foot, id, close, headingLevel = 2 }) {
  const tag = `h${headingLevel}`;
  return h`<section class="win ${variant ? `win--${variant}` : ''} win-open ${cls}" ${corner ? raw(`data-corner="${esc(corner)}"`) : ''} ${cornerBr ? raw('data-corner-br') : ''} ${id ? raw(`id="${esc(id)}"`) : ''} aria-label="${title}">
    <header class="win__bar">${icon ? h`<img class="win__icon" src="${icon}" alt="">` : ''}<${raw(tag)} class="win__title">${title}</${raw(tag)}>
      <span class="win__ctl" aria-hidden="${close ? 'false' : 'true'}">${close ? h`<button type="button" data-close aria-label="Close">×</button>` : h`<span>_</span><span>□</span><span>×</span>`}</span></header>
    <div class="win__body">${body}</div>${foot ? h`<div class="win__foot">${foot}</div>` : ''}</section>`;
}
export function lotus(stage, size = '') {
  const n = Math.max(0, Math.min(5, Number(stage) || 0));
  const label = n === 0 ? 'No lotus yet' : n === 5 ? 'Fully bloomed lotus (5 of 5)' : `${n} of 5 lotus rewards`;
  return h`<span class="lotus ${size ? `lotus--${size}` : ''}" style="--frame:${n}" role="img" aria-label="${label}" title="${label}"></span>`;
}
export function ta(text, { size = '', tr = true, block = false, lang } = {}) {
  return h`<span class="ta ${size ? `ta-${size}` : ''}" lang="${lang || state.lang}" ${block ? raw('style="display:block"') : ''}>${text}</span>${tr ? h`<span class="tr">${transliterate(text)}</span>` : ''}`;
}
export const level = (code) => (code ? h`<span class="level-badge" title="${state.meta?.levels.find((l) => l.code === code)?.name || code}">${code}</span>` : '');
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const fmtDur = (s) => { s = Math.round(s || 0); const m = Math.floor(s / 60); const r = s % 60; return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(r).padStart(2, '0')}`; };
export const fmtMs = (ms) => { const s = Math.round((ms || 0) / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
export function errorsBox(e) {
  const probs = e?.details?.problems;
  return h`<div class="errors" role="alert"><strong>${e.message}</strong>${probs?.length ? h`<ul>${probs.map((p) => h`<li>${p}</li>`)}</ul>` : ''}</div>`;
}
export function empty(title, text, action = '') {
  return h`<div class="empty"><img src="/art/ui/coconut.png" alt=""><h3>${title}</h3><p class="muted">${text}</p>${action}</div>`;
}
export const loadingView = () => h`<div class="loading" role="status"><span class="lotus lotus--lg" style="--frame:9"></span>Loading…</div>`;

let toastBox;
export function toast(msg, kind = 'ok') {
  if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'toasts'; toastBox.setAttribute('aria-live', 'polite'); document.body.append(toastBox); }
  const t = document.createElement('div');
  t.className = `toast toast--${kind}`; t.textContent = msg;
  toastBox.append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3800);
}

/** Opens a retro-window modal. Returns { el, close }. `onMount(el, close)` binds events. */
export function modal({ title, body, foot, variant = 'salmon', corner = 'frangipani', onMount, onClose }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = String(h`<div class="modal" role="dialog" aria-modal="true">${win({ title, body, foot, variant, corner, close: true })}</div>`);
  const prev = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); onClose?.(); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') { // focus trap
      const f = [...back.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  (back.querySelector('input, select, textarea, .btn:not([data-close])') || back.querySelector('[data-close]'))?.focus();
  onMount?.(back, close);
  return { el: back, close };
}
export function confirmDialog({ title = 'Please confirm', text, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title, variant: danger ? 'coral' : 'salmon',
      body: h`<p>${text}</p>`,
      foot: h`<button class="btn btn--ghost" data-close type="button">Cancel</button><button class="btn ${danger ? 'btn--danger' : ''}" data-ok type="button">${confirmLabel}</button>`,
      onMount: (el, close) => el.querySelector('[data-ok]').addEventListener('click', () => { answered = true; resolve(true); close(); }),
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

/** Save library words (or a custom word) into one of the learner's collections. */
export async function saveToCollection({ vocabularyIds, word, title = 'Save to collection', source, sourceRef, onSaved }) {
  let cols;
  try { cols = (await api('/collections')).collections; } catch (e) { toast(e.message, 'bad'); return; }
  modal({
    title,
    body: h`<form data-save>
      ${cols.length ? h`<label class="field"><span>Collection</span><select name="cid">${cols.map((c) => h`<option value="${c.id}">${c.title} (${c.wordCount})</option>`)}<option value="new">+ New collection…</option></select></label>`
        : h`<p class="muted">You have no collections yet. Name your first one:</p><input type="hidden" name="cid" value="new">`}
      <label class="field" data-newname ${cols.length ? raw('hidden') : ''}><span>New collection name</span><input type="text" name="title" maxlength="80" placeholder="Words from stories"></label>
      ${word && !word.english ? h`<label class="field"><span>English meaning</span><input type="text" name="english" required maxlength="200"></label>` : ''}
      <div data-err></div>
      <div class="btn-row"><button class="btn btn--bloom" type="submit">Save</button><button class="btn btn--ghost" type="button" data-close>Cancel</button></div></form>`,
    onMount(el, close) {
      const f = el.querySelector('form');
      const sel = f.querySelector('select');
      sel?.addEventListener('change', () => { el.querySelector('[data-newname]').hidden = sel.value !== 'new'; });
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(f);
        try {
          let cid = fd.get('cid');
          if (cid === 'new') cid = (await api('/collections', { method: 'POST', body: { title: fd.get('title') || 'My words' } })).id;
          const body = vocabularyIds ? { vocabularyIds, source, sourceRef } : { ...word, english: word.english || fd.get('english'), source, sourceRef };
          const r = await api(`/collections/${cid}/words`, { method: 'POST', body });
          close();
          toast(r.skipped ? `Saved ${r.added} word(s); ${r.skipped} already there.` : 'Saved to collection.');
          onSaved?.(Number(cid));
        } catch (err) { el.querySelector('[data-err]').innerHTML = String(errorsBox(err)); }
      });
    },
  });
}

export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function formData(form) { return Object.fromEntries(new FormData(form)); }
export { transliterate };
