# 001 — Life Tracker Performance Analytics OS

**Data**: 2026-07-14
**Sezione**: "Performance" (tab `performance`, gruppo Intelligence della sidebar)
**Stato**: implementata end-to-end, testata, build verde
**Vincoli rispettati**: nessun commit/push/deploy, nessuna modifica a `.env`, nessun reset o migrazione del database, nessuna dipendenza aggiunta.

---

## 1. Executive Summary

È stata implementata una nuova sezione **Performance Review** che risponde alle tre domande fondanti: *dove avevo deciso di investire il tempo, dove l'ho investito davvero, quale correzione emerge dalla differenza*.

La sezione offre viste **Week / Month / Year** con navigazione tra periodi, confronto onesto dei periodi parziali (primi N giorni vs primi N giorni del periodo precedente), KPI, grafico Plan vs Reality (barre giornaliere/mensili + vista cumulativa), breakdown per Goal e Project, heatmap di consistenza, motore di insight **deterministico** (nessun LLM), lista carry-over, pannello Data Coverage e tabella di dettaglio che riconcilia ogni numero aggregato con i record sorgente.

Tutto il calcolo vive in un **metrics layer puro** (`src/lib/performance/`, zero dipendenze da React/DB) coperto da 59 unit test; la UI (9 componenti) è coperta da 8 component test. Suite completa: **483/483 test verdi**, lint ok, `next build` ok.

## 2. Repository audit (fase 1)

Lo stack ipotizzato dal brief (Prisma + DB relazionale + route server) **non corrisponde al progetto reale**. Stack verificato:

- **Next.js 15 App Router + React 18 + TypeScript** (`strict: false`), Tailwind CSS 3, Recharts 2.8, lucide-react, Vitest 3 + Testing Library.
- **SPA a tab**: l'intera app vive su `src/app/page.tsx`; la navigazione è lo stato `activeTab` in `MainApp.tsx` + `shell/SidebarNavigation.tsx`. Non esistono route per-sezione né uso di search params.
- **Data layer client-side**: `src/lib/database.ts` (`LifeTrackerDB`) con adapter **Firebase** (utente loggato, collezioni con path per-utente) e **IndexedDB** (guest). Niente Prisma, niente API server per i dati personali.
- **`DataProvider`** carica in memoria tutte le entità dell'utente all'avvio, già filtrate per `userId` e soft-delete; i componenti ricevono i dati dal context.
- **Analytics esistenti**: `AnalyticsDashboard` (finestre 7/30/90 giorni), `GoalAnalyticsDashboard`, `WeeklyExecution` (solo settimana corrente). Nessuna offre periodi calendario navigabili, confronto periodi, scorecard progetti, heatmap, unplanned/carry-over, drill-down. La nuova sezione è additiva; le tab esistenti restano intatte.
- Modulo più recente e meglio testato: `src/lib/weeklyPlanner/*` — ne ho adottato le convenzioni (moduli puri + test co-locati, predicati di stato documentati).

## 3. Modello dati individuato

```
Goal (title, status, priority, targetDate, timeAllocationTarget, soft-delete)
 └─ Project (goalId, status, weekly/totalHoursTarget, soft-delete)
     └─ Task (projectId, goalId?, status, estimatedMinutes, dueDate?, completedAt?, soft-delete)
         └─ TimeBlock (taskId?/projectId?/goalId?, startTime/endTime pianificati,
                        actualStartTime?/actualEndTime?, status: planned|in_progress|
                        completed|cancelled|overrun, type: work|break|buffer|…)
Session (timeBlockId?, taskId?, projectId?, startTime, endTime?, duration sec,
         status: active|paused|completed)  ← NON caricata da DataProvider
```

Fatti chiave verificati nel codice:

