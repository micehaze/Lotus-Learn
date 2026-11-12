"""Index attested Tamil and Telugu forms with a short, attributed Wikipedia excerpt."""
import argparse
import re
import sqlite3
import textwrap
import unicodedata
from contextlib import closing
from pathlib import Path

from import_native_wiktionary import pages

SCHEMA = """
CREATE TABLE passages(id INTEGER PRIMARY KEY, article TEXT NOT NULL, excerpt TEXT NOT NULL);
CREATE TABLE words(lang TEXT NOT NULL, word TEXT NOT NULL, passage_id INTEGER NOT NULL REFERENCES passages(id),
  PRIMARY KEY(lang,word)) WITHOUT ROWID;
"""
SCRIPT = {"ta": re.compile(r"[\u0B80-\u0BFF]+"), "te": re.compile(r"[\u0C00-\u0C7F]+")}
BLOCKS = re.compile(r"<!--.*?-->|<ref\b[^>]*/>|<(ref|gallery|math)\b[^>]*>.*?</\1>|\{\|.*?\|\}", re.I | re.S)
TEMPLATES = re.compile(r"\{\{[^{}]*\}\}")
LINKS = re.compile(r"\[\[([^\[\]]+)\]\]")


def visible_link(match):
    target, _, label = match[1].partition("|")
    return "" if ":" in target else label or target


def excerpts(text):
    text = BLOCKS.sub(" ", text)
    for _ in range(10):
        text, removed = TEMPLATES.subn(" ", text)
        if not removed:
            break
    for line in text.splitlines():
        if line.lstrip().startswith(("=", "*", "#", ":", "|", "!", ";")) or len(line) < 35:
            continue
        line = LINKS.sub(visible_link, line)
        if any(markup in line for markup in ("[[", "]]", "{{", "}}", "<", ">", "http:","https:")):
            continue
        line = " ".join(line.replace("'''", "").replace("''", "").split())
        for sentence in re.split(r"(?<=[.!?।])\s+", line):
            for excerpt in textwrap.wrap(sentence, 300, break_long_words=False, break_on_hyphens=False):
                if 35 <= len(excerpt) <= 300:
                    yield unicodedata.normalize("NFC", excerpt)


def build(output, dumps, limit=None):
    if output.exists():
        raise SystemExit(f"Choose a new output path: {output}")
    with closing(sqlite3.connect(output)) as db:
        db.executescript(SCHEMA)
        for lang, dump in dumps.items():
            seen = set()
            for title, text in pages(dump):
                for excerpt in excerpts(text):
                    tokens = SCRIPT[lang].findall(excerpt)
                    if len(tokens) < 4 or sum(map(len, tokens)) < len(excerpt) * 0.65:
                        continue
                    fresh = {word for word in tokens if word not in seen
                             and unicodedata.category(word[0]).startswith("L")
                             and sum(unicodedata.category(char).startswith("L") for char in word) >= 3
                             and all(unicodedata.category(char)[0] in "LM" for char in word)}
                    if fresh:
                        new_words = sorted(fresh)
                        if limit is not None:
                            new_words = new_words[:limit - len(seen)]
                        row = db.execute("INSERT INTO passages(article,excerpt) VALUES(?,?)", (title, excerpt)).lastrowid
                        db.executemany("INSERT INTO words VALUES(?,?,?)", ((lang, word, row) for word in new_words))
                        seen.update(new_words)
                        if limit is not None and len(seen) >= limit:
                            break
                if limit is not None and len(seen) >= limit:
                    break
            db.commit()
            print(f"{lang}: {len(seen):,} distinct attested forms", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=650_000, help="Maximum distinct forms per language")
    for lang in SCRIPT:
        parser.add_argument(f"--{lang}", type=Path, required=True)
    args = parser.parse_args()
    if args.limit < 1:
        parser.error("--limit must be positive")
    build(args.output, {lang: getattr(args, lang) for lang in SCRIPT}, limit=args.limit)
