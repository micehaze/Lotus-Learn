import { tokenize, normalizeText } from '../../shared/tamil.js';
import { validateNative, countSentences, NATIVE_RE, isLang } from '../../shared/indic.js';
const hasTamil = (t) => NATIVE_RE.test(String(t || ''));
export const MIN_STORY_SENTENCES = 20;
const WPM = { A1: 40, A2: 50, B1: 60, B2: 70, C1: 80, C2: 90 };
export const readingMinutes = (words, level) => Math.max(1, Math.ceil((words || 0) / (WPM[level] || 60)));
import { bad, notFound, conflict, parseJSON, j, sha256, slugify, clamp } from '../util.js';
import { STORY_CATEGORIES, VIDEO_CATEGORIES } from './meta.js';
import { parseYouTubeId } from '../integrations/index.js';

const SOURCE_TYPES = ['original', 'public-domain', 'open-license', 'ai-generated'];
const LEVELS_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Heuristic difficulty estimate for Tamil prose (used for validation and as AI fallback). */
export function assessDifficulty(paragraphs) {
  const text = paragraphs.map((p) => p.ta).join(' ');
  const sentences = text.split(/[.!?।]+/).map((s) => s.trim()).filter(Boolean);
  const words = tokenize(text).filter((t) => hasTamil(t));
  const avgSentence = sentences.length ? words.length / sentences.length : 0;
  const avgWord = words.length ? words.reduce((a, w) => a + [...w].length, 0) / words.length : 0;
  let idx = avgSentence <= 6 ? 0 : avgSentence <= 8 ? 1 : avgSentence <= 11 ? 2 : avgSentence <= 14 ? 3 : avgSentence <= 18 ? 4 : 5;
  if (avgWord > 9.5) idx = Math.min(5, idx + 1);
  return { suggestedLevel: LEVELS_ORDER[idx], words: words.length, sentences: sentences.length, avgSentenceLength: Math.round(avgSentence * 10) / 10, avgWordLength: Math.round(avgWord * 10) / 10 };
}

export function validateStoryInput(input, { levels }) {
  const problems = [];
  const warnings = [];
  const lang = input.lang || 'ta';
  if (!isLang(lang)) problems.push('Unknown language');
  const title = String(input.title || '').normalize('NFC').trim();
  if (!title) problems.push('Title is required');
  const paragraphs = (Array.isArray(input.paragraphs) ? input.paragraphs : []).map((p) => ({
    ta: String(p?.ta || '').normalize('NFC').trim(), en: String(p?.en || '').trim(),
  })).filter((p) => p.ta);
  if (!paragraphs.length) problems.push('At least one Tamil paragraph is required');
  paragraphs.forEach((p, i) => {
    const pr = validateNative(p.ta, lang, { minRatio: 0.7 });
    if (pr.length) problems.push(`Paragraph ${i + 1}: ${pr.join(', ')}`);
    if (!p.en) warnings.push(`Paragraph ${i + 1} has no English translation`);
    if (p.ta.length > 2000) problems.push(`Paragraph ${i + 1} is too long`);
  });
  const sentences = paragraphs.reduce((a, p) => a + countSentences(p.ta), 0);
  if (paragraphs.length && sentences < MIN_STORY_SENTENCES) problems.push(`A story needs at least ${MIN_STORY_SENTENCES} sentences in the target language (this one has ${sentences}).`);
  const level = String(input.level || '').toUpperCase();
  if (!levels.has(level)) problems.push('Unknown proficiency level');
  const category = STORY_CATEGORIES.includes(input.category) ? input.category : 'short-story';
  const sourceType = String(input.source_type || input.sourceType || '');
  if (!SOURCE_TYPES.includes(sourceType)) problems.push(`Source type must be one of: ${SOURCE_TYPES.join(', ')}`);
  const license = String(input.license || '').trim();
  const sourceNote = String(input.source_note || input.sourceNote || '').trim();
  if ((sourceType === 'public-domain' || sourceType === 'open-license') && (!license || !sourceNote)) problems.push('Public-domain and openly licensed texts need a licence and a source citation');
  const difficulty = paragraphs.length ? assessDifficulty(paragraphs) : null;
  if (difficulty && levels.has(level) && Math.abs(LEVELS_ORDER.indexOf(difficulty.suggestedLevel) - LEVELS_ORDER.indexOf(level)) >= 2)
    warnings.push(`Text statistics suggest ${difficulty.suggestedLevel}, but it is labelled ${level}`);
  return {
    problems, warnings,
    value: {
      lang, sentences,
      title: title.slice(0, 160), title_en: String(input.title_en || input.titleEn || '').trim().slice(0, 160), summary: String(input.summary || '').trim().slice(0, 500),
      level, category, register: ['spoken', 'formal', 'literary', 'common', 'colloquial'].includes(input.register) ? input.register : 'formal',
      paragraphs, source_type: sourceType, license: license.slice(0, 200), source_note: sourceNote.slice(0, 500), topic_id: input.topic_id || input.topicId || null,
      content_hash: sha256(paragraphs.map((p) => normalizeText(p.ta)).join('\n')), word_count: difficulty?.words || 0, difficulty,
    },
  };
}

