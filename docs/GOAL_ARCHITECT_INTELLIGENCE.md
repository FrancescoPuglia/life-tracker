# Goal Architect Intelligence

> Deterministic, local-first feature that turns natural-language goal
> architecture into a reviewable, editable, idempotently committable
> hierarchy of **Goal → Projects → Tasks + Key Results** — without AI,
> without external services, and without ever inventing IDs.

---

## 1. Problem

Most users write vague goals ("get fit", "find a job", "play better chess")
and never translate them into a structured execution system. The cost is
silent:

- No clear unit of progress.
- No measurable target hours.
- No reviewable plan before commitment.
- No way to revisit, edit, and re-commit safely.

Generic AI planners get partially there, but they are opaque, network-bound,
and feel untrustworthy because they cannot explain what they did or why.
We need something different — a feature that lets the user write *"Goal
SCACCHI. 300 ore. Projects: Calcolo 80h, Tattica 60h, Aperture 70h, …"* and
see exactly what will be created **before** anything is created.

## 2. Product Idea

```
Natural-language goal architecture
     → Parser   (rule-based, deterministic)
     → Compiler (typed draft tree)
     → Review UI (inline edits + validation + confidence)
     → Approve  (sequential commit through DataProvider)
     → Real Goal / Projects / Tasks / Key Results
```

The whole feature is local-first: every step except the final commit lives
entirely in the browser. The commit talks only to the existing
`DataProvider` — no direct database writes from this feature.

## 3. User Flow

1. Open Life Tracker → click the **🏗️ Goal Architect** tab.
2. Write goal architecture in the textarea, or load one of the five built-in
   fixtures (Lavoro / Scacchi / Model Physique / Intelligence Engine /
   Presence Upgrade) via the quick chips.
3. Click **Generate Draft**. The parser builds a typed
   `GoalArchitectureDraft` and the UI renders the review tree.
4. Review:
   - Summary panel (counts, hours roll-up, can-commit state).
   - Goal header + per-project cards + per-task rows + Key Results panel.
   - Issues panel (errors / warnings / info, grouped by severity).
   - Confidence panel (per-field bars with reasons).
5. Edit any field inline. Every keystroke re-runs validation + summary
   synchronously and persists the new draft to `localStorage`.
6. Refresh the page if you want — the draft hydrates from local storage and
   the banner shows *↺ Loaded from local draft*.
7. Click **🏗️ Approve & create real entities** to commit. The button is
   gated by validation. After a success or partial commit, it stays disabled
   and the banner shows *✅ Draft committed*.
8. Open the Goals & Projects tab to see the real entities under the real
   Goal.

## 4. Parser Syntax — Cheat Sheet

The parser is rule-based, deterministic, Italian + English + mixed. It
ignores capitalization and most punctuation, normalizes whitespace,
diacritics, and Unicode quotes/dashes, and **never throws**.

### 4.1 Goal

| Form | Example |
|---|---|
| `Goal: NAME` | `Goal: SCACCHI — Chess Mastery` |
| `Obiettivo: NAME` | `Obiettivo: Lavoro — Career Command 2026` |
| `Crea il Goal NAME` | `Crea il Goal Model Physique` |
| `Create goal NAME` | `Create goal Chess Mastery` |
| `Objective: NAME` | `Objective: Career 2026` |

### 4.2 Total hours

| Form | Example |
|---|---|
| `Total hours: 300` | also `Target hours 300`, `Monte ore: 300` |
| `Ore totali: 300` | |
| `Il Goal totale deve avere 300 ore` | verbose Italian form |

### 4.3 Target date

| Form | Example |
|---|---|
| `Target date: 31/12/2026` | ISO `2026-12-31` also accepted |
| `Scadenza: 31/12/2026` | also `Deadline:`, `Due date:` |
| `entro dicembre 2026` | → last day of month = `2026-12-31` |
| `by December 2026` | same semantics |
| `end of 2026` / `entro fine 2026` | → `2026-12-31` |
| `31 dicembre 2026` / `31 December 2026` | explicit day form |

