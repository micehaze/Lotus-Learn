import { h, raw, api, qs, state, win, ta, level, empty, toast, errorsBox, saveToCollection, transliterate, fmtDur, fmtDate, debounce } from '../core.js';
import { tokenize, hasTamil } from '/shared/tamil.js';

const CAT = (c) => String(c || '').replace(/-/g, ' ');

export async function reading({ query, navigate }) {
  const r = await api(`/stories${qs({ level: query.level, category: query.category, q: query.q })}`);
  const m = state.meta;
  return {
    title: 'Reading', scene: 'river',
    html: h`<div class="page-head"><div><h1>Reading library</h1><p>Tamil stories with transliteration, translations and tap-to-look-up words.</p></div></div>
    <div class="stack">
      ${win({ title: 'Filter stories', variant: 'salmon', body: h`<form class="filters" data-f>
        <label class="field"><span>Level</span><select name="level"><option value="">All</option>${m.levels.map((l) => h`<option value="${l.code}" ${l.code === query.level ? raw('selected') : ''}>${l.code} · ${l.name}</option>`)}</select></label>
        <label class="field"><span>Category</span><select name="category"><option value="">All</option>${m.storyCategories.map((c) => h`<option value="${c}" ${c === query.category ? raw('selected') : ''}>${CAT(c)}</option>`)}</select></label>
        <label class="field"><span>Title</span><input type="search" name="q" value="${query.q || ''}"></label><button class="btn btn--cyan" type="submit">Show stories</button></form>` })}
      ${r.items.length ? h`<div class="cards cards--wide">${r.items.map((s, i) => win({ title: s.titleEn || s.title, variant: ['', 'green', 'coral', 'orange'][i % 4], corner: i === 0 ? 'hibiscus' : undefined, body: h`
          <p class="ta ta-lg" lang="ta" style="margin:0">${s.title}</p><p class="small muted">${s.summary}</p>
          <div class="row small">${level(s.level)}<span class="chip">${CAT(s.category)}</span><span class="chip chip--salmon">${s.register}</span><span class="muted">${s.wordCount} words</span></div>
          ${s.progress ? h`<div class="meter" style="--v:${s.progress.progress}%;margin-top:10px" aria-label="Read ${s.progress.progress}%"><span></span></div>` : ''}`,
          foot: h`<span class="small muted" style="margin-right:auto">${s.sourceType === 'ai-generated' ? 'AI-assisted, reviewed' : s.sourceType}</span><a class="btn btn--small" href="/reading/${s.id}">${s.progress?.progress >= 100 ? 'Read again' : s.progress ? 'Continue' : 'Read'}</a>` }))}</div>`
        : win({ title: 'No stories', body: empty('No stories match', 'Try another level or category.') })}
    </div>`,
    mount(root) { root.querySelector('[data-f]').addEventListener('submit', (e) => { e.preventDefault(); navigate(`/reading${qs(Object.fromEntries(new FormData(e.target)))}`); }); },
  };
}

/** Wraps every Tamil word in a focusable span for lookups. */
function wordify(text) {
  return tokenize(text).map((t) => (hasTamil(t) ? h`<span class="w" tabindex="0" role="button" data-w="${t}">${t}</span>` : t));
}

