"""Build Alar/Olam indexes separately; source files and licenses stay redistributable."""
import io
import json
import re
import sys
import tarfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "tools/vendor"), str(ROOT / "local-dictionary")]
import yaml
from lotus_dict.lexicon import Lexicon, build_info
from lotus_dict.langs import in_script, norm

HOME = ROOT / "local-dictionary/data"
SRC = HOME / "sources"


def build_alar():
    lex = Lexicon(HOME / "alar.db")
    if lex.meta().get("complete"):
        return
    # C safe loader avoids code execution from YAML tags.
    with open(SRC / "alar.yml", encoding="utf8") as f:
        data = yaml.load(f, Loader=getattr(yaml, "CSafeLoader", yaml.SafeLoader))
    def lines():
        for e in data:
            word = str(e.get("entry", ""))
            if not in_script(word, "kn"):
                continue
            yield json.dumps({"word": word, "lang_code": "kn", "pos": (e.get("defs") or [{}])[0].get("type", "noun"),
                "etymology_text": "Alar entry " + str(e["id"]),
                "forms": [{"form": e.get("phone", ""), "tags": ["romanization"]}],
                "senses": [{"glosses": [str(d.get("entry", ""))]} for d in e.get("defs", []) if d.get("entry")]}, ensure_ascii=False)
    n = lex.import_kaikki_lines(lines(), lang="kn", source="alar")
    lex.rebuild_search()
    build_info(lex, [{"source": "V. Krishna's Alar", "url": "https://github.com/alar-dict/data", "license": "ODbL-1.0", "records": n}])
    lex.set_meta("complete", True); lex.db.commit()
    print("Alar", n, flush=True)


def build_olam():
    lex = Lexicon(HOME / "olam.db")
    if lex.meta().get("complete"):
        return
    pos = {"n": "noun", "v": "verb", "a": "adjective", "adj": "adjective", "adv": "adverb", "pron": "pronoun"}
    def lines():
        with tarfile.open(SRC / "enml.tar.gz") as archive:
            member = next(x for x in archive.getmembers() if x.isfile() and x.name.endswith("enml"))
            with io.TextIOWrapper(archive.extractfile(member), encoding="utf8") as f:
                next(f)
                for row in f:
                    parts = row.rstrip("\n").split("\t")
                    if len(parts) != 3:
                        continue
                    en, tag, native = [x.strip() for x in parts]
                    if not in_script(native, "ml") or not re.search("[A-Za-z]", en):
                        continue
                    p = pos.get(tag.strip("{}"), "noun")
                    lex.db.execute("INSERT OR IGNORE INTO translations VALUES (?,?,?,?,?,?,?,?)", (norm(en), en, p, en, "ml", native, "", "olam"))
                    yield json.dumps({"word": native, "lang_code": "ml", "pos": p, "senses": [{"glosses": [en]}]}, ensure_ascii=False)
    n = lex.import_kaikki_lines(lines(), lang="ml", source="olam")
    lex.rebuild_search()
    build_info(lex, [{"source": "Olam English-Malayalam corpus", "url": "https://olam.in/p/open/enml", "license": "ODbL-1.0", "records": n}])
    lex.set_meta("complete", True); lex.db.commit()
    print("Olam", n, flush=True)


if __name__ == "__main__":
    build_alar()
    build_olam()
    lex = Lexicon(HOME / "lexicon.db"); lex.rebuild_search()
    print("All search indexes built.")
