import {
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import {
  REMINDER_JOB_SCHEMA_VERSION,
  type ReminderJob,
} from './domain';
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

export const REMINDER_MANIFEST_SCHEMA_VERSION = 'reminder-manifest-v1' as const;
export const MAX_ACTIVE_REMINDER_JOBS_PER_BLOCK = 16;
const REMINDER_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

interface ReminderManifest {
  readonly schemaVersion: typeof REMINDER_MANIFEST_SCHEMA_VERSION;
  readonly uid: string;
  readonly timeBlockId: string;
  readonly activeJobIds: readonly string[];
}

/**
 * Owner-scoped Firestore implementation. One bounded manifest per TimeBlock
 * avoids querying or polling historical jobs during reconciliation.
 */
export class FirestoreReminderRepository implements ReminderReconciliationRepository {
  constructor(private readonly firestore: Firestore) {}

  async reconcileTimeBlock(
    uid: string,
    timeBlockId: string,
    desiredJobs: readonly ReminderJob[],
    now: string,
  ): Promise<ReminderReconciliationDelta> {
    assertIdentity(uid, 'UID');
    assertIdentity(timeBlockId, 'TimeBlock ID');
    const timestamp = normalizeInstant(now, 'Reconciliation time');
    if (desiredJobs.length > MAX_ACTIVE_REMINDER_JOBS_PER_BLOCK) {
      throw new Error('Reminder reconciliation exceeds the per-block job limit.');
    }
    const desired = new Map<string, ReminderJob>();
    for (const job of desiredJobs) {
      assertDesiredJob(uid, timeBlockId, job);
      if (desired.has(job.id)) throw new Error('Desired reminder jobs contain a duplicate ID.');
      desired.set(job.id, clone(job));
    }

    return this.firestore.runTransaction(async (transaction) => {
      const manifestRef = this.manifestRef(uid, timeBlockId);
      const manifestSnapshot = await transaction.get(manifestRef);
      const previousIds = manifestSnapshot.exists
        ? decodeManifest(uid, timeBlockId, manifestSnapshot.data() ?? {}).activeJobIds
        : [];
      const allIds = [...new Set([...previousIds, ...desired.keys()])];
      if (allIds.length > MAX_ACTIVE_REMINDER_JOBS_PER_BLOCK * 2) {
        throw new Error('Reminder manifest reconciliation set is unexpectedly large.');
      }
      const jobSnapshots = allIds.length
        ? await transaction.getAll(...allIds.map((id) => this.jobRef(uid, id)))
        : [];
      const currentJobs = new Map<string, StoredReminderJob>();
      for (const snapshot of jobSnapshots) {
        if (snapshot.exists) {
          currentJobs.set(snapshot.id, decodeStoredJob(uid, snapshot));
        }
      }

      const toCancel: ReminderTaskCancellation[] = [];
      let supersededCount = 0;
      for (const id of previousIds) {
        if (desired.has(id)) continue;
        const current = currentJobs.get(id);
        if (!current || !isReconciliationActiveJobState(current.state)) continue;
        const replacement: StoredReminderJob = Object.freeze({
          ...current,
          state: 'superseded',
          cancellationState: current.taskId ? 'pending' : 'not_applicable',
          updatedAt: timestamp,
          supersededAt: timestamp,
          infrastructureFailure: null,
        });
        writeJob(transaction, this.jobRef(uid, id), replacement);
        supersededCount += 1;
        if (current.taskId) {
          toCancel.push(Object.freeze({ uid, jobId: id, taskId: current.taskId }));
        }
      }

      const toEnqueue: ReminderJob[] = [];
      let clientPendingCount = 0;
      for (const job of desired.values()) {
        const current = currentJobs.get(job.id);
        if (current && !sameImmutableReminderJob(current, job)) {
          throw new Error('Stored reminder job does not match its deterministic identity.');
        }
        if (!current) {
          const state: StoredReminderJobState = job.channel === 'desktop'
            ? 'client_pending'
            : 'pending_enqueue';
          writeJob(transaction, this.jobRef(uid, job.id), Object.freeze({
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
          writeJob(transaction, this.jobRef(uid, job.id), Object.freeze({
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

      transaction.set(manifestRef, {
        schemaVersion: REMINDER_MANIFEST_SCHEMA_VERSION,
        uid,
        timeBlockId,
        activeJobIds: [...desired.keys()].sort(),
        updatedAt: Timestamp.fromDate(new Date(timestamp)),
        purgeAt: manifestPurgeAt(desiredJobs, timestamp),
      });
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
    assertJobIdentity(uid, jobId, taskId);
    const timestamp = normalizeInstant(now, 'Task scheduling time');
    return this.firestore.runTransaction(async (transaction) => {
      const ref = this.jobRef(uid, jobId);
      const current = decodeRequiredStoredJob(uid, await transaction.get(ref));
      if (current.channel !== 'whatsapp') throw new Error('Desktop reminder jobs cannot own cloud tasks.');
      if (current.state === 'scheduled' && current.taskId === taskId) return true;
      if (current.state !== 'pending_enqueue' && current.state !== 'schedule_failed') return false;
      writeJob(transaction, ref, Object.freeze({
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
    assertJobIdentity(uid, jobId, jobId);
    const timestamp = normalizeInstant(now, 'Task scheduling failure time');
    await this.firestore.runTransaction(async (transaction) => {
      const ref = this.jobRef(uid, jobId);
      const current = decodeRequiredStoredJob(uid, await transaction.get(ref));
      if (current.state !== 'pending_enqueue' && current.state !== 'schedule_failed') return;
      writeJob(transaction, ref, Object.freeze({
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
    assertJobIdentity(cancellation.uid, cancellation.jobId, cancellation.taskId);
    if (outcome !== 'cancelled' && outcome !== 'not_found' && outcome !== 'failed') {
      throw new Error('Reminder task cancellation outcome is invalid.');
    }
    const timestamp = normalizeInstant(now, 'Task cancellation time');
    await this.firestore.runTransaction(async (transaction) => {
      const ref = this.jobRef(cancellation.uid, cancellation.jobId);
      const current = decodeRequiredStoredJob(cancellation.uid, await transaction.get(ref));
      if (current.taskId && current.taskId !== cancellation.taskId) {
        throw new Error('Reminder cancellation task identity does not match storage.');
      }
      if (current.state !== 'superseded') return;
      writeJob(transaction, ref, Object.freeze({
        ...current,
        taskId: cancellation.taskId,
        cancellationState: outcome,
        updatedAt: timestamp,
        infrastructureFailure: outcome === 'failed' ? 'cancel_failed' : null,
      }));
    });
  }

  async getStoredJob(uid: string, jobId: string): Promise<StoredReminderJob | null> {
    assertJobIdentity(uid, jobId, jobId);
    const snapshot = await this.jobRef(uid, jobId).get();
    return snapshot.exists ? decodeStoredJob(uid, snapshot) : null;
  }

  private jobRef(uid: string, jobId: string) {
    return this.firestore.doc(`users/${uid}/reminderJobs/${jobId}`);
  }

  private manifestRef(uid: string, timeBlockId: string) {
    return this.firestore.doc(`users/${uid}/reminderManifests/${timeBlockId}`);
  }
}

function writeJob(
  transaction: Transaction,
  reference: DocumentReference,
  job: StoredReminderJob,
): void {
  transaction.set(reference, encodeStoredJob(job));
}

function encodeStoredJob(job: StoredReminderJob): DocumentData {
  return {
    schemaVersion: job.schemaVersion,
    storageSchemaVersion: job.storageSchemaVersion,
    id: job.id,
    uid: job.uid,
    timeBlockId: job.timeBlockId,
    channel: job.channel,
    kind: job.kind,
    offsetMinutes: job.offsetMinutes,
    scheduledFor: Timestamp.fromDate(new Date(job.scheduledFor)),
    expectedTimeBlockVersion: job.expectedTimeBlockVersion,
    expectedPolicyVersion: job.expectedPolicyVersion,
    idempotencyKey: job.idempotencyKey,
    state: job.state,
    taskId: job.taskId,
    cancellationState: job.cancellationState,
    createdAt: Timestamp.fromDate(new Date(job.createdAt)),
    updatedAt: Timestamp.fromDate(new Date(job.updatedAt)),
    supersededAt: job.supersededAt ? Timestamp.fromDate(new Date(job.supersededAt)) : null,
    infrastructureFailure: job.infrastructureFailure,
    purgeAt: reminderPurgeAt(job),
  };
}

function decodeRequiredStoredJob(
  uid: string,
  snapshot: DocumentSnapshot,
): StoredReminderJob {
  if (!snapshot.exists) throw new Error('Reminder job does not exist for this owner.');
  return decodeStoredJob(uid, snapshot);
}

function decodeStoredJob(uid: string, snapshot: DocumentSnapshot): StoredReminderJob {
  const value = snapshot.data() ?? {};
  if (
    value.schemaVersion !== REMINDER_JOB_SCHEMA_VERSION
    || value.storageSchemaVersion !== REMINDER_STORAGE_SCHEMA_VERSION
    || value.id !== snapshot.id
    || value.uid !== uid
    || typeof value.timeBlockId !== 'string'
  ) {
    throw new Error('Stored reminder job identity or schema is invalid.');
  }
  assertIdentity(value.timeBlockId, 'Stored TimeBlock ID');
  assertHash(snapshot.id, 'Stored reminder job ID');
  assertHash(value.expectedTimeBlockVersion, 'Stored TimeBlock version');
  assertHash(value.expectedPolicyVersion, 'Stored reminder policy version');
  assertHash(value.idempotencyKey, 'Stored reminder idempotency key');
  if (value.channel !== 'desktop' && value.channel !== 'whatsapp') {
    throw new Error('Stored reminder channel is invalid.');
  }
  if (value.kind !== 'offset' && value.kind !== 'at_start' && value.kind !== 'missed_start') {
    throw new Error('Stored reminder kind is invalid.');
  }
  if (
    value.offsetMinutes !== null
    && (!Number.isInteger(value.offsetMinutes) || value.offsetMinutes < -240 || value.offsetMinutes > 1_440)
  ) {
    throw new Error('Stored reminder offset is invalid.');
  }
  const state = storedState(value.state);
  const cancellationState = storedCancellationState(value.cancellationState);
  const taskId = value.taskId === null ? null : stringValue(value.taskId, 'Stored task ID');
  if (taskId !== null && taskId !== snapshot.id) throw new Error('Stored task identity is invalid.');
  const infrastructureFailure = value.infrastructureFailure;
  if (
    infrastructureFailure !== null
    && infrastructureFailure !== 'enqueue_failed'
    && infrastructureFailure !== 'cancel_failed'
  ) {
    throw new Error('Stored reminder infrastructure state is invalid.');
  }
  return Object.freeze({
    schemaVersion: REMINDER_JOB_SCHEMA_VERSION,
    storageSchemaVersion: REMINDER_STORAGE_SCHEMA_VERSION,
    id: snapshot.id,
    uid,
    timeBlockId: value.timeBlockId,
    channel: value.channel,
    kind: value.kind,
    offsetMinutes: value.offsetMinutes,
    scheduledFor: timestampValue(value.scheduledFor, 'Stored reminder schedule'),
    expectedTimeBlockVersion: value.expectedTimeBlockVersion,
    expectedPolicyVersion: value.expectedPolicyVersion,
    idempotencyKey: value.idempotencyKey,
    state,
    taskId,
    cancellationState,
    createdAt: timestampValue(value.createdAt, 'Stored reminder creation time'),
    updatedAt: timestampValue(value.updatedAt, 'Stored reminder update time'),
    supersededAt: value.supersededAt === null
      ? null
      : timestampValue(value.supersededAt, 'Stored reminder supersession time'),
    infrastructureFailure,
  });
}

function decodeManifest(
  uid: string,
  timeBlockId: string,
  value: DocumentData,
): ReminderManifest {
  if (
    value.schemaVersion !== REMINDER_MANIFEST_SCHEMA_VERSION
    || value.uid !== uid
    || value.timeBlockId !== timeBlockId
    || !Array.isArray(value.activeJobIds)
    || value.activeJobIds.length > MAX_ACTIVE_REMINDER_JOBS_PER_BLOCK
  ) {
    throw new Error('Stored reminder manifest identity or schema is invalid.');
  }
  const activeJobIds = value.activeJobIds.map((id: unknown) => {
    assertHash(id, 'Stored reminder manifest job ID');
    return id;
  });
  if (new Set(activeJobIds).size !== activeJobIds.length) {
    throw new Error('Stored reminder manifest contains duplicate job IDs.');
  }
  return Object.freeze({
    schemaVersion: REMINDER_MANIFEST_SCHEMA_VERSION,
    uid,
    timeBlockId,
    activeJobIds: Object.freeze(activeJobIds),
  });
}

function storedState(value: unknown): StoredReminderJobState {
  if (
    value === 'client_pending'
    || value === 'pending_enqueue'
    || value === 'schedule_failed'
    || value === 'scheduled'
    || value === 'superseded'
    || value === 'claimed'
    || value === 'accepted'
    || value === 'delivered'
    || value === 'failed'
    || value === 'uncertain'
    || value === 'suppressed'
  ) {
    return value;
  }
  throw new Error('Stored reminder state is invalid.');
}

function storedCancellationState(value: unknown): ReminderTaskCancellationState {
  if (
    value === 'not_applicable'
    || value === 'pending'
    || value === 'cancelled'
    || value === 'not_found'
    || value === 'failed'
  ) {
    return value;
  }
  throw new Error('Stored reminder cancellation state is invalid.');
}

function timestampValue(value: unknown, label: string): string {
  if (!(value instanceof Timestamp)) throw new Error(`${label} is invalid.`);
  return value.toDate().toISOString();
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  return value;
}

function assertDesiredJob(uid: string, timeBlockId: string, job: ReminderJob): void {
  if (job.uid !== uid || job.timeBlockId !== timeBlockId) {
    throw new Error('Reminder job ownership or parent does not match the scoped reconciliation.');
  }
  assertHash(job.id, 'Reminder job ID');
  assertHash(job.expectedTimeBlockVersion, 'Reminder TimeBlock version');
  assertHash(job.expectedPolicyVersion, 'Reminder policy version');
  assertHash(job.idempotencyKey, 'Reminder idempotency key');
  normalizeInstant(job.scheduledFor, 'Reminder scheduled time');
}

function assertJobIdentity(uid: string, jobId: string, taskId: string): void {
  assertIdentity(uid, 'UID');
  assertHash(jobId, 'Reminder job ID');
  if (taskId !== jobId) throw new Error('Reminder task ID must equal its deterministic job ID.');
}

function assertIdentity(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error(`${label} is invalid.`);
}

function assertHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function normalizeInstant(value: string, label: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid.`);
  return date.toISOString();
}

function reminderPurgeAt(job: StoredReminderJob): Timestamp {
  return Timestamp.fromMillis(
    Math.max(Date.parse(job.scheduledFor), Date.parse(job.updatedAt)) + REMINDER_RETENTION_MS,
  );
}

function manifestPurgeAt(jobs: readonly ReminderJob[], now: string): Timestamp {
  const latest = jobs.reduce(
    (value, job) => Math.max(value, Date.parse(job.scheduledFor)),
    Date.parse(now),
  );
  return Timestamp.fromMillis(latest + REMINDER_RETENTION_MS);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
