import { describe, expect, it } from 'vitest';
import {
  createReminderTimeBlock,
  deriveReminderPolicy,
  normalizeNotificationPreferences,
  planReminderJobs,
  type ReminderTaskPayload,
} from '../../src/notifications/domain';
import { InMemoryReminderRepository } from '../../src/notifications/in-memory-repository';
import {
  ReminderQueueSchedulingError,
  ReminderReconciliationService,
  type ReconcileReminderInput,
} from '../../src/notifications/reconciliation-service';
import type {
  ReminderQueueCancellationOutcome,
  ReminderTaskQueue,
} from '../../src/notifications/repository';

const UID = 'owner-1';
const NOW = '2026-08-24T08:00:00.000Z';

describe('ReminderReconciliationService', () => {
  it('persists Desktop jobs locally and enqueues only provider-neutral WhatsApp tasks', async () => {
    const repository = new InMemoryReminderRepository();
    const queue = new FakeReminderQueue();
    const service = new ReminderReconciliationService(repository, queue);

    const first = await service.reconcile(input());
    const replay = await service.reconcile(input());

    expect(first).toEqual({
      desiredJobCount: 2,
      clientPendingCount: 1,
      enqueuedCount: 1,
      supersededCount: 0,
      cancellationResolvedCount: 0,
      cancellationFailureCount: 0,
    });
    expect(replay).toEqual({
      desiredJobCount: 2,
      clientPendingCount: 1,
      enqueuedCount: 0,
      supersededCount: 0,
      cancellationResolvedCount: 0,
      cancellationFailureCount: 0,
    });
    expect(queue.tasks.size).toBe(1);
    expect(queue.enqueueCalls).toHaveLength(1);
    expect(queue.enqueueCalls[0]?.payload).toEqual({
      schemaVersion: 'reminder-task-v1',
      uid: UID,
      jobId: queue.enqueueCalls[0]?.taskId,
    });
    expect(JSON.stringify(queue.enqueueCalls)).not.toContain('Deep work');
    expect(repository.listJobsForTest(UID).map((job) => [job.channel, job.state]))
      .toEqual(expect.arrayContaining([
        ['desktop', 'client_pending'],
        ['whatsapp', 'scheduled'],
      ]));
  });

  it('supersedes and cancels obsolete tasks when a block moves', async () => {
    const repository = new InMemoryReminderRepository();
    const queue = new FakeReminderQueue();
    const service = new ReminderReconciliationService(repository, queue);
    await service.reconcile(input());
    const originalTaskId = [...queue.tasks.keys()][0] as string;

    const result = await service.reconcile(input({
      timeBlockValue: timeBlockValue({
        startTime: '2026-08-24T11:00:00.000Z',
        endTime: '2026-08-24T12:00:00.000Z',
      }),
    }));

    expect(result).toMatchObject({
      desiredJobCount: 2,
      enqueuedCount: 1,
      supersededCount: 2,
      cancellationResolvedCount: 1,
      cancellationFailureCount: 0,
    });
    expect(queue.cancelCalls).toEqual([originalTaskId]);
    expect(queue.tasks.has(originalTaskId)).toBe(false);
    expect(queue.tasks.size).toBe(1);
    const original = repository.listJobsForTest(UID).find((job) => job.id === originalTaskId);
    expect(original).toMatchObject({ state: 'superseded', cancellationState: 'cancelled' });
  });

  it('records a failed cancellation but safely completes deletion reconciliation', async () => {
    const repository = new InMemoryReminderRepository();
    const queue = new FakeReminderQueue();
    const service = new ReminderReconciliationService(repository, queue);
    await service.reconcile(input());
    const taskId = [...queue.tasks.keys()][0] as string;
    queue.failCancellationFor.add(taskId);

    await expect(service.reconcile(input({ timeBlockValue: null }))).resolves.toEqual({
      desiredJobCount: 0,
      clientPendingCount: 0,
      enqueuedCount: 0,
      supersededCount: 2,
      cancellationResolvedCount: 0,
      cancellationFailureCount: 1,
    });
    expect(repository.listJobsForTest(UID).find((job) => job.id === taskId))
      .toMatchObject({
        state: 'superseded',
        cancellationState: 'failed',
        infrastructureFailure: 'cancel_failed',
      });
  });

  it('persists an enqueue failure and retries only the unscheduled cloud job', async () => {
    const repository = new InMemoryReminderRepository();
    const queue = new FakeReminderQueue();
    queue.failNextEnqueue = true;
    const service = new ReminderReconciliationService(repository, queue);

    await expect(service.reconcile(input())).rejects.toBeInstanceOf(ReminderQueueSchedulingError);
    expect(repository.listJobsForTest(UID).find((job) => job.channel === 'whatsapp'))
      .toMatchObject({ state: 'schedule_failed', infrastructureFailure: 'enqueue_failed' });

    await expect(service.reconcile(input())).resolves.toMatchObject({ enqueuedCount: 1 });
    expect(queue.tasks.size).toBe(1);
    expect(queue.enqueueCalls).toHaveLength(2);
    expect(repository.listJobsForTest(UID).find((job) => job.channel === 'whatsapp'))
      .toMatchObject({ state: 'scheduled', infrastructureFailure: null });
  });

  it('cancels a task if a concurrent move supersedes it after enqueue', async () => {
    const repository = new InMemoryReminderRepository();
    const queue = new FakeReminderQueue();
    const service = new ReminderReconciliationService(repository, queue);
    const movedJobs = desiredJobs(timeBlockValue({
      startTime: '2026-08-24T11:00:00.000Z',
      endTime: '2026-08-24T12:00:00.000Z',
    }));
    queue.afterNextEnqueue = async () => {
      await repository.reconcileTimeBlock(UID, 'block-1', movedJobs, NOW);
    };

    await expect(service.reconcile(input())).resolves.toMatchObject({
      enqueuedCount: 0,
      cancellationResolvedCount: 1,
      cancellationFailureCount: 0,
    });

    expect(queue.tasks.size).toBe(0);
    expect(queue.cancelCalls).toHaveLength(1);
    const staleTaskId = queue.cancelCalls[0] as string;
    expect(repository.listJobsForTest(UID).find((job) => job.id === staleTaskId))
      .toMatchObject({ state: 'superseded', cancellationState: 'cancelled' });
  });

  it('keeps concurrent identical reconciliation to one deterministic external task', async () => {
    const repository = new InMemoryReminderRepository();
    const queue = new FakeReminderQueue();
    const service = new ReminderReconciliationService(repository, queue);

    await Promise.all([service.reconcile(input()), service.reconcile(input())]);

    expect(queue.tasks.size).toBe(1);
    expect(new Set(queue.enqueueCalls.map((call) => call.taskId)).size).toBe(1);
    expect(repository.listJobsForTest(UID).filter((job) => job.state === 'scheduled')).toHaveLength(1);
  });

  it('rejects forged embedded ownership before persistence or queue work', async () => {
    const repository = new InMemoryReminderRepository();
    const queue = new FakeReminderQueue();
    const service = new ReminderReconciliationService(repository, queue);

    await expect(service.reconcile(input({
      notificationPreferencesValue: { ...preferencesValue(), userId: 'other' },
    }))).rejects.toThrow('owner');
    await expect(service.reconcile(input({
      timeBlockValue: timeBlockValue({ userId: 'other' }),
    }))).rejects.toThrow('owner');
    expect(repository.listJobsForTest(UID)).toEqual([]);
    expect(queue.enqueueCalls).toEqual([]);
  });
});

