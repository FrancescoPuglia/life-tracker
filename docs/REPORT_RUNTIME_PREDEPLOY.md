# Scientific report runtime pre-deploy boundary

Last reviewed: 2026-08-25 (Europe/Rome)

## Status and authority

**NOT DEPLOYED.** This document records the local implementation and the exact
boundary that must be reviewed before any Firebase or Resend operation. It is
not deployment approval.

No staging or production resource, API, billing setting, IAM policy, runtime
parameter, Secret Manager value, provider account, domain, message, or real
user document was changed while implementing this slice. Staging Functions,
API/resource counts, three named managed IAM bindings, and Secret Manager
existence/version numbers were refreshed read-only; no secret value, mailbox,
fixed UID, or user document was read. Tests used only local deterministic fakes
and the local Firestore/Rules emulators. No Resend/OpenAI credential was read,
no OpenAI request was made, and no email was sent.

## Exact source and deploy authority

- Application branch: `codex/life-tracker-os`
- Isolated report implementation checkpoint:
  `169dfadae60b2e830b291fef5544db77f6768a3a`
- Firebase config Git blob:
  `31df469063ae94e6b6e931e9584710de4286b64f`
- Isolated lockfile Git blob:
  `c859defa0488189714dc0118336b1b8ec5002db8`
- Report runtime wiring Git blob:
  `f4c3acecaabd0023408b0048355080fa3d0fd646`
- Isolated deploy bundle: 429,711 bytes; SHA-256
  `498b110426e80f0843a6bd0001b3917d50358e3ae03e834d025efb536a86cf9c`
- Default Functions source fingerprint at the report-isolation checkpoint:
  `sha256:82c541689189779ae8742a9dd98dabf198611609a5ee5c769d40a16a24338aeb`
- Current default Functions source fingerprint after the later isolated MCP
  separation at `099c579`:
  `sha256:bec32f91c16273d006d14221438e974bc2ed836be6e85d35e04ba6965694d655`
- Runtime/toolchain: Node 22; Firebase CLI `15.28.1`

`firebase.reports.json` contains one Functions source, codebase `reports`, and
no Firestore, Hosting, Auth, Storage, or emulator target. Its predeploy step
builds the checked-in isolated package from its exact lockfile. Full Firebase
SDK discovery returns exactly the two report endpoints below, nine reviewed
parameters, the two scheduled-delivery secret names, zero task queues, one
Scheduler trigger, one required API (`cloudscheduler.googleapis.com`), and no
custom role. At this report checkpoint the default codebase discovered only
`lifeTrackerAiApi` and `lifeTrackerMcp`. The later MCP isolation at `099c579`
further reduced current default discovery to only `lifeTrackerAiApi`; the
isolated report authority and bundle are unchanged.

The runtime is fail-closed and single-owner:

- `REPORT_EMAIL_RUNTIME_ENABLED` defaults to exact `false`. In that state the
  scheduled and preference handlers return before reading an owner or Firestore.
- `REPORT_EMAIL_OWNER_UID` is a server-side fixed Firebase UID allowlist, not a
  request or document value. Its default `not-configured` sentinel is rejected
  even if the enable switch is accidentally set to `true`.
- `REPORT_EMAIL_FROM_ADDRESS` and `REPORT_EMAIL_FROM_NAME` are validated
  non-secret sender metadata.
- `RESEND_API_KEY` is a Firebase Secret Manager parameter bound only to the
  delivery-capable scheduled endpoint. The preference trigger does not bind it.
- `OPENAI_API_KEY` is the same backend-only Secret Manager parameter already
  used by Secure AI. It is now also bound to the delivery-capable scheduled
  endpoint so an explicitly enabled Weekly route can add an interpretation.
  The preference trigger does not bind it. No Twilio secret is bound to either
  report endpoint.
- The Resend client is constructed lazily only after the switch is exactly
  `true`, the fixed owner matches, and sender metadata validates.
- `AI_MODEL_ROUTING_ENABLED` defaults to exact `false`. In that state the
  Weekly interpretation path does not read `AI_MODEL_ROUTING_CONFIG`, the
  OpenAI base URL, or the OpenAI secret value. It writes one stable
  deterministic-only decision for the immutable report and cannot be enabled
  retroactively for that report by a later configuration change.
- Exact routing `true` requires the complete evaluated route manifest and its
  bounded `weekly_strategic_review` profile. A Firestore transaction must win
  the report-specific one-attempt claim before an OpenAI client is constructed.
  The SDK has zero automatic retries for this workload; an abandoned claim
  becomes terminal `uncertain`, never a second provider attempt.
