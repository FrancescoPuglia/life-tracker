# Life Tracker OS progress checkpoint

Last updated: 2026-08-25 (Europe/Rome)

## Resume identity

- Repository: `FrancescoPuglia/life-tracker`
- Working branch: `codex/life-tracker-os`
- Master starting SHA: `df99a6c2e1f06beb4fd9a6cb18e6565c5b25400b`
- Current implementation checkpoint SHA: `c4daf4311a73990357870e14819564ba6a0bf005`
- Remote master branch: `origin/codex/life-tracker-os` (established)
- Worktree at checkpoint start: clean

## Immutable verified prerequisite

Goal 1 remains complete and is not being rebuilt.

- Final receipt SHA: `df99a6c2e1f06beb4fd9a6cb18e6565c5b25400b`
- Reviewed/deployed source: `bef7b11c3ea2881b82b72faf52ebea61f251766b`
- Staging revision: `lifetrackeraiapi-00010-les`
- Staging model: `gpt-5.6-sol`
- Verdict: `LIFE TRACKER SECURE AI STAGING VERIFIED`
- Canonical evidence: `docs/SECURE_AI_VERIFICATION_RECEIPT.md` and
  `docs/SECURE_AI_STAGING_PROGRESS.md`

The final Goal 1 evidence records all 14 required live lifecycle flows, complete
synthetic mutable-state cleanup, production isolation, 624 frontend unit tests,
174 Functions unit tests, 49 Rules tests, 2 Auth tests, 32 transaction-emulator
tests, 3 integrated browser tests, 1 static-export browser test, builds,
typechecks, and security scans. Re-run only affected Goal 1 gates when a later
slice changes one of those trust boundaries.

## Completed milestone

### Master initialization

- Confirmed `pwd`, branch, HEAD, clean status, remote, upstream, cached remote
  HEAD, and recent commits.
- Queried live GitHub refs: remote HEAD is `main` at `5ea3280`; verified staging
  is `df99a6c`; `codex/life-tracker-os` did not exist locally or remotely.
- Created `codex/life-tracker-os` directly from the clean Goal 1 receipt without
  merge, reset, force-push, or history rewrite.
- Read the repository guidance, complete Goal 1 receipt/progress record, Secure
  AI architecture/runbook, Firebase configuration, package manifests, and the
  relevant frontend/auth/static-export structure.
- Confirmed the app is a single client-side App Router surface and already has
  a proven static export. Next.js `15.5.23` is compatible in principle with the
  official Tauri 2 static-export integration (`output: 'export'`, `out` as
  `frontendDist`). A desktop-specific proof remains to be run.
- Confirmed no Tauri structure exists yet and Rust/Cargo are not installed in
  the current WSL environment. Native Windows toolchain availability remains to
  be checked without treating updater work as an R1 blocker.

### R1 desktop static-export compatibility

- Green commit: `711d00cd405d500f43261e689086c27081b0a2a0`
- Added separate, exact `staging` and `production` Desktop build profiles.
- Desktop builds bind the Firebase Web manifest and canonical project-owned
  HTTPS `lifeTrackerAiApi` endpoint at build time and reject an ambiguous or
  mismatched profile.
- The staging API-key input is public Firebase Web configuration but is still
  matched by SHA-256 and is never printed by the build script.
- Desktop artifacts attest their immutable Git SHA, runtime (`desktop`),
  environment, and exact AI backend in exported HTML.
- The release build requires a clean committed tree, clears known provider
  secret variables, runs the existing output-inclusive security scan, and
  verifies every public attestation after export.
- The existing GitHub Pages profile retains its `/life-tracker` base path and
  was not redirected or unpublished.
- Proved Next.js `15.5.23` emits a valid root Desktop static export from the
  real repository. This build-only proof compiled production public endpoints
  but made no Firebase, backend, provider, or production-data request.

### R1 least-privilege Tauri 2 shell

- Green commit: `6482346d40aeaac21a0c2851bc984eaed643c3b8`
- Added a pinned Tauri 2 shell: CLI `2.11.4`, JavaScript API `2.11.1`, Rust
  `tauri` `2.11.5`, notification plugin `2.3.3`, autostart plugin `2.5.1`, and
  single-instance plugin `2.4.3`.
