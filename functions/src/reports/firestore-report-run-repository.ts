import { createHash } from 'node:crypto';
import {
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';
import { DomainError } from '../domain/errors';
import {
  createReportArchiveIdempotencyRecord,
  createStoredScientificReportArchive,
  type StoredScientificReportArchive,
} from './archive';
import {
  assertReportArchiveMarkerCoherence,
  decodeReportArchiveIdempotencySnapshot,
  decodeStoredScientificReportArchiveSnapshot,
  encodeReportArchiveIdempotencyRecord,
  encodeStoredScientificReportArchive,
} from './firestore-archive-repository';
import { deriveFirestoreScientificReportSchedulePolicy } from './firestore-schedule-authority';
import {
  REPORT_RUN_DELIVERY_CLAIM_LEASE_MS,
  REPORT_RUN_GENERATION_CLAIM_LEASE_MS,
  REPORT_RUN_MAX_DELIVERY_ATTEMPTS,
  REPORT_RUN_MAX_GENERATION_ATTEMPTS,
  REPORT_RUN_STORAGE_SCHEMA_VERSION,
  type AuthorizeScientificReportRunDeliveryResult,
  type ClaimScientificReportRunResult,
  type CommitScientificReportRunResult,
  type FinalizeScientificReportRunDeliveryResult,
  type RecordScientificReportRunFailureResult,
  type ScientificReportRunFailureCode,
  type ScientificReportRunRepository,
  type ScientificReportRunState,
  type StoredScientificReportRun,
} from './report-run';
import { reportIdempotencyKey } from './report-builder';
import {
  REPORT_DAILY_CATCH_UP_MS,
  REPORT_WEEKLY_CATCH_UP_MS,
  authorizeScientificReportScheduleCandidate,
  deriveScientificReportSchedulePolicy,
  type ScientificReportScheduleCandidate,
  type ScientificReportSchedulePolicy,
  type ScientificReportScheduleSuppressionReason,
  validateScientificReportScheduleCandidate,
} from './scheduling';

const RUN_ID_PATTERN = /^report_run_[0-9a-f]{48}$/;
const REPORT_ID_PATTERN = /^report_[0-9a-f]{56}$/;
const GENERATION_CLAIM_ID_PATTERN = /^report_generation_[0-9a-f]{48}$/;
const DELIVERY_CLAIM_ID_PATTERN = /^report_delivery_[0-9a-f]{48}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const GENERATION_RETRY_BASE_MS = 5 * 60_000;
const DELIVERY_RETRY_BASE_MS = 10 * 60_000;

/**
 * Admin-only report-run transactions. All paths are derived from a validated
 * candidate UID/run ID; recipient mailboxes are returned in memory and never
 * encoded into run, archive-idempotency, or task state.
 */
export class FirestoreScientificReportRunRepository
implements ScientificReportRunRepository {
  constructor(private readonly firestore: Firestore) {}

  async claimGeneration(
    candidate: ScientificReportScheduleCandidate,
    now: string,
  ): Promise<ClaimScientificReportRunResult> {
    validateScientificReportScheduleCandidate(candidate);
    const timestamp = normalizeInstant(now, 'Report run claim time');
    if (Date.parse(timestamp) < Date.parse(candidate.scheduledFor)) {
      return Object.freeze({
        action: 'retry_later',
        stage: 'generation',
        notBefore: candidate.scheduledFor,
      });
    }
    const reportId = reportIdempotencyKey(
      candidate.uid,
      candidate.reportType,
      candidate.localStartDate,
    );
    return this.firestore.runTransaction(async (transaction) => {
      const refs = this.refs(candidate.uid, candidate.id, reportId);
      const snapshots = await transaction.getAll(
        refs.run,
        refs.user,
        refs.preferences,
        refs.archive,
        refs.idempotency,
      );
      const [runSnapshot, userSnapshot, preferenceSnapshot, archiveSnapshot, markerSnapshot]
        = completeSnapshots(snapshots, 'Report run claim authority read is incomplete.');
      const stored = runSnapshot.exists ? decodeStoredReportRun(candidate.uid, runSnapshot) : null;
      const exactStoredCandidate = stored ? runMatchesCandidate(stored, candidate, reportId) : false;
      if (stored) assertRunPeriod(stored, candidate, reportId);
      const archive = decodeArchivePair(
        candidate.uid,
        archiveSnapshot,
        markerSnapshot,
      );
      const maximumAge = candidate.reportType === 'daily'
        ? REPORT_DAILY_CATCH_UP_MS
        : REPORT_WEEKLY_CATCH_UP_MS;
      if (Date.parse(timestamp) - Date.parse(candidate.scheduledFor) > maximumAge) {
        if (stored && !terminalRun(stored)) {
          transaction.set(refs.run, encodeStoredReportRun(suppressedRun(
            stored,
            'outside_catch_up_window',
            timestamp,
          )));
        }
        return Object.freeze({ action: 'no_op', reason: 'outside_catch_up_window' });
      }
      const policy = deriveFirestoreScientificReportSchedulePolicy(
        candidate.uid,
        userSnapshot,
        preferenceSnapshot,
      );
      const authorization = authorizeScientificReportScheduleCandidate(policy, candidate);

      if (authorization.action === 'suppress') {
        if (stored && !terminalRun(stored)) {
          transaction.set(refs.run, encodeStoredReportRun(suppressedRun(
            stored,
            authorization.reason,
            timestamp,
          )));
        }
        return Object.freeze({ action: 'no_op', reason: authorization.reason });
      }

      if (stored && !exactStoredCandidate) {
        if (stored.state === 'completed') {
          return Object.freeze({ action: 'no_op', reason: 'already_completed' });
        }
        if (stored.state === 'failed') {
          return Object.freeze({ action: 'no_op', reason: 'terminal_failure' });
        }
        const reason: ScientificReportScheduleSuppressionReason =
          stored.recipientAuthorityHash !== candidate.recipientAuthorityHash
            ? 'recipient_changed'
            : 'schedule_changed';
        transaction.set(refs.run, encodeStoredReportRun(suppressedRun(
          stored,
          reason,
          timestamp,
        )));
        return Object.freeze({ action: 'no_op', reason });
      }

      if (!stored) {
        const created = newGeneratingRun(candidate, reportId, timestamp);
        transaction.create(refs.run, encodeStoredReportRun(created));
        return generationResult(created, policy);
      }
      if (stored.state === 'completed') {
        return Object.freeze({ action: 'no_op', reason: 'already_completed' });
      }
      if (stored.state === 'failed') {
        return Object.freeze({ action: 'no_op', reason: 'terminal_failure' });
      }

      if (stored.state === 'archived'
        || stored.state === 'delivery_authorized'
        || stored.state === 'delivery_retryable'
        || (stored.state === 'suppressed' && archive !== null)) {
        if (!archive || !archiveMatchesRun(archive, stored)) {
          const failed = failedRun(stored, 'archive_missing', timestamp);
          transaction.set(refs.run, encodeStoredReportRun(failed));
          return Object.freeze({ action: 'no_op', reason: 'terminal_failure' });
        }
        if (
          stored.state === 'delivery_retryable'
          && stored.nextAttemptAt
          && Date.parse(timestamp) < Date.parse(stored.nextAttemptAt)
        ) {
          return Object.freeze({
            action: 'retry_later',
            stage: 'delivery',
            notBefore: stored.nextAttemptAt,
          });
        }
        if (
          stored.state === 'delivery_authorized'
          && stored.deliveryClaimExpiresAt
          && Date.parse(timestamp) < Date.parse(stored.deliveryClaimExpiresAt)
        ) {
          return Object.freeze({
            action: 'retry_later',
            stage: 'delivery',
            notBefore: stored.deliveryClaimExpiresAt,
          });
        }
        if (stored.state === 'suppressed') {
          transaction.set(refs.run, encodeStoredReportRun(archivedRun(stored, archive, timestamp)));
        }
        return Object.freeze({ action: 'resume_delivery', reportId });
      }

      if (
        stored.state === 'generation_retryable'
        && stored.nextAttemptAt
        && Date.parse(timestamp) < Date.parse(stored.nextAttemptAt)
      ) {
        return Object.freeze({
          action: 'retry_later',
          stage: 'generation',
          notBefore: stored.nextAttemptAt,
        });
      }
      if (
        stored.state === 'generating'
        && stored.generationClaimExpiresAt
        && Date.parse(timestamp) < Date.parse(stored.generationClaimExpiresAt)
      ) {
        return Object.freeze({
          action: 'retry_later',
          stage: 'generation',
          notBefore: stored.generationClaimExpiresAt,
        });
      }
      if (stored.generationAttemptCount >= REPORT_RUN_MAX_GENERATION_ATTEMPTS) {
        const failed = failedRun(stored, 'generation_attempts_exhausted', timestamp);
        transaction.set(refs.run, encodeStoredReportRun(failed));
        return Object.freeze({ action: 'no_op', reason: 'terminal_failure' });
      }
      const reclaimed = generatingRun(stored, timestamp);
      transaction.set(refs.run, encodeStoredReportRun(reclaimed));
      return generationResult(reclaimed, policy);
    });
  }

  async getArchive(uid: string, reportId: string): Promise<StoredScientificReportArchive | null> {
    assertUid(uid);
    assertReportId(reportId);
    const snapshot = await this.firestore.doc(`users/${uid}/reportArchives/${reportId}`).get();
    return snapshot.exists ? decodeStoredScientificReportArchiveSnapshot(uid, snapshot) : null;
  }

  async commitGeneratedReport(input: Readonly<{
    candidate: ScientificReportScheduleCandidate;
    claimId: string;
    report: Parameters<typeof createStoredScientificReportArchive>[1];
    now: string;
  }>): Promise<CommitScientificReportRunResult> {
    validateScientificReportScheduleCandidate(input.candidate);
    assertGenerationClaimId(input.claimId);
    const timestamp = normalizeInstant(input.now, 'Report archive commit time');
    const reportId = reportIdempotencyKey(
      input.candidate.uid,
      input.candidate.reportType,
      input.candidate.localStartDate,
    );
    const proposed = createStoredScientificReportArchive(
      input.candidate.uid,
      input.report,
      timestamp,
    );
    if (
      proposed.id !== reportId
      || proposed.type !== input.candidate.reportType
      || proposed.localStartDate !== input.candidate.localStartDate
    ) {
      throw new DomainError('CONFLICT', 'Generated report period does not match its run.');
    }

    return this.firestore.runTransaction(async (transaction) => {
      const refs = this.refs(input.candidate.uid, input.candidate.id, reportId);
      const snapshots = await transaction.getAll(
        refs.run,
        refs.user,
        refs.preferences,
        refs.archive,
        refs.idempotency,
      );
      const [runSnapshot, userSnapshot, preferenceSnapshot, archiveSnapshot, markerSnapshot]
        = completeSnapshots(snapshots, 'Report archive commit authority read is incomplete.');
      if (!runSnapshot.exists) throw new DomainError('NOT_FOUND', 'Report run was not found.');
      const stored = decodeStoredReportRun(input.candidate.uid, runSnapshot);
      assertRunCandidate(stored, input.candidate, reportId);
      if (stored.state === 'archived' && stored.lastGenerationClaimId === input.claimId) {
        const replay = decodeArchivePair(
          input.candidate.uid,
          archiveSnapshot,
          markerSnapshot,
        );
        if (!replay || !archiveMatchesRun(replay, stored)) {
          throw new DomainError('INTERNAL', 'Report archive replay state is inconsistent.');
        }
        if (replay.artifactHash !== proposed.artifactHash) {
          throw new DomainError('CONFLICT', 'Report archive replay content changed.');
        }
        return Object.freeze({ action: 'archived', archive: replay, idempotentReplay: true });
      }
      if (
        stored.state !== 'generating'
        || stored.currentGenerationClaimId !== input.claimId
      ) {
        throw new DomainError('CONFLICT', 'Report generation claim is no longer current.');
      }

      const policy = deriveFirestoreScientificReportSchedulePolicy(
        input.candidate.uid,
        userSnapshot,
        preferenceSnapshot,
      );
      const authorization = authorizeScientificReportScheduleCandidate(policy, input.candidate);
      if (authorization.action === 'suppress') {
        transaction.set(refs.run, encodeStoredReportRun(suppressedRun(
          stored,
          authorization.reason,
          timestamp,
        )));
        return Object.freeze({ action: 'suppressed', reason: authorization.reason });
      }
      const canonicalLocale = Intl.getCanonicalLocales(policy.locale)[0];
      if (
        proposed.timezone !== policy.timezone
        || proposed.report.locale !== canonicalLocale
      ) {
        const failed = failedRun(stored, 'generation_invalid', timestamp, input.claimId);
        transaction.set(refs.run, encodeStoredReportRun(failed));
        return Object.freeze({ action: 'failed', reason: 'generation_invalid' });
      }

      const existing = decodeArchivePair(
        input.candidate.uid,
        archiveSnapshot,
        markerSnapshot,
      );
      let archive = proposed;
      let idempotentReplay = false;
      if (existing) {
        if (
          existing.id !== proposed.id
          || existing.type !== proposed.type
          || existing.localStartDate !== proposed.localStartDate
          || existing.timezone !== proposed.timezone
          || existing.artifactHash !== proposed.artifactHash
        ) {
          const failed = failedRun(stored, 'archive_conflict', timestamp, input.claimId);
          transaction.set(refs.run, encodeStoredReportRun(failed));
          return Object.freeze({ action: 'failed', reason: 'archive_conflict' });
        }
        archive = existing;
        idempotentReplay = true;
      } else {
        if (proposed.generatedAt !== stored.generatedAt) {
          throw new DomainError('CONFLICT', 'Generated report instant does not match its first claim.');
        }
        transaction.create(refs.archive, encodeStoredScientificReportArchive(proposed));
        transaction.create(
          refs.idempotency,
          encodeReportArchiveIdempotencyRecord(createReportArchiveIdempotencyRecord(proposed)),
        );
      }
      transaction.set(refs.run, encodeStoredReportRun(archivedRun(
        stored,
        archive,
        timestamp,
        input.claimId,
      )));
      return Object.freeze({ action: 'archived', archive, idempotentReplay });
    });
  }

  async recordGenerationFailure(input: Readonly<{
    candidate: ScientificReportScheduleCandidate;
    claimId: string;
    reason: 'source_unavailable' | 'generation_invalid';
    now: string;
  }>): Promise<RecordScientificReportRunFailureResult> {
    validateScientificReportScheduleCandidate(input.candidate);
    assertGenerationClaimId(input.claimId);
    const timestamp = normalizeInstant(input.now, 'Report generation failure time');
    return this.firestore.runTransaction(async (transaction) => {
      const ref = this.runRef(input.candidate.uid, input.candidate.id);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new DomainError('NOT_FOUND', 'Report run was not found.');
      const stored = decodeStoredReportRun(input.candidate.uid, snapshot);
      assertRunCandidate(stored, input.candidate, stored.reportId);
      const replay = replayGenerationFailure(stored, input.claimId, input.reason);
      if (replay) return replay;
      if (
        stored.state !== 'generating'
        || stored.currentGenerationClaimId !== input.claimId
      ) {
        throw new DomainError('CONFLICT', 'Report generation claim is no longer current.');
      }
      if (stored.generationAttemptCount >= REPORT_RUN_MAX_GENERATION_ATTEMPTS) {
        const failed = failedRun(
          stored,
          'generation_attempts_exhausted',
          timestamp,
          input.claimId,
        );
        transaction.set(ref, encodeStoredReportRun(failed));
        return Object.freeze({ action: 'failed', reason: 'generation_attempts_exhausted' });
      }
      const notBefore = addMilliseconds(
        timestamp,
        GENERATION_RETRY_BASE_MS * stored.generationAttemptCount,
      );
      const retryable: StoredScientificReportRun = Object.freeze({
        ...stored,
        state: 'generation_retryable',
        currentGenerationClaimId: null,
        lastGenerationClaimId: input.claimId,
        generationClaimExpiresAt: null,
        nextAttemptAt: notBefore,
        suppressionReason: null,
        failureCode: input.reason,
        updatedAt: timestamp,
        completedAt: null,
      });
      transaction.set(ref, encodeStoredReportRun(retryable));
      return Object.freeze({ action: 'retry_later', stage: 'generation', notBefore });
    });
  }

  async authorizeDelivery(input: Readonly<{
    candidate: ScientificReportScheduleCandidate;
    reportId: string;
    archiveArtifactHash: string;
    archiveMetricHash: string;
    now: string;
  }>): Promise<AuthorizeScientificReportRunDeliveryResult> {
    validateScientificReportScheduleCandidate(input.candidate);
    assertReportId(input.reportId);
    assertHash(input.archiveArtifactHash, 'Report archive artifact hash');
    assertHash(input.archiveMetricHash, 'Report archive metric hash');
    const timestamp = normalizeInstant(input.now, 'Report delivery authorization time');
    return this.firestore.runTransaction(async (transaction) => {
      const refs = this.refs(input.candidate.uid, input.candidate.id, input.reportId);
      const snapshots = await transaction.getAll(
        refs.run,
        refs.user,
        refs.preferences,
        refs.archive,
        refs.idempotency,
      );
      const [runSnapshot, userSnapshot, preferenceSnapshot, archiveSnapshot, markerSnapshot]
        = completeSnapshots(snapshots, 'Report delivery authority read is incomplete.');
      if (!runSnapshot.exists) throw new DomainError('NOT_FOUND', 'Report run was not found.');
      const stored = decodeStoredReportRun(input.candidate.uid, runSnapshot);
      assertRunCandidate(stored, input.candidate, input.reportId);
      if (stored.state === 'completed') {
        return Object.freeze({ action: 'no_op', reason: 'already_completed' });
      }
      if (stored.state === 'failed') {
        return Object.freeze({ action: 'no_op', reason: 'terminal_failure' });
      }
      if (
        stored.state !== 'archived'
        && stored.state !== 'delivery_authorized'
        && stored.state !== 'delivery_retryable'
        && stored.state !== 'suppressed'
      ) {
        throw new DomainError('CONFLICT', 'Report archive is not ready for delivery.');
      }
      const policy = deriveFirestoreScientificReportSchedulePolicy(
        input.candidate.uid,
        userSnapshot,
        preferenceSnapshot,
      );
      const authorization = authorizeScientificReportScheduleCandidate(policy, input.candidate);
      if (authorization.action === 'suppress') {
        transaction.set(refs.run, encodeStoredReportRun(suppressedRun(
          stored,
          authorization.reason,
          timestamp,
        )));
        return Object.freeze({ action: 'suppressed', reason: authorization.reason });
      }
      const archive = decodeArchivePair(
        input.candidate.uid,
        archiveSnapshot,
        markerSnapshot,
      );
      if (
        !archive
        || archive.id !== input.reportId
        || !archiveMatchesRun(archive, stored)
        || archive.artifactHash !== input.archiveArtifactHash
        || archive.metricHash !== input.archiveMetricHash
      ) {
        const failed = failedRun(stored, 'archive_missing', timestamp);
        transaction.set(refs.run, encodeStoredReportRun(failed));
        return Object.freeze({ action: 'no_op', reason: 'terminal_failure' });
      }
      if (
        stored.state === 'delivery_retryable'
        && stored.nextAttemptAt
        && Date.parse(timestamp) < Date.parse(stored.nextAttemptAt)
      ) {
        return Object.freeze({ action: 'retry_later', notBefore: stored.nextAttemptAt });
      }
      if (
        stored.state === 'delivery_authorized'
        && stored.deliveryClaimExpiresAt
        && Date.parse(timestamp) < Date.parse(stored.deliveryClaimExpiresAt)
      ) {
        return Object.freeze({ action: 'retry_later', notBefore: stored.deliveryClaimExpiresAt });
      }
      if (stored.deliveryAttemptCount >= REPORT_RUN_MAX_DELIVERY_ATTEMPTS) {
        const failed = failedRun(stored, 'delivery_attempts_exhausted', timestamp);
        transaction.set(refs.run, encodeStoredReportRun(failed));
        return Object.freeze({ action: 'no_op', reason: 'terminal_failure' });
      }
      const attemptNumber = stored.deliveryAttemptCount + 1;
      const claimId = deliveryClaimId(stored.id, attemptNumber, timestamp);
      const authorized: StoredScientificReportRun = Object.freeze({
        ...stored,
        state: 'delivery_authorized',
        deliveryAttemptCount: attemptNumber,
        currentDeliveryClaimId: claimId,
        deliveryClaimExpiresAt: addMilliseconds(timestamp, REPORT_RUN_DELIVERY_CLAIM_LEASE_MS),
        nextAttemptAt: null,
        suppressionReason: null,
        failureCode: null,
        updatedAt: timestamp,
        completedAt: null,
      });
      transaction.set(refs.run, encodeStoredReportRun(authorized));
      return Object.freeze({ action: 'deliver', claimId, recipient: authorization.recipient });
    });
  }

  async finalizeDelivery(input: Parameters<ScientificReportRunRepository['finalizeDelivery']>[0])
  : Promise<FinalizeScientificReportRunDeliveryResult> {
    validateScientificReportScheduleCandidate(input.candidate);
    assertReportId(input.reportId);
    assertDeliveryClaimId(input.claimId);
    const timestamp = normalizeInstant(input.now, 'Report delivery finalization time');
    return this.firestore.runTransaction(async (transaction) => {
      const ref = this.runRef(input.candidate.uid, input.candidate.id);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new DomainError('NOT_FOUND', 'Report run was not found.');
      const stored = decodeStoredReportRun(input.candidate.uid, snapshot);
      assertRunCandidate(stored, input.candidate, input.reportId);
      const replay = replayDeliveryFinalization(stored, input.claimId, input.result);
      if (replay) return replay;
      if (
        stored.state !== 'delivery_authorized'
        || stored.currentDeliveryClaimId !== input.claimId
      ) {
        throw new DomainError('CONFLICT', 'Report delivery claim is no longer current.');
      }
      const transition = deliveryTransition(stored, input.claimId, input.result, timestamp);
      transaction.set(ref, encodeStoredReportRun(transition.run));
      return transition.result;
    });
  }

  async recordDeliveryInvocationFailure(input: Readonly<{
    candidate: ScientificReportScheduleCandidate;
    reportId: string;
    claimId: string;
    now: string;
  }>): Promise<RecordScientificReportRunFailureResult> {
    validateScientificReportScheduleCandidate(input.candidate);
    assertReportId(input.reportId);
    assertDeliveryClaimId(input.claimId);
    const timestamp = normalizeInstant(input.now, 'Report delivery failure time');
    return this.firestore.runTransaction(async (transaction) => {
      const ref = this.runRef(input.candidate.uid, input.candidate.id);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new DomainError('NOT_FOUND', 'Report run was not found.');
      const stored = decodeStoredReportRun(input.candidate.uid, snapshot);
      assertRunCandidate(stored, input.candidate, input.reportId);
      const replay = replayDeliveryFailure(stored, input.claimId);
      if (replay) return replay;
      if (
        stored.state !== 'delivery_authorized'
        || stored.currentDeliveryClaimId !== input.claimId
      ) {
        throw new DomainError('CONFLICT', 'Report delivery claim is no longer current.');
      }
      if (stored.deliveryAttemptCount >= REPORT_RUN_MAX_DELIVERY_ATTEMPTS) {
        const failed = failedRun(
          stored,
          'delivery_attempts_exhausted',
          timestamp,
          undefined,
          input.claimId,
        );
        transaction.set(ref, encodeStoredReportRun(failed));
        return Object.freeze({ action: 'failed', reason: 'delivery_attempts_exhausted' });
      }
      const notBefore = addMilliseconds(
        timestamp,
        DELIVERY_RETRY_BASE_MS * stored.deliveryAttemptCount,
      );
      const retryable: StoredScientificReportRun = Object.freeze({
        ...stored,
        state: 'delivery_retryable',
        currentDeliveryClaimId: null,
        lastDeliveryClaimId: input.claimId,
        deliveryClaimExpiresAt: null,
        nextAttemptAt: notBefore,
        deliveryOutcome: null,
        suppressionReason: null,
        failureCode: 'delivery_service_unavailable',
        updatedAt: timestamp,
        completedAt: null,
      });
      transaction.set(ref, encodeStoredReportRun(retryable));
      return Object.freeze({ action: 'retry_later', stage: 'delivery', notBefore });
    });
  }

  private refs(uid: string, runId: string, reportId: string) {
    return {
      run: this.runRef(uid, runId),
      user: this.firestore.doc(`users/${uid}`),
      preferences: this.firestore.doc(`users/${uid}/notificationPreferences/default`),
      archive: this.firestore.doc(`users/${uid}/reportArchives/${reportId}`),
      idempotency: this.firestore.doc(`users/${uid}/reportIdempotency/${reportId}`),
    } as const;
  }

  private runRef(uid: string, runId: string) {
    assertUid(uid);
    assertRunId(runId);
    return this.firestore.doc(`users/${uid}/reportRuns/${runId}`);
  }
}

function newGeneratingRun(
  candidate: ScientificReportScheduleCandidate,
  reportId: string,
  now: string,
): StoredScientificReportRun {
  const claimId = generationClaimId(candidate.id, 1, now);
  return Object.freeze({
    schemaVersion: REPORT_RUN_STORAGE_SCHEMA_VERSION,
    id: candidate.id,
    userId: candidate.uid,
    reportId,
    reportType: candidate.reportType,
    localDate: candidate.localDate,
    localStartDate: candidate.localStartDate,
    scheduledFor: candidate.scheduledFor,
    expectedScheduleVersion: candidate.expectedScheduleVersion,
    recipientAuthorityHash: candidate.recipientAuthorityHash,
    state: 'generating',
    generationAttemptCount: 1,
    currentGenerationClaimId: claimId,
    lastGenerationClaimId: null,
    generatedAt: now,
    generationClaimExpiresAt: addMilliseconds(now, REPORT_RUN_GENERATION_CLAIM_LEASE_MS),
    deliveryAttemptCount: 0,
    currentDeliveryClaimId: null,
    lastDeliveryClaimId: null,
    deliveryClaimExpiresAt: null,
    nextAttemptAt: null,
    archiveArtifactHash: null,
    archiveMetricHash: null,
    deliveryOutcome: null,
    suppressionReason: null,
    failureCode: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  });
}

function generatingRun(stored: StoredScientificReportRun, now: string): StoredScientificReportRun {
  const attempt = stored.generationAttemptCount + 1;
  return Object.freeze({
    ...stored,
    state: 'generating',
    generationAttemptCount: attempt,
    currentGenerationClaimId: generationClaimId(stored.id, attempt, now),
    generationClaimExpiresAt: addMilliseconds(now, REPORT_RUN_GENERATION_CLAIM_LEASE_MS),
    nextAttemptAt: null,
    suppressionReason: null,
    failureCode: null,
    updatedAt: now,
    completedAt: null,
  });
}

function generationResult(
  run: StoredScientificReportRun,
  policy: ScientificReportSchedulePolicy,
): Extract<ClaimScientificReportRunResult, { action: 'generate' }> {
  if (!run.currentGenerationClaimId) throw new DomainError('INTERNAL', 'Report claim is missing.');
  return Object.freeze({
    action: 'generate',
    claimId: run.currentGenerationClaimId,
    generatedAt: run.generatedAt,
    reportId: run.reportId,
    timezone: policy.timezone,
    locale: policy.locale,
  });
}

function archivedRun(
  stored: StoredScientificReportRun,
  archive: StoredScientificReportArchive,
  now: string,
  generationClaim: string | undefined = undefined,
): StoredScientificReportRun {
  return Object.freeze({
    ...stored,
    state: 'archived',
    currentGenerationClaimId: null,
    lastGenerationClaimId: generationClaim ?? stored.lastGenerationClaimId,
    generationClaimExpiresAt: null,
    currentDeliveryClaimId: null,
    deliveryClaimExpiresAt: null,
    nextAttemptAt: null,
    archiveArtifactHash: archive.artifactHash,
    archiveMetricHash: archive.metricHash,
    deliveryOutcome: null,
    suppressionReason: null,
    failureCode: null,
    updatedAt: now,
    completedAt: null,
  });
}

function suppressedRun(
  stored: StoredScientificReportRun,
  reason: ScientificReportScheduleSuppressionReason,
  now: string,
): StoredScientificReportRun {
  return Object.freeze({
    ...stored,
    state: 'suppressed',
    currentGenerationClaimId: null,
    lastGenerationClaimId: stored.currentGenerationClaimId ?? stored.lastGenerationClaimId,
    generationClaimExpiresAt: null,
    currentDeliveryClaimId: null,
    lastDeliveryClaimId: stored.currentDeliveryClaimId ?? stored.lastDeliveryClaimId,
    deliveryClaimExpiresAt: null,
    nextAttemptAt: null,
    deliveryOutcome: null,
    suppressionReason: reason,
    failureCode: null,
    updatedAt: now,
    completedAt: now,
  });
}

function failedRun(
  stored: StoredScientificReportRun,
  failureCode: ScientificReportRunFailureCode,
  now: string,
  generationClaim: string | undefined = undefined,
  deliveryClaim: string | undefined = undefined,
): StoredScientificReportRun {
  return Object.freeze({
    ...stored,
    state: 'failed',
    currentGenerationClaimId: null,
    lastGenerationClaimId: generationClaim
      ?? stored.currentGenerationClaimId
      ?? stored.lastGenerationClaimId,
    generationClaimExpiresAt: null,
    currentDeliveryClaimId: null,
    lastDeliveryClaimId: deliveryClaim
      ?? stored.currentDeliveryClaimId
      ?? stored.lastDeliveryClaimId,
    deliveryClaimExpiresAt: null,
    nextAttemptAt: null,
    deliveryOutcome: null,
    suppressionReason: null,
    failureCode,
    updatedAt: now,
    completedAt: now,
  });
}

function deliveryTransition(
  stored: StoredScientificReportRun,
  claimId: string,
  result: Parameters<ScientificReportRunRepository['finalizeDelivery']>[0]['result'],
  now: string,
): Readonly<{
  run: StoredScientificReportRun;
  result: FinalizeScientificReportRunDeliveryResult;
}> {
  if (result.outcome === 'accepted'
    || (result.outcome === 'no_op' && result.reason === 'already_sent')) {
    const delivery = result.outcome === 'accepted' ? 'accepted' : 'already_sent';
    return Object.freeze({
      run: Object.freeze({
        ...stored,
        state: 'completed',
        currentDeliveryClaimId: null,
        lastDeliveryClaimId: claimId,
        deliveryClaimExpiresAt: null,
        nextAttemptAt: null,
        deliveryOutcome: delivery,
        suppressionReason: null,
        failureCode: null,
        updatedAt: now,
        completedAt: now,
      }),
      result: Object.freeze({ action: 'completed', delivery }),
    });
  }
  if (result.outcome === 'retry_later') {
    const notBefore = normalizeInstant(result.notBefore, 'Report delivery retry time');
    if (Date.parse(notBefore) <= Date.parse(now)) {
      throw new DomainError('INTERNAL', 'Report delivery retry time is not in the future.');
    }
    return Object.freeze({
      run: Object.freeze({
        ...stored,
        state: 'delivery_retryable',
        currentDeliveryClaimId: null,
        lastDeliveryClaimId: claimId,
        deliveryClaimExpiresAt: null,
        nextAttemptAt: notBefore,
        deliveryOutcome: null,
        suppressionReason: null,
        failureCode: null,
        updatedAt: now,
        completedAt: null,
      }),
      result: Object.freeze({ action: 'retry_later', notBefore }),
    });
  }
  const failureCode = deliveryFailureCode(result);
  return Object.freeze({
    run: failedRun(stored, failureCode, now, undefined, claimId),
    result: Object.freeze({ action: 'failed', reason: failureCode }),
  });
}

function replayGenerationFailure(
  stored: StoredScientificReportRun,
  claimId: string,
  reason: 'source_unavailable' | 'generation_invalid',
): RecordScientificReportRunFailureResult | null {
  if (stored.lastGenerationClaimId !== claimId) return null;
  if (stored.state === 'generation_retryable' && stored.nextAttemptAt) {
    if (stored.failureCode !== reason) {
      throw new DomainError('CONFLICT', 'Report generation failure replay changed.');
    }
    return Object.freeze({
      action: 'retry_later',
      stage: 'generation',
      notBefore: stored.nextAttemptAt,
    });
  }
  if (stored.state === 'failed' && stored.failureCode) {
    return Object.freeze({ action: 'failed', reason: stored.failureCode });
  }
  return null;
}

function deliveryFailureCode(
  result: Parameters<ScientificReportRunRepository['finalizeDelivery']>[0]['result'],
): ScientificReportRunFailureCode {
  if (result.outcome === 'rejected') return 'delivery_rejected';
  if (result.outcome === 'uncertain') return 'delivery_uncertain';
  if (result.outcome === 'no_op') {
    if (result.reason === 'delivery_uncertain') return 'delivery_uncertain';
    if (result.reason === 'attempts_exhausted') return 'delivery_attempts_exhausted';
    if (result.reason === 'report_missing') return 'archive_missing';
    if (result.reason === 'terminal_failure') return 'delivery_terminal_failure';
  }
  throw new DomainError('CONFLICT', 'Report delivery failure result is inconsistent.');
}

function replayDeliveryFailure(
  stored: StoredScientificReportRun,
  claimId: string,
): RecordScientificReportRunFailureResult | null {
  if (stored.lastDeliveryClaimId !== claimId) return null;
  if (stored.state === 'delivery_retryable' && stored.nextAttemptAt) {
    return Object.freeze({
      action: 'retry_later',
      stage: 'delivery',
      notBefore: stored.nextAttemptAt,
    });
  }
  if (stored.state === 'failed' && stored.failureCode) {
    return Object.freeze({ action: 'failed', reason: stored.failureCode });
  }
  return null;
}

function replayDeliveryFinalization(
  stored: StoredScientificReportRun,
  claimId: string,
  input: Parameters<ScientificReportRunRepository['finalizeDelivery']>[0]['result'],
): FinalizeScientificReportRunDeliveryResult | null {
  if (stored.lastDeliveryClaimId !== claimId) return null;
  if (stored.state === 'completed' && stored.deliveryOutcome) {
    const expected = input.outcome === 'accepted'
      ? 'accepted'
      : input.outcome === 'no_op' && input.reason === 'already_sent'
        ? 'already_sent'
        : null;
    if (expected !== stored.deliveryOutcome) {
      throw new DomainError('CONFLICT', 'Report delivery finalization replay changed.');
    }
    return Object.freeze({ action: 'completed', delivery: stored.deliveryOutcome });
  }
  if (stored.state === 'delivery_retryable' && stored.nextAttemptAt) {
    if (input.outcome !== 'retry_later'
      || normalizeInstant(input.notBefore, 'Report delivery retry time') !== stored.nextAttemptAt) {
      throw new DomainError('CONFLICT', 'Report delivery finalization replay changed.');
    }
    return Object.freeze({ action: 'retry_later', notBefore: stored.nextAttemptAt });
  }
  if (stored.state === 'failed' && stored.failureCode) {
    const expected = deliveryFailureCode(input);
    if (stored.failureCode !== expected) {
      throw new DomainError('CONFLICT', 'Report delivery finalization replay changed.');
    }
    return Object.freeze({ action: 'failed', reason: stored.failureCode });
  }
  return null;
}

function decodeArchivePair(
  uid: string,
  archiveSnapshot: DocumentSnapshot,
  markerSnapshot: DocumentSnapshot,
): StoredScientificReportArchive | null {
  if (archiveSnapshot.exists !== markerSnapshot.exists) {
    throw new DomainError('INTERNAL', 'Report archive idempotency state is inconsistent.');
  }
  if (!archiveSnapshot.exists) return null;
  const archive = decodeStoredScientificReportArchiveSnapshot(uid, archiveSnapshot);
  const marker = decodeReportArchiveIdempotencySnapshot(uid, markerSnapshot);
  assertReportArchiveMarkerCoherence(archive, marker);
  return archive;
}

function archiveMatchesRun(
  archive: StoredScientificReportArchive,
  run: StoredScientificReportRun,
): boolean {
  return archive.id === run.reportId
    && archive.userId === run.userId
    && archive.type === run.reportType
    && archive.localStartDate === run.localStartDate
    && (run.archiveArtifactHash === null || archive.artifactHash === run.archiveArtifactHash)
    && (run.archiveMetricHash === null || archive.metricHash === run.archiveMetricHash);
}

function terminalRun(run: StoredScientificReportRun): boolean {
  return run.state === 'completed' || run.state === 'failed';
}

function assertRunCandidate(
  run: StoredScientificReportRun,
  candidate: ScientificReportScheduleCandidate,
  reportId: string,
): void {
  if (!runMatchesCandidate(run, candidate, reportId)) {
    throw new DomainError('CONFLICT', 'Stored report run does not match its candidate.');
  }
}

function assertRunPeriod(
  run: StoredScientificReportRun,
  candidate: ScientificReportScheduleCandidate,
  reportId: string,
): void {
  if (
    run.id !== candidate.id
    || run.userId !== candidate.uid
    || run.reportId !== reportId
    || run.reportType !== candidate.reportType
    || run.localStartDate !== candidate.localStartDate
  ) {
    throw new DomainError('CONFLICT', 'Stored report run does not match its period.');
  }
}

function runMatchesCandidate(
  run: StoredScientificReportRun,
  candidate: ScientificReportScheduleCandidate,
  reportId: string,
): boolean {
  return run.id === candidate.id
    && run.userId === candidate.uid
    && run.reportId === reportId
    && run.reportType === candidate.reportType
    && run.localDate === candidate.localDate
    && run.localStartDate === candidate.localStartDate
    && run.scheduledFor === candidate.scheduledFor
    && run.expectedScheduleVersion === candidate.expectedScheduleVersion
    && run.recipientAuthorityHash === candidate.recipientAuthorityHash;
}

/** @internal Exported for bounded emulator assertions and future worker reads. */
export function decodeStoredReportRun(
  uid: string,
  snapshot: DocumentSnapshot,
): StoredScientificReportRun {
  assertUid(uid);
  assertRunId(snapshot.id);
  const value = snapshot.data() ?? {};
  const keys = [
    'archiveArtifactHash', 'archiveMetricHash', 'completedAt', 'createdAt',
    'currentDeliveryClaimId', 'currentGenerationClaimId', 'deliveryAttemptCount',
    'deliveryClaimExpiresAt', 'deliveryOutcome', 'expectedScheduleVersion',
    'failureCode', 'generatedAt', 'generationAttemptCount', 'generationClaimExpiresAt',
    'id', 'lastDeliveryClaimId', 'lastGenerationClaimId', 'localDate',
    'localStartDate', 'nextAttemptAt', 'recipientAuthorityHash', 'reportId',
    'reportType', 'scheduledFor', 'schemaVersion', 'state', 'suppressionReason',
    'updatedAt', 'userId',
  ];
  if (
    Object.keys(value).sort().join(',') !== keys.sort().join(',')
    || value.schemaVersion !== REPORT_RUN_STORAGE_SCHEMA_VERSION
    || value.id !== snapshot.id
    || value.userId !== uid
  ) {
    throw new DomainError('INTERNAL', 'Stored report run identity or schema is invalid.');
  }
  const candidate = validateScientificReportScheduleCandidate({
    schemaVersion: 'scientific-report-schedule-candidate-v1',
    id: snapshot.id,
    uid,
    reportType: reportTypeValue(value.reportType),
    localDate: localDateValue(value.localDate, 'Stored report run local date'),
    localStartDate: localDateValue(value.localStartDate, 'Stored report run start date'),
    scheduledFor: timestampValue(value.scheduledFor, 'Stored report scheduled time'),
    expectedScheduleVersion: hashValue(value.expectedScheduleVersion, 'Stored schedule version'),
    recipientAuthorityHash: hashValue(value.recipientAuthorityHash, 'Stored recipient authority'),
  });
  const run: StoredScientificReportRun = Object.freeze({
    schemaVersion: REPORT_RUN_STORAGE_SCHEMA_VERSION,
    id: candidate.id,
    userId: uid,
    reportId: reportIdValue(value.reportId),
    reportType: candidate.reportType,
    localDate: candidate.localDate,
    localStartDate: candidate.localStartDate,
    scheduledFor: candidate.scheduledFor,
    expectedScheduleVersion: candidate.expectedScheduleVersion,
    recipientAuthorityHash: candidate.recipientAuthorityHash,
    state: runStateValue(value.state),
    generationAttemptCount: integerValue(
      value.generationAttemptCount,
      1,
      REPORT_RUN_MAX_GENERATION_ATTEMPTS,
      'Stored generation attempt count',
    ),
    currentGenerationClaimId: nullableClaimId(
      value.currentGenerationClaimId,
      GENERATION_CLAIM_ID_PATTERN,
      'Stored generation claim',
    ),
    lastGenerationClaimId: nullableClaimId(
      value.lastGenerationClaimId,
      GENERATION_CLAIM_ID_PATTERN,
      'Stored last generation claim',
    ),
    generatedAt: timestampValue(value.generatedAt, 'Stored report generation time'),
    generationClaimExpiresAt: nullableTimestampValue(
      value.generationClaimExpiresAt,
      'Stored generation lease',
    ),
    deliveryAttemptCount: integerValue(
      value.deliveryAttemptCount,
      0,
      REPORT_RUN_MAX_DELIVERY_ATTEMPTS,
      'Stored delivery attempt count',
    ),
    currentDeliveryClaimId: nullableClaimId(
      value.currentDeliveryClaimId,
      DELIVERY_CLAIM_ID_PATTERN,
      'Stored delivery claim',
    ),
    lastDeliveryClaimId: nullableClaimId(
      value.lastDeliveryClaimId,
      DELIVERY_CLAIM_ID_PATTERN,
      'Stored last delivery claim',
    ),
    deliveryClaimExpiresAt: nullableTimestampValue(
      value.deliveryClaimExpiresAt,
      'Stored delivery lease',
    ),
    nextAttemptAt: nullableTimestampValue(value.nextAttemptAt, 'Stored retry time'),
    archiveArtifactHash: nullableHash(value.archiveArtifactHash, 'Stored archive artifact hash'),
    archiveMetricHash: nullableHash(value.archiveMetricHash, 'Stored archive metric hash'),
    deliveryOutcome: deliveryOutcomeValue(value.deliveryOutcome),
    suppressionReason: suppressionReasonValue(value.suppressionReason),
    failureCode: failureCodeValue(value.failureCode),
    createdAt: timestampValue(value.createdAt, 'Stored report run creation time'),
    updatedAt: timestampValue(value.updatedAt, 'Stored report run update time'),
    completedAt: nullableTimestampValue(value.completedAt, 'Stored report run completion time'),
  });
  if (
    run.reportId !== reportIdempotencyKey(uid, run.reportType, run.localStartDate)
    || Date.parse(run.updatedAt) < Date.parse(run.createdAt)
  ) {
    throw new DomainError('INTERNAL', 'Stored report run identity is inconsistent.');
  }
  assertRunStateCoherence(run);
  return run;
}

/** @internal Exact server-owned codec; it deliberately has no mailbox field. */
export function encodeStoredReportRun(run: StoredScientificReportRun): DocumentData {
  assertRunStateCoherence(run);
  return {
    schemaVersion: run.schemaVersion,
    id: run.id,
    userId: run.userId,
    reportId: run.reportId,
    reportType: run.reportType,
    localDate: run.localDate,
    localStartDate: run.localStartDate,
    scheduledFor: toTimestamp(run.scheduledFor),
    expectedScheduleVersion: run.expectedScheduleVersion,
    recipientAuthorityHash: run.recipientAuthorityHash,
    state: run.state,
    generationAttemptCount: run.generationAttemptCount,
    currentGenerationClaimId: run.currentGenerationClaimId,
    lastGenerationClaimId: run.lastGenerationClaimId,
    generatedAt: toTimestamp(run.generatedAt),
    generationClaimExpiresAt: toNullableTimestamp(run.generationClaimExpiresAt),
    deliveryAttemptCount: run.deliveryAttemptCount,
    currentDeliveryClaimId: run.currentDeliveryClaimId,
    lastDeliveryClaimId: run.lastDeliveryClaimId,
    deliveryClaimExpiresAt: toNullableTimestamp(run.deliveryClaimExpiresAt),
    nextAttemptAt: toNullableTimestamp(run.nextAttemptAt),
    archiveArtifactHash: run.archiveArtifactHash,
    archiveMetricHash: run.archiveMetricHash,
    deliveryOutcome: run.deliveryOutcome,
    suppressionReason: run.suppressionReason,
    failureCode: run.failureCode,
    createdAt: toTimestamp(run.createdAt),
    updatedAt: toTimestamp(run.updatedAt),
    completedAt: toNullableTimestamp(run.completedAt),
  };
}

function assertRunStateCoherence(run: StoredScientificReportRun): void {
  validateScientificReportScheduleCandidate({
    schemaVersion: 'scientific-report-schedule-candidate-v1',
    id: run.id,
    uid: run.userId,
    reportType: run.reportType,
    localDate: run.localDate,
    localStartDate: run.localStartDate,
    scheduledFor: run.scheduledFor,
    expectedScheduleVersion: run.expectedScheduleVersion,
    recipientAuthorityHash: run.recipientAuthorityHash,
  });
  assertReportId(run.reportId);
  normalizeInstant(run.generatedAt, 'Report run generation time');
  normalizeInstant(run.createdAt, 'Report run creation time');
  normalizeInstant(run.updatedAt, 'Report run update time');
  const scheduledEpoch = Date.parse(run.scheduledFor);
  const generatedEpoch = Date.parse(run.generatedAt);
  const createdEpoch = Date.parse(run.createdAt);
  const updatedEpoch = Date.parse(run.updatedAt);
  const temporalCoherence = generatedEpoch === createdEpoch
    && createdEpoch >= scheduledEpoch
    && updatedEpoch >= createdEpoch
    && (run.completedAt === null || Date.parse(run.completedAt) === updatedEpoch)
    && (run.generationClaimExpiresAt === null
      || Date.parse(run.generationClaimExpiresAt) > updatedEpoch)
    && (run.deliveryClaimExpiresAt === null
      || Date.parse(run.deliveryClaimExpiresAt) > updatedEpoch)
    && (run.nextAttemptAt === null || Date.parse(run.nextAttemptAt) > updatedEpoch);
  const archivePair = (run.archiveArtifactHash === null) === (run.archiveMetricHash === null);
  const noGenerationClaim = run.currentGenerationClaimId === null
    && run.generationClaimExpiresAt === null;
  const noDeliveryClaim = run.currentDeliveryClaimId === null
    && run.deliveryClaimExpiresAt === null;
  const commonTerminal = noGenerationClaim && noDeliveryClaim && run.nextAttemptAt === null;
  const coherent = temporalCoherence && archivePair && (
    run.state === 'generating'
      ? run.currentGenerationClaimId !== null
        && run.generationClaimExpiresAt !== null
        && run.archiveArtifactHash === null
        && noDeliveryClaim
        && run.nextAttemptAt === null
        && run.deliveryOutcome === null
        && run.suppressionReason === null
        && run.failureCode === null
        && run.completedAt === null
      : run.state === 'generation_retryable'
        ? noGenerationClaim
          && run.lastGenerationClaimId !== null
          && run.archiveArtifactHash === null
          && noDeliveryClaim
          && run.nextAttemptAt !== null
          && run.deliveryOutcome === null
          && run.suppressionReason === null
          && (run.failureCode === 'source_unavailable' || run.failureCode === 'generation_invalid')
          && run.completedAt === null
        : run.state === 'archived'
          ? commonTerminal
            && run.archiveArtifactHash !== null
            && run.deliveryOutcome === null
            && run.suppressionReason === null
            && run.failureCode === null
            && run.completedAt === null
          : run.state === 'delivery_authorized'
            ? noGenerationClaim
              && run.archiveArtifactHash !== null
              && run.currentDeliveryClaimId !== null
              && run.deliveryClaimExpiresAt !== null
              && run.nextAttemptAt === null
              && run.deliveryOutcome === null
              && run.suppressionReason === null
              && run.failureCode === null
              && run.completedAt === null
            : run.state === 'delivery_retryable'
              ? noGenerationClaim
                && noDeliveryClaim
                && run.lastDeliveryClaimId !== null
                && run.archiveArtifactHash !== null
                && run.nextAttemptAt !== null
                && run.deliveryOutcome === null
                && run.suppressionReason === null
                && (run.failureCode === null
                  || run.failureCode === 'delivery_service_unavailable')
                && run.completedAt === null
              : run.state === 'completed'
                ? commonTerminal
                  && run.archiveArtifactHash !== null
                  && run.lastDeliveryClaimId !== null
                  && run.deliveryOutcome !== null
                  && run.suppressionReason === null
                  && run.failureCode === null
                  && run.completedAt !== null
                : run.state === 'suppressed'
                  ? commonTerminal
                    && run.deliveryOutcome === null
                    && run.suppressionReason !== null
                    && run.failureCode === null
                    && run.completedAt !== null
                  : commonTerminal
                    && run.deliveryOutcome === null
                    && run.suppressionReason === null
                    && run.failureCode !== null
                    && run.completedAt !== null
  );
  if (!coherent) throw new DomainError('INTERNAL', 'Stored report run state is inconsistent.');
}

function completeSnapshots(
  snapshots: readonly (DocumentSnapshot | undefined)[],
  message: string,
): [DocumentSnapshot, DocumentSnapshot, DocumentSnapshot, DocumentSnapshot, DocumentSnapshot] {
  if (snapshots.length !== 5 || snapshots.some((snapshot) => !snapshot)) {
    throw new DomainError('INTERNAL', message);
  }
  return snapshots as [DocumentSnapshot, DocumentSnapshot, DocumentSnapshot, DocumentSnapshot, DocumentSnapshot];
}

function generationClaimId(runId: string, attempt: number, now: string): string {
  return `report_generation_${sha256(`report-generation-v1\0${runId}\0${attempt}\0${now}`).slice(0, 48)}`;
}

function deliveryClaimId(runId: string, attempt: number, now: string): string {
  return `report_delivery_${sha256(`report-delivery-v1\0${runId}\0${attempt}\0${now}`).slice(0, 48)}`;
}

function addMilliseconds(now: string, milliseconds: number): string {
  return new Date(Date.parse(now) + milliseconds).toISOString();
}

function normalizeInstant(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new DomainError('INVALID_ARGUMENT', `${label} is invalid.`);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new DomainError('INVALID_ARGUMENT', `${label} is invalid.`);
  const normalized = new Date(epoch).toISOString();
  if (normalized !== value) throw new DomainError('INVALID_ARGUMENT', `${label} is not normalized.`);
  return normalized;
}

function toTimestamp(value: string): Timestamp {
  return Timestamp.fromDate(new Date(normalizeInstant(value, 'Report run timestamp')));
}

function toNullableTimestamp(value: string | null): Timestamp | null {
  return value === null ? null : toTimestamp(value);
}

function timestampValue(value: unknown, label: string): string {
  if (!(value instanceof Timestamp)) throw new DomainError('INTERNAL', `${label} is invalid.`);
  return value.toDate().toISOString();
}

function nullableTimestampValue(value: unknown, label: string): string | null {
  return value === null ? null : timestampValue(value, label);
}

function assertUid(uid: string): void {
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(uid)) {
    throw new DomainError('UNAUTHENTICATED', 'A verified Firebase identity is required.');
  }
}

