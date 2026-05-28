# Discovery Report — Life Tracker Weekly Planning Intelligence

> **Scope**: Prompt 1/5. **Read-only**. No application code modified, no
> dependencies added, no migrations, no AI introduced.
> Repo HEAD: `ce80e21` on `main`.
> Generated: 2026-05-28.

---

## 1. Executive Summary

Life Tracker is a Next.js 15 / App Router single-page application backed by a
single `LifeTrackerDB` (`src/lib/database.ts:1204`) that switches between three
storage adapters (`MemoryAdapter`, `IndexedDBAdapter`, `FirebaseAdapter`).
Global state is held in two React Context providers — `AuthProvider`
(`src/providers/AuthProvider.tsx`) and `DataProvider`
(`src/providers/DataProvider.tsx`, 1290 lines) — and the entire app is one
page (`src/app/page.tsx`) rendering a tabbed `MainApp` shell. Domain types
(Goal/Project/Task/TimeBlock/Habit/Note/…) all live in
`src/types/index.ts:1`.

`createTimeBlock` already enforces the "must link to at least one of
Task/Project/Goal" invariant (`src/providers/DataProvider.tsx:391-395`) and
fans completion changes into the rollup engine
(`src/lib/hierarchicalRollup.ts`). Two deterministic engines already exist
that we can study but should NOT reuse blindly: `SuperSmartAutoScheduler`
(`src/lib/autoScheduler.ts:39`) and `SmartGoalToPlanEngine`
(`src/lib/goalToPlanEngine.ts:16`). OpenAI is imported in `src/lib/ai/*` and
`src/lib/voice/*` only — the rest of the codebase is deterministic.

**Status of the toolchain (verified by running them):**
- `npm run build` → ✅ exit 0 (Next.js static export, 9 pages, ~266 kB First Load JS on `/`).
- `npm run lint` → ✅ exit 0 (warnings only: react-hooks/exhaustive-deps, no-unescaped-entities, no-img-element). Zero errors.
- `npm run test:run` → ⚠ 27 passed / 2 failed. Both failures are in `src/app/api/ai/chat/route.test.ts` (test expects English "required fields" but the route returns the Italian string "Campi obbligatori mancanti"). Unrelated to TimeBlock / planning logic. **Not blocking** for the new feature, but should be flagged.

**Fattibilità**: HIGH. All the primitives needed for the Weekly Planning
Intelligence feature already exist (typed entities, TimeBlock CRUD, rollup,
DB adapters, calendar UI patterns).

**Rischio principale**: the codebase has _no_ "draft" concept — TimeBlocks
are always real, persisted entities that immediately trigger KPI/rollup
recomputation. We must keep planning bozze entirely off this hot path.

**Raccomandazione**: **GO with risks**. Proceed to Prompt 2 with a brand-new,
isolated module (`src/lib/weeklyPlanner/` for the deterministic core,
`src/components/WeeklyPlanning/` for UI). Do not modify
`DataProvider.tsx`, `database.ts`, `types/index.ts`, or
`hierarchicalRollup.ts` in Prompts 2–3.

---

## 2. Current Architecture Map

| Layer | What | Files |
|---|---|---|
| Framework | Next.js 15.5.6 App Router, React 18, TS 5 | `package.json`, `next.config.js` |
| Routing | Single page + API routes | `src/app/page.tsx`, `src/app/api/{ai,notion,voice}/*` |
| State | React Context, two providers | `src/providers/AuthProvider.tsx`, `src/providers/DataProvider.tsx` |
| Persistence | Adapter pattern over IndexedDB / Firestore / in-memory | `src/lib/database.ts` (2311 lines), `src/lib/firebaseAdapter.ts` (518 lines) |
| Auth | Firebase Auth (email + Google) | `src/lib/auth.ts`, `src/lib/firebase.ts`, `src/config/firebaseConfig.ts` |
| Domain types | All centralized | `src/types/index.ts` (653 lines), `src/types/blocks.ts`, `src/types/ai-enhanced.ts` |
| UI | Tailwind, single tabbed shell | `src/components/MainApp.tsx` (14 tabs) |
| Testing | Vitest + jsdom + Testing Library | `vitest.config.ts`, `src/test/setup.ts`, 5 `*.test.ts(x)` files |
| Path alias | `@/*` → `src/*` | `tsconfig.json:18` |
| TS strictness | `strict: false`, `allowJs: true` | `tsconfig.json:5` — relevant for the "no `any`" rule of the new feature: we must self-impose it, the compiler will not. |

