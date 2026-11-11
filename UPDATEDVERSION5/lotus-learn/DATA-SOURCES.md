# Dictionary data attribution and licenses

The source databases are a collection of independently licensed datasets. Keep these notices and source licenses with redistributed copies. Generated output is labelled separately and is not attributed to these dictionaries.

| Database | Source | License |
|---|---|---|
| `local-dictionary/data/lexicon.db` | Wiktionary contributors, extracted by Kaikki.org / Wiktextract (Tatu Ylonen) | CC BY-SA 4.0 / applicable GFDL terms |
| `local-dictionary/data/alar.db` | V. Krishna’s Alar Kannada–English corpus | ODbL 1.0 |
| `local-dictionary/data/olam.db` | Olam open English–Malayalam corpus | ODbL 1.0 |
| `local-dictionary/data/native-wiktionary.db` | Tamil and Telugu Wiktionary contributors | CC BY-SA 4.0 |
| `local-dictionary/data/wikipedia-usage.db` | Tamil and Telugu Wikipedia contributors | CC BY-SA 4.0 |

Wiktionary source: https://kaikki.org/dictionary/ and https://en.wiktionary.org/ . Original downloaded JSONL snapshots are in `local-dictionary/data/kaikki/`. Attribution and share-alike obligations remain applicable to the derived index and dictionary text.

Alar source: https://github.com/alar-dict/data and https://alar.ink . Original YAML, README and full license are in `local-dictionary/data/sources/alar.yml`, `ALAR-README.md` and `ALAR-LICENSE.txt`. Indexed definitions and pronunciation fields preserve the source wording; the local app adds search indexes and displays only a subset of fields.

Olam source: https://olam.in/p/open/enml . Original archive is `local-dictionary/data/sources/enml.tar.gz`. Source text is retained, with script filtering and indexes added. The ODbL license is supplied as `local-dictionary/data/sources/ODbL-1.0.html` and also in the Alar license file. Data are provided under their source licenses; the source authors do not endorse this app.

The Tamil and Telugu Wiktionary and Wikipedia indexes are distributed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Wikipedia context excerpts link to their original articles and retain source attribution. The local usage index records distinct spellings with a short excerpt from a source article. The app reports these as word forms with usage examples. Dictionary entry totals count lexical records from the dictionaries and their translation sources.

The native Wiktionary importer uses explicit definitions and translations from the [Tamil](https://dumps.wikimedia.org/tawiktionary/latest/) and [Telugu](https://dumps.wikimedia.org/tewiktionary/latest/) article dumps. The usage importer filters markup and indexes visible text from the [Tamil Wikipedia](https://dumps.wikimedia.org/tawiki/latest/) and [Telugu Wikipedia](https://dumps.wikimedia.org/tewiki/latest/) article dumps. To build both indexes, run the commands below from the Version 5 folder. Use a new output filename for rebuilds and swap in the completed database while the local dictionary server is stopped.

```powershell
New-Item -ItemType Directory -Force local-dictionary/data/sources
foreach ($wiki in @('tawiktionary', 'tewiktionary', 'tawiki', 'tewiki')) {
  curl.exe --fail --location "https://dumps.wikimedia.org/$wiki/latest/$wiki-latest-pages-articles.xml.bz2" -o "local-dictionary/data/sources/$wiki.xml.bz2"
  if ($LASTEXITCODE) { throw "Download failed for $wiki" }
}
python local-dictionary/import_native_wiktionary.py --output local-dictionary/data/native-wiktionary.db --ta local-dictionary/data/sources/tawiktionary.xml.bz2 --te local-dictionary/data/sources/tewiktionary.xml.bz2
python local-dictionary/import_wikipedia_usage.py --output local-dictionary/data/wikipedia-usage.db --ta local-dictionary/data/sources/tawiki.xml.bz2 --te local-dictionary/data/sources/tewiki.xml.bz2
```

Optional IndicTrans2: https://github.com/AI4Bharat/IndicTrans2 (MIT). Model weights are not installed merely by installing IndicTransToolkit.

Local AI: Ollama, using an installed model selected in `.env`. Gemma model use is subject to the Gemma terms at https://ai.google.dev/gemma/terms . Qwen3 model information: https://ollama.com/library/qwen3 . Model-generated text is never presented as a quote from a dictionary or web source.

An Open-Tamil parallel list was inspected during development and excluded from the search indexes due to questionable translations. It is not used to inflate coverage counts.
