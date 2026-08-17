# Security policy

## Reporting a vulnerability

Please use GitHub's private **Security advisory** flow for this repository. Do
not include credentials, Firebase exports, user records, ID tokens, prompts, or
API responses in a public issue.

Include the affected revision, impact, a minimal reproduction with synthetic
data, and any mitigation already attempted.

## Secrets

- Browser-visible Firebase configuration and `NEXT_PUBLIC_AI_API_BASE_URL` are
  public configuration, not credentials.
- OpenAI credentials are bound only to the Firebase HTTPS Function through
  Google Secret Manager. They must never be added to a root `.env*` file used
  by Next.js, a GitHub Pages build, client source, logs, or test fixtures.
- Firebase Admin uses Application Default Credentials in the managed Functions
  runtime. Service-account JSON files must not be stored in this repository.
- Local Functions emulation may use an ignored `functions/.secret.local` file.
  Never commit that file or paste its contents into test output.

The repository intentionally contains no usable secret value. Documentation
may contain an unmistakable non-secret placeholder. If a credential was ever
exposed, revoke it at the provider; deleting it from the current tree is not
sufficient.

## Rotation procedure

1. Revoke or disable the old provider credential.
2. Create a replacement with the minimum required project permissions and a
   spending limit.
3. Store a new secret version with
   `firebase functions:secrets:set SECRET_NAME --project TARGET_PROJECT_ID`
   without echoing it into shell history or CI logs. Resolve and verify the
   non-production target before running the command.
4. Redeploy only the backend function that binds the secret. Do not deploy from
   an unreviewed working tree.
5. Verify authentication, rate limiting, audit records, and provider usage.
6. Prune unused secret versions only after the new version is confirmed.

## Data and authorization boundaries

- Firestore client access is deny-by-default and scoped to
  `/users/{authenticatedUid}/...`.
- The backend derives `uid` only from a verified Firebase ID token. A `uid` or
  `userId` supplied in a request or model tool call is never authoritative.
- Change plans, snapshots, idempotency records, rate-limit state, and audit logs
  are server-only collections. Firebase Admin writes them; clients are denied.
- Destructive and multi-entity changes require preview, explicit apply with an
  idempotency key, a consistent snapshot, and conflict-aware rollback.
- Audit entries contain identifiers and outcomes, not prompts, secrets, note
  bodies, or full entity payloads.

## Safe operations

Run the local test suites and emulators against a Firebase demo project ID.
Never point automated tests at a production project and never import a real
Firestore export into CI. Production deployment and data migration are manual,
separately reviewed operations.
