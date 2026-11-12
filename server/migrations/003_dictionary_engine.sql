-- Lotus Learn 003: dictionary lookup engine, morphology, cache, Learnt, completeness rules.
-- Additive (one non-user table rebuild); a backup is written by db.js first.

-- relation categories widened: A synonym · B near-synonym · C contextual alternative · D related
CREATE TABLE sense_relations_new (
  id INTEGER PRIMARY KEY,
  sense_id INTEGER NOT NULL REFERENCES word_senses(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('synonym','near_synonym','contextual_alternative','related','antonym','contextual_opposite','contrast')),
  native TEXT NOT NULL, transliteration TEXT NOT NULL DEFAULT '', english TEXT NOT NULL DEFAULT '',
  nuance TEXT NOT NULL DEFAULT '', difference TEXT NOT NULL DEFAULT '', context TEXT NOT NULL DEFAULT '',
  target_vocabulary_id INTEGER REFERENCES vocabulary(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'editor', review_status TEXT NOT NULL DEFAULT 'editor',
  UNIQUE (sense_id, relation, native)
);
INSERT INTO sense_relations_new SELECT id, sense_id, relation, native, transliteration, english, nuance, difference, context, target_vocabulary_id, source, review_status FROM sense_relations;
DROP TABLE sense_relations;
ALTER TABLE sense_relations_new RENAME TO sense_relations;
CREATE INDEX idx_rel_sense ON sense_relations(sense_id);

-- where an entry came from (seed, admin, wiktionary, google, azure, libretranslate, ai …)
ALTER TABLE vocabulary ADD COLUMN origin TEXT NOT NULL DEFAULT '';
ALTER TABLE sense_examples ADD COLUMN origin TEXT NOT NULL DEFAULT '';

-- inflected / conjugated forms that resolve to a lemma (seeded verb forms + analyser results)
CREATE TABLE word_forms (
  id INTEGER PRIMARY KEY,
  lang TEXT NOT NULL REFERENCES languages(code),
  form TEXT NOT NULL,
  lemma TEXT NOT NULL,
  lemma_vocabulary_id INTEGER REFERENCES vocabulary(id) ON DELETE CASCADE,
  analysis TEXT NOT NULL DEFAULT '{}',
  gloss TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'analyser',
  created_at TEXT NOT NULL,
  UNIQUE (lang, form, lemma)
);
CREATE INDEX idx_forms_lookup ON word_forms(lang, form);

-- persistent cache of external dictionary / translation results
CREATE TABLE dictionary_cache (
  id INTEGER PRIMARY KEY,
  lang TEXT NOT NULL, direction TEXT NOT NULL, query_norm TEXT NOT NULL, provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','miss','error')),
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  UNIQUE (lang, direction, query_norm, provider)
);

-- Learnt: 10 correct answers on 3 distinct learning days (per user, per language)
CREATE TABLE word_learnt (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_key TEXT NOT NULL,
  lang TEXT NOT NULL REFERENCES languages(code),
  qualified_at TEXT NOT NULL,
  qualifying_days TEXT NOT NULL DEFAULT '[]',
  total_correct INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, word_key)
);
CREATE INDEX idx_learnt_lang ON word_learnt(user_id, lang);

-- completeness rules: incomplete Daily Topics / lists are kept but no longer published
ALTER TABLE daily_topics ADD COLUMN subtopics TEXT NOT NULL DEFAULT '[]';
UPDATE daily_topics SET status = 'pending' WHERE status = 'published' AND word_count < 60;
UPDATE vocabulary_lists SET status = 'pending' WHERE status = 'published'
  AND (SELECT COUNT(*) FROM vocabulary_list_items i WHERE i.list_id = vocabulary_lists.id) < 40;
