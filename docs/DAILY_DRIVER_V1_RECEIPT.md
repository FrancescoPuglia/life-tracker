# Daily Driver v1 release receipt

Date: 2026-08-26 (Europe/Rome)

This receipt tracks the bounded Daily Driver release sprint. It does not
authorize resources beyond the explicit staging Function approval or any
production mutation without a separate human gate.

## Release identity

- Release branch: `codex/daily-driver-v1`
- Starting SHA: `9f90dbc885cf1b5b70eb436b502e7a1a0026c375`
- Final release implementation SHA:
  `c9f835eba7586167f5b6b22c3fbe4a7198bb8dbf`
- Remote HEAD immediately before this final acceptance-only receipt update:
  `917f55a413cff45a2f6ec9b57722bce0e56badb2`
- Worktree: clean at sprint start, at the pushed OAuth interoperability source
  checkpoint, and immediately before this final acceptance-only receipt update

## Staging deployment

- Explicit project: `life-tracker-staging` (`675076431391`)
- Failed-deploy baseline: Cloud Run generation 10, revision
  `lifetrackeraiapi-00010-les`; no new revision had been created.
- Demonstrated prerequisite: Pub/Sub API was enabled, while the official
  `service-675076431391@gcp-sa-pubsub.iam.gserviceaccount.com` identity returned
  `404 NOT_FOUND`. The authenticated account held `roles/owner` and passed the
  relevant Service Usage permission checks.
- Causal remediation: generated only the official Pub/Sub service identity by
  the Service Usage `generateServiceIdentity` mechanism. No broad IAM role was
  manually granted.
- Deployment: PASS; exact detached source
  `3100c42bfda50bb4627b7345270985a517439167`, explicit
  `--project life-tracker-staging`, exact
  `--only functions:lifeTrackerAiApi`.
- Active result: exactly one Function; Node 22; Cloud Run generation 11,
  revision `lifetrackeraiapi-00011-kec`, ready with 100% traffic.
- Firebase source generation: `1787684974250979`; source hash
  `602d71a7e9b13b5d68b166a7efec160995586f93`.
- Backend fingerprint:
  `sha256:8bec8a4cea3b148f56f9fdd3b6643edcd1f64ac0dd05eb3f9f35c0eb9b342a06`.
- Runtime fingerprint:
  `sha256:6ef03a915ff73a9d688bd416fd13a622b9effc9c5573963d39eb85d563e50a7f`.
- Fixed public verifier: PASS, 16/16 requests; three exact allowed origins and
  five denied origins, including Desktop near-match denials; Sol/medium and
  prompt/schema authority unchanged.
- Secret bindings remained metadata-only and unchanged: `OPENAI_API_KEY`
  version 2 and `AI_CAPABILITY_SIGNING_SECRET` version 1.
- Rollback: targeted redeploy of exact `bef7b11c3ea2881b82b72faf52ebea61f251766b`
  with the original two-origin policy, then verify revision/fingerprints and
  Desktop-origin denial as documented in `docs/R1_STAGING_DEPLOY_PRECHECK.md`.

Milestone: `R1 STAGING FUNCTION DEPLOY VERIFIED`

## Installed staging safety gate

- Source: `be35501d4b9c1df40714aaa51fb0fb2ea9d0414d`, current Daily Driver
  branch, staging environment, Desktop runtime.
- Demonstrated installed-startup blocker: Tauri's non-default prototype freeze
  made Firebase/Long initialization throw before React mount. The minimal fix
  restored Firebase-compatible startup while retaining the restrictive CSP,
  disabled asset protocol, and all other Desktop hardening checks.
- Focused adjacent gates: Desktop profile tests PASS; Desktop security PASS;
  static/output security PASS; `git diff --check` PASS.
- Installer:
  `src-tauri/target/release/bundle/nsis/Life Tracker Beta_1.0.0_x64-setup.exe`
  (SHA-256
  `6bd9f7ce7123e6e9702cb34a139cb4c1807f2bd08d4b29649f09476e4c7332e5`).