### 4.4 Projects

```
Projects: A 10h, B 20h, C 30h
Progetti:
- Calcolo e Visualizzazione 80h
- Tattica 60h
- Aperture 70h
```

Either comma-separated on one line or bullet-list on multiple lines.
Bullet-list mode is required when project titles contain commas
(e.g. *"ONU, FAO, WFP, IFAD, UNV, UNOPS"* — commas inside the title would
break a comma-separated split).

### 4.5 Tasks per project

```
Nel progetto Aperture crea questi task:
- Completare Short & Sweet Catalana 20h critical
- Studiare Sveshnikov 25h critical
- Repertorio Benko 15h high
```

English form:

```
In project Openings create tasks: Catalan 10h critical, Sicilian 15h high.
Tasks for project Openings: Catalan 10h critical.
```

Each item parses: `<title> [<N>h] [<priority>] [<date>]` in any order.

### 4.6 Top-level Tasks (no project)

```
Tasks: Generic 5h critical, Other 10h high
```

Top-level tasks become `directTaskIds` on the Goal. Note: they cannot be
committed as-is — see **§ 9 Known limitations**.

### 4.7 Key Results

```
Key Results: 120 candidature mirate inviate, 20 colloqui condotti, 1 offerta firmata
KR: completare 20 giorni Cognitive Chess Training, completare 100 studi, raggiungere 2100 Elo
Risultati chiave: 12% body fat, 200 sessioni, 4 review trimestrali
```

Each KR captures: `targetValue` + `unit` (if a known unit alias follows the
number — `libri/books`, `corsi/courses`, `%`, `giorni/days`,
`sessioni/sessions`, `studi/studies`, `ore/hours`, `video/videos`,
`task/tasks`). Unknown unit tokens stay as `custom` + `customUnit`.

### 4.8 Priority aliases

| Priority | Aliases recognized |
|---|---|
| `critical` | `critical`, `critico`, `critica`, `urgente`, `crit`, `urgent`, `altissima`, `importantissimo` |
| `high` | `high`, `alta`, `alto`, `importante`, `prioritario`, `h` |
| `medium` | `medium`, `media`, `medio`, `med`, `m` |
| `low` | `low`, `bassa`, `basso`, `l` |

## 5. Draft Model

The parser compiles natural-language text into a fully-typed draft:

```ts
GoalArchitectureDraft {
  id, version, status, createdAtISO, updatedAtISO, sourceText,
  goal: GoalDraft | null,
  projects: ProjectDraft[],
  tasks: TaskDraft[],
  keyResults: KeyResultDraft[],
  issues: GoalArchitectIssue[],
  summary: GoalArchitectureSummary,
  confidence: DraftConfidence,
}
```

Every entity carries:

- A **deterministic id** (`createDraftId(kind, title, parentId?)`) — same
  input always produces the same id.
- A **`sourceText`** snippet so reviewers can trace each row back to the
  input.
- A **`confidence`** value (overall + per-field with a `reason` string).

The draft `status` is one of `draft | valid | invalid | committed`. The
`summary` is recomputed after every parse and every edit:

```ts
GoalArchitectureSummary {
  goalCount, projectCount, taskCount, keyResultCount,
  totalGoalTargetHours?, totalProjectTargetHours, totalTaskEstimatedHours,
  orphanTaskCount, orphanKeyResultCount,
  errorCount, warningCount, infoCount,
  isStructurallyValid, canCommit,
}
```

`canCommit` is `true` only when:
- A `goal` exists with a non-empty title.
- No `error`-severity issues.
- No orphan tasks (tasks pointing to non-existent projects).
- No orphan key results (KRs pointing to a different goal).

## 6. Validation Rules

Implemented in `src/lib/goalArchitect/validation.ts`. Errors block commit;
warnings and info do not.

