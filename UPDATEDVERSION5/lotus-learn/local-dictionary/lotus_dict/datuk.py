"""Datuk is Malayalam–Malayalam. Definitions here are NEVER English glosses."""
import json
import re
import sqlite3
from .langs import norm

SCHEMA = """
CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, word TEXT NOT NULL, norm TEXT NOT NULL, origin TEXT, info TEXT);
CREATE INDEX IF NOT EXISTS datuk_word ON entries(norm);
CREATE TABLE IF NOT EXISTS definitions(entry_id TEXT, sense_no INTEGER, definition TEXT, grammar TEXT, PRIMARY KEY(entry_id,sense_no));
CREATE VIRTUAL TABLE IF NOT EXISTS definition_search USING fts5(definition, entry_id UNINDEXED);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
"""


class Datuk:
    def __init__(self, path):
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)

    def import_records(self, records):
        with self.db:
            for row in records:
                word = re.sub(r"[0-9⁰¹²³⁴⁵⁶⁷⁸⁹]+$", "", str(row.get("entry", ""))).strip()
                if not word:
                    continue
                record_id = str(row["id"])
                self.db.execute("INSERT OR REPLACE INTO entries VALUES(?,?,?,?,?)", (record_id, word, norm(word), row.get("origin", ""), row.get("info", "")))
                self.db.execute("DELETE FROM definitions WHERE entry_id=?", (record_id,))
                for i, definition in enumerate(row.get("defs", []), 1):
                    self.db.execute("INSERT INTO definitions VALUES(?,?,?,?)", (record_id, i, str(definition.get("entry", "")), str(definition.get("type", ""))))
            self.db.execute("DELETE FROM definition_search")
            self.db.execute("INSERT INTO definition_search SELECT definition,entry_id FROM definitions")
            self.db.execute("INSERT OR REPLACE INTO meta VALUES('source',?)", (json.dumps({"name": "Datuk / Olam Malayalam–Malayalam", "license": "ODbL-1.0", "url": "https://github.com/knadh/datuk"}),))

    def lookup_native(self, word, lang, candidates=()):
        if lang != 'ml':
            return {"entries": [], "via": None}
        for form in [word, *candidates]:
            entries = []
            for row in self.db.execute("SELECT * FROM entries WHERE norm=? ORDER BY id LIMIT 12", (norm(form),)):
                senses = []
                for d in self.db.execute("SELECT * FROM definitions WHERE entry_id=? ORDER BY sense_no", (row['id'],)):
                    grammar = d['grammar']
                    pos = 'verb' if grammar.startswith('ക്രി') else 'adjective' if grammar.startswith('വി.') else 'noun' if grammar.startswith('നാ.') else ''
                    senses.append({"gloss": "", "native_definition": d['definition'], "definition_lang": "ml", "grammar": grammar,
                        "pos": pos, "source_record_id": row['id'] + ':' + str(d['sense_no']), "tags": [], "examples": [], "relations": {}})
                entries.append({"lang": "ml", "word": row['word'], "source": "datuk", "source_url": "https://github.com/knadh/datuk", "license": "ODbL-1.0",
                    "pos": next((s['pos'] for s in senses if s['pos']), ''), "roman": "", "ipa": "", "etymology": row['origin'] or '', "senses": senses, "relations": {}})
            if entries:
                return {"entries": entries, "via": 'headword' if form == word else 'morphological analysis'}
        return {"entries": [], "via": None}

    def stats(self):
        return {"entries": {"ml": self.db.execute('SELECT COUNT(*) FROM entries').fetchone()[0]},
            "definitions": self.db.execute('SELECT COUNT(*) FROM definitions').fetchone()[0], "license": "ODbL-1.0"}
