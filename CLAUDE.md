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
  Gmail reply polling (Task C — not yet implemented)

## Repo layout

```
/                     Next.js app (App Router)
  /app                routes; /app/api for API routes
  /lib                Supabase clients, shared helpers
  /components
/scraper-service      Python FastAPI (own deploy, own requirements.txt)
/db                   schema.sql and future migrations
/docs                 TASKS.md, STARTUP.md, ARCHITECTURE.md, USER_GUIDE.md
```

## Data model (see /db/schema.sql — source of truth)

- `contacts` — one row per business. `place_id` unique (dedup key for scraper).
  Claude analysis fields (`analysis`, `score_breakdown`, emails) live here and
  survive screenshot deletion. `score_breakdown` now includes `intent`, `craft`,
  `gap` fields in addition to `dimensions` and `total_score`.
- `contact_events` — append-only history: status changes, notes, emails sent,
  replies. **Status changes are logged by a Postgres trigger** (`trg_contacts_status`),
  which also sets `last_contact_date`. Never insert `status_change` events from
  app code — just update `contacts.status`.
- `scrape_jobs` + `scrape_job_items` — async job tracking. Progress =
  `processed/total`. Items enable resume after crash.
- `screenshots` — Storage paths; a daily cron deletes rows + files older than
  `settings.screenshot_ttl_days` (5).
- `blocklist` — place_ids of "Not interested" contacts; scraper skips them.
- `settings` — key/value jsonb. Keys in use: `analysis_context`,
  `scoring_config`, `screenshot_ttl_days`, `recontact_months`.

## Domain rules

- Statuses: `To contact` → `Contacted` → `No reply` / `In conversation` /
  `Not interested` / `To recontact`
- **Categories (v3 — Model B, opportunity-based, NOT Google rating-based)**:
  - New contacts from scraper arrive as `Not analysed`
  - After Instagram analysis: `High` / `Medium` / `Low` based on opportunity
    score (see Scoring section below)
  - The old Google-based categorization (rating ≥ 4.5 = High etc.) is retired.
    `scraper_core.categorize()` still exists for `is_new_venue` logic but its
    `category` return value is ignored — contacts always save as `Not analysed`.
  - Check constraint on `contacts.category` includes `'Not analysed'`
    (migration applied manually via SQL Editor)
- `is_new_venue` flag (orthogonal to category): rating ≥ 4.5 AND
  10 ≤ reviews ≤ 100 → likely recently opened. Badge in UI, never merged into
  category.
- Setting status to `Not interested` must also insert the contact's `place_id`
  into `blocklist` (app code, not trigger)
- Max 10 Instagram screenshots per analysis
- Generated emails: greeting "Hey [business name]", sign-off "Cheers," on one
  line then "Francesco" on the next line (real line break). No em/en dashes,
  no generic adjectives, no bullets/bold. CTA: low-friction concrete next step
  (never "does this resonate"). Tone and focus adapt to photo/video gap and
  brand intent signals (see prospect_vision.py EMAIL PHILOSOPHY).

## Opportunity Scoring (Model B) — prospect_vision.py + main.py

The score shown in the IG column measures **"how good a client is this"**,
not "how nice is their Instagram". Implemented in `pv.compute_opportunity()`.

**Six dimensions scored by Claude Vision (0-20 each):**
- `photo_quality` — still photo quality
- `video_presence` — Reels/video amount and quality (judged strictly — KEY)
- `content_consistency` — cohesive brand identity
- `posting_frequency` — regularity and recency
- `engagement_signals` — visible likes/comments
- `bio_profile` — professional bio, highlights, contact info

**Two derived indicators (0-100):**
- **Intent** = do they care about their brand? (weighted: content_consistency
  35%, posting_frequency 30%, engagement_signals 20%, bio_profile 15%)
- **Craft** = how good is their quality already? (video_presence 60%,
  photo_quality 40%)

**Opportunity** = blend of Intent and gap (Intent − Craft). Big positive gap =
they care but execute poorly = opportunity for UnFocus.