### Errors (block commit)
- Missing goal.
- Empty title (goal / project / task / key result).
- Negative or non-finite hours / target values / current values.
- Malformed `dueDateISO`.
- Project's `parentGoalId` doesn't match the draft's goal id.
- Task's `parentProjectId` references a non-existent project.
- Key result's `parentGoalId` doesn't match the draft's goal id.
- Invalid priority value.

### Warnings (advisory)
- Missing `targetHours` on goal/project; missing `estimatedHours` on task.
- Missing `dueDateISO` on goal.
- Missing `unit` on key result.
- Missing `targetValue` on key result.
- < 2 key results (`too_few_key_results`).
- > 5 key results (`too_many_key_results`).
- Project with no tasks.
- Task linked directly to the goal (no project parent).
- Duplicate project titles in the same goal.
- Duplicate task titles in the same project.
- Duplicate KR titles.
- Similar titles (Levenshtein ≤ 20% of longest, min length 5).
- Hours mismatch: goal `targetHours` vs Σ project `targetHours`, project
  `targetHours` vs Σ task `estimatedHours` (tolerance 0.25h absolute or 5%
  relative).

## 7. Commit Safety Contract

The commit pipeline lives in
`src/lib/goalArchitect/commitGoalArchitectureDraft.ts`. It is:

- **Pure**. No React, no DataProvider import, no localStorage. Callers
  inject `createGoal/createProject/createTask/createKeyResult` plus
  snapshots of existing entities.
- **Explicit-approve-only**. Generate and edit never call create functions.
  Only the explicit click on **Approve** triggers the pipeline.
- **Sequential**. Goal → each Project → each Task → each Key Result.
  Never `Promise.all`. A `commitInFlightRef` latch makes double-click
  impossible.
- **Real-IDs-only**. Each child entity is created with the id **returned
  by the parent's create function**. If a parent create returns `undefined`
  or throws, descendants are skipped with `reason: 'parent_unresolved'` —
  they are never created with placeholder ids like `goalId: ''`.
- **Idempotent**. Every created entity has a `GAI_KEY: gai:<draftId>:<kind>:<entityId>`
  marker embedded at the end of its `description`. Primary duplicate
  detection looks for this string in existing entities. Secondary detection
  is structural (normalized title + parent id, plus matching
  `estimatedMinutes` for tasks).
- **No destructive rollback**. The DataProvider's delete functions cascade
  (deleting a goal soft-deletes its projects and tasks) and could affect
  unrelated user data on a partial re-commit. Instead, partial failures are
  reported via `status: 'partial' | 'failed'` plus `errors[]` and
  `skipped[]`. Re-running a commit is safe because of GAI_KEY.
- **No direct DB writes**. The pipeline never imports `@/lib/database`,
  Firebase, or IndexedDB. The only side effect available to it is the
  injected create functions.
- **No invented IDs**. The pipeline never makes up an id.

### Commit result shape

```ts
GoalArchitectCommitResult {
  status: 'success' | 'partial' | 'blocked' | 'failed',
  createdGoals: GoalArchitectCommitCreated[],
  createdProjects: GoalArchitectCommitCreated[],
  createdTasks: GoalArchitectCommitCreated[],
  createdKeyResults: GoalArchitectCommitCreated[],
  skipped: GoalArchitectCommitSkipped[],
  duplicates: GoalArchitectCommitDuplicate[],
  blockedReasons: GoalArchitectBlockedReason[],
  errors: GoalArchitectCommitError[],
  message: string,
}
```

| Status | Meaning |
|---|---|
| `blocked` | Pre-flight validation rejected the input. Nothing was created. |
| `success` | Every expected entity was either created or matched as a duplicate. |
| `partial` | Some entities were created or matched; at least one was skipped or errored (typically because `createKeyResult` is missing, or a project create failed and its tasks were skipped). |
| `failed` | The goal itself could not be created. No descendants attempted. |

## 8. Persistence Behavior

Implemented in `src/lib/goalArchitect/draftStore.ts`.

- **Key format**:
  `goal-architect-draft:<userIdOrLocal>:<draftIdOrSlug>`. The UI uses the
  default slot `active`, so the user has a single hydrating draft per
  account. The richer per-draft form is exposed for callers that want to
  manage multiple drafts.
