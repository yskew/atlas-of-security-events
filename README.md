# SecurityEvents

A free ($0/month) project that discovers upcoming **cybersecurity events** —
CTFs, calls-for-papers, conferences, meetups (OWASP / BSides / DEF CON groups),
BlueHat-style and blue-team events — across cities worldwide, deduplicates them,
stores them in a database, and presents them on an **immersive interactive
globe**. Past-deadline events expire automatically, so users only ever see
opportunities they can still act on.

Two parts:

- **`pipeline/`** — a Python discovery pipeline (runs nightly on GitHub Actions).
- **`web/`** — a Next.js + react-three-fiber globe UI (deploys to Vercel).

Everything runs on free tiers: GitHub Actions (cron), Neon (Postgres), Google
Gemini + OpenRouter (LLMs), DuckDuckGo (search), Vercel (UI hosting).

## How the pipeline works

```
DISCOVER → FETCH (ladder) → EXTRACT (LLM) → FILTER → DEDUP → UPSERT → EXPIRE
```

- **Discover** — ctftime API (free, no key) for CTFs, plus keyless DuckDuckGo
  search across `{event type × city}` and brand queries (OWASP / BSides / …).
- **Fetch ladder** ([fetch.py](pipeline/fetch.py)) — direct HTTP → Jina Reader
  (renders JS pages, free) for sites that 403 or are single-page apps.
- **Extract** ([extract.py](pipeline/extract.py)) — an LLM turns a page into
  structured, grounded records (a page may yield several events). Provider chain:
  Gemini models first (each has its own free daily quota), then OpenRouter free
  models — so coverage continues after any one quota is spent.
- **Filter** — only on-site, target-geo, reputable, professional, well-known,
  genuinely-cybersecurity events with a future deadline. Aggregator/academic
  domains are dropped before fetching; the LLM tags `audience` + `notable`.
- **Dedup** — exact fingerprint then fuzzy match merges the same event seen from
  multiple sources into one canonical record with many "sightings".
- **Expire** ([expire.py](pipeline/expire.py)) — soft-delete past-deadline events
  (kept as tombstones so they aren't re-added); hard-purge long-archived rows.

**City sweep with a bookmark.** Cities are processed in priority order. A cursor
in the DB (`pipeline_state`) records the last finished city, so each run resumes
where the previous one stopped and **resets to the first city after a full
sweep** — shared between local and CI runs via the same database. Runs stop on a
wall-clock budget (`RUN_MAX_MINUTES`) or when a sweep completes; the rest stays
queued (events commit one-by-one, so a stopped/killed run loses nothing).

## Quick start (local, no keys needed)

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows;  source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env              # optional — runs on ctftime alone with no keys

python -m pipeline.run            # discover → store → expire (SQLite locally, no time cap)
python -m pipeline.run --list     # print currently-active events
```

Run the UI:

```bash
cd web
npm install
npm run dev                       # http://localhost:3000  (reads DATABASE_URL from web/.env.local)
```

## Configuration

Copy `.env.example` to `.env` (see that file for the full annotated list). Highlights:

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | SQLite locally; Neon/Postgres in prod | `sqlite:///securityevents.db` |
| `GEMINI_API_KEYS` | comma-separated keys; enables discovery + extraction | _(unset → ctftime only)_ |
| `OPENROUTER_API_KEY` | free-model fallback after Gemini quota | _(unset)_ |
| `RUN_MAX_MINUTES` | wall-clock budget per run (0 = no cap) | `0` |
| `TARGET_FRESH_PER_CITY` | fresh URLs to extract per city | `15` |
| `REVERIFY_AFTER_DAYS` | re-check a processed URL after N days | `7` |

Target cities & event types live in [pipeline/config.py](pipeline/config.py) —
the UI is data-driven, so adding a city needs **no** frontend change.

## Deployment ($0/month)

### Database — Neon
Create a free [Neon](https://neon.tech) Postgres project; copy its connection
string. Use it as `DATABASE_URL` everywhere below.

### UI — Vercel
1. Import the GitHub repo into [Vercel](https://vercel.com).
2. Set **Root Directory = `web`** (the Next.js app lives in the subfolder).
3. Add env var **`DATABASE_URL`** = your Neon string. Deploy.

### Pipeline — GitHub Actions (cron)
[.github/workflows/pipeline.yml](.github/workflows/pipeline.yml) runs twice daily
(00:00 & 05:30 UTC), 5h soft cap each. Add these **repository secrets**
(Settings → Secrets and variables → Actions):

- `DATABASE_URL` — the same Neon string
- `GEMINI_API_KEYS`
- `OPENROUTER_API_KEY`

> ⚠️ **Never commit `.env` / `web/.env.local`** (both gitignored). If any key was
> ever shared or committed, **rotate it** before/after going public.

## Project layout

```
pipeline/            Python discovery pipeline
  config.py          cities, event taxonomy, query templates, settings
  models.py          ExtractedEvent schema + fingerprint/geo/deadline helpers
  db.py              SQLAlchemy models, work-queue, cursor, upsert/dedup
  fetch.py           fetch ladder (httpx → Jina Reader)
  extract.py         multi-provider LLM extraction (Gemini → OpenRouter)
  expire.py          soft-expire + hard-purge lifecycle
  run.py             orchestrator / CLI (city sweep, bookmark, time budget)
  sources/           ctftime API + DuckDuckGo web search
web/                 Next.js 16 + react-three-fiber globe UI
  src/app/           routes, layout, Neon read
  src/components/    Globe, Explorer, FilterRail, EventList, MobileShell, Hud …
  src/lib/           geo, store (zustand), db (Neon), filters, utils
.github/workflows/   pipeline.yml (scheduled discovery run)
brand/               logo source assets
tests/               pytest suite
```

## Tests

```bash
pip install pytest
pytest
```
