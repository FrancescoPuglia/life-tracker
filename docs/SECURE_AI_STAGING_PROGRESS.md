# Secure AI staging progress checkpoint

Date: 2026-08-17

Branch: `codex/secure-ai-staging`
Verified source baseline: `ae26be152cb550c495c548bb271f3704bcda5202`

This is a resumable progress checkpoint, not a final staging-verification
receipt.

## Isolated environment

- Dedicated Firebase project: `life-tracker-staging`.
- Positively identified production/reference project: `life-tracker-12000`.
- Production deployments and production data mutations performed: none.
- Firestore `(default)`: Native mode, Standard edition, `eur3`.
- Email/Password Auth and the staging Web app are enabled.
- Historic exposed OpenAI key: human-confirmed revoked.

## Deployed staging resources

Every deploy command named `--project life-tracker-staging` explicitly.

- Firestore Rules: deployed after the 47-test emulator suite passed.
- Firestore indexes and TTL configuration: deployed.
- `lifeTrackerAiApi`: active Gen 2 Node 22 Function in `europe-west1`.
- Bound secrets: `OPENAI_API_KEY` and `AI_CAPABILITY_SIGNING_SECRET` only.
- Non-secret runtime model: `gpt-5.6-sol`, reasoning effort `medium`.
- Exact allowed origins: local verification origin and the staging Hosting
  origin.
- Artifact Registry cleanup: images older than seven days are deleted.

No secret value appears in this document.

## Verified cloud boundary

- Approved-origin health request: HTTP 200.
- Unapproved-origin health request: HTTP 403.
- Unauthenticated chat request: HTTP 401.
- Real browser flow created authenticated synthetic staging users and seeded
  only their staging-owned fixture data.
- The browser made no direct OpenAI or legacy `/api/ai` request before the
  provider gate.
- A separate provider-independent live Rules check passed: owner create/read
  and owner-constrained query returned 200; anonymous read, cross-user read,
  cross-user create, and server-only namespace read returned 403; the denied
  cross-user write created no document; missing and existing cross-user reads
  were indistinguishable. Its two synthetic Auth users and fixture document
  were deleted at the end of the check.

## Live OpenAI gate

The authenticated request reached the deployed backend and the official
Responses endpoint. OpenAI returned HTTP 429 with the safe code
`insufficient_quota`; the backend returned its normalized error. Secret-safe
telemetry recorded only our request ID, provider status/code/type, and provider
request ID. It did not log prompts, response bodies, headers, tokens, or keys.

A second live browser run from source commit `fc04226` reproduced the same
provider `429 insufficient_quota` on staging Function revision
`lifetrackeraiapi-00002-lep`. The evidence artifact recorded overall `FAIL`,
the exact grounded-read failure stage, and every later flow as NOT RUN. Its
failure-path teardown deleted 15/15 explicit fixture documents and 2/2
synthetic Auth accounts. Production remained untouched.

That call exposed one runtime-classification defect: provider availability was
being flattened to generic HTTP 500. The remediation maps external provider
failures to a typed, non-secret HTTP 503 `PROVIDER_UNAVAILABLE` while leaving
unexpected internal failures as 500. Targeted adapter/HTTP tests passed. Only
`functions:lifeTrackerAiApi` was then deployed to `life-tracker-staging` with
Firebase source hash `071d9f3f44060b8399a69081c92e1f60f56a38ba`.

The post-deploy live browser retry from commit `94ba619` returned the expected
typed HTTP 503 while the safe Function telemetry still classified the upstream
response as `429 insufficient_quota`. Its artifact again recorded overall
`FAIL`, every provider-dependent flow as NOT RUN, production untouched, and
successful deletion of 15/15 fixture documents plus 2/2 synthetic Auth users.

