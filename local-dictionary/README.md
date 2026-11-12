# LotusLearn local dictionary — free, offline, no paid APIs

Runs on your own computer. After a one-time download it works **with the internet disconnected**.

| Layer | Resource | Licence | Used for |
| --- | --- | --- | --- |
| Translation | [AI4Bharat IndicTrans2](https://github.com/AI4Bharat/IndicTrans2) (Hugging Face `ai4bharat/indictrans2-*`) via `transformers` + `IndicTransToolkit` | MIT | en ↔ ta/ml/kn/te/hi; ta/ml/kn/te ↔ each other (indic-indic model, or English pivot on small machines) |
| Dictionary | [Kaikki.org](https://kaikki.org/) JSONL extracted from English Wiktionary by wiktextract | CC BY-SA 4.0 / GFDL | definitions, senses, word forms, examples, synonyms, antonyms, related words, English→Indic translation tables |
| Lexemes | [Wikidata Lexemes](https://www.wikidata.org/wiki/Wikidata:Lexicographical_data) dump | CC0 | lemmas, forms, senses linked by “item for this sense” (sense-preserving cross-language equivalents), synonyms, antonyms |
| Enrichment | [Ollama](https://ollama.com) with an open-weight model (default **Gemma 3**, chosen by RAM/VRAM) | Gemma Terms of Use (free; not OSI) — or use `--llm qwen2.5:7b` (Apache-2.0) | sense grouping, nuances, near-synonyms, contextual opposites, collocations, example sentences |
| Morphology | LotusLearn `shared/morphology.js` | — | inflected forms → lemma candidates (கிராமத்தில் → கிராமம்) |
| Cache | LotusLearn database | — | every successful result is stored permanently |

**Attribution / ShareAlike.** Wiktionary-derived text keeps its CC BY-SA 4.0 licence: LotusLearn shows the source under each entry,
and if you redistribute the built `data/lexicon.db` you must do so under CC BY-SA with attribution to Wiktionary contributors and Kaikki.org.
Machine translations and local-LLM output are labelled as such and shown with an “AI-assisted” flag.

## Setup (once, needs internet)

Python 3.10+ is required. A virtual environment is recommended:

```bash
cd local-dictionary
python3 -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
python setup_local_dictionary.py --dry-run               # hardware report + chosen models, downloads nothing
python setup_local_dictionary.py                         # installs packages, downloads models + data, builds data/lexicon.db
```

The script detects RAM, CPU cores, GPU and VRAM (NVIDIA via `nvidia-smi`, Apple Silicon, AMD/ROCm) and free disk, then picks:

| Your machine | IndicTrans2 | Indic↔Indic | Ollama model |
| --- | --- | --- | --- |
| < 5 GB RAM | distilled 200M (CPU) | via English | none (enrichment off) |
| 5–8 GB RAM | distilled 200M | via English | none / `gemma3:1b` at 8 GB |
| 8–12 GB RAM | distilled 200M + indic-indic 320M | direct | `gemma3:1b` |
| ≥ 12 GB RAM or ≥ 6 GB VRAM | distilled | direct | `gemma3:4b` |
| ≥ 8 GB VRAM / Apple ≥ 32 GB | 1B models | direct | `gemma3:4b` / `gemma3:12b` (≥ 12 GB VRAM or ≥ 32 GB RAM) |

Overrides: `--tier dist|full`, `--llm gemma3:4b|qwen2.5:7b|none`, `--no-english` (skip the large English translation-table stream),
`--no-lexemes`, `--kaikki-dir` (use files you downloaded yourself). Install Ollama from https://ollama.com/download first if you want enrichment.
If a Hugging Face model page asks you to accept terms, accept it and run `huggingface-cli login` (free account, no billing).

Approximate downloads: IndicTrans2 distilled ≈ 2–3 GB (1B ≈ 14 GB); Kaikki Tamil/Malayalam/Kannada/Telugu ≈ tens of MB each;
English translation tables are **streamed** from the multi-GB English file (only ta/ml/kn/te/hi translations are kept);
Wikidata Lexemes dump is streamed (only en/ta/ml/kn/te/hi kept). Ollama: gemma3:1b ≈ 0.8 GB, 4b ≈ 3.3 GB, 12b ≈ 8 GB.

## Run

```bash
python -m lotus_dict.server            # http://127.0.0.1:8765  (from local-dictionary/, venv active)
ollama serve                           # if Ollama is not already running as an app
```

Or from the project root: `npm run start:all` (starts this service and the website; set `PYTHON=.venv/bin/python` to use the venv).

## Verify real local inference (no mocks)

```bash
python verify_local.py                 # English “love”→ta, “discover”→ml, “go”→kn, “beautiful”→te, கிராமத்தில்→en, 12 cross-language pairs
python -m unittest discover -s tests -v  # unit tests (lexicon, HTTP server, pivot logic, failure handling)
```

## API (used by the Node backend)

`GET /health` · `POST /lookup {text, lang, direction: to_en|from_en, candidates?, context?}` · `POST /translate {text, src, tgt, n}` ·
`POST /equivalents {word, lang, gloss?, targets?}` · `POST /enrich {word, lang, gloss, pos}`.
