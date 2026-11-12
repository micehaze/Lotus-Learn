import { bad, notFound } from '../util.js';
import { isLang } from '../../shared/indic.js';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function checkDate(d) {
  const m = String(d || '').match(DATE_RE);
  if (!m) throw bad('Date must look like YYYY-MM-DD');
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (dt.getUTCFullYear() !== +m[1] || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) throw bad('That date does not exist');
  return d;
}

/** Personal, per-language Learning Notes. Every query is scoped by user and language. */
export function createNotesService({ db, clock }) {
  const now = () => clock.now().toISOString();
  const view = (r) => ({ id: r.id, lang: r.lang, date: r.note_date, title: r.title, body: r.body, createdAt: r.created_at, updatedAt: r.updated_at });
  const lang = (l) => { if (!isLang(l)) throw bad('Unknown language'); return l; };
  function own(userId, id) {
    const r = db.get('SELECT * FROM learning_notes WHERE id = ? AND user_id = ?', id, userId);
    if (!r) throw notFound('Note not found');
    return r;
  }
  function month(userId, l, ym) {
    if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) throw bad('Month must look like YYYY-MM');
    const days = db.all('SELECT note_date, COUNT(*) AS n FROM learning_notes WHERE user_id = ? AND lang = ? AND note_date LIKE ? GROUP BY note_date', userId, lang(l), `${ym}-%`);
    return { month: ym, days: Object.fromEntries(days.map((d) => [d.note_date, d.n])) };
  }
  const year = (userId, l, y) => Object.fromEntries(db.all("SELECT substr(note_date, 1, 7) AS m, COUNT(*) AS n FROM learning_notes WHERE user_id = ? AND lang = ? AND note_date LIKE ? GROUP BY m", userId, lang(l), `${y}-%`).map((r) => [r.m, r.n]));
  const byDate = (userId, l, d) => db.all('SELECT * FROM learning_notes WHERE user_id = ? AND lang = ? AND note_date = ? ORDER BY created_at, id', userId, lang(l), checkDate(d)).map(view);
  const countOn = (userId, l, d) => db.get('SELECT COUNT(*) AS n FROM learning_notes WHERE user_id = ? AND lang = ? AND note_date = ?', userId, l, d).n;
  function search(userId, l, q) {
    const s = String(q || '').trim();
    if (!s) return [];
    return db.all('SELECT * FROM learning_notes WHERE user_id = ? AND lang = ? AND (title LIKE ? OR body LIKE ?) ORDER BY note_date DESC, id DESC LIMIT 100', userId, lang(l), `%${s}%`, `%${s}%`).map(view);
  }
  const recent = (userId, l, n = 5) => db.all('SELECT * FROM learning_notes WHERE user_id = ? AND lang = ? ORDER BY updated_at DESC LIMIT ?', userId, lang(l), n).map(view);
  function clean(input) {
    const title = String(input.title ?? '').slice(0, 120);
    const body = String(input.body ?? '').normalize('NFC');
    if (body.length > 50000) throw bad('A note can hold up to 50,000 characters');
    return { title, body };
  }
  function create(userId, l, input) {
    const { title, body } = clean(input);
    const r = db.run('INSERT INTO learning_notes(user_id, lang, note_date, title, body, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', userId, lang(l), checkDate(input.date), title, body, now(), now());
    return view(db.get('SELECT * FROM learning_notes WHERE id = ?', Number(r.lastInsertRowid)));
  }
  /** mode: 'replace' (edit/rewrite) or 'append' (adds text below the existing note). */
  function update(userId, id, input) {
    const cur = own(userId, id);
    const mode = input.mode === 'append' ? 'append' : 'replace';
    const c = clean({ title: input.title ?? cur.title, body: input.body ?? '' });
    const body = mode === 'append' ? `${cur.body}${cur.body && c.body ? '\n\n' : ''}${c.body}` : (input.body === undefined ? cur.body : c.body);
    if (body.length > 50000) throw bad('A note can hold up to 50,000 characters');
    db.run('UPDATE learning_notes SET title = ?, body = ?, updated_at = ? WHERE id = ?', c.title, body, now(), id);
    return view(db.get('SELECT * FROM learning_notes WHERE id = ?', id));
  }
  function remove(userId, id) { own(userId, id); db.run('DELETE FROM learning_notes WHERE id = ? AND user_id = ?', id, userId); }
  return { month, year, byDate, countOn, search, recent, create, update, remove, get: (u, id) => view(own(u, id)) };
}
