"""Offline lexicon built from Kaikki.org (Wiktionary extracts, CC BY-SA) and Wikidata Lexemes (CC0).

The index is a single SQLite file. It is built once by setup_local_dictionary.py and only read at runtime,
so dictionary look-ups work with the internet disconnected.
"""
import bz2
import gzip
import io
import json
import re
import sqlite3
import time
from collections import defaultdict

from .langs import LANGS, LEARNING, NAME_TO_CODE, WIKIDATA_LANG, LEXICAL_CATEGORY, POS, norm

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY, lang TEXT, word TEXT, norm TEXT, pos TEXT, roman TEXT, ipa TEXT,
  etymology TEXT, source TEXT, UNIQUE(lang, word, pos, source, etymology));
CREATE INDEX IF NOT EXISTS ix_entries ON entries(lang, norm);
CREATE TABLE IF NOT EXISTS senses (id INTEGER PRIMARY KEY, entry_id INTEGER, idx INTEGER, gloss TEXT, tags TEXT, item TEXT);
CREATE INDEX IF NOT EXISTS ix_senses ON senses(entry_id);
CREATE INDEX IF NOT EXISTS ix_senses_item ON senses(item);
CREATE TABLE IF NOT EXISTS examples (sense_id INTEGER, text TEXT, english TEXT, roman TEXT, UNIQUE(sense_id, text));
CREATE TABLE IF NOT EXISTS relations (entry_id INTEGER, sense_id INTEGER, kind TEXT, word TEXT, note TEXT, UNIQUE(entry_id, sense_id, kind, word));
CREATE TABLE IF NOT EXISTS forms (lang TEXT, form_norm TEXT, form TEXT, entry_id INTEGER, tags TEXT, UNIQUE(lang, form_norm, entry_id));
CREATE INDEX IF NOT EXISTS ix_forms ON forms(lang, form_norm);
CREATE TABLE IF NOT EXISTS gloss_index (lang TEXT, term TEXT, entry_id INTEGER, sense_id INTEGER, weight INTEGER, UNIQUE(lang, term, sense_id));
CREATE INDEX IF NOT EXISTS ix_gloss ON gloss_index(lang, term);
CREATE TABLE IF NOT EXISTS translations (en_norm TEXT, en_word TEXT, en_pos TEXT, sense TEXT, lang TEXT, word TEXT, roman TEXT, source TEXT,
  UNIQUE(en_norm, sense, lang, word, source));
