import type { Auth, DecodedIdToken, UserRecord } from 'firebase-admin/auth';
import { describe, expect, it, vi } from 'vitest';
import { AdminFirebaseMcpIdentityVerifier } from '../../src/mcp/firebase-identity';

const UID = 'firebase-owner';
const AUTH_TIME_SECONDS = 1_777_000_000;

describe('Firebase MCP identity authority', () => {
  it('derives identity only from a revoked-checked Firebase ID token', async () => {
    const fixture = identityFixture();

    await expect(fixture.verifier.verifyIdToken('firebase-id-token')).resolves.toEqual({
      uid: UID,
      authTimeSeconds: AUTH_TIME_SECONDS,
    });
    expect(fixture.verifyIdToken).toHaveBeenCalledWith('firebase-id-token', true);
  });

  it.each([
    { uid: '', auth_time: AUTH_TIME_SECONDS },
    { uid: 'uid with spaces', auth_time: AUTH_TIME_SECONDS },
    { uid: UID, auth_time: 0 },
    { uid: UID, auth_time: 1.5 },
  ])('rejects malformed decoded Firebase authority %#', async (decoded) => {
    const fixture = identityFixture({ decoded });
    await expect(fixture.verifier.verifyIdToken('firebase-id-token'))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rechecks enabled and revocation state on every OAuth token use', async () => {
    const fixture = identityFixture({
      user: {
        uid: UID,
        disabled: false,
        tokensValidAfterTime: new Date(AUTH_TIME_SECONDS * 1_000).toUTCString(),
      },
    });

    await expect(fixture.verifier.assertAccountActive(UID, AUTH_TIME_SECONDS))
      .resolves.toBeUndefined();
    await expect(fixture.verifier.assertAccountActive(UID, AUTH_TIME_SECONDS))
      .resolves.toBeUndefined();
    expect(fixture.getUser).toHaveBeenCalledTimes(2);
    expect(fixture.getUser).toHaveBeenNthCalledWith(1, UID);
  });

  it.each([
    { disabled: true },
    {
      disabled: false,
      tokensValidAfterTime: new Date((AUTH_TIME_SECONDS + 1) * 1_000).toUTCString(),
    },
    { disabled: false, tokensValidAfterTime: 'not-a-date' },
  ])('rejects disabled, revoked, or malformed Firebase account state %#', async (user) => {
    const fixture = identityFixture({ user: { uid: UID, ...user } });
    await expect(fixture.verifier.assertAccountActive(UID, AUTH_TIME_SECONDS))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('normalizes Firebase SDK failures without leaking provider details', async () => {
    const fixture = identityFixture();
    fixture.verifyIdToken.mockRejectedValueOnce(new Error('sensitive Firebase verifier detail'));
    fixture.getUser.mockRejectedValueOnce(new Error('sensitive Firebase account detail'));

    await expect(fixture.verifier.verifyIdToken('firebase-id-token'))
      .rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Firebase authentication is required.',
      });
    await expect(fixture.verifier.assertAccountActive(UID, AUTH_TIME_SECONDS))
      .rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Firebase authentication is required.',
      });
  });
});

function identityFixture(overrides: {
  decoded?: Partial<DecodedIdToken>;
  user?: Partial<UserRecord>;
} = {}) {
  const verifyIdToken = vi.fn(async () => ({
    uid: UID,
    auth_time: AUTH_TIME_SECONDS,
    ...overrides.decoded,
  } as DecodedIdToken));
  const getUser = vi.fn(async () => ({
    uid: UID,
    disabled: false,
    tokensValidAfterTime: undefined,
    ...overrides.user,
  } as UserRecord));
  const auth = { verifyIdToken, getUser } as unknown as Pick<
    Auth,
    'verifyIdToken' | 'getUser'
  >;
  return {
    verifier: new AdminFirebaseMcpIdentityVerifier(auth),
    verifyIdToken,
    getUser,
  };
}
