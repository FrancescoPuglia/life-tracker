import { Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { DomainError } from '../domain/errors';

const UID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

export interface McpReadRateLimiter {
  consume(uid: string, now: Date): Promise<void>;
}

export class FirestoreMcpReadRateLimiter implements McpReadRateLimiter {
  constructor(
    private readonly firestore: Firestore,
    private readonly limit = 60,
    private readonly windowMs = 60_000,
  ) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('MCP rate limit configuration is invalid.');
    }
    if (!Number.isInteger(windowMs) || windowMs < 1_000 || windowMs > 3_600_000) {
      throw new Error('MCP rate limit window is invalid.');
    }
  }

  async consume(uid: string, now: Date): Promise<void> {
    if (!UID_PATTERN.test(uid) || !Number.isFinite(now.getTime())) {
      throw new DomainError('UNAUTHENTICATED', 'MCP read identity is invalid.');
    }
    const reference = this.firestore.doc(`users/${uid}/mcpReadRateLimits/default`);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const nowMs = now.getTime();
      const current = snapshot.exists
        ? decodeRateLimit(snapshot.data(), uid, this.limit, this.windowMs, nowMs)
        : null;
      const inWindow = current !== null && nowMs - current.startedAtMs < this.windowMs;
      const count = inWindow ? current.count : 0;
      const startedAtMs = current?.startedAtMs ?? nowMs;
      if (count >= this.limit) {
        throw new DomainError('RATE_LIMITED', 'MCP read rate limit exceeded.', {
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((startedAtMs + this.windowMs - nowMs) / 1_000),
          ),
        });
      }
      const windowStartedAt = inWindow ? startedAtMs : nowMs;
      transaction.set(reference, {
        schemaVersion: 'life-tracker-mcp-read-rate-limit-v1',
        uid,
        count: count + 1,
        windowStartedAt: Timestamp.fromMillis(windowStartedAt),
        purgeAt: Timestamp.fromMillis(windowStartedAt + this.windowMs * 2),
      });
    });
  }
}

function decodeRateLimit(
  value: DocumentData | undefined,
  uid: string,
  limit: number,
  windowMs: number,
  nowMs: number,
): Readonly<{ count: number; startedAtMs: number }> {
  const startedAtMs = value?.windowStartedAt instanceof Timestamp
    ? value.windowStartedAt.toMillis()
    : Number.NaN;
  const purgeAtMs = value?.purgeAt instanceof Timestamp
    ? value.purgeAt.toMillis()
    : Number.NaN;
  if (
    value?.schemaVersion !== 'life-tracker-mcp-read-rate-limit-v1'
    || value.uid !== uid
    || !Number.isInteger(value.count)
    || value.count < 1
    || value.count > limit
    || !Number.isFinite(startedAtMs)
    || startedAtMs > nowMs
    || !Number.isFinite(purgeAtMs)
    || purgeAtMs < startedAtMs + windowMs
  ) {
    throw new DomainError('INTERNAL', 'Stored MCP read rate limit is invalid.');
  }
  return Object.freeze({ count: value.count as number, startedAtMs });
}

export const NOOP_MCP_READ_RATE_LIMITER: McpReadRateLimiter = Object.freeze({
  consume: async () => undefined,
});
