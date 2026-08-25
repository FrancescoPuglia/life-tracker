# R1 staging Desktop and Function-only deployment precheck

Status: `GREEN LOCALLY — DEPLOYMENT AND INSTALL NOT RUN`

Prepared: 2026-08-25 (Europe/Rome)

This receipt defines the smallest staging change required to make the installed
Tauri Beta able to call the already-verified Secure AI backend. It does not
authorize deployment, installation, a provider call, or any Firebase mutation.

## Exact targets

- Firebase project: `life-tracker-staging`
- Firebase project number: `675076431391`
- Function: `lifeTrackerAiApi`
- Region/runtime: `europe-west1`, Gen 2, Node 22
- Existing reviewed/deployed source:
  `bef7b11c3ea2881b82b72faf52ebea61f251766b`
- Existing authoritative revision: `lifetrackeraiapi-00010-les`
- Proposed minimal Function source:
  `3100c42bfda50bb4627b7345270985a517439167`
- Current Master/Desktop source:
  `ced322e7a63cf6dbe7de6f54a047abfe62df6a45`

Production project `life-tracker-12000` is expressly out of scope.

## Current live staging evidence

A read-only Firebase CLI inventory with explicit
`--project life-tracker-staging` returned exactly one Function:

| Field | Current value |
| --- | --- |
| Function/state | `lifeTrackerAiApi`, `ACTIVE` |
| Platform/runtime | `gcfv2`, `nodejs22` |
| Region | `europe-west1` |
| Source generation | `1787586849180704` |
| Firebase source hash | `50d67b3457a2d8167d13f657848c5585804cef65` |
| Timeout/memory/CPU | 60 seconds / 512 MiB / 1 |
| Concurrency/max instances | 40 / 20 |
| Model/reasoning | `gpt-5.6-sol` / `medium` |
| Provider base URL | official OpenAI API v1 |
| Allowed origins | local verification `http://127.0.0.1:3300` and staging Hosting `https://life-tracker-staging.web.app` |
| Secret bindings (metadata only) | `OPENAI_API_KEY` version 2; `AI_CAPABILITY_SIGNING_SECRET` version 1 |

The approved Hosting-origin `/v1/health` response was HTTP 200 and returned:

- backend release fingerprint:
  `sha256:5bfec76cae50f689f2d3da0fc445044364d96294e8ddafb6d9a4a0415a8a33b4`;
- runtime configuration fingerprint:
  `sha256:16636fe0025aa4db11ce7d875dfc341e3fc2d69f817945321c7812aff82393a9`;
- model `gpt-5.6-sol`, reasoning `medium`, prompt
  `life-tracker-secure-v1`, and schema `life-plan-v1`.

Fresh CORS probes proved:

- staging Hosting origin: HTTP 200 with exact allow-origin;
- `https://tauri.localhost`: HTTP 403;
- `http://tauri.localhost`, `https://evil.tauri.localhost`, and
  `https://tauri.localhost:443`: HTTP 403;
- the public Pages origin is also currently denied.

No authenticated endpoint, OpenAI provider path, Firestore document, secret
value, or production resource was touched by these probes.

## Minimal source delta

`bef7b11..3100c42` changes exactly five Functions files:

- `functions/src/http/cors.ts`: adds the exact constant
  `https://tauri.localhost`;
- `functions/src/index.ts`: includes that constant in the source default;
- `functions/test/http/cors.test.ts`;
- `functions/test/http/handler.test.ts`;
- `functions/test/runtime-config.test.ts`.

The implementation delta is one runtime origin. The remaining changes are
negative/attestation tests. There is no dependency, domain, authentication,
ownership, Firestore, tool, approval, apply, rollback, provider, prompt, model,
secret, timeout, concurrency, or instance-limit change.

The proposed deploy must use a detached clean worktree at exact `3100c42`, not
the current multi-endpoint Functions tree. This guarantees that Firebase
discovery sees one deployable endpoint only and cannot accidentally include the
later reminder, report, or MCP endpoints.

## Exact non-secret runtime policy after deploy

The deployment worktree must supply these reviewed non-secret parameters:

| Parameter | Required value |
| --- | --- |
| `OPENAI_MODEL` | `gpt-5.6-sol` |
| `OPENAI_REASONING_EFFORT` | `medium` |
| `OPENAI_BASE_URL` | official OpenAI API v1 |
| `AI_ALLOWED_ORIGINS` | `http://127.0.0.1:3300`, `https://life-tracker-staging.web.app`, `https://tauri.localhost` |

