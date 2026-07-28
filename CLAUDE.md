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

## Modulo 2 (Scraper come servizio) — ✅ completato e testato in produzione

- Task 2.1 (FastAPI su Railway): `POST /scrape` (bearer token) crea la riga
  in `scrape_jobs` e lancia il lavoro in background; `GET /scrape/{job_id}`
  per controllare l'avanzamento. Deploy documentato in `docs/deploy.md`
  (root directory, env vars, comandi curl di test).
- Task 2.2 (Places API New + field mask): Text Search e Place Details via
  `httpx` diretto su `places.googleapis.com/v1` (la legacy `googlemaps` non
  è abilitata sul progetto GCP — solo "Places API (New)", da Modulo 0).
  Field mask minimale (`places.id`) in fase di ricerca; field mask completo
  richiesto solo per i candidati che superano il filtro duplicati/blocklist.
  Filtro `businessStatus`: i locali non `OPERATIONAL` vengono scartati
  (contati in `skipped`, ma senza riga in `scrape_job_items` — lo schema non
  ha ancora uno status dedicato tipo `skipped_closed`)
- Dedup e blocklist (place_id già in `contacts` o `blocklist`) implementato
  dentro `run_scrape_job` — corrisponde al task 2.4 di `docs/TASKS.md`.
  Evento `contact_events` (`type='import'`) aggiunto per ogni nuovo
  contatto.
- Task 2.5 di `docs/TASKS.md` (Progress nel frontend) ✅ completato e
  testato: pannello "New search" (`components/scrape-panel.tsx`) chiama
  `app/api/scrape/route.ts` (proxy server-side verso `SCRAPER_SERVICE_URL`,
  token mai esposto al browser), che risponde con `job_id`; barra di
  avanzamento e contatori via Supabase Realtime (`postgres_changes` UPDATE
  su `scrape_jobs`, filtrata per `id`). Richiede `replica identity full` +
  tabella in `supabase_realtime` (`db/migration_003_realtime_scrape_jobs.sql`,
  eseguita). A fine job la lista contatti si aggiorna da sola
  (`router.refresh()`). Badge "New venue" (`is_new_venue`) visibile in
  lista e dettaglio contatto.
  - Nota tecnica: il client Realtime deve propagare esplicitamente il JWT
    (`supabase.realtime.setAuth(session.access_token)`) prima di
    sottoscrivere — altrimenti il socket si connette come `anon` e le RLS
    `to authenticated` bloccano silenziosamente ogni evento (nessun errore
    in console, semplicemente zero eventi ricevuti).
- File chiave: `scraper-service/main.py`, `scraper-service/scraper_core.py`,
  `scraper-service/railway.json`, `app/api/scrape/route.ts`,
  `components/scrape-panel.tsx`.

⚠️ **Debito tecnico noto, non bloccante**: il task 2.3 di `docs/TASKS.md`
("Enrichment parallelo", httpx + asyncio concorrenza ~8) **non è
implementato** — `scraper_core.scrape_website` è tuttora sincrono con
`requests`, un sito alla volta, con delay casuali di 2–5s tra i fetch
(homepage + fino a 3 link "contact" trovati + fino a 10 path standard tipo
`/contact`, `/about`, ecc.).

Impatto pratico stimato (in base al target dichiarato nello stesso task —
"200 contatti in ~15 minuti invece di 90" — quindi ~27s/contatto in
sincrono contro ~4.5s/contatto in parallelo a concorrenza 8):

| Risultati scrape | Sincrono (attuale) | Parallelo (concorrenza 8, da fare) |
|---|---|---|
| 50  | ~20–25 min | ~4 min |
| 100 | ~40–45 min | ~7–8 min |

Sotto i ~30-40 risultati per ricerca la differenza è tollerabile per un
uso manuale (avvii lo scrape e fai altro). Da risolvere prima di lanciare
scrape ricorrenti su aree grandi (100+ risultati attesi) o se si vuole
incolonnare più ricerche in sequenza.

Prossimo: Modulo 3 (Analisi Claude e generazione email) — vedi
`docs/TASKS.md`.

## Modulo 3 (Analisi Claude e generazione email) — ✅ completato e testato

