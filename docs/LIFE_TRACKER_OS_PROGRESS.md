# Life Tracker OS progress checkpoint

Last updated: 2026-08-24 (Europe/Rome)

## Resume identity

- Repository: `FrancescoPuglia/life-tracker`
- Working branch: `codex/life-tracker-os`
- Master starting SHA: `df99a6c2e1f06beb4fd9a6cb18e6565c5b25400b`
- Current implementation checkpoint SHA: `52ee54f03976de81fb4b8488b3e9ba599a91330e`
- Remote master branch: not created yet
- Worktree at checkpoint start: clean

## Immutable verified prerequisite

Goal 1 remains complete and is not being rebuilt.

- Final receipt SHA: `df99a6c2e1f06beb4fd9a6cb18e6565c5b25400b`
- Reviewed/deployed source: `bef7b11c3ea2881b82b72faf52ebea61f251766b`
- Staging revision: `lifetrackeraiapi-00010-les`
- Staging model: `gpt-5.6-sol`
- Verdict: `LIFE TRACKER SECURE AI STAGING VERIFIED`
- Canonical evidence: `docs/SECURE_AI_VERIFICATION_RECEIPT.md` and
  `docs/SECURE_AI_STAGING_PROGRESS.md`

The final Goal 1 evidence records all 14 required live lifecycle flows, complete
synthetic mutable-state cleanup, production isolation, 624 frontend unit tests,
174 Functions unit tests, 49 Rules tests, 2 Auth tests, 32 transaction-emulator
tests, 3 integrated browser tests, 1 static-export browser test, builds,
typechecks, and security scans. Re-run only affected Goal 1 gates when a later
slice changes one of those trust boundaries.

## Completed milestone

### Master initialization

- Confirmed `pwd`, branch, HEAD, clean status, remote, upstream, cached remote
  HEAD, and recent commits.
- Queried live GitHub refs: remote HEAD is `main` at `5ea3280`; verified staging
  is `df99a6c`; `codex/life-tracker-os` did not exist locally or remotely.
- Created `codex/life-tracker-os` directly from the clean Goal 1 receipt without
  merge, reset, force-push, or history rewrite.
- Read the repository guidance, complete Goal 1 receipt/progress record, Secure
  AI architecture/runbook, Firebase configuration, package manifests, and the
  relevant frontend/auth/static-export structure.
- Confirmed the app is a single client-side App Router surface and already has
  a proven static export. Next.js `15.5.23` is compatible in principle with the
  official Tauri 2 static-export integration (`output: 'export'`, `out` as
  `frontendDist`). A desktop-specific proof remains to be run.
- Confirmed no Tauri structure exists yet and Rust/Cargo are not installed in
  the current WSL environment. Native Windows toolchain availability remains to
  be checked without treating updater work as an R1 blocker.

### R1 desktop static-export compatibility

- Green commit: `711d00cd405d500f43261e689086c27081b0a2a0`
- Added separate, exact `staging` and `production` Desktop build profiles.
- Desktop builds bind the Firebase Web manifest and canonical project-owned
  HTTPS `lifeTrackerAiApi` endpoint at build time and reject an ambiguous or
  mismatched profile.
- The staging API-key input is public Firebase Web configuration but is still
  matched by SHA-256 and is never printed by the build script.
- Desktop artifacts attest their immutable Git SHA, runtime (`desktop`),
  environment, and exact AI backend in exported HTML.
- The release build requires a clean committed tree, clears known provider
  secret variables, runs the existing output-inclusive security scan, and
  verifies every public attestation after export.
- The existing GitHub Pages profile retains its `/life-tracker` base path and
  was not redirected or unpublished.
- Proved Next.js `15.5.23` emits a valid root Desktop static export from the
  real repository. This build-only proof compiled production public endpoints
  but made no Firebase, backend, provider, or production-data request.

### R1 least-privilege Tauri 2 shell

- Green commit: `6482346d40aeaac21a0c2851bc984eaed643c3b8`
- Added a pinned Tauri 2 shell: CLI `2.11.4`, JavaScript API `2.11.1`, Rust
  `tauri` `2.11.5`, notification plugin `2.3.3`, autostart plugin `2.5.1`, and
  single-instance plugin `2.4.3`.
- The main window receives only 11 enumerated window/notification/autostart
  commands. It receives no shell, filesystem, process, native HTTP, updater,
  raw menu/tray, or custom Rust command capability; no remote origin receives
  native IPC access.