- Built executable SHA-256:
  `816bffe602b231ba1998a7946197b3b60dfbd5ed50fd7f5c8935b2627d76cc61`.
  Installed NSIS-patched executable SHA-256:
  `c268660fdd4dfd5294557d51a65be25a0273a57f38a3d40d1e07a38ac64f2faa`.
- Binary/provider-secret scan: PASS. No OpenAI/Twilio/private-key/provider
  secret names or Pages runtime shapes were present; the sole broad `re_`
  signature was the pinned `tauri_runtime_wry` dependency name.
- Launch and Firebase Auth: PASS with a disposable staging-only account; no
  ErrorBoundary.
- Durable disposable Goal: authoritative owner-scoped Firestore read PASS;
  reload PASS; full Desktop process restart and reread PASS.
- Planner: PASS.
- Session start/pause/resume/stop: PASS; authoritative reread found one
  completed, owner-matched Session with measured nonzero duration (40 seconds),
  preserved after Desktop restart.
- Secure AI from `https://tauri.localhost`: authenticated POST 200; grounded
  read returned the exact authoritative disposable Goal title.
- Preview/Reject: PASS with zero matching authoritative Domain after Reject.
  Fresh Preview/Apply created the exact owner-scoped Domain and exact requested
  fields; Undo removed it on authoritative reread.
- Tray/single-instance: closing the window retained the same process; launching
  the installed executable restored the same singleton. Controlled restart
  created a new process and preserved Auth/data.
- Cleanup: both disposable Firestore documents and the AI-created Domain were
  absent after cleanup; the one exact disposable Firebase Auth account was
  deleted through the staging project admin API. Immutable backend audit data
  was not altered.

Milestone: `LIFE TRACKER STAGING DESKTOP RELEASE GATE PASSED`

## Production Daily Driver

- Production project: `life-tracker-12000` (`970402762590`)
- Production resources changed, all explicitly scoped to
  `life-tracker-12000`:
  - enabled only Cloud Functions, Cloud Run, Artifact Registry, Cloud Build,
    Eventarc, and Secret Manager APIs;
  - generated only the official Pub/Sub and Eventarc Google-managed service
    identities; no broad IAM role was granted;
  - created `AI_CAPABILITY_SIGNING_SECRET` version 1 directly from fresh
    randomness without displaying or writing its value;
  - deployed Firestore Rules only. No index, TTL, Function, historical data,
    billing, budget, reminder, report, MCP, Tasks, or Scheduler mutation occurred
    at that checkpoint;
  - created only `lifeTrackerAiApi` in `europe-west1`, with exact secret-accessor
    grants on the two named secrets. Firebase CLI also enabled its required
    Extensions metadata API; no Extension was installed;
  - applied the Firebase default one-day cleanup policy only to the new
    `europe-west1/gcf-artifacts` repository to prevent image-storage buildup.
- Billing gate: Blaze/pay-as-you-go is independently VERIFIED from read-only
  metadata; a billing account is linked. No billing or budget setting was
  changed. The Budget API returned an HTTP 500 metadata error, so the reported
  EUR 5 alert is `NOT VERIFIED` by this sprint and will not be retried or
  modified.
- Production Desktop source SHA:
  `158b5aff601d9e506c7c1bbed5e6c6b130fad4e7`.
- Planned backend source: exact staging-verified detached source
  `3100c42bfda50bb4627b7345270985a517439167`, not the unrelated reminder,
  report, or MCP exports added later.
- Existing production Function state after required API enablement: zero Gen1
  Functions, zero Gen2 Functions, and zero Function-managed Cloud Run services;
  canonical `lifeTrackerAiApi` endpoint HTTP 404.
- Predeployment Rules release:
  `projects/life-tracker-12000/rulesets/491f1929-e5fe-4686-8ec2-e0974a13e132`;
  one-file source SHA-256
  `7f95ba84efa0537537dd4d92e8ee30f5408ab2c83bc71d4f36508fd0e5a297bd`.
