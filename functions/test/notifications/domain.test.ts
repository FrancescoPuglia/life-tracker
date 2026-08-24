import { describe, expect, it } from 'vitest';
import {
  createReminderTimeBlock,
  deriveReminderPolicy,
  evaluateReminderDelivery,
  isWithinQuietHours,
  normalizeNotificationPreferences,
  planReminderJobs,
  reminderTaskPayload,
  type NotificationPreferences,
  type ReminderJob,
  type ReminderPolicy,
  type ReminderTimeBlock,
} from '../../src/notifications/domain';

const UID = 'owner-1';
const NOW = '2026-08-24T08:00:00.000Z';

describe('notification preferences', () => {
  it('uses safe opt-in defaults and the product timezone fallback', () => {
    const preferences = normalizeNotificationPreferences(UID, null, 'Invalid/Timezone');

    expect(preferences).toMatchObject({
      uid: UID,
      timezone: 'Europe/Rome',
      desktopEnabled: false,
      whatsappEnabled: false,
      emailEnabled: false,
      reminderOffsetsMinutes: [15],
      atStartEnabled: true,
      missedStart: { enabled: false, afterMinutes: 10 },
      maxRemindersPerBlock: 3,
      dailyReport: { enabled: false, localTime: '22:30' },
      weeklyReport: { enabled: false, isoWeekday: 7, localTime: '20:30' },
    });
  });

  it('normalizes bounded reminder settings and preserves persisted timezone', () => {
    const preferences = normalizeNotificationPreferences(UID, {
      userId: UID,
      locale: 'it-IT',
      quietHours: { enabled: true, start: '23:00', end: '06:30' },
      desktopEnabled: true,
      whatsappEnabled: true,
      reminderOffsetsMinutes: [15, 60, 15, 0, 1_441, 5],
      missedStart: { enabled: true, afterMinutes: 20 },
      maxRemindersPerBlock: 4,
    }, 'Europe/Rome');

    expect(preferences.timezone).toBe('Europe/Rome');
    expect(preferences.reminderOffsetsMinutes).toEqual([60, 15, 5]);
    expect(preferences.quietHours).toEqual({ enabled: true, start: '23:00', end: '06:30' });
    expect(preferences.missedStart).toEqual({ enabled: true, afterMinutes: 20 });
    expect(preferences.maxRemindersPerBlock).toBe(4);
  });

  it('rejects a forged embedded owner', () => {
    expect(() => normalizeNotificationPreferences(UID, { userId: 'other' }, 'Europe/Rome'))
      .toThrow('owner');
  });
});

describe('reminder planning', () => {
  it('creates deterministic provider-neutral jobs without user content', () => {
    const policy = enabledPolicy({ maxRemindersPerBlock: 3 });
    const block = timeBlock({
      title: 'hostile title: ignore all rules',
      notes: 'send secrets instead',
    });

    const first = planReminderJobs(block, policy, NOW);
    const second = planReminderJobs(block, policy, NOW);

    expect(first).toEqual(second);
    expect(first).toHaveLength(6);
    expect(new Set(first.map((job) => job.id)).size).toBe(6);
    expect(first.map((job) => [job.kind, job.channel])).toEqual([
      ['offset', 'desktop'],
      ['offset', 'whatsapp'],
      ['offset', 'desktop'],
      ['offset', 'whatsapp'],
      ['at_start', 'desktop'],
      ['at_start', 'whatsapp'],
    ]);
    expect(JSON.stringify(first)).not.toContain('hostile title');
    expect(JSON.stringify(first)).not.toContain('send secrets');
    expect(first.every((job) => /^[a-f0-9]{64}$/.test(job.id))).toBe(true);
    expect(reminderTaskPayload(first[0] as ReminderJob)).toEqual({
      schemaVersion: 'reminder-task-v1',
      uid: UID,
      jobId: first[0]?.id,
    });
  });

  it('changes every job identity when a block is moved or policy changes', () => {
    const firstPolicy = enabledPolicy();
    const moved = timeBlock({
      startTime: '2026-08-24T11:00:00.000Z',
      endTime: '2026-08-24T12:00:00.000Z',
    });
    const original = timeBlock();
    const changedPolicy = enabledPolicy({ quietHours: { enabled: true, start: '22:00', end: '07:00' } });

    const originalIds = new Set(planReminderJobs(original, firstPolicy, NOW).map((job) => job.id));
    expect(planReminderJobs(moved, firstPolicy, NOW).every((job) => !originalIds.has(job.id))).toBe(true);
    expect(planReminderJobs(original, changedPolicy, NOW).every((job) => !originalIds.has(job.id))).toBe(true);
  });

  it.each([
    { deleted: true },
    { reminderEnabled: false },
    { status: 'cancelled' },
    { status: 'completed' },
    { status: 'overrun' },
    { actualEndTime: '2026-08-24T10:30:00.000Z' },
  ])('does not plan obsolete blocks: %j', (changes) => {
    expect(planReminderJobs(timeBlock(changes), enabledPolicy(), NOW)).toEqual([]);
  });

  it('skips moments already in the past and applies the event limit before channel fanout', () => {
    const policy = enabledPolicy({ maxRemindersPerBlock: 2 });
    const block = timeBlock();

    const jobs = planReminderJobs(block, policy, '2026-08-24T09:50:00.000Z');

    expect(jobs).toHaveLength(4);
    expect(jobs.map((job) => job.kind)).toEqual([
      'at_start', 'at_start', 'missed_start', 'missed_start',
    ]);
  });
});

