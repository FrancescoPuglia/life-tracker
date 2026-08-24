# Secure AI verification receipt

Date: 2026-08-17 (Europe/Rome)

Scope: local verification of the recovered Life Tracker secure OpenAI
integration. This receipt records evidence; it does not authorize a merge,
deployment, production-data change, or secret rotation.

> **Supersession notice (2026-08-24):** Sections A-M preserve the original
> recovery receipt. Section N is the authoritative Goal 1 staging completion
> receipt and supersedes earlier statements that staging/provider gates were
> not run or that external actions remained.

## A. Recovery and Git state

- Repository: `/mnt/c/Users/Franc/Desktop/LIFE_TRACKING`
- Branch: `codex/secure-openai-integration`
- Recovered base: `5ea328066d207d695fcf689015fd610e3751f457`
- Recovery checkpoint: `3c2d58570bd5740b6ca41d67e0533b71ce0c6b0d`
- Final locally verified code candidate before this receipt:
  `378f13bd669aec891ee5cb7e4d7eba71743040d4`
- The recovered 25 tracked changes and 32 untracked files were preserved; no
  competing recovery candidate was found and no recovered source was discarded.
- The local branch is clean at the recorded code candidate.
- Remote preservation is blocked: `git push -u origin
  codex/secure-openai-integration` is rejected with HTTP 403 because the active
  GitHub identity is `FrankPuglia`, which lacks write permission to
  `FrancescoPuglia/life-tracker`. The local commits remain intact. No force push
  or push to `main` was attempted.

Runtime used for verification: Node.js `22.22.0`, npm `10.9.4`, Java
`21.0.12`, Firebase CLI `15.27.0`, and the repository npm lockfiles.

## B. Security incident

- The tracked OpenAI credential previously present in `AI_SETUP_GUIDE.md` was
  replaced with an obvious placeholder before the recovery checkpoint.
- Root `.env.local`, Functions emulator `.env.local`, and
  `functions/.secret.local` are ignored and were not staged or inspected for
  values.
- `scripts/check-static-security.mjs` scans tracked content for high-confidence
  OpenAI, Google service-account, GitHub, Slack, and AWS credential patterns and
  scans browser source/output for provider-secret leakage. It passes.
- No live OpenAI request used a recovered credential.
- **EXTERNAL SECURITY ACTION PENDING: REVOKE/ROTATE HISTORIC OPENAI KEY.**

## C. Implemented architecture

```text
GitHub Pages static browser
  -> Firebase Web Auth / ID token
  -> lifeTrackerAiApi HTTPS Function
  -> Firebase Admin verifyIdToken(token, checkRevoked=true)
  -> server-derived AuthContext.uid
  -> UID-scoped Firestore domain repository
  -> deterministic reads, analytics, WPI, and Goal Architect validation
  -> backend-only OpenAI Responses API read/proposal loop
  -> exact LifePlan diff + one-time human approval capability
  -> Firestore transaction / authoritative preconditions
  -> post-write reread and verification
  -> audit receipt + owner-bound conditional rollback
```

Client or model `userId` values never select authority. Firebase Admin bypasses
Rules, so all server paths and references are independently scoped and checked.
The model has strict read/proposal tools only; apply and rollback are explicit
authenticated HTTP actions.

## D. Capability summary

Canonical bounded state covers Goals, Key Results, Projects, Tasks,
TimeBlocks, Sessions, Habits, Habit Logs, Notes, Goal Roadmaps, Domains,
persisted preferences/timezone, KPIs, and deterministic analytics. User text is
marked untrusted data and never becomes system authority.

Read tools cover canonical state, focused entity reads, KPIs, period analysis,
planned-versus-actual, goal alignment, and schedule conflicts. Proposal tools
cover Tasks, focused TimeBlocks, deterministic day/week schedules, generic
non-schedule changes, and Goal Architect hierarchy drafts. There is no raw
Firestore path, collection, query, code-execution, apply, or rollback tool.

The HTTP surface is:

- `GET /v1/health` (non-secret readiness);
- `POST /v1/chat` (authenticated read/proposal orchestration);
- `POST /v1/plans/{planId}/apply` (authenticated exact-capability action);
- `POST /v1/executions/{executionId}/rollback` (authenticated safe rollback).

## E. Mutation integrity

The implemented lifecycle is:

`validate -> snapshot -> propose -> preview -> approve -> apply -> verify -> audit`

