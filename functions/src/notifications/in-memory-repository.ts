import type { ReminderJob } from './domain';
import {
  REMINDER_STORAGE_SCHEMA_VERSION,
  isReconciliationActiveJobState,
  sameImmutableReminderJob,
  type ReminderReconciliationDelta,
  type ReminderReconciliationRepository,
  type ReminderTaskCancellation,
  type ReminderTaskCancellationState,
  type StoredReminderJob,
  type StoredReminderJobState,
} from './repository';

/** Deterministic transactional adapter for unit tests; it never contacts Firebase. */
export class InMemoryReminderRepository implements ReminderReconciliationRepository {
  private readonly jobs = new Map<string, StoredReminderJob>();
  private transactionTail: Promise<void> = Promise.resolve();

  async reconcileTimeBlock(
    uid: string,
    timeBlockId: string,
    desiredJobs: readonly ReminderJob[],
    now: string,
  ): Promise<ReminderReconciliationDelta> {
    return this.withTransaction(() => {
      assertIdentity(uid, 'UID');
      assertIdentity(timeBlockId, 'TimeBlock ID');
      const timestamp = validInstant(now, 'Reconciliation time');
      const desired = new Map<string, ReminderJob>();
      for (const job of desiredJobs) {
        assertDesiredJob(uid, timeBlockId, job);
        if (desired.has(job.id)) throw new Error('Desired reminder jobs contain a duplicate ID.');
        desired.set(job.id, clone(job));
      }

      const toCancel: ReminderTaskCancellation[] = [];
      let supersededCount = 0;
      for (const [key, current] of this.jobs) {
        if (
          current.uid !== uid
          || current.timeBlockId !== timeBlockId
          || desired.has(current.id)
          || !isReconciliationActiveJobState(current.state)
        ) {
          continue;
        }
        const cancellationState = current.taskId ? 'pending' : 'not_applicable';
        this.jobs.set(key, Object.freeze({
          ...current,
          state: 'superseded',
          cancellationState,
          updatedAt: timestamp,
          supersededAt: timestamp,
          infrastructureFailure: null,
        }));
        supersededCount += 1;
        if (current.taskId) {
          toCancel.push(Object.freeze({ uid, jobId: current.id, taskId: current.taskId }));
        }
      }

      const toEnqueue: ReminderJob[] = [];
      let clientPendingCount = 0;
      for (const job of desired.values()) {
        const key = jobKey(uid, job.id);
        const current = this.jobs.get(key);
        if (current && !sameImmutableReminderJob(current, job)) {
          throw new Error('Stored reminder job does not match its deterministic identity.');
        }
        if (!current) {
          const state: StoredReminderJobState = job.channel === 'desktop'
            ? 'client_pending'
            : 'pending_enqueue';
          this.jobs.set(key, Object.freeze({
            ...clone(job),
            storageSchemaVersion: REMINDER_STORAGE_SCHEMA_VERSION,
            state,
            taskId: null,
            cancellationState: 'not_applicable',
            createdAt: timestamp,
            updatedAt: timestamp,
            supersededAt: null,
            infrastructureFailure: null,
          }));
          if (state === 'client_pending') clientPendingCount += 1;
          else toEnqueue.push(clone(job));
          continue;
        }
        if (current.state === 'client_pending') {
          clientPendingCount += 1;
        } else if (current.state === 'pending_enqueue' || current.state === 'schedule_failed') {
          toEnqueue.push(clone(job));
        } else if (current.state === 'superseded') {
          const state: StoredReminderJobState = job.channel === 'desktop'
            ? 'client_pending'
            : 'pending_enqueue';
          this.jobs.set(key, Object.freeze({
            ...current,
            state,
            taskId: null,
            cancellationState: 'not_applicable',
            updatedAt: timestamp,
            supersededAt: null,
            infrastructureFailure: null,
          }));
          if (state === 'client_pending') clientPendingCount += 1;
          else toEnqueue.push(clone(job));
        }
      }

      return Object.freeze({
        toEnqueue: Object.freeze(toEnqueue),
        toCancel: Object.freeze(toCancel),
        supersededCount,
        clientPendingCount,
      });
    });
  }

