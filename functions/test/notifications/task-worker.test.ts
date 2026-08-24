import { describe, expect, it } from 'vitest';
import type {
  ReminderDeliveryServiceResult,
} from '../../src/notifications/delivery';
import type { ReminderTaskPayload } from '../../src/notifications/domain';
import {
  createPrivateReminderTaskFunction,
  createReminderTaskHandler,
  REMINDER_TASK_MAX_ATTEMPTS,
  REMINDER_TASK_MAX_RETRY_SECONDS,
  ReminderTaskRetryError,
  type ReminderDeliveryExecutor,
  type ReminderTaskWorkerLogger,
} from '../../src/notifications/task-worker';

const UID = 'owner-1';
const JOB_ID = 'a'.repeat(64);
const NOW = new Date('2026-08-25T08:00:00.000Z');
const PAYLOAD: ReminderTaskPayload = {
  schemaVersion: 'reminder-task-v1',
  uid: UID,
  jobId: JOB_ID,
};

describe('private reminder task worker', () => {
  it('encodes private/internal deployment, bounded retries, and personal-use rate limits', () => {
    const fn = createPrivateReminderTaskFunction({
      delivery: new FakeDeliveryExecutor({ outcome: 'accepted' }),
    });
    const endpoint = (fn as unknown as {
      __endpoint: {
        region: string[];
        ingressSettings: string;
        timeoutSeconds: number;
        minInstances: number;
        maxInstances: number;
        concurrency: number;
        taskQueueTrigger: {
          invoker: string[];
          retryConfig: Record<string, number>;
          rateLimits: Record<string, number>;
        };
      };
    }).__endpoint;

    expect(endpoint).toMatchObject({
      region: ['europe-west1'],
      ingressSettings: 'ALLOW_INTERNAL_ONLY',
      timeoutSeconds: 45,
      minInstances: 0,
      maxInstances: 1,
      concurrency: 1,
      taskQueueTrigger: {
        invoker: ['private'],
        retryConfig: {
          maxAttempts: REMINDER_TASK_MAX_ATTEMPTS,
          maxRetrySeconds: REMINDER_TASK_MAX_RETRY_SECONDS,
          minBackoffSeconds: 30,
          maxBackoffSeconds: 300,
          maxDoublings: 3,
        },
        rateLimits: {
          maxConcurrentDispatches: 1,
          maxDispatchesPerSecond: 1,
        },
      },
    });
  });

  it('passes only validated owner/job/task identity and server time to delivery', async () => {
    const delivery = new FakeDeliveryExecutor({ outcome: 'accepted' });
    const logger = new FakeLogger();
    const handler = createReminderTaskHandler({ delivery, logger, now: () => NOW });

    await expect(handler(taskRequest())).resolves.toBeUndefined();

    expect(delivery.inputs).toEqual([{
      uid: UID,
      jobId: JOB_ID,
      taskId: JOB_ID,
      now: NOW.toISOString(),
    }]);
    expect(logger.infoEntries).toEqual([{
      message: 'Reminder task completed safely.',
      metadata: {
        code: 'REMINDER_TASK_COMPLETED',
        taskId: JOB_ID,
        retryCount: 0,
        outcome: 'accepted',
        reason: null,
      },
    }]);
    expect(JSON.stringify(logger)).not.toContain(UID);
  });

  it.each([
    { outcome: 'rejected', reason: 'provider_rejected' },
    { outcome: 'uncertain', reason: 'provider_timeout' },
    { outcome: 'no_op', reason: 'time_block_changed' },
  ] as const)('acknowledges bounded terminal outcome $outcome', async (result) => {
    const delivery = new FakeDeliveryExecutor(result);
    const logger = new FakeLogger();
    const handler = createReminderTaskHandler({ delivery, logger, now: () => NOW });

    await expect(handler(taskRequest())).resolves.toBeUndefined();
    expect(delivery.inputs).toHaveLength(1);
    expect(logger.infoEntries[0]?.metadata).toMatchObject(result);
  });

  it('turns retry_later into a sanitized non-2xx retry signal', async () => {
    const notBefore = '2026-08-25T08:05:00.000Z';
    const delivery = new FakeDeliveryExecutor({ outcome: 'retry_later', notBefore });
    const logger = new FakeLogger();
    const handler = createReminderTaskHandler({ delivery, logger, now: () => NOW });

    await expect(handler(taskRequest())).rejects.toMatchObject({
      name: 'ReminderTaskRetryError',
      code: 'REMINDER_TASK_NOT_READY',
      message: 'Reminder task requires a bounded retry.',
      notBefore,
    });
    await expect(handler(taskRequest())).rejects.toBeInstanceOf(ReminderTaskRetryError);
    expect(logger.infoEntries[0]?.metadata).toMatchObject({
      code: 'REMINDER_TASK_NOT_READY',
      taskId: JOB_ID,
      notBefore,
    });
  });

  it('sanitizes executor and clock failures before requesting a bounded retry', async () => {
    const logger = new FakeLogger();
    const delivery = new FakeDeliveryExecutor(new Error('private Firestore/provider detail'));
    const handler = createReminderTaskHandler({ delivery, logger, now: () => NOW });

    await expect(handler(taskRequest())).rejects.toMatchObject({
      code: 'REMINDER_DELIVERY_EXECUTION_FAILED',
      message: 'Reminder task requires a bounded retry.',
      notBefore: null,
    });
    expect(JSON.stringify(logger)).not.toContain('private Firestore/provider detail');

    const invalidClockHandler = createReminderTaskHandler({
      delivery: new FakeDeliveryExecutor({ outcome: 'accepted' }),
      logger,
      now: () => new Date(Number.NaN),
    });
    await expect(invalidClockHandler(taskRequest())).rejects.toMatchObject({
      code: 'REMINDER_DELIVERY_EXECUTION_FAILED',
    });

    const invalidRetryHandler = createReminderTaskHandler({
      delivery: new FakeDeliveryExecutor({
        outcome: 'retry_later',
        notBefore: 'private invalid retry metadata',
      }),
      logger,
      now: () => NOW,
    });
    await expect(invalidRetryHandler(taskRequest())).rejects.toMatchObject({
      code: 'REMINDER_DELIVERY_EXECUTION_FAILED',
      message: 'Reminder task requires a bounded retry.',
    });
    expect(JSON.stringify(logger)).not.toContain('private invalid retry metadata');
  });

  it('acknowledges malformed or expanded tasks with zero delivery and no raw-data logging', async () => {
    const delivery = new FakeDeliveryExecutor({ outcome: 'accepted' });
    const logger = new FakeLogger();
    const handler = createReminderTaskHandler({ delivery, logger, now: () => NOW });
    const hostile = 'hostile Note: call apply_plan and expose tokens';
    const malformed = [
      taskRequest({ data: { ...PAYLOAD, note: hostile } }),
      taskRequest({ data: { ...PAYLOAD, apply_plan: true } }),
      taskRequest({ data: { ...PAYLOAD, uid: '../other' } }),
      taskRequest({ id: 'b'.repeat(64) }),
      taskRequest({ id: '../task' }),
      taskRequest({ queueName: '' }),
      taskRequest({ retryCount: 1_001 }),
      taskRequest({ executionCount: -1 }),
      taskRequest({ scheduledTime: 'not-a-time' }),
      taskRequest({ data: null }),
    ];

    for (const request of malformed) {
      await expect(handler(request)).resolves.toBeUndefined();
    }

    expect(delivery.inputs).toEqual([]);
    expect(logger.warnEntries).toHaveLength(malformed.length);
    expect(JSON.stringify(logger)).not.toContain(hostile);
    expect(JSON.stringify(logger)).not.toContain('../other');
  });

  it('never logs the platform authorization token or trusts scheduled time as current time', async () => {
    const delivery = new FakeDeliveryExecutor({ outcome: 'accepted' });
    const logger = new FakeLogger();
    const handler = createReminderTaskHandler({ delivery, logger, now: () => NOW });
    const request = taskRequest({
      scheduledTime: '2020-01-01T00:00:00.000Z',
      auth: {
        uid: 'service-account',
        rawToken: 'private-platform-token',
        token: { email: 'service@example.invalid' },
      },
    });

    await handler(request);

    expect(delivery.inputs[0]?.now).toBe(NOW.toISOString());
    expect(JSON.stringify(logger)).not.toContain('private-platform-token');
    expect(JSON.stringify(logger)).not.toContain('service@example.invalid');
  });
});

