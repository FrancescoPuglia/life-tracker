# Private ChatGPT read integration: pre-deploy and recovery runbook

Last reviewed: 2026-08-25 (Europe/Rome)

## Status and authority

**NOT DEPLOYED.** The read-only MCP implementation, its isolated Firebase
codebase, Rules denials, and TTL metadata are locally verified. No staging or
production Function, Rule, index, TTL policy, API, IAM binding, runtime
parameter, Firebase account, ChatGPT setting, billing setting, secret, or user
document was changed while isolating this deployment boundary. No ChatGPT
account has been connected.

Exact source authority:

- application branch: `codex/life-tracker-os`;
- MCP implementation checkpoint:
  `4219f576c36ca3578f4f331690aff45fc2316c04`;
- isolated deployment checkpoint:
  `099c5794a962d7a859a5ebc5f3231cf8cf1b34cd`;
- `firebase.mcp.json` Git blob:
  `3c0f680d09578aed846d9241eff7797d8204cdad`;
- isolated lockfile Git blob:
  `e9f8ce43ca17a6bba155593ac571e9077aacda58`;
- isolated entry Git blob:
  `11a7cae4329bbd69e368d587f8fdcbfd7643df93`;
- reviewed runtime wiring Git blob:
  `5ddb34aa70e9cd556ebf7bb44ac1a3875471a69e`;
- isolated bundle: 387,871 bytes; SHA-256
  `80410572680d2aac7431418023a2d825031d867627725bbd9c3b18bcda789594`;
- separated default Functions source fingerprint:
  `sha256:bec32f91c16273d006d14221438e974bc2ed836be6e85d35e04ba6965694d655`;
- separated default bundle: 531,718 bytes; SHA-256
  `31724c2ab028df7bd96871b852d7a72c7a80ef54d9aa6f1a439fb4d2396e3b3e`;
- toolchain: Node `22.22.0`, Firebase CLI `15.28.1`, Firebase Functions
  `7.3.2`, MCP TypeScript SDK `1.30.0`.

`firebase.mcp.json` contains one Functions source, codebase `mcp`, and no
Firestore, Hosting, Auth, Storage, emulator, or other deploy target. Its
predeploy step builds the checked-in isolated package from its lockfile and
runs SDK discovery. Discovery must return exactly one endpoint, four non-secret
parameters, zero secret bindings, zero task queues, zero schedulers, zero
custom roles, and zero required APIs. The ordinary default codebase now
discovers only `lifeTrackerAiApi`; it is not MCP deployment authority. The
detached R1 source remains a separate one-endpoint authority and is unchanged.

## Read-only product boundary

`lifeTrackerMcp` exposes exactly these 12 tools:

- `get_life_tracker_state`
- `get_goals`
- `get_projects`
- `get_tasks`
- `get_timeblocks`
- `get_sessions`
- `get_habits`
- `get_kpis`
- `get_reports`
- `planned_vs_actual`
- `analyze_period`
- `goal_alignment`

There are zero write tools. Notes are omitted, arbitrary Firestore paths and
free-text queries are absent, list pages are limited to 10 items, explicit date
ranges are limited to 90 days, state collections are limited to 10 items, and a
tool response is limited to 192,000 UTF-8 bytes. Tool definitions are
read-only/non-destructive/closed-world. Apply, preview, rollback, delete,
capability issuance, and schedule replacement remain available only through
Life Tracker's verified application boundary.

Deterministic domain and report services remain the numerical authority. MCP
does not call an LLM and cannot invent or persist an analytical value. Returned
titles and descriptions are marked untrusted data; Notes and editor JSON do not
enter the MCP response. Tool-name injection cannot expand the compile-time
allowlist.

## Identity and OAuth authority

Firebase Authentication remains the sole user identity authority:

1. ChatGPT discovers protected-resource and authorization-server metadata.
2. The user signs in on the Life Tracker consent page through the Firebase Web
   SDK. A password, if used, is sent directly to Firebase and never to the MCP
   backend.
3. The backend verifies the Firebase ID token with revocation checking, derives
   the UID from that token, rereads the Firebase account, and compares it with
   the one fixed configured owner UID.
4. Explicit read-only consent completes an OAuth 2.1 authorization-code flow
   with S256 PKCE, exact `resource`, and RFC 9207 `iss` callback
   identification.
5. Access and rotating refresh tokens are opaque,
   owner/client/resource/scope-bound, expiring, one-time where applicable, and
   stored only as SHA-256 hashes under the configured owner's path.
