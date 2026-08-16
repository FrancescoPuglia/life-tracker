import type { Auth } from 'firebase-admin/auth';
import { DomainError } from '../domain/errors';
import type { HeaderValue, TokenVerifier, VerifiedIdentity } from './types';

const MAX_ID_TOKEN_LENGTH = 16_384;
const BEARER_PREFIX = 'Bearer ';
const SAFE_UID = /^[A-Za-z0-9:_-]{1,128}$/;

export function parseBearerToken(value: HeaderValue): string {
  if (typeof value !== 'string' || !value.startsWith(BEARER_PREFIX)) {
    throw new DomainError('UNAUTHENTICATED', 'Authentication is required.');
  }
  const token = value.slice(BEARER_PREFIX.length);
  if (
    token.length < 20
    || token.length > MAX_ID_TOKEN_LENGTH
    || token.trim() !== token
    || /\s/.test(token)
  ) {
    throw new DomainError('UNAUTHENTICATED', 'Authentication is required.');
  }
  return token;
}

export class FirebaseTokenVerifier implements TokenVerifier {
  constructor(private readonly auth: Pick<Auth, 'verifyIdToken'>) {}

  async verifyBearerToken(token: string): Promise<VerifiedIdentity> {
    try {
      const decoded = await this.auth.verifyIdToken(token, true);
      if (!SAFE_UID.test(decoded.uid)) {
        throw new Error('invalid uid');
      }
      return { uid: decoded.uid };
    } catch {
      // Never expose Firebase error details or token material.
      throw new DomainError('UNAUTHENTICATED', 'Authentication is required.');
    }
  }
}
