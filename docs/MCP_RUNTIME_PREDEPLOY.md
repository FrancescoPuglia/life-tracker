# Private ChatGPT read integration: pre-deploy and recovery runbook

Status: local implementation and emulator verification only. The MCP Function,
OAuth server, Rules additions, TTL policies, and runtime parameters have **not**
been deployed to staging or production. No ChatGPT account has been connected.

## Release boundary

`lifeTrackerMcp` is a private-personal, read-only Streamable HTTP MCP service.
It reuses the existing Firebase-authenticated domain/read/report repositories;
it is not another Firestore or mutation path. The current surface has exactly
12 tools:

- `get_life_tracker_state`
- `get_goals`
- `get_projects`
- `get_tasks`
- `get_timeblocks`
- `get_sessions`
- `get_habits`
- `get_kpis`
- `planned_vs_actual`
- `analyze_period`
- `goal_alignment`
- `get_reports`

There are zero write tools. Notes are omitted, arbitrary Firestore paths and
free-text queries are absent, list pages are limited to 10 items, explicit date
ranges are limited to 90 days, state collections are limited to 10 items, and a
tool response is limited to 192,000 UTF-8 bytes. Apply, preview, rollback,
delete, capability issuance, and schedule replacement remain available only
through Life Tracker's existing verified application boundary.

## Identity and OAuth authority

Firebase Authentication remains the sole user identity authority:

1. ChatGPT discovers protected-resource and authorization-server metadata.
2. The user signs in on the Life Tracker consent page through the Firebase Web
   SDK. A password, if used, is sent directly to Firebase and never to the MCP
   backend.
3. The backend verifies the Firebase ID token with revocation checking, derives
   its UID from that token, rechecks the Firebase account, and compares it with
   the one configured private owner UID.
4. Explicit read-only consent completes an OAuth 2.1 authorization-code flow
   with S256 PKCE and RFC 9207 `iss` callback identification.
5. Access and rotating refresh tokens are opaque, owner/client/resource/scope
   bound, expiring, one-time where applicable, and stored only as SHA-256
   hashes under the configured owner's path.
6. Every MCP request revalidates the access token, exact resource and scope,
   and current Firebase account status before deriving `AuthContext.uid`.

The server pins the current stable ChatGPT CIMD client identifier
`https://chatgpt.com/oauth/client.json` and stable issuer-protected redirect.
Callback-ID-specific and arbitrary clients fail closed. If OpenAI changes that
official document or redirect contract, linking must remain disabled until the
new metadata is reviewed and the allowlist is deliberately updated.

Official contracts used for this implementation:

- [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI ChatGPT connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [ChatGPT stable CIMD document](https://chatgpt.com/oauth/client.json)

## Required public URL shape

`MCP_CANONICAL_BASE_URL` must be an exact root HTTPS origin, for example
`https://private-mcp.example` with no path, query, fragment, credentials, or
non-HTTPS scheme. The externally connected MCP URL is then:

`https://private-mcp.example/mcp`

This root-origin requirement keeps discovery standards-compatible:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`
- `/authorize`
- `/token`
- `/revoke`
- `/mcp`

For a Firebase second-generation Function, use a reviewed root service origin
(for example the exact generated Cloud Run service origin or an approved custom
root domain), not a path-bearing `cloudfunctions.net/<function>` URL. Do not
enable the runtime until all public URLs resolve to this same exact origin.

## Runtime and persistence inventory

The Function is intentionally a public HTTPS invoker because ChatGPT must reach
OAuth discovery and `/mcp`; private data is protected by OAuth and Firebase
owner authorization, not by anonymous network reachability.

- region: `europe-west1`
- timeout: 60 seconds
- memory: 512 MiB
- concurrency: 20
- maximum instances: 2
- CORS: disabled; browser consent POSTs require the exact same Origin and a
  `__Host-` HttpOnly/Secure/SameSite CSRF cookie
- authenticated MCP request budget: 60 per owner per rolling fixed minute
- OpenAI/Twilio/Resend secrets: none bound

Default-off non-secret parameters:

- `MCP_READ_RUNTIME_ENABLED=false`
- `MCP_OWNER_UID=not-configured`
- `MCP_CANONICAL_BASE_URL=https://invalid.example`
- `MCP_FIREBASE_WEB_CONFIG={}`

The Firebase web configuration is public client configuration, but it is
strictly parsed and must match the deployed Firebase project. It must never be
confused with a service account or provider credential.

Server-only Firestore collections:

- `users/{uid}/mcpOAuthPendingAuthorizations`
- `users/{uid}/mcpOAuthAuthorizationCodes`
- `users/{uid}/mcpOAuthAccessTokens`
- `users/{uid}/mcpOAuthRefreshTokens`
- `users/{uid}/mcpReadRateLimits`

Client Rules deny every read and write to those namespaces at both owner-nested
and root paths. `purgeAt` has a TTL policy for all five collection groups.

## Cost controls

The MCP path calls no LLM and cannot change the OpenAI budget. Pricing-relevant
operations are Function invocations, Firebase Auth account checks, Firestore
token/rate-limit reads and transactions, and TTL deletion. Personal volume is
bounded by one configured owner, 60 authenticated requests per minute, two
maximum instances, 10-item pages, 90-day ranges, and fixed output size. OAuth
and provider retries are not unbounded. Configure cloud budget alerts before
enabling a public endpoint; do not enable billing or raise any budget merely to
deploy this slice.

## Exact staged promotion gate

Do not execute these steps without a fresh exact human approval for the named
project and resource diff:

1. Positively identify the staging Firebase/GCP project and current branch SHA.
2. Review the Functions diff, Rules diff, five TTL field overrides, enabled APIs,
   billing status, root service URL plan, and rollback target.
3. Deploy the Function in its default-off state first. Do not reuse a production
   project or rely on an implicit Firebase target.
4. Read back the generated second-generation service metadata and select its
   exact root HTTPS origin. Verify that the origin does not expose another app.
5. Enter the owner UID and public Firebase Web configuration through an approved
   local/provider configuration surface. Do not paste account identifiers or
   credentials into chat. Keep the switch false.
6. Deploy Rules and TTL/index configuration only after their exact diff is
   approved. No real user document migration or deletion is part of this slice.
7. Rebuild/redeploy with the canonical origin and only then explicitly enable
   `MCP_READ_RUNTIME_ENABLED=true`.
8. Verify health (`writeToolCount: 0`), both discovery documents, a 401 OAuth
   challenge without a token, malformed/range/write denials, and non-secret logs.
9. In ChatGPT Developer Mode, add the exact `<origin>/mcp` URL and complete one
   Firebase-owner consent. This is a separate interactive human action.
10. Compare real ChatGPT answers for Goals, yesterday's actual execution,
    30-day planned-versus-actual, neglected Goal, and four-week analysis with
    deterministic Life Tracker/report evidence.

Do not display access tokens, refresh tokens, Firebase ID tokens, or secret
values during acceptance. A unit or emulator pass is not real ChatGPT
verification.

## Failure and recovery

Core tracking, deterministic analytics, reminders, reports, Desktop, and the
verified Secure AI application do not depend on MCP. If OpenAI/ChatGPT is
unavailable, quota-limited, or disconnected, those paths continue to work.

Recovery order:

1. Set `MCP_READ_RUNTIME_ENABLED=false` and redeploy the exact Function revision.
2. Revoke the affected OAuth token through `/revoke`, or—with explicit owner
   approval—remove only the named server-owned OAuth control documents. Never
   delete Life Tracker domain data.
3. Disable/revoke the Firebase account session if identity compromise is
   suspected; every subsequent MCP request rechecks that authority.
4. Roll the Function, Rules, and index/TTL configuration back to the recorded
   pre-deploy SHA/configuration. TTL removal does not restore already expired
   control records, but those records contain no domain data and a new OAuth link
   can be created.
5. Remove the ChatGPT connection from the account UI and verify `/mcp` returns
   the disabled response before considering recovery complete.

## Current verification status

Locally verified: strict types, OAuth/PKCE/replay unit tests, full in-process
consent-to-MCP HTTP flow, hostile Note containment, attempted write/tool-name
injection, bounded ranges/output, Firebase revocation behavior, real Firestore
transaction concurrency, hashes-only persistence, rate-limit tamper handling,
and full client Rules denial.

Not run: staging deployment, live endpoint discovery, real Firebase owner login,
ChatGPT Developer Mode connection, or real ChatGPT comparison. Therefore R6 is
implemented locally but **not deployed and not real-client verified**.
