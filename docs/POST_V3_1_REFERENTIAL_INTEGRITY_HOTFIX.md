# Life Tracker — Post-V3.1 referential-integrity hotfix receipt

## Verdict

**POST-V3.1 REFERENTIAL INTEGRITY HOTFIX READY — MANUAL TODAY CONFIRMATION REQUIRED**

The current-state invariant is enforced and covered across authoritative
hydration, Goal deletion, Today, Weekly Planning, reminders, reload, and
simulated restart. The production NSIS was built from the exact clean hotfix
checkpoint, installed in place, and launch-smoke verified. No production data
was changed, cleared, migrated, or deleted, and no production record was
inspected as part of the diagnosis. Consequently, the final
visual confirmation that Francesco's existing production ghost is absent from
Today is intentionally left manual; the disposable Goal `p` was not touched.

## Release identity

- Repository: `C:\Users\Franc\Desktop\LIFE_TRACKING`
- Starting branch: `codex/final-elite-v3-1`
- Starting local/upstream SHA:
  `01023bc8ddf19c2d08ab5221a72835e8ad52df57`
- Accepted installed V3.1 source lineage:
  `75f176de0040957bf7e135ee3b8ab7dd8f3ea121`
- Hotfix branch: `codex/post-v3-1-referential-integrity`
- Final implementation and embedded Desktop source SHA:
  `ca1f14eba0e6e25fa53cecbff429c1e71d5cf324`
- Remote implementation HEAD verified after push:
  `ca1f14eba0e6e25fa53cecbff429c1e71d5cf324`
- The documentation-only commit containing this receipt necessarily follows
  the embedded implementation SHA; its exact remote tip is reported in the
  terminal handoff.

The starting V3.1 worktree was clean and local HEAD equalled upstream. No
reset, force-push, history rewrite, merge, cloud deployment, or production-data
mutation occurred.

## Exact root cause and provenance

The displayed phrase was searched in the entire current repository and with
Git history pickaxe/regex searches:

`i 100 studi che bisogna conoscere`

It had zero source or history matches before the regression fixture was added.
Therefore it is not a seed, migration, bootstrap default, cached source
snapshot, or hard-coded Today fallback.

The exact display path is:

`Firebase Auth UID -> users/{uid}/tasks/{taskId} -> DataProvider.tasks -> MainApp -> TodayCommandCenter.pickTopTasks -> Priorità di oggi`

Evidence:

- authenticated startup switches directly to the Firebase adapter and loads
  `tasks`; it does not hydrate production Tasks from IndexedDB or localStorage;
- the Firebase adapter stores that collection at
  `users/{authenticatedUid}/tasks` and enforces owner-scoped paths;
- Today rendered `task.title` and the `task.priority` chip directly;
- before this hotfix, Today excluded only deleted/completed/cancelled Tasks and
  never validated Project or Goal existence;
- no Key Result, Project, Weekly draft, TimeBlock, Session, reminder cache, or
  Today snapshot can supply that exact field to the priority list.

Classification: **A — orphan Task**, combined with **J — shared current-state
selector/reconciliation bug**. The persistence location is an undeleted
owner-scoped Firestore Task document. Its exact production document ID and
whether its stale link is an empty `projectId` or an ID for a deleted Project
were deliberately not inspected because production data was out of scope.
Both forms, plus stale `goalId`/`goalIds`, are covered by the invariant.

The Task survived operationally because older deletion behavior had already
left it outside the surviving canonical Goal/Project set, while current V3
deletion can only physically delete children discoverable from owner-scoped
Goal, Project, `goalId`, and `goalIds` relationships. The V3 Today selector then
treated every remaining open Task as current, even when its mandatory
Project-to-Goal parent chain no longer existed.

## Canonical deletion audit and matrix

V3.1 canonical Goal deletion remains owner-scoped and atomic. It rereads the
Goal, Key Results, Projects, and Tasks from the server, builds one deletion
plan, commits one Firestore batch, and only then updates UI state. A failed
batch throws, leaves the hierarchy visible, and the Goals UI shows a bounded
error. A repeated delete is a safe no-op after authoritative absence.