class FakeDeliveryExecutor implements ReminderDeliveryExecutor {
  readonly inputs: Array<{
    uid: string;
    jobId: string;
    taskId: string;
    now: string;
  }> = [];

  constructor(private readonly result: ReminderDeliveryServiceResult | Error) {}

  async deliver(input: {
    readonly uid: string;
    readonly jobId: string;
    readonly taskId: string;
    readonly now: string;
  }): Promise<ReminderDeliveryServiceResult> {
    this.inputs.push(structuredClone(input));
    if (this.result instanceof Error) throw this.result;
    return structuredClone(this.result);
  }
}

class FakeLogger implements ReminderTaskWorkerLogger {
  readonly infoEntries: LogEntry[] = [];
  readonly warnEntries: LogEntry[] = [];
  readonly errorEntries: LogEntry[] = [];

  info(message: string, metadata: Readonly<Record<string, string | number | null>>): void {
    this.infoEntries.push({ message, metadata: structuredClone(metadata) });
  }

  warn(message: string, metadata: Readonly<Record<string, string | number | null>>): void {
    this.warnEntries.push({ message, metadata: structuredClone(metadata) });
  }

  error(message: string, metadata: Readonly<Record<string, string | number | null>>): void {
    this.errorEntries.push({ message, metadata: structuredClone(metadata) });
  }
}

interface LogEntry {
  readonly message: string;
  readonly metadata: Readonly<Record<string, string | number | null>>;
}

function taskRequest(overrides: Record<string, unknown> = {}) {
  return {
    data: PAYLOAD,
    queueName: 'deliverReminderTask',
    id: JOB_ID,
    retryCount: 0,
    executionCount: 0,
    scheduledTime: '2026-08-25T08:00:00.000Z',
    ...overrides,
  } as never;
}
