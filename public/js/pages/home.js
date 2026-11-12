import { h, raw, api, state, win, ta, lotus, level, fmtDate, empty, esc, saveToCollection, langName } from '../core.js';
import { dailyBars } from '../charts.js';

export async function home() {
  const d = await api('/home');
  const p = d.profile;
  const o = d.overview;
  const goal = Math.min(100, Math.round((o.totals.todayCorrect / Math.max(1, p.dailyGoal)) * 100));
  const topicName = (slug) => state.meta.topics.find((t) => t.slug === slug)?.name || slug;
  const initial = p.displayName.trim().charAt(0).toUpperCase();
  return {
    title: 'Home', scene: 'lagoon',
    html: h`<div class="split">
      <div class="stack">
        ${win({ title: p.displayName, variant: 'salmon', corner: 'hibiscus', body: h`
          <div class="row" style="align-items:flex-start;flex-wrap:nowrap">
            <a href="/profile" class="avatar avatar--lg" style="${p.avatar ? raw(`background-image:url('${esc(p.avatar)}')`) : ''}" aria-label="Edit profile picture">${p.avatar ? '' : initial}</a>
            <div><p style="margin:0">${langName()} ${level(p.level)} ${state.meta.levels.find((l) => l.code === p.level)?.name}</p>
              <p class="small muted" style="margin:6px 0 0">${p.bio || `Learning ${langName()} one lotus at a time.`}</p>
              <p class="small" style="margin:6px 0 0"><strong>${o.streak.current}</strong>-day streak · best ${o.streak.longest}</p></div>
          </div>
          <p class="small" style="margin:12px 0 0"><a href="/profile">Edit profile</a> · <a href="/collections">My collections</a> · <a href="/statistics">My statistics</a></p>` })}
        ${win({ title: 'Quick actions', variant: 'green', body: h`<div class="stack" style="gap:10px">
          ${d.activeSession ? h`<a class="btn btn--bloom" href="/learn/${d.activeSession.id}">Resume lesson (${d.activeSession.correct}/${d.activeSession.required})</a>` : h`<a class="btn btn--bloom" href="/study">Study words</a>`}
          <a class="btn btn--cyan" href="/collections/new">Create a collection</a>
          <a class="btn btn--ghost" href="/dictionary">Look up a word</a>
          <a class="btn btn--ghost" href="/reading">Read a story</a></div>` })}
        ${win({ title: 'My interests', body: h`<dl class="kv"><dt>Level</dt><dd>${p.level}</dd><dt>Topics</dt><dd>${p.preferredTopics.length ? p.preferredTopics.map(topicName).join(', ') : h`<a href="/settings">Choose topics</a>`}</dd><dt>Daily goal</dt><dd>${p.dailyGoal} correct answers</dd><dt>Member since</dt><dd>${fmtDate(p.memberSince)}</dd></dl>` })}
        ${d.recentRewards.length ? win({ title: 'Recent lotus rewards', variant: 'coral', corner: 'lotus', body: h`<ul class="list">${d.recentRewards.map((r) => h`<li class="spread"><span>${ta(r.tamil || '', { tr: false })} <span class="small muted">${r.english}</span></span>${lotus(r.lotus, 'sm')}</li>`)}</ul>` }) : ''}
      </div>
      <div class="stack">
        ${win({ title: "Today's practice", variant: 'orange', body: h`
          <div class="spread"><span><strong>${o.totals.todayCorrect}</strong> of ${p.dailyGoal} correct answers today</span><span class="small muted">${o.totals.lotuses} lotuses · ${o.totals.bloomed} in full bloom</span></div>
          <div class="meter meter--salmon" style="--v:${goal}%;margin-top:8px" role="progressbar" aria-valuenow="${goal}" aria-valuemin="0" aria-valuemax="100" aria-label="Daily goal progress"><span></span></div>` })}
        ${win({ title: d.dailyTopic?.title ? `Daily Topic · ${d.dailyTopic.preparing?.title || d.dailyTopic.title}` : 'Daily Topic', corner: 'frangipani', body: d.dailyTopic?.words.length ? h`
          <p class="small muted">${d.dailyTopic.preparing ? 'Today’s lesson is being prepared. Here is the most recent completed lesson. ' : ''}${d.dailyTopic.wordCount} ${langName()} study entries. Showing the closest to your level (${p.level}) first.</p>
          <div class="cards">${d.dailyTopic.words.map((w) => h`<a class="wcard" href="/dictionary/entry/${w.id}" style="text-decoration:none">${ta(w.tamil, { lang: w.lang })}<span class="en">${w.english}</span><span class="wcard__meta">${level(w.level)}<span class="small muted">${w.register}</span></span></a>`)}</div>
          <div class="btn-row" style="margin-top:12px"><a class="btn btn--small btn--bloom" href="/daily-topic">Open Daily Topic</a><button class="btn btn--small" type="button" data-save-daily>Save these to a collection</button><a class="btn btn--ghost btn--small" href="/daily-topic/archive">Topic archive</a></div>` : h`${empty('Today’s topic is being prepared', 'It will appear when all four language lists are ready.')}<a class="btn btn--ghost btn--small" href="/daily-topic/archive">Topic archive</a>` })}
        <div class="grid grid-2">
          ${win({ title: 'Grammar', variant: 'coral', body: d.grammar.length ? h`<ul class="list">${d.grammar.map((g) => h`<li><a href="/grammar/${g.id}">${g.title}</a> ${level(g.level)}</li>`)}</ul><a class="btn btn--small btn--ghost" href="/grammar">All grammar lessons</a>` : h`<p class="muted">No lessons yet.</p>` })}
          ${win({ title: 'Learning Notes', variant: 'green', body: h`<p>${d.notesToday ? `You wrote ${d.notesToday} note(s) today.` : 'No note for today yet.'}</p><a class="btn btn--small" href="/notes">Open my ${langName()} notebook</a>` })}
        </div>
        <div class="grid grid-2">
          ${win({ title: 'Vocabulary lists', variant: 'green', body: d.lists.length ? h`<ul class="list">${d.lists.map((l) => h`<li><a href="/vocabulary/lists/${l.id}">${l.title}</a> ${level(l.level)} <span class="small muted">${l.wordCount} words</span></li>`)}</ul>` : h`<p class="muted">No lists yet.</p>` })}
          ${win({ title: 'New stories', variant: 'salmon', body: d.stories.length ? h`<ul class="list">${d.stories.map((s) => h`<li><a href="/reading/${s.id}"><span class="ta" lang="${s.lang}">${s.title}</span></a> ${level(s.level)}<br><span class="small muted">${s.titleEn}</span></li>`)}</ul>` : h`<p class="muted">No stories yet.</p>` })}
        </div>
        ${win({ title: 'New videos', variant: 'coral', body: d.videos.length ? h`<div class="cards cards--wide">${d.videos.map((v) => h`<a class="win vcard" href="/videos/${v.id}" style="text-decoration:none;color:inherit"><img src="${v.thumbnailUrl}" alt="" loading="lazy"><div class="win__body"><strong>${v.title}</strong><br>${level(v.level)}</div></a>`)}</div>` : h`<p class="muted">No videos have been approved yet. Administrators add them from the content dashboard.</p><a class="btn btn--ghost btn--small" href="/videos">Open the video library</a>` })}
        ${win({ title: 'My collections', variant: 'salmon', corner: 'hibiscus', body: d.collections.length ? h`<div class="cards">${d.collections.map((c) => h`<a class="wcard" href="/collections/${c.id}" style="text-decoration:none"><strong>${c.title}</strong><span class="ta small" lang="ta">${c.preview.join(' · ')}</span><span class="wcard__meta"><span class="small muted">${c.wordCount} words</span><span class="row" style="gap:2px">${lotus(c.lotus.bloomed ? 5 : c.lotus.growing ? 2 : 0, 'sm')}<span class="small">${c.lotus.bloomed}</span></span></span></a>`)}</div>` : empty('No collections yet', 'Create one and start adding words.', h`<a class="btn" href="/collections/new">Create a collection</a>`) })}
        ${d.reading.length ? win({ title: 'Continue reading', body: h`<ul class="list">${d.reading.map((r) => h`<li class="spread"><a href="/reading/${r.id}" class="ta" lang="ta">${r.title}</a><span class="meter" style="--v:${r.progress}%;width:140px"><span></span></span></li>`)}</ul>` }) : ''}
      </div></div>`,
    mount(root) {
      root.querySelector('[data-save-daily]')?.addEventListener('click', () => saveToCollection({ vocabularyIds: d.dailyTopic.words.map((w) => w.id), title: `Save words from “${d.dailyTopic.title}”`, source: 'list', sourceRef: `daily-topic:${d.dailyTopic.id}` }));
    },
  };
}