Do not rely on `3100c42` source defaults: its defaults predate the verified
Sol/medium runtime. Create the temporary worktree's ignored
`functions/.env.life-tracker-staging` with only the exact non-secret values
above. Do not copy an existing environment file, open a secret file, or add a
secret value to that file.

The expected post-deploy runtime configuration fingerprint is:

`sha256:6ef03a915ff73a9d688bd416fd13a622b9effc9c5573963d39eb85d563e50a7f`

The origin set is exact. In particular, do not add the public Pages origin,
wildcards, subdomains, an explicit port, HTTP Tauri, or a second Desktop origin.

## Minimal source proof

The exact `3100c42` commit was checked in a detached `/tmp` worktree:

| Check | Result |
| --- | --- |
| Lockfile install/audit | 339 packages; 0 vulnerabilities |
| Affected tests | 3 files / 32 tests PASS (`cors`, HTTP handler, runtime config) |
| Strict typecheck/build | PASS; Node 22 CommonJS bundle 340.0 kB |
| Proposed backend fingerprint | `sha256:8bec8a4cea3b148f56f9fdd3b6643edcd1f64ac0dd05eb3f9f35c0eb9b342a06` |
| Deployable endpoints | exactly 1: `lifeTrackerAiApi` |
| Endpoint metadata | `gcfv2`, `europe-west1`, 60 seconds, 512 MiB, concurrency 40, max instances 20 |
| Secret metadata | exact existing names only: `OPENAI_API_KEY`, `AI_CAPABILITY_SIGNING_SECRET` |
| Source/bundle credential scan | PASS; no high-confidence credential-shaped value |
| Diff hygiene | `git diff --check bef7b11..3100c42` PASS |

Goal 1's 14 live OpenAI lifecycle flows are not repeated merely for confidence.
The affected trust boundary is CORS only, and its focused tests plus post-deploy
allow/deny probes are the required regression. Installed Ask AI acceptance may
make one intentional real user request later; it is not part of deployment.

## Automated read-only acceptance verifier

Master checkpoint `f1070cc69b80aa2cd6724c4e297c99ec110db5fd` adds a
provider-free verifier for the exact public boundary:

```text
npm run verify:r1-staging:baseline
npm run verify:r1-staging:desktop
```

Each profile makes exactly 16 bounded HTTPS requests to `/v1/health`: GET plus
an authenticated-POST-shaped OPTIONS preflight for every exact allowed and
denied origin. It sends no bearer token, request body, Firebase data, provider
request, or mutation. It caps a health body at 8 KiB, retries only one transport
exception, never logs a response body or request ID, and validates:

- exact status and `Access-Control-Allow-Origin` behavior;
- absence of credentialed CORS;
- POST/Authorization/Content-Type/X-Request-Id preflight support;
- exact release/runtime fingerprints and Sol/medium/prompt/schema authority;
- denial of HTTP/subdomain/explicit-port Tauri, Pages, and attacker origins.

The live `baseline` profile passed 16/16 probes on 2026-08-25 with the original
two origins and Goal 1 fingerprints. The `desktop` profile exited 1 as required
before deployment because the current release/runtime fingerprints remain the
baseline values; the baseline profile independently proved exact Desktop GET
and preflight denial. The first sandboxed live command failed with a normalized
transport error because network access was unavailable; its explicitly
approved read-only retry passed. No cloud state changed.

## Current Beta artifact

A clean reviewed-staging export and Windows x64 Tauri/NSIS build completed from
exact `ced322e7a63cf6dbe7de6f54a047abfe62df6a45`:

| Artifact | Size | SHA-256 |
| --- | ---: | --- |
| `life-tracker.exe` | 6,478,848 bytes | `cd24d9dfdde54e7f66691dec67e09eebbbf12f3281719c3771356f59f627f519` |
| `Life Tracker Beta_1.0.0_x64-setup.exe` | 2,386,292 bytes | `032403ca52c6a367f814adee37e9a95d03e55309988c215ffedadabdcd77d23d` |

Evidence:

- reviewed public staging Firebase Web manifest matched every pinned app/project
  field and API-key hash without printing the public key;
- 4 static pages exported; output-inclusive static security passed;
- exported HTML attests exact source SHA, `staging`, `desktop`, and the exact
  staging `lifeTrackerAiApi` URL;
- pinned Windows x64 Tauri release and one NSIS bundle passed;
- executable and installer contain no OpenAI/Twilio/webhook/private-key shape,
  provider-secret variable name, or Life Tracker GitHub/Pages runtime URL;
