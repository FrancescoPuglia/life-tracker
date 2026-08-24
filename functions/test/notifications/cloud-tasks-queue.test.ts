import { describe, expect, it } from 'vitest';
import {
  CLOUD_TASK_SAFE_SCHEDULE_HORIZON_MS,
  FirebaseReminderTaskQueue,
  REMINDER_TASK_DISPATCH_DEADLINE_SECONDS,
  ReminderTaskQueueInfrastructureError,
} from '../../src/notifications/cloud-tasks-queue';
import type { ReminderTaskPayload } from '../../src/notifications/domain';

const NOW = new Date('2026-08-24T08:00:00.000Z');
const JOB_ID = 'a'.repeat(64);
const PAYLOAD: ReminderTaskPayload = {
  schemaVersion: 'reminder-task-v1',
  uid: 'owner-1',
  jobId: JOB_ID,
};

describe('FirebaseReminderTaskQueue', () => {
  it('enqueues the minimal payload with a hashed ID and bounded dispatch deadline', async () => {
    const client = new FakeTaskQueueClient();
    const queue = new FirebaseReminderTaskQueue(client, () => NOW);
    const scheduledFor = '2026-08-24T09:45:00.000Z';

    await queue.enqueue(JOB_ID, PAYLOAD, scheduledFor);

    expect(client.enqueues).toEqual([{
      data: PAYLOAD,
      options: {
        id: JOB_ID,
        scheduleTime: new Date(scheduledFor),
        dispatchDeadlineSeconds: REMINDER_TASK_DISPATCH_DEADLINE_SECONDS,
      },
    }]);
    expect(JSON.stringify(client.enqueues)).not.toContain('title');
    expect(JSON.stringify(client.enqueues)).not.toContain('note');
    expect(JSON.stringify(client.enqueues)).not.toContain('token');
  });

  it.each(['functions/task-already-exists', 'task-already-exists'])(
    'treats deterministic task replay %s as success',
    async (code) => {
      const client = new FakeTaskQueueClient();
      client.enqueueError = { code, message: 'provider detail' };
      const queue = new FirebaseReminderTaskQueue(client, () => NOW);

      await expect(queue.enqueue(JOB_ID, PAYLOAD, NOW.toISOString())).resolves.toBeUndefined();
      expect(client.enqueues).toHaveLength(1);
    },
  );

  it('returns an accurate resolved cancellation without claiming deletion vs absence', async () => {
    const client = new FakeTaskQueueClient();
    const queue = new FirebaseReminderTaskQueue(client, () => NOW);

    await expect(queue.cancel(JOB_ID)).resolves.toBe('resolved');
    expect(client.deletes).toEqual([JOB_ID]);
  });

  it('normalizes queue failures without exposing raw infrastructure details', async () => {
    const client = new FakeTaskQueueClient();
    client.enqueueError = new Error('sensitive provider response');
    client.deleteError = new Error('sensitive cancellation response');
    const queue = new FirebaseReminderTaskQueue(client, () => NOW);

    await expect(queue.enqueue(JOB_ID, PAYLOAD, NOW.toISOString())).rejects.toMatchObject({
      code: 'REMINDER_TASK_ENQUEUE_FAILED',
      message: 'Reminder task enqueue failed.',
    });
    await expect(queue.cancel(JOB_ID)).rejects.toMatchObject({
      code: 'REMINDER_TASK_CANCEL_FAILED',
      message: 'Reminder task cancellation failed.',
    });
    await expect(queue.cancel(JOB_ID)).rejects.toBeInstanceOf(ReminderTaskQueueInfrastructureError);
  });

  it('rejects malformed identity, expanded payloads, and schedules beyond 29 days', async () => {
    const client = new FakeTaskQueueClient();
    const queue = new FirebaseReminderTaskQueue(client, () => NOW);
    const tooFar = new Date(NOW.getTime() + CLOUD_TASK_SAFE_SCHEDULE_HORIZON_MS + 1).toISOString();

    await expect(queue.enqueue('bad', PAYLOAD, NOW.toISOString())).rejects.toThrow('ID');
    await expect(queue.enqueue(JOB_ID, { ...PAYLOAD, uid: '../other' }, NOW.toISOString()))
      .rejects.toThrow('identity');
    await expect(queue.enqueue(JOB_ID, {
      ...PAYLOAD,
      title: 'must not enter task payload',
    } as ReminderTaskPayload, NOW.toISOString())).rejects.toThrow('identity');
    await expect(queue.enqueue(JOB_ID, PAYLOAD, tooFar)).rejects.toThrow('horizon');
    expect(client.enqueues).toEqual([]);
  });
});

class FakeTaskQueueClient {
  readonly enqueues: Array<{ data: ReminderTaskPayload; options: unknown }> = [];
  readonly deletes: string[] = [];
  enqueueError: unknown;
  deleteError: unknown;

  async enqueue(data: ReminderTaskPayload, options: unknown): Promise<void> {
    this.enqueues.push(structuredClone({ data, options }));
    if (this.enqueueError) throw this.enqueueError;
  }

  async delete(taskId: string): Promise<void> {
    this.deletes.push(taskId);
    if (this.deleteError) throw this.deleteError;
  }
}
