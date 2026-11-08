-- Lotus Learn — initial schema
-- Every user-owned row carries user_id (directly or via its parent) and every data-access
-- function in src/modules scopes queries by the authenticated user's id (application-level RLS).

-- ───────────── Reference data (admin-configurable) ─────────────
CREATE TABLE levels (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE topics (
  id        INTEGER PRIMARY KEY,
  slug      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  name_ta   TEXT,
  parent_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE parts_of_speech (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL
);

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ───────────── Accounts ─────────────
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE user_profiles (
  user_id              INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name         TEXT NOT NULL,
  avatar_path          TEXT,
  bio                  TEXT NOT NULL DEFAULT '',
  status_line          TEXT NOT NULL DEFAULT '',
  proficiency_level    TEXT NOT NULL DEFAULT 'A1' REFERENCES levels(code),
  interface_language   TEXT NOT NULL DEFAULT 'en' CHECK (interface_language IN ('en','en-ta')),
  preferred_topics     TEXT NOT NULL DEFAULT '[]',
  daily_goal           INTEGER NOT NULL DEFAULT 50 CHECK (daily_goal BETWEEN 10 AND 1000),
  timezone             TEXT NOT NULL DEFAULT 'UTC',
  motion               TEXT NOT NULL DEFAULT 'system' CHECK (motion IN ('system','full','reduced','off')),
  show_transliteration INTEGER NOT NULL DEFAULT 1 CHECK (show_transliteration IN (0,1)),
  show_translation     INTEGER NOT NULL DEFAULT 0 CHECK (show_translation IN (0,1)),
  onboarded            INTEGER NOT NULL DEFAULT 0 CHECK (onboarded IN (0,1)),
  updated_at           TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  id         TEXT PRIMARY KEY,               -- sha256(token); the raw token only lives in the cookie
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

CREATE TABLE email_outbox (
  id         INTEGER PRIMARY KEY,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  provider   TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('logged','sent','failed')),
  error      TEXT,
  created_at TEXT NOT NULL
);

-- ───────────── Vocabulary ─────────────
CREATE TABLE vocabulary (
  id              INTEGER PRIMARY KEY,
  tamil           TEXT NOT NULL,
  transliteration TEXT NOT NULL,
  pronunciation   TEXT NOT NULL DEFAULT '',
  english         TEXT NOT NULL,
  alt_english     TEXT NOT NULL DEFAULT '[]',
  hindi           TEXT,
  malayalam       TEXT,
  pos             TEXT NOT NULL REFERENCES parts_of_speech(code),
  level           TEXT NOT NULL REFERENCES levels(code),
  topic_id        INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  register        TEXT NOT NULL DEFAULT 'neutral' CHECK (register IN ('neutral','spoken','formal','literary','colloquial')),
  dialect         TEXT,
  notes           TEXT,
  example_ta      TEXT,
  example_en      TEXT,
  collocations    TEXT NOT NULL DEFAULT '[]',   -- [{ta, en}]
  synonyms        TEXT NOT NULL DEFAULT '[]',   -- [tamil]
  antonyms        TEXT NOT NULL DEFAULT '[]',
  related         TEXT NOT NULL DEFAULT '[]',   -- [{ta, en}]
  verb_forms      TEXT,                         -- {label: form}
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected')),
  verification    TEXT NOT NULL DEFAULT 'unverified' CHECK (verification IN ('verified','unverified','ai_generated')),
  source          TEXT NOT NULL DEFAULT 'manual',
  validation      TEXT,                         -- JSON validation report
  review_notes    TEXT,
  reviewed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TEXT,
  dedupe_key      TEXT NOT NULL UNIQUE,         -- NFC(tamil)|pos — prevents duplicate library entries
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_vocab_browse ON vocabulary(status, level, topic_id, pos);
CREATE INDEX idx_vocab_english ON vocabulary(english);

CREATE TABLE vocabulary_lists (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  level       TEXT NOT NULL REFERENCES levels(code),
  topic_id    INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('pending','published','rejected')),
  source      TEXT NOT NULL DEFAULT 'manual',
  run_key     TEXT UNIQUE,
  created_at  TEXT NOT NULL
);
CREATE TABLE vocabulary_list_items (
  list_id       INTEGER NOT NULL REFERENCES vocabulary_lists(id) ON DELETE CASCADE,
  vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
  sort          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (list_id, vocabulary_id)
);

-- ───────────── Videos ─────────────
CREATE TABLE videos (
  id                INTEGER PRIMARY KEY,
  platform          TEXT NOT NULL DEFAULT 'youtube',
  external_id       TEXT NOT NULL,
  title             TEXT NOT NULL,
  channel           TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  url               TEXT NOT NULL,
  thumbnail_url     TEXT,
  duration_sec      INTEGER,
  level             TEXT NOT NULL REFERENCES levels(code),
  topic_id          INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  category          TEXT NOT NULL DEFAULT 'educational',
  register          TEXT NOT NULL DEFAULT 'spoken' CHECK (register IN ('neutral','spoken','formal','literary','colloquial')),
  accent            TEXT,
  published_at      TEXT,
  transcript        TEXT,      -- JSON [{t?: seconds, ta, en?}] — only when legally available
  transcript_source TEXT,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected')),
  source            TEXT NOT NULL DEFAULT 'manual',
  validation        TEXT,
  review_notes      TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (platform, external_id)
);
CREATE INDEX idx_videos_browse ON videos(status, level, topic_id);

CREATE TABLE user_videos (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id   INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  favorite   INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1)),
  watched_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, video_id)
);

