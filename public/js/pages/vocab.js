import { h, raw, api, qs, state, win, ta, level, empty, saveToCollection, debounce, toast, errorsBox } from '../core.js';
import { transliterate } from '/shared/tamil.js';

const posName = (p) => ({ postposition: 'postposition', idiom: 'idiom / proverb' }[p] || p);
const regLabel = (r) => ({ common: 'common (spoken & written)', spoken: 'spoken', formal: 'formal / written', literary: 'literary', colloquial: 'colloquial' }[r] || r);
const strip = (s) => String(s || '').replace(/\[\[(.+?)\]\]/g, '$1');
const mark = (s) => { const parts = String(s || '').split(/\[\[(.+?)\]\]/); return parts.map((p, i) => (i % 2 ? h`<mark style="background:var(--salmon-pale)">${p}</mark>` : p)); };

export function wordCard(w, { save = true } = {}) {
  return h`<div class="wcard"><a href="/vocabulary/word/${w.id}" style="text-decoration:none;color:inherit">${ta(w.tamil)}</a><span class="en">${w.english}</span>
    <span class="wcard__meta"><span class="row" style="gap:4px">${level(w.level)}<span class="small muted">${posName(w.partOfSpeech)}</span></span>${save ? h`<button class="btn btn--small btn--ghost" type="button" data-save="${w.id}" aria-label="Save ${w.english}">Save</button>` : ''}</span></div>`;
}
function bindSave(root) {
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-save]'); if (b) saveToCollection({ vocabularyIds: [Number(b.dataset.save)] }); });
}

export function entryDetail(w, { extra = '' } = {}) {
  return h`<div class="row" style="align-items:flex-start;justify-content:space-between">
      <div>${ta(w.tamil, { size: 'xl', tr: false })}<p style="margin:0"><em>${w.transliteration}</em>${w.pronunciation ? h` · say “${w.pronunciation}”` : ''}</p></div>
      <div class="row">${level(w.level)}<span class="chip">${posName(w.partOfSpeech)}</span><span class="chip chip--salmon">${regLabel(w.register)}</span>${w.topic ? h`<span class="chip chip--green">${w.topic}</span>` : ''}</div></div>
    <dl class="kv" style="margin-top:12px"><dt>English</dt><dd>${w.english}${w.altEnglish?.length ? h` <span class="muted">(${w.altEnglish.join(', ')})</span>` : ''}</dd>
      ${w.hindi ? h`<dt>Hindi</dt><dd lang="hi">${w.hindi}</dd>` : ''}${w.malayalam ? h`<dt>Malayalam</dt><dd lang="ml">${w.malayalam}</dd>` : ''}
      ${w.synonyms?.length ? h`<dt>Synonyms</dt><dd>${w.synonyms.map((s) => h`<a class="ta" lang="ta" href="/dictionary?q=${encodeURIComponent(s)}">${s}</a> `)}</dd>` : ''}
      ${w.antonyms?.length ? h`<dt>Antonyms</dt><dd>${w.antonyms.map((s) => h`<a class="ta" lang="ta" href="/dictionary?q=${encodeURIComponent(s)}">${s}</a> `)}</dd>` : ''}
      ${w.dialect ? h`<dt>Variants</dt><dd>${w.dialect}</dd>` : ''}</dl>
    ${w.collocations?.length ? h`<h3 style="margin-top:14px">Common collocations</h3><ul class="list">${w.collocations.map((c) => h`<li><span class="ta" lang="ta">${mark(c.ta)}</span><span class="tr">${transliterate(strip(c.ta))}</span><span class="en">${c.en}</span></li>`)}</ul>` : ''}
    ${w.examples?.length ? h`<h3 style="margin-top:14px">Examples</h3><ul class="list">${w.examples.map((c) => h`<li><span class="ta" lang="ta">${mark(c.ta)}</span><span class="tr">${transliterate(strip(c.ta))}</span><span class="en">${c.en}</span></li>`)}</ul>` : ''}
    ${w.partOfSpeech === 'verb' && Object.keys(w.forms || {}).length ? h`<h3 style="margin-top:14px">Common forms</h3><div class="table-wrap"><table class="tbl"><tr><th>Form</th><th>Tamil</th></tr>
      ${[['present1s', 'I … (present)'], ['past1s', 'I … (past)'], ['future1s', 'I will …'], ['inf', 'to … (infinitive)']].filter(([k]) => w.forms[k]).map(([k, l]) => h`<tr><td>${l}</td><td><span class="ta" lang="ta">${w.forms[k]}</span><span class="tr">${transliterate(w.forms[k])}</span></td></tr>`)}</table></div>` : ''}
    ${w.reviewStatus === 'native-reviewed' ? h`<p class="small muted" style="margin-top:10px">Reviewed by a native speaker.</p>` : h`<p class="small muted" style="margin-top:10px">Editorial entry awaiting native-speaker review.</p>`}
    ${extra}`;
}