- LifePlans store exact operations, safe before/after diff, warnings,
  assumptions, conflicts, base and entity/scope hashes, expiry, and changeset
  hash.
- Approval is bound to UID, plan, changeset, base state, scope, expiry, and a
  one-time capability whose raw value is not persisted.
- Apply checks ownership, references, invariant scopes, approval,
  idempotency, and drift in one Firestore transaction. OpenAI and other external
  side effects never run inside a retryable transaction.
- Duplicate requests and concurrent clicks converge on one execution receipt.
- Relevant schedule ranges, reference chains, Sessions, semantic-duplicate
  scopes, and dependency scopes are bound so phantoms and newer edits yield
  `STATE_CHANGED` with zero partial writes.
- Snapshots and audits are owner-bound. Rollback verifies exact after-state and
  refuses to overwrite later human edits or orphan newer dependants.
- Post-commit verification and receipt healing serialize with rollback, so a
  stale verifier cannot resurrect an applied result after rollback.

## F. Deterministic domain reuse

Functions bundle the existing pure Weekly Planning and Goal Architect
validators instead of implementing a free-form second scheduler/hierarchy
engine. Verified cases cover fixed/locked/executed/cancelled blocks,
non-overlap, capacity, Europe/Rome and DST geometry, cross-day boundaries,
semantic replay, parent/reference integrity, atomic hierarchy creation,
duplicate rejection, and orphan-safe rollback. Planned-versus-actual uses real
Sessions and trustworthy actual fields rather than inferring execution solely
from planned status.

## G. Verification gates

All commands below exited `0` unless explicitly marked otherwise.

| Gate | Command and evidence | Result |
| --- | --- | --- |
| G0 workspace | `pwd`; `git status --short --branch`; `git rev-parse HEAD`; runtime version commands. Canonical branch/path and clean `378f13b` candidate confirmed. | PASS |
| G1 dependency integrity | Root and Functions `npm ci` completed from their lockfiles earlier in this goal; final `npm ls --depth=0` completed. Root `npm audit --audit-level=high` exits 0 with three moderate, dev-only `firebase-tools` transitive findings; Functions audit reports 0 vulnerabilities. | PASS with P2 dependency note |
| G1 frontend unit | `npm run test:run`: 43 files, 567/567 tests. | PASS |
| G1 Functions unit | `npm --prefix functions run test:run`: 13 files, 141/141 unit tests; 27 emulator tests intentionally skipped in this unit command and executed below. | PASS |
| G1 lint | `npm run lint`: exit 0; existing non-AI warnings remain documented. | PASS |
| G1 types | `npm run typecheck`; `npm --prefix functions run typecheck`: both exit 0. | PASS |
| G1 Functions build | `npm --prefix functions run build`: shared validators, typecheck, and Node 22 bundle (`320.8kb`) succeed. | PASS |
| G1 static build | `OPENAI_API_KEY= NEXT_PUBLIC_OPENAI_API_KEY= NEXT_PUBLIC_OPENAI_MODEL= npm run build`: static `/` and `/_not-found` export succeeds without an OpenAI secret. | PASS |
| G2 domain | Root and Functions suites cover serializers, bounds, analytics, WPI/Goal Architect, conflicts, contracts, schema rejection, and prompt-injection fixtures. | PASS |
| G3 Rules | `npm run test:rules` through the official Firestore emulator: 47/47. Anonymous and cross-user CRUD are denied, owner CRUD is allowed, forged sensitive fields are denied, and every AI server namespace is browser-inaccessible. Expected `PERMISSION_DENIED` emulator logs are negative-test evidence. | PASS |
| G3 Auth | `npm run test:auth:emulator`: 2/2. A real emulator ID token is verified and its UID is authoritative; spoof behavior and malformed/invalid auth are additionally covered by 14 HTTP auth unit tests. | PASS |
| G4 Responses/tools | Functions unit suite covers strict schemas, unknown/malformed tools, tool subsets, bounds, timeout/deadline, provider/tool errors, loop limit, fake transport, and absence of model-callable apply/rollback. | PASS |
| G5 transactions | `npm run test:functions:emulator`: 25/25 real Firestore emulator cases. Includes exact approval binding, replay/capability mismatch, concurrent apply, rate limiting, stale entity/range/reference/Session scopes, zero partial writes, verification recovery/race, audit, rollback, wrong owner, later edits, WPI/GAI semantics, and hierarchy atomicity. | PASS |
| G6 persistence regression | Root DataProvider/FirebaseAdapter tests plus emulator/browser paths cover owner-constrained queries, completed-state persistence, auth rehydration in changed paths, backend failure behavior, and no duplicate apply. The unrelated sync subsystem was not redesigned. | PASS for changed scope |
| G7 static browser | `npm run test:e2e:static`: 1/1; generated export loads from the real `/life-tracker` base path. | PASS |
| G7 integrated browser | `npm run test:e2e:emulator`: 3/3 in 3.8 minutes. Desktop exercises fixture and real local Auth/Functions/Firestore/fake-Responses boundaries; mobile exercises layout, focus, authenticated request, and keyboard close. | PASS |
| G8 static/security | `npm run check:static-security`; filename-only Git checks; `git diff --check`: pass. No tracked Next route handlers, browser OpenAI runtime, public OpenAI key variable, legacy Chat Completions path, generic DB tool, or high-confidence tracked credential. Root has no `openai` dependency; Functions owns `openai@6.49.0`, `firebase-admin@14.2.0`, and `firebase-functions@7.3.2`. | PASS |
| G9 independent review | Three read-only reviewers assessed exact code commit `378f13b`: domain PASS, transaction CONDITIONAL, security CONDITIONAL. No implementation P0/P1 remains; one human-controlled external P1 and four P2 items are recorded below. | CONDITIONAL |
| G10 release readiness | Architecture, secrets, staging-only commands, TTL/index requirements, shared-origin caveat, MCP boundary, and rollback are documented in `docs/SECURE_AI_INTEGRATION.md`. No deployment was run. | PASS (documentation only) |

