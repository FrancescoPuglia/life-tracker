# Secure AI setup (Firebase Functions + OpenAI Responses API)

Life Tracker keeps its GitHub Pages frontend static. The browser authenticates
with Firebase, sends a refreshed Firebase ID token to the HTTPS Function, and
never receives an OpenAI credential. Do not restore the removed Next.js
`/api/ai/chat` route.

## Architecture

```text
Static browser -> Firebase Auth -> HTTPS Function -> UID-scoped domain layer
              -> OpenAI Responses API (read/proposal tools only)
              -> preview -> explicit Apply -> Firestore transaction
              -> verification -> audit receipt -> optional safe rollback
```

OpenAI proposes and explains. The backend validates ownership and deterministic
Life Tracker rules. Apply and rollback are authenticated user actions and are
not model-callable tools.

## Frontend configuration

Copy `.env.local.example` to the ignored `.env.local` file and configure the
public Firebase Web SDK values. Set only the external backend URL for AI:

```dotenv
NEXT_PUBLIC_AI_API_BASE_URL=http://127.0.0.1:5001/PROJECT_ID/europe-west1/lifeTrackerAiApi
```

For a GitHub Pages build, this value must be the deployed HTTPS Function URL,
for example `https://europe-west1-PROJECT_ID.cloudfunctions.net/lifeTrackerAiApi`.
It is public routing configuration, not a credential.

Never add `OPENAI_API_KEY`, an OpenAI public-key variable, a Firebase Admin
service account, or an approval secret to the root environment or GitHub Pages
workflow.

## Backend secrets and parameters

The Function binds two secrets with Firebase `defineSecret`:

- `OPENAI_API_KEY`: a rotated backend-only OpenAI project key;
- `AI_CAPABILITY_SIGNING_SECRET`: at least 32 random bytes for approval and
  rollback capabilities.

Documentation placeholder only — never replace this in a tracked file:

```dotenv
OPENAI_API_KEY=sk-proj-YOUR_KEY_HERE
```

After selecting the intended non-production/staging Firebase project, a human
operator sets them interactively:

```bash
firebase functions:secrets:set OPENAI_API_KEY --project life-tracker-staging
firebase functions:secrets:set AI_CAPABILITY_SIGNING_SECRET --project life-tracker-staging
```

Do not paste secret values into a command argument, tracked file, issue, log, or
chat. Local emulation may use the ignored `functions/.secret.local` file.

The non-secret `defineString` parameters are:

- `OPENAI_MODEL` (backend-configurable model);
- `OPENAI_REASONING_EFFORT`;
- `OPENAI_BASE_URL` (defaults to the official OpenAI API; production rejects
  non-official hosts, while the emulator may use loopback for deterministic
  tests);
- `AI_ALLOWED_ORIGINS` (comma-separated exact HTTPS origins plus explicit
  loopback development origins).

The defaults are defined in `functions/src/index.ts`. Any project-specific
Firebase parameter file remains local and must be reviewed before deployment.

## Install, build, and test

Use Node.js 22 and the checked-in npm lockfiles:

```bash
npm ci
npm --prefix functions ci
npm run typecheck
npm run test:run
npm --prefix functions run typecheck
npm --prefix functions run test:run
npm --prefix functions run build
```

Run emulator-backed authorization and transaction tests from the repository
root:

```bash
npm run test:rules
npm run test:functions:emulator
npm run test:auth:emulator
```

Start local Firebase services only against a demo/development project:

```bash
firebase emulators:start --only auth,firestore,functions --project PROJECT_ID
```

Automated tests inject a deterministic fake Responses transport and make no
live OpenAI calls. Production Responses requests use `store: false`; Life
Tracker persists only its own bounded plan/audit metadata, not hosted response
state.

## Static frontend verification

```bash
GITHUB_PAGES=true \
NEXT_PUBLIC_AI_API_BASE_URL=https://europe-west1-PROJECT_ID.cloudfunctions.net/lifeTrackerAiApi \
npm run build
npm run check:static-security -- --include-output
npm run test:e2e:static
```

The security check rejects legacy local AI routes, provider-key names, direct
OpenAI calls, and an OpenAI SDK dependency in browser code.

## Deployment (documentation only)

Deployment is a separate, human-approved action. After review, secret rotation,
staging verification, and explicit project selection, the narrow Functions
command is:

```bash
firebase deploy --project PROJECT_ID --only functions:lifeTrackerAiApi
```

Firestore Rules are a separate high-impact deployment:

```bash
firebase deploy --project PROJECT_ID --only firestore:rules
```

The proposal-snapshot retention policy and required Firestore index are also a
separate deployment:

```bash
firebase deploy --project PROJECT_ID --only firestore:indexes
```

Do not combine these commands implicitly and do not deploy from an unreviewed
working tree.

CORS is origin-based, not path-based. All projects hosted below
`https://francescopuglia.github.io` share one browser origin and must therefore
be treated as mutually trusted. A dedicated custom origin is the stronger
production isolation option.

## Current MCP boundary

`ReadOnlyMcpDomainAdapter` reuses the same authenticated domain registry but is
disabled by default and has no remote transport in this branch. It exposes only
bounded read tools when explicitly enabled. Proposal, apply, rollback, and raw
database operations remain unavailable. A future remote MCP server must add a
reviewed authentication transport without creating a second business-logic or
write-authority path. Official OpenAI plugin documentation describes MCP tools
that may read information or take actions, but the public documentation checked
for this release does not establish availability for this owner's current plan.
No MCP capability is enabled on that assumption.

Official references:

- [MCP server concepts](https://developers.openai.com/plugins/concepts/mcp-server)
- [Tool design](https://developers.openai.com/plugins/plan/tools)
- [Authentication](https://developers.openai.com/plugins/build/auth)
- [Responses API MCP and connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)

## Incident note

A historical OpenAI key was exposed in an earlier revision of this guide. The
current tree contains no usable value, and the owner confirmed on 2026-08-17
that the historical key was revoked. Future staging and production credentials
must remain separate, backend-only secrets.