- Existing index/TTL state: none, reusing the 2026-08-24 production audit.
- Required production index delta: exactly one collection-scoped composite
  index for `timeBlocks(startTime ASC, endTime ASC)`, deployed with an
  index-only temporary Firebase config and explicit
  `--project life-tracker-12000 --only firestore:indexes`. It is `READY`.
  No field override or Rules release was included in that deployment.
- Active production Rules:
  `projects/life-tracker-12000/rulesets/523e6510-07a0-447c-9ea1-cd07bbedaecf`;
  exact source SHA-256
  `2b4a86baea34655cb268d885e11edc76c843691321fd75508094338a9bc72514`.
  The prior rollback ruleset remains listed and immutable.
- Minimum recovery path: this release performs no migration or historical-data
  write. Rules rollback re-points `cloud.firestore` to the immutable prior
  ruleset above. Function rollback deletes only the newly introduced
  `lifeTrackerAiApi` in `europe-west1` after positively identifying the project;
  secrets are retained rather than destructively purged. Acceptance writes use
  isolated disposable records and Undo/cleanup. A paid Firestore backup is not
  enabled for this non-destructive metadata/function delta.
- Production Secure AI preparation: the release-boundary source remained the
  exact reviewed detached source `3100c42`, plus only the backward-compatible
  in-memory decoder for historical browser timestamp-map representations.
  No production document was migrated or rewritten. Focused decoder tests
  PASS 9/9; detached Functions typecheck and build PASS. Final backend
  fingerprint:
  `sha256:400b8f4c7d8ca23b3a31aeb596d50c9d69ea5c30d778d541d8e17c6f782ad085`;
  expected one-origin Sol/medium runtime fingerprint
  `sha256:90f81b28a952c81d870db3315f55f38dbac8ade9c25c92b150d4fc8f382a5025`.
  `AI_CAPABILITY_SIGNING_SECRET` version 1 and human-supplied `OPENAI_API_KEY`
  version 1 are enabled. Neither value was accessed or displayed.
- Production Secure AI deployment: PASS from exact detached source
  `3100c42bfda50bb4627b7345270985a517439167`; explicit
  `--project life-tracker-12000`; exact
  `--only functions:lifeTrackerAiApi`. The Function create succeeded; the CLI
  then exited 1 solely because its first-deploy cleanup policy was absent. The
  causal `functions:artifacts:setpolicy` remediation exited 0 without a second
  Function deployment.
- Final live backend: exactly zero Gen1 and one active Gen2 Function; Node 22,
  512 MiB, 60-second timeout, max 20 instances, concurrency 40; source
  generation `1787752479816343`; Firebase source hash
  `13cf5908dbc22eb4493de3234b326eb804a2119f`. A temporary safe stage-only
  diagnostic revision used to isolate index readiness was replaced after
  acceptance by the minimal release source above. Provider-free health returns
  the exact final source fingerprint and unchanged runtime fingerprint; the
  exact Tauri origin returns 200 and a subdomain near-match returns 403. Both
  secret bindings remain metadata-only at exact version 1; no secret value was
  accessed, printed, copied, or rotated.
- Provider-free production verifier: PASS, 12/12 requests. Exact
  `https://tauri.localhost` health/preflight succeeded; HTTP, subdomain,
  explicit-port, Pages, and attacker near-matches were denied. Live source and
  runtime fingerprints exactly match the expected values above; Sol/medium and
  prompt/schema authority are unchanged.
- Production installer:
  `src-tauri/target/release/bundle/nsis/Life Tracker_1.0.0_x64-setup.exe`;
  SHA-256
  `fc720eaf75312839a1a5cafd8c00e1370ff59986db80cf11636f25ba8766a0c2`.
- Built production executable: 6,485,504 bytes; SHA-256
  `d0a307ebd761ef4c4c4d7066ecbf5e2bb375dec4d27670b30b0f34d8bed19df3`.
  Installed NSIS-patched executable SHA-256:
  `04aa91037e0857dcf520c3733501d909bde016aed1c9d711ac2a4eaafc48f461`.
