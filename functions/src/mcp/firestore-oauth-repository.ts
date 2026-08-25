import {
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';
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

const UID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const CLIENT_ID_MAX = 512;
const URL_MAX = 2_048;
const STATE_MAX = 512;

/**
 * Server-only OAuth persistence. Every document path is rooted beneath the
 * configured private owner; only SHA-256 credential hashes are document IDs.
 */
export class FirestoreMcpOAuthRepository implements McpOAuthRepository {
  constructor(
    private readonly firestore: Firestore,
    private readonly ownerUid: string,
  ) {
    assertUid(ownerUid);
  }

  async createPending(record: McpOAuthPendingAuthorization): Promise<void> {
    assertPendingRecord(record, this.ownerUid);
    const reference = this.pendingRef(record.idHash);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) {
        throw new DomainError('CONFLICT', 'OAuth pending identifier already exists.');
      }
      transaction.create(reference, encodePending(record));
    });
  }

  async completePending(
    request: CompletePendingAuthorizationRequest,
  ): Promise<McpOAuthPendingAuthorization> {
    assertHash(request.pendingIdHash);
    assertHash(request.csrfHash);
    assertHash(request.code.codeHash);
    const pendingRef = this.pendingRef(request.pendingIdHash);
    const codeRef = this.codeRef(request.code.codeHash);
    return this.firestore.runTransaction(async (transaction) => {
      const [pendingSnapshot, codeSnapshot] = await transaction.getAll(pendingRef, codeRef);
      if (!pendingSnapshot || !codeSnapshot) {
        throw new DomainError('INTERNAL', 'OAuth transaction read is incomplete.');
      }
      const pending = decodePending(pendingSnapshot, this.ownerUid);
      assertPendingActive(pending, request.csrfHash, request.now);
      if (codeSnapshot.exists || request.code.uid !== this.ownerUid) {
        throw new DomainError('CONFLICT', 'OAuth authorization state conflicts.');
      }
      const completed = Object.freeze({
        ...pending,
        status: 'completed' as const,
        completedAt: normalizedInstant(request.now),
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
        firebaseAuthTimeSeconds: positiveInteger(request.code.firebaseAuthTimeSeconds),
        createdAt: normalizedInstant(request.code.createdAt),
        expiresAt: normalizedInstant(request.code.expiresAt),
        consumedAt: null,
      });
      assertCodeRecord(code, this.ownerUid);
      transaction.set(pendingRef, encodePending(completed));
      transaction.create(codeRef, encodeCode(code));
      return completed;
    });
  }

  async denyPending(
    request: DenyPendingAuthorizationRequest,
  ): Promise<McpOAuthPendingAuthorization> {
    assertHash(request.pendingIdHash);
    assertHash(request.csrfHash);
    const reference = this.pendingRef(request.pendingIdHash);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const pending = decodePending(snapshot, this.ownerUid);
      assertPendingActive(pending, request.csrfHash, request.now);
      const denied = Object.freeze({
        ...pending,
        status: 'denied' as const,
        completedAt: normalizedInstant(request.now),
      });
      transaction.set(reference, encodePending(denied));
      return denied;
    });
  }

  async getAuthorizationCode(codeHash: string): Promise<McpOAuthAuthorizationCode | null> {
    assertHash(codeHash);
    const snapshot = await this.codeRef(codeHash).get();
    return snapshot.exists ? decodeCode(snapshot, this.ownerUid) : null;
  }

  async exchangeAuthorizationCode(
    request: ExchangeAuthorizationCodeRequest,
  ): Promise<McpOAuthAuthorizationCode> {
    assertHash(request.codeHash);
    assertTokenRecord(request.access, this.ownerUid, 'access');
    assertTokenRecord(request.refresh, this.ownerUid, 'refresh');
    assertDistinctNewTokens(request.access, request.refresh);
    const codeRef = this.codeRef(request.codeHash);
    const accessRef = this.accessRef(request.access.tokenHash);
    const refreshRef = this.refreshRef(request.refresh.tokenHash);
    return this.firestore.runTransaction(async (transaction) => {
      const [codeSnapshot, accessSnapshot, refreshSnapshot] = await transaction.getAll(
        codeRef,
        accessRef,
        refreshRef,
      );
      if (!codeSnapshot || !accessSnapshot || !refreshSnapshot) {
        throw new DomainError('INTERNAL', 'OAuth transaction read is incomplete.');
      }
      const code = decodeCode(codeSnapshot, this.ownerUid);
      if (
        code.consumedAt !== null
        || code.clientId !== request.clientId
        || code.redirectUri !== request.redirectUri
        || code.resource !== request.resource
        || Date.parse(code.expiresAt) <= Date.parse(request.now)
        || accessSnapshot.exists
        || refreshSnapshot.exists
      ) throw new DomainError('UNAUTHENTICATED', 'OAuth authorization grant is invalid.');
      assertTokenAuthority(code, request.access, request.refresh);
      const consumed = Object.freeze({
        ...code,
        consumedAt: normalizedInstant(request.now),
      });
      transaction.set(codeRef, encodeCode(consumed));
      transaction.create(accessRef, encodeToken(request.access));
      transaction.create(refreshRef, encodeToken(request.refresh));
      return consumed;
    });
  }

  async getRefreshToken(tokenHash: string): Promise<McpOAuthTokenRecord | null> {
    assertHash(tokenHash);
    const snapshot = await this.refreshRef(tokenHash).get();
    return snapshot.exists ? decodeToken(snapshot, this.ownerUid, 'refresh') : null;
  }

  async rotateRefreshToken(
    request: RotateRefreshTokenRequest,
  ): Promise<McpOAuthTokenRecord> {
    assertHash(request.refreshHash);
    assertTokenRecord(request.access, this.ownerUid, 'access');
    assertTokenRecord(request.refresh, this.ownerUid, 'refresh');
    assertDistinctNewTokens(request.access, request.refresh);
    if (
      request.refreshHash === request.access.tokenHash
      || request.refreshHash === request.refresh.tokenHash
    ) throw new DomainError('CONFLICT', 'OAuth token identifier already exists.');
    const oldRef = this.refreshRef(request.refreshHash);
    const accessRef = this.accessRef(request.access.tokenHash);
    const refreshRef = this.refreshRef(request.refresh.tokenHash);
    return this.firestore.runTransaction(async (transaction) => {
      const [oldSnapshot, accessSnapshot, refreshSnapshot] = await transaction.getAll(
        oldRef,
        accessRef,
        refreshRef,
      );
      if (!oldSnapshot || !accessSnapshot || !refreshSnapshot) {
        throw new DomainError('INTERNAL', 'OAuth transaction read is incomplete.');
      }
      const existing = decodeToken(oldSnapshot, this.ownerUid, 'refresh');
      if (
        existing.state !== 'active'
        || existing.consumedAt !== null
        || existing.revokedAt !== null
        || existing.clientId !== request.clientId
        || existing.resource !== request.resource
        || !sameScopes(existing.scopes, request.scopes)
        || Date.parse(existing.expiresAt) <= Date.parse(request.now)
        || accessSnapshot.exists
        || refreshSnapshot.exists
      ) throw new DomainError('UNAUTHENTICATED', 'OAuth refresh token is invalid.');
      assertTokenAuthority(existing, request.access, request.refresh);
      const consumed = Object.freeze({
        ...existing,
        state: 'consumed' as const,
        consumedAt: normalizedInstant(request.now),
      });
      transaction.set(oldRef, encodeToken(consumed));
      transaction.create(accessRef, encodeToken(request.access));
      transaction.create(refreshRef, encodeToken(request.refresh));
      return consumed;
    });
  }

  async getAccessToken(tokenHash: string): Promise<McpOAuthTokenRecord | null> {
    assertHash(tokenHash);
    const snapshot = await this.accessRef(tokenHash).get();
    return snapshot.exists ? decodeToken(snapshot, this.ownerUid, 'access') : null;
  }

  async revokeToken(tokenHash: string, clientId: string, now: string): Promise<void> {
    assertHash(tokenHash);
    const at = normalizedInstant(now);
    const accessRef = this.accessRef(tokenHash);
    const refreshRef = this.refreshRef(tokenHash);
    await this.firestore.runTransaction(async (transaction) => {
      const [accessSnapshot, refreshSnapshot] = await transaction.getAll(accessRef, refreshRef);
      if (!accessSnapshot || !refreshSnapshot) {
        throw new DomainError('INTERNAL', 'OAuth revocation read is incomplete.');
      }
      if (accessSnapshot.exists) {
        const access = decodeToken(accessSnapshot, this.ownerUid, 'access');
        if (access.clientId === clientId && access.revokedAt === null) {
          transaction.set(accessRef, encodeToken(Object.freeze({
            ...access,
            state: 'revoked' as const,
            revokedAt: at,
          })));
        }
      }
      if (refreshSnapshot.exists) {
        const refresh = decodeToken(refreshSnapshot, this.ownerUid, 'refresh');
        if (refresh.clientId === clientId && refresh.revokedAt === null) {
          transaction.set(refreshRef, encodeToken(Object.freeze({
            ...refresh,
            state: 'revoked' as const,
            revokedAt: at,
          })));
        }
      }
    });
  }

  private pendingRef(hash: string) {
    return this.firestore.doc(`users/${this.ownerUid}/mcpOAuthPendingAuthorizations/${hash}`);
  }

  private codeRef(hash: string) {
    return this.firestore.doc(`users/${this.ownerUid}/mcpOAuthAuthorizationCodes/${hash}`);
  }

  private accessRef(hash: string) {
    return this.firestore.doc(`users/${this.ownerUid}/mcpOAuthAccessTokens/${hash}`);
  }

  private refreshRef(hash: string) {
    return this.firestore.doc(`users/${this.ownerUid}/mcpOAuthRefreshTokens/${hash}`);
  }
}