const TYPE_NAMES = { collocation: 'Collocation', ta_en: 'Tamil → English', en_ta: 'English → Tamil', sentence: 'Sentence completion' };
export async function statistics() {
  const [o, hist] = await Promise.all([api('/stats/overview'), api('/sessions?limit=15')]);
  return {
    title: 'Statistics', scene: 'valley',
    html: h`<div class="page-head"><div><h1>${langName()} statistics</h1><p>Your ${langName()} learning history, from real lesson data. Other languages are counted separately.</p></div><a class="btn btn--cyan" href="/statistics/collections">Collection statistics</a></div>
    <div class="stack">
      ${win({ title: 'Overview', variant: 'salmon', corner: 'lotus', body: h`<div class="statgrid">
        <div class="stat"><b>${o.streak.current}</b><span>day streak (best ${o.streak.longest})</span></div>
        <div class="stat"><b>${o.totals.accuracy}%</b><span>overall accuracy</span></div>
        <div class="stat"><b>${o.totals.correct}</b><span>correct answers</span></div>
        <div class="stat"><b>${o.totals.completedSessions}</b><span>lessons completed</span></div>
        <div class="stat"><b>${o.totals.lotuses}</b><span>lotus rewards</span></div>
        <div class="stat"><b>${o.totals.bloomed}</b><span>words in full bloom</span></div>
        <div class="stat"><b>${o.totals.wordsStudied}</b><span>words studied</span></div></div>` })}
      ${win({ title: 'Last 30 days', body: o.totals.answers ? dailyBars(o.last30) : empty('No practice yet', 'Finish a lesson and your daily history appears here.', h`<a class="btn" href="/study">Study words</a>`) })}
      <div class="grid grid-2">
        ${win({ title: 'Accuracy by exercise', variant: 'green', body: Object.keys(o.byType).length ? h`<ul class="list">${Object.entries(o.byType).map(([t, v]) => { const pct = Math.round((v.correct / Math.max(1, v.correct + v.incorrect)) * 100); return h`<li><div class="spread"><span>${TYPE_NAMES[t] || t}</span><span class="small">${pct}% · ${v.correct}/${v.correct + v.incorrect}</span></div><div class="meter" style="--v:${pct}%"><span></span></div></li>`; })}</ul>` : h`<p class="muted">No answers yet.</p>` })}
        ${win({ title: 'Recent lessons', variant: 'coral', body: hist.length ? h`<div class="table-wrap"><table class="tbl"><tr><th>Started</th><th>Words</th><th>Accuracy</th><th>Lotuses</th><th></th></tr>
          ${hist.map((s) => h`<tr><td>${fmtDate(s.startedAt)}</td><td>${s.words}</td><td>${s.answered ? Math.round((s.correct / s.answered) * 100) : 0}%</td><td>${s.lotuses}</td><td>${s.status === 'completed' ? h`<a href="/learn/${s.id}/stats">Statistics</a>` : s.status === 'active' ? h`<a href="/learn/${s.id}">Resume</a>` : h`<span class="muted">ended</span>`}</td></tr>`)}</table></div>` : h`<p class="muted">No lessons yet.</p>` })}
      </div></div>`,
  };
}
