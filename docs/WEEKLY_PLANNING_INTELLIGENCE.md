# Weekly Planning Intelligence

> Deterministic, local-first, draft-first weekly planner that turns natural-language intentions into a reviewable week of real TimeBlocks — with plan-vs-actual calibration.

---

## 1. Problem

Most users fail at weekly planning for the same reasons:

- They open a calendar, see empty slots, and freeze.
- They overcommit on Monday and burn out by Wednesday.
- The plan and the execution drift apart silently — by Sunday, nobody remembers what the plan even was.
- AI planners feel magical for a week and untrustworthy afterwards because they cannot explain what they did or why.

What's missing is a **bridge** between intention and execution: a system that lets you write *"this week I want to study the Catalan on Monday, hit the gym four times, and read every night"* and turn that into a real, visible week — without lying about it.

## 2. Product Idea

```
Natural-language weekly intentions
     → Parser  (deterministic, no AI)
     → Goal/Project/Task mapping
     → Routine expansion + scheduler
     → Conflict detection + realism score
     → Editable draft (saved locally)
     → Human approval
     → Real TimeBlocks created via the existing DataProvider
     → Plan-vs-actual review next week
```

Five hard guarantees:

1. **Deterministic-first** — the MVP runs locally with regex + tables. Same input → same draft. No LLM, no API key, no opaque output.
2. **Draft-first** — nothing gets written to the user's calendar until they explicitly approve.
3. **Local-first** — drafts live in `localStorage`. No data leaves the device pre-approval.
4. **Human-in-the-loop** — every mapping, every block, every conflict is reviewable.
5. **No fake productivity** — maintenance routines are not committed as fake "goals"; unmapped blocks are surfaced, not silently dropped.

## 3. Architecture

```
src/lib/weeklyPlanner/                   ← pure engine, no React, no DB
  ├ types.ts                             — strict TS types + defaults
  ├ timeUtils.ts                         — HH:mm math + stable id (djb2)
  ├ parser.ts                            — text → ParsedIntent[]
  ├ goalMapper.ts                        — intents → Goal/Project/Task
  ├ routineEngine.ts                     — recurrence → per-day blocks
  ├ scheduler.ts                         — pipeline + greedy overlap resolver
  ├ conflicts.ts                         — overlap, overload, missing goal, …
  ├ scoring.ts                           — realism score 0..100 + breakdown
  ├ draftStore.ts                        — localStorage (SSR-safe + guarded)
  ├ commitDraft.ts                       — validate + map + commit pipeline
  ├ analytics.ts                         — WPI_KEY parsing + plan-vs-actual
  └ index.ts                             — public barrel

src/components/WeeklyPlanning/           ← UI, consumes engine read-only
  ├ WeeklyPlanningTab.tsx                — container + provider-free View
  ├ WeeklyIntentInput.tsx                — textarea + actions
  ├ GoalMappingReview.tsx                — mapping cards
  ├ DraftWeekCalendar.tsx                — 7-day grid
  ├ PlanWarningsPanel.tsx                — conflicts + warnings
  ├ RealismScorePanel.tsx                — score breakdown
  ├ ApprovePlanPanel.tsx                 — safe commit button
  ├ WeeklyIntelligenceReviewPanel.tsx    — plan-vs-actual review
  ├ WeeklyPlanningEmptyState.tsx         — first-paint hero
  ├ WpiWeeklyExecutionSummary.tsx        — non-invasive shim for WeeklyExecution
  ├ weeklyPlanningAdapters.ts            — Goal/Project/Task → *Like
  └ weeklyPlanningUi.ts                  — colors, formatters
```

**Boundary contract**: the only mutation surface is `useDataContext().createTimeBlock`. The engine never imports React, the UI never imports `database.ts`.

## 4. Safety Model

| Guarantee | How it's enforced |
|---|---|
| Deterministic | No `Math.random` in core. IDs come from a stable djb2 hash. |
| Draft-first | `WeeklyPlanDraft.status === 'draft'`. Approval is the only path to a real TimeBlock. |
| Local-first | Drafts in `localStorage` with `weekly-plan-draft:${user}:${weekStartISO}` key. SSR-safe wrapper that returns `null` on any error. |
| Human approval | Approve button disabled when any block is unmapped / needs-review / in error-conflict / invalid-time. Reasons surfaced inline. |
| No AI | `grep -r "openai\|fetch" src/lib/weeklyPlanner` → 0 hits. |
| No direct DB writes | The engine has zero imports from `@/lib/database`. |
| Idempotency | Every committed block carries `WPI_KEY: wpi:${draft.id}:${block.id}` in its `notes`. Re-approve is a no-op. |
| Type safety | `strict: false` at the repo level → the module imposes "no `any`" by self-discipline + a sweep that's checked in CI-style grep. |

## 5. Data Flow

```
WeeklyIntentRaw          { id, text, weekStartISO, createdAtISO }
        │
        ▼
parseWeeklyIntent()      → ParsedIntent[]
        │
        ▼
mapIntentsToGoals()      → GoalMappingCandidate[]   (domain anchor + synonyms)
        │
        ▼
expandRoutineIntents()   → DraftTimeBlock[]         (recurrence × days)
        │
        ▼
resolveSchedule()        → DraftTimeBlock[]         (greedy buffer-aware)
        │
        ▼
detectConflicts()        → PlanConflict[] + PlanWarning[]
        │
        ▼
scorePlanRealism()       → PlanRealismScore (0..100, explainable)
        │
        ▼
WeeklyPlanDraft  ─── saveWeeklyPlanDraft() ─→ localStorage
        │
        ▼
[Human approval]
        │
        ▼
validateDraftForCommit() → classify each block (commit / skip / blocking)
        │
        ▼
commitWeeklyPlanDraft()  → sequential await of DataProvider.createTimeBlock
        │                  with WPI_KEY in notes + duplicate guard
        ▼
TimeBlock[] (real, persisted)
        │
        ▼
calculateWpiWeeklyAnalytics(timeBlocks, weekStartISO, matchedDraft)
        │
        ▼
WpiAnalyticsResult  →  Weekly Intelligence Review panel
```