Durable ignored browser evidence includes
`test-results/playwright/desktop-applied-receipt.png`,
`desktop-conflict-preview.png`, and `mobile-grounded-answer.png`.

## H. Independent review

Three independent agents statically reviewed exact Git object
`378f13bd669aec891ee5cb7e4d7eba71743040d4` without editing or mutating state.
The main writer separately executed every test command in section G.

- **Domain reviewer: PASS.** No P0/P1. It confirmed bounded state,
  Sessions-based analytics, WPI protected/cancelled/DST/capacity behavior,
  Goal Architect orphan protection, proposal-only tools, and read-only MCP. It
  reported the legacy standalone semantic-marker provenance P2 below.
- **Transaction reviewer: CONDITIONAL.** No P0/P1. It confirmed exact approval,
  capability-bound replay, atomic writes/audit, verifier/rollback serialization,
  phantom/reference/Session scopes, idempotency, and safe rollback. It reported
  the cross-week advisory-capacity scope and rollback-expiry test gaps below.
- **Security reviewer: CONDITIONAL.** No implementation P0/P1. It confirmed
  token/UID authority, Rules/Admin ownership, strict CORS/provider host,
  Responses bounds, prompt-data separation, static separation, account-switch
  isolation, credential-safe logging, and read-only MCP. It classifies the
  unconfirmed provider-side revocation as an external P1 and reported the auth
  enumeration and semantic-provenance P2s below.

## I. Dependencies added for this boundary

- `firebase-functions`: deployable v2 HTTPS Function runtime.
- `firebase-admin`: server-side ID-token verification and privileged Firestore
  access with explicit domain ownership enforcement.
- `openai`: backend-only Responses API transport; absent from the root/browser
  dependency tree.
- `zod`: runtime validation for HTTP payloads, tool arguments, and structured
  domain contracts.
- `@js-temporal/polyfill`: deterministic timezone and DST geometry shared by
  scheduling validation.
- Functions-only `esbuild`, TypeScript, and Vitest: reproducible Node 22 bundle
  and deterministic unit tests.
- Root `@firebase/rules-unit-testing`, Firebase CLI, and Playwright: official
  Rules/emulator and browser verification. The local `@life-tracker/ai-contract`
  workspace prevents frontend/backend contract drift without importing server
  runtime code into the browser.

## J. Residual risks and unverified external gates

No implementation P0 or P1 finding remains. The following external blocker and
known limitations are tracked separately:

1. **External P1, credential incident:** the current tree is redacted, but the
   historic Git object still contains the compromised OpenAI credential and
   provider-side revocation cannot be proven locally. Francesco must revoke it;
   no code or history rewrite can substitute for that action.