function encodePending(record: McpOAuthPendingAuthorization): DocumentData {
  assertPendingRecord(record, record.uid);
  return {
    ...record,
    createdAt: timestamp(record.createdAt),
    expiresAt: timestamp(record.expiresAt),
    completedAt: nullableTimestamp(record.completedAt),
    purgeAt: timestamp(record.expiresAt),
  };
}

function encodeCode(record: McpOAuthAuthorizationCode): DocumentData {
  assertCodeRecord(record, record.uid);
  return {
    ...record,
    createdAt: timestamp(record.createdAt),
    expiresAt: timestamp(record.expiresAt),
    consumedAt: nullableTimestamp(record.consumedAt),
    purgeAt: timestamp(record.expiresAt),
  };
}

function encodeToken(record: McpOAuthTokenRecord): DocumentData {
  assertTokenRecord(record, record.uid, record.kind);
  return {
    ...record,
    createdAt: timestamp(record.createdAt),
    expiresAt: timestamp(record.expiresAt),
    consumedAt: nullableTimestamp(record.consumedAt),
    revokedAt: nullableTimestamp(record.revokedAt),
    purgeAt: timestamp(record.expiresAt),
  };
}

function decodePending(
  snapshot: DocumentSnapshot,
  uid: string,
): McpOAuthPendingAuthorization {
  if (!snapshot.exists) {
    throw new DomainError('UNAUTHENTICATED', 'OAuth authorization request is invalid.');
  }
  const value = snapshot.data() ?? {};
  const record: McpOAuthPendingAuthorization = Object.freeze({
    schemaVersion: schema(value.schemaVersion),
    idHash: hash(value.idHash),
    uid: owner(value.uid, uid),
    clientId: boundedString(value.clientId, CLIENT_ID_MAX),
    redirectUri: boundedString(value.redirectUri, URL_MAX),
    state: boundedString(value.state, STATE_MAX),
    scopes: scopes(value.scopes),
    codeChallenge: boundedString(value.codeChallenge, 128),
    resource: boundedString(value.resource, URL_MAX),
    csrfHash: hash(value.csrfHash),
    status: pendingState(value.status),
    createdAt: instant(value.createdAt),
    expiresAt: instant(value.expiresAt),
    completedAt: nullableInstant(value.completedAt),
  });
  if (record.idHash !== snapshot.id) {
    throw new DomainError('INTERNAL', 'Stored OAuth pending identity is invalid.');
  }
  assertPendingRecord(record, uid);
  return record;
}

