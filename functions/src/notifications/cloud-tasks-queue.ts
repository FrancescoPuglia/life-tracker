import type { App } from 'firebase-admin/app';
import { getFunctions, type TaskOptions } from 'firebase-admin/functions';
import {
  REMINDER_TASK_SCHEMA_VERSION,
  type ReminderTaskPayload,
} from './domain';
import type {
  ReminderQueueCancellationOutcome,
  ReminderTaskQueue,
} from './repository';

export const REMINDER_TASK_REGION = 'europe-west1' as const;
export const REMINDER_TASK_FUNCTION_NAME = 'deliverReminderTask' as const;
export const REMINDER_TASK_TARGET =
  `locations/${REMINDER_TASK_REGION}/functions/${REMINDER_TASK_FUNCTION_NAME}` as const;
export const CLOUD_TASK_SAFE_SCHEDULE_HORIZON_MS = 29 * 24 * 60 * 60 * 1_000;
export const REMINDER_TASK_DISPATCH_DEADLINE_SECONDS = 60;

interface FirebaseTaskQueueClient {
  enqueue(data: ReminderTaskPayload, options: TaskOptions): Promise<void>;
  delete(taskId: string): Promise<void>;
}

export class ReminderTaskQueueInfrastructureError extends Error {
  readonly code: 'REMINDER_TASK_ENQUEUE_FAILED' | 'REMINDER_TASK_CANCEL_FAILED';

  constructor(code: ReminderTaskQueueInfrastructureError['code']) {
    super(code === 'REMINDER_TASK_ENQUEUE_FAILED'
      ? 'Reminder task enqueue failed.'
      : 'Reminder task cancellation failed.');
    this.name = 'ReminderTaskQueueInfrastructureError';
    this.code = code;
  }
}

/** Firebase Admin Cloud Tasks adapter. It never adds user content or headers. */
export class FirebaseReminderTaskQueue implements ReminderTaskQueue {
  readonly maximumScheduleHorizonMs = CLOUD_TASK_SAFE_SCHEDULE_HORIZON_MS;

  constructor(
    private readonly client: FirebaseTaskQueueClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async enqueue(
    taskId: string,
    payload: ReminderTaskPayload,
    scheduledFor: string,
  ): Promise<void> {
    assertTaskIdentity(taskId, payload);
    const scheduleTime = validDate(scheduledFor, 'Reminder task schedule');
    if (scheduleTime.getTime() > this.now().getTime() + this.maximumScheduleHorizonMs) {
      throw new Error('Reminder task schedule exceeds the safe Cloud Tasks horizon.');
    }
    try {
      await this.client.enqueue(Object.freeze({ ...payload }), {
        id: taskId,
        scheduleTime,
        dispatchDeadlineSeconds: REMINDER_TASK_DISPATCH_DEADLINE_SECONDS,
      });
    } catch (error) {
      if (isTaskAlreadyExists(error)) return;
      throw new ReminderTaskQueueInfrastructureError('REMINDER_TASK_ENQUEUE_FAILED');
    }
  }

  async cancel(taskId: string): Promise<ReminderQueueCancellationOutcome> {
    assertHash(taskId, 'Reminder task ID');
    try {
      // Firebase Admin intentionally treats both deleted and already absent as
      // success, so the provider-neutral receipt is accurately named resolved.
      await this.client.delete(taskId);
      return 'resolved';
    } catch {
      throw new ReminderTaskQueueInfrastructureError('REMINDER_TASK_CANCEL_FAILED');
    }
  }
}

export function createFirebaseReminderTaskQueue(app: App): FirebaseReminderTaskQueue {
  return new FirebaseReminderTaskQueue(
    getFunctions(app).taskQueue<ReminderTaskPayload>(REMINDER_TASK_TARGET),
  );
}

function assertTaskIdentity(taskId: string, payload: ReminderTaskPayload): void {
  assertHash(taskId, 'Reminder task ID');
  if (
    payload.schemaVersion !== REMINDER_TASK_SCHEMA_VERSION
    || payload.jobId !== taskId
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(payload.uid)
  ) {
    throw new Error('Reminder task payload identity or schema is invalid.');
  }
  if (Object.keys(payload).sort().join(',') !== 'jobId,schemaVersion,uid') {
    throw new Error('Reminder task payload contains unsupported fields.');
  }
}

function assertHash(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} is invalid.`);
}

function validDate(value: string, label: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid.`);
  return date;
}

function isTaskAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'functions/task-already-exists' || code === 'task-already-exists';
}