**Tabs in `MainApp.tsx:49`:** `'planner' | 'smart_scheduler' | 'adaptation' | 'micro_coach' | 'habits' | 'okr' | 'analytics' | 'goal_analytics' | 'badges' | 'vision-board' | 'notes' | 'events' | 'weekly' | 'voice'`. A new `'weekly_intel'` tab is the natural insertion point.

**Auth/Data gating** (`src/app/page.tsx:41-88`): `AuthGate → DataGate → DataLoadingGate → MainApp`. The gate **requires** a Firebase user — there is no UI path for the "guest" mode described in `CLAUDE.md`, even though the data layer supports it (see §5).

---

## 3. Domain Model Inventory

All entities below are defined in `src/types/index.ts`. All extend `BaseEntity` (`id`, `userId`, `domainId`, `createdAt`, `updatedAt`, optional `deleted`).

### Goal — `src/types/index.ts:63-91`
- **Key fields**: `title`, `description?`, `status` (`active|completed|paused|at_risk|archived`), `priority`, `targetDate`, `targetHours?`, `timeAllocationTarget` (hours/week), `keyResults[]`, `category`, `complexity`, `estimatedHours?`, `actualMinutes?`, `actualHours?`.
- **Relations**: 1—N → `Project` (via `Project.goalId`); 1—N → `KeyResult`.
- **CRUD**: `createGoal` / `updateGoal` / `deleteGoal` in `DataProvider.tsx:666-…`.
- **Risks**: `targetHours` is optional; mapping must tolerate undefined.

### Project — `src/types/index.ts:109-128`
- **Key fields**: `name`, `goalId` (**required**), `domainId` (**required**), `status`, `priority`, `dueDate?`, `weeklyHoursTarget?`, `totalHoursTarget?`, `actualMinutes?`, `actualHours?`.
- **Relations**: child of Goal; 1—N → `Task`.
- **CRUD**: `createProject` / `updateProject` / `deleteProject` in `DataProvider.tsx:810-…`.

### Task — `src/types/index.ts:130-156`
- **Key fields**: `title`, `projectId` (**required**), `goalId?`, `goalIds?`, `domainId`, `status` (`pending|in_progress|completed|blocked|cancelled|todo`), `priority`, `estimatedMinutes` (**required**), `actualMinutes?`, `actualHours?`, `dueDate?`, `ifThenPlan?`, `why?`.
- **Relations**: child of Project; optional explicit `goalId`/`goalIds`.
- **CRUD**: `createTask` / `updateTask` / `deleteTask` in `DataProvider.tsx:890-…`.
- **Risks**: legacy data may have `estimatedMinutes === 0`; the mapper must treat that as "unknown" not "zero".

### TimeBlock — `src/types/index.ts:162-204`
- **Key fields**: `title`, `startTime`, `endTime`, `actualStartTime?`, `actualEndTime?`, `status` (`planned|in_progress|completed|cancelled|overrun`), `type` (`work|break|buffer|travel|meeting|focus|admin|deep|shallow`), `taskId?` / `taskIds?`, `projectId?`, `goalId?` / `goalIds?`, `goalAllocation?`, `expectedImpact?`, `color?`, `location?`, `notes?`.
- **Hard invariant** (`DataProvider.tsx:391-395`): a TimeBlock MUST be linked to at least one of `taskId | projectId | goalId`. The future commit step must obey this — every draft block we materialize must already carry one of those IDs.
- **CRUD**: `createTimeBlock` / `updateTimeBlock` / `deleteTimeBlock` in `DataProvider.tsx:372-…`.

### Habit / HabitLog — `src/types/index.ts:243-269`
- **Key fields**: `Habit { name, frequency: 'daily'|'weekly'|'monthly', targetValue?, isActive, streakCount, bestStreak }`; `HabitLog { habitId, date, completed, value? }`.
- **No native day-of-week mask, no per-habit time-of-day** — frequencies are coarse. Routines like "palestra 4x/settimana" or "studio Catalana lunedì" cannot be expressed as a `Habit` today.
- **CRUD**: `createHabit` / `updateHabit` / `deleteHabit` / `logHabit` in `DataProvider.tsx:209-212`.
- **Risk**: do not co-opt the Habit model for routine scheduling — that would silently change semantics and break the streak counter. Routines stay in the planner's own state.

### Review / Analytics — `src/types/index.ts:493-532`
- **AnalyticsData**: includes `planVsActual`, `activityRankings`, `weeklyReview { highlights, challenges, insights, nextWeekGoals }`.
- **No persisted `WeeklyReview` entity** — analytics are derived on demand.
- Relevant for Prompt 5 (loop back into review).

