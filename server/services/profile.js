import { bad, parseJSON, j, isValidTimeZone } from '../util.js';
import { lotusStage } from './mastery.js';

const AVATAR_RE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/;

export function createProfileService({ db, clock, meta, vocabulary, library, learning, stats, collections }) {
  function get(userId) {
    const r = db.get('SELECT p.*, u.email, u.role, u.created_at FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?', userId);
    if (!r) return null;
    return {
      userId: r.user_id, email: r.email, role: r.role, memberSince: r.created_at,
      displayName: r.display_name, bio: r.bio, avatar: r.avatar, level: r.proficiency_level, interfaceLanguage: r.interface_language,
      preferredTopics: parseJSON(r.preferred_topics, []), timezone: r.timezone, motion: r.motion,
      showTransliteration: !!r.show_transliteration, dailyGoal: r.daily_goal, onboarded: !!r.onboarded,
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
    if (input.level !== undefined) { if (!m.levels.has(input.level)) throw bad('Unknown level'); next.proficiency_level = input.level; }
    if (input.interfaceLanguage !== undefined) { if (!['en'].includes(input.interfaceLanguage)) throw bad('Only English is available as an interface language at the moment'); next.interface_language = input.interfaceLanguage; }
    if (input.preferredTopics !== undefined) {
      if (!Array.isArray(input.preferredTopics)) throw bad('preferredTopics must be a list');
      const valid = input.preferredTopics.filter((s) => m.topicsBySlug.has(s)).slice(0, 30);
      next.preferred_topics = j(valid);
    }
    if (input.timezone !== undefined) { if (!isValidTimeZone(input.timezone)) throw bad('Unknown time zone'); next.timezone = input.timezone; }
    if (input.motion !== undefined) { if (!['full', 'reduced', 'off'].includes(input.motion)) throw bad('Motion must be full, reduced or off'); next.motion = input.motion; }
    if (input.showTransliteration !== undefined) next.show_transliteration = input.showTransliteration ? 1 : 0;
    if (input.dailyGoal !== undefined) { const g = Number(input.dailyGoal); if (!Number.isInteger(g) || g < 1 || g > 500) throw bad('Daily goal must be between 1 and 500'); next.daily_goal = g; }
    if (input.onboarded !== undefined) next.onboarded = input.onboarded ? 1 : 0;
    db.run(`UPDATE user_profiles SET display_name=?, bio=?, proficiency_level=?, interface_language=?, preferred_topics=?, timezone=?, motion=?, show_transliteration=?, daily_goal=?, onboarded=?, updated_at=? WHERE user_id=?`,
      next.display_name, next.bio, next.proficiency_level, next.interface_language, next.preferred_topics, next.timezone, next.motion, next.show_transliteration, next.daily_goal, next.onboarded, clock.now().toISOString(), userId);
    return get(userId);
  }

  function setAvatar(userId, dataUrl) {
    if (dataUrl === null) { db.run('UPDATE user_profiles SET avatar = NULL WHERE user_id = ?', userId); return get(userId); }
    const m = String(dataUrl || '').match(AVATAR_RE);
    if (!m) throw bad('Profile picture must be a PNG, JPEG, WebP or GIF image');
    const bytes = Buffer.from(m[2], 'base64').length;
    if (bytes > 300 * 1024) throw bad('Profile picture must be smaller than 300 KB');
    db.run('UPDATE user_profiles SET avatar = ? WHERE user_id = ?', dataUrl, userId);
    return get(userId);
  }

  function home(userId) {
    const profile = get(userId);
    const raw = db.get('SELECT * FROM user_profiles WHERE user_id = ?', userId);
    const overview = stats.overview(userId);
    const cols = collections.list(userId).collections.slice(0, 8);
    const recentRewards = db.all(`SELECT r.reward_date, r.word_key, m.successful_days,
        (SELECT tamil FROM collection_words cw WHERE cw.user_id = r.user_id AND cw.word_key = r.word_key LIMIT 1) AS tamil,
        (SELECT english FROM collection_words cw WHERE cw.user_id = r.user_id AND cw.word_key = r.word_key LIMIT 1) AS english
      FROM lotus_rewards r JOIN word_mastery m ON m.user_id = r.user_id AND m.word_key = r.word_key
      WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 6`, userId)
      .map((r) => ({ date: r.reward_date, tamil: r.tamil, english: r.english, lotus: lotusStage(r.successful_days) }));
    return {
      profile,
      overview,
      daily: vocabulary.daily(userId, raw, 10),
      lists: vocabulary.lists({ level: profile.level }).slice(0, 4).concat(vocabulary.lists().filter((l) => l.level !== profile.level).slice(0, 2)),
      stories: library.listStories(userId, {}).items.slice(0, 5),
      videos: library.listVideos(userId, {}).slice(0, 4),
      reading: library.readingHistory(userId).filter((r) => !r.completedAt).slice(0, 3),
      collections: cols,
      activeSession: learning.active(userId),
      recentRewards,
    };
  }

  return { get, update, setAvatar, home };
}
