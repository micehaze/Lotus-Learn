#!/usr/bin/env python3
"""One-time setup for the free, local LotusLearn dictionary.

  1. Detects RAM / CPU / GPU / VRAM / disk and chooses model sizes (see --dry-run).
  2. Downloads IndicTrans2 models from Hugging Face (free; no account normally needed — if a model page asks you to
     accept terms, run `huggingface-cli login` with a free account; no billing is involved).
  3. Downloads Kaikki.org (Wiktionary) data for Tamil, Malayalam, Kannada, Telugu and, if disk allows, streams the
     English dictionary to keep only its translation tables.
  4. Streams the Wikidata Lexemes dump and keeps en/ta/ml/kn/te/hi lexemes.
  5. Builds data/lexicon.db and pulls the chosen Ollama model.
Everything afterwards runs offline.
"""
import argparse
import bz2
import gzip
import json
import shutil
import subprocess
import sys
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from lotus_dict.hardware import detect, plan  # noqa: E402
from lotus_dict.lexicon import Lexicon, build_info, open_text_stream  # noqa: E402
from lotus_dict.translator import MODELS  # noqa: E402

KAIKKI = {"ta": "Tamil", "ml": "Malayalam", "kn": "Kannada", "te": "Telugu", "en": "English"}
KAIKKI_URLS = ["https://kaikki.org/dictionary/{name}/kaikki.org-dictionary-{name}.jsonl",
               "https://kaikki.org/dictionary/{name}/kaikki.org-dictionary-{name}.jsonl.gz"]
LEXEMES_URL = "https://dumps.wikimedia.org/wikidatawiki/entities/latest-lexemes.json.bz2"
UA = {"User-Agent": "LotusLearn-local-dictionary/1.0 (offline language-learning app)"}


def http_lines(url):
    """Stream text lines from a URL, decompressing .gz/.bz2 on the fly (nothing large is held in memory)."""
    req = urllib.request.Request(url, headers=UA)
    resp = urllib.request.urlopen(req, timeout=120)
    dec = bz2.BZ2Decompressor() if url.endswith(".bz2") else zlib.decompressobj(16 + zlib.MAX_WBITS) if url.endswith(".gz") else None
    buf = b""
    while True:
        chunk = resp.read(1 << 20)
        if not chunk:
            break
        data = dec.decompress(chunk) if dec else chunk
        buf += data
        *lines, buf = buf.split(b"\n")
        for ln in lines:
            yield ln.decode("utf-8", "replace")
    if buf:
        yield buf.decode("utf-8", "replace")


def download(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    tmp.rename(dest)


def step(msg):
    print(f"\n==> {msg}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--home", default=str(ROOT / "data"))
    ap.add_argument("--dry-run", action="store_true", help="only print the hardware report and plan")
    ap.add_argument("--tier", choices=["dist", "full"], help="override IndicTrans2 size")
    ap.add_argument("--llm", help="override the Ollama model, e.g. gemma3:4b, qwen2.5:7b, or 'none'")
    ap.add_argument("--skip-models", action="store_true")
    ap.add_argument("--skip-data", action="store_true")
    ap.add_argument("--no-english", action="store_true", help="skip streaming the English Wiktionary translation tables")
    ap.add_argument("--no-lexemes", action="store_true")
    ap.add_argument("--kaikki-dir", help="use already-downloaded Kaikki JSONL files from this folder")
    a = ap.parse_args()
    home = Path(a.home); home.mkdir(parents=True, exist_ok=True)
    hw = detect(str(home)); p = plan(hw)
    if a.tier: p["translation"]["tier"] = a.tier
    if a.llm: p["llm"]["model"] = None if a.llm == "none" else a.llm
    if a.no_english: p["datasets"]["kaikki_english_translations"] = False
    if a.no_lexemes: p["datasets"]["wikidata_lexemes"] = False
    print(json.dumps({"hardware": hw, "plan": p}, indent=2))
    if a.dry_run:
        return
    (home / "config.json").write_text(json.dumps(p, indent=2))

    if not a.skip_models:
        step("Python packages for IndicTrans2")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(ROOT / "requirements.txt")])
        from huggingface_hub import snapshot_download
        wanted = ["en-indic", "indic-en"] + (["indic-indic"] if p["translation"]["indic_indic"] else [])
        for d in wanted:
            name = MODELS[p["translation"]["tier"]][d]
            step(f"Downloading {name}")
            try:
                snapshot_download(name)
            except Exception as e:  # noqa: BLE001
                print(f"!! Could not download {name}: {e}\n   If the model page asks you to accept terms, open https://huggingface.co/{name}, accept, then run "
                      f"`huggingface-cli login` (free account, no billing) and re-run this script.")
        if p["llm"]["model"]:
            if shutil.which("ollama"):
                step(f"ollama pull {p['llm']['model']}")
                subprocess.call(["ollama", "pull", p["llm"]["model"]])
            else:
                print("!! Ollama is not installed. Install from https://ollama.com/download and run: ollama pull " + p["llm"]["model"])

    if not a.skip_data:
        lex = Lexicon(home / "lexicon.db")
        sources = []
        for code in p["datasets"]["kaikki_languages"]:
            name = KAIKKI[code]
            local = Path(a.kaikki_dir) / f"kaikki.org-dictionary-{name}.jsonl" if a.kaikki_dir else home / "kaikki" / f"kaikki.org-dictionary-{name}.jsonl"
            if not local.exists():
                step(f"Downloading Kaikki {name}")
                for tpl in KAIKKI_URLS:
                    url = tpl.format(name=name)
                    try:
                        download(url, local.with_suffix(".jsonl.gz") if url.endswith(".gz") else local)
                        break
                    except Exception as e:  # noqa: BLE001
                        print(f"   {url}: {e}")
            path = local if local.exists() else local.with_suffix(".jsonl.gz")
            if path.exists():
                step(f"Indexing {name}")
                n = lex.import_kaikki_lines(open_text_stream(path), lang=code)
                print(f"   {n} entries"); sources.append({"kaikki": name, "entries": n})
            else:
                print(f"!! No Kaikki data for {name}; check https://kaikki.org/dictionary/{name}/ and pass --kaikki-dir")
        if p["datasets"]["kaikki_english_translations"]:
            step("Streaming English Wiktionary translation tables (only ta/ml/kn/te/hi translations are kept; a few GB of download)")
            for tpl in KAIKKI_URLS:
                try:
                    n = lex.import_kaikki_lines(http_lines(tpl.format(name="English")), english_translations_only=True)
                    print(f"   {n} translations"); sources.append({"kaikki": "English translations", "translations": n}); break
                except Exception as e:  # noqa: BLE001
                    print(f"   {tpl}: {e}")
        if p["datasets"]["wikidata_lexemes"]:
            step("Streaming Wikidata Lexemes dump (CC0; filtered to en/ta/ml/kn/te/hi)")
            try:
                n = lex.import_lexemes(http_lines(LEXEMES_URL)); print(f"   {n} lexemes"); sources.append({"wikidata_lexemes": n})
            except Exception as e:  # noqa: BLE001
                print(f"!! Wikidata lexemes skipped: {e}")
        build_info(lex, sources)
        lex.rebuild_search()
        print(json.dumps(lex.stats()["entries"], indent=2))
    step("Done. Start the service with:  python -m lotus_dict.server   (from the local-dictionary folder)")


if __name__ == "__main__":
    main()
