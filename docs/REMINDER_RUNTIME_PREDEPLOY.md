# Native reminder staging pre-deploy boundary

Status: `GREEN LOCALLY — NOT DEPLOYED`

Prepared: 2026-08-25 (Europe/Rome)

This receipt defines the smallest reviewed staging change that can support
authenticated native Windows reminders without enabling WhatsApp, Cloud Tasks,
Cloud Scheduler, email, MCP, or a provider call. It is evidence and a proposed
mutation boundary; it is not deployment approval.

Production project `life-tracker-12000` is expressly out of scope. No staging
or production Function, Rule, index, TTL policy, document, API, IAM binding,
runtime parameter, secret, billing setting, provider account, or Desktop
installation was changed while preparing this receipt. The only live data
access was bounded read-only metadata and count-only Firestore aggregation.

## Exact source authority

- Application branch: `codex/life-tracker-os`
- Native reminder implementation checkpoint:
  `eb34cd1fdbbbe9eced03bf1ed96905fa6ccf745d`
- Server channel-gate checkpoint:
  `3f0d441725f95de290e8a73c2fcaeb290836ba14`
- Isolated Firebase config Git blob:
  `b0de965330b472399e3eed6ed1f650a62a393eb9`
- Isolated lockfile Git blob:
  `ed8ce32053b3d09bb339c1cb69b1fcfb9983d0b4`
- Isolated deploy bundle: 119,038 bytes; SHA-256
  `1e5ba4f135cc3ad2542b7f2981691c614a90b960142c5e91fa139959e953cef2`
- Default Functions source fingerprint at the native-isolation checkpoint:
  `sha256:cd838b04e641d893473a81e5444dc187c10f1c766b5044ad1017f2b9899b2a5a`
- Current default Functions source fingerprint after later report/MCP
  separation at `099c579`:
  `sha256:bec32f91c16273d006d14221438e974bc2ed836be6e85d35e04ba6965694d655`
- Functions runtime/toolchain: Node 22; pinned Firebase CLI `15.28.1`
- Locked isolated dependencies resolve to `firebase-admin@14.3.0` and
  `firebase-functions@7.3.2`
- Firebase project: `life-tracker-staging`
- Project number: `675076431391`
- Region: `europe-west1`

`firebase.reminders.json` contains one Functions source and no Firestore,
Hosting, Auth, Storage, or emulator target. Its codebase is `reminders`; its
predeploy step compiles `functions-reminders/src/index.ts` into one local
bundle. Full Firebase Functions SDK discovery—not a source-text inference—then
returns exactly the four endpoints below, zero parameter specifications, zero
secret bindings, zero task queues, zero schedulers, and zero required APIs.
The ordinary `firebase.json` and default Functions bundle are not deployment
authority for this slice.

## Current live staging baseline

Fresh read-only inventory proved:

- billing is already enabled and a billing account is already linked; no
  billing change is needed or authorized;
- the authenticated Firebase principal was positively identified; its email is
  intentionally omitted from this public-repository document;
- exactly one live Function exists: active Gen 2 Node 22
  `lifeTrackerAiApi` in `europe-west1`;
- that Function still uses `gpt-5.6-sol`, reasoning `medium`, and the two Goal 1
  origins. The Desktop origin has not been deployed;
- Eventarc has zero triggers in `europe-west1` and Pub/Sub has zero topics;
- Cloud Tasks and Cloud Scheduler APIs are disabled;
- the live Firestore Rules source is 10,303 bytes with SHA-256
  `78f8b6dc22faf62f444986dad0fb8ab9a5964c54da754305205d182bd3fa790f`,
  exactly matching the verified Goal 1 Rules;
- the live Firestore index state exactly matches Goal 1: one composite index
  and six TTL field overrides.

The required native infrastructure APIs are already enabled:

| API | Current state | Native deployment use |
| --- | --- | --- |
| Cloud Functions | enabled | four Gen 2 Functions |
| Cloud Run | enabled | Gen 2 execution |
| Cloud Build | enabled | deployment build |
| Artifact Registry | enabled | deployment artifact |
| Eventarc | enabled | three Firestore triggers |
| Pub/Sub | enabled | managed Eventarc transport |
| Firestore | enabled | Rules, indexes, owner-scoped reminder state |
| Secret Manager | enabled | existing platform; native four bind no secret |
| Cloud Tasks | **disabled** | excluded |
| Cloud Scheduler | **disabled** | excluded |