The final evidence hardening was deployed from exact clean commit `c18c820` as
Function revision `lifetrackeraiapi-00005-beb`, Firebase source hash
`bf5ad32afd15d760d7381903c4d9ec19a6c852c3`, and storage-source generation
`1786980891480225`. Its runtime health response exposes the non-secret source
fingerprint
`sha256:b4dad10b19f5dd4f3bb25b2b9764d8deee79a0e1a5cfbbed06ca63e43b3dad75`,
which the clean-source harness requires to match its locally generated
fingerprint before creating any staging identity or data. The deploy command
targeted only `functions:lifeTrackerAiApi` with
`--project life-tracker-staging` and exited 0. A read-only post-deploy CLI check
confirmed that only `OPENAI_API_KEY` version 2 and
`AI_CAPABILITY_SIGNING_SECRET` version 1 are bound, both in the staging project.

The exact-source browser run (`stg-20260817154149-c3a7ff`) passed approved and
denied CORS checks plus a valid-mode authenticated payload-`userId` spoof
rejection before calling OpenAI. The first grounded read then returned the
expected typed HTTP 503. Secret-safe Function telemetry tied that request to
upstream Responses HTTP 429 `insufficient_quota`. The artifact is explicitly
`FAIL`, records every later provider-dependent flow as NOT RUN, states
`productionTouched: false`, and confirms deletion of 15/15 explicit fixture
documents plus 2/2 synthetic Auth accounts.

A subsequent attestation/retention hardening checkpoint was deployed from exact
clean commit `e80fbe7` as Function revision
`lifetrackeraiapi-00006-per`, Firebase source hash
`70f8ebe1fd5c8b5e4ef899a4959c351fd14fbd70`, and storage-source generation
`1786984624882907`. Its runtime health fingerprint is
`sha256:de3d12d180462fdb29dd9e7272b69fb8491f94a625e3dcd0ae56a508692d2d80`.
The fingerprint now covers the reviewed Firestore Rules, indexes/TTL
configuration, Firebase project mapping, and deployment configuration as well
as the backend source and shared contracts. The deploy targeted only
`functions:lifeTrackerAiApi` in `life-tracker-staging`; the first CLI attempt
failed before upload on the default 10-second source-discovery timeout, and the
unchanged retry with `FUNCTIONS_DISCOVERY_TIMEOUT=120` exited 0. Read-only
metadata confirmed that only `OPENAI_API_KEY` version 2 and
`AI_CAPABILITY_SIGNING_SECRET` version 1 are bound. A fresh Firestore Admin
metadata read confirmed all six reviewed TTL policies remain `ACTIVE`.

The corresponding exact-source browser run
(`stg-20260817164501-0a7ffb`) again passed health/fingerprint, exact CORS, and
valid-mode authenticated payload-UID rejection before calling OpenAI. The
grounded request returned normalized HTTP 503 `PROVIDER_UNAVAILABLE`;
request-ID-scoped, allowlisted telemetry confirmed the upstream Responses
result remained HTTP 429 `insufficient_quota`. The artifact retains only
status, safe error code, and request ID for that failure—never the provider
response body. It records overall `FAIL`, every later flow as NOT RUN,
`productionTouched: false`, and successful deletion of 15/15 fixture documents
plus 2/2 synthetic Auth accounts.

Because no provider response could be generated, grounded read,
planned-vs-actual interpretation, hostile-Note behavior, proposal, Reject,
Apply, replay, drift, audit receipt, and Undo remain **NOT RUN against the real
Responses API**. Their local/emulator counterparts remain green.

## Live evidence harness hardening

The next funded run now fails closed unless it proves the deployed behavior,
not merely a plausible response:

- canonical shared-contract parsing plus one exact, conflict-free operation;
- plan/hash/execution/affected-set binding for Apply, replay, and Undo;
- full bounded-fixture hashes for Reject, exact Apply scope, and stale-preview
  zero-partial-write checks;
- one UI request per approval and a real concurrent same-key TimeBlock-create
  race that must converge on one execution, one replay, and one entity;
- definite cross-user and missing-entity proposal probes, payload `userId`
  rejection, wrong-owner Apply/Rollback indistinguishability, and newer-human-
  edit rollback refusal;
- hostile-Note canary retrieval in planning mode while proposal tools are
  available, with a full fixture no-mutation check;
