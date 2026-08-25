import { createHash } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FirestoreMcpOAuthRepository } from '../../src/mcp/firestore-oauth-repository';
import {
  LifeTrackerMcpOAuthService,
  mcpOAuthHash,
  type McpOAuthTokens,
} from '../../src/mcp/oauth-service';
import type { FirebaseMcpIdentityVerifier } from '../../src/mcp/oauth-types';
import { FirestoreMcpReadRateLimiter } from '../../src/mcp/rate-limiter';

const PROJECT_ID = 'demo-life-tracker-mcp-oauth';
const BASE_URL = 'https://mcp.example';
const RESOURCE = `${BASE_URL}/mcp`;
const CLIENT_ID = 'https://chatgpt.com/oauth/client.json';
const REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect';
const FIREBASE_ID_TOKEN = 'firebase-id-token-safe-emulator-fixture';
const CODE_VERIFIER = 'v'.repeat(64);
const CODE_CHALLENGE = createHash('sha256')
  .update(CODE_VERIFIER, 'ascii')
  .digest('base64url');
let uidSequence = 0;

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'Firestore MCP OAuth and rate-limit transactions',
  () => {
    let app: App;
    let firestore: Firestore;

    beforeAll(() => {
      app = initializeApp({ projectId: PROJECT_ID }, `mcp-oauth-${Date.now()}`);
      firestore = getFirestore(app);
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    it('stores only credential hashes and serializes code and refresh-token replay', async () => {
      const ownerUid = uniqueUid('lifecycle');
      const otherUid = uniqueUid('other');
      const clock = mutableClock('2026-08-25T10:00:00.000Z');
      const service = oauthService(firestore, ownerUid, clock.read);
      await firestore.doc(`users/${otherUid}/goals/victim-goal`).set({
        id: 'victim-goal', userId: otherUid, title: 'Other owner goal',
      });

      const pending = await service.beginAuthorization(authorizeInput());
      const redirectUrl = await service.completeAuthorization({
        pendingId: pending.pendingId,
        csrfToken: pending.csrfToken,
        firebaseIdToken: FIREBASE_ID_TOKEN,
      });
      const rawCode = new URL(redirectUrl).searchParams.get('code');
      if (!rawCode) throw new Error('Missing OAuth authorization code.');

      const codeExchanges = await Promise.allSettled([
        service.exchangeAuthorizationCode(tokenInput(rawCode)),
        service.exchangeAuthorizationCode(tokenInput(rawCode)),
      ]);
      expect(codeExchanges.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(codeExchanges.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      const firstTokens = fulfilledTokenPair(codeExchanges);
      await expect(service.exchangeAuthorizationCode(tokenInput(rawCode)))
        .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

      const storedCollections = await Promise.all([
        firestore.collection(`users/${ownerUid}/mcpOAuthPendingAuthorizations`).get(),
        firestore.collection(`users/${ownerUid}/mcpOAuthAuthorizationCodes`).get(),
        firestore.collection(`users/${ownerUid}/mcpOAuthAccessTokens`).get(),
        firestore.collection(`users/${ownerUid}/mcpOAuthRefreshTokens`).get(),
      ]);
      expect(storedCollections.map(({ size }) => size)).toEqual([1, 1, 1, 1]);
      const storedJson = JSON.stringify(storedCollections.flatMap((snapshot) =>
        snapshot.docs.map((document) => ({ id: document.id, data: document.data() }))));
      for (const rawCredential of [
        pending.pendingId,
        pending.csrfToken,
        rawCode,
        firstTokens.access_token,
        firstTokens.refresh_token,
        FIREBASE_ID_TOKEN,
      ]) expect(storedJson).not.toContain(rawCredential);
      for (const snapshot of storedCollections) {
        expect(snapshot.docs.every((document) => /^[0-9a-f]{64}$/.test(document.id))).toBe(true);
        expect(snapshot.docs.every((document) => document.data().purgeAt instanceof Timestamp))
          .toBe(true);
      }
      expect(storedCollections[0]!.docs[0]!.id).toBe(mcpOAuthHash(pending.pendingId));
      expect(storedCollections[1]!.docs[0]!.id).toBe(mcpOAuthHash(rawCode));
      expect(storedCollections[2]!.docs[0]!.id).toBe(mcpOAuthHash(firstTokens.access_token));
      expect(storedCollections[3]!.docs[0]!.id).toBe(mcpOAuthHash(firstTokens.refresh_token));
      expect((await firestore.collection(`users/${otherUid}/mcpOAuthAccessTokens`).get()).empty)
        .toBe(true);

      clock.set('2026-08-25T10:01:00.000Z');
      const refreshExchanges = await Promise.allSettled([
        service.exchangeRefreshToken(refreshInput(firstTokens.refresh_token)),
        service.exchangeRefreshToken(refreshInput(firstTokens.refresh_token)),
      ]);
      expect(refreshExchanges.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(refreshExchanges.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      const rotated = fulfilledTokenPair(refreshExchanges);
      await expect(service.exchangeRefreshToken(refreshInput(firstTokens.refresh_token)))
        .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      await expect(service.verifyAccessToken(rotated.access_token)).resolves.toMatchObject({
        clientId: CLIENT_ID,
        scopes: ['life_tracker.read'],
        extra: { uid: ownerUid },
      });

      await service.revokeToken(rotated.access_token, CLIENT_ID);
      await expect(service.verifyAccessToken(rotated.access_token))
        .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      expect((await firestore.doc(
        `users/${ownerUid}/mcpOAuthAccessTokens/${mcpOAuthHash(rotated.access_token)}`,
      ).get()).data()).toMatchObject({ state: 'revoked', revokedAt: expect.any(Timestamp) });
    }, 30_000);

    it('fails closed when server-owned OAuth documents are malformed or misowned', async () => {
      const ownerUid = uniqueUid('tamper');
      const service = oauthService(
        firestore,
        ownerUid,
        () => new Date('2026-08-25T10:00:00.000Z'),
      );
      const { tokens } = await linkedTokens(service);
      const reference = firestore.doc(
        `users/${ownerUid}/mcpOAuthAccessTokens/${mcpOAuthHash(tokens.access_token)}`,
      );
      await reference.update({ uid: 'different-owner' });

      await expect(service.verifyAccessToken(tokens.access_token))
        .rejects.toMatchObject({ code: 'INTERNAL' });
      expect(() => new FirestoreMcpOAuthRepository(firestore, '../forged/path'))
        .toThrow('MCP owner configuration is invalid.');
    }, 30_000);

    it('serializes the owner read budget and rejects tampered counter state', async () => {
      const ownerUid = uniqueUid('rate');
      const limiter = new FirestoreMcpReadRateLimiter(firestore, 1, 60_000);
      const now = new Date('2026-08-25T10:00:00.000Z');

      const concurrent = await Promise.allSettled([
        limiter.consume(ownerUid, now),
        limiter.consume(ownerUid, now),
      ]);
      expect(concurrent.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      const rejected = concurrent.find(({ status }) => status === 'rejected');
      expect(rejected).toMatchObject({ reason: { code: 'RATE_LIMITED' } });
      const reference = firestore.doc(`users/${ownerUid}/mcpReadRateLimits/default`);
      expect((await reference.get()).data()).toMatchObject({
        schemaVersion: 'life-tracker-mcp-read-rate-limit-v1',
        uid: ownerUid,
        count: 1,
        windowStartedAt: expect.any(Timestamp),
        purgeAt: expect.any(Timestamp),
      });

      await expect(limiter.consume(ownerUid, new Date('2026-08-25T10:01:00.000Z')))
        .resolves.toBeUndefined();
      await reference.update({ count: -1 });
      await expect(limiter.consume(ownerUid, new Date('2026-08-25T10:01:01.000Z')))
        .rejects.toMatchObject({ code: 'INTERNAL' });
      await reference.update({ count: 1, uid: 'different-owner' });
      await expect(limiter.consume(ownerUid, new Date('2026-08-25T10:01:02.000Z')))
        .rejects.toMatchObject({ code: 'INTERNAL' });
    }, 30_000);
  },
);

function uniqueUid(label: string): string {
  uidSequence += 1;
  return `mcp-${label}-${Date.now()}-${uidSequence}`;
}

function oauthService(firestore: Firestore, ownerUid: string, clock: () => Date) {
  const identity: FirebaseMcpIdentityVerifier = {
    verifyIdToken: vi.fn(async (token) => {
      if (token !== FIREBASE_ID_TOKEN) throw new Error('unexpected test token');
      return { uid: ownerUid, authTimeSeconds: 1_777_000_000 };
    }),
    assertAccountActive: vi.fn(async (uid) => {
      if (uid !== ownerUid) throw new Error('unexpected test owner');
    }),
  };
  return new LifeTrackerMcpOAuthService(
    new FirestoreMcpOAuthRepository(firestore, ownerUid),
    identity,
    ownerUid,
    BASE_URL,
    clock,
  );
}

function authorizeInput() {
  return {
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    state: 'emulator-state-value-1234567890',
    scopes: ['life_tracker.read'],
    codeChallenge: CODE_CHALLENGE,
    resource: RESOURCE,
  };
}

function tokenInput(code: string) {
  return {
    clientId: CLIENT_ID,
    code,
    codeVerifier: CODE_VERIFIER,
    redirectUri: REDIRECT_URI,
    resource: RESOURCE,
  };
}

function refreshInput(refreshToken: string) {
  return {
    clientId: CLIENT_ID,
    refreshToken,
    scopes: ['life_tracker.read'],
    resource: RESOURCE,
  };
}

async function linkedTokens(service: LifeTrackerMcpOAuthService) {
  const pending = await service.beginAuthorization(authorizeInput());
  const redirect = await service.completeAuthorization({
    pendingId: pending.pendingId,
    csrfToken: pending.csrfToken,
    firebaseIdToken: FIREBASE_ID_TOKEN,
  });
  const code = new URL(redirect).searchParams.get('code');
  if (!code) throw new Error('Missing OAuth authorization code.');
  return { pending, tokens: await service.exchangeAuthorizationCode(tokenInput(code)) };
}

function fulfilledTokenPair(
  results: PromiseSettledResult<McpOAuthTokens>[],
): McpOAuthTokens {
  const fulfilled = results.find(
    (result): result is PromiseFulfilledResult<McpOAuthTokens> => result.status === 'fulfilled',
  );
  if (!fulfilled) throw new Error('Missing fulfilled OAuth token exchange.');
  return fulfilled.value;
}

function mutableClock(initial: string) {
  let current = initial;
  return {
    read: () => new Date(current),
    set: (value: string) => { current = value; },
  };
}
