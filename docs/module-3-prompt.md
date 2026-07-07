# Prompt per Claude Code — Modulo 3 (analisi Claude e generazione email)
# Incolla in una sessione Claude Code aperta nel root del repo.
# Prerequisiti: Moduli 1 e 2 completati e testati; ANTHROPIC_API_KEY pronta.

Leggi CLAUDE.md, db/schema.sql, db/migration_002_category_v2.sql e
docs/TASKS.md prima di iniziare. In scraper-service/prospect_analyzer.py
trovi il vecchio script CLI: il SYSTEM_PROMPT e la struttura JSON di
risposta sono già validati sul campo e vanno riusati QUASI IDENTICI —
cambia solo dove gira il codice e dove si salvano i risultati.

Implementa il Modulo 3 (task 3.1 → 3.3 di docs/TASKS.md), un task alla
volta, fermandoti dopo ognuno per farmi testare.

## 3.1 — Upload screenshot

Nella pagina dettaglio contatto: area drag & drop + click, fino a 10
immagini (jpg/png/webp), anteprime, rimozione singola. Ogni upload:
- file nel bucket Storage 'screenshots', path
  {contact_id}/{timestamp}_{nome-sanificato}
- riga in screenshots (contact_id, storage_path)
Vincoli: limite dimensione per file 5 MB con messaggio chiaro; ridimensiona
lato client se l'immagine supera ~2000px sul lato lungo (gli screenshot
telefono sono enormi e Claude non ha bisogno di più); mostra sempre il
contatore n/10. Al load della pagina, mostra gli screenshot esistenti non
ancora scaduti.

## 3.2 — Analisi + generazione email

API route POST /api/contacts/[id]/analyze (server-side, sessione
verificata):
1. Legge le righe screenshots del contatto (errore chiaro se zero).
2. Scarica i file dallo Storage, li converte in base64.
3. Chiama la Claude API (model claude-sonnet-4-6, max_tokens 2000) con:
   - system: il SYSTEM_PROMPT di prospect_analyzer.py (riusalo, adattando
     solo eventuali riferimenti al contesto CLI)
   - user: i blocchi image + il blocco testo col business context
     (name, rating, review_count, address, website, instagram, category,
     is_new_venue — presi dal DB, non da input utente)
4. Parsing difensivo del JSON (strip dei fence markdown, priority_score
   può arrivare come "7/10" → estrai l'intero, campi mancanti → errore
   esplicito, non default silenziosi).
5. Salva su contacts: analysis, priority_score, score_breakdown,
   email_technical, email_warm, email_followup.
6. Inserisci contact_event type='analysis', body breve
   ("Claude analysis completed — score 7/10, N screenshots").

UI: bottone "Generate emails" (disabilitato senza screenshot), stato di
caricamento, poi: card analisi (sola lettura), tre textarea editabili con
bottone di salvataggio per variante (update dei rispettivi campi contacts),
score breakdown visualizzato (le 5 dimensioni con barre 0-20).
Rigenerare = richiamare l'endpoint: sovrascrive i campi, quindi chiedi
conferma se le email sono state modificate a mano (confronto con l'ultimo
salvataggio).

Timeout: la chiamata con 10 immagini può durare 30-60s — configura
maxDuration adeguato sulla route e dimmi se il piano Vercel attuale lo
consente, altrimenti proponi l'alternativa (spostare la chiamata sul
servizio Railway).

## 3.3 — Cron pulizia screenshot

- API route GET /api/cron/cleanup-screenshots protetta: header
  Authorization: Bearer {CRON_SECRET} (nuova env var), 401 altrimenti.
- Logica: righe screenshots con created_at < now() - settings.
  screenshot_ttl_days → cancella i file dallo Storage, poi le righe.
  Logga quanti file/righe rimossi. I campi analisi in contacts NON si
  toccano.
- vercel.json: schedule giornaliero (es. 03:00 UTC).
- Dammi un modo per testare subito: query SQL che retrodata una riga
  screenshots di test + curl con il secret.

Vincoli: la ANTHROPIC_API_KEY vive solo lato server (env), mai nel client.
Aggiorna .env.example (ANTHROPIC_API_KEY, CRON_SECRET). Se una scelta non
è ovvia, chiedimi prima.