- fixed-message assertion failures that never serialize provider credentials,
  approval capabilities, rollback capabilities, or Firebase tokens;
- exact diff-value/changed-field checks for TimeBlock identity, interval,
  status, type, hierarchy links, flexibility, and server WPI provenance;
- fixture snapshots taken before Preview as well as after Preview/Reject, so a
  proposal-time mutation cannot be mislabeled as a safe Reject;
- pre-consumption wrong-capability and cross-plan-capability rejection checks;
- the payload-UID negative case now uses a valid `ask` mode, and privileged
  Rules probes address the real root `aiChangePlans/{uid}_{planId}` namespace;
- explicit overall `PASS`/`FAIL`, failure stage, completed/NOT-RUN matrix,
  clean local source commit, exact deployed backend source fingerprint, and
  cleanup result in the evidence artifact;
- teardown of every explicit synthetic user document followed by deletion of
  both synthetic Auth accounts, including provider-failure paths. Durable
  server audit records remain server-only. Plans, approvals, executions, and
  idempotency records now carry server-owned TTL timestamps; snapshots and
  rate-limit records use their rollback/window TTL boundaries. Evidence calls
  the immediate result `userAndAuthCleanupComplete` rather than claiming that
  asynchronous server TTL deletion has already occurred.

Targeted evidence-helper tests: 3 files / 19 tests passed. Root TypeScript and
the static security scan also passed after this hardening.

The deployed Firestore configuration was independently reread after deployment:
the `timeBlocks` composite index is present and TTL is enabled for
`aiSnapshots.purgeAt`, `aiChangePlans.purgeAt`, `aiApprovals.purgeAt`,
`aiExecutions.purgeAt`, `aiIdempotency.purgeAt`, and
`aiRateLimits.expiresAt`.

## Green independent regression at this checkpoint

- Root unit tests: 47 files, 594 tests passed.
- Functions unit tests: 14 files / 151 tests passed; 27 emulator-only tests
  skipped in the unit invocation.
- Firestore Rules emulator: 47/47 passed.
- Firebase Auth emulator: 2/2 passed.
- Firestore transaction/failure-injection emulator: 25/25 passed.
- Full Auth + Firestore + Functions + browser emulator E2E: 3/3 passed.
- Static-export browser E2E: 1/1 passed.
- Root typecheck: passed.
- Functions typecheck/build: passed.
- Root lint: passed with the established warning set.
- Production static export with OpenAI variables empty: passed.
- Post-build static security scan: passed.
- `git diff --check`: passed.

The final clean-commit rerun reproduced these results. The first Rules command
hit a cold-start-only 10-second setup-hook timeout before any assertion ran;
the immediate unchanged rerun exercised and passed all 47/47 cases. No rule or
test was weakened.

The final transaction-emulator rerun also verifies that TTL metadata is stored
as Firestore timestamps while remaining outside the immutable LifePlan hash.
The first attempt failed closed on this boundary; after explicitly excluding
`purgeAt` from changeset integrity, all 25/25 cases passed again.

## Local attestation checkpoint awaiting staging deployment

Clean commit `8c11adab11b78bd63466cc3f12fc39bb68fddbe3` adds two
independent fail-closed provenance checks without changing the AI authority or
mutation model:

- `/v1/health` now returns a non-secret runtime-policy digest in addition to
  the source/configuration fingerprint. The digest binds the configured model,
  reasoning effort, validated provider URL, exact origin allowlist,
  prompt/schema versions, timeout, tool/call limits, and output-token limit.
  Only the digest and safe model/version labels are exposed.
- Static and staging browser builds embed the exact lowercase 40-character Git
  commit in the document body. The staging harness requires it to match the
  clean source commit before creating Auth users or fixture data.
- `npm run build:static` performs a fresh real GitHub Pages export, clears both
  OpenAI environment variables, embeds the exact commit, and runs the output
  security scan. The deploy workflow uses this reproducible command.

