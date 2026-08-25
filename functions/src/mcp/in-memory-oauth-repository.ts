import { DomainError } from '../domain/errors';
import { MCP_READ_SCOPE } from './tool-contracts';
import {
  MCP_OAUTH_SCHEMA_VERSION,
  type CompletePendingAuthorizationRequest,
  type DenyPendingAuthorizationRequest,
  type ExchangeAuthorizationCodeRequest,
  type McpOAuthAuthorizationCode,
  type McpOAuthPendingAuthorization,
  type McpOAuthRepository,
  type McpOAuthTokenRecord,
  type RotateRefreshTokenRequest,
} from './oauth-types';

/** Deterministic repository used only by unit/transport tests. */
export class InMemoryMcpOAuthRepository implements McpOAuthRepository {
  private readonly pending = new Map<string, McpOAuthPendingAuthorization>();
  private readonly codes = new Map<string, McpOAuthAuthorizationCode>();
  private readonly access = new Map<string, McpOAuthTokenRecord>();
  private readonly refresh = new Map<string, McpOAuthTokenRecord>();

  async createPending(record: McpOAuthPendingAuthorization): Promise<void> {
    if (this.pending.has(record.idHash)) {
      throw new DomainError('CONFLICT', 'OAuth pending identifier already exists.');
    }
    this.pending.set(record.idHash, record);
  }

  async completePending(
    request: CompletePendingAuthorizationRequest,
  ): Promise<McpOAuthPendingAuthorization> {
    const pending = this.pending.get(request.pendingIdHash);
    assertPending(pending, request.csrfHash, request.now);
    if (request.code.uid !== pending.uid || this.codes.has(request.code.codeHash)) {
      throw new DomainError('CONFLICT', 'OAuth authorization state conflicts.');
    }
    const completed = Object.freeze({
      ...pending,
      status: 'completed' as const,
      completedAt: request.now,
    });
    const code: McpOAuthAuthorizationCode = Object.freeze({
      schemaVersion: MCP_OAUTH_SCHEMA_VERSION,
      codeHash: request.code.codeHash,
      uid: pending.uid,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      scopes: pending.scopes,
      codeChallenge: pending.codeChallenge,
      resource: pending.resource,
      firebaseAuthTimeSeconds: request.code.firebaseAuthTimeSeconds,
      createdAt: request.code.createdAt,
      expiresAt: request.code.expiresAt,
      consumedAt: null,
    });
    this.pending.set(request.pendingIdHash, completed);
    this.codes.set(code.codeHash, code);
    return completed;
  }

  async denyPending(
    request: DenyPendingAuthorizationRequest,
  ): Promise<McpOAuthPendingAuthorization> {
    const pending = this.pending.get(request.pendingIdHash);
    assertPending(pending, request.csrfHash, request.now);
    const denied = Object.freeze({
      ...pending,
      status: 'denied' as const,
      completedAt: request.now,
    });
    this.pending.set(request.pendingIdHash, denied);
    return denied;
  }

  async getAuthorizationCode(codeHash: string): Promise<McpOAuthAuthorizationCode | null> {
    return this.codes.get(codeHash) ?? null;
  }

  async exchangeAuthorizationCode(
    request: ExchangeAuthorizationCodeRequest,
  ): Promise<McpOAuthAuthorizationCode> {
    const code = this.codes.get(request.codeHash);
    if (
      !code
      || code.consumedAt !== null
      || code.clientId !== request.clientId
      || code.redirectUri !== request.redirectUri
      || code.resource !== request.resource
      || Date.parse(code.expiresAt) <= Date.parse(request.now)
    ) throw new DomainError('UNAUTHENTICATED', 'OAuth authorization grant is invalid.');
    assertIssuedPair(code, request.access, request.refresh);
    assertFreshTokenIds(this.access, this.refresh, request.access, request.refresh);
    const consumed = Object.freeze({ ...code, consumedAt: request.now });
    this.codes.set(request.codeHash, consumed);
    this.access.set(request.access.tokenHash, request.access);
    this.refresh.set(request.refresh.tokenHash, request.refresh);
    return consumed;
  }

