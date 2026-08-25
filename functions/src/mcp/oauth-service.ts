import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { DomainError } from '../domain/errors';
import { MCP_READ_SCOPE } from './tool-contracts';
import {
  MCP_OAUTH_SCHEMA_VERSION,
  type FirebaseMcpIdentityVerifier,
  type McpOAuthAuthorizationCode,
  type McpOAuthPendingAuthorization,
  type McpOAuthRepository,
  type McpOAuthTokenKind,
  type McpOAuthTokenRecord,
} from './oauth-types';

const PENDING_TTL_MS = 10 * 60_000;
const AUTHORIZATION_CODE_TTL_MS = 5 * 60_000;
const ACCESS_TOKEN_TTL_MS = 60 * 60_000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
const FIREBASE_ID_TOKEN_MAX_LENGTH = 16_384;
const STATE_PATTERN = /^[\u0021-\u007e]{16,512}$/;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const OWNER_UID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const OPAQUE_TOKEN_PATTERN = /^ltmcp_(pd|cs|cd|at|rt)_[A-Za-z0-9_-]{43}$/;
const CHATGPT_CIMD_CLIENT_ID = 'https://chatgpt.com/oauth/client.json';
const CHATGPT_STABLE_REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect';

export interface BeginMcpAuthorizationRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly scopes: readonly string[];
  readonly codeChallenge: string;
  readonly resource: string;
}

export interface BeginMcpAuthorizationResult {
  readonly pendingId: string;
  readonly csrfToken: string;
  readonly expiresAt: string;
}

export interface McpOAuthTokens {
  readonly access_token: string;
  readonly token_type: 'Bearer';
  readonly expires_in: number;
  readonly scope: typeof MCP_READ_SCOPE;
  readonly refresh_token: string;
}

/**
 * OAuth 2.1 authorization-code + S256 PKCE service for the private ChatGPT
 * connection. Firebase Auth remains the only user identity authority. OAuth
 * codes and tokens are opaque, owner-bound, hashed at rest, expiring, and
 * replay-safe.
 */
export class LifeTrackerMcpOAuthService {
  readonly issuer: string;
  readonly resource: string;
  readonly protectedResourceMetadataUrl: string;

  constructor(
    private readonly repository: McpOAuthRepository,
    private readonly firebaseIdentity: FirebaseMcpIdentityVerifier,
    private readonly ownerUid: string,
    canonicalBaseUrl: string,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (!OWNER_UID_PATTERN.test(ownerUid)) {
      throw new DomainError('INTERNAL', 'MCP owner configuration is invalid.');
    }
    const base = normalizeMcpCanonicalBaseUrl(canonicalBaseUrl);
    this.issuer = base;
    this.resource = `${base}/mcp`;
    this.protectedResourceMetadataUrl = `${base}/.well-known/oauth-protected-resource`;
  }