Exact-commit verification at `8c11ada` passed 594/594 root tests, 151/151
Functions unit tests, root and Functions typechecks, the Functions build, the
fresh static export and output-inclusive security scan, static browser E2E
1/1, and full Auth + Firestore + Functions emulator browser E2E 3/3. Durable
Playwright status artifacts both report `passed`; the three emulator evidence
screenshots cover conflict preview, applied receipt, and mobile grounded answer.
No provider credential was used by these local/emulator gates.

This commit is pushed to `origin/codex/secure-ai-staging` but is **not yet
deployed**. The deployed Function remains exact commit `e80fbe7` with runtime
source fingerprint
`sha256:de3d12d180462fdb29dd9e7272b69fb8491f94a625e3dcd0ae56a508692d2d80`.
The locally generated source fingerprint for `8c11ada` is
`sha256:580797247f5ed3fcffd9f17fc5428bab6c5e1095c101d6001b0b8ad394204701`.
No cloud or production mutation was made for this local checkpoint.

The subsequent independent security review found one P1 in the Pages build
boundary: an arbitrary HTTPS `NEXT_PUBLIC_AI_API_BASE_URL` could have received
the user's Firebase bearer token. Commit
`aa10db867d348cf8c9c79ce1507b02329511ef01` fixes this by sharing one strict
public contract between the browser and static scanner. A configured backend
is now accepted only when it is the exact
`europe-west1-{firebaseProject}.cloudfunctions.net/lifeTrackerAiApi` endpoint
for the same Firebase project that owns Auth. Only the matching project-bound
Functions emulator path is allowed in explicit development. The Pages workflow
hard-binds the production Firebase project ID, the exported body attests the
exact public backend endpoint, and the staging harness checks that marker
before creating any identity or data. A direct negative scan proved
`https://attacker.example/lifeTrackerAiApi` is rejected.

The same checkpoint distinguishes the configured model from the
provider-returned model identity. A successful staging record must now report
both the reviewed request model and the provider's exact safe model field.
Missing or malformed provider model metadata fails closed. Follow-up commit
`0373bae2f9ac6d30162f34f893a221ba7e23a257` strengthens that boundary by
requiring the exact configured model identity on **every** provider response,
including intermediate tool-call turns, before usage, output, or tool execution
is processed. Missing, malformed, and mismatched intermediate identities are
covered by fail-closed tests that also prove no proposal or audit event is
created. The staging harness captures a single immutable source commit for the
entire run and fails if the tree or HEAD changes before evidence finalization.

Full unit verification after this remediation passed 597/597 root tests and
152/152 Functions unit tests; both typechecks and the focused positive/negative
static-boundary checks passed. Its locally generated backend source fingerprint
is `sha256:d436cf7146f159187c574957ace734fb623b1fa5229946429c310b7a6cef8f4c`.
The clean documentation checkpoint `c1a8379` then passed the Functions build,
root lint with only the established warnings, a fresh production Pages export,
the automatic output-inclusive static security scan, static browser E2E 1/1,
full Auth + Firestore + Functions emulator browser E2E 3/3, Firestore Rules
47/47, Auth token verification 2/2, and transaction/failure-injection emulator
25/25. The first static Playwright launch was denied by the managed sandbox at
localhost bind (`EPERM`); the unchanged already-built gate was rerun with the
approved localhost sandbox permission and passed. The first full emulator
attempt selected system Node 18 because of an overly narrow temporary PATH and
failed before emulator startup; restoring the repository Node 22 path made the
unchanged gate pass. No test or security policy was weakened.