- The main window receives only 11 enumerated window/notification/autostart
  commands. It receives no shell, filesystem, process, native HTTP, updater,
  raw menu/tray, or custom Rust command capability; no remote origin receives
  native IPC access.
- Added strict staging and production CSP profiles, frozen custom-protocol
  prototypes, active Tauri CSP rewriting, no global Tauri object, no asset
  protocol, no developer tools, and no updater artifacts.
- Tray/menu creation and show/focus/quit handling live in Rust. Closing hides to
  the tray; a shortcut/second launch focuses the existing instance.
- Added official native notification and user-controlled autostart plugins.
  Neither path can mark execution complete or mutate Life Tracker domain data.
- Added isolated NSIS/current-user Beta packaging metadata and a separate
  production identifier. Beta and production use visibly distinct generated
  Windows icons sourced from reviewable SVG assets.
- The existing Pages runtime and its deployment workflow were not changed.
- Identified the next required staging integration boundary: the verified AI
  Function currently allows the Goal 1 browser origins, not the installed
  Tauri origin `https://tauri.localhost`. R1 Ask AI must remain NOT VERIFIED
  until the allowlist is updated, affected CORS tests pass, the exact Function
  is redeployed to staging, and the installed Beta proves the request.

### R1 native controls and installed Windows Beta

- Green implementation commits through `52ee54f03976de81fb4b8488b3e9ba599a91330e`.
- Added a Settings surface backed by a dynamically loaded native bridge. It
  exposes explicit notification permission/test controls, user-controlled
  autostart, runtime/environment/backend status, and normalized non-secret
  failures. Merely opening Settings never requests permission.
- Notification interaction can only unminimize, show, and focus the app. It has
  no Task, TimeBlock, Session, completion, apply, or rollback mutation path.
- Added only `notification:allow-register-listener` to support that focus path;
  the exact capability allowlist remains otherwise unchanged and still denies
  shell, filesystem, process, native HTTP, updater, and custom Rust commands.
- Added the exact installed Tauri WebView origin `https://tauri.localhost` to
  the Function CORS policy with negative tests for HTTP, subdomain, and explicit
  port near-matches. The ignored staging runtime parameter now retains the two
  verified Goal 1 origins and adds exactly this Desktop origin.
- Affected Secure AI regression passed locally: 32/32 CORS, HTTP boundary, and
  runtime-attestation tests; Functions typecheck/build passed. The staging
  Function was **not deployed** because the managed approval gate requires a
  separate exact human approval for deployment. Goal 1 revision `00010-les`
  therefore remains authoritative until that approval is received.
- Added a no-key-logging resolver for the registered staging Firebase Web app.
  It captures Firebase CLI JSON in memory, validates the exact project-bound
  fields and pinned public API-key hash, clears provider-secret variables, and
  never prints the public key.
- Replaced Windows `.cmd` shim execution with direct pinned JavaScript CLI
  entry points for Tauri, npm, and Next. A bounded read-only diagnostic review
  confirmed the causal Node/Windows launcher failure and recommended the
  no-shell remediation. Cross-platform tests cover discrete arguments and
  reject ambiguous/shim inputs.
- Bound the private `@life-tracker/ai-contract` workspace package directly to
  reviewed repository source for TypeScript/Webpack so the Windows build does
  not depend on a WSL-created symlink.
- Produced a real Windows x64 NSIS installer from the clean checkpoint and
  installed it current-user. Windows registry records Life Tracker Beta
  `1.0.0` at `C:\Users\Franc\AppData\Local\Life Tracker Beta`; a normal Start
  Menu shortcut exists.
- Installed launch passed with the exact title `Life Tracker Beta - Staging`.
  Close hid the window while retaining one process; a second launch restored
  and focused that same PID; a full idle-process restart created a new healthy
  PID and visible window.
- Installed authentication, entity workflows, Ask AI, and the notification
  permission/toast interaction remain **NOT VERIFIED** pending the CORS deploy
  approval and direct installed-UI acceptance. R1 remains in progress.

### Production read-only audit and timestamp compatibility

- Green compatibility commit: `3545280d3b7f16543db27963a90089ca9a8fea55`.
- Completed the explicit-target read-only audit of `life-tracker-12000`; no
  production resource, data, API, billing, Rules, index, backup, Auth setting,
  Hosting release, or GitHub setting changed.