CREATE INDEX IF NOT EXISTS ix_tr ON translations(en_norm, lang);
CREATE INDEX IF NOT EXISTS ix_tr_rev ON translations(lang, word);
CREATE VIRTUAL TABLE IF NOT EXISTS sense_search USING fts5(gloss, lang UNINDEXED, entry_id UNINDEXED, sense_id UNINDEXED);
"""

ATTRIBUTION = [
    {"source": "Wiktionary via Kaikki.org", "license": "CC BY-SA 4.0 (and GFDL)", "url": "https://kaikki.org/",
     "note": "Definitions, forms, examples and relations extracted from Wiktionary by wiktextract (Ylonen, LREC 2022)."},
    {"source": "Wikidata Lexemes", "license": "CC0 1.0", "url": "https://www.wikidata.org/wiki/Wikidata:Lexicographical_data"},
]
SKIP_FORM_TAGS = {"romanization", "table-tags", "inflection-template", "class", "canonical", "transliteration"}
LANG_NAMES = {v[1]: k for k, v in LANGS.items()}


def gloss_terms(gloss: str):
    """English look-up keys for a gloss: the whole short gloss and each ;/, separated part, without 'to '/'a '."""
    out = []
    for part in [gloss] + [p for chunk in gloss.split(";") for p in chunk.split(",")]:
        p = norm(part.split("(")[0])
        for prefix in ("to ", "a ", "an ", "the "):
            if p.startswith(prefix):
                p = p[len(prefix):]
        if p and len(p) <= 40:
            out.append(p)
    return list(dict.fromkeys(out))


class Lexicon:
    def __init__(self, path):
        self.path = str(path)
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)

    # ------------------------------------------------------------------ building
    def set_meta(self, key, value):
        self.db.execute("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, json.dumps(value)))

    def meta(self):
        return {r["key"]: json.loads(r["value"]) for r in self.db.execute("SELECT key, value FROM meta")}

    def import_kaikki_lines(self, lines, lang=None, english_translations_only=False, source="wiktionary"):
        """Import Kaikki JSONL lines. For non-English entries everything is stored; for English entries only the
        translations into ta/ml/kn/te/hi are kept (that is what makes English→Indic look-ups rich)."""
        n = 0
        cur = self.db.cursor()
        for raw in lines:
            if not raw:
                continue
            try:
                e = json.loads(raw)
            except ValueError:
                continue
            code = e.get("lang_code") or NAME_TO_CODE.get(e.get("lang"))
            word = e.get("word")
            if not word:
                continue
            pos = POS.get(e.get("pos", ""), e.get("pos", "") or "")
            if code == "en":
                for t in e.get("translations") or []:
                    tc = t.get("code") or LANG_NAMES.get(t.get("lang"))
                    if tc in ("ta", "ml", "kn", "te", "hi") and t.get("word"):
                        cur.execute("INSERT OR IGNORE INTO translations VALUES (?,?,?,?,?,?,?,?)",
                                    (norm(word), word, pos, (t.get("sense") or "")[:200], tc, t["word"].strip(), t.get("roman") or "", source))
                        n += 1
                continue
            if english_translations_only or (lang and code != lang) or code not in LANGS:
                continue
            roman = next((f.get("form") for f in e.get("forms") or [] if "romanization" in (f.get("tags") or [])), "")
            ipa = next((s.get("ipa") for s in e.get("sounds") or [] if s.get("ipa")), "")
            ety = (e.get("etymology_text") or "")[:400]
            cur.execute("INSERT OR IGNORE INTO entries(lang, word, norm, pos, roman, ipa, etymology, source) VALUES (?,?,?,?,?,?,?,?)",
                        (code, word, norm(word), pos, roman, ipa, ety, source))
            eid = cur.execute("SELECT id FROM entries WHERE lang=? AND word=? AND pos=? AND source=? AND etymology=?", (code, word, pos, source, ety)).fetchone()[0]
            for kind in ("synonyms", "antonyms", "related", "derived", "coordinate_terms"):
                for r in e.get(kind) or []:
                    if r.get("word"):
                        cur.execute("INSERT OR IGNORE INTO relations VALUES (?,?,?,?,?)", (eid, None, kind.rstrip("s").replace("coordinate_term", "coordinate"), r["word"], r.get("sense") or ""))
            for f in e.get("forms") or []:
                tags = set(f.get("tags") or [])
                if f.get("form") and not (tags & SKIP_FORM_TAGS) and f["form"] != word:
                    cur.execute("INSERT OR IGNORE INTO forms VALUES (?,?,?,?,?)", (code, norm(f["form"]), f["form"], eid, ",".join(sorted(tags))))
            for i, s in enumerate(e.get("senses") or []):
                glosses = s.get("glosses") or s.get("raw_glosses") or []
                if not glosses:
                    continue
                gloss = glosses[-1].strip()
                cur.execute("INSERT INTO senses(entry_id, idx, gloss, tags) VALUES (?,?,?,?)", (eid, i, gloss[:500], ",".join(s.get("tags") or [])))
                sid = cur.lastrowid
                for t in gloss_terms(gloss):
                    cur.execute("INSERT OR IGNORE INTO gloss_index VALUES (?,?,?,?,?)", (code, t, eid, sid, 3 if t == norm(gloss.split("(")[0]).removeprefix("to ") else 2))
                for ex in s.get("examples") or []:
                    if ex.get("text") and ex.get("type", "example") != "quotation" or (ex.get("text") and ex.get("english")):
                        cur.execute("INSERT OR IGNORE INTO examples VALUES (?,?,?,?)", (sid, ex["text"][:400], (ex.get("english") or ex.get("translation") or "")[:400], ex.get("roman") or ""))
                for kind in ("synonyms", "antonyms", "related"):
                    for r in s.get(kind) or []:
                        if r.get("word"):
                            cur.execute("INSERT OR IGNORE INTO relations VALUES (?,?,?,?,?)", (eid, sid, kind.rstrip("s"), r["word"], r.get("sense") or ""))
                # Wiktionary inflected-form entries ("locative singular of X") point to their lemma
                for fo in s.get("form_of") or []:
                    if fo.get("word"):
                        cur.execute("INSERT OR IGNORE INTO forms VALUES (?,?,?,?,?)", (code, norm(word), word, eid, "form-of:" + fo["word"]))
            n += 1
        self.db.commit()
        return n

    def import_lexemes(self, stream, max_items=None):
        """Import Wikidata Lexemes (JSON dump lines) for en/ta/ml/kn/te/hi. Senses keep their 'item for this sense'
        (P5137) so meanings can be matched across languages; P5973 synonyms and P5974 antonyms are kept."""
        n = 0
        cur = self.db.cursor()
        sense_ids = {}
        pending_rel = []
        for raw in stream:
            raw = raw.strip().rstrip(",")
            if not raw.startswith("{"):
                continue
            try:
                lx = json.loads(raw)
            except ValueError:
                continue
            code = WIKIDATA_LANG.get(lx.get("language"))
            if not code:
                continue
            lemma = next((v["value"] for v in (lx.get("lemmas") or {}).values()), None)
            if not lemma:
                continue
            pos = LEXICAL_CATEGORY.get(lx.get("lexicalCategory"), "")
            if code == "en":
                # English lexemes contribute translations (P5972) only
                for s in lx.get("senses") or []:
                    for c in (s.get("claims") or {}).get("P5972", []):
                        sid_target = (c.get("mainsnak", {}).get("datavalue") or {}).get("value", {}).get("id")
                        if sid_target:
                            pending_rel.append(("translation-en", lemma, pos, (s.get("glosses", {}).get("en") or {}).get("value", ""), sid_target))
                continue
            cur.execute("INSERT OR IGNORE INTO entries(lang, word, norm, pos, roman, ipa, etymology, source) VALUES (?,?,?,?,?,?,?,?)",
                        (code, lemma, norm(lemma), pos, "", "", lx.get("id", ""), "wikidata"))
            eid = cur.execute("SELECT id FROM entries WHERE lang=? AND word=? AND pos=? AND source='wikidata' AND etymology=?", (code, lemma, pos, lx.get("id", ""))).fetchone()[0]
            for f in lx.get("forms") or []:
                rep = next((v["value"] for v in (f.get("representations") or {}).values()), None)
                if rep and rep != lemma:
                    cur.execute("INSERT OR IGNORE INTO forms VALUES (?,?,?,?,?)", (code, norm(rep), rep, eid, ",".join(f.get("grammaticalFeatures") or [])))
            for i, s in enumerate(lx.get("senses") or []):
                gloss = (s.get("glosses", {}).get("en") or {}).get("value") or ""
                claims = s.get("claims") or {}
                item = next(((c.get("mainsnak", {}).get("datavalue") or {}).get("value", {}).get("id") for c in claims.get("P5137", [])), None)
                if not gloss and not item:
                    continue
                cur.execute("INSERT INTO senses(entry_id, idx, gloss, tags, item) VALUES (?,?,?,?,?)", (eid, i, gloss[:500], "", item))
                sid = cur.lastrowid
                sense_ids[s.get("id")] = (sid, eid, code, lemma)
                for t in gloss_terms(gloss) if gloss else []:
                    cur.execute("INSERT OR IGNORE INTO gloss_index VALUES (?,?,?,?,?)", (code, t, eid, sid, 2))
                for prop, kind in (("P5973", "synonym"), ("P5974", "antonym")):
                    for c in claims.get(prop, []):
                        tid = (c.get("mainsnak", {}).get("datavalue") or {}).get("value", {}).get("id")
                        if tid:
                            pending_rel.append((kind, eid, sid, tid, None))
            n += 1
            if max_items and n >= max_items:
                break
        for kind, a, b, c, d in pending_rel:
            if kind == "translation-en":  # (kind, english lemma, pos, english gloss, target sense id)
                target = sense_ids.get(d)
                if target:
                    _, _, tcode, tlemma = target
                    cur.execute("INSERT OR IGNORE INTO translations VALUES (?,?,?,?,?,?,?,?)", (norm(a), a, b, (c or "")[:200], tcode, tlemma, "", "wikidata"))
            else:
                target = sense_ids.get(c)
                if target:
                    cur.execute("INSERT OR IGNORE INTO relations VALUES (?,?,?,?,?)", (a, b, kind, target[3], "Wikidata"))
        self.db.commit()
        return n

    # ------------------------------------------------------------------ queries
    def _entry(self, row):
        eid = row["id"]
        senses = []
        for s in self.db.execute("SELECT * FROM senses WHERE entry_id = ? ORDER BY idx", (eid,)):
            ex = [dict(text=e["text"], english=e["english"], roman=e["roman"]) for e in self.db.execute("SELECT * FROM examples WHERE sense_id = ?", (s["id"],))]
            rel = defaultdict(list)
            for r in self.db.execute("SELECT kind, word, note FROM relations WHERE sense_id = ?", (s["id"],)):
                rel[r["kind"]].append({"word": r["word"], "note": r["note"]})
            senses.append({"gloss": s["gloss"], "tags": [t for t in (s["tags"] or "").split(",") if t], "item": s["item"], "examples": ex, "relations": dict(rel)})
        rel = defaultdict(list)
        for r in self.db.execute("SELECT kind, word, note FROM relations WHERE entry_id = ? AND sense_id IS NULL", (eid,)):
            rel[r["kind"]].append({"word": r["word"], "note": r["note"]})
        return {"lang": row["lang"], "word": row["word"], "pos": row["pos"], "roman": row["roman"], "ipa": row["ipa"],
                "etymology": row["etymology"] if row["source"] != "wikidata" else "", "source": row["source"],
                "senses": senses, "relations": dict(rel)}

    def lookup_native(self, word, lang, candidates=()):
        """Exact headword → inflected form (Wiktionary/Wikidata forms) → caller-supplied lemma candidates."""
        q = norm(word)
        rows = list(self.db.execute("SELECT * FROM entries WHERE lang = ? AND norm = ?", (lang, q)))
        via = "headword"
        if not rows:
            f = list(self.db.execute("SELECT e.*, f.tags AS ftags FROM forms f JOIN entries e ON e.id = f.entry_id WHERE f.lang = ? AND f.form_norm = ?", (lang, q)))
            lemmas = [t.split(":", 1)[1] for r in f for t in (r["ftags"] or "").split(",") if t.startswith("form-of:")]
            rows = [r for r in f if not (r["ftags"] or "").startswith("form-of:")]
            for lm in lemmas:
                rows += list(self.db.execute("SELECT * FROM entries WHERE lang = ? AND norm = ?", (lang, norm(lm))))
            via = "inflected form" if rows else via
        if not rows:
            for c in candidates or ():
                rows = list(self.db.execute("SELECT * FROM entries WHERE lang = ? AND norm = ?", (lang, norm(c))))
                if rows:
                    via = "morphological analysis"
                    break
        entries = [self._entry(r) for r in rows]
        entries = [e for e in entries if e["senses"]] or entries
        return {"query": word, "lang": lang, "via": via if entries else None, "entries": entries}

    def lookup_english(self, word, lang, limit=12):
        """English → native: Wiktionary translation tables, Wikidata translations, then reverse gloss index."""
        q = norm(word)
        q2 = q[3:] if q.startswith("to ") else q
        seen, out = set(), []
        for r in self.db.execute("SELECT * FROM translations WHERE en_norm IN (?, ?) AND lang = ? ORDER BY CASE source WHEN 'wiktionary' THEN 0 ELSE 1 END", (q, q2, lang)):
            key = norm(r["word"])
            if key in seen:
                continue
            seen.add(key)
            out.append({"native": r["word"], "roman": r["roman"], "english": word, "sense": r["sense"], "pos": r["en_pos"], "basis": f"{r['source']} translation table", "score": 100})
        for r in self.db.execute("""SELECT g.weight, e.word, e.roman, e.pos, s.gloss, e.source FROM gloss_index g JOIN entries e ON e.id = g.entry_id
                                    JOIN senses s ON s.id = g.sense_id WHERE g.lang = ? AND g.term = ? ORDER BY g.weight DESC, e.id LIMIT 40""", (lang, q2)):
            key = norm(r["word"])
            if key in seen:
                continue
            seen.add(key)
            out.append({"native": r["word"], "roman": r["roman"], "english": r["gloss"], "sense": r["gloss"], "pos": r["pos"], "basis": f"{r['source']} definition", "score": 60 + 10 * r["weight"]})
        # Definitions such as "a rural village or settlement" used to be invisible.
        # Phrase matching respects word boundaries; never match "craft" inside "aircraft".
        if len(out) < limit and re.search(r"[a-z]", q2):
            phrase = '"' + q2.replace('"', '""') + '"'
            rows = self.db.execute("""SELECT e.word, e.roman, e.pos, e.source, f.gloss
                FROM sense_search f JOIN entries e ON e.id=f.entry_id
                WHERE sense_search MATCH ? AND f.lang=? ORDER BY rank LIMIT 60""", (phrase, lang))
            for r in rows:
                key = norm(r["word"])
                if key not in seen:
                    seen.add(key)
                    out.append({"native": r["word"], "roman": r["roman"], "english": r["gloss"], "sense": r["gloss"],
                        "pos": r["pos"], "basis": f"{r['source']} definition context", "score": 45})
        return out[:limit]

    def rebuild_search(self):
        self.db.execute("DELETE FROM sense_search")
        self.db.execute("INSERT INTO sense_search(gloss,lang,entry_id,sense_id) SELECT s.gloss,e.lang,e.id,s.id FROM senses s JOIN entries e ON e.id=s.entry_id")
        self.db.commit()

    def similar(self, word, lang, limit=8):
        """Spelling neighbours, explicitly not claims of synonymy or identical pronunciation."""
        from difflib import SequenceMatcher
        rows = self.db.execute("""SELECT e.word, e.roman, (SELECT gloss FROM senses WHERE entry_id=e.id LIMIT 1) AS gloss
            FROM entries e WHERE lang=? AND word!=? AND length(word) BETWEEN ? AND ? AND substr(word,1,1)=?
            LIMIT 1800""", (lang, word, max(1, len(word)-2), len(word)+2, word[:1]))
        candidates = []
        seen = set()
        for r in rows:
            score = SequenceMatcher(None, word, r["word"]).ratio()
            if score >= .55 and r["word"] not in seen and r["gloss"]:
                seen.add(r["word"])
                candidates.append({"native": r["word"], "english": r["gloss"], "roman": r["roman"], "similarity": round(score, 2), "kind": "similar spelling"})
        return sorted(candidates, key=lambda x: -x["similarity"])[:limit]

    def equivalents(self, word, lang, targets, gloss=""):
        """Sense-preserving equivalents: Wikidata 'item for this sense' links, then English-pivot through glosses."""
        q = norm(word)
        out = defaultdict(list)
        items = [r["item"] for r in self.db.execute("SELECT s.item FROM senses s JOIN entries e ON e.id = s.entry_id WHERE e.lang = ? AND e.norm = ? AND s.item IS NOT NULL", (lang, q))]
        for it in items:
            for r in self.db.execute("SELECT e.lang, e.word, s.gloss FROM senses s JOIN entries e ON e.id = s.entry_id WHERE s.item = ? AND e.lang != ?", (it, lang)):
                if r["lang"] in targets:
                    out[r["lang"]].append({"native": r["word"], "english": r["gloss"], "basis": f"Wikidata sense link ({it})"})
        glosses = [gloss] if gloss else [r["gloss"] for r in self.db.execute("SELECT s.gloss FROM senses s JOIN entries e ON e.id = s.entry_id WHERE e.lang = ? AND e.norm = ? ORDER BY s.idx LIMIT 2", (lang, q))]
        for g in glosses:
            for term in gloss_terms(g)[:2]:
                for t in targets:
                    if out.get(t):
                        continue
                    for hit in self.lookup_english(term, t, limit=3):
                        out[t].append({"native": hit["native"], "english": term, "basis": f"via English “{term}” ({hit['basis']})"})
        return {k: v[:4] for k, v in out.items()}

    def stats(self):
        per = {r["lang"]: r["n"] for r in self.db.execute("SELECT lang, COUNT(*) AS n FROM entries GROUP BY lang")}
        tr = {r["lang"]: r["n"] for r in self.db.execute("SELECT lang, COUNT(*) AS n FROM translations GROUP BY lang")}
        return {"entries": per, "english_translations": tr, "forms": self.db.execute("SELECT COUNT(*) FROM forms").fetchone()[0], "meta": self.meta()}


def open_text_stream(path_or_file):
    """Line iterator over .jsonl, .jsonl.gz or .json.bz2 files (streamed — never loaded fully into memory)."""
    p = str(path_or_file)
    if p.endswith(".gz"):
        return io.TextIOWrapper(gzip.open(p, "rb"), encoding="utf-8")
    if p.endswith(".bz2"):
        return io.TextIOWrapper(bz2.open(p, "rb"), encoding="utf-8")
    return open(p, "r", encoding="utf-8")


def build_info(lexicon, sources):
    lexicon.set_meta("built_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    lexicon.set_meta("sources", sources)
    lexicon.set_meta("attribution", ATTRIBUTION)
    lexicon.db.commit()
