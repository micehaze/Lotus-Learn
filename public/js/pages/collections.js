import { h, raw, api, qs, state, win, ta, lotus, level, empty, toast, confirmDialog, modal, errorsBox, formData, go, langName } from '../core.js';
import { radar } from '../charts.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export async function index({ query, navigate }) {
  const d = await api(`/collections${qs({ q: query.q })}`);
  const sel = await api('/selection');
  return {
    title: 'Collections', scene: 'fern',
    html: h`<div class="page-head"><div><h1>My ${langName()} collections</h1><p>${plural(d.collections.length, 'collection')} · up to ${d.limit} words each · other languages keep their own collections</p></div>
      <div class="btn-row"><a class="btn btn--bloom" href="/collections/new">Create collection</a><a class="btn btn--cyan" href="/statistics/collections">Collection statistics</a><a class="btn btn--green" href="/study">Study${sel.count ? ` (${sel.count} selected)` : ''}</a></div></div>
    <div class="stack">
      ${win({ title: 'Search within collections', variant: 'salmon', body: h`<form class="filters" data-search><label class="field" style="flex:3"><span>Word or collection name</span><input type="search" name="q" value="${query.q || ''}" placeholder="வீடு, house, veedu…"></label><button class="btn btn--cyan" type="submit">Search</button>${query.q ? h`<a class="btn btn--ghost" href="/collections">Clear</a>` : ''}</form>
        ${query.q ? (d.matches.length ? h`<ul class="list" style="margin-top:10px">${d.matches.map((m) => h`<li class="spread"><span>${ta(m.tamil, { tr: false })} <span class="muted">${m.english}</span></span><a class="small" href="/collections/${m.collectionId}">${m.collectionTitle}</a></li>`)}</ul>` : h`<p class="muted" style="margin-top:10px">No words match “${query.q}”.</p>`) : ''}` })}
      ${d.collections.length ? h`<div class="cards cards--wide">${d.collections.map((c, i) => win({ title: c.title, variant: ['', 'salmon', 'green', 'coral', 'orange'][i % 5], corner: i === 0 ? 'hibiscus' : undefined, body: h`
          <p class="small muted" style="min-height:1.5em">${c.description}</p>
          <p class="ta" lang="${state.lang}" style="min-height:1.8em">${c.preview.join(' · ')}</p>
          <div class="row small"><span>${plural(c.wordCount, 'word')}</span><span class="row" style="gap:2px">${lotus(0, 'sm')}${c.lotus.none}</span><span class="row" style="gap:2px">${lotus(2, 'sm')}${c.lotus.growing}</span><span class="row" style="gap:2px">${lotus(5, 'sm')}${c.lotus.bloomed}</span></div>`,
          foot: h`<a class="btn btn--small btn--ghost" href="/collections/${c.id}/stats">Statistics</a><a class="btn btn--small" href="/collections/${c.id}">Open</a>` }))}</div>`
        : win({ title: 'Start your first collection', corner: 'lotus', body: empty('No collections yet', 'A collection is a personal list of words — for a topic, a story, or the words you keep forgetting.', h`<a class="btn btn--bloom" href="/collections/new">Create collection</a>`) })}
    </div>`,
    mount(root) { root.querySelector('[data-search]').addEventListener('submit', (e) => { e.preventDefault(); navigate(`/collections${qs(formData(e.target))}`); }); },
  };
}