- **SSR-safe**. When `typeof window === 'undefined'`, every operation is a
  no-op that returns the sentinel (`false` / `null` / `[]`). The view's
  hydration `useEffect` is gated by `disablePersistence`.
- **Hydration**. On mount the view calls `loadGoalArchitectureDraft(key)`.
  If a valid blob is present, `draft` and `rawText` are restored and the
  banner shows *↺ Loaded from local draft*. If the blob is invalid JSON or
  has the wrong shape, `loadGoalArchitectureDraft` returns `null` (no
  crash).
- **Save on Generate and on every edit**. Every state mutation that
  produces a new `GoalArchitectureDraft` is persisted immediately. No
  debounce — the blob is small and last-write-wins is correct.
- **Clear**. `Clear` empties the textarea, drops the in-memory draft, and
  calls `deleteGoalArchitectureDraft(key)`. **Clear does not touch
  committed entities** — those live in the DataProvider and survive a
  draft clear.
- **Shape guard**. `isGoalArchitectureDraftLike` does a shallow check on
  the keys the UI reads first; an unrecognized blob never reaches the
  render tree.

## 9. Known Limitations

### 9.1 Direct tasks need a Project parent at commit time
The real `Task` entity in `src/types/index.ts` requires `projectId`. Tasks
attached directly to a Goal (via `goal.directTaskIds`) are intentionally
**skipped** at commit with `reason: 'parent_unresolved'` and a helpful
suggestion. Fix the draft text by writing
`Nel progetto <Project> crea task: <task title>` and re-Generate, or move
the task to a Project after committing the rest.

### 9.2 Some Goal fields are populated only by OKR Manager
The Goal Architect commit fills `title`, `description` (with GAI_KEY),
`status`, `priority`, `targetDate`, `targetHours`, `timeAllocationTarget`,
`domainId`. Fields like `category`, `complexity`, embedded `keyResults` are
left for the user to populate inside the OKR Manager after commit. This
matches the existing OKR Manager creation pattern.

### 9.3 Active-slot draft is last-write-wins across tabs
If the user has Goal Architect open in two browser tabs, both write to the
same `<user>:active` slot. The last write wins. Multiple-draft mode (per
goal id) is supported by the storage API but not exposed in the UI yet.

### 9.4 `customUnit` is preserved but not yet user-editable
When the parser encounters an unknown KR unit (e.g. `"Elo"`), the compiler
stores it as `unit: 'custom'` + `customUnit: 'Elo'` and the commit forwards
the value via `unit: 'Elo'` to `createKeyResult`. The Review UI exposes the
`unit` dropdown with `custom` as an option but does not currently render a
companion text input for editing `customUnit`. Workaround: edit the
description text directly and re-Generate.

### 9.5 No rollback
By design — see § 7. Re-running a commit is the supported recovery path
because of GAI_KEY idempotency.

## 10. Manual QA Checklist

### Flow A — Fresh empty state
- [ ] Open Life Tracker → click **🏗️ Goal Architect**.
- [ ] Header reads *Goal Architect Intelligence*.
- [ ] Textarea, quick fixture chips, and **Load Example** are visible.
- [ ] Empty state card and amber *no saved draft* banner are visible.
- [ ] **Generate Draft** is disabled while the textarea is empty.

### Flow B — Chess fixture
- [ ] Click the **Scacchi** chip → textarea fills with the Chess fixture.
- [ ] Click **Generate Draft** → review tree appears.
- [ ] Goal title contains `SCACCHI`.
- [ ] 5 projects appear: Calcolo e Visualizzazione, Tattica, Aperture,
      Strategia, Finali.
- [ ] Aperture's task list contains Catalana, Sveshnikov, Benko.
- [ ] Summary panel: 5 projects, 7+ tasks, 3 KRs, Σ project hours = 300h,
      Σ task hours = 300h (no amber mismatch warning).
- [ ] Issues panel reads *No blocking issues detected.*
- [ ] Banner shows *✓ Draft saved locally*.