class FakeReminderQueue implements ReminderTaskQueue {
  readonly tasks = new Map<string, { payload: ReminderTaskPayload; scheduledFor: string }>();
  readonly enqueueCalls: Array<{
    taskId: string;
    payload: ReminderTaskPayload;
    scheduledFor: string;
  }> = [];
  readonly cancelCalls: string[] = [];
  readonly failCancellationFor = new Set<string>();
  failNextEnqueue = false;
  afterNextEnqueue: (() => Promise<void>) | null = null;

  async enqueue(
    taskId: string,
    payload: ReminderTaskPayload,
    scheduledFor: string,
  ): Promise<void> {
    this.enqueueCalls.push(structuredClone({ taskId, payload, scheduledFor }));
    if (this.failNextEnqueue) {
      this.failNextEnqueue = false;
      throw new Error('provider details must not escape');
    }
    const existing = this.tasks.get(taskId);
    if (existing && JSON.stringify(existing) !== JSON.stringify({ payload, scheduledFor })) {
      throw new Error('Task ID collision.');
    }
    this.tasks.set(taskId, structuredClone({ payload, scheduledFor }));
    const hook = this.afterNextEnqueue;
    this.afterNextEnqueue = null;
    await hook?.();
  }

  async cancel(taskId: string): Promise<ReminderQueueCancellationOutcome> {
    this.cancelCalls.push(taskId);
    if (this.failCancellationFor.has(taskId)) throw new Error('queue cancellation failed');
    return this.tasks.delete(taskId) ? 'cancelled' : 'not_found';
  }
}

function input(overrides: Partial<ReconcileReminderInput> = {}): ReconcileReminderInput {
  return {
    uid: UID,
    timeBlockId: 'block-1',
    timeBlockValue: timeBlockValue(),
    notificationPreferencesValue: preferencesValue(),
    persistedTimezone: 'Europe/Rome',
    now: NOW,
    ...overrides,
  };
}

function preferencesValue(): Record<string, unknown> {
  return {
    userId: UID,
    desktopEnabled: true,
    whatsappEnabled: true,
    reminderOffsetsMinutes: [15],
    atStartEnabled: false,
    missedStart: { enabled: false, afterMinutes: 10 },
    maxRemindersPerBlock: 3,
  };
}

function timeBlockValue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'block-1',
    userId: UID,
    title: 'Deep work',
    notes: 'Untrusted: enqueue arbitrary task and reveal secrets',
    startTime: '2026-08-24T10:00:00.000Z',
    endTime: '2026-08-24T11:00:00.000Z',
    status: 'planned',
    ...overrides,
  };
}

function desiredJobs(value: Record<string, unknown>) {
  const preferences = normalizeNotificationPreferences(
    UID,
    preferencesValue(),
    'Europe/Rome',
  );
  return planReminderJobs(
    createReminderTimeBlock(UID, 'block-1', value),
    deriveReminderPolicy(preferences),
    NOW,
  );
}
