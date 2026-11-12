# Lotus Learn Version 5

Lotus Learn is a local language-learning app for **Tamil, Malayalam, Kannada, and Telugu**. Choose a language and level, look up words, practice saved vocabulary, and track your progress in each language.

Version 5 runs from the root of the `main` branch. The previous GitHub layout and older versions are available in the [obsolete version archive](https://github.com/micehaze/Lotus-Learn/tree/archive-pre-v5-layout).

## Download and start

Install [Node.js 22.13 or later](https://nodejs.org/en/download) and [Python 3.10 or later](https://www.python.org/downloads/) and add them to PATH. Install [Ollama](https://ollama.com/download) for AI features. Use [Code → Download ZIP](https://github.com/micehaze/Lotus-Learn/archive/refs/heads/main.zip) and extract it, or clone the project.

```powershell
git clone https://github.com/micehaze/Lotus-Learn.git
Set-Location Lotus-Learn
```

From the extracted or cloned app folder, copy the settings and build the base offline dictionary. This step downloads data once.

```powershell
Copy-Item .env.example .env
python local-dictionary/setup_local_dictionary.py --skip-models --llm none --no-english --no-lexemes
```

Open **START-LOTUS.cmd** or run `npm.cmd start`. Keep the console open and visit [localhost:3005](http://localhost:3005). Register your account and select a learning language. On macOS or Linux, use `cp .env.example .env`, `python3` for the setup commands, and `npm start`.

## Install the expanded dictionaries

Run these commands from the app folder for the Malayalam and Kannada supplements.

```powershell
python -m pip install PyYAML
python tools/download-extra.py
python tools/build-extra.py
python tools/expand-dictionaries.py
```

Download [lotuslearn-v5-tamil-telugu-indexes.zip](https://github.com/micehaze/Lotus-Learn/releases/download/v5-dictionary-coverage/lotuslearn-v5-tamil-telugu-indexes.zip). With the app stopped, extract `native-wiktionary.db` and `wikipedia-usage.db` into `local-dictionary/data/`. Restart the app and check **Dictionary → Dictionary coverage**. Wikipedia results include usage excerpts and source links. [Data sources and licenses](DATA-SOURCES.md)

## Enable local AI and translation

Start Ollama and download the models listed in `.env`. These downloads are needed once.

```powershell
ollama pull gemma3:4b
ollama pull qwen3:4b
ollama list
```

Restart Lotus Learn. `OLLAMA_MODEL` controls dictionary enrichment and other AI-assisted content. `DAILY_TOPIC_MODEL` controls the Daily Topic worker. It prepares one shared theme per date in the app timezone and publishes when all four language lists pass validation. If a list falls short, open **Admin → Daily Topics** to inspect the error, retry the list, or supply reviewed entries. Generation can take time on a CPU.

For optional offline machine translation, install the dependencies and download IndicTrans2 into the app's model folders. Python 3.11 or 3.12 is recommended for this step.

```powershell
python -m venv local-dictionary/.venv
$lotusPython = ".\local-dictionary\.venv\Scripts\python.exe"
& $lotusPython -m pip install torch "transformers>=4.40,<5" sentencepiece sacremoses huggingface_hub protobuf
& $lotusPython tools/install-local-models.py
```

On macOS or Linux, set `lotusPython=./local-dictionary/.venv/bin/python` and invoke it as `"$lotusPython"`. The app uses the virtual environment on its next start. Source lookups, Vocabulary, and Reading updates work offline after setup. Video playback, the ChatGPT shortcut, and live web examples require internet access. Set `DICT_WEB_ENABLED=false` in `.env` to turn off live web examples.

## Use the app

| Section | What to do |
| --- | --- |
| **Dictionary** | Search in English or in the selected language. Open a result for meanings, examples, and source attribution. Save useful words to collections. |
| **Vocabulary and review** | Browse published words by language, level, and topic. Practice saved words and track mastery in your account. |
| **Daily Topic** | Open the latest published theme or browse the archive. A date appears once all four language lists are ready. |
| **Reading** | Select **Update Stories** for three original, template-based practice stories. Each has native script, Latin transliteration, and English translations. The custom-story shortcut provides a prompt to copy into ChatGPT in a new tab. |
| **Videos** | Select **Update Videos** for three curated YouTube links in the active language. Open, favorite, or mark them watched. Later updates can reuse links from the catalog. |
| **Grammar** | Browse lessons by language and proficiency level. |

## Create an administrator and publish content

Run the command below from the app folder with your own email and a new password. If the email already exists, the script grants admin rights and keeps its existing password. Sign in and open **Admin**.

```powershell
npm.cmd run create-admin -- you@example.com "choose-your-own-strong-password"
```

Select the target language before adding content. Published items are visible to all accounts using that language on **this installation**. Each download has its own database.

- **Vocabulary.** Add individual entries or import CSV or JSON. Publish during import or approve entries in the review queue.
- **Daily Topics.** Assign a future theme and open **Review** to add or edit each language list. Follow the line format in the editor. Each list needs at least 20 distinct entries and at least three valid collocations. Select **Publish** when the date is due and all four lists are ready.
- **Stories.** Add an original or licensed article with at least 20 target-language sentences and matching English paragraphs. Save and publish it from **Pending**.
- **Videos.** Paste a YouTube link or ID, supply a title if automatic metadata is unavailable, and publish it from **Pending**. Curated updates and manual links work without an API key. Optional discovery uses `YOUTUBE_API_KEY`.

## Troubleshooting and backups

- If a port is busy, close the other Lotus Learn console or update `PORT`, `PUBLIC_URL`, and `LOCAL_DICT_URL` in `.env`. The example settings use website port `3005` and dictionary port `8766`.
- If Daily Topic stays pending, verify the model with `ollama list` and check **Admin → Daily Topics** for list errors. The command `npm.cmd run daily-topic:generate -- --status` also reports worker status.
- Run `npm.cmd run backup` before upgrading. Accounts, progress, and manually published content live in `data/lotus.db`. Move your own database when you want to keep those records on a different installation.

The browser UI lives in `public/`, the Node server and Admin API in `server/`, and the Python dictionary service in `local-dictionary/`. Run `npm.cmd run check` for source checks, `npm.cmd test` for Node tests, and `npm.cmd run dict:test` for dictionary tests.