| Entity/evidence | Current-state rule after Goal deletion | Durable action | Historical rule |
| --- | --- | --- | --- |
| Goal | absent | physical atomic delete | report artifacts remain |
| Key Result | requires a live owner Goal | physical atomic delete when linked | immutable report evidence remains |
| Project | requires a live owner Goal | physical atomic delete when linked | no reconstruction from history |
| Task | requires a live owner Project; every Goal reference must exist | physical atomic delete when discoverable; legacy orphan fails closed | completed execution evidence remains separate |
| Today priority/mission | only coherent current Tasks | derived, never persisted | no historical fallback |
| Weekly Plan draft | every stored mapping ID must still be current | only the exact owner/week local draft is removed when stale | unrelated localStorage and committed blocks remain |
| Future/non-terminal TimeBlock | every Task/Project/Goal reference must exist | retained in Firestore but suppressed from current consumers | no destructive policy invented |
| Completed/cancelled/overrun TimeBlock | cannot become current/reminder work | untouched | preserved for planning/execution history |
| Completed Session | never recreates a Task/Goal | untouched | preserved as authoritative execution evidence |
| Reminder dispatch | requires one live matching non-terminal TimeBlock and coherent parents | claimed idempotently; stale presentation rejected | no reminder architecture change |
| Analytics/report evidence | cannot repopulate current Tasks | untouched | preserved, including immutable report archives/hashes |
| Selected Goal/Project | must exist in the reconciled portfolio | stale UI selection cleared | no persistence mutation |
| Goal roadmap | requires a current Goal | hidden from current portfolio when orphaned | raw document untouched |

The remaining Goal `p` and a coherent `p` hierarchy are explicitly retained by
the selector regression. No production fixture was created and `p` was not
modified.

## Fix

One shared, read-only reconciliation layer now derives current operational
Goal, Key Result, Project, Task, TimeBlock, and roadmap collections from the
raw owner snapshot. Raw state remains available internally for authoritative
CRUD and historical evidence. Current consumers—including Today, Planner,
Auto Scheduler, Adapt Plan, Goals, Now/Next, alarm context, selectors, and
creation candidates—receive the reconciled state.

Additional bounded defenses:

- Today independently revalidates its Task parent chain;
- a claimed Desktop reminder cannot surface a denormalized stale title unless
  it resolves to one unique live TimeBlock with coherent parents;
- the current owner's exact current-week Weekly Plan draft is removed if a
  saved mapping references a deleted entity, but only after authoritative data
  is ready; no broad localStorage/IndexedDB clearing occurs;
- selected Goal/Project state reconciles after authoritative refresh;
- aggregate orphan counts are logged without titles or document payloads, so
  rejection is diagnosable rather than silent.

No backend, Firebase Rules/index, report/email, theme, alarm mode/sound,
MCP/OAuth, Secure AI, or cloud resource was changed.

## Files changed

- `src/lib/currentOperationalState.ts`
- `src/lib/currentOperationalState.test.ts`
- `src/providers/DataProvider.tsx`
- `src/providers/DataProvider.test.tsx`
- `src/components/shell/TodayCommandCenter.tsx`
- `src/components/shell/TodayCommandCenter.test.tsx`
- `src/components/WeeklyPlanning/WeeklyPlanningTab.tsx`
- `src/components/WeeklyPlanning/WeeklyPlanningTab.test.tsx`
- `src/lib/desktop/executionAlarm.ts`
- `src/lib/desktop/executionAlarm.test.ts`
- `src/components/desktop/DesktopReminderRuntime.test.tsx`
- `src/components/OKRManager.tsx`

## Test and security evidence

