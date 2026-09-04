# Prospect Engine — Architettura

Documentazione tecnica del sistema. Per le decisioni implementative
dettagliate e il log dei bug risolti, vedi `CLAUDE.md`.

---

## Stack

| Layer | Tecnologia | Deploy |
|-------|-----------|--------|
| Frontend + API routes | Next.js 15 (App Router, TypeScript) | Vercel (Hobby) |
| Database + Auth + Storage | Supabase (Postgres, RLS, Storage bucket `screenshots`) | Supabase cloud |
| Scraper + Analisi AI | Python FastAPI | Railway (Hobby) |
| AI | Claude API (`claude-sonnet-4-6`) | Anthropic API |
| Email | Gmail API (OAuth 2.0) | Google Cloud |
| Scraping luoghi | Places API (New) | Google Cloud |

---

## Flusso dei dati

```
Google Maps (Places API New)
        ↓
  FastAPI /scrape          ← chiamato da Next.js API route (proxy)
        ↓
  contacts (Supabase)      ← category: "Not analysed" fino all'analisi IG
        ↓
  Screenshot upload        ← drag & drop nel browser → Supabase Storage
        ↓
  FastAPI /analyze         ← Claude Vision analizza gli screenshot
        ↓
  contacts aggiornato      ← score, category (High/Medium/Low), 3 email
        ↓
  Gmail API /send          ← inviato da Next.js server action
        ↓
  contact_events loggato   ← trigger DB logga status change automaticamente
```

---

## Struttura repository

```
/                           Next.js app
  /app
    /api                    API routes (proxy verso scraper-service)
      /scrape               POST: avvia scrape, GET: stato job
      /contacts/[id]/analyze  POST: avvia analisi, GET: stato job
      /auth/gmail           start + callback per OAuth Gmail
      /cron                 cleanup screenshots, re-engagement
      /unsubscribe          link unsubscribe dalle email
    /(protected)            pagine autenticate (middleware protegge)
      /contacts             lista contatti con filtri
      /contacts/[id]        dettaglio contatto
      /settings             configurazione analisi context
  /components               componenti React
  /lib                      client Supabase, helpers, gmail.ts
/scraper-service            Python FastAPI (deploy separato su Railway)
  main.py                   endpoints + background jobs
  scraper_core.py           Places API, enrichment siti web
  prospect_vision.py        analisi Claude Vision + scoring opportunità
/db
  schema.sql                schema completo (source of truth)
  migration_*.sql           migrazioni eseguite su Supabase
/docs                       questa documentazione
```

---

## Schema database (tabelle principali)

**`contacts`** — una riga per business
- Dati anagrafici: `name`, `address`, `suburb`, `phone`, `website`, `email`, `instagram`
- Dati Google: `place_id` (chiave dedup), `rating`, `review_count`, `business_type`
- Categorizzazione: `category` ("Not analysed" → "High"/"Medium"/"Low" dopo analisi IG)
- Flag: `is_new_venue` (rating ≥ 4.5 AND 10 ≤ reviews ≤ 100)
- Analisi IG: `score_breakdown` (JSONB), `analysis`, `priority_score`
- Email generate: `email_technical`, `email_warm`, `email_followup`
- Gmail: `gmail_thread_id`, `gmail_message_id`
- Stato: `status`, `last_contact_date`, `unsubscribed_at`

**`contact_events`** — storia append-only
- Tipi: `status_change`, `note`, `email_sent`, `email_reply`, `analysis`, `import`, `system`
- I `status_change` sono loggati da un **trigger Postgres** (`trg_contacts_status`)
  — non inserire mai eventi di tipo `status_change` dal codice applicativo

**`scrape_jobs`** + **`scrape_job_items`** — tracking job scraping
- Progress: `processed/total`, contatori `new_contacts`/`skipped`
- Aggiornati in tempo reale via Supabase Realtime