- Neither schedule manifests nor run documents persist the recipient mailbox.
  The mailbox is recovered from current owner-scoped preferences inside the
  transactional execution path.
- Invalid static runtime parameters are logged only with a stable code and are
  acknowledged without Firestore access or retry churn; the next scheduled tick
  re-evaluates configuration.

## Exact resource diff

The isolated `reports` codebase exports these two new second-generation
Functions in `europe-west1`:

| Export | Trigger | Runtime limits | Secret binding |
| --- | --- | --- | --- |
| `reconcileScientificReportSchedules` | Internal-only Firestore write on `users/{uid}/notificationPreferences/default` | 60 s, 256 MiB, min 0, max 1, concurrency 1 | None |
| `deliverScheduledScientificReports` | Cloud Scheduler every five minutes in UTC | 540 s, 1 GiB, min 0, max 1, concurrency 1, 3 platform retries within 15 minutes | `RESEND_API_KEY`, `OPENAI_API_KEY` |

The exact parameter surface is:

- `REPORT_EMAIL_RUNTIME_ENABLED`
- `REPORT_EMAIL_OWNER_UID`
- `REPORT_EMAIL_FROM_ADDRESS`
- `REPORT_EMAIL_FROM_NAME`
- `RESEND_API_KEY`
- `AI_MODEL_ROUTING_ENABLED`
- `AI_MODEL_ROUTING_CONFIG`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`

The bundle contains no AI HTTP endpoint, MCP endpoint/configuration, reminder
endpoint/configuration, Cloud Tasks dependency, Twilio symbol/secret, Secure AI
origin/capability secret, or unused chat model/reasoning parameter. Deployment
must use `firebase.reports.json`; `--only` filtering of the ordinary config is
not an equivalent boundary because Firebase checks prerequisites against its
whole discovered backend before endpoint filtering.

The scheduled handler first reconciles the one configured owner, then selects
at most 10 due manifests. The repository itself accepts no more than 20 and
queries only documents whose embedded `userId` equals that fixed owner. There
is no all-user scan.

Starting from the exact R3 reminder manifest (four composites/fifteen field
overrides), the report metadata diff adds:

- owner report-history composite index `reportArchives`: `userId ASC`,
  `generatedAt DESC`;
- collection-group composite index `reportScheduleManifests`: `userId ASC`,
  `state ASC`, `availableAt ASC`, `reportType ASC`;
- a single-field override that disables indexing of the large immutable
  `reportArchives.report` object;
- explicit browser denial for both owner-nested and root
  `reportScheduleManifests` namespaces;
- explicit browser denial for both owner-nested and root
  `reportInterpretations` namespaces;
- no new TTL policy in this slice.

Use the exact reminder-plus-report manifest from
`43efb669c875f6977e439b16baa7b8dad2c9ff49`—not current canonical metadata,
which also contains MCP TTLs:

- Git blob: `c5d7abae7130a891b5191a522e6a29b0d44666f4`
- SHA-256:
  `088031e706253ced325761007b97345075037c01488444d8e75f8d09bd671f84`
- 3,603 bytes; 151 lines
- expected final state: six composite indexes and sixteen field overrides

The current Rules source is unchanged at SHA-256
`2b4a86baea34655cb268d885e11edc76c843691321fd75508094338a9bc72514`.
R3 deploys those additive owner/report-read and server-namespace-denial Rules
first. R4 must verify that hash is already live and make no Rules change. If R3
is not green, do not deploy reports out of release order.

Schedule-manifest state is limited to two stable paths per owner:

- `users/{uid}/reportScheduleManifests/daily`
- `users/{uid}/reportScheduleManifests/weekly`

Each manifest holds only owner/type identity, deterministic schedule authority,
availability, bounded retry state, and timestamps. It contains no title, Note,
description, mailbox, provider key, or arbitrary Firestore path.

An optional Weekly report also has one server-only control at
`users/{uid}/reportInterpretations/{reportId}`. It binds the exact report
artifact/metric hashes, evaluated route/receipt, one claim, bounded usage,
sanitized structured interpretation, and terminal status. Provider input is a
bounded deterministic metric context only: no Goal/Task titles, Notes,
descriptions, entity IDs, mailbox, provider secret, or arbitrary database path.
The immutable `reportArchives` document remains the sole numerical/chart
authority and is never rewritten by interpretation.

## Expected service/API surface

Fresh explicit-target staging inventory proved:

- billing is already linked; no billing change is required or authorized;
- Artifact Registry, Cloud Billing, Cloud Build, Cloud Functions, Cloud Run,
  Eventarc, Firestore, Pub/Sub, and Secret Manager APIs are enabled;
- Cloud Scheduler and Cloud Tasks APIs are disabled;
- exactly one active Function exists: verified Goal 1 `lifeTrackerAiApi`;
- Eventarc has zero triggers in `europe-west1`; Pub/Sub has zero topics;
- `OPENAI_API_KEY` exists with enabled versions 1 and 2; the live AI Function
  binds version 2. Only names/version numbers were read;
- `RESEND_API_KEY` does not exist;
- the Pub/Sub service-agent token-creator binding and the default-compute Run
  invoker/Eventarc receiver bindings are all absent, matching the native R3
  preflight.

Cloud Scheduler job count remains honestly `NOT VERIFIED`: its API is disabled
and Cloud Asset API is also disabled, so there is no mutation-free enumeration
path in the current project. Do not infer a zero count from the disabled API.
After an exact future approval, enable only Cloud Scheduler first, enumerate
jobs before deploying a Function, and abort on any unexpected pre-existing job.
This staged protocol prevents a first broad Firebase deploy from combining
service enablement, unknown-job reconciliation, and report creation.

R4 follows R3. The three managed Eventarc IAM grants should already have been
reviewed and created by the native-reminder deployment. Reconfirm them; the
report approval must not add a different principal or project-wide role. If R3
has not established the reviewed Eventarc transport, stop and complete R3
instead of silently broadening R4.

The explicit project must be supplied on every command. Never rely only on the
`.firebaserc` default. Staging is `life-tracker-staging`; production is
`life-tracker-12000`. Production currently has no linked billing account and
the required backend APIs were disabled in the last read-only audit. Enabling
billing, an API, or a paid service is a separate human cost gate.

Deployment must be scoped to codebase `reports` plus the exact historical
report metadata manifest. It must not deploy Rules again, Hosting, the default
AI/MCP codebase, remove an existing Function, alter Goal 1 secrets/parameters,
enable the report switch, or configure a provider/domain. Before approval,
capture and review:

1. exact project identity, authenticated principal, billing link, and enabled
   API inventory;
2. existing Functions, then—after the separately approved Scheduler API
   enablement—Scheduler jobs, Eventarc triggers, indexes, Rules release, service
   agents, and relevant IAM bindings;
3. isolated SDK discovery and the Firebase CLI endpoint/resource deletion
   warning set; do not run dry-run against a broader config because API checks
   can precede dry-run exit;
4. Secret Manager **metadata only** for `RESEND_API_KEY` and the existing
   `OPENAI_API_KEY` binding (existence, versions, replication, IAM), never
   either value;
5. the ignored `functions-reports/.env.life-tracker-staging` non-secret
   parameter file and its file mode,
   without printing the fixed UID or sender address into logs;
6. a rollback record containing pre-change indexes, Function revisions,
   runtime parameter metadata, and the application SHA.

## Local and read-only evidence

| Gate | Result |
| --- | --- |
| Focused report/deploy regression | PASS; 4 files / 26 tests |
| Full Functions regression | PASS; 49 files / 471 tests; 11 emulator files / 97 tests explicitly skipped outside emulator gates |
| Isolated report typecheck/build | PASS; 429,711-byte bundle, SHA-256 `498b1104...` |
| Isolated SDK discovery | PASS; exact two endpoints/nine params/two scheduled secrets/one Scheduler/zero task queues |
| Default SDK discovery at report isolation | PASS; exact AI + MCP endpoints, no report/reminder endpoint, zero required APIs |
| Current default SDK discovery | PASS at later `099c579`; Secure AI endpoint only, zero required APIs |
| Default strict build at report isolation | PASS; 636.8 kB bundle, source fingerprint `sha256:82c54168...` |
| Production dependency audits | PASS; default and isolated packages each report 0 vulnerabilities |
| Security/hygiene | PASS; static/Desktop security, isolated bundle credential scan, `git diff --check`, staged diff check |
| Live staging Function inventory | PASS read-only; one unchanged Goal 1 AI Function |
| Live staging API/resource inventory | PASS read-only; Scheduler/Tasks disabled, zero Eventarc triggers/Pub/Sub topics |
| Live secret metadata | PASS read-only; OpenAI enabled versions 1/2, Resend absent; no value accessed |
| Live managed-IAM inventory | PASS read-only; exact three R3/Eventarc bindings absent |
| Scheduler job inventory | NOT VERIFIED while Scheduler and Cloud Asset APIs are disabled; staged verification required after approved API enablement |

The report runtime parameter refactor duplicates only parameter declarations
inside the isolated codebase; names, validation, default-off behavior, secret
bindings, provider construction, and report domain logic are unchanged. The
report-emulator persistence suite was not rerun for this export-only wiring
change; its prior explicit results remain authoritative, while all 471 local
Functions tests including report runtime/interpretation passed on the new
source.

## Workload and cost envelope

These are bounded estimates, not a promise of a zero bill. Pricing and free
tiers can change and must be rechecked on the deployment date.

### Scheduler and compute

- Five-minute cadence is 288 invocations/day, 8,640 in a 30-day month, or 8,928
  in a 31-day month.
- Cloud Scheduler bills by job rather than execution. Current official pricing
  is US$0.10/job/month with three jobs/month free per billing account, not per
  project. This slice adds one job. The existing reminder scheduler and all
  other projects on the same billing account must be counted before relying on
  the free allowance.
- Both Functions have `minInstances: 0`; there is no intentionally warm
  instance. Current Cloud Run request-based free tier includes two million
  requests, 180,000 vCPU-seconds, and 360,000 GiB-seconds per billing account
  per month, based on `us-central1` pricing. `europe-west1` usage and shared
  billing-account consumption still require the official calculator/actual
  billing view.
- The scheduled report can use up to 540 seconds and 1 GiB only when work is
  due. Actual chart/report generation duration must be observed in staging
  before enabling production.

Official references: [Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing)
and [Cloud Run pricing](https://cloud.google.com/run/pricing).

### Firestore

An idle scheduled invocation performs one four-document reconciliation
transaction (user, preferences, Daily manifest, Weekly manifest) plus one due
query. Firestore charges at least one document read for an empty query. Because
this composite query has an inequality and an additional ordered field, budget
conservatively for one index-entry batch too. With no transaction retry, that
is at most approximately six billed read operations per idle invocation:

- about 1,728/day;
- about 51,840 per 30-day month;
- about 53,568 per 31-day month.

This control-plane estimate is below the current 50,000 document-read daily
free quota. It excludes transaction retries, preference-trigger invocations,
due-run transactions, and the report source documents. A generated report is
bounded by the checked-in dataset/page limits and marks truncation, but its
theoretical source-read ceiling is intentionally much larger than ordinary
personal usage. Staging must measure actual reads with representative data;
production enablement must not rely on the idle estimate alone.

Writes are change-driven: normally two manifest writes on first reconciliation,
then only preference/schedule changes, retry-state transitions, and one
advance/finalization per due report. A scheduler tick with unchanged future
manifests performs no manifest write.

Current Firestore free quota is 50,000 reads, 20,000 writes, and 20,000 deletes
per day for one qualifying database per project; backup, restore, PITR, clone,
and TTL deletes are excluded from free usage. See the official
[Firestore pricing guide](https://firebase.google.com/docs/firestore/pricing).

### Email provider

With one owner and both schedules enabled, ordinary provider volume is at most
one Daily email per local day plus one Weekly email per local week: normally
35-36 messages/month. Durable claim/finalization prevents scheduler retries
from sending a second accepted message. Ambiguous provider acceptance is
terminal and requires manual reconciliation; it is never blindly retried.

Resend currently advertises a free plan with 3,000 emails/month and a 100/day
limit. Pay-as-you-go overage is for paid subscriptions and must not be enabled.
No plan upgrade, automatic overage, domain purchase, or paid sender action is
authorized. See [Resend pricing](https://resend.com/pricing).

### Optional Weekly model interpretation

Routing-off incurs no report OpenAI request. Once an evaluated Weekly route is
separately approved and enabled, each immutable Weekly report may authorize at
most one Responses request: one turn, zero tools, a 64,000-byte maximum metric
context, 900 maximum output tokens, a 20-second application deadline, and zero
SDK retries. A provider/config/schema/quota failure settles deterministic-only;
there is no retry on a more expensive model and no automatic model fallback.

No live model evaluation has run, so no model is yet asserted cheapest
adequate and this path must remain off. The representative corpus, current
reviewed prices, maximum-cost approval boundary, and rollback are documented in
`docs/AI_MODEL_ROUTING_EVALUATION.md`. No OpenAI credit purchase, spend-limit
change, auto-reload, or billing action is authorized.

## Safe configuration and promotion sequence

After a separately granted exact approval:

1. Require R1 and the complete native/cloud R3 staging gates to be green. Then
   reconfirm the explicit Firebase project and all read-only inventory above.
2. Enable only `cloudscheduler.googleapis.com`, enumerate every existing
   Scheduler job immediately, and stop for review if the result differs from
   the R3 receipt. Do not enable Cloud Tasks or another API in this step.
3. Create `RESEND_API_KEY` version 1 through Firebase's secure interactive Secret
   Manager flow. Francesco enters the value directly into the trusted CLI or
   provider console; it is never pasted into chat, a command argument, an env
   dump, Git, or a log.
4. Store the nine reviewed non-secret/secret parameter names only in the
   isolated codebase. Put non-secret values in ignored
   `functions-reports/.env.life-tracker-staging`; verify hashes/metadata without
   printing the fixed UID or mailbox. Bind existing `OPENAI_API_KEY` version 2
   by metadata only; never read its value.
5. Keep both `REPORT_EMAIL_RUNTIME_ENABLED=false` and
   `AI_MODEL_ROUTING_ENABLED=false` while deploying the named Functions
   and keep the evaluated-route manifest at `not-configured`.
6. From exact manifest commit `43efb669...`, deploy Firestore indexes only.
   Verify six composites/sixteen field overrides and no deletion. Do not deploy
   current canonical MCP TTL metadata or Rules.
7. From exact implementation `169dfad...`, rerun both production audits,
   typecheck/build/discovery/scans, then deploy the whole isolated codebase:

```text
node <reviewed-firebase-cli> deploy \
  --config firebase.reports.json \
  --project life-tracker-staging \
  --only functions