- Added strict staging and production CSP profiles, frozen custom-protocol
  prototypes, active Tauri CSP rewriting, no global Tauri object, no asset
  protocol, no developer tools, and no updater artifacts.
- Tray/menu creation and show/focus/quit handling live in Rust. Closing hides to
  the tray; a shortcut/second launch focuses the existing instance.
- Added official native notification and user-controlled autostart plugins.
  Neither path can mark execution complete or mutate Life Tracker domain data.
- Added isolated NSIS/current-user Beta packaging metadata and a separate
  production identifier. Beta and production use visibly distinct generated
  Windows icons sourced from reviewable SVG assets.
- The existing Pages runtime and its deployment workflow were not changed.
- Identified the next required staging integration boundary: the verified AI
  Function currently allows the Goal 1 browser origins, not the installed
  Tauri origin `https://tauri.localhost`. R1 Ask AI must remain NOT VERIFIED
  until the allowlist is updated, affected CORS tests pass, the exact Function
  is redeployed to staging, and the installed Beta proves the request.

### R1 native controls and installed Windows Beta

- Green implementation commits through `52ee54f03976de81fb4b8488b3e9ba599a91330e`.
- Added a Settings surface backed by a dynamically loaded native bridge. It
  exposes explicit notification permission/test controls, user-controlled
  autostart, runtime/environment/backend status, and normalized non-secret
  failures. Merely opening Settings never requests permission.
- Notification interaction can only unminimize, show, and focus the app. It has
  no Task, TimeBlock, Session, completion, apply, or rollback mutation path.
- Added only `notification:allow-register-listener` to support that focus path;
  the exact capability allowlist remains otherwise unchanged and still denies
  shell, filesystem, process, native HTTP, updater, and custom Rust commands.
- Added the exact installed Tauri WebView origin `https://tauri.localhost` to
  the Function CORS policy with negative tests for HTTP, subdomain, and explicit
  port near-matches. The ignored staging runtime parameter now retains the two
  verified Goal 1 origins and adds exactly this Desktop origin.
- Affected Secure AI regression passed locally: 32/32 CORS, HTTP boundary, and
  runtime-attestation tests; Functions typecheck/build passed. The staging
  Function was **not deployed** because the managed approval gate requires a
  separate exact human approval for deployment. Goal 1 revision `00010-les`
  therefore remains authoritative until that approval is received.
- Added a no-key-logging resolver for the registered staging Firebase Web app.
  It captures Firebase CLI JSON in memory, validates the exact project-bound
  fields and pinned public API-key hash, clears provider-secret variables, and
  never prints the public key.
- Replaced Windows `.cmd` shim execution with direct pinned JavaScript CLI
  entry points for Tauri, npm, and Next. A bounded read-only diagnostic review
  confirmed the causal Node/Windows launcher failure and recommended the
  no-shell remediation. Cross-platform tests cover discrete arguments and
  reject ambiguous/shim inputs.
- Bound the private `@life-tracker/ai-contract` workspace package directly to
  reviewed repository source for TypeScript/Webpack so the Windows build does
  not depend on a WSL-created symlink.
- Produced a real Windows x64 NSIS installer from the clean checkpoint and
  installed it current-user. Windows registry records Life Tracker Beta
  `1.0.0` at `C:\Users\Franc\AppData\Local\Life Tracker Beta`; a normal Start
  Menu shortcut exists.
- Installed launch passed with the exact title `Life Tracker Beta - Staging`.
  Close hid the window while retaining one process; a second launch restored
  and focused that same PID; a full idle-process restart created a new healthy
  PID and visible window.
- Installed authentication, entity workflows, Ask AI, and the notification
  permission/toast interaction remain **NOT VERIFIED** pending the CORS deploy
  approval and direct installed-UI acceptance. R1 remains in progress.

## Evidence