- `SessionManager.stopSession()` **scrive i tempi reali sul TimeBlock collegato** e lo marca `completed`/`overrun`: le Session con `timeBlockId` sono già assorbite dal blocco (fonte di doppio conteggio se sommate). Le Session **orfane** (senza blocco) sono lavoro reale non rappresentato altrove.
- La catena di attribuzione ufficiale è `lib/hierarchicalRollup.ts`: taskId → task.projectId → project.goalId, con fallback ai link diretti del blocco. Replicata identica nel nuovo engine.
- `weeklyPlanner/analytics.isCompletedStatus()` (modulo più recente, dichiarato "single source of truth") considera **`overrun` come eseguito**; CLAUDE.md (più vecchio) conta solo `completed`. Ho seguito la semantica più recente e reso visibile la differenza (`dataQuality.overrunBlockCount`).
- Goals/Projects/Tasks/KeyResults usano soft-delete (`deleted`); TimeBlocks e Tasks possono anche essere hard-deleted → i blocchi con genitori mancanti sono rilevati e contati (`blocksWithMissingParents`), il tempo finisce in "Unassigned", mai perso.
- I timestamp sono `Date` locali (deserializzati da `toDateSafe`, che gestisce Firestore Timestamp/ISO/epoch); non esiste alcuna libreria timezone nel progetto.

## 4. Metric Glossary

La versione normativa è il commento in testa a **`src/lib/performance/types.ts`**; sintesi:

| Metrica | Formula | Fonte | Esclusioni / fallback |
|---|---|---|---|
| **Planned minutes** | Σ finestra pianificata (start→end) dei blocchi **creati in anticipo** (`createdAt < startTime`), clippata al periodo | TimeBlocks | Esclusi: `deleted`, `cancelled` (→ `cancelledPlannedMinutes`), type `break`/`buffer` (→ `excludedBreakMinutes`). I blocchi retro-loggati **non sono piano** (altrimenti Plan ≈ Actual per definizione) |
| **Actual minutes** | Σ tempo eseguito di blocchi `completed`/`overrun` su `[actualStart‖start, actualEnd‖end]` clippato al periodo **+** Session `completed` senza `timeBlockId` | TimeBlocks + Sessions | Session con `timeBlockId` saltate (anti doppio conteggio); Session `active/paused` escluse (→ `openSessionCount`); durate >24h cappate (→ `anomalousDurationCount`) |
| **Variance / execution ratio** | `actual − planned`; `actual ÷ planned` | derivate | ratio `null` se planned = 0 (mai NaN/∞) |
| **Unplanned minutes** | actual da blocchi retro-loggati (`createdAt ≥ startTime`) + session orfane | derivata | sottoinsieme di Actual |
| **Planned tasks / fulfillment** | task con `dueDate` nel periodo ∪ task linkati da blocchi pianificati nel periodo; fulfilled se `completedAt < fine periodo` e (se due nel periodo) `≤ end-of-day(dueDate)` | Tasks | rate `null` con denominatore 0 |
| **On-time rate** | completati nel periodo **con** dueDate: `completedAt ≤ EOD(dueDate)` | Tasks | i task senza scadenza non entrano nel denominatore |
| **Carry-over** | planned task non fulfilled, con esito derivabile: `open` (scadenza passata o periodo chiuso) / `completed-late` / `cancelled` | Tasks | i task in corso con scadenza futura in un periodo corrente **non** sono carry-over; le riprogrammazioni non sono tracciabili dallo schema (gap documentato) |
| **Active days** | giorni trascorsi con actual > 0 o ≥1 task completato | day buckets | `elapsedDays` = giorni da inizio periodo a min(oggi, fine) |
| **Data coverage** | `measured ÷ (measured + assumed)`; measured = timestamp reali, assumed = fallback finestra pianificata | derivata | `null` senza actual; + contatori di onestà (orfane, unclassified, estimated-unscheduled, ecc.) |
| **Confronto periodo** | periodo parziale → finestra precedente clippata allo **stesso span calendario** (`now` shiftato di un periodo con aritmetica di calendario, mai millisecondi) | period.ts | DST-safe |

Decisioni documentate nei test: blocchi sovrapposti restano record distinti (nessuna dedup, somme fedeli ai dati); `createdAt` corrotto → beneficio del dubbio (planned).

## 5. Decisioni architetturali

