import { h, raw, api, qs, state, win, ta, level, empty, toast, langName, transliterate } from '../core.js';

export async function index({ query, navigate }) {
  const [cats, list] = await Promise.all([api('/grammar/categories'), api(`/grammar${qs({ category: query.category, level: query.level, q: query.q, bookmarked: query.bookmarked, studied: query.studied })}`)]);
  const link = (o) => `/grammar${qs({ ...query, ...o })}`;
  return {
    title: 'Grammar', scene: 'fern',
    html: h`<div class="page-head"><div><h1>${langName()} grammar</h1><p>${list.total} lessons · ${list.studied} studied</p></div></div>
    <div class="split">
      ${win({ title: 'Categories', variant: 'green', corner: 'frangipani', body: h`<nav class="tree" aria-label="Grammar categories"><a href="${link({ category: '' })}" ${!query.category ? raw('aria-current="true"') : ''}>All lessons</a>
        <ul>${cats.map((c) => h`<li><a href="${link({ category: c.slug })}" ${query.category === c.slug ? raw('aria-current="true"') : ''}>${c.name}</a> <span class="small muted">${c.total || ''}</span>
          ${c.children.length ? h`<ul>${c.children.map((k) => h`<li><a href="${link({ category: k.slug })}" ${query.category === k.slug ? raw('aria-current="true"') : ''}>${k.name}</a> <span class="small muted">${k.lessons || ''}</span></li>`)}</ul>` : ''}</li>`)}</ul></nav>` })}
      <div class="stack">
        ${win({ title: 'Find a lesson', variant: 'salmon', body: h`<form class="filters" data-f>
          <label class="field"><span>Search rules</span><input type="search" name="q" value="${query.q || ''}"></label>
          <label class="field"><span>Difficulty</span><select name="level"><option value="">All</option>${state.meta.levels.map((l) => h`<option ${l.code === query.level ? raw('selected') : ''}>${l.code}</option>`)}</select></label>
          <label class="field"><span>Show</span><select name="studied"><option value="">All</option><option value="false" ${query.studied === 'false' ? raw('selected') : ''}>Not studied yet</option><option value="true" ${query.studied === 'true' ? raw('selected') : ''}>Studied</option></select></label>
          <label class="check"><input type="checkbox" name="bookmarked" value="true" ${query.bookmarked ? raw('checked') : ''}> Bookmarked</label>
          <input type="hidden" name="category" value="${query.category || ''}"><button class="btn btn--cyan" type="submit">Show</button></form>` })}
        ${list.items.length ? h`<div class="cards cards--wide">${list.items.map((l) => h`<a class="wcard" href="/grammar/${l.id}" style="text-decoration:none;min-height:auto">
            <strong>${l.title}</strong><span class="small muted">${l.parentCategory ? `${l.parentCategory} › ` : ''}${l.category}</span>
            <span class="wcard__meta"><span class="row" style="gap:4px">${level(l.level)}${l.progress?.bookmarked ? h`<span class="chip chip--pink">★</span>` : ''}${l.progress?.studiedAt ? h`<span class="chip chip--green">studied</span>` : ''}</span><span class="small">${l.examples.length} examples</span></span></a>`)}</div>`
          : win({ title: 'No lessons', body: empty('Nothing here yet', 'Try another category or filter. New lessons are added as they are checked.') })}
      </div></div>`,
    mount(root) { root.querySelector('[data-f]').addEventListener('submit', (e) => { e.preventDefault(); navigate(`/grammar${qs(Object.fromEntries(new FormData(e.target)))}`); }); },
  };
}

const exRow = (e) => h`<li>${ta(e.native)}<span class="en">${e.en}</span>${e.note ? h`<span class="small muted">${e.note}</span>` : ''}</li>`;
export async function lesson({ params }) {
  const l = await api(`/grammar/${params.id}`);
  const para = (t) => String(t || '').split(/\n+/).filter(Boolean).map((p) => h`<p>${p}</p>`);
  return {
    title: l.title, scene: 'fern',
    html: h`<div style="max-width:880px;margin:0 auto" class="stack">
      ${win({ title: l.title, variant: 'salmon', corner: 'hibiscus', cornerBr: true, body: h`
        <div class="row small" style="margin-bottom:8px">${level(l.level)}<span class="chip">${l.parentCategory ? `${l.parentCategory} › ` : ''}${l.category}</span>${l.reviewStatus === 'native-reviewed' ? h`<span class="chip chip--green">native-reviewed</span>` : h`<span class="chip chip--warn">awaiting native review</span>`}</div>
        <section class="lesson-sec"><h3>Rule</h3>${para(l.rule)}</section>
        ${l.nuances ? h`<section class="lesson-sec"><h3>Nuances</h3>${para(l.nuances)}</section>` : ''}
        ${l.variations.length ? h`<section class="lesson-sec"><h3>Variations</h3>${l.variations.map((v) => h`<div class="note-card"><strong>${v.name}</strong>${v.description ? h`<p class="small muted" style="margin:2px 0 6px">${v.description}</p>` : ''}<ul class="list">${v.examples.map(exRow)}</ul></div>`)}</section>` : ''}
        <section class="lesson-sec"><h3>Examples</h3><ul class="list">${l.examples.map(exRow)}</ul></section>
        ${l.comparison?.length ? h`<section class="lesson-sec"><h3>Comparison</h3><div class="table-wrap"><table class="tbl">${l.comparison.map((row) => h`<tr>${row.map((c, i) => h`<td>${i === 0 ? h`<span class="ta" lang="${l.lang}">${c}</span><span class="tr">${transliterate(c)}</span>` : c}</td>`)}</tr>`)}</table></div></section>` : ''}`,
        foot: h`<button class="btn btn--ghost" type="button" data-bm aria-pressed="${l.progress?.bookmarked ? 'true' : 'false'}">${l.progress?.bookmarked ? '★ Bookmarked' : '☆ Bookmark'}</button><button class="btn ${l.progress?.studiedAt ? 'btn--green' : 'btn--bloom'}" type="button" data-st>${l.progress?.studiedAt ? '✓ Studied' : 'Mark as studied'}</button>` })}
      ${l.related.length ? win({ title: 'More in this category', variant: 'green', body: h`<ul class="list">${l.related.map((r) => h`<li><a href="/grammar/${r.id}">${r.title}</a> ${level(r.level)}</li>`)}</ul>` }) : ''}
      <a class="btn btn--ghost" href="/grammar">Back to grammar</a></div>`,
    mount(root) {
      const p = { bookmarked: !!l.progress?.bookmarked, studied: !!l.progress?.studiedAt };
      const bm = root.querySelector('[data-bm]'); const st = root.querySelector('[data-st]');
      bm.addEventListener('click', async () => { p.bookmarked = !p.bookmarked; await api(`/grammar/${l.id}/progress`, { method: 'PUT', body: { bookmarked: p.bookmarked } }); bm.textContent = p.bookmarked ? '★ Bookmarked' : '☆ Bookmark'; bm.setAttribute('aria-pressed', p.bookmarked); toast(p.bookmarked ? 'Bookmarked.' : 'Bookmark removed.'); });
      st.addEventListener('click', async () => { p.studied = !p.studied; await api(`/grammar/${l.id}/progress`, { method: 'PUT', body: { studied: p.studied } }); st.textContent = p.studied ? '✓ Studied' : 'Mark as studied'; st.classList.toggle('btn--green', p.studied); st.classList.toggle('btn--bloom', !p.studied); toast(p.studied ? 'Marked as studied.' : 'Marked as not studied.'); });
    },
  };
}
