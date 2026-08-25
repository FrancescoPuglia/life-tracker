# Daily Driver v1 release receipt

Date: 2026-08-25 (Europe/Rome)

This receipt tracks the bounded Daily Driver release sprint. It does not
authorize resources beyond the explicit staging Function approval or any
production mutation without a separate human gate.

## Release identity

- Release branch: `codex/daily-driver-v1`
- Starting SHA: `9f90dbc885cf1b5b70eb436b502e7a1a0026c375`
- Final SHA: pending final receipt commit
- Remote HEAD: pending first release-branch push
- Worktree: clean at sprint start; final state pending

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

- Installer name/path/SHA-256: NOT RUN
- Executable SHA-256: NOT RUN
- Login, durable fixture, Planner, Session, Secure AI, restart, and tray: NOT RUN

## Production Daily Driver

- Production project: `life-tracker-12000` (`970402762590`)
- Production resources changed: none
- Recovery/rollback state: NOT YET ESTABLISHED FOR PROMOTION
- Forward-durability acceptance: NOT RUN
- Weekly Planner acceptance: NOT RUN
- Session acceptance: NOT RUN
- Analytics acceptance: NOT RUN
- Secure AI and Preview/Apply/Undo acceptance: NOT RUN
- Restart/re-auth evidence: NOT RUN
- Notification/tray/autostart: NOT RUN
- MCP: NOT ATTEMPTED

## Deferred work

WhatsApp, Twilio, reports/email, routing refinements, MCP redesign, privacy,
Pages retirement, updater, and all P2/P3 work remain outside this sprint.

`LIFE TRACKER DAILY DRIVER NOT READY`
