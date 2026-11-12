import { h, api, state, applyPrefs, win, ta, errorsBox, formData, toast, raw, langName } from '../core.js';
import { refreshMe, renderShell } from '../app.js';

export async function landing() {
  const show = await api('/public/showcase');
  const word = show.words[new Date().getDate() % Math.max(1, show.words.length)];
  return {
    title: 'Learn Tamil', scene: 'lagoon',
    html: h`<section class="hero">
      <div>
        <h1 class="hero__logo">Lotus<br>Learn</h1>
        <p class="hero__ta" lang="ta">தமிழ் கற்போம்</p>
        <p class="hero__lead">Learn Tamil, Malayalam, Kannada or Telugu — each with its own progress, dictionary, grammar, stories and notebook. Practise every word until it sticks and watch a lotus grow on its card.</p>
        <div class="btn-row"><a class="btn btn--big btn--bloom" href="/register">Start learning</a><a class="btn btn--big btn--ghost" href="/login">I have an account</a></div>
      </div>
      <div class="stack">
        ${word ? win({ title: 'Word of the day', variant: 'salmon', corner: 'hibiscus', body: h`${ta(word.tamil, { size: 'xl' })}<p class="en">${word.english}</p>` }) : ''}
        ${win({ title: 'How the lotus grows', variant: 'green', corner: 'lotus', body: h`
          <p>Answer ten questions correctly for a word and it earns a lotus. One lotus per word per day. Five days of practice and the flower opens.</p>
          <div class="lotus-legend">${[0, 1, 2, 3, 4, 5].map((n) => h`<span><span class="lotus lotus--sm" style="--frame:${n}"></span>${n}</span>`)}</div>` })}
      </div>
    </section>
    <div class="grid grid-3" style="margin-top:28px">
      ${win({ title: 'Your own collections', body: h`<p>Build word lists from the library, stories, videos or your own notes. Up to ${state.meta?.limits.collectionWordLimit || 1000} words each.</p>` })}
      ${win({ title: 'Stories & videos', variant: 'orange', body: h`<p>${show.counts.stories} Tamil stories with tap-to-translate words${show.counts.videos ? h`, and ${show.counts.videos} curated videos` : ''}. Spoken and formal Tamil are labelled.</p>` })}
      ${win({ title: 'Four languages, one place', variant: 'coral', body: h`<p>${show.perLanguage.map((l) => h`<span class="ta" lang="${l.code}">${l.native}</span> ${l.words} words · `)}switch at any time without losing progress.</p>` })}
    </div>`,
  };
}

function authForm({ title, fields, submit, footer, onSubmit, corner = 'hibiscus' }) {
  return {
    title, scene: 'cascade',
    html: h`<div style="max-width:440px;margin:4vh auto">${win({ title, variant: 'salmon', corner, cornerBr: true, body: h`<form data-auth novalidate>${fields}<div data-err></div><div class="btn-row"><button class="btn btn--bloom" type="submit">${submit}</button></div></form><div style="margin-top:14px">${footer}</div>` })}</div>`,
    mount(root) {
      const f = root.querySelector('form');
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
        try { await onSubmit(formData(f), root); } catch (err) { root.querySelector('[data-err]').innerHTML = String(errorsBox(err)); } finally { btn.disabled = false; }
      });
    },
  };
}

export function login({ query, navigate }) {
  return authForm({
    title: 'Sign in', submit: 'Sign in',
    fields: h`<label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
      <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>`,
    footer: h`<p class="small"><a href="/forgot-password">Forgot your password?</a> · New here? <a href="/register">Create an account</a></p>`,
    async onSubmit(d) {
      await api('/auth/login', { method: 'POST', body: d });
      await refreshMe(); renderShell();
      const next = query.next && query.next.startsWith('/') && !query.next.startsWith('//') ? query.next : '/home';
      navigate(next, { replace: true });
    },
  });
}
export function register({ navigate }) {
  return authForm({
    title: 'Create your account', submit: 'Create account', corner: 'lotus',
    fields: h`<label class="field"><span>Your name</span><input type="text" name="displayName" maxlength="60" autocomplete="name"></label>
      <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
      <label class="field"><span>Password</span><input type="password" name="password" autocomplete="new-password" minlength="8" required><small>At least 8 characters.</small></label>`,
    footer: h`<p class="small">Already learning? <a href="/login">Sign in</a></p>`,
    async onSubmit(d) {
      await api('/auth/register', { method: 'POST', body: d });
      await refreshMe(); renderShell(); navigate('/onboarding', { replace: true });
    },
  });
}
export function forgot() {
  return authForm({
    title: 'Reset your password', submit: 'Send reset link',
    fields: h`<p>Enter your account email. We'll send a link that is valid for one hour.</p><label class="field"><span>Email</span><input type="email" name="email" required></label>`,
    footer: h`<p class="small"><a href="/login">Back to sign in</a></p>`,
    async onSubmit(d, root) {
      const r = await api('/auth/forgot', { method: 'POST', body: d });
      root.querySelector('form').innerHTML = String(h`<div class="notice notice--info">${r.message}</div>`);
    },
  });
}
export function reset({ query, navigate }) {
  return authForm({
    title: 'Choose a new password', submit: 'Save new password',
    fields: h`<input type="hidden" name="token" value="${query.token || ''}"><label class="field"><span>New password</span><input type="password" name="password" minlength="8" autocomplete="new-password" required></label>`,
    footer: h`<p class="small"><a href="/login">Back to sign in</a></p>`,
    async onSubmit(d) {
      await api('/auth/reset', { method: 'POST', body: d });
      toast('Password changed. Sign in with your new password.');
      navigate('/login', { replace: true });
    },
  });
}

