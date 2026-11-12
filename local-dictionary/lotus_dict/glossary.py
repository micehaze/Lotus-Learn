"""Sense- and direction-preserving glossary index. Hindi links are never automatic synonyms."""
import json
import sqlite3
from .langs import norm

SCHEMA = """
CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY, source_word TEXT, source_norm TEXT, source_lang TEXT,
 target_word TEXT,target_norm TEXT,target_lang TEXT,domain TEXT,pos TEXT,sense TEXT,dataset TEXT,source_url TEXT,license TEXT,
 UNIQUE(source_norm,source_lang,target_norm,target_lang,domain,pos,sense,dataset));
CREATE INDEX IF NOT EXISTS glossary_forward ON records(source_lang,source_norm,target_lang);
CREATE INDEX IF NOT EXISTS glossary_reverse ON records(target_lang,target_norm,source_lang);
"""


class Glossary:
    def __init__(self, path):
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)

    def import_records(self, records, *, dataset, license, source_url):
        if not license or license.lower() in ('unknown', 'unspecified'):
            raise ValueError('A dataset-specific reuse license is required; the repository code license is insufficient.')
        with self.db:
            for r in records:
                values = (str(r['source_word']).strip(), norm(r['source_word']), r['source_lang'], str(r['target_word']).strip(), norm(r['target_word']),
                    r['target_lang'], r.get('domain', ''), r.get('pos', ''), r.get('sense', ''), dataset, source_url, license)
                if not values[0] or not values[3]:
                    continue
                self.db.execute('INSERT OR IGNORE INTO records(source_word,source_norm,source_lang,target_word,target_norm,target_lang,domain,pos,sense,dataset,source_url,license) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', values)

    def lookup(self, word, source, target):
        out = []
        for reverse in (False, True):
            rows = self.db.execute('SELECT * FROM records WHERE ' + ('target_lang=? AND target_norm=? AND source_lang=?' if reverse else 'source_lang=? AND source_norm=? AND target_lang=?') + ' LIMIT 30', (source, norm(word), target))
            for row in rows:
                r = dict(row)
                out.append({"native": r['source_word'] if reverse else r['target_word'], "english": word if source == 'en' else (r['source_word'] if reverse else r['target_word']),
                    "sense": r['sense'], "pos": r['pos'], "domain": r['domain'], "basis": 'indic-glossaries: ' + r['dataset'], "score": 105,
                    "provenance": {**r, "lookup_direction": 'reverse' if reverse else 'forward', "reverse_is_sense_candidate": reverse}})
        return out

    def stats(self):
        return [dict(r) for r in self.db.execute('SELECT dataset,source_lang,target_lang,license,COUNT(*) AS records FROM records GROUP BY dataset,source_lang,target_lang,license')]