function lookupPopover(token, anchor, ctx) {
  document.querySelector('.popover')?.remove();
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.innerHTML = String(win({ title: token, variant: 'salmon', close: true, body: h`<p class="muted">Looking up…</p>` }));
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.min(innerWidth - pop.offsetWidth - 12, Math.max(12, r.left))}px`;
  pop.style.top = `${r.bottom + 8 + pop.offsetHeight > innerHeight ? Math.max(12, r.top - pop.offsetHeight - 8) : r.bottom + 8}px`;
  const close = () => { pop.remove(); document.removeEventListener('keydown', esc); anchor.focus(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  pop.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  api(`/dictionary/lookup${qs({ ta: token })}`).then((res) => {
    const body = pop.querySelector('.win__body');
    if (res.entry) {
      const w = res.entry;
      body.innerHTML = String(h`${ta(w.tamil, { size: 'lg' })}<p style="margin:0"><strong>${w.english}</strong> ${level(w.level)}</p>
        ${res.match === 'stem' ? h`<p class="small muted">“${token}” is a form of this word.</p>` : ''}
        <p class="small muted">${w.partOfSpeech} · ${w.register}</p>
        <div class="btn-row"><button class="btn btn--small btn--bloom" data-sv type="button">Save to collection</button><a class="btn btn--small btn--ghost" href="/vocabulary/word/${w.id}">Full entry</a></div>`);
      body.querySelector('[data-sv]').addEventListener('click', () => { close(); saveToCollection({ vocabularyIds: [w.id], source: ctx.source, sourceRef: ctx.ref }); });
    } else {
      body.innerHTML = String(h`${ta(token, { size: 'lg' })}<p class="small">This form isn't in the dictionary yet. You can save it as your own word.</p>
        <form data-own><label class="field"><span>English meaning</span><input type="text" name="english" required></label><button class="btn btn--small btn--bloom" type="submit">Save as my word</button></form>`);
      body.querySelector('[data-own]').addEventListener('submit', (e) => { e.preventDefault(); const en = new FormData(e.target).get('english'); close(); saveToCollection({ word: { tamil: token, english: en, notes: `From: ${ctx.title}` }, source: ctx.source, sourceRef: ctx.ref }); });
    }
  }).catch((e) => { pop.querySelector('.win__body').innerHTML = String(errorsBox(e)); });
}

export function bindWords(root, ctx) {
  root.addEventListener('click', (e) => { const w = e.target.closest('[data-w]'); if (w) lookupPopover(w.dataset.w, w, ctx); });
  root.addEventListener('keydown', (e) => { const w = e.target.closest('[data-w]'); if (w && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); lookupPopover(w.dataset.w, w, ctx); } });
  // save a selected phrase
  root.addEventListener('mouseup', () => {
    const sel = getSelection().toString().trim();
    document.querySelector('[data-phrase]')?.remove();
    if (!sel || !hasTamil(sel) || !sel.includes(' ') || sel.length > 80) return;
    const b = document.createElement('button');
    b.className = 'btn btn--small btn--bloom'; b.dataset.phrase = ''; b.type = 'button'; b.textContent = 'Save phrase';
    b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:60';
    b.addEventListener('click', () => { b.remove(); saveToCollection({ word: { tamil: sel, english: '' }, title: 'Save phrase', source: ctx.source, sourceRef: ctx.ref }); });
    document.body.append(b);
  });
}

export async function reader({ params }) {
  const s = await api(`/stories/${params.id}`);
  const ctx = { source: 'story', ref: String(s.id), title: s.titleEn || s.title };
  return {
    title: s.titleEn || s.title, scene: 'river',
    html: h`<div style="max-width:860px;margin:0 auto" class="stack">
      ${win({ title: s.titleEn || 'Story', variant: 'salmon', corner: 'hibiscus', cornerBr: true, body: h`
        <h1 class="ta ta-xl" lang="ta" style="margin:0">${s.title}</h1><span class="tr">${transliterate(s.title)}</span>
        <div class="row small" style="margin:8px 0">${level(s.level)}<span class="chip">${CAT(s.category)}</span><span class="chip chip--salmon">${s.register} Tamil</span>${s.topic ? h`<span class="chip chip--green">${s.topic}</span>` : ''}</div>
        <div class="btn-row" role="group" aria-label="Reading aids"><label class="check"><input type="checkbox" data-tog="tr" ${state.profile.showTransliteration ? raw('checked') : ''}> Transliteration</label><label class="check"><input type="checkbox" data-tog="en"> English translation</label></div>
        <p class="small muted" style="margin:8px 0 0">Tap any word to look it up. Select several words to save a phrase.</p>` })}
      ${win({ title: 'Story', corner: 'frangipani', body: h`<div class="reader" data-reader>
        ${s.paragraphs.map((p, i) => h`<p class="para" data-i="${i}"><span class="ta" lang="ta">${wordify(p.ta)}</span><span class="tr">${transliterate(p.ta)}</span>${p.en ? h`<span class="para-en">${p.en}</span><button class="btn btn--small btn--ghost" type="button" data-pt="${i}" style="margin-top:6px">Translate paragraph</button>` : ''}</p>`)}</div>
        <p class="small muted">Source: ${s.sourceNote || s.sourceType}${s.license ? ` · ${s.license}` : ''}</p>` })}
      <div class="btn-row"><a class="btn btn--ghost" href="/reading">Back to library</a><span class="small" style="color:#fff;text-shadow:1px 1px 0 var(--line)" data-prog>${s.progress ? `Read ${s.progress.progress}%` : ''}</span></div></div>`,
    mount(root) {
      document.body.classList.add('hide-en');
      const rd = root.querySelector('[data-reader]');
      bindWords(rd, ctx);
      root.querySelector('[data-tog=tr]').addEventListener('change', (e) => document.body.classList.toggle('hide-tr', !e.target.checked));
      root.querySelector('[data-tog=en]').addEventListener('change', (e) => document.body.classList.toggle('hide-en', !e.target.checked));
      rd.addEventListener('click', (e) => { const b = e.target.closest('[data-pt]'); if (b) { const en = b.previousElementSibling; en.classList.toggle('show'); b.textContent = en.classList.contains('show') ? 'Hide translation' : 'Translate paragraph'; } });
      const total = s.paragraphs.length;
      let maxSeen = s.progress?.lastParagraph ?? -1;
      const save = debounce(() => {
        const pct = Math.round(((maxSeen + 1) / total) * 100);
        api(`/stories/${s.id}/progress`, { method: 'PUT', body: { paragraph: maxSeen, progress: pct } }).then((r) => { const el = root.querySelector('[data-prog]'); if (el) el.textContent = `Read ${r.progress}%`; }).catch(() => {});
      }, 800);
      const io = new IntersectionObserver((entries) => { for (const en of entries) if (en.isIntersecting) { const i = Number(en.target.dataset.i); if (i > maxSeen) { maxSeen = i; save(); } } }, { threshold: 0.6 });
      rd.querySelectorAll('.para').forEach((p) => io.observe(p));
      if (s.progress?.lastParagraph > 0) rd.querySelector(`[data-i="${s.progress.lastParagraph}"]`)?.scrollIntoView({ block: 'center' });
      const cleanup = new MutationObserver(() => { if (!document.body.contains(rd)) { io.disconnect(); document.body.classList.remove('hide-en'); document.body.classList.toggle('hide-tr', !state.profile.showTransliteration); cleanup.disconnect(); } });
      cleanup.observe(document.getElementById('main'), { childList: true });
    },
    keepScroll: true,
  };
}

export async function videos({ query, navigate }) {
  const list = await api(`/videos${qs({ level: query.level, category: query.category, favorite: query.favorite, watched: query.watched })}`);
  const m = state.meta;
  return {
    title: 'Videos', scene: 'dusk',
    html: h`<div class="page-head"><div><h1>Video library</h1><p>Tamil videos played through official YouTube embeds.</p></div></div>
    <div class="stack">
      ${win({ title: 'Filter videos', variant: 'salmon', body: h`<form class="filters" data-f>
        <label class="field"><span>Level</span><select name="level"><option value="">All</option>${m.levels.map((l) => h`<option value="${l.code}" ${l.code === query.level ? raw('selected') : ''}>${l.code}</option>`)}</select></label>
        <label class="field"><span>Category</span><select name="category"><option value="">All</option>${m.videoCategories.map((c) => h`<option value="${c}" ${c === query.category ? raw('selected') : ''}>${CAT(c)}</option>`)}</select></label>
        <label class="field"><span>Show</span><select name="favorite"><option value="">All videos</option><option value="true" ${query.favorite === 'true' ? raw('selected') : ''}>Favourites</option></select></label>
        <label class="field"><span>Watched</span><select name="watched"><option value="">Any</option><option value="false" ${query.watched === 'false' ? raw('selected') : ''}>Not watched yet</option><option value="true" ${query.watched === 'true' ? raw('selected') : ''}>Watched</option></select></label>
        <button class="btn btn--cyan" type="submit">Show videos</button></form>` })}
      ${list.length ? h`<div class="cards cards--wide">${list.map((v) => h`<a class="win vcard" href="/videos/${v.id}" style="text-decoration:none;color:inherit"><img src="${v.thumbnailUrl}" alt="" loading="lazy"><div class="win__body"><strong>${v.title}</strong><div class="row small" style="margin-top:6px">${level(v.level)}<span class="chip">${CAT(v.category)}</span><span>${fmtDur(v.durationSeconds)}</span>${v.favorite ? h`<span class="chip chip--pink">★ favourite</span>` : ''}${v.watched ? h`<span class="chip chip--green">watched</span>` : ''}</div></div></a>`)}</div>`
        : win({ title: 'No videos yet', variant: 'coral', corner: 'coral', body: empty('The video shelf is empty', query.level || query.category || query.favorite || query.watched ? 'No videos match these filters.' : 'Videos appear here once an administrator approves them. Automatic discovery runs daily when a YouTube API key is configured.') })}
    </div>`,
    mount(root) { root.querySelector('[data-f]').addEventListener('submit', (e) => { e.preventDefault(); navigate(`/videos${qs(Object.fromEntries(new FormData(e.target)))}`); }); },
  };
}

export async function video({ params }) {
  const v = await api(`/videos/${params.id}`);
  const ctx = { source: 'video', ref: String(v.id), title: v.title };
  return {
    title: v.title, scene: 'dusk',
    html: h`<div class="split" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
      ${win({ title: v.title, variant: 'salmon', corner: 'hibiscus', body: h`<div class="video-frame"><iframe src="${v.embedUrl}" title="${v.title}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
        <div class="btn-row" style="margin-top:12px"><button class="btn ${v.favorite ? '' : 'btn--ghost'}" type="button" data-fav aria-pressed="${v.favorite}">${v.favorite ? '★ Favourite' : '☆ Add to favourites'}</button><button class="btn ${v.watched ? 'btn--green' : 'btn--ghost'}" type="button" data-watch aria-pressed="${v.watched}">${v.watched ? '✓ Watched' : 'Mark as watched'}</button><a class="btn btn--ghost" href="${v.watchUrl}" target="_blank" rel="noopener">Open on YouTube</a></div>` })}
      <div class="stack">
        ${win({ title: 'About this video', variant: 'green', body: h`<dl class="kv"><dt>Channel</dt><dd>${v.channel || '—'}</dd><dt>Level</dt><dd>${v.level || '—'}</dd><dt>Category</dt><dd>${CAT(v.category)}</dd><dt>Topic</dt><dd>${v.topic || '—'}</dd><dt>Duration</dt><dd>${fmtDur(v.durationSeconds)}</dd><dt>Tamil</dt><dd>${v.register}${v.accent ? ` · ${v.accent}` : ''}</dd><dt>Published</dt><dd>${fmtDate(v.publishedAt)}</dd><dt>Added</dt><dd>${fmtDate(v.createdAt)}</dd></dl>
          ${v.description ? h`<details style="margin-top:10px"><summary>Description</summary><p class="small" style="white-space:pre-line">${v.description}</p></details>` : ''}` })}
        ${win({ title: 'Transcript', corner: 'frangipani', body: v.transcript?.length ? h`<p class="small muted">Tap a word to look it up and save it. Source: ${v.transcriptSource}</p><div class="reader" data-reader>${v.transcript.map((l) => h`<p class="para"><span class="ta" lang="ta">${wordify(l.ta)}</span><span class="tr">${transliterate(l.ta)}</span>${l.en ? h`<span class="para-en show">${l.en}</span>` : ''}</p>`)}</div>`
          : h`<p class="muted">No authorised transcript is available for this video. Use the YouTube player's captions if the creator provides them.</p>` })}
      </div></div>`,
    mount(root) {
      const rd = root.querySelector('[data-reader]');
      if (rd) bindWords(rd, ctx);
      const set = async (body) => { try { const r = await api(`/videos/${v.id}/state`, { method: 'PUT', body }); Object.assign(v, r); const f = root.querySelector('[data-fav]'); f.textContent = r.favorite ? '★ Favourite' : '☆ Add to favourites'; f.classList.toggle('btn--ghost', !r.favorite); f.setAttribute('aria-pressed', r.favorite); const w = root.querySelector('[data-watch]'); w.textContent = r.watched ? '✓ Watched' : 'Mark as watched'; w.classList.toggle('btn--green', r.watched); w.classList.toggle('btn--ghost', !r.watched); w.setAttribute('aria-pressed', r.watched); toast('Saved.'); } catch (e) { toast(e.message, 'bad'); } };
      root.querySelector('[data-fav]').addEventListener('click', () => set({ favorite: !v.favorite }));
      root.querySelector('[data-watch]').addEventListener('click', () => set({ watched: !v.watched }));
    },
  };
}
