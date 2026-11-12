-- Lotus Learn 002: multilingual platform (Tamil, Malayalam, Kannada, Telugu).
-- Additive only: no user rows are deleted or recreated. Every pre-existing
-- record is Tamil, so legacy rows are tagged 'ta'. A file backup is taken by
-- db.js before this migration runs (data/backups/pre-<migration>-*.db).

CREATE TABLE languages (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  native_name TEXT NOT NULL,
  script TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  theme TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO languages(code, name, native_name, script, sort_order) VALUES
  ('ta', 'Tamil', 'தமிழ்', 'Taml', 0), ('ml', 'Malayalam', 'മലയാളം', 'Mlym', 1),
  ('kn', 'Kannada', 'ಕನ್ನಡ', 'Knda', 2), ('te', 'Telugu', 'తెలుగు', 'Telu', 3);

-- active learning language (global per account); everything else is per language
ALTER TABLE user_profiles ADD COLUMN active_language TEXT NOT NULL DEFAULT 'ta' CHECK (active_language IN ('ta','ml','kn','te'));

CREATE TABLE user_language_profiles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lang TEXT NOT NULL REFERENCES languages(code),
  proficiency_level TEXT NOT NULL DEFAULT 'A1' REFERENCES levels(code) ON UPDATE CASCADE,
  preferred_topics TEXT NOT NULL DEFAULT '[]',
  daily_goal INTEGER NOT NULL DEFAULT 20,
  show_transliteration INTEGER NOT NULL DEFAULT 1,
  onboarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lang)
);
INSERT INTO user_language_profiles(user_id, lang, proficiency_level, preferred_topics, daily_goal, show_transliteration, onboarded, created_at, updated_at)
  SELECT user_id, 'ta', proficiency_level, preferred_topics, daily_goal, show_transliteration, onboarded, updated_at, updated_at FROM user_profiles;

-- language tags on content and progress (legacy rows are Tamil)
ALTER TABLE vocabulary ADD COLUMN lang TEXT NOT NULL DEFAULT 'ta' CHECK (lang IN ('ta','ml','kn','te'));
ALTER TABLE vocabulary ADD COLUMN concept_key TEXT;            -- links sense-equivalent entries across languages
ALTER TABLE vocabulary ADD COLUMN definition TEXT NOT NULL DEFAULT '';
UPDATE vocabulary SET norm_key = 'ta|' || norm_key;            -- duplicate guard is now per language
CREATE INDEX idx_vocab_lang ON vocabulary(lang, status, level);
CREATE INDEX idx_vocab_concept ON vocabulary(concept_key);
ALTER TABLE vocabulary_lists ADD COLUMN lang TEXT NOT NULL DEFAULT 'ta' CHECK (lang IN ('ta','ml','kn','te'));
ALTER TABLE collections ADD COLUMN lang TEXT NOT NULL DEFAULT 'ta' CHECK (lang IN ('ta','ml','kn','te'));
CREATE INDEX idx_collections_user_lang ON collections(user_id, lang);
ALTER TABLE collection_words ADD COLUMN lang TEXT NOT NULL DEFAULT 'ta' CHECK (lang IN ('ta','ml','kn','te'));
ALTER TABLE word_mastery ADD COLUMN lang TEXT NOT NULL DEFAULT 'ta' CHECK (lang IN ('ta','ml','kn','te'));
CREATE INDEX idx_mastery_lang ON word_mastery(user_id, lang);
ALTER TABLE lotus_rewards ADD COLUMN lang TEXT NOT NULL DEFAULT 'ta' CHECK (lang IN ('ta','ml','kn','te'));
ALTER TABLE learning_sessions ADD COLUMN lang TEXT NOT NULL DEFAULT 'ta' CHECK (lang IN ('ta','ml','kn','te'));
DROP INDEX idx_one_active_session;
CREATE UNIQUE INDEX idx_one_active_session_lang ON learning_sessions(user_id, lang) WHERE status = 'active';
ALTER TABLE stories ADD COLUMN lang TEXT NOT NULL DEFAULT 'ta' CHECK (lang IN ('ta','ml','kn','te'));
CREATE INDEX idx_stories_lang ON stories(lang, status, level);
ALTER TABLE videos ADD COLUMN lang TEXT NOT NULL DEFAULT 'ta' CHECK (lang IN ('ta','ml','kn','te'));
ALTER TABLE videos ADD COLUMN url TEXT;
CREATE INDEX idx_videos_lang ON videos(lang, status, level);

