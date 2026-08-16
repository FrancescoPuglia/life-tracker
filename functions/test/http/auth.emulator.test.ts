import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FirebaseTokenVerifier } from '../../src/http/auth';

const PROJECT_ID = 'life-tracker-test';

describe.skipIf(!process.env.FIREBASE_AUTH_EMULATOR_HOST)(
  'FirebaseTokenVerifier against the Auth emulator',
  () => {
    let app: App;
    let auth: Auth;

    beforeAll(() => {
      app = initializeApp({ projectId: PROJECT_ID }, `auth-emulator-${Date.now()}`);
      auth = getAuth(app);
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    it('verifies a real emulator ID token and derives its authoritative uid', async () => {
      const identity = await createEmulatorIdentity('verified');
      const verifier = new FirebaseTokenVerifier(auth);

      await expect(verifier.verifyBearerToken(identity.idToken)).resolves.toEqual({
        uid: identity.localId,
      });
    });

    it('rejects invalid, expired, wrong-project, and revoked emulator tokens', async () => {
      const identity = await createEmulatorIdentity('negative');
      const verifier = new FirebaseTokenVerifier(auth);

      await expect(verifier.verifyBearerToken('not-a-valid-firebase-token-value'))
        .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      await expect(verifier.verifyBearerToken(rewritePayload(identity.idToken, {
        exp: Math.floor(Date.now() / 1_000) - 60,
      }))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      await expect(verifier.verifyBearerToken(rewritePayload(identity.idToken, {
        aud: 'another-project',
        iss: 'https://securetoken.google.com/another-project',
      }))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

      await auth.revokeRefreshTokens(identity.localId);
      await expect(verifier.verifyBearerToken(rewritePayload(identity.idToken, {
        auth_time: Math.floor(Date.now() / 1_000) - 3_600,
      }))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  },
);

async function createEmulatorIdentity(label: string): Promise<{
  readonly idToken: string;
  readonly localId: string;
}> {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host) throw new Error('Auth emulator host is unavailable.');
  const response = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        password: 'emulator-fixture-password-123',
        returnSecureToken: true,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Auth emulator sign-up failed with status ${response.status}.`);
  }
  const body = await response.json() as { idToken?: unknown; localId?: unknown };
  if (typeof body.idToken !== 'string' || typeof body.localId !== 'string') {
    throw new Error('Auth emulator returned an invalid sign-up response.');
  }
  return { idToken: body.idToken, localId: body.localId };
}

function rewritePayload(token: string, patch: Readonly<Record<string, unknown>>): string {
  const [header, payload] = token.split('.');
  if (!header || !payload) throw new Error('Auth emulator returned a malformed ID token.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  const rewritten = Buffer.from(JSON.stringify({ ...decoded, ...patch }), 'utf8').toString('base64url');
  // Auth emulator tokens intentionally use alg=none. Never use this helper
  // outside emulator-only tests; production verification requires Admin SDK.
  return `${header}.${rewritten}.`;
}