export async function browse({ query, navigate }) {
  const page = Number(query.page) || 1;
  const [res, lists] = await Promise.all([api(`/vocabulary${qs({ level: query.level, topic: query.topic, pos: query.pos, register: query.register, q: query.q, page })}`), api(`/vocabulary/lists${qs({ level: query.level })}`)]);
  const m = state.meta;
  const sel = (label, name, opts, cur) => h`<label class="field"><span>${label}</span><select name="${name}"><option value="">All</option>${opts.map(([v, l]) => h`<option value="${v}" ${v === cur ? raw('selected') : ''}>${l}</option>`)}</select></label>`;
  const link = (p) => `/vocabulary${qs({ ...query, page: p })}`;
  return {
    title: 'Vocabulary', scene: 'fern',
    html: h`<div class="page-head"><div><h1>Vocabulary</h1><p>${res.total} published words, by level, topic and part of speech.</p></div></div>
    <div class="stack">
      ${win({ title: 'Find words', variant: 'salmon', body: h`<form class="filters" data-filters>
        ${sel('Level', 'level', m.levels.map((l) => [l.code, `${l.code} · ${l.name}`]), query.level)}
        ${sel('Topic', 'topic', m.topics.map((t) => [t.slug, t.name]), query.topic)}
        ${sel('Part of speech', 'pos', m.partsOfSpeech.map((p) => [p, posName(p)]), query.pos)}
        <label class="field"><span>Register</span><select name="register"><option value="">All</option>${m.registers.map((r) => h`<option value="${r}" ${r === query.register ? raw('selected') : ''}>${regLabel(r)}</option>`)}</select></label>
        <label class="field"><span>Search</span><input type="search" name="q" value="${query.q || ''}" placeholder="Tamil, English, transliteration"></label>
        <button class="btn btn--cyan" type="submit">Show words</button></form>` })}
      ${lists.length ? win({ title: 'Vocabulary lists', variant: 'green', corner: 'frangipani', body: h`<div class="cards cards--wide">${lists.map((l) => h`<a class="wcard" href="/vocabulary/lists/${l.id}" style="text-decoration:none;min-height:auto"><strong>${l.title}</strong><span class="small muted">${l.description}</span><span class="wcard__meta">${level(l.level)}<span class="small">${l.wordCount} words</span></span></a>`)}</div>` }) : ''}
      ${win({ title: `Words · page ${res.page} of ${res.pages}`, corner: 'hibiscus', body: res.items.length ? h`<div class="cards">${res.items.map((w) => wordCard(w))}</div>
        <div class="spread" style="margin-top:14px">${res.page > 1 ? h`<a class="btn btn--ghost btn--small" href="${link(res.page - 1)}">Previous page</a>` : h`<span></span>`}${res.page < res.pages ? h`<a class="btn btn--ghost btn--small" href="${link(res.page + 1)}">Next page</a>` : ''}</div>` : empty('No words match', 'Try fewer filters or another search.') })}
    </div>`,
    mount(root) {
      bindSave(root);
      root.querySelector('[data-filters]').addEventListener('submit', (e) => { e.preventDefault(); navigate(`/vocabulary${qs(Object.fromEntries(new FormData(e.target)))}`); });
    },
  };
}

export async function listDetail({ params }) {
  const l = await api(`/vocabulary/lists/${params.id}`);
  return {
    title: l.title, scene: 'fern',
    html: h`<div class="page-head"><div><h1>${l.title}</h1><p>${l.description}</p></div><button class="btn btn--bloom" type="button" data-all>Save all ${l.words.length} words</button></div>
      ${win({ title: `${l.words.length} words ${l.level ? `· ${l.level}` : ''}`, corner: 'frangipani', body: h`<div class="cards">${l.words.map((w) => wordCard(w))}</div>` })}`,
    mount(root) { bindSave(root); root.querySelector('[data-all]').addEventListener('click', () => saveToCollection({ vocabularyIds: l.words.map((w) => w.id), source: 'list', sourceRef: String(l.id) })); },
  };
}

export async function wordDetail({ params }) {
  const w = await api(`/vocabulary/${params.id}`);
  return {
    title: w.english, scene: 'fern',
    html: h`<div style="max-width:820px;margin:0 auto">${win({ title: w.english, variant: 'salmon', corner: 'hibiscus', cornerBr: true, body: entryDetail(w), foot: h`<a class="btn btn--ghost" href="/vocabulary">Back to vocabulary</a><button class="btn btn--bloom" type="button" data-save="${w.id}">Save to collection</button>` })}</div>`,
    mount: bindSave,
  };
}