6. Every MCP request revalidates the access token, exact resource and scope,
   and current Firebase account status before deriving `AuthContext.uid`.

The server permits only the current stable ChatGPT CIMD client identifier
`https://chatgpt.com/oauth/client.json` with the issuer-protected stable
redirect `https://chatgpt.com/connector_platform_oauth_redirect`. It advertises
only public-client token exchange (`none`) with S256 PKCE. Current official
ChatGPT metadata supports both `none` and `private_key_jwt`; the intersection
with this server is therefore only `none`. The server accepts no client secret,
dynamic registration, callback-ID client, arbitrary redirect, machine-to-
machine grant, or customer-provided API key.

If OpenAI changes the stable metadata/redirect contract, linking must remain
disabled until the new official metadata and the local allowlist are reviewed.
Current official contracts:

- [OpenAI MCP server guidance](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI MCP authentication guidance](https://developers.openai.com/plugins/build/auth)
- [OpenAI ChatGPT connection and test guidance](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [ChatGPT stable CIMD document](https://chatgpt.com/oauth/client.json)

The current OpenAI connection guide says Developer Mode availability can
depend on account/workspace policy, requires a reachable HTTPS Streamable HTTP
endpoint (normally `/mcp`) or Secure MCP Tunnel for development, and requires
the discovered tool metadata to be reviewed. Real account availability is
therefore a live human acceptance gate, not a unit-test claim.

## Runtime and exact resource diff

The isolated `mcp` codebase proposes one new second-generation Function:

| Export | Trigger | Runtime | Secrets |
| --- | --- | --- | --- |
| `lifeTrackerMcp` | Public HTTPS OAuth/MCP edge | `europe-west1`; 60 s; 512 MiB; concurrency 20; max instances 2; CORS off | None |

The public invoker is deliberate because ChatGPT must reach discovery,
authorization, token, revocation, and `/mcp` routes. Private Life Tracker data
is protected by OAuth, current Firebase owner authorization, exact resource and
scope checks, and Firestore owner paths—not by anonymous network reachability.
Anonymous traffic can still consume bounded Function resources; maximum two
instances and cloud budget/alert review are therefore part of the enable gate.

The exact non-secret parameter surface is:

- `MCP_READ_RUNTIME_ENABLED=false`
- `MCP_OWNER_UID=not-configured`
- `MCP_CANONICAL_BASE_URL=https://invalid.example`
- `MCP_FIREBASE_WEB_CONFIG={}`

The exact value `true` is the only enable state. While false, the Function
returns a non-cacheable 503 before reading the owner, Firebase Web
configuration, Firestore, or Auth. Enabling rejects the default owner, invalid
root URL, malformed Web configuration, or project mismatch. Firebase Web
configuration is public client configuration, not a service account or
provider secret, but fixed owner/account identifiers must still be kept out of
logs and chat.

The bundle contains no Secure AI HTTP endpoint/configuration, OpenAI secret,
capability secret, report endpoint/scheduler, Resend secret, reminder endpoint,
Cloud Tasks/Scheduler dependency, Twilio symbol/secret, or provider loop.
Deployment must use `firebase.mcp.json`; endpoint filtering against the
ordinary config is not an equivalent isolation boundary.

## Required public URL shape

`MCP_CANONICAL_BASE_URL` must be an exact root HTTPS origin such as
`https://private-mcp.example`, with no path, query, fragment, credentials, or
non-HTTPS scheme. The externally connected MCP URL is then:

`https://private-mcp.example/mcp`

The same exact root must serve:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`
- `/authorize`
- `/token`
- `/revoke`
- `/mcp`

For the second-generation Firebase Function, use a reviewed root service
origin—normally the exact generated Cloud Run service origin—or an approved
custom root domain. Do not use a path-bearing
`cloudfunctions.net/<function>` URL. Keep the runtime false until every public
URL resolves to the same reviewed origin and that origin exposes no unrelated
application.

## Persistence, Rules, and TTL authority

Server-only state is limited to:

- `users/{uid}/mcpOAuthPendingAuthorizations`
- `users/{uid}/mcpOAuthAuthorizationCodes`
- `users/{uid}/mcpOAuthAccessTokens`
- `users/{uid}/mcpOAuthRefreshTokens`
- `users/{uid}/mcpReadRateLimits`

Client Rules deny reads and writes to all five collection groups at both
owner-nested and root paths. The reviewed current Rules source is 19,909 bytes
with SHA-256
`2b4a86baea34655cb268d885e11edc76c843691321fd75508094338a9bc72514`.
Under the release sequence, R3 deploys those current additive Rules and R4
verifies the same hash without changing them. R6 must verify that exact hash is
already live; if it is not, stop and request a separate exact Rules approval.
Do not silently combine a Rules change with MCP deployment.

After the exact R4 metadata state of six composites and sixteen field
overrides, MCP adds only five `purgeAt` TTL overrides—one for each collection
group above. The exact final manifest is:

- authority commit: `4219f576c36ca3578f4f331690aff45fc2316c04`;
- Git blob: `b4e5fc103d144ba3dbc534a8aea744e16c1e5678`;
- SHA-256:
  `98ee5ea1069cd2b62d4e8e3cc85d95ad7c7d6216e8c169066eb11958e64bdec2`;
- 4,271 bytes; 181 lines;
- final state: six composite indexes and twenty-one field overrides, of which
  twenty are TTL policies;
- no new composite index and no deletion of a prior index/override.

Before TTL approval, count all five staging namespaces without reading token
values and verify the current index/TTL delta. TTL may permanently delete
expired server-control documents and those deletes are billable; it never
targets a Life Tracker domain collection. Any unexpected existing document or
metadata deletion aborts the change. Deploy the exact index manifest separately
from the Function and never deploy Hosting or the default codebase.

## Cost and failure controls

MCP calls no OpenAI model, Twilio, or email provider and cannot change any
provider budget. Pricing-relevant operations are HTTPS Function invocations,
Firebase Auth account checks, Firestore token/rate-limit reads and
transactions, and TTL deletes. Personal authenticated volume is bounded by one
fixed owner, 60 requests per rolling fixed minute, two maximum instances,
10-item pages, 90-day ranges, and fixed response size.

Unauthenticated traffic is rejected but can still incur Function invocations.
Before public enablement, review current Cloud Run/Functions and Firestore
pricing, configure non-secret monitoring/budget alerts under a separate account
approval, and record a manual disable threshold. Do not enable billing, raise a
budget, buy capacity, or create an automatic recharge merely to deploy MCP.
Official pricing references:

- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Firestore pricing](https://firebase.google.com/docs/firestore/pricing)

Core tracking, deterministic analytics, reminders, reports, Desktop, and
Secure AI do not depend on MCP. Invalid auth, wrong owner, revoked/disabled
Firebase account, stale/replayed token, wrong resource/scope, malformed body,
oversized range/output, unknown/write tool, or tampered rate-limit state fails
closed with bounded non-secret errors.

## Exact staged promotion gate

Do not execute any step below without a fresh exact human approval for its
named project and resource diff. R6 follows the usable Desktop and prior
backend/reminder/report staging gates; a provider-controlled WhatsApp approval
may remain separately pending, but MCP must not be bundled into a WhatsApp or
email mutation.

1. Positively identify branch `codex/life-tracker-os`, exact checkpoint
   `099c579...`, staging project `life-tracker-staging`, authenticated
   principal, billing link, existing Functions, Rules release, index/TTL state,
   enabled APIs, IAM, and rollback revision. Never rely on an implicit target.
2. Confirm staging still has no `lifeTrackerMcp`, no `mcp` codebase, and no
   generated root origin. Count the five MCP control namespaces and review the
   exact five-TTL additive diff without reading document/token values.
3. Create ignored `functions-mcp/.env.life-tracker-staging` non-secret
   configuration through a trusted local surface. Keep
   `MCP_READ_RUNTIME_ENABLED=false`; do not print the fixed UID or Web
   configuration into logs or chat.
4. Reinstall the exact lockfile, rerun typecheck/build/discovery/audit/scans,
   and deploy only the isolated codebase:

```text
node <reviewed-firebase-cli> deploy \
  --config firebase.mcp.json \
  --project life-tracker-staging \
  --only functions
```

5. Abort if discovery or the cloud delta includes anything except the one new
   `lifeTrackerMcp` Function with four non-secret parameters, public invoker,
   zero secrets, zero required APIs, and no Function deletion. Reject AI,
   reminders, reports, Rules, indexes, Hosting, provider, API, IAM, billing, or
   production changes.
6. Read back the generated second-generation service metadata, source/revision,
   limits, invoker, secret bindings, ingress, and exact root HTTPS origin.
   Confirm the default-off endpoint performs no Auth/Firestore/provider work.
7. Put the reviewed generated root origin into
   `MCP_CANONICAL_BASE_URL`, keep the switch false, redeploy only codebase
   `mcp`, and prove all six routes resolve to that same origin. This is a
   separate exact configuration diff if it was not covered by the approval.
8. Verify the current Rules hash is already live. Under a separate exact TTL
   approval, deploy only the exact `4219f57` index manifest and verify six
   composites/twenty-one overrides, five new MCP TTL policies, and zero
   deletion. Do not deploy Rules again.
9. Under a separate bounded runtime-enable approval, set only
   `MCP_READ_RUNTIME_ENABLED=true`. Verify the health receipt reports
   `writeToolCount: 0`, both discovery documents, a tokenless 401 challenge,
   invalid/malformed/range/write denials, and non-secret logs before linking an
   account.
10. In ChatGPT, Francesco performs the official interactive steps: Settings →
    Security and login → Developer mode; open ChatGPT Plugins; add the exact
    `<origin>/mcp`; review all 12 discovered read tools; complete one Firebase
    owner consent. Developer Mode availability must be observed, not assumed.
11. Ask the five acceptance questions: active Goals; actual completion
    yesterday; 30-day planned versus actual; most neglected Goal; last four
    weeks. Compare each answer/tool result with deterministic Firestore/report
    evidence and record arguments, output bounds, and errors without tokens or
    private raw document dumps.
12. Attempt missing auth, cross-user identity, malformed arguments, excessive
    range, hostile content, a write action, and tool-name injection. Current
    Pro-exposed write tool count must remain zero.

No access token, refresh token, Firebase ID token, secret value, fixed owner
identifier, or private mailbox may be displayed during deployment or
acceptance. Unit/emulator evidence is not real ChatGPT verification.

## Local and read-only evidence

| Gate | Result |
| --- | --- |
| Isolated typecheck/build/discovery | PASS; exit 0; exactly one endpoint/four params/zero secrets/zero task queues/zero schedulers/zero required APIs; 387,871-byte bundle SHA-256 `80410572...` |
| Focused MCP plus deployment surface | PASS; exit 0; 8 files / 43 tests; one emulator file / 3 tests skipped only in this non-emulator command |
| MCP Firestore transaction emulator | PASS; exit 0; 3/3 concurrent code exchange, refresh rotation, hashes-only persistence, revocation/tamper/owner/rate-limit behavior |
| Full Functions regression | PASS; exit 0; 49 files / 471 tests; 11 emulator files / 97 tests explicitly skipped outside emulator gates |
| Default strict build/discovery | PASS; exit 0; only `lifeTrackerAiApi`, eight existing AI params, two existing AI secret bindings, zero required APIs; source fingerprint `sha256:bec32f91...` |
| Isolated production dependency audit | PASS; exit 0; 0 vulnerabilities |
| Security/hygiene | PASS; static security, changed/staged credential-shape scan, config-shape assertion, `git diff --check`, staged diff check |
| Prior Rules emulator at MCP implementation | PASS at `4219f57`; 72/72; Rules were not changed by deployment isolation and were not rerun |
| Staging inventory | PASS read-only; one unchanged Goal 1 AI Function and no MCP Function at the latest inventory; no cloud state changed |
| Live endpoint and ChatGPT account | NOT RUN; runtime is not deployed/enabled and no account setting changed |

The first emulator launch lacked the already-downloaded temporary JRE on PATH
and was interrupted before emulator startup (exit 130). The final command used
the previously hash-verified Temurin JRE only from `/tmp`; it installed nothing,
started the local Firestore emulator, passed all three tests, shut down cleanly,
and exited 0.

## Failure and recovery

1. Set `MCP_READ_RUNTIME_ENABLED=false` and redeploy only codebase `mcp`; verify
   the endpoint returns the disabled response before any Firestore/Auth read.
2. Revoke the affected OAuth token through `/revoke`, or—with exact owner
   approval—remove only named server-owned OAuth control documents. Never
   delete Goals, Projects, Tasks, TimeBlocks, Sessions, Habits, or reports.
3. Disable/revoke the Firebase account session if identity compromise is
   suspected; every subsequent MCP request rechecks Firebase authority.
4. Remove the ChatGPT connection from the account UI and verify it no longer
   appears in a new conversation.
5. Roll the isolated `mcp` Function back to the recorded revision. If removal
   is required, delete only the named MCP Function under a separate destructive
   approval; never accept a deletion warning for another codebase.
6. Restore the recorded index/TTL metadata only after reviewing the exact
   delta. Removing TTL does not restore already expired control documents, but
   they contain no domain data and a new OAuth link can be created.

Current verdict for R6: locally implemented and deployment-isolated, but
**NOT DEPLOYED AND NOT REAL-CLIENT VERIFIED**.