- Production artifact scan: PASS; no provider credential, private-key,
  staging-project, secret-variable, or Pages runtime signature. The one broad
  `re_` executable shape has the same digest as the previously traced pinned
  `tauri_runtime_wry` token; the installer contains none.
- Installed launch: PASS from the normal current-user installation at
  `https://tauri.localhost`; no ErrorBoundary. Production Auth metadata is
  valid and unexpired, its audience is exactly `life-tracker-12000`, the UID
  matches the persisted Desktop session, production Firestore traffic is
  present, and staging traffic is absent. Francesco's compatible historical
  production state is visible.
- Fresh-login bootstrap blocker: FIXED in `158b5af`. The unauthenticated path
  initialized IndexedDB before switching to Firebase and depended on the
  mutable adapter type, permitting overlapping bootstrap attempts; persisted
  Auth after F5 took the direct Firebase path. DataProvider now switches
  directly to the owner-bound Firebase adapter, runs once per UID/explicit
  retry, rejects Firestore read failures instead of silently substituting
  empty/local state, and resolves within 20 seconds to either ready or an
  actionable retry screen. Focused DataProvider tests PASS (9/9), including a
  non-resolving local-adapter regression and retry without reload; canonical
  typecheck, static security, Desktop export/output security, and Desktop
  security PASS.
- Fresh sign-out/sign-in acceptance: PASS in the newly installed build. The
  real production dashboard appeared directly with no F5, Ctrl+R, or process
  restart; boolean-only runtime confirmation recorded fresh sign-in after app
  launch, production audience/UID match, `uiReady=true`, and no loader/retry.
- Forward-durability acceptance: PASS for UI creation of one
  uniquely prefixed disposable Goal, Project, Task, and TimeBlock; owner-scoped
  authoritative Firestore rereads found every record with the correct UID and
  exact Goal -> Project -> Task -> TimeBlock parent links and timestamps. UI
  reload reconstructed the hierarchy. Renaming the disposable Goal produced
  the exact authoritative reread. A controlled full Desktop process restart
  then reread the singular Goal, Project, Task, and TimeBlock from authoritative
  Firestore with the same owner and exact hierarchy; the updated hierarchy
  rendered again in the installed UI. Final sign-out/sign-in then loaded the
  production dashboard without refresh; a runtime reread confirmed the exact
  hierarchy and completed Session were still authoritative before cleanup.
  An intentionally failing two-write owner-scoped commit left zero partial
  state. Cleanup then atomically deleted only the exact disposable Goal,
  Project, Task, TimeBlock, Domain, and uniquely release-window-bounded
  five-second Session; authoritative rereads verified all six absent.
- Weekly Planner acceptance: PASS for installed Planner, Weekly Planning draft
  view, Weekly Execution, and Goal Architect loading against production state.
- Session acceptance: PASS. The precondition found zero existing open personal
  Sessions; one new owner-scoped Session completed start -> pause -> resume ->
  stop, resume reused the exact same document, authoritative Firestore recorded
  5 seconds of active duration, and no open Session remained. The exact
  completed owner Session, start/end interval, status, and duration survived
  the controlled Desktop process restart.
- Today / Analytics acceptance: PASS. Today Command Center, session-authoritative
  Performance, and Analytics loaded after the completed Session.
- Secure AI and Preview/Apply/Undo acceptance: PASS after Francesco's explicit
  production acceptance approval. Authenticated grounded read returned the
  exact disposable Goal and Task with real-provider/tool-call evidence.
  Preview produced exactly one immutable operation and one diff for the exact
  disposable TimeBlock with zero conflicts. Reject left authoritative state
  byte/semantically unchanged. A fresh plan had a distinct ID; Apply returned
  `verified=true`, and an owner-scoped authoritative reread found exactly the
  requested interval. Undo returned `verified=true` and an authoritative
  reread matched the complete original semantic record. Historical personal
  records were untouched.
