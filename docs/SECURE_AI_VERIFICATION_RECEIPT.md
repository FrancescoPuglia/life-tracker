# Secure AI verification receipt

Date: 2026-08-17 (Europe/Rome)

Scope: local verification of the recovered Life Tracker secure OpenAI
integration. This receipt records evidence; it does not authorize a merge,
deployment, production-data change, or secret rotation.

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

## M. Verdict

`SECURE OPENAI INTEGRATION CONDITIONALLY VERIFIED — HUMAN EXTERNAL ACTIONS PENDING`
