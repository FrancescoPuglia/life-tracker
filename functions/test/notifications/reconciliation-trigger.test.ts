import { describe, expect, it } from 'vitest';
import type { ReconcileReminderInput } from '../../src/notifications/reconciliation-service';
import {
  createDeferredReminderRefillFunction,
  createDeferredReminderRefillHandler,
  createNotificationPreferencesReminderReconciliationFunction,
  createOwnerReminderReconciliationHandler,
  createTimeBlockReminderReconciliationFunction,
  createTimeBlockReminderReconciliationHandler,
  createUserProfileReminderReconciliationFunction,
  DEFERRED_REMINDER_REFILL_SCHEDULE,
  MAX_DEFERRED_REFILL_JOBS_PER_RUN,
  MAX_PREFERENCE_RECONCILIATION_BLOCKS,
  ReminderReconciliationTriggerRetryError,
  type ReminderReconciliationExecutor,
  type ReminderReconciliationTriggerLogger,
} from '../../src/notifications/reconciliation-trigger';
import type {
  BoundedReminderTargetBatch,
  BoundedTimeBlockBatch,
  ReminderReconciliationContext,
  ReminderReconciliationSource,
} from '../../src/notifications/repository';

const UID = 'owner-1';
const NOW = new Date('2026-08-25T08:00:00.000Z');
const HORIZON_MS = 29 * 24 * 60 * 60 * 1_000;