- Production has Native Firestore in `europe-southwest1`, broad owner-path Rules,
  no composite index/TTL, no PITR/delete protection/backup, no production cloud
  backend APIs, and no billing link. Backend promotion is an explicit human
  cost/plan gate.
- All audited embedded owners matched their owner-scoped paths. Production
  TimeBlocks use legacy timestamp maps; the client sanitizer had been flattening
  SDK timestamp/server-transform instances. The compatibility commit preserves
  SDK atomic values and safely normalizes legacy maps during legitimate reads
  and full user updates.
- The official Rules emulator proves malformed legacy maps remain rejected and
  a legitimate native-timestamp normalization update succeeds: 49/49 PASS.
  Frontend regression is 53 files / 639 tests PASS; typecheck and static security
  pass.
- The installed `52ee54f` Beta remains valid evidence for packaging, launch,
  tray, single-instance, and restart, but is superseded as a release candidate
  by the client compatibility change. Rebuild/reinstall is required before R1
  workflow acceptance.
- Added `docs/PRODUCTION_READ_ONLY_AUDIT.md`. Exact personal collection counts
  are intentionally not committed while GitHub is public; recapture them after
  R7 for the private final receipt.

### R3 deterministic notification domain

- Green implementation commit: `95985185aa52b3612b394d85879af2cf737fa45f`.
- Added provider-neutral, versioned `NotificationPreferences`, `ReminderPolicy`,
  `ReminderJob`, `ReminderTaskPayload`, and delivery-decision contracts. Desktop,
  WhatsApp, and email preferences share one owner-bound domain while reminder
  jobs remain limited to Desktop and WhatsApp delivery channels.
- Preferences are opt-in by default, use the persisted valid timezone when
  present, and otherwise fall back to `Europe/Rome`. Offsets, quiet hours,
  locale, delivery caps, and daily/weekly report schedules are normalized and
  bounded deterministically.
- Reminder identities and idempotency keys are privacy-safe SHA-256 values over
  owner/path, authoritative schedule version, policy version, channel, kind,
  and instant. User titles, Notes, descriptions, and provider content never
  enter queue payloads or authority/version material.
- Planning excludes deleted, disabled, cancelled, completed, overrun, and
  actually ended blocks. The delivery decision rereads authoritative owner,
  block, schedule, execution, policy, quiet-hour, per-channel cap, and consumed
  idempotency state before permitting a send.
- Stale move/policy jobs, deleted/completed blocks, already-started missed
  reminders, duplicate retries, and disabled channels all fail closed. Quiet
  hours use the persisted IANA timezone and are covered across Europe/Rome DST
  start and end transitions.
- This slice is pure deterministic domain code only. It does not create a Cloud
  Task, deploy a Function, send a notification, call a provider, or mutate any
  Firebase project.

### R3 durable reconciliation and queue boundary

- Green implementation commit: `1bb03cb8a36a615f3a8b1485ec31dca6f75bf202`.
- Added an atomic repository contract for durable reminder jobs and an
  injectable provider-neutral task queue. Stored states distinguish local
  Desktop availability, pending/scheduled cloud work, supersession, delivery
  outcomes, and sanitized enqueue/cancellation failures.
- Reconciliation persists the exact desired job set before external queue work.
  It schedules only WhatsApp jobs in the cloud queue; Desktop jobs stay
  `client_pending` for the native client path.
- Replays do not enqueue an already scheduled job. Concurrent identical runs
  converge on one deterministic task ID. If a block moves after enqueue but
  before the scheduled-state transaction, the newly created stale task is
  immediately cancelled best effort and remains superseded in durable state.
- A cancellation failure does not reactivate obsolete work: it is recorded as
  sanitized infrastructure state and the future authenticated worker must still
  reread and suppress the superseded/version-mismatched job. An enqueue failure
  becomes `schedule_failed` and only that unscheduled job is retried.
- Tests use a serialized in-memory transactional repository and idempotent fake
  queue. No Firebase project, Cloud Tasks API, provider, secret, billing state,
  or external message was touched.

### R3 owner-scoped Firestore reminder persistence

- Green implementation commit: `4d821b3a8ec7e241fc7f27d802b412c2b589e451`.
- Added an Admin SDK repository that independently validates owner/path,
  deterministic job identity, schema, state, native timestamps, and task IDs.
  Jobs live under `users/{uid}/reminderJobs/{hash}`; the caller cannot select an
  arbitrary Firestore path.