### Flow C — Edit persistence
- [ ] In the Goal header, change *Target hours* from 300 to 350.
- [ ] Summary panel hours roll-up turns amber (mismatch vs Σ project = 300).
- [ ] Open DevTools → Application → Local Storage → confirm the saved JSON
      contains `targetHours: 350` and a new `updatedAtISO`.
- [ ] Refresh the page → draft re-loads, banner shows *↺ Loaded from local
      draft*, edited value (350) survives.

### Flow D — Safe commit
- [ ] Click **🏗️ Approve & create real entities**.
- [ ] Button label changes to *Creating Goal/Projects/Tasks…*.
- [ ] After completion, the **success** panel appears with counts:
      `1 Goal · 5 Projects · 7+ Tasks · 3 Key Results`.
- [ ] Button becomes disabled with label *✓ Draft committed*.
- [ ] Banner adds *✅ Draft committed*.
- [ ] A footnote explains the `GAI_KEY` marker in entity descriptions.
- [ ] Open **🎯 Goals & Projects** → real Goal `SCACCHI — Chess Mastery`
      exists with the 5 projects nested below, tasks under the right
      projects, and 3 KRs attached to the goal.

### Flow E — Duplicate prevention
- [ ] Back in Goal Architect, click **Clear**.
- [ ] Reload the Chess fixture and **Generate Draft** again.
- [ ] Click **Approve**.
- [ ] Result panel reports the goal as a duplicate (matched by GAI_KEY or by
      title) and the children attach to the existing goal id.
- [ ] OKR Manager shows **no second** `SCACCHI` goal.

### Flow F — Malformed input
- [ ] Clear, type `asdf qwer random random`, click **Generate Draft**.
- [ ] Issues panel shows a `missing_goal` error.
- [ ] Summary panel reports `Cannot commit`.
- [ ] **Approve** button stays disabled.
- [ ] No real entity is created.

### Flow G — Direct task limitation
- [ ] Type a minimal input: `Goal: Test. Projects: Alpha 5h. Tasks: Direct 2h.`
- [ ] Generate → the *Tasks directly linked to Goal* amber section appears.
- [ ] Approve → result panel is *partial*; the direct task is listed in
      `skipped` with a message suggesting the
      `Nel progetto <Project> crea task:` fix.

### Flow H — Double-click protection
- [ ] Generate a valid draft.
- [ ] Double-click **Approve** as fast as possible.
- [ ] Only one Goal is created. Result panel is *success*.

## 11. Worked Examples — Five Real Goal Fixtures

The repo ships five real-life goal architectures as both **draft fixtures**
(hand-built draft objects in `fixtures.ts`) and **parser input texts** (the
natural-language form, in `parserFixtures.ts`). Loading any of the five
quick chips populates the textarea with the corresponding parser-input
text.

| Fixture | Goal | Projects | Tasks | KRs |
|---|---|---:|---:|---:|
| `work` | LAVORO — Career Command 2026 | 8 | 5 | 3 |
| `chess` | SCACCHI — Chess Mastery | 5 | 7+ | 3 |
| `modelPhysique` | MODEL PHYSIQUE | 5 | 4 | 3 |
| `intelligenceEngine` | INTELLIGENCE ENGINE | 5 | 4 | 3 |
| `presenceUpgrade` | PRESENCE UPGRADE | 6 | 5 | 3 |

Each parser-input text is structured so the parser produces a draft that
passes validation (`canCommit: true`, zero errors) — they are also the
end-to-end test corpus for `parseGoalArchitecture.test.ts` and
`fixtures.test.ts`.

### Example — Chess fixture (excerpt)

Input text:

```
Goal: SCACCHI — Chess Mastery
Target date: 31/12/2026
Total hours: 300

Projects:
- Calcolo e Visualizzazione 80h
- Tattica 60h
- Aperture 70h
- Strategia 60h
- Finali 30h

Nel progetto Aperture crea questi task:
- Completare Short & Sweet Catalana 20h critical
- Studiare Sveshnikov 25h critical
- Repertorio Benko 15h high

Key Results:
- Raggiungere 2100 Elo
- Completare 100 studi
- Completare 4 corsi Chessable
```

