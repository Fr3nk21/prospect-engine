# Prospect Engine — Recap sessione e prossimi task

Documento di contesto per ripartire da dove ci siamo fermati. Aggiornato dopo
la sessione del 9 settembre 2026, che ha chiuso tutti i blocchi prioritari
identificati nell'UX test dell'8 settembre.

---

## Stato del progetto

Tutti i blocchi del recap precedente sono stati completati. Il tool è ora
pronto per l'outreach reale — Francesco non ha ancora inviato email a
clienti, ma non ci sono più blocchi tecnici noti.

**Completato in questa sessione (9 settembre):**

- **Bug UX test**: porta dev fissata (3100), delete contatto ora preserva i
  filtri della lista tramite `router.back()` invece di un redirect fisso,
  bug sullo status era un falso allarme (funzionava già)
- **Modifica manuale contatto**: form inline (pulsante "Modifica") per
  email/telefono/Instagram, con `manually_edited_fields` (array, non
  booleano) che traccia solo i campi realmente cambiati — protegge da un
  futuro re-enrich senza congelare l'intera riga
- **Aggiunta manuale contatto**: modale "+ Add contact" dalla lista,
  `place_id` null, `category` = `Not analysed`, `source` = `manual`
- **Protocollo cattura screenshot**: sequenza consigliata (non obbligatoria)
  documentata in `docs/USER_GUIDE.md` — header profilo → griglia → tab Reels
  aperto → post aperti. Il prompt in `prospect_vision.py` ora riconosce ogni
  tipo di screenshot dal contenuto visivo (non dalla posizione) e usa il tab
  Reels come segnale primario per `video_presence` quando presente
- **Calibrazione soglie scoring**: `gap_medium` alzato da 5 a 15 in
  `settings.scoring_config`, basato sui dati reali di 20 venue analizzati.
  Ricategorizzazione retroattiva applicata (8 venue passati da Medium a Low)
- **Quick win**: `PAGE_SIZES` ora include 50/100, countdown onesto durante
  l'analisi ("Xs — di solito ~30s") invece di una barra di progresso finta
- **Performance lista contatti**: `score_breakdown` letto direttamente nella
  query paginata (eliminata la query separata su `analysis_jobs`),
  `screenshots` ora scopata sugli id della pagina corrente invece che
  sull'intera tabella
- **Filtro "Contacted 7+ giorni"**: badge cliccabile in lista, versione
  manuale (senza polling Gmail) — un contatto esce dalla vista appena cambi
  il suo status
- **Rifiniture UI**: select/date/checkbox nativi ristilizzati (mancava
  `appearance: none`), link sito/Instagram accorciati e puliti dai parametri
  UTM, colonna "Category" rinominata in "Opportunity" (per chiarezza — non è
  mai stata il tipo di business), nuova colonna "Type" separata dal
  sottotitolo per supportare futuri settori oltre alla ristorazione

---

## Lezioni tecniche da questa sessione

- **Due file `actions.ts`** (`app/(protected)/contacts/actions.ts` per la
  lista, `app/(protected)/contacts/[id]/actions.ts` per il dettaglio) sono
  una fonte concreta di errori — in questa sessione una funzione è finita
  nel file sbagliato e ha sovrascritto tutto il contenuto precedente,
  causando ore di debug su un sintomo ("is not a function") la cui causa
  reale era altrove. Attenzione al percorso esatto prima di incollare codice.
- **JSONB e `WHERE ... IS NOT NULL` non bastano**: una colonna JSONB può
  essere "not null" ma non contenere le chiavi attese. Una query di
  ricategorizzazione ha toccato 5 righe che non doveva (dati legacy senza
  `gap`/`intent`). Meglio `WHERE score_breakdown ? 'chiave'` per verificare
  l'esistenza della chiave, non solo che la colonna non sia nulla.
- **Controlli nativi del browser** (select, date, checkbox) ignorano
  `background`/`border` senza `appearance: none` esplicito — causa comune di
  "questo campo è brutto" quando il CSS sembra corretto a prima vista.

---

## Cosa resta, esplicitamente rimandato

Nessun blocco prioritario aperto. Le voci sotto restano ferme finché non si
verifica la precondizione indicata.

- **Pagina Insights** — vuota con zero invii reali. Ha senso con 50-100
  email effettivamente mandate da analizzare.
- **Task C — Gmail polling risposte** — dopo le prime email reali spedite.
  Richiede `gmail.readonly` e re-consent OAuth.
- **Pubblicare app OAuth su "In production"** — fix permanente per lo
  scadere del refresh token ogni 7 giorni. Attenzione: potrebbe richiedere
  verifica Google per lo scope `gmail.send` — se blocca, fermarsi e valutare.
- **Multi-market/multi-industry** (Italia, altre città australiane, altri
  settori oltre alla ristorazione) — dopo validazione di Melbourne
  hospitality con dati di risposta reali. La colonna "Type" aggiunta oggi è
  un primo passo di preparazione per questo, ma non un'attivazione.

---

## Riferimenti rapidi

- **Repo:** prospect-engine (Next.js + Supabase + FastAPI su Railway)
- **CLAUDE.md** nella root — da aggiornare con le decisioni di questa sessione
- **docs/USER_GUIDE.md** — aggiornato con il protocollo screenshot
- **docs/ARCHITECTURE.md** — stack, schema DB, scoring Modello B (soglie da
  verificare che riflettano `gap_medium = 15`)
- **docs/STARTUP.md** — avvio, variabili env, troubleshooting

## Come lavora Francesco

- Preferisce essere consultato prima di scelte architetturali, non trovarsi
  davanti a decisioni già prese
- Testa in locale prima di ogni push
- Vuole file completi da sostituire, non diff parziali
- Fa tutte le modifiche manualmente (non usa Claude Code per l'implementazione)
- Comunica in italiano, codice e UI restano in inglese
- Preferisce messaggi concisi — non dilungarsi inutilmente
- Non è uno sviluppatore professionista ma conosce Next.js, Python, Vercel