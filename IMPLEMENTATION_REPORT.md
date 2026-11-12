# Implementation & verification report — multilingual extension

**Verification run:** `npm test` → **50/50** (39 original + 11 extension tests) · `npm run test:e2e` → **17/17** browser flows, 0 page errors · `npm run check` → passed. Screenshots of all four themes and every new page: `tests/e2e/screenshots/` (03, 25–30).

## Database migration performed

`server/migrations/002_multilingual.sql` (additive, runs inside a transaction; `db.js` writes a `VACUUM INTO` backup first when the database already has data):

* New tables: `languages`, `user_language_profiles` (per-language level, topics, goal, transliteration, onboarding), `content_state`, `word_senses`, `sense_relations`, `sense_collocations`, `sense_examples`, `sense_equivalents`, `word_homonyms`, `grammar_categories`, `grammar_lessons`, `grammar_progress`, `learning_notes`, `daily_topics`, `daily_topic_words`.
* New columns: `lang` on vocabulary, lists, collections, collection words, word mastery, lotus rewards, sessions, stories, videos, jobs; `user_profiles.active_language`; `vocabulary.concept_key` (shared meaning across languages) and `definition`; `videos.url`.
* Legacy rows tagged `ta`; Tamil profiles copied into `user_language_profiles`; vocabulary duplicate keys now include the language; one-active-session index is now per language; `content_jobs` rebuilt (history kept) to allow grammar / daily-topic / enrichment jobs.
* Start-up backfill mirrors each legacy entry into sense 1 of the sense model (source `legacy`), and extends the three short Tamil seed stories to 20+ sentences in place. Reading progress is kept.
* Verified by a test that builds a pre-extension database with mastery, rewards, sessions and jobs, migrates it, and checks every value survived and the backup exists.

## Requirements → status

| PRD § | Requirement | Status / evidence |
| --- | --- | --- |
| 2.1–2.2 | Four languages; switcher in profile & navigation | Done. Top-bar switcher + `PUT /api/profile/language`; theme, scenes, content, collections and stats switch without logout (e2e) |
| 2.3 | Independent progress for every data type; sessions keep their language; no merging of identically spelled words | Done; tests cover levels, collections, selection, mastery, stats, notes, grammar progress, concurrent per-language lessons. Mastery is keyed by entry id, never by spelling |
| 2.4 | Independent A1–C2 per language | Done |
| 3.1 | Both directions per language, swap, Unicode, transliteration, typos, multiword, forms, multiple senses | Done (test per language). Cross-script and Hindi input map through shared meanings |
| 3.2 | Entry structure, collapsible sections, primary translation first | Done (`/dictionary/entry/:id`) |
| 3.3–3.4 | 10–15 synonyms / antonyms with nuance; honest when fewer | **Partial by design.** Model, UI, AI pipeline and honesty notes done. Checked seed data: rich nuance sets only for காதல், மகிழ்ச்சி, பெரிய; most entries have 0–2. No padding is done |
| 3.5–3.6 | Three structured collocation types + common expressions | Done (model, UI, labelled constructions). Seed counts are small; legacy collocations appear as "common" |
| 3.7 | Cross-language equivalents incl. Hindi, sense-preserving | Done for the 31 shared concepts in all languages (linked by concept key) + Hindi |
| 3.8 | Homophones/homonyms only when legitimate | Done; one verified seed (படி). Section is hidden otherwise |
| 3.9 | 5–7 examples with highlight & transliteration | Model/UI done; seed entries have 1–4 checked examples; the gap is stated on each entry |
| 3.10 | Validation, caching, verified vs unreviewed | Done: AI enrichment stored permanently, never regenerated (job key), script-validated, hidden until approved |
| 4 | Per-language reading, 3–5/day, ≥ 20 sentences, metadata, durability, catch-up | Done (scheduler + validation + tests). **Daily growth needs an AI key** and admin approval (or the opt-in auto-publish setting). Seeds: 3 Tamil + 1 per other language |
| 5 | Per-language videos, 3–5/day, dedupe, external links | Done; **discovery needs `YOUTUBE_API_KEY`** (tested with a mocked API, not live). No seed videos |
| 6 | Daily Topic replaces Daily Words, 60–80 related words, archive, save/study | Done. **Current library is far below 60 words per topic** (e.g. Telugu "Nature" has 6). The topic shows the shortfall and is topped up only with approved words; AI fill jobs are queued when a key is set |
| 7 | Grammar for each language; rule/nuances/variations/examples; 3–5/day; browse, search, filter, bookmark, studied | Done. 24 checked seed lessons (Tamil 9, Malayalam, Kannada and Telugu 5 each); daily growth needs AI |
| 8 | Learning Notes calendar per language | Done: day/month/year navigation, create, edit, append, rewrite, delete with confirmation, search, autosave, simple formatting |
| 9 | Central lifecycle, targets, local scheduler, catch-up, idempotency, retries, notify tabs, admin controls per language | Done (tests: catch-up, concurrency, restart, SSE; e2e: live update in an open tab) |
| 10 | Four themes from references; consistent architecture; smooth switching; animations; reduced motion | Done for Tamil & Malayalam from the images; Kannada & Telugu from the written brief only (no images supplied). Verified by screenshots |
| 11 | Schema, FKs, uniqueness, indexes, authorization, safe migration + backup | Done |
| 12 | Navigation, responsive, four scripts | Done. Fonts: Noto Sans Tamil/Malayalam/Kannada/Telugu (Google Fonts) with OS fallbacks |
| 13 | Automated tests | Done (see top). Visual review done manually from screenshots |

## Needs from you

* **Native-speaker review** of all seed content (Admin → Vocabulary / Grammar / Stories); everything is labelled *editor* (AI-assisted), not verified.
* **Credentials** for growth: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (stories, grammar, vocabulary, Daily-Topic fill, dictionary enrichment) and `YOUTUBE_API_KEY` (videos). `RESEND_API_KEY` optional for reset emails. Integrations are tested against mocks only.
* **Kannada and Telugu reference images**, if you want those themes derived from images instead of the written brief.

## Known limitations

* Seed volume is far below the 10–15 / 60–80 targets; the app states the gaps rather than fabricating.
* Platform-wide daily content uses the server's UTC date; lotus rewards use each learner's time zone.
* In this build sandbox Telugu rendered with a fallback bitmap font in screenshots; real browsers load Noto Sans Telugu.
* Single-process server (in-memory rate limiter and scheduler lock); no offline mode; English-only interface.
* Stack differs from the original preference (Node + SQLite instead of Next.js + PostgreSQL), as explained in the README.
