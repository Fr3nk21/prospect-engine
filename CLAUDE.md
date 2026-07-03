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
  Railway. Long-running scrape jobs run as background tasks (no timeout).
  Uses the Supabase **service_role** key (bypasses RLS). Endpoint protected by
  shared secret in `Authorization: Bearer` header (env `SCRAPER_API_TOKEN`).
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
- Categories: `High` (rating ≥ 4.5 AND reviews > 200 AND has website),
  `Medium` (4.0 ≤ rating < 4.5 OR 100 ≤ reviews ≤ 200), else `Low`
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

## Modulo attuale — Modulo 1

### Task 1.1 — Scaffold Next.js + Auth ✅ COMPLETATO E TESTATO
- Next.js 15 (App Router, TypeScript) scaffoldato nella root del repo
- Supabase Auth con `@supabase/ssr`: login (email+password), logout, middleware
- Route protette: redirect → /login se non autenticato; redirect → /contacts se già loggato
- Toggle tema chiaro/scuro (CSS variables, preferenza in localStorage)
- File chiave: `middleware.ts`, `lib/supabase/server.ts`, `lib/supabase/client.ts`,
  `components/topbar.tsx`, `app/login/page.tsx`, `app/globals.css`

### Task 1.2 — Import Google Sheet 🔄 IN CORSO
**Infrastruttura pronta:**
- Service account Google: `sheets-reader@prospect-engine-501213.iam.gserviceaccount.com`
- Chiave: `scraper-service/prospect-engine-501213-01c1baacedda.json`
  (in `scraper-service/.gitignore`, mai committata)
- Foglio "Melbourne Venues" condiviso come Viewer con il service account

**Punto di stop:** mappatura colonne foglio→DB mostrata e confermata da Francesco;
lo script `scraper-service/import_sheet.py` NON è ancora stato scritto.

**Mappatura approvata (sheet → contacts):**
`Venue`→`name`, `Indirizzo`→`address`, `Area`→`suburb`, `Telefono`→`phone`,
`Sito Web`→`website`, `Email`→`email`, `Instagram`→`instagram`,
`Rating`→`rating`, `N° Recensioni`→`review_count`, `Tipo Attività`→`business_type`,
`Categoria`→`category` (Alta/Media/Bassa → High/Medium/Low),
`Stato Contatto`→`status` (vedi mappatura sotto), `Data Contatto`→`last_contact_date`;
skip: `Qualità Instagram`, `DM Instagram`, `Email Bozza`, `Aggiornato`.
Stati: vuoto/`Da contattare`→`To contact`, `Contattato`→`Contacted`,
`Contattato ma non risposto`→`No reply`, `In conversazione`→`In conversation`,
`Contattato e non interessato`→`Not interested` (+ insert in blocklist).
`place_id`=NULL per tutti, `source`=`sheet_import`.

**Prossimo passo:** scrivere `scraper-service/import_sheet.py` con
`--dry-run`, riepilogo (lette/inserite/scartate), inserimento in `blocklist`
per i Not interested.
