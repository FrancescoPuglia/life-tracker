# Life Tracker OS progress checkpoint

Last updated: 2026-08-25 (Europe/Rome)

## Resume identity

- Repository: `FrancescoPuglia/life-tracker`
- Working branch: `codex/life-tracker-os`
- Master starting SHA: `df99a6c2e1f06beb4fd9a6cb18e6565c5b25400b`
- Current implementation checkpoint SHA: `169dfadae60b2e830b291fef5544db77f6768a3a`
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

### R3 authoritative reconciliation triggers and bounded refill

- Green implementation commit: `24d006500fe25c2afbf97588ad784fc36e04b68b`.
- Added dependency-injected factories for TimeBlock, notification-preference,
  and persisted-user-timezone Firestore write events. They ignore event
  snapshots and reread the current owner-scoped TimeBlock, notification
  preferences, and profile timezone. Malformed platform paths acknowledge with
  zero work; operational failures throw only a sanitized retry signal.
- Closed the out-of-order event race at the durable boundary: every
  reconciliation carries the exact observed TimeBlock schedule version and
  reminder-policy version, and the Firestore transaction recomputes both from
  current authority before changing any job or manifest. An older handler can
  no longer restore obsolete jobs after a newer move, delete, completion, or
  preference change.
- Event factories are private/internal, zero-warm-instance, region-fixed, and
  idempotent with `retry: true`. Current Eventarc documentation defines
  at-least-once retry with a default 24-hour retention window; see
  [Eventarc retries](https://docs.cloud.google.com/eventarc/docs/retry-events).
  Same-project Eventarc and Cloud Scheduler are explicitly accepted sources for
  internal Cloud Run ingress; see
  [Cloud Run ingress](https://docs.cloud.google.com/run/docs/securing/ingress).
- Preference/timezone fan-out uses an indexed owner-subcollection query for
  only future `planned`/`in_progress` TimeBlocks. It is capped at 100 and aborts
  before reminder writes if the cap is exceeded, so partial preference changes
  are never silently reported as complete. Current delivery authority still
  suppresses any stale disabled-policy job independently.
- Added a six-hour, indexed, 100-row horizon refill instead of a minute-wide
  Firestore poll. It selects only WhatsApp jobs due inside the safe 29-day
  Cloud Tasks horizon and also recovers `pending_enqueue`/`schedule_failed`
  work left by a crash or queue outage. It reconciles at most four TimeBlocks
  concurrently and requests one of three bounded scheduler retries when more
  eligible work remains.
- Added the exact additive composite indexes for future active TimeBlocks and
  due unscheduled reminder jobs. This checkpoint exports factories only, not
  named deployed trigger instances; no Function, scheduler, Eventarc trigger,
  index, queue, API, IAM binding, billing state, secret, provider, or message
  changed.

### R3/R5 Twilio WhatsApp provider and delivery-status boundary

- Green implementation commit: `bc9d1a98dc5a8ef59f653cb78cb6076ec7ec9503`.
- Added pinned Twilio Node SDK `6.1.0` behind the existing provider-neutral
  `MessagingProvider` contract. The adapter accepts only server-fixed owner,
  sender, recipient, callback URL, and content mode; ReminderJob, client, model,
  and task payload data cannot redirect a paid message or supply credentials.
  The SDK call has no internal retry, a 10-second timeout, and a 10-minute
  provider validity window so stale queued messages expire.
- Sandbox/session messages contain only bounded display title, deterministic
  localized start time, and planned duration. Production template mode sends
  one validated `ContentSid` and exactly those three variables with no `Body`.
  Provider results/errors map to bounded generic accepted/rejected/uncertain
  outcomes; raw provider errors never persist or enter logs.
- Added an intentional public HTTPS status-callback factory because Twilio is
  external to Google Cloud. It accepts only POST form callbacks up to 64 KiB,
  reconstructs the configured exact HTTPS URL, verifies the official Twilio
  signature over every form field, checks the exact Account SID, WhatsApp
  channel, Message SID, status, and bounded failure code, and then translates
  the webhook into a provider-neutral delivery-status record. CORS is disabled;
  the auth token is a bound SecretParam and is never present in endpoint
  metadata or logs.
- The callback URL carries only deterministic attempt/job hashes. A server-only
  opaque route is created atomically with the pre-send delivery claim and maps
  that hash to exactly one owner. The callback transaction then rereads the
  owner-scoped job and attempt, binds the exact provider message identity,
  records only monotonic status, treats duplicates/out-of-order callbacks as
  no-ops, and closes the callback-before-finalization race. Delivered/read
  status advances an accepted reminder job to `delivered` but never changes a
  TimeBlock, Task, or Session.
- Added 90-day TTL declarations and explicit browser denial for both generic
  provider delivery status and opaque callback-route records. Nothing was
  deployed; no Twilio credential/account/sender/template was accessed, no
  message was sent, and no Firebase API, IAM, billing, queue, or index changed.

### R3/R5 named notification runtime bindings

- Green implementation commit: `a8762376df685763aa8ce20ec8e734546ff31c60`.
- Exported the exact deployable notification surface from the Functions entry:
  private/internal `deliverReminderTask`, three authoritative Firestore
  reconciliation triggers, the six-hour deferred refill scheduler, and one
  intentionally public `twilioWhatsAppStatusCallback` whose authority remains
  the exact official Twilio signature. The Cloud Tasks target name and worker
  export are identical.
- Only the worker and callback bind `TWILIO_AUTH_TOKEN`; triggers/scheduler bind
  no provider secret. Provider parameters and the SecretParam are resolved only
  inside the first real worker/callback invocation. Module import, Firebase
  deployment discovery, endpoint metadata, and disabled execution read no
  provider credential.
- Added an exact `REMINDER_WHATSAPP_ENABLED` kill switch defaulting to `false`
  and safe non-secret sentinel defaults. This prevents unrelated targeted
  Secure AI deployments from requiring Twilio configuration. Disabled or
  malformed configuration fails before owner lookup, destination use,
  Firestore claim, SDK creation, or provider call; enabling still requires the
  fixed owner/account/sender/recipient/callback/content configuration and the
  securely bound auth secret.
- Reconciliation reuses one owner-validating Firestore repository and creates
  its Cloud Tasks client lazily on the first actual reconciliation invocation,
  not during export discovery. Worker retry/rate/concurrency and all trigger
  batch/retry bounds remain unchanged.
- Production bundle inspection found all seven expected endpoints with exact
  region, trigger type, ingress, timeout, and secret metadata. Nothing was
  deployed and no runtime parameter, Secret Manager value, API, IAM binding,
  billing state, queue, scheduler, trigger, provider, or message changed.

### R3 authenticated native Desktop reminders and editable policy

- Green implementation commit: `318d7a6384fe6e313412e4d216ebbeea32d7cbc7`.
- Added one strict, versioned Desktop reminder callable contract shared by the
  browser bundle and Functions. The request has no owner field: verified
  Firebase callable authentication is the only UID authority. Unauthenticated,
  malformed, spoofed, cross-owner, oversized, and unknown-field requests fail
  closed. Candidate reads are bounded to 64 jobs, a 10-minute lookback, and a
  24-hour horizon; fixed-window server rate limits allow 30 list and 30 claim
  calls per authenticated owner/action/minute without storing a raw UID.
- The claim transaction rereads the owner-scoped ReminderJob, authoritative
  TimeBlock, current notification preferences/timezone, Session state for a
  missed-start warning, delivery counters, receipts, attempts, and consumed
  idempotency identity. Moved, deleted, cancelled, completed, already-started,
  quiet-hour, disabled, policy-version, schedule-version, cap, and duplicate
  cases become no-op responses. Concurrent claims produce one dispatch.
- A permitted claim atomically consumes the server idempotency key and records
  an accepted Desktop handoff receipt before returning minimal display data.
  This deliberately chooses at-most-once behavior: a crash or native API
  failure after the server handoff can miss one toast, but an ambiguous retry
  cannot duplicate it. The receipt proves backend authorization/handoff, not
  that Windows rendered the notification.
- Added the signed-in Tauri-only coordinator, bounded per-owner local restart
  journal, server-time scheduling, offline/expired-auth/permission-denied
  fail-closed behavior, and cleanup guards preventing a sign-out race from
  displaying the prior owner's reminder. It requests permission only through
  the existing explicit Settings action. A notification click can only
  unminimize/show/focus Life Tracker; it cannot complete a block or mutate a
  Task, TimeBlock, Session, plan, or rollback path.
- Notification Settings now persist the complete owner-bound policy document:
  timezone, locale, Desktop channel, offsets, at-start/missed-start behavior,
  maximum reminders, quiet hours, and daily/weekly report preferences. Exact
  validation rejects unknown fields and invalid bounds without a partial write.
  WhatsApp and email remain disabled by default.
- The callable does not bind a provider secret. App Check enforcement remains
  disabled because no Tauri WebView attestation path is configured; Firebase
  Authentication, owner-derived paths, strict schemas, bounded reads, server
  rate limiting, and transactional authority are the current controls.
- Built a clean reviewed-staging static export and a new Windows x64 NSIS bundle
  from this exact commit. Installer SHA-256 is
  `e2a69bdea9ad6b3e93be6e8455f97f619aaefb33ae61329385eeeeb9d640bd3d`
  (2,380,685 bytes); release executable SHA-256 is
  `16b11332c3a4426ce1f80a18b71bc03ac9cd9e6d0a4068fd64829d0777f38b2e`
  (6,473,216 bytes). A bounded binary credential-signature scan passed.
- The new installer is **not yet installed/accepted**. WSL-to-Windows process
  interop timed out after the build, so the existing older Beta was not
  terminated or overwritten. No Function, Rules, index, API, IAM, billing,
  provider, message, production resource, or Firebase data changed.

### R4 deterministic scientific metric and report domain

- Green implementation commit: `3238e217d956229648175034861f27e88c7c1d04`.
- Added versioned deterministic metric, report, formula, and chart-data
  contracts for Daily and Weekly execution reports. Every metric carries its
  availability, numerator, denominator, sample size, missing count, exact
  formula, and source. Partial known values are distinguishable from complete
  totals; unavailable values remain `null`.
- Report periods use the persisted planning timezone and the sole product
  fallback `Europe/Rome`. Daily/weekly half-open instants are Temporal-derived,
  Monday-first, and proven across 23-hour and 25-hour Europe/Rome DST days.
- Actual time uses completed persisted Sessions (`duration` is seconds) and
  explicit block actual intervals only when no valid linked Session exists.
  Planned windows never become actual-time fallback. Open Sessions,
  contradictory durations, completed blocks without actual evidence, missing
  Sessions, and truncated inputs are explicit data-quality conditions; missing
  Sessions are never silently reported as zero productivity.
- Implemented planned/actual/adherence/variance, Task and TimeBlock completion,
  Goal target/planned/actual allocation, Goal Alignment Index, deep work,
  cadence-bounded habit adherence, carryover, start delay, measured overrun,
  block estimation error, time-of-day/weekday completion, capacity utilization,
  four-week trends, and a versioned Weekly Execution Index. Schedule volatility
  remains explicitly unavailable because the current schema has no defensible
  reschedule history; `updatedAt` is not misused as schedule evidence.
- Daily and Weekly deterministic fallback reports classify statements as
  OBSERVED/DERIVED/INFERENCE/RECOMMENDATION with period, N, missing count,
  baseline, confidence, and uncertainty. Time-of-day inference requires bounded
  sample/effect thresholds, says association rather than causation, and proposes
  only a two-week experiment. Hostile user labels remain bounded untrusted
  display data and cannot change formulas or statement authority.
- Chart data is derived only from the immutable metric bundle. Each chart binds
  the exact metric SHA-256 and its own canonical data SHA-256, so a renderer or
  model cannot invent/recalculate values. Report identity is owner-bound and
  retry-stable over owner/type/local-period without exposing the UID.
- Added `docs/SCIENTIFIC_REPORT_METRICS.md` as the formula/denominator source of
  truth. This slice performs no Firestore read/write, archive mutation,
  scheduler registration, chart rendering, LLM/provider call, email send,
  secret access, deployment, API/IAM/billing change, or production action. It
  does not export a new runtime endpoint.

### R4 owner-scoped source and immutable report archive

- Green implementation commit: `2ca3b7408c578440349a011f435b923a19ddc86e`.
- Added a bounded scientific-report source loader that accepts only an
  authenticated server context and the verified repository's allowlisted
  collections. Every Firestore path is derived from the verified UID; callers
  cannot pass a user ID or arbitrary database path. Goals, Projects, Tasks,
  Habits, Sessions, HabitLogs, and TimeBlocks are independently capped, and any
  cap/scan exhaustion is surfaced as `truncated` rather than treated as complete.
- Source coverage includes the four-week comparison horizon and, for Daily
  reports, tomorrow's workload. TimeBlocks are bounded before local interval
  selection so an explicit actual interval inside the horizon is not lost when
  its planned interval moved outside it. Persisted planning timezone remains
  authoritative, with `Europe/Rome` only through the existing repository
  fallback.
- Added immutable `scientific-report-archive-v1` artifacts under the
  owner-derived path `users/{uid}/reportArchives/{reportId}`. The report itself
  contains only a one-way owner hash; the top-level `userId` exists solely for
  Rules query constraints. Archives carry report/metric/formula versions,
  deterministic metric and artifact hashes, data-quality flags, normalized
  timestamps, and provider-neutral email delivery state. Raw source records are
  not duplicated into archive metadata.
- Report validation recomputes every metric hash and chart-data hash, rejects
  non-finite/unsupported/cyclic data, enforces Firebase-safe owner identity, and
  reserves headroom below Firestore's 1 MiB document limit. The large immutable
  `report` map is exempt from automatic indexing; history indexes only
  `userId + generatedAt`, reducing cost and index-entry pressure.
- Archive creation and its server-only `reportIdempotency` marker are one
  Firestore transaction. Same owner/type/local-period plus identical content is
  an exact replay; changed content conflicts instead of overwriting the first
  artifact. Concurrent creation produced exactly one create and one replay.
  Orphaned marker/archive state fails closed without a partial write.
- Browser Rules permit only owner get and owner-constrained newest-first list of
  report archives. Client create/update/delete, unconstrained list,
  cross-owner/forged-owner read, idempotency access, and future report-delivery
  attempt access are denied. Report history UI is not yet wired.
- This slice exports no Function, callable, trigger, or scheduler. The production
  Functions bundle remains 511.3 kB and contains no archive symbols. It made no
  Firebase/cloud/provider request, deployment, secret access, email send,
  API/IAM/billing change, or production-data mutation.

### R4 deterministic local chart rendering

- Green implementation commit: `191fa821e1a6078b4a888c0e62de6666b2702963`.
- Added an accessible, deterministic SVG renderer for every existing
  hash-bound report chart. It revalidates chart schema, identity, metric/data
  hashes, ordered series, values, units, sample metadata, and bounded source
  cardinality immediately before rendering. Titles, labels, axes, units,
  legends, and missing-value semantics are explicit; missing values render as
  an em dash and never as zero.
- Visual density is capped at 12 points. Crowded Goal allocation charts select
  the highest deterministic values and disclose the omitted count while the
  complete metric/chart JSON remains authoritative. Hostile labels are bounded,
  escaped text only; generated SVG has no external links, scripts, stylesheets,
  `foreignObject`, dynamic URL references, or chart SaaS dependency.
- Added local 2x PNG rasterization using pinned `sharp@0.35.3` on the existing
  Node 22 Functions runtime. Inputs are capped at two million pixels and 200 kB;
  outputs must be exact 1600x920 PNGs below 1 MB. SVG authority, active-content
  denial, source SVG/data/metric hashes, PNG signature/hash, dimensions, byte
  length, chart identity, and content ID are reverified before an attachment can
  be trusted.
- Charts render sequentially with a maximum set of ten to bound native memory.
  Native parser/renderer failures are converted to a stable non-secret report
  error, leave the deterministic report untouched, and cannot destroy the
  already archived artifact. Two renders of the representative chart produced
  byte-identical PNGs; all five weekly charts rendered successfully in one run.
- Sharp was selected after a real Node 22 proof. Its current stable release has
  maintained prebuilt Linux support and explicit input-pixel controls. The
  smaller stable Resvg binding was rejected because its next prerelease adds a
  process-panic containment fix absent from the old stable package. The
  Functions production dependency audit reports zero vulnerabilities.
- A real PNG was visually inspected after rendering: title, legend, axes,
  labels, units, missing-value marker, contrast, and non-misleading two-dimensional
  scale were readable. No runtime Function, email provider, scheduler, cloud
  action, secret access, API/billing change, or Firebase mutation was added.

### R4 deterministic report email and provider boundary

- Green implementation commit: `45614cff81f0560baa591b2c7b0fad9ce77f6bca`.
- Added a provider-neutral `EmailProvider` contract with bounded sender/recipient
  mailboxes, stable accepted/rejected/retry-later/uncertain outcomes, provider
  delivery IDs, exact content hashes, copied inline attachments, and a privacy-safe
  report idempotency key. Provider bodies, response headers, thrown details, and
  credentials never enter the normalized result.
- Pinned the current Node 22-compatible server packages after checking their
  official contracts: `@react-email/render@2.1.0`, React/React DOM `19.2.8`, and
  `resend@6.22.1`. Only React Email's maintained server renderer is installed,
  not its substantially larger preview/CLI package. The Functions production
  dependency audit reports zero vulnerabilities.
- Daily and Weekly email composition revalidates the verified UID against the
  immutable archive, recomputes the report artifact/metric/chart/SVG/PNG
  authority, rerenders the exact chart set, and copies every attachment before
  constructing content. Cross-owner, archive, chart, PNG, content-hash, active
  HTML, external URL, and CID-reference tampering all fail closed.
- HTML uses React Email, table-compatible inline styling, a fixed URL-free
  responsive rule, HTML5 doctype, zero external assets, and one CID reference
  per verified local PNG. HTML/text/attachment counts and sizes are bounded;
  sender/recipient and display-name fields reject header/parser injection.
- The explicit text fallback contains the same Daily execution evidence or all
  16 Weekly scientific sections. Both surfaces retain OBSERVED/DERIVED/
  INFERENCE/RECOMMENDATION discipline, N/missing/confidence/formula data,
  deterministic values, explicit uncertainty, and the rule that missing
  Sessions are unknown rather than zero. OpenAI is not required or called.
- The Resend adapter maps local buffers, CID/content type, HTML, text, two
  low-cardinality tags, and the stable provider idempotency key. Invalid
  recipients/configuration/messages fail before the client; definitive quota,
  security, conflict, and validation outcomes are distinct from retryable rate
  limits and ambiguous transport/5xx outcomes. The SDK client is injected;
  this slice creates no client, reads no credential, and makes no provider call.
- A representative weekly email was rendered with real Sharp PNGs and inspected
  through a local headless browser at 900 px and 390 px. The desktop document and
  mobile stacked-card layout were readable; headings, evidence labels, charts,
  methodology, uncertainty, and footer remained intact. This was local synthetic
  content only, not a sent email or provider/mobile-client acceptance claim.
- No Function, callable, HTTP route, scheduler, secret binding, Firestore write,
  Firebase/cloud action, provider account action, domain change, or real email
  was added. Provider idempotency lasts only 24 hours and is explicitly not yet
  treated as the durable scheduler duplicate-prevention authority.

### R4 durable at-most-once report-email delivery

- Green implementation commit: `5a800bc8c0e7f95e1903f5d5fbf31e51155726ce`.
- Added claim-before-send orchestration around the existing immutable report
  archive and provider-neutral email boundary. A one-way authority hash binds
  the exact owner, report/artifact/metric/content identity, sender, recipient,
  provider, and stable idempotency key; mailbox values and message bodies are
  not persisted in delivery-control or attempt records.
- Owner-derived Firestore transactions atomically create the first server-only
  control record, provider attempt, and archive `pending` summary before a
  provider call. Finalization atomically records the exact accepted, rejected,
  retryable, or uncertain outcome and updates only the archive delivery summary;
  the deterministic report and its hashes remain unchanged.
- Two concurrent full delivery services produced exactly one provider call.
  Exact finalization replay is idempotent; forged owner, attempt, authority, or
  conflicting replay fails closed. Browser Rules explicitly deny both
  `reportEmailDelivery` controls and `reportDeliveryAttempts` at owner and root
  collection shapes.
- Only definitive pre-send provider outcomes may retry: maximum three attempts,
  5/10 minute deterministic backoff, and a 12-hour authority window. Provider
  throws, malformed/5xx ambiguity, and an abandoned claim become terminal
  `uncertain` state and are never automatically resent, preventing a scheduler
  retry from duplicating an email after provider acceptance but before local
  acknowledgement.
- No Function, callable, HTTP route, scheduler, secret/client binding, provider
  call, cloud action, API/billing change, or Firebase project mutation was
  added. The production bundle remains 511.3 kB and contains no delivery-service
  or Firestore delivery-repository symbols.

### R4 owner-scoped report history UI

- Green implementation commit: `2d51356601a19662deda63a01cb717c6c9272b63`.
- Added a lazy-loaded Scientific Reports surface inside the existing
  Intelligence navigation. It shows the newest 12 Daily/Weekly archives, one
  bounded overflow witness, local period/generation time, deterministic
  executive summary, key metrics with N/missing/availability, data-quality
  flags, formula/schema versions, and provider-neutral delivery state.
- The browser query is exactly owner-filtered, `generatedAt` descending, and
  limited to 13 documents. Rules now require an explicit limit at or below 20;
  owner queries with no limit or limit 21, unfiltered/forged/cross-owner reads,
  archive mutation, and server-only delivery control/attempt access fail.
- A strict client decoder revalidates archive/report/metric/delivery schema,
  document/embedded owner identity, report/hash identity, normalized period and
  timestamp fields, deterministic-fallback policy, metric availability, and the
  invariant that missing Sessions are never zero. Malformed records are
  quarantined and counted without mutating or copying the archived report.
- Full reports are reduced to a minimal frozen display model before React state.
  Provider message IDs and stable internal failure codes are validated but not
  surfaced; retry/uncertain/failed outcomes are mapped to provider-neutral UI.
  Hostile summary text renders only as escaped text.
- Explicit loading, empty, overflow, malformed, unavailable/retry, stale-owner,
  partial-data, and delivery states are covered. The production static export is
  green and contains no server-only report collection names or test/provider
  details. No Function, scheduler, provider client/secret, cloud action,
  API/billing change, Firebase mutation, or message send was added.

### R4 deterministic Daily/Weekly schedule planning

- Green implementation commit: `f1c78ba8d016a9af738b3cfd7ff189ccf77e4f56`.
- Upgraded the single owner-scoped notification-preferences document to exact
  `notification-preferences-v2`, adding one validated report recipient while
  retaining exact read/update compatibility with v1. A legacy v1 document has
  no recipient authority, so the client and server deliberately disable its
  email/report schedules until an explicit validated v2 save; Rules permit
  only v1-to-v2 migration and reject v2 downgrade, forged fields, invalid
  mailboxes, or enabled schedules without email authority.
- Extended the existing Desktop Settings surface with opt-in email delivery,
  recipient, Daily time, and Weekly day/time controls. Persisted timezone stays
  authoritative; saving preferences neither configures a provider nor sends a
  message. Report-only changes do not enter the reminder-policy version, so
  they cannot churn TimeBlock reminder jobs.
- Added a pure provider-neutral schedule policy and a maximum-two-candidate
  planner: at most the most recent Daily and Weekly occurrence. Candidate IDs
  bind trusted UID, report type, and local report period; schedule and one-way
  recipient-authority hashes detect stale work without persisting or placing a
  mailbox in a future task payload.
- Local-time resolution uses Temporal `compatible` disambiguation: a skipped
  spring time shifts forward once, and an autumn duplicate selects the earlier
  instant once. Sunday delivery summarizes its current Monday-Sunday calendar
  week; a configurable Monday-Saturday delivery summarizes the last completed
  calendar week rather than including future days. Schedule/recipient changes
  retain the same period identity but change the expected authority hashes.
- No report-run record, source read, report generation, archive mutation,
  Function/callable/scheduler export, provider client/secret, cloud action,
  API/billing change, Firebase mutation, or message send was added. The built
  Functions entry bundle contains no schedule-candidate or `report_run_`
  runtime symbol.

### R4 durable report-run orchestration

- Green implementation commit: `e4db3389b903f07844b6d20c463516b90c5f3ca6`.
- Added a provider-neutral `scientific-report-run-v1` state machine at the
  owner-derived `users/{uid}/reportRuns/{runId}` path. A run stores only stable
  UID/type/period/schedule identities, one-way recipient authority, bounded
  generation/delivery claims, archive hashes, non-secret outcomes, and
  timestamps. It never stores the recipient mailbox, provider body, provider
  credential, source records, or arbitrary Firestore path.
- Generation claims are transactional, limited to three attempts, recover an
  expired lease with the original deterministic generation instant, reject
  early/out-of-window work, and serialize concurrent invocations to one
  generator. Persisted transitions reject backward clocks, expired-at-write
  claims, and expired-at-write retry times before mutation.
- The service performs the exact sequence `claim -> bounded owner-scoped source
  load -> deterministic build -> atomic archive + idempotency marker + run
  commit -> current recipient/schedule reauthorization -> durable email
  handoff -> run finalization`. An existing immutable archive is reused without
  rereading mutable source state.
- Generation commit and delivery authorization each reread the current user and
  exact notification preference documents in the same transaction. Disabled
  email/schedule, changed recipient/schedule, legacy recipient-less v1
  preferences, or an expired catch-up window safely suppress work. Stale
  authority creates no archive and makes no provider call.
- Delivery claims are bounded to five orchestration attempts and wrap the
  existing three-attempt claim-before-send email repository. A simulated crash
  after provider acceptance recovered as `already_sent` with one source load
  and one provider invocation; an abandoned/ambiguous provider claim remains
  terminal no-resend. Exact replays return the stored result, while changed
  content or finalization conflicts fail closed.
- Archive creation and its idempotency marker now share their previously proven
  exact codec with the run transaction, so archive, marker, and run hashes
  commit atomically. Browser Rules explicitly deny both nested and root
  `reportRuns` access.
- No runtime scheduler, Function export, Resend client instance, provider
  secret access, cloud action, API/billing change, Firebase mutation, or real
  message send was added. The production Functions entry bundle remains free
  of report-run and Resend runtime symbols.

### R4 default-off scheduled report runtime

- Green implementation commit: `43efb669c875f6977e439b16baa7b8dad2c9ff49`.
- Added exactly two owner-nested, server-only schedule manifests: Daily and
  Weekly. They contain deterministic period/schedule authority, availability,
  bounded retry state, and timestamps but never a mailbox, title, Note,
  provider value, or arbitrary path. Current policy normalization is shared
  with the report-run transactions, and legacy recipient-less v1 preferences
  remain fail-closed.
- One fixed-owner collection-group query selects at most ten due manifests per
  invocation. It uses an additive composite index and validates the exact
  `users/{uid}/reportScheduleManifests/{daily|weekly}` path and embedded owner;
  there is no all-user poll. Browser Rules deny both owner-nested and root
  manifest namespaces.
- Preference writes transactionally reconcile both manifests from current
  authority. The five-minute scheduled handler also reconciles the one fixed
  owner before querying, making first deployment and missed Eventarc delivery
  self-healing. Enable/change/disable, recipient changes, weekly day changes,
  Daily/Weekly coexistence, DST, stale manifests, corrupt manifests, backward
  time, query caps, and concurrent execution are covered.
- Manifest advancement preserves an unconsumed future period, remaps that
  period to current wall-clock authority, never regresses to an older week, and
  skips the duplicate weekly period a schedule-day change can otherwise
  produce. A changed current recipient/schedule suppresses an older in-flight
  same-period run atomically; stale generation cannot commit an archive.
- Unexpected runtime failures back off by 5/10/15/20 minutes, then skip only
  the exhausted period after the fifth failure. Normal report/service retry
  state remains durable. Work executes sequentially, platform retries are
  bounded, and provider acceptance ambiguity retains the existing terminal
  no-resend behavior.
- Exported `reconcileScientificReportSchedules` is an internal-only preference
  trigger with no secret. Exported `deliverScheduledScientificReports` is an
  internal-only five-minute scheduled Function; only it binds
  `RESEND_API_KEY`. Both have min instances zero, max instances one, and a
  default-off exact kill switch. The Resend client is lazy after the switch,
  fixed owner, and sender validate. The `not-configured` owner sentinel and all
  malformed static configuration fail closed before Firestore/provider access
  without Eventarc retry churn.
- Added `docs/REPORT_RUNTIME_PREDEPLOY.md` with the exact endpoint/index/API,
  cost, configuration, approval, and recovery boundary. No Function, Rule,
  index, Scheduler job, API, IAM/billing setting, parameter, secret, provider,
  domain, user document, or email was changed outside local/emulator state.

### Economical AI workload routing and evaluation boundary

- Green implementation commit: `43a019c19c77e1a27fd664557cb72447dda0395e`.
- Added a backend-only, exact opt-in route manifest for Ask, Coach, Analyze,
  Plan, and Weekly Strategic Review. Exact `false` is the default and does not
  read the manifest; it preserves Goal 1's model, reasoning effort, runtime
  config ID/health shape, and exact 30-second/6-turn/12-tool/1,500-token bounds.
- Exact `true` requires all five routes, a current price-catalog version, a
  receipt-bound evaluation time, and models/reasoning within workload ceilings.
  Missing, partial, stale, arbitrary, or over-ceiling routes fail closed. The
  authenticated fixed mode is the only route selector; prompt/user/tool data
  cannot select a model. A selected provider failure never triggers an
  automatic retry on a more expensive model.
- Added a seven-case synthetic evaluation corpus covering grounded owner reads,
  hostile Note containment, bounded coaching, exact planned-versus-actual,
  unavailable Sessions, preview-only planning, and immutable weekly metrics.
  The cheapest-first selector requires complete failing evidence before every
  escalation, validates provider model/usage/criteria, estimates direct token
  cost from the reviewed 2026-08-25 official catalog, and hashes only safe
  structured observations into receipts. Raw model/user output is not retained.
- Runtime and provider request/response metadata safely attest workload,
  manifest hash, and evaluation receipt. The production Functions bundle
  contains the default-off parser/adapter but excludes every evaluation prompt,
  fixture, selector, and receipt-building symbol.
- Added `docs/AI_MODEL_ROUTING_EVALUATION.md` with official source links,
  prices, workload ceilings, exact corpus, sequential stopping rules, cost
  envelope, activation/rollback boundary, and a separate live-evaluation gate.
  No OpenAI call, provider secret access, credit spend, retry loop, deployment,
  parameter, budget, billing, auto-reload, staging, or production change
  occurred. No model is yet claimed cheapest adequate.

### R4 bounded post-archive Weekly strategic interpretation

- Green implementation commit: `34f6810d86c5c9d1e0f6158fdb24ba1b4cd8e2f3`.
- Added a versioned optional Weekly addendum that can run only after the exact
  deterministic report archive has committed. It binds owner hash, report and
  metric artifact hashes, metric-context hash, prompt/output schema, evaluated
  route/config/receipt, provider model/response, bounded token usage, and its
  own artifact hash. The immutable archive, metric bundle, and chart data are
  never rewritten.
- Provider input is reconstructed independently at the adapter from bounded
  deterministic scalar/bucket/daily/four-week metrics and data-quality facts.
  It contains no Goal/Project/Task titles, Notes, descriptions, entity IDs,
  mailbox, raw Firestore path, provider credential, or model-controlled tool
  output. The request is one turn, zero tools, 64,000 context bytes maximum,
  900 output tokens maximum, and a 64-character one-way safety identifier.
- Output uses strict JSON and explicitly labels the summary/claims as
  `INFERENCE` or `RECOMMENDATION`. Exact metric-ID references and uncertainty
  are required. Digits, Unicode numbers, written exact metric quantities,
  URLs/HTML/control characters, causal language, and diagnosis/medical claims
  fail closed. Unexpected tool/call output, model drift, usage drift, malformed
  JSON, or artifact tampering cannot enter email or storage.
- Added owner-derived server-only
  `users/{uid}/reportInterpretations/{reportId}` controls. Transactions provide
  one stable default-off decision or one provider claim. Concurrent full
  service resolutions invoke the fake provider once; an abandoned claim becomes
  terminal `uncertain` and is never reissued. Provider/config/quota/schema
  failure settles deterministic-only with no expensive fallback.
- Weekly email waits for the interpretation decision before current
  schedule/recipient authorization. A valid addendum is included in both HTML
  and text and therefore in the email content/send-authority hash; Daily email
  is unchanged. Routing-off preserves the existing deterministic email form
  and never reads the route manifest, endpoint, or OpenAI secret value.
- Shared the existing backend OpenAI parameters between Secure AI and reports.
  Only the delivery-capable scheduled Function binds `OPENAI_API_KEY`; the
  preference trigger remains secret-free, and no Twilio secret is added. The
  Weekly client is constructed only after a durable claim and has zero SDK
  retries. Goal 1 chat retains its established default of one retry.
- Firestore Rules explicitly deny browser access to nested and root
  interpretation controls. `docs/REPORT_RUNTIME_PREDEPLOY.md` now records the
  exact secret binding, cost cap, activation separation, and recovery path.
  No OpenAI/Resend call, credential access, deployment, runtime parameter,
  Firebase/cloud resource, billing/budget, user document, or external message
  changed.

### R6 authenticated read-only ChatGPT/MCP boundary

- Green implementation commit: `4219f576c36ca3578f4f331690aff45fc2316c04`.
- Added one explicit 12-tool read-only allowlist: Life Tracker state, Goals,
  Projects, Tasks, TimeBlocks, Sessions, Habits, KPIs, reports,
  planned-versus-actual, bounded period analysis, and Goal alignment. There is
  no apply, rollback, delete, schedule replacement, arbitrary query/path, raw
  Firestore, dynamic tool-registration, or other mutation tool.
- Tool arguments use exact schemas, 90-day maximum ranges, small pagination and
  state limits, and a 192,000-byte response ceiling. Existing deterministic
  domain/report services remain the metric authority. Notes and editor JSON are
  recursively removed, and returned user-controlled text is explicitly marked
  untrusted data rather than instructions.
- Implemented OAuth 2.1 authorization-code flow with exact S256 PKCE, RFC 9207
  issuer identification, exact resource binding, one-time authorization codes,
  rotating refresh tokens, revocation, and SHA-256-only token storage. The
  canonical issuer must be one HTTPS root origin; path-bearing, HTTP,
  cross-origin, callback-specific, or arbitrary client/redirect configuration
  fails closed.
- Firebase Authentication remains the sole identity authority. The backend
  verifies a current ID token with revocation checking, rereads the Firebase
  user on authorization and token use, rejects disabled/revoked users, and
  allows only the fixed configured owner. Client/model UID fields cannot select
  an owner or Firestore path.
- OAuth state, codes, access tokens, refresh tokens, and authenticated rate
  limits live only under five server-owned owner-scoped Firestore namespaces.
  Codes/tokens have bounded expiries and TTL metadata; browser Rules deny both
  nested and root access. Transaction-emulator tests prove one-time/concurrent
  exchange, refresh rotation, hash-only persistence, revocation, tamper
  rejection, owner isolation, and rate-limit serialization.
- Added a stateless Streamable HTTP MCP endpoint using the official SDK, root
  OAuth/protected-resource discovery, a same-origin Firebase consent page with
  a strict CSP and `__Host-` CSRF cookie, bounded request bodies, safe logs, and
  a 60-request/minute authenticated-owner limit. The deployment surface has no
  provider secret, maximum two instances, and a default-off exact kill switch.
- `docs/MCP_RUNTIME_PREDEPLOY.md` records the exact root-origin, Firebase public
  configuration binding, stable ChatGPT client/redirect, endpoint, cost,
  promotion, connection, acceptance, and rollback gates. Nothing was deployed;
  no Firebase project, ChatGPT account, Developer Mode setting, provider,
  credential, billing state, user document, or external network client changed.

### R7 repository privacy and Pages-retirement preflight

- Green implementation commit: `7a1204b91e9bb46b6c54e8bd24f63fd0fbc0cd53`.
- Refreshed live state through anonymous GitHub API/HTTP only. The exact
  repository remains public, `main` remains `5ea3280`, the Pages URL returns
  HTTP 200, and the latest Pages workflow deployment remains the successful
  `main@5ea3280` run. There are no releases, Git tags, forks, stars, or
  subscribers; all 30 listed historical Pages artifacts are expired.
- Proved the Tauri runtime has no GitHub Pages, raw-content, repository API,
  release, archive/content, or GitHub-hosted object URL. A new deterministic
  Desktop-security guard scans runtime/config/build material, rejects those
  surfaces without logging matched URL/query content, and also denies any
  JavaScript/Rust updater dependency or initialization while the updater is
  intentionally absent.
- Negative tests cover Pages, raw content, repository content/archive, API,
  release, and hosted object URLs, plus safe Firebase/local sources, bounded
  findings, and malformed scanner input. Static security now scans every
  repository workflow for provider-secret injection instead of assuming one
  fixed workflow filename.
- Added `docs/REPOSITORY_PRIVACY_PREDEPLOY.md` with current state, official
  GitHub behavior, production prerequisites, recovery-ref and installer
  evidence, custom-domain/DNS pause, Pages redeployment prevention, private CI
  cost controls, exact unpublish/private/verification sequence, failure matrix,
  and rollback/acceptance evidence.
- The active `.github/workflows/deploy.yml`, live Pages deployment, repository
  visibility, Actions settings, DNS, tags, releases, branches, and billing were
  deliberately unchanged. GitHub CLI admin authentication is expired; any
  future admin action requires trusted interactive reauthentication and exact
  approval, never a credential in chat.

### R1 current-source Beta and minimal staging deploy preflight

- Green receipt commit: `8e1d7f409decc8a70dee115b1bd3daa8ddc512e3`.
- Built a clean reviewed-staging static export and Windows x64 Tauri/NSIS Beta
  from exact source `ced322e7a63cf6dbe7de6f54a047abfe62df6a45`.
  Output security and exact Git/environment/runtime/backend attestations passed.
  The executable is 6,478,848 bytes with SHA-256 `cd24d9df...f627f519`;
  the 2,386,292-byte installer is `032403ca...d77d23d`.
- Binary scans found no OpenAI/Twilio/webhook/private-key shape,
  provider-secret variable name, or Life Tracker GitHub/Pages runtime URL. One
  permissive 29-character `re_` candidate was classified without disclosure as
  a pinned `tauri_runtime_wry` library token; it is absent from tracked runtime
  source, exported frontend, and installer. Both Windows artifacts report Life
  Tracker Beta 1.0.0 and are honestly `NotSigned`.
- Refreshed the explicit staging inventory. It still has exactly one active
  Node 22 Function with source hash `50d67b...`, backend fingerprint
  `5bfec76c...`, runtime fingerprint `16636fe0...`, Sol/medium, the original two
  exact origins, and the same two secret versions by metadata only. Exact
  Desktop and near-match origins remain HTTP 403 before deployment.
- Proved the smallest deployable source in an isolated detached worktree:
  `3100c42bfda50bb4627b7345270985a517439167` is exactly Goal 1 source plus the
  Desktop CORS delta/tests. Its 32/32 affected tests, strict typecheck/build,
  zero-vulnerability install, one-endpoint discovery, source/bundle credential
  scan, and diff hygiene passed. Expected backend/runtime fingerprints are
  `8bec8a4c...` and `6ef03a91...`.
- `docs/R1_STAGING_DEPLOY_PRECHECK.md` fixes the target, exact non-secret
  parameters, resource exclusions, cost boundary, approval procedure,
  post-deploy allow/deny matrix, and targeted `bef7b11` rollback. The temporary
  proof worktree and generated dependencies were removed afterward; Git history
  retains the commit.
- The Function was not deployed, the artifact was not installed, and no
  provider, secret value, Firebase data/resource, production target, billing
  setting, GitHub state, or user application changed.

### R3 native-reminder staging safety and deployment preflight

- Green safety commit: `3f0d441725f95de290e8a73c2fcaeb290836ba14`.
- Pre-deploy review found that the WhatsApp runtime switch previously gated
  provider construction but not reconciliation. A user preference could still
  derive a WhatsApp job and attempt Cloud Tasks enqueue while the provider was
  disabled. The server now applies the exact switch before reminder-policy
  derivation: false, malformed, or unavailable configuration preserves Desktop
  jobs but permits no cloud enqueue. Existing queued work uses a lazy adapter
  only for best-effort cancellation and remains independently authority-checked.
- Negative tests prove exact false and parameter-read failure create Desktop
  jobs only without constructing Cloud Tasks; a prior WhatsApp job is
  superseded and cancellation performs no enqueue. The policy-hash transition
  correctly supersedes both prior channel-bound jobs before creating one fresh
  Desktop-only job.
- Refreshed explicit `life-tracker-staging` metadata read-only. Billing is
  already linked; Functions, Run, Build, Artifact Registry, Eventarc, Pub/Sub,
  Firestore, and Secret Manager are enabled; Cloud Tasks and Scheduler are
  disabled. Staging has zero Eventarc triggers and zero Pub/Sub topics. The
  live Rules hash exactly matches Goal 1, and live indexes remain one
  composite/six TTL policies.
- Count-only Firestore aggregation found all nine reminder runtime namespaces
  empty. This proves the reviewed reminder TTL enablement has no existing
  document to delete at this checkpoint. A first transport request failed
  without mutation; one bounded retry passed.
- `docs/REMINDER_RUNTIME_PREDEPLOY.md` splits the proposed change into current
  owner-scoped Rules, the exact reviewed reminder-only index manifest, and only
  four secret-free Functions: the authenticated Desktop callable plus three
  private/internal Firestore triggers. It explicitly excludes the AI Function,
  task worker, refill scheduler, Twilio callback, report Functions, MCP,
  Cloud Tasks/Scheduler API enablement, and every provider action.
- Green deploy-isolation commit:
  `eb34cd1fdbbbe9eced03bf1ed96905fa6ccf745d`. Firebase CLI prerequisite
  inspection occurs before `--only` endpoint filtering, so the four native
  endpoints now live in checked-in codebase `reminders` behind
  `firebase.reminders.json`; it contains no Firestore/Hosting target and imports
  none of the default AI/MCP/report or full cloud-reminder endpoint surface.
- Full Firebase SDK discovery of the isolated bundle proves exactly four
  endpoints, zero runtime parameters, zero secret bindings, zero task queues,
  zero schedulers, zero custom roles, and zero required APIs. Its 119,038-byte
  bundle has SHA-256 `1e5ba4f135cc3ad2542b7f2981691c614a90b960142c5e91fa139959e953cef2`.
  The native reconciliation path overrides every user WhatsApp preference at
  compile time and has no Cloud Tasks adapter or runtime switch that can enable
  cloud delivery.
- The ordinary default codebase now owns exactly its AI, MCP, and two report
  endpoints and exports no reminder endpoint. Its report surface still declares
  Cloud Scheduler, so it is explicitly not valid deployment authority for the
  native slice. The separately proven R1 authority remains detached exact
  one-endpoint source `3100c42`, not current default source.
- Read-only IAM inventory found the three first-Eventarc managed grants absent:
  Pub/Sub service-agent token creation plus default-compute Run invocation and
  Eventarc event receipt. A later native deploy approval must name exactly
  those principal/role additions; no IAM mutation occurred here.
- The temporary detached `318d7a6` Functions proof worktree was removed because
  it predates the new server gate; Git history remains intact. That commit is
  retained only as the reviewed reminder-only index-manifest authority.
- Nothing was deployed. No Rule, index, TTL, API, IAM, secret, provider,
  document, billing setting, production resource, or Desktop installation was
  changed.

### R1 automated live CORS/preflight acceptance

- Green verifier commit: `f1070cc69b80aa2cd6724c4e297c99ec110db5fd`.
- Added two fixed profiles for the explicit public staging health endpoint:
  `baseline` binds the existing Goal 1 fingerprints/two origins, while
  `desktop` binds the reviewed post-deploy fingerprints/three origins. Neither
  accepts a caller-selected endpoint, fingerprint, model, or origin set.
- Each run performs exactly 16 bounded unauthenticated requests: GET plus an
  authenticated-POST-shaped OPTIONS preflight across every exact allow/deny
  origin. It sends no token/body, caps response data at 8 KiB, retries only one
  transport exception, returns only allowlisted evidence, and cannot touch
  Firestore or OpenAI.
- Eight script suites passed. The real `baseline` run passed all 16 probes with
  release `sha256:5bfec76c...`, runtime `sha256:16636fe0...`, Sol/medium, the
  exact original two origins, and six denials including exact Desktop. The
  `desktop` command exited 1 as required before deployment because live staging
  still reports the baseline fingerprints.
- The first sandboxed live command failed with the verifier's fixed transport
  error because network was restricted. Its explicitly approved read-only
  retry passed; no cloud or provider state changed.

### R4 isolated scientific-report deploy boundary

- Green isolation commit: `169dfadae60b2e830b291fef5544db77f6768a3a`.
- Moved the two report endpoint exports into checked-in Firebase codebase
  `reports` behind `firebase.reports.json`. Full SDK discovery proves exactly
  the preference Firestore trigger and five-minute delivery scheduler, nine
  relevant parameters, only `RESEND_API_KEY`/`OPENAI_API_KEY` on the scheduled
  endpoint, one Scheduler requirement, zero task queues, and no custom role.
- The 429,711-byte isolated bundle has SHA-256 `498b1104...` and contains no AI
  HTTP endpoint, MCP/reminder/Twilio/Cloud Tasks symbol, Secure AI capability or
  origin parameter, unused chat model/reasoning parameter, credential shape, or
  external workspace import. The default codebase is reduced to AI + MCP and
  has zero required APIs.
- Refreshed staging metadata read-only: the one Goal 1 AI Function is unchanged;
  Cloud Scheduler/Tasks are disabled; Eventarc/Pub/Sub resource counts are zero;
  all three first-Eventarc managed bindings remain absent; OpenAI secret enabled
  versions 1/2 exist; `RESEND_API_KEY` does not. No value or user document was
  read and no cloud state changed.
- Scheduler job count remains honestly not verified because both Scheduler and
  Cloud Asset APIs are disabled. The corrected runbook requires a staged future
  approval: enable Scheduler only, enumerate jobs, then proceed. It never infers
  zero jobs from a disabled API.
- Corrected the report metadata authority. After R3's four-composite/fifteen-
  override manifest, R4 needs both report composites plus the large-report field
  override. Exact historical manifest `43efb669...` ends at six composites and
  sixteen overrides; current canonical metadata is excluded because it also
  contains five MCP TTL policies.
- Focused regression passed 4 files / 26 tests; broad Functions passed 49 files
  / 471 tests with 11 emulator files / 97 tests explicitly skipped; default and
  isolated builds, both production audits, security scans, and diff hygiene are
  green.

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
| Reconciliation trigger/refill focused tests | PASS; 34/34 across authoritative handlers, preference disable/cap, bounded refill, queue adapter, and private worker metadata |
| Reconciliation authority/source emulator | PASS; 10/10 final run, including stale transaction rejection, owner-scoped source reads, future-query cap, deferred promotion, and pending/failed enqueue recovery |
| Combined reminder transaction check before final recovery assertion | PASS; 20/20 reconciliation plus delivery emulator tests; the expected local metadata lookup warning did not affect results |
| Functions regression after trigger/refill | PASS; 22 files / 248 tests, with 54 emulator-only tests correctly skipped outside the emulator gate |
| Trigger/refill build/security/hygiene | PASS; Functions typecheck/bundle, index JSON parse, static security, high-confidence changed/staged credential scan, `git diff --check`, and staged diff check |
| Twilio provider/callback focused tests | PASS; 49/49 adapter, signature, HTTP boundary, delivery-service, and failure-mapping tests |
| Provider delivery Firestore emulator | PASS; 13/13, including callback-before-finalization, opaque route, exact provider identity, monotonic status, replay, stale authority, and single-send recovery |
| Firestore Rules after provider delivery status | PASS; 59/59, including root callback-route and owner-scoped provider-status client denial |
| Functions regression after Twilio boundary | PASS; 24 files / 289 tests, with 57 emulator-only tests correctly skipped outside their explicit gates |
| Twilio dependency audit | PASS; pinned `twilio@6.1.0`, `npm audit --omit=dev --audit-level=high` found 0 vulnerabilities |
| Twilio boundary build/security/hygiene | PASS; Functions typecheck/bundle, valid index JSON, static security, 13-file changed/staged credential scans, `git diff --check`, and staged diff check |
| Named notification binding focused tests | PASS; 47/47 lazy secret/parameter, kill-switch, fixed destination, endpoint metadata, task-worker, callback, and trigger tests |
| Functions regression after named bindings | PASS; 25 files / 296 tests, with 57 emulator-only tests correctly skipped outside their explicit gates |
| Compiled notification endpoint manifest | PASS; 7/7 named endpoints, exact trigger kinds/region/ingress/timeouts, and `TWILIO_AUTH_TOKEN` bound only to worker/callback |
| Named binding build/security/hygiene | PASS; Functions typecheck/bundle, static security, six-file changed/staged credential scans, generated-bundle credential scan, `git diff --check`, and staged diff check |
| Native reminder focused frontend tests | PASS; 8 files / 37 tests covering bridge, callable client, coordinator, local journal, runtime glue, policy validation, and Settings |
| Frontend regression after native reminders | PASS; 58 files / 664 tests |
| Functions regression after Desktop callable | PASS; 26 files / 303 unit tests; 5 emulator files / 63 tests intentionally skipped outside explicit emulator gates |
| Desktop callable transaction emulator | PASS; 6/6 bounded feed, atomic handoff, concurrent single-dispatch, moved/completed/Session/cross-owner/rate-limit cases |
| Firestore Rules after Desktop callable | PASS; 60/60, including browser denial of server-owned rate-limit state |
| Desktop reminder type/build/security | PASS; frontend and Functions typechecks/builds, Desktop/static security checks, valid index/capability JSON, `git diff --check`, and high-confidence changed-material scan |
| Compiled notification endpoint manifest after callable | PASS; 8/8 endpoints; callable public edge has no secret, Twilio secret remains limited to worker/callback |
| Clean staging export after native reminders | PASS at `318d7a6`; reviewed `life-tracker-staging` Web manifest, 4 static pages, output-inclusive security scan |
| New Windows Tauri release build | PASS; optimized MSVC build and one x64 NSIS bundle from `318d7a6` |
| New release executable | 6,473,216 bytes; SHA-256 `16b11332c3a4426ce1f80a18b71bc03ac9cd9e6d0a4068fd64829d0777f38b2e` |
| New NSIS installer | 2,380,685 bytes; SHA-256 `e2a69bdea9ad6b3e93be6e8455f97f619aaefb33ae61329385eeeeb9d640bd3d` |
| New binary credential scan | PASS; bounded OpenAI/Resend/private-key signatures absent in executable and installer |
| New current-user install/notification acceptance | NOT RUN; WSL/Windows interop timed out after build, and the staging backend changes are not deployed |
| Scientific report focused domain tests | PASS; 16/16 DST, Session precedence, explicit actual, missing-data, goal alignment, Task/Habit denominator, hostile text, chart-hash, report identity, tomorrow-risk, order-stability, and bound tests |
| Functions regression after report domain | PASS; 27 files / 319 unit tests; 5 emulator files / 63 tests intentionally skipped outside explicit emulator gates |
| Scientific report type/build gate | PASS; strict Functions typecheck and production bundle; existing 511.3 kB runtime surface unchanged because no report endpoint is exported |
| Scientific report security/hygiene | PASS; static security, high-confidence changed-material credential scan, `git diff --check`, cached diff check, and exact nine-file staged review |
| Report source/archive focused tests | PASS; 23/23 source loading, truncation, auth-first, artifact identity, size, metric/chart tamper, deterministic metrics, and report-contract tests |
| Report source/archive Firestore emulator | PASS; 6/6 real owner-derived source reads, atomic create/replay, content conflict, concurrent single-create, bounded owner history, and orphan-state fail-closed tests |
| Firestore Rules after report archive | PASS; 63/63, including the exact owner-filtered/newest-first/limited history query and denial of archive mutation, forgery, cross-owner read, idempotency, and delivery-attempt state |
| Functions regression after report archive | PASS; 29 files / 326 unit tests; 6 emulator files / 69 tests correctly skipped outside their explicit emulator gates |
| Report archive type/build/security | PASS; final focused tests and strict typecheck after UID hardening; Functions build 511.3 kB with no archive runtime symbols; valid index JSON; static security; 12-file credential scan; worktree and cached diff checks |
| Report chart renderer proof | PASS; pinned `sharp@0.35.3` on Node 22 produced byte-identical 1600x920 PNGs from the deterministic SVG contract; representative output passed direct visual inspection |
| Report chart focused tests | PASS; 7/7 accessibility, hash binding, missing data, hostile label, cardinality, real native PNG, active SVG, malformed/oversized output, sequential rendering, and failure-isolation tests |
| Functions regression after chart renderer | PASS; 30 files / 333 unit tests; 6 emulator files / 69 tests correctly skipped outside their explicit emulator gates |
| Report chart type/build/security | PASS after final artifact-boundary hardening; strict Functions typecheck/build, 511.3 kB deployed bundle with no chart-renderer symbols, production dependency audit with 0 vulnerabilities, static security, changed/staged credential scans, worktree and cached diff checks |
| Report email focused tests | PASS; 17/17 deterministic Daily/Weekly HTML/text, all 16 Weekly sections, unavailable Sessions, archive/owner/chart tamper, renderer failure, active/external content, content/PNG hash, real Resend mapping, copied buffers, provider errors, invalid recipient, and transport uncertainty tests |
| Report email desktop/mobile proof | PASS locally with synthetic data; real Sharp charts rendered in a 900 px document and a 390 px responsive stacked-card document with no external URL or network request |
| Functions regression after report email | PASS; 31 files / 350 unit tests; 6 emulator files / 69 tests correctly skipped outside their explicit emulator gates |
| Report email type/build/security | PASS; strict Functions typecheck/build, unchanged 511.3 kB deployed bundle with no report-email symbols, production dependency audit with 0 vulnerabilities, static security, changed/staged credential scans, worktree and cached diff checks |
| Report email delivery focused tests | PASS; 9/9 claim-before-send ordering, content/envelope authority, no-send paths, bounded retry, invalid recipient, missing archive, and transport-ambiguity tests |
| Report email delivery Firestore emulator | PASS; 6/6 concurrent single-claim, concurrent full-service single provider invocation, bounded three-attempt retry, abandoned-claim uncertainty, rejected/ambiguous terminal state, replay, forgery, owner isolation, and no-mailbox persistence tests |
| Combined report archive/delivery emulator | PASS; 12/12 archive immutability/idempotency plus delivery claim/finalization transactions against the same local Firestore emulator |
| Firestore Rules after email delivery persistence | PASS; 64/64, including browser denial of report email controls and delivery attempts |
| Functions regression after durable email delivery | PASS; 32 files / 359 unit tests; 7 emulator files / 75 tests correctly skipped outside their explicit emulator gates |
| Durable email delivery build/security | PASS; strict Functions typecheck/build, unchanged 511.3 kB runtime bundle with no delivery symbols, static security, changed/staged high-confidence credential scans, `git diff --check`, and cached diff check |
| Report history focused coverage | PASS in the final frontend run; 4 files / 28 tests across strict decoding, bounded source/query shape, UI states, hostile text, stale owner, navigation, and delivery-state mapping |
| Report history Rules remediation | Initial run correctly failed after the limit guard was placed on the adjacent preference match; causal patch moved it to `reportArchives`; final Rules emulator 64/64 PASS, including no-limit and limit-21 denial |
| Frontend regression after report history | PASS; 62 files / 686 tests |
| Report history type/build gate | PASS; frontend typecheck and Next.js 15.5.23 production static build, 4 static pages, root route 231 kB / 333 kB first load; only established unrelated lint warnings |
| Report history security/hygiene | PASS; output-inclusive static security, Desktop attack-surface check, changed/staged credential scans, absence of server-only collection/test/provider strings in `out/`, `git diff --check`, and cached diff check |
| Report schedule focused domain coverage | PASS; 40/40 across notification normalization and deterministic Daily/Weekly planning, including opt-in authority, forged owner/instant rejection, period identity, recipient/schedule version changes, last-completed-week semantics, and both Europe/Rome DST transitions |
| Report preference frontend coverage | PASS; 12/12 Settings/preferences tests for recipient validation, Daily/Weekly persistence, missing authority, Desktop reminder preservation, native controls, and safe failures |
| Notification preference v2 Rules emulator | PASS; 64/64 real Rules tests, including exact v1 compatibility/migration, invalid or missing recipient denial, schedule-without-email denial, v2 downgrade denial, owner isolation, and all prior report/reminder security cases |
| Frontend regression after report schedules | PASS; 62 files / 689 tests |
| Functions regression after report schedules | PASS; 33 files / 369 unit tests; 7 emulator files / 75 tests correctly skipped outside their explicit gates |
| Report schedule type/build gate | PASS; frontend and Functions typechecks, Next.js 15.5.23 static build (4 pages; root 231 kB / 333 kB first load), and Functions production bundle; only established unrelated lint warnings |
| Report schedule Desktop export | PASS from clean exact `f1c78ba`; reviewed `life-tracker-staging` public Web manifest, distinguishable Beta profile, 4 static pages, Desktop scan, output-inclusive static scan, and exact SHA attestation. The generic no-profile command correctly exited 1; the first sandboxed manifest lookup exited before build, and its approved read-only retry passed |
| Report schedule security/hygiene | PASS; Desktop/static output security, changed and staged high-confidence credential scans, no scheduler symbols in the Functions entry bundle, `git diff --check`, and cached diff check |
| Report-run focused coverage | PASS; 18/18 schedule authorization, orchestration ordering, archive reuse, source failure, stale authority, delivery failure, and archive contract tests |
| Coupled report Firestore emulator | PASS; 18/18 archive, email-delivery, and report-run transaction tests, including concurrent claims, stable lease recovery, early/catch-up bounds, v1 fail-closed behavior, atomic stale suppression, exact replay/conflict, backward-time rollback, bounded failures, and provider-acceptance crash recovery |
| Firestore Rules after report runs | PASS; 65/65, including denial of owner-nested and root server-only `reportRuns` state |
| Functions regression after report runs | PASS; 34 files / 374 unit tests; 8 emulator files / 81 tests correctly skipped outside their explicit emulator gates |
| Report-run type/build/security | PASS; strict Functions typecheck/build (512.3 kB entry), no report-run/scheduler/Resend runtime symbols, static and Desktop security checks, changed/staged high-confidence credential scans, `git diff --check`, and cached diff check |
| Report scheduler focused tests | PASS; final 7 files / 46 tests across schedule mapping, manifest orchestration, endpoint metadata, exact default-off/invalid-config behavior, run, archive, and email delivery |
| Report manifest Firestore emulator | PASS; 6/6 preference enable/change/disable, bounded fixed-owner query, Daily/Weekly advancement, weekly remap/duplicate suppression, backward time, bounded failures, and concurrent full fake-provider execution |
| Coupled report Firestore emulator after scheduler | PASS; 4 files / 25 tests across archive, email delivery, run, and manifest transactions against one local emulator |
| Firestore Rules after report manifests | PASS; 66/66, including client denial of owner-nested and root schedule-manifest state |
| Functions regression after report runtime | PASS; 37 files / 393 unit tests; 9 emulator files / 88 tests correctly skipped outside their explicit gates |
| Report runtime build/security | PASS; strict typecheck and 801.2 kB reachable Functions bundle, production dependency audit 0 vulnerabilities, valid index JSON, static/Desktop security, generated-bundle and staged high-confidence credential scans, worktree/cached diff checks |
| Isolated report deployment surface | PASS at exact `169dfad`; two endpoints, nine params, two scheduled secrets, one Scheduler API, zero task queues/custom roles; bundle SHA-256 `498b1104...` |
| Default deployment after report isolation | PASS; AI + MCP only, no report/reminder endpoint, zero required APIs; source fingerprint `sha256:82c54168...` |
| Report isolation focused/broad regression | PASS; focused 4 files / 26 tests; broad 49 files / 471 tests with 97 emulator-only skips |
| Report isolation dependency/build/security | PASS; both production audits 0 vulnerabilities, strict builds, bundle/source scans, static/Desktop security, and staged diff hygiene |
| Report staging read-only inventory | PASS; Scheduler/Tasks disabled, zero Eventarc/PubSub, Resend secret absent, OpenAI versions 1/2 metadata only, three R3 IAM bindings absent |
| Scheduler pre-existing job count | NOT VERIFIED without enabling disabled Scheduler or Cloud Asset API; future approved staged inventory required |
| AI routing focused regression | PASS; 7 files / 64 tests across exact-off legacy behavior, strict manifests/ceilings, cheapest-first evidence, receipt construction, route-only dispatch, no expensive fallback, response metadata, runtime attestation, application, and HTTP boundaries |
| Functions regression after AI routing | PASS; 40 files / 410 unit tests; 9 emulator files / 88 tests correctly skipped outside their explicit gates |
| AI routing type/build/security | PASS; strict Functions typecheck, 816.8 kB bundle, evaluation corpus absent from bundle, production dependency audit 0 vulnerabilities, static/Desktop security, staged high-confidence credential scan, and diff hygiene |
| Live economical model evaluation | NOT RUN; routing remains exact `false`, Goal 1 revision/model unchanged, no provider credit or secret used, and no cheapest-adequate model asserted |
| Weekly interpretation focused gate | PASS; final 4 files / 42 tests across metric-only context, strict provider response, hostile/tampered output, routing-off secret laziness, report-run ordering, deterministic/addendum email forms, and provider failures |
| Weekly interpretation Firestore emulator | PASS; final 6/6 stable default-off, concurrent claim and concurrent full-service single-provider authority, immutable completion/replay, terminal failure/uncertainty, invalid failure code, archive conflict, and owner isolation |
| Coupled report persistence emulator before final hardening | PASS; 5 files / 30 tests across archive, email delivery, report run, schedule manifest, and interpretation transactions; later interpretation-only changes re-passed the final 6/6 gate |
| Firestore Rules after interpretation controls | PASS; 67/67, including denial of nested and root `reportInterpretations` reads/writes |
| Functions broad regression after interpretation | PASS; 41 files / 424 unit tests; 10 emulator files / 93 tests skipped in that non-emulator command, followed by the new sixth explicit interpretation-emulator assertion passing in the real emulator |
| Weekly interpretation type/build gate | PASS; strict Functions typecheck and Node 22 production build, 866.8 kB entry bundle, exact default-off runtime, and evaluation corpus absent from the bundle |
| Weekly interpretation security/hygiene | PASS; production dependency audit 0 vulnerabilities, static/Desktop security checks, changed/staged and generated-bundle credential scans, `git diff --check`, and staged diff check |
| MCP focused unit/HTTP coverage | PASS; 7 files / 42 tests, with the 3 persistence-emulator tests skipped only in this non-emulator command; OAuth/PKCE, Firebase identity, consent/CSRF, exact tools, schemas/bounds, hostile content, rate limiting, discovery, and Streamable HTTP covered |
| MCP Firestore transaction emulator | PASS; 3/3 concurrent one-time code exchange, rotating refresh, hash-only persistence, revocation, tamper fail-closed behavior, owner isolation, and serialized rate limiting against the real local emulator |
| Firestore Rules after MCP controls | PASS; 72/72, including browser denial for all five nested and root OAuth/rate-limit namespaces |
| Functions broad regression at MCP checkpoint | PASS on exact `4219f57`; 47 test files passed / 11 explicit emulator files skipped, 465 tests passed / 97 skipped |
| MCP type/build/endpoint gate | PASS; strict Functions typecheck and Node 22 production build; source fingerprint `sha256:06b87ff4e25edfd8931533d5cc351f0ed85d07b71db9320dea6386ca8f5f9167`; one public HTTPS OAuth-protected endpoint, region `europe-west1`, 60-second timeout, 512 MiB, concurrency 20, max instances 2, no secret bindings |
| MCP dependency/security/hygiene | PASS; production dependency audit 0 vulnerabilities, static/Desktop security, valid Rules/index JSON, changed/staged and generated-bundle high-confidence credential scans, `git diff --check`, staged diff check, and no unstaged overlap |
| MCP deployment and real ChatGPT acceptance | NOT RUN; runtime remains default-off, no endpoint/account setting changed, and real Developer Mode questions remain an explicit later human/cloud gate |
| Live GitHub/Pages privacy snapshot | PASS read-only; repository public, `has_pages: true`, Pages HTTP 200, one active custom deployment workflow plus the GitHub Pages system workflow, latest deployment successful at `main@5ea3280`, zero releases/tags/forks/stars/subscribers, and 30/30 listed artifacts expired |
| Desktop repository-independence tests | PASS; 7/7 Desktop config test files, including negative Pages/raw/content/archive/API/release/object URL assertions and safe local/Firebase controls |
| Desktop repository-independence enforcement | PASS; runtime/config/source scan, updater dependency/init denial, Desktop security, expanded all-workflow static security, syntax/JSON parsing, changed/staged credential scans, and diff hygiene |
| Pages workflow and GitHub mutations during preflight | PASS unchanged; `.github/workflows/deploy.yml` is outside the diff and no Pages, visibility, DNS, Actions setting, tag, release, branch, or billing mutation occurred |
| R7 live privacy conversion | NOT RUN; production prerequisites, authenticated admin/custom-domain verification, workflow replacement, exact human approval, unpublish evidence, and private-access checks remain required |
| Current-source staging Desktop export | PASS at exact `ced322e7`; reviewed public Firebase manifest, 4 static pages, exact source/environment/runtime/backend attestations, and output-inclusive security scan |
| Current-source Windows Tauri build | PASS; optimized x64 `Life Tracker Beta` 1.0.0 executable plus one NSIS bundle; no install performed |
| Current executable/installer | 6,478,848-byte executable SHA-256 `cd24d9dfdde54e7f66691dec67e09eebbbf12f3281719c3771356f59f627f519`; 2,386,292-byte installer SHA-256 `032403ca52c6a367f814adee37e9a95d03e55309988c215ffedadabdcd77d23d` |
| Current artifact signing | `NotSigned` for executable and installer; recorded as a Beta distribution limitation, not represented as Authenticode PASS |
| Current artifact security | PASS for provider credential names/key shapes and Life Tracker GitHub/Pages runtime URLs; one broad Resend-shape false positive traced by hash/compiled lineage to `tauri_runtime_wry`, absent from source/export/installer |
| Minimal R1 Function proof | PASS at exact `3100c42`; 3 files / 32 affected tests, strict typecheck/build, one deployable endpoint, production dependency audit 0 vulnerabilities, source/bundle credential scans, and diff hygiene |
| Minimal R1 expected fingerprints | Backend `sha256:8bec8a4cea3b148f56f9fdd3b6643edcd1f64ac0dd05eb3f9f35c0eb9b342a06`; exact three-origin Sol/medium runtime `sha256:6ef03a915ff73a9d688bd416fd13a622b9effc9c5573963d39eb85d563e50a7f` |
| R1 staging deploy/install | NOT RUN; exact Function-only approval and post-deploy CORS/attestation checks are required before installer use |
| R1 automated baseline verifier | PASS; 16/16 public GET/POST-preflight probes, two exact allows, six exact denies, and full Goal 1 fingerprints |
| R1 post-deploy verifier | Expected pre-deploy exit 1; live release/runtime remain baseline, so Desktop acceptance correctly cannot pass yet |
| Local emulator Java prerequisite | PASS without repository/OS mutation; official Temurin JRE `21.0.12.1+1` downloaded only to `/tmp`, exact 52,059,408-byte size and SHA-256 `2413149700df0f7d440500a84a8f764c535f21e5a5e87d38328b64eec2c5b500` matched current Adoptium API metadata |
| Native server channel gate | PASS at exact `3f0d441`; default/malformed/unavailable WhatsApp switch creates no cloud job or enqueue and preserves Desktop reconciliation |
| Native reminder focused regression | PASS; 6 files / 71 tests, including the final 8/8 runtime-binding gate |
| Functions regression after channel hardening | PASS; 47 files / 468 tests; 11 explicit emulator files / 97 tests correctly skipped outside emulator gates |
| Native reminder type/build/security | PASS; strict typecheck, 962.5 kB bundle, source fingerprint `sha256:3ee25396...`, static security, changed/generated credential scan, and diff hygiene |
| Isolated native deployment surface | PASS at exact `eb34cd1`; four endpoints, zero params/secrets/task queues/schedulers/custom roles/required APIs; 119,038-byte bundle SHA-256 `1e5ba4f1...` |
| Default deployment separation | PASS; exactly AI/MCP/two-report endpoints and no reminder endpoint; current default config is not used for native deployment |
| Native isolation focused regression | PASS; 3 files / 11 tests for compile-time Desktop-only behavior, endpoint metadata, and exact default deploy surface |
| Functions regression after deploy isolation | PASS; 49 files / 471 tests; 11 explicit emulator files / 97 tests correctly skipped outside emulator gates |
| Native isolation dependencies/build/security | PASS; both production audits 0 vulnerabilities, default and isolated strict builds, static security, isolated bundle scan, and staged diff hygiene |
| Native staging billing/API preflight | PASS read-only; billing already linked, required APIs enabled, Cloud Tasks/Scheduler disabled, and no API/billing change required |
| Native staging IAM preflight | PASS read-only; exact three first-Eventarc managed bindings absent and isolated for a future explicit approval |
| Native staging resource preflight | PASS read-only; one unchanged AI Function, zero Eventarc triggers, zero Pub/Sub topics, Goal 1 Rules/index baseline intact |
| Reminder TTL safety preflight | PASS count-only; all nine reminder runtime namespaces contain zero documents |
| Native reminder staging deployment | NOT RUN; exact four-Function plus reviewed Rules/reminder-only-index approval remains separate from R1 |

## Release status

- R1 Desktop Beta using verified staging: IN PROGRESS — current-source x64 NSIS artifact and exact minimal Function-only deployment/rollback receipt are green; staging CORS deployment, install, and visible acceptance remain pending
- R2 Production Desktop: READ-ONLY AUDIT COMPLETE; PROMOTION NOT STARTED
- R3 Native and cloud reminders: IN PROGRESS — deterministic domain, persistence, reconciliation, task adapter, at-most-once service, Firestore delivery claims/receipts/status, named private worker, authoritative triggers/refill, Twilio adapter/signed callback, authenticated native coordinator/policy, server-side cloud-channel gate, and an exact isolated four-endpoint native staging codebase are green; staging deployment and installed/live delivery remain pending
- R4 Daily and weekly reports: IN PROGRESS — deterministic metrics, Daily/Weekly fallback contracts, formula specification, scientific statement discipline, bounded owner-scoped source reads, immutable/idempotent report archives, accessible local SVG/PNG charts, responsive HTML/text composition, provider-neutral Resend mapping, durable at-most-once email claims/finalization, bounded owner-scoped report history, preference v2, DST-safe due-period planning, durable claim/generate/archive/reauthorize/deliver orchestration, default-off fixed-owner runtime scheduling, isolated exact two-endpoint deploy codebase, default-off economical workload routing/evaluation, and bounded post-archive Weekly strategic interpretation are green; secure secret/sender/domain configuration, Scheduler staging gate, deployment, and live Daily/Weekly delivery remain pending
- R5 WhatsApp Sandbox and production-ready path: IN PROGRESS — provider, signed delivery-status persistence, disabled-by-default runtime binding, and named worker/callback are green locally/emulator; Sandbox join/configuration, cloud deployment, and real delivery pending
- R6 ChatGPT read integration: IN PROGRESS — the authenticated, owner-scoped, bounded, zero-write MCP/OAuth server is green locally and in the Firestore/Rules emulators; deployment and a real ChatGPT Developer Mode connection remain pending
- R7 Pages removal and repository privacy conversion: PREPARED — live state refreshed, recovery/conversion runbook and Desktop runtime-independence guard are green; workflow replacement, explicit unpublish, private conversion, and post-change acceptance remain gated

## External blockers

The original R1 installer is installed, and a superseding installer from
`318d7a6` is built but not installed. WSL/Windows interop timed out after the
successful build; installed authentication/domain/native-notification
acceptance therefore still needs direct interaction on Francesco's Windows
desktop.

The existing explicit staging gate remains approval to deploy only
`lifeTrackerAiApi` to the positively identified `life-tracker-staging` project
with the reviewed Desktop-origin allowlist, using detached one-endpoint source
`3100c42`. The separate native-reminder staging boundary is now fully recorded
in `docs/REMINDER_RUNTIME_PREDEPLOY.md`: current owner-scoped Rules, the
reminder-only index manifest, exactly four secret-free Functions in isolated
codebase `reminders`, and the exact three absent first-Eventarc managed IAM
grants. Cloud Tasks, Scheduler, worker, callback, refill, Twilio, reports, MCP,
runtime parameters, and provider configuration remain structurally excluded.
Request that separate approval only after the immediate R1 gate. No staging or
production resource changed in this slice.

Scientific report deployment is another separately reviewed staging gate.
`docs/REPORT_RUNTIME_PREDEPLOY.md` now records codebase `reports`, the exact two
Functions, two report indexes/one field override, already-reviewed Rules hash,
scheduled endpoint secret bindings, refreshed API/resource/IAM/secret metadata,
cost envelope, staged Scheduler inventory, separate default-off switches, and
rollback. `RESEND_API_KEY` is confirmed absent. A future Resend
credential/sender/domain action must be performed by Francesco through a
trusted provider/Secret Manager surface and must never be pasted into chat. No
such action is requested before R1 and the complete native/cloud R3 staging
gates are green.

Economical routing has a separate paid-evaluation/activation gate documented in
`docs/AI_MODEL_ROUTING_EVALUATION.md`. The technically green parser, bounds,
synthetic corpus, selector, and receipts do not establish live model quality.
Do not run the live corpus, read a provider secret, spend OpenAI credit, change
budget/auto-reload, or enable routing until independent work is checkpointed and
one exact maximum-cost staging action is approved. Goal 1's verified Sol staging
revision remains untouched.

The read-only MCP server has a separate deployment/connection gate documented
in `docs/MCP_RUNTIME_PREDEPLOY.md`. Its local implementation is default-off and
has no provider secret, but real acceptance requires one explicit root HTTPS
deployment origin, reviewed Firebase public Web configuration, the fixed owner,
and Francesco's interactive Firebase consent inside ChatGPT Developer Mode.
Do not deploy it, enable the runtime, change a ChatGPT account setting, or claim
real-client verification until the production/staging target and cost diff are
approved. This does not block privacy/release dependency preparation.

R7 account mutations remain a late release gate. The repository and Pages site
are still public by design, and the active deployment workflow is unchanged.
`docs/REPOSITORY_PRIVACY_PREDEPLOY.md` requires production Desktop/backend
acceptance, a recovery tag, authenticated custom-domain/DNS inspection, a
reviewed non-Pages CI replacement, and one exact approval before unpublish or
visibility changes. The local GitHub CLI admin session is expired; future
reauthentication must use GitHub's trusted interactive surface without exposing
a token. No such action is requested yet.

The immediate R1 gate is now one exact staging mutation documented in
`docs/R1_STAGING_DEPLOY_PRECHECK.md`: deploy only `lifeTrackerAiApi` from
minimal source `3100c42` to explicit project `life-tracker-staging`, retaining
Sol/medium, both Goal 1 origins, both existing secret versions, and adding only
`https://tauri.localhost`. It creates one new build/revision and can incur the
staging project's existing cloud costs, but enables no API/billing/provider
loop. The current artifact must not be installed or used for Ask AI until the
post-deploy `npm run verify:r1-staging:desktop` fingerprint, GET, and
authenticated-POST preflight matrix pass.

Production promotion has a separate later cost gate: `life-tracker-12000` has
no billing link and its required backend APIs are disabled. Do not enable
billing, APIs, or paid services without explicit human approval. This does not
block independent local/emulator implementation.

## Exact next step

Commit and push this progress checkpoint, then request the single exact R1
staging approval quoted in `docs/R1_STAGING_DEPLOY_PRECHECK.md`. Do not broaden
that approval to any other Function, Rule, index, parameter, secret, API,
billing setting, provider call, production target, or Desktop installation.

If approved, recreate a clean detached `3100c42` worktree, install its exact
lockfile, create only the reviewed four-line non-secret staging parameter file,
repeat project/source/endpoint/secret-metadata checks, and deploy with exact
scope `--project life-tracker-staging --only functions:lifeTrackerAiApi`.
Immediately prove the new full backend/runtime fingerprints, original-origin
continuity, exact Desktop-origin allow, near-match/Pages denies, unchanged
resource bounds/secret versions, one endpoint, and production isolation. The
first public gate is `npm run verify:r1-staging:desktop`; any nonzero exit aborts
installation and provider use.

Only after those checks pass, install the freshly hashed Beta and complete the
visible authentication, Goal/Project/Task/TimeBlock/Session/Habit/Analytics,
Ask AI preview/apply/undo, native notification/autostart, offline, expired-auth,
backend-unavailable, tray, single-instance, and restart acceptance matrix.

After R1 is green, the next distinct staging mutation is the native-only R3
sequence in `docs/REMINDER_RUNTIME_PREDEPLOY.md`. Reconfirm its zero-count/API
preconditions and request exact approval for current Rules, the reviewed
reminder-only index manifest, only the four secret-free native Functions via
`firebase.reminders.json`, and only the three documented first-Eventarc managed
IAM additions that remain absent. Do not combine that future approval with
Cloud Tasks, Scheduler, Twilio, reports, MCP, production, or any provider
credential/action.