- one permissive `re_` shape in the executable was classified without printing
  it: it is a 29-character token inherited from the pinned
  `tauri_runtime_wry` library, absent from tracked runtime source, `out`, and the
  installer. It is not a Resend credential;
- Windows metadata reports `Life Tracker Beta`, file version `1.0.0`;
- both artifacts are `NotSigned`. Code signing is not an R1/updater blocker,
  but Windows may show an untrusted-publisher/SmartScreen warning and the final
  receipt must not imply Authenticode verification.

The artifact is not installed. The older installed Beta is unchanged.

## Explicitly excluded resources

The approved deploy command must not include or change:

- any Function other than `lifeTrackerAiApi`;
- Firestore Rules, indexes, TTL, data, Auth, Hosting, Storage, or extensions;
- reminder callable/triggers/worker/callback/refill scheduler;
- report triggers/scheduler/email runtime;
- read-only MCP/OAuth server;
- Cloud Tasks, Cloud Scheduler, Eventarc configuration, queue, or IAM;
- Secret Manager value/version/rotation/access policy;
- OpenAI model routing, budget, billing, auto-reload, or provider call;
- Twilio, Resend, domain/DNS, GitHub, production Firebase, or Desktop install.

## Approval-time procedure

Before the mutation, display only safe metadata and confirm:

1. authenticated Firebase account identity (never its credential);
2. target `life-tracker-staging`, project number `675076431391`;
3. current Function source hash/fingerprints and secret version metadata still
   match this receipt;
4. exact clean worktree source is `3100c42bfda50bb4627b7345270985a517439167`;
5. the temporary non-secret parameter file has the exact four settings above;
6. focused tests/build/credential scan still pass;
7. Firebase discovery contains exactly one endpoint;
8. command scope is exactly `functions:lifeTrackerAiApi`.

Then, and only after one exact human approval, run from the detached worktree:

```text
node <reviewed-firebase-cli> deploy \
  --project life-tracker-staging \
  --only functions:lifeTrackerAiApi
```

This creates a new Function/Cloud Run revision and build artifact. It can incur
the staging project's existing build/runtime/storage costs. It enables no new
API, plan, billing link, paid provider call, auto-reload, or loop. No billing
setting may be changed as part of the approval.

## Required post-deploy acceptance

Before installing the new Beta:

1. Run `npm run verify:r1-staging:desktop`; it must return `PASS` with three
   allowed origins, five denied origins, 16 requests, and the full expected
   release/runtime fingerprints.
2. `functions:list --project life-tracker-staging --json` still returns only the
   intended Function for this source and shows the same resource bounds and
   secret version metadata.
3. Approved Hosting and local-verification origins return HTTP 200.
4. Exact `https://tauri.localhost` returns HTTP 200 with the exact
   `Access-Control-Allow-Origin` value.
5. HTTP Tauri, subdomain Tauri, explicit-port Tauri, Pages, and attacker origins
   return HTTP 403 without an allow-origin header.
6. Health reports backend fingerprint `sha256:8bec8a4c...` in full as recorded
   above and runtime fingerprint `sha256:6ef03a91...` in full as recorded above.
7. Model/reasoning/prompt/schema remain Sol/medium/secure-v1/life-plan-v1.
8. No other endpoint, Rule, index, task, scheduler, secret version, provider,
   or production resource changed.

If any assertion fails, do not install or invoke Ask AI.

## Rollback

The durable rollback is a targeted redeploy from a second clean detached
worktree at exact `bef7b11c3ea2881b82b72faf52ebea61f251766b`, with the original
non-secret runtime values:

- model `gpt-5.6-sol`;
- reasoning `medium`;
- official provider base URL;
- origins `http://127.0.0.1:3300` and
  `https://life-tracker-staging.web.app`.

Use the same explicit project and only-target command. Verify restored backend
fingerprint `sha256:5bfec76c...`, runtime fingerprint `sha256:16636fe0...`, and
Desktop origin HTTP 403. This creates a new rollback revision without rewriting
Git history or touching production/user data. The existing revision
`lifetrackeraiapi-00010-les` remains the authoritative recovery reference.

## Exact pending human action

None is requested by this document alone. First commit and push this receipt.
If all metadata still matches afterward, request exactly:

`Approve deploying only lifeTrackerAiApi from 3100c42 to the explicit
life-tracker-staging project with the exact three-origin non-secret policy?`

Until that approval and post-deploy evidence, R1 Ask AI remains
`NOT VERIFIED` and the correct overall status is not a release PASS.
