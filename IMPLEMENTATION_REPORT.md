# Implementation & verification report

**Verification run (this build):** `npm test` → 39/39 passed · `npm run test:e2e` → 14/14 browser flows passed, 0 page errors · `npm run check` → all checks passed. Screenshots of every major screen at desktop, tablet and mobile sizes are in `tests/e2e/screenshots/`.

Status key: **Done** = implemented and exercised by automated tests and/or the browser run · **Done (credentials)** = implemented and tested against mocked providers, not against the live third-party API · **Partial** · **Not done**.

## PRD sections

| § | Area | Status | Notes / evidence |
| --- | --- | --- | --- |
| 1 | Product modules | Done | All ten modules present and connected through shared models and navigation. |
| 2 | Levels A1–C2, register | Done | Levels are admin-editable/addable; learners change level in Settings; recommendations prioritise level but browsing covers all. Every entry carries a register (common/spoken/formal/literary/colloquial) shown as a label. |
| 3.1–3.2 | Vocabulary library & entry fields | Done | All fields stored incl. pronunciation, Hindi/Malayalam, collocations, synonyms, antonyms, register, dialect notes, verb forms. **Library size is 52 seed words** — growth relies on AI generation, CSV/JSON import or manual entry. |
| 3.3 | Daily recommendations | Done | Deterministic per user per day; level + preferred topics; skips collected and already-rewarded words (tested). |
| 3.4 | Content management | Done (AI: credentials) | Add/edit/delete, lists, topics, levels, CSV/JSON import with per-row report, AI generation → review queue. |
| 4 | Video library | Done / Done (credentials) | Official privacy-enhanced YouTube embed, metadata, filters, favourites, watched, authorised transcripts with tap-to-save words, admin add-by-link with review. Discovery (search → Tamil-signal filter → duration filter → classification → dedupe → review) tested with a mocked YouTube API. **No videos are seeded** because video IDs could not be verified offline. |
| 5 | Reading library | Done | 3 original stories (A1, A2, B1 spoken dialogue); transliteration & translation toggles, per-paragraph translation, tap-to-look-up (incl. inflected forms), save words/phrases, saved progress. Licence/citation required for public-domain and openly licensed texts. AI stories (credentials) are validated and held for approval. |
| 6 | Dictionary | Done | EN/HI/ML → Tamil, Tamil and romanised-Tamil input, exact/partial/fuzzy/phrase/verb-form matching, suggestions, synonyms, collocations, examples, forms; AI suggestions clearly labelled unverified (credentials). **Partial:** "related expressions" field exists but seed data rarely fills it. |
| 7 | Accounts | Done | Email registration, login/logout, reset (single-use, 1 h, signs out other sessions), profile picture, preferences, change password, delete account (cascade). Interface language: only English exists (preference stored). Reset emails: console by default; Resend adapter is **untested live**. |
| 8 | Collections | Done | Unlimited collections, admin-configurable word limit (default 1,000, tested at 3), cards with lotus, confirm-before-delete, edit, search within/across collections. |
| 9 | Word selection | Done | Server-persisted selection across collections, blue-star cards, select-all, duplicate prevention by vocabulary identity, 1–50 limit with clear message and **no silent trimming** (tested), preview with expected questions. |
| 10 | Learning engine | Done | Four exercise types; 3/2/2/3 plan with reallocation when contexts are missing; distractors exclude synonyms/shared meanings and match inflection; mixed order (no back-to-back word while ≥2 remain); only correct answers count; per-answer tracking (word, question, type, answer, correctness, timestamp, attempt #); resumable; idempotent submits; completion screen. |
| 11 | Lotus system | Done | One lotus per word per local calendar day (DB-unique), five days → full bloom, later reviews still counted, original pixel stages 0–5 + bloom animation. |
| 12 | Statistics | Done | Lesson histogram (correct vs incorrect per word), accuracy, time, strongest/weakest, per-type table; collection radar with filter + pagination (12 axes/page) and summary; global collection radar with selection; 30-day history, streaks, accuracy by exercise type. |
| 13 | Automation | Done (credentials) | Scheduler with configurable daily targets (vocab lists, 2–4 videos, 3–5 stories), idempotent job keys (re-running never duplicates — tested), job history, failed jobs + retry, manual triggers, validation, review queue. |
| 14 | Architecture | Partial (deviation) | Modular services as required; **not** Next.js/PostgreSQL/Supabase/Recharts — see README "deviations". |
| 15 | Database | Done | Normalised schema with FKs, indexes, unique constraints. RLS replaced by enforced ownership predicates (SQLite). |
| 16 | Design & UX | Done | Responsive (desktop/tablet/mobile verified), loading/empty/error states, confirmations, Tamil font stack, real Tamil on every screen. |
| 17 | Security | Done | scrypt passwords, hashed session tokens, HttpOnly SameSite cookies, CSRF header + origin check, CSP and security headers, input validation, rate limits (auth, AI, jobs), server-side admin checks, keys server-side only, `npm run backup`. Rate limiting is in-memory (single process). |
| 18 | Phases 1–5 | Done | — |
| 18 | Phase 6 | Partial | Mobile UX, accessibility basics and testing done. **Not done:** offline caching (IndexedDB/service worker), production deployment setup, measured performance profiling on real devices. |
| 19 | Acceptance criteria | Done | Each criterion is covered by an integration test or e2e step (see below). "Synchronises across devices" holds because all progress is server-side; not tested on two physical devices. |
| 20 | Future languages | Partial | Language-specific columns (Tamil/Hindi/Malayalam) and Tamil script utilities; adding a new target language needs schema and utility work. |
| 21 | Visual direction | Done | Ref 1 → chunky outlined italic logo + lagoon/waterfall scene in cyan & salmon; Ref 2 → bevelled window frames in five palette variants; Ref 3 → profile-left / content-right logged-in home; Refs 4–8 → six original pixel scenes (lagoon, cascade, fern forest, river, dusk beach, rainbow valley); Ref 9–12 → pixel hibiscus/frangipani/lotus corner ornaments, sprig button ornaments, coconut empty state, lotus stages; Refs 13–14 → shared colour tokens. |
| 22 | Animation | Done | Moving water with ripples, drifting current, twinkling reflections confined to its mask; waterfalls; swaying palms/ferns/leaves/hibiscus with staggered timing; bobbing lotus pads; gentle parallax; button, window, card-selection, answer, progress, lotus-bloom and chart animations; pauses when the tab is hidden; reduced-motion and user "off" switch verified. The two Pinterest motion references **could not be opened** (no network); the water follows §22.2's written behaviour. |

## Acceptance criteria → evidence

Register & choose level (e2e onboarding) · browse by level/topic/POS (dictionary test) · EN/HI/ML search (dictionary test + e2e) · unlimited collections & 1,000 limit (configurable-limit test) · manual create/edit words (collections test + e2e) · save from stories/transcripts (reader e2e; transcript path uses the same component) · multi-collection selection & select-all (selection test + e2e) · ≤50 words (selection test) · 10 correct per word, mixed order, wrong answers don't count (learning tests) · resume (learning test) · one lotus per day, five → bloom (lotus test with simulated clock) · histogram / radar / global radar (e2e screenshots 11–13, stats assertions) · automated video & reading additions (mocked automation test) · AI validated before publication (mocked automation test) · desktop + mobile (e2e) · design follows references (screenshots).

## Needs from you

* A native Tamil speaker to review the 52 seed words and 3 stories (Admin → Vocabulary → "Mark native-reviewed").
* Optional keys: `ANTHROPIC_API_KEY` (or OpenAI), `YOUTUBE_API_KEY`, `RESEND_API_KEY`. These integrations are implemented and tested against mocks but **have not been exercised against the live services**.
* For public hosting: HTTPS with `SECURE_COOKIES=true`, `PUBLIC_URL`, `SEED_DEMO_USER=false`, and a scheduled `npm run backup`.

## Known limitations

Single-process server (in-memory rate limiter and scheduler lock); no offline mode; English-only interface; seed library is small until AI/import is used; Google Fonts (Noto Sans Tamil, Pixelify Sans) load from the internet with local fallbacks; the stack differs from the preferred Next.js/PostgreSQL.
