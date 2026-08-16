import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { DomainError } from '../domain/errors';
import type { RateLimiter, RateLimitRequest } from './types';

interface StoredRateLimit {
  readonly bucket: string;
  readonly count: number;
  readonly windowStartedAt: Timestamp;
  readonly expiresAt: Timestamp;
}

/** Firestore-backed fixed-window protection shared by all function instances. */
export class FirestoreRateLimiter implements RateLimiter {
  constructor(private readonly firestore: Firestore) {}

  async consume(request: RateLimitRequest): Promise<void> {
    const key = createHash('sha256')
      .update(`${request.uid}:${request.bucket}`)
      .digest('hex');
    const reference = this.firestore.collection('aiRateLimits').doc(key);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists ? snapshot.data() as Partial<StoredRateLimit> : null;
      const nowMs = request.now.getTime();
      const startedAtMs = current?.windowStartedAt instanceof Timestamp
        ? current.windowStartedAt.toMillis()
        : Number.NaN;
      const inWindow = Number.isFinite(startedAtMs) && nowMs - startedAtMs < request.windowMs;
      const count = inWindow && typeof current?.count === 'number' ? current.count : 0;
      if (count >= request.limit) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((startedAtMs + request.windowMs - nowMs) / 1_000),
        );
        throw new DomainError('RATE_LIMITED', 'Rate limit exceeded.', { retryAfterSeconds });
      }
      const nextStartedAt = inWindow ? startedAtMs : nowMs;
      transaction.set(reference, {
        bucket: request.bucket,
        count: count + 1,
        windowStartedAt: Timestamp.fromMillis(nextStartedAt),
        expiresAt: Timestamp.fromMillis(nextStartedAt + request.windowMs * 2),
      } satisfies StoredRateLimit);
    });
  }
}