| Gate | Result |
| --- | --- |
| Focused referential/deletion/Today/DataProvider/Planner/Weekly/reminder matrix | PASS — 21 files / 218 tests |
| Full frontend regression | PASS — 79 files / 796 tests |
| `npm run typecheck` | PASS, exit 0 |
| `npm run build` | PASS, exit 0; four static pages; root 247 kB / 350 kB first load |
| `npm run test:desktop:config` | PASS — 8/8 suites |
| `npm run check:static-security` | PASS before and after staging |
| `npm run check:desktop-security` | PASS |
| `git diff --check` / cached diff check | PASS |
| Production Desktop export + output-inclusive security scan | PASS |
| Installer/executable/installed-executable credential scan | CLEAN; no high-confidence OpenAI, Resend, Twilio, private-key, bearer-JWT, GitHub, Slack, or AWS credential shape |
| Firestore Rules emulator | NOT RUN — no Rules/backend change; Java was not installed |

The exact observed Italian title and `critical` priority are covered in Today,
operational-state, DataProvider reload/restart, and reminder rejection tests.
The regression creates only disposable in-memory fixtures, proves the valid
Task appears before deletion, deletes its Goal canonically, and proves absence
after rerender, authoritative reload, unmount/remount, repeated deletion, and
simulated restart. Terminal TimeBlocks, a completed Session fixture, report
evidence, and Goal `p` remain intact.

## Production Desktop and installation

- Production profile: `production`
- Firebase project: `life-tracker-12000`
- Runtime: `desktop`
- Secure AI endpoint:
  `https://europe-west1-life-tracker-12000.cloudfunctions.net/lifeTrackerAiApi`
- Exact installer path:
  `C:\Users\Franc\Desktop\LIFE_TRACKING\src-tauri\target\release\bundle\nsis\Life Tracker_1.0.0_x64-setup.exe`
- Installer size: 2,434,449 bytes
- Installer SHA-256:
  `fb2b729e7a8e5412193734226b3001c620b9ce739c79eaaef7a1cb5303e30023`
- Built executable SHA-256:
  `7490e74caa24f7e01de52ce65ab5dc081a3b99bf024a3b7d8c5bb010bffd2736`
- Embedded source SHA:
  `ca1f14eba0e6e25fa53cecbff429c1e71d5cf324`
- Authenticode: `NotSigned` (unchanged distribution limitation)

The prior Life Tracker process was closed without uninstalling. The first
`cmd.exe` invocation failed before starting the installer because its quote
wrapper was rejected; the exact installer was then invoked through Windows
`Start-Process` with uppercase `/S` and returned exit code 0. No app-data path
was removed or cleared.

Installed verification:

- install location: `C:\Users\Franc\AppData\Local\Life Tracker`;
- registry DisplayName `Life Tracker`, version `1.0.0`, current-user
  uninstaller and install location present;
- installed executable SHA-256:
  `68c6b0b796f76a14d57542351bc27ba7ec8bcef9e2cf4074ff234c70ccb99d21`;
- installed executable contains the `life-tracker-12000` production marker;
- launch process path matches the install location;
- window title `Life Tracker`; Windows reports the process responsive;
- installed executable credential scan CLEAN.

The WSL process-specific Windows interop socket timed out after installation;
the live distro-level interop socket was selected and the same read-only launch
smoke completed successfully. This did not affect the installer or app.

Exact manual installation instruction if reinstalling:

`"C:\Users\Franc\Desktop\LIFE_TRACKING\src-tauri\target\release\bundle\nsis\Life Tracker_1.0.0_x64-setup.exe" /S`

## Deployment, rollback, cost, and residual acceptance

Production resources deployed: **none**. No Functions, Scheduler, Rules,
indexes, secrets, IAM, Auth, MCP/OAuth, reports/email, or production documents
were changed. Cloud cost impact: **none**.

Rollback requires no data rollback. Rebuild the production Desktop installer
from `codex/final-elite-v3-1` at
`01023bc8ddf19c2d08ab5221a72835e8ad52df57` and run its current-user installer
in place. The previous binary was replaced by the requested update and is not
retained as a separate rollback artifact in this workspace.

Residual acceptance: open Today after the existing authentication state is
restored and confirm `i 100 studi che bisogna conoscere` is absent. This is a
read-only visual confirmation; do not delete or modify Goal `p`.
