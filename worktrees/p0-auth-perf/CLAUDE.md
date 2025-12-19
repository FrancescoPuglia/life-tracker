# Life Tracker — CLAUDE.md (Project Memory)

## North Star
Life Tracker è un "personal operating system" che converte:
- Goals/OKR → Projects → (Key Results opzionali)
- Pianificazione (Time Blocks) → Esecuzione reale (actual start/end) → Progress %
Obiettivo: UX **fast**, **pulita**, **misurabile**. Niente bug su percentuali, niente init infinito, niente UI "sporca" pre-login.

## HARD CONSTRAINTS (NON NEGOZIABILI)
1) **NO DATA LOSS**: non cancellare/modificare i contenuti degli obiettivi già scritti dall'utente.  
2) **NO FAKE UID / NO MAGIC USER-1**: guest deve avere un ID persistente stabile, logged usa `currentUser.uid`.  
3) **MIGRAZIONI NON DISTRUTTIVE**: se cambia IndexedDB schema/versione, upgrade only + backward compat.  
4) **INIT DETERMINISTICA**: nessun loop di init. Un solo run per cambio "auth mode" (guest→logged / logged→guest).  
5) **PERFORMANCE BUDGET (DEV)**:
   - Critical path (UI utilizzabile) target: ~< 1.5s su macchina normale
   - Nessun task secondario può bloccare il render iniziale
6) **TypeScript CLEAN + Build OK**: `npm run build` deve passare.
7) Claude Code environment:
   - Non usare `cd` fuori dalla root per policy; usare path assoluti o comandi con `--prefix`.
   - Commit piccoli e verificabili.

## Architettura (alto livello)
- Next.js app router.
- Auth: Firebase auth (logged mode).
- Storage:
  - Guest mode: IndexedDB (LifeTrackerDB + adapter)
  - Logged mode: Firebase/Firestore adapter (switch in runtime)
- UI principali:
  - Pre-login: deve mostrare SOLO schermata auth pulita (nessuna UI sottostante).
  - Post-login: Dashboard + OKR + Time Planner + moduli.

## Data model essenziale (minimo)
- Goal: id, userId, title, description, totalHoursTarget (se presente), status, priority, dates…
- Project: id, userId, goalId, plannedHours/target info, status…
- TimeBlock: id, userId, projectId (link), goalId (se usato), startTime, endTime,
  status: planned | in_progress | completed,
  actualStartTime?, actualEndTime?
IMPORTANT: startTime/endTime devono essere **DateTime completi** (ISO) quando salvati.

## Regole di Progress (Source of Truth)
- Goal %:
  - actualHours = somma ore di timeBlocks COMPLETED collegati ai project del goal
  - actualHours usa (actualStartTime/actualEndTime) se entrambi presenti, altrimenti fallback (startTime/endTime)
  - percent = min(actualHours / goal.totalHoursTarget * 100, 100) se target esiste
- Project %:
  - Se esiste target ore: actualHours/target
  - Altrimenti mostra ore completed vs ore planned (ma NON inventare percentuali)
- Vietato contare blocchi non completati nel "done".

## Regole Overdue (Source of Truth)
- Un blocco è overdue se:
  - endTime (DateTime) < now
  - status != completed
- MA: parsing dev'essere deterministico:
  - Se legacy HH:mm: convertire usando referenceDate (giorno del planner) senza timezone bugs.
  - Un solo helper condiviso per parsing e durations.

## Workflow obbligatorio per ogni fix
1) Riproduci (steps precisi)
2) Root cause (1-2 frasi)
3) Patch minima (diff localizzato)
4) Test:
   - npm run dev: nessun errore console
   - login: tempo e fluidità
   - OKR/progress: scenario minimo verificato
   - overdue: scenario minimo verificato
   - npm run build OK
5) Commit con messaggio chiaro + riepilogo con evidenze (log tempi + screenshot dove serve)

## Strumenti consigliati
- git worktrees per lavorare in parallelo su bug separati.
- Instrumentation: console.time/timeEnd e un PERF_SUMMARY unico per init.

## Definition of Done (DoD)
- Login screen pulita (solo auth card, background uniforme)
- Init senza loop e senza attese "assurde"
- Percentuali goal/project corrette e leggibili (zero overlap a ogni breakpoint)
- Overdue accurato (nessun overdue falso)
- Build OK