const LANGS = [['auto', 'Detect'], ['en', 'English → Tamil'], ['hi', 'Hindi → Tamil'], ['ml', 'Malayalam → Tamil'], ['ta', 'Tamil']];
export async function dictionary({ query, navigate }) {
  const q = query.q || '';
  const lang = query.lang || 'auto';
  const res = q ? await api(`/dictionary/search${qs({ q, lang })}`) : null;
  return {
    title: 'Dictionary', scene: 'fern',
    html: h`<div class="page-head"><div><h1>Dictionary</h1><p>Search Tamil from English, Hindi or Malayalam. Romanised Tamil works too: try “thanneer”.</p></div></div>
    <div class="stack" style="max-width:900px;margin:0 auto">
      ${win({ title: 'Search', variant: 'salmon', corner: 'frangipani', body: h`<form data-dict class="filters" role="search" autocomplete="off">
        <label class="field" style="flex:3;position:relative"><span>Word or phrase</span><input type="search" name="q" value="${q}" placeholder="water, पानी, വെള്ളം, தண்ணீர் or thanneer" aria-autocomplete="list" aria-controls="sugg">
          <ul id="sugg" class="win" role="listbox" hidden style="position:absolute;top:100%;left:0;right:0;z-index:5;list-style:none;margin:2px 0 0;padding:4px"></ul></label>
        <label class="field"><span>Direction</span><select name="lang">${LANGS.map(([v, l]) => h`<option value="${v}" ${v === lang ? raw('selected') : ''}>${l}</option>`)}</select></label>
        <button class="btn btn--cyan" type="submit">Search</button></form>` })}
      ${res ? (res.results.length ? h`<p style="color:#fff;text-shadow:1px 1px 0 var(--line);font-weight:600;margin:0">${res.results.length} result(s) for “${res.query}” (${LANGS.find((l) => l[0] === res.lang)?.[1] || res.lang})</p>
        ${res.results.map((w, i) => win({ title: `${w.translation || w.english} · ${w.match.type}`, variant: i ? '' : 'green', corner: i ? undefined : 'lotus', body: entryDetail(w), foot: h`<a class="btn btn--ghost btn--small" href="/vocabulary/word/${w.id}">Open entry</a><button class="btn btn--small btn--bloom" data-save="${w.id}" type="button">Save to collection</button>` }))}`
        : win({ title: 'No verified entry found', variant: 'coral', corner: 'coral', body: h`<p>“${res.query}” is not in the Lotus Learn dictionary yet.</p>
          ${state.meta.features.ai ? h`<button class="btn" type="button" data-ai>Ask the AI for a suggestion</button><div data-ai-out></div>` : h`<p class="small muted">AI suggestions are not configured on this server. You can still add your own word to a collection.</p>`}
          <a class="btn btn--ghost" href="/collections">Add a word manually</a>` })) : win({ title: 'Tips', body: h`<ul class="list"><li>Partial words match: “frie” finds “friend”.</li><li>Small spelling mistakes are forgiven: “watr” still finds water.</li><li>Phrases search collocations: “drink water”.</li><li>Tamil verb forms are recognised: <span class="ta" lang="ta">குடித்தேன்</span>.</li></ul>` })}
    </div>`,
    mount(root) {
      bindSave(root);
      const f = root.querySelector('[data-dict]');
      const input = f.querySelector('input[name=q]');
      const box = f.querySelector('#sugg');
      f.addEventListener('submit', (e) => { e.preventDefault(); box.hidden = true; navigate(`/dictionary${qs(Object.fromEntries(new FormData(f)))}`); });
      input.addEventListener('input', debounce(async () => {
        const v = input.value.trim();
        if (v.length < 2) { box.hidden = true; return; }
        try {
          const s = await api(`/dictionary/suggest${qs({ q: v, lang: f.lang.value })}`);
          box.innerHTML = s.map((x) => String(h`<li role="option"><a href="/vocabulary/word/${x.id}" style="display:block;padding:4px 6px"><span class="ta" lang="ta">${x.tamil}</span> <span class="small muted">${x.transliteration} · ${x.label}</span></a></li>`)).join('');
          box.hidden = !s.length;
        } catch { box.hidden = true; }
      }, 220));
      input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 200));
      root.querySelector('[data-ai]')?.addEventListener('click', async (e) => {
        const out = root.querySelector('[data-ai-out]');
        e.target.disabled = true; out.textContent = 'Asking…';
        try {
          const r = await api('/dictionary/ai-suggest', { method: 'POST', body: { q, lang: res.lang === 'auto' ? 'en' : res.lang } });
          out.innerHTML = String(h`<div class="notice">${r.label}</div>${r.items.length ? h`<ul class="list">${r.items.map((x, i) => h`<li>${ta(x.tamil, { size: 'lg' })}<span class="en">${x.english} · ${x.register}</span><p class="small">${x.note}</p><button class="btn btn--small btn--ghost" data-ai-save="${i}" type="button">Save as my own word</button></li>`)}</ul>` : h`<p>No suggestion.</p>`}`);
          out.querySelectorAll('[data-ai-save]').forEach((b) => b.addEventListener('click', () => { const x = r.items[b.dataset.aiSave]; saveToCollection({ word: { tamil: x.tamil, english: x.english, notes: 'AI suggestion (unverified)' }, source: 'dictionary' }); }));
        } catch (err) { out.innerHTML = String(errorsBox(err)); e.target.disabled = false; }
      });
      void toast;
    },
  };
}
