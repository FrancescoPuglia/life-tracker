import type { ReminderJob, ReminderTaskPayload } from './domain';

export const REMINDER_STORAGE_SCHEMA_VERSION = 'reminder-storage-v1' as const;

export type StoredReminderJobState =
  | 'client_pending'
  | 'deferred_enqueue'
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

export const RECONCILIATION_ACTIVE_JOB_STATES: ReadonlySet<StoredReminderJobState> = new Set([
  'client_pending',
  'deferred_enqueue',
  'pending_enqueue',
  'schedule_failed',
  'scheduled',
]);

export type ReminderTaskCancellationState =
  | 'not_applicable'
  | 'pending'
  | 'resolved'
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
  readonly deferredCount: number;
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
    enqueueThrough: string,
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

export type ReminderQueueCancellationOutcome = 'resolved';

export interface ReminderTaskQueue {
  /** Must stay below the provider's documented absolute maximum. */
  readonly maximumScheduleHorizonMs: number;

  enqueue(
    taskId: string,
    payload: ReminderTaskPayload,
    scheduledFor: string,
  ): Promise<void>;

  cancel(taskId: string): Promise<ReminderQueueCancellationOutcome>;
}

export function isReconciliationActiveJobState(state: StoredReminderJobState): boolean {
  return RECONCILIATION_ACTIVE_JOB_STATES.has(state);
}

export function sameImmutableReminderJob(
  stored: StoredReminderJob,
  desired: ReminderJob,
): boolean {
  return stored.schemaVersion === desired.schemaVersion
    && stored.id === desired.id
    && stored.uid === desired.uid
    && stored.timeBlockId === desired.timeBlockId
    && stored.channel === desired.channel
    && stored.kind === desired.kind
    && stored.offsetMinutes === desired.offsetMinutes
    && stored.scheduledFor === desired.scheduledFor
    && stored.expectedTimeBlockVersion === desired.expectedTimeBlockVersion
    && stored.expectedPolicyVersion === desired.expectedPolicyVersion
    && stored.idempotencyKey === desired.idempotencyKey;
}

export function desiredReminderStorageState(
  job: ReminderJob,
  enqueueThrough: string,
): Extract<StoredReminderJobState, 'client_pending' | 'deferred_enqueue' | 'pending_enqueue'> {
  if (job.channel === 'desktop') return 'client_pending';
  return Date.parse(job.scheduledFor) <= Date.parse(enqueueThrough)
    ? 'pending_enqueue'
    : 'deferred_enqueue';
}
