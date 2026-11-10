# Lotus Learn 🪷

A South Indian language-learning platform for **Tamil, Malayalam, Kannada and Telugu**. Each language is an independent learning environment with its own level, collections, lotus mastery, lessons, statistics, streaks, reading and video history, grammar progress, Daily Topics and Learning Notes, and its own visual theme. Shared features: a ten-correct-answer learning engine, a sense-aware bidirectional dictionary with cross-language equivalents, Grammar, Learning Notes, a Daily Topic archive, reading and video libraries, and an admin dashboard with durable daily content automation, all in a living pixel-art world with retro-Windows frames.

## Run it locally

**Requirement:** Node.js **22.13 or newer** (it uses Node's built-in SQLite). Nothing else: there are **no npm dependencies to install**.

```bash
cd lotus-learn
cp .env.example .env      # optional – the defaults work
npm start                 # or: node --disable-warning=ExperimentalWarning server/index.js
```

Open **http://localhost:3000**.

On every start the database (`data/lotus.db`) is migrated and the idempotent seed runs (it never deletes or duplicates). An **existing** database is backed up to `data/backups/pre-002_multilingual-*.db` before the multilingual migration is applied, and all existing records are kept as Tamil. A fresh database gets: 30 topics; 52 Tamil + 31 Malayalam + 31 Kannada + 31 Telugu vocabulary entries linked across languages by shared meaning; 24 grammar lessons; 6 stories of 20+ sentences; per-language lists; and a Daily Topic per language. Two **development** accounts are created:

| Role | Email | Password |
| --- | --- | --- |
| Learner (with 3 sample collections) | demo@lotuslearn.local | lotus-demo-2026 |
| Administrator | admin@lotuslearn.local | lotus-admin-2026 |

Disable them with `SEED_DEMO_USER=false` before sharing the server. To make a real administrator:

```bash
npm run create-admin -- you@example.com "a-strong-password" "Your Name"
```

Other commands:

```bash
npm run dev        # restart on server changes
npm test           # 50 unit + integration tests (node:test, in-memory database)
npm run test:e2e   # 17 browser flows incl. all four themes (needs: pip install playwright && playwright install chromium)
npm run check      # syntax + asset + unsafe-pattern checks
npm run seed       # re-run the idempotent seed
npm run backup     # consistent online copy of the database into data/backups/
npm run art        # regenerate all pixel art from tools/build-art.mjs
```

## Optional external services

Core learning (accounts, collections, lessons, lotuses, statistics, dictionary, reading, video playback, admin) works with **no keys at all**. These add features; each fails gracefully and is reported in Admin → Overview:

| Feature | Setting | Without it |
| --- | --- | --- |
| Daily AI stories (3–5/language/day), grammar lessons (3–5), vocabulary, Daily-Topic top-ups, dictionary enrichment (senses, synonyms, collocations, examples, equivalents), AI review pass, classification | `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) | Skipped by the scheduler and recorded as a shortfall; manual runs report "not configured"; everything else works |
| Daily YouTube discovery (3–5/language/day) | `YOUTUBE_API_KEY` | Admins add YouTube or other legal video links by hand |
| Password-reset emails | `RESEND_API_KEY` | Reset link is printed in the server console |

AI output is **held for review by default**: generated words, stories, grammar lessons and dictionary enrichments land in Admin → Review queue (per language) with script validation, duplicate checks, length checks (stories ≥ 20 sentences) and an independent AI review note. An admin may opt in to *auto-publish validated AI content*; it is then labelled "not human-reviewed".

### Daily content while running locally

The server runs a durable scheduler (every `AUTOMATION_INTERVAL_MINUTES`). Each run checks, per language, when content was last produced, catches up missed days (up to `catchup_days`, default 7) and queues idempotent jobs keyed by language/type/date, so restarts, several open tabs or repeated runs never create duplicates. Temporary failures retry up to 3 times with back-off; shortfalls are recorded in Admin → Automation. Opening the app also triggers a throttled catch-up check. Open tabs are told about newly published content through a server-sent event stream (with a 5-minute polling fallback) and refresh the visible page. Nothing runs while the server is stopped; work resumes on the next start.

## Languages, themes and reference images

Switch the learning language from the top bar. The theme, scenes, decorations, content and progress all follow; nothing in the other languages changes. Themes are one component system driven by per-language design tokens (`public/css/app.css`) and generated art (`tools/build-art.mjs`):

| Language | Art | Colours | Scenes & animation |
| --- | --- | --- | --- |
| Tamil | uploaded images 1–8 (jasmine branch, temple pillars ×2, bushes, kurinji flowers, kalash, sun flare, pink meadow) | images 9–10 | pink–blue sunrise sky, rising sun with rotating rays, pillars with jasmine garlands, kalash, shivering bushes and kurinji, pink flowers, lotus pond; animated jasmine corners on windows |
| Malayalam | images 11–17 (jungle border, palm leaves, fern, misty rainforest hills, Jog-style falls, waterfall rock, banana tree) | images 18–19 | smoky light-grey sky, misty Kerala hills, three animated waterfalls, banana plants, ferns, animated white flowers, hanging banana bunches on window borders |
| Kannada | **no images supplied** — written brief only | brief hex list | sunset sky, slowly setting sun, banyan with aerial roots, fig trees, reflecting pond, animated frangipani corners |
| Telugu | **no images supplied** — written brief only | brief hex list | yellow-pink early-summer sky, large rising sun, mango trees, swaying mango branches, aquamarine canal |

The PRD's reference mappings disagree with each other and with the 19 images actually uploaded; the table follows your per-image instructions, adjusted to the uploaded files. Reduced motion and the "motion off" setting show still scenes.

## Project layout

```
server/            HTTP server, router, services (one per module), migrations, seed
  services/        auth, meta, vocabulary, dictionary (senses), collections(+selection), learning,
                   mastery, stats, library(reading+videos), profile (language profiles), grammar,
                   notes, dailyTopics, content (automation), events (live updates)
  migrations/      001_init.sql, 002_multilingual.sql (additive; backup taken first)
  integrations/    LLM provider abstraction, YouTube Data API, mailer
shared/            transliteration & validation for Tamil, Malayalam, Kannada, Telugu (+ Hindi); water renderer
public/            index.html, css/app.css (design system), js/ (SPA, scene engine, charts, pages)
public/art/        original generated pixel art (scenes, sprite sheets, lotus stages, ornaments)
tools/             build-art.mjs (art generator), check.mjs
tests/             unit/, integration/, e2e/ (+ screenshots)
```

## Architecture notes and deliberate deviations

* **Stack.** The brief preferred Next.js + PostgreSQL + Prisma + Recharts. This build was produced in an environment with no package registry or database server, so it uses a stack that could be executed and tested end to end there: Node's `http` server, `node:sqlite` (transactions, foreign keys, unique/partial indexes), and a framework-free ES-module SPA with hand-written SVG charts. The result runs with zero installs. All SQL is in the service layer and the schema in `server/migrations`, so a move to PostgreSQL means porting one migration file and the `db.js` wrapper; services are independent of HTTP and UI.
* **Row-level security.** SQLite has no RLS, so every user-owned query carries an ownership predicate (`user_id = ?`) in the service layer; integration tests verify cross-user access returns 404.
* **Integrity.** One active lesson per user and one lotus per word per day are enforced by database constraints, not only code. Answers are idempotent (unique per question).
* **Animation.** A fixed 320×180 pixel stage is scaled to cover the viewport. Water and waterfalls are rendered into a canvas at 7–12 fps from the shared `shared/water.js` maths; plants sway via stepped CSS sprite-sheet animations with staggered timing; light pointer parallax on desktop. It pauses when the tab is hidden, is replaced by a complete static picture under `prefers-reduced-motion` or the user's "reduced"/"off" setting, and the static picture is shown before scripts load.

## Content honesty

Seed vocabulary and stories were written by the development team with AI assistance from common, high-frequency Tamil. They are marked **"editorial entry awaiting native-speaker review"**, not as verified. Admins mark entries native-reviewed after checking them.

See **IMPLEMENTATION_REPORT.md** for the PRD-by-section status, test evidence and known gaps.