- Task 3.1 (upload screenshot) **✅ completato e testato in locale**
  (drag&drop + click, limite 5MB, resize client-side, limite 10
  screenshot, rimozione singola verificata anche lato Storage,
  persistenza al reload). Bug risolto durante il test: in
  `resizeIfNeeded` (`screenshot-upload.tsx`), `bitmap.close()` veniva
  chiamato prima di `ctx.drawImage(bitmap, ...)`, causando un
  `ImageBitmap` detached e un errore silenzioso lato client (nessuna
  richiesta arrivava mai alla Server Action). File: `components/screenshot-
  upload.tsx` (drag&drop + click, resize client-side via canvas se il
  lato lungo supera 2000px, rifiuto file >5MB, contatore n/10, rimozione
  singola), `app/(protected)/contacts/[id]/actions.ts`
  (`uploadScreenshot`/`deleteScreenshot`, rollback dello storage se
  l'insert DB fallisce), `app/(protected)/contacts/[id]/page.tsx` (legge
  le righe `screenshots` esistenti + genera signed URL per le anteprime,
  bucket privato). `next.config.ts`: `serverActions.bodySizeLimit`
  alzato a 6MB per far passare i file nelle Server Action.
- Task 3.2 (analisi + generazione email) **✅ completato e testato**, sia
  in locale che in produzione su Railway. File:
  `app/api/contacts/[id]/analyze/route.ts` (proxy), `POST /analyze` e
  `GET /analyze/{job_id}` in `scraper-service/main.py`,
  `scraper-service/prospect_vision.py`, `components/analysis-panel.tsx`,
  `db/migration_004_analysis_jobs.sql` (tabella `analysis_jobs` — **già
  eseguita su Supabase**, confermato 2026-07-27: `create table` dava
  "relation already exists").
  - **Bug diagnosticato (2026-07-17) e risolto**: il proxy Next.js
    chiamava `SCRAPER_SERVICE_URL` puntato a Railway (produzione), che
    non aveva ancora `/analyze` perché `main.py` non era stato
    deployato (modifiche solo locali, mai committate). Risultato: 404
    propagato fedelmente dal proxy (`route.ts` fa `NextResponse.json(...,
    { status: response.status })`), con ~750ms di ritardo dato dal
    round-trip di rete verso Railway — non un `notFound()` nel codice né
    un problema di routing Next.js. Risolto committando
    main.py/prospect_vision.py/analysis-panel.tsx e deployando su
    Railway.
  - **Bug risolto (2026-07-28)**: `ANTHROPIC_API_KEY` su Railway era
    invalida — corretta nelle env var del servizio; test end-to-end in
    produzione ora passa.
  - **Osservazione investigata (2026-07-28), nessuna causa applicativa
    trovata**: nei log del dev server erano comparse decine di
    `GET /login 200` ripetuti ogni 30-40ms prima della richiesta di
    analisi. Ipotesi iniziale (`useEffect` senza dipendenze corrette →
    loop lato client) esclusa con evidenza: `app/login/page.tsx` è un
    Server Component puro senza `useEffect`/fetch; tutti gli `useEffect`
    in `analysis-panel.tsx`/`scrape-panel.tsx`/`topbar.tsx`/`contacts-
    filter-bar.tsx` hanno dipendenze e guardie corrette; non esiste
    nessun endpoint di polling GET per lo stato dei job (scrape/analysis
    usano solo Supabase Realtime); nessun `setInterval` in tutto il
    repo. Non riproducibile dal codice — probabile artefatto di
    browser/dev-tools durante quella sessione di test specifica (cookie
    di sessione scaduto su una tab, retry di una request reindirizzata).
    Non bloccante; da catturare dal vivo (tab Network, initiator delle
    richieste) se si ripresenta.
  Decisioni architetturali prese:
  - **Vercel Hobby impone davvero un cap di 60s** (verificato con un test
    reale: route con `maxDuration=60` e sleep di 65s → 504
    `FUNCTION_INVOCATION_TIMEOUT` a ~60.9s, nonostante il dashboard
    mostri 300s di default). Di conseguenza la chiamata a Claude Vision
    non può girare sincrona su una API route Vercel.
  - Pattern scelto: **stesso schema asincrono già validato per lo
    scrape** (Modulo 2.1/2.5) — `app/api/contacts/[id]/analyze/route.ts`
    diventa un proxy leggero (verifica sessione, poi inoltra a Railway);
    la logica reale (lettura screenshots, chiamata Claude Vision,
    parsing, save su `contacts`) gira come nuovo endpoint in
    `scraper-service/`, che crea una riga di job e risponde subito con un
    id; il frontend segue l'avanzamento via Supabase Realtime, come
    `scrape_jobs`. Serve una nuova tabella tipo `analysis_jobs` (non
    ancora creata).
  - `ANTHROPIC_API_KEY` va aggiunta alle env var di **Railway**, non di
    Vercel (la chiamata a Claude gira lato scraper-service).
  - **Score breakdown**: si mantengono le 6 dimensioni del prompt già
    validato in `scraper-service/prospect_analyzer.py` (Visual Quality,
    Content Consistency, Video Presence, Posting Frequency, Engagement
    Signals, Bio & Profile — scale diverse, totale /100). La dicitura
    "5 dimensioni 0-20" in `docs/TASKS.md` è imprecisa e va ignorata. La
    UI deve renderizzare dinamicamente qualunque numero di
    dimensioni/scale arrivi dal JSON di risposta — niente hardcoded.
  - **Tono email** (`email_technical` vs `email_warm`): stessa identica
    filosofia di fondo per entrambe — prima persona, tono onesto e
    umano, non salesy, dimostra di aver guardato davvero
    Instagram/sito (cita qualcosa di specifico visto negli screenshot),
    osservazione onesta su cosa funziona/manca, 1-2 soluzioni concrete
    legate a video/foto. La differenza è **solo di registro**:
    `technical` apre più dritto su osservazione+soluzione (adatta a
    business più strutturati/corporate); `warm` apre con più calore
    relazionale prima della proposta (adatta a attività piccole/
    familiari). Evitare in entrambe: linguaggio da agenzia, superlativi
    vuoti, urgenza artificiale, frasi genériche copiabili su qualunque
    business. Il SYSTEM_PROMPT esistente genera solo 2 varianti (cold +
    followup) e va riscritto per produrne 3 (technical/warm/followup).
  - Tracciabilità di quale variante viene poi usata in un invio reale:
    già coperta dallo schema esistente (`contact_events.email_variant`),
    non serve altro codice ora — verrà popolata nel Modulo 4 (invio).
