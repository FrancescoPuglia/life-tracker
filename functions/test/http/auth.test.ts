import { describe, expect, it, vi } from 'vitest';
import { FirebaseTokenVerifier, parseBearerToken } from '../../src/http/auth';

describe('HTTP authentication', () => {
  it('accepts one well-formed Bearer token', () => {
    expect(parseBearerToken(`Bearer ${'token-segment-'.repeat(3)}`)).toBe('token-segment-'.repeat(3));
  });

  it.each([
    undefined,
    '',
    'Basic abc',
    'bearer abc',
    'Bearer short',
    `Bearer ${'x'.repeat(20)} trailing`,
    ['Bearer one', 'Bearer two'],
  ])('rejects malformed authorization value %#', (value) => {
    expect(() => parseBearerToken(value)).toThrowError('Authentication is required.');
  });

  it('checks revocation and derives uid from the verified token', async () => {
    const verifyIdToken = vi.fn(async () => ({ uid: 'verified-user' }));
    const verifier = new FirebaseTokenVerifier({ verifyIdToken } as never);

    await expect(verifier.verifyBearerToken('opaque-token-value-with-safe-length'))
      .resolves.toEqual({ uid: 'verified-user' });
    expect(verifyIdToken).toHaveBeenCalledWith('opaque-token-value-with-safe-length', true);
  });

  it.each([
    'auth/argument-error',
    'auth/id-token-expired',
    'auth/id-token-revoked',
    'auth/invalid-credential',
  ])('normalizes %s token verification failures', async (providerCode) => {
    const verifyIdToken = vi.fn(async () => {
      throw new Error(`${providerCode}: sensitive provider details`);
    });
    const verifier = new FirebaseTokenVerifier({ verifyIdToken } as never);

    await expect(verifier.verifyBearerToken('opaque-token-value-with-safe-length'))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED', message: 'Authentication is required.' });
  });

  it('rejects a decoded UID that cannot be used as an internally derived path segment', async () => {
    const verifier = new FirebaseTokenVerifier({
      verifyIdToken: vi.fn(async () => ({ uid: '../victim' })),
    } as never);

    await expect(verifier.verifyBearerToken('opaque-token-value-with-safe-length'))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