-- content jobs: rebuilt (not user data) to widen job types and add language
CREATE TABLE content_jobs_new (
  id INTEGER PRIMARY KEY,
  job_type TEXT NOT NULL CHECK (job_type IN ('vocabulary','story','video_discovery','classify','grammar','daily_topic','enrich_entry')),
  lang TEXT NOT NULL DEFAULT 'ta' CHECK (lang IN ('ta','ml','kn','te')),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  payload TEXT NOT NULL DEFAULT '{}', result TEXT, error TEXT, error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, triggered_by TEXT NOT NULL DEFAULT 'scheduler',
  created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, next_retry_at TEXT
);
INSERT INTO content_jobs_new(id, job_type, lang, idempotency_key, status, payload, result, error, error_code, attempts, triggered_by, created_at, started_at, completed_at)
  SELECT id, job_type, 'ta', idempotency_key, status, payload, result, error, error_code, attempts, triggered_by, created_at, started_at, completed_at FROM content_jobs;
DROP TABLE content_jobs;
ALTER TABLE content_jobs_new RENAME TO content_jobs;
CREATE INDEX idx_jobs_status ON content_jobs(status, created_at);
CREATE INDEX idx_jobs_lang ON content_jobs(lang, job_type, status);

-- per language/content-type bookkeeping for the daily lifecycle (last run, shortfalls)
CREATE TABLE content_state (
  lang TEXT NOT NULL REFERENCES languages(code),
  content_type TEXT NOT NULL,
  last_checked_at TEXT, last_run_date TEXT, last_success_at TEXT,
  produced_today INTEGER NOT NULL DEFAULT 0, target_today INTEGER NOT NULL DEFAULT 0,
  shortfall INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (lang, content_type)
);

