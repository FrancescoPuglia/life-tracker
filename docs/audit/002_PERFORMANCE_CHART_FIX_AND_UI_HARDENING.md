# 002 — Performance Chart Fix & UI Hardening

**Data**: 2026-07-15
**Sezione**: Performance Review (tab `performance`)
**Riferimenti**: commit di partenza `84306ab feat(analytics): add performance plan vs actual dashboard`; report precedente `docs/audit/001_LIFE_TRACKER_ANALYTICS_OS.md`
**Vincoli rispettati**: nessun commit/push/deploy, nessuna modifica a `.env`, nessun reset/alterazione dei dati utente, nessuna funzionalità rimossa, nessuna dipendenza aggiunta.

---

## 1. Executive Summary

Il grafico principale **Plan vs Reality era completamente vuoto in ogni browser reale** (dev server e deploy GitHub Pages) pur ricevendo dati corretti: la causa non era nei dati né nel CSS, ma in un'**incompatibilità di runtime fra Next 15 App Router e Recharts 2.15**. Next esegue la propria copia vendored di **React 19 canary** (ignorando il `react@18` del package.json); Recharts individua i propri figli (`<Bar>`, `<Line>`) scandendo i children e appiattendo i Fragment con `isFragment()` di `react-is` ≤ 18, che **non riconosce gli elementi React 19** (`$$typeof = Symbol.for('react.transitional.element')` vs `'react.element'`). I `<Bar>/<Line>` del componente erano avvolti in Fragment (`<>…</>`) dentro il ternario Daily/Cumulative → Recharts non li trovava → nessuna barra, nessun dominio Y (quindi niente tick, gridline, tooltip), mentre asse X e ReferenceLine (figli diretti) funzionavano. Nei test vitest il bug non si manifestava perché lì risolvono `react-is@18` + `react@18` reali: per questo la suite era verde e il deploy rotto.

Correzione alla radice: **le serie sono ora figli condizionali diretti del chart** (`{mode === 'buckets' && <Bar/>}`), pattern immune da `isFragment`. Verificato in Chromium reale: barre, assi, tooltip, Daily/Cumulative, Week/Month/Year, filtri, resize — tutto funzionante, 0 errori console.

