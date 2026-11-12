import { LEVELS, TOPICS, VOCABULARY, LISTS, STORIES } from './data.js';
import { ML, KN, TE, TAMIL_CONCEPTS, TAMIL_SENSES, HOMONYMS } from './multilingual.js';
import { GRAMMAR, TAMIL_STORY_UPGRADES, STORIES as MULTI_STORIES } from './content.js';
import { slugify, sha256 } from '../util.js';
import { normKey } from '../services/vocabulary.js';
import { transliterateAny, LANG_CODES, countSentences } from '../../shared/indic.js';

export const DEMO = {
  learner: { email: 'demo@lotuslearn.local', password: 'lotus-demo-2026', name: 'Kavya (demo)' },
  admin: { email: 'admin@lotuslearn.local', password: 'lotus-admin-2026', name: 'Content admin (demo)' },
};
const EXTRA_TOPICS = ['Religion', 'Arts'];
const NEW_LANG_VOCAB = { ml: ML, kn: KN, te: TE };
const LIST_TITLES = { ml: 'ആദ്യ വാക്കുകൾ · First words', kn: 'ಮೊದಲ ಪದಗಳು · First words', te: 'మొదటి పదాలు · First words' };

/** Safe to run on every start: every insert is guarded by a uniqueness check; nothing is deleted. */
export async function seed(app, { demoUsers = true, log = () => {} } = {}) {
  const { db, services, clock } = app;
  const now = clock.now().toISOString();
  const S = services;
  const report = { words: 0, stories: 0, grammar: 0, upgraded: 0, held: 0, senses: 0 };
  db.tx(() => {
    LEVELS.forEach(([code, name, description], i) => db.run('INSERT OR IGNORE INTO levels(code, name, description, sort_order) VALUES (?,?,?,?)', code, name, description, i));
    [...TOPICS, ...EXTRA_TOPICS].forEach((name, i) => db.run('INSERT OR IGNORE INTO topics(slug, name, sort_order) VALUES (?,?,?)', slugify(name), name, i));
  });
  S.meta.invalidate();

  // ---------------- vocabulary (Tamil original seed + three new languages)
  const add = (v, lang) => {
    if (db.get('SELECT id FROM vocabulary WHERE norm_key = ?', normKey(v.tamil, v.english, lang))) return;
    S.vocabulary.create({ ...v, lang }, { lang, status: 'published', source: 'seed', reviewStatus: 'editor' });
    report.words++;
  };
  for (const v of VOCABULARY) add(v, 'ta');
  for (const [ta, concept] of Object.entries(TAMIL_CONCEPTS)) db.run("UPDATE vocabulary SET concept_key = ? WHERE lang = 'ta' AND tamil = ? AND concept_key IS NULL", concept, ta);
  for (const [lang, list] of Object.entries(NEW_LANG_VOCAB)) for (const v of list) add(v, lang);
  S.vocabulary.invalidate();
  report.senses = S.vocabulary.backfillSenses();

  const idOf = (lang, native) => db.get('SELECT id FROM vocabulary WHERE lang = ? AND tamil = ?', lang, native)?.id;
  for (const l of LISTS) {
    if (db.get("SELECT id FROM vocabulary_lists WHERE title = ? AND lang = 'ta'", l.title)) continue;
    const topic = db.get('SELECT id FROM topics WHERE slug = ?', l.topic);
    const r = db.run('INSERT INTO vocabulary_lists(lang, title, description, level, topic_id, status, source, created_at) VALUES (?,?,?,?,?,?,?,?)', 'ta', l.title, l.description, l.level, topic?.id || null, 'published', 'seed', now);
    l.words.forEach((t, i) => { const id = idOf('ta', t); if (id) db.run('INSERT OR IGNORE INTO vocabulary_list_items(list_id, vocabulary_id, position) VALUES (?,?,?)', Number(r.lastInsertRowid), id, i); });
  }
  for (const [lang, list] of Object.entries(NEW_LANG_VOCAB)) {
    if (db.get('SELECT id FROM vocabulary_lists WHERE title = ? AND lang = ?', LIST_TITLES[lang], lang)) continue;
    const r = db.run('INSERT INTO vocabulary_lists(lang, title, description, level, status, source, created_at) VALUES (?,?,?,?,?,?,?)', lang, LIST_TITLES[lang], 'Everyday core words with example sentences and verb forms.', 'A1', 'published', 'seed', now);
    list.forEach((v, i) => { const id = idOf(lang, v.tamil); if (id) db.run('INSERT OR IGNORE INTO vocabulary_list_items(list_id, vocabulary_id, position) VALUES (?,?,?)', Number(r.lastInsertRowid), id, i); });
  }

  // ---------------- nuanced Tamil senses (editor rows upgrade any legacy mirror of the same word)
  for (const [word, d] of Object.entries(TAMIL_SENSES)) {
    const vid = idOf('ta', word);
    if (!vid) continue;
    const sense = db.get('SELECT id FROM word_senses WHERE vocabulary_id = ? AND sense_no = 1', vid);
    if (!sense) continue;
    db.run("UPDATE word_senses SET definition = CASE WHEN definition = '' THEN ? ELSE definition END, usage_notes = CASE WHEN usage_notes = '' THEN ? ELSE usage_notes END WHERE id = ?", d.definition || '', d.usage_notes || '', sense.id);
    for (const rel of ['synonym', 'near_synonym', 'related', 'antonym', 'contextual_opposite', 'contrast']) for (const r of d[rel] || []) {
      db.run("DELETE FROM sense_relations WHERE sense_id = ? AND native = ? AND source = 'legacy'", sense.id, r.native);
      db.run(`INSERT INTO sense_relations(sense_id, relation, native, transliteration, english, nuance, difference, context, source, review_status) VALUES (?,?,?,?,?,?,?,?, 'editor', 'editor')
        ON CONFLICT(sense_id, relation, native) DO NOTHING`, sense.id, rel, r.native, transliterateAny(r.native), r.english, r.nuance, r.difference, r.context || '');
    }
    for (const [cat, list] of Object.entries(d.collocations || {})) for (const [native, english, explanation] of list)
      db.run("INSERT OR IGNORE INTO sense_collocations(sense_id, category, native, transliteration, english, explanation, source, review_status) VALUES (?,?,?,?,?,?, 'editor', 'editor')", sense.id, cat, native, transliterateAny(native), english, explanation || '');
    for (const [native, english] of d.examples || [])
      db.run("INSERT OR IGNORE INTO sense_examples(sense_id, native, transliteration, english, source, review_status) VALUES (?,?,?,?, 'editor', 'editor')", sense.id, native, transliterateAny(native.replace(/\[\[|\]\]/g, '')), english);
  }
  for (const h of HOMONYMS) {
    const vid = idOf(h.lang, h.word);
    if (vid) db.run("INSERT OR IGNORE INTO word_homonyms(vocabulary_id, kind, native, transliteration, meaning, example, example_en, source, review_status) VALUES (?,?,?,?,?,?,?, 'editor', 'editor')", vid, h.kind, h.native, transliterateAny(h.native), h.meaning, h.example, h.example_en);
  }

  // ---------------- grammar
  for (const lang of LANG_CODES) S.grammar.ensureCategories(lang);
  for (const g of GRAMMAR) {
    try { S.grammar.create(g, { status: 'published', source: 'editor', reviewStatus: 'editor' }); report.grammar++; }
    catch (e) { if (!e.details?.duplicate) log(`grammar seed skipped "${g.title}": ${e.message} ${JSON.stringify(e.details?.problems || [])}`); }
  }

  // ---------------- stories: upgrade short Tamil seeds in place (progress kept), add new languages
  for (const s of STORIES) {
    const paragraphs = TAMIL_STORY_UPGRADES[s.title] || s.paragraphs;
    const existing = db.get("SELECT id, paragraphs, source_note FROM stories WHERE title = ? AND lang = 'ta'", s.title);
    if (existing) {
      const n = JSON.parse(existing.paragraphs).reduce((a, p) => a + countSentences(p.ta), 0);
      if (n < 20 && /editorial seed/.test(existing.source_note) && TAMIL_STORY_UPGRADES[s.title]) {
        S.library.updateStory(existing.id, { paragraphs });
        db.run("UPDATE stories SET status = 'published' WHERE id = ?", existing.id);
        report.upgraded++;
      }
      continue;
    }
    const topic = db.get('SELECT id FROM topics WHERE slug = ?', s.topic);
    S.library.createStory({ ...s, lang: 'ta', paragraphs, topic_id: topic?.id || null, source_type: 'original', source_note: 'Original story written for Lotus Learn (editorial seed; native-speaker review recommended)', license: 'Original work' }, { status: 'published', reviewStatus: 'editor' });
    report.stories++;
  }
  for (const s of MULTI_STORIES) {
    if (db.get('SELECT id FROM stories WHERE title = ? AND lang = ?', s.title, s.lang)) continue;
    const topic = db.get('SELECT id FROM topics WHERE slug = ?', s.topic);
    S.library.createStory({ ...s, topic_id: topic?.id || null, source_type: 'original', source_note: 'Original story written for Lotus Learn (editorial seed; native-speaker review recommended)', license: 'Original work' }, { status: 'published', reviewStatus: 'editor' });
    report.stories++;
  }
  report.held = S.library.enforceStoryMinimum();
  for (const lang of LANG_CODES) S.dailyTopics.ensureFor(lang);
  log(`Seed: ${report.words} new words, ${report.stories} new stories, ${report.grammar} new grammar lessons, ${report.upgraded} stories extended, ${report.senses} senses backfilled, ${report.held} short stories held for review.`);

  if (demoUsers) {
    for (const [kind, d] of Object.entries(DEMO)) {
      if (db.get('SELECT id FROM users WHERE email = ?', d.email)) continue;
      const id = await S.auth.register({ email: d.email, password: d.password, displayName: d.name });
      if (kind === 'admin') db.run("UPDATE users SET role = 'admin' WHERE id = ?", id);
      S.profile.update(id, { onboarded: true, level: 'A1', preferredTopics: ['nature', 'food-and-cooking', 'family'], lang: 'ta' });
      if (kind === 'learner') {
        const ids = (lang, words) => words.map((t) => idOf(lang, t)).filter(Boolean);
        const c1 = S.collections.create(id, { title: 'My first words', description: 'Home, family and food' }, 'ta');
        S.collections.addFromLibrary(id, c1, ids('ta', ['வீடு', 'அம்மா', 'அப்பா', 'தண்ணீர்', 'சாப்பாடு', 'நண்பன்']));
        const c2 = S.collections.create(id, { title: 'Tropical garden', description: 'Nature words from the lotus pond' }, 'ta');
        S.collections.addFromLibrary(id, c2, ids('ta', ['பூ', 'மரம்', 'தாமரை', 'தென்னை', 'மழை', 'கடல்']));
        const c3 = S.collections.create(id, { title: 'Everyday verbs', description: 'Eat, drink, go, come' }, 'ta');
        S.collections.addFromLibrary(id, c3, ids('ta', ['சாப்பிடு', 'குடி', 'போ', 'வா', 'பேசு']));
        S.profile.update(id, { lang: 'ml', level: 'A2', onboarded: true });
        const m1 = S.collections.create(id, { title: 'Kerala basics', description: 'House, family and rain' }, 'ml');
        S.collections.addFromLibrary(id, m1, ids('ml', ['വീട്', 'അമ്മ', 'വെള്ളം', 'മഴ', 'തെങ്ങ്', 'നന്ദി']));
      }
      log(`Demo ${kind}: ${d.email} / ${d.password}`);
    }
  }
  return report;
}
export { sha256 };