- Each TimeBlock has one server-only manifest containing at most 16 active job
  IDs. Reconciliation transactionally reads only the old/new bounded union,
  avoiding global polling, unbounded history queries, and a new composite
  index. Job/manifest TTL metadata retains records for 90 days; the reviewed
  index file contains the additive TTL declarations but nothing was deployed.
- Added strict client Rules for exactly one normalized
  `notificationPreferences/default` document. Clients may control only bounded
  channel/schedule preferences; provider identity, jobs, manifests, attempts,
  receipts, and notification idempotency remain browser-denied. Preference
  lists require an owner-constrained query, and cross-owner/forged/malformed
  writes fail closed.
- Real Firestore transaction-emulator tests prove create/replay, native
  Timestamp storage, moved-job supersession/cancellation, post-enqueue race
  handling, concurrent convergence, corrupt manifest rejection, bounded work,
  hostile-content exclusion, and cross-owner path isolation.
- Superseded diagnostics are recorded honestly: the first Rules run was 55/56
  because a list operation has no bound wildcard document ID; separating `get`
  and owner-constrained `list` fixed it. The first transaction run was 5/6 only
  because emulator cold start exceeded the default 5-second test timeout; the
  established 30-second emulator timeout produced 6/6. Two launcher attempts
  also exited before tests until the verified Java and repository-local
  Firebase CLI were explicitly selected.

### R3 bounded Cloud Tasks adapter and scheduling horizon

- Green implementation commit: `7ee89d2f8647231f0672fd4bdd09e11b4cf14e95`.
- Added a Firebase Admin task-queue adapter targeting only the named private
  worker `locations/europe-west1/functions/deliverReminderTask`. Payloads have
  exactly `schemaVersion`, `uid`, and deterministic hashed `jobId`; no title,
  Note, provider identity, arbitrary header, URL, or raw Firestore path is
  accepted.
