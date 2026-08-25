import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryMcpOAuthRepository } from '../../src/mcp/in-memory-oauth-repository';
import { LifeTrackerMcpOAuthService } from '../../src/mcp/oauth-service';
import type { FirebaseMcpIdentityVerifier } from '../../src/mcp/oauth-types';

const OWNER_UID = 'verified-owner';
const BASE_URL = 'https://europe-west1-life-tracker.example';
const RESOURCE = `${BASE_URL}/mcp`;
const CLIENT_ID = 'https://chatgpt.com/oauth/client.json';
const REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect';
const FIREBASE_TOKEN = 'firebase-id-token-with-safe-test-length';
const VERIFIER = 'a'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER, 'ascii').digest('base64url');

describe('Life Tracker MCP OAuth service', () => {
  it('publishes resource-bound OAuth 2.1 metadata with a read-only scope', () => {
    const { service } = fixture();
    expect(service.authorizationServerMetadata()).toEqual(expect.objectContaining({
      issuer: BASE_URL,
      authorization_endpoint: `${BASE_URL}/authorize`,
      token_endpoint: `${BASE_URL}/token`,
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['life_tracker.read'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    }));
    expect(service.protectedResourceMetadata()).toEqual(expect.objectContaining({
      resource: RESOURCE,
      authorization_servers: [BASE_URL],
      scopes_supported: ['life_tracker.read'],
    }));
    expect(service.challenge()).toContain(service.protectedResourceMetadataUrl);
  });

  it('links a verified Firebase owner, consumes PKCE code once, and rotates refresh tokens', async () => {
    const { service, identity } = fixture();
    const begin = await service.beginAuthorization(validAuthorization());
    const redirect = new URL(await service.completeAuthorization({
      pendingId: begin.pendingId,
      csrfToken: begin.csrfToken,
      firebaseIdToken: FIREBASE_TOKEN,
    }));
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT_URI);
    expect(redirect.searchParams.get('state')).toBe(validAuthorization().state);
    expect(redirect.searchParams.get('iss')).toBe(BASE_URL);
    const code = redirect.searchParams.get('code');
    expect(code).toMatch(/^ltmcp_cd_/);

    const first = await service.exchangeAuthorizationCode({
      clientId: CLIENT_ID,
      code: code!,
      codeVerifier: VERIFIER,
      redirectUri: REDIRECT_URI,
      resource: RESOURCE,
    });
    expect(first).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3_600,
      scope: 'life_tracker.read',
    });
    expect(first.access_token).toMatch(/^ltmcp_at_/);
    expect(first.refresh_token).toMatch(/^ltmcp_rt_/);

    const auth = await service.verifyAccessToken(first.access_token);
    expect(auth).toMatchObject({
      clientId: CLIENT_ID,
      scopes: ['life_tracker.read'],
      extra: { uid: OWNER_UID },
    });
    expect(auth.resource?.href).toBe(RESOURCE);

    const second = await service.exchangeRefreshToken({
      clientId: CLIENT_ID,
      refreshToken: first.refresh_token,
      scopes: null,
      resource: RESOURCE,
    });
    expect(second.refresh_token).not.toBe(first.refresh_token);
    await expect(service.exchangeRefreshToken({
      clientId: CLIENT_ID,
      refreshToken: first.refresh_token,
      scopes: null,
      resource: RESOURCE,
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.exchangeAuthorizationCode({
      clientId: CLIENT_ID,
      code: code!,
      codeVerifier: VERIFIER,
      redirectUri: REDIRECT_URI,
      resource: RESOURCE,
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(identity.assertAccountActive).toHaveBeenCalled();
  });

  it('rejects a different Firebase user before minting an authorization code', async () => {
    const identity: FirebaseMcpIdentityVerifier = {
      verifyIdToken: vi.fn(async () => ({ uid: 'other-user', authTimeSeconds: 1_777_000_000 })),
      assertAccountActive: vi.fn(async () => undefined),
    };
    const { service } = fixture(identity);
    const begin = await service.beginAuthorization(validAuthorization());
    await expect(service.completeAuthorization({
      pendingId: begin.pendingId,
      csrfToken: begin.csrfToken,
      firebaseIdToken: FIREBASE_TOKEN,
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('fails closed for hostile clients, write scopes, resource swaps, bad PKCE, and CSRF replay', async () => {
    const { service } = fixture();
    await expect(service.beginAuthorization({
      ...validAuthorization(),
      clientId: 'https://attacker.example/client.json',
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(service.beginAuthorization({
      ...validAuthorization(),
      scopes: ['life_tracker.read', 'life_tracker.write'],
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.beginAuthorization({
      ...validAuthorization(),
      resource: 'https://attacker.example/mcp',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const begin = await service.beginAuthorization(validAuthorization());
    const wrongCsrf = `${begin.csrfToken.slice(0, -1)}${begin.csrfToken.endsWith('A') ? 'B' : 'A'}`;
    await expect(service.completeAuthorization({
      pendingId: begin.pendingId,
      csrfToken: wrongCsrf,
      firebaseIdToken: FIREBASE_TOKEN,
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const redirect = new URL(await service.completeAuthorization({
      pendingId: begin.pendingId,
      csrfToken: begin.csrfToken,
      firebaseIdToken: FIREBASE_TOKEN,
    }));
    await expect(service.completeAuthorization({
      pendingId: begin.pendingId,
      csrfToken: begin.csrfToken,
      firebaseIdToken: FIREBASE_TOKEN,
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.exchangeAuthorizationCode({
      clientId: CLIENT_ID,
      code: redirect.searchParams.get('code')!,
      codeVerifier: 'b'.repeat(64),
      redirectUri: REDIRECT_URI,
      resource: RESOURCE,
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects callback-specific and mismatched clients because issuer identification is enabled', async () => {
    const { service } = fixture();
    const callbackId = 'callback_12345678';
    const input = {
      ...validAuthorization(),
      clientId: `https://chatgpt.com/oauth/${callbackId}/client.json`,
      redirectUri: `https://chatgpt.com/connector/oauth/${callbackId}`,
    };
    await expect(service.beginAuthorization(input))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(service.beginAuthorization({
      ...input,
      redirectUri: REDIRECT_URI,
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('revokes access tokens and rechecks Firebase account state for every use', async () => {
    const { service, identity } = fixture();
    const tokens = await issueTokens(service);
    await service.revokeToken(tokens.access_token, CLIENT_ID);
    await expect(service.verifyAccessToken(tokens.access_token))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const next = await issueTokens(service);
    identity.assertAccountActive.mockRejectedValueOnce(
      Object.assign(new Error('revoked'), { code: 'UNAUTHENTICATED' }),
    );
    await expect(service.verifyAccessToken(next.access_token)).rejects.toBeTruthy();
  });
});

function fixture(identityOverride?: FirebaseMcpIdentityVerifier) {
  const identity = identityOverride ?? {
    verifyIdToken: vi.fn(async () => ({ uid: OWNER_UID, authTimeSeconds: 1_777_000_000 })),
    assertAccountActive: vi.fn(async () => undefined),
  };
  return {
    identity: identity as typeof identity & {
      assertAccountActive: ReturnType<typeof vi.fn>;
    },
    service: new LifeTrackerMcpOAuthService(
      new InMemoryMcpOAuthRepository(),
      identity,
      OWNER_UID,
      BASE_URL,
      () => new Date('2026-08-25T10:00:00.000Z'),
    ),
  };
}

function validAuthorization() {
  return {
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    state: 'state-value-long-enough-1234567890',
    scopes: ['life_tracker.read'],
    codeChallenge: CHALLENGE,
    resource: RESOURCE,
  };
}

async function issueTokens(service: LifeTrackerMcpOAuthService) {
  const begin = await service.beginAuthorization(validAuthorization());
  const redirect = new URL(await service.completeAuthorization({
    pendingId: begin.pendingId,
    csrfToken: begin.csrfToken,
    firebaseIdToken: FIREBASE_TOKEN,
  }));
  return service.exchangeAuthorizationCode({
    clientId: CLIENT_ID,
    code: redirect.searchParams.get('code')!,
    codeVerifier: VERIFIER,
    redirectUri: REDIRECT_URI,
    resource: RESOURCE,
  });
}
