import { h, api, qs, state, win, ta, level, empty, toast, saveToCollection, langName, go } from '../core.js';
const fmtDate=date=>new Intl.DateTimeFormat(undefined,{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'}).format(new Date(date+'T12:00:00Z'));
const constructions={adj_noun:'Adjective + noun',verb_object:'Verb + object',noun_verb:'Noun + verb',adv_verb:'Manner + action',common:'Common expression'};

function wordGrid(words) {
  return h`<div class="cards">${words.map((w) => h`<label class="wcard" style="cursor:pointer">
    <span class="row" style="justify-content:space-between"><input type="checkbox" class="check" data-pick="${w.id}" aria-label="Select ${w.english}"> ${level(w.level)}</span>
    ${ta(w.tamil, { lang: w.lang, tr: false })}${w.transliteration ? h`<span class="tr">${w.transliteration}</span>` : ''}<span class="en">${w.english}</span>
    ${w.example ? h`<span class="ta small" lang="${w.lang}">${w.example}</span><span class="small muted">${w.example_en || ''}</span>` : ''}
    <span class="wcard__meta"><span class="small muted">${constructions[w.construction] || w.partOfSpeech} · ${w.register}${w.aiAssisted ? ' · AI-assisted, not native-reviewed' : ''}</span><a class="small" href="/dictionary/entry/${w.id}">Entry</a></span></label>`)}</div>`;
}
function topicView(t, { all, base }) {
  if (!t || !t.words || (t.status && t.status !== 'published')) return win({ title: 'Daily Topic', body: empty('Today’s topic is being prepared', `${t?.title ? t.title + ' · ' + t.date + '. ' : ''}The four language lists are being prepared. This date will publish when all four are ready. Earlier topics remain in the archive.`) });
  return h`${t.preparing ? h`<p class="notice" role="status">${t.preparing.date}: ${t.preparing.title} is being prepared. Showing the latest completed lesson below.</p>` : ''}${win({ title: `${t.title} · ${fmtDate(t.date)}`, variant: 'salmon', corner: 'hibiscus', cornerBr: true, body: h`
    <p>${t.description}</p><p class="small muted">${t.levelAdaptation || ''}</p>
    <div class="row small"><span><strong>${t.wordCount}</strong> study entries in this topic</span></div>
    <div class="btn-row" style="margin:12px 0">
      <a class="btn btn--small ${all ? 'btn--ghost' : ''}" href="${base}">Order for my level (${state.profile.level})</a><a class="btn btn--small ${all ? '' : 'btn--ghost'}" href="${base}${base.includes('?') ? '&' : '?'}all=1">All levels</a>
      <span style="flex:1"></span>
      <button class="btn btn--small btn--ghost" type="button" data-selall>Select all shown</button>
      <button class="btn btn--small btn--cyan" type="button" data-save>Save selected</button>
      <button class="btn btn--small btn--bloom" type="button" data-study>Save & study</button></div>
    ${t.words.length ? wordGrid(t.words) : h`<p class="muted">No words at this level in today’s topic. <a href="${base}${base.includes('?') ? '&' : '?'}all=1">Show all levels</a>.</p>`}` })}`;
}
function bindTopic(root, t) {
  const picked = () => [...root.querySelectorAll('[data-pick]:checked')].map((x) => Number(x.dataset.pick));
  root.querySelector('[data-selall]')?.addEventListener('click', () => root.querySelectorAll('[data-pick]').forEach((x) => { x.checked = true; }));
  const save = (study) => {
    const ids = picked().length ? picked() : t.words.map((w) => w.id);
    if (!ids.length) return toast('No words to save.', 'bad');
    saveToCollection({ vocabularyIds: ids, title: `Save ${ids.length} word(s) from “${t.title}”`, source: 'list', sourceRef: `daily-topic:${t.id}`, onSaved: (cid) => { if (study) go(`/study?c=${cid}`); } });
  };
  root.querySelector('[data-save]')?.addEventListener('click', () => save(false));
  root.querySelector('[data-study]')?.addEventListener('click', () => save(true));
}

export async function today({ query }) {
  const t = await api(`/daily-topic/today${qs({ all: query.all })}`);
  return {
    title: 'Daily Topic', scene: 'fern',
    html: h`<div class="page-head"><div><h1>Daily Topic</h1><p>One shared daily microtopic, with natural ${langName()} words and expressions.</p></div><a class="btn btn--cyan" href="/daily-topic/archive">Topic archive</a></div>${topicView(t, { all: !!query.all, base: '/daily-topic' })}`,
    mount: (root) => t && bindTopic(root, t),
  };
}
export async function detail({ params, query }) {
  const t = await api(`/daily-topic/${params.id}${qs({ all: query.all })}`);
  return {
    title: t.title, scene: 'fern',
    html: h`<div class="page-head"><div><h1>${t.title}</h1><p>${t.isToday ? 'Today’s topic' : `From ${fmtDate(t.date)}`}</p></div><a class="btn btn--ghost" href="/daily-topic/archive">Back to archive</a></div>${topicView(t, { all: !!query.all, base: `/daily-topic/${t.id}` })}`,
    mount: (root) => bindTopic(root, t),
  };
}
export async function archive({ query, navigate }) {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month || '') ? query.month : '';
  const from = query.from || (month ? month + '-01' : undefined);
  const to = query.to || (month ? month + '-' + new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate() : undefined);
  const a = await api(`/daily-topic/archive${qs({ q: query.q, from, to, month, page: query.page })}`);
  const currentMonth = month || (a.today || new Date().toISOString().slice(0,10)).slice(0,7);
  const [year,mon] = currentMonth.split('-').map(Number);
  const days = new Date(Date.UTC(year,mon,0)).getUTCDate();
  const firstDay = new Date(Date.UTC(year,mon-1,1)).getUTCDay();
  const dated = new Map((a.calendar || a.items).map(x=>[x.date,x]));
  const calendar = h`<div class="daily-calendar" role="list" aria-label="Topic calendar">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=>h`<span class="small label">${x}</span>`)}${Array.from({length:firstDay},()=>h`<span></span>`)}${Array.from({length:days},(_,i)=>{const date=currentMonth+'-'+String(i+1).padStart(2,'0'),topic=dated.get(date);return topic?h`<a class="btn btn--small" role="listitem" href="/daily-topic/${topic.id}" title="${topic.title}">${i+1}</a>`:h`<span class="small muted" role="listitem" title="No published topic loaded for this date">${i+1}</span>`;})}</div>`;
  return {
    title: 'Topic archive', scene: 'fern',
    html: h`<div class="page-head"><div><h1>Topic archive</h1><p>Every ${langName()} Daily Topic stays here.</p></div><a class="btn" href="/daily-topic">Today’s topic</a></div>
    ${win({ title: `${a.total} topic(s)`, variant: 'green', corner: 'frangipani', body: h`
      <form class="filters" data-f><label class="field"><span>Calendar month</span><input type="month" name="month" value="${month}"></label><label class="field"><span>Topic name</span><input type="search" name="q" value="${query.q || ''}"></label>
        <label class="field"><span>From</span><input type="date" name="from" placeholder="YYYY-MM-DD" value="${query.from || ''}" pattern="\\d{4}-\\d{2}-\\d{2}"></label>
        <label class="field"><span>To</span><input type="date" name="to" placeholder="YYYY-MM-DD" value="${query.to || ''}" pattern="\\d{4}-\\d{2}-\\d{2}"></label>
        <button class="btn btn--cyan" type="submit">Filter</button></form>
      ${calendar}${a.pending?.length ? h`<p class="notice small">${a.pending.length} date(s) are waiting for complete language lists. Published history remains available.</p>` : ''}${a.items.length ? h`<ul class="list" style="margin-top:10px">${a.items.map((t) => h`<li class="spread"><a href="/daily-topic/${t.id}"><strong>${t.title}</strong></a><span class="small muted">${fmtDate(t.date)} · ${t.wordCount} words${t.isToday ? ' · today' : ''}</span></li>`)}</ul>` : h`<p class="muted">No topics match.</p>`}
      ${a.pages > 1 ? h`<div class="spread">${a.page > 1 ? h`<a class="btn btn--small btn--ghost" href="/daily-topic/archive${qs({ ...query, page: a.page - 1 })}">Newer</a>` : h`<span></span>`}${a.page < a.pages ? h`<a class="btn btn--small btn--ghost" href="/daily-topic/archive${qs({ ...query, page: a.page + 1 })}">Older</a>` : ''}</div>` : ''}` })}`,
    mount(root) { root.querySelector('[data-f]').addEventListener('submit', (e) => { e.preventDefault(); navigate(`/daily-topic/archive${qs(Object.fromEntries(new FormData(e.target)))}`); }); },
  };
}