2. **P2, semantic provenance:** legacy WPI/GAI idempotency markers live in
   client-writable notes/descriptions. Inline or malformed marker forgery is
   rejected, but an owner can pre-persist a syntactically canonical standalone
   marker that may affect that same owner's duplicate suppression/analytics or
   redirect a legacy Goal Architect reuse to a structurally unrelated entity.
   Authentication, approval, cross-user isolation, and Firestore authorization
   are not bypassed. Removing this tradeoff safely requires a migration to
   server-owned provenance metadata, or structural agreement in addition to
   the marker, shared by the existing client commit paths; it must not be
   patched by breaking the required WPI/GAI replay bridge.
3. **P2, auth enumeration hardening:** the client distinguishes some Firebase
   sign-in error codes. If Firebase Email Enumeration Protection is not enabled,
   this can expose account-existence signals. Production should enable that
   setting and a follow-up should make invalid-credential/reset messages
   enumeration-equivalent.
4. **P2, cross-week rollback advisory scope:** a focused TimeBlock move to a
   different week binds the target week and source day, but not every other day
   in the source week. A later workload change elsewhere in the source week can
   make rollback introduce a new weekly-overload warning. Source-day overlap
   safety remains bound, and WPI treats weekly overload as a warning rather than
   a blocking conflict. A follow-up should bind the complete source week.
5. **P2, rollback-expiry evidence:** production and in-memory repositories check
   `rollbackExpiresAt`, but there is no direct emulator regression advancing a
   mutable clock past that deadline and asserting zero mutation. Add that test
   before changing rollback expiry code.
6. **P2, hosting origin:** every project below
   `https://francescopuglia.github.io` shares one browser origin. CORS cannot
   isolate `/life-tracker` from sibling paths. Use a dedicated trusted origin
   before production if other projects on that origin are not equally trusted.
7. **P2, dependency tooling:** root audit reports three moderate findings under
   development-only `firebase-tools`; npm offers only a forced breaking
   downgrade. Functions production dependencies report zero vulnerabilities.
8. **P3, repository lint debt:** lint exits 0 with pre-existing hook,
   accessibility, font, image, and escaping warnings outside the secure-AI
   change path.
9. The authenticated action flow is verified against the source/dev browser and
   real local emulators; the generated `out/` artifact is separately verified
   as a static login shell. A deployed staging artifact has not been exercised.
10. Live OpenAI smoke, staging deployment, production deployment, production
   data, and production Rules/index changes are **NOT RUN**.
11. Current ChatGPT account/plan eligibility for a remote MCP/plugin connection
   is **NOT VERIFIED**. The only included MCP adapter is feature-disabled,
   authenticated, read-only, and has no remote transport; writes remain disabled.

## K. Human actions remaining

1. Revoke the historical exposed OpenAI key and create a scoped, budget-limited
   replacement.
2. Authenticate Git as an identity with write access to
   `FrancescoPuglia/life-tracker`, then push only
   `codex/secure-openai-integration` without force.
3. Review the branch and this receipt. Do not merge until the remote branch and
   external credential incident are resolved.
4. If staging is approved, set the rotated OpenAI key and a fresh capability
   signing secret in the intended staging project's Secret Manager, deploy only
   the reviewed resources, and run a budget-limited authenticated live smoke.

Exact staging commands, prerequisites, TTL/index steps, and operational rollback
are documented in `docs/SECURE_AI_INTEGRATION.md`. They were not executed.

## L. Rollback

- User mutation: use the receipt-bound Undo capability before expiry; the
  backend rejects unsafe rollback over newer state and emits a rollback receipt.
- Feature branch: `git revert <specific-green-commit>` on the feature branch;
  do not reset or rewrite history.
- Staging service: build and redeploy the last known-good reviewed SHA from a
  separate clean checkout. Rules and indexes must be restored separately only
  after their local emulator verification.

## M. Historical recovery verdict (superseded by N.10)

`SECURE OPENAI INTEGRATION CONDITIONALLY VERIFIED — HUMAN EXTERNAL ACTIONS PENDING`

## N. Final Goal 1 staging verification

Date: 2026-08-24 (Europe/Rome)

### N.1 Git continuity and target identity

