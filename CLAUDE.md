# Life Tracker — Project Operating Manual (CLAUDE.md)

## North Star
Life Tracker misura il progresso in modo GOAL-centrico:
Goals → Projects → Tasks → TimeBlocks (tempo investito).
La metrica primaria è: ORE REALI FATTE (actual), non ore pianificate.

## Tech
- Next.js 15 (App Router) + TypeScript
- Tailwind CSS
- Data layer: src/lib/database.ts (LifeTrackerDB) con adapters:
  - Firebase (logged)
  - IndexedDB (guest)
  - (eventuale memory)

## HARD RULES (non negoziabili)
1) MAI introdurre fallback user finti (es: "user-1").
   - Logged: userId = currentUser.uid
   - Guest: userId = guestId stabile (localStorage o helper esistente)
2) MAI modificare/sovrascrivere dati già salvati (Goals/Projects/Tasks/TimeBlocks).
   - Ogni change di schema deve essere backward-compatible.
3) Niente wipe automatici del DB.
   - Reset IndexedDB SOLO tramite UI di recovery e SOLO guest.
4) Init deterministica: niente loop useEffect.
5) build sempre verde: `npm run build` deve passare.

## Progress Rules (definizione ufficiale)
### Actual hours (contano per %)
Somma delle durate dei TimeBlocks con:
- status === 'completed'
- durata = (actualEndTime - actualStartTime) se esiste,
  altrimenti (endTime - startTime)

### Target hours (denominatore per %)
- Task target: preferibilmente `estimatedMinutes`/`durationMinutes`/campo equivalente -> ore target task
- Project target: somma target dei task (se ci sono), altrimenti campo target project (se esiste)
- Goal target: somma target dei project (se ci sono), altrimenti campo target goal

### Rollup gerarchico
Un’ora completata su un TimeBlock linkato ad un Task:
- incrementa Task actual
- incrementa Project actual
- incrementa Goal actual

Se un TimeBlock è linkato solo a Project (taskId assente):
- incrementa Project actual
- incrementa Goal actual
- Task non cambia

## TimeBlock Lifecycle (obbligatorio)
- planned → in_progress → completed (o skipped/missed)
- Deve esistere sempre un’azione UI per:
  - Complete (set status completed + actual times se mancanti)
  - Delete (rimuove il timeBlock)
- Overdue: SOLO se endTime < now e status != completed.
  Non deve impedire completamento o delete.

## Auth UX rule
Prima del login NON deve essere montata l’UI dell’app sotto.
Serve un AuthGate che renderizza SOLO una schermata pulita (sfondo uniforme scuro + card login).

## Test Checklist (Definition of Done)
- Login: UI app non visibile sotto l’Auth screen
- Init: perceived < 2s in dev (sblocca UI dopo essential data)
- TimeBlock: posso creare + completare + cancellare un blocco
- Rollup: completare 1h su un task -> task/progetto/goal aumentano e % cambia
- Overdue: tooltip coerente, non “false overdue”
- Habits: click sul pallino crea/toglie log di oggi e aggiorna counters
- `npm run build` OK
