# Secure AI integration: architecture and release runbook

Status: feature-branch implementation; no production deployment has been
performed. The recovered working state was checkpointed at
`3c2d58570bd5740b6ca41d67e0533b71ce0c6b0d` from base
`5ea328066d207d695fcf689015fd610e3751f457`. The locally verified code
candidate before the final verification receipt is
`378f13bd669aec891ee5cb7e4d7eba71743040d4`.

## Trust and control flow

```text
GitHub Pages static frontend
  -> Firebase Web Auth and ID-token acquisition
  -> lifeTrackerAiApi HTTPS Function
  -> Admin verifyIdToken(token, checkRevoked=true)
  -> authoritative AuthContext.uid
  -> UID-derived Firestore repository paths
  -> deterministic reads, analytics, WPI, and Goal Architect validation
  -> backend-only OpenAI Responses API read/proposal loop
  -> immutable LifePlan preview and exact human-readable diff
  -> explicit user Apply with one-time capability
  -> Firestore transaction: approval + preconditions + snapshot + writes + audit
  -> authoritative reread and receipt
  -> optional owner-bound, state-safe rollback
```

Firebase Admin bypasses client Security Rules. Repository ownership checks are
therefore mandatory even though the browser Rules are deny-by-default. Request
body, query, tool, and model `userId` values are never authoritative.

## HTTP surface

The single exported v2 Function is `lifeTrackerAiApi` in `europe-west1`:

- `GET /v1/health`: non-secret source and runtime-policy readiness;
- `POST /v1/chat`: authenticated analysis or proposal orchestration;
- `POST /v1/plans/{planId}/apply`: authenticated exact-capability apply;
- `POST /v1/executions/{executionId}/rollback`: authenticated safe rollback.

Privileged routes require JSON, a bounded body, an exact allowed Origin when an
Origin header is present, and `Authorization: Bearer <Firebase ID token>`.
Errors expose stable classifications and request IDs, not provider/auth details.
The browser accepts a configured bearer-token destination only when it is the
canonical `lifeTrackerAiApi` Function for the same public Firebase project that
owns Auth. Arbitrary HTTPS hosts fail closed; loopback is limited to the exact
project-bound Functions emulator path in explicit development.
The Firestore rate limiter is per authenticated UID and shared across serverless
instances. Fixed windows are deliberately simple and may allow boundary bursts.
Health returns two independent attestations: a source/configuration fingerprint
and a runtime-policy digest. The latter binds the configured model, reasoning
effort, official provider URL, exact CORS allowlist, prompt/schema versions,
timeouts, tool-loop limits, and output limit. Only its digest plus safe
model/version labels are public; origins and provider URL are not echoed.
Successful Responses metadata records the configured/requested model separately
from the provider-returned model identity; the live staging harness requires
both to match the reviewed model.

## Authorized state and tools

Canonical state is bounded by date range, page size, field allowlists, depth,
and byte budgets. It includes Goals, Key Results, Projects, Tasks, TimeBlocks,
Sessions, Habits, Habit Logs, Notes, Goal Roadmaps, Domains, KPIs, timezone,
preferences, and deterministic analytics. Sessions are actual execution;
TimeBlocks are planned time. User-authored text remains marked untrusted data.

Model tools are allowlisted and strictly schema-validated:

- reads: state and focused entity reads, KPIs, period analysis,
  planned-vs-actual, goal alignment, and schedule conflicts;
- proposals: Task changes, deterministic TimeBlock changes, day/week WPI
  previews, generic non-schedule previews, and Goal Architect hierarchy drafts.

There is no raw query/path/collection tool. Apply and rollback are absent from
the model registry.

## LifePlan safety lifecycle

A preview stores the owner internally, exact operations, before/after diff,
warnings/conflicts/assumptions, base and per-entity hashes, expiry, changeset
hash, and safe orchestration metadata. The returned approval secret is HMAC
derived; only its hash is persisted.

Apply re-authenticates, checks owner/scope/expiry/hash/base state/idempotency,
then atomically consumes approval, snapshots touched entities, validates domain
invariants, writes the changes, and records execution/audit data. A stale entity
hash aborts the entire transaction as `STATE_CHANGED`. A repeated idempotency
key returns the original result; a consumed capability cannot authorize another
execution. Post-commit state is reread and hashed before a verified receipt is
returned.