| Field | Final evidence |
| --- | --- |
| Repository | `FrancescoPuglia/life-tracker` at `/mnt/c/Users/Franc/Desktop/LIFE_TRACKING` |
| Branch | `codex/secure-ai-staging` |
| Verified resume SHA | `3eaf30f051a2ed8e56d2a19f18f5a7274ee6229c` |
| Final reviewed and deployed source SHA | `bef7b11c3ea2881b82b72faf52ebea61f251766b` |
| Final receipt SHA | The containing commit of this section; the exact resolved local/remote SHA is reported in the final handoff because a Git commit cannot embed its own object ID. |
| Remote | `origin/codex/secure-ai-staging`; matched local HEAD before receipt editing and is required to match the receipt commit after push. |
| Final tree | Required clean after the receipt commit and push. Generated `out/`, `.next/`, `functions/lib/`, and ignored test evidence were not manually edited or committed. |

The initial `pwd`, branch, `HEAD`, short status, and remote-ref checks matched
the preserved checkpoint exactly. No recovery archaeology, reset, merge,
force-push, or history rewrite occurred.

### N.2 Authenticated staging deployment attestation

- Firebase CLI identity: `pugliafrancesco3@gmail.com`, verified without
  displaying tokens or credential metadata.
- Explicit staging target: `life-tracker-staging`, project number
  `675076431391`.
- Positively identified production/reference target: `life-tracker-12000`,
  project number `970402762590`.
- Production deployment, production Rules/index mutation, production data
  access, and production Auth mutation: **none**.
- Deployment scope: only `functions:lifeTrackerAiApi`, with explicit
  `--project life-tracker-staging`.
- Runtime: Gen 2, Node 22, `europe-west1`.
- Cloud Run service: `lifetrackeraiapi`; revision
  `lifetrackeraiapi-00010-les`; service generation and observed generation 10;
  Ready `True`; 100% of traffic on that revision.
- Firebase source generation: `1787586849180704`; source hash:
  `50d67b3457a2d8167d13f657848c5585804cef65`.
- Backend release fingerprint:
  `sha256:5bfec76cae50f689f2d3da0fc445044364d96294e8ddafb6d9a4a0415a8a33b4`.
- Runtime configuration fingerprint:
  `sha256:16636fe0025aa4db11ce7d875dfc341e3fc2d69f817945321c7812aff82393a9`.
- Reviewed runtime contract: model `gpt-5.6-sol`, reasoning effort `medium`,
  prompt `life-tracker-secure-v1`, schema `life-plan-v1`.
- Secret bindings, metadata only: `OPENAI_API_KEY` version 2 and
  `AI_CAPABILITY_SIGNING_SECRET` version 1. No secret value was accessed,
  printed, rotated, or copied.
- Exact approved-origin health returned 200 with both fingerprints and exact
  frontend source SHA. An unapproved origin returned 403.

### N.3 Bounded real-provider evidence

Provider funding/model availability was tested once with the smallest separate
authenticated smoke before fixture creation. It completed on `gpt-5.6-sol`
with provider response ID
`resp_0e85acff431b073b016a8c6a36953c87d2bdbb108e62d7dddd`, one provider call,
4,312 input tokens, 14 output tokens, and 4,326 total tokens. It created no
Firestore fixture and its one temporary Auth user was deleted.

The single successful full run then used eight Responses calls: two turns for
each of the four necessary tool-mediated provider flows. Those flows used
57,173 total tokens. Including the smoke, all successful final provider
evidence used nine calls and 61,499 total tokens. No successful live call was
repeated merely for confidence; no provider loop was uncontrolled; no credit,
auto-reload, budget, alert, or billing setting was changed.

Those numbers describe the accepted final evidence runs, not cumulative
provider-account billing across earlier causal failing runs in the preserved
Goal 1 history. The billing dashboard and secret were intentionally not
accessed. Every earlier attempt remained bounded by the same per-request,
per-turn, timeout, and tool-call limits and was run only to reproduce or verify
a specific failed gate.

The final live evidence artifact is the ignored, secret-safe
`test-results/staging/live-verification.json`, run
`stg-20260824160753-930702`, generated from immutable source commit
`bef7b11c3ea2881b82b72faf52ebea61f251766b`. Its status is `PASS`, its
execution profile is `full`, all 14 flows are complete, and `notRunFlows` is
empty.

### N.4 Real staging lifecycle results

