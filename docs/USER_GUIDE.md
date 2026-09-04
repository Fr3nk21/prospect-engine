# Prospect Engine — Guida utente

Come usare il tool giorno per giorno.

---

## Il flusso completo

```
Scraping → Triage → Analisi IG → Invio email → Gestione risposte
```

Ogni fase è indipendente: puoi analizzare solo alcuni contatti,
o inviare email solo dopo aver analizzato. Non è obbligatorio
seguire l'ordine per ogni contatto.

---

## 1. Scraping nuovi venue

Dalla lista contatti, pannello in alto **"New search"**:

1. Inserisci la **location** (es. "Fitzroy, VIC, Australia")
2. Inserisci la **categoria** (es. "restaurant", "cafe", "bar")
3. Clicca **Search** — la barra di avanzamento mostra il progresso in tempo reale
4. Al termine, i nuovi contatti compaiono in lista con categoria **"Not analysed"**

**Cosa fa lo scraper:**
- Cerca su Google Maps tutti i venue della categoria nella location
- Arricchisce ogni venue con email e Instagram dal loro sito web
- Salta i duplicati (stessi venue già in lista) e i blocklisted
- Salta i venue chiusi permanentemente

**Nota:** lo scraper non accede a Instagram direttamente. Il profilo
Instagram viene trovato solo se è linkato sul sito web del venue.

---

## 2. Triage della lista

Prima di analizzare ogni venue, usa i filtri per trovare quelli
più interessanti su cui concentrarti:

- **Category: Not analysed** — i nuovi da valutare
- **Rating** — usa il rating Google come primo filtro grezzo (visibile in lista,
  più piccolo e in secondo piano rispetto al punteggio IG)
- **City/Suburb** — concentrati su una zona alla volta
- **Type** — filtra per tipo di business

I filtri sopravvivono alla navigazione: se apri un contatto e torni
indietro, li ritrovi attivi.

---

## 3. Analisi Instagram

Per ogni venue che vuoi analizzare in profondità:

1. Apri la pagina di dettaglio del contatto
2. Vai su Instagram del venue e fai **screenshot** della griglia, dei Reels,
   della bio — fino a 10 screenshot
3. Carica gli screenshot nella sezione **"Instagram screenshots"**
   (drag & drop o click per sfogliare)
4. Clicca **"Analyze Instagram"**
5. L'analisi dura ~30 secondi — il pulsante lampeggia durante l'elaborazione
6. Al termine compaiono: punteggio opportunità, breakdown per dimensione,
   tre varianti email

**Il punteggio opportunità (0-100):**
Non misura "quanto è bello il profilo" ma **"quanto vale come cliente potenziale"**.
Un venue con un brand curato ma video di bassa qualità prende un punteggio alto —
è esattamente il cliente che ha bisogno di te. Un venue già eccellente su tutto
prende un punteggio basso — non ha bisogno di te.

**Le categorie:**
- `High` (verde) — gap chiaro tra brand e qualità esecutiva, alto potenziale
- `Medium` (arancione) — potenziale c'è ma meno urgente
- `Low` (rosso) — o non ci tengono abbastanza, o sono già bravi
- `Not analysed` (grigio) — nessuna analisi ancora

**Gli screenshot vengono eliminati automaticamente dopo 5 giorni.**
L'analisi e le email restano per sempre sul contatto.

---

## 4. Le tre varianti email

Dopo l'analisi trovi tre email pronte:

- **Technical** — apre diretto sull'osservazione + proposta. Per business
  più strutturati o corporate.
- **Warm** — apre con più calore relazionale prima della proposta. Per
  piccole attività a conduzione familiare.
- **Follow-up** — da inviare se non c'è risposta dopo la prima email.
  Referenzia la prima e aggiunge un nuovo hook.

**Per modificare un'email:**
1. Clicca **Edit** sulla variante che vuoi modificare
2. Si apre un modal a schermo intero con l'email editabile
3. Modifica il testo come vuoi
4. Clicca **Save** per salvare, oppure **Cancel** per annullare

**Per inviare:**
1. Clicca **Send** (dentro o fuori dal modal)
2. Conferma l'invio nella finestra di dialogo
3. Il bottone diventa **"Sent ✓"** e lo stato del contatto passa a **"Contacted"**

Ogni email include in automatico la firma e il link di unsubscribe.
Non aggiungerli manualmente.

---

## 5. Gestione degli stati

Gli stati seguono questo flusso:

```
To contact → Contacted → No reply
                       → In conversation
                       → Not interested
Not interested → To recontact (automatico dopo 9 mesi, se non ha fatto unsubscribe)
```

**Cambiare stato:** dal dettaglio contatto, usa il menu a tendina
"Contact status". Il cambio viene loggato automaticamente nella cronologia
con data e ora.

**"Not interested":** aggiunge il venue alla blocklist — non verrà
mai riscrappato da Google Maps nelle ricerche future.

**"To recontact":** appare automaticamente dopo 9 mesi per i contatti
"Not interested" che non hanno fatto unsubscribe. È un promemoria che vale
la pena riprovare — non un invio automatico.

---

## 6. Note e cronologia

Nel dettaglio contatto, sezione **"History"**:

- Scrivi una nota nel campo di testo e clicca **Save note** per aggiungerla
- La cronologia mostra tutti gli eventi: import, cambi di stato, note,
  email inviate, analisi completate — in ordine cronologico inverso

---

## 7. Settings

La pagina **Settings** (link in alto a destra) permette di modificare
il contesto di settore usato dal prompt di analisi Claude.

Il testo default è:
> "a videography and photography studio in Melbourne specialising in
> hospitality content"

Se vuoi puntare il tool su un altro settore (es. barbershop, studi
legali, palestre), modifica questo testo e salva. Le prossime analisi
useranno il nuovo contesto. Le analisi già fatte non cambiano.

---

## Cose da non fare

- **Non modificare manualmente `contacts.status`** nel DB Supabase —
  usa sempre l'app, perché il trigger che logga la cronologia si attiva
  solo da lì
- **Non committare `.env.local`** — contiene le chiavi API
- **Non aggiungere il link di unsubscribe a mano nelle email** —
  viene aggiunto automaticamente da `lib/gmail.ts`
- **Non inviare email a chi ha status "Not interested"** — il bottone
  Send funziona tecnicamente, ma è contro le regole dello Spam Act

---

## Colonna IG nella lista

La colonna **IG** in lista mostra:
- `📷 72` — screenshot caricati + analisi completata (72 = punteggio opportunità)
- `📷` — screenshot caricati, nessuna analisi ancora
- `—` — nessuno screenshot, nessuna analisi

Il tooltip al passaggio del mouse mostra "Opportunity score: X/100".