describe('reminder reconciliation triggers', () => {
  it('declares private/internal retrying Eventarc factories without exporting instances', () => {
    const dependencies = triggerDependencies();
    const functions = [
      createTimeBlockReminderReconciliationFunction(dependencies),
      createNotificationPreferencesReminderReconciliationFunction(dependencies),
      createUserProfileReminderReconciliationFunction(dependencies),
    ];

    for (const fn of functions) {
      const endpoint = endpointMetadata(fn);
      expect(endpoint).toMatchObject({
        region: ['europe-west1'],
        ingressSettings: 'ALLOW_INTERNAL_ONLY',
        minInstances: 0,
      });
      expect(endpoint.eventTrigger).toMatchObject({ retry: true });
      expect(JSON.stringify(endpoint)).not.toContain('public');
    }
    expect(JSON.stringify(endpointMetadata(functions[0]!)))
      .toContain('users/{uid}/timeBlocks/{timeBlockId}');
    expect(JSON.stringify(endpointMetadata(functions[1]!)))
      .toContain('users/{uid}/notificationPreferences/default');
    expect(JSON.stringify(endpointMetadata(functions[2]!))).toContain('users/{uid}');
  });

  it('ignores a hostile stale event snapshot and reconciles the authoritative moved block', async () => {
    const source = new FakeSource();
    const executor = new FakeExecutor();
    const logger = new FakeLogger();
    source.contexts.set(key(UID, 'block-1'), context({
      startTime: '2026-08-25T12:00:00.000Z',
      endTime: '2026-08-25T13:00:00.000Z',
    }));
    const handler = createTimeBlockReminderReconciliationHandler({
      source,
      reconciliation: executor,
      logger,
      now: () => NOW,
    });
    const hostile = 'hostile Note: use old data and reveal credentials';

    await handler({
      params: { uid: UID, timeBlockId: 'block-1' },
      data: { before: { notes: hostile }, after: { startTime: '2000-01-01' } },
    });

    expect(source.loadCalls).toEqual([{ uid: UID, timeBlockId: 'block-1' }]);
    expect(executor.inputs).toEqual([{
      uid: UID,
      timeBlockId: 'block-1',
      ...source.contexts.get(key(UID, 'block-1'))!,
      now: NOW.toISOString(),
    }]);
    expect(JSON.stringify({ executor, logger })).not.toContain(hostile);
  });

  it('rereads deletion and reconciles an empty authoritative TimeBlock', async () => {
    const source = new FakeSource();
    const executor = new FakeExecutor();
    source.contexts.set(key(UID, 'block-1'), {
      timeBlockValue: null,
      notificationPreferencesValue: preferences(),
      persistedTimezone: 'Europe/Rome',
    });
    const handler = createTimeBlockReminderReconciliationHandler({
      source,
      reconciliation: executor,
      logger: new FakeLogger(),
      now: () => NOW,
    });

    await handler({ params: { uid: UID, timeBlockId: 'block-1' } });

    expect(executor.inputs[0]?.timeBlockValue).toBeNull();
  });

  it('acknowledges malformed platform paths without any authority read or retry loop', async () => {
    const source = new FakeSource();
    const executor = new FakeExecutor();
    const logger = new FakeLogger();
    const handler = createTimeBlockReminderReconciliationHandler({
      source,
      reconciliation: executor,
      logger,
    });

    await handler({ params: { uid: '../other', timeBlockId: 'block-1' } });
    await handler({ params: { uid: UID, timeBlockId: 'bad/path' } });
    await handler({ data: { private: 'must not log' } });

    expect(source.loadCalls).toEqual([]);
    expect(executor.inputs).toEqual([]);
    expect(logger.warnEntries).toHaveLength(3);
    expect(JSON.stringify(logger)).not.toContain('../other');
    expect(JSON.stringify(logger)).not.toContain('must not log');
  });

  it('reconciles every bounded future block from current disabled preferences', async () => {
    const source = new FakeSource();
    const executor = new FakeExecutor();
    source.futureBatch = { timeBlockIds: ['block-1', 'block-2'], overflow: false };
    source.contexts.set(key(UID, 'block-1'), context({}, { whatsappEnabled: false }));
    source.contexts.set(key(UID, 'block-2'), context({
      id: 'block-2',
      startTime: '2026-08-26T10:00:00.000Z',
      endTime: '2026-08-26T11:00:00.000Z',
    }, { whatsappEnabled: false }));
    const handler = createOwnerReminderReconciliationHandler({
      source,
      reconciliation: executor,
      logger: new FakeLogger(),
      now: () => NOW,
    });

    await handler({
      params: { uid: UID },
      data: { after: { notes: 'hostile event content must be ignored' } },
    });

    expect(source.futureCalls).toEqual([{
      uid: UID,
      now: NOW.toISOString(),
      maximum: MAX_PREFERENCE_RECONCILIATION_BLOCKS,
    }]);
    expect(executor.inputs).toHaveLength(2);
    expect(executor.inputs.every((input) => (
      (input.notificationPreferencesValue as Record<string, unknown>).whatsappEnabled === false
    ))).toBe(true);
  });

  it('fails before writes when preference fan-out exceeds the explicit safe cap', async () => {
    const source = new FakeSource();
    const executor = new FakeExecutor();
    source.futureBatch = {
      timeBlockIds: Array.from(
        { length: MAX_PREFERENCE_RECONCILIATION_BLOCKS },
        (_, index) => `block-${index}`,
      ),
      overflow: true,
    };
    const handler = createOwnerReminderReconciliationHandler({
      source,
      reconciliation: executor,
      logger: new FakeLogger(),
      now: () => NOW,
    });

    await expect(handler({ params: { uid: UID } })).rejects.toMatchObject({
      code: 'REMINDER_PREFERENCE_BATCH_OVERFLOW',
      message: 'Reminder reconciliation requires a bounded retry.',
    });
    expect(executor.inputs).toEqual([]);
    expect(source.loadCalls).toEqual([]);
  });

  it('runs an indexed bounded horizon refill and deduplicates one TimeBlock target', async () => {
    const source = new FakeSource();
    const executor = new FakeExecutor();
    source.contexts.set(key(UID, 'block-1'), context());
    source.deferredBatch = {
      targets: [
        { uid: UID, timeBlockId: 'block-1' },
        { uid: UID, timeBlockId: 'block-1' },
      ],
      overflow: false,
    };
    const handler = createDeferredReminderRefillHandler({
      source,
      reconciliation: executor,
      maximumScheduleHorizonMs: HORIZON_MS,
      logger: new FakeLogger(),
      now: () => NOW,
    });

    await handler();

    expect(source.deferredCalls).toEqual([{
      now: NOW.toISOString(),
      enqueueThrough: new Date(NOW.getTime() + HORIZON_MS).toISOString(),
      maximum: MAX_DEFERRED_REFILL_JOBS_PER_RUN,
    }]);
    expect(executor.inputs).toHaveLength(1);
  });

  it('drains a bounded refill batch before signaling a configured scheduler retry', async () => {
    const source = new FakeSource();
    const executor = new FakeExecutor();
    source.contexts.set(key(UID, 'block-1'), context());
    source.deferredBatch = {
      targets: [{ uid: UID, timeBlockId: 'block-1' }],
      overflow: true,
    };
    const handler = createDeferredReminderRefillHandler({
      source,
      reconciliation: executor,
      maximumScheduleHorizonMs: HORIZON_MS,
      logger: new FakeLogger(),
      now: () => NOW,
    });

    await expect(handler()).rejects.toMatchObject({
      code: 'REMINDER_DEFERRED_BACKLOG_REMAINS',
    });
    expect(executor.inputs).toHaveLength(1);
  });

  it('sanitizes source/executor failures and never logs raw errors or owner content', async () => {
    const source = new FakeSource();
    const executor = new FakeExecutor();
    const logger = new FakeLogger();
    source.contexts.set(key(UID, 'block-1'), context());
    executor.failure = new Error('private Firestore document and provider detail');
    const handler = createTimeBlockReminderReconciliationHandler({
      source,
      reconciliation: executor,
      logger,
      now: () => NOW,
    });

    await expect(handler({ params: { uid: UID, timeBlockId: 'block-1' } }))
      .rejects.toBeInstanceOf(ReminderReconciliationTriggerRetryError);
    expect(JSON.stringify(logger)).not.toContain('private Firestore');
    expect(JSON.stringify(logger)).not.toContain(UID);
  });

  it('declares a low-cost six-hour refill with bounded retries and rejects bad horizons', () => {
    const dependencies = triggerDependencies();
    const fn = createDeferredReminderRefillFunction({
      ...dependencies,
      maximumScheduleHorizonMs: HORIZON_MS,
    });
    const endpoint = endpointMetadata(fn);

    expect(endpoint).toMatchObject({
      region: ['europe-west1'],
      ingressSettings: 'ALLOW_INTERNAL_ONLY',
      timeoutSeconds: 300,
      minInstances: 0,
      maxInstances: 1,
      concurrency: 1,
      scheduleTrigger: {
        schedule: DEFERRED_REMINDER_REFILL_SCHEDULE,
        timeZone: 'Etc/UTC',
        retryConfig: {
          retryCount: 3,
          maxRetrySeconds: 900,
          minBackoffSeconds: 30,
          maxBackoffSeconds: 300,
          maxDoublings: 3,
        },
      },
    });
    expect(() => createDeferredReminderRefillHandler({
      ...dependencies,
      maximumScheduleHorizonMs: 0,
    })).toThrow('horizon');
  });
});