The per-turn provider-identity checkpoint passed its focused adapter suite
15/15, the complete Functions unit suite 155/155, Functions typecheck and
build, `git diff --check`, and the canonical static security scan. Its locally
generated backend source fingerprint is
`sha256:d4046d28fdb96b6c3b2454b1bfad91dfa89980a03b0727e8984c644b68caba24`.
Independent review then identified that an explicitly `failed` or `incomplete`
provider response containing a tool call could reach proposal execution.
Commit `029d85c876b6e4f03a21558f8adcb3aa14564b2b` now rejects either status
immediately after model attestation and before accounting, output ingestion, or
tool execution. The regression proves no proposal or audit event is created.
Its focused adapter suite passed 17/17, the complete Functions unit suite
157/157, Functions typecheck and build passed, and the generated backend source
fingerprint is
`sha256:dd9b08c86037d78a4bb7ec7dd3ece78e340d6886af877ae4f4ae253ec9c39d1c`.
Final review identified the remaining SDK statuses `in_progress`, `cancelled`,
and `queued`, plus absent status metadata. Commit
`771e261c680f29c8b6aa1293675d0c75ef19b1ec` now requires explicit
`status: completed`; every other or missing status is rejected before output or
tool processing. The expanded focused suite passed 21/21, the complete
Functions unit suite passed 161/161, Functions typecheck/build passed, and the
generated backend source fingerprint is
`sha256:6994a8f1bf82fdfddb023e1e5e050b27dbf3b5927062c471d85a852fdca57da1`.
Security follow-up commit
`3a30e0cb27bf573782c3df75cc2e189a85b8d369` also binds each browser bearer
token to the same Firebase project used to derive the canonical backend URL.
The client obtains `getIdTokenResult()`, requires both `aud` and `iss` to match
the configured project, and refuses network access on mismatch or missing
claims. Focused client tests passed 21/21, the full root suite passed 600/600,
root typecheck and the static security scan passed, and the full real Auth +
Firestore + Functions emulator browser boundary passed 3/3 with SDK-issued
emulator tokens. No token value is decoded manually, logged, or persisted.
At exact source checkpoint `08f26fa94f070c1f9d0fb1f30f275fe6e6d5e1fb`,
the fresh production static export and output-inclusive scan passed, static
browser E2E passed 1/1, and the full isolated Auth + Firestore + Functions
emulator browser suite passed 3/3 in 4.5 minutes. Those scenarios exercised
grounded read, preview/reject, authenticated tool orchestration, apply, drift
rejection, rollback, and mobile behavior with the fake Responses transport.
No cloud project or real provider secret was used.

The exact static export attested source
`08f26fa94f070c1f9d0fb1f30f275fe6e6d5e1fb` and public AI backend state
`not-configured`; a configured production or staging export is required to
attest its exact project-bound Function URL instead. The ignored Playwright
status artifacts both reported `passed`. Screenshot SHA-256 evidence for the
emulator conflict preview, applied receipt, and mobile grounded answer is,
respectively, `28149313590cc192153f6d1786a1c964af55f9acdb6207819f90f77800d2a13b`,
`b419328e47721839ea234ef5819cc782b7674f4f81d01c4add4dca21f5549e7a`,
and `8ce681d3b397a1f9f5755b3d679ea9de0f44950a72966e177ff1c39941467703`.
This checkpoint is not yet deployed; production remains untouched.

## Exact external unblock

Two human-controlled prerequisites now remain before the next staging cloud
mutation and funded browser run:

1. Invalidate and reauthenticate the Firebase CLI session before reuse. A
   local CLI diagnostic emitted credential-bearing authentication metadata to
   the private tool transcript. No credential was copied into repository files,
   artifacts, logs, or this receipt, but the session must be treated as exposed.
   Run `firebase logout`, then `firebase login`, and confirm successful login.
2. In the dedicated OpenAI staging project, enable funded API usage and a
   non-zero project budget/usage limit sufficient for the bounded Responses
   smoke. Keep the key restricted to the minimum endpoint permissions required
   for `/v1/responses`, and confirm project access to `gpt-5.6-sol`.

After Firebase reauthentication, deploy only the final exact reviewed commit
at or after `aa10db867d348cf8c9c79ce1507b02329511ef01`
to the explicit staging project and verify both health attestations before
creating any synthetic data:

```bash
FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy \
  --project life-tracker-staging \
  --only functions:lifeTrackerAiApi
```

If quota is enabled for the already-bound key, no new secret version is
required. If the key must be replaced, enter it only through:

```bash
firebase functions:secrets:set OPENAI_API_KEY --project life-tracker-staging
firebase deploy --project life-tracker-staging --only functions:lifeTrackerAiApi
```

Never paste the key into chat, a file, or command-line arguments.
