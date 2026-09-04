# Prospect Engine — Startup Guide

Guida operativa per avviare e usare il tool ogni volta che riprendi a lavorare.

---

## Avvio normale

Sequenza da seguire ogni volta, in ordine:

**1. Verifica Railway**

Apri [railway.app](https://railway.app) → il tuo progetto → servizio
`prospect-engine`. Controlla che lo stato sia **Active** (non "Sleeping").
Se è in sleep: clicca sul servizio → "Deploy" → aspetta 30-60 secondi
finché il log mostra `Application startup complete`.

**2. Avvia il dev server Next.js**

Dal terminale, assicurati di essere nella cartella giusta:

```bash
cd /path/to/prospect-engine   # NON in BookOrbit o altri progetti
npm run dev
```

Il server parte su `http://localhost:3000`. Se vedi BookOrbit invece di
Prospect Engine, sei nella cartella sbagliata.

**3. Verifica il token Gmail**

Apri l'app nel browser e prova ad analizzare un contatto e inviare una
email. Se vedi l'errore `Gmail token refresh failed: Token has been expired
or revoked`, il refresh token è scaduto — vedi la sezione **Situazioni
speciali** più sotto.

**4. Controlla `.env.local`**

Apri `.env.local` nella root del progetto. Verifica che `SCRAPER_SERVICE_URL`
punti a Railway (non a `localhost`) se vuoi usare lo scraper e l'analisi
Instagram in produzione:

```bash
SCRAPER_SERVICE_URL=https://prospect-engine-production-7809.up.railway.app
# SCRAPER_SERVICE_URL=http://localhost:8001   # commentato = non usato
```

Dopo ogni modifica a `.env.local`, **riavvia il dev server** (Ctrl+C → `npm run dev`).
Next.js non legge le variabili d'ambiente a caldo.

---

## Variabili d'ambiente

### `.env.local` (Next.js — mai committare)

| Variabile | Dove trovarla | Note |
|-----------|--------------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | URL del progetto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API | Chiave pubblica |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | Solo server-side, non esporre |
| `SCRAPER_SERVICE_URL` | Railway → servizio → Settings | Toggle locale/produzione con commento |
| `SCRAPER_API_TOKEN` | Scelto da te, identico su Railway | Bearer token per proteggere gli endpoint |
| `ANTHROPIC_API_KEY` | console.anthropic.com | Solo se il backend gira in locale |
| `GMAIL_CLIENT_ID` | Google Cloud Console → OAuth | App OAuth per Gmail |
| `GMAIL_CLIENT_SECRET` | Google Cloud Console → OAuth | App OAuth per Gmail |
| `GMAIL_REFRESH_TOKEN` | Generato da `/api/auth/gmail/start` | Rinnovare se scade |
| `CRON_SECRET` | Scelto da te | Bearer token per i cron job Vercel |
| `NEXT_PUBLIC_APP_URL` | URL pubblico del deploy Vercel | Es. `https://prospect-engine.vercel.app`, no trailing slash |

### Railway (FastAPI — impostate nel pannello env vars del servizio)

Le stesse di `.env.local` eccetto quelle `NEXT_PUBLIC_*` e Gmail.
In più: `MAPS_API_KEY` (Google Cloud Console → Places API New).

---

## Situazioni speciali

### Token Gmail scaduto

**Sintomo:** errore `Gmail token refresh failed: Token has been expired or revoked`
quando provi a inviare una email.

**Causa:** l'app OAuth è in modalità "Testing" su Google Cloud, che fa
scadere i refresh token dopo ~7 giorni di inattività.

**Fix immediato (5 minuti):**

1. Col dev server acceso, apri nel browser:
   `http://localhost:3000/api/auth/gmail/start`
2. Ti reindirizza su Google — accedi con `info@unfocus.com.au`
3. Se compare "app non verificata", clicca **Avanzate → Vai a (nome app)**
4. Dai il consenso
5. Vieni rimandato a una pagina con il nuovo refresh token in un box grigio
6. Copialo e incollalo in due posti:
   - `.env.local` → riga `GMAIL_REFRESH_TOKEN=<nuovo token>`
   - Vercel → progetto → Settings → Environment Variables → `GMAIL_REFRESH_TOKEN`
7. Riavvia il dev server (`Ctrl+C` → `npm run dev`)
8. Su Vercel: Deployments → ultimo deploy → "…" → **Redeploy**

**Se al passo 5 vedi "No refresh token returned":**
Vai su [myaccount.google.com/permissions](https://myaccount.google.com/permissions),
revoca l'accesso all'app UnFocus, e ripeti dal passo 1.

**Fix permanente:** Google Cloud Console → OAuth consent screen →
"Publish app" → passa a "In production". I refresh token smettono di
scadere. Attenzione: potrebbe richiedere una verifica da parte di Google
per lo scope `gmail.send` — se blocca, fermati e valuta con calma.

---

### Railway in sleep mode

**Sintomo:** `Could not reach the analysis service` oppure lo scraper non
risponde.

**Cause possibili:**
- Il servizio Railway è in sleep (piano Hobby — si spegne dopo inattività)
- Il servizio è crashato

**Fix:**
1. Apri [railway.app](https://railway.app) → servizio → tab **Deployments**
2. Se lo stato è "Sleeping": clicca **Deploy** (o fai un nuovo push su GitHub)
3. Aspetta che il log mostri `Application startup complete` (30-60 secondi)
4. Riprova l'operazione nell'app

---

### Dev server mostra BookOrbit invece di Prospect Engine

**Causa:** il terminale è posizionato nella cartella di un altro progetto Next.js.

**Fix:**
```bash
# Interrompi il server (Ctrl+C), poi:
cd /path/to/prospect-engine
npm run dev
```

Se sei nella cartella giusta ma vedi ancora il problema, verifica che
`package.json` nella root abbia `"name": "prospect-engine"`.

---

### L'analisi si interrompe a metà (Railway riavvia)

**Sintomo:** il pulsante di analisi rimane in attesa, nei log di Railway
vedi `Shutting down / Stopping Container` a metà analisi.

**Causa:** Railway (piano Hobby) a volte riavvia il container durante
operazioni lunghe.

**Fix:** premi di nuovo "Analyze Instagram" — il secondo tentativo di
solito completa correttamente. Se continua a interrompersi, controlla i
log di Railway per errori più specifici.

---

### Errore `KeyError` o crash durante l'analisi

**Causa più comune:** il system prompt in `prospect_vision.py` contiene
parentesi graffe `{}` che Python interpreta come segnaposto in un
`.format()`. Questo era il bug iniziale, già risolto usando `.replace()`
invece di `.format()`.

**Se si ripresenta:** apri `scraper-service/prospect_vision.py` e
verifica che `build_system_prompt` usi `.replace()`:
```python
def build_system_prompt(analysis_context: str | None) -> str:
    return SYSTEM_PROMPT_TEMPLATE.replace("{analysis_context}", ...)
```

---

## Flusso di lavoro quotidiano (sintesi)

```
Mattina:
1. Railway attivo? → sì → procedi
2. npm run dev nella cartella giusta
3. Token Gmail ok? → sì → procedi
4. Analizza 2-3 venue con screenshot → invia email
5. Aggiorna stati contatti con risposte ricevute

Aggiornamento codice:
1. Fai le modifiche
2. Testa in locale
3. git add -A && git commit -m "..." && git push
4. Railway si rideploya da solo (2-3 minuti)
5. Vercel si rideploya da solo (1-2 minuti)
```