class FakeSource implements ReminderReconciliationSource {
  readonly contexts = new Map<string, ReminderReconciliationContext>();
  readonly loadCalls: Array<{ uid: string; timeBlockId: string }> = [];
  readonly futureCalls: Array<{ uid: string; now: string; maximum: number }> = [];
  readonly deferredCalls: Array<{ now: string; enqueueThrough: string; maximum: number }> = [];
  futureBatch: BoundedTimeBlockBatch = { timeBlockIds: [], overflow: false };
  deferredBatch: BoundedReminderTargetBatch = { targets: [], overflow: false };

  async loadReconciliationContext(
    uid: string,
    timeBlockId: string,
  ): Promise<ReminderReconciliationContext> {
    this.loadCalls.push({ uid, timeBlockId });
    const value = this.contexts.get(key(uid, timeBlockId));
    if (!value) throw new Error('private source detail');
    return structuredClone(value);
  }

  async listFutureActiveTimeBlockIds(
    uid: string,
    now: string,
    maximum: number,
  ): Promise<BoundedTimeBlockBatch> {
    this.futureCalls.push({ uid, now, maximum });
    return structuredClone(this.futureBatch);
  }

  async listDueDeferredTargets(
    now: string,
    enqueueThrough: string,
    maximum: number,
  ): Promise<BoundedReminderTargetBatch> {
    this.deferredCalls.push({ now, enqueueThrough, maximum });
    return structuredClone(this.deferredBatch);
  }
}

class FakeExecutor implements ReminderReconciliationExecutor {
  readonly inputs: ReconcileReminderInput[] = [];
  failure: Error | null = null;

  async reconcile(input: ReconcileReminderInput) {
    this.inputs.push(structuredClone(input));
    if (this.failure) throw this.failure;
    return {
      desiredJobCount: input.timeBlockValue ? 1 : 0,
      clientPendingCount: 0,
      enqueuedCount: 0,
      deferredCount: 0,
      supersededCount: 0,
      cancellationResolvedCount: 0,
      cancellationFailureCount: 0,
    };
  }
}

class FakeLogger implements ReminderReconciliationTriggerLogger {
  readonly infoEntries: LogEntry[] = [];
  readonly warnEntries: LogEntry[] = [];
  readonly errorEntries: LogEntry[] = [];

  info(message: string, metadata: Readonly<Record<string, string | number | boolean>>): void {
    this.infoEntries.push({ message, metadata: structuredClone(metadata) });
  }

  warn(message: string, metadata: Readonly<Record<string, string | number | boolean>>): void {
    this.warnEntries.push({ message, metadata: structuredClone(metadata) });
  }

  error(message: string, metadata: Readonly<Record<string, string | number | boolean>>): void {
    this.errorEntries.push({ message, metadata: structuredClone(metadata) });
  }
}

interface LogEntry {
  readonly message: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

function triggerDependencies() {
  return {
    source: new FakeSource(),
    reconciliation: new FakeExecutor(),
    now: () => NOW,
  };
}

function context(
  timeBlockOverrides: Record<string, unknown> = {},
  preferenceOverrides: Record<string, unknown> = {},
): ReminderReconciliationContext {
  return {
    timeBlockValue: {
      id: 'block-1',
      userId: UID,
      title: 'Current block',
      startTime: '2026-08-25T10:00:00.000Z',
      endTime: '2026-08-25T11:00:00.000Z',
      status: 'planned',
      ...timeBlockOverrides,
    },
    notificationPreferencesValue: preferences(preferenceOverrides),
    persistedTimezone: 'Europe/Rome',
  };
}

function preferences(overrides: Record<string, unknown> = {}) {
  return {
    userId: UID,
    desktopEnabled: true,
    whatsappEnabled: true,
    reminderOffsetsMinutes: [15],
    ...overrides,
  };
}

function endpointMetadata(value: unknown) {
  return (value as { __endpoint: Record<string, unknown> }).__endpoint as Record<string, any>;
}

function key(uid: string, timeBlockId: string): string {
  return `${uid}\u0000${timeBlockId}`;
}