function decodeCode(
  snapshot: DocumentSnapshot,
  uid: string,
): McpOAuthAuthorizationCode {
  if (!snapshot.exists) {
    throw new DomainError('UNAUTHENTICATED', 'OAuth authorization grant is invalid.');
  }
  const value = snapshot.data() ?? {};
  const record: McpOAuthAuthorizationCode = Object.freeze({
    schemaVersion: schema(value.schemaVersion),
    codeHash: hash(value.codeHash),
    uid: owner(value.uid, uid),
    clientId: boundedString(value.clientId, CLIENT_ID_MAX),
    redirectUri: boundedString(value.redirectUri, URL_MAX),
    scopes: scopes(value.scopes),
    codeChallenge: boundedString(value.codeChallenge, 128),
    resource: boundedString(value.resource, URL_MAX),
    firebaseAuthTimeSeconds: positiveInteger(value.firebaseAuthTimeSeconds),
    createdAt: instant(value.createdAt),
    expiresAt: instant(value.expiresAt),
    consumedAt: nullableInstant(value.consumedAt),
  });
  if (record.codeHash !== snapshot.id) {
    throw new DomainError('INTERNAL', 'Stored OAuth code identity is invalid.');
  }
  assertCodeRecord(record, uid);
  return record;
}

function decodeToken(
  snapshot: DocumentSnapshot,
  uid: string,
  expectedKind: 'access' | 'refresh',
): McpOAuthTokenRecord {
  if (!snapshot.exists) throw new DomainError('UNAUTHENTICATED', 'OAuth token is invalid.');
  const value = snapshot.data() ?? {};
  const record: McpOAuthTokenRecord = Object.freeze({
    schemaVersion: schema(value.schemaVersion),
    tokenHash: hash(value.tokenHash),
    kind: tokenKind(value.kind),
    uid: owner(value.uid, uid),
    clientId: boundedString(value.clientId, CLIENT_ID_MAX),
    scopes: scopes(value.scopes),
    resource: boundedString(value.resource, URL_MAX),
    firebaseAuthTimeSeconds: positiveInteger(value.firebaseAuthTimeSeconds),
    state: tokenState(value.state),
    createdAt: instant(value.createdAt),
    expiresAt: instant(value.expiresAt),
    consumedAt: nullableInstant(value.consumedAt),
    revokedAt: nullableInstant(value.revokedAt),
  });
  if (record.tokenHash !== snapshot.id || record.kind !== expectedKind) {
    throw new DomainError('INTERNAL', 'Stored OAuth token identity is invalid.');
  }
  assertTokenRecord(record, uid, expectedKind);
  return record;
}

