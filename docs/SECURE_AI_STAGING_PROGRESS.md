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
- explicit overall `PASS`/`FAIL`, failure stage, completed/NOT-RUN matrix,
  local source commit, and cleanup result in the evidence artifact;
- teardown of every explicit synthetic user document followed by deletion of
  both synthetic Auth accounts, including provider-failure paths. Durable
  server audit records remain server-only; rollback snapshots use the deployed
  TTL policy.

Targeted evidence-helper tests: 3 files / 16 tests passed. Root TypeScript and
the static security scan also passed after this hardening.

## Green independent regression at this checkpoint

- Root unit tests: 44 files, 572 tests passed.
- Functions unit tests: 13 files / 141 tests passed; 27 emulator-only tests
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

## Exact external unblock

In the dedicated OpenAI staging project, enable funded API usage and a
non-zero project budget/usage limit sufficient for a small Responses API test.
Keep the key restricted to the minimum endpoint permissions required for
`/v1/responses`, and confirm that project access includes `gpt-5.6-sol`.

If quota is enabled for the already-bound key, no new secret or Firebase
deploy is needed. If the key must be replaced, enter it only through:

```bash
firebase functions:secrets:set OPENAI_API_KEY --project life-tracker-staging
firebase deploy --project life-tracker-staging --only functions:lifeTrackerAiApi
```

Never paste the key into chat, a file, or command-line arguments.
