-- Append-only Daily Topic curriculum. Existing daily_topics and saves are retained.
CREATE TABLE daily_microtopics (
 id INTEGER PRIMARY KEY, parent_category TEXT NOT NULL, title TEXT NOT NULL UNIQUE,
 goal TEXT NOT NULL, outline_json TEXT NOT NULL, signature TEXT NOT NULL UNIQUE,
 source TEXT NOT NULL, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE daily_topic_dates (
 id INTEGER PRIMARY KEY, topic_date TEXT NOT NULL UNIQUE, microtopic_id INTEGER NOT NULL UNIQUE REFERENCES daily_microtopics(id),
 title TEXT NOT NULL, outline_json TEXT NOT NULL, timezone TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','generating','failed','published')),
 created_at TEXT NOT NULL, published_at TEXT
);
CREATE TABLE daily_topic_language_sets (
 id INTEGER PRIMARY KEY, date_id INTEGER NOT NULL REFERENCES daily_topic_dates(id),
 language_code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', word_count INTEGER NOT NULL DEFAULT 0,
 UNIQUE(date_id,language_code)
);
CREATE TABLE daily_study_entries (
 id INTEGER PRIMARY KEY, language_set_id INTEGER NOT NULL REFERENCES daily_topic_language_sets(id),
 vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id), position INTEGER NOT NULL,
 identity_key TEXT NOT NULL, lemma_key TEXT NOT NULL, construction TEXT NOT NULL, payload TEXT NOT NULL,
 UNIQUE(language_set_id,identity_key), UNIQUE(language_set_id,position)
);
CREATE INDEX daily_entries_identity ON daily_study_entries(identity_key,language_set_id);
CREATE TABLE topic_generation_jobs (
 id INTEGER PRIMARY KEY, date_id INTEGER NOT NULL REFERENCES daily_topic_dates(id), language_code TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued', attempt_count INTEGER NOT NULL DEFAULT 0, lease_token TEXT,
 lease_until TEXT, next_retry_at TEXT, error_summary TEXT, started_at TEXT, completed_at TEXT,
 UNIQUE(date_id,language_code)
);
CREATE INDEX topic_jobs_due ON topic_generation_jobs(status,next_retry_at,date_id);
CREATE TABLE daily_curriculum_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
-- Migrate old out-of-range configuration only; retain custom values already within 20–50.
UPDATE app_settings SET value='20' WHERE key='daily_topic_words_min' AND CAST(value AS INTEGER)>50;
UPDATE app_settings SET value='36' WHERE key='daily_topic_words_max' AND CAST(value AS INTEGER)>50;