function assertPendingRecord(record: McpOAuthPendingAuthorization, uid: string): void {
  if (
    record.schemaVersion !== MCP_OAUTH_SCHEMA_VERSION
    || record.uid !== uid
    || !HASH_PATTERN.test(record.idHash)
    || !HASH_PATTERN.test(record.csrfHash)
    || !sameScopes(record.scopes, [MCP_READ_SCOPE])
    || Date.parse(record.createdAt) >= Date.parse(record.expiresAt)
    || (record.status === 'pending') !== (record.completedAt === null)
  ) throw new DomainError('INTERNAL', 'OAuth pending record is invalid.');
}

function assertCodeRecord(record: McpOAuthAuthorizationCode, uid: string): void {
  if (
    record.schemaVersion !== MCP_OAUTH_SCHEMA_VERSION
    || record.uid !== uid
    || !HASH_PATTERN.test(record.codeHash)
    || !sameScopes(record.scopes, [MCP_READ_SCOPE])
    || Date.parse(record.createdAt) >= Date.parse(record.expiresAt)
    || !Number.isInteger(record.firebaseAuthTimeSeconds)
    || record.firebaseAuthTimeSeconds <= 0
  ) throw new DomainError('INTERNAL', 'OAuth authorization code record is invalid.');
}

function assertTokenRecord(
  record: McpOAuthTokenRecord,
  uid: string,
  kind: 'access' | 'refresh',
): void {
  const coherentState = record.state === 'active'
    ? record.consumedAt === null && record.revokedAt === null
    : record.state === 'consumed'
      ? record.consumedAt !== null && record.revokedAt === null
      : record.revokedAt !== null;
  if (
    record.schemaVersion !== MCP_OAUTH_SCHEMA_VERSION
    || record.uid !== uid
    || record.kind !== kind
    || !HASH_PATTERN.test(record.tokenHash)
    || !sameScopes(record.scopes, [MCP_READ_SCOPE])
    || Date.parse(record.createdAt) >= Date.parse(record.expiresAt)
    || !Number.isInteger(record.firebaseAuthTimeSeconds)
    || record.firebaseAuthTimeSeconds <= 0
    || !coherentState
  ) throw new DomainError('INTERNAL', 'OAuth token record is invalid.');
}