function rowToStory(r, progress) {
  return {
    id: r.id, lang: r.lang || 'ta', slug: r.slug, title: r.title, titleEn: r.title_en, summary: r.summary, level: r.level, category: r.category, register: r.register,
    topicId: r.topic_id, topic: r.topic_name || null, sourceType: r.source_type, sourceNote: r.source_note, license: r.license, status: r.status,
    reviewStatus: r.review_status, wordCount: r.word_count, readingMinutes: readingMinutes(r.word_count, r.level), createdAt: r.created_at, publishedAt: r.published_at,
    validation: parseJSON(r.validation, {}),
    progress: progress ? { progress: progress.progress, lastParagraph: progress.last_paragraph, completedAt: progress.completed_at } : null,
  };
}

export function createLibraryService({ db, clock, meta, youtube }) {
  const now = () => clock.now().toISOString();

  // ------------------------------------------------------------------ stories
  function listStories(userId, { lang, level, category, topic, q, status = 'published', page = 1 } = {}) {
    const where = ['s.status = ?']; const args = [status];
    if (lang) { where.push('s.lang = ?'); args.push(lang); }
    if (level) { where.push('s.level = ?'); args.push(level); }
    if (category) { where.push('s.category = ?'); args.push(category); }
    if (topic) { where.push('t.slug = ?'); args.push(topic); }
    if (q) { where.push('(s.title LIKE ? OR lower(s.title_en) LIKE ?)'); args.push(`%${q}%`, `%${String(q).toLowerCase()}%`); }
    const size = 24; const p = Math.max(1, Number(page) || 1);
    const total = db.get(`SELECT COUNT(*) AS n FROM stories s LEFT JOIN topics t ON t.id = s.topic_id WHERE ${where.join(' AND ')}`, ...args).n;
    const rows = db.all(`SELECT s.*, t.name AS topic_name, rh.progress, rh.last_paragraph, rh.completed_at AS rh_completed
      FROM stories s LEFT JOIN topics t ON t.id = s.topic_id LEFT JOIN reading_history rh ON rh.story_id = s.id AND rh.user_id = ?
      WHERE ${where.join(' AND ')} ORDER BY COALESCE(s.published_at, s.created_at) DESC, s.id DESC LIMIT ? OFFSET ?`, userId || 0, ...args, size, (p - 1) * size);
    return { items: rows.map((r) => rowToStory(r, r.progress != null ? { progress: r.progress, last_paragraph: r.last_paragraph, completed_at: r.rh_completed } : null)), total, page: p, pages: Math.max(1, Math.ceil(total / size)) };
  }

  function getStory(id, userId, { any = false } = {}) {
    const r = db.get(`SELECT s.*, t.name AS topic_name FROM stories s LEFT JOIN topics t ON t.id = s.topic_id WHERE s.id = ? ${any ? '' : "AND s.status = 'published'"}`, id);
    if (!r) throw notFound('Story not found');
    const prog = userId ? db.get('SELECT * FROM reading_history WHERE user_id = ? AND story_id = ?', userId, id) : null;
    const paragraphs = parseJSON(r.paragraphs, []);
    return { ...rowToStory(r, prog), paragraphs, sentenceCount: paragraphs.reduce((a, p) => a + countSentences(p.ta), 0) };
  }

  function saveProgress(userId, id, { paragraph = 0, progress = 0 }) {
    const s = db.get("SELECT id, paragraphs FROM stories WHERE id = ? AND status = 'published'", id);
    if (!s) throw notFound('Story not found');
    const total = parseJSON(s.paragraphs, []).length;
    const pIdx = clamp(Number(paragraph) || 0, 0, Math.max(0, total - 1));
    const pct = clamp(Math.round(Number(progress) || 0), 0, 100);
    const ts = now();
    db.run(`INSERT INTO reading_history(user_id, story_id, progress, last_paragraph, completed_at, updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(user_id, story_id) DO UPDATE SET progress = MAX(progress, excluded.progress), last_paragraph = excluded.last_paragraph,
      completed_at = COALESCE(completed_at, excluded.completed_at), updated_at = excluded.updated_at`, userId, id, pct, pIdx, pct >= 100 ? ts : null, ts);
    return db.get('SELECT progress, last_paragraph AS lastParagraph, completed_at AS completedAt FROM reading_history WHERE user_id = ? AND story_id = ?', userId, id);
  }

  function readingHistory(userId, lang = 'ta') {
    return db.all(`SELECT s.id, s.title, s.title_en, s.level, rh.progress, rh.updated_at, rh.completed_at FROM reading_history rh JOIN stories s ON s.id = rh.story_id
      WHERE rh.user_id = ? AND s.lang = ? AND s.status = 'published' ORDER BY rh.updated_at DESC LIMIT 20`, userId, lang)
      .map((r) => ({ id: r.id, title: r.title, titleEn: r.title_en, level: r.level, progress: r.progress, updatedAt: r.updated_at, completedAt: r.completed_at }));
  }

  function createStory(input, { status = 'pending', reviewStatus = 'editor', idempotencyKey = null, extraValidation = {} } = {}) {
    const { value, problems, warnings } = validateStoryInput(input, meta.snapshot());
    if (problems.length) throw bad('Story is invalid', { problems, warnings });
    if (db.get('SELECT id FROM stories WHERE content_hash = ?', value.content_hash)) throw conflict('An identical story already exists', { duplicate: true });
    let slug = slugify(value.title_en || value.title);
    if (db.get('SELECT id FROM stories WHERE slug = ?', slug)) slug = `${slug}-${value.content_hash.slice(0, 6)}`;
    const ts = now();
    const r = db.run(`INSERT INTO stories(lang, slug, title, title_en, summary, level, topic_id, category, register, paragraphs, source_type, source_note, license, status, review_status, validation, content_hash, word_count, idempotency_key, created_at, published_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, value.lang, slug, value.title, value.title_en, value.summary, value.level, value.topic_id, value.category, value.register,
      j(value.paragraphs), value.source_type, value.source_note, value.license, status, reviewStatus, j({ warnings, difficulty: value.difficulty, ...extraValidation }),
      value.content_hash, value.word_count, idempotencyKey, ts, status === 'published' ? ts : null);
    return Number(r.lastInsertRowid);
  }

  function updateStory(id, input) {
    const cur = getStory(id, null, { any: true });
    const merged = { lang: cur.lang, title: cur.title, title_en: cur.titleEn, summary: cur.summary, level: cur.level, category: cur.category, register: cur.register, paragraphs: cur.paragraphs, source_type: cur.sourceType, license: cur.license, source_note: cur.sourceNote, topic_id: cur.topicId, ...input };
    const { value, problems, warnings } = validateStoryInput(merged, meta.snapshot());
    if (problems.length) throw bad('Story is invalid', { problems, warnings });
    if (db.get('SELECT id FROM stories WHERE content_hash = ? AND id != ?', value.content_hash, id)) throw conflict('An identical story already exists', { duplicate: true });
    db.run(`UPDATE stories SET title=?, title_en=?, summary=?, level=?, topic_id=?, category=?, register=?, paragraphs=?, source_type=?, source_note=?, license=?, validation=?, content_hash=?, word_count=? WHERE id=?`,
      value.title, value.title_en, value.summary, value.level, value.topic_id, value.category, value.register, j(value.paragraphs), value.source_type, value.source_note, value.license,
      j({ ...cur.validation, warnings, difficulty: value.difficulty }), value.content_hash, value.word_count, id);
  }
  function setStoryStatus(id, status, reviewStatus) {
    const r = db.run('UPDATE stories SET status = ?, review_status = COALESCE(?, review_status), published_at = CASE WHEN ? = \'published\' THEN COALESCE(published_at, ?) ELSE published_at END WHERE id = ?', status, reviewStatus || null, status, now(), id);
    if (!r.changes) throw notFound('Story not found');
  }
  function deleteStory(id) { if (!db.run('DELETE FROM stories WHERE id = ?', id).changes) throw notFound('Story not found'); }

  // ------------------------------------------------------------------ videos
  function rowToVideo(r) {
    return {
      id: r.id, lang: r.lang || 'ta', platform: r.platform, externalId: r.external_id, url: r.url || null, title: r.title, channel: r.channel, description: r.description, thumbnailUrl: r.thumbnail_url,
      level: r.level, topicId: r.topic_id, topic: r.topic_name || null, category: r.category, durationSeconds: r.duration_seconds, register: r.register, accent: r.accent,
      publishedAt: r.published_at, createdAt: r.created_at, status: r.status, source: r.source, hasTranscript: !!r.transcript, transcriptSource: r.transcript_source,
      validation: parseJSON(r.validation, {}), favorite: !!r.favorite, watched: !!r.watched,
      embedUrl: r.platform === 'youtube' ? `https://www.youtube-nocookie.com/embed/${r.external_id}` : null,
      watchUrl: r.platform === 'youtube' ? `https://www.youtube.com/watch?v=${r.external_id}` : r.url,
    };
  }
  function listVideos(userId, { lang, level, topic, category, favorite, watched, q, status = 'published' } = {}) {
    const where = ['v.status = ?']; const args = [status];
    if (lang) { where.push('v.lang = ?'); args.push(lang); }
    if (level) { where.push('v.level = ?'); args.push(level); }
    if (topic) { where.push('t.slug = ?'); args.push(topic); }
    if (category) { where.push('v.category = ?'); args.push(category); }
    if (favorite === 'true' || favorite === true) where.push('vu.favorite = 1');
    if (watched === 'true') where.push('vu.watched = 1');
    if (watched === 'false') where.push('COALESCE(vu.watched, 0) = 0');
    if (q) { where.push('lower(v.title) LIKE ?'); args.push(`%${String(q).toLowerCase()}%`); }
    return db.all(`SELECT v.*, t.name AS topic_name, vu.favorite, vu.watched FROM videos v LEFT JOIN topics t ON t.id = v.topic_id
      LEFT JOIN video_user vu ON vu.video_id = v.id AND vu.user_id = ? WHERE ${where.join(' AND ')} ORDER BY v.created_at DESC, v.id DESC LIMIT 200`, userId || 0, ...args).map(rowToVideo);
  }
  function getVideo(id, userId, { any = false } = {}) {
    const r = db.get(`SELECT v.*, t.name AS topic_name, vu.favorite, vu.watched FROM videos v LEFT JOIN topics t ON t.id = v.topic_id
      LEFT JOIN video_user vu ON vu.video_id = v.id AND vu.user_id = ? WHERE v.id = ? ${any ? '' : "AND v.status = 'published'"}`, userId || 0, id);
    if (!r) throw notFound('Video not found');
    return { ...rowToVideo(r), transcript: parseJSON(r.transcript, null) };
  }
  function setVideoState(userId, id, { favorite, watched }) {
    if (!db.get("SELECT id FROM videos WHERE id = ? AND status = 'published'", id)) throw notFound('Video not found');
    const cur = db.get('SELECT * FROM video_user WHERE user_id = ? AND video_id = ?', userId, id) || { favorite: 0, watched: 0, watched_at: null };
    const fav = favorite === undefined ? cur.favorite : favorite ? 1 : 0;
    const wat = watched === undefined ? cur.watched : watched ? 1 : 0;
    const ts = now();
    db.run(`INSERT INTO video_user(user_id, video_id, favorite, watched, watched_at, updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(user_id, video_id) DO UPDATE SET favorite = excluded.favorite, watched = excluded.watched, watched_at = excluded.watched_at, updated_at = excluded.updated_at`,
      userId, id, fav, wat, wat ? cur.watched_at || ts : null, ts);
    return { favorite: !!fav, watched: !!wat };
  }

  function validateVideoFields(input, m) {
    const problems = [];
    const out = {};
    if (input.title !== undefined) { out.title = String(input.title).trim().slice(0, 200); if (!out.title) problems.push('Title is required'); }
    if (input.level !== undefined) { out.level = input.level ? String(input.level).toUpperCase() : null; if (out.level && !m.levels.has(out.level)) problems.push('Unknown level'); }
    if (input.category !== undefined) { out.category = input.category; if (!VIDEO_CATEGORIES.includes(out.category)) problems.push('Unknown category'); }
    if (input.topic_id !== undefined || input.topicId !== undefined) { const t = Number(input.topic_id ?? input.topicId) || null; if (t && !m.topicsById.has(t)) problems.push('Unknown topic'); out.topic_id = t; }
    if (input.register !== undefined) out.register = ['spoken', 'formal', 'literary', 'common', 'colloquial', 'mixed'].includes(input.register) ? input.register : 'spoken';
    if (input.accent !== undefined) out.accent = String(input.accent).slice(0, 80);
    if (input.description !== undefined) out.description = String(input.description).slice(0, 2000);
    if (input.duration_seconds !== undefined || input.durationSeconds !== undefined) out.duration_seconds = Math.max(0, Math.round(Number(input.duration_seconds ?? input.durationSeconds) || 0));
    if (input.transcript !== undefined) {
      if (input.transcript === null || input.transcript === '') out.transcript = null;
      else {
        const lines = Array.isArray(input.transcript) ? input.transcript : String(input.transcript).split('\n').map((ta) => ({ ta }));
        const clean = lines.map((l) => ({ start: Number(l.start) || null, ta: String(l.ta || '').trim(), en: String(l.en || '').trim() })).filter((l) => l.ta);
        if (clean.some((l) => !hasTamil(l.ta))) problems.push('Transcript lines must contain Tamil text');
        out.transcript = j(clean);
        if (!String(input.transcript_source || input.transcriptSource || '').trim()) problems.push('Give the source/authorisation for the transcript');
      }
    }
    if (input.transcript_source !== undefined || input.transcriptSource !== undefined) out.transcript_source = String(input.transcript_source ?? input.transcriptSource).slice(0, 300);
    return { out, problems };
  }

  async function addVideo(input, { status = 'pending', source = 'admin', lang } = {}) {
    const L = lang || input.lang || 'ta';
    if (!isLang(L)) throw bad('Unknown language');
    let externalId = parseYouTubeId(input.url || input.externalId);
    let platform = 'youtube'; let link = null;
    if (!externalId) {
      let u; try { u = new URL(String(input.url || '')); } catch { u = null; }
      if (!u || !/^https?:$/.test(u.protocol)) throw bad('Enter a valid YouTube link, video ID, or https link to a legally accessible video page');
      u.hash = ''; link = u.toString(); platform = 'link'; externalId = sha256(link).slice(0, 24);
      if (!input.title) throw bad('Give a title for external video links');
    }
    if (db.get('SELECT id FROM videos WHERE platform = ? AND external_id = ?', platform, externalId)) throw conflict('This video is already in the library', { duplicate: true });
    let metaInfo = null;
    if (!input.title && platform === 'youtube') metaInfo = (youtube.configured ? (await youtube.details([externalId]).catch(() => []))[0] : null) || (await youtube.oembed(externalId));
    const fields = { title: input.title || metaInfo?.title || '', ...input };
    const { out, problems } = validateVideoFields(fields, meta.snapshot());
    if (!out.title) problems.push('Title is required (metadata could not be fetched automatically)');
    if (problems.length) throw bad('Video is invalid', { problems });
    const ts = now();
    const r = db.run(`INSERT INTO videos(lang, platform, external_id, url, title, channel, description, thumbnail_url, level, topic_id, category, duration_seconds, register, accent, published_at, transcript, transcript_source, status, source, validation, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, L, platform, externalId, link, out.title, String(input.channel || metaInfo?.channel || '').slice(0, 120), out.description || metaInfo?.description || '',
      platform === 'youtube' ? (metaInfo?.thumbnailUrl || `https://i.ytimg.com/vi/${externalId}/mqdefault.jpg`) : '', out.level || null, out.topic_id || null, out.category || 'educational',
      out.duration_seconds || metaInfo?.durationSeconds || 0, out.register || 'spoken', out.accent || '', input.publishedAt || metaInfo?.publishedAt || null,
      out.transcript || null, out.transcript_source || '', status, source, j(input.validation || {}), ts);
    return Number(r.lastInsertRowid);
  }
  function updateVideo(id, input) {
    getVideo(id, null, { any: true });
    const { out, problems } = validateVideoFields(input, meta.snapshot());
    if (problems.length) throw bad('Video is invalid', { problems });
    const keys = Object.keys(out);
    if (!keys.length) return;
    db.run(`UPDATE videos SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => out[k]), id);
  }
  function setVideoStatus(id, status) { if (!db.run('UPDATE videos SET status = ? WHERE id = ?', status, id).changes) throw notFound('Video not found'); }
  function deleteVideo(id) { if (!db.run('DELETE FROM videos WHERE id = ?', id).changes) throw notFound('Video not found'); }

  /** Published stories below the minimum length are moved back to review (never deleted). */
  function enforceStoryMinimum() {
    let moved = 0;
    for (const r of db.all("SELECT id, paragraphs, validation FROM stories WHERE status = 'published'")) {
      const n = parseJSON(r.paragraphs, []).reduce((a, p) => a + countSentences(p.ta), 0);
      if (n < MIN_STORY_SENTENCES) {
        db.run("UPDATE stories SET status = 'pending', validation = ? WHERE id = ?", j({ ...parseJSON(r.validation, {}), lengthHold: `Held for review: ${n} sentences, minimum is ${MIN_STORY_SENTENCES}` }), r.id);
        moved++;
      }
    }
    return moved;
  }

  return { enforceStoryMinimum, listStories, getStory, saveProgress, readingHistory, createStory, updateStory, setStoryStatus, deleteStory, listVideos, getVideo, setVideoState, addVideo, updateVideo, setVideoStatus, deleteVideo };
}