function assertRunId(value: string): void {
  if (!RUN_ID_PATTERN.test(value)) throw new DomainError('INVALID_ARGUMENT', 'Report run ID is invalid.');
}

function assertReportId(value: string): void {
  if (!REPORT_ID_PATTERN.test(value)) throw new DomainError('INVALID_ARGUMENT', 'Report ID is invalid.');
}

function assertGenerationClaimId(value: string): void {
  if (!GENERATION_CLAIM_ID_PATTERN.test(value)) {
    throw new DomainError('INVALID_ARGUMENT', 'Report generation claim is invalid.');
  }
}

function assertDeliveryClaimId(value: string): void {
  if (!DELIVERY_CLAIM_ID_PATTERN.test(value)) {
    throw new DomainError('INVALID_ARGUMENT', 'Report delivery claim is invalid.');
  }
}

function assertHash(value: string, label: string): void {
  if (!HASH_PATTERN.test(value)) throw new DomainError('INVALID_ARGUMENT', `${label} is invalid.`);
}

function hashValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new DomainError('INTERNAL', `${label} is invalid.`);
  }
  return value;
}

function nullableHash(value: unknown, label: string): string | null {
  return value === null ? null : hashValue(value, label);
}

function localDateValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DomainError('INTERNAL', `${label} is invalid.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new DomainError('INTERNAL', `${label} is invalid.`);
  }
  return value;
}

function integerValue(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new DomainError('INTERNAL', `${label} is invalid.`);
  }
  return value as number;
}

function reportTypeValue(value: unknown): 'daily' | 'weekly' {
  if (value !== 'daily' && value !== 'weekly') {
    throw new DomainError('INTERNAL', 'Stored report run type is invalid.');
  }
  return value;
}

function reportIdValue(value: unknown): string {
  if (typeof value !== 'string') throw new DomainError('INTERNAL', 'Stored report ID is invalid.');
  assertReportId(value);
  return value;
}

function runStateValue(value: unknown): ScientificReportRunState {
  const states: readonly ScientificReportRunState[] = [
    'generating', 'generation_retryable', 'archived', 'delivery_authorized',
    'delivery_retryable', 'completed', 'suppressed', 'failed',
  ];
  if (!states.includes(value as ScientificReportRunState)) {
    throw new DomainError('INTERNAL', 'Stored report run state is invalid.');
  }
  return value as ScientificReportRunState;
}

function nullableClaimId(
  value: unknown,
  pattern: RegExp,
  label: string,
): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new DomainError('INTERNAL', `${label} is invalid.`);
  }
  return value;
}

function deliveryOutcomeValue(value: unknown): 'accepted' | 'already_sent' | null {
  if (value === null || value === 'accepted' || value === 'already_sent') return value;
  throw new DomainError('INTERNAL', 'Stored report delivery outcome is invalid.');
}

function suppressionReasonValue(
  value: unknown,
): ScientificReportScheduleSuppressionReason | null {
  if (
    value === null
    || value === 'email_disabled'
    || value === 'schedule_disabled'
    || value === 'recipient_changed'
    || value === 'schedule_changed'
    || value === 'outside_catch_up_window'
  ) return value;
  throw new DomainError('INTERNAL', 'Stored report suppression reason is invalid.');
}

function failureCodeValue(value: unknown): ScientificReportRunFailureCode | null {
  const values: readonly ScientificReportRunFailureCode[] = [
    'source_unavailable', 'generation_invalid', 'archive_conflict',
    'generation_attempts_exhausted', 'delivery_service_unavailable',
    'delivery_rejected', 'delivery_uncertain', 'delivery_terminal_failure',
    'delivery_attempts_exhausted', 'archive_missing',
  ];
  if (value === null || values.includes(value as ScientificReportRunFailureCode)) {
    return value as ScientificReportRunFailureCode | null;
  }
  throw new DomainError('INTERNAL', 'Stored report failure code is invalid.');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