function wordFields(w = {}) {
  const ex = w.examples?.[0] || {};
  const strip = (s) => String(s || '').replace(/\[\[(.+?)\]\]/g, '$1');
  return h`<div class="grid grid-2" style="gap:0 14px">
    <label class="field"><span>${langName()} word *</span><input class="ta-input" type="text" name="tamil" value="${w.tamil || ''}" required lang="${state.lang}"></label>
    <label class="field"><span>Transliteration</span><input type="text" name="transliteration" value="${w.transliteration || ''}" placeholder="filled in automatically"></label>
    <label class="field"><span>English translation *</span><input type="text" name="english" value="${w.english || ''}" required></label>
    <label class="field"><span>Hindi (optional)</span><input type="text" name="hindi" value="${w.hindi || ''}" lang="hi"></label>
    <label class="field"><span>Malayalam (optional)</span><input type="text" name="malayalam" value="${w.malayalam || ''}" lang="ml"></label>
    <label class="field"><span>Synonyms</span><input class="ta-input" type="text" name="synonyms" value="${(w.synonyms || []).join(', ')}" placeholder="comma separated"></label>
    <label class="field"><span>Example sentence (${langName()})</span><input class="ta-input" type="text" name="exampleTa" value="${strip(ex.ta)}" lang="${state.lang}"></label>
    <label class="field"><span>Example translation</span><input type="text" name="exampleEn" value="${ex.en || ''}"></label></div>
    <label class="field"><span>Collocations</span><textarea class="ta-input" name="collocations" placeholder="one per line: தண்ணீர் குடி — drink water">${(w.collocations || []).map((c) => `${strip(c.ta)}${c.en ? ` — ${c.en}` : ''}`).join('\n')}</textarea><small>Used for collocation exercises when the word appears in the phrase.</small></label>`;
}
const fieldsToWord = (d) => ({ tamil: d.tamil, transliteration: d.transliteration, english: d.english, hindi: d.hindi, malayalam: d.malayalam, synonyms: d.synonyms, collocations: d.collocations, examples: d.exampleTa ? [{ ta: d.exampleTa, en: d.exampleEn }] : [] });

export function create({ navigate }) {
  return {
    title: 'New collection', scene: 'fern',
    html: h`<div style="max-width:860px;margin:0 auto">${win({ title: 'Create collection', variant: 'salmon', corner: 'hibiscus', cornerBr: true, body: h`<form data-create>
      <label class="field"><span>Collection name *</span><input type="text" name="title" maxlength="80" required placeholder="Romantic vocabulary"></label>
      <label class="field"><span>Description (optional)</span><input type="text" name="description" maxlength="500"></label>
      <div data-words></div>
      <div class="btn-row"><button class="btn btn--cyan" type="button" data-add>Add word</button></div>
      <div data-err></div>
      <div class="btn-row" style="margin-top:16px"><button class="btn btn--bloom btn--big" type="submit">Save</button><a class="btn btn--ghost" href="/collections">Cancel</a></div></form>` })}</div>`,
    mount(root) {
      const box = root.querySelector('[data-words]');
      const add = () => { const d = document.createElement('fieldset'); d.className = 'win'; d.style.cssText = 'margin:0 0 14px;padding:12px'; d.innerHTML = String(h`<legend class="label">Word ${box.children.length + 1}</legend>${wordFields()}<button class="btn btn--small btn--danger" type="button" data-rm>Remove word</button>`); box.append(d); d.querySelector('[data-rm]').addEventListener('click', () => d.remove()); d.querySelector('input').focus(); };
      root.querySelector('[data-add]').addEventListener('click', add);
      root.querySelector('[data-create]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const words = [...box.querySelectorAll('fieldset')].map((fs) => fieldsToWord(Object.fromEntries([...fs.querySelectorAll('[name]')].map((i) => [i.name, i.value])))).filter((w) => w.tamil || w.english);
        try {
          const r = await api('/collections', { method: 'POST', body: { title: f.title.value, description: f.description.value, words } });
          toast('Collection saved.'); navigate(`/collections/${r.id}`, { replace: true });
        } catch (err) { root.querySelector('[data-err]').innerHTML = String(errorsBox(err)); }
      });
    },
  };
}

function wordModal(collectionId, word, done) {
  modal({
    title: word ? 'Edit word' : 'Add word', variant: 'salmon',
    body: h`<form>${wordFields(word || {})}<div data-err></div><div class="btn-row"><button class="btn btn--bloom" type="submit">${word ? 'Save changes' : 'Add word'}</button><button class="btn btn--ghost" type="button" data-close>Cancel</button></div></form>`,
    onMount(el, close) {
      el.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = fieldsToWord(formData(e.target));
        try {
          if (word) await api(`/collections/${collectionId}/words/${word.id}`, { method: 'PATCH', body });
          else await api(`/collections/${collectionId}/words`, { method: 'POST', body });
          close(); toast(word ? 'Word updated.' : 'Word added.'); done();
        } catch (err) { el.querySelector('[data-err]').innerHTML = String(errorsBox(err)); }
      });
    },
  });
}

