# Prompt per Claude Code — Modulo 5 (Today view e Insights)
# Incolla in una sessione Claude Code aperta nel root del repo.
# Prerequisiti: Moduli 1-4 completati; qualche settimana di dati reali
# (invii + risposte) rende gli Insights subito sensati, ma non è bloccante.

Leggi CLAUDE.md, db/schema.sql e docs/TASKS.md prima di iniziare.
Implementa il Modulo 5 (task 5.1 → 5.3 di docs/TASKS.md), un task alla
volta, fermandoti dopo ognuno per farmi testare.

## 5.1 — Vista Today (nuova homepage)

La route / diventa la vista Today; la lista contatti si sposta su
/contacts (aggiorna la navigazione: Today | Contacts | Insights |
Settings).

Tre sezioni, ciascuna una lista compatta di card cliccabili verso il
dettaglio (nome, categoria, badge new venue, giorni trascorsi, azione
suggerita). Ordina per urgenza, max 10 per sezione con link "view all"
che apre /contacts pre-filtrata:

1. "Follow-ups due" — status 'Contacted', ultimo contact_event
   email_sent >= 7 giorni fa, nessuna risposta, follow-up non ancora
   inviato (nessun email_sent con variant='followup'). Azione: aprire
   il dettaglio con la follow-up pronta.
2. "Hot prospects, never contacted" — status 'To contact', ordinati per:
   is_new_venue prima, poi priority_score (se analizzati), poi categoria.
3. "Open conversations" — status 'In conversation', ordinati per
   email_reply più recente. Mostra da quanti giorni attende una mia
   risposta.

Sezione vuota → una riga di stato ("Nothing due today"), non nasconderla.
Header con contatori sintetici: to contact / contacted this week /
open conversations.

## 5.2 — Insights

Pagina /insights. REGOLA FISSA: ogni percentuale mostra sempre il numero
assoluto accanto — "43% (3/7)" — perché i campioni saranno piccoli a
lungo. Sotto le ~5 osservazioni, mostra "not enough data" invece della
percentuale.

Definizione di "reply": contatto con almeno un contact_event
type='email_reply' successivo all'email_sent considerata.

Blocchi (query SQL aggregate — propònile e discutiamole prima di
implementare la UI):
1. Reply rate per variante (technical / warm / followup)
2. Reply rate per categoria (High/Medium/Low) e per is_new_venue
   (qui si valida l'ipotesi "i locali nuovi rispondono di più")
3. Reply rate per business_type e per suburb
4. Funnel del mese corrente e del precedente: nuovi contatti →
   contattati → risposte → conversazioni
5. Priority score vs risposte: reply rate per fascia di score
   (1-4 / 5-7 / 8-10) — valida lo scoring di Claude
6. Tempo mediano alla risposta

UI sobria e leggibile: tabelle e barre orizzontali CSS, coerenti col
tema; niente librerie di charting pesanti per ora.

## 5.3 — Export CSV

Su /contacts: bottone "Export CSV" che scarica la lista CON I FILTRI
CORRENTI applicati (stesse query params). Colonne: tutti i campi
anagrafici + categoria, flag new venue, stato, date, priority_score.
Generazione server-side, encoding UTF-8 con BOM (per Excel).

Vincoli: le query Insights girano server-side (Server Components o route
handler); attenzione agli N+1 — aggregazioni in SQL, non in JavaScript.
Se una scelta non è ovvia, chiedimi prima.