**`analysis_jobs`** — tracking job analisi IG
- Statuses: `queued` → `running` → `completed`/`failed`

**`screenshots`** — path dei file in Storage
- Il cron giornaliero (3:00 UTC) elimina file + righe più vecchie di `settings.screenshot_ttl_days` (5)
- L'analisi Claude sopravvive alla cancellazione degli screenshot (vive in `contacts`)

**`blocklist`** — `place_id` da non riscrape
- Popolato automaticamente quando uno stato diventa `Not interested` o arriva un unsubscribe

**`settings`** — configurazione key/value (JSONB)
- `analysis_context`: descrizione del settore per il prompt Claude
- `scoring_config`: pesi e soglie del Modello B (Intent/Craft/gap)
- `screenshot_ttl_days`: giorni di retention screenshot (default 5)
- `recontact_months`: mesi prima del re-engagement automatico (default 9)

---

## Scoring opportunità (Modello B)

Il punteggio mostrato nella colonna IG **non misura "quanto è bello il profilo"**
ma **"quanto è un buon cliente potenziale"**.

**Sei dimensioni** (0-20 ciascuna, valutate da Claude Vision):
- `photo_quality` — qualità della fotografia
- `video_presence` — quantità e qualità di video/Reels (peso maggiore)
- `content_consistency` — coerenza visiva e identità di brand
- `posting_frequency` — frequenza e regolarità
- `engagement_signals` — like e commenti visibili
- `bio_profile` — bio professionale, highlights, link

**Due indicatori derivati:**
- **Intent** (0-100): quanto ci tengono al brand → `content_consistency` 35% + `posting_frequency` 30% + `engagement_signals` 20% + `bio_profile` 15%
- **Craft** (0-100): quanto è già buona la qualità → `video_presence` 60% + `photo_quality` 40%

**Opportunità** = blend di Intent e gap (Intent − Craft):
- Gap grande = ci tengono ma eseguono male = opportunità per UnFocus

**Categorie:**
- `High`: gap ≥ 20 (e Intent ≥ 40)
- `Medium`: gap tra 5 e 20 (e Intent ≥ 40)
- `Low`: Intent < 40 (non investiranno) oppure gap < 5 (già bravi)

I pesi e le soglie sono configurabili nella tabella `settings` (chiave `scoring_config`)
senza modificare il codice.

---

## Sicurezza

- **Auth**: Supabase Auth, singolo utente (`info@unfocus.com.au`). Signup disabilitato.
  Il middleware Next.js protegge tutte le rotte tranne `/login`, `/api/cron/*`, `/api/unsubscribe`.
- **Scraper API**: protetto da `Authorization: Bearer {SCRAPER_API_TOKEN}` (shared secret)
- **Cron**: protetti da `Authorization: Bearer {CRON_SECRET}`
- **Unsubscribe**: token stateless HMAC-SHA256 (nessuna tabella extra)
- **Gmail**: OAuth 2.0, scope solo `gmail.send`. Refresh token in env var, mai nel codice.
- **Claude API**: chiamata solo server-side (mai dal browser)
- **Service role key**: solo su Railway (bypassa RLS) e nelle server action che lo richiedono

---

## Cron job attivi (Vercel)

| Schedule | Endpoint | Cosa fa |
|----------|----------|---------|
| `0 3 * * *` | `/api/cron/cleanup-screenshots` | Elimina screenshot più vecchi di N giorni |
| `0 4 * * *` | `/api/cron/recontact` | Sposta "Not interested" → "To recontact" dopo N mesi |

---

## Aggiornare il codice

```bash
# Modifica i file, testa in locale, poi:
git add -A
git commit -m "descrizione della modifica"
git push
# Railway e Vercel si ridisployano automaticamente dal branch main
```

Per Railway: il redeploy impiega 2-3 minuti. Verifica lo stato nel tab Deployments.
Per Vercel: 1-2 minuti. Le variabili d'ambiente aggiornate richiedono un Redeploy manuale.
