# Functions security override

- Parse `Authorization: Bearer <Firebase ID token>` and call Firebase Admin `verifyIdToken`; derive `AuthContext.uid` only from the decoded token.
- Never accept authoritative UID, collection names, or document paths from HTTP bodies, query strings, model arguments, or MCP arguments.
- Keep OpenAI and Secret Manager access in this package. Bind `OPENAI_API_KEY` with `defineSecret`; tests use injected fakes and never make live API calls.
- Model-callable tools are strict, bounded, server-allowlisted read or proposal operations. Apply and rollback are authenticated user actions, never model tools.
- Every private Admin SDK access uses an owner-scoped repository method. Normalize cross-user missing/forbidden responses to avoid entity probing.
- Approval capabilities are hashed at rest, UID/plan/hash/base-version/scope bound, expiring, atomically consumed, and non-replayable.
- Firestore transaction callbacks contain only deterministic Firestore work; never call OpenAI or another external side effect inside a retryable callback.
- Significant writes require idempotency, entity preconditions, snapshots, post-write verification, audit receipts, and safe rollback checks.
- Logs contain correlation IDs and safe classifications only: never tokens, approval secrets, credentials, raw prompts, or complete private Notes.
- Run Functions typecheck/tests/build plus affected emulator tests before a checkpoint.