-- ───────────── Reading ─────────────
CREATE TABLE stories (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  title_en     TEXT NOT NULL,
  category     TEXT NOT NULL,
  level        TEXT NOT NULL REFERENCES levels(code),
  topic_id     INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  paragraphs   TEXT NOT NULL,          -- JSON [{ta, en}]
  summary      TEXT NOT NULL DEFAULT '',
  source_type  TEXT NOT NULL CHECK (source_type IN ('original','ai_generated','public_domain','open_license','folk_retelling')),
  license      TEXT NOT NULL DEFAULT '',
  author       TEXT NOT NULL DEFAULT '',
  metrics      TEXT,                   -- difficulty metrics JSON
  validation   TEXT,
  review_notes TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected')),
  content_hash TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_stories_browse ON stories(status, level, category);

CREATE TABLE reading_history (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  story_id       INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  progress       REAL NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 1),
  last_paragraph INTEGER NOT NULL DEFAULT 0,
  completed_at   TEXT,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (user_id, story_id)
);

-- ───────────── Collections ─────────────
CREATE TABLE collections (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_collections_user ON collections(user_id);

CREATE TABLE collection_words (
  id            INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocabulary_id INTEGER REFERENCES vocabulary(id) ON DELETE SET NULL,
  custom_data   TEXT,                  -- user-authored word, or personal overrides of a library word
  word_key      TEXT NOT NULL,         -- NFC Tamil text; prevents duplicates within a collection
  source        TEXT NOT NULL DEFAULT 'library' CHECK (source IN ('library','custom','dictionary','story','video','list')),
  created_at    TEXT NOT NULL,
  UNIQUE (collection_id, word_key)
);
CREATE INDEX idx_cw_user ON collection_words(user_id);
CREATE INDEX idx_cw_vocab ON collection_words(vocabulary_id);

CREATE TABLE word_mastery (
  collection_word_id   INTEGER PRIMARY KEY REFERENCES collection_words(id) ON DELETE CASCADE,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  successful_sessions  INTEGER NOT NULL DEFAULT 0,
  total_correct        INTEGER NOT NULL DEFAULT 0,
  total_incorrect      INTEGER NOT NULL DEFAULT 0,
  current_correct      INTEGER NOT NULL DEFAULT 0,   -- best progress (0–10) toward the next lotus
  last_successful_date TEXT,
  mastery_score        INTEGER NOT NULL DEFAULT 0 CHECK (mastery_score BETWEEN 0 AND 100),
  updated_at           TEXT NOT NULL
);
CREATE INDEX idx_mastery_user ON word_mastery(user_id);

CREATE TABLE lotus_awards (
  id                 INTEGER PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_word_id INTEGER NOT NULL REFERENCES collection_words(id) ON DELETE CASCADE,
  session_id         INTEGER NOT NULL,
  award_date         TEXT NOT NULL,   -- learner's local calendar day
  stage              INTEGER NOT NULL,
  created_at         TEXT NOT NULL,
  UNIQUE (collection_word_id, award_date)   -- hard guarantee: one lotus per word per day
);

-- ───────────── Study selection (server-side, survives navigation & devices) ─────────────
CREATE TABLE study_selections (
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_word_id INTEGER NOT NULL REFERENCES collection_words(id) ON DELETE CASCADE,
  word_key           TEXT NOT NULL,
  added_at           TEXT NOT NULL,
  PRIMARY KEY (user_id, collection_word_id),
  UNIQUE (user_id, word_key)
);

-- ───────────── Learning engine ─────────────
CREATE TABLE learning_sessions (
  id                INTEGER PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status            TEXT NOT NULL CHECK (status IN ('active','completed','abandoned')),
  started_at        TEXT NOT NULL,
  completed_at      TEXT,
  last_activity_at  TEXT NOT NULL,
  active_ms         INTEGER NOT NULL DEFAULT 0,
  total_answers     INTEGER NOT NULL DEFAULT 0,
  correct_answers   INTEGER NOT NULL DEFAULT 0,
  incorrect_answers INTEGER NOT NULL DEFAULT 0,
  award_date        TEXT
);
CREATE UNIQUE INDEX one_active_session_per_user ON learning_sessions(user_id) WHERE status = 'active';
CREATE INDEX idx_sessions_user ON learning_sessions(user_id, started_at);

CREATE TABLE session_words (
  id                 INTEGER PRIMARY KEY,
  session_id         INTEGER NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  collection_word_id INTEGER NOT NULL REFERENCES collection_words(id) ON DELETE CASCADE,
  snapshot           TEXT NOT NULL,     -- word data frozen at session start
  plan               TEXT NOT NULL,     -- remaining exercise slots {type: count}
  correct_answers    INTEGER NOT NULL DEFAULT 0 CHECK (correct_answers BETWEEN 0 AND 10),
  incorrect_answers  INTEGER NOT NULL DEFAULT 0,
  completed_at       TEXT,
  lotus_awarded      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (session_id, collection_word_id)
);

CREATE TABLE learning_questions (
  id              INTEGER PRIMARY KEY,
  session_id      INTEGER NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  session_word_id INTEGER NOT NULL REFERENCES session_words(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  question_type   TEXT NOT NULL CHECK (question_type IN ('collocation','ta_en','en_ta','sentence')),
  question_data   TEXT NOT NULL,
  correct_answer  TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  answered_at     TEXT,
  UNIQUE (session_id, seq)
);
CREATE INDEX idx_questions_pending ON learning_questions(session_id, answered_at);

CREATE TABLE learning_answers (
  id              INTEGER PRIMARY KEY,
  question_id     INTEGER NOT NULL UNIQUE REFERENCES learning_questions(id) ON DELETE CASCADE,
  session_id      INTEGER NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  session_word_id INTEGER NOT NULL REFERENCES session_words(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_type   TEXT NOT NULL,
  user_answer     TEXT NOT NULL,
  is_correct      INTEGER NOT NULL CHECK (is_correct IN (0,1)),
  attempt_number  INTEGER NOT NULL,
  response_ms     INTEGER,
  answered_at     TEXT NOT NULL
);
CREATE INDEX idx_answers_user ON learning_answers(user_id, answered_at);

CREATE TABLE daily_activity (
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day                TEXT NOT NULL,
  answers            INTEGER NOT NULL DEFAULT 0,
  correct            INTEGER NOT NULL DEFAULT 0,
  sessions_completed INTEGER NOT NULL DEFAULT 0,
  lotus_awards       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- ───────────── Content automation ─────────────
CREATE TABLE content_jobs (
  id            INTEGER PRIMARY KEY,
  job_type      TEXT NOT NULL CHECK (job_type IN ('vocabulary','story','video_discovery','classify_videos')),
  status        TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
  trigger_type  TEXT NOT NULL CHECK (trigger_type IN ('schedule','manual','retry')),
  run_key       TEXT UNIQUE,           -- idempotency key for scheduled runs, e.g. story:2026-11-08:2
  params        TEXT NOT NULL DEFAULT '{}',
  result        TEXT,
  error_message TEXT,
  retryable     INTEGER NOT NULL DEFAULT 1,
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  started_at    TEXT,
  completed_at  TEXT
);
CREATE INDEX idx_jobs_status ON content_jobs(status, created_at);

CREATE TABLE app_errors (
  id         INTEGER PRIMARY KEY,
  context    TEXT NOT NULL,
  message    TEXT NOT NULL,
  stack      TEXT,
  created_at TEXT NOT NULL
);