  authorizationServerMetadata(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/authorize`,
      token_endpoint: `${this.issuer}/token`,
      revocation_endpoint: `${this.issuer}/revoke`,
      response_types_supported: Object.freeze(['code']),
      grant_types_supported: Object.freeze(['authorization_code', 'refresh_token']),
      token_endpoint_auth_methods_supported: Object.freeze(['none']),
      code_challenge_methods_supported: Object.freeze(['S256']),
      scopes_supported: Object.freeze([MCP_READ_SCOPE]),
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  }

  protectedResourceMetadata(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      resource: this.resource,
      authorization_servers: Object.freeze([this.issuer]),
      scopes_supported: Object.freeze([MCP_READ_SCOPE]),
      bearer_methods_supported: Object.freeze(['header']),
      resource_name: 'Life Tracker private read access',
    });
  }

  challenge(error = 'invalid_token'): string {
    const description = error === 'insufficient_scope'
      ? 'The Life Tracker read scope is required'
      : 'A valid Life Tracker account link is required';
    return `Bearer resource_metadata="${this.protectedResourceMetadataUrl}", scope="${MCP_READ_SCOPE}", error="${error}", error_description="${description}"`;
  }

  authorizationErrorRedirect(input: Readonly<{
    clientId: string;
    redirectUri: string;
    state?: string;
    error: 'invalid_request' | 'invalid_scope' | 'access_denied' | 'server_error';
  }>): string | null {
    try {
      assertKnownClient(input.clientId, input.redirectUri);
    } catch {
      return null;
    }
    const redirect = new URL(input.redirectUri);
    redirect.searchParams.set('error', input.error);
    redirect.searchParams.set('error_description', 'The Life Tracker authorization request was rejected.');
    if (input.state && STATE_PATTERN.test(input.state)) {
      redirect.searchParams.set('state', input.state);
    }
    redirect.searchParams.set('iss', this.issuer);
    return redirect.href;
  }

  async beginAuthorization(
    input: BeginMcpAuthorizationRequest,
  ): Promise<BeginMcpAuthorizationResult> {
    assertKnownClient(input.clientId, input.redirectUri);
    assertScopes(input.scopes);
    assertResource(input.resource, this.resource);
    if (!STATE_PATTERN.test(input.state)) {
      throw new DomainError('INVALID_ARGUMENT', 'OAuth state is invalid.');
    }
    if (!PKCE_CHALLENGE_PATTERN.test(input.codeChallenge)) {
      throw new DomainError('INVALID_ARGUMENT', 'OAuth PKCE challenge is invalid.');
    }
    const now = this.now();
    const pendingId = randomOpaque('pd');
    const csrfToken = randomOpaque('cs');
    const record: McpOAuthPendingAuthorization = Object.freeze({
      schemaVersion: MCP_OAUTH_SCHEMA_VERSION,
      idHash: sha256(pendingId),
      uid: this.ownerUid,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      state: input.state,
      scopes: Object.freeze([MCP_READ_SCOPE]),
      codeChallenge: input.codeChallenge,
      resource: this.resource,
      csrfHash: sha256(csrfToken),
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PENDING_TTL_MS).toISOString(),
      completedAt: null,
    });
    await this.repository.createPending(record);
    return Object.freeze({ pendingId, csrfToken, expiresAt: record.expiresAt });
  }

  async completeAuthorization(input: Readonly<{
    pendingId: string;
    csrfToken: string;
    firebaseIdToken: string;
  }>): Promise<string> {
    assertOpaque(input.pendingId, 'pd');
    assertOpaque(input.csrfToken, 'cs');
    assertFirebaseIdToken(input.firebaseIdToken);
    const identity = await this.firebaseIdentity.verifyIdToken(input.firebaseIdToken);
    if (identity.uid !== this.ownerUid) {
      throw new DomainError('FORBIDDEN', 'This Firebase account cannot link this Life Tracker.');
    }
    await this.firebaseIdentity.assertAccountActive(identity.uid, identity.authTimeSeconds);
    const now = this.now();
    const rawCode = randomOpaque('cd');
    const pending = await this.repository.completePending({
      pendingIdHash: sha256(input.pendingId),
      csrfHash: sha256(input.csrfToken),
      code: Object.freeze({
        codeHash: sha256(rawCode),
        uid: identity.uid,
        firebaseAuthTimeSeconds: identity.authTimeSeconds,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + AUTHORIZATION_CODE_TTL_MS).toISOString(),
      }),
      now: now.toISOString(),
    });
    return authorizationRedirect(pending, rawCode, this.issuer);
  }

  async denyAuthorization(input: Readonly<{
    pendingId: string;
    csrfToken: string;
  }>): Promise<string> {
    assertOpaque(input.pendingId, 'pd');
    assertOpaque(input.csrfToken, 'cs');
    const pending = await this.repository.denyPending({
      pendingIdHash: sha256(input.pendingId),
      csrfHash: sha256(input.csrfToken),
      now: this.now().toISOString(),
    });
    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set('error', 'access_denied');
    redirect.searchParams.set('error_description', 'The user declined Life Tracker access.');
    redirect.searchParams.set('state', pending.state);
    redirect.searchParams.set('iss', this.issuer);
    return redirect.href;
  }

  async exchangeAuthorizationCode(input: Readonly<{
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    resource: string;
  }>): Promise<McpOAuthTokens> {
    assertKnownClient(input.clientId, input.redirectUri);
    assertResource(input.resource, this.resource);
    assertOpaque(input.code, 'cd');
    if (!PKCE_VERIFIER_PATTERN.test(input.codeVerifier)) {
      throw new DomainError('UNAUTHENTICATED', 'OAuth authorization grant is invalid.');
    }
    const codeHash = sha256(input.code);
    const code = await this.repository.getAuthorizationCode(codeHash);
    const now = this.now();
    assertActiveAuthorizationCode(code, input, this.ownerUid, now);
    const expectedChallenge = createHash('sha256')
      .update(input.codeVerifier, 'ascii')
      .digest('base64url');
    if (!safeStringEqual(code.codeChallenge, expectedChallenge)) {
      throw new DomainError('UNAUTHENTICATED', 'OAuth authorization grant is invalid.');
    }
    await this.firebaseIdentity.assertAccountActive(code.uid, code.firebaseAuthTimeSeconds);
    const issued = issueTokenPair(code, now);
    await this.repository.exchangeAuthorizationCode({
      codeHash,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      resource: input.resource,
      access: issued.access.record,
      refresh: issued.refresh.record,
      now: now.toISOString(),
    });
    return tokenResponse(issued.access.raw, issued.refresh.raw);
  }

  async exchangeRefreshToken(input: Readonly<{
    clientId: string;
    refreshToken: string;
    scopes: readonly string[] | null;
    resource: string;
  }>): Promise<McpOAuthTokens> {
    assertKnownClientId(input.clientId);
    assertResource(input.resource, this.resource);
    if (input.scopes) assertScopes(input.scopes);
    assertOpaque(input.refreshToken, 'rt');
    const refreshHash = sha256(input.refreshToken);
    const existing = await this.repository.getRefreshToken(refreshHash);
    const now = this.now();
    assertActiveToken(existing, 'refresh', input.clientId, this.ownerUid, this.resource, now);
    await this.firebaseIdentity.assertAccountActive(
      existing.uid,
      existing.firebaseAuthTimeSeconds,
    );
    const issued = issueTokenPair(existing, now);
    await this.repository.rotateRefreshToken({
      refreshHash,
      clientId: input.clientId,
      resource: this.resource,
      scopes: Object.freeze([MCP_READ_SCOPE]),
      access: issued.access.record,
      refresh: issued.refresh.record,
      now: now.toISOString(),
    });
    return tokenResponse(issued.access.raw, issued.refresh.raw);
  }

  async verifyAccessToken(rawToken: string): Promise<AuthInfo> {
    assertOpaque(rawToken, 'at');
    const record = await this.repository.getAccessToken(sha256(rawToken));
    const now = this.now();
    assertActiveToken(record, 'access', null, this.ownerUid, this.resource, now);
    await this.firebaseIdentity.assertAccountActive(record.uid, record.firebaseAuthTimeSeconds);
    return Object.freeze({
      token: rawToken,
      clientId: record.clientId,
      scopes: [...record.scopes],
      expiresAt: Math.floor(Date.parse(record.expiresAt) / 1_000),
      resource: new URL(record.resource),
      extra: Object.freeze({ uid: record.uid }),
    });
  }

  async revokeToken(rawToken: string, clientId: string): Promise<void> {
    assertKnownClientId(clientId);
    if (!OPAQUE_TOKEN_PATTERN.test(rawToken)) return;
    await this.repository.revokeToken(sha256(rawToken), clientId, this.now().toISOString());
  }

  private now(): Date {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new DomainError('INTERNAL', 'MCP clock is invalid.');
    }
    return now;
  }
}

function issueTokenPair(
  authority: McpOAuthAuthorizationCode | McpOAuthTokenRecord,
  now: Date,
): Readonly<{
  access: Readonly<{ raw: string; record: McpOAuthTokenRecord }>;
  refresh: Readonly<{ raw: string; record: McpOAuthTokenRecord }>;
}> {
  const accessRaw = randomOpaque('at');
  const refreshRaw = randomOpaque('rt');
  const record = (raw: string, kind: McpOAuthTokenKind, ttlMs: number): McpOAuthTokenRecord =>
    Object.freeze({
      schemaVersion: MCP_OAUTH_SCHEMA_VERSION,
      tokenHash: sha256(raw),
      kind,
      uid: authority.uid,
      clientId: authority.clientId,
      scopes: Object.freeze([MCP_READ_SCOPE]),
      resource: authority.resource,
      firebaseAuthTimeSeconds: authority.firebaseAuthTimeSeconds,
      state: 'active',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      consumedAt: null,
      revokedAt: null,
    });
  return Object.freeze({
    access: Object.freeze({ raw: accessRaw, record: record(accessRaw, 'access', ACCESS_TOKEN_TTL_MS) }),
    refresh: Object.freeze({ raw: refreshRaw, record: record(refreshRaw, 'refresh', REFRESH_TOKEN_TTL_MS) }),
  });
}

function tokenResponse(accessToken: string, refreshToken: string): McpOAuthTokens {
  return Object.freeze({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_MS / 1_000,
    scope: MCP_READ_SCOPE,
    refresh_token: refreshToken,
  });
}

function assertActiveAuthorizationCode(
  code: McpOAuthAuthorizationCode | null,
  input: Readonly<{ clientId: string; redirectUri: string; resource: string }>,
  ownerUid: string,
  now: Date,
): asserts code is McpOAuthAuthorizationCode {
  if (
    !code
    || code.uid !== ownerUid
    || code.clientId !== input.clientId
    || code.redirectUri !== input.redirectUri
    || code.resource !== input.resource
    || code.consumedAt !== null
    || Date.parse(code.expiresAt) <= now.getTime()
    || !sameScopes(code.scopes)
  ) {
    throw new DomainError('UNAUTHENTICATED', 'OAuth authorization grant is invalid.');
  }
}

function assertActiveToken(
  record: McpOAuthTokenRecord | null,
  kind: McpOAuthTokenKind,
  clientId: string | null,
  ownerUid: string,
  resource: string,
  now: Date,
): asserts record is McpOAuthTokenRecord {
  if (
    !record
    || record.kind !== kind
    || record.uid !== ownerUid
    || (clientId !== null && record.clientId !== clientId)
    || record.resource !== resource
    || record.state !== 'active'
    || record.consumedAt !== null
    || record.revokedAt !== null
    || Date.parse(record.expiresAt) <= now.getTime()
    || !sameScopes(record.scopes)
  ) {
    throw new DomainError('UNAUTHENTICATED', 'OAuth token is invalid.');
  }
}

function authorizationRedirect(
  pending: McpOAuthPendingAuthorization,
  code: string,
  issuer: string,
): string {
  const redirect = new URL(pending.redirectUri);
  redirect.searchParams.set('code', code);
  redirect.searchParams.set('state', pending.state);
  redirect.searchParams.set('iss', issuer);
  return redirect.href;
}

function assertKnownClient(clientId: string, redirectUri: string): void {
  const expected = expectedRedirectUri(clientId);
  if (!expected || redirectUri !== expected) {
    throw new DomainError('INVALID_ARGUMENT', 'OAuth client or redirect URI is invalid.');
  }
}

function assertKnownClientId(clientId: string): void {
  if (!expectedRedirectUri(clientId)) {
    throw new DomainError('UNAUTHENTICATED', 'OAuth client is invalid.');
  }
}

function expectedRedirectUri(clientId: string): string | null {
  return clientId === CHATGPT_CIMD_CLIENT_ID ? CHATGPT_STABLE_REDIRECT_URI : null;
}

function assertScopes(scopes: readonly string[]): void {
  if (!sameScopes(scopes)) {
    throw new DomainError('FORBIDDEN', 'Only Life Tracker read access is available.');
  }
}

function sameScopes(scopes: readonly string[]): boolean {
  return scopes.length === 1 && scopes[0] === MCP_READ_SCOPE;
}

function assertResource(value: string, expected: string): void {
  if (value !== expected) {
    throw new DomainError('FORBIDDEN', 'OAuth resource is invalid.');
  }
}

function assertFirebaseIdToken(value: string): void {
  if (
    typeof value !== 'string'
    || value.length < 20
    || value.length > FIREBASE_ID_TOKEN_MAX_LENGTH
    || value.trim() !== value
    || /\s/.test(value)
  ) {
    throw new DomainError('UNAUTHENTICATED', 'Firebase authentication is required.');
  }
}

function assertOpaque(value: string, kind: 'pd' | 'cs' | 'cd' | 'at' | 'rt'): void {
  if (!OPAQUE_TOKEN_PATTERN.test(value) || !value.startsWith(`ltmcp_${kind}_`)) {
    throw new DomainError('UNAUTHENTICATED', 'OAuth credential is invalid.');
  }
}

function randomOpaque(kind: 'pd' | 'cs' | 'cd' | 'at' | 'rt'): string {
  return `ltmcp_${kind}_${randomBytes(32).toString('base64url')}`;
}

export function mcpOAuthHash(value: string): string {
  return sha256(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeStringEqual(left: string, right: string): boolean {
  const first = Buffer.from(left, 'utf8');
  const second = Buffer.from(right, 'utf8');
  return first.length === second.length && timingSafeEqual(first, second);
}

export function normalizeMcpCanonicalBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DomainError('INTERNAL', 'MCP canonical URL is invalid.');
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.pathname !== '/'
  ) {
    throw new DomainError('INTERNAL', 'MCP canonical URL is invalid.');
  }
  return parsed.origin;
}

export function assertMcpOAuthHash(value: string): void {
  if (!HASH_PATTERN.test(value)) {
    throw new DomainError('INVALID_ARGUMENT', 'MCP OAuth hash is invalid.');
  }
}