| Required result | Real staging evidence | Result |
| --- | --- | --- |
| Auth/UID authority | A valid Firebase token was accepted; an otherwise valid authenticated payload containing client `userId` was rejected. | PASS |
| Grounded read | The model called only `get_life_tracker_state` and returned the run-unique synthetic fixture evidence. Two Responses turns, one tool call, provider model `gpt-5.6-sol`, 12,137 total tokens. Plausible invention without the fixture could not satisfy the exact assertion. | PASS |
| Planned versus actual | The deterministic `planned_vs_actual` tool reread the persisted TimeBlock and Session and returned exactly 60 planned and 40 actual minutes. Two Responses turns, one tool call, 10,840 total tokens. | PASS |
| Hostile Note | A real Note containing an instruction/canary was passed only as untrusted data. The model used `get_notes`; no plan or mutation was created; mutation count remained zero. | PASS |
| Preview/reject | `preview_timeblock_change` produced plan `f05a28aa-8c7e-426c-b66b-5541aa9269b4` and exact changeset hash `d771aea1e6b0a14166c0da79c2fbc844566154e6aa3cea447d576dc1e2e7789d`. State was unchanged before approval and remained unchanged after reject. | PASS |
| Fresh approve/apply | A fresh controlled plan `347d0aa1-a2f5-430d-96f0-7e7bcbc01ed5` was approved through the authenticated backend. Execution `579683d5-bd2d-4915-99d1-4b643b56874d` committed and reread as verified. | PASS |
| Exact postcondition | The intended affected set matched exactly; the unrelated fixed block was byte/semantically unchanged; the UI disabled duplicate approval. | PASS |
| Durable audit | The execution returned a durable verified receipt bound to owner, plan, changeset, and execution. Durable audit records were retained as required. | PASS |
| Replay/one-time approval | Replaying the same execution converged idempotently; a second approval was rejected; mutation count after replay was zero. | PASS |
| Concurrent idempotency | Two concurrent create approvals yielded one committed execution, one idempotent replay, and one entity; rollback removed that entity. | PASS |
| Drift protection | After a legitimate V2 user edit, applying stale V1 returned `STATE_CHANGED`; V2 was preserved and partial mutation count was zero. | PASS |
| Rollback restoration | Owner-bound Undo restored the exact semantic scope and was itself replay-safe. | PASS |
| Rollback non-clobber | Wrong-owner rollback was indistinguishable from missing. A later legitimate user edit caused stale rollback denial; the newer edit remained and mutation count was zero. | PASS |
| Cross-user isolation | Real staging Rules, repository reads, proposal lookup, apply, and server-only namespaces denied user B access to user A. Existing and missing foreign IDs were indistinguishable. | PASS |
| Browser boundary | Nine requests went only to the project-bound backend; direct OpenAI requests, legacy AI requests, authoritative payload `userId`, and unexpected console errors were all zero. | PASS |

### N.5 Cleanup and production isolation

- Mutable synthetic staging user documents: 16 attempted, 16 deleted.
- Synthetic Firebase Auth accounts in the full run: 2 attempted, 2 deleted.
- Separate minimal-smoke Auth account: deleted.
- Cleanup status: complete for all mutable user fixture state.
- Server-owned audit receipts were intentionally preserved because deleting
  them would violate the audit invariant. Ephemeral server-owned plans,
  snapshots, capabilities, rate records, and idempotency records are governed
  by the deployed TTL policy.
- Production/reference project `life-tracker-12000`: explicitly untouched.

### N.6 Regression and security gates

All final commands below exited 0. Counts refer to the final unchanged source
unless a diagnostic is explicitly noted.

| Gate | Command | Final evidence |
| --- | --- | --- |
| Frontend types | `npm run typecheck` | PASS |
| Functions types | `npm --prefix functions run typecheck` | PASS; exact release fingerprint generated |
| Frontend unit | `npm run test:run` | 50 files, 624/624 tests PASS |
| Functions unit | `npm --prefix functions run test:run` | 16 files, 174/174 unit tests PASS; 34 emulator-only tests skipped here and executed below |
| Frontend static build | `OPENAI_API_KEY= NEXT_PUBLIC_OPENAI_API_KEY= NEXT_PUBLIC_OPENAI_MODEL= npm run build` | PASS; static export completed with the established warning set only |
| Functions build | `npm --prefix functions run build` | PASS |
| Firestore Rules | `npm run test:rules` | 49/49 on the official emulator PASS |
| Firebase Auth boundary | `npm run test:auth:emulator` | 2/2 PASS |
| Transaction/failure injection | `npm run test:functions:emulator` | 32/32 on the Firestore emulator PASS |
| Integrated browser/emulators | `npm run test:e2e:emulator` | 3/3 with real emulator Auth/Firestore/Functions and fake provider transport PASS |
| Static export browser | `OPENAI_API_KEY= NEXT_PUBLIC_OPENAI_API_KEY= NEXT_PUBLIC_OPENAI_MODEL= npm run test:e2e:static` | 1/1 PASS; output-inclusive static security scan PASS |
| Static/secret security | `npm run check:static-security`; output-inclusive scan; high-confidence changed/staged credential-pattern scan | PASS; no provider secret in browser, tracked source, docs, output, or diff |
| Patch hygiene | `git diff --check` | PASS |