### Other entities (used by the app, **must not be touched**)
- `Note`, `NoteTemplate`, `GoalRoadmap`, `GoalMilestone`, `VisionBoard`, `VisionItem`, `MediaAsset`, `ImportantEvent`, `Session`, `Insight`, `Achievement`, `KPI`, `Deadline`, `CalendarEvent` — all defined in `src/types/index.ts`.

---

## 4. TimeBlock Creation Flow

**Today, a TimeBlock is born from `useDataContext().createTimeBlock(data)`** (`src/providers/DataProvider.tsx:372-449`). The flow is:

1. Caller supplies `Partial<TimeBlock>`; the provider:
   - parses dates via `toDateSafe` with today's date as fallback,
   - generates id via `generateId('timeblock')`,
   - injects `userId` from the provider (the closed-over `userId` prop, ultimately `currentUser.uid` from `AuthProvider`),
   - defaults `domainId` to `'domain-1'`,
   - normalizes `status` to a valid `TimeBlockStatus` (`normalizeTimeBlockStatus`, `DataProvider.tsx:29`),
   - validates link to ≥1 of `taskId|projectId|goalId` (`DataProvider.tsx:391-395`) — throws otherwise.
2. Optimistic state update (`setTimeBlocks(prev => [...prev, block])`).
3. Persistence: `await db.create<TimeBlock>('timeBlocks', block)`.
4. `await refreshKPIs()`.
5. On failure: rollback by filter.

**On `updateTimeBlock`** (`DataProvider.tsx:451-…`):
- If status transitions to `'completed'`, calls
  `rollupForCompletedTimeBlock(userId, id)` from `src/lib/hierarchicalRollup.ts:177`, which propagates actual hours up to Task/Project/Goal.
- If status transitions away from `'completed'`, falls back to `performHierarchicalRollup(userId, [])` — i.e. **full** recalc.

**On `deleteTimeBlock`** (`DataProvider.tsx:605-…`): optimistic remove + `db.delete('timeBlocks', id)` + rollback on error.

**Validation summary**: only the "must link" check is enforced — no time range validation, no overlap detection, no day-of-week check. The new planner must therefore self-validate before staging blocks for commit.

**Recurrence today**: handled in the **UI layer**, not the model. `TimeBlockPlanner.tsx:263-…` has a `repeatWeekly` flag that, when set, creates N independent TimeBlock rows (one per chosen weekday) by calling `onCreateBlock` repeatedly. There is no `recurrenceRule` field on TimeBlock. The new feature must keep the same "expand-then-create" pattern at commit time.

**Status set**: `'planned' | 'in_progress' | 'completed' | 'cancelled' | 'overrun'` (`src/types/index.ts:24`). The codebase has no `'skipped'` or `'missed'` status — what `CLAUDE.md` calls "missed/skipped" is approximated by `cancelled` + an overdue heuristic computed at render time.

**Avoiding duplicates at commit**: the safest signature is a stable `draftBlockKey` per draft (e.g. `${draftId}:${dayIndex}:${slotIndex}`) stored on the TimeBlock as `notes` metadata or simply not stored — the commit step will deduplicate by checking that no real block already covers `(startTime,endTime,taskId)` for that user.

---

## 5. Persistence and Local-First Assessment

### Adapter layer — `src/lib/database.ts`
- **Interface**: `DatabaseAdapter` (`src/lib/firebaseAdapter.ts`) — `create / update / delete / getAll / getByIndex / subscribe / waitForSync / isOnline`.
- **`MemoryAdapter`** (`database.ts:68`) — no-op fallback for non-browser/test environments.
- **`IndexedDBAdapter`** (`database.ts:122`) — primary local store. IDB version **4** (`database.ts:119`). Object stores already created (`database.ts:187-195`):
  ```
  users, domains, goals, keyResults, projects, tasks,
  timeBlocks, sessions, habits, habitLogs, metrics,
  calendarEvents, deadlines, journalEntries, insights, achievements,
  notes, noteTemplates, goalRoadmaps,
  visionBoards, visionItems, mediaAssets, mediaBlobs,
  pages, login_streaks
  ```
  Default indexes are on `userId` (per store) with extra indexes on `startTime/status/etc.` for timeBlocks. **No `weeklyPlanDrafts` store yet.**
- **`FirebaseAdapter`** (`database.ts:1486`) — used when `useFirebase === true` and a `userId` is set via `adapter.setUserId(...)`.
- **`LifeTrackerDB` orchestrator** (`database.ts:1204`):
  - `getAdapterType()` exposes which adapter is active,
  - default to `IndexedDBAdapter` if no Firebase session
    (`database.ts:1286-1290`),
  - `switchToIndexedDB()` (`database.ts:1462`) and `getAdapterDebugInfo()`
    (`database.ts:1366`) for diagnostics,
  - reset capability is **only** exposed for IndexedDB
    (`database.ts:2148`), aligned with `CLAUDE.md` HARD RULE #3.