Rollback requires its own owner/execution/hash-bound capability. It compares
current state with the execution's exact after-state before restoring the
snapshot. Newer human edits cause a safe conflict instead of being overwritten.

## Deterministic validators

Functions build a shared pure validator bundle from the existing root
`src/lib/weeklyPlanner` and `src/lib/goalArchitect` modules. WPI preserves
fixed/locked commitments, timezone, non-overlap, capacity, hierarchy links,
WPI markers, and draft-first semantics. Goal Architect validates the full
hierarchy, real parent IDs, dates, ownership, orphan prevention, and GAI replay
markers before a LifePlan is created. OpenAI cannot bypass either validator.

## Development and verification

Node.js 22 and npm lockfiles are authoritative. Java 21 is required by the
current Firebase Firestore emulator.

```bash
npm ci
npm --prefix functions ci
npm run lint
npm run typecheck
npm run test:run
npm --prefix functions run typecheck
npm --prefix functions run test:run
npm --prefix functions run build
npm run test:rules
npm run test:functions:emulator
npm run test:auth:emulator
npm run test:e2e:emulator
npm run build:static
npm run check:static-security -- --include-output
npm run test:e2e:static
```

Automated tests use synthetic data, fake Responses transports, and demo
emulators. The Playwright gate has both browser-fixture coverage and a real
local boundary path: the latter signs in through the Auth emulator and calls
the built HTTPS Function, Firestore emulator, and a loopback fake
OpenAI-compatible Responses transport. It exercises desktop and mobile UI
flows without a provider key or live model. Screenshots/traces are written to
ignored `test-results/` evidence. Tests must never call a live model or
production Firebase project.

`build:static` always performs a fresh GitHub Pages export, clears OpenAI
variables, embeds the current public Git commit, and never reuses an existing
`out/` directory as evidence. It then runs the output-inclusive static security
scan under the same public build configuration. Static and staging browser
gates assert the commit marker. The body also attests the exact non-secret AI
backend endpoint, which staging binds to its reviewed Function before identities
or fixture data are created. A stale or differently configured frontend fails
closed.

## Secrets and configuration

The browser receives only public Firebase Web SDK configuration and
`NEXT_PUBLIC_AI_API_BASE_URL`. The backend uses Firebase parameterized
configuration and binds `OPENAI_API_KEY` plus `AI_CAPABILITY_SIGNING_SECRET`
through Secret Manager. Set them interactively only after selecting the intended
staging project:

```bash
firebase functions:secrets:set OPENAI_API_KEY --project life-tracker-staging
firebase functions:secrets:set AI_CAPABILITY_SIGNING_SECRET --project life-tracker-staging
```

No live OpenAI smoke test may use the historical exposed key. Human revocation
and a rotated backend secret are prerequisites. `OPENAI_BASE_URL` defaults to
`https://api.openai.com/v1`; production rejects another provider host and only
the Functions emulator may use loopback. Responses requests set `store: false`.

## MCP boundary

The feature-disabled `ReadOnlyMcpDomainAdapter` reuses the same registry and
executor. It can expose only authenticated read tools; it has no remote network
transport in this branch. Official OpenAI plugin documentation describes tools
that can read information or take actions and requires the server to enforce
its own authentication and behavior. The public documentation checked for this
release does not establish availability for the owner's current ChatGPT plan.
Accordingly, no remote MCP integration is enabled and MCP writes remain
disabled. A future adapter must reuse this same approval/transaction service
and must not create a second privileged path.

References:

- [OpenAI MCP server concepts](https://developers.openai.com/plugins/concepts/mcp-server)
- [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI Responses API MCP and connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data#default-usage-policies-by-endpoint)
- [Firebase parameterized configuration and secrets](https://firebase.google.com/docs/functions/config-env)
- [Firebase function deployment](https://firebase.google.com/docs/functions/manage-functions)

## Dedicated staging environment

The isolated Goal 1 target is Firebase project `life-tracker-staging`
(project number `675076431391`). The existing `life-tracker-12000` project is
the production/reference project and is never a valid staging target. The
repository `.firebaserc` maps both `default` and `staging` to the isolated
staging project, while every cloud command in this runbook still names the
project explicitly.

Firebase CLI/API verification on 2026-08-17 established:

- active Web app: `Life Tracker Staging Web`;
- default Firestore database: Native mode, Standard edition, location `eur3`;
- project billing enabled;
- Email/Password Auth accepts a synthetic account (the verification account
  was deleted immediately);
- `AI_CAPABILITY_SIGNING_SECRET` exists as an enabled Secret Manager version;
- `OPENAI_API_KEY` exists only in staging Secret Manager and is bound to the
  deployed Function; its value is never read, printed, or stored locally.

The Functions package reads non-secret staging parameters from the ignored
`functions/.env.life-tracker-staging` file. The staging values are
`OPENAI_MODEL=gpt-5.6-sol`, `OPENAI_REASONING_EFFORT=medium`, the official
OpenAI API base URL, and an exact CORS allowlist for the local verification
origin plus the staging Firebase Hosting origin. Neither secret belongs in an
environment file.

The staging Function is `lifeTrackerAiApi` (Gen 2, Node 22, `europe-west1`).
Its deployed secret environment contains exactly `OPENAI_API_KEY` and
`AI_CAPABILITY_SIGNING_SECRET`. Container images in the staging
`gcf-artifacts` repository have a seven-day cleanup policy.

Set the rotated OpenAI credential only through the interactive terminal prompt
and never paste it into chat or a tracked file:

```bash
firebase functions:secrets:set OPENAI_API_KEY --project life-tracker-staging
```

## Staging deployment (production remains forbidden)

1. Verify the active/explicit project resolves to `life-tracker-staging` and
   never `life-tracker-12000`.
2. Confirm the historical key is revoked; create a scoped, budget-limited
   staging replacement.
3. Set `OPENAI_API_KEY` interactively and verify only its metadata. The
   capability-signing secret is generated independently and never displayed.
4. Run every local gate above from a clean reviewed commit.
5. Deploy only the Function:

   ```bash
   firebase deploy --project life-tracker-staging --only functions:lifeTrackerAiApi
   ```

6. Run authenticated staging negative tests and a budget-limited live smoke.
7. Deploy Firestore Rules only after a separate diff/review:

   ```bash
   firebase deploy --project life-tracker-staging --only firestore:rules
   ```

8. Deploy the reviewed Firestore index/TTL configuration separately:

   ```bash
   firebase deploy --project life-tracker-staging --only firestore:indexes
   ```

   `aiAuditLogs` are the durable receipt trail. Ephemeral `aiChangePlans`,
   `aiApprovals`, `aiExecutions`, and `aiIdempotency` records carry a
   server-owned `purgeAt` timestamp and use a seven-day post-action retention
   window; abandoned previews expire at preview expiry. `aiSnapshots` expire
   at the rollback boundary, and `aiRateLimits.expiresAt` is TTL-managed.
   Staging fixture teardown removes explicit user documents and Auth accounts
   immediately; server-only ephemeral records are deleted asynchronously by
   these deployed TTL policies.

9. Set the GitHub Pages repository variable `NEXT_PUBLIC_AI_API_BASE_URL` to
   exactly
   `https://europe-west1-life-tracker-12000.cloudfunctions.net/lifeTrackerAiApi`,
   then use the existing reviewed Pages workflow. Any other host, project,
   path, query, credentials, or fragment is rejected before export.

CORS cannot isolate one GitHub Pages project path from another project under
the same `https://francescopuglia.github.io` origin. Treat every page on that
origin as trusted or move Life Tracker to a dedicated origin before production.

## Rollback

- Application change: use the returned Undo action while its capability is
  valid and no later state conflicts. The backend verifies the restore and
  creates a rollback receipt.
- Feature branch: revert the specific green feature commit with `git revert`;
  do not reset, rewrite, or force-push shared history.
- Staging Function: check out the last known-good reviewed SHA in a separate
  clean checkout, run its tests/build, and redeploy only
  `functions:lifeTrackerAiApi`. Do not delete the Function as an implicit
  rollback.
- Rules: redeploy the last known-good reviewed `firestore.rules` only after
  emulator verification. Never use production data to test rollback.
- Index/TTL configuration: redeploy the last known-good reviewed
  `firestore.indexes.json`; removing a TTL policy is a separate data-retention
  decision and must not be used as an application rollback shortcut.