- Task 3.3 (cron pulizia screenshot) **✅ completato e testato** — 8
  screenshot scaduti rimossi correttamente in test reale, analisi/email
  sui contatti verificati (incluso "3 Idiots") rimaste intatte; test 401
  senza header confermato. File: `app/api/cron/cleanup-screenshots/route.ts`
  (`GET`, protetto da `Authorization: Bearer {CRON_SECRET}`, legge
  `settings.screenshot_ttl_days`, cancella file da Storage poi righe da
  `screenshots`, logga quanti file/righe rimossi), `lib/supabase/admin.ts`
  (client `service_role`, necessario perché il cron non ha sessione utente
  quindi niente cookie → l'anon client con RLS non vedrebbe nulla),
  `vercel.json` (schedule daily `0 3 * * *`).
  - **Decisione architetturale**: il matcher di `middleware.ts` includeva
    `/api/*` e reindirizzava a `/login` qualunque richiesta senza sessione
    Supabase — una chiamata cron (nessun cookie) sarebbe stata bloccata
    prima di raggiungere la route. Escluso `api/cron` dal matcher
    (`middleware.ts`); le altre route `/api/*` restano invariate perché
    chiamate dal browser con sessione valida.
  - Nuove env var: `CRON_SECRET` (Vercel la invia automaticamente come
    header `Authorization: Bearer` sulle invocazioni cron quando la env
    var è impostata sul progetto — stesso pattern di `SCRAPER_API_TOKEN`),
    `SUPABASE_SERVICE_ROLE_KEY` (già in `.env.example`, ora anche in
    `.env.local`).

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
