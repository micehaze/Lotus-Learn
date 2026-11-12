import { h, raw, api, qs, state, win, toast, confirmDialog, langName, debounce, errorsBox, esc } from '../core.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Tiny, safe formatting: **bold**, _italic_, "- " bullets. Escapes first, then formats. */
export function formatNote(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1<em>$2</em>').replace(/^- (.*)$/gm, '• $1');
}

export async function page({ query, navigate }) {
  const today = ymd(new Date());
  const date = /^\d{4}-\d{2}-\d{2}$/.test(query.date || '') ? query.date : today;
  const ym = query.ym && /^\d{4}-\d{2}$/.test(query.ym) ? query.ym : date.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const [month, dayNotes, search] = await Promise.all([api(`/notes/month?ym=${ym}`), api(`/notes/day?date=${date}`), query.q ? api(`/notes/search?q=${encodeURIComponent(query.q)}`) : Promise.resolve(null)]);
  const first = new Date(y, m - 1, 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)); // weeks start on Monday
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const shift = (months) => { const d = new Date(y, m - 1 + months, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const go = (o) => `/notes${qs({ ym, date, ...o })}`;
  return {
    title: 'Learning Notes', scene: 'notes', keepScroll: true,
    html: h`<div class="page-head"><div><h1>Learning Notes</h1><p>Your personal ${langName()} notebook. Notes in other languages are kept separately.</p></div></div>
    <div class="split" style="grid-template-columns:minmax(0,380px) minmax(0,1fr)">
      <div class="stack">
        ${win({ title: `${MONTHS[m - 1]} ${y}`, variant: 'green', corner: 'frangipani', body: h`
          <div class="spread" style="margin-bottom:8px"><span class="btn-row">
            <a class="btn btn--small btn--ghost" href="${go({ ym: `${y - 1}-${pad(m)}` })}" aria-label="Previous year">«</a><a class="btn btn--small btn--ghost" href="${go({ ym: shift(-1) })}" aria-label="Previous month">‹</a></span>
            <a class="btn btn--small" href="/notes${qs({ date: today })}">Today</a>
            <span class="btn-row"><a class="btn btn--small btn--ghost" href="${go({ ym: shift(1) })}" aria-label="Next month">›</a><a class="btn btn--small btn--ghost" href="${go({ ym: `${y + 1}-${pad(m)}` })}" aria-label="Next year">»</a></span></div>
          <table class="cal" aria-label="Calendar for ${MONTHS[m - 1]} ${y}"><tr>${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => h`<th scope="col">${d}</th>`)}</tr>
          ${[0, 1, 2, 3, 4, 5].map((w) => h`<tr>${cells.slice(w * 7, w * 7 + 7).map((d) => { const k = ymd(d); const n = month.days[k]; return h`<td><button type="button" data-day="${k}" class="${d.getMonth() !== m - 1 ? 'other' : ''} ${k === today ? 'today' : ''}" aria-pressed="${k === date ? 'true' : 'false'}" aria-label="${k}${n ? `, ${n} note(s)` : ''}">${d.getDate()}${n ? h`<span class="dot">${n}</span>` : ''}</button></td>`; })}</tr>`)}</table>
          <form class="row" data-jump style="margin-top:10px"><label class="visually-hidden" for="jump">Go to date</label><input id="jump" type="text" name="date" placeholder="YYYY-MM-DD" style="flex:1"><button class="btn btn--small btn--cyan" type="submit">Go</button></form>` })}
        ${win({ title: 'Search notes', variant: 'salmon', body: h`<form class="row" data-search><input type="search" name="q" value="${query.q || ''}" placeholder="Word, phrase or topic" style="flex:1"><button class="btn btn--small btn--cyan" type="submit">Search</button></form>
          ${search ? (search.length ? h`<ul class="list" style="margin-top:8px">${search.map((n) => h`<li><a href="/notes${qs({ date: n.date, ym: n.date.slice(0, 7) })}"><strong>${n.date}</strong> ${n.title || ''}</a><br><span class="small muted">${n.body.slice(0, 90)}</span></li>`)}</ul>` : h`<p class="muted small">No notes match.</p>`) : ''}` })}
      </div>
      ${win({ title: `Notes for ${date}`, corner: 'hibiscus', cornerBr: true, body: h`<div data-notes>${dayNotes.map((n) => noteCard(n))}</div>
        <div class="btn-row"><button class="btn btn--bloom" type="button" data-new>New note for ${date}</button></div>
        <p class="small muted" style="margin-top:8px">Notes save automatically. Formatting: **bold**, _italic_, “- ” for bullet lines. Native scripts are fully supported.</p>` })}
    </div>`,
    mount(root) {
      root.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => navigate(`/notes${qs({ ym, date: b.dataset.day })}`)));
      root.querySelector('[data-search]').addEventListener('submit', (e) => { e.preventDefault(); navigate(`/notes${qs({ ym, date, q: new FormData(e.target).get('q') })}`); });
      root.querySelector('[data-jump]').addEventListener('submit', (e) => { e.preventDefault(); const d = new FormData(e.target).get('date'); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) navigate(`/notes${qs({ ym: d.slice(0, 7), date: d })}`); else toast('Use the format YYYY-MM-DD.', 'bad'); });
      const box = root.querySelector('[data-notes]');
      dayNotes.forEach((n) => bindCard(box.querySelector(`[data-note="${n.id}"]`), n));
      root.querySelector('[data-new]').addEventListener('click', () => {
        const draft = { id: null, date, title: '', body: '' };
        box.insertAdjacentHTML('beforeend', String(noteCard(draft)));
        const card = box.lastElementChild; bindCard(card, draft); card.querySelector('textarea').focus();
      });
    },
  };
}

function noteCard(n) {
  return h`<article class="note-card" data-note="${n.id || 'new'}">
    <label class="field"><span>Title</span><input type="text" name="title" value="${n.title}" maxlength="120" placeholder="What did you learn?"></label>
    <label class="field"><span>Note</span><textarea name="body" lang="${state.lang}" placeholder="Write freely in ${langName()} and English…">${n.body}</textarea></label>
    <div class="spread"><span class="save-state" aria-live="polite">${n.id ? 'Saved' : 'Not saved yet'}</span>
      <span class="btn-row"><button class="btn btn--small btn--ghost" type="button" data-preview>Preview</button><button class="btn btn--small btn--ghost" type="button" data-append ${n.id ? '' : raw('disabled')}>Append</button><button class="btn btn--small btn--danger" type="button" data-del>Delete</button></span></div>
    <div class="note-preview" hidden></div>
    <div data-appendbox hidden style="margin-top:8px"><label class="field"><span>Add to the end of this note</span><textarea name="extra" lang="${state.lang}"></textarea></label><button class="btn btn--small" type="button" data-doappend>Append to note</button></div></article>`;
}

let pending = 0;
addEventListener('beforeunload', (e) => { if (pending) { e.preventDefault(); e.returnValue = ''; } });
function bindCard(card, note) {
  const st = card.querySelector('.save-state');
  const title = card.querySelector('[name=title]'); const body = card.querySelector('[name=body]');
  let saving = Promise.resolve();
  const save = async () => {
    if (!note.id && !title.value.trim() && !body.value.trim()) return;
    pending++; st.textContent = 'Saving…';
    saving = saving.then(async () => {
      try {
        const r = note.id ? await api(`/notes/${note.id}`, { method: 'PATCH', body: { title: title.value, body: body.value } }) : await api('/notes', { method: 'POST', body: { date: note.date, title: title.value, body: body.value } });
        note.id = r.id; card.dataset.note = r.id; card.querySelector('[data-append]').disabled = false; st.textContent = `Saved ${new Date(r.updatedAt).toLocaleTimeString()}`;
      } catch (e) { st.textContent = `Not saved: ${e.message}. Your text is still here — keep this page open and try again.`; }
      finally { pending--; }
    });
    return saving;
  };
  const later = debounce(save, 800);
  title.addEventListener('input', () => { st.textContent = 'Unsaved changes…'; later(); });
  body.addEventListener('input', () => { st.textContent = 'Unsaved changes…'; later(); });
  body.addEventListener('blur', save);
  card.querySelector('[data-preview]').addEventListener('click', () => { const p = card.querySelector('.note-preview'); p.hidden = !p.hidden; p.innerHTML = formatNote(body.value); });
  card.querySelector('[data-append]').addEventListener('click', () => { card.querySelector('[data-appendbox]').hidden = false; card.querySelector('[name=extra]').focus(); });
  card.querySelector('[data-doappend]').addEventListener('click', async () => {
    const extra = card.querySelector('[name=extra]');
    if (!extra.value.trim()) return;
    await save();
    try { const r = await api(`/notes/${note.id}`, { method: 'PATCH', body: { mode: 'append', body: extra.value } }); body.value = r.body; extra.value = ''; card.querySelector('[data-appendbox]').hidden = true; st.textContent = 'Appended and saved'; }
    catch (e) { st.innerHTML = String(errorsBox(e)); }
  });
  card.querySelector('[data-del]').addEventListener('click', async () => {
    if (!note.id) { card.remove(); return; }
    if (!(await confirmDialog({ title: 'Delete note', text: 'Delete this note permanently? This cannot be undone.', confirmLabel: 'Delete note' }))) return;
    await api(`/notes/${note.id}`, { method: 'DELETE' }); card.remove(); toast('Note deleted.');
  });
}