export function card(w, { selectable = false, editable = false } = {}) {
  const body = h`${ta(w.tamil)}<span class="en">${w.english}</span><span class="wcard__meta"><span class="small muted">${w.topic || w.collectionTitle || ''}</span>${lotus(w.mastery.lotus)}</span>`;
  if (selectable) return h`<button type="button" class="wcard ${w.selected ? 'wcard--selected' : ''}" data-toggle="${w.id}" aria-pressed="${w.selected ? 'true' : 'false'}">${body}</button>`;
  return h`<div class="wcard" data-word="${w.id}">${editable ? h`<button class="wcard__x" type="button" data-del="${w.id}" aria-label="Delete ${w.english}">×</button><button class="wcard__x wcard__edit" type="button" data-edit="${w.id}" aria-label="Edit ${w.english}">✎</button>` : ''}${body}</div>`;
}

export async function detail({ params, query, navigate }) {
  const c = await api(`/collections/${params.id}${qs({ q: query.q })}`);
  const reload = () => navigate(location.pathname + location.search, { replace: true });
  return {
    title: c.title, scene: 'fern', keepScroll: true,
    html: h`<div class="page-head"><div><h1>${c.title}</h1><p>${c.description || ''} ${c.words.length}/${c.limit} words</p></div>
      <div class="btn-row"><button class="btn btn--bloom" type="button" data-addword>Add word</button><button class="btn btn--green" type="button" data-study ${c.words.length ? '' : raw('disabled')}>Study this collection</button><a class="btn btn--cyan" href="/collections/${c.id}/stats">Collection statistics</a></div></div>
    <div class="stack">
      ${win({ title: 'Collection', variant: 'salmon', body: h`<div class="spread"><form class="filters" data-search style="flex:1"><label class="field" style="flex:3"><span>Search in this collection</span><input type="search" name="q" value="${query.q || ''}"></label><button class="btn btn--cyan" type="submit">Search</button></form>
        <div class="btn-row"><button class="btn btn--ghost btn--small" type="button" data-rename>Rename / edit</button><button class="btn btn--danger btn--small" type="button" data-delcol>Delete collection</button></div></div>
        <p class="small muted" style="margin:8px 0 0">Add words from the <a href="/vocabulary">vocabulary library</a>, the <a href="/dictionary">dictionary</a>, <a href="/reading">stories</a> or by hand.</p>` })}
      ${win({ title: `${c.words.length} word${c.words.length === 1 ? '' : 's'}`, corner: 'hibiscus', body: c.words.length ? h`<div class="cards">${c.words.map((w) => card(w, { editable: true }))}</div>` : empty(query.q ? 'No matching words' : 'This collection is empty', query.q ? 'Try another search.' : 'Add your first word to start learning.') })}
    </div>`,
    mount(root) {
      root.querySelector('[data-search]').addEventListener('submit', (e) => { e.preventDefault(); navigate(`/collections/${c.id}${qs(formData(e.target))}`); });
      root.querySelector('[data-addword]').addEventListener('click', () => wordModal(c.id, null, reload));
      root.querySelector('[data-study]').addEventListener('click', async () => {
        try { const r = await api('/selection', { method: 'POST', body: { collectionId: c.id } }); toast(`${r.added} word(s) selected${r.duplicates ? `, ${r.duplicates} already selected` : ''}.`); navigate('/study'); }
        catch (e) { toast(e.message, 'bad'); }
      });
      root.addEventListener('click', async (e) => {
        const del = e.target.closest('[data-del]');
        const ed = e.target.closest('[data-edit]');
        if (del) {
          const w = c.words.find((x) => x.id === Number(del.dataset.del));
          if (await confirmDialog({ title: 'Delete word', text: `Delete “${w.tamil}” (${w.english}) from ${c.title}? Its lotus progress stays with you if the word is in another collection.` })) {
            try { await api(`/collections/${c.id}/words/${w.id}`, { method: 'DELETE' }); toast('Word deleted.'); reload(); } catch (err) { toast(err.message, 'bad'); }
          }
        }
        if (ed) wordModal(c.id, c.words.find((x) => x.id === Number(ed.dataset.edit)), reload);
      });
      root.querySelector('[data-rename]').addEventListener('click', () => modal({
        title: 'Edit collection', body: h`<form><label class="field"><span>Name</span><input type="text" name="title" value="${c.title}" maxlength="80" required></label><label class="field"><span>Description</span><input type="text" name="description" value="${c.description}"></label><div data-err></div><button class="btn" type="submit">Save changes</button></form>`,
        onMount(el, close) { el.querySelector('form').addEventListener('submit', async (e) => { e.preventDefault(); try { await api(`/collections/${c.id}`, { method: 'PATCH', body: formData(e.target) }); close(); toast('Collection saved.'); reload(); } catch (err) { el.querySelector('[data-err]').innerHTML = String(errorsBox(err)); } }); },
      }));
      root.querySelector('[data-delcol]').addEventListener('click', async () => {
        if (await confirmDialog({ title: 'Delete collection', text: `Delete “${c.title}” and its ${c.words.length} word cards? This cannot be undone.`, confirmLabel: 'Delete collection' })) {
          await api(`/collections/${c.id}`, { method: 'DELETE' }); toast('Collection deleted.'); navigate('/collections', { replace: true });
        }
      });
    },
  };
}

