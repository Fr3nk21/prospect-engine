# UnFocus Prospect Engine — Roadmap operativa

Lavora un modulo alla volta, end-to-end, e testalo prima di passare al
successivo. Ogni task ha un "fatto quando" per capire quando è chiusa.

---

## Modulo 0 — Setup (mezza giornata, tutto manuale, niente codice)

**0.1 Account e progetti**
Crea: progetto Supabase, progetto Google Cloud (abilita *Places API (New)* e
metti un budget alert a $20), account Railway, repo Git `prospect-engine`.
*Fatto quando: hai tutte le chiavi salvate nel password manager.*

**0.2 Schema DB**
Incolla `db/schema.sql` nel SQL Editor di Supabase ed eseguilo.
*Fatto quando: vedi le 7 tabelle nel Table Editor e il bucket `screenshots` in Storage.*

**0.3 Utente e sicurezza**
Supabase → Authentication: crea il tuo utente (email + password), poi
disabilita i signup (Settings → "Allow new users to sign up" → off).
*Fatto quando: esiste un solo utente e nessuno può registrarsi.*

**0.4 Backup del foglio**
Google Sheet "Melbourne Venues" → File → Scarica → .xlsx. Conservalo.
*Fatto quando: hai il file al sicuro fuori da Google.*

---

## Modulo 1 — CRM funzionante coi dati esistenti (il primo con Claude Code)

**1.1 Scaffold Next.js + Auth**
App Next.js (App Router, TypeScript), Supabase Auth con `@supabase/ssr`,
middleware che protegge tutto tranne `/login`. Deploy su Vercel già da ora.
*Fatto quando: senza login vieni rediretto, col login entri.*

**1.2 Import del Google Sheet (una tantum)**
Script Python (in `scraper-service/`, riusa gspread e il service account) che
legge il foglio, mappa le colonne (Nome→name, Alta/Media/Bassa→High/Medium/Low,
stati in inglese) e inserisce in `contacts` con `source='sheet_import'`.
*Fatto quando: i conteggi tornano (righe foglio = righe DB) e il foglio va in pensione.*

**1.3 Lista contatti**
La dashboard del mockup su dati veri: tabella con filtri (ricerca, categoria,
stato, tipo, intervallo date ultimo contatto), ordinamento, paginazione,
toggle tema chiaro/scuro.
*Fatto quando: ritrovi e filtri tutti i tuoi contatti reali.*

**1.4 Dettaglio contatto (base)**
Pagina dettaglio: dati business, cambio stato (il trigger DB logga da solo),
note manuali, cronologia da `contact_events`. "Not interested" → inserimento
in `blocklist`.
*Fatto quando: cambi uno stato e la cronologia mostra la voce con data.*

---

## Modulo 2 — Scraper come servizio

**2.1 FastAPI su Railway**
Adatta `scraper.py`: via CLI e gspread, dentro scrittura su Supabase
(service_role key), endpoint `POST /scrape` protetto da bearer token che crea
il job e risponde subito con `job_id`; il lavoro gira in background.
*Fatto quando: una POST con curl avvia uno scrape e la riga in `scrape_jobs` avanza.*

**2.2 Places API (New) + field mask**
Migra dalle chiamate legacy: Text Search v1 + Place Details con field mask
(solo i campi necessari → costi minimi). Aggiungi `businessStatus` per
scartare i locali chiusi.
*Fatto quando: uno scrape di prova produce contatti completi e i costi in
console Google restano ~0.*

**2.3 Enrichment parallelo**
httpx + asyncio (concorrenza ~8): homepage + /contact + /about + link mailto.
Obiettivo: 200 contatti in ~15 minuti invece di 90.
*Fatto quando: il tempo per contatto scende sotto i ~5 secondi medi.*

**2.4 Dedup e blocklist**
Skip per `place_id` già in `contacts` o in `blocklist`; contatori
`skipped` nel job.
*Fatto quando: rilanciando lo stesso scrape, 0 nuovi inserimenti.*

**2.5 Progress nel frontend**
Il bottone "Start search" chiama l'API route → FastAPI → job_id; barra di
avanzamento con Supabase Realtime sulla riga del job (percentuale +
stima tempo rimanente da processed/total).
*Fatto quando: vedi la barra muoversi in tempo reale durante uno scrape vero.*

---

## Modulo 3 — Analisi Claude e generazione email

**3.1 Upload screenshot**
Nel dettaglio contatto: drag & drop fino a 10 immagini → Supabase Storage
(bucket `screenshots`) + riga in `screenshots`.
*Fatto quando: le anteprime compaiono e i file sono nel bucket.*

**3.2 Analisi + email**
API route server-side: scarica gli screenshot, chiama Claude
(`claude-sonnet-4-6`, il prompt di `prospect_analyzer.py` va bene così),
salva su `contacts`: analysis, priority_score, score_breakdown, 3 email.
Textarea editabili con salvataggio.
*Fatto quando: generi le email per un prospect vero e le ritrovi dopo un reload.*

**3.3 Cron pulizia screenshot**
Vercel Cron giornaliero → API route: righe `screenshots` più vecchie di
`settings.screenshot_ttl_days` → cancella file da Storage + righe. L'analisi
resta (vive in `contacts`).
*Fatto quando: uno screenshot retrodatato a 6 giorni fa sparisce alla run successiva.*

---

## Modulo 4 — Gmail

**4.1 OAuth interno**
Google Cloud → OAuth consent screen tipo **Internal** (Workspace), scope
`gmail.send` + `gmail.readonly`. Flusso di autorizzazione una tantum,
refresh token salvato in env/settings.
*Fatto quando: un endpoint di test invia un'email da info@unfocus.com.au.*

**4.2 Invio dall'app**
Bottone "Send" sulle email generate: invia via Gmail API, salva
`gmail_thread_id`, stato → "Contacted" (il trigger logga), evento
`email_sent` con variante usata.
*Fatto quando: l'email parte, è nei tuoi Inviati, e lo stato si aggiorna da solo.*

**4.3 Polling risposte**
Vercel Cron orario: per i thread dei contatti "Contacted"/"No reply",
controlla se c'è una risposta → stato "In conversation" + evento `email_reply`.
*Fatto quando: rispondi a te stesso da un altro account e lo stato cambia da solo.*

**4.4 Cron reset stati**
"No reply" → "To contact" dopo `settings.status_reset_months` (6) mesi.
*Fatto quando: un contatto di test retrodatato viene resettato.*

---

## Modulo 5 — Il cervello

**5.1 Vista Today (nuova homepage)**
Tre sezioni: follow-up in scadenza (Contacted da 7+ giorni senza risposta),
High priority mai contattati, conversazioni aperte da riprendere.
*Fatto quando: la mattina apri l'app e sai cosa fare senza filtrare nulla.*

**5.2 Insights**
Reply rate per variante/categoria/tipo/sobborgo (sempre con numeri assoluti
accanto alle percentuali), funnel mensile, correlazione priority_score →
risposte.
*Fatto quando: rispondi a "quale variante funziona meglio?" con un dato.*

**5.3 Export CSV** (opzionale)
Export della lista filtrata corrente.

---

## Regole di ingaggio

- Un modulo alla volta. Il Modulo 1 da solo sostituisce già il foglio.
- Commit e deploy frequenti: Vercel e Railway deployano da Git, usalo.
- Ogni sessione di Claude Code: apri nel root del repo, così legge CLAUDE.md.
- Torna alla chat di progetto (Fable 5) quando una scelta tocca schema DB
  o architettura; per il resto, Claude Code con Sonnet basta.