export async function onboarding({ navigate }) {
  const m = state.meta;
  const p = state.profile;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return {
    title: 'Welcome', scene: 'cascade',
    html: h`<div style="max-width:860px;margin:0 auto">${win({ title: `Welcome, ${p.displayName}`, variant: 'salmon', corner: 'lotus', cornerBr: true, body: h`
      <form data-onb>
        ${state.profile.languages && !Object.values(state.profile.languages).some((x) => x.onboarded) ? h`<h2>Which language would you like to learn first?</h2>
        <div class="row" role="radiogroup" aria-label="Learning language" style="margin-bottom:14px">${state.meta.languages.map((l) => h`<label class="chip" style="font-size:1rem"><input type="radio" name="lang" value="${l.code}" ${l.code === state.lang ? raw('checked') : ''}><span lang="${l.code}">${l.native}</span> · ${l.name}</label>`)}</div>
        <p class="small muted">You can add the other languages later; each keeps its own level and progress.</p>` : h`<input type="hidden" name="lang" value="${state.lang}">`}
        <h2>How much ${langName()} do you know?</h2>
        <div class="cards cards--wide" role="radiogroup" aria-label="Proficiency level">
          ${m.levels.map((l) => h`<label class="wcard" style="cursor:pointer;min-height:auto"><span class="row"><input type="radio" name="level" value="${l.code}" ${l.code === p.level ? raw('checked') : ''}> <strong>${l.code} · ${l.name}</strong></span><span class="small muted">${l.description}</span></label>`)}
        </div>
        <h2 style="margin-top:20px">What would you like to talk about?</h2>
        <p class="muted small">Daily word recommendations favour these topics. You can change them any time.</p>
        <div class="chips">${m.topics.map((t) => h`<label class="chip"><input type="checkbox" name="topics" value="${t.slug}" ${p.preferredTopics.includes(t.slug) ? raw('checked') : ''}>${t.name}</label>`)}</div>
        <h2 style="margin-top:20px">Moving scenery</h2>
        <div class="row">
          <label class="check"><input type="radio" name="motion" value="full" ${p.motion === 'full' ? raw('checked') : ''}> Full animation</label>
          <label class="check"><input type="radio" name="motion" value="reduced" ${p.motion === 'reduced' ? raw('checked') : ''}> Reduced</label>
          <label class="check"><input type="radio" name="motion" value="off" ${p.motion === 'off' ? raw('checked') : ''}> Still pictures</label>
        </div>
        <p class="small muted">Your time zone: ${tz}. Lotus rewards follow your local calendar day.</p>
        <div data-err></div>
        <div class="btn-row" style="margin-top:14px"><button class="btn btn--big btn--bloom" type="submit">Start learning</button></div>
      </form>` })}</div>`,
    mount(root) {
      root.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          const lang = fd.get('lang') || state.lang;
          if (lang !== state.lang) state.profile = await api('/profile/language', { method: 'PUT', body: { lang } });
          state.profile = await api('/profile', { method: 'PATCH', body: { lang, level: fd.get('level'), preferredTopics: fd.getAll('topics'), motion: fd.get('motion'), timezone: tz, onboarded: true } });
          applyPrefs(); renderShell(); navigate('/home', { replace: true });
        } catch (err) { root.querySelector('[data-err]').innerHTML = String(errorsBox(err)); }
      });
    },
  };
}