Resulting draft:

- 1 Goal `SCACCHI — Chess Mastery`, targetHours 300, dueDateISO `2026-12-31`.
- 5 ProjectDrafts, all with `parentGoalId = goal.id`.
- 7+ TaskDrafts, with the three Aperture tasks correctly bound to the
  Aperture project by deterministic id.
- 3 KeyResultDrafts. The `2100 Elo` KR is detected as `unit: 'custom'`
  + `customUnit: 'Elo'` (Elo is not a known unit alias).
- `summary.canCommit: true`, zero errors.

After **Approve**:

- 1 real `Goal` entity in the DataProvider.
- 5 real `Project` entities (`name = project.title`, `goalId = realGoalId`).
- 7+ real `Task` entities (`projectId = realProjectId`,
  `estimatedMinutes = Math.round(estimatedHours * 60)`).
- 3 real `KeyResult` entities (`goalId = realGoalId`).
- Every entity's `description` ends with
  `GAI_KEY: gai:<draftId>:<entityKind>:<entityId>`.

## 12. Module Map

```
src/lib/goalArchitect/
├── types.ts                          domain types
├── ids.ts                            deterministic id helpers
├── validation.ts                     pure validator
├── summary.ts                        pure summary derivation
├── fixtures.ts                       5 draft fixtures
├── parserTypes.ts                    parser AST types
├── normalizer.ts                     token normalization (hours / dates / priority / units)
├── parser.ts                         section-position rule parser
├── compiler.ts                       AST → draft, project matcher
├── parseGoalArchitecture.ts          public facade, never throws
├── parserFixtures.ts                 5 natural-language input texts
├── draftStore.ts                     SSR-safe localStorage persistence
├── commitGoalArchitectureDraft.ts    sequential commit pipeline
└── *.test.ts                         204 tests across 12 files

src/components/GoalArchitect/
├── GoalArchitectTab.tsx              view + container (default export)
├── GoalArchitectInput.tsx            textarea + Generate/Clear/Load Example + 5 chips
├── GoalArchitectEmptyState.tsx       3-step intro card
├── GoalDraftSummaryPanel.tsx         counts + hours roll-up
├── GoalDraftReview.tsx               goal header + tree + KR panel + confidence
├── GoalDraftTree.tsx                 projects + direct-tasks bucket
├── ProjectDraftCard.tsx              editable project card
├── TaskDraftRow.tsx                  editable task row
├── KeyResultDraftPanel.tsx           editable KR list
├── GoalArchitectIssuesPanel.tsx      severity-grouped issue list
├── GoalArchitectConfidencePanel.tsx  overall + per-field bars
├── GoalArchitectApprovePanel.tsx     operational commit panel
├── goalArchitectUi.ts                pure UI helpers (no React)
├── goalArchitectDataAdapters.ts      DataProvider entities → snapshots
└── GoalArchitectTab.test.tsx         17 UI tests
```

---

# Portfolio Case Study

## Goal Architect Intelligence — Turning Natural-Language Ambition into Executable OKRs

### Problem

Users routinely write vague, qualitative goals and never translate them
into structured execution systems. The result is silent: no measurable
unit of progress, no reviewable plan, no way to revisit decisions, and
no honest sense of what is being attempted. Generic AI planners do part
of the job but introduce different problems — they are opaque,
network-bound, and feel untrustworthy precisely because they cannot show
their work.

### Solution

A deterministic, local-first Goal Architect that converts natural-language
goal architecture into a fully-typed `Goal → Projects → Tasks + Key
Results` draft, lets the user review and edit every field, and only then
— on an explicit click — creates the corresponding real entities through
the existing DataProvider. No AI. No external services. No fake rollback.
No invented IDs.

### Product Value

- **Reduces planning friction.** One textarea + Italian/English mixed
  parsing replaces a multi-screen wizard.
