import { createHash } from 'node:crypto';
import {
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import {
  createReminderTimeBlock,
  deriveReminderPolicy,
  evaluateReminderDelivery,
  normalizeNotificationPreferences,
  REMINDER_JOB_SCHEMA_VERSION,
  type ReminderJob,
  type ReminderSuppressionReason,
} from './domain';
import {
  DELIVERY_ATTEMPT_SCHEMA_VERSION,
  DELIVERY_RECEIPT_SCHEMA_VERSION,
  NOTIFICATION_IDEMPOTENCY_SCHEMA_VERSION,
  REMINDER_DELIVERY_COUNTER_SCHEMA_VERSION,
  type FinalizeReminderDeliveryInput,
  type MessagingRejectionReason,
  type MessagingUncertaintyReason,
  type NotificationIdempotencyRecord,
  type PrepareReminderDeliveryInput,
  type ReminderDeliveryAttemptRecord,
  type ReminderDeliveryCounter,
  type ReminderDeliveryFinalization,
  type ReminderDeliveryOutcome,
  type ReminderDeliveryPreparation,
  type ReminderDeliveryReceipt,
  type ReminderDeliveryRepository,
} from './delivery';
import {
  REMINDER_STORAGE_SCHEMA_VERSION,
  ReminderAuthorityChangedError,
  desiredReminderStorageState,
  isReconciliationActiveJobState,
  sameImmutableReminderJob,
  type BoundedReminderTargetBatch,
  type BoundedTimeBlockBatch,
  type ReminderAuthorityExpectation,
  type ReminderReconciliationDelta,
  type ReminderReconciliationRepository,
  type ReminderReconciliationContext,
  type ReminderReconciliationSource,
  type ReminderTaskCancellation,
  type ReminderTaskCancellationState,
  type StoredReminderJob,
  type StoredReminderJobState,
} from './repository';

export const REMINDER_MANIFEST_SCHEMA_VERSION = 'reminder-manifest-v1' as const;
export const MAX_ACTIVE_REMINDER_JOBS_PER_BLOCK = 16;
const REMINDER_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
export const DELIVERY_CLAIM_RECOVERY_DELAY_MS = 5 * 60 * 1_000;

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
export class FirestoreReminderRepository implements
  ReminderReconciliationRepository,
  ReminderDeliveryRepository,
  ReminderReconciliationSource {
  constructor(private readonly firestore: Firestore) {}

  async loadReconciliationContext(
    uid: string,
    timeBlockId: string,
  ): Promise<ReminderReconciliationContext> {
    assertIdentity(uid, 'UID');
    assertIdentity(timeBlockId, 'TimeBlock ID');
    const snapshots = await this.firestore.getAll(
      this.firestore.doc(`users/${uid}/timeBlocks/${timeBlockId}`),
      this.firestore.doc(`users/${uid}`),
      this.firestore.doc(`users/${uid}/notificationPreferences/default`),
    );
    const [timeBlockSnapshot, userSnapshot, preferenceSnapshot] = snapshots;
    if (!timeBlockSnapshot || !userSnapshot || !preferenceSnapshot) {
      throw new Error('Reminder reconciliation source read is incomplete.');
    }
    const timeBlockValue = timeBlockSnapshot.exists
      ? timeBlockSnapshot.data() ?? {}
      : null;
    if (timeBlockValue) {
      assertScopedDocumentOwner(uid, timeBlockValue, 'TimeBlock');
    }
    const notificationPreferencesValue = preferenceSnapshot.exists
      ? preferenceSnapshot.data() ?? {}
      : {};
    if (preferenceSnapshot.exists) {
      assertScopedDocumentOwner(uid, notificationPreferencesValue, 'Notification preferences');
    }
    return Object.freeze({
      timeBlockValue,
      notificationPreferencesValue,
      persistedTimezone: persistedUserTimezone(
        uid,
        userSnapshot.exists ? userSnapshot.data() ?? {} : null,
      ),
    });
  }

  async listFutureActiveTimeBlockIds(
    uid: string,
    now: string,
    maximum: number,
  ): Promise<BoundedTimeBlockBatch> {
    assertIdentity(uid, 'UID');
    const timestamp = normalizeInstant(now, 'Future TimeBlock query time');
    assertBatchMaximum(maximum);
    const snapshot = await this.firestore.collection(`users/${uid}/timeBlocks`)
      .where('status', 'in', ['planned', 'in_progress'])
      .where('endTime', '>', Timestamp.fromDate(new Date(timestamp)))
      .orderBy('endTime', 'asc')
      .limit(maximum + 1)
      .get();
    for (const document of snapshot.docs) {
      assertIdentity(document.id, 'TimeBlock ID');
      assertScopedDocumentOwner(uid, document.data(), 'TimeBlock');
    }
    return Object.freeze({
      timeBlockIds: Object.freeze(snapshot.docs.slice(0, maximum).map((document) => document.id)),
      overflow: snapshot.size > maximum,
    });
  }

  async listDueDeferredTargets(
    now: string,
    enqueueThrough: string,
    maximum: number,
  ): Promise<BoundedReminderTargetBatch> {
    const timestamp = normalizeInstant(now, 'Deferred reminder query time');
    const enqueueBoundary = normalizeInstant(enqueueThrough, 'Deferred reminder enqueue horizon');
    if (Date.parse(enqueueBoundary) < Date.parse(timestamp)) {
      throw new Error('Deferred reminder enqueue horizon cannot be before query time.');
    }
    assertBatchMaximum(maximum);
    const snapshot = await this.firestore.collectionGroup('reminderJobs')
      .where('state', 'in', ['deferred_enqueue', 'pending_enqueue', 'schedule_failed'])
      .where('scheduledFor', '<=', Timestamp.fromDate(new Date(enqueueBoundary)))
      .orderBy('scheduledFor', 'asc')
      .limit(maximum + 1)
      .get();
    const targets = new Map<string, Readonly<{ uid: string; timeBlockId: string }>>();
    for (const document of snapshot.docs.slice(0, maximum)) {
      const path = document.ref.path.split('/');
      if (
        path.length !== 4
        || path[0] !== 'users'
        || path[2] !== 'reminderJobs'
        || path[3] !== document.id
      ) {
        throw new Error('Deferred reminder path is invalid.');
      }
      const uid = path[1];
      if (!uid) throw new Error('Deferred reminder owner path is invalid.');
      assertIdentity(uid, 'UID');
      const job = decodeStoredJob(uid, document);
      if (
        !['deferred_enqueue', 'pending_enqueue', 'schedule_failed'].includes(job.state)
        || job.channel !== 'whatsapp'
      ) {
        throw new Error('Deferred reminder state or channel is invalid.');
      }
      targets.set(`${uid}\u0000${job.timeBlockId}`, Object.freeze({
        uid,
        timeBlockId: job.timeBlockId,
      }));
    }
    return Object.freeze({
      targets: Object.freeze([...targets.values()]),
      overflow: snapshot.size > maximum,
    });
  }

  async reconcileTimeBlock(
    uid: string,
    timeBlockId: string,
    desiredJobs: readonly ReminderJob[],
    now: string,
    enqueueThrough: string,
    authority: ReminderAuthorityExpectation,
  ): Promise<ReminderReconciliationDelta> {
    assertIdentity(uid, 'UID');
    assertIdentity(timeBlockId, 'TimeBlock ID');
    const timestamp = normalizeInstant(now, 'Reconciliation time');
    const enqueueBoundary = normalizeInstant(enqueueThrough, 'Task enqueue horizon');
    if (Date.parse(enqueueBoundary) < Date.parse(timestamp)) {
      throw new Error('Task enqueue horizon cannot be before reconciliation time.');
    }
    if (desiredJobs.length > MAX_ACTIVE_REMINDER_JOBS_PER_BLOCK) {
      throw new Error('Reminder reconciliation exceeds the per-block job limit.');
    }
    assertAuthorityExpectation(authority);
    const desired = new Map<string, ReminderJob>();
    for (const job of desiredJobs) {
      assertDesiredJob(uid, timeBlockId, job);
      if (
        job.expectedTimeBlockVersion !== authority.expectedTimeBlockVersion
        || job.expectedPolicyVersion !== authority.expectedPolicyVersion
      ) {
        throw new Error('Desired reminder job does not match the observed authority.');
      }
      if (desired.has(job.id)) throw new Error('Desired reminder jobs contain a duplicate ID.');
      desired.set(job.id, clone(job));
    }

    return this.firestore.runTransaction(async (transaction) => {
      const manifestRef = this.manifestRef(uid, timeBlockId);
      const authoritySnapshots = await transaction.getAll(
        manifestRef,
        this.firestore.doc(`users/${uid}/timeBlocks/${timeBlockId}`),
        this.firestore.doc(`users/${uid}`),
        this.firestore.doc(`users/${uid}/notificationPreferences/default`),
      );
      const [manifestSnapshot, timeBlockSnapshot, userSnapshot, preferenceSnapshot]
        = authoritySnapshots;
      if (!manifestSnapshot || !timeBlockSnapshot || !userSnapshot || !preferenceSnapshot) {
        throw new Error('Reminder reconciliation authority read is incomplete.');
      }
      assertCurrentReconciliationAuthority(
        uid,
        timeBlockId,
        timeBlockSnapshot,
        userSnapshot,
        preferenceSnapshot,
        authority,
      );
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
      let deferredCount = 0;
      for (const job of desired.values()) {
        const current = currentJobs.get(job.id);
        if (current && !sameImmutableReminderJob(current, job)) {
          throw new Error('Stored reminder job does not match its deterministic identity.');
        }
        if (!current) {
          const state = desiredReminderStorageState(job, enqueueBoundary);
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
            deliveryAttemptId: null,
            deliveryOutcome: null,
            deliverySuppressionReason: null,
            deliveryFinalizedAt: null,
          }));
          if (state === 'client_pending') clientPendingCount += 1;
          else if (state === 'deferred_enqueue') deferredCount += 1;
          else toEnqueue.push(clone(job));
          continue;
        }
        if (current.state === 'client_pending') {
          clientPendingCount += 1;
        } else if (current.state === 'deferred_enqueue') {
          const state = desiredReminderStorageState(job, enqueueBoundary);
          if (state === 'deferred_enqueue') {
            deferredCount += 1;
          } else {
            writeJob(transaction, this.jobRef(uid, job.id), Object.freeze({
              ...current,
              state,
              updatedAt: timestamp,
              infrastructureFailure: null,
            }));
            toEnqueue.push(clone(job));
          }
        } else if (current.state === 'pending_enqueue' || current.state === 'schedule_failed') {
          toEnqueue.push(clone(job));
        } else if (current.state === 'superseded') {
          const state = desiredReminderStorageState(job, enqueueBoundary);
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
          else if (state === 'deferred_enqueue') deferredCount += 1;
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
        deferredCount,
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
    if (outcome !== 'resolved' && outcome !== 'failed') {
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

  async prepareDelivery(
    input: PrepareReminderDeliveryInput,
  ): Promise<ReminderDeliveryPreparation> {
    assertIdentity(input.uid, 'UID');
    assertHash(input.jobId, 'Reminder job ID');
    assertHash(input.taskId, 'Reminder task ID');
    const timestamp = normalizeInstant(input.now, 'Reminder delivery time');

    return this.firestore.runTransaction(async (transaction) => {
      const jobRef = this.jobRef(input.uid, input.jobId);
      const jobSnapshot = await transaction.get(jobRef);
      if (!jobSnapshot.exists) {
        return Object.freeze({ action: 'no_op', reason: 'job_missing' });
      }
      const current = decodeStoredJob(input.uid, jobSnapshot);
      if (current.taskId !== input.taskId) {
        return Object.freeze({ action: 'no_op', reason: 'task_identity_mismatch' });
      }
      if (isDeliveryFinalJobState(current.state)) {
        return Object.freeze({ action: 'no_op', reason: 'job_already_finalized' });
      }

      const attemptId = deliveryAttemptId(current);
      if (current.state === 'claimed') {
        const claimSnapshots = await transaction.getAll(
          this.deliveryAttemptRef(input.uid, attemptId),
          this.notificationIdempotencyRef(input.uid, current.idempotencyKey),
        );
        const [attemptSnapshot, idempotencySnapshot] = claimSnapshots;
        if (!attemptSnapshot || !idempotencySnapshot) {
          throw new Error('Reminder delivery claim read is incomplete.');
        }
        const attempt = decodeRequiredDeliveryAttempt(
          input.uid,
          current,
          attemptId,
          attemptSnapshot,
        );
        const idempotency = decodeRequiredNotificationIdempotency(
          input.uid,
          current,
          attemptId,
          idempotencySnapshot,
        );
        assertActiveClaimCoherence(current, attempt, idempotency);
        const recoverAt = new Date(
          Date.parse(attempt.claimedAt) + DELIVERY_CLAIM_RECOVERY_DELAY_MS,
        ).toISOString();
        if (Date.parse(timestamp) < Date.parse(recoverAt)) {
          return Object.freeze({ action: 'retry_later', notBefore: recoverAt });
        }
        return Object.freeze({
          action: 'recover_uncertain',
          uid: input.uid,
          jobId: input.jobId,
          attemptId,
        });
      }
      if (current.state !== 'scheduled') {
        return Object.freeze({ action: 'no_op', reason: 'job_not_scheduled' });
      }
      if (current.channel !== 'whatsapp') {
        throw new Error('Only WhatsApp reminder jobs can use the cloud delivery repository.');
      }

      const counterId = deliveryCounterId(current);
      const authoritySnapshots = await transaction.getAll(
        this.firestore.doc(`users/${input.uid}/timeBlocks/${current.timeBlockId}`),
        this.firestore.doc(`users/${input.uid}`),
        this.firestore.doc(`users/${input.uid}/notificationPreferences/default`),
        this.notificationIdempotencyRef(input.uid, current.idempotencyKey),
        this.deliveryAttemptRef(input.uid, attemptId),
        this.deliveryCounterRef(input.uid, counterId),
      );
      const sessionDocuments = current.kind === 'missed_start'
        ? (await transaction.get(
          this.firestore.collection(`users/${input.uid}/sessions`)
            .where('timeBlockId', '==', current.timeBlockId)
            .limit(1),
        )).docs
        : [];
      const [timeBlockSnapshot, userSnapshot, preferenceSnapshot,
        idempotencySnapshot, attemptSnapshot, counterSnapshot] = authoritySnapshots;
      if (!timeBlockSnapshot || !userSnapshot || !preferenceSnapshot
        || !idempotencySnapshot || !attemptSnapshot || !counterSnapshot) {
        throw new Error('Reminder delivery authority read is incomplete.');
      }
      if (idempotencySnapshot.exists || attemptSnapshot.exists) {
        throw new Error('Reminder delivery claim state is inconsistent.');
      }

      const rawTimeBlock = timeBlockSnapshot.exists ? timeBlockSnapshot.data() ?? {} : null;
      const timeBlock = rawTimeBlock
        ? createReminderTimeBlock(input.uid, current.timeBlockId, rawTimeBlock)
        : null;
      const persistedTimezone = persistedUserTimezone(
        input.uid,
        userSnapshot.exists ? userSnapshot.data() ?? {} : null,
      );
      const rawPreferences = preferenceSnapshot.exists
        ? preferenceSnapshot.data() ?? {}
        : {};
      if (preferenceSnapshot.exists) {
        assertScopedDocumentOwner(input.uid, rawPreferences, 'Notification preferences');
      }
      const preferences = normalizeNotificationPreferences(
        input.uid,
        rawPreferences,
        persistedTimezone,
      );
      const policy = deriveReminderPolicy(preferences);
      const counter = counterSnapshot.exists
        ? decodeDeliveryCounter(input.uid, current, counterId, counterSnapshot)
        : emptyDeliveryCounter(input.uid, current, counterId, timestamp);
      const decision = evaluateReminderDelivery({
        job: current,
        authenticatedUid: input.uid,
        timeBlock,
        policy,
        now: timestamp,
        hasStartedSession: hasStartedSession(input.uid, current.timeBlockId, sessionDocuments),
        consumedDeliverySlotsForBlockAndChannel: counter.claimedCount,
        idempotencyConsumed: false,
      });
      if (decision.action === 'suppress') {
        writeJob(transaction, jobRef, Object.freeze({
          ...current,
          state: 'suppressed',
          updatedAt: timestamp,
          deliverySuppressionReason: decision.reason,
          deliveryFinalizedAt: timestamp,
        }));
        return Object.freeze({ action: 'no_op', reason: decision.reason });
      }
      if (decision.action === 'retry_later') {
        return Object.freeze({ action: 'retry_later', notBefore: decision.notBefore });
      }
      if (!rawTimeBlock || !timeBlock) {
        throw new Error('Reminder delivery authority changed unexpectedly.');
      }

      const attempt: ReminderDeliveryAttemptRecord = Object.freeze({
        schemaVersion: DELIVERY_ATTEMPT_SCHEMA_VERSION,
        id: attemptId,
        uid: input.uid,
        jobId: current.id,
        timeBlockId: current.timeBlockId,
        channel: current.channel,
        idempotencyKey: current.idempotencyKey,
        state: 'claimed',
        claimedAt: timestamp,
        finalizedAt: null,
        outcome: null,
        providerMessageId: null,
        failureReason: null,
      });
      const idempotency: NotificationIdempotencyRecord = Object.freeze({
        schemaVersion: NOTIFICATION_IDEMPOTENCY_SCHEMA_VERSION,
        id: current.idempotencyKey,
        uid: input.uid,
        jobId: current.id,
        attemptId,
        state: 'claimed',
        claimedAt: timestamp,
        finalizedAt: null,
        outcome: null,
      });
      const nextCounter: ReminderDeliveryCounter = Object.freeze({
        ...counter,
        claimedCount: counter.claimedCount + 1,
        updatedAt: timestamp,
      });
      writeJob(transaction, jobRef, Object.freeze({
        ...current,
        state: 'claimed',
        updatedAt: timestamp,
        deliveryAttemptId: attemptId,
        deliveryOutcome: null,
        deliverySuppressionReason: null,
        deliveryFinalizedAt: null,
      }));
      transaction.set(
        this.deliveryAttemptRef(input.uid, attemptId),
        encodeDeliveryAttempt(attempt, current.scheduledFor, timestamp),
      );
      transaction.set(
        this.notificationIdempotencyRef(input.uid, current.idempotencyKey),
        encodeNotificationIdempotency(idempotency, current.scheduledFor, timestamp),
      );
      transaction.set(
        this.deliveryCounterRef(input.uid, counterId),
        encodeDeliveryCounter(nextCounter, current.scheduledFor, timestamp),
      );
      return Object.freeze({
        action: 'send',
        claim: Object.freeze({
          uid: input.uid,
          job: immutableReminderJob(current),
          attemptId,
          message: Object.freeze({
            title: reminderDisplayTitle(rawTimeBlock.title),
            startTime: timeBlock.startTime,
            plannedMinutes: plannedMinutes(timeBlock.startTime, timeBlock.endTime),
            timezone: policy.timezone,
            locale: preferences.locale,
          }),
        }),
      });
    });
  }

  async finalizeDelivery(input: FinalizeReminderDeliveryInput): Promise<void> {
    assertIdentity(input.uid, 'UID');
    assertHash(input.jobId, 'Reminder job ID');
    assertHash(input.attemptId, 'Reminder delivery attempt ID');
    const timestamp = normalizeInstant(input.now, 'Reminder finalization time');
    const result = normalizeDeliveryFinalization(input.result);

    await this.firestore.runTransaction(async (transaction) => {
      const jobRef = this.jobRef(input.uid, input.jobId);
      const jobSnapshot = await transaction.get(jobRef);
      const current = decodeRequiredStoredJob(input.uid, jobSnapshot);
      const expectedAttemptId = deliveryAttemptId(current);
      if (input.attemptId !== expectedAttemptId || current.deliveryAttemptId !== expectedAttemptId) {
        throw new Error('Reminder delivery attempt does not match the claimed job.');
      }
      const counterId = deliveryCounterId(current);
      const [attemptSnapshot, idempotencySnapshot, receiptSnapshot, counterSnapshot]
        = await transaction.getAll(
          this.deliveryAttemptRef(input.uid, input.attemptId),
          this.notificationIdempotencyRef(input.uid, current.idempotencyKey),
          this.deliveryReceiptRef(input.uid, input.attemptId),
          this.deliveryCounterRef(input.uid, counterId),
        );
      if (!attemptSnapshot || !idempotencySnapshot || !receiptSnapshot || !counterSnapshot) {
        throw new Error('Reminder delivery finalization read is incomplete.');
      }
      const attempt = decodeRequiredDeliveryAttempt(
        input.uid,
        current,
        input.attemptId,
        attemptSnapshot,
      );
      const idempotency = decodeRequiredNotificationIdempotency(
        input.uid,
        current,
        input.attemptId,
        idempotencySnapshot,
      );
      const counter = decodeRequiredDeliveryCounter(
        input.uid,
        current,
        counterId,
        counterSnapshot,
      );

      if (receiptSnapshot.exists) {
        const receipt = decodeDeliveryReceipt(
          input.uid,
          current,
          input.attemptId,
          receiptSnapshot,
        );
        assertFinalizedDeliveryCoherence(current, attempt, idempotency, receipt);
        if (receipt.outcome === 'accepted' && counter.acceptedCount < 1) {
          throw new Error('Accepted reminder delivery counter is inconsistent.');
        }
        if (!sameDeliveryResult(receipt, result)) {
          throw new Error('Reminder delivery was already finalized with a different result.');
        }
        return;
      }
      assertActiveClaimCoherence(current, attempt, idempotency);
      if (counter.claimedCount < 1 || counter.acceptedCount > counter.claimedCount) {
        throw new Error('Reminder delivery counter is inconsistent.');
      }

      const providerMessageId = result.outcome === 'accepted'
        ? result.providerMessageId
        : null;
      const failureReason = result.outcome === 'accepted' ? null : result.reason;
      const finalizedAttempt: ReminderDeliveryAttemptRecord = Object.freeze({
        ...attempt,
        state: result.outcome,
        finalizedAt: timestamp,
        outcome: result.outcome,
        providerMessageId,
        failureReason,
      });
      const finalizedIdempotency: NotificationIdempotencyRecord = Object.freeze({
        ...idempotency,
        state: 'finalized',
        finalizedAt: timestamp,
        outcome: result.outcome,
      });
      const receipt: ReminderDeliveryReceipt = Object.freeze({
        schemaVersion: DELIVERY_RECEIPT_SCHEMA_VERSION,
        id: input.attemptId,
        uid: input.uid,
        jobId: current.id,
        attemptId: input.attemptId,
        timeBlockId: current.timeBlockId,
        channel: current.channel,
        outcome: result.outcome,
        providerMessageId,
        failureReason,
        createdAt: timestamp,
      });
      writeJob(transaction, jobRef, Object.freeze({
        ...current,
        state: deliveryJobState(result),
        updatedAt: timestamp,
        deliveryOutcome: result.outcome,
        deliverySuppressionReason: null,
        deliveryFinalizedAt: timestamp,
      }));
      transaction.set(
        this.deliveryAttemptRef(input.uid, input.attemptId),
        encodeDeliveryAttempt(finalizedAttempt, current.scheduledFor, timestamp),
      );
      transaction.set(
        this.notificationIdempotencyRef(input.uid, current.idempotencyKey),
        encodeNotificationIdempotency(finalizedIdempotency, current.scheduledFor, timestamp),
      );
      transaction.set(
        this.deliveryReceiptRef(input.uid, input.attemptId),
        encodeDeliveryReceipt(receipt, current.scheduledFor),
      );
      if (result.outcome === 'accepted') {
        transaction.set(
          this.deliveryCounterRef(input.uid, counterId),
          encodeDeliveryCounter(Object.freeze({
            ...counter,
            acceptedCount: counter.acceptedCount + 1,
            updatedAt: timestamp,
          }), current.scheduledFor, timestamp),
        );
      }
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

  private deliveryAttemptRef(uid: string, attemptId: string) {
    return this.firestore.doc(`users/${uid}/deliveryAttempts/${attemptId}`);
  }

  private deliveryReceiptRef(uid: string, attemptId: string) {
    return this.firestore.doc(`users/${uid}/deliveryReceipts/${attemptId}`);
  }

  private notificationIdempotencyRef(uid: string, idempotencyKey: string) {
    return this.firestore.doc(`users/${uid}/notificationIdempotency/${idempotencyKey}`);
  }

  private deliveryCounterRef(uid: string, counterId: string) {
    return this.firestore.doc(`users/${uid}/reminderDeliveryCounters/${counterId}`);
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
    deliveryAttemptId: job.deliveryAttemptId,
    deliveryOutcome: job.deliveryOutcome,
    deliverySuppressionReason: job.deliverySuppressionReason,
    deliveryFinalizedAt: job.deliveryFinalizedAt
      ? Timestamp.fromDate(new Date(job.deliveryFinalizedAt))
      : null,
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
  const deliveryAttemptId = value.deliveryAttemptId === undefined || value.deliveryAttemptId === null
    ? null
    : hashValue(value.deliveryAttemptId, 'Stored reminder delivery attempt ID');
  const deliveryOutcome = value.deliveryOutcome === undefined || value.deliveryOutcome === null
    ? null
    : deliveryOutcomeValue(value.deliveryOutcome, 'Stored reminder delivery outcome');
  const deliverySuppressionReason = value.deliverySuppressionReason === undefined
    || value.deliverySuppressionReason === null
    ? null
    : suppressionReasonValue(value.deliverySuppressionReason);
  const deliveryFinalizedAt = value.deliveryFinalizedAt === undefined
    || value.deliveryFinalizedAt === null
    ? null
    : timestampValue(value.deliveryFinalizedAt, 'Stored reminder delivery finalization time');
  assertStoredDeliveryState(
    state,
    deliveryAttemptId,
    deliveryOutcome,
    deliverySuppressionReason,
    deliveryFinalizedAt,
  );
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
    deliveryAttemptId,
    deliveryOutcome,
    deliverySuppressionReason,
    deliveryFinalizedAt,
  });
}

function encodeDeliveryAttempt(
  attempt: ReminderDeliveryAttemptRecord,
  scheduledFor: string,
  now: string,
): DocumentData {
  return {
    schemaVersion: attempt.schemaVersion,
    id: attempt.id,
    uid: attempt.uid,
    jobId: attempt.jobId,
    timeBlockId: attempt.timeBlockId,
    channel: attempt.channel,
    idempotencyKey: attempt.idempotencyKey,
    state: attempt.state,
    claimedAt: Timestamp.fromDate(new Date(attempt.claimedAt)),
    finalizedAt: attempt.finalizedAt ? Timestamp.fromDate(new Date(attempt.finalizedAt)) : null,
    outcome: attempt.outcome,
    providerMessageId: attempt.providerMessageId,
    failureReason: attempt.failureReason,
    purgeAt: deliveryPurgeAt(scheduledFor, now),
  };
}

function encodeDeliveryReceipt(
  receipt: ReminderDeliveryReceipt,
  scheduledFor: string,
): DocumentData {
  return {
    schemaVersion: receipt.schemaVersion,
    id: receipt.id,
    uid: receipt.uid,
    jobId: receipt.jobId,
    attemptId: receipt.attemptId,
    timeBlockId: receipt.timeBlockId,
    channel: receipt.channel,
    outcome: receipt.outcome,
    providerMessageId: receipt.providerMessageId,
    failureReason: receipt.failureReason,
    createdAt: Timestamp.fromDate(new Date(receipt.createdAt)),
    purgeAt: deliveryPurgeAt(scheduledFor, receipt.createdAt),
  };
}

function encodeNotificationIdempotency(
  record: NotificationIdempotencyRecord,
  scheduledFor: string,
  now: string,
): DocumentData {
  return {
    schemaVersion: record.schemaVersion,
    id: record.id,
    uid: record.uid,
    jobId: record.jobId,
    attemptId: record.attemptId,
    state: record.state,
    claimedAt: Timestamp.fromDate(new Date(record.claimedAt)),
    finalizedAt: record.finalizedAt ? Timestamp.fromDate(new Date(record.finalizedAt)) : null,
    outcome: record.outcome,
    purgeAt: deliveryPurgeAt(scheduledFor, now),
  };
}

function encodeDeliveryCounter(
  counter: ReminderDeliveryCounter,
  scheduledFor: string,
  now: string,
): DocumentData {
  return {
    schemaVersion: counter.schemaVersion,
    id: counter.id,
    uid: counter.uid,
    timeBlockId: counter.timeBlockId,
    channel: counter.channel,
    claimedCount: counter.claimedCount,
    acceptedCount: counter.acceptedCount,
    updatedAt: Timestamp.fromDate(new Date(counter.updatedAt)),
    purgeAt: deliveryPurgeAt(scheduledFor, now),
  };
}

function decodeRequiredDeliveryAttempt(
  uid: string,
  job: StoredReminderJob,
  attemptId: string,
  snapshot: DocumentSnapshot,
): ReminderDeliveryAttemptRecord {
  if (!snapshot.exists) throw new Error('Reminder delivery attempt is missing.');
  const value = snapshot.data() ?? {};
  if (
    value.schemaVersion !== DELIVERY_ATTEMPT_SCHEMA_VERSION
    || value.id !== snapshot.id
    || snapshot.id !== attemptId
    || value.uid !== uid
    || value.jobId !== job.id
    || value.timeBlockId !== job.timeBlockId
    || value.channel !== job.channel
    || value.idempotencyKey !== job.idempotencyKey
  ) {
    throw new Error('Reminder delivery attempt identity or schema is invalid.');
  }
  const state = deliveryAttemptState(value.state);
  const claimedAt = timestampValue(value.claimedAt, 'Reminder delivery claim time');
  const finalizedAt = nullableTimestampValue(
    value.finalizedAt,
    'Reminder delivery finalization time',
  );
  const outcome = value.outcome === null
    ? null
    : deliveryOutcomeValue(value.outcome, 'Reminder delivery attempt outcome');
  const providerMessageId = value.providerMessageId === null
    ? null
    : providerMessageIdValue(value.providerMessageId);
  const failureReason = value.failureReason === null
    ? null
    : failureReasonValue(value.failureReason);
  assertAttemptOutcome(state, claimedAt, finalizedAt, outcome, providerMessageId, failureReason);
  assertPurgeAt(value.purgeAt, 'Reminder delivery attempt retention');
  return Object.freeze({
    schemaVersion: DELIVERY_ATTEMPT_SCHEMA_VERSION,
    id: attemptId,
    uid,
    jobId: job.id,
    timeBlockId: job.timeBlockId,
    channel: job.channel,
    idempotencyKey: job.idempotencyKey,
    state,
    claimedAt,
    finalizedAt,
    outcome,
    providerMessageId,
    failureReason,
  });
}

function decodeRequiredNotificationIdempotency(
  uid: string,
  job: StoredReminderJob,
  attemptId: string,
  snapshot: DocumentSnapshot,
): NotificationIdempotencyRecord {
  if (!snapshot.exists) throw new Error('Reminder delivery idempotency claim is missing.');
  const value = snapshot.data() ?? {};
  if (
    value.schemaVersion !== NOTIFICATION_IDEMPOTENCY_SCHEMA_VERSION
    || value.id !== snapshot.id
    || snapshot.id !== job.idempotencyKey
    || value.uid !== uid
    || value.jobId !== job.id
    || value.attemptId !== attemptId
  ) {
    throw new Error('Reminder delivery idempotency identity or schema is invalid.');
  }
  const state = notificationIdempotencyState(value.state);
  const claimedAt = timestampValue(value.claimedAt, 'Reminder idempotency claim time');
  const finalizedAt = nullableTimestampValue(
    value.finalizedAt,
    'Reminder idempotency finalization time',
  );
  const outcome = value.outcome === null
    ? null
    : deliveryOutcomeValue(value.outcome, 'Reminder idempotency outcome');
  if (
    (state === 'claimed' && (finalizedAt !== null || outcome !== null))
    || (state === 'finalized' && (finalizedAt === null || outcome === null))
    || (finalizedAt !== null && Date.parse(finalizedAt) < Date.parse(claimedAt))
  ) {
    throw new Error('Reminder delivery idempotency state is invalid.');
  }
  assertPurgeAt(value.purgeAt, 'Reminder idempotency retention');
  return Object.freeze({
    schemaVersion: NOTIFICATION_IDEMPOTENCY_SCHEMA_VERSION,
    id: job.idempotencyKey,
    uid,
    jobId: job.id,
    attemptId,
    state,
    claimedAt,
    finalizedAt,
    outcome,
  });
}

function decodeDeliveryReceipt(
  uid: string,
  job: StoredReminderJob,
  attemptId: string,
  snapshot: DocumentSnapshot,
): ReminderDeliveryReceipt {
  const value = snapshot.data() ?? {};
  if (
    value.schemaVersion !== DELIVERY_RECEIPT_SCHEMA_VERSION
    || value.id !== snapshot.id
    || snapshot.id !== attemptId
    || value.uid !== uid
    || value.jobId !== job.id
    || value.attemptId !== attemptId
    || value.timeBlockId !== job.timeBlockId
    || value.channel !== job.channel
  ) {
    throw new Error('Reminder delivery receipt identity or schema is invalid.');
  }
  const outcome = deliveryOutcomeValue(value.outcome, 'Reminder delivery receipt outcome');
  const providerMessageId = value.providerMessageId === null
    ? null
    : providerMessageIdValue(value.providerMessageId);
  const failureReason = value.failureReason === null
    ? null
    : failureReasonValue(value.failureReason);
  const createdAt = timestampValue(value.createdAt, 'Reminder delivery receipt time');
  assertFinalResultFields(outcome, providerMessageId, failureReason);
  assertPurgeAt(value.purgeAt, 'Reminder delivery receipt retention');
  return Object.freeze({
    schemaVersion: DELIVERY_RECEIPT_SCHEMA_VERSION,
    id: attemptId,
    uid,
    jobId: job.id,
    attemptId,
    timeBlockId: job.timeBlockId,
    channel: job.channel,
    outcome,
    providerMessageId,
    failureReason,
    createdAt,
  });
}

function decodeRequiredDeliveryCounter(
  uid: string,
  job: StoredReminderJob,
  counterId: string,
  snapshot: DocumentSnapshot,
): ReminderDeliveryCounter {
  if (!snapshot.exists) throw new Error('Reminder delivery counter is missing.');
  return decodeDeliveryCounter(uid, job, counterId, snapshot);
}

function decodeDeliveryCounter(
  uid: string,
  job: StoredReminderJob,
  counterId: string,
  snapshot: DocumentSnapshot,
): ReminderDeliveryCounter {
  const value = snapshot.data() ?? {};
  if (
    value.schemaVersion !== REMINDER_DELIVERY_COUNTER_SCHEMA_VERSION
    || value.id !== snapshot.id
    || snapshot.id !== counterId
    || value.uid !== uid
    || value.timeBlockId !== job.timeBlockId
    || value.channel !== job.channel
    || !Number.isInteger(value.claimedCount)
    || value.claimedCount < 0
    || value.claimedCount > 10_000
    || !Number.isInteger(value.acceptedCount)
    || value.acceptedCount < 0
    || value.acceptedCount > value.claimedCount
  ) {
    throw new Error('Reminder delivery counter identity or state is invalid.');
  }
  const updatedAt = timestampValue(value.updatedAt, 'Reminder delivery counter update time');
  assertPurgeAt(value.purgeAt, 'Reminder delivery counter retention');
  return Object.freeze({
    schemaVersion: REMINDER_DELIVERY_COUNTER_SCHEMA_VERSION,
    id: counterId,
    uid,
    timeBlockId: job.timeBlockId,
    channel: job.channel,
    claimedCount: value.claimedCount,
    acceptedCount: value.acceptedCount,
    updatedAt,
  });
}

function emptyDeliveryCounter(
  uid: string,
  job: StoredReminderJob,
  counterId: string,
  now: string,
): ReminderDeliveryCounter {
  return Object.freeze({
    schemaVersion: REMINDER_DELIVERY_COUNTER_SCHEMA_VERSION,
    id: counterId,
    uid,
    timeBlockId: job.timeBlockId,
    channel: job.channel,
    claimedCount: 0,
    acceptedCount: 0,
    updatedAt: now,
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
    || value === 'deferred_enqueue'
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
    || value === 'resolved'
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

function assertCurrentReconciliationAuthority(
  uid: string,
  timeBlockId: string,
  timeBlockSnapshot: DocumentSnapshot,
  userSnapshot: DocumentSnapshot,
  preferenceSnapshot: DocumentSnapshot,
  expected: ReminderAuthorityExpectation,
): void {
  const rawTimeBlock = timeBlockSnapshot.exists ? timeBlockSnapshot.data() ?? {} : null;
  const currentTimeBlockVersion = rawTimeBlock
    ? createReminderTimeBlock(uid, timeBlockId, rawTimeBlock).scheduleVersion
    : null;
  const rawPreferences = preferenceSnapshot.exists
    ? preferenceSnapshot.data() ?? {}
    : {};
  if (preferenceSnapshot.exists) {
    assertScopedDocumentOwner(uid, rawPreferences, 'Notification preferences');
  }
  const preferences = normalizeNotificationPreferences(
    uid,
    rawPreferences,
    persistedUserTimezone(uid, userSnapshot.exists ? userSnapshot.data() ?? {} : null),
  );
  const currentPolicyVersion = deriveReminderPolicy(preferences).version;
  if (
    currentTimeBlockVersion !== expected.expectedTimeBlockVersion
    || currentPolicyVersion !== expected.expectedPolicyVersion
  ) {
    throw new ReminderAuthorityChangedError();
  }
}

function assertAuthorityExpectation(authority: ReminderAuthorityExpectation): void {
  if (
    authority.expectedTimeBlockVersion !== null
    && !/^[a-f0-9]{64}$/.test(authority.expectedTimeBlockVersion)
  ) {
    throw new Error('Expected TimeBlock version is invalid.');
  }
  assertHash(authority.expectedPolicyVersion, 'Expected reminder policy version');
}

function assertBatchMaximum(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new Error('Reminder reconciliation batch limit is invalid.');
  }
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

function deliveryAttemptId(job: ReminderJob): string {
  return sha256([
    DELIVERY_ATTEMPT_SCHEMA_VERSION,
    job.uid,
    job.id,
    job.idempotencyKey,
  ].join('\u0000'));
}

function deliveryCounterId(job: ReminderJob): string {
  return sha256([
    REMINDER_DELIVERY_COUNTER_SCHEMA_VERSION,
    job.uid,
    job.timeBlockId,
    job.channel,
  ].join('\u0000'));
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function deliveryPurgeAt(scheduledFor: string, now: string): Timestamp {
  return Timestamp.fromMillis(
    Math.max(Date.parse(scheduledFor), Date.parse(now)) + REMINDER_RETENTION_MS,
  );
}

function immutableReminderJob(job: ReminderJob): ReminderJob {
  return Object.freeze({
    schemaVersion: job.schemaVersion,
    id: job.id,
    uid: job.uid,
    timeBlockId: job.timeBlockId,
    channel: job.channel,
    kind: job.kind,
    offsetMinutes: job.offsetMinutes,
    scheduledFor: job.scheduledFor,
    expectedTimeBlockVersion: job.expectedTimeBlockVersion,
    expectedPolicyVersion: job.expectedPolicyVersion,
    idempotencyKey: job.idempotencyKey,
  });
}

function assertScopedDocumentOwner(
  uid: string,
  value: unknown,
  label: string,
): void {
  const record = plainRecord(value, label);
  if (record.userId !== uid) {
    throw new Error(`${label} owner does not match the scoped path.`);
  }
  for (const field of ['uid', 'ownerId', 'ownerUid'] as const) {
    if (record[field] !== undefined && record[field] !== uid) {
      throw new Error(`${label} owner does not match the scoped path.`);
    }
  }
}

function persistedUserTimezone(uid: string, value: DocumentData | null): unknown {
  if (value === null) return undefined;
  const record = plainRecord(value, 'Persisted user profile');
  for (const field of ['userId', 'uid', 'ownerId', 'ownerUid'] as const) {
    if (record[field] !== undefined && record[field] !== uid) {
      throw new Error('Persisted user profile owner does not match the scoped path.');
    }
  }
  const preferences = record.preferences === undefined
    ? null
    : plainRecord(record.preferences, 'Persisted user preferences');
  return preferences?.timezone ?? record.timezone;
}

function hasStartedSession(
  uid: string,
  timeBlockId: string,
  snapshots: readonly DocumentSnapshot[],
): boolean {
  for (const snapshot of snapshots) {
    const value = snapshot.data() ?? {};
    if (value.userId !== uid || value.timeBlockId !== timeBlockId) {
      throw new Error('Persisted Session owner or TimeBlock link is invalid.');
    }
  }
  return snapshots.length > 0;
}

function reminderDisplayTitle(value: unknown): string {
  if (typeof value !== 'string') return 'Scheduled time block';
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) return 'Scheduled time block';
  return [...normalized].slice(0, 160).join('');
}

function plannedMinutes(startTime: string, endTime: string): number {
  return Math.max(1, Math.ceil((Date.parse(endTime) - Date.parse(startTime)) / 60_000));
}

function normalizeDeliveryFinalization(
  input: ReminderDeliveryFinalization,
): ReminderDeliveryFinalization {
  const value = plainRecord(input, 'Reminder delivery finalization');
  if (value.outcome === 'accepted') {
    return Object.freeze({
      outcome: 'accepted',
      providerMessageId: providerMessageIdValue(value.providerMessageId),
    });
  }
  if (value.outcome === 'rejected') {
    return Object.freeze({
      outcome: 'rejected',
      reason: rejectionReasonValue(value.reason),
    });
  }
  if (value.outcome === 'uncertain') {
    return Object.freeze({
      outcome: 'uncertain',
      reason: uncertaintyReasonValue(value.reason),
    });
  }
  throw new Error('Reminder delivery finalization outcome is invalid.');
}

function deliveryJobState(
  result: ReminderDeliveryFinalization,
): Extract<StoredReminderJobState, 'accepted' | 'failed' | 'uncertain'> {
  if (result.outcome === 'accepted') return 'accepted';
  return result.outcome === 'rejected' ? 'failed' : 'uncertain';
}

function isDeliveryFinalJobState(state: StoredReminderJobState): boolean {
  return state === 'accepted'
    || state === 'delivered'
    || state === 'failed'
    || state === 'uncertain'
    || state === 'suppressed';
}

function assertActiveClaimCoherence(
  job: StoredReminderJob,
  attempt: ReminderDeliveryAttemptRecord,
  idempotency: NotificationIdempotencyRecord,
): void {
  if (
    job.state !== 'claimed'
    || job.deliveryAttemptId !== attempt.id
    || job.deliveryOutcome !== null
    || job.deliverySuppressionReason !== null
    || job.deliveryFinalizedAt !== null
    || attempt.state !== 'claimed'
    || idempotency.state !== 'claimed'
    || attempt.claimedAt !== idempotency.claimedAt
  ) {
    throw new Error('Reminder delivery claim records are inconsistent.');
  }
}

function assertFinalizedDeliveryCoherence(
  job: StoredReminderJob,
  attempt: ReminderDeliveryAttemptRecord,
  idempotency: NotificationIdempotencyRecord,
  receipt: ReminderDeliveryReceipt,
): void {
  if (
    attempt.state !== receipt.outcome
    || attempt.outcome !== receipt.outcome
    || attempt.providerMessageId !== receipt.providerMessageId
    || attempt.failureReason !== receipt.failureReason
    || attempt.finalizedAt !== receipt.createdAt
    || idempotency.state !== 'finalized'
    || idempotency.outcome !== receipt.outcome
    || idempotency.finalizedAt !== receipt.createdAt
    || job.deliveryOutcome !== receipt.outcome
    || job.deliveryFinalizedAt !== receipt.createdAt
    || job.state !== deliveryJobStateFromOutcome(receipt.outcome)
  ) {
    throw new Error('Finalized reminder delivery records are inconsistent.');
  }
}

function deliveryJobStateFromOutcome(
  outcome: ReminderDeliveryOutcome,
): Extract<StoredReminderJobState, 'accepted' | 'failed' | 'uncertain'> {
  if (outcome === 'accepted') return 'accepted';
  return outcome === 'rejected' ? 'failed' : 'uncertain';
}

function sameDeliveryResult(
  receipt: ReminderDeliveryReceipt,
  result: ReminderDeliveryFinalization,
): boolean {
  if (receipt.outcome !== result.outcome) return false;
  if (result.outcome === 'accepted') {
    return receipt.providerMessageId === result.providerMessageId
      && receipt.failureReason === null;
  }
  return receipt.providerMessageId === null && receipt.failureReason === result.reason;
}

function deliveryAttemptState(value: unknown): ReminderDeliveryAttemptRecord['state'] {
  if (value === 'claimed' || value === 'accepted' || value === 'rejected' || value === 'uncertain') {
    return value;
  }
  throw new Error('Reminder delivery attempt state is invalid.');
}

function notificationIdempotencyState(
  value: unknown,
): NotificationIdempotencyRecord['state'] {
  if (value === 'claimed' || value === 'finalized') return value;
  throw new Error('Reminder delivery idempotency state is invalid.');
}

function deliveryOutcomeValue(value: unknown, label: string): ReminderDeliveryOutcome {
  if (value === 'accepted' || value === 'rejected' || value === 'uncertain') return value;
  throw new Error(`${label} is invalid.`);
}

function rejectionReasonValue(value: unknown): MessagingRejectionReason {
  if (
    value === 'invalid_recipient'
    || value === 'provider_rejected'
    || value === 'template_unavailable'
    || value === 'provider_unavailable'
  ) {
    return value;
  }
  throw new Error('Reminder delivery rejection reason is invalid.');
}

function uncertaintyReasonValue(value: unknown): MessagingUncertaintyReason {
  if (
    value === 'provider_timeout'
    || value === 'transport_unknown'
    || value === 'worker_recovered_claim'
  ) {
    return value;
  }
  throw new Error('Reminder delivery uncertainty reason is invalid.');
}

function failureReasonValue(
  value: unknown,
): MessagingRejectionReason | MessagingUncertaintyReason {
  try {
    return rejectionReasonValue(value);
  } catch {
    return uncertaintyReasonValue(value);
  }
}

function providerMessageIdValue(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 256
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error('Provider message identity is invalid.');
  }
  return value;
}

function assertAttemptOutcome(
  state: ReminderDeliveryAttemptRecord['state'],
  claimedAt: string,
  finalizedAt: string | null,
  outcome: ReminderDeliveryOutcome | null,
  providerMessageId: string | null,
  failureReason: MessagingRejectionReason | MessagingUncertaintyReason | null,
): void {
  if (state === 'claimed') {
    if (
      finalizedAt !== null
      || outcome !== null
      || providerMessageId !== null
      || failureReason !== null
    ) {
      throw new Error('Claimed reminder delivery attempt contains a final result.');
    }
    return;
  }
  if (
    finalizedAt === null
    || outcome !== state
    || Date.parse(finalizedAt) < Date.parse(claimedAt)
  ) {
    throw new Error('Finalized reminder delivery attempt state is invalid.');
  }
  assertFinalResultFields(state, providerMessageId, failureReason);
}

function assertFinalResultFields(
  outcome: ReminderDeliveryOutcome,
  providerMessageId: string | null,
  failureReason: MessagingRejectionReason | MessagingUncertaintyReason | null,
): void {
  if (outcome === 'accepted') {
    if (providerMessageId === null || failureReason !== null) {
      throw new Error('Accepted reminder delivery result is invalid.');
    }
    return;
  }
  if (providerMessageId !== null || failureReason === null) {
    throw new Error('Failed reminder delivery result is invalid.');
  }
  if (outcome === 'rejected') rejectionReasonValue(failureReason);
  else uncertaintyReasonValue(failureReason);
}

function assertStoredDeliveryState(
  state: StoredReminderJobState,
  attemptId: string | null,
  outcome: ReminderDeliveryOutcome | null,
  suppressionReason: ReminderSuppressionReason | null,
  finalizedAt: string | null,
): void {
  if (state === 'claimed') {
    if (!attemptId || outcome !== null || suppressionReason !== null || finalizedAt !== null) {
      throw new Error('Stored claimed reminder delivery state is invalid.');
    }
    return;
  }
  if (state === 'accepted' || state === 'delivered' || state === 'failed' || state === 'uncertain') {
    const expected = state === 'accepted' || state === 'delivered'
      ? 'accepted'
      : state === 'failed' ? 'rejected' : 'uncertain';
    if (!attemptId || outcome !== expected || suppressionReason !== null || !finalizedAt) {
      throw new Error('Stored finalized reminder delivery state is invalid.');
    }
    return;
  }
  if (state === 'suppressed') {
    if (attemptId !== null || outcome !== null || suppressionReason === null || !finalizedAt) {
      throw new Error('Stored suppressed reminder delivery state is invalid.');
    }
    return;
  }
  if (attemptId !== null || outcome !== null || suppressionReason !== null || finalizedAt !== null) {
    throw new Error('Stored pending reminder delivery state is invalid.');
  }
}

function suppressionReasonValue(value: unknown): ReminderSuppressionReason {
  if (
    value === 'job_owner_mismatch'
    || value === 'time_block_missing'
    || value === 'time_block_owner_mismatch'
    || value === 'time_block_deleted'
    || value === 'reminder_disabled'
    || value === 'time_block_cancelled'
    || value === 'time_block_completed'
    || value === 'time_block_ended'
    || value === 'time_block_changed'
    || value === 'policy_changed'
    || value === 'channel_disabled'
    || value === 'quiet_hours'
    || value === 'already_started'
    || value === 'delivery_limit_reached'
    || value === 'idempotency_consumed'
  ) {
    return value;
  }
  throw new Error('Stored reminder suppression reason is invalid.');
}

function nullableTimestampValue(value: unknown, label: string): string | null {
  return value === null ? null : timestampValue(value, label);
}

function hashValue(value: unknown, label: string): string {
  assertHash(value, label);
  return value;
}

function assertPurgeAt(value: unknown, label: string): void {
  if (!(value instanceof Timestamp)) throw new Error(`${label} is invalid.`);
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