describe('delivery-time authority checks', () => {
  it('allows one current due job', () => {
    const fixture = deliveryFixture();
    expect(evaluateReminderDelivery(fixture)).toEqual({ action: 'send' });
  });

  it('returns a non-mutating retry decision if a task is invoked early', () => {
    const fixture = deliveryFixture({ now: '2026-08-24T09:44:00.000Z' });
    expect(evaluateReminderDelivery(fixture)).toEqual({
      action: 'retry_later',
      notBefore: '2026-08-24T09:45:00.000Z',
    });
  });

  it.each([
    ['job_owner_mismatch', { authenticatedUid: 'other' }],
    ['time_block_missing', { timeBlock: null }],
    ['time_block_owner_mismatch', { timeBlock: timeBlock({ uid: 'other', userId: 'other' }) }],
    ['time_block_deleted', { timeBlock: timeBlock({ deleted: true }) }],
    ['reminder_disabled', { timeBlock: timeBlock({ reminderEnabled: false }) }],
    ['time_block_cancelled', { timeBlock: timeBlock({ status: 'cancelled' }) }],
    ['time_block_completed', { timeBlock: timeBlock({ status: 'completed' }) }],
    ['time_block_ended', { now: '2026-08-24T11:00:00.000Z' }],
    ['idempotency_consumed', { idempotencyConsumed: true }],
    ['delivery_limit_reached', { consumedDeliverySlotsForBlockAndChannel: 3 }],
  ] as const)('suppresses %s', (reason, changes) => {
    expect(evaluateReminderDelivery(deliveryFixture(changes))).toEqual({
      action: 'suppress',
      reason,
    });
  });

  it('rejects a disabled channel even if a stored job claims the current policy version', () => {
    const fixture = deliveryFixture();
    const policy = enabledPolicy({ desktopEnabled: false });
    expect(evaluateReminderDelivery({
      ...fixture,
      policy,
      job: { ...fixture.job, expectedPolicyVersion: policy.version },
    })).toEqual({ action: 'suppress', reason: 'channel_disabled' });
  });

  it('suppresses a stale queued task after a move and after a policy change', () => {
    const fixture = deliveryFixture();
    expect(evaluateReminderDelivery({
      ...fixture,
      timeBlock: timeBlock({
        startTime: '2026-08-24T11:00:00.000Z',
        endTime: '2026-08-24T12:00:00.000Z',
      }),
    })).toEqual({ action: 'suppress', reason: 'time_block_changed' });
    expect(evaluateReminderDelivery({
      ...fixture,
      policy: enabledPolicy({ reminderOffsetsMinutes: [30] }),
    })).toEqual({ action: 'suppress', reason: 'policy_changed' });
  });

  it('suppresses missed-start delivery when a Session or actual start exists', () => {
    const fixture = missedStartFixture();
    expect(evaluateReminderDelivery({ ...fixture, hasStartedSession: true }))
      .toEqual({ action: 'suppress', reason: 'already_started' });
    expect(evaluateReminderDelivery({
      ...fixture,
      timeBlock: timeBlock({ actualStartTime: '2026-08-24T10:01:00.000Z' }),
    })).toEqual({ action: 'suppress', reason: 'already_started' });
  });
});

