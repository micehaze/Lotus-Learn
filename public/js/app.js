import { h, raw, api, state, applyPrefs, setNavigator, loadingView, errorsBox, win, toast, esc } from './core.js';
import { setScene } from './scene.js';
import * as pub from './pages/public.js';
import * as home from './pages/home.js';
import * as vocab from './pages/vocab.js';
import * as cols from './pages/collections.js';
import * as learn from './pages/learn.js';
import * as lib from './pages/library.js';
import * as acct from './pages/account.js';
import * as admin from './pages/admin.js';

// [pattern, page, access] access: 'public' | 'guest' (signed-out only) | 'user' | 'admin'
const ROUTES = [
  ['/', pub.landing, 'guest'],
  ['/login', pub.login, 'guest'],
  ['/register', pub.register, 'guest'],
  ['/forgot-password', pub.forgot, 'public'],
  ['/reset-password', pub.reset, 'public'],
  ['/onboarding', pub.onboarding, 'user'],
  ['/home', home.home, 'user'],
  ['/statistics', home.statistics, 'user'],
  ['/statistics/collections', cols.globalStats, 'user'],
  ['/vocabulary', vocab.browse, 'user'],
  ['/vocabulary/lists/:id', vocab.listDetail, 'user'],
  ['/vocabulary/word/:id', vocab.wordDetail, 'user'],
  ['/dictionary', vocab.dictionary, 'user'],
  ['/collections', cols.index, 'user'],
  ['/collections/new', cols.create, 'user'],
  ['/collections/:id', cols.detail, 'user'],
  ['/collections/:id/stats', cols.stats, 'user'],
  ['/study', cols.study, 'user'],
  ['/learn/:id', learn.session, 'user'],
  ['/learn/:id/done', learn.done, 'user'],
  ['/learn/:id/stats', learn.lessonStats, 'user'],
  ['/reading', lib.reading, 'user'],
  ['/reading/:id', lib.reader, 'user'],
  ['/videos', lib.videos, 'user'],
  ['/videos/:id', lib.video, 'user'],
  ['/profile', acct.profile, 'user'],
  ['/settings', acct.settings, 'user'],
  ['/admin', admin.page, 'admin'],
  ['/admin/:tab', admin.page, 'admin'],
].map(([p, page, access]) => {
  const keys = [];
  const re = new RegExp(`^${p.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  return { re, keys, page, access };
});

const NAV = [
  ['/home', 'Home'], ['/vocabulary', 'Vocabulary'], ['/videos', 'Videos'], ['/reading', 'Reading'], ['/dictionary', 'Dictionary'],
  ['/collections', 'Collections'], ['/statistics', 'Statistics'], ['/profile', 'Profile'],
];

function shell() {
  const signedIn = !!state.user;
  const p = state.profile;
  const initial = (p?.displayName || '?').trim().charAt(0).toUpperCase();
  return h`
  <header class="topbar">
    <a class="logo" href="${signedIn ? '/home' : '/'}" aria-label="Lotus Learn home"><span class="logo__word">Lotus Learn</span><span class="logo__ta" lang="ta">தமிழ்</span></a>
    ${signedIn ? h`<form class="topbar__search" role="search" data-quicksearch><label class="visually-hidden" for="qs">Search the dictionary</label><input id="qs" type="search" name="q" placeholder="Search in English, Hindi, Malayalam or Tamil" autocomplete="off"><button class="btn btn--cyan btn--small" type="submit">Search</button></form>` : ''}
    <div class="topbar__user">
      ${signedIn ? h`<button class="btn btn--ghost btn--small menu-btn" type="button" data-menu aria-expanded="false" aria-controls="nav">Menu</button>
        <a href="/profile" class="avatar" style="${p?.avatar ? raw(`background-image:url('${esc(p.avatar)}')`) : ''}" aria-label="Your profile">${p?.avatar ? '' : initial}</a>
        <span class="who">${p?.displayName}</span>
        <button class="btn btn--ghost btn--small" type="button" data-logout>Sign out</button>`
      : h`<a class="btn btn--ghost btn--small" href="/login">Sign in</a><a class="btn btn--small" href="/register">Create account</a>`}
    </div>
  </header>
  ${signedIn ? h`<nav class="navbar" id="nav" aria-label="Main">${NAV.map(([href, label]) => h`<a href="${href}" data-nav="${href}">${label}</a>`)}${state.user.role === 'admin' ? h`<a href="/admin" data-nav="/admin">Admin</a>` : ''}<a href="/settings" data-nav="/settings">Settings</a></nav>` : ''}
  <main id="main" tabindex="-1"></main>
  <footer class="footer">Lotus Learn · original pixel art · Tamil learning for every level</footer>`;
}

function renderShell() {
  const app = document.getElementById('app');
  app.innerHTML = String(shell());
  app.querySelector('[data-logout]')?.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    state.user = null; state.profile = null; applyPrefs(); renderShell(); navigate('/');
  });
  app.querySelector('[data-quicksearch]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get('q');
    navigate(`/dictionary?q=${encodeURIComponent(q)}`);
  });
  const menu = app.querySelector('[data-menu]');
  menu?.addEventListener('click', () => { const n = app.querySelector('.navbar'); n.classList.toggle('open'); menu.setAttribute('aria-expanded', n.classList.contains('open')); });
}

let renderSeq = 0;
export async function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
  await render();
}
setNavigator(navigate);

async function render() {
  const seq = ++renderSeq;
  const url = new URL(location.href);
  const path = url.pathname;
  let match = null, params = {};
  for (const r of ROUTES) { const m = path.match(r.re); if (m) { match = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; } }
  if (!match) { mountView({ title: 'Not found', scene: 'fern', html: win({ title: 'Page not found', variant: 'coral', corner: 'coral', body: h`<p>This page does not exist.</p><a class="btn" href="/">Go home</a>` }) }); return; }
  if (match.access === 'user' && !state.user) return navigate(`/login?next=${encodeURIComponent(path + url.search)}`, { replace: true });
  if (match.access === 'admin' && state.user?.role !== 'admin') { if (!state.user) return navigate('/login', { replace: true }); mountView({ title: 'Admin only', scene: 'fern', html: win({ title: 'Administrator access required', variant: 'coral', body: h`<p>This area is for content administrators.</p>` }) }); return; }
  if (match.access === 'guest' && state.user) return navigate('/home', { replace: true });
  if (state.user && !state.profile?.onboarded && path !== '/onboarding' && match.access === 'user') return navigate('/onboarding', { replace: true });
  document.querySelectorAll('[data-nav]').forEach((a) => a.toggleAttribute('aria-current', path === a.dataset.nav || (a.dataset.nav !== '/home' && path.startsWith(a.dataset.nav))));
  document.querySelectorAll('[data-nav][aria-current]').forEach((a) => a.setAttribute('aria-current', 'page'));
  document.querySelector('.navbar')?.classList.remove('open');
  const main = document.getElementById('main');
  main.innerHTML = String(loadingView());
  try {
    const view = await match.page({ params, query: Object.fromEntries(url.searchParams), navigate, refreshShell: renderShell });
    if (seq !== renderSeq || !view) return;
    mountView(view);
  } catch (e) {
    if (seq !== renderSeq) return;
    if (e.status === 401) { state.user = null; renderShell(); return navigate('/login', { replace: true }); }
    mountView({ title: 'Error', scene: 'fern', html: win({ title: e.status === 404 ? 'Not found' : 'Something went wrong', variant: 'coral', corner: 'coral', body: h`${errorsBox(e)}<a class="btn" href="/home">Back to home</a>` }) });
  }
}

function mountView(view) {
  const main = document.getElementById('main');
  document.title = `${view.title} · Lotus Learn`;
  main.innerHTML = String(view.html);
  setScene(view.scene || 'lagoon');
  view.mount?.(main);
  if (!view.keepScroll) scrollTo(0, 0);
  main.focus({ preventScroll: true });
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return;
  e.preventDefault();
  navigate(href);
});
addEventListener('popstate', render);
matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => { applyPrefs(); render(); });

export async function refreshMe() {
  const me = await api('/auth/me');
  state.user = me.user; state.profile = me.profile || null;
  applyPrefs();
}

(async function boot() {
  try {
    const [me, meta] = await Promise.all([api('/auth/me'), api('/meta')]);
    state.user = me.user; state.profile = me.profile || null; state.meta = meta;
  } catch (e) {
    document.getElementById('app').innerHTML = String(win({ title: 'Cannot reach Lotus Learn', variant: 'coral', body: errorsBox(e) }));
    return;
  }
  applyPrefs();
  renderShell();
  render();
})();
export { renderShell, toast };