| Check | Result |
| --- | --- |
| Initial worktree | Clean at `df99a6c` |
| Live remote HEAD | `refs/heads/main` at `5ea328066d207d695fcf689015fd610e3751f457` |
| Verified remote staging | `origin/codex/secure-ai-staging` at `df99a6c` |
| Master branch collision | None locally or remotely |
| Master branch creation | PASS; now on `codex/life-tracker-os` |
| Local Node/npm | Node `22.22.0`; npm `10.9.4` |
| Local WSL Rust/Cargo | NOT AVAILABLE |
| Desktop build-script tests | `npm run test:desktop:config`: PASS (6 test files) |
| Runtime marker tests | `npx vitest run src/lib/runtimeEnvironment.test.ts`: 2/2 PASS |
| Frontend typecheck | `npm run typecheck`: PASS |
| Desktop static export | `TAURI_DESKTOP=true ... npm run build`: PASS; 4 static pages, root route 222 kB |
| Export attestations | Exact SHA/backend/environment/runtime markers: PASS |
| Output security | `npm run check:static-security -- --include-output`: PASS |
| Patch hygiene | `git diff --check` and staged `git diff --cached --check`: PASS |
| Changed/staged secret scan | High-confidence credential patterns: no matches |
| Tauri config schema | Stable CLI validation PASS after two causal schema corrections |
| Windows Rust compile | `cargo check --manifest-path src-tauri\\Cargo.toml`: PASS from the final Rust/capability source; 493 locked packages |
| Windows Rust lint | `cargo fmt -- --check` and `cargo clippy -- -D warnings`: PASS |
| Desktop attack-surface scan | `npm run check:desktop-security`: PASS |
| Tauri dependency audit | Exact npm/Cargo pins verified; root high-severity npm audit gate PASS with the established three moderate `firebase-tools` development-only findings |
| Final icon generation | Production and badged Beta SVG sources generated all required Windows icon formats: PASS |
| Post-icon Windows native build | PASS in the later clean Tauri release build; the earlier transient WSL/Windows interop failure is superseded |
| Windows installer | PASS; x64 current-user NSIS bundle built and installed from the clean `52ee54f` checkpoint |
| Native bridge/UI tests | 20/20 PASS across bridge, Settings, sidebar, and runtime markers |
| Affected Functions boundary tests | 32/32 PASS (`cors`, HTTP handler, runtime config) |
| Functions typecheck/build | PASS after Desktop-origin policy change |
| Cross-platform build-script tests | 6 test files PASS; Tauri CLI Windows smoke reports `2.11.4` |
| Clean staging export | PASS at `52ee54f`; 4 static pages; output-inclusive security scan PASS |
| Windows Tauri release build | PASS; optimized MSVC build and one x64 NSIS bundle |
| Release executable | 6,463,488 bytes; SHA-256 `ba853bed54d195208a1ccd67f58a921b91cdb38574fea002b813c3ca27d8f634` |
| NSIS installer | 2,371,470 bytes; SHA-256 `4fe3c1f5d772b957399457623baea96c49c2f498626f11c7e4734e3148557e70` |
| Binary provider-secret scan | PASS; no high-confidence OpenAI/Twilio/Resend/private-key signatures in app or installer |
| Current-user install | PASS; registry version `1.0.0`, install location, uninstaller, and Start Menu shortcut verified |
| Installed launch/tray/single-instance/restart | PASS; visible staging title, hide-to-tray, same-PID focus, new-PID restart |
| Staging Function Desktop-origin deploy | NOT RUN — exact human deployment approval required |
| Installed auth/domain/AI/notification acceptance | NOT VERIFIED |

## Release status

- R1 Desktop Beta using verified staging: IN PROGRESS
- R2 Production Desktop: NOT STARTED
- R3 Native and cloud reminders: NOT STARTED
- R4 Daily and weekly reports: NOT STARTED
- R5 WhatsApp Sandbox and production-ready path: NOT STARTED
- R6 ChatGPT read integration: NOT STARTED
- R7 Pages removal and repository privacy conversion: NOT STARTED

## External blockers

The R1 installer is built and installed. The remaining explicit human gate is
approval to deploy only `lifeTrackerAiApi` to the positively identified
`life-tracker-staging` project with the reviewed Desktop-origin allowlist. The
managed gate rejected the first attempt before execution; no staging resource
changed. Installed UI authentication/notification acceptance will then require
Francesco to interact with the visible Beta. No production resource, provider
credential, billing setting, GitHub visibility, or public Pages state changed.

## Exact next step

After exact human approval, deploy only `functions:lifeTrackerAiApi` to explicit
project `life-tracker-staging`, verify health/runtime attestation and exact CORS
allow/deny behavior, then complete installed authentication, core-domain, Ask
AI Preview/Apply/Undo, notification, autostart, offline/backend-unavailable, and
expired-auth acceptance. Then begin the required read-only production audit and
recovery classification without making any production change.