## 6. User Flow

1. **Open Weekly Intelligence** tab (`🧭` icon in the nav).
2. **Write or Load Example** in the textarea (5+ lines anchored on the 5 user goals).
3. **Generate Draft Week** — engine runs locally; draft saved to `localStorage`.
4. **Review** mapping cards: confirm "Catalana → Chess Mastery / Openings / Catalan Course", etc.
5. **Inspect** the 7-column draft calendar, the conflicts panel, the realism score.
6. **Approve** — sequential commit creates real TimeBlocks via `DataProvider.createTimeBlock`. Each carries a `WPI_KEY` in its `notes` for idempotency.
7. **Execute the week** in the existing Time Planner tab — mark blocks as `completed` / `cancelled` / etc.
8. **Return to Weekly Intelligence** — the Review panel shows plan-vs-actual: completion rate, planned/completed hours, day breakdown, realism calibration (well calibrated / overestimated / underestimated).
9. **Iterate** the following week with the calibration learning in mind.

## 7. Testing

Three layers of tests, all under `vitest`:

| Layer | File | Test count | What it proves |
|---|---|---|---|
| Engine — parser | `parser.test.ts` | 11 | IT+EN parsing, days, durations, recurrence, confidence |
| Engine — goal mapper | `goalMapper.test.ts` | 9 | Domain anchor + synonym matching, maintenance shortcut |
| Engine — routine engine | `routineEngine.test.ts` | 9 | daily=7, weekdays=5, 4x={0,1,3,5}, default times |
| Engine — scheduler | `scheduler.test.ts` | 6 | End-to-end pipeline, determinism, slide-on-overlap |
| Engine — conflicts | `conflicts.test.ts` | 11 | Overlap, overload, missing_goal, routine_collision, … |
| Engine — scoring | `scoring.test.ts` | 5 | Clean vs overloaded, error > warning, clamp |
| Engine — draft store | `draftStore.test.ts` | 12 | Save/load/delete, SSR/JSON guards, type guard |
| Engine — commit | `commitDraft.test.ts` | 21 | Classifier, mapping, duplicates, idempotency, partial |
| Engine — analytics | `analytics.test.ts` | 26 | WPI key parsing, status mapping, 4 calibration bands |
| UI — Weekly Planning Tab | `WeeklyPlanningTab.test.tsx` | 16 | Persistence, commit, double-click, review panel states |

**Total: 126 tests across the feature.** The whole engine is regression-locked end-to-end.

## 8. Limitations

- The parser is deterministic and IT+EN only at MVP. Long compound sentences may need to be split by the user.
- Maintenance routines (wake-up, weekly review) are deliberately *not* committed as TimeBlocks in the MVP — they belong in the `Habit` module, which we don't touch.
- No external calendar sync (Google / Outlook). The feature lives inside the Time Planner.
- No AI assistant in MVP. Optional Phase 5+.
- Analytics depend on the user marking TimeBlocks as `completed` / `cancelled`. If the user never updates statuses, completion rate stays 0.
- Drafts persist in `localStorage` only (no IndexedDB / no Firebase). One draft per user × week.
- `TimeBlockStatus` has no `partial` value; partially completed blocks are not separable in this MVP.

## 9. Roadmap

| Phase | Item |
|---|---|
| 5.1 | Manual remap UI in `GoalMappingReview` so the user can override an `unmapped` block |
| 5.2 | Recurring routines (commit "Mi sveglio alle 7" as a real recurring TimeBlock series) |
| 5.3 | Integration with the `Habit` module (wake-up routine ⇄ habit log) |
| 5.4 | Calendar sync (Google iCal) |
| 5.5 | Historical calibration trend chart (4-week rolling completion rate) |
| 5.6 | Mobile polish (current MVP is desktop-first) |
| 6.x | Optional AI parser as a fallback for ambiguous lines (opt-in, behind a flag) |
| 6.x | Better scheduling constraints (per-day caps, fatigue model) |

## 10. Portfolio Note

This feature is built to demonstrate the kind of engineering I bring to a product:

- **Product thinking** — solves a *real* user problem ("why do I keep failing my weekly plan?") with a concrete, testable workflow.
- **Architecture** — a clean engine/UI split with a documented boundary contract; the engine has zero React, the UI has zero DB calls.
- **Deterministic planning** — a non-AI engine that explains every decision; the realism score has explicit `notes[]` for each penalty.
- **Local-first** — drafts never leave the device pre-approval; the UI works offline.
- **Safety reviewer mindset** — explicit blocking rules, idempotency keys, sequential commit, latch against double-click, classifier shared between UI and runtime so they can't drift.
- **Analytics** — plan-vs-actual calibration that closes the loop and gives the user a learning signal, not just numbers.
- **TypeScript** — `strict: false` at the repo level → zero `any` self-imposed across the entire feature (~3800 lines), verified by grep.
- **Testing discipline** — 126 tests across parser, mapper, scheduler, persistence, commit, analytics and UI.
- **Documentation** — this file + per-prompt review reports in `docs/`.

The result is a feature that is **explainable to a product manager**, **safe enough to ship**, and **simple enough to evolve** when the user signals what they want next.
