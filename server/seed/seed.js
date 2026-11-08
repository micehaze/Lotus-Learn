import { LEVELS, TOPICS, VOCABULARY, LISTS, STORIES } from './data.js';
import { slugify } from '../util.js';
import { normKey } from '../services/vocabulary.js';

export const DEMO = {
  learner: { email: 'demo@lotuslearn.local', password: 'lotus-demo-2026', name: 'Kavya (demo)' },
  admin: { email: 'admin@lotuslearn.local', password: 'lotus-admin-2026', name: 'Content admin (demo)' },
};

/** Safe to run repeatedly: every insert is guarded by a uniqueness check. */
export async function seed(app, { demoUsers = true, log = () => {} } = {}) {
  const { db, services, clock } = app;
  const now = clock.now().toISOString();
  db.tx(() => {
    LEVELS.forEach(([code, name, description], i) => db.run('INSERT OR IGNORE INTO levels(code, name, description, sort_order) VALUES (?,?,?,?)', code, name, description, i));
    TOPICS.forEach((name, i) => db.run('INSERT OR IGNORE INTO topics(slug, name, sort_order) VALUES (?,?,?)', slugify(name), name, i));
  });
  services.meta.invalidate();

  let words = 0;
  for (const v of VOCABULARY) {
    if (db.get('SELECT id FROM vocabulary WHERE norm_key = ?', normKey(v.tamil, v.english))) continue;
    services.vocabulary.create(v, { status: 'published', source: 'seed', reviewStatus: 'editor' });
    words++;
  }
  const byTamil = new Map(db.all('SELECT id, tamil FROM vocabulary').map((r) => [r.tamil, r.id]));
  for (const l of LISTS) {
    if (db.get('SELECT id FROM vocabulary_lists WHERE title = ?', l.title)) continue;
    const topic = db.get('SELECT id FROM topics WHERE slug = ?', l.topic);
    const r = db.run('INSERT INTO vocabulary_lists(title, description, level, topic_id, status, source, created_at) VALUES (?,?,?,?,?,?,?)', l.title, l.description, l.level, topic?.id || null, 'published', 'seed', now);
    l.words.forEach((t, i) => { const id = byTamil.get(t); if (id) db.run('INSERT OR IGNORE INTO vocabulary_list_items(list_id, vocabulary_id, position) VALUES (?,?,?)', Number(r.lastInsertRowid), id, i); });
  }
  let stories = 0;
  for (const s of STORIES) {
    if (db.get('SELECT id FROM stories WHERE title = ?', s.title)) continue;
    const topic = db.get('SELECT id FROM topics WHERE slug = ?', s.topic);
    services.library.createStory({ ...s, topic_id: topic?.id || null, source_type: 'original', source_note: 'Original story written for Lotus Learn (editorial seed; native-speaker review recommended)', license: 'Original work' }, { status: 'published', reviewStatus: 'editor' });
    stories++;
  }
  log(`Seed: ${words} new words, ${stories} new stories.`);

  if (demoUsers) {
    for (const [kind, d] of Object.entries(DEMO)) {
      if (db.get('SELECT id FROM users WHERE email = ?', d.email)) continue;
      const id = await services.auth.register({ email: d.email, password: d.password, displayName: d.name });
      if (kind === 'admin') db.run("UPDATE users SET role = 'admin' WHERE id = ?", id);
      services.profile.update(id, { onboarded: true, level: 'A1', preferredTopics: ['nature', 'food-and-cooking', 'family'] });
      if (kind === 'learner') {
        const c1 = services.collections.create(id, { title: 'My first words', description: 'Home, family and food' });
        services.collections.addFromLibrary(id, c1, ['வீடு', 'அம்மா', 'அப்பா', 'தண்ணீர்', 'சாப்பாடு', 'நண்பன்'].map((t) => byTamil.get(t)).filter(Boolean));
        const c2 = services.collections.create(id, { title: 'Tropical garden', description: 'Nature words from the lotus pond' });
        services.collections.addFromLibrary(id, c2, ['பூ', 'மரம்', 'தாமரை', 'தென்னை', 'மழை', 'கடல்'].map((t) => byTamil.get(t)).filter(Boolean));
        const c3 = services.collections.create(id, { title: 'Everyday verbs', description: 'Eat, drink, go, come' });
        services.collections.addFromLibrary(id, c3, ['சாப்பிடு', 'குடி', 'போ', 'வா', 'பேசு'].map((t) => byTamil.get(t)).filter(Boolean));
      }
      log(`Demo ${kind}: ${d.email} / ${d.password}`);
    }
  }
}