- **Turns intention into structured execution.** Output is a real OKR
  hierarchy with hours, due dates, priorities and key results.
- **Keeps the user in control.** Nothing is created until the user clicks
  the explicit approve button. The button is gated by validation.
- **Makes goal planning measurable.** Hours roll-up, mismatch warnings,
  confidence bars, and explicit issue severity make planning legible.
- **Works without AI or external services.** Fully local, fully
  deterministic, fully reproducible.
- **Preserves privacy.** Drafts never leave the browser. The only network
  traffic is the existing DataProvider sync the user already trusts.

### Engineering Value

- **Type-safe draft model.** Every entity, issue code, severity and
  priority is a closed TypeScript union — no `any`.
- **Deterministic parser and compiler.** Same input → same draft → same
  ids. Idempotent end-to-end.
- **Validation-first UI.** Every keystroke re-runs validation + summary
  synchronously. The user sees consequences immediately.
- **SSR-safe local persistence.** Single 150-line `draftStore` with try/
  catch wrappers, runtime shape guard, and no IndexedDB/Firebase
  coupling.
- **Idempotent commit pipeline.** Sequential, never `Promise.all`. Real
  ids come from the DataProvider's returned values; descendants are
  skipped (not faked) if a parent create fails.
- **Clean separation of concerns.** Library modules know nothing about
  React; React components know nothing about the DataProvider beyond a
  thin adapter; the commit pipeline knows nothing about persistence.
- **High test coverage.** 204 tests across 12 files cover parser, compiler,
  validator, summary, fixtures, draft store, commit pipeline, and UI.

### Safety / Trust

- **No auto-commit.** Create functions are never called outside the
  explicit Approve handler.
- **No hidden database writes.** The feature never imports
  `@/lib/database`, Firebase, or IndexedDB. All persistence goes through
  the `DataProvider` (real entities) or `localStorage` (drafts only).
- **No external network calls.** No `fetch`, no OpenAI, no LLM, no third-
  party HTTP.
- **No fake rollback.** Failures surface as visible `partial`/`failed`
  statuses with per-entity `skipped[]` and `errors[]` lists.
- **Every failure is visible.** Status pill, severity-grouped issues
  panel, blocked-reasons list, per-entity error rows.
- **Idempotent re-commit.** `GAI_KEY` markers in entity descriptions let
  the user safely re-run a commit after editing or after a partial
  failure.
- **Double-click protected.** A `useRef` latch makes a second Approve
  click a no-op while the first is in flight.

### Result — Concrete Numbers

| Metric | Value |
|---|---:|
| Library test files | 11 |
| UI test file | 1 |
| Tests in this feature | 204 (187 lib + 17 UI) |
| Full repo test count | 359+ |
| Build status | green |
| Lint status | green (no warnings in this feature tree) |
| `any` usages in this feature | 0 |
| Direct DB / Firebase / IndexedDB imports in this feature | 0 |
| `fetch` / OpenAI / external HTTP in this feature | 0 |
| Destructive delete calls in this feature | 0 |
| Lines of pure TypeScript in the engine | ~2.8k |
| Lines of React UI | ~1.4k |
| Major modules | 14 library + 14 UI components |

### What I Would Build Next

- A small "Promote direct task to project" affordance in the review tree
  so users don't have to re-Generate just to fix orphan tasks.
- A drafts manager UI exposing the per-`draft.id` storage slot already
  supported by `draftStore.ts`, so users can iterate on multiple goal
  architectures side by side.
- A short post-commit diff: highlight which entities were freshly created,
  which were matched as duplicates, which were skipped, with one-click
  jumps to the OKR Manager.
- A read-only "share" view that renders a draft as a portfolio-friendly
  snapshot.

The interesting work in this feature was not in the parser or the UI but
in the seams: a strict separation between draft and reality, a commit
pipeline that refuses to invent ids, and an idempotency strategy that
makes destructive rollback unnecessary. That is what makes the feature
trustworthy enough to ship.