- Restart/re-auth evidence: fresh re-auth PASS before fixture creation; full
  process restart and post-restart authoritative fixture/Session reread PASS.
  Final post-fixture sign-out/sign-in PASS by Francesco; the real dashboard
  appeared directly without F5/Ctrl+R/restart. Production Auth audience and
  owner identity, UI readiness, hierarchy durability, and completed Session
  durability were independently reread before cleanup. After cleanup the
  installed UI remained ready with no loader, retry screen, or ErrorBoundary.
- Tray/single-instance: PASS in the installed production app; closing the
  window retained the exact process and launching the Start Menu executable
  restored the singleton. Autostart and native notification: NOT RUN.
- MCP deployment: PASS to explicit production project `life-tracker-12000`.
  The deployed authority is isolated checkpoint `099c579` plus only the
  already-tested legacy timestamp-map compatibility decoder; the shared MCP,
  package, and config sources otherwise have zero diff from that checkpoint.
  Firebase discovery found exactly one endpoint (`lifeTrackerMcp`), four
  non-secret parameters, zero secret bindings, zero task queues, zero
  schedulers, zero custom roles, and zero required APIs. Final isolated bundle:
  388,790 bytes; SHA-256
  `277b4bfe5151743920177a39d87578d71e5de788b55dfcaf4e683acf28b757fb`.
- MCP real-ChatGPT interoperability deployment: PASS from pushed release
  commit `c9f835e`. The isolated discovery surface remained exactly one
  endpoint (`lifeTrackerMcp`), four non-secret parameters, zero secret
  bindings, zero task queues, and zero schedulers. Final isolated bundle:
  389,058 bytes; SHA-256
  `8da44253685fd1e3d5fe521640708708892321a2947be101f9b86c0939ad9136`.
  The first deploy command used an incompatible function-name selector and
  Firebase aborted before cloud mutation. The single causal retry used the
  isolated `firebase.mcp.json` surface with explicit project
  `life-tracker-12000`; only `mcp:lifeTrackerMcp(europe-west1)` was updated.
- MCP live Function: codebase `mcp`; Node 22; `europe-west1`; 512 MiB;
  60-second timeout; concurrency 20; max instances 2; current source
  generation `1787763373778169`; Cloud Run revision
  `lifetrackermcp-00005-vih` is both latest-created and latest-ready with 100%
  traffic; canonical root
  `https://lifetrackermcp-7tbny53slq-ew.a.run.app` and connection endpoint
  `https://lifetrackermcp-7tbny53slq-ew.a.run.app/mcp`. It is bound to the
  exact production owner and sole active production Firebase Web app, with the
  read kill switch enabled. Owner UID and Web configuration values were never
  printed; there is no MCP secret binding.
- MCP promotion safety: first deployed default-off and proved HTTP 503 before
  Auth/Firestore initialization; then bound the generated root while still
  off. The first enabled health call failed closed because Firebase CLI's Web
  config included fields outside the reviewed four-field allowlist. The one
  causal retry retained only `apiKey`, `authDomain`, `projectId`, and `appId`;
  final health is 200. No tool or identity scope changed.
- MCP persistence metadata: the existing `timeBlocks(startTime ASC,
  endTime ASC)` composite remains the sole composite. Exactly five `purgeAt`
  TTL overrides are live for pending authorizations, authorization codes,
  access tokens, refresh tokens, and MCP read-rate controls. No Rules release,
  domain collection TTL, index deletion, or historical-data mutation was
  included.
