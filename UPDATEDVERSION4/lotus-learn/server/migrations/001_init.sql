-- Lotus Learn schema v1 (SQLite). Every user-owned row carries user_id and is
-- only ever queried with an ownership predicate (see server/services/*).

CREATE TABLE levels (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE topics (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'learner' CHECK (role IN ('learner', 'admin')),
  created_at TEXT NOT NULL
);

CREATE TABLE user_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  avatar TEXT,
  proficiency_level TEXT NOT NULL DEFAULT 'A1' REFERENCES levels(code) ON UPDATE CASCADE,
  interface_language TEXT NOT NULL DEFAULT 'en',
  preferred_topics TEXT NOT NULL DEFAULT '[]',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  motion TEXT NOT NULL DEFAULT 'full' CHECK (motion IN ('full', 'reduced', 'off')),
  show_transliteration INTEGER NOT NULL DEFAULT 1,
  daily_goal INTEGER NOT NULL DEFAULT 20,
  onboarded INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,                 -- sha256 of the cookie token (token never stored)
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE vocabulary (
  id INTEGER PRIMARY KEY,
  tamil TEXT NOT NULL,
  transliteration TEXT NOT NULL,
  pronunciation TEXT NOT NULL DEFAULT '',
  english TEXT NOT NULL,
  alt_english TEXT NOT NULL DEFAULT '[]',
  hindi TEXT NOT NULL DEFAULT '',
  malayalam TEXT NOT NULL DEFAULT '',
  part_of_speech TEXT NOT NULL CHECK (part_of_speech IN ('noun','verb','adjective','adverb','pronoun','postposition','conjunction','interjection','particle','idiom')),
  level TEXT NOT NULL REFERENCES levels(code) ON UPDATE CASCADE,
  topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  register TEXT NOT NULL DEFAULT 'common' CHECK (register IN ('common','spoken','formal','literary','colloquial')),
  dialect TEXT NOT NULL DEFAULT '',
  examples TEXT NOT NULL DEFAULT '[]',      -- [{ta, en, form?}] target wrapped in [[ ]]
  collocations TEXT NOT NULL DEFAULT '[]',  -- [{ta, en, form?}]
  synonyms TEXT NOT NULL DEFAULT '[]',
  antonyms TEXT NOT NULL DEFAULT '[]',
  related TEXT NOT NULL DEFAULT '[]',
  forms TEXT NOT NULL DEFAULT '{}',         -- verbs: {present1s, past1s, future1s, inf}
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','pending','rejected')),
  source TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('seed','admin','ai','import')),
  review_status TEXT NOT NULL DEFAULT 'editor' CHECK (review_status IN ('native-reviewed','editor','ai-unreviewed')),
  validation TEXT NOT NULL DEFAULT '{}',
  norm_key TEXT NOT NULL UNIQUE,            -- duplicate guard: normalized tamil|english
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_vocab_level ON vocabulary(level, status);
CREATE INDEX idx_vocab_topic ON vocabulary(topic_id, status);
CREATE INDEX idx_vocab_pos ON vocabulary(part_of_speech, status);
CREATE INDEX idx_vocab_tamil ON vocabulary(tamil);

CREATE TABLE vocabulary_lists (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  level TEXT REFERENCES levels(code) ON UPDATE CASCADE,
  topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','pending','rejected')),
  source TEXT NOT NULL DEFAULT 'admin',
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE vocabulary_list_items (
  list_id INTEGER NOT NULL REFERENCES vocabulary_lists(id) ON DELETE CASCADE,
  vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (list_id, vocabulary_id)
);

CREATE TABLE collections (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_collections_user ON collections(user_id);

CREATE TABLE collection_words (
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocabulary_id INTEGER REFERENCES vocabulary(id) ON DELETE SET NULL,
  word_key TEXT NOT NULL,                  -- mastery identity: v<vocab id> or m:<uuid>
  tamil TEXT NOT NULL,
  transliteration TEXT NOT NULL DEFAULT '',
  english TEXT NOT NULL,
  hindi TEXT NOT NULL DEFAULT '',
  malayalam TEXT NOT NULL DEFAULT '',
  part_of_speech TEXT NOT NULL DEFAULT '',
  topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  examples TEXT NOT NULL DEFAULT '[]',
  collocations TEXT NOT NULL DEFAULT '[]',
  synonyms TEXT NOT NULL DEFAULT '[]',
  forms TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (collection_id, word_key)
);
CREATE INDEX idx_cw_user ON collection_words(user_id);
CREATE INDEX idx_cw_collection ON collection_words(collection_id);
CREATE INDEX idx_cw_key ON collection_words(user_id, word_key);

CREATE TABLE word_mastery (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_key TEXT NOT NULL,
  successful_days INTEGER NOT NULL DEFAULT 0,  -- lotus rewards earned (display caps at 5)
  current_correct INTEGER NOT NULL DEFAULT 0,  -- progress inside an unfinished session
  total_correct INTEGER NOT NULL DEFAULT 0,
  total_incorrect INTEGER NOT NULL DEFAULT 0,
  last_reward_date TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, word_key)
);

CREATE TABLE lotus_rewards (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_key TEXT NOT NULL,
  reward_date TEXT NOT NULL,
  session_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, word_key, reward_date)   -- hard guarantee: one lotus per word per day
);

CREATE TABLE selections (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_word_id INTEGER NOT NULL REFERENCES collection_words(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, collection_word_id)
);

CREATE TABLE learning_sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','abandoned')),
  word_count INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  last_activity_at TEXT NOT NULL,
  current_question_id INTEGER,
  last_session_word_id INTEGER,
  reward_date TEXT
);
CREATE INDEX idx_sessions_user ON learning_sessions(user_id, status);
CREATE UNIQUE INDEX idx_one_active_session ON learning_sessions(user_id) WHERE status = 'active';

CREATE TABLE session_words (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  word_key TEXT NOT NULL,
  collection_word_id INTEGER REFERENCES collection_words(id) ON DELETE SET NULL,
  collection_id INTEGER,
  collection_title TEXT NOT NULL DEFAULT '',
  snapshot TEXT NOT NULL,
  plan TEXT NOT NULL,
  type_correct TEXT NOT NULL DEFAULT '{}',
  correct_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_count BETWEEN 0 AND 10),
  incorrect_count INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  UNIQUE (session_id, word_key)
);

CREATE TABLE learning_questions (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  session_word_id INTEGER NOT NULL REFERENCES session_words(id) ON DELETE CASCADE,
  question_type TEXT NOT NULL CHECK (question_type IN ('collocation','ta_en','en_ta','sentence')),
  prompt TEXT NOT NULL,
  options TEXT NOT NULL,
  correct_answer TEXT NOT NULL,
  context_ref TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  answered_at TEXT
);
CREATE INDEX idx_questions_sw ON learning_questions(session_word_id);

CREATE TABLE learning_answers (
  id INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL UNIQUE REFERENCES learning_questions(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  session_word_id INTEGER NOT NULL REFERENCES session_words(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_type TEXT NOT NULL,
  user_answer TEXT NOT NULL,
  is_correct INTEGER NOT NULL,
  attempt_number INTEGER NOT NULL,
  answered_at TEXT NOT NULL
);
CREATE INDEX idx_answers_session ON learning_answers(session_id);
CREATE INDEX idx_answers_user ON learning_answers(user_id, answered_at);

CREATE TABLE stories (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_en TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL REFERENCES levels(code) ON UPDATE CASCADE,
  topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'short-story',
  register TEXT NOT NULL DEFAULT 'formal',
  paragraphs TEXT NOT NULL,                 -- [{ta, en}]
  source_type TEXT NOT NULL CHECK (source_type IN ('original','public-domain','open-license','ai-generated')),
  source_note TEXT NOT NULL DEFAULT '',
  license TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('published','pending','rejected')),
  review_status TEXT NOT NULL DEFAULT 'editor',
  validation TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL UNIQUE,
  word_count INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX idx_stories_status ON stories(status, level);

CREATE TABLE reading_history (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  last_paragraph INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, story_id)
);

CREATE TABLE videos (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'youtube',
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  level TEXT REFERENCES levels(code) ON UPDATE CASCADE,
  topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'educational',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  register TEXT NOT NULL DEFAULT 'spoken',
  accent TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  transcript TEXT,                           -- [{start, ta, en}] only when authorised
  transcript_source TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('published','pending','rejected')),
  source TEXT NOT NULL DEFAULT 'admin',
  validation TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (platform, external_id)
);
CREATE INDEX idx_videos_status ON videos(status, level);

CREATE TABLE video_user (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  favorite INTEGER NOT NULL DEFAULT 0,
  watched INTEGER NOT NULL DEFAULT 0,
  watched_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, video_id)
);

CREATE TABLE content_jobs (
  id INTEGER PRIMARY KEY,
  job_type TEXT NOT NULL CHECK (job_type IN ('vocabulary','story','video_discovery','classify')),
  idempotency_key TEXT NOT NULL UNIQUE,      -- re-running the scheduler can never duplicate work
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  payload TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  error TEXT,
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  triggered_by TEXT NOT NULL DEFAULT 'scheduler',
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX idx_jobs_status ON content_jobs(status, created_at);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
