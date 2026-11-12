import { h, raw, api, state, applyPrefs, win, lotus, level, fmtDate, toast, errorsBox, confirmDialog, esc } from '../core.js';
import { renderShell } from '../app.js';
import { refreshScene } from '../scene.js';

async function resizeImage(file, size = 256) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file is not an image we can read.')); i.src = url; });
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const s = Math.min(img.width, img.height);
    c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

export async function profile() {
  const [p, o, hist] = await Promise.all([api('/profile'), api('/stats/overview'), api('/reading/history')]);
  const initial = p.displayName.trim().charAt(0).toUpperCase();
  return {
    title: 'Profile', scene: 'valley',
    html: h`<div class="split">
      ${win({ title: 'Profile picture', variant: 'salmon', corner: 'hibiscus', body: h`<div class="center"><div class="avatar avatar--lg" data-av style="margin:0 auto 12px;${p.avatar ? raw(`background-image:url('${esc(p.avatar)}')`) : ''}">${p.avatar ? '' : initial}</div>
        <label class="btn btn--small" style="cursor:pointer">Upload picture<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-file class="visually-hidden"></label>
        ${p.avatar ? h`<button class="btn btn--small btn--ghost" type="button" data-rmav>Remove</button>` : ''}<p class="small muted">Square images work best. It is resized to 256 px.</p></div>` })}
      <div class="stack">
        ${win({ title: 'About you', corner: 'frangipani', body: h`<form data-prof>
          <label class="field"><span>Display name</span><input type="text" name="displayName" value="${p.displayName}" maxlength="60" required></label>
          <label class="field"><span>About me</span><textarea name="bio" maxlength="400">${p.bio}</textarea></label>
          <dl class="kv"><dt>Email</dt><dd>${p.email}</dd><dt>Level</dt><dd>${level(p.level)} <a class="small" href="/settings">change</a></dd><dt>Member since</dt><dd>${fmtDate(p.memberSince)}</dd></dl>
          <div data-err></div><button class="btn" type="submit" style="margin-top:12px">Save profile</button></form>` })}
        ${win({ title: 'Progress', variant: 'green', corner: 'lotus', body: h`<div class="statgrid"><div class="stat"><b>${o.streak.current}</b><span>day streak</span></div><div class="stat"><b>${o.totals.wordsStudied}</b><span>words studied</span></div><div class="stat"><b>${o.totals.lotuses}</b><span>lotuses</span></div><div class="stat"><b>${o.totals.bloomed}</b><span>full blooms</span></div></div>
          <div class="lotus-legend" style="margin-top:12px">${[1, 2, 3, 4, 5].map((n) => h`<span>${lotus(n, 'sm')} ${n === 5 ? 'full bloom' : `${n} day${n > 1 ? 's' : ''}`}</span>`)}</div>` })}
        ${win({ title: 'Reading history', variant: 'orange', body: hist.length ? h`<ul class="list">${hist.map((r) => h`<li class="spread"><a class="ta" lang="ta" href="/reading/${r.id}">${r.title}</a><span class="small">${r.progress}%</span></li>`)}</ul>` : h`<p class="muted">No stories read yet. <a href="/reading">Open the reading library</a>.</p>` })}
      </div></div>`,
    mount(root) {
      const err = root.querySelector('[data-err]');
      root.querySelector('[data-prof]').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { state.profile = await api('/profile', { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) }); renderShell(); toast('Profile saved.'); } catch (x) { err.innerHTML = String(errorsBox(x)); }
      });
      root.querySelector('[data-file]').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { const dataUrl = await resizeImage(f); state.profile = await api('/profile/avatar', { method: 'PUT', body: { dataUrl } }); renderShell(); const av = root.querySelector('[data-av]'); av.style.backgroundImage = `url('${dataUrl}')`; av.textContent = ''; toast('Picture updated.'); } catch (x) { toast(x.message, 'bad'); }
      });
      root.querySelector('[data-rmav]')?.addEventListener('click', async () => { state.profile = await api('/profile/avatar', { method: 'PUT', body: { dataUrl: null } }); renderShell(); toast('Picture removed.'); location.reload(); });
    },
  };
}

