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

Targeted evidence-helper tests: 3 files / 18 tests passed. Root TypeScript and
the static security scan also passed after this hardening.

The deployed Firestore configuration was independently reread after deployment:
the `timeBlocks` composite index is present and TTL is enabled for
`aiSnapshots.purgeAt`, `aiChangePlans.purgeAt`, `aiApprovals.purgeAt`,
`aiExecutions.purgeAt`, `aiIdempotency.purgeAt`, and
`aiRateLimits.expiresAt`.

## Green independent regression at this checkpoint

- Root unit tests: 46 files, 585 tests passed.
- Functions unit tests: 13 files / 142 tests passed; 27 emulator-only tests
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

## Exact external unblock

In the dedicated OpenAI staging project, enable funded API usage and a
non-zero project budget/usage limit sufficient for a small Responses API test.
Keep the key restricted to the minimum endpoint permissions required for
`/v1/responses`, and confirm that project access includes `gpt-5.6-sol`.

If quota is enabled for the already-bound key, no new secret or Firebase
deploy is needed while `/v1/health` continues to return the exact reviewed
fingerprint recorded above. If the key must be replaced, enter it only through:

```bash
firebase functions:secrets:set OPENAI_API_KEY --project life-tracker-staging
firebase deploy --project life-tracker-staging --only functions:lifeTrackerAiApi
```

Never paste the key into chat, a file, or command-line arguments.
