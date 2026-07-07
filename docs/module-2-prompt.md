# Prompt per Claude Code — Modulo 2 (scraper come servizio)
# Incolla il testo sotto in una sessione Claude Code aperta nel root del repo.
# Prerequisiti: Modulo 1 completato e testato; account Railway pronto;
# MAPS_API_KEY con Places API (New) abilitata.

Leggi CLAUDE.md, db/schema.sql e docs/TASKS.md prima di iniziare.
In scraper-service/ trovi scraper.py: è il vecchio script CLI da cui partire —
la logica di enrichment e categorizzazione è valida, tutto il resto
(CLI, gspread, Sheets) va eliminato.

Implementa il Modulo 2 (task 2.1 → 2.5 di docs/TASKS.md), un task alla
volta, fermandoti dopo ognuno per farmi testare.

## 2.1 — Servizio FastAPI

Struttura in scraper-service/: main.py (app + endpoint), scraper.py
(logica Maps + enrichment, rifattorizzata), db.py (client Supabase),
requirements.txt, Dockerfile o railway.json per il deploy.

Endpoint:
- POST /scrape  body: {"location": "...", "business_type": "..."}
  → crea riga in scrape_jobs (status 'queued'), avvia il lavoro con
  BackgroundTasks, risponde SUBITO con {"job_id": "..."} .
  Rifiuta (409) se esiste già un job 'queued' o 'running': un solo
  scrape alla volta.
- GET /health → {"status": "ok"} (per Railway).

Sicurezza: ogni endpoint tranne /health richiede header
Authorization: Bearer <SCRAPER_API_TOKEN> (confronto con env var,
risposta 401 altrimenti). Il servizio usa la SUPABASE_SERVICE_ROLE_KEY
(env) — mai esposta altrove.

Env vars (aggiorna .env.example): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
SCRAPER_API_TOKEN, MAPS_API_KEY.

## 2.2 — Places API (New)

Sostituisci le chiamate legacy googlemaps con chiamate HTTP dirette (httpx):
- Text Search: POST https://places.googleapis.com/v1/places:searchText
  query "{business_type} in {location}", con paginazione (nextPageToken).
- Field mask MINIMA (header X-Goog-FieldMask), solo:
  places.id, places.displayName, places.formattedAddress,
  places.nationalPhoneNumber, places.websiteUri, places.rating,
  places.userRatingCount, places.businessStatus, places.types
- Scarta i place con businessStatus != 'OPERATIONAL'.
- Se la field mask copre già tutto dal Text Search, NIENTE chiamata
  Place Details separata (costi dimezzati). Verifica nella doc corrente
  cosa restituisce searchText e dimmelo prima di implementare.

## 2.3 — Flusso del job

1. status → 'running', started_at = now().
2. Fase ricerca: raccogli tutti i place. Per ognuno inserisci una riga in
   scrape_job_items (status 'pending'). Aggiorna scrape_jobs.total.
3. Dedup: gli item con place_id già presente in contacts →
   'skipped_duplicate'; in blocklist → 'skipped_blocklist'.
   Incrementa scrape_jobs.skipped.
4. Enrichment SOLO per gli item rimasti: httpx.AsyncClient + asyncio,
   semaforo a concorrenza 8, timeout 10s per richiesta. Per ogni sito:
   homepage + /contact + /contact-us + /about (le path che esistono);
   email da link mailto: (priorità) poi regex sul testo con blocklist
   domini terzi (sentry, wix, example.com...); Instagram da link
   instagram.com/<handle>, scartando /p/, /reel/, /explore/.
   Un errore su un sito NON ferma il job: logga, lascia email/instagram
   vuoti, continua.
5. Per ogni item completato: insert in contacts (source='scraper',
   suburb=location), con categoria v2 (vedi CLAUDE.md Domain rules):
   High = rating >= 4.5 e recensioni > 200; Medium = rating 4.0-4.5
   oppure recensioni 100-200; Low = resto. Il sito web NON entra nella
   categoria. Calcola anche is_new_venue = rating >= 4.5 e recensioni
   tra 10 e 100 (colonna booleana, migration 002).
   Item → 'done', incrementa scrape_jobs.processed e new_contacts.
   Aggiorna processed anche per gli item skipped, così la barra arriva
   sempre a total.
6. Fine: status 'completed', finished_at. Eccezione non gestita a livello
   job: status 'failed' + messaggio in error (mai lasciare un job
   'running' orfano).

Nota bene: NON creare eventi 'status_change' in contact_events da codice
(ci pensa il trigger). Puoi inserire un evento type='import' per ogni
nuovo contatto con body descrittivo ("Scraped from Google Maps — {location},
{business_type}").

## 2.4 — Lato Next.js

- API route POST /api/scrape: verifica sessione utente, poi inoltra al
  servizio Railway col bearer token (il token vive solo lato server:
  env SCRAPER_SERVICE_URL + SCRAPER_API_TOKEN). Restituisce il job_id.
- La dashboard: il pannello "New search" chiama /api/scrape; se c'è un
  job attivo mostra una progress bar (processed/total, percentuale,
  stima tempo rimasto calcolata da started_at) che si aggiorna con
  Supabase Realtime sulla riga di scrape_jobs (abilita la publication
  Realtime per quella tabella e dammi l'SQL da eseguire). Fallback:
  polling ogni 5s se Realtime non è disponibile.
- A job 'completed': messaggio riassuntivo (nuovi / skipped) e refresh
  della lista contatti. A job 'failed': mostra l'errore.
- Aggiorna lista e dettaglio contatto: badge "New venue" quando
  is_new_venue è true (stile coerente coi tag categoria) + filtro
  booleano nella filter bar.

## 2.5 — Deploy e test

- Istruzioni per il deploy su Railway (collegamento repo, root directory
  scraper-service/, env vars da impostare).
- Dammi i comandi curl per testare in locale e in produzione:
  /health, /scrape senza token (deve dare 401), /scrape valido, e come
  osservare l'avanzamento (query SQL su scrape_jobs).
- Primo test reale con un'area piccola per contenere i costi e la durata,
  poi verifica in dashboard.

Vincoli: type hints ovunque; log leggibili (logging, non print); nessuna
retry-storm (max 1 retry per richiesta HTTP fallita); rispetta la
concorrenza 8 verso siti DIVERSI ma mai più di 1 richiesta concorrente
verso lo stesso host. Se una scelta non è ovvia, chiedimi prima.