const PAGE = 12;
export async function stats({ params, query }) {
  const s = await api(`/collections/${params.id}/stats`);
  const filter = query.filter || 'all';
  const words = s.words.filter((w) => filter === 'all' || (filter === 'none' && w.lotus === 0) || (filter === 'growing' && w.lotus >= 1 && w.lotus <= 4) || (filter === 'bloomed' && w.lotus === 5));
  const pages = Math.max(1, Math.ceil(words.length / PAGE));
  const page = Math.min(pages, Math.max(1, Number(query.page) || 1));
  const slice = words.slice((page - 1) * PAGE, page * PAGE);
  const link = (o) => `/collections/${params.id}/stats${qs({ filter, page, ...o })}`;
  const sum = s.summary;
  return {
    title: `${s.collection.title} statistics`, scene: 'valley',
    html: h`<div class="page-head"><div><h1>${s.collection.title}</h1><p>Collection statistics</p></div><a class="btn btn--ghost" href="/collections/${params.id}">Back to collection</a></div>
    <div class="grid grid-2" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">
      ${win({ title: 'Mastery radar', variant: 'salmon', corner: 'lotus', body: h`
        <div class="row" role="group" aria-label="Filter words">${[['all', 'All'], ['none', 'No lotus'], ['growing', '1–4 lotuses'], ['bloomed', 'Full bloom']].map(([k, l]) => h`<a class="btn btn--small ${k === filter ? '' : 'btn--ghost'}" href="${link({ filter: k, page: 1 })}" ${k === filter ? raw('aria-current="true"') : ''}>${l}</a>`)}</div>
        <p class="small muted">Each axis is one word (0 = new, 20 per lotus, 100 = full bloom). Showing ${slice.length} of ${words.length}.</p>
        ${radar(slice.map((w) => ({ label: w.tamil, value: w.score, tamil: true })), { label: 'Word mastery radar' })}
        ${pages > 1 ? h`<div class="spread">${page > 1 ? h`<a class="btn btn--small btn--ghost" href="${link({ page: page - 1 })}">Previous words</a>` : h`<span></span>`}<span class="small">Page ${page} of ${pages}</span>${page < pages ? h`<a class="btn btn--small btn--ghost" href="${link({ page: page + 1 })}">Next words</a>` : h`<span></span>`}</div>` : ''}` })}
      <div class="stack">
        ${win({ title: 'Summary', variant: 'green', body: h`<div class="statgrid"><div class="stat"><b>${sum.totalWords}</b><span>total words</span></div><div class="stat"><b>${sum.withoutLotus}</b><span>without lotus</span></div><div class="stat"><b>${sum.growing}</b><span>with 1–4 lotuses</span></div><div class="stat"><b>${sum.bloomed}</b><span>fully bloomed</span></div><div class="stat"><b>${sum.averageMastery}</b><span>average mastery</span></div></div>` })}
        ${win({ title: 'Words', body: h`<div class="table-wrap" style="max-height:420px"><table class="tbl"><tr><th>Word</th><th>Lotus</th><th>Score</th><th>✓/✗</th></tr>${s.words.map((w) => h`<tr><td><span class="ta" lang="${state.lang}">${w.tamil}</span><br><span class="small muted">${w.english}</span></td><td>${lotus(w.lotus, 'sm')}</td><td>${w.score}</td><td class="small">${w.totalCorrect}/${w.totalIncorrect}</td></tr>`)}</table></div>` })}
      </div></div>`,
  };
}

