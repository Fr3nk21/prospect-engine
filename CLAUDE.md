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

✅ **Debito tecnico del task 2.3 saldato**: `scraper_core.scrape_website` e
`fetch_page` sono ora async (`httpx.AsyncClient`); `main.py` divide
`run_scrape_job` in due fasi — fase 1 sequenziale (dedup/blocklist/Place
Details, invariata), fase 2 (`_enrich_candidates`) fa l'enrichment con
`asyncio.Semaphore(8)` + `scraper_core.HostLocks` (un `asyncio.Lock` per
hostname, creato al volo) così nessun host target viene mai colpito da più
di una richiesta contemporanea, indipendentemente dalla concorrenza-8
globale. Il delay casuale 2-5s anti rate-limiting resta scoped al singolo
host (dentro il lock), non è diventato globale. `run_scrape_job` resta una
funzione sync (FastAPI esegue le `BackgroundTasks` sync in un thread
separato via `run_in_threadpool`, senza loop già attivo) e lancia la fase 2
con `asyncio.run(...)` — verificato che non dà "event loop already
running". `processed`/`scrape_jobs` si aggiornano non appena il singolo
contatto completa il proprio enrichment (ordine di completamento, non
ordine di lista) — stesso comportamento osservabile di prima, solo più
rapido. Testato dal vivo: host diversi girano in parallelo, stesso host
si serializza correttamente.

✅ **Bug risolto — Text Search si fermava sempre a 20 risultati**: non era
un problema del ciclo di paginazione (già corretto: `while True`, sleep
2s, retry con `pageToken`, stop quando il token manca) ma di
`SEARCH_FIELD_MASK = "places.id"` — `nextPageToken` è un campo top-level
(non annidato sotto `places`) e le Places API (New) lo stripano sempre
dalla risposta se non è esplicitamente nel field mask, anche quando
esistono altre pagine. Fix: `SEARCH_FIELD_MASK = "places.id,nextPageToken"`.
Verificato dal vivo: una query con >20 risultati ora recupera le 3 pagine
(60 risultati, il cap naturale di Google) invece di fermarsi alla prima.

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

## Modulo 4 (Gmail) — ✅ completato (task 4.1–4.3), test su contatto reale rimandato

- Task 4.1 (OAuth interno) **✅ completato**. Consent screen Internal,
  scope solo `gmail.send` (niente `gmail.readonly` per ora — servirebbe
  solo per leggere le risposte, fuori scope attuale, e richiederebbe un
  nuovo consenso). Flusso one-shot: `app/api/auth/gmail/start/route.ts`
  reindirizza al consenso Google (`prompt: 'consent'` per forzare un
  nuovo refresh_token anche se l'account aveva già autorizzato l'app in
  passato), `app/api/auth/gmail/callback/route.ts` scambia il code e
  mostra il refresh_token una tantum da incollare in
  `GMAIL_REFRESH_TOKEN`. Refresh token ottenuto e salvato in
  `.env.local` (da aggiungere anche su Vercel prima del deploy).
