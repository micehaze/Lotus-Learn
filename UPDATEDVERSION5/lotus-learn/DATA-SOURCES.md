# Dictionary data attribution and licenses

The source databases are a collection of independently licensed datasets. Keep these notices and source licenses with redistributed copies. Generated output is labelled separately and is not attributed to these dictionaries.

| Database | Source | License |
|---|---|---|
| `local-dictionary/data/lexicon.db` | Wiktionary contributors, extracted by Kaikki.org / Wiktextract (Tatu Ylonen) | CC BY-SA 4.0 / applicable GFDL terms |
| `local-dictionary/data/alar.db` | V. Krishna’s Alar Kannada–English corpus | ODbL 1.0 |
| `local-dictionary/data/olam.db` | Olam open English–Malayalam corpus | ODbL 1.0 |

Wiktionary source: https://kaikki.org/dictionary/ and https://en.wiktionary.org/ . Original downloaded JSONL snapshots are in `local-dictionary/data/kaikki/`. Attribution and share-alike obligations remain applicable to the derived index and dictionary text.

Alar source: https://github.com/alar-dict/data and https://alar.ink . Original YAML, README and full license are in `local-dictionary/data/sources/alar.yml`, `ALAR-README.md` and `ALAR-LICENSE.txt`. Indexed definitions and pronunciation fields preserve the source wording; the local app adds search indexes and displays only a subset of fields.

Olam source: https://olam.in/p/open/enml . Original archive is `local-dictionary/data/sources/enml.tar.gz`. Source text is retained, with script filtering and indexes added. The ODbL license is supplied as `local-dictionary/data/sources/ODbL-1.0.html` and also in the Alar license file. Data are provided under their source licenses; the source authors do not endorse this app.

Wikipedia context excerpts link to their original articles and retain CC BY-SA attribution. They are short context excerpts, not independently reviewed dictionary examples.

Optional IndicTrans2: https://github.com/AI4Bharat/IndicTrans2 (MIT). Model weights are not installed merely by installing IndicTransToolkit.

Local AI: Ollama, using an installed model selected in `.env`. Gemma model use is subject to the Gemma terms at https://ai.google.dev/gemma/terms . Qwen3 model information: https://ollama.com/library/qwen3 . Model-generated text is never presented as a quote from a dictionary or web source.

An Open-Tamil parallel list was inspected during development and excluded from the search indexes due to questionable translations. It is not used to inflate coverage counts.