export async function globalStats({ query }) {
  const g = await api('/stats/collections');
  const chosen = query.ids ? query.ids.split(',').map(Number) : g.collections.filter((c) => c.wordCount).slice(0, 12).map((c) => c.id);
  const items = g.collections.filter((c) => chosen.includes(c.id));
  const s = g.summary;
  return {
    title: 'Collection statistics', scene: 'valley',
    html: h`<div class="page-head"><div><h1>Collection statistics</h1><p>Average mastery of each collection, compared.</p></div><a class="btn btn--ghost" href="/collections">Back to collections</a></div>
    <div class="grid grid-2" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">
      ${win({ title: 'Collections radar', variant: 'salmon', corner: 'lotus', body: radar(items.map((c) => ({ label: c.title, value: c.score })), { label: 'Collection mastery radar' }) })}
      <div class="stack">
        ${win({ title: 'Summary', variant: 'green', body: h`<div class="statgrid"><div class="stat"><b>${s.collections}</b><span>collections</span></div><div class="stat"><b>${s.vocabularySize}</b><span>unique words</span></div><div class="stat"><b>${s.bloomed}</b><span>fully mastered</span></div><div class="stat"><b>${s.averageMastery}</b><span>average mastery</span></div></div>
          <dl class="kv" style="margin-top:12px"><dt>Strongest</dt><dd>${s.strongest ? `${s.strongest.title} (${s.strongest.score})` : '—'}</dd><dt>Needs practice</dt><dd>${s.needsPractice ? h`<a href="/collections/${s.needsPractice.id}">${s.needsPractice.title}</a> (${s.needsPractice.score})` : '—'}</dd></dl>` })}
        ${win({ title: 'Choose collections', body: h`<form data-pick><div class="stack" style="gap:6px">${g.collections.map((c) => h`<label class="check"><input type="checkbox" name="ids" value="${c.id}" ${chosen.includes(c.id) ? raw('checked') : ''}> ${c.title} <span class="small muted">${c.wordCount} words · ${c.score}</span></label>`)}</div><button class="btn btn--cyan btn--small" type="submit" style="margin-top:10px">Update chart</button></form>` })}
      </div></div>`,
    mount(root) { root.querySelector('[data-pick]').addEventListener('submit', (e) => { e.preventDefault(); go(`/statistics/collections?ids=${new FormData(e.target).getAll('ids').join(',')}`); }); },
  };
}

