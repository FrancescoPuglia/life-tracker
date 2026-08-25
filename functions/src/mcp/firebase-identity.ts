import type { Auth } from 'firebase-admin/auth';
import { DomainError } from '../domain/errors';
import type {
  FirebaseMcpIdentityVerifier,
  VerifiedFirebaseMcpIdentity,
} from './oauth-types';

const UID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

/** Firebase Authentication is the sole user identity and revocation authority. */
export class AdminFirebaseMcpIdentityVerifier implements FirebaseMcpIdentityVerifier {
  constructor(
    private readonly auth: Pick<Auth, 'verifyIdToken' | 'getUser'>,
  ) {}

  async verifyIdToken(token: string): Promise<VerifiedFirebaseMcpIdentity> {
    try {
      const decoded = await this.auth.verifyIdToken(token, true);
      if (
        !UID_PATTERN.test(decoded.uid)
        || typeof decoded.auth_time !== 'number'
        || !Number.isInteger(decoded.auth_time)
        || decoded.auth_time <= 0
      ) throw new Error('invalid Firebase identity');
      return Object.freeze({
        uid: decoded.uid,
        authTimeSeconds: decoded.auth_time,
      });
    } catch {
      throw new DomainError('UNAUTHENTICATED', 'Firebase authentication is required.');
    }
  }

  async assertAccountActive(uid: string, authTimeSeconds: number): Promise<void> {
    try {
      if (
        !UID_PATTERN.test(uid)
        || !Number.isInteger(authTimeSeconds)
        || authTimeSeconds <= 0
      ) throw new Error('invalid Firebase identity');
      const user = await this.auth.getUser(uid);
      const tokensValidAfterMs = user.tokensValidAfterTime
        ? Date.parse(user.tokensValidAfterTime)
        : 0;
      if (
        user.disabled
        || !Number.isFinite(tokensValidAfterMs)
        || authTimeSeconds * 1_000 < tokensValidAfterMs
      ) throw new Error('Firebase account is inactive or revoked');
    } catch {
      throw new DomainError('UNAUTHENTICATED', 'Firebase authentication is required.');
    }
  }
}