Nella stessa passata: **bug dimostrato e corretto su "Planned Tasks Done"** (i task completati dall'OKR manager non scrivevano mai `completedAt` → nessun completamento risultava alle analytics), **semantica status rifondata sul piano maturato a oggi** (un mese in corso non marca più "Behind" tutto ciò che ha piano futuro; nuovo stato "Not due yet"), **hardening UX** di KPI/Goal/Insights, e **due bug di layout reali trovati in browser**: la tabella `sr-only` del grafico che causava scroll orizzontale su mobile e una regola globale `.grid-cols-7 > div { min-height: 480px }` che gonfiava la heatmap Consistency a ~3000px. Aggiornati i workflow GitHub Actions ai major `node24` verificati sugli `action.yml` ufficiali.

**Verdetto: PASS** (§23).

## 2. Problema riprodotto

Riproduzione oggettiva, non presunta:

1. **Harness temporanea** `src/app/dev-chart-repro/page.tsx` (eliminata a fine lavoro): montava il VERO `PlanVsActualChart` con punti generati dal VERO engine (`computePerformanceOverview`) su un dataset July 2026 analogo all'incidente (Actual ~36h, Planned ~79h, unplanned, giorni futuri).
2. **Chromium headless (Playwright)** su `next dev`: ispezione DOM del chart.

Risultato pre-fix nel browser (stessi dati con cui vitest disegnava 33 barre):

```
barPaths: 0, barLayers: 0, yTicks: [], gridLines: 2 (solo bordi), xTicks: 11, refLines: 1
```

Identico allo screenshot dell'incidente: asse X, legenda, toggle e linea "today" presenti; barre, scala Y e tooltip assenti.

## 3. Causa esatta del grafico vuoto

Catena verificata pezzo per pezzo:

1. Il chunk servito dal bundler contiene `next/dist/compiled/react` con `REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element")` → **in App Router il runtime è la copia vendored di React 19 canary**, non il react@18 dichiarato.
2. Recharts 2.15.4 (`ReactUtils.toArray`) appiattisce i Fragment solo se `isFragment(child)` è true; `react-is` risolto nel bundle è ≤ 18 e confronta con `Symbol.for('react.element')` → sugli elementi React 19 restituisce **false** (verificato in Node: `compiled(19) isFragment: false`, `nested(18.3.1): true`).
3. In `PlanVsActualChart` i tre `<Bar>` e le due `<Line>` erano dentro `{mode === 'buckets' ? (<>…</>) : (<>…</>)}` → `findAllByType(children, Bar|Line)` non trovava nulla → `formattedGraphicalItems` vuoto → **nessuna serie renderizzata, nessun dato per il dominio Y** (niente tick/gridline), **nessun payload per il Tooltip**.
4. XAxis/YAxis/Tooltip/ReferenceLine sono figli diretti → l'asse X categorico (basato sul prop `data`) e la linea today continuavano a funzionare: esattamente i sintomi osservati.
5. In vitest/jsdom `react-is` e `react` risolvono alle versioni 18 reali → fragment riconosciuti → barre disegnate → la suite non poteva intercettare il bug. Unico altro chart con questo pattern nel repo: nessuno (`AnalyticsDashboard` non usa fragment nei chart, per questo le altre tab funzionano).

## 4. Dati reali ricevuti dal componente

Il DTO era **sano**: `overview.timeSeries` (ispezionato via harness e coperto dai test engine) contiene 31 `PerformanceTimePoint` con `plannedMinutes/actualMinutes/unplannedMinutes/cumulative*` **interi finiti** (mai NaN/Infinity/stringhe/undefined), ordinati per data, chiavi `YYYY-MM-DD` corrette, `isToday` sul 14, `isFuture` dal 15 in poi. KPI e grafico leggono la stessa aggregazione (`aggregateWindow`) — la discrepanza era esclusivamente nel layer di rendering Recharts.

## 5. Correzione implementata

`src/components/performance/PlanVsActualChart.tsx`:

- **Fragment eliminati dai children del chart**: ogni `<Bar>`/`<Line>` è un figlio condizionale diretto (`{mode === 'buckets' && <Bar …/>}` ×3, `{mode === 'cumulative' && <Line …/>}` ×2), con commento che documenta il vincolo (i booleani sono scartati da `React.Children`, versione-indipendente).
- **Guardia sui non-finiti al confine UI**: nel `useMemo` dei dati ogni campo numerico passa da `Number.isFinite(v) ? v : 0` — un singolo NaN avvelenava l'intera scala Y.
- **Fix overflow mobile**: la twin table accessibile è ora dentro `<div className="sr-only">` — una `<table>` stilata `sr-only` direttamente mantiene la larghezza del contenuto (`display:table` tratta `width` come minimo) e allargava il documento a 572px su viewport 390px (bug presente anche in produzione).

Nessuna nuova libreria; nessuna tabella al posto del grafico.

## 6. Test di regressione aggiunti (grafico)

Nuovo `src/components/performance/PlanVsActualChart.test.tsx` (14 test): rende il chart REALE dando a `ResponsiveContainer` una dimensione concreta (stub di `getBoundingClientRect` 900×280) con punti dal VERO engine, e verifica **primitive grafiche con geometrie valide** (path con `width/height > 0`, niente `NaN`/`Infinity` nel `d`, fill presenti — mai solo titolo/assi):

1. mese con dati → barre visibili nei 3 layer (planned / actual-planned / unplanned);
2. asse Y numerico con tick finiti;
3. serie distinte (3 layer per stack);
4. scala con Planned ≫ Actual (forma dell'incidente) — altezze realmente proporzionali;
5. scala con Actual ≫ Planned;
6. giorni a zero e buchi nel mese;
7. periodo completamente vuoto → empty state, non chart bianco;
8. un solo giorno con dati;
9. valori molto grandi (10×24h) senza NaN;
10. Daily → Cumulative → Daily (2 linee con path validi, poi di nuovo barre);
11. Week e Year (bucket mensili, label "Monthly");
12. aggiornamento su cambio del prop `points` (rerender);
13. input corrotti (NaN/Infinity/undefined) → sanitizzati, mai geometrie NaN;
14. copertura del punto 13 anche sull'asse Y.

I test 1–2 e 13 **fallivano** sull'implementazione difettosa in ambiente browser; in jsdom fotografano il contratto (nota documentata nel file: jsdom non misura il testo, quindi i tick Y possono collassare a 1 — 0 tick resta il segnale di bug). Nota su §6.14 del brief ("container nascosto→visibile"): non riproducibile fedelmente in jsdom (la misura è stubbata); coperto dalla verifica browser reale con resize (§13).

## 7. Verifica "Planned Tasks Done" (0/19)

**Bug dimostrabile trovato** (non era un dato "giusto ma basso"):

- `OKRManager.handleToggleTaskComplete` completa i task con `{ status: 'completed', updatedAt }` **senza mai scrivere `completedAt`**; `DataProvider.updateTask` faceva merge passivo. L'engine (da glossario) riconosce un completamento **solo** via `completedAt` → ogni task completato dall'UI principale restava per sempre "non fatto" per la dashboard → 0/19 strutturale (e `completedTasksInPeriod`, on-time rate, active days da task tutti sottostimati).
- Definizione di "planned task" (dueDate nel periodo ∪ task linkati da blocchi pianificati) verificata e invariata; nessuna confusione planned/completed-in-period; ricorrenze non modellate dallo schema (nessuna regressione possibile).

Correzioni:

1. **Write-side (radice)** — `DataProvider.updateTask` ora possiede l'integrità del timestamp per ogni caller: transizione a `completed` senza `completedAt` esplicito → backfill `new Date()`; transizione da `completed` ad altro stato → azzeramento con `null` (necessario su Firestore: gli `undefined` vengono strippati da `sanitizeForStorage` e `updateDoc` lascerebbe il vecchio valore).
2. **Read-side (dati storici)** — `metrics.ts`: le righe legacy con `status === 'completed'` e `completedAt` assente usano `updatedAt` come approssimazione documentata (glossario aggiornato in `types.ts`).

Test di regressione: 3 in `metrics.test.ts` (fallback conteggiato, task aperti mai conteggiati, completamento legacy fuori periodo non attribuito al periodo) + 4 in `DataProvider.test.tsx` con provider montato e db mockato (backfill, azzeramento a `null`, `completedAt` esplicito rispettato, ri-completamento che preserva il timestamp originale).

## 8. Status Goal/Project ("tutto Behind")

Il vecchio `entityStatus` confrontava l'actual con il **piano dell'intero periodo**: a metà mese qualunque goal con piano futuro risultava "Behind" — semanticamente falso. Nuova formula (documentata su `EntityStatus` in `types.ts` e in `entityStatus()`):

- riferimento = **piano maturato fino a oggi** (`plannedElapsed`, nuovo accumulo clippato a `min(now, fine periodo)`) per i periodi in corso; per i periodi chiusi coincide col piano pieno (elapsed == full);
- `ahead` ratio ≥ 1.15 · `on-track` in banda · `behind` ratio < 0.85 → **"behind as of today"**;
- **nuovo stato `not-due`** ("Not due yet"): piano esistente ma interamente futuro — prima era "Behind";
- `no-plan` (esecuzione senza piano), `inactive` (progetti fermi 14+ giorni con task aperti), `no-data` invariati; esecuzione prima che maturi piano → `ahead`.

Esteso il contratto dati: `plannedElapsedMinutes` su summary/goal/project e `executionRatioToDate` sul summary (per non duplicare formule nella UI). Chip con tooltip esplicativo (`describeStatus` in `theme.ts`) che riporta i numeri della valutazione ("Behind as of today: 3h done vs 9h planned so far…"). Test: 4 nuovi in `metrics.test.ts` (not-due mai behind con piano futuro; giudizio sul maturato con piano futuro ignorato; ahead senza piano maturato; periodo chiuso giudicato sul piano pieno). La verifica browser mostra ora status misti: On track / Behind / Not due yet.

## 9. Miglioramenti KPI

`PerfKpiGrid`: griglia **4+3** su desktop (`grid-cols-2 sm:grid-cols-3 xl:grid-cols-4`) al posto di 7 colonne compresse; tile a altezza uniforme (`h-full flex flex-col`, sub-line ancorata in basso con `mt-auto`); valori e delta `tabular-nums`; sub-label brevi ("vs prev period to date") con la spiegazione integrale nel tooltip `title` di ogni tile (formula + metodo di confronto); "Plan vs actual" mostra anche **"NN% of plan to date"** (da `executionRatioToDate`) quando il periodo è in corso — distingue esplicitamente il full-period dal maturato.

## 10. Miglioramenti Goal Performance

- nome goal troncato con **tooltip col nome completo**;
- chip status con tooltip formula/numeri (§8);
- blocco numerico allineato (`ml-auto`, variance a larghezza fissa `w-16`, `tabular-nums`, tooltip "Actual / Planned" e "Variance");
- riga a `flex-wrap`: su mobile i numeri scendono sotto il nome senza tagli;
- bullet bar: **larghezza minima 4px** per valori piccoli ma reali (prima invisibili), track planned a opacità ridotta, e **notch scuro al punto del piano maturato a oggi** — si vede a colpo d'occhio se il blu (actual) è dietro o davanti al "dovuto a oggi".

## 11. Miglioramenti Insights

Engine: `MAX_INSIGHTS` 5 → 8 (il ranking per priorità resta; test aggiornato alla costante). Pannello: **4 insight iniziali + "Show N more"/"Show fewer"** (`data-testid="insights-toggle"`); titolo e descrizione con `line-clamp-2` + `title` integrale (i nomi progetto chilometrici non dominano più la card); la regola `project-inactive` già limitava l'elenco a 3 nomi + ellissi.

## 12. Verifica responsive

Larghezze verificate in Chromium: **1440, 1024, 768, 390**. A 390px trovato e corretto l'overflow orizzontale (tabella `sr-only`, §5): ora `scrollWidth == clientWidth` a tutte le larghezze (`overflowX: false` in ogni scenario). KPI 2 colonne su mobile, 3 su tablet, 4 su desktop; righe goal con wrapping pulito; scorecard in card sotto `sm`.

Secondo bug reale trovato guardando la pagina intera: la **heatmap Consistency month era alta ~3030px** — `globals.css` contiene `.grid-cols-7 > div { contain: layout; min-height: 480px }` (patch storica per il Time Planner) che sequestra l'utility Tailwind `grid-cols-7` in tutta l'app. Fix locale e senza rischi per le altre tab: la heatmap usa `grid-cols-[repeat(7,minmax(0,1fr))]` (stesso layout, selettore diverso) → sezione da 3030px a 382px, celle 36px come da design.

## 13. Verifica browser (reale, non stimata)

Chromium headless via Playwright su `next dev` (porta 3000), harness full-dashboard con dataset July 2026 (6 goal, 7 project, 19 task pianificati di cui 2 completati "legacy" e 2 con timestamp, retro-logged, session orfana, piano futuro). Scenari eseguiti e risultato finale:

| Scenario | Esito |
|---|---|
| Month/Daily @ 1440·1024·768·390 | 33/33 barre visibili, 5 tick Y, 5 gridline, 0 overflow |
| Cumulative | 2 linee, path senza NaN, dominio 0→100h, barre a 0 |
| Daily ⇄ Cumulative ⇄ Daily | nessun grafico vuoto/stantio, barre ripristinate |
| Week | 6 barre, 7 tick X |
| Year (Monthly) | 3 barre (unico mese con dati), 12 tick X |
| Periodo precedente (June, vuoto) | empty state corretto, nessun asse rotto |
| Filtro Goal (click su riga) | grafico rifiltrato (15 barre), KPI 2/7, scorecard scopata |
| Selezione giorno da barra | funzionante, nessuna regressione |
| Resize 1440→900→1440 | 33 barre ricalcolate correttamente |
| Insights toggle | 4 → 8 → 4 |
| Tooltip Daily / Cumulative (hover) | contenuti corretti ("3h planned · 2h 30m actual · Variance −30m") |
| KPI Planned tasks done | **4/19 (21%)** — fallback legacy operativo |
| Status goal | misti: On track / Behind / Not due yet |

Screenshot prima/dopo salvati **solo in locale** (scratchpad di sessione), non nel repository, senza dati personali. Nota: verifica condotta su `next dev` — lo stesso ambiente bundler in cui il bug era riprodotto (la causa è nel runtime React vendored, identico in build); l'export statico GH Pages non è stato ricostruito in locale (§22).

## 14. Errori console

**Zero** errori e zero warning React nella verifica finale (tutti gli scenari sopra). L'unico messaggio emerso durante il lavoro era un hydration-mismatch causato dagli id non deterministici della **harness** (corretto nella harness stessa, poi eliminata col file).

## 15. Audit GitHub Actions

Warning "runtime node20 forzato su node24" — causa: tag major che dichiarano `runs.using: node20`. Verifica fatta **sugli `action.yml` ufficiali dei tag** (raw.githubusercontent) e sulle release page; aggiornati in `.github/workflows/deploy.yml` ai major minimi che dichiarano `node24`:

| Action | Prima | Dopo | Verifica |
|---|---|---|---|
| actions/checkout | v4 | **v5** | action.yml v5: `using: node24` |
| actions/setup-node | v4 | **v5** | action.yml v5: `using: node24` |
| actions/upload-pages-artifact | v3 | **v5** | composite; v3 interno usa upload-artifact v4 (`node20`), v5 pin upload-artifact **v7.0.0** (`node24`) |
| actions/deploy-pages | v4 | **v5** | action.yml v5: `using: node24` |

Inoltre `node-version: '20' → '22'`: Node 20 è EOL da aprile 2026; il progetto è sviluppato e buildato localmente su Node 22 (build verde in §21 eseguita proprio su 22.22.0). Nessuna action ridondante; permessi e struttura Pages invariati e compatibili (upload v5 + deploy v5 sono la coppia corrente). Non testabile in CI da locale (niente push per vincolo): da osservare al primo deploy.

## 16. File creati

- `src/components/performance/PlanVsActualChart.test.tsx` — 14 test di regressione del grafico
- `docs/audit/002_PERFORMANCE_CHART_FIX_AND_UI_HARDENING.md` — questo report

(Harness temporanea `src/app/dev-chart-repro/` creata per riproduzione/verifica e **rimossa**.)

## 17. File modificati

1. `src/components/performance/PlanVsActualChart.tsx` — fix P0 (figli diretti), sanitizzazione non-finiti, wrap sr-only
2. `src/components/performance/PerfKpiGrid.tsx` — griglia 4+3, tile uniformi, tooltip, ratio to date
3. `src/components/performance/GoalPerformancePanel.tsx` — tooltip nome/status/valori, min-width barre, notch piano maturato, wrap mobile
4. `src/components/performance/InsightsPanel.tsx` — 4 + "Show more", line-clamp, tooltip
5. `src/components/performance/ProjectScorecard.tsx` — tooltip status (tabella + card mobile)
6. `src/components/performance/ConsistencyHeatmap.tsx` — immunizzazione dalla regola globale `.grid-cols-7`
7. `src/components/performance/theme.ts` — `STATUS_META['not-due']`, `describeStatus()`
8. `src/lib/performance/types.ts` — `EntityStatus` documentato + `not-due`; `plannedElapsedMinutes`, `executionRatioToDate`; glossario completamenti legacy
9. `src/lib/performance/metrics.ts` — accumulo `plannedElapsed`, `entityStatus` su piano maturato, fallback `completedAt`
10. `src/lib/performance/insights.ts` — `MAX_INSIGHTS = 8`
11. `src/lib/performance/metrics.test.ts` — +7 test (status, completamenti legacy), 1 aggiornato alla costante
12. `src/providers/DataProvider.tsx` — integrità `completedAt` in `updateTask`
13. `src/providers/DataProvider.test.tsx` — harness provider montato + 4 test `completedAt`
14. `.github/workflows/deploy.yml` — §15

## 18. Comandi eseguiti (principali)

```
git rev-parse --show-toplevel · git status --short · git branch --show-current · git log -3 --oneline
npx vitest run src/components/performance/PlanVsActualChart.test.tsx   (pre-fix: 2 fail in browser-contract, post-fix: 14 pass)
npx vitest run src/lib/performance/ · src/providers/DataProvider.test.tsx
npm run dev  + Playwright/Chromium headless (riproduzione, ispezione DOM, screenshot 1440/1024/768/390, interazioni)
node …/validate action.yml (curl raw.githubusercontent per i runtime delle Actions)
npm run test:run · npm run lint · npm run build
```

## 19. Risultati test

- Suite completa `npm run test:run`: **38 file, 508 test, 508 passed** (verde; include i 25 test nuovi/aggiornati di questa sessione: 14 chart + 7 metrics + 4 DataProvider).
- Il run intermedio aveva evidenziato 1 fail atteso: il vecchio test fotografava il cap a 5 insight, aggiornato al nuovo contratto (`MAX_INSIGHTS`).

## 20. Risultato lint

`npm run lint`: **exit 0**. 7 warning, tutti **pre-esistenti** e in file non toccati da questo lavoro (RichNoteEditor, SlashCommandMenu, AuthProvider, 3 hook-deps storici di DataProvider in funzioni non modificate). Zero warning nei file di §16–17.

## 21. Risultato build

`npm run build` (Node 22.22.0): **compilazione riuscita, exit 0** — vedi coda del log nel task di build; nessun errore TypeScript (strict del progetto invariato), nessun errore di route.

## 22. Limitazioni residue

1. **Regola globale `.grid-cols-7 > div { min-height: 480px }`** ancora in `globals.css`: continua a colpire `KPIDashboard`, `EventsCalendar`, `DraftWeekCalendar` (fuori dal perimetro di questo intervento). La heatmap Performance è immunizzata localmente; consiglio un follow-up che scopi la regola al solo Time Planner.
2. La verifica browser è su `next dev`; l'export statico GitHub Pages non è stato ricostruito/servito in locale. Il meccanismo del bug (React vendored di Next) è identico nei due modi ed è stato riprodotto e risolto nello stesso ambiente, ma la conferma finale sul deploy avverrà al prossimo push.
3. Il fallback `updatedAt` per i completamenti legacy è un'approssimazione dichiarata (un edit successivo sposterebbe la data); i dati nuovi hanno il timestamp esatto dal write-side.
4. I nuovi tag delle GitHub Actions sono verificati sui metadata ufficiali ma non ancora eseguiti in CI (vincolo no-push).
5. jsdom non misura il testo: l'asserzione sul numero di tick Y nei test è ≥ 1 (0 = bug); il conteggio pieno (5) è verificato in browser.
6. Il warning Browserslist ("caniuse-lite is 9 months old") è pre-esistente e non toccato.

## 23. Conferma vincoli e verdetto

Confermo: **nessun commit, nessun push, nessun deploy, nessuna modifica a `.env*`, nessun reset/migrazione/alterazione del database o dei dati utente**; guest mode IndexedDB e Firebase mode intatti (le modifiche a `DataProvider.updateTask` sono additive e passano dagli adapter esistenti); nessuna funzionalità rimossa; nessun `console.log` o codice temporaneo residuo (harness eliminata); nessun test disabilitato; copertura aumentata (+25 test).

Il grafico Plan vs Reality **mostra barre reali nel browser** (33/33 visibili con geometrie finite a tutte le larghezze, tooltip e cumulate funzionanti, 0 errori console).

# VERDETTO: **PASS**