One root unit test missed its UI timing deadline when the root and Functions
full suites were first launched concurrently under host CPU pressure (623/624).
The exact unchanged test immediately passed 1/1, and the isolated unchanged
full root suite passed 624/624. This was retained as an honest diagnostic, not
suppressed or weakened.

Two pre-success live harness attempts did not consume a provider call or leave
state: the first timed out while warming the local Next server before identity
creation; the second encountered a transient read-only health transport error
before identity creation. Its safe receipt proved zero documents, zero Auth
accounts, complete cleanup, and no production access. The unchanged exact warm
build then produced the single successful full live run above.

### N.7 Independent adversarial review and remediation

The independent reviewer was read-only. It inspected the exact approval,
hashing, Firestore transport, transaction, rollback, browser, and live-harness
paths and did not mutate the worktree or cloud state.

The writer reproduced every substantive P1 candidate before remediation,
including a focused real Firestore-emulator case where an accepted offset
date-time plan committed and then ended `COMMITTED_UNVERIFIED`. Negative tests
also captured projection truncation/unknown values/deletions, non-finite and
signed-zero hashing, nested Firestore Timestamp/GeoPoint handling, sub-
millisecond timestamps, and ordinary ISO-looking string preservation.

Commit `bef7b11c3ea2881b82b72faf52ebea61f251766b` made approval projection exact
and fail-closed, introduced compatible collision-safe canonical hashing,
implemented collection/path-aware Firestore transport validation, and
canonicalized writable date-times before diff/hash/approval. Focused, adjacent,
unit, emulator, build, live, and full-regression gates then passed. The final
review verdict was P0: none; reproducible P1: none remaining.

### N.8 Residual P2/P3 follow-ups

No residual item authorizes a cross-user access, direct model mutation,
approval replay, stale-state write, unsafe rollback, provider-secret exposure,
or production access. The read-only review retained these lower-severity
follow-ups:

1. A provider deadline after server-side preview creation can leave an
   inaccessible TTL-managed preview even though no capability reaches the
   client and no domain write is possible.
2. Read sanitization truncates bounded data without a user-facing truncation
   marker.
3. Cleanup cannot distinguish a missing document from a corrupt foreign-owned
   document when the owner-safe interface correctly returns an equivalent 403.
4. Legacy persisted date fields that are valid strings but not the canonical
   storage form fail closed and may require an explicit migration.
5. Some UI rendering treats `null` and empty optional values equivalently.
6. Approval capability storage in `sessionStorage` inherits the browser's XSS
   threat model; CSP and the project-bound backend reduce but cannot eliminate
   that architectural risk.
7. The exact staging-configured frontend was served locally for the real cloud
   run; Firebase Hosting itself was not redeployed or used for this verification.
8. Firestore integer/double equivalence and inherited classifier field-name
   edge cases remain P3 fidelity hardening opportunities.

### N.9 Deliberately not run or changed

- Production deployment, production data/Auth access, production Rules/index
  mutation, merge to `main`, force-push, and history rewrite: **NOT RUN by
  design**.
- Firebase Hosting deployment: **NOT RUN**. The user-authorized minimum deploy
  was the exact staging Function; the full real run used an exact
  staging-configured local frontend and the deployed cloud backend.
- Billing changes, additional credit purchase, auto-reload enablement, spend
  limit changes, alert changes, and API-key rotation: **NOT RUN**.
- Secret value inspection: **NOT RUN**. Binding metadata and successful
  secret-backed execution supplied the required evidence.
- No required Goal 1 lifecycle item is NOT VERIFIED. No human action remains
  for Goal 1.

### N.10 Final verdict

LIFE TRACKER SECURE AI STAGING VERIFIED