- Task 4.2 (invio dall'app) **✅ completato e testato end-to-end** (email
  arrivata, Inviati su info@unfocus.com.au corretto, stato → Contacted,
  evento `email_sent` in cronologia col testo giusto).
  File: `lib/gmail.ts` (`sendGmailMessage` — refresh dell'access token via
  REST, costruisce il messaggio RFC 2822 raw base64url, POST a
  `gmail.googleapis.com/.../messages/send`; niente dipendenza
  `googleapis`, stesso stile a chiamate REST dirette già usato per Places
  API New e per il token exchange di `callback/route.ts`),
  `app/(protected)/contacts/[id]/actions.ts` (server action `sendEmail`:
  invia, poi aggiorna `contacts.gmail_thread_id`/`gmail_message_id` e
  logga l'evento `email_sent` con la variante usata), bottone "Send" per
  variante in `components/analysis-panel.tsx` (con `window.confirm` prima
  dell'invio — azione irreversibile e reale).
  - **Bug risolto durante il test**: l'header `Subject` veniva scritto
    raw (`Subject: ${subject}`), senza MIME encoding — un nome contatto
    con em dash ("TEST — Fuffa Restaurant") arrivava corrotto
    ("Hey TEST Ã¢Â€Â" Fuffa Restaurant"). Fix in `lib/gmail.ts`:
    `encodeHeaderValue` avvolge il subject in RFC 2047 encoded-word
    (`=?UTF-8?B?<base64>?=`) solo se contiene caratteri non-ASCII, lascia
    invariati i subject puramente ASCII.
  - **Decisioni prese**:
    - Nessun pattern async/job come scrape o analisi: l'invio Gmail è
      un'unica chiamata REST, ben sotto il limite di 60s di Vercel Hobby
      (vedi nota in Modulo 3.2) — gira sincrono dentro la server action.
    - Subject dell'email: `{business_name} — quick thought` (niente
      "Hey" — quello resta solo nel saluto del corpo). Diventa
      `Re: {business_name} — quick thought` in automatico quando l'invio
      è in thread (vedi threading sotto).
    - Lo stato passa a `Contacted` (il trigger DB logga da solo) **solo
      se era `To contact`** — un follow-up inviato mentre il contatto è
      già `In conversation`/`No reply` non deve retrocedere lo stato.
    - Se il contatto non ha `email` in anagrafica, il bottone "Send" è
      disabilitato (tooltip) invece di fallire silenziosamente.
- Task 4.3 (UI: modal per le email) **✅ completato e testato**. Le tre
  textarea inline (troppo piccole per email di 60-80 parole) sono state
  sostituite da un'anteprima troncata (~160 caratteri, read-only) più due
  bottoni per variante: **Edit** (apre un modal a schermo intero) e
  **Send / Sent ✓** (resta visibile anche fuori dal modal, come
  indicatore di stato a colpo d'occhio). File:
  `components/analysis-panel.tsx` (`EmailVariantEditor`/`EmailModal`).
  - Il modal separa **draft** (testo in editing) da **savedValue**
    (ultimo valore confermato persistito): `Cancel`/`✕`/backdrop/Escape
    chiudono senza chiedere conferma se non ci sono modifiche, altrimenti
    mostrano un `window.confirm` prima di scartarle. `Save` persiste il
    draft su `contacts.email_*` e aggiorna `savedValue`.
  - `Send` (sia dentro che fuori dal modal) invia il testo corrente; se
    inviato dal modal senza un `Save` esplicito prima, il testo viene
    comunque persistito su `contacts.email_*` subito dopo l'invio riuscito
    — altrimenti un reload avrebbe mostrato testo diverso da quello
    realmente spedito.
  - **"Sent ✓" persistente tra reload**: non è più solo stato client
    effimero — `app/(protected)/contacts/[id]/page.tsx` calcola
    `sentVariants` dagli eventi `email_sent` già presenti in
    `contact_events` e lo passa giù come prop.
- **Threading follow-up** (rifinitura decisa con Francesco dopo il primo
  test del 4.2) **✅ implementato, header verificati corretti — vedi nota
  sotto sul limite del test di raggruppamento visivo**. Problema:
  `gmail_thread_id` da solo non basta per far apparire un'email nello
  stesso thread Gmail lato destinatario — serve anche l'header RFC
  `Message-ID` del messaggio precedente da passare come
  `In-Reply-To`/`References`. Leggere quell'header via l'API
  richiederebbe però lo scope `gmail.readonly` (deliberatamente non
  richiesto — vedi task 4.1). Soluzione: `lib/gmail.ts` genera lui
  stesso un `Message-ID` (`<uuid@unfocus.com.au>`) ad ogni invio, lo
  imposta esplicitamente nell'header in uscita, e lo restituisce alla
  server action, che lo salva in `contacts.gmail_message_id`
  (`db/migration_005_gmail_message_id.sql`, **eseguita su Supabase**
  2026-07-31 — colonna aggiunta anche in `db/schema.sql`). Al prossimo
  invio per lo stesso contatto, se `gmail_message_id` è già valorizzato
  (a prescindere dalla variante — non è ristretto al solo `followup`),
  `sendGmailMessage` aggiunge `In-Reply-To`/`References` e il `threadId`
  esistente, e il subject diventa `Re: ...`.
  - **Nota sul test (2026-07-31)**: verificato con "Mostra originale" in
    Gmail che `In-Reply-To`/`References` sull'email di follow-up
    puntano correttamente al `Message-ID` del primo invio — la parte
    lato codice/header è corretta e confermata. Il raggruppamento
    *visivo* in un'unica conversazione **non si è però verificato** nel
    test (mittente info@unfocus.com.au, destinatario un altro indirizzo
    Gmail): comportamento noto di Gmail, che a volte non raggruppa email
    arrivate via API in scenari Gmail-to-Gmail anche con header corretti.
    Su client non-Gmail, o con destinatari su server email diversi da
    Google, il raggruppamento visivo è atteso funzionare normalmente,
    perché segue lo standard RFC (che qui è rispettato). Non bloccante:
    il codice è corretto, è un limite del test specifico, non della
    implementazione.
- Task 4.4 (polling risposte, da `docs/TASKS.md`) — non iniziato.
- **Test su un contatto reale (prospect vero, non fittizio) rimandato a
  un'altra sessione** — tutto il resto del modulo (OAuth, invio, modal,
  threading) è stato validato con contatti di test.

## Gestione contatti — eliminazione e filtro città — ✅ completato e testato

Feature non legate a un modulo di `docs/TASKS.md` (manutenzione/UI di
supporto sulla lista contatti).

- **Eliminazione contatti (singola e bulk)**: logica condivisa in
  `lib/delete-contacts.ts` (`deleteContactsById`), usata sia da
  `app/(protected)/contacts/actions.ts` (`deleteContacts`, bulk, bottone
  "Delete selected" nella lista) sia da `[id]/actions.ts` (`deleteContact`,
  singolo, con `redirect('/contacts')` dopo l'eliminazione). Rimuove prima
  i file screenshot dallo Storage (le righe `contact_events`/
  `screenshots`/`analysis_jobs` sono già `on delete cascade` in
  `db/schema.sql`, ma i file nel bucket non lo sono — andrebbero persi
  come orfani senza questa rimozione esplicita), poi elimina la riga
  `contacts`.
  - **Decisione presa dopo il primo test**: l'eliminazione **non** tocca
    mai `blocklist`, né per i contatti con `place_id` né per quelli senza.
    La blocklist resta riservata esclusivamente allo stato
    `Not interested` (già gestita lì via `updateContactStatus` in
    `[id]/actions.ts`). Motivo: eliminare è per pulizia dati/test/errori,
    e deve permettere a un prossimo scrape della stessa zona di far
    ricomparire il contatto; per bloccarlo in modo permanente si passa
    prima da "Not interested".
  - UI: `components/contacts-table.tsx` (client — stato di selezione,
    checkbox "select all", barra "Delete selected" visibile solo con
    ≥1 selezionato, `window.confirm` prima di eliminare, poi
    `revalidatePath('/contacts')` per aggiornare lista/conteggio senza
    reload completo), `components/contact-row.tsx` (checkbox per riga,
    `stopPropagation` per non attivare la navigazione al dettaglio),
    `components/delete-contact-button.tsx` (bottone nel dettaglio, stesso
    pattern di conferma).
- **Filtro "City"**: nuovo query param `city` in
  `app/(protected)/contacts/page.tsx` (`eq('suburb', city)`), select
  popolata dinamicamente dai valori distinti di `suburb` presenti in
  `contacts` (nessun valore hardcoded), opzione default "All cities".
  Stesso pattern degli altri filtri in `components/contacts-filter-bar.tsx`
  (query params via `router.push`, sopravvive al reload, resetta la
  paginazione, incluso nel calcolo di "Clear filters"). Nessuna migration
  necessaria — `suburb` esisteva già.
- **Bug scoperto testando il filtro e risolto**: `suburb` veniva popolato
  dallo scraper con un pezzo dell'indirizzo del singolo locale
  (`formattedAddress.split(',')[1]` — es. "1 Martin Pl",
  "Abbotsford VIC 3067" vs "Abbotsford VIC 3121" per lo stesso quartiere)
  invece che dalla location cercata (`scrape_jobs.location`, es.
  "Sydney, NSW, Australia", "Richmond, VIC"). Fix per i nuovi inserimenti
  in `scraper-service/main.py` (`_enrich_candidates.handle`): `suburb =
  location`. Dati storici corretti con `db/migration_006_backfill_suburb.sql`
  (**eseguita su Supabase** — `UPDATE contacts SET suburb = scrape_jobs.location`
  via join `scrape_job_items.place_id = contacts.place_id` filtrato su
  `status = 'done'`, per evitare match su righe `skipped_duplicate` di
  scrape successivi sullo stesso place_id). Contatti `sheet_import`/
  `manual` (senza `place_id`/job associato) non entrano nel join — lasciati
  invariati come richiesto.

## Task A — Firma email automatica — ✅ completato e testato in produzione

Ogni email inviata da `lib/gmail.ts` include in fondo, dopo il corpo, una
firma hardcoded (nessun nuovo scope OAuth necessario):

```
--
Francesco Bugugnoli
Visual Content Partner
0476 278 891
UnFocus - Strategic video content
```

Appesa in `buildRawMessage` (separata dal corpo da una riga vuota + `--`
su riga propria, convenzione standard email), senza toccare `body` a
monte — `contacts.email_*` e la history in `contact_events` restano il
testo "puro" scritto/generato, senza firma/footer incorporati.

## Task B — Unsubscribe (Spam Act 2003) + re-engagement — ✅ completato e
testato in produzione (migration 007 eseguita su Supabase, link
unsubscribe HTML "click here" invece di URL grezzo — vedi anche sezione
email HTML più sotto)

- **Unsubscribe**: `contacts.unsubscribed_at` (timestamptz, nullable,
  `db/migration_007_unsubscribe_recontact.sql` — **eseguita su Supabase**).
  Ogni email include, dopo la firma, un link
  `{NEXT_PUBLIC_APP_URL}/api/unsubscribe?token=...`. Il token è stateless
  (`lib/unsubscribe-token.ts`): `contactId.HMAC-SHA256(contactId)`, chiave
  `CRON_SECRET` (stesso secret già usato per i cron, nessuna tabella
  extra). `app/api/unsubscribe/route.ts` (pubblica, esclusa dall'auth
  check in `middleware.ts` insieme a `api/cron`, stesso motivo: nessuna
  sessione Supabase disponibile per chi clicca da un client email)
  verifica il token, setta `unsubscribed_at=now()` e `status='Not
  interested'`, aggiunge il `place_id` in `blocklist` (stessa regola di
  dominio già applicata al "Not interested" manuale — vedi sezione
  "Gestione contatti"), mostra una pagina HTML di conferma semplice.
  Nuova env var `NEXT_PUBLIC_APP_URL` (base URL pubblico, no trailing
  slash — aggiunta in `.env.local` e su Vercel).
- **Re-engagement**: nuovo status `'To recontact'` aggiunto al check
  constraint di `contacts.status` e a `STATUSES`
  (`lib/contacts.ts` — compare da solo nel filtro Status della lista
  contatti). Nuova chiave settings `recontact_months` (default 9).
  `app/api/cron/recontact/route.ts` (bearer `CRON_SECRET`, stesso
  pattern di `cleanup-screenshots`), schedulato daily alle 4:00 in
  `vercel.json` (sfalsato di un'ora dal cleanup screenshot delle 3:00):
  sposta a `'To recontact'` i contatti con `status='Not interested'`,
  `unsubscribed_at IS NULL` e `last_contact_date` più vecchio di
  `recontact_months` mesi. **Chi ha fatto unsubscribe non viene mai
  toccato**, a prescindere da quanto tempo sia passato — è un opt-out
  esplicito, non un semplice "non interessato" temporaneo.
  - Il trigger `trg_contacts_status` già esistente logga da solo lo
    `status_change` e aggiorna `last_contact_date` a `current_date` anche
    per questa transizione — comportamento coerente con tutte le altre
    modifiche di stato, nessuna eccezione necessaria nel codice del cron.
- **Rifinitura estetica**: il link di unsubscribe mostrava l'URL grezzo
  per intero. `lib/gmail.ts` ora invia l'email come `text/html` (non più
  `text/plain` — necessario perché un `<a>` cliccabile non funziona in
  plain text), corpo e firma escapati in HTML con newline convertiti in
  `<br>`, link reso come testo leggibile ("...click here to
  unsubscribe.") invece dell'URL.
- File chiave: `lib/gmail.ts`, `lib/unsubscribe-token.ts`,
  `app/api/unsubscribe/route.ts`, `app/api/cron/recontact/route.ts`,
  `db/migration_007_unsubscribe_recontact.sql`, `middleware.ts`,
  `lib/contacts.ts`, `components/contact-badges.tsx`.

## Task E — Normalizzazione business_type — ✅ completato e testato in
produzione (Railway)

`contacts.business_type` veniva popolato con la stringa di ricerca
digitata nel form di scrape (es. "restaurant"), non con i tag tecnici di
Google — comunque poco leggibile/consistente come filtro se la query
digitata varia. Aggiunto `types` a `DETAILS_FIELD_MASK` in
`scraper_core.py` (Place Details ora richiede anche l'array `types[]`) e
un dizionario `GOOGLE_TYPE_LABELS` (~60 voci, es. `restaurant` →
"Restaurant", `beauty_salon` → "Beauty Salon") che esclude di proposito i
tag generici (`point_of_interest`, `establishment`, `food`, `store`) così
un tag più specifico più avanti nell'array vince comunque.
`normalize_business_type(types, fallback)` (approvato da Francesco prima
dell'implementazione) scorre `types[]` nell'ordine restituito da Google e
ritorna la prima etichetta riconosciuta; se nessuna corrisponde, fallback
= **la query di ricerca digitata nel form** (non il primo tag grezzo —
scelta esplicita di Francesco: sempre leggibile anche quando non precisa).
Applicato in `main.py` (`_enrich_candidates.handle`) al momento
dell'insert in `contacts`. Nessuna migration — non tocca lo schema, solo
dati nuovi (i contatti già scrapati restano con la stringa vecchia,
nessun backfill richiesto).

## Task F — Contesto di settore configurabile per l'analisi Claude Vision
— ✅ completato e testato in produzione (migration 008 eseguita su
Supabase, campo Settings verificato dal vivo)

Il `SYSTEM_PROMPT` di `scraper-service/prospect_vision.py` era hardcoded
su hospitality. Estratta la sola frase di contesto settore in una nuova
chiave settings `analysis_context` (`db/migration_008_analysis_context.sql`
— **eseguita su Supabase**), default identico byte-per-byte al testo
prima hardcoded ("a videography and photography studio in Melbourne
specialising in hospitality content") così le analisi esistenti non
cambiano finché non viene modificato dalla UI.
- `prospect_vision.py`: `SYSTEM_PROMPT` è diventato `SYSTEM_PROMPT_TEMPLATE`
  (placeholder `{analysis_context}`), `build_system_prompt(analysis_context)`
  fa il format con fallback su `DEFAULT_ANALYSIS_CONTEXT` se il valore è
  vuoto/None. `analyze()` accetta un parametro opzionale `analysis_context`.
- **Decisione architetturale**: la lettura da Supabase resta in `main.py`
  (`run_analysis_job`, che già possiede il client Supabase), non dentro
  `prospect_vision.py` — quel file resta puro (nessuna dipendenza da
  Supabase), coerente con il suo stesso commento in testa ("Used by the
  /analyze background job in main.py"). `main.py` legge la chiave
  `analysis_context` a ogni job di analisi e la passa a `pv.analyze(...)`.
- **UI**: nuova pagina `/settings` (`app/(protected)/settings/page.tsx` +
  `actions.ts`) con un textarea per leggere/modificare `analysis_context`
  senza toccare codice — così il tool si può ripuntare su un altro
  settore (barbershop, cleaning company, ecc.) semplicemente cambiando
  questo testo. Link "Settings" aggiunto in `components/topbar.tsx`.
- Nota: il prompt caching (`cache_control: ephemeral`) resta valido dato
  che il testo del system prompt è identico per tutte le analisi finché
  `analysis_context` non viene cambiato dalla UI.
- File chiave: `scraper-service/scraper_core.py`, `scraper-service/main.py`,
  `scraper-service/prospect_vision.py`,
  `db/migration_008_analysis_context.sql`,
  `app/(protected)/settings/page.tsx`, `app/(protected)/settings/actions.ts`,
  `components/topbar.tsx`.

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
