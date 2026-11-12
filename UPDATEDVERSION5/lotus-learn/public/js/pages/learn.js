import { h, raw, api, win, ta, lotus, toast, confirmDialog, errorsBox, fmtMs, transliterate, motionAllowed, langName } from '../core.js';
import { histogram } from '../charts.js';

let TYPE_LABEL = { collocation: 'Collocation', ta_en: 'Tamil → English', en_ta: 'English → Tamil', sentence: 'Sentence' };
const labels = (lang) => { TYPE_LABEL = { collocation: 'Collocation', ta_en: `${langName(lang)} → English`, en_ta: `English → ${langName(lang)}`, sentence: 'Sentence' }; };

export async function session({ params, navigate }) {
  const id = Number(params.id);
  const st = await api(`/sessions/${id}`);
  if (st.status === 'completed') { navigate(`/learn/${id}/done`, { replace: true }); return null; }
  if (st.status === 'abandoned') { navigate('/study', { replace: true }); return null; }
  labels(st.lang);
  return {
    title: 'Lesson', scene: 'cascade',
    html: h`<div class="learn">
      ${win({ title: `${langName(st.lang)} lesson in progress`, variant: 'salmon', corner: 'lotus', body: h`<div data-progress></div>`, foot: h`<button class="btn btn--ghost btn--small" type="button" data-tr>Transliteration on/off</button><a class="btn btn--ghost btn--small" href="/home">Pause (progress is saved)</a><button class="btn btn--danger btn--small" type="button" data-end>End lesson</button>` })}
      <div style="height:18px"></div>
      <div data-q aria-live="polite"></div></div>`,
    mount(root) {
      const qBox = root.querySelector('[data-q]');
      const progBox = root.querySelector('[data-progress]');
      let current = null, locked = false, onEnter = null;
      const drawProgress = (s) => {
        const pct = Math.round((s.correct / s.required) * 100);
        progBox.innerHTML = String(h`<div class="spread"><span><strong>${s.correct}</strong> / ${s.required} correct answers · ${s.wordsCompleted}/${s.wordCount} words done</span><span class="small muted">${s.incorrect} incorrect</span></div>
          <div class="meter" style="--v:${pct}%;margin:8px 0" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Lesson progress"><span></span></div>
          <details><summary class="small">Progress per word</summary><ul class="list">${s.words.map((w) => h`<li class="spread"><span class="ta" lang="${st.lang}">${w.tamil}</span><span class="word-dots" aria-label="${w.correct} of 10">${Array.from({ length: 10 }, (_, i) => h`<i class="${i < w.correct ? 'on' : ''}"></i>`)}</span></li>`)}</ul></details>`);
      };
      drawProgress(st);
      const drawQuestion = (q) => {
        const p = q.prompt;
        const promptHtml = p.lang === 'ta' ? h`<span class="ta ta-xl" lang="${st.lang}">${p.text}</span><span class="tr">${transliterate(p.text.replace(/＿＿＿/g, '___'))}</span>` : h`<span class="ta-xl" style="display:block;font-weight:700;margin:8px 0">${p.text}</span>${p.pos ? h`<span class="small muted">(${p.pos})</span>` : ''}`;
        qBox.innerHTML = String(win({ title: `${TYPE_LABEL[q.type]} · word ${q.word.correct}/10`, variant: 'green', corner: 'hibiscus', cls: 'question', body: h`
          <p class="q-instruction">${p.instruction}</p>${promptHtml}${p.hint ? h`<p class="q-hint">“${p.hint}”</p>` : ''}
          <div class="options" role="group" aria-label="Answer options">${q.options.map((o, i) => h`<button class="opt" type="button" data-opt="${i}"><span class="opt__key">${i + 1}</span>${q.type === 'ta_en' ? h`<span>${o}</span>` : h`<span class="ta" lang="${st.lang}">${o}</span><span class="tr">${transliterate(o)}</span>`}</button>`)}</div>
          <div data-fb></div>` }));
        qBox.querySelector('.opt')?.focus({ preventScroll: true });
        locked = false;
      };
      const next = async () => {
        onEnter = null;
        try {
          const r = await api(`/sessions/${id}/question`);
          if (!r.question) { navigate(`/learn/${id}/done`, { replace: true }); return; }
          current = r.question; drawQuestion(current);
        } catch (e) { qBox.innerHTML = String(errorsBox(e)); }
      };
      const answer = async (i) => {
        if (locked || !current) return;
        locked = true;
        const btns = [...qBox.querySelectorAll('.opt')];
        btns.forEach((b) => { b.disabled = true; });
        const choice = current.options[i];
        try {
          const r = await api(`/sessions/${id}/answer`, { method: 'POST', body: { questionId: current.id, answer: choice } });
          const right = current.options.indexOf(r.correctAnswer);
          btns[right]?.classList.add('opt--correct');
          if (!r.correct) btns[i].classList.add('opt--wrong');
          drawProgress(r.session);
          const fb = qBox.querySelector('[data-fb]');
          if (r.completed) {
            fb.innerHTML = String(h`<div class="feedback feedback--ok">Lesson complete!</div>`);
            setTimeout(() => navigate(`/learn/${id}/done`, { replace: true }), 700);
            return;
          }
          if (r.correct) {
            fb.innerHTML = String(h`<div class="feedback feedback--ok"><span>✓ Correct${r.word.completed ? ' — this word has all 10 correct answers!' : ''}</span></div>`);
            setTimeout(next, motionAllowed() ? 650 : 400);
          } else {
            fb.innerHTML = String(h`<div class="feedback feedback--bad"><span>✗ Not quite. The answer is <span class="ta" lang="${st.lang}">${r.correctAnswer}</span>. Wrong answers don't count toward the 10.</span><button class="btn btn--small" type="button" data-next>Continue</button></div>`);
            const b = fb.querySelector('[data-next]'); b.focus(); b.addEventListener('click', next); onEnter = next;
          }
        } catch (e) { toast(e.message, 'bad'); btns.forEach((b) => { b.disabled = false; }); locked = false; }
      };
      qBox.addEventListener('click', (e) => { const o = e.target.closest('[data-opt]'); if (o) answer(Number(o.dataset.opt)); });
      const onKey = (e) => {
        if (!document.body.contains(qBox)) { document.removeEventListener('keydown', onKey); return; }
        if (e.target.closest('input, textarea, select')) return;
        if (/^[1-4]$/.test(e.key) && !locked) answer(Number(e.key) - 1);
        if (e.key === 'Enter' && onEnter && !e.target.closest('button')) { e.preventDefault(); onEnter(); }
      };
      document.addEventListener('keydown', onKey);
      root.querySelector('[data-tr]').addEventListener('click', () => document.body.classList.toggle('hide-tr'));
      root.querySelector('[data-end]').addEventListener('click', async () => {
        if (await confirmDialog({ title: 'End lesson', text: 'End this lesson now? Answers so far are kept in your statistics, but no lotuses are awarded for an unfinished lesson.', confirmLabel: 'End lesson' })) {
          await api(`/sessions/${id}/abandon`, { method: 'POST' }); toast('Lesson ended.'); navigate('/study', { replace: true });
        }
      });
      next();
    },
  };
}