function assertPendingActive(
  pending: McpOAuthPendingAuthorization,
  csrfHash: string,
  now: string,
): void {
  if (
    pending.status !== 'pending'
    || pending.completedAt !== null
    || pending.csrfHash !== csrfHash
    || Date.parse(pending.expiresAt) <= Date.parse(now)
  ) throw new DomainError('UNAUTHENTICATED', 'OAuth authorization request is invalid.');
}

function assertTokenAuthority(
  authority: Pick<McpOAuthAuthorizationCode, 'uid' | 'clientId' | 'resource' | 'scopes' | 'firebaseAuthTimeSeconds'>,
  access: McpOAuthTokenRecord,
  refresh: McpOAuthTokenRecord,
): void {
  if (
    access.uid !== authority.uid
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

function assertDistinctNewTokens(
  access: McpOAuthTokenRecord,
  refresh: McpOAuthTokenRecord,
): void {
  if (access.tokenHash === refresh.tokenHash) {
    throw new DomainError('CONFLICT', 'OAuth token identifier already exists.');
  }
}

function schema(value: unknown): typeof MCP_OAUTH_SCHEMA_VERSION {
  if (value !== MCP_OAUTH_SCHEMA_VERSION) {
    throw new DomainError('INTERNAL', 'Stored OAuth schema is invalid.');
  }
  return value;
}

function owner(value: unknown, uid: string): string {
  if (value !== uid) throw new DomainError('INTERNAL', 'Stored OAuth owner is invalid.');
  return uid;
}

function hash(value: unknown): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new DomainError('INTERNAL', 'Stored OAuth hash is invalid.');
  }
  return value;
}

function assertHash(value: string): void {
  if (!HASH_PATTERN.test(value)) {
    throw new DomainError('INVALID_ARGUMENT', 'OAuth identifier is invalid.');
  }
}

function assertUid(value: string): void {
  if (!UID_PATTERN.test(value)) {
    throw new DomainError('INTERNAL', 'MCP owner configuration is invalid.');
  }
}

function boundedString(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new DomainError('INTERNAL', 'Stored OAuth text is invalid.');
  return value;
}

function scopes(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !sameScopes(value, [MCP_READ_SCOPE])) {
    throw new DomainError('INTERNAL', 'Stored OAuth scopes are invalid.');
  }
  return Object.freeze([MCP_READ_SCOPE]);
}

function pendingState(value: unknown): McpOAuthPendingAuthorization['status'] {
  if (value !== 'pending' && value !== 'completed' && value !== 'denied') {
    throw new DomainError('INTERNAL', 'Stored OAuth pending state is invalid.');
  }
  return value;
}

function tokenKind(value: unknown): McpOAuthTokenRecord['kind'] {
  if (value !== 'access' && value !== 'refresh') {
    throw new DomainError('INTERNAL', 'Stored OAuth token kind is invalid.');
  }
  return value;
}

function tokenState(value: unknown): McpOAuthTokenRecord['state'] {
  if (value !== 'active' && value !== 'consumed' && value !== 'revoked') {
    throw new DomainError('INTERNAL', 'Stored OAuth token state is invalid.');
  }
  return value;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new DomainError('INTERNAL', 'Stored OAuth integer is invalid.');
  }
  return value;
}

function normalizedInstant(value: string): string {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new DomainError('INVALID_ARGUMENT', 'OAuth time is invalid.');
  return new Date(epoch).toISOString();
}

function timestamp(value: string): Timestamp {
  return Timestamp.fromDate(new Date(normalizedInstant(value)));
}

function nullableTimestamp(value: string | null): Timestamp | null {
  return value === null ? null : timestamp(value);
}

function instant(value: unknown): string {
  if (!(value instanceof Timestamp)) {
    throw new DomainError('INTERNAL', 'Stored OAuth time is invalid.');
  }
  return value.toDate().toISOString();
}

function nullableInstant(value: unknown): string | null {
  return value === null ? null : instant(value);
}

function sameScopes(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === 1
    && right.length === 1
    && left[0] === MCP_READ_SCOPE
    && right[0] === MCP_READ_SCOPE;
}
