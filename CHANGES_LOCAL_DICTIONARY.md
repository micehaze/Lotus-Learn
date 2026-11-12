# Free, local dictionary — change report

## What changed
* **New Python service `local-dictionary/`** (standard-library HTTP server on 127.0.0.1:8765):
  `lotus_dict/translator.py` (AI4Bharat IndicTrans2 via transformers + IndicTransToolkit; en↔Indic, Indic↔Indic or English pivot),
  `lotus_dict/lexicon.py` (offline SQLite index of Kaikki/Wiktionary + Wikidata Lexemes: senses, forms→lemma, examples, synonyms,
  antonyms, related words, English translation tables, sense-linked equivalents), `lotus_dict/llm.py` (Ollama, local),
  `lotus_dict/hardware.py` (RAM/CPU/GPU/VRAM/disk detection → model sizes), `lotus_dict/server.py`, `setup_local_dictionary.py`
  (downloads only what the plan needs, streams the large dumps), `verify_local.py` (real-inference checks), tests.
* **Node backend:** `server/integrations/dictionaryProviders.js` now talks only to the local service. `server/integrations/index.js`:
  Anthropic/OpenAI code removed — AI is **Ollama only**; the YouTube Data API (Google Cloud) path removed (videos are added by link).
  `server/services/lookup.js`: layers 3–5 rewired to the local lexicon, IndicTrans2 and Ollama; Wiktionary senses/examples/relations are
  stored on the entry; English searches also show lexicon senses when the library has < 3 matches; results cached for 10 years.
  `server/config.js`, `.env.example` (no paid keys left), `package.json` scripts, `tools/start-all.mjs`, source attribution in the UI.
* **Database:** no new migration; uses the tables from `003_dictionary_engine.sql` (`dictionary_cache`, `word_forms`, `origin`).
  Existing users, collections, progress and content are untouched.

## Verified here
* Node: **57/57** (dictionary tests run against the **real Python service** over HTTP with a fixture-built lexicon — no mocked providers).
* Python: **7/7** (lexicon import/query, inflected forms, Wikidata sense links, pivot logic, HTTP server, graceful failures).
* Static checks pass. Both services start together with `npm run start:all`.
* Browser end-to-end: passes through registration, vocabulary and the dictionary; **stops at the Daily Topic step** because the
  previous pass only publishes topics with ≥ 60 words and the seed library is too small (pre-existing, content-volume issue).

## NOT verified here (needs your machine)
The build sandbox has no internet, no PyTorch, 1 CPU core and 3.9 GB RAM, so IndicTrans2, the real Kaikki/Wikidata data and Ollama
could not be downloaded or run. **Real local inference has not been executed yet.** Run `npm run dict:setup` then
`npm run dict:verify` — it performs “love”→ta, “discover”→ml, “go”→kn, “beautiful”→te, கிராமத்தில்→en and 12 cross-language pairs
against the real models and exits non-zero on failure. Kaikki download URLs and Hugging Face model access were written from the
published formats; if either has changed, the script prints the URL that failed (use `--kaikki-dir` for manual downloads).
