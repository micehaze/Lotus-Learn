import { validateNative, isLang, transliterateAny, LANGUAGES } from '../../shared/indic.js';
import { normalizeText } from '../../shared/tamil.js';
import { bad, notFound, conflict, parseJSON, j, sha256, slugify } from '../util.js';

/** Hierarchy shared by all four languages. Names describe the real structures (postpositions and case
 *  suffixes, no article system) rather than forcing English categories onto Dravidian grammar. */
export const GRAMMAR_TREE = [
  ['nouns', 'Nouns', [['number-plural', 'Number and plural'], ['gender', 'Gender and noun classes']]],
  ['pronouns', 'Pronouns', [['personal-pronouns', 'Personal pronouns and politeness']]],
  ['adjectives', 'Adjectives and adjectival forms', []],
  ['adverbs', 'Adverbs and adverbial forms', []],
  ['cases', 'Case suffixes and postpositions', [['dative', 'Dative case'], ['locative', 'Locative case'], ['accusative', 'Accusative case'], ['postpositions', 'Postpositions']]],
  ['determiners', 'Determiners and definiteness', []],
  ['verbs', 'Verbs', [['conjugation', 'Verb conjugation'], ['tense', 'Tense'], ['aspect', 'Aspect'], ['mood', 'Mood'], ['negation', 'Negation'], ['imperatives', 'Imperatives']]],
  ['agreement', 'Agreement (person, number, gender)', []],
  ['word-order', 'Word order', []],
  ['questions', 'Questions', []],
  ['sentences', 'Sentence structure', [['simple', 'Simple sentences'], ['compound', 'Compound sentences'], ['complex', 'Complex sentences'], ['conditionals', 'Conditional constructions'], ['relative-clauses', 'Relative (adjectival) clauses'], ['participles', 'Participles']]],
  ['copula', 'Being and having (copula & existence)', []],
  ['spoken-formal', 'Spoken versus formal grammar', []],
  ['exceptions', 'Common exceptions', []],
];