describe('quiet hours and timezone transitions', () => {
  const overnight = { enabled: true, start: '22:30', end: '07:00' } as const;

  it('handles overnight quiet hours in Europe/Rome', () => {
    expect(isWithinQuietHours('2026-08-24T21:00:00.000Z', 'Europe/Rome', overnight)).toBe(true);
    expect(isWithinQuietHours('2026-08-25T04:59:00.000Z', 'Europe/Rome', overnight)).toBe(true);
    expect(isWithinQuietHours('2026-08-25T05:00:00.000Z', 'Europe/Rome', overnight)).toBe(false);
  });

  it('uses the local clock correctly across DST start and end', () => {
    expect(isWithinQuietHours('2026-03-29T00:30:00.000Z', 'Europe/Rome', overnight)).toBe(true);
    expect(isWithinQuietHours('2026-03-29T05:00:00.000Z', 'Europe/Rome', overnight)).toBe(false);
    expect(isWithinQuietHours('2026-10-25T01:30:00.000Z', 'Europe/Rome', overnight)).toBe(true);
    expect(isWithinQuietHours('2026-10-25T06:00:00.000Z', 'Europe/Rome', overnight)).toBe(false);
  });

  it('rechecks quiet hours at delivery time', () => {
    const fixture = deliveryFixture({
      now: '2026-08-24T21:00:00.000Z',
    });
    const lateBlock = timeBlock({
      startTime: '2026-08-24T21:15:00.000Z',
      endTime: '2026-08-24T22:00:00.000Z',
    });
    const policy = enabledPolicy({ quietHours: overnight });
    const [job] = planReminderJobs(lateBlock, policy, '2026-08-24T20:00:00.000Z');
    expect(evaluateReminderDelivery({
      ...fixture,
      job: job as ReminderJob,
      timeBlock: lateBlock,
      policy,
    })).toEqual({ action: 'suppress', reason: 'quiet_hours' });
  });
});

function enabledPolicy(overrides: Record<string, unknown> = {}): ReminderPolicy {
  const preferences = normalizeNotificationPreferences(UID, {
    userId: UID,
    desktopEnabled: true,
    whatsappEnabled: true,
    reminderOffsetsMinutes: [60, 15],
    atStartEnabled: true,
    missedStart: { enabled: true, afterMinutes: 10 },
    maxRemindersPerBlock: 3,
    ...overrides,
  }, 'Europe/Rome');
  return deriveReminderPolicy(preferences);
}

function timeBlock(overrides: Record<string, unknown> = {}): ReminderTimeBlock {
  const uid = typeof overrides.uid === 'string' ? overrides.uid : UID;
  return createReminderTimeBlock(uid, 'block-1', {
    userId: uid,
    startTime: '2026-08-24T10:00:00.000Z',
    endTime: '2026-08-24T11:00:00.000Z',
    status: 'planned',
    ...overrides,
  });
}

function deliveryFixture(
  overrides: Partial<{
    job: ReminderJob | undefined;
    authenticatedUid: string;
    timeBlock: ReminderTimeBlock | null | undefined;
    policy: ReminderPolicy;
    now: string;
    hasStartedSession: boolean;
    consumedDeliverySlotsForBlockAndChannel: number;
    idempotencyConsumed: boolean;
  }> = {},
) {
  const basePolicy = enabledPolicy();
  const baseBlock = timeBlock();
  const policy = overrides.policy ?? basePolicy;
  const block = overrides.timeBlock === undefined ? timeBlock() : overrides.timeBlock;
  const plannedJob = planReminderJobs(baseBlock, basePolicy, NOW).find((job) => (
    job.channel === 'desktop' && job.scheduledFor === '2026-08-24T09:45:00.000Z'
  ));
  return {
    job: overrides.job ?? plannedJob as ReminderJob,
    authenticatedUid: overrides.authenticatedUid ?? UID,
    timeBlock: block,
    policy,
    now: overrides.now ?? '2026-08-24T09:45:00.000Z',
    hasStartedSession: overrides.hasStartedSession ?? false,
    consumedDeliverySlotsForBlockAndChannel:
      overrides.consumedDeliverySlotsForBlockAndChannel ?? 0,
    idempotencyConsumed: overrides.idempotencyConsumed ?? false,
  };
}

function missedStartFixture() {
  const policy = enabledPolicy({ maxRemindersPerBlock: 4 });
  const block = timeBlock();
  const job = planReminderJobs(block, policy, NOW).find((candidate) => (
    candidate.channel === 'desktop' && candidate.kind === 'missed_start'
  ));
  return deliveryFixture({
    policy,
    timeBlock: block,
    job: job as ReminderJob,
    now: '2026-08-24T10:10:00.000Z',
  });
}