  async getRefreshToken(tokenHash: string): Promise<McpOAuthTokenRecord | null> {
    return this.refresh.get(tokenHash) ?? null;
  }

  async rotateRefreshToken(
    request: RotateRefreshTokenRequest,
  ): Promise<McpOAuthTokenRecord> {
    const existing = this.refresh.get(request.refreshHash);
    if (
      !existing
      || existing.state !== 'active'
      || existing.consumedAt !== null
      || existing.revokedAt !== null
      || existing.clientId !== request.clientId
      || existing.resource !== request.resource
      || !sameScopes(existing.scopes, request.scopes)
      || Date.parse(existing.expiresAt) <= Date.parse(request.now)
    ) throw new DomainError('UNAUTHENTICATED', 'OAuth refresh token is invalid.');
    assertIssuedPair(existing, request.access, request.refresh);
    assertFreshTokenIds(this.access, this.refresh, request.access, request.refresh);
    const consumed = Object.freeze({
      ...existing,
      state: 'consumed' as const,
      consumedAt: request.now,
    });
    this.refresh.set(request.refreshHash, consumed);
    this.access.set(request.access.tokenHash, request.access);
    this.refresh.set(request.refresh.tokenHash, request.refresh);
    return consumed;
  }

  async getAccessToken(tokenHash: string): Promise<McpOAuthTokenRecord | null> {
    return this.access.get(tokenHash) ?? null;
  }

  async revokeToken(tokenHash: string, clientId: string, now: string): Promise<void> {
    for (const collection of [this.access, this.refresh]) {
      const token = collection.get(tokenHash);
      if (token?.clientId === clientId && token.revokedAt === null) {
        collection.set(tokenHash, Object.freeze({
          ...token,
          state: 'revoked' as const,
          revokedAt: now,
        }));
      }
    }
  }
}

function assertPending(
  pending: McpOAuthPendingAuthorization | undefined,
  csrfHash: string,
  now: string,
): asserts pending is McpOAuthPendingAuthorization {
  if (
    !pending
    || pending.status !== 'pending'
    || pending.completedAt !== null
    || pending.csrfHash !== csrfHash
    || Date.parse(pending.expiresAt) <= Date.parse(now)
  ) throw new DomainError('UNAUTHENTICATED', 'OAuth authorization request is invalid.');
}

function assertIssuedPair(
  authority: Pick<McpOAuthAuthorizationCode, 'uid' | 'clientId' | 'resource' | 'scopes' | 'firebaseAuthTimeSeconds'>,
  access: McpOAuthTokenRecord,
  refresh: McpOAuthTokenRecord,
): void {
  if (
    access.kind !== 'access'
    || refresh.kind !== 'refresh'
    || access.uid !== authority.uid
    || refresh.uid !== authority.uid
    || access.clientId !== authority.clientId
    || refresh.clientId !== authority.clientId
    || access.resource !== authority.resource
    || refresh.resource !== authority.resource
    || access.firebaseAuthTimeSeconds !== authority.firebaseAuthTimeSeconds
    || refresh.firebaseAuthTimeSeconds !== authority.firebaseAuthTimeSeconds
    || !sameScopes(access.scopes, authority.scopes)
    || !sameScopes(refresh.scopes, authority.scopes)
  ) throw new DomainError('INTERNAL', 'OAuth token authority is inconsistent.');
}

function assertFreshTokenIds(
  accessRecords: ReadonlyMap<string, McpOAuthTokenRecord>,
  refreshRecords: ReadonlyMap<string, McpOAuthTokenRecord>,
  access: McpOAuthTokenRecord,
  refresh: McpOAuthTokenRecord,
): void {
  if (
    access.tokenHash === refresh.tokenHash
    || accessRecords.has(access.tokenHash)
    || refreshRecords.has(refresh.tokenHash)
  ) throw new DomainError('CONFLICT', 'OAuth token identifier already exists.');
}

function sameScopes(left: readonly string[], right: readonly string[]): boolean {
  return left.length === 1
    && right.length === 1
    && left[0] === MCP_READ_SCOPE
    && right[0] === MCP_READ_SCOPE;
}
