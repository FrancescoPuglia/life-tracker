# Scientific report runtime pre-deploy boundary

Last reviewed: 2026-08-25 (Europe/Rome)

## Status and authority

**NOT DEPLOYED.** This document records the local implementation and the exact
boundary that must be reviewed before any Firebase or Resend operation. It is
not deployment approval.

No staging or production resource, API, billing setting, IAM policy, runtime
parameter, Secret Manager value, provider account, domain, message, or real
user document was read or changed while implementing this slice. Tests used
only local deterministic fakes and the local Firestore/Rules emulators. No
Resend/OpenAI credential was read, no OpenAI request was made, and no email was
sent.

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

The local Functions entry now exports these two new second-generation
Functions in `europe-west1`:

| Export | Trigger | Runtime limits | Secret binding |
| --- | --- | --- | --- |
| `reconcileScientificReportSchedules` | Internal-only Firestore write on `users/{uid}/notificationPreferences/default` | 60 s, 256 MiB, min 0, max 1, concurrency 1 | None |
| `deliverScheduledScientificReports` | Cloud Scheduler every five minutes in UTC | 540 s, 1 GiB, min 0, max 1, concurrency 1, 3 platform retries within 15 minutes | `RESEND_API_KEY`, `OPENAI_API_KEY` |

The scheduled handler first reconciles the one configured owner, then selects
at most 10 due manifests. The repository itself accepts no more than 20 and
queries only documents whose embedded `userId` equals that fixed owner. There
is no all-user scan.

The Firestore metadata diff adds:

- collection-group composite index `reportScheduleManifests`: `userId ASC`,
  `state ASC`, `availableAt ASC`, `reportType ASC`;
- explicit browser denial for both owner-nested and root
  `reportScheduleManifests` namespaces;
- explicit browser denial for both owner-nested and root
  `reportInterpretations` namespaces;
- no new TTL policy in this slice.

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

An approved Firebase deployment may need Cloud Functions/Cloud Run, Cloud
Build, Artifact Registry, Eventarc, Cloud Scheduler, Firestore, Firebase Rules,
and Secret Manager support. Firebase may also provision service agents or
Pub/Sub plumbing as part of the managed triggers. The exact target-project
service state, generated deployment plan, service-agent/IAM delta, and existing
Scheduler job count are **NOT VERIFIED** and must be inventoried read-only
immediately before deployment.

The explicit project must be supplied on every command. Never rely only on the
`.firebaserc` default. Staging is `life-tracker-staging`; production is
`life-tracker-12000`. Production currently has no linked billing account and
the required backend APIs were disabled in the last read-only audit. Enabling
billing, an API, or a paid service is a separate human cost gate.

Deployment must be scoped to the two named Functions plus the separately
reviewed Rules/index changes. It must not implicitly deploy Hosting, remove an
existing Function, alter Goal 1 secrets/parameters, enable the report switch,
or configure a provider/domain. Before approval, capture and review:

1. exact project identity, authenticated principal, billing link, and enabled
   API inventory;
2. existing Functions, Scheduler jobs, Eventarc triggers, indexes, Rules
   release, service agents, and relevant IAM bindings;
3. the Firebase CLI endpoint/resource deletion warning set;
4. Secret Manager **metadata only** for `RESEND_API_KEY` and the existing
   `OPENAI_API_KEY` binding (existence, versions, replication, IAM), never
   either value;
5. the ignored target-specific non-secret parameter file and its file mode,
   without printing the fixed UID or sender address into logs;
6. a rollback record containing pre-change Rules, indexes, Function revisions,
   runtime parameter metadata, and the application SHA.

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

1. Reconfirm the explicit Firebase project and all read-only inventory above.
2. Create/update `RESEND_API_KEY` through Firebase's secure interactive Secret
   Manager flow. Francesco enters the value directly into the trusted CLI or
   provider console; it is never pasted into chat, a command argument, an env
   dump, Git, or a log.
3. Store non-secret runtime values only in the ignored target-specific Functions
   parameter file. Verify names and hashes/metadata without printing the fixed
   UID or mailbox.
4. Keep both `REPORT_EMAIL_RUNTIME_ENABLED=false` and
   `AI_MODEL_ROUTING_ENABLED=false` while deploying the named Functions,
   reviewed Rules, and index.
5. Verify the deployed Functions' secret bindings, ingress/invoker policy,
   Scheduler cadence, max/min instances, retry policy, source SHA, Rules, and
   index readiness. Confirm no Hosting or unrelated Function changed.
6. Exercise default-off behavior and confirm zero Firestore/provider activity.
7. Use a single isolated owner-authorized staging schedule, enable the switch
   only after sender/domain readiness, and observe one deterministic Daily
   delivery plus its archive/attempt/provider ID. Do not loop provider tests.
8. Disable immediately on unexpected sends, read amplification, malformed
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
code rollback is needed, redeploy the recorded prior Function revision/source
and restore the recorded Rules/index metadata. Do not delete report archives,
email delivery attempts, run documents, or real user data as part of rollback.
Queued Scheduler invocations remain harmless while the switch is false.

Recovery itself is a managed cloud mutation and requires the same explicit
target confirmation and authorization as deployment, except in an active
incident where the pre-authorized kill-switch runbook applies.

The independent model stop is setting `AI_MODEL_ROUTING_ENABLED=false`.
Already settled report controls remain stable and cannot trigger a later
provider call; deterministic archives and deterministic-only email rendering
remain usable. Do not delete interpretation controls to force regeneration.