// ------------------------------------------------------------------ study selection (PRD §9)
export async function study({ query, navigate }) {
  const [list, sel, active] = await Promise.all([api('/collections'), api('/selection'), api('/sessions/active')]);
  const openId = Number(query.c) || list.collections[0]?.id;
  const open = openId ? await api(`/collections/${openId}`) : null;
  return {
    title: 'Study', scene: 'cascade', keepScroll: true,
    html: h`<div class="page-head"><div><h1>Choose ${langName()} words to study</h1><p>Pick 1–${sel.max} words from any ${langName()} collections. Each word needs 10 correct answers.</p></div></div>
    ${active.session ? h`<div class="notice">You have a lesson in progress (${active.session.correct}/${active.session.required} correct). <a class="btn btn--small" href="/learn/${active.session.id}">Resume lesson</a></div>` : ''}
    <div class="split">
      <div class="stack">
        ${win({ title: 'Collections', variant: 'green', body: list.collections.length ? h`<ul class="list">${list.collections.map((c) => h`<li><a href="/study?c=${c.id}" ${c.id === openId ? raw('aria-current="true" style="font-weight:700"') : ''}>${c.title}</a> <span class="small muted">${c.wordCount}</span></li>`)}</ul>` : empty('No collections', 'Create one first.', h`<a class="btn" href="/collections/new">Create collection</a>`) })}
        ${win({ title: `Selected: ${sel.count} / ${sel.max}`, variant: 'salmon', corner: 'lotus', id: 'preview', body: sel.count ? h`
          <dl class="kv"><dt>Selected words</dt><dd>${sel.count}</dd><dt>Expected questions</dt><dd>${sel.expectedQuestions}</dd></dl>
          <ul class="list" style="max-height:300px;overflow:auto;margin-top:8px">${sel.items.map((w) => h`<li class="spread"><span><span class="ta" lang="${state.lang}">${w.tamil}</span> <span class="small muted">${w.collectionTitle}</span></span><button class="btn btn--small btn--ghost" type="button" data-unsel="${w.id}" aria-label="Remove ${w.english}">×</button></li>`)}</ul>`
          : h`<p class="muted">Tap word cards to select them. Your selection is kept while you move between collections.</p>`,
          foot: h`<button class="btn btn--ghost btn--small" type="button" data-clear ${sel.count ? '' : raw('disabled')}>Clear selection</button><button class="btn btn--bloom" type="button" data-start ${sel.count && !active.session ? '' : raw('disabled')}>Start learning</button>` })}
      </div>
      ${open ? win({ title: open.title, corner: 'hibiscus', body: h`<div class="spread" style="margin-bottom:12px"><span class="small muted">Tap a card to select or deselect it.</span><button class="btn btn--cyan btn--small" type="button" data-all>Select words</button></div>
          ${open.words.length ? h`<div class="cards">${open.words.map((w) => card(w, { selectable: true }))}</div>` : empty('Empty collection', 'Add words to this collection first.', h`<a class="btn" href="/collections/${open.id}">Open collection</a>`)}` }) : ''}
    </div>`,
    mount(root) {
      const reload = () => navigate(location.pathname + location.search, { replace: true });
      const handle = async (p) => { try { const r = await p; if (r?.duplicates) toast(`${r.duplicates} word(s) were already selected from another collection.`); reload(); } catch (e) { toast(e.message, 'bad'); } };
      root.addEventListener('click', (e) => {
        const t = e.target.closest('[data-toggle]');
        if (t) handle(t.classList.contains('wcard--selected') ? api('/selection/remove', { method: 'POST', body: { ids: [Number(t.dataset.toggle)] } }) : api('/selection', { method: 'POST', body: { ids: [Number(t.dataset.toggle)] } }));
        const u = e.target.closest('[data-unsel]');
        if (u) handle(api('/selection/remove', { method: 'POST', body: { ids: [Number(u.dataset.unsel)] } }));
      });
      root.querySelector('[data-all]')?.addEventListener('click', () => handle(api('/selection', { method: 'POST', body: { collectionId: openId } })));
      root.querySelector('[data-clear]')?.addEventListener('click', () => handle(api('/selection/clear', { method: 'POST' })));
      root.querySelector('[data-start]')?.addEventListener('click', async (e) => {
        e.target.disabled = true;
        try { const r = await api('/sessions', { method: 'POST' }); navigate(`/learn/${r.id}`); }
        catch (err) { toast(err.message, 'bad'); e.target.disabled = false; }
      });
    },
  };
}
