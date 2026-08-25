import { createHash } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

export const DESKTOP_REMINDER_RATE_LIMIT_SCHEMA_VERSION =
  'desktop-reminder-rate-limit-v1' as const;

export type DesktopReminderRateLimitAction = 'list' | 'claim';

export interface DesktopReminderRateLimitInput {
  readonly uid: string;
  readonly action: DesktopReminderRateLimitAction;
  readonly now: Date;
}

export interface DesktopReminderRateLimiter {
  consume(input: DesktopReminderRateLimitInput): Promise<void>;
}

export class DesktopReminderRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Desktop reminder request rate exceeded.');
    this.name = 'DesktopReminderRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface StoredDesktopReminderRateLimit {
  readonly schemaVersion: typeof DESKTOP_REMINDER_RATE_LIMIT_SCHEMA_VERSION;
  readonly action: DesktopReminderRateLimitAction;
  readonly count: number;
  readonly windowStartedAt: Timestamp;
  readonly expiresAt: Timestamp;
}

const RATE_LIMITS: Readonly<Record<DesktopReminderRateLimitAction, Readonly<{
  limit: number;
  windowMs: number;
}>>> = Object.freeze({
  list: Object.freeze({ limit: 30, windowMs: 60_000 }),
  claim: Object.freeze({ limit: 30, windowMs: 60_000 }),
});

/** Fixed-window protection shared by all callable instances. Raw UIDs are not persisted. */
export class FirestoreDesktopReminderRateLimiter implements DesktopReminderRateLimiter {
  constructor(private readonly firestore: Firestore) {}

  async consume(input: DesktopReminderRateLimitInput): Promise<void> {
    assertUid(input.uid);
    const policy = RATE_LIMITS[input.action];
    if (!policy || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
      throw new Error('Desktop reminder rate-limit input is invalid.');
    }
    const id = createHash('sha256')
      .update(`${DESKTOP_REMINDER_RATE_LIMIT_SCHEMA_VERSION}\u0000${input.uid}\u0000${input.action}`)
      .digest('hex');
    const reference = this.firestore.doc(`reminderApiRateLimits/${id}`);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists
        ? decodeStoredRateLimit(snapshot.data() ?? {}, input.action)
        : null;
      const nowMs = input.now.getTime();
      const startedAtMs = current?.windowStartedAt.toMillis() ?? Number.NaN;
      const inWindow = Number.isFinite(startedAtMs)
        && nowMs >= startedAtMs
        && nowMs - startedAtMs < policy.windowMs;
      const count = inWindow ? current?.count ?? 0 : 0;
      if (count >= policy.limit) {
        throw new DesktopReminderRateLimitError(Math.max(
          1,
          Math.ceil((startedAtMs + policy.windowMs - nowMs) / 1_000),
        ));
      }
      const nextStartedAt = inWindow ? startedAtMs : nowMs;
      transaction.set(reference, {
        schemaVersion: DESKTOP_REMINDER_RATE_LIMIT_SCHEMA_VERSION,
        action: input.action,
        count: count + 1,
        windowStartedAt: Timestamp.fromMillis(nextStartedAt),
        expiresAt: Timestamp.fromMillis(nextStartedAt + policy.windowMs * 2),
      } satisfies StoredDesktopReminderRateLimit);
    });
  }
}

function decodeStoredRateLimit(
  value: Record<string, unknown>,
  expectedAction: DesktopReminderRateLimitAction,
): StoredDesktopReminderRateLimit {
  if (
    value.schemaVersion !== DESKTOP_REMINDER_RATE_LIMIT_SCHEMA_VERSION
    || value.action !== expectedAction
    || !Number.isInteger(value.count)
    || (value.count as number) < 0
    || (value.count as number) > 10_000
    || !(value.windowStartedAt instanceof Timestamp)
    || !(value.expiresAt instanceof Timestamp)
  ) {
    throw new Error('Stored Desktop reminder rate limit is invalid.');
  }
  return value as unknown as StoredDesktopReminderRateLimit;
}

function assertUid(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error('Desktop reminder owner identity is invalid.');
  }
}