### "Guest" mode — gap between docs and reality
- `CLAUDE.md` says: _"Guest: userId = guestId stabile (localStorage o helper esistente)"_.
- The data layer respects this (`IndexedDBAdapter` is the default).
- **But the UI does not**: `AuthGate` (`src/app/page.tsx:41-56`) renders `<AuthModal/>` whenever `status === 'signedOut'` — `AuthModal.tsx` exposes no "continue as guest" button (grep on `guest|anonymous|Ospite` in `AuthModal.tsx` returns nothing). In practice, no real user ever reaches `MainApp` without a Firebase `uid`.
- **Implication for the new feature**: a draft store keyed on `userId === currentUser.uid` will always have a valid key in production. We do _not_ need to invent a `guestId`; we just inherit the same `userId` the `DataProvider` already uses.

### Where to persist a `WeeklyPlanDraft`
Trade-off, ranked from least invasive to most:
1. **In-memory only inside a new `WeeklyPlannerProvider`** — simplest; loses bozza on refresh; OK for an MVP draft session.
2. **`localStorage` (single JSON blob per user)** — survives refresh; no schema migration; no IDB version bump. **Recommended for Prompt 4.**
3. **New IDB object store `weeklyPlanDrafts`** — would require bumping `IDB_VERSION` from 4 → 5 (`database.ts:119`) and adding a `createObjectStore` branch in the `onupgradeneeded` handler (`database.ts:197-288`). This is a schema migration and is therefore higher-risk under HARD RULE #2 ("backward-compatible") — only do it if Prompt 4 explicitly demands multi-week persisted history.
4. **Firestore** — never for a bozza. Drafts must never leave the device pre-approval (Principle #2 + #3).

**Recommendation**: Prompt 4 uses option 2 (`localStorage`). If we later need history, layer option 3 on top with a careful migration.

---

## 6. Existing Planner / Calendar / Habit UI

| File | Role | Reusable bits for the new feature |
|---|---|---|
| `src/components/TimeBlockPlanner.tsx` (1521 lines) | Main day/week canvas; drag-to-create, weekly repeat, modal editor | Week-grid layout + drag math; the `repeatWeekly` weekday selection pattern (`TimeBlockPlanner.tsx:1168-1213`) is exactly what the draft calendar will need — but extract as standalone helpers, do not import this monolith. |
| `src/components/SmartScheduler.tsx` (517 lines) | Calls `autoScheduler.schedule(tasks, constraints, goals)` and renders results | Constraint-shape reference; **not** a UI to reuse as-is. |
| `src/components/HabitsTracker.tsx` (564 lines) | Habit grid, daily logging | Visual idiom for daily-streak pills; not reusable for routine scheduling (Habit model is too coarse, see §3). |
| `src/components/WeeklyExecution.tsx` (325 lines) | Existing "weekly review" view | Layout/structure inspiration for Prompt 5's `WeeklyReviewLoop`. |
| `src/components/EventsCalendar.tsx` (597 lines) | Calendar for `ImportantEvent` entities | Month-view rendering reference; separate entity, do not mix. |
| `src/components/RealTimeAdaptation.tsx` (626 lines) | Wraps `rePlanningEngine` | Patterns for "warnings panel"; useful Prompt 3 reference. |

**UX problems observed (not in scope to fix now)**:
- `TimeBlockPlanner.tsx` is a 1521-line god-component with mixed concerns; reusing it would be a vector for regressions. The new feature should compose **new** small components.
- 14 top-level tabs in `MainApp` — adding a 15th is acceptable, but Prompt 3 should think about a sensible default landing for the new feature so users find it.

**Reusable for `DraftWeekCalendar` (Prompt 3)**: nothing copy-paste-safe. We will write a thin, read-only week-grid (Mon–Sun × 24h) that consumes the draft data and supports inline edit / drag-resize at most. We can borrow CSS class conventions from `TimeBlockPlanner.tsx:749` but not the component tree.

---

## 7. Test Infrastructure

- **Framework**: Vitest 3.2.4 + jsdom 26 + `@testing-library/react`.
- **Config**: `vitest.config.ts` — `environment: 'jsdom'`, `globals: true`, alias `@→./src`, coverage v8.
- **Setup**: `src/test/setup.ts` — auto-cleanup; polyfills `indexedDB`, `localStorage`, `sessionStorage` for the Node test env.
- **Existing tests (5 files, 29 tests)**:
  - ✅ `src/utils/dateUtils.test.ts` (7) — date helpers.
  - ✅ `src/lib/streakCalculator.test.ts` (11) — habit streaks.
  - ✅ `src/lib/hierarchicalRollup.test.ts` — rollup math.
  - ✅ `src/providers/DataProvider.test.tsx` (3) — provider smoke tests.
  - ⚠ `src/app/api/ai/chat/route.test.ts` — 2 failing (test string assertion mismatch with Italian error message). **Pre-existing, unrelated to this feature.**
- **Coverage**: not measured in CI; reporter configured (`'text','json','html','lcov'`) but not enforced.

**Gaps relevant to the new feature**:
- No tests on `createTimeBlock` validation.
- No tests on `autoScheduler.ts` or `goalToPlanEngine.ts` (despite their size).
- No timezone-related tests (relevant: Italian users, DST around end-of-March / end-of-October).

**Where new tests will live** (mirror the source convention `foo.ts → foo.test.ts` next to the source file):
- `src/lib/weeklyPlanner/parser.test.ts`
- `src/lib/weeklyPlanner/goalMapper.test.ts`
- `src/lib/weeklyPlanner/routineEngine.test.ts`
- `src/lib/weeklyPlanner/scheduler.test.ts`
- `src/lib/weeklyPlanner/conflicts.test.ts`
- `src/lib/weeklyPlanner/scoring.test.ts`
- `src/lib/weeklyPlanner/commitDraft.test.ts`

---

## 8. Recommended Feature Module Architecture

The repository convention is **flat folders** (`src/lib/*.ts`, `src/components/*.tsx`) with one nested folder per non-trivial sub-system (`src/lib/ai/`, `src/lib/voice/`, `src/components/blocks/`, `src/components/ai/`). We mirror that.

### Layout
```
src/lib/weeklyPlanner/                  # deterministic core (no React, no Firebase)
  types.ts                              # WeeklyIntentInput, ParsedIntent, RoutineSpec,
                                        #   GoalMapping, DraftBlock, WeeklyPlanDraft,
                                        #   PlanWarning, RealismScore, CommitResult
  parser.ts                             # natural-language → ParsedIntent[]
  goalMapper.ts                         # ParsedIntent → { goalId, projectId, taskId }
  routineEngine.ts                      # frequencies + weekday rules → date slots
  scheduler.ts                          # slots × working hours → DraftBlock[]
  conflicts.ts                          # detect overlap with existing TimeBlocks + within draft
  scoring.ts                            # realism score (hours/week vs capacity)
  draftStore.ts                         # pure persistence helpers (Prompt 4) — localStorage
  commitDraft.ts                        # DraftBlock[] → calls injected createTimeBlock()
  index.ts                              # public re-exports
  *.test.ts                             # vitest unit tests (Prompt 2)

src/components/WeeklyPlanning/
  WeeklyPlanningTab.tsx                 # top-level, owns local state + wiring
  WeeklyIntentInput.tsx                 # textarea + examples + submit
  GoalMappingReview.tsx                 # ambiguity resolver: parsed → goal/project/task
  DraftWeekCalendar.tsx                 # Mon–Sun × 24h read-only grid (with edit affordances)
  PlanWarningsPanel.tsx                 # conflicts, overload, missing mapping
  RealismScorePanel.tsx                 # score + breakdown
  ApprovePlanPanel.tsx                  # final confirmation → commit
```

### Per-file responsibility table

| File | Responsibility | Input | Output | Depends on | Risk |
|---|---|---|---|---|---|
| `types.ts` | Single source of truth for the feature's TS types. | — | exported types | `@/types` (Goal/Project/Task/TimeBlock — read-only) | Low |
| `parser.ts` | Deterministic NL → `ParsedIntent[]` (regex + keyword tables, IT-first). | `string`, `{ today: Date }` | `ParsedIntent[]` | none | **High** — language fragility; mitigation: strict scope, explicit "unmapped" intents. |
| `goalMapper.ts` | Match each intent to an existing Goal/Project/Task by token similarity + manual override. | `ParsedIntent[]`, `{ goals, projects, tasks }` | `GoalMapping[]` (with confidence + alternatives) | `@/types` (read-only) | Medium — false positives; mitigation: never auto-commit when confidence < threshold. |
| `routineEngine.ts` | Expand "lunedì, martedì, 4x/settimana, ogni mattina" into concrete date slots for the active week. | `ParsedIntent`, `{ weekStart: Date, tz: string }` | `RoutineSlot[]` | `@/utils/dateUtils` | Medium — DST/timezone; mitigation: test boundary weeks. |
| `scheduler.ts` | Place each slot into a `DraftBlock` respecting user working hours + existing blocks. | `RoutineSlot[]`, `existingBlocks`, `userPrefs` | `DraftBlock[]` | `conflicts.ts` | Medium — packing heuristic; mitigation: deterministic ordering + tiebreaker tests. |
| `conflicts.ts` | Pure: detect overlap (a, b) and aggregate per-day overload. | blocks/drafts | `PlanWarning[]` | none | Low |
| `scoring.ts` | Compute realism score from planned vs available hours, repeats, fragmentation. | draft + capacity | `RealismScore` | none | Low |
| `draftStore.ts` | Read/write `WeeklyPlanDraft` in `localStorage` namespaced by `userId` + `weekKey`. | `userId`, `weekKey`, draft | persisted draft | browser `localStorage` | Medium — quota; mitigation: 1 draft/user at a time. |
| `commitDraft.ts` | Convert approved draft into real TimeBlocks **by calling the injected `createTimeBlock` from `DataProvider`**. | `WeeklyPlanDraft`, `createTimeBlock` | `CommitResult` (created IDs + skipped) | DataProvider (via DI) | **High** — duplication risk; mitigation: pre-flight existing-block scan + idempotency key per draft block. |
| `index.ts` | Barrel exports. | — | — | — | — |
| UI components | Render-only; all logic lives in `lib/weeklyPlanner/`. | props from `WeeklyPlanningTab` | JSX | core lib + DataProvider hooks | Low |

### Wiring into `MainApp`
Add tab id `'weekly_intel'` to the `ActiveTab` union (`MainApp.tsx:49`) — this is the **one and only** edit to existing files we propose for Prompt 3. No type change in `src/types/index.ts`. No change to `DataProvider`.

---

## 9. Integration Strategy

**Pure logic** (no React, no DB): `parser`, `goalMapper`, `routineEngine`, `scheduler`, `conflicts`, `scoring`. All take inputs in, return data out. No side effects. Fully unit-testable with Vitest. **Built in Prompt 2.**

**UI** (React, no DB): the `WeeklyPlanning/*` components consume `useDataContext()` only to **read** goals/projects/tasks/timeBlocks and to display them. Drafts live in component state until Prompt 4. **Built in Prompt 3.**

**Persistence** (`localStorage` only): `draftStore.ts` reads/writes one bozza per user. Never touches IndexedDB or Firestore. **Built in Prompt 4.**

**Commit path**: `commitDraft.ts` receives the existing `createTimeBlock` from `useDataContext()` and calls it once per `DraftBlock`. **It does not duplicate or replace `DataProvider`'s validation** — the same "must link to ≥1 entity" rule applies automatically because we go through the public API. **Built in Prompt 4.**

**APIs to use** (read + write):
- Read: `useDataContext().{goals, projects, tasks, timeBlocks, kpis}`.
- Write: `useDataContext().createTimeBlock` — **the only mutation surface** the new feature touches.
- Date helpers: `@/utils/dateUtils` (already has `toDateSafe`, formatting, week math — confirmed by `dateUtils.test.ts`).

**APIs to avoid (explicit ban list)**:
- `db.create / db.update / db.delete` directly (bypasses validation + optimistic update).
- `firebaseAdapter` directly.
- `aiEngine`, `microCoach`, `secondBrain`, `riskPredictor`, `rePlanningEngine`, `autoScheduler`, `goalToPlanEngine` (all are either AI-flavored, or already coupled to other components, or both — reading them for inspiration is fine, importing is not).
- OpenAI / `/api/ai/*` routes.
- `hierarchicalRollup` (only `DataProvider` should trigger it; we feed it via `createTimeBlock`).

**Boundary contract**: the new feature exports exactly one symbol to the rest of the app — `<WeeklyPlanningTab />`. Everything else is private to `src/lib/weeklyPlanner/`.

---

## 10. Risk Register

| # | Rischio | Gravità | Probabilità | File coinvolti | Mitigazione | Prompt |
|---|---|---|---|---|---|---|
| 1 | Perdita dati esistenti (Goal/Project/Task/TimeBlock) per scrittura accidentale | 🔴 Alta | Bassa | `src/lib/database.ts`, `src/providers/DataProvider.tsx` | Non importare `db.*` direttamente; passare _solo_ per `createTimeBlock`; nessun update/delete su entità non create dalla feature. | 4 |
| 2 | Duplicazione TimeBlock al re-commit della stessa bozza | 🔴 Alta | Media | `commitDraft.ts` | Idempotency key per `(weekKey, dayIndex, slotIndex, taskId)` + pre-flight scan dei TimeBlock esistenti nella settimana; commit transazionale (rollback dei creati se uno fallisce). | 4 |
| 3 | Mapping sbagliato Goal/Project/Task → TimeBlock orfani semantici | 🟠 Media | Alta | `goalMapper.ts`, `WeeklyPlanningTab.tsx` | Confidence threshold; UI "GoalMappingReview" obbligatoria; default a "non mappato" che blocca il commit. | 2 + 3 |
| 4 | Parser troppo fragile su input italiano | 🟠 Media | Alta | `parser.ts` | Scope esplicitamente ristretto (IT-first, lista chiusa di pattern); intent `unknown` → mostrato a UI per correzione manuale. | 2 |
| 5 | UI troppo complessa per single-page tabbed shell | 🟡 Bassa | Media | `WeeklyPlanning/*` | Wizard a step (Intent → Mapping → Calendar → Approval); ogni step in component piccolo. | 3 |
| 6 | Persistenza bozza non sicura (quota localStorage, multi-tab) | 🟡 Bassa | Bassa | `draftStore.ts` | Una sola bozza viva per utente; sentinel di staleness; try/catch su `setItem`. | 4 |
| 7 | Rottura analytics (KPI / rollup) per blocchi spuri creati dalla feature | 🟠 Media | Bassa | `hierarchicalRollup.ts`, `DataProvider.tsx` | I draft non sono TimeBlock → KPI non cambiano fino al commit; al commit, status `'planned'` (no rollup). Test: KPI invariati pre/post draft. | 3 + 5 |
| 8 | Rottura habits (uso improprio del modello Habit per le routine) | 🟠 Media | Media | `HabitsTracker.tsx`, `types.ts` (Habit) | **Mai** scrivere su `habits` o `habitLogs`. Routine settimanali vivono nella feature. | 2 (decisione esplicita) |
| 9 | Uso accidentale di AI | 🔴 Alta | Bassa | `src/lib/ai/*`, `src/lib/voice/*` | Lint guard: il codice della feature non importa nulla da `@/lib/ai` o `@/lib/voice`. Verifica con grep in CR. | 2–5 |
| 10 | Uso di `any` (tsconfig non strict) | 🟠 Media | Alta | tutto il modulo | Self-imposed rule: zero `any`, zero `as any`. Tipi espliciti per ogni `Partial<T>`. PR review checklist. | 2–5 |
| 11 | Migrazione silenziosa dello schema IDB | 🔴 Alta | Bassa | `database.ts` (IDB_VERSION) | Non bumpare `IDB_VERSION` in P2–P3. Se si aggiunge store in P4, PR dedicata + test downgrade. | 4 |
| 12 | Drift DST / timezone (Catalana / palestra / etc.) | 🟠 Media | Media | `routineEngine.ts`, `scheduler.ts` | Tutte le date interne via `dateUtils`; test boundary weeks (ultimo weekend di marzo, ultimo di ottobre). | 2 |

---

## 11. Five-Prompt Implementation Roadmap

The proposed sequence is **confirmed** with minor adjustments noted below.

### Prompt 1 — Discovery (this report) ✅
- **Done**: read repo, mapped models / persistence / UI / tests, no application code touched.
- **Output**: `docs/WEEKLY_PLANNING_DISCOVERY_REPORT.md`.

### Prompt 2 — Types + Deterministic Core (no UI, no persistence)
- **Goal**: ship `src/lib/weeklyPlanner/` with pure logic + 100 % unit-test coverage of the core.
- **Files probably created**:
  - `src/lib/weeklyPlanner/types.ts`
  - `…/parser.ts`, `…/goalMapper.ts`, `…/routineEngine.ts`, `…/scheduler.ts`, `…/conflicts.ts`, `…/scoring.ts`
  - matching `*.test.ts`
  - `…/index.ts`
- **Files NOT modified**: `types/index.ts`, `database.ts`, `DataProvider.tsx`, anything UI.
- **Risks**: parser fragility, DST.
- **Acceptance**:
  - `npm run build` ✅, `npm run lint` ✅, `npm run test:run` ✅ (existing 27 still pass; ≥40 new tests pass).
  - Module exports types and pure functions only. No React, no IDB, no Firebase, no `fetch`.
  - Grep for `any` / `as any` inside the new module returns 0 hits.

### Prompt 3 — UI Wizard (no persistence)
- **Goal**: build the 5-step UI; drafts live in component state.
- **Files probably created**: `src/components/WeeklyPlanning/{WeeklyPlanningTab,WeeklyIntentInput,GoalMappingReview,DraftWeekCalendar,PlanWarningsPanel,RealismScorePanel,ApprovePlanPanel}.tsx`.
- **Files modified (minimal)**: `src/components/MainApp.tsx` — add `'weekly_intel'` to `ActiveTab` and one new nav card. Nothing else.
- **Risks**: UI complexity, false sense of "saved" — Approval step must clearly say "Nothing persisted yet".
- **Acceptance**:
  - Build / lint / tests green.
  - Manual: typing an intent shows parsed → mapped → draft calendar → warnings → score, all without writing to DB.
  - No `createTimeBlock` calls until Prompt 4 commit step.

### Prompt 4 — Draft Persistence + Approval Commit
- **Goal**: `draftStore.ts` (localStorage) + `commitDraft.ts` wired to `useDataContext().createTimeBlock`.
- **Files probably created**: `src/lib/weeklyPlanner/{draftStore,commitDraft}.ts` + tests.
- **Files modified**: `WeeklyPlanningTab.tsx` to use the store + commit.
- **Risks**: duplicates (#2), localStorage quota (#6).
- **Acceptance**:
  - Refresh mid-bozza → bozza ripristinata.
  - Approve → N real TimeBlocks created via `createTimeBlock`, each linked to ≥1 entity, status `planned`.
  - Re-approve same bozza → idempotent (0 duplicates).
  - KPI / rollup behave exactly as if user had created the blocks via `TimeBlockPlanner`.

### Prompt 5 — Review Loop + Analytics Hook + Docs
- **Goal**: integrate with `WeeklyExecution` / `AnalyticsDashboard` for plan-vs-actual feedback; finalize portfolio docs.
- **Files probably modified (read-only-ish)**: a small section in `WeeklyExecution.tsx` that **reads** the last committed bozza id from `draftStore` (no write to other entities); README + manual QA notes.
- **Risks**: scope creep (resist adding ML).
- **Acceptance**: docs done, manual QA pass, screenshots, build/lint/tests green.

---

## 12. Acceptance Criteria for Prompt 1

| Criterion | Status |
|---|---|
| `package.json` read | ✅ §2 |
| Core models identified | ✅ §3 |
| TimeBlock creation flow mapped | ✅ §4 |
| Persistence identified | ✅ §5 |
| UI/planner inventoried | ✅ §6 |
| Tests identified | ✅ §7 |
| Architecture proposed coherent with repo | ✅ §8 |
| 5-prompt roadmap produced | ✅ §11 |
| No application code modified | ✅ — only this Markdown was written |
| No dependencies installed | ✅ |
| No migrations performed | ✅ (IDB still v4) |
| No AI added | ✅ |
| `npm run build` green | ✅ exit 0 |
| `npm run lint` green | ✅ exit 0 (warnings only) |
| `npm run test:run` | ⚠ 27/29 — 2 pre-existing failures in `route.test.ts`, unrelated |

---

## 13. Final Recommendation

### **GO WITH RISKS**

The repo is structurally ready for Prompt 2. The deterministic-first /
local-first / draft-first / human-in-the-loop principles map cleanly onto the
existing architecture **provided** we treat the following as hard constraints
in every subsequent prompt:

1. **One mutation surface**: only `useDataContext().createTimeBlock`. No
   direct `db.*`, no Firestore writes, no AI call, no edits to
   `types/index.ts` / `database.ts` / `DataProvider.tsx` /
   `hierarchicalRollup.ts`.
2. **No `IDB_VERSION` bump** in Prompts 2–3. If Prompt 4 needs IDB, it gets
   its own PR with migration tests.
3. **No reuse of existing engines** (`autoScheduler`, `goalToPlanEngine`,
   `rePlanningEngine`, `microCoach`, `secondBrain`, `riskPredictor`) — they
   are inspiration only.
4. **Self-imposed strictness**: zero `any`, zero `as any`, named types for
   every function boundary. `tsconfig` is permissive; we must not be.

### Before Prompt 2, please verify / confirm:

- [ ] **Failing AI route test** (`src/app/api/ai/chat/route.test.ts`) — leave
  as-is for now? It's pre-existing and unrelated. Recommended: do not fix in
  this feature's PRs to keep diffs focused.
- [ ] **Language scope for `parser.ts`** — Italian only at MVP, English as a
  stretch? Lock the scope before Prompt 2 to bound test surface.
- [ ] **Working-hours source** — does the planner read `User.preferences.workingHours`
  from a stored `User` entity, or default to `08:00–22:00` until the user
  configures it? (No `User` document is currently created at sign-in by
  `DataProvider`; the type exists in `types/index.ts:32` but I did not find
  a `createUser` call.)
- [ ] **Routine vs Habit decision** — confirm we will NOT extend the `Habit`
  model. Routines are first-class to the planner feature.
- [ ] **Draft persistence** — confirm `localStorage` (option 2 in §5) for
  Prompt 4, not a new IDB store. If you prefer IDB, we plan the migration
  upfront.

Once these are confirmed, Prompt 2 can begin.
