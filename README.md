# Lotus Learn 🪷

An AI-assisted Tamil learning web application: vocabulary collections, a ten-correct-answer learning engine, lotus mastery, statistics, a multilingual dictionary (English / Hindi / Malayalam → Tamil), a reading library, a video library and an admin dashboard for AI content automation, presented as a living tropical pixel-art world with retro-Windows frames.

## Run it locally

**Requirement:** Node.js **22.13 or newer** (it uses Node's built-in SQLite). Nothing else: there are **no npm dependencies to install**.

```bash
cd lotus-learn
cp .env.example .env      # optional – the defaults work
npm start                 # or: node --disable-warning=ExperimentalWarning server/index.js
```

Open **http://localhost:3000**.

On first start the database (`data/lotus.db`) is created, migrated and seeded with levels, 28 topics, 52 vocabulary entries, 5 vocabulary lists and 3 original stories, plus two **development** accounts:

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
npm test           # 39 unit + integration tests (node:test, in-memory database)
npm run test:e2e   # 14 browser flows (needs: pip install playwright && playwright install chromium)
npm run check      # syntax + asset + unsafe-pattern checks
npm run seed       # re-run the idempotent seed
npm run backup     # consistent online copy of the database into data/backups/
npm run art        # regenerate all pixel art from tools/build-art.mjs
```

## Optional external services

Core learning (accounts, collections, lessons, lotuses, statistics, dictionary, reading, video playback, admin) works with **no keys at all**. These add features; each fails gracefully and is reported in Admin → Overview:

| Feature | Setting | Without it |
| --- | --- | --- |
| AI vocabulary & story generation, AI review pass, translation assist, AI dictionary suggestions, AI video classification | `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) | Jobs are skipped by the scheduler; manual runs fail with a clear "not configured" error; dictionary shows no AI button |
| Automatic daily YouTube discovery (2–4/day) | `YOUTUBE_API_KEY` | Admins add videos by link; discovery skipped |
| Password-reset emails | `RESEND_API_KEY` | Reset link is printed in the server console |

AI output is **never published automatically**: generated words and stories land in Admin → Review queue with script validation, duplicate checks, difficulty statistics and an independent AI review note.

## Project layout

```
server/            HTTP server, router, services (one per module), migrations, seed
  services/        auth, meta, vocabulary(+dictionary), collections(+selection), learning,
                   mastery, stats, library(reading+videos), profile, content(automation)
  integrations/    LLM provider abstraction, YouTube Data API, mailer
shared/            Tamil transliteration/validation/search keys; water renderer (server+browser)
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
