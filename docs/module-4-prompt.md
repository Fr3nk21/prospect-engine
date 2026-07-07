# Prompt per Claude Code — Modulo 4 (Gmail: invio e tracking)
# Incolla in una sessione Claude Code aperta nel root del repo.
# Prerequisiti: Modulo 3 completato; setup manuale OAuth fatto (vedi sotto).

## Setup manuale PRIMA della sessione (lo faccio io, Francesco):
# Google Cloud (stesso progetto delle Places API) → OAuth consent screen:
#   User Type: INTERNAL (l'account info@unfocus.com.au è Google Workspace)
#   Scopes: gmail.send, gmail.readonly
# → Credentials → OAuth Client ID, tipo Web application,
#   redirect URI: http://localhost:3000/api/auth/gmail/callback
#   e l'equivalente in produzione.
# Client ID e Client Secret pronti da mettere in env.

Leggi CLAUDE.md, db/schema.sql e docs/TASKS.md prima di iniziare.
Implementa il Modulo 4 (task 4.1 → 4.4 di docs/TASKS.md), un task alla
volta, fermandoti dopo ognuno per farmi testare.

## 4.1 — Collegamento OAuth (una tantum)

- Route /api/auth/gmail/start → redirect al consent Google
  (access_type=offline, prompt=consent per ottenere il refresh token).
- Route /api/auth/gmail/callback → scambia il code, salva il refresh
  token in settings (key 'gmail_refresh_token') — è un'app a utente
  singolo su DB già protetto da RLS, non serve un vault.
- Helper server-side che dato il refresh token restituisce un access
  token valido (refresh automatico, cache in memoria).
- Pagina/sezione Settings minimale: stato connessione Gmail
  (connesso come info@unfocus.com.au / non connesso) + bottone Connect.
- Test: endpoint temporaneo che manda un'email a me stesso, poi lo togliamo.

## 4.2 — Invio dall'app

Nella pagina dettaglio, sotto ogni variante email (technical / warm /
followup): bottone "Send via Gmail" che apre una conferma con anteprima
(destinatario = contacts.email, subject proposto modificabile, corpo =
contenuto attuale della textarea).

API route POST /api/contacts/[id]/send:
1. Valida: email destinatario presente, Gmail connesso, corpo non vuoto.
2. Invia via Gmail API (messages.send, MIME testo semplice, From
   info@unfocus.com.au). Se il contatto ha già un gmail_thread_id e la
   variante è followup → invia NELLO STESSO thread (threadId + header
   In-Reply-To/References), altrimenti nuovo thread.
3. Salva gmail_thread_id su contacts (se nuovo).
4. Aggiorna contacts.status → 'Contacted' SOLO se lo stato attuale è
   'To contact' (il trigger DB logga il cambio; non toccare gli stati
   più avanzati).
5. Inserisci contact_event type='email_sent', email_variant, body =
   snapshot del testo inviato (è il dato per la pattern analysis:
   variante + testo esatto).

UI post-invio: conferma, cronologia aggiornata, badge "Sent" accanto
alla variante inviata.

## 4.3 — Polling risposte (cron orario)

- API route GET /api/cron/check-replies protetta da CRON_SECRET.
- Per ogni contatto con gmail_thread_id e status in
  ('Contacted','No reply'): threads.get sul thread; se esiste un
  messaggio con From diverso da info@unfocus.com.au e più recente
  dell'ultimo nostro invio → status 'In conversation' (trigger logga)
  + contact_event type='email_reply' con data della risposta.
- Attenzione alle quote: batch con pausa breve tra le chiamate; se i
  thread aperti sono tanti, processa i più vecchi non controllati prima
  (aggiungi colonna contacts.last_reply_check timestamptz — dammi
  l'ALTER TABLE come migration 003).
- vercel.json: schedule orario.

## 4.4 — Cron reset stati

- API route GET /api/cron/reset-stale protetta da CRON_SECRET,
  schedule giornaliero.
- Contatti 'No reply' con last_contact_date più vecchia di
  settings.status_reset_months → status 'To contact' (trigger logga).
  In più inserisci contact_event type='system', body
  "Auto-reset after N months without reply".

Vincoli: tutte le chiamate Google lato server; token e secret solo in
env/settings; aggiorna .env.example (GOOGLE_OAUTH_CLIENT_ID,
GOOGLE_OAUTH_CLIENT_SECRET). Niente tracking pixel — il tracking è
risposta sì/no, per scelta. Se una scelta non è ovvia, chiedimi prima.
