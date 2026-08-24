# Life Tracker production read-only audit

Date: 2026-08-24 (Europe/Rome)

Target: `life-tracker-12000` (`970402762590`)

Status: READ-ONLY AUDIT COMPLETE; PRODUCTION PROMOTION NOT AUTHORIZED

## Scope and handling

Every cloud query named `life-tracker-12000` explicitly. The audit read only
project, Firebase app, Auth, Firestore, Rules, index, backup, API, billing,
Hosting, GitHub repository, and GitHub Pages metadata. It also ran bounded
Firestore collection-group counts and field-projected compatibility checks.

No production document was created, updated, deleted, exported, or copied to
disk. No API, billing link, backup, Rule, index, Function, secret, Hosting
release, GitHub setting, or Pages setting was changed. No UID, document ID,
title, note, schedule value, provider credential, Auth user record, API-key
value, or other document payload was printed or persisted.

The repository is still public. Exact personal collection counts were therefore
kept out of Git. Before the final receipt, repeat the count-only inventory after
R7 makes the repository private and add the resulting private evidence. This is
an intentional privacy gate, not a claim that counts were unverified.

## Positive identity and application configuration

- Firebase project is ACTIVE with display name `Life Tracker`.
- One active Web app exists: `Life Tracker Web`, app ID
  `1:970402762590:web:e5bc0162003ac224c449cf`.
- The live public Web manifest matches the reviewed production Desktop profile:
  project ID, app ID, Auth domain, Storage bucket, and messaging sender ID all
  agree. The public Firebase API-key value was never printed; its SHA-256 is
  `00887e4ba692083552f3c9b60dd3a0bc9d03a4c363ba49e1b73b09a28165689a`.
- Firebase Hosting has one default site, but an anonymous request to
  `https://life-tracker-12000.web.app/` returned HTTP 404.

## Authentication

- Email/password: enabled; password required.
- Google: enabled.
- Anonymous and phone sign-in: disabled.
- MFA: disabled.
- Multi-tenancy and Auth blocking Functions: disabled/unconfigured.
- Authorized domains are the Firebase domains, `localhost`, and the current
  GitHub Pages domain. `tauri.localhost` is not currently authorized. Installed
  email/password must be proved directly; a Google Desktop flow needs a
  separately reviewed native/external-browser design and exact domain handling.

## Firestore

- Database: `(default)`, Native mode, Standard edition, free tier.
- Location: `europe-southwest1`.
- Concurrency: pessimistic; realtime updates enabled.
- Version retention: one hour.
- Point-in-time recovery: disabled.
- Database delete protection: disabled.
- Backup schedules: none. Existing backups in the database location: none.
- Deployed composite indexes: none. Deployed field overrides/TTL policies: none.

The only root collection is `users`. Bounded, content-free discovery found
owner-scoped product collections plus one legacy `blockTypes` collection. The
server-owned Secure AI namespaces are not populated. The persisted `sessions`
collection is not populated, so actual execution must remain explicitly
missing in R2 analytics; it must never be silently treated as zero.

Every document in the observed owner-scoped collections had a string `userId`
that matched its `/users/{uid}` path. No mismatched optional owner field or
document `id` was found. These checks compared values only in memory and emitted
aggregate mismatch counts.

All observed TimeBlocks use the legacy map wire shape
`{seconds: integer, nanoseconds: integer}` for start/end rather than a native
Firestore timestamp. Status and type values satisfy the reviewed enums. The
verified Rules correctly reject the legacy map on a partial update. Commit
`3545280` fixes the client boundary: SDK atomic values are no longer flattened,
legacy maps become native timestamps on legitimate full updates, and reads
restore them to JavaScript `Date` objects. This is gradual normalization during
authorized user edits, not a bulk or silent migration.

## Deployed Rules comparison

The active production Firestore Rules release was created on
2025-12-23. Its one-file SHA-256 is
`7f95ba84efa0537537dd4d92e8ee30f5408ab2c83bc71d4f36508fd0e5a297bd`.
It allows any authenticated owner to read or write any nested document under
`/users/{uid}`. It is owner-path scoped but materially broader than the verified
deny-by-default collection allowlist.

The reviewed local Rules SHA-256 is
`78f8b6dc22faf62f444986dad0fb8ab9a5964c54da754305205d182bd3fa790f`.
They add collection allowlisting, embedded-owner validation, immutable protected
fields, TimeBlock/domain validation, and browser denial for server namespaces.