**Category thresholds (defaults, overridable via `settings.scoring_config`):**
- `High`: gap ≥ 20 AND Intent ≥ 40
- `Medium`: gap 5–20 AND Intent ≥ 40
- `Low`: Intent < 40 (won't invest) OR gap < 5 (already well served)

**Email tone adapts to scores:**
- Lead with whichever craft dimension is weaker (photo vs video)
- Match confidence to brand intent signals: direct/specific for high-intent
  venues with clear gap; lighter/exploratory for weaker signals or polished
  profiles

**Config:** weights and thresholds live in `settings.scoring_config` (JSONB).
`main.py._load_scoring_config()` reads this at runtime with fallback to
`pv.DEFAULT_SCORING_CONFIG`. Modifiable from Supabase SQL Editor without
code changes. A Settings UI for this is planned but not yet built.

## Conventions

- TypeScript strict; Server Components by default, Client Components only when
  interactive
- UI text in **English**; conversation with Francesco in **Italian**
- Light/dark theme via CSS variables
- Python: type hints, httpx + asyncio for enrichment (concurrency ~8),
  never hammer the same host
- Secrets only in env vars: `.env.local` (Next.js), Railway env (FastAPI),
  never committed. Keep `.env.example` updated.
- All Claude API calls include max_tokens and parse JSON defensively
  (strip markdown fences, validate fields)
- **`prospect_vision.py` is pure** (no Supabase dependency). All I/O lives
  in `main.py`. `compute_opportunity()` is a pure function — no side effects.
- **Use `.replace()` not `.format()` for prompt injection** in
  `build_system_prompt()` — the prompt contains literal `{}` in the JSON
  example which would cause KeyError with `.format()`.

## UI — contacts list

Column order: Business · IG · Category · Rating · Status · Last contact

- **IG column**: shows `📷 72` (screenshots + score), `📷` (screenshots only),
  or `—`. Score = opportunity score 0-100. Tooltip: "Opportunity score: X/100".
- **Category**: tag based on Instagram analysis result. `Not analysed` (grey)
  until analysis runs, then `High` / `Medium` / `Low`.
- **Rating**: Google rating, shown small and dimmed (opacity 0.5). Kept for
  triage before analysis — do not remove.
- Filters survive navigation: filter bar uses `router.replace` + `scroll:false`;
  "← All contacts" uses `window.history.back()` via `components/back-button.tsx`
  (Client Component — needed because the detail page is a Server Component).

## Key files changed in Sept 2026 sessions

- `scraper-service/prospect_vision.py` — Model B scoring, 6 new dimensions
  (photo_quality replaces visual_quality), compute_opportunity(), adaptive
  email tone rules, _strip_dashes() safety net
- `scraper-service/main.py` — _load_scoring_config(), compute_opportunity()
  integration, category written from IG score not Google data, "Not analysed"
  default for new contacts
- `lib/contacts.ts` — ContactListItem updated (instagram_score replaces
  has_analysis), ScoreBreakdown updated (intent/craft/gap fields)
- `app/(protected)/contacts/page.tsx` — column order, scoreMap from
  score_breakdown JSONB, explicit row mapping (no spread cast)
- `components/contact-row.tsx` — IG before Category, Rating dimmed inline
- `components/contacts-filter-bar.tsx` — router.replace + scroll:false
- `components/back-button.tsx` — NEW: Client Component for history.back()
- `components/analysis-panel.tsx` — status messages during analysis
  (JOB_STATUS_LABEL: queued/running)
- `components/screenshot-upload.tsx` — optimistic delete (removingIds Set,
  instant UI update, rollback on error)
- `docs/STARTUP.md`, `docs/ARCHITECTURE.md`, `docs/USER_GUIDE.md` — NEW

## Modulo 2 (Scraper come servizio) — ✅ completato e testato in produzione

- Task 2.1 (FastAPI su Railway): `POST /scrape` (bearer token) crea la riga
  in `scrape_jobs` e lancia il lavoro in background; `GET /scrape/{job_id}`
  per controllare l'avanzamento. Deploy documentato in `docs/deploy.md`.
- Task 2.2 (Places API New + field mask): Text Search e Place Details via
  `httpx` diretto su `places.googleapis.com/v1`. Field mask minimale
  (`places.id,nextPageToken`) in fase di ricerca — `nextPageToken` è
  top-level e va incluso esplicitamente altrimenti la paginazione si ferma
  a 20 risultati.
- Dedup e blocklist (place_id già in `contacts` o `blocklist`) in
  `run_scrape_job`. Evento `contact_events` (`type='import'`) per ogni
  nuovo contatto.
- Task 2.5 (Progress nel frontend): barra via Supabase Realtime su
  `scrape_jobs`. Richiede `replica identity full` + tabella in
  `supabase_realtime`. JWT propagato esplicitamente
  (`supabase.realtime.setAuth`).
- Enrichment parallelo: `asyncio.Semaphore(8)` + `scraper_core.HostLocks`
  (un lock per hostname).
- File chiave: `scraper-service/main.py`, `scraper-service/scraper_core.py`,
  `app/api/scrape/route.ts`, `components/scrape-panel.tsx`.

## Modulo 3 (Analisi Claude e generazione email) — ✅ completato e testato

- Task 3.1: drag & drop screenshot → Supabase Storage, limite 10,
  resize client-side (canvas, lato lungo max 2000px), rollback storage
  se insert DB fallisce. Optimistic delete: screenshot sparisce
  immediatamente dalla UI, server action gira in background.
- Task 3.2: pattern async identico allo scrape (Railway background job +
  Supabase Realtime). `analysis_jobs` table. `ANTHROPIC_API_KEY` su Railway.
  Feedback visivo: "Waiting for the analysis service…" / "Analyzing
  screenshots with Claude Vision…" durante il job.
- Task 3.3: cron pulizia screenshot (`0 3 * * *`), client service_role,
  `api/cron` escluso dal middleware auth check.
- File chiave: `scraper-service/main.py`, `scraper-service/prospect_vision.py`,
  `app/api/contacts/[id]/analyze/route.ts`, `components/analysis-panel.tsx`,
  `components/screenshot-upload.tsx`.

## Modulo 4 (Gmail) — ✅ completato (task 4.1–4.2), Task C rimandato

- Task 4.1: OAuth consent screen, scope `gmail.send` only. Flusso one-shot:
  `/api/auth/gmail/start` → Google consent → `/api/auth/gmail/callback`
  mostra refresh token da copiare in `GMAIL_REFRESH_TOKEN`. Token scade
  dopo ~7 giorni se app è in "Testing" mode — fix permanente: pubblicare
  app su "In production" in Google Cloud Console.
- Task 4.2: invio via Gmail API REST (no googleapis SDK). RFC 2822 raw
  base64url. Subject UTF-8 encoded (RFC 2047) per caratteri non-ASCII.
  Threading: `Message-ID` generato da `lib/gmail.ts`, salvato in
  `contacts.gmail_message_id`, usato come `In-Reply-To`/`References` al
  prossimo invio. Stato → `Contacted` solo se era `To contact`.
  Email inviata come `text/html` (per link unsubscribe cliccabile).
- Firma: hardcoded in `lib/gmail.ts` `buildRawMessage`, non in
  `contacts.email_*` (testo "puro" separato dalla firma).
- Task C (polling risposte): rimandato a dopo le prime email reali.
  Richiederà scope aggiuntivo `gmail.readonly` e re-consent OAuth.
- File chiave: `lib/gmail.ts`, `app/(protected)/contacts/[id]/actions.ts`,
  `components/analysis-panel.tsx`.

## Task A — Firma email — ✅

Firma aggiornata in `lib/gmail.ts`:
```
--
Francesco Bugugnoli
Videographer & Photographer
0476 278 891
unfocus.com.au
```

## Task B — Unsubscribe + re-engagement — ✅

- Stateless HMAC-SHA256 token (`lib/unsubscribe-token.ts`, chiave `CRON_SECRET`).
- `app/api/unsubscribe/route.ts`: setta `unsubscribed_at`, `status='Not
  interested'`, aggiunge a `blocklist`. Esclusa dal middleware auth check.
- Status `To recontact`: cron daily (`0 4 * * *`), `recontact_months` da
  `settings`. Chi ha fatto unsubscribe non viene mai toccato.
- Migration 007 eseguita su Supabase.

## Task E — Normalizzazione business_type — ✅

`GOOGLE_TYPE_LABELS` dict in `scraper_core.py` (~60 voci). Fallback = query
di ricerca digitata nel form (leggibile sempre). Nessun backfill sui dati
esistenti.

## Task F — Contesto settore configurabile — ✅

`analysis_context` in `settings` (migration 008 eseguita). UI in
`/settings`. `build_system_prompt()` usa `.replace()` non `.format()`
(il prompt contiene `{}` letterali nel JSON di esempio).

## Development approach

Work module by module, end-to-end, testing before moving on (see /docs/TASKS.md).
Francesco is not a professional developer but knows Next.js, Python, and Vercel:
explain architectural choices before implementing, don't oversimplify code.
Ask before making non-obvious architectural decisions.

For architecture and debugging: use this project chat (more capable model).
For implementation: Claude Code with Sonnet.

## Commands

```
npm run dev            # Next.js locally (porta 3000; se occupata da altro progetto scala a 3001)
npm run build          # production build check
cd scraper-service && uvicorn main:app --reload   # FastAPI locally
```