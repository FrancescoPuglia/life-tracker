import { createHash } from 'node:crypto';
import {
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';
import { DomainError } from '../domain/errors';
import {
  REPORT_DELIVERY_STATE_SCHEMA_VERSION,
  type StoredReportDeliveryState,
  type StoredScientificReportArchive,
} from './archive';
import {
  REPORT_EMAIL_CLAIM_LEASE_MS,
  REPORT_EMAIL_DELIVERY_ATTEMPT_SCHEMA_VERSION,
  REPORT_EMAIL_DELIVERY_CONTROL_SCHEMA_VERSION,
  REPORT_EMAIL_MAX_PROVIDER_ATTEMPTS,
  REPORT_EMAIL_RETRY_WINDOW_MS,
  type FinalizeReportEmailDeliveryInput,
  type FinalizeReportEmailDeliveryResult,
  type PrepareReportEmailDeliveryInput,
  type PrepareReportEmailDeliveryResult,
  type ReportEmailDeliveryFinalization,
  type ScientificReportEmailDeliveryRepository,
  type StoredReportEmailDeliveryAttempt,
  type StoredReportEmailDeliveryControl,
} from './email-delivery';
import {
  FirestoreScientificReportArchiveRepository,
  decodeStoredScientificReportArchiveSnapshot,
  encodeStoredReportDeliveryState,
} from './firestore-archive-repository';

const UID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const REPORT_ID_PATTERN = /^report_[0-9a-f]{56}$/;
const ATTEMPT_ID_PATTERN = /^email_attempt_[0-9a-f]{48}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const PROVIDER_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const FAILURE_CODE_PATTERN = /^[a-z0-9_:-]{1,80}$/;
const CONTROL_STATES = new Set(['claimed', 'retryable', 'sent', 'failed', 'uncertain']);
const ATTEMPT_STATES = new Set(['claimed', 'accepted', 'rejected', 'retryable', 'uncertain']);
const REJECTION_REASONS = new Set([
  'invalid_message',
  'invalid_recipient',
  'provider_configuration',
  'provider_quota_exhausted',
  'provider_security_rejection',
  'idempotency_conflict',
  'provider_rejected',
]);
const RETRY_REASONS = new Set(['rate_limited', 'idempotency_in_progress']);
const UNCERTAIN_REASONS = new Set(['transport_unknown', 'worker_recovered_claim']);

/** Server-only Firestore transactions for claim-before-send report email delivery. */
export class FirestoreScientificReportEmailDeliveryRepository
implements ScientificReportEmailDeliveryRepository {
  private readonly archives: FirestoreScientificReportArchiveRepository;

  constructor(private readonly firestore: Firestore) {
    this.archives = new FirestoreScientificReportArchiveRepository(firestore);
  }

  getArchive(uid: string, reportId: string): Promise<StoredScientificReportArchive | null> {
    return this.archives.getArchive(uid, reportId);
  }

  async prepareEmailDelivery(
    input: PrepareReportEmailDeliveryInput,
  ): Promise<PrepareReportEmailDeliveryResult> {
    const now = validatePreparationInput(input);
    const archiveRef = this.firestore.doc(`users/${input.uid}/reportArchives/${input.reportId}`);
    const controlRef = this.firestore.doc(
      `users/${input.uid}/reportEmailDelivery/${input.reportId}`,
    );

    return this.firestore.runTransaction(async (transaction) => {
      const [archiveSnapshot, controlSnapshot] = await transaction.getAll(archiveRef, controlRef);
      if (!archiveSnapshot?.exists) {
        throw new DomainError('NOT_FOUND', 'Scientific report archive was not found.');
      }
      if (!controlSnapshot) {
        throw new DomainError('INTERNAL', 'Report email delivery authority read is incomplete.');
      }
      const archive = decodeStoredScientificReportArchiveSnapshot(input.uid, archiveSnapshot);
      assertArchiveMatchesPreparation(archive, input);

      if (!controlSnapshot.exists) {
        if (archive.delivery.state !== 'not_attempted') {
          throw new DomainError('INTERNAL', 'Report email delivery state is orphaned.');
        }
        const attempt = createClaimedAttempt(input, 1, now);
        const control = createInitialControl(input, attempt, now);
        transaction.create(controlRef, encodeControl(control));
        transaction.create(
          this.attemptRef(input.uid, attempt.id),
          encodeAttempt(attempt),
        );
        updateArchiveDelivery(transaction, archiveRef, pendingDelivery(now), now);
        return Object.freeze({
          action: 'send',
          attemptId: attempt.id,
          attemptNumber: 1,
        });
      }

      const control = decodeControl(input.uid, controlSnapshot);
      assertControlMatchesPreparation(control, input);
      assertArchiveControlCoherence(archive, control);
      if (control.state === 'sent') {
        return Object.freeze({ action: 'no_op', reason: 'already_sent' });
      }
      if (control.state === 'failed') {
        return Object.freeze({ action: 'no_op', reason: 'terminal_failure' });
      }
      if (control.state === 'uncertain') {
        return Object.freeze({ action: 'no_op', reason: 'delivery_uncertain' });
      }
      if (control.state === 'claimed') {
        const leaseEnd = Date.parse(control.lastAttemptAt) + REPORT_EMAIL_CLAIM_LEASE_MS;
        if (Date.parse(now) < leaseEnd) {
          return Object.freeze({
            action: 'retry_later',
            notBefore: new Date(leaseEnd).toISOString(),
          });
        }
        const attemptRef = this.attemptRef(input.uid, control.currentAttemptId);
        const attemptSnapshot = await transaction.get(attemptRef);
        const attempt = decodeAttempt(input.uid, attemptSnapshot);
        assertAttemptMatchesControl(attempt, control);
        const failureCode = 'uncertain_worker_recovered_claim';
        const recoveredControl: StoredReportEmailDeliveryControl = Object.freeze({
          ...control,
          state: 'uncertain',
          nextAttemptAt: null,
          providerMessageId: null,
          failureCode,
          updatedAt: now,
        });
        const recoveredAttempt: StoredReportEmailDeliveryAttempt = Object.freeze({
          ...attempt,
          state: 'uncertain',
          finalizedAt: now,
          nextAttemptAt: null,
          providerMessageId: null,
          reason: 'worker_recovered_claim',
        });
        transaction.update(controlRef, encodeControl(recoveredControl));
        transaction.update(attemptRef, encodeAttempt(recoveredAttempt));
        updateArchiveDelivery(
          transaction,
          archiveRef,
          failedDelivery(control.lastAttemptAt, failureCode),
          now,
        );
        return Object.freeze({ action: 'no_op', reason: 'delivery_uncertain' });
      }

      if (!control.nextAttemptAt) {
        throw new DomainError('INTERNAL', 'Retryable report email has no retry time.');
      }
      if (Date.parse(now) < Date.parse(control.nextAttemptAt)) {
        return Object.freeze({ action: 'retry_later', notBefore: control.nextAttemptAt });
      }
      if (
        control.attemptCount >= REPORT_EMAIL_MAX_PROVIDER_ATTEMPTS
        || Date.parse(now) > Date.parse(control.retryDeadline)
      ) {
        const exhausted = terminalizeRetry(control, now);
        transaction.update(controlRef, encodeControl(exhausted));
        updateArchiveDelivery(
          transaction,
          archiveRef,
          failedDelivery(control.lastAttemptAt, 'retry_attempts_exhausted'),
          now,
        );
        return Object.freeze({ action: 'no_op', reason: 'attempts_exhausted' });
      }

      const attemptNumber = control.attemptCount + 1;
      const attempt = createClaimedAttempt(input, attemptNumber, now);
      const claimed: StoredReportEmailDeliveryControl = Object.freeze({
        ...control,
        state: 'claimed',
        attemptCount: attemptNumber,
        currentAttemptId: attempt.id,
        lastAttemptAt: now,
        nextAttemptAt: null,
        providerMessageId: null,
        failureCode: null,
        updatedAt: now,
      });
      transaction.create(this.attemptRef(input.uid, attempt.id), encodeAttempt(attempt));
      transaction.update(controlRef, encodeControl(claimed));
      updateArchiveDelivery(transaction, archiveRef, pendingDelivery(now), now);
      return Object.freeze({ action: 'send', attemptId: attempt.id, attemptNumber });
    });
  }

  async finalizeEmailDelivery(
    input: FinalizeReportEmailDeliveryInput,
  ): Promise<FinalizeReportEmailDeliveryResult> {
    const now = validateFinalizationInput(input);
    const archiveRef = this.firestore.doc(`users/${input.uid}/reportArchives/${input.reportId}`);
    const controlRef = this.firestore.doc(
      `users/${input.uid}/reportEmailDelivery/${input.reportId}`,
    );
    const attemptRef = this.attemptRef(input.uid, input.attemptId);

    return this.firestore.runTransaction(async (transaction) => {
      const [archiveSnapshot, controlSnapshot, attemptSnapshot] = await transaction.getAll(
        archiveRef,
        controlRef,
        attemptRef,
      );
      if (!archiveSnapshot?.exists || !controlSnapshot?.exists || !attemptSnapshot?.exists) {
        throw new DomainError('INTERNAL', 'Report email finalization state is incomplete.');
      }
      const archive = decodeStoredScientificReportArchiveSnapshot(input.uid, archiveSnapshot);
      const control = decodeControl(input.uid, controlSnapshot);
      const attempt = decodeAttempt(input.uid, attemptSnapshot);
      if (
        control.reportId !== input.reportId
        || control.currentAttemptId !== input.attemptId
        || control.sendAuthorityHash !== input.sendAuthorityHash
      ) {
        throw new DomainError('CONFLICT', 'Report email claim authority changed.');
      }
      assertArchiveControlCoherence(archive, control);
      assertAttemptMatchesControl(attempt, control);
      if (Date.parse(now) < Date.parse(attempt.claimedAt)) {
        throw new DomainError('INVALID_ARGUMENT', 'Report email finalization time is invalid.');
      }
      if (attempt.state !== 'claimed') {
        if (!finalizationMatchesAttempt(input.result, attempt)) {
          throw new DomainError('CONFLICT', 'Report email attempt was finalized differently.');
        }
        return resultForControl(control);
      }
      if (control.state !== 'claimed') {
        throw new DomainError('CONFLICT', 'Report email delivery is no longer claimed.');
      }

      const transition = finalizeTransition(control, attempt, input.result, now);
      transaction.update(controlRef, encodeControl(transition.control));
      transaction.update(attemptRef, encodeAttempt(transition.attempt));
      updateArchiveDelivery(transaction, archiveRef, transition.delivery, now);
      return transition.result;
    });
  }

  private attemptRef(uid: string, attemptId: string) {
    return this.firestore.doc(`users/${uid}/reportDeliveryAttempts/${attemptId}`);
  }
}

function validatePreparationInput(input: PrepareReportEmailDeliveryInput): string {
  assertUid(input.uid);
  assertReportId(input.reportId);
  assertHash(input.reportArtifactHash);
  assertHash(input.metricHash);
  assertHash(input.emailContentHash);
  assertHash(input.sendAuthorityHash);
  if (
    input.provider !== 'resend'
    || !/^life-tracker-report-v3\/[0-9a-f]{64}$/u.test(input.idempotencyKey)
  ) {
    throw new DomainError('INVALID_ARGUMENT', 'Report email delivery authority is invalid.');
  }
  return normalizedInstant(input.now, 'Report email claim time');
}

function validateFinalizationInput(input: FinalizeReportEmailDeliveryInput): string {
  assertUid(input.uid);
  assertReportId(input.reportId);
  if (!ATTEMPT_ID_PATTERN.test(input.attemptId)) {
    throw new DomainError('INVALID_ARGUMENT', 'Report email attempt identifier is invalid.');
  }
  assertHash(input.sendAuthorityHash);
  validateFinalization(input.result);
  return normalizedInstant(input.now, 'Report email finalization time');
}

function validateFinalization(result: ReportEmailDeliveryFinalization): void {
  if (!result || typeof result !== 'object') {
    throw new DomainError('INVALID_ARGUMENT', 'Report email result is invalid.');
  }
  if (result.outcome === 'accepted') {
    if (!PROVIDER_MESSAGE_ID_PATTERN.test(result.providerMessageId)) {
      throw new DomainError('INVALID_ARGUMENT', 'Provider message identity is invalid.');
    }
    return;
  }
  if (result.outcome === 'rejected' && REJECTION_REASONS.has(result.reason)) return;
  if (result.outcome === 'retryable' && RETRY_REASONS.has(result.reason)) return;
  if (result.outcome === 'uncertain' && UNCERTAIN_REASONS.has(result.reason)) return;
  throw new DomainError('INVALID_ARGUMENT', 'Report email result is invalid.');
}

function assertArchiveMatchesPreparation(
  archive: StoredScientificReportArchive,
  input: PrepareReportEmailDeliveryInput,
): void {
  if (
    archive.id !== input.reportId
    || archive.userId !== input.uid
    || archive.artifactHash !== input.reportArtifactHash
    || archive.metricHash !== input.metricHash
  ) {
    throw new DomainError('CONFLICT', 'Report archive changed before email delivery.');
  }
}

function assertControlMatchesPreparation(
  control: StoredReportEmailDeliveryControl,
  input: PrepareReportEmailDeliveryInput,
): void {
  if (
    control.reportId !== input.reportId
    || control.userId !== input.uid
    || control.reportArtifactHash !== input.reportArtifactHash
    || control.metricHash !== input.metricHash
    || control.emailContentHash !== input.emailContentHash
    || control.sendAuthorityHash !== input.sendAuthorityHash
    || control.idempotencyKey !== input.idempotencyKey
    || control.provider !== input.provider
  ) {
    throw new DomainError('CONFLICT', 'Report email delivery content changed after its first claim.');
  }
}

function createInitialControl(
  input: PrepareReportEmailDeliveryInput,
  attempt: StoredReportEmailDeliveryAttempt,
  now: string,
): StoredReportEmailDeliveryControl {
  return Object.freeze({
    schemaVersion: REPORT_EMAIL_DELIVERY_CONTROL_SCHEMA_VERSION,
    id: input.reportId,
    userId: input.uid,
    reportId: input.reportId,
    reportArtifactHash: input.reportArtifactHash,
    metricHash: input.metricHash,
    emailContentHash: input.emailContentHash,
    sendAuthorityHash: input.sendAuthorityHash,
    idempotencyKey: input.idempotencyKey,
    provider: 'resend',
    state: 'claimed',
    attemptCount: 1,
    currentAttemptId: attempt.id,
    firstAttemptAt: now,
    lastAttemptAt: now,
    retryDeadline: new Date(Date.parse(now) + REPORT_EMAIL_RETRY_WINDOW_MS).toISOString(),
    nextAttemptAt: null,
    providerMessageId: null,
    failureCode: null,
    updatedAt: now,
  });
}

function createClaimedAttempt(
  input: PrepareReportEmailDeliveryInput,
  attemptNumber: number,
  now: string,
): StoredReportEmailDeliveryAttempt {
  return Object.freeze({
    schemaVersion: REPORT_EMAIL_DELIVERY_ATTEMPT_SCHEMA_VERSION,
    id: attemptId(input.reportId, attemptNumber, input.sendAuthorityHash),
    userId: input.uid,
    reportId: input.reportId,
    attemptNumber,
    provider: 'resend',
    emailContentHash: input.emailContentHash,
    sendAuthorityHash: input.sendAuthorityHash,
    idempotencyKey: input.idempotencyKey,
    state: 'claimed',
    claimedAt: now,
    finalizedAt: null,
    nextAttemptAt: null,
    providerMessageId: null,
    reason: null,
  });
}

function terminalizeRetry(
  control: StoredReportEmailDeliveryControl,
  now: string,
): StoredReportEmailDeliveryControl {
  return Object.freeze({
    ...control,
    state: 'failed',
    nextAttemptAt: null,
    providerMessageId: null,
    failureCode: 'retry_attempts_exhausted',
    updatedAt: now,
  });
}

function finalizeTransition(
  control: StoredReportEmailDeliveryControl,
  attempt: StoredReportEmailDeliveryAttempt,
  finalization: ReportEmailDeliveryFinalization,
  now: string,
): Readonly<{
  control: StoredReportEmailDeliveryControl;
  attempt: StoredReportEmailDeliveryAttempt;
  delivery: StoredReportDeliveryState;
  result: FinalizeReportEmailDeliveryResult;
}> {
  if (finalization.outcome === 'accepted') {
    return Object.freeze({
      control: Object.freeze({
        ...control,
        state: 'sent',
        nextAttemptAt: null,
        providerMessageId: finalization.providerMessageId,
        failureCode: null,
        updatedAt: now,
      }),
      attempt: Object.freeze({
        ...attempt,
        state: 'accepted',
        finalizedAt: now,
        providerMessageId: finalization.providerMessageId,
      }),
      delivery: sentDelivery(attempt.claimedAt, finalization.providerMessageId, now),
      result: Object.freeze({ state: 'sent' }),
    });
  }
  if (finalization.outcome === 'rejected') {
    const failureCode = `provider_${finalization.reason}`;
    return Object.freeze({
      control: Object.freeze({
        ...control,
        state: 'failed',
        nextAttemptAt: null,
        providerMessageId: null,
        failureCode,
        updatedAt: now,
      }),
      attempt: Object.freeze({
        ...attempt,
        state: 'rejected',
        finalizedAt: now,
        reason: finalization.reason,
      }),
      delivery: failedDelivery(attempt.claimedAt, failureCode),
      result: Object.freeze({ state: 'failed' }),
    });
  }
  if (finalization.outcome === 'uncertain') {
    const failureCode = `uncertain_${finalization.reason}`;
    return Object.freeze({
      control: Object.freeze({
        ...control,
        state: 'uncertain',
        nextAttemptAt: null,
        providerMessageId: null,
        failureCode,
        updatedAt: now,
      }),
      attempt: Object.freeze({
        ...attempt,
        state: 'uncertain',
        finalizedAt: now,
        reason: finalization.reason,
      }),
      delivery: failedDelivery(attempt.claimedAt, failureCode),
      result: Object.freeze({ state: 'uncertain' }),
    });
  }

  const nextAttemptAt = new Date(
    Date.parse(now) + retryDelayMs(attempt.attemptNumber),
  ).toISOString();
  if (
    attempt.attemptNumber >= REPORT_EMAIL_MAX_PROVIDER_ATTEMPTS
    || Date.parse(nextAttemptAt) > Date.parse(control.retryDeadline)
  ) {
    const failureCode = 'retry_attempts_exhausted';
    return Object.freeze({
      control: terminalizeRetry(control, now),
      attempt: Object.freeze({
        ...attempt,
        state: 'retryable',
        finalizedAt: now,
        nextAttemptAt: null,
        reason: finalization.reason,
      }),
      delivery: failedDelivery(attempt.claimedAt, failureCode),
      result: Object.freeze({ state: 'attempts_exhausted' }),
    });
  }
  const failureCode = `retryable_${finalization.reason}`;
  return Object.freeze({
    control: Object.freeze({
      ...control,
      state: 'retryable',
      nextAttemptAt,
      providerMessageId: null,
      failureCode,
      updatedAt: now,
    }),
    attempt: Object.freeze({
      ...attempt,
      state: 'retryable',
      finalizedAt: now,
      nextAttemptAt,
      reason: finalization.reason,
    }),
    delivery: failedDelivery(attempt.claimedAt, failureCode),
    result: Object.freeze({ state: 'retryable', notBefore: nextAttemptAt }),
  });
}

function pendingDelivery(now: string): StoredReportDeliveryState {
  return Object.freeze({
    schemaVersion: REPORT_DELIVERY_STATE_SCHEMA_VERSION,
    channel: 'email',
    state: 'pending',
    provider: 'resend',
    providerMessageId: null,
    lastAttemptAt: now,
    sentAt: null,
    failureCode: null,
  });
}

function sentDelivery(
  attemptedAt: string,
  providerMessageId: string,
  sentAt: string,
): StoredReportDeliveryState {
  return Object.freeze({
    schemaVersion: REPORT_DELIVERY_STATE_SCHEMA_VERSION,
    channel: 'email',
    state: 'sent',
    provider: 'resend',
    providerMessageId,
    lastAttemptAt: attemptedAt,
    sentAt,
    failureCode: null,
  });
}

function failedDelivery(attemptedAt: string, failureCode: string): StoredReportDeliveryState {
  if (!FAILURE_CODE_PATTERN.test(failureCode)) {
    throw new DomainError('INTERNAL', 'Report email failure code is invalid.');
  }
  return Object.freeze({
    schemaVersion: REPORT_DELIVERY_STATE_SCHEMA_VERSION,
    channel: 'email',
    state: 'failed',
    provider: 'resend',
    providerMessageId: null,
    lastAttemptAt: attemptedAt,
    sentAt: null,
    failureCode,
  });
}

function updateArchiveDelivery(
  transaction: FirebaseFirestore.Transaction,
  archiveRef: FirebaseFirestore.DocumentReference,
  delivery: StoredReportDeliveryState,
  now: string,
): void {
  transaction.update(archiveRef, {
    delivery: encodeStoredReportDeliveryState(delivery),
    updatedAt: Timestamp.fromDate(new Date(now)),
  });
}

function encodeControl(control: StoredReportEmailDeliveryControl): DocumentData {
  return {
    ...control,
    firstAttemptAt: Timestamp.fromDate(new Date(control.firstAttemptAt)),
    lastAttemptAt: Timestamp.fromDate(new Date(control.lastAttemptAt)),
    retryDeadline: Timestamp.fromDate(new Date(control.retryDeadline)),
    nextAttemptAt: control.nextAttemptAt
      ? Timestamp.fromDate(new Date(control.nextAttemptAt))
      : null,
    updatedAt: Timestamp.fromDate(new Date(control.updatedAt)),
  };
}

function encodeAttempt(attempt: StoredReportEmailDeliveryAttempt): DocumentData {
  return {
    ...attempt,
    claimedAt: Timestamp.fromDate(new Date(attempt.claimedAt)),
    finalizedAt: attempt.finalizedAt
      ? Timestamp.fromDate(new Date(attempt.finalizedAt))
      : null,
    nextAttemptAt: attempt.nextAttemptAt
      ? Timestamp.fromDate(new Date(attempt.nextAttemptAt))
      : null,
  };
}

function decodeControl(
  uid: string,
  snapshot: DocumentSnapshot,
): StoredReportEmailDeliveryControl {
  const value = snapshot.data() ?? {};
  if (
    value.schemaVersion !== REPORT_EMAIL_DELIVERY_CONTROL_SCHEMA_VERSION
    || value.id !== snapshot.id
    || value.reportId !== snapshot.id
    || value.userId !== uid
    || !REPORT_ID_PATTERN.test(snapshot.id)
    || value.provider !== 'resend'
    || !CONTROL_STATES.has(String(value.state))
    || !Number.isInteger(value.attemptCount)
    || value.attemptCount < 1
    || value.attemptCount > REPORT_EMAIL_MAX_PROVIDER_ATTEMPTS
    || typeof value.currentAttemptId !== 'string'
    || !ATTEMPT_ID_PATTERN.test(value.currentAttemptId)
  ) {
    throw new DomainError('INTERNAL', 'Stored report email control is invalid.');
  }
  const reportArtifactHash = storedHash(value.reportArtifactHash);
  const metricHash = storedHash(value.metricHash);
  const emailContentHash = storedHash(value.emailContentHash);
  const sendAuthorityHash = storedHash(value.sendAuthorityHash);
  const idempotencyKey = storedIdempotencyKey(value.idempotencyKey, snapshot.id);
  const firstAttemptAt = storedTimestamp(value.firstAttemptAt);
  const lastAttemptAt = storedTimestamp(value.lastAttemptAt);
  const retryDeadline = storedTimestamp(value.retryDeadline);
  const nextAttemptAt = nullableStoredTimestamp(value.nextAttemptAt);
  const updatedAt = storedTimestamp(value.updatedAt);
  const providerMessageId = nullableProviderMessageId(value.providerMessageId);
  const failureCode = nullableFailureCode(value.failureCode);
  const state = value.state as StoredReportEmailDeliveryControl['state'];
  const expectedAttemptId = attemptId(snapshot.id, value.attemptCount, sendAuthorityHash);
  if (
    value.currentAttemptId !== expectedAttemptId
    || Date.parse(firstAttemptAt) > Date.parse(lastAttemptAt)
    || Date.parse(lastAttemptAt) > Date.parse(updatedAt)
    || Date.parse(retryDeadline) <= Date.parse(firstAttemptAt)
    || !controlStateCoherent(state, nextAttemptAt, providerMessageId, failureCode)
  ) {
    throw new DomainError('INTERNAL', 'Stored report email control is inconsistent.');
  }
  return Object.freeze({
    schemaVersion: REPORT_EMAIL_DELIVERY_CONTROL_SCHEMA_VERSION,
    id: snapshot.id,
    userId: uid,
    reportId: snapshot.id,
    reportArtifactHash,
    metricHash,
    emailContentHash,
    sendAuthorityHash,
    idempotencyKey,
    provider: 'resend',
    state,
    attemptCount: value.attemptCount,
    currentAttemptId: value.currentAttemptId,
    firstAttemptAt,
    lastAttemptAt,
    retryDeadline,
    nextAttemptAt,
    providerMessageId,
    failureCode,
    updatedAt,
  });
}

function controlStateCoherent(
  state: StoredReportEmailDeliveryControl['state'],
  nextAttemptAt: string | null,
  providerMessageId: string | null,
  failureCode: string | null,
): boolean {
  if (state === 'claimed') {
    return nextAttemptAt === null && providerMessageId === null && failureCode === null;
  }
  if (state === 'retryable') {
    return nextAttemptAt !== null && providerMessageId === null && failureCode?.startsWith('retryable_') === true;
  }
  if (state === 'sent') {
    return nextAttemptAt === null && providerMessageId !== null && failureCode === null;
  }
  if (state === 'failed') {
    return nextAttemptAt === null && providerMessageId === null && failureCode !== null;
  }
  return nextAttemptAt === null
    && providerMessageId === null
    && failureCode?.startsWith('uncertain_') === true;
}

function decodeAttempt(
  uid: string,
  snapshot: DocumentSnapshot,
): StoredReportEmailDeliveryAttempt {
  const value = snapshot.data() ?? {};
  if (
    !snapshot.exists
    || value.schemaVersion !== REPORT_EMAIL_DELIVERY_ATTEMPT_SCHEMA_VERSION
    || value.id !== snapshot.id
    || value.userId !== uid
    || typeof value.reportId !== 'string'
    || !REPORT_ID_PATTERN.test(value.reportId)
    || !Number.isInteger(value.attemptNumber)
    || value.attemptNumber < 1
    || value.attemptNumber > REPORT_EMAIL_MAX_PROVIDER_ATTEMPTS
    || value.provider !== 'resend'
    || !ATTEMPT_STATES.has(String(value.state))
  ) {
    throw new DomainError('INTERNAL', 'Stored report email attempt is invalid.');
  }
  const emailContentHash = storedHash(value.emailContentHash);
  const sendAuthorityHash = storedHash(value.sendAuthorityHash);
  const idempotencyKey = storedIdempotencyKey(value.idempotencyKey, value.reportId);
  const claimedAt = storedTimestamp(value.claimedAt);
  const finalizedAt = nullableStoredTimestamp(value.finalizedAt);
  const nextAttemptAt = nullableStoredTimestamp(value.nextAttemptAt);
  const providerMessageId = nullableProviderMessageId(value.providerMessageId);
  const reason = nullableFailureCode(value.reason);
  const state = value.state as StoredReportEmailDeliveryAttempt['state'];
  if (
    snapshot.id !== attemptId(value.reportId, value.attemptNumber, sendAuthorityHash)
    || !attemptStateCoherent(state, finalizedAt, nextAttemptAt, providerMessageId, reason)
  ) {
    throw new DomainError('INTERNAL', 'Stored report email attempt is inconsistent.');
  }
  return Object.freeze({
    schemaVersion: REPORT_EMAIL_DELIVERY_ATTEMPT_SCHEMA_VERSION,
    id: snapshot.id,
    userId: uid,
    reportId: value.reportId,
    attemptNumber: value.attemptNumber,
    provider: 'resend',
    emailContentHash,
    sendAuthorityHash,
    idempotencyKey,
    state,
    claimedAt,
    finalizedAt,
    nextAttemptAt,
    providerMessageId,
    reason,
  });
}

function attemptStateCoherent(
  state: StoredReportEmailDeliveryAttempt['state'],
  finalizedAt: string | null,
  nextAttemptAt: string | null,
  providerMessageId: string | null,
  reason: string | null,
): boolean {
  if (state === 'claimed') {
    return finalizedAt === null && nextAttemptAt === null
      && providerMessageId === null && reason === null;
  }
  if (state === 'accepted') {
    return finalizedAt !== null && nextAttemptAt === null
      && providerMessageId !== null && reason === null;
  }
  if (state === 'rejected') {
    return finalizedAt !== null && nextAttemptAt === null
      && providerMessageId === null && reason !== null;
  }
  if (state === 'retryable') {
    return finalizedAt !== null && providerMessageId === null && reason !== null;
  }
  return finalizedAt !== null && nextAttemptAt === null
    && providerMessageId === null && reason !== null;
}

function assertArchiveControlCoherence(
  archive: StoredScientificReportArchive,
  control: StoredReportEmailDeliveryControl,
): void {
  const delivery = archive.delivery;
  const coherent = control.state === 'claimed'
    ? delivery.state === 'pending'
      && delivery.provider === 'resend'
      && delivery.lastAttemptAt === control.lastAttemptAt
      && delivery.failureCode === null
    : control.state === 'sent'
      ? delivery.state === 'sent'
        && delivery.providerMessageId === control.providerMessageId
      : delivery.state === 'failed'
        && delivery.failureCode === control.failureCode;
  if (!coherent) {
    throw new DomainError('INTERNAL', 'Report archive delivery summary is inconsistent.');
  }
}

function assertAttemptMatchesControl(
  attempt: StoredReportEmailDeliveryAttempt,
  control: StoredReportEmailDeliveryControl,
): void {
  if (
    attempt.id !== control.currentAttemptId
    || attempt.userId !== control.userId
    || attempt.reportId !== control.reportId
    || attempt.attemptNumber !== control.attemptCount
    || attempt.emailContentHash !== control.emailContentHash
    || attempt.sendAuthorityHash !== control.sendAuthorityHash
    || attempt.idempotencyKey !== control.idempotencyKey
    || attempt.provider !== control.provider
    || attempt.claimedAt !== control.lastAttemptAt
  ) {
    throw new DomainError('INTERNAL', 'Report email attempt authority is inconsistent.');
  }
}

function finalizationMatchesAttempt(
  finalization: ReportEmailDeliveryFinalization,
  attempt: StoredReportEmailDeliveryAttempt,
): boolean {
  if (finalization.outcome === 'accepted') {
    return attempt.state === 'accepted'
      && attempt.providerMessageId === finalization.providerMessageId;
  }
  if (finalization.outcome === 'rejected') {
    return attempt.state === 'rejected' && attempt.reason === finalization.reason;
  }
  if (finalization.outcome === 'retryable') {
    return attempt.state === 'retryable' && attempt.reason === finalization.reason;
  }
  return attempt.state === 'uncertain' && attempt.reason === finalization.reason;
}

function resultForControl(
  control: StoredReportEmailDeliveryControl,
): FinalizeReportEmailDeliveryResult {
  if (control.state === 'sent') return Object.freeze({ state: 'sent' });
  if (control.state === 'retryable' && control.nextAttemptAt) {
    return Object.freeze({ state: 'retryable', notBefore: control.nextAttemptAt });
  }
  if (control.state === 'uncertain') return Object.freeze({ state: 'uncertain' });
  if (control.failureCode === 'retry_attempts_exhausted') {
    return Object.freeze({ state: 'attempts_exhausted' });
  }
  return Object.freeze({ state: 'failed' });
}

function retryDelayMs(attemptNumber: number): number {
  return 5 * 60_000 * (2 ** Math.max(0, attemptNumber - 1));
}

function attemptId(reportId: string, attemptNumber: number, authorityHash: string): string {
  const digest = createHash('sha256')
    .update(`${reportId}\0${attemptNumber}\0${authorityHash}`)
    .digest('hex')
    .slice(0, 48);
  return `email_attempt_${digest}`;
}

function assertUid(uid: string): void {
  if (!UID_PATTERN.test(uid)) {
    throw new DomainError('UNAUTHENTICATED', 'A verified Firebase identity is required.');
  }
}

function assertReportId(reportId: string): void {
  if (!REPORT_ID_PATTERN.test(reportId)) {
    throw new DomainError('INVALID_ARGUMENT', 'Report identifier is invalid.');
  }
}

function assertHash(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new DomainError('INVALID_ARGUMENT', 'Report email hash authority is invalid.');
  }
}