- Current official Cloud Tasks limits allow scheduling at most 30 days ahead
  and retain tasks at most 31 days. The adapter deliberately uses a 29-day
  safety horizon. Farther WhatsApp jobs persist as `deferred_enqueue`; a later
  reconciliation atomically promotes them when eligible. Desktop jobs remain
  independent `client_pending` records.
  See [Cloud Tasks quotas](https://docs.cloud.google.com/tasks/docs/quotas).
- Explicit hashed task IDs provide provider deduplication, but current official
  documentation says recently completed/deleted names can remain unavailable
  for up to 24 hours. Durable Firestore idempotency remains required beyond
  queue deduplication. See the
  [tasks.create reference](https://docs.cloud.google.com/tasks/docs/reference/rest/v2/projects.locations.queues.tasks/create).
- Firebase Admin intentionally resolves task deletion whether the task was
  deleted or already absent. The provider-neutral audit state is therefore
  named `resolved`; it never overclaims a confirmed cancellation. Duplicate
  `task-already-exists` enqueue responses are idempotent success, while other
  errors are sanitized.
- The future worker will use `invoker: private`, bounded retries, and bounded
  rate/concurrency as supported by the official
  [Firebase task queue options](https://firebase.google.com/docs/reference/functions/firebase-functions.tasks.taskqueueoptions).
  No queue, worker, API, scheduler, billing state, IAM role, or cloud task was
  created in this slice.

### R3 provider-neutral at-most-once delivery boundary

- Green implementation commit: `a7b5c64b878c2e36b42f3aebb8e68ebf13f5d856`.
- Added provider-neutral delivery claims, message requests, attempts,
  finalization outcomes, and a `MessagingProvider` boundary. Provider-specific
  identities and errors cannot become authorization input or unbounded stored
  state.
- The repository contract must atomically re-evaluate current authority and
  consume idempotency before the first external send. After a claim exists,
  retry recovery finalizes the attempt as uncertain without calling the
  provider again. Provider throws, timeouts, invalid message identities, and a
  lost finalization therefore fail conservatively without duplicate automatic
  delivery.
- This slice deliberately exports no queue worker and implements no Twilio or
  other external provider. Firestore claim/finalization persistence is the next
  trust boundary; no cloud resource, credential, API, billing state, or message
  was touched.

### R3 transactional Firestore delivery claims and receipts

- Green implementation commit: `a90c0b91c76fd0b556de3917c9958022c05de605`.
- The owner-scoped repository now atomically rereads the stored job, current
  TimeBlock, notification preferences, persisted user timezone, durable
  per-block/channel claim counter, and (only for missed-start jobs) one linked
  authoritative Session before allowing a provider call. Moved, deleted,
  completed, ended, disabled, quiet-hours, changed-policy, already-started,
  exhausted-limit, wrong-task, and wrong-owner paths cannot create an attempt.
- A send transaction writes the job claim, deterministic attempt,
  notification-idempotency record, and consumed delivery slot before returning
  any provider message. Duplicate workers serialize; a five-minute claim lease
  exceeds the configured 60-second task dispatch deadline, and abandoned
  claims recover as uncertain without another provider call.
- Finalization is atomic and idempotent across the job, attempt, receipt,
  idempotency record, and accepted counter. Exact replay succeeds; conflicting
  results and incoherent/cross-owner records fail closed. Only bounded reason
  enums and a validated provider message identity persist; raw provider errors,
  Notes, descriptions, credentials, and storage metadata do not cross the
  provider request boundary.
- Added additive 90-day TTL declarations for attempts, receipts,
  notification idempotency, and counters, plus explicit browser denial for the
  counter namespace. Nothing was deployed and no API, IAM, billing, queue,
  provider credential, or external message was touched.
- The first delivery-emulator run was 9/10 only because the test treated a
  Firestore `QuerySnapshot` like an array. Changing the assertion to its real
  `size` property produced 10/10; combined reconciliation/delivery transactions
  then passed 17/17.

### R3 private/internal task-worker boundary

- Green implementation commit: `c4daf4311a73990357870e14819564ba6a0bf005`.
- Added one canonical parser for the exact three-field task payload and reused
  it on both enqueue and dispatch. It rejects extra fields, hostile content,
  malformed UID/job identity, non-plain values, symbols, and task-ID mismatch
  before delivery.
- The deployable worker factory fixes `invoker: private`, same-project
  internal-only ingress, one concurrent dispatch, one dispatch per second, one
  warm-cost-free instance minimum, one maximum instance, a 45-second handler
  timeout, and five attempts within a 15-minute retry window. Current Google
  documentation explicitly recognizes same-project Cloud Tasks as internal
  Cloud Run ingress; see
  [Cloud Run ingress](https://docs.cloud.google.com/run/docs/securing/ingress)
  and [Firebase task functions](https://firebase.google.com/docs/functions/task-functions).
- Platform task ID must equal the deterministic job ID. Retry/execution counts
  and scheduled context are bounded, while current time comes from the server
  clock. `retry_later` and transient execution failures throw only a sanitized
  bounded-retry error; malformed tasks acknowledge with zero delivery so they
  cannot create a poison retry loop. Logs contain only a hash task ID, bounded
  outcome/reason, retry count, and optional canonical retry time—never UID,
  title, Note, payload, auth token, or raw error.
- This checkpoint deliberately exports only the deployable factory, not a
  `deliverReminderTask` function instance. A real provider binding must be
  complete before the named worker can be exported. No function, queue, API,
  IAM binding, provider, secret, billing state, or external message changed.

## Evidence

| Check | Result |
| --- | --- |
| Initial worktree | Clean at `df99a6c` |
| Live remote HEAD | `refs/heads/main` at `5ea328066d207d695fcf689015fd610e3751f457` |
| Verified remote staging | `origin/codex/secure-ai-staging` at `df99a6c` |
| Master branch collision | None locally or remotely |
| Master branch creation | PASS; now on `codex/life-tracker-os` |
| Local Node/npm | Node `22.22.0`; npm `10.9.4` |
| Local WSL Rust/Cargo | NOT AVAILABLE |
| Desktop build-script tests | `npm run test:desktop:config`: PASS (6 test files) |
| Runtime marker tests | `npx vitest run src/lib/runtimeEnvironment.test.ts`: 2/2 PASS |
| Frontend typecheck | `npm run typecheck`: PASS |
| Desktop static export | `TAURI_DESKTOP=true ... npm run build`: PASS; 4 static pages, root route 222 kB |
| Export attestations | Exact SHA/backend/environment/runtime markers: PASS |
| Output security | `npm run check:static-security -- --include-output`: PASS |
| Patch hygiene | `git diff --check` and staged `git diff --cached --check`: PASS |
| Changed/staged secret scan | High-confidence credential patterns: no matches |
| Tauri config schema | Stable CLI validation PASS after two causal schema corrections |
| Windows Rust compile | `cargo check --manifest-path src-tauri\\Cargo.toml`: PASS from the final Rust/capability source; 493 locked packages |
| Windows Rust lint | `cargo fmt -- --check` and `cargo clippy -- -D warnings`: PASS |
| Desktop attack-surface scan | `npm run check:desktop-security`: PASS |
| Tauri dependency audit | Exact npm/Cargo pins verified; root high-severity npm audit gate PASS with the established three moderate `firebase-tools` development-only findings |
| Final icon generation | Production and badged Beta SVG sources generated all required Windows icon formats: PASS |
| Post-icon Windows native build | PASS in the later clean Tauri release build; the earlier transient WSL/Windows interop failure is superseded |
| Windows installer | PASS; x64 current-user NSIS bundle built and installed from the clean `52ee54f` checkpoint |
| Native bridge/UI tests | 20/20 PASS across bridge, Settings, sidebar, and runtime markers |
| Affected Functions boundary tests | 32/32 PASS (`cors`, HTTP handler, runtime config) |
| Functions typecheck/build | PASS after Desktop-origin policy change |
| Cross-platform build-script tests | 6 test files PASS; Tauri CLI Windows smoke reports `2.11.4` |
| Clean staging export | PASS at `52ee54f`; 4 static pages; output-inclusive security scan PASS |
| Windows Tauri release build | PASS; optimized MSVC build and one x64 NSIS bundle |
| Release executable | 6,463,488 bytes; SHA-256 `ba853bed54d195208a1ccd67f58a921b91cdb38574fea002b813c3ca27d8f634` |
| NSIS installer | 2,371,470 bytes; SHA-256 `4fe3c1f5d772b957399457623baea96c49c2f498626f11c7e4734e3148557e70` |
| Binary provider-secret scan | PASS; no high-confidence OpenAI/Twilio/Resend/private-key signatures in app or installer |
| Current-user install | PASS; registry version `1.0.0`, install location, uninstaller, and Start Menu shortcut verified |
| Installed launch/tray/single-instance/restart | PASS; visible staging title, hide-to-tray, same-PID focus, new-PID restart |
| Staging Function Desktop-origin deploy | NOT RUN — exact human deployment approval required |
| Installed auth/domain/AI/notification acceptance | NOT VERIFIED |
| Production positive identity/read-only audit | PASS; explicit `life-tracker-12000`, zero mutations |
| Production Rules/index/backup comparison | PASS; broad Rules, no index/TTL, no backup/PITR/delete protection |
| Production backend/billing inventory | PASS; required backend APIs disabled, no billing link |
| Production owner-marker compatibility | PASS; all projected embedded owners matched their owner paths |
| Legacy TimeBlock timestamp remediation | PASS; unit behavior, 49/49 Rules emulator, 639 frontend regression |
| Reminder-domain focused tests | PASS; 30/30 deterministic planning, authority, stale-state, idempotency, quiet-hours, and DST tests |
| Functions regression after reminder domain | PASS; 17 files / 206 tests, with 34 emulator-only tests correctly skipped outside the emulator gate |
| Functions typecheck/build after reminder domain | PASS; Node 22 bundle generated locally; generated `functions/lib/` remains untracked |
| Reminder changed-material security/hygiene | PASS; static frontend security, refined high-confidence credential scan, `git diff --check`, and staged diff check |
| Reminder reconciliation focused tests | PASS; 7/7 persistence-before-queue, replay, move, delete, failure, concurrency, and forged-owner tests |
| Functions regression after reconciliation | PASS; 18 files / 213 tests, with 34 emulator-only tests correctly skipped outside the emulator gate |
| Reconciliation typecheck/build/security | PASS; Functions bundle, static security, changed-material credential scan, and staged diff hygiene |
| Notification preference Rules emulator | PASS; 56/56, including owner-constrained list and five new server-only namespaces |
| Reminder Firestore transaction emulator | PASS; 6/6 against isolated local emulator; no cloud project contacted |
| Functions regression after Firestore adapter | PASS; 18 files / 213 tests, with 40 emulator-only tests correctly skipped in the non-emulator gate |
| Firestore adapter build/security/hygiene | PASS; typecheck/bundle, index JSON parse, static security, 8-file credential scan, and staged diff check |
| Cloud Tasks/reconciliation focused tests | PASS; 14/14 minimal payload, duplicate, sanitized failure, cancellation, horizon deferral/refill, and concurrency tests |
| Reminder Firestore emulator after horizon change | PASS; 7/7, including durable deferred-to-pending promotion |
| Functions regression after Cloud Tasks adapter | PASS; 19 files / 220 tests, with 41 emulator-only tests correctly skipped in the non-emulator gate |
| Cloud Tasks build/security/hygiene | PASS; Functions bundle/typecheck, static security, 9-file credential scan, and staged diff check |
| Delivery-service focused tests | PASS; 8/8 no-op, retry, accepted, rejected, timeout/throw, invalid identity, and recovery-without-resend cases |
| Functions regression after delivery service | PASS; 20 files / 228 tests, with 41 emulator-only tests correctly skipped in the non-emulator gate |
| Delivery-service build/security/hygiene | PASS; Functions bundle/typecheck, static security, four-file high-confidence credential scan, and staged diff check |
| Firestore delivery transaction emulator | PASS; 10/10 claim-before-send, exact replay, concurrent single-send, abandoned-claim recovery, stale authority, Session, owner/task, and conflict cases |
| Combined reminder Firestore emulator | PASS; 17/17 reconciliation and delivery transactions on the same exact job codec |
| Firestore Rules after delivery persistence | PASS; 57/57, including client denial of attempts, receipts, notification idempotency, and delivery counters |
| Functions regression after delivery persistence | PASS; 20 files / 228 tests, with 51 emulator-only tests correctly skipped in the non-emulator gate |
| Delivery persistence build/security/hygiene | PASS; Functions bundle/typecheck, valid index JSON, static security, ten-file high-confidence credential scan, and staged diff check |
| Task payload/worker focused tests | PASS; 45/45 parser, enqueue, deployment metadata, identity, malformed input, terminal outcome, retry, clock, and log-privacy cases |
| Functions regression after worker boundary | PASS; 21 files / 237 tests, with 51 emulator-only tests correctly skipped in the non-emulator gate |
| Worker build/security/hygiene | PASS; Functions bundle/typecheck, static security, six-file high-confidence credential scan, and staged diff check |

## Release status

- R1 Desktop Beta using verified staging: IN PROGRESS
- R2 Production Desktop: READ-ONLY AUDIT COMPLETE; PROMOTION NOT STARTED
- R3 Native and cloud reminders: IN PROGRESS — deterministic domain, persistence, reconciliation, task adapter, at-most-once service, Firestore delivery claims/receipts, and private worker factory green; triggers, provider binding/export, and installed delivery pending
- R4 Daily and weekly reports: NOT STARTED
- R5 WhatsApp Sandbox and production-ready path: NOT STARTED
- R6 ChatGPT read integration: NOT STARTED
- R7 Pages removal and repository privacy conversion: NOT STARTED

## External blockers

The R1 installer is built and installed. The remaining explicit human gate is
approval to deploy only `lifeTrackerAiApi` to the positively identified
`life-tracker-staging` project with the reviewed Desktop-origin allowlist. The
managed gate rejected the first attempt before execution; no staging resource
changed. Installed UI authentication/notification acceptance will then require
Francesco to interact with the visible Beta. No production resource, provider
credential, billing setting, GitHub visibility, or public Pages state changed.

Production promotion has a separate later cost gate: `life-tracker-12000` has
no billing link and its required backend APIs are disabled. Do not enable
billing, APIs, or paid services without explicit human approval. This does not
block independent local/emulator implementation.

## Exact next step

Continue R3 with dependency-injected TimeBlock and notification-preference
reconciliation trigger handlers plus a bounded deferred-horizon refill. Prove
create/move/delete/preference-disable races and no unbounded global polling
locally before exporting any trigger. Then implement the server-owned provider
binding/Twilio adapter and instantiate the named private worker. Do not enable
Cloud Tasks, billing, APIs, provider secrets, or deploy any resource. After
exact human approval, separately deploy only
`functions:lifeTrackerAiApi` to explicit project `life-tracker-staging`, verify
health/runtime attestation and exact CORS allow/deny behavior, rebuild/reinstall
the staging Beta, and complete the installed R1 acceptance matrix.