1. **Calcolo client-side su dati già in memoria.** L'app è una SPA con dataset personale (migliaia di record) già caricato da `DataProvider`; introdurre un'API server sarebbe contro-architettura (l'export statico per GitHub Pages non avrebbe il server). L'aggregazione pura gira in millisecondi dentro `useMemo`.
2. **Layer separati** come da brief, adattati: `lib/performance/` = repository(=input snapshot)+metrics+insights+format puri e testabili senza DB; `components/performance/` = solo rendering/interazione. Nessuna formula duplicata nella UI.
3. **Sessions caricate on-demand** nel dashboard via `db.getByIndex('sessions','userId', userId)` (indice IndexedDB esistente; su Firebase il path è comunque per-utente) + filtro difensivo `s.userId === userId` + deserializzazione `toDateSafe`.
4. **Isolamento utente**: `userId` esclusivamente dalla sessione autenticata (`useDataContext().userId`, derivato da `AuthProvider`); nessun id accettato dall'esterno; nessuna cache globale (tutto stato React per-mount); nessun dato personale nei log (solo errori tecnici).
5. **Periodi in ora locale** (= `Europe/Rome` per l'utente e per il sistema, verificato `timedatectl`): aritmetica con `setDate/setMonth` (DST-safe strutturalmente, mai somme di ms per attraversare giorni), settimane ISO lunedì-domenica, estremi esclusivi `[start, end)`. Coerente con tutto il resto dell'app, che usa l'ora locale del dispositivo.
6. **Stato in-component, non URL**: l'app non ha routing per tab né search params (convenzione consolidata). Deviazione dal brief documentata qui; la sincronizzazione URL diventerebbe sensata solo se l'app adottasse route per tab.
7. **`overrun` conta come eseguito** (allineato al modulo più recente); differenza resa visibile in Data Coverage.

## 6. Libreria grafica: Recharts (esistente)

Recharts 2.8 è già in `package.json` ed è usata da `AnalyticsDashboard`. Copre bene barre affiancate/impilate, linee cumulative, tooltip e responsività; introdurre ECharts avrebbe violato "non introdurre due librerie di chart" e appesantito il bundle. Heatmap e bullet-bar dei Goal sono HTML/CSS puro (più accessibili e leggeri di un canvas). Animazioni disattivate (`isAnimationActive={false}`): niente distorsione percettiva, `prefers-reduced-motion` rispettato per costruzione (l'unica animazione residua, lo scroll del drill-down, controlla la media query).

**Metodo colore (skill dataviz applicata)**: il grafico principale è una forma *emphasis* — Actual (la storia) in blu brand `#3b82f6`, Planned (contesto) in grigio slate `#64748b` (basso chroma intenzionale, contrasto 4.75:1), Unplanned in ambra `#f59e0b`. Palette **validata con lo script della skill** (non a occhio): coppia blu/ambra ΔE CVD 132.6 (target ≥12) PASS; ambra 2.15:1 su bianco → regola del *relief* soddisfatta (tooltip + etichette + tabella attività, i valori non sono mai solo-colore). Heatmap = rampa **sequenziale** monotona blu (Tailwind 100→700). I Goal **non** hanno un colore per riga (categorie nominali illimitate → stessa coppia grigio/blu per tutte, identità dalla label). Stati (ahead/on-track/behind/no-plan/inactive/no-data) = chip con **simbolo + testo**, mai solo colore. Un solo asse per grafico (daily/cumulative è un toggle, non un secondo asse).

## 7. Struttura della pagina e grafici

Ordine (gerarchia del brief): **Toolbar** (periodo + filtri) → **KPI** (7 stat tile: Actual, Planned, Plan vs Actual, Planned tasks done, Unplanned, Active days, Data coverage — ognuna con delta vs periodo precedente e formula nel tooltip) → **Plan vs Reality** (ComposedChart: barre Planned + stack Actual/Unplanned per giorno/mese; vista Cumulative con due linee; reference line "oggi"; click su barra = drill sul giorno; twin table `sr-only`) → **Goal Performance** (bullet-bar per goal su scala comune, share of actual, trend vs precedente, task, chip stato; click = filtro globale) + **What changed** (insight) → **Project Scorecard** (tabella ordinabile: Planned/Actual/Variance/Done/Open/Carry/Last activity/Status; mobile = card; "Focus" = filtro globale) → **Consistency** (heatmap: week = 7 celle grandi con valore stampato, month = griglia calendario, year = contribution grid; metrica commutabile Actual / % of plan / Tasks; celle = bottoni con `aria-label` completa) → **Detailed Activity** (striscia Data Quality, blocco Carry-over, tabella ricercabile e paginata con provenienza Planned/Retro-logged/Session e time source measured/assumed).

File creati:

```
src/lib/performance/
  types.ts        (327)  contratto dati + Metric Glossary normativo
  period.ts       (179)  confini periodo, navigazione, confronto, DST-safe
  metrics.ts     (1077)  motore di aggregazione puro
  insights.ts     (339)  motore insight deterministico (12 regole, top 5)
  format.ts        (92)  "12h 30m", %, delta, label periodo
  period.test.ts  (142) · metrics.test.ts (762) · format.test.ts (93)

src/components/performance/
  PerformanceDashboard.tsx (372)  orchestratore, sessioni, stati
  PerfToolbar.tsx (196) · PerfKpiGrid.tsx (146) · PlanVsActualChart.tsx (363)
  GoalPerformancePanel.tsx (141) · ProjectScorecard.tsx (257)
  ConsistencyHeatmap.tsx (272) · InsightsPanel.tsx (97)
  ActivityDetailPanel.tsx (333) · theme.ts (84)
  PerformanceDashboard.test.tsx (312)
```

File modificati (11 righe totali): `MainApp.tsx` (+tab lazy `performance` con `Suspense`), `shell/SidebarNavigation.tsx` (+voce "Performance ⏱️ · Plan vs Actual OS" nel gruppo Intelligence). **Nessuna migrazione** (nessuno schema server; nessun campo nuovo richiesto).

## 8. Filtri e drill-down

Filtri (una riga sopra tutto, scoping globale di KPI, grafici, goal, project, heatmap, insight, dettaglio): **Goal** (incl. sentinel "Unassigned time"), **Project** (ristretto al goal selezionato; il cambio goal invalida il project), **Source** (Planned+unplanned / Planned only / Unplanned only — agisce sulle metriche temporali; i contatori task non hanno provenienza, documentato nel tooltip), **Reset**. Drill-down: click su goal row / project focus / barra del grafico / cella heatmap / insight → filtro o selezione giorno + scroll al dettaglio; chip del giorno rimovibile.

## 9. Insight engine deterministico

12 regole pure in `insights.ts`, ciascuna con id, condizione, soglia esportata come costante documentata, priorità, messaggio con i numeri che l'hanno generata e link al filtro corrispondente: `goal-under-plan`, `goal-idle`, `day-plan-missed`, `unplanned-heavy`, `low-coverage`, `project-inactive`, `carry-over-high`, `project-stalled`, `fulfillment-trend`, `goal-improved`, `consistency-trend`, `day-overload`, `concentration`. Pannello limitato ai **top 5** per priorità. Tono: fattuale, nessun messaggio motivazionale. Nessun LLM.

## 10. Empty / partial / error states

- **Periodo vuoto**: card dedicata che distingue "nessun piano e nessun tracking" da "i filtri non producono risultati", con CTA verso Time Planner / Today (via `onNavigate`) o reset filtri.
- **Solo piano** / **solo actual**: gestiti naturalmente (ratio 0% vs "No plan"/unplanned; mai piano inventato).
- **Periodo parziale**: badge "In progress", `activeDays/elapsedDays`, confronto clippato allo stesso span (etichettato "vs same elapsed span of previous period").
- **Loading**: skeleton a dimensioni stabili (nessun layout shift).
- **Errore sessioni**: banner con Retry, dashboard degradata ai soli blocchi (dichiarato).
- **Errore di calcolo**: card con reset non distruttivo; **errore dati globale**: card `role="alert"`.

## 11. Edge case coperti (test reali)

Periodo senza dati; `planned=0` (ratio null, mai ∞/NaN — asserzione ricorsiva `assertFiniteDeep` su tutto il DTO); actual>planned; task completato senza durata; session senza task (unclassified/Unassigned); blocco con task hard-deleted (missing parent + fallback); goal archiviato con storia; blocco cancellato/riprogrammato(=cancellato+ricreato); blocco a cavallo di mezzanotte (split per giorno); blocco a cavallo del confine periodo (clipping alla sola parte interna); session aperta (esclusa+contata); session+blocco stessa attività (no doppio conteggio); blocchi sovrapposti (documentato: no dedup); task completato fuori periodo ma dovuto nel periodo (carry-over `completed-late`/fulfillment); primo/ultimo giorno mese; settimana tra due mesi; anno bisestile (366/29); DST Europe/Rome marzo+ottobre 2025 (7 day-key unici, mezzanotte locale); periodo corrente parziale; filtri senza risultati; utente senza dati; **isolamento utente** (session di `user-b` iniettata dal mock → mai contata; query `getByIndex('sessions','userId', user-a)` verificata).

## 12. Comandi eseguiti e risultati REALI

| Comando | Risultato |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errori nei file nuovi/modificati (persistono 6 errori **pre-esistenti su main** in `WeeklyPlanningTab.test.tsx` e `draftStore.test.ts`, non toccati) |
| `npx vitest run src/lib/performance` | ✅ 59/59 |
| `npx vitest run src/components/performance` | ✅ 8/8 |
| `npm run test:run` (suite intera) | ✅ **37 file, 483/483 test passati** |
| `npm run lint` | ✅ exit 0 — zero warning nei file nuovi (i warning mostrati sono pre-esistenti in altri file) |
| `npm run build` | ✅ build di produzione completata; route `/` 265 kB First Load JS; dashboard in chunk lazy separato |
| `npx next start` + `curl` | ✅ HTTP 200, HTML servito con l'app |

Durante lo sviluppo i test hanno catturato e fatto correggere 2 bug reali (ordine giorno-mese nelle label del periodo; task completati conteggiati in "estimated-unscheduled") — valore dei test dimostrato.

## 13. Performance

- Nessun N+1: una sola query aggiuntiva (sessions) per mount; tutto il resto è già in memoria.
- Aggregazione O(n·giorniToccati) con bucket per giorno; ricalcolo `useMemo` solo su cambio dati/periodo/filtri.
- Recharts caricato solo nel chunk lazy della tab; animazioni disabilitate; tabella attività paginata (50/pagina); heatmap annuale = ~370 bottoni leggeri.
- Skeleton a dimensioni fisse → niente CLS; nessuna cache condivisa → nessun rischio di leakage cross-user.

## 14. Accessibilità

Grafico con `role="img"` + descrizione riassuntiva e **tabella twin `sr-only`** con tutti i valori; celle heatmap = `<button>` con `aria-label` completa e focus visibile; settimana con valori **stampati** nelle celle (non solo colore); stati con simbolo+testo; `aria-pressed`/`aria-sort`/`aria-current` sui controlli; tooltip che *arricchiscono e non vincolano* (ogni valore raggiungibile senza hover); `tabular-nums` nelle colonne numeriche; nomi utente-generati inseriti via testo React (mai innerHTML).

## 15. Limitazioni residue e miglioramenti futuri (non bloccanti)

1. **Dark mode**: l'app è light-only (nessun toggle né classi dark nel design system); la sezione segue il tema esistente. Se il progetto adotterà un dark mode, `theme.ts` è l'unico punto da estendere (rampa dark già indicata dalla skill dataviz).
2. **Stato in URL**: non implementato perché l'app non ha routing per tab; diventa naturale se/quando le tab diventeranno route.
3. **Riprogrammazioni**: lo schema non storicizza gli spostamenti dei blocchi → il carry-over distingue solo open/late/cancelled.
4. **Goal/Project soft-deleted con storia**: `DataProvider` non li espone → il loro tempo storico appare come "Unassigned" (contato in `blocksWithMissingParents`). Modifica minima futura: esporre anche le entità `deleted` in sola lettura per la risoluzione dei nomi.
5. **E2E browser**: il progetto non ha Playwright/Cypress; la verifica runtime si è fermata a component test con engine reale + build + server 200. Aggiungere Playwright con un utente guest sarebbe il passo successivo.
6. **"Oggi" statico nel render**: il flag `isToday` si aggiorna a ogni interazione/cambio dati, non con un timer a mezzanotte.

## 16. Conferme finali

- ✅ Nessun `git commit`, `git push`, deploy.
- ✅ Nessuna modifica a `.env*`, autenticazione, regole Firestore.
- ✅ Nessun dato eliminato, nessun reset DB, nessuna migrazione.
- ✅ Nessuna dipendenza aggiunta o aggiornata.
- ✅ Nessun dato demo hardcoded: ogni numero mostrato deriva dai record reali dell'utente autenticato; i dati sintetici esistono solo nei test.
- ✅ Funzionalità esistenti intatte (483/483 test, incluse tutte le suite pre-esistenti).
