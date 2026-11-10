import { bad, notFound, conflict, parseJSON, j, slugify } from '../util.js';

export const DEFAULT_SETTINGS = {
  collection_word_limit: 1000,
  daily_vocab_lists: 1,
  daily_videos_min: 3,
  daily_videos_max: 5,
  daily_stories_min: 3,
  daily_stories_max: 5,
  daily_grammar_min: 3,
  daily_grammar_max: 5,
  daily_topic_words_min: 60,
  daily_topic_words_max: 80,
  catchup_days: 7,
  list_min_words: 40,
  auto_publish_videos: false,
  auto_publish_validated: false,
  auto_publish_topic_words: true,
  show_ai_enrichment: true,
  vocab_list_min_words: 40,
  automation_enabled: true,
};
export const SESSION_MAX_WORDS = 50;
export const CORRECT_PER_WORD = 10;
export const STORY_CATEGORIES = ['short-story', 'everyday', 'dialogue', 'fairy-tale', 'folklore', 'historical', 'romance', 'adventure', 'mystery', 'science-fiction', 'cultural', 'news-style', 'educational', 'literary-excerpt'];
export const VIDEO_CATEGORIES = ['conversation', 'interview', 'podcast', 'cooking', 'travel', 'news', 'entertainment', 'educational', 'music', 'documentary', 'short-story', 'street-interview', 'children', 'cultural'];

export function createMetaService({ db }) {
  let snap = null;
  const invalidate = () => { snap = null; };

  function snapshot() {
    if (!snap) {
      const levels = db.all('SELECT * FROM levels ORDER BY sort_order, code');
      const topics = db.all('SELECT * FROM topics ORDER BY sort_order, name');
      snap = {
        levelsList: levels,
        levels: new Set(levels.map((l) => l.code)),
        topics,
        topicsById: new Map(topics.map((t) => [t.id, t])),
        topicsBySlug: new Map(topics.map((t) => [t.slug, t])),
      };
    }
    return snap;
  }
  const levelOrder = () => snapshot().levelsList.map((l) => l.code);

  function getSettings() {
    const rows = db.all('SELECT key, value FROM app_settings');
    const out = { ...DEFAULT_SETTINGS };
    for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = parseJSON(r.value, DEFAULT_SETTINGS[r.key]);
    return out;
  }
  function updateSettings(patch) {
    const cur = getSettings();
    const next = { ...cur };
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      if (typeof DEFAULT_SETTINGS[k] === 'boolean') next[k] = !!v;
      else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 100000) throw bad(`Setting ${k} must be a whole number`);
        next[k] = n;
      }
    }
    if (next.collection_word_limit < 1) throw bad('Collection limit must be at least 1');
    if (next.daily_videos_min > next.daily_videos_max) throw bad('Minimum daily videos cannot exceed the maximum');
    if (next.daily_stories_min > next.daily_stories_max) throw bad('Minimum daily stories cannot exceed the maximum');
    if (next.daily_grammar_min > next.daily_grammar_max) throw bad('Minimum daily grammar lessons cannot exceed the maximum');
    if (next.daily_topic_words_min > next.daily_topic_words_max) throw bad('Minimum daily topic words cannot exceed the maximum');
    if (next.catchup_days < 1 || next.catchup_days > 31) throw bad('Catch-up window must be 1–31 days');
    db.tx(() => { for (const [k, v] of Object.entries(next)) db.run('INSERT INTO app_settings(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, j(v)); });
    return next;
  }

  // ---------------- levels
  function updateLevel(code, { name, description, sort_order }) {
    const cur = db.get('SELECT * FROM levels WHERE code = ?', code);
    if (!cur) throw notFound('Level not found');
    db.run('UPDATE levels SET name = ?, description = ?, sort_order = ? WHERE code = ?',
      String(name ?? cur.name).trim().slice(0, 60) || cur.name, String(description ?? cur.description).slice(0, 400), Number(sort_order ?? cur.sort_order), code);
    invalidate();
  }
  function createLevel({ code, name, description = '', sort_order = 99 }) {
    const c = String(code || '').toUpperCase().trim();
    if (!/^[A-Z0-9]{1,6}$/.test(c)) throw bad('Level code must be 1–6 letters/digits');
    if (db.get('SELECT code FROM levels WHERE code = ?', c)) throw conflict('Level already exists');
    db.run('INSERT INTO levels(code, name, description, sort_order) VALUES (?,?,?,?)', c, String(name || c).slice(0, 60), String(description).slice(0, 400), Number(sort_order) || 99);
    invalidate();
  }

  // ---------------- topics
  function createTopic({ name, parent_id = null, slug }) {
    const n = String(name || '').trim().slice(0, 60);
    if (!n) throw bad('Topic name is required');
    const s = slugify(slug || n);
    if (db.get('SELECT id FROM topics WHERE slug = ?', s)) throw conflict('A topic with this name already exists');
    if (parent_id && !db.get('SELECT id FROM topics WHERE id = ?', parent_id)) throw bad('Parent topic not found');
    const r = db.run('INSERT INTO topics(slug, name, parent_id, sort_order) VALUES (?,?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM topics))', s, n, parent_id || null);
    invalidate();
    return Number(r.lastInsertRowid);
  }
  function updateTopic(id, { name, parent_id }) {
    const cur = db.get('SELECT * FROM topics WHERE id = ?', id);
    if (!cur) throw notFound('Topic not found');
    if (parent_id && Number(parent_id) === Number(id)) throw bad('A topic cannot be its own parent');
    db.run('UPDATE topics SET name = ?, parent_id = ? WHERE id = ?', String(name ?? cur.name).trim().slice(0, 60) || cur.name, parent_id === undefined ? cur.parent_id : parent_id || null, id);
    invalidate();
  }
  function deleteTopic(id) {
    const r = db.run('DELETE FROM topics WHERE id = ?', id);
    if (!r.changes) throw notFound('Topic not found');
    invalidate();
  }

  function publicMeta() {
    const s = snapshot();
    return {
      levels: s.levelsList.map((l) => ({ code: l.code, name: l.name, description: l.description })),
      topics: s.topics.map((t) => ({ id: t.id, slug: t.slug, name: t.name, parentId: t.parent_id })),
    };
  }

  return { snapshot, levelOrder, invalidate, getSettings, updateSettings, updateLevel, createLevel, createTopic, updateTopic, deleteTopic, publicMeta };
}