Replacing production Rules is security-improving but classified **RISKY**, not
blindly compatible. The timestamp remediation and installed real-data CRUD
acceptance must pass first. The legacy `blockTypes` collection is not used by
current source and will become client-inaccessible under deny-by-default Rules;
it will not be deleted or migrated implicitly.

## Backend and billing

Production currently has no callable canonical Life Tracker backend: the
reviewed `lifeTrackerAiApi` health URL returned HTTP 404. The following APIs are
disabled: Cloud Functions, Cloud Run, Artifact Registry, Cloud Build, Secret
Manager, Cloud Tasks, and Cloud Scheduler. Firestore, Identity Toolkit, and
Firebase Rules APIs are enabled. Because the inventory APIs are disabled, a
positive full list of historical Function/Run resources is NOT VERIFIED and
must be rerun immediately after any explicitly approved API enablement and
before deployment.

The project has no linked billing account and billing is disabled. No billing
change is authorized. Enabling the required production backend is therefore an
explicit human cost/plan gate. Code, tests, configuration, and recovery planning
can continue independently, but R2 AI, cloud reminders, scheduled reports, and
remote MCP cannot be called production-verified before that gate is approved.

## Public web and repository dependencies

- `FrancescoPuglia/life-tracker` is PUBLIC; default branch is `main`.
- GitHub Pages is built by workflow and public. The anonymous Pages URL returned
  HTTP 200.
- Pages deploys only from pushes to `main` or manual workflow dispatch. Work on
  `codex/life-tracker-os` does not publish a new site.
- The Desktop is a compiled static export and has no runtime dependency on
  GitHub Pages or anonymous repository assets. No updater is configured.
- Firebase Hosting is not serving the application (HTTP 404).

R7 must still record a recovery ref, unpublish Pages, verify the public URL is
unavailable, make the repository private, verify clone/fetch/push and CI, and
rerun the secret scan. Previous public exposure cannot be retroactively erased.

## Change classification

| Required change | Classification | Reason |
| --- | --- | --- |
| Use the live production Web manifest in a distinct production Desktop | Compatible | Exact project/app fields and API-key hash match the reviewed profile |
| Preserve owner-scoped hierarchy | Compatible | All audited embedded owners matched their owner paths |
| Deploy the verified Function and required service APIs | Additive, human gate | APIs and billing are disabled and the canonical endpoint is 404; rerun the full inventory before deploy |
| Deploy composite index and six TTL overrides | Additive, production approval | Production currently has none; deployment changes managed metadata |
| Add server-owned Secure AI namespaces | Additive | Namespaces are currently absent and browser Rules deny them |
| Replace broad production Rules | Risky | Safer policy, but legacy wire compatibility and real CRUD must be accepted first |
| Normalize legacy TimeBlock timestamp maps during legitimate edits | Compatible after `3545280` | No bulk mutation; native timestamp is required by verified Rules |
| Delete or migrate legacy `blockTypes` data | Destructive | Not required and not authorized |
| Enable billing or purchase services | Human cost gate | Explicit permission is required; no change was made |

## Recovery gate before production mutation

Current recovery is insufficient for privileged production promotion: there is
no PITR, delete protection, backup schedule, or existing backup. Before any
production Function/Rules/index mutation:

1. obtain explicit approval for the production cost/plan decision;
2. choose and create a recoverable Firestore backup/export without exposing raw
   user data to Git or the transcript;
3. record the application SHA, active Rules release/hash, index/TTL state,
   deployed service inventory, and exact target again;
4. deploy additively and verify; and
5. retain the pre-change recovery reference and documented restore procedure.

No real user-data deletion or destructive schema migration is authorized.

## Evidence gates

- Read-only Firebase/GCP/GitHub metadata queries: exit 0 except the expected
  Functions inventory 403 proving the Cloud Functions API is disabled.
- Canonical production `lifeTrackerAiApi` health URL: HTTP 404.
- Owner/schema compatibility projections: completed in memory with no raw-value
  persistence.
- `npm run typecheck`: exit 0.
- `npm run test:run`: 53 files / 639 tests PASS.
- Focused storage/adapter tests: 12/12 PASS.
- `npm run test:rules`: 49/49 PASS on the official Firestore emulator using a
  checksum-verified temporary Temurin Java 21 runtime and `life-tracker-test`.
- `npm run check:static-security`: exit 0.
