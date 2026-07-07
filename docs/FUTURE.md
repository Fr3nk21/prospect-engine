# Prospect Engine — Memorandum funzionalità future

Aggiornato: luglio 2026. Questo documento raccoglie le espansioni discusse
e approvate in linea di principio, con prerequisiti e ordine consigliato.
Regola generale: nessuna di queste parte prima che i Moduli 1–5 siano
completi e usati con dati reali per almeno 4–6 settimane.

---

## Da fare SUBITO (durante i Moduli 3–5, costo quasi zero)

Predisposizioni che evitano refactor dolorosi quando arriverà la
generalizzazione multi-mercato:

- [ ] Colonna `country` su `contacts` (default 'AU'), valorizzata dallo
      scraper a partire dalla location.
- [ ] I prompt di analisi e generazione email del Modulo 3 vanno tenuti
      in un file di configurazione dedicato (o in `settings`), NON
      cablati dentro il codice della route.
- [ ] Le soglie di categoria (rating/recensioni per High/Medium/Low e
      new venue) lette da `settings`, non hardcoded nello scraper.
- [ ] Ogni `email_sent` salva già variante + testo esatto (previsto nel
      Modulo 4): è il dato che alimenta tutto il resto. Non degradarlo.

---

## F1 — Screenshot Instagram automatici

**Cosa**: endpoint sul servizio Railway (Playwright headless) che visita
il profilo Instagram pubblico del contatto e cattura 4–6 screenshot
(griglia + primi post), caricandoli direttamente nel bucket. L'analisi
diventa un solo click dal dettaglio contatto.
**Perché**: è l'unico passaggio manuale rimasto nel flusso; oggi limita
quanti prospect analizzi.
**Attenzioni**: solo profili pubblici, nessun login, rate molto basso
(un profilo ogni qualche minuto), user-agent onesto. Instagram è ostile
all'automazione: prevedere fallback manuale se la cattura fallisce.
**Prerequisiti**: Modulo 3 stabile. **Sforzo**: medio.

## F2 — Sequenze di invio

**Cosa**: al posto dell'invio singolo, una sequenza: cold email → attesa
N giorni → follow-up automatica se nessuna risposta. Stop immediato
dell'intera sequenza alla prima risposta o al passaggio a Not interested.
**Perché**: la follow-up è dove si perde disciplina; Today la ricorda,
la sequenza la esegue.
**Note di design**: tabella `sequences` (contact_id, step, scheduled_at,
status); il cron orario esistente esegue gli step in scadenza. Cap
giornaliero di invii configurabile in `settings` (protegge la
reputazione del dominio).
**Prerequisiti**: Modulo 4 + fiducia nel polling risposte. **Sforzo**: basso.

## F3 — Insight narrativi mensili

**Cosa**: cron mensile che passa gli aggregati della pagina Insights a
Claude e salva un paragrafo di sintesi ("i wine bar di Fitzroy con la
variante warm rispondono al doppio della media; le agency non rispondono
mai al follow-up"), mostrato in cima a /insights.
**Prerequisiti**: ~100 invii registrati; prima di quella soglia le
sintesi sarebbero rumore travestito da insight. **Sforzo**: basso.

## F4 — Modulo Signals (fonti oltre Google Maps)

**Cosa**: seconda sorgente di prospect basata su *segnali di apertura e
crescita*, non su ricerca di massa. Una tabella `signals` alimentata da
scraper leggeri sul servizio Railway; i segnali diventano prospect con
un click e compaiono in una sezione dedicata di Today ("New openings
this week").
**Fonti in ordine di valore (Melbourne)**:
1. Registro licenze liquor VGCCC — nuova licenza = locale che aprirà:
   prospect prima che esista su Maps.
2. Broadsheet Melbourne / Urban List — nuove aperture settimanali, già
   selezionate editorialmente, spesso con Instagram.
3. Registri food business dei council (Yarra, Melbourne, Port Phillip).
4. ABN Lookup / ASIC per nuove società (agenzie, construction).
5. Annunci Seek: chi assume marketing/social sta investendo in
   visibilità — timing perfetto per proporsi.
**Note**: Facebook pages restano un arricchimento (email quando il sito
non la espone), non una fonte. Evitare scraping diretto di Instagram e
directory generaliste (dati stantii, email generiche).
**Prerequisiti**: Moduli 1–5. **Sforzo**: medio-alto (una fonte alla
volta: partire da Broadsheet, la più semplice).

## F5 — Playbooks (multi-mercato / multi-industria)

**Cosa**: rendere configurabile ciò che oggi è specifico per Melbourne
hospitality. Tabella `playbooks`: ogni riga = combinazione
mercato/industria (es. "Hospitality AU", "Barber IT", "Construction AU")
con: lingua delle email, template e regole del prompt di generazione,
dimensioni e pesi dell'analisi (cosa guardare: Instagram? portfolio sul
sito? Google Business Profile?), soglie di categoria e new venue, tipi
di business suggeriti nella ricerca.
Lo scrape si lancia scegliendo location + playbook; ogni contatto nasce
col suo `playbook_id` e analisi/email/categorie leggono da lì.
**Perché**: apre il tool a qualsiasi paese e settore (Italia,
Construction, Barber, Mechanic...) scrivendo configurazione, non codice.
**Attenzioni**:
- Non generalizzare prima di aver validato Melbourne hospitality con
  risposte reali: un tool flessibile costruito su ipotesi non validate
  è flessibilmente mediocre.
- Ogni playbook nuovo va calibrato con qualcuno che conosce quel
  mercato: le soglie di recensioni e il registro delle email non si
  indovinano.
- Mercati UE: il cold outreach B2B ricade sotto GDPR (più restrittivo
  dello Spam Act australiano) — prima di attivare un playbook europeo,
  verifica legale seria delle pratiche di contatto.
**Prerequisiti**: le predisposizioni "da fare subito" + Insights con
dati veri. **Sforzo**: alto (ma incrementale: il primo playbook è la
formalizzazione dell'esistente).

## F6 — Portfolio-matching nelle email

**Cosa**: una tabella `portfolio` (lavori UnFocus: cliente, tipo, link,
descrizione breve, tag). Durante l'analisi, Claude riceve anche il
portfolio e suggerisce quale lavoro citare come referenza nella email
("simile al reel girato per X").
**Perché**: la referenza pertinente è il singolo elemento che più
aumenta la credibilità di una cold email.
**Prerequisiti**: Modulo 3; qualche lavoro censito. **Sforzo**: basso.

---

## Ordine consigliato

F2 (sequenze) → F1 (screenshot automatici) → F6 (portfolio) →
F3 (insight narrativi) → F4 (signals) → F5 (playbooks).

La logica: prima si automatizza il flusso che già funziona (F2, F1),
poi si migliora la qualità del messaggio (F6), poi si impara dai dati
(F3), poi si allarga la cattura (F4), e solo alla fine si generalizza
a nuovi mercati (F5) — quando ogni pezzo precedente ha dimostrato di
funzionare almeno in uno.
