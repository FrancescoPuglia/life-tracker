export const MCP_OAUTH_SCHEMA_VERSION = 'life-tracker-mcp-oauth-v1' as const;

export type McpOAuthPendingState = 'pending' | 'completed' | 'denied';
export type McpOAuthTokenKind = 'access' | 'refresh';
export type McpOAuthTokenState = 'active' | 'consumed' | 'revoked';

export interface McpOAuthPendingAuthorization {
  readonly schemaVersion: typeof MCP_OAUTH_SCHEMA_VERSION;
  readonly idHash: string;
  readonly uid: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly scopes: readonly string[];
  readonly codeChallenge: string;
  readonly resource: string;
  readonly csrfHash: string;
  readonly status: McpOAuthPendingState;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly completedAt: string | null;
}

export interface McpOAuthAuthorizationCode {
  readonly schemaVersion: typeof MCP_OAUTH_SCHEMA_VERSION;
  readonly codeHash: string;
  readonly uid: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly codeChallenge: string;
  readonly resource: string;
  readonly firebaseAuthTimeSeconds: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
}

export interface McpOAuthTokenRecord {
  readonly schemaVersion: typeof MCP_OAUTH_SCHEMA_VERSION;
  readonly tokenHash: string;
  readonly kind: McpOAuthTokenKind;
  readonly uid: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly resource: string;
  readonly firebaseAuthTimeSeconds: number;
  readonly state: McpOAuthTokenState;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly revokedAt: string | null;
}

export interface CompletePendingAuthorizationRequest {
  readonly pendingIdHash: string;
  readonly csrfHash: string;
  /** Remaining authority fields are copied from the stored pending request. */
  readonly code: Readonly<{
    codeHash: string;
    uid: string;
    firebaseAuthTimeSeconds: number;
    createdAt: string;
    expiresAt: string;
  }>;
  readonly now: string;
}

export interface DenyPendingAuthorizationRequest {
  readonly pendingIdHash: string;
  readonly csrfHash: string;
  readonly now: string;
}

export interface ExchangeAuthorizationCodeRequest {
  readonly codeHash: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly resource: string;
  readonly access: McpOAuthTokenRecord;
  readonly refresh: McpOAuthTokenRecord;
  readonly now: string;
}

export interface RotateRefreshTokenRequest {
  readonly refreshHash: string;
  readonly clientId: string;
  readonly resource: string;
  readonly scopes: readonly string[];
  readonly access: McpOAuthTokenRecord;
  readonly refresh: McpOAuthTokenRecord;
  readonly now: string;
}

export interface McpOAuthRepository {
  createPending(record: McpOAuthPendingAuthorization): Promise<void>;
  completePending(
    request: CompletePendingAuthorizationRequest,
  ): Promise<McpOAuthPendingAuthorization>;
  denyPending(
    request: DenyPendingAuthorizationRequest,
  ): Promise<McpOAuthPendingAuthorization>;
  getAuthorizationCode(codeHash: string): Promise<McpOAuthAuthorizationCode | null>;
  exchangeAuthorizationCode(
    request: ExchangeAuthorizationCodeRequest,
  ): Promise<McpOAuthAuthorizationCode>;
  getRefreshToken(tokenHash: string): Promise<McpOAuthTokenRecord | null>;
  rotateRefreshToken(request: RotateRefreshTokenRequest): Promise<McpOAuthTokenRecord>;
  getAccessToken(tokenHash: string): Promise<McpOAuthTokenRecord | null>;
  revokeToken(tokenHash: string, clientId: string, now: string): Promise<void>;
}

export interface VerifiedFirebaseMcpIdentity {
  readonly uid: string;
  readonly authTimeSeconds: number;
}

export interface FirebaseMcpIdentityVerifier {
  verifyIdToken(token: string): Promise<VerifiedFirebaseMcpIdentity>;
  assertAccountActive(uid: string, authTimeSeconds: number): Promise<void>;
}