export function createGrammarService({ db, clock, meta }) {
  const now = () => clock.now().toISOString();

  function ensureCategories(lang) {
    db.tx(() => GRAMMAR_TREE.forEach(([slug, name, kids], i) => {
      db.run('INSERT OR IGNORE INTO grammar_categories(lang, slug, name, sort_order) VALUES (?,?,?,?)', lang, slug, name, i * 10);
      const pid = db.get('SELECT id FROM grammar_categories WHERE lang = ? AND slug = ?', lang, slug).id;
      kids.forEach(([ks, kn], k) => db.run('INSERT OR IGNORE INTO grammar_categories(lang, slug, name, parent_id, sort_order) VALUES (?,?,?,?,?)', lang, ks, kn, pid, i * 10 + k + 1));
    }));
  }

  function categories(lang, { includeEmpty = true } = {}) {
    const rows = db.all(`SELECT c.*, (SELECT COUNT(*) FROM grammar_lessons l WHERE l.category_id = c.id AND l.status = 'published') AS lessons
      FROM grammar_categories c WHERE c.lang = ? ORDER BY c.sort_order, c.id`, lang);
    const top = rows.filter((r) => !r.parent_id).map((r) => ({ id: r.id, slug: r.slug, name: r.name, lessons: r.lessons, children: [] }));
    const byId = new Map(top.map((t) => [t.id, t]));
    for (const r of rows.filter((x) => x.parent_id)) byId.get(r.parent_id)?.children.push({ id: r.id, slug: r.slug, name: r.name, lessons: r.lessons });
    for (const t of top) t.total = t.lessons + t.children.reduce((a, c) => a + c.lessons, 0);
    return includeEmpty ? top : top.filter((t) => t.total > 0);
  }

  function view(r, progress) {
    return {
      id: r.id, lang: r.lang, slug: r.slug, title: r.title, level: r.level, categoryId: r.category_id, category: r.category_name, parentCategory: r.parent_name || null,
      rule: r.rule, nuances: r.nuances, variations: parseJSON(r.variations, []), examples: parseJSON(r.examples, []), comparison: parseJSON(r.comparison, []),
      status: r.status, source: r.source, reviewStatus: r.review_status, validation: parseJSON(r.validation, {}), createdAt: r.created_at, publishedAt: r.published_at,
      progress: progress ? { bookmarked: !!progress.bookmarked, studiedAt: progress.studied_at, lastViewedAt: progress.last_viewed_at } : null,
    };
  }
  const SELECT = `SELECT l.*, c.name AS category_name, p.name AS parent_name FROM grammar_lessons l LEFT JOIN grammar_categories c ON c.id = l.category_id LEFT JOIN grammar_categories p ON p.id = c.parent_id`;

  function list(lang, { userId, category, level, q, status = 'published', bookmarked, studied, limit = 200 } = {}) {
    const where = ['l.lang = ?', 'l.status = ?']; const args = [lang, status];
    if (category) { where.push('(c.slug = ? OR p.slug = ?)'); args.push(category, category); }
    if (level) { where.push('l.level = ?'); args.push(level); }
    if (q) { where.push('(lower(l.title) LIKE ? OR lower(l.rule) LIKE ? OR l.examples LIKE ?)'); const like = `%${String(q).toLowerCase()}%`; args.push(like, like, `%${q}%`); }
    let rows = db.all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY COALESCE(l.published_at, l.created_at) DESC, l.id DESC LIMIT ?`, ...args, Math.min(500, limit));
    const prog = userId ? new Map(db.all('SELECT * FROM grammar_progress WHERE user_id = ?', userId).map((p) => [p.lesson_id, p])) : new Map();
    let items = rows.map((r) => view(r, prog.get(r.id)));
    if (bookmarked === 'true') items = items.filter((i) => i.progress?.bookmarked);
    if (studied === 'true') items = items.filter((i) => i.progress?.studiedAt);
    if (studied === 'false') items = items.filter((i) => !i.progress?.studiedAt);
    const studiedCount = userId ? db.get("SELECT COUNT(*) AS n FROM grammar_progress g JOIN grammar_lessons l ON l.id = g.lesson_id WHERE g.user_id = ? AND l.lang = ? AND g.studied_at IS NOT NULL", userId, lang).n : 0;
    const total = db.get("SELECT COUNT(*) AS n FROM grammar_lessons WHERE lang = ? AND status = 'published'", lang).n;
    return { items, total, studied: studiedCount };
  }

  function get(id, { userId, any = false } = {}) {
    const r = db.get(`${SELECT} WHERE l.id = ? ${any ? '' : "AND l.status = 'published'"}`, id);
    if (!r) throw notFound('Grammar lesson not found');
    if (userId && r.status === 'published') db.run('INSERT INTO grammar_progress(user_id, lesson_id, last_viewed_at) VALUES (?,?,?) ON CONFLICT(user_id, lesson_id) DO UPDATE SET last_viewed_at = excluded.last_viewed_at', userId, id, now());
    const prog = userId ? db.get('SELECT * FROM grammar_progress WHERE user_id = ? AND lesson_id = ?', userId, id) : null;
    const related = db.all("SELECT id, title, level FROM grammar_lessons WHERE category_id = ? AND id != ? AND status = 'published' ORDER BY level, title LIMIT 6", r.category_id, id);
    return { ...view(r, prog), related };
  }

  function setProgress(userId, id, { bookmarked, studied }) {
    get(id);
    const cur = db.get('SELECT * FROM grammar_progress WHERE user_id = ? AND lesson_id = ?', userId, id) || { bookmarked: 0, studied_at: null };
    const b = bookmarked === undefined ? cur.bookmarked : bookmarked ? 1 : 0;
    const s = studied === undefined ? cur.studied_at : studied ? (cur.studied_at || now()) : null;
    db.run('INSERT INTO grammar_progress(user_id, lesson_id, bookmarked, studied_at, last_viewed_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id, lesson_id) DO UPDATE SET bookmarked = excluded.bookmarked, studied_at = excluded.studied_at', userId, id, b, s, now());
    return { bookmarked: !!b, studiedAt: s };
  }

  function validate(input) {
    const problems = []; const warnings = [];
    const lang = input.lang;
    if (!isLang(lang)) problems.push('Unknown language');
    const title = String(input.title || '').trim();
    if (!title) problems.push('Title is required');
    const level = String(input.level || '').toUpperCase();
    if (!meta.snapshot().levels.has(level)) problems.push('Unknown level');
    let categoryId = null;
    if (isLang(lang)) {
      ensureCategories(lang);
      const c = db.get('SELECT id FROM grammar_categories WHERE lang = ? AND (id = ? OR slug = ?)', lang, Number(input.category_id ?? input.categoryId) || -1, String(input.category || ''));
      if (!c) problems.push('Choose an existing grammar category'); else categoryId = c.id;
    }
    const rule = String(input.rule || '').trim();
    if (rule.length < 20) problems.push('The rule needs a clear explanation (at least 20 characters)');
    const checkEx = (e, where) => {
      const native = String(e?.native || '').normalize('NFC').trim();
      const en = String(e?.en || e?.english || '').trim();
      if (!native || !en) { problems.push(`${where}: every example needs the sentence and an English translation`); return null; }
      const p = isLang(lang) ? validateNative(native, lang, { minRatio: 0.6 }) : [];
      if (p.length) { problems.push(`${where}: ${p.join(', ')}`); return null; }
      return { native, transliteration: transliterateAny(native), en, note: String(e.note || '').trim() };
    };
    const examples = (Array.isArray(input.examples) ? input.examples : []).map((e, i) => checkEx(e, `Example ${i + 1}`)).filter(Boolean);
    if (examples.length < 2) problems.push('A lesson needs at least two examples');
    const variations = (Array.isArray(input.variations) ? input.variations : []).map((v, i) => {
      const name = String(v?.name || '').trim();
      const exs = (Array.isArray(v?.examples) ? v.examples : []).map((e, k) => checkEx(e, `Variation ${i + 1} example ${k + 1}`)).filter(Boolean);
      if (!name) problems.push(`Variation ${i + 1} needs a name`);
      if (!exs.length) problems.push(`Variation "${name || i + 1}" needs at least one example`);
      return { name, description: String(v?.description || '').trim(), examples: exs };
    });
    const comparison = Array.isArray(input.comparison) ? input.comparison.filter((row) => Array.isArray(row)).slice(0, 20).map((row) => row.map((c) => String(c).slice(0, 120))) : [];
    return {
      problems, warnings,
      value: { lang, title: title.slice(0, 160), level, category_id: categoryId, rule: rule.slice(0, 3000), nuances: String(input.nuances || '').trim().slice(0, 3000), variations, examples, comparison,
        content_hash: sha256(`${lang}|${normalizeText(title)}|${normalizeText(rule)}`), slug: slugify(input.slug || title) },
    };
  }

  function create(input, { status = 'pending', source = 'editor', reviewStatus = 'editor', idempotencyKey = null, extraValidation = {} } = {}) {
    const { value, problems, warnings } = validate(input);
    if (problems.length) throw bad('Grammar lesson is invalid', { problems, warnings });
    if (db.get('SELECT id FROM grammar_lessons WHERE content_hash = ?', value.content_hash)) throw conflict('This grammar lesson already exists', { duplicate: true });
    if (db.get('SELECT id FROM grammar_lessons WHERE lang = ? AND lower(title) = lower(?)', value.lang, value.title)) throw conflict('A lesson with this title already exists for this language', { duplicate: true });
    let slug = value.slug;
    if (db.get('SELECT id FROM grammar_lessons WHERE lang = ? AND slug = ?', value.lang, slug)) slug = `${slug}-${value.content_hash.slice(0, 6)}`;
    const ts = now();
    const r = db.run(`INSERT INTO grammar_lessons(lang, category_id, slug, title, level, rule, nuances, variations, examples, comparison, status, source, review_status, validation, content_hash, idempotency_key, created_at, published_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, value.lang, value.category_id, slug, value.title, value.level, value.rule, value.nuances, j(value.variations), j(value.examples), j(value.comparison),
      status, source, reviewStatus, j({ warnings, ...extraValidation }), value.content_hash, idempotencyKey, ts, status === 'published' ? ts : null);
    return Number(r.lastInsertRowid);
  }
  function update(id, input) {
    const cur = get(id, { any: true });
    const merged = { lang: cur.lang, title: cur.title, level: cur.level, category_id: cur.categoryId, rule: cur.rule, nuances: cur.nuances, variations: cur.variations, examples: cur.examples, comparison: cur.comparison, ...input };
    const { value, problems, warnings } = validate(merged);
    if (problems.length) throw bad('Grammar lesson is invalid', { problems, warnings });
    if (db.get('SELECT id FROM grammar_lessons WHERE content_hash = ? AND id != ?', value.content_hash, id)) throw conflict('This grammar lesson already exists', { duplicate: true });
    db.run('UPDATE grammar_lessons SET category_id=?, title=?, level=?, rule=?, nuances=?, variations=?, examples=?, comparison=?, content_hash=?, validation=? WHERE id=?',
      value.category_id, value.title, value.level, value.rule, value.nuances, j(value.variations), j(value.examples), j(value.comparison), value.content_hash, j({ ...cur.validation, warnings }), id);
  }
  function setStatus(id, status, reviewStatus) {
    if (!db.run("UPDATE grammar_lessons SET status = ?, review_status = COALESCE(?, review_status), published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END WHERE id = ?", status, reviewStatus || null, status, now(), id).changes) throw notFound('Grammar lesson not found');
  }
  function remove(id) { if (!db.run('DELETE FROM grammar_lessons WHERE id = ?', id).changes) throw notFound('Grammar lesson not found'); }
  const leafCategories = (lang) => { ensureCategories(lang); return db.all('SELECT c.slug, c.name, p.name AS parent FROM grammar_categories c LEFT JOIN grammar_categories p ON p.id = c.parent_id WHERE c.lang = ? ORDER BY c.sort_order', lang); };
  const titles = (lang) => db.all('SELECT title FROM grammar_lessons WHERE lang = ?', lang).map((r) => r.title);

  return { ensureCategories, categories, list, get, setProgress, validate, create, update, setStatus, remove, leafCategories, titles, languageName: (l) => LANGUAGES[l]?.name };
}
