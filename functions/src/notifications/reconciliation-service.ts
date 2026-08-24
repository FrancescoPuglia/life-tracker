import {
  createReminderTimeBlock,
  deriveReminderPolicy,
  normalizeNotificationPreferences,
  planReminderJobs,
  reminderTaskPayload,
  type ReminderJob,
} from './domain';
import type {
  ReminderQueueCancellationOutcome,
  ReminderReconciliationRepository,
  ReminderTaskCancellation,
  ReminderTaskQueue,
} from './repository';

export interface ReconcileReminderInput {
  readonly uid: string;
  readonly timeBlockId: string;
  readonly timeBlockValue: Readonly<Record<string, unknown>> | null;
  readonly notificationPreferencesValue: unknown;
  readonly persistedTimezone: unknown;
  readonly now: string;
}

export interface ReconcileReminderResult {
  readonly desiredJobCount: number;
  readonly clientPendingCount: number;
  readonly enqueuedCount: number;
  readonly supersededCount: number;
  readonly cancellationResolvedCount: number;
  readonly cancellationFailureCount: number;
}

export class ReminderQueueSchedulingError extends Error {
  readonly code = 'REMINDER_QUEUE_SCHEDULING_FAILED';
  readonly failureCount: number;

  constructor(failureCount: number) {
    super(`Failed to schedule ${failureCount} reminder task(s).`);
    this.name = 'ReminderQueueSchedulingError';
    this.failureCount = failureCount;
  }
}

/**
 * Reconciles durable job state before touching Cloud Tasks. Queue cancellation
 * is best effort because the authenticated worker must independently suppress
 * superseded/stale jobs. Enqueue failures are retriable and never include raw
 * provider errors in persisted state or returned messages.
 */
export class ReminderReconciliationService {
  constructor(
    private readonly repository: ReminderReconciliationRepository,
    private readonly queue: ReminderTaskQueue,
  ) {}

  async reconcile(input: ReconcileReminderInput): Promise<ReconcileReminderResult> {
    const now = normalizeInstant(input.now);
    const preferences = normalizeNotificationPreferences(
      input.uid,
      input.notificationPreferencesValue,
      input.persistedTimezone,
    );
    const policy = deriveReminderPolicy(preferences);
    const desiredJobs = input.timeBlockValue
      ? planReminderJobs(
        createReminderTimeBlock(input.uid, input.timeBlockId, input.timeBlockValue),
        policy,
        now,
      )
      : Object.freeze([]) as readonly ReminderJob[];
    const delta = await this.repository.reconcileTimeBlock(
      input.uid,
      input.timeBlockId,
      desiredJobs,
      now,
    );

    let cancellationResolvedCount = 0;
    let cancellationFailureCount = 0;
    for (const cancellation of delta.toCancel) {
      const outcome = await this.cancelSafely(cancellation, now);
      if (outcome === 'failed') cancellationFailureCount += 1;
      else cancellationResolvedCount += 1;
    }

    let enqueuedCount = 0;
    let enqueueFailureCount = 0;
    for (const job of delta.toEnqueue) {
      if (job.channel !== 'whatsapp') {
        await this.repository.markTaskEnqueueFailed(input.uid, job.id, now);
        enqueueFailureCount += 1;
        continue;
      }
      try {
        await this.queue.enqueue(job.id, reminderTaskPayload(job), job.scheduledFor);
        const remainsCurrent = await this.repository.markTaskScheduled(
          input.uid,
          job.id,
          job.id,
          now,
        );
        if (remainsCurrent) {
          enqueuedCount += 1;
        } else {
          const outcome = await this.cancelSafely(
            { uid: input.uid, jobId: job.id, taskId: job.id },
            now,
          );
          if (outcome === 'failed') cancellationFailureCount += 1;
          else cancellationResolvedCount += 1;
        }
      } catch {
        await this.repository.markTaskEnqueueFailed(input.uid, job.id, now);
        enqueueFailureCount += 1;
      }
    }
    if (enqueueFailureCount > 0) throw new ReminderQueueSchedulingError(enqueueFailureCount);

    return Object.freeze({
      desiredJobCount: desiredJobs.length,
      clientPendingCount: delta.clientPendingCount,
      enqueuedCount,
      supersededCount: delta.supersededCount,
      cancellationResolvedCount,
      cancellationFailureCount,
    });
  }

  private async cancelSafely(
    cancellation: ReminderTaskCancellation,
    now: string,
  ): Promise<ReminderQueueCancellationOutcome | 'failed'> {
    try {
      const outcome = await this.queue.cancel(cancellation.taskId);
      await this.repository.recordTaskCancellation(cancellation, outcome, now);
      return outcome;
    } catch {
      await this.repository.recordTaskCancellation(cancellation, 'failed', now);
      return 'failed';
    }
  }
}

function normalizeInstant(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Reminder reconciliation time is invalid.');
  return date.toISOString();
}