-- ------------------------------------------------------------ sense-aware dictionary
CREATE TABLE word_senses (
  id INTEGER PRIMARY KEY,
  vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
  sense_no INTEGER NOT NULL,
  gloss TEXT NOT NULL,                       -- English translation of this sense
  definition TEXT NOT NULL DEFAULT '',       -- detailed meaning
  part_of_speech TEXT NOT NULL DEFAULT '',
  register TEXT NOT NULL DEFAULT '',
  grammar_notes TEXT NOT NULL DEFAULT '',
  usage_notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'editor',     -- legacy | editor | ai | import
  review_status TEXT NOT NULL DEFAULT 'editor' CHECK (review_status IN ('native-reviewed','editor','ai-unreviewed')),
  created_at TEXT NOT NULL,
  UNIQUE (vocabulary_id, sense_no)
);
CREATE TABLE sense_relations (
  id INTEGER PRIMARY KEY,
  sense_id INTEGER NOT NULL REFERENCES word_senses(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('synonym','near_synonym','related','antonym','contextual_opposite','contrast')),
  native TEXT NOT NULL, transliteration TEXT NOT NULL DEFAULT '', english TEXT NOT NULL DEFAULT '',
  nuance TEXT NOT NULL DEFAULT '', difference TEXT NOT NULL DEFAULT '', context TEXT NOT NULL DEFAULT '',
  target_vocabulary_id INTEGER REFERENCES vocabulary(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'editor', review_status TEXT NOT NULL DEFAULT 'editor',
  UNIQUE (sense_id, relation, native)
);
CREATE TABLE sense_collocations (
  id INTEGER PRIMARY KEY,
  sense_id INTEGER NOT NULL REFERENCES word_senses(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('adj_noun','noun_verb','adv_verb','common')),
  native TEXT NOT NULL, transliteration TEXT NOT NULL DEFAULT '', english TEXT NOT NULL DEFAULT '',
  explanation TEXT NOT NULL DEFAULT '', structure_label TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'editor', review_status TEXT NOT NULL DEFAULT 'editor',
  UNIQUE (sense_id, category, native)
);
CREATE TABLE sense_examples (
  id INTEGER PRIMARY KEY,
  sense_id INTEGER NOT NULL REFERENCES word_senses(id) ON DELETE CASCADE,
  native TEXT NOT NULL,                       -- searched word wrapped in [[ ]] for highlighting
  transliteration TEXT NOT NULL DEFAULT '', english TEXT NOT NULL DEFAULT '',
  register TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'editor', review_status TEXT NOT NULL DEFAULT 'editor',
  UNIQUE (sense_id, native)
);
CREATE TABLE sense_equivalents (
  id INTEGER PRIMARY KEY,
  sense_id INTEGER NOT NULL REFERENCES word_senses(id) ON DELETE CASCADE,
  lang TEXT NOT NULL CHECK (lang IN ('ta','ml','kn','te','hi')),
  native TEXT NOT NULL, transliteration TEXT NOT NULL DEFAULT '', english_note TEXT NOT NULL DEFAULT '',
  target_vocabulary_id INTEGER REFERENCES vocabulary(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'editor', review_status TEXT NOT NULL DEFAULT 'editor',
  UNIQUE (sense_id, lang, native)
);
CREATE TABLE word_homonyms (
  id INTEGER PRIMARY KEY,
  vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('homophone','homonym')),
  native TEXT NOT NULL, transliteration TEXT NOT NULL DEFAULT '', meaning TEXT NOT NULL,
  example TEXT NOT NULL DEFAULT '', example_en TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'editor', review_status TEXT NOT NULL DEFAULT 'editor',
  UNIQUE (vocabulary_id, kind, native, meaning)
);
CREATE INDEX idx_senses_vocab ON word_senses(vocabulary_id);
CREATE INDEX idx_rel_sense ON sense_relations(sense_id);
CREATE INDEX idx_col_sense ON sense_collocations(sense_id);
CREATE INDEX idx_ex_sense ON sense_examples(sense_id);
CREATE INDEX idx_eq_sense ON sense_equivalents(sense_id);

-- ------------------------------------------------------------ grammar
CREATE TABLE grammar_categories (
  id INTEGER PRIMARY KEY,
  lang TEXT NOT NULL REFERENCES languages(code),
  slug TEXT NOT NULL, name TEXT NOT NULL,
  parent_id INTEGER REFERENCES grammar_categories(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (lang, slug)
);
CREATE TABLE grammar_lessons (
  id INTEGER PRIMARY KEY,
  lang TEXT NOT NULL REFERENCES languages(code),
  category_id INTEGER REFERENCES grammar_categories(id) ON DELETE SET NULL,
  slug TEXT NOT NULL, title TEXT NOT NULL, level TEXT NOT NULL REFERENCES levels(code) ON UPDATE CASCADE,
  rule TEXT NOT NULL, nuances TEXT NOT NULL DEFAULT '',
  variations TEXT NOT NULL DEFAULT '[]',     -- [{name, description, examples:[{native, en}]}]
  examples TEXT NOT NULL DEFAULT '[]',       -- [{native, en, note}]
  comparison TEXT NOT NULL DEFAULT '[]',     -- optional table rows [[...]]
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('published','pending','rejected')),
  source TEXT NOT NULL DEFAULT 'editor', review_status TEXT NOT NULL DEFAULT 'editor',
  validation TEXT NOT NULL DEFAULT '{}', content_hash TEXT NOT NULL UNIQUE, idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL, published_at TEXT,
  UNIQUE (lang, slug)
);
CREATE INDEX idx_grammar_lang ON grammar_lessons(lang, status, level);
CREATE TABLE grammar_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL REFERENCES grammar_lessons(id) ON DELETE CASCADE,
  bookmarked INTEGER NOT NULL DEFAULT 0, studied_at TEXT, last_viewed_at TEXT,
  PRIMARY KEY (user_id, lesson_id)
);

-- ------------------------------------------------------------ learning notes (personal, per language)
CREATE TABLE learning_notes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lang TEXT NOT NULL REFERENCES languages(code),
  note_date TEXT NOT NULL CHECK (note_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_notes_user ON learning_notes(user_id, lang, note_date);

-- ------------------------------------------------------------ daily topics (platform-wide per language)
CREATE TABLE daily_topics (
  id INTEGER PRIMARY KEY,
  lang TEXT NOT NULL REFERENCES languages(code),
  topic_date TEXT NOT NULL,
  topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0, target_min INTEGER NOT NULL DEFAULT 60, shortfall INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','pending','rejected')),
  source TEXT NOT NULL DEFAULT 'scheduler', created_at TEXT NOT NULL,
  UNIQUE (lang, topic_date)
);
CREATE TABLE daily_topic_words (
  daily_topic_id INTEGER NOT NULL REFERENCES daily_topics(id) ON DELETE CASCADE,
  vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (daily_topic_id, vocabulary_id)
);