- MCP public acceptance: PASS. Health advertises exactly 12 read tools and 0
  write tools; protected-resource and authorization-server discovery bind the
  exact root/resource and sole `life_tracker.read` scope; public-client token
  exchange is S256 PKCE only. Tokenless MCP returned 401 with a discoverable
  challenge; an unknown OAuth client, write scope, and unknown route all
  failed closed. ChatGPT's current public client metadata still contains the
  reviewed stable redirect, public-client method, and authorization-code
  contract. The official connection procedure is documented by
  [OpenAI's ChatGPT plugin connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).
- MCP real-client OAuth diagnosis: PASS, with sanitized Cloud Run evidence.
  The failed ChatGPT attempt reached tokenless `/mcp` (401), protected-resource
  metadata (200), OAuth authorization-server metadata (200), and then
  `/authorize`. ChatGPT used the reviewed stable CIMD client, stable redirect,
  exact production `/mcp` resource, sole read scope, valid state, and S256
  PKCE. The only additional parameter was the standard `ui_locales` display
  hint. The strict authorization schema rejected that harmless optional hint
  and returned an OAuth error redirect before the Firebase page rendered.
  The observed OpenID discovery fallback returned 404 but was non-causal
  because OAuth metadata discovery had already succeeded and ChatGPT continued
  to `/authorize`.
- MCP OAuth interoperability fix: PASS. The authorization boundary now accepts
  only a bounded, language-tag-shaped `ui_locales` value and deliberately
  ignores it for identity and authorization. Every unrecognized parameter and
  malformed locale still fails closed. Focused verification passed:
  `http-app.test.ts` + `oauth-service.test.ts` (13/13), the final HTTP
  regression (7/7), strict Functions typecheck, isolated MCP build/discovery,
  static security, changed/generated high-confidence credential scan, and
  diff hygiene. No owner scope, token policy, tool, Rules, index, secret, or
  Life Tracker domain-data behavior changed. Current OAuth requirements were
  checked against
  [OpenAI's plugin authentication guide](https://developers.openai.com/plugins/build/auth).
- MCP post-deploy OAuth smoke: PASS. Health, protected-resource metadata,
  authorization-server metadata, CIMD, S256 PKCE advertisement, and the
  tokenless 401 discovery challenge were live. A credential-free synthetic
  request with `ui_locales=it-IT` rendered the Firebase authorization page with
  HTTP 200 and was immediately closed through the deny/CSRF path. No access or
  refresh token was issued and no Life Tracker record was read or written.
- MCP live owner/OAuth acceptance: PASS. After an initial Windows/WSL interop
  failure that occurred before the verifier started and created no token or
  request, the bridge recovered. A fresh live flow used Francesco's current
  installed-app Firebase identity entirely in process memory, completed exact
  ChatGPT-client authorization-code consent with S256 PKCE, exchanged opaque
  tokens, initialized Streamable HTTP, and listed exactly the 12 reviewed
  tools with read-only/non-destructive/closed-world/idempotent annotations.
  `get_goals` returned verified-owner production data without Notes or raw
  paths; `apply_plan` and an excessive analysis range failed closed. Both
  temporary access and refresh tokens were revoked, and the revoked access
  token returned 401. No UID, token, or personal record content was printed.
- MCP ChatGPT-client acceptance: PASS. Francesco reported that the existing
  Life Tracker developer-mode plugin connected successfully after the fix and
  then read his production goals clearly. Sanitized Cloud Run evidence
  independently correlated the same real-client flow: localized `/authorize`
  returned 200; Firebase `/authorize/complete` returned 200; `/token` returned
  200; and subsequent OpenAI-host `/mcp` requests returned successful 200/202
  responses. The live server exposes the reviewed exact 12 read-only tools and
  zero writes; the successful goal answer exercises the owner-scoped
  `get_goals` path against the same `life-tracker-12000` data used by Desktop.
  No token, UID, personal goal content, or credential was printed or added to
  this receipt.
- MCP rollback: set only `MCP_READ_RUNTIME_ENABLED=false` in the ignored local
  production runtime config and redeploy with `firebase.mcp.json`, explicit
  `--project life-tracker-12000 --only functions`; verify 503 before any owner
  read. Revoke/remove the ChatGPT connection separately. TTL policies target
  only expiring MCP control records and never Life Tracker domain data.
- Human blocker: none. The real ChatGPT OAuth connection and bounded production
  goal read are accepted.

## Deferred work

WhatsApp, Twilio, reports/email, routing refinements, MCP redesign, privacy,
Pages retirement, updater, and all P2/P3 work remain outside this sprint.

`LIFE TRACKER PERSONAL V1 READY — DESKTOP + CHATGPT MCP`
