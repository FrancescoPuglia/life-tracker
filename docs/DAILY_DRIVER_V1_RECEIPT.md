# Daily Driver v1 release receipt

Date: 2026-08-26 (Europe/Rome)

This receipt tracks the bounded Daily Driver release sprint. It does not
authorize resources beyond the explicit staging Function approval or any
production mutation without a separate human gate.

## Release identity

- Release branch: `codex/daily-driver-v1`
- Starting SHA: `9f90dbc885cf1b5b70eb436b502e7a1a0026c375`
- Final SHA: pending final receipt commit
- Remote HEAD at production recovery checkpoint:
  `a5a2bfd7dce60a50c06c20621f8411b2a600e891`
- Worktree: clean at sprint start and before this receipt update; final state
  pending

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
    billing, budget, reminder, report, MCP, Tasks, or Scheduler mutation occurred.
- Billing gate: Blaze/pay-as-you-go is independently VERIFIED from read-only
  metadata; a billing account is linked. No billing or budget setting was
  changed. The Budget API returned an HTTP 500 metadata error, so the reported
  EUR 5 alert is `NOT VERIFIED` by this sprint and will not be retried or
  modified.
- Production Desktop source SHA:
  `a5a2bfd7dce60a50c06c20621f8411b2a600e891`.
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
- Production Secure AI preparation: exact backend source build PASS; expected
  backend fingerprint
  `sha256:8bec8a4cea3b148f56f9fdd3b6643edcd1f64ac0dd05eb3f9f35c0eb9b342a06`;
  expected one-origin Sol/medium runtime fingerprint
  `sha256:90f81b28a952c81d870db3315f55f38dbac8ade9c25c92b150d4fc8f382a5025`.
  `AI_CAPABILITY_SIGNING_SECRET` version 1 is enabled;
  `OPENAI_API_KEY` is absent and requires secure human input. Function deploy:
  NOT RUN.
- Production installer:
  `src-tauri/target/release/bundle/nsis/Life Tracker_1.0.0_x64-setup.exe`;
  SHA-256
  `637c34abbe04e1aaf3396ea03e0ce805429b913b51e00ac27c76a3f852cff16e`.
- Built production executable: 6,485,504 bytes; SHA-256
  `e753bf1253af8338dc1e2ee3d374be2993ec4ee6c1631f59c0efe6271149d59d`.
  Installed NSIS-patched executable SHA-256:
  `a7b14533fd7344c81e1fe661ca80297b3981ebf4a859a1614d35fb8d1c6949f4`.
- Production artifact scan: PASS; no provider credential, private-key,
  staging-project, secret-variable, or Pages runtime signature. The one broad
  `re_` executable shape has the same digest as the previously traced pinned
  `tauri_runtime_wry` token; the installer contains none.
- Installed launch: PASS from the normal current-user installation; production
  login form reached at `https://tauri.localhost`, no ErrorBoundary. Francesco
  login and real-data visibility remain NOT RUN pending human availability.
- Forward-durability acceptance: NOT RUN
- Weekly Planner acceptance: NOT RUN
- Session acceptance: NOT RUN
- Analytics acceptance: NOT RUN
- Secure AI and Preview/Apply/Undo acceptance: NOT RUN
- Restart/re-auth evidence: NOT RUN
- Notification/tray/autostart: NOT RUN
- MCP: NOT ATTEMPTED
- Current human blocker: securely set `OPENAI_API_KEY` in production Secret
  Manager using Firebase CLI. No secret value may enter chat, logs, files, or
  command arguments.

## Deferred work

WhatsApp, Twilio, reports/email, routing refinements, MCP redesign, privacy,
Pages retirement, updater, and all P2/P3 work remain outside this sprint.

`LIFE TRACKER DAILY DRIVER NOT READY`