function normalizedInstant(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new DomainError('INVALID_ARGUMENT', `${label} is invalid.`);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new DomainError('INVALID_ARGUMENT', `${label} is invalid.`);
  const normalized = new Date(epoch).toISOString();
  if (normalized !== value) throw new DomainError('INVALID_ARGUMENT', `${label} is not normalized.`);
  return normalized;
}

function storedHash(value: unknown): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new DomainError('INTERNAL', 'Stored report email hash is invalid.');
  }
  return value;
}

function storedIdempotencyKey(value: unknown, reportId: string): string {
  if (
    typeof value !== 'string'
    || !/^life-tracker-report-v3\/[0-9a-f]{64}$/u.test(value)
    || !REPORT_ID_PATTERN.test(reportId)
  ) {
    throw new DomainError('INTERNAL', 'Stored report email idempotency key is invalid.');
  }
  return value;
}

function storedTimestamp(value: unknown): string {
  if (!(value instanceof Timestamp)) {
    throw new DomainError('INTERNAL', 'Stored report email timestamp is invalid.');
  }
  return value.toDate().toISOString();
}

function nullableStoredTimestamp(value: unknown): string | null {
  return value === null ? null : storedTimestamp(value);
}

function nullableProviderMessageId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !PROVIDER_MESSAGE_ID_PATTERN.test(value)) {
    throw new DomainError('INTERNAL', 'Stored provider message identity is invalid.');
  }
  return value;
}

function nullableFailureCode(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !FAILURE_CODE_PATTERN.test(value)) {
    throw new DomainError('INTERNAL', 'Stored report email reason is invalid.');
  }
  return value;
}
