# Prompt per Claude Code — Modulo 1
# (incolla il testo sotto nella sessione di Claude Code, aperta nel root del repo)

Leggi CLAUDE.md, db/schema.sql e docs/TASKS.md prima di iniziare.

Implementa il Modulo 1 (task 1.1 → 1.4 di docs/TASKS.md), un passo alla volta,
fermandoti dopo ogni task per farmi verificare che funzioni.

Contesto: lo schema SQL è già stato eseguito su Supabase, il mio utente esiste,
i signup sono disabilitati. Ho le credenziali pronte da mettere in .env.local
(ti do i valori quando servono — tu prepara .env.example con i nomi delle
variabili).

Ordine di lavoro:

1. **Scaffold + Auth (task 1.1)** — Inizializza Next.js (App Router,
   TypeScript) nel root del repo, rispettando la struttura descritta in
   CLAUDE.md. Supabase Auth con @supabase/ssr: pagina /login (email +
   password, niente signup), middleware che protegge tutte le route,
   logout nella topbar. Fermati e dimmi come testare in locale.

2. **Import Google Sheet (task 1.2)** — Script Python una tantum in
   scraper-service/import_sheet.py che legge il foglio "Melbourne Venues"
   via gspread (service account) e popola la tabella contacts via Supabase.
   Mappatura: colonne italiane → campi inglesi dello schema; categoria
   Alta/Media/Bassa → High/Medium/Low; stati "Da contattare"→"To contact",
   "Contattato"→"Contacted", "Contattato ma non risposto"→"No reply",
   "In conversazione"→"In conversation", "Contattato e non interessato"→
   "Not interested"; source='sheet_import'. Lo script deve stampare un
   riepilogo (righe lette / inserite / scartate e perché) e avere una
   modalità --dry-run. Prima di scrivere sul DB, mostrami la mappatura
   colonne che hai dedotto e chiedimi conferma.

3. **Lista contatti (task 1.3)** — Dashboard su dati veri. In docs/mockup.jsx
   c'è il mockup approvato: replica layout, palette (CSS variables, temi
   light/dark con toggle), filtri (ricerca nome, categoria, stato, tipo,
   intervallo date ultimo contatto), ordinamento per colonna e paginazione.
   Filtri e paginazione via query params, così i filtri sopravvivono al reload.

4. **Dettaglio contatto base (task 1.4)** — Pagina /contacts/[id]: dati
   business, select stato (solo update di contacts.status — il trigger DB
   logga da solo l'evento), note manuali (insert in contact_events con
   type='note'), cronologia in ordine inverso. Quando lo stato diventa
   "Not interested" e il contatto ha un place_id, inserisci anche in blocklist.

Vincoli: UI in inglese; niente componenti client dove basta un Server
Component; nessuna chiamata a Supabase con la service_role key dal frontend.
Se una scelta implementativa non è ovvia, chiedimi prima di procedere.