An approved native deployment must not enable either disabled API. If Firebase
proposes Cloud Tasks, Cloud Scheduler, a provider secret, or any unrelated
service, abort before mutation and re-review the plan.

### First-Eventarc IAM delta

The read-only IAM preflight found that the three Firebase-managed bindings
normally required for a project's first Gen 2 Eventarc Functions are currently
absent. A real deployment approval must therefore name these additions
explicitly. They match the current Firebase CLI `15.28.1` first-integrated-event
service behavior and the official
[Eventarc Cloud Run target roles](https://cloud.google.com/eventarc/docs/roles-permissions):

- grant `roles/iam.serviceAccountTokenCreator` to
  `service-675076431391@gcp-sa-pubsub.iam.gserviceaccount.com`;
- grant `roles/run.invoker` to
  `675076431391-compute@developer.gserviceaccount.com`;
- grant `roles/eventarc.eventReceiver` to
  `675076431391-compute@developer.gserviceaccount.com`.

These are service-agent/default-compute bindings, not permission for a human or
Desktop client. No project-wide editor/owner role, custom role, public
invoker, provider principal, or production IAM change is authorized. Recheck
the live policy immediately before deployment and omit any grant that has
become present. Abort if the CLI asks for a different principal or role.

## Exact Function allowlist

Deploy exactly these four new Gen 2 exports:

| Export | Edge/trigger | Limits | Secrets |
| --- | --- | --- | --- |
| `desktopReminderApi` | public callable; exact CORS allowlist; Firebase Auth required in handler | 15 s, 256 MiB, min 0, max 2, concurrency 20 | none |
| `reconcileTimeBlockReminders` | internal/private Firestore write on `users/{uid}/timeBlocks/{timeBlockId}` | 120 s, 256 MiB, min 0, max 2, concurrency 4 | none |
| `reconcileNotificationPreferenceReminders` | internal/private Firestore write on `users/{uid}/notificationPreferences/default` | 300 s, 256 MiB, min 0, max 1, concurrency 1 | none |
| `reconcileUserProfileReminders` | internal/private Firestore write on `users/{uid}` | 300 s, 256 MiB, min 0, max 1, concurrency 1 | none |

The callable CORS allowlist is exactly:

- `https://tauri.localhost`
- `http://127.0.0.1:3000`
- `http://localhost:3000`

The callable derives UID only from Firebase callable authentication, accepts no
client-selected owner, bounds the list to 64 jobs, looks back 10 minutes and
ahead 24 hours, and returns a 60-second refresh interval. Both `list` and
`claim` are owner-hash rate-limited to 30 actions per minute. App Check is not
enforced in this Beta path; Firebase Auth, exact owner paths, strict schemas,
transactional authority checks, CORS, and the durable rate limit remain the
compensating controls. App Check remains a documented defense-in-depth follow-up.

The three event Functions use `retry: true`. Current Firebase documentation
states that a newly created Gen 2 event Function has a 24-hour retry window with
exponential backoff between 10 and 600 seconds. That is bounded but can still
incur cost during a persistent fault. Each handler is idempotent, rereads
authoritative owner-scoped state, and has bounded fan-out; unexpected sustained
retry activity is a rollback signal. See the official
[Firebase asynchronous retry guide](https://firebase.google.com/docs/functions/retries).

## Server-side channel kill switch

The pre-deploy review found and fixed a material native-only risk. Before
`3f0d441`, `REMINDER_WHATSAPP_ENABLED=false` prevented provider construction but
did not prevent reconciliation from deriving WhatsApp jobs and enqueueing Cloud
Tasks when a user preference requested the channel.

At `3f0d441` the future full reminder runtime's server switch was enforced
before reminder-policy derivation. At `eb34cd1`, the staging-native codebase
was made stronger and compile-time Desktop-only:

- every user preference is copied into a server-owned reconciliation input with
  `whatsappEnabled=false` before policy derivation;
- Desktop jobs continue to reconcile normally;
- the isolated bundle declares no `REMINDER_WHATSAPP_ENABLED` parameter and no
  other runtime parameter;
- no Cloud Tasks adapter, task worker, scheduled refill, Twilio provider, or
  callback is reachable from the isolated entry point;
- both queue enqueue and cancellation adapters fail closed if an impossible
  cloud path is reached, while the three trigger handlers retain sanitized,
  bounded retry behavior.

The default full-runtime gate remains in source for the later separately
reviewed cloud/WhatsApp release, but its constructed endpoints are no longer
exported by the default Firebase entry. Future cloud enablement must deliberately
replace or migrate the `reminders` codebase after a new deploy-surface review;
it cannot be activated by setting a preference or environment value in this
native build.

The count-only staging audit found zero documents in every reminder runtime
namespace:

- `reminderJobs`
- `reminderManifests`
- `deliveryAttempts`
- `deliveryReceipts`
- `notificationIdempotency`
- `reminderDeliveryCounters`
- `providerDeliveryStatuses`
- `reminderProviderCallbackRoutes`
- `reminderApiRateLimits`

There is therefore no old WhatsApp job to cancel and no existing reminder TTL
document to delete at this pre-deploy checkpoint. Firestore contains no
notification-preference document, so trigger creation cannot backfill or fan
out until a future authorized preference/profile/TimeBlock write occurs.
Firestore event triggers do not process historical writes merely because the
Function is deployed.

## Structurally excluded Functions

The isolated codebase discovers exactly four endpoints. These seven endpoints
are not merely omitted by a command-line filter; they are absent from its
compiled export surface:

- `lifeTrackerAiApi`
- `deliverReminderTask`
- `refillDeferredReminders`
- `twilioWhatsAppStatusCallback`
- `reconcileScientificReportSchedules`
- `deliverScheduledScientificReports`
- `lifeTrackerMcp`

At this native-isolation checkpoint the default codebase separately discovered
`lifeTrackerAiApi`, `lifeTrackerMcp`, `reconcileScientificReportSchedules`, and
`deliverScheduledScientificReports`; it contained no reminder endpoint. Later
report and MCP isolation reduced the current default codebase to only
`lifeTrackerAiApi` at `099c579`. This history is precisely why the native deploy
must use `firebase.reminders.json` rather than relying on `--only` filtering of
the ordinary config: Firebase CLI prerequisite checks occur against the
discovered backend before endpoint filtering.

This separation preserves the verified Goal 1 revision and its pending,
separately reviewed Desktop-CORS deployment. It prevents creation of a Cloud
Tasks queue, Cloud Scheduler job, Twilio callback, Resend/OpenAI report runtime,
or MCP endpoint. `TWILIO_AUTH_TOKEN`, `RESEND_API_KEY`, `OPENAI_API_KEY`, and
`AI_CAPABILITY_SIGNING_SECRET` are not declared or bound by the isolated
codebase. No secret value, new version, parameter, or binding is authorized. If
the CLI requests secret creation or value entry, abort.

Do not use Firebase `--dry-run` as a supposedly read-only preflight against a
broader config. Current CLI behavior can ensure APIs or service identities
before its dry-run exit. The safe local preflight is the checked-in SDK
discovery test; the first cloud command must itself be covered by the exact
mutation approval below.

## Rules boundary

The current client writes version 2 notification preferences because scientific
report settings share the same provider-neutral preference document. Deploying
the older reminder Rules would reject the current Settings UI. The proposed
Rules source is therefore the current reviewed file at `eb34cd1`:

- Git blob: `439fa4c057cde23fa813bba762cbd70374019053`
- SHA-256:
  `2b4a86baea34655cb268d885e11edc76c843691321fd75508094338a9bc72514`
- size: 19,909 bytes; 534 lines

Relative to Goal 1, the Rules changes add owner-scoped notification preference
access, immutable owner-scoped report-history reads, and explicit browser
denials for every reminder/report/MCP server namespace. They do not alter the
verified AI ownership, approval, execution, audit, idempotency, or rollback
rules. The exact current Rules passed 72/72 official emulator tests at
`4219f576c36ca3578f4f331690aff45fc2316c04` and have not changed since.

This Rules deployment makes later report/MCP server namespaces explicit but
does not deploy their Functions, create their documents, or enable their
runtimes.

## Reminder-only index and TTL boundary

Do **not** deploy the current canonical `firestore.indexes.json` in this slice:
it also contains report and MCP metadata that is outside native-reminder scope.
Use the already reviewed reminder-only manifest from exact commit
`318d7a6384fe6e313412e4d216ebbeea32d7cbc7`:

- Git blob: `21f17e22c601fcdbf726db4b6ac1ef5e806a1673`
- SHA-256:
  `eed52250345fc3765de9e41ec67e45f6ccfe347c9c84593fa9cf997aabc857a9`
- size: 2,897 bytes; 128 lines

It preserves all one-composite/six-TTL Goal 1 metadata and adds only reminder
metadata:

- composite `timeBlocks` collection query: `status ASC`, `endTime ASC`;
- composite `reminderJobs` collection-group query: `state ASC`,
  `scheduledFor ASC`;
- composite `reminderJobs` owner-collection query: `state ASC`,
  `scheduledFor ASC`;
- TTL `purgeAt` for eight reminder delivery/control collection groups;
- TTL `expiresAt` for `reminderApiRateLimits`.

Expected final metadata is four composite indexes and fifteen TTL field
overrides. Index creation consumes storage/build work. TTL deletes are billed,
are not covered by Firestore's free delete quota, and enabling TTL on a
non-empty namespace can bulk-delete already expired documents. The zero-count
proof above is therefore a mandatory precondition and must be repeated
immediately before deployment. Future expired server-owned reminder controls
are intentionally eligible for TTL; no user Goal, Project, Task, TimeBlock,
Session, Habit, or report artifact has a TTL in this manifest. See the official
[Firestore TTL guide](https://firebase.google.com/docs/firestore/ttl) and
[Firestore pricing guide](https://firebase.google.com/docs/firestore/pricing).

## Runtime configuration boundary

The isolated native codebase has no runtime parameter or secret specification.
Do not create a `functions-reminders/.env.*` file, copy the default Functions
environment, or enter a value during this deployment. Owner identity continues
to come from verified Firebase Auth for the callable and from exact Firestore
trigger path parameters for reconciliation; there is no fixed UID, mailbox,
phone number, provider account, model, or origin parameter in this bundle.

The callable's three-origin CORS policy is a reviewed source constant. The
default AI Function's model/origin/secret configuration is outside this
codebase and must remain byte-for-byte/runtime-fingerprint unchanged by the
native-reminder slice.

## Cost envelope

This is a low-volume personal workload, not a zero-cost promise.

- All four Functions have `minInstances: 0`; there is no intentionally warm
  compute. Builds, Artifact Registry storage, invocations, CPU/memory, network,
  logs, and Firestore operations can use the staging billing account's existing
  paid/free-tier capacity. See [Cloud Run pricing](https://cloud.google.com/run/pricing).
- Eventarc Standard currently charges US$0 for Google-source events, with the
  first 50,000 chargeable events/month free; its Pub/Sub transport has separate
  Pub/Sub pricing. The personal write-driven volume should be small, but actual
  billing-account usage remains authoritative. See
  [Eventarc pricing](https://cloud.google.com/eventarc/pricing).
- The Desktop normally lists once per minute while it is open. Each list uses
  one rate-limit transaction and an owner-scoped bounded query. Eight hours/day
  is about 480 callable invocations/day; even a continuously open client is
  about 1,440/day. Claims happen only for due jobs. The server hard limit is 30
  lists and 30 claims per owner per minute.
- Preference/profile reconciliation queries at most 100 future active
  TimeBlocks and uses concurrency at most four. Each TimeBlock write targets
  only that owner/path. There is no global minute poll.
- Firestore's current qualifying-database free quota is 50,000 document reads,
  20,000 writes, and 20,000 deletes/day. Shared project usage, index-entry
  reads/storage, transaction retries, TTL deletes, and non-free features still
  count under the official pricing rules.
- Native scope creates no Cloud Tasks queue and no Scheduler job. For the later
  cloud phase only, current official pricing is US$0.40/million Cloud Tasks
  billable operations after the first million/month and US$0.10 Scheduler
  job/month with three free jobs per billing account. See
  [Cloud Tasks pricing](https://cloud.google.com/tasks/pricing) and
  [Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing).
- Twilio, Resend, and OpenAI volume is exactly zero in this slice. No provider
  plan, budget, auto-reload, domain, phone, sender, or credential is changed.

## Local and read-only evidence

| Gate | Result |
| --- | --- |
| New kill-switch tests | final 8/8 PASS: false/malformed/unavailable state prevents enqueue, preserves Desktop, and best-effort cancels old work |
| Isolated native-runtime tests | 2/2 PASS: endpoint metadata and an untrusted WhatsApp preference produce one Desktop-only job with zero enqueue |
| Focused deploy-surface regression | 3 files / 11 tests PASS |
| Full Functions regression | 49 files / 471 tests PASS; 11 emulator files / 97 tests correctly skipped outside explicit emulator gates |
| Default Functions typecheck/build | PASS; source fingerprint `sha256:cd838b04...`; 952.9 kB bundle plus 1.8 MB source map |
| Isolated Functions typecheck/build | PASS; 119,038-byte deploy bundle with SHA-256 `1e5ba4f1...` |
| Prior coupled reminder Firestore emulator | 20/20 PASS; persistence code is unchanged by `3f0d441` |
| Current Firestore Rules emulator | 72/72 PASS; Rules unchanged since that checkpoint |
| Isolated SDK deploy discovery | PASS; exact four endpoints, zero params/secrets/task queues/schedulers/custom roles/required APIs |
| Default SDK deploy discovery at native isolation | PASS; exact AI/MCP/two-report surface and no reminder endpoint; not used for this deploy |
| Current default SDK discovery | PASS at later `099c579`; Secure AI endpoint only; isolated native authority unchanged |
| Isolated production dependency audit | PASS; 0 vulnerabilities |
| Default Functions production dependency audit | PASS; 0 vulnerabilities |
| Static security | PASS |
| Changed/generated credential scan | PASS; no high-confidence credential-shaped value or provider/runtime symbol in the isolated bundle |
| Diff hygiene | `git diff --check` and staged diff check PASS |
| Staging billing/API inventory | PASS, read-only; no new API required for native scope |
| Staging managed-IAM inventory | PASS, read-only; the exact three first-Eventarc bindings above are absent and require explicit approval |
| Staging Rules hash | PASS; exact Goal 1 source |
| Staging Eventarc/Pub/Sub inventory | 0 triggers / 0 topics |
| Staging reminder namespace counts | all nine are 0 |

One initial focused assertion expected one superseded job; the real deterministic
policy transition correctly superseded both old channel-bound jobs and created
one new Desktop-only job. The assertion was corrected, then focused and full
regressions passed. One non-mutating Firestore count request had a transient
transport failure; its bounded retry succeeded. Neither diagnostic changed
cloud state.

## Approval-time sequence

No action below is authorized by this document. After the existing R1
`lifeTrackerAiApi` Desktop-CORS gate is separately resolved, repeat all live
preconditions and request one exact native-reminder staging approval.

If approved:

1. Reconfirm clean local/origin implementation SHA `eb34cd1...`, explicit
   project ID/number, authenticated principal, billing/API state, the single
   live AI Function, live Goal 1 Rules/index hashes, zero Eventarc/Pub/Sub
   resources, and zero reminder-namespace counts. Re-read only the three
   managed IAM bindings above.
2. Create two clean detached `/tmp` worktrees: current `eb34cd1...` for Rules
   and Functions, and `318d7a6...` for the exact reminder-only index manifest.
3. Install only exact lockfiles as needed, repeat tests/build/discovery/scans,
   and prove the isolated bundle hash/surface. Do not create or read an
   environment file and do not use a broader Firebase config.
4. Deploy current Rules only to explicit `life-tracker-staging`. Verify the live
   SHA-256 is `2b4a86ba...` in full and Goal 1 browser/security probes remain
   green.
5. From the `318d7a6...` worktree deploy Firestore indexes only. Abort on any
   deletion outside the expected metadata reconciliation. Wait until all four
   composites and fifteen TTL policies are ready.
6. Approve only the three absent managed IAM additions listed above, then from
   the `eb34cd1...` worktree deploy the complete isolated `reminders` codebase,
   whose discovery test must still return exactly the four named Functions:

```text
node <reviewed-firebase-cli> deploy \
  --config firebase.reminders.json \
  --project life-tracker-staging \
  --only functions
```

7. Reject any plan or warning that mentions an excluded Function, Function
   deletion, Hosting, Auth, Storage, production, Cloud Tasks, Scheduler,
   Twilio, Resend, MCP, provider secret, API enablement, billing change, or an
   IAM principal/role outside the exact three-grant allowlist.

## Required post-deploy acceptance

Before claiming native reminders work:

1. Staging has exactly five Functions: the unchanged Goal 1 AI Function plus
   the four reviewed native exports. Record source/resource metadata for each.
2. The AI revision, source hash, model, reasoning, origins, secret versions,
   runtime fingerprint, and backend fingerprint are unchanged by this slice.
3. Eventarc has exactly the three reviewed Firestore triggers with internal
   ingress, private invocation, correct paths, retry policy, region, and bounds.
   The project-IAM delta contains only the exact approved first-Eventarc
   additions.
4. Cloud Tasks and Scheduler remain disabled; no task queue, scheduler job,
   Twilio callback, report Function, or MCP Function exists.
5. Live Rules and indexes match the exact hashes/counts above. All reminder
   namespaces were empty before TTL activation.
6. Unauthenticated and malformed callable requests fail closed. Exact Desktop
   and development origins pass CORS; HTTP/subdomain/explicit-port/attacker
   near-matches fail.
7. An authorized staging preference requesting both channels is overridden by
   the compile-time native policy and creates Desktop jobs only, zero WhatsApp
   jobs, and zero Cloud Tasks operations. No runtime parameter exists that can
   enable the cloud channel.
8. The installed Desktop proves notification permission state, before/start/
   missed-start display, click-to-focus only, duplicate suppression, restart,
   offline/backend-unavailable behavior, expired auth, and denied permission.
9. Moving, deleting, cancelling, completing, or starting a Session for the
   isolated reversible test TimeBlock suppresses stale delivery. A notification
   click never completes work or creates a Session.
10. Count-only cleanup verification proves no synthetic acceptance fixture is
    left in analytics/reminder state. No real user data is deleted.

## Recovery

The immediate user-visible stop is to disable Desktop reminders in Settings
and close the Desktop app. The coordinator stops polling and displaying native
notifications; this does not mark any work complete or alter Sessions.

If a deployed callable is faulty, leave Rules/data intact and deploy a reviewed
fix. If event triggers produce sustained failures or cost, explicitly delete
only the three new trigger Functions (or all four Functions in codebase
`reminders`) after positive staging confirmation and human approval, using the
isolated config and exact endpoint inventory. These Functions have no prior
cloud revision because they are new. Function deletion must not include
`lifeTrackerAiApi` or any default-codebase endpoint.

Do not automatically remove the three managed IAM bindings during an incident:
they may become shared Eventarc infrastructure. A later removal requires a
fresh read-only dependency inventory and explicit approval for the exact
principal/role pairs. Leaving an unused managed binding temporarily is safer
than breaking a legitimate newer trigger without evidence.

Do not roll Rules back to Goal 1 as a first response: that would break current
version 2 Settings and report-history behavior. The additive Rules may safely
remain while Functions are stopped. The reminder-only index/TTL metadata may
also remain; removing it is a separate reviewed metadata mutation and cannot
restore a document already deleted by TTL. The pre-deploy zero-count proof is
the defense against that irreversible case.

No rollback step deletes a Goal, Project, Task, TimeBlock, Session, Habit,
report archive, or real user document. Production remains untouched.
