# Deploy — scraper-service (Railway)

Il microservizio FastAPI in `/scraper-service` è deployato su Railway come
servizio separato dal Next.js (che resta su Vercel).

URL produzione: `https://prospect-engine-production-7809.up.railway.app`
(salvato come `SCRAPER_SERVICE_URL` in `.env.local` e nelle env di Vercel).

## Configurazione Railway

- **Root directory**: `scraper-service` (il monorepo ha anche il Next.js
  alla radice — Railway deve buildare solo questa sottocartella)
- **Builder**: Nixpacks (rilevato da `requirements.txt`), configurato in
  `scraper-service/railway.json`:
  - start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
  - healthcheck: `GET /health`, timeout 30s
  - restart policy: `ON_FAILURE`
- Railway inietta automaticamente `$PORT` — non va impostata a mano

## Variabili d'ambiente (Railway → Variables)

Corrispondono a `scraper-service/.env.example`:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key — bypassa RLS>
MAPS_API_KEY=<Google Maps Platform key, Places API (New) abilitata>
SCRAPER_API_TOKEN=<stringa lunga casuale, condivisa col Next.js>
ANTHROPIC_API_KEY=<chiave Claude API — la chiamata a Claude Vision gira qui, non su Vercel>
```

`SCRAPER_API_TOKEN` deve combaciare con quello messo in `.env.local` del
Next.js (usato in `Authorization: Bearer <token>` sia dalla API route proxy
sia nei test manuali sotto).

`SERVICE_ACCOUNT_FILE` / `SPREADSHEET_ID` (usati solo da `import_sheet.py`,
Modulo 1) non servono su Railway — quello script gira in locale.

## Comandi di test

Sostituire `$URL` e `$TOKEN` con i valori reali.

```bash
# Health check (nessuna auth richiesta)
curl https://prospect-engine-production-7809.up.railway.app/health

# Avvia uno scrape
curl -X POST https://prospect-engine-production-7809.up.railway.app/scrape \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"location": "Richmond, VIC", "business_type": "Restaurant"}'
# → {"job_id": "..."}

# Controlla l'avanzamento del job
curl https://prospect-engine-production-7809.up.railway.app/scrape/<job_id> \
  -H "Authorization: Bearer $TOKEN"

# Avvia un'analisi Instagram (serve almeno uno screenshot già caricato per il contatto)
curl -X POST https://prospect-engine-production-7809.up.railway.app/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"contact_id": "<uuid contatto>"}'
# → {"job_id": "..."}

# Controlla l'avanzamento dell'analisi
curl https://prospect-engine-production-7809.up.railway.app/analyze/<job_id> \
  -H "Authorization: Bearer $TOKEN"
```

## Note

- Gli scrape girano come `BackgroundTasks` di FastAPI: la richiesta HTTP
  torna subito con `job_id`, il lavoro vero (ricerca Google Maps +
  enrichment sito per sito) continua in background senza timeout HTTP.
- Il servizio usa la Supabase **service_role key**, quindi bypassa le RLS —
  nessun bisogno di sessione utente lato scraper.
- Log applicativi visibili in Railway → Deployments → View logs.