```

8. Abort if discovery or the cloud delta includes anything other than the two
   report endpoints, one new report Scheduler job, the two exact
   scheduled-endpoint secret bindings, and no Function deletion. In particular,
   reject AI HTTP, MCP, reminders, Cloud Tasks, Hosting, Rules, production, or
   provider/billing changes.
9. Verify the deployed Functions' secret bindings, ingress/invoker policy,
   Scheduler cadence, max/min instances, retry policy, source SHA, Rules, and
   index readiness. Confirm no Hosting or unrelated Function changed.
10. Exercise default-off behavior and confirm zero Firestore/provider activity.
11. Under a separate bounded runtime-enable approval, use one isolated
   owner-authorized staging schedule, enable the email switch
   only after sender/domain readiness, and observe one deterministic Daily
   delivery plus its archive/attempt/provider ID. Do not loop provider tests.
12. Disable immediately on unexpected sends, read amplification, malformed
   state, cost anomaly, or ambiguous ownership. Preserve archives and attempts
   for diagnosis; do not delete real user data.

Weekly model routing is a different, later paid-evaluation gate. Do not combine
report deployment/email acceptance with model-evaluation approval. When that
gate is eventually satisfied, configure the receipt-bound manifest first,
enable exact routing only for a bounded staging acceptance, and verify one
metric-bound addendum plus the unchanged deterministic archive/chart hashes.

Production promotion is a later, distinct approval after staging evidence,
backup/recovery, real-data read-only comparison, and the production billing/API
decision. A staging approval does not authorize production.

## Recovery

The first-line email stop is setting the report runtime switch back to exact
`false`; both handlers then stop before owner/Firestore/provider access. If a
code rollback is needed, deploy a reviewed fix or explicitly delete only the
two new Functions in codebase `reports` with `firebase.reports.json`; they have
no prior cloud revision. Never delete/update `lifeTrackerAiApi`, `lifeTrackerMcp`,
or a reminder Function. Do not delete report archives, email delivery attempts,
run documents, or real user data as part of rollback. Queued Scheduler
invocations remain harmless while the switch is false.

The additive report indexes/field override and already-reviewed Rules may stay
in place while Functions are stopped. Removing either is a distinct metadata
mutation and is not the first response. Cloud Scheduler API may also remain
enabled; disabling an API is not evidence that its resources were removed.

Recovery itself is a managed cloud mutation and requires the same explicit
target confirmation and authorization as deployment, except in an active
incident where the pre-authorized kill-switch runbook applies.

The independent model stop is setting `AI_MODEL_ROUTING_ENABLED=false`.
Already settled report controls remain stable and cannot trigger a later
provider call; deterministic archives and deterministic-only email rendering
remain usable. Do not delete interpretation controls to force regeneration.