const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC']; } })();
export async function settings({ navigate }) {
  const p = await api('/profile');
  const m = state.meta;
  return {
    title: 'Settings', scene: 'valley',
    html: h`<div class="page-head"><div><h1>Settings</h1></div></div>
    <div class="grid grid-2">
      ${win({ title: 'Learning', variant: 'salmon', corner: 'lotus', body: h`<form data-learn>
        <label class="field"><span>Tamil level</span><select name="level">${m.levels.map((l) => h`<option value="${l.code}" ${l.code === p.level ? raw('selected') : ''}>${l.code} · ${l.name}</option>`)}</select><small>Recommendations favour this level; you can still explore all levels.</small></label>
        <label class="field"><span>Daily goal (correct answers)</span><input type="number" name="dailyGoal" min="1" max="500" value="${p.dailyGoal}"></label>
        <label class="check"><input type="checkbox" name="showTransliteration" ${p.showTransliteration ? raw('checked') : ''}> Show transliteration under Tamil text</label>
        <fieldset style="border:0;padding:0;margin:14px 0"><legend class="label">Preferred topics</legend><div class="chips">${m.topics.map((t) => h`<label class="chip"><input type="checkbox" name="topics" value="${t.slug}" ${p.preferredTopics.includes(t.slug) ? raw('checked') : ''}>${t.name}</label>`)}</div></fieldset>
        <button class="btn" type="submit">Save learning settings</button></form>` })}
      <div class="stack">
        ${win({ title: 'Interface', variant: 'green', corner: 'frangipani', body: h`<form data-ui>
          <label class="field"><span>Interface language</span><select name="interfaceLanguage"><option value="en">English</option></select><small>More interface languages can be added later.</small></label>
          <fieldset style="border:0;padding:0;margin:0 0 12px"><legend class="label">Animated scenery</legend>
            <label class="check"><input type="radio" name="motion" value="full" ${p.motion === 'full' ? raw('checked') : ''}> Full: moving water, flowers and leaves</label><br>
            <label class="check"><input type="radio" name="motion" value="reduced" ${p.motion === 'reduced' ? raw('checked') : ''}> Reduced: still scenery, small feedback only</label><br>
            <label class="check"><input type="radio" name="motion" value="off" ${p.motion === 'off' ? raw('checked') : ''}> Off: no animation at all</label>
            <p class="small muted">Your device's “reduce motion” setting is always respected.</p></fieldset>
          <label class="field"><span>Time zone</span><select name="timezone">${ZONES.map((z) => h`<option ${z === p.timezone ? raw('selected') : ''}>${z}</option>`)}</select><small>Lotus rewards follow your calendar day.</small></label>
          <button class="btn" type="submit">Save interface settings</button></form>` })}
        ${win({ title: 'Password', body: h`<form data-pw><label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label><label class="field"><span>New password</span><input type="password" name="next" minlength="8" autocomplete="new-password" required></label><div data-pwerr></div><button class="btn" type="submit">Change password</button></form>` })}
        ${win({ title: 'Delete account', variant: 'coral', corner: 'coral', body: h`<p class="small">Deletes your profile, collections, lesson history and lotuses permanently.</p><form data-delacct><label class="field"><span>Confirm with your password</span><input type="password" name="password" required></label><button class="btn btn--danger" type="submit">Delete my account</button></form>` })}
      </div></div>`,
    mount(root) {
      const save = async (body, msg) => { try { state.profile = await api('/profile', { method: 'PATCH', body }); applyPrefs(); renderShell(); toast(msg); return true; } catch (e) { toast(e.message, 'bad'); return false; } };
      root.querySelector('[data-learn]').addEventListener('submit', (e) => { e.preventDefault(); const fd = new FormData(e.target); save({ level: fd.get('level'), dailyGoal: Number(fd.get('dailyGoal')), showTransliteration: fd.get('showTransliteration') === 'on', preferredTopics: fd.getAll('topics') }, 'Learning settings saved.'); });
      root.querySelector('[data-ui]').addEventListener('submit', async (e) => { e.preventDefault(); const fd = new FormData(e.target); if (await save({ interfaceLanguage: fd.get('interfaceLanguage'), motion: fd.get('motion'), timezone: fd.get('timezone') }, 'Interface settings saved.')) refreshScene(); });
      root.querySelector('[data-pw]').addEventListener('submit', async (e) => { e.preventDefault(); try { await api('/auth/change-password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('Password changed.'); } catch (x) { root.querySelector('[data-pwerr]').innerHTML = String(errorsBox(x)); } });
      root.querySelector('[data-delacct]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pw = new FormData(e.target).get('password');
        if (!(await confirmDialog({ title: 'Delete account', text: 'This permanently deletes your account and all learning data. Continue?', confirmLabel: 'Delete account' }))) return;
        try { await api('/auth/delete-account', { method: 'POST', body: { password: pw } }); state.user = null; state.profile = null; renderShell(); navigate('/', { replace: true }); toast('Your account was deleted.'); } catch (x) { toast(x.message, 'bad'); }
      });
    },
  };
}
