import type { ReminderJob, ReminderTaskPayload } from './domain';

export const REMINDER_STORAGE_SCHEMA_VERSION = 'reminder-storage-v1' as const;

export type StoredReminderJobState =
  | 'client_pending'
  | 'pending_enqueue'
  | 'schedule_failed'
  | 'scheduled'
  | 'superseded'
  | 'claimed'
  | 'accepted'
  | 'delivered'
  | 'failed'
  | 'uncertain'
  | 'suppressed';

export type ReminderTaskCancellationState =
  | 'not_applicable'
  | 'pending'
  | 'cancelled'
  | 'not_found'
  | 'failed';

export interface StoredReminderJob extends ReminderJob {
  readonly storageSchemaVersion: typeof REMINDER_STORAGE_SCHEMA_VERSION;
  readonly state: StoredReminderJobState;
  readonly taskId: string | null;
  readonly cancellationState: ReminderTaskCancellationState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly supersededAt: string | null;
  readonly infrastructureFailure: 'enqueue_failed' | 'cancel_failed' | null;
}

export interface ReminderTaskCancellation {
  readonly uid: string;
  readonly jobId: string;
  readonly taskId: string;
}

export interface ReminderReconciliationDelta {
  readonly toEnqueue: readonly ReminderJob[];
  readonly toCancel: readonly ReminderTaskCancellation[];
  readonly supersededCount: number;
  readonly clientPendingCount: number;
}

export interface ReminderReconciliationRepository {
  /**
   * Atomically persists the exact desired set for one owner-scoped TimeBlock,
   * marks older active jobs superseded, and returns external queue work.
   */
  reconcileTimeBlock(
    uid: string,
    timeBlockId: string,
    desiredJobs: readonly ReminderJob[],
    now: string,
  ): Promise<ReminderReconciliationDelta>;

  /**
   * Returns false when a concurrent reconciliation superseded the job after
   * enqueue. The caller must then best-effort cancel the newly created task.
   */
  markTaskScheduled(
    uid: string,
    jobId: string,
    taskId: string,
    now: string,
  ): Promise<boolean>;

  markTaskEnqueueFailed(uid: string, jobId: string, now: string): Promise<void>;

  recordTaskCancellation(
    cancellation: ReminderTaskCancellation,
    outcome: Exclude<ReminderTaskCancellationState, 'not_applicable' | 'pending'>,
    now: string,
  ): Promise<void>;
}

export type ReminderQueueCancellationOutcome = 'cancelled' | 'not_found';

export interface ReminderTaskQueue {
  enqueue(
    taskId: string,
    payload: ReminderTaskPayload,
    scheduledFor: string,
  ): Promise<void>;

  cancel(taskId: string): Promise<ReminderQueueCancellationOutcome>;
}
