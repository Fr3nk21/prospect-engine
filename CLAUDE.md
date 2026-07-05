# UnFocus Prospect Engine

Lead management web app for UnFocus, a video production studio in Melbourne.
Single user (Francesco). Flow: scrape businesses from Google Maps → enrich with
email/Instagram from their websites → categorize → analyze Instagram screenshots
with Claude Vision → generate personalized cold emails → send via Gmail → track
replies and statuses.

## Architecture

- **Frontend + API routes**: Next.js (App Router, TypeScript), deployed on Vercel
- **Database + Auth + Storage**: Supabase (Postgres, single authenticated user,
  Storage bucket `screenshots`)
- **Scraper microservice**: Python FastAPI in `/scraper-service`, deployed on
  Railway at `https://prospect-engine-production-7809.up.railway.app`
  (`SCRAPER_SERVICE_URL`). Long-running scrape jobs run as background tasks
  (no timeout). Uses the Supabase **service_role** key (bypasses RLS).
  Endpoint protected by shared secret in `Authorization: Bearer` header
  (env `SCRAPER_API_TOKEN`). Health check at `GET /health`.
- **AI**: Claude API, model `claude-sonnet-4-6`, called **server-side only**
  (Next.js API route or FastAPI — never from the browser)
- **Cron**: Vercel Cron → API routes for: screenshot cleanup (>5 days),
  status reset ("No reply" → "To contact" after N months, from `settings`),
  Gmail reply polling (Module 4)

## Repo layout

```
/                     Next.js app (App Router)
  /app                routes; /app/api for API routes
  /lib                Supabase clients, shared helpers
  /components
/scraper-service      Python FastAPI (own deploy, own requirements.txt)
/db                   schema.sql and future migrations
/docs                 TASKS.md, module specs
```

## Data model (see /db/schema.sql — source of truth)

- `contacts` — one row per business. `place_id` unique (dedup key for scraper).
  Claude analysis fields (`analysis`, `score_breakdown`, emails) live here and
  survive screenshot deletion.
- `contact_events` — append-only history: status changes, notes, emails sent,
  replies. **Status changes are logged by a Postgres trigger** (`trg_contacts_status`),
  which also sets `last_contact_date`. Never insert `status_change` events from
  app code — just update `contacts.status`.
- `scrape_jobs` + `scrape_job_items` — async job tracking. Progress =
  `processed/total`. Items enable resume after crash.
- `screenshots` — Storage paths; a daily cron deletes rows + files older than
  `settings.screenshot_ttl_days` (5).
- `blocklist` — place_ids of "Not interested" contacts; scraper skips them.
- `settings` — key/value jsonb (reset months, TTL days).

## Domain rules

- Statuses: `To contact` → `Contacted` → `No reply` / `In conversation` / `Not interested`
- Categories (v2 — website is NOT a factor; category measures prospect value,
  contactability is separate data): `High` (rating ≥ 4.5 AND reviews > 200),
  `Medium` (4.0 ≤ rating < 4.5 OR 100 ≤ reviews ≤ 200), else `Low`
- `is_new_venue` flag (orthogonal to category): rating ≥ 4.5 AND
  10 ≤ reviews ≤ 100 → likely recently opened, prime prospect. Shown as
  badge/filter in the UI, never merged into category (kept separate so
  reply-rate analysis can validate it later)
- Setting status to `Not interested` must also insert the contact's `place_id`
  into `blocklist` (app code, not trigger — needs the place_id check)
- Max 10 Instagram screenshots per analysis
- Generated emails: greeting "Hey [business name]", sign-off "Cheers, Francesco",
  one free specific observation as lead magnet, no generic adjectives
  ("stunning", "amazing"), CTA "Curious if this resonates?" or natural equivalent,
  no bullets/bold in email body

## Conventions

- TypeScript strict; Server Components by default, Client Components only when
  interactive
- UI text in **English**; conversation with Francesco in **Italian**
- Light/dark theme via CSS variables (see mockup in /docs if present)
- Python: type hints, httpx + asyncio for enrichment (concurrency ~8),
  never hammer the same host
- Secrets only in env vars: `.env.local` (Next.js), Railway env (FastAPI),
  never committed. Keep `.env.example` updated.
- All Claude API calls include max_tokens and parse JSON defensively
  (strip markdown fences, validate fields)

## Modulo attuale — Modulo 2 (Scraper come servizio)

- Task 2.1 (FastAPI su Railway) ✅ completato e testato: `POST /scrape`
  (bearer token) crea la riga in `scrape_jobs` e lancia il lavoro in
  background; `GET /scrape/{job_id}` per controllare l'avanzamento.
- Task 2.2 (Places API New + field mask) ✅ completato e testato: Text
  Search e Place Details via `httpx` diretto su `places.googleapis.com/v1`
  (la legacy `googlemaps` non è abilitata sul progetto GCP — solo
  "Places API (New)", da Modulo 0). Field mask minimale (`places.id`) in
  fase di ricerca; field mask completo richiesto solo per i candidati che
  superano il filtro duplicati/blocklist. Filtro `businessStatus`: i
  locali non `OPERATIONAL` vengono scartati (contati in `skipped`, ma
  senza riga in `scrape_job_items` — lo schema non ha ancora uno status
  dedicato tipo `skipped_closed`)
- Dedup (place_id già in `contacts` o `blocklist`) già implementato dentro
  il task 2.1 — corrisponde al "fatto quando" del task 2.4 di
  `docs/TASKS.md`
- Evento `contact_events` (`type='import'`, body descrittivo
  "Scraped from Google Maps — {location}, {business_type}") aggiunto per
  ogni nuovo contatto — task 2.3 (numerazione del prompt esterno)
- Task 2.1-2.3 ✅ completati e testati sia in locale sia in produzione su
  Railway (`SCRAPER_SERVICE_URL` sopra), incluso `GET /health`
- File chiave: `scraper-service/main.py`, `scraper-service/scraper_core.py`,
  `scraper-service/railway.json`

⚠️ **Divergenza numerazione task, ancora aperta**: il task 2.3 di
`docs/TASKS.md` è "Enrichment parallelo" (httpx + asyncio, concorrenza ~8,
homepage+/contact+/about+mailto, obiettivo <5s medi a contatto) — **non
ancora implementato**: il crawler del sito (`scraper_core.scrape_website`)
è tuttora sincrono con `requests`, un sito alla volta. La numerazione che
stiamo seguendo in sessione (prompt esterno) ha invece già segnato 2.1-2.3
come completi. Non bloccante per procedere, ma da tenere a mente: la
parallelizzazione dell'enrichment resta da fare a un certo punto.

Prossimo: task 2.4 (integrazione Next.js — bottone "Start search" nel
frontend che chiama `SCRAPER_SERVICE_URL`, presumibilmente con barra di
avanzamento, corrispondente al task 2.5 "Progress nel frontend" di
`docs/TASKS.md`).

## Development approach

Work module by module, end-to-end, testing before moving on (see /docs/TASKS.md).
Francesco is not a professional developer but knows Next.js, Python, and Vercel:
explain architectural choices before implementing, don't oversimplify code.
Ask before making non-obvious architectural decisions.

## Commands

```
npm run dev            # Next.js locally
npm run build          # production build check
cd scraper-service && uvicorn main:app --reload   # FastAPI locally
```
