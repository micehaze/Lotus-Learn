import { bad, parseJSON, j, isValidTimeZone } from '../util.js';
import { lotusStage } from './mastery.js';
import { isLang, LANGUAGES, LANG_CODES } from '../../shared/indic.js';

const AVATAR_RE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/;
const LANG_FIELDS = ['level', 'preferredTopics', 'showTransliteration', 'dailyGoal', 'onboarded'];

export function createProfileService({ db, clock, meta, vocabulary, library, learning, stats, collections, grammar, dailyTopics, notes }) {
  const now = () => clock.now().toISOString();

  /** Every language keeps its own level, topics, goal, transliteration preference and onboarding state. */
  function ensureLangProfile(userId, lang) {
    db.run('INSERT OR IGNORE INTO user_language_profiles(user_id, lang, created_at, updated_at) VALUES (?,?,?,?)', userId, lang, now(), now());
    return db.get('SELECT * FROM user_language_profiles WHERE user_id = ? AND lang = ?', userId, lang);
  }
  const viewLang = (r) => ({ level: r.proficiency_level, preferredTopics: parseJSON(r.preferred_topics, []), dailyGoal: r.daily_goal, showTransliteration: !!r.show_transliteration, onboarded: !!r.onboarded, started: true });

  function activeLang(userId) {
    return db.get('SELECT active_language FROM user_profiles WHERE user_id = ?', userId)?.active_language || 'ta';
  }

  function get(userId) {
    const r = db.get('SELECT p.*, u.email, u.role, u.created_at FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?', userId);
    if (!r) return null;
    const active = r.active_language || 'ta';
    ensureLangProfile(userId, active);
    const rows = db.all('SELECT * FROM user_language_profiles WHERE user_id = ?', userId);
    const languages = Object.fromEntries(LANG_CODES.map((c) => [c, { level: 'A1', preferredTopics: [], dailyGoal: 20, showTransliteration: true, onboarded: false, started: false }]));
    for (const row of rows) languages[row.lang] = viewLang(row);
    const cur = languages[active];
    return {
      userId: r.user_id, email: r.email, role: r.role, memberSince: r.created_at,
      displayName: r.display_name, bio: r.bio, avatar: r.avatar, interfaceLanguage: r.interface_language, timezone: r.timezone, motion: r.motion,
      activeLanguage: active, activeLanguageName: LANGUAGES[active].name,
      level: cur.level, preferredTopics: cur.preferredTopics, showTransliteration: cur.showTransliteration, dailyGoal: cur.dailyGoal, onboarded: cur.onboarded,
      languages,
    };
  }

  function update(userId, input) {
    const cur = db.get('SELECT * FROM user_profiles WHERE user_id = ?', userId);
    const m = meta.snapshot();
    const next = { ...cur };
    if (input.displayName !== undefined) {
      const n = String(input.displayName).trim();
      if (!n || n.length > 60) throw bad('Display name must be 1–60 characters');
      next.display_name = n;
    }
    if (input.bio !== undefined) next.bio = String(input.bio).slice(0, 400);
    if (input.interfaceLanguage !== undefined) { if (!['en'].includes(input.interfaceLanguage)) throw bad('Only English is available as an interface language at the moment'); next.interface_language = input.interfaceLanguage; }
    if (input.timezone !== undefined) { if (!isValidTimeZone(input.timezone)) throw bad('Unknown time zone'); next.timezone = input.timezone; }
    if (input.motion !== undefined) { if (!['full', 'reduced', 'off'].includes(input.motion)) throw bad('Motion must be full, reduced or off'); next.motion = input.motion; }
    if (input.activeLanguage !== undefined) { if (!isLang(input.activeLanguage)) throw bad('Unknown learning language'); next.active_language = input.activeLanguage; }
    // language-scoped fields go to the language named in the request, else the active language
    const lang = input.lang || next.active_language || 'ta';
    if (!isLang(lang)) throw bad('Unknown learning language');
    const lp = { ...ensureLangProfile(userId, lang) };
    if (input.level !== undefined) { if (!m.levels.has(input.level)) throw bad('Unknown level'); lp.proficiency_level = input.level; }
    if (input.preferredTopics !== undefined) {
      if (!Array.isArray(input.preferredTopics)) throw bad('preferredTopics must be a list');
      lp.preferred_topics = j(input.preferredTopics.filter((s) => m.topicsBySlug.has(s)).slice(0, 30));
    }
    if (input.showTransliteration !== undefined) lp.show_transliteration = input.showTransliteration ? 1 : 0;
    if (input.dailyGoal !== undefined) { const g = Number(input.dailyGoal); if (!Number.isInteger(g) || g < 1 || g > 500) throw bad('Daily goal must be between 1 and 500'); lp.daily_goal = g; }
    if (input.onboarded !== undefined) lp.onboarded = input.onboarded ? 1 : 0;
    db.tx(() => {
      db.run(`UPDATE user_profiles SET display_name=?, bio=?, interface_language=?, timezone=?, motion=?, active_language=?, updated_at=? WHERE user_id=?`,
        next.display_name, next.bio, next.interface_language, next.timezone, next.motion, next.active_language || 'ta', now(), userId);
      db.run('UPDATE user_language_profiles SET proficiency_level=?, preferred_topics=?, show_transliteration=?, daily_goal=?, onboarded=?, updated_at=? WHERE user_id=? AND lang=?',
        lp.proficiency_level, lp.preferred_topics, lp.show_transliteration, lp.daily_goal, lp.onboarded, now(), userId, lang);
      if (lang === 'ta') // keep the legacy Tamil columns in step for older tooling
        db.run('UPDATE user_profiles SET proficiency_level=?, preferred_topics=?, show_transliteration=?, daily_goal=?, onboarded=? WHERE user_id=?', lp.proficiency_level, lp.preferred_topics, lp.show_transliteration, lp.daily_goal, lp.onboarded, userId);
    });
    if (input.activeLanguage !== undefined) ensureLangProfile(userId, input.activeLanguage);
    return get(userId);
  }

  function setAvatar(userId, dataUrl) {
    if (dataUrl === null) { db.run('UPDATE user_profiles SET avatar = NULL WHERE user_id = ?', userId); return get(userId); }
    const m = String(dataUrl || '').match(AVATAR_RE);
    if (!m) throw bad('Profile picture must be a PNG, JPEG, WebP or GIF image');
    if (Buffer.from(m[2], 'base64').length > 300 * 1024) throw bad('Profile picture must be smaller than 300 KB');
    db.run('UPDATE user_profiles SET avatar = ? WHERE user_id = ?', dataUrl, userId);
    return get(userId);
  }

  /** Language-profile row in the legacy shape expected by vocabulary.daily(). */
  function legacyRow(userId, lang) {
    const p = db.get('SELECT timezone FROM user_profiles WHERE user_id = ?', userId);
    const lp = ensureLangProfile(userId, lang);
    return { timezone: p?.timezone || 'UTC', proficiency_level: lp.proficiency_level, preferred_topics: lp.preferred_topics };
  }

  function home(userId, langArg) {
    const profile = get(userId);
    const lang = langArg || profile.activeLanguage;
    const lp = profile.languages[lang];
    const overview = stats.overview(userId, lang);
    const recentRewards = db.all(`SELECT r.reward_date, r.word_key, m.successful_days,
        (SELECT tamil FROM collection_words cw WHERE cw.user_id = r.user_id AND cw.word_key = r.word_key LIMIT 1) AS tamil,
        (SELECT english FROM collection_words cw WHERE cw.user_id = r.user_id AND cw.word_key = r.word_key LIMIT 1) AS english
      FROM lotus_rewards r JOIN word_mastery m ON m.user_id = r.user_id AND m.word_key = r.word_key
      WHERE r.user_id = ? AND r.lang = ? ORDER BY r.created_at DESC LIMIT 6`, userId, lang)
      .map((r) => ({ date: r.reward_date, tamil: r.tamil, english: r.english, lotus: lotusStage(r.successful_days) }));
    return {
      lang, profile,
      overview,
      dailyTopic: dailyTopics.today(lang, { level: lp.level, limit: 12 }),
      daily: vocabulary.daily(userId, legacyRow(userId, lang), 10, lang),
      lists: vocabulary.lists({ lang, level: lp.level }).slice(0, 4).concat(vocabulary.lists({ lang }).filter((l) => l.level !== lp.level).slice(0, 2)),
      stories: library.listStories(userId, { lang }).items.slice(0, 5),
      videos: library.listVideos(userId, { lang }).slice(0, 4),
      grammar: grammar.list(lang, { userId, limit: 4 }).items,
      notesToday: notes.countOn(userId, lang, overview.today),
      reading: library.readingHistory(userId, lang).filter((r) => !r.completedAt).slice(0, 3),
      collections: collections.list(userId, '', lang).collections.slice(0, 8),
      activeSession: learning.active(userId, lang),
      recentRewards,
    };
  }

  return { get, update, setAvatar, home, activeLang, ensureLangProfile, legacyRow };
}
