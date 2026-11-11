# Lotus Learn — Version 5

This is a separate, runnable upgrade of Version 4. Your existing learner database was copied with SQLite’s online backup API. Version 4 was not edited.

## Start on this computer

1. Double-click **START-LOTUS.cmd** in this folder.
2. Keep its console window open.
3. Open **http://localhost:3005**.
4. Sign in with your existing account, or create one. Development learner: `demo@lotuslearn.local` / `lotus-demo-2026`.
5. Open **Dictionary**, select Tamil, Malayalam, Kannada or Telugu, and search in English or the language’s script. Switch direction with ⇄.

The launcher starts the dictionary service and website together. It starts Ollama when needed and installed. No `npm install` is required. The dictionary indexes are already included; do not run the heavyweight setup script just to use the app.

Requirements: Node.js 22.13+, Python 3.10+ with SQLite FTS5, and Ollama for AI features. These were found on this computer. If you move the folder to another computer, install those programs and run `ollama pull gemma3:4b` once. The model is stored in Ollama’s model library, not duplicated in this project.

## What is included

| Language | Indexed source entries |
|---|---:|
| Tamil | 13,526 |
| Malayalam | 141,292 |
| Kannada | 159,379 |
| Telugu | 22,926 |
| Total | 337,123 |

These are dictionary records, including compounds, different parts of speech and etymologies; they are **not** unique-word counts. There are also 361,785 indexed forms and 192,287 English–Malayalam translation records. Counts describe this downloaded snapshot, not all words in each language. Tamil coverage is below 20,000 source entries; unknown words use a labelled local-AI fallback.

Sources: Wiktionary/Kaikki for all four languages; V. Krishna’s Alar for Kannada; Olam for Malayalam. Independently licensed source databases are kept in separate files. See **DATA-SOURCES.md** and `local-dictionary/data/sources/` for attribution, original data and licenses.

## Dictionary behavior

- English → native and native → English search, with persistent lookup caching and the existing morphology support.
- Searches definitions as complete words/phrases, so “craft” does not accidentally match “aircraft”. Common headwords are preferred when present in the source; historical alternatives remain available.
- Imported senses, relations and source examples appear in the dictionary, not just in an unused secondary service.
- Entry details automatically request other-language translations and enrichment. Initial results remain usable while the local model works. Repeated visits reuse saved results.
- Existing Wiktionary examples are preferred. Limited public Wikipedia context lookup is available when online. Context excerpts are separate from dictionary examples because they can use another sense.
- Missing examples are generated in a focused request and checked for target usage, correct script and sentence punctuation. AI-generated translations, relations, collocations and examples are visibly labelled **unreviewed**.
- Generated collocations are suggestions, not proof that an expression is established in a language corpus.
- Synonyms, near-synonyms, related words and contextual alternatives stay separate. A wolf is not inserted as a synonym of dog just to reach a number. Antonyms may correctly be empty. Lists are not padded to 10–15.
- Similar spellings are shown separately. They are not asserted to be homophones. Recorded homonyms/homophones remain available when the source library has them.
- Temporary failures remain retryable; an equivalent-translation failure does not stop example generation.

## Settings and troubleshooting

Settings are in `.env`. This copy uses website port **3005** and dictionary port **8766**, so it can run beside Version 4. `OLLAMA_MODEL` selects the dictionary model; `DICT_WEB_ENABLED=false` disables online context lookup. Dictionary data and local AI can work offline after downloads. First-time AI requests on a CPU can take several minutes; dictionary-source hits are much faster. General story, grammar, and vocabulary automation can stay disabled while the separate Daily Topic worker runs.

### Daily Topic

Each date uses one shared microtopic across Tamil, Malayalam, Kannada, and Telugu. The Node server scans at startup and every minute, including after local midnight or after waking. It reserves a seven-day rolling plan, catches up in date order, and publishes a date only after all four lists have passed review with 20–50 entries each. Older records remain browsable, including pre-migration topics whose original language-specific titles and lists are preserved. The browser updates through the existing live stream or minute polling. Your level puts matching entries first; the full list is still available.

