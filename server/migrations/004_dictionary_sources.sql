-- Additive dictionary metadata only. Learner tables and proficiency rules are unchanged.
CREATE TABLE dictionary_native_definitions (
 id INTEGER PRIMARY KEY,
 vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
 lang TEXT NOT NULL, definition TEXT NOT NULL, grammar TEXT NOT NULL DEFAULT '',
 source TEXT NOT NULL, source_record_id TEXT NOT NULL, source_url TEXT NOT NULL DEFAULT '',
 UNIQUE(vocabulary_id,source,source_record_id)
);
CREATE INDEX dictionary_native_word ON dictionary_native_definitions(vocabulary_id);
CREATE TABLE dictionary_provenance (
 id INTEGER PRIMARY KEY,
 vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
 source TEXT NOT NULL, record_key TEXT NOT NULL, payload TEXT NOT NULL,
 UNIQUE(vocabulary_id,source,record_key)
);
CREATE INDEX dictionary_import_lookup ON vocabulary(lang,status,origin,tamil);
