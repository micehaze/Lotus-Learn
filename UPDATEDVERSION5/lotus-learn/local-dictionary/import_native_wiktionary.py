"""Build a separate dictionary index from Tamil and Telugu Wiktionary XML dumps."""
import argparse
import bz2
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from lotus_dict.langs import in_script, norm
from lotus_dict.lexicon import Lexicon


def pages(path):
    with bz2.open(path, "rb") as stream:
        events = ET.iterparse(stream, events=("start", "end"))
        _, root = next(events)
        for event, page in events:
            if event != "end" or not page.tag.endswith("}page"):
                continue
            if page.findtext("{*}ns") == "0" and page.find("{*}redirect") is None:
                yield page.findtext("{*}title", ""), page.findtext("{*}revision/{*}text", "")
            root.remove(page)


def definitions(text, lang):
    text = re.sub(r"<!--.*?-->|<ref\b[^>]*/>|<ref\b[^>]*>.*?</ref>", "", text, flags=re.S)
    section = False
    for line in text.splitlines():
        line = line.strip()
        if lang == "ta":
            marker = re.match(r"^\{\{(பொருள்|விளக்கம்|மொழிபெயர்ப்பு(?:கள்)?|சொல் வளப்பகுதி)\s*(?:\||\}\})", line)
            if marker:
                section = marker[1] in {"பொருள்", "விளக்கம்"}
                continue
        heading = re.fullmatch(r"\s*={2,}\s*(.*?)\s*={2,}\s*", line)
        if heading:
            label = heading[1]
            section = any(part in label for part in (
                ("பொருள்", "விளக்கம்", "பெயர்ச்சொல்", "வினைச்சொல்") if lang == "ta"
                else ("అర్థ", "అర్ధ", "అర్థము", "అర్ధము")
            ))
            continue
        if not line or line.startswith(("#:", "#*", "{{", "|", "<", ";", "[[பகுப்பு:", "[[వర్గం:", "[[File:")):
            continue
        if not section and (lang != "ta" or not line.startswith("#")):
            continue
        if line.startswith(("*:", "**")):
            continue
        line = re.sub(r"\[\[([^\[\]]+)\]\]", lambda m: m[1].rsplit("|", 1)[-1], line)
        line = re.sub(r"\{\{[^{}]*\}\}|<[^>]+>|'{2,}", "", line)
        line = " ".join(line.lstrip("#* :").split())
        if 2 <= len(line) <= 800 and in_script(line, lang) and not any(c in line for c in "{}[]"):
            yield line


def reverse_words(title, text, lang):
    if not re.fullmatch(r"[A-Za-z][A-Za-z' -]{1,45}", title):
        return
    headings = re.split(r"(?m)^==(?!=)\s*(.*?)\s*(?<![=])==\s*$", text)
    for heading, section in zip(headings[1::2], headings[2::2]):
        if lang == "ta" and heading != "ஆங்கிலம்":
            continue
        if lang == "te" and not heading.startswith("బ్రౌను నిఘంటువు నుండి"):
            continue
        for line in section.splitlines():
            line = line.strip()
            if lang == "ta" and not re.match(r"^[#*](?![#*:])", line):
                continue
            if lang == "te":
                if not re.match(r"^(?:\*\s*)?'''(?:నామవాచక|క్రియ|విశేషణ|అవ్యయ|సర్వనామ)", line):
                    continue
                line = re.sub(r"'''[^']+'''", "", line)
            if "{{" in line or "[[File:" in line:
                continue
            line = re.sub(r"\[\[([^\[\]]+)\]\]", lambda m: m[1].rsplit("|", 1)[-1], line)
            line = re.sub(r"\([^()]*\)|'{2,}", "", line)
            for part in re.split(r"[,;]", line):
                word = " ".join(part.strip("#* .\t").split())
                if (len(word) >= 2 and len(word.split()) <= 2 and in_script(word, lang, min_ratio=1)
                        and not any(c in word for c in "[]{}:<>|/0123456789")):
                    yield word


def build(output, dumps):
    if output.exists():
        raise SystemExit(f"Choose a new output file: {output} already exists.")
    lexicon = Lexicon(output)
    with lexicon.db:
        for lang, path in dumps.items():
            imported = 0
            english = {}
            for title, text in pages(path):
                for word in reverse_words(title, text, lang):
                    english.setdefault(word, set()).add(title)
                if not in_script(title, lang, min_ratio=1) or any(c in title for c in ":/()0123456789"):
                    continue
                glosses = list(dict.fromkeys(definitions(text, lang)))[:8]
                if not glosses:
                    continue
                entry = lexicon.db.execute(
                    "INSERT INTO entries(lang,word,norm,pos,roman,ipa,etymology,source) VALUES(?,?,?,?,?,?,?,?)",
                    (lang, title, norm(title), "", "", "", "", "native-wiktionary"),
                ).lastrowid
                lexicon.db.executemany(
                    "INSERT INTO senses(entry_id,idx,gloss,tags) VALUES(?,?,?,?)",
                    ((entry, idx, gloss, "native-definition") for idx, gloss in enumerate(glosses)),
                )
                imported += 1
            for word, glosses in english.items():
                lexicon.db.execute(
                    "INSERT OR IGNORE INTO entries(lang,word,norm,pos,roman,ipa,etymology,source) VALUES(?,?,?,?,?,?,?,?)",
                    (lang, word, norm(word), "", "", "", "", "native-wiktionary"),
                )
                entry = lexicon.db.execute("SELECT id FROM entries WHERE lang=? AND word=?", (lang, word)).fetchone()[0]
                lexicon.db.executemany(
                    "INSERT INTO senses(entry_id,idx,gloss,tags) VALUES(?,?,?,?)",
                    ((entry, idx - len(glosses), gloss, "reverse-translation") for idx, gloss in enumerate(sorted(glosses))),
                )
                lexicon.db.executemany(
                    "INSERT OR IGNORE INTO translations VALUES(?,?,?,?,?,?,?,?)",
                    ((norm(gloss), gloss, "", "", lang, word, "", "native-wiktionary") for gloss in glosses),
                )
            print(f"{lang}: {imported:,} pages with definitions; {len(english):,} reverse headwords", flush=True)
    lexicon.db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    for code in ("ta", "te"):
        parser.add_argument(f"--{code}", type=Path)
    args = parser.parse_args()
    dumps = {lang: getattr(args, lang) for lang in ("ta", "te") if getattr(args, lang)}
    if not dumps:
        parser.error("provide at least one Wiktionary XML dump")
    build(args.output, dumps)