Ollama runs locally at `127.0.0.1:11434`. Daily Topic defaults to `qwen3:4b`. The worker starts with stored vocabulary and looks up topic-specific meanings in the local dictionary. It uses [Ollama structured output](https://github.com/ollama/ollama/blob/main/docs/api.md) to propose new candidates. New AI entries need meaning evidence from the local dictionary or IndicTrans2 before a separate model pass reviews relevance, morphology, natural usage, and meaning. Published AI entries carry an AI-assisted label. The worker saves reviewed batches between attempts. If a list falls short, the date stays pending or failed and its topic remains reserved. A date that reaches its quality retry limit can be retried from Admin, and later eligible dates can proceed. The bundled plan can still reserve dates without Ollama.

From this **Version 5** directory in PowerShell:

```powershell
ollama list
npm.cmd run backup
npm.cmd run start:all
```

If `qwen3:4b` is not installed, run `ollama pull qwen3:4b` once. Ollama must be running. The normal startup command also starts the local dictionary and website. For a headless run, with Ollama and preferably the dictionary service already running, use:

```powershell
npm.cmd run daily-topic:generate
npm.cmd run daily-topic:generate -- --status
npm.cmd run test:daily-topic
```

`DAILY_TOPIC_ENABLED=false` disables scheduled generation in the web process. A manual headless run still works. `DAILY_TOPIC_TARGET` defaults to 30 and is clamped to the 20–50 range configured in **Admin → Settings**. `DAILY_TOPIC_TIMEOUT_MS` controls the timeout of each local model request. `APP_TIMEZONE` sets an IANA zone on first use; the database keeps that zone across host timezone changes so existing dates do not move. SQLite writes a backup before each migration on an existing installation.

In **Admin → Daily Topics**, assign a shared theme to a future date, review each language list, retry failed jobs, or publish a complete due date. An active worker owns its claimed list until it finishes or its lease expires. Failed quality attempts are bounded; use **Retry list** after correcting the cause. Service outages retry automatically. Published dates and expressions are immutable. Archived expressions can still be saved to a collection for their language.

To opt into [Windows Task Scheduler](https://learn.microsoft.com/en-us/windows/win32/taskschd/schtasks), first preview the action, then register it if desired:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\daily-topic-task.ps1 -Preview
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\daily-topic-task.ps1 -At '00:05'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\daily-topic-task.ps1 -Uninstall
```

The task runs under your signed-in Windows user at logon and at the specified machine-local time. Use a time after the pinned application midnight when the Windows and app zones differ. Keep Ollama available for the task. Closing the browser does not stop either scheduler; a sleeping or powered-off machine cannot generate, and catch-up starts after the machine and required services return.

If the page reports no dictionary connection, close the Version 5 console and start **START-LOTUS.cmd** again. Running `node server/index.js` alone starts only the website. If AI is unavailable, open Ollama and check `ollama list`; the selected model must be installed. If port 3005 is already occupied, close the other Version 5 console or change `PORT` and `PUBLIC_URL` together.

Saved words, accounts and progress are in `data/lotus.db`. Back up the whole `data` folder before replacing it. Run `npm run backup` for an online database backup.

## Development and verification

```powershell
npm start                 # website plus dictionary
npm run start:web         # website alone, for development
npm test                  # isolated Node unit/integration tests
npm run check             # JavaScript syntax and bundled asset checks
npm run dict:test         # Python dictionary tests
node tools/smoke-v5.mjs    # real-data and live local-model checks; running app required
```

Supplementary dataset refresh (not needed for normal use): `python tools/download-extra.py`, install PyYAML if needed (`python -m pip install --target tools/vendor PyYAML`), then `python tools/build-extra.py`. Completed supplementary indexes are reused. To replace them with a new source snapshot, build in a separate folder and swap only after verifying it. The original IndicTrans2 setup remains optional; installing IndicTransToolkit alone does not install model weights or dictionary data.

## Limits

No resource covers every historical, dialectal, technical, borrowed and inflected word. AI can make linguistic mistakes even when script and sentence checks pass. Exact literary interpretation needs context and native-speaker review. The app does not search every website or social network: its implemented online source is public Wikipedia, alongside the bundled Wiktionary and dictionary datasets. Extra recorded senses may have fewer details than the primary meaning enriched by AI. Learning lessons and curated lists retain the original, smaller editorial library; importing dictionary data does not automatically turn every dictionary record into a reviewed lesson.
