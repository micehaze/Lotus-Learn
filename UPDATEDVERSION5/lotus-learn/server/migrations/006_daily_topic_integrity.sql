-- Append-only safeguards; never rewrite or delete legacy archives.
UPDATE app_settings SET value='20' WHERE key='daily_topic_words_min' AND CAST(value AS INTEGER)<20;
UPDATE app_settings SET value='50' WHERE key='daily_topic_words_max' AND CAST(value AS INTEGER)>50;
UPDATE app_settings SET value='36' WHERE key='daily_topic_words_max' AND CAST(value AS INTEGER)<20;
CREATE TRIGGER daily_published_date_update BEFORE UPDATE ON daily_topic_dates
WHEN OLD.status='published' BEGIN SELECT RAISE(ABORT,'Published Daily Topics are immutable'); END;
CREATE TRIGGER daily_published_date_delete BEFORE DELETE ON daily_topic_dates
WHEN OLD.status='published' BEGIN SELECT RAISE(ABORT,'Published Daily Topics are immutable'); END;
CREATE TRIGGER daily_published_entries_update BEFORE UPDATE ON daily_study_entries
WHEN EXISTS(SELECT 1 FROM daily_topic_language_sets s JOIN daily_topic_dates d ON d.id=s.date_id WHERE s.id=OLD.language_set_id AND d.status='published')
BEGIN SELECT RAISE(ABORT,'Published Daily Topic entries are immutable'); END;
CREATE TRIGGER daily_published_entries_delete BEFORE DELETE ON daily_study_entries
WHEN EXISTS(SELECT 1 FROM daily_topic_language_sets s JOIN daily_topic_dates d ON d.id=s.date_id WHERE s.id=OLD.language_set_id AND d.status='published')
BEGIN SELECT RAISE(ABORT,'Published Daily Topic entries are immutable'); END;
CREATE TRIGGER daily_published_entries_insert BEFORE INSERT ON daily_study_entries
WHEN EXISTS(SELECT 1 FROM daily_topic_language_sets s JOIN daily_topic_dates d ON d.id=s.date_id WHERE s.id=NEW.language_set_id AND d.status='published')
BEGIN SELECT RAISE(ABORT,'Published Daily Topic entries are immutable'); END;