  async markTaskScheduled(
    uid: string,
    jobId: string,
    taskId: string,
    now: string,
  ): Promise<boolean> {
    return this.withTransaction(() => {
      const current = this.requiredJob(uid, jobId);
      const timestamp = validInstant(now, 'Task scheduling time');
      if (taskId !== jobId) throw new Error('Reminder task ID must equal its deterministic job ID.');
      if (current.channel !== 'whatsapp') throw new Error('Desktop reminder jobs cannot own cloud tasks.');
      if (current.state === 'scheduled' && current.taskId === taskId) return true;
      if (current.state !== 'pending_enqueue' && current.state !== 'schedule_failed') return false;
      this.jobs.set(jobKey(uid, jobId), Object.freeze({
        ...current,
        state: 'scheduled',
        taskId,
        cancellationState: 'not_applicable',
        updatedAt: timestamp,
        infrastructureFailure: null,
      }));
      return true;
    });
  }

  async markTaskEnqueueFailed(uid: string, jobId: string, now: string): Promise<void> {
    return this.withTransaction(() => {
      const current = this.requiredJob(uid, jobId);
      const timestamp = validInstant(now, 'Task scheduling failure time');
      if (current.state !== 'pending_enqueue' && current.state !== 'schedule_failed') return;
      this.jobs.set(jobKey(uid, jobId), Object.freeze({
        ...current,
        state: 'schedule_failed',
        updatedAt: timestamp,
        infrastructureFailure: 'enqueue_failed',
      }));
    });
  }

  async recordTaskCancellation(
    cancellation: ReminderTaskCancellation,
    outcome: Exclude<ReminderTaskCancellationState, 'not_applicable' | 'pending'>,
    now: string,
  ): Promise<void> {
    return this.withTransaction(() => {
      const current = this.requiredJob(cancellation.uid, cancellation.jobId);
      const timestamp = validInstant(now, 'Task cancellation time');
      if (cancellation.taskId !== cancellation.jobId) {
        throw new Error('Reminder cancellation task ID must equal its deterministic job ID.');
      }
      if (current.taskId && current.taskId !== cancellation.taskId) {
        throw new Error('Reminder cancellation task identity does not match storage.');
      }
      if (current.state !== 'superseded') return;
      this.jobs.set(jobKey(current.uid, current.id), Object.freeze({
        ...current,
        taskId: cancellation.taskId,
        cancellationState: outcome,
        updatedAt: timestamp,
        infrastructureFailure: outcome === 'failed' ? 'cancel_failed' : null,
      }));
    });
  }

  listJobsForTest(uid: string): readonly StoredReminderJob[] {
    return [...this.jobs.values()]
      .filter((job) => job.uid === uid)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(clone);
  }

  private requiredJob(uid: string, jobId: string): StoredReminderJob {
    assertIdentity(uid, 'UID');
    assertIdentity(jobId, 'Reminder job ID');
    const current = this.jobs.get(jobKey(uid, jobId));
    if (!current) throw new Error('Reminder job does not exist for this owner.');
    return current;
  }

  private async withTransaction<T>(operation: () => T | Promise<T>): Promise<T> {
    const run = this.transactionTail.then(operation, operation);
    this.transactionTail = run.then(() => undefined, () => undefined);
    return run;
  }
}

function assertDesiredJob(uid: string, timeBlockId: string, job: ReminderJob): void {
  if (job.uid !== uid || job.timeBlockId !== timeBlockId) {
    throw new Error('Reminder job ownership or parent does not match the scoped reconciliation.');
  }
  assertIdentity(job.id, 'Reminder job ID');
  validInstant(job.scheduledFor, 'Reminder scheduled time');
}

function assertIdentity(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error(`${label} is invalid.`);
}

function validInstant(value: string, label: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid.`);
  return date.toISOString();
}

function jobKey(uid: string, jobId: string): string {
  return `${uid}\u0000${jobId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