export async function done({ params }) {
  const s = await api(`/sessions/${params.id}/summary`);
  const t = s.totals;
  const earned = s.words.filter((w) => w.earnedLotus);
  return {
    title: 'Lesson completed', scene: 'lagoon',
    html: h`<div class="learn stack">
      ${win({ title: 'Lesson completed', variant: 'salmon', corner: 'lotus', cornerBr: true, body: h`<div class="complete-hero">
        <h1>Excellent!</h1><p style="font:600 1.3rem var(--font-ui);margin:4px 0 16px">Lesson completed!</p>
        <div class="statgrid"><div class="stat"><b>${t.words}</b><span>words studied</span></div><div class="stat"><b>${t.questions}</b><span>questions answered</span></div>
          <div class="stat"><b>${t.correct}</b><span>correct answers</span></div><div class="stat"><b>${t.incorrect}</b><span>incorrect answers</span></div>
          <div class="stat"><b>${fmtMs(t.activeMs)}</b><span>total time</span></div><div class="stat"><b>${t.wordsCompleted}</b><span>words completed</span></div></div></div>` })}
      ${win({ title: earned.length ? `New lotus rewards: ${earned.length}` : 'Lotus rewards', variant: 'green', corner: 'hibiscus', body: earned.length ? h`<div class="rewards">${earned.map((w, i) => h`<div class="reward"><span class="lotus lotus--lg ${w.mastery.lotus === 5 ? 'lotus--bloom' : 'lotus--grow'}" style="--frame:${w.mastery.lotus};animation-delay:${i * 120}ms" role="img" aria-label="${w.mastery.lotus} of 5 lotuses"></span><span class="ta" lang="${s.lang}">${w.tamil}</span><span class="small muted">${w.mastery.lotus === 5 ? 'Full bloom!' : `${w.mastery.lotus} of 5`}</span></div>`)}</div>`
        : h`<p>No new lotuses this time: these words already earned today's lotus. Practise again tomorrow to grow them.</p>` })}
      <div class="btn-row" style="justify-content:center"><a class="btn btn--big btn--bloom" href="/learn/${s.id}/stats">Lesson Statistics</a><a class="btn btn--big btn--ghost" href="/study">Study more words</a></div></div>`,
  };
}

export async function lessonStats({ params }) {
  const s = await api(`/sessions/${params.id}/summary`);
  labels(s.lang);
  const t = s.totals;
  const row = (w) => h`<li class="spread"><span>${ta(w.tamil, { tr: false })} <span class="small muted">${w.english}</span></span><span class="small">${w.accuracy}% · ${w.incorrect} wrong</span></li>`;
  return {
    title: 'Lesson statistics', scene: 'valley',
    html: h`<div class="page-head"><div><h1>Lesson statistics</h1><p>${new Date(s.startedAt).toLocaleString()}</p></div><a class="btn btn--ghost" href="/statistics">All statistics</a></div>
    <div class="stack">
      ${win({ title: 'Answers per word', variant: 'salmon', corner: 'lotus', body: h`<p class="small muted">Taller coral bars show the words that caused the most difficulty.</p>${histogram(s.words)}` })}
      <div class="grid grid-3">
        ${win({ title: 'Totals', variant: 'green', body: h`<div class="statgrid"><div class="stat"><b>${t.accuracy}%</b><span>accuracy</span></div><div class="stat"><b>${fmtMs(t.activeMs)}</b><span>total time</span></div><div class="stat"><b>${t.questions}</b><span>questions completed</span></div><div class="stat"><b>${t.lotusesEarned}</b><span>lotuses earned</span></div></div>` })}
        ${win({ title: 'Strongest words', body: s.strongest.length ? h`<ul class="list">${s.strongest.map(row)}</ul>` : h`<p class="muted">—</p>` })}
        ${win({ title: 'Weakest words', variant: 'coral', body: s.weakest.length ? h`<ul class="list">${s.weakest.map(row)}</ul>` : h`<p>No mistakes in this lesson.</p>` })}
      </div>
      ${win({ title: 'By exercise type', body: h`<div class="table-wrap"><table class="tbl"><tr><th>Word</th>${Object.keys(TYPE_LABEL).map((k) => h`<th>${TYPE_LABEL[k]}</th>`)}<th>Lotus</th></tr>
        ${s.words.map((w) => h`<tr><td><span class="ta" lang="${s.lang}">${w.tamil}</span></td>${Object.keys(TYPE_LABEL).map((k) => h`<td class="small">${w.byType[k] ? `${w.byType[k].correct} ✓ · ${w.byType[k].incorrect} ✗` : '—'}</td>`)}<td>${lotus(w.mastery.lotus, 'sm')}</td></tr>`)}</table></div>` })}
    </div>`,
  };
}
void raw;
