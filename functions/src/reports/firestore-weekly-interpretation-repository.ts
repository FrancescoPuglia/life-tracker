import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { DomainError } from '../domain/errors';
import {
  FirestoreScientificReportArchiveRepository,
  decodeStoredScientificReportArchiveSnapshot,
} from './firestore-archive-repository';
import type { StoredScientificReportArchive } from './archive';
import {
  WEEKLY_INTERPRETATION_CLAIM_LEASE_MS,
  WEEKLY_INTERPRETATION_CONTROL_SCHEMA_VERSION,
  type StoredWeeklyInterpretationControl,
  type WeeklyInterpretationClaimResult,
  type WeeklyInterpretationFailureCode,
  type WeeklyInterpretationRepository,
  type WeeklyInterpretationStableResult,
  type WeeklyInterpretationSkipReason,
  validateWeeklyInterpretationClaimId,
  validateWeeklyStrategicInterpretation,
  weeklyInterpretationProfileHash,
} from './weekly-interpretation';

const CONTROL_COLLECTION = 'reportInterpretations';
const UID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/u;
const REPORT_ID_PATTERN = /^report_[0-9a-f]{56}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;

/** Owner-derived server-only state for one at-most-once weekly interpretation. */
export class FirestoreWeeklyInterpretationRepository
implements WeeklyInterpretationRepository {
  private readonly archives: FirestoreScientificReportArchiveRepository;

  constructor(private readonly firestore: Firestore) {
    this.archives = new FirestoreScientificReportArchiveRepository(firestore);
  }

  async settleSkipped(
    input: Parameters<WeeklyInterpretationRepository['settleSkipped']>[0],
  ): ReturnType<WeeklyInterpretationRepository['settleSkipped']> {
    const authority = prepareAuthority(input.uid, input.archive, input.now);
    assertSkipReason(input.reason);
    return this.firestore.runTransaction(async (transaction) => {
      const archiveRef = this.archiveRef(authority.uid, authority.archive.id);
      const controlRef = this.controlRef(authority.uid, authority.archive.id);
      const snapshots = await transaction.getAll(archiveRef, controlRef);
      const [archiveSnapshot, controlSnapshot] = requireAuthoritySnapshots(
        snapshots[0],
        snapshots[1],
      );
      const archive = requireArchive(authority.uid, archiveSnapshot);
      assertSameArchive(archive, authority.archive);
      if (!controlSnapshot.exists) {
        const control = skippedControl(archive, input.reason, authority.now);
        transaction.create(controlRef, encodeStoredWeeklyInterpretationControl(control));
        return stable(control);
      }
      const control = decodeStoredWeeklyInterpretationControl(authority.uid, archive, controlSnapshot);
      return settleExisting(transaction, controlRef, control, authority.now);
    });
  }

  async claim(
    input: Parameters<WeeklyInterpretationRepository['claim']>[0],
  ): Promise<WeeklyInterpretationClaimResult> {
    const authority = prepareAuthority(input.uid, input.archive, input.now);
    validateWeeklyInterpretationClaimId(input.claimId);
    const profileHash = weeklyInterpretationProfileHash(input.profile);
    return this.firestore.runTransaction(async (transaction) => {
      const archiveRef = this.archiveRef(authority.uid, authority.archive.id);
      const controlRef = this.controlRef(authority.uid, authority.archive.id);
      const snapshots = await transaction.getAll(archiveRef, controlRef);
      const [archiveSnapshot, controlSnapshot] = requireAuthoritySnapshots(
        snapshots[0],
        snapshots[1],
      );
      const archive = requireArchive(authority.uid, archiveSnapshot);
      assertSameArchive(archive, authority.archive);
      if (!controlSnapshot.exists) {
        const control = claimedControl(
          archive,
          profileHash,
          input.claimId,
          authority.now,
        );
        transaction.create(controlRef, encodeStoredWeeklyInterpretationControl(control));
        return Object.freeze({ action: 'generate' as const, claimId: input.claimId });
      }
      const control = decodeStoredWeeklyInterpretationControl(authority.uid, archive, controlSnapshot);
      return settleExisting(transaction, controlRef, control, authority.now);
    });
  }

  async finalizeSuccess(
    input: Parameters<WeeklyInterpretationRepository['finalizeSuccess']>[0],
  ): Promise<WeeklyInterpretationStableResult> {
    return this.finalize(input, null);
  }

  async finalizeFailure(
    input: Parameters<WeeklyInterpretationRepository['finalizeFailure']>[0],
  ): Promise<WeeklyInterpretationStableResult> {
    assertFinalFailureCode(input.failureCode);
    return this.finalize(input, input.failureCode);
  }

  async getControl(
    uid: string,
    reportId: string,
  ): Promise<StoredWeeklyInterpretationControl | null> {
    assertUid(uid);
    assertReportId(reportId);
    const archive = await this.archives.getArchive(uid, reportId);
    if (!archive) return null;
    const snapshot = await this.controlRef(uid, reportId).get();
    return snapshot.exists
      ? decodeStoredWeeklyInterpretationControl(uid, archive, snapshot)
      : null;
  }

  private async finalize(
    input: Parameters<WeeklyInterpretationRepository['finalizeSuccess']>[0]
      | Parameters<WeeklyInterpretationRepository['finalizeFailure']>[0],
    failureCode: Exclude<WeeklyInterpretationFailureCode, 'provider_result_uncertain'> | null,
  ): Promise<WeeklyInterpretationStableResult> {
    const authority = prepareAuthority(input.uid, input.archive, input.now);
    validateWeeklyInterpretationClaimId(input.claimId);
    return this.firestore.runTransaction(async (transaction) => {
      const archiveRef = this.archiveRef(authority.uid, authority.archive.id);
      const controlRef = this.controlRef(authority.uid, authority.archive.id);
      const snapshots = await transaction.getAll(archiveRef, controlRef);
      const [archiveSnapshot, controlSnapshot] = requireAuthoritySnapshots(
        snapshots[0],
        snapshots[1],
      );
      const archive = requireArchive(authority.uid, archiveSnapshot);
      assertSameArchive(archive, authority.archive);
      if (!controlSnapshot.exists) {
        throw new DomainError('CONFLICT', 'Weekly interpretation claim is unavailable.');
      }
      const control = decodeStoredWeeklyInterpretationControl(authority.uid, archive, controlSnapshot);
      if (control.state !== 'claimed' || control.claimId !== input.claimId) {
        if (control.state === 'complete' || control.state === 'failed' || control.state === 'uncertain') {
          return stable(control);
        }
        throw new DomainError('CONFLICT', 'Weekly interpretation is no longer claimed.');
      }
      const interpretation = failureCode === null
        ? validateWeeklyStrategicInterpretation(
          authority.uid,
          archive,
          (input as Parameters<WeeklyInterpretationRepository['finalizeSuccess']>[0]).interpretation,
        )
        : null;
      if (
        interpretation
        && control.profileHash !== weeklyInterpretationProfileHash(profileFrom(interpretation))
      ) {
        throw new DomainError('CONFLICT', 'Weekly interpretation profile changed after claim.');
      }
      const updated: StoredWeeklyInterpretationControl = Object.freeze({
        ...control,
        state: interpretation ? 'complete' : 'failed',
        claimId: null,
        claimExpiresAt: null,
        failureCode,
        interpretation,
        updatedAt: authority.now,
      });
      transaction.update(controlRef, encodeStoredWeeklyInterpretationControl(updated));
      return stable(updated);
    });
  }

  private archiveRef(uid: string, reportId: string) {
    assertUid(uid);
    assertReportId(reportId);
    return this.firestore.doc(`users/${uid}/reportArchives/${reportId}`);
  }

  private controlRef(uid: string, reportId: string) {
    assertUid(uid);
    assertReportId(reportId);
    return this.firestore.doc(`users/${uid}/${CONTROL_COLLECTION}/${reportId}`);
  }
}

export function encodeStoredWeeklyInterpretationControl(
  control: StoredWeeklyInterpretationControl,
) {
  return {
    schemaVersion: control.schemaVersion,
    id: control.id,
    userId: control.userId,
    reportId: control.reportId,
    reportArtifactHash: control.reportArtifactHash,
    metricHash: control.metricHash,
    state: control.state,
    attemptCount: control.attemptCount,
    profileHash: control.profileHash,
    claimId: control.claimId,
    claimExpiresAt: control.claimExpiresAt
      ? Timestamp.fromDate(new Date(control.claimExpiresAt))
      : null,
    skipReason: control.skipReason,
    failureCode: control.failureCode,
    interpretation: control.interpretation,
    createdAt: Timestamp.fromDate(new Date(control.createdAt)),
    updatedAt: Timestamp.fromDate(new Date(control.updatedAt)),
  };
}

export function decodeStoredWeeklyInterpretationControl(
  uid: string,
  archive: StoredScientificReportArchive,
  snapshot: FirebaseFirestore.DocumentSnapshot,
): StoredWeeklyInterpretationControl {
  assertUid(uid);
  assertSameArchive(archive, archive);
  const value = snapshot.data() ?? {};
  const keys = [
    'attemptCount', 'claimExpiresAt', 'claimId', 'createdAt', 'failureCode', 'id',
    'interpretation', 'metricHash', 'profileHash', 'reportArtifactHash', 'reportId',
    'schemaVersion', 'skipReason', 'state', 'updatedAt', 'userId',
  ];
  if (
    Object.keys(value).sort().join(',') !== keys.sort().join(',')
    || snapshot.id !== archive.id
    || value.schemaVersion !== WEEKLY_INTERPRETATION_CONTROL_SCHEMA_VERSION
    || value.id !== archive.id
    || value.userId !== uid
    || value.reportId !== archive.id
    || value.reportArtifactHash !== archive.artifactHash
    || value.metricHash !== archive.metricHash
  ) {
    throw new DomainError('INTERNAL', 'Stored weekly interpretation identity is invalid.');
  }
  const createdAt = timestampValue(value.createdAt, 'creation time');
  const updatedAt = timestampValue(value.updatedAt, 'update time');
  const claimExpiresAt = value.claimExpiresAt === null
    ? null
    : timestampValue(value.claimExpiresAt, 'claim expiry');
  const control: StoredWeeklyInterpretationControl = Object.freeze({
    schemaVersion: WEEKLY_INTERPRETATION_CONTROL_SCHEMA_VERSION,
    id: archive.id,
    userId: uid,
    reportId: archive.id,
    reportArtifactHash: archive.artifactHash,
    metricHash: archive.metricHash,
    state: value.state as StoredWeeklyInterpretationControl['state'],
    attemptCount: value.attemptCount as 0 | 1,
    profileHash: nullableHash(value.profileHash),
    claimId: nullableClaimId(value.claimId),
    claimExpiresAt,
    skipReason: nullableSkipReason(value.skipReason),
    failureCode: nullableFailureCode(value.failureCode),
    interpretation: value.interpretation === null
      ? null
      : validateWeeklyStrategicInterpretation(uid, archive, value.interpretation),
    createdAt,
    updatedAt,
  });
  validateControlState(control);
  return control;
}

function prepareAuthority(
  uid: string,
  archive: StoredScientificReportArchive,
  now: string,
) {
  assertUid(uid);
  assertSameArchive(archive, archive);
  return Object.freeze({ uid, archive, now: normalizedInstant(now, 'operation time') });
}

function requireArchive(
  uid: string,
  snapshot: FirebaseFirestore.DocumentSnapshot | undefined,
): StoredScientificReportArchive {
  if (!snapshot?.exists) {
    throw new DomainError('NOT_FOUND', 'Scientific report archive was not found.');
  }
  return decodeStoredScientificReportArchiveSnapshot(uid, snapshot);
}

function assertSameArchive(
  actual: StoredScientificReportArchive,
  expected: StoredScientificReportArchive,
): void {
  if (
    !actual
    || actual.type !== 'weekly'
    || actual.id !== expected.id
    || actual.userId !== expected.userId
    || actual.artifactHash !== expected.artifactHash
    || actual.metricHash !== expected.metricHash
  ) {
    throw new DomainError('CONFLICT', 'Weekly interpretation archive authority changed.');
  }
}

function skippedControl(
  archive: StoredScientificReportArchive,
  reason: WeeklyInterpretationSkipReason,
  now: string,
): StoredWeeklyInterpretationControl {
  if (reason !== 'routing_disabled' && reason !== 'routing_invalid') {
    throw new DomainError('INVALID_ARGUMENT', 'Weekly interpretation skip reason is invalid.');
  }
  return Object.freeze({
    schemaVersion: WEEKLY_INTERPRETATION_CONTROL_SCHEMA_VERSION,
    id: archive.id,
    userId: archive.userId,
    reportId: archive.id,
    reportArtifactHash: archive.artifactHash,
    metricHash: archive.metricHash,
    state: 'skipped',
    attemptCount: 0,
    profileHash: null,
    claimId: null,
    claimExpiresAt: null,
    skipReason: reason,
    failureCode: null,
    interpretation: null,
    createdAt: now,
    updatedAt: now,
  });
}

function claimedControl(
  archive: StoredScientificReportArchive,
  profileHash: string,
  claimId: string,
  now: string,
): StoredWeeklyInterpretationControl {
  return Object.freeze({
    schemaVersion: WEEKLY_INTERPRETATION_CONTROL_SCHEMA_VERSION,
    id: archive.id,
    userId: archive.userId,
    reportId: archive.id,
    reportArtifactHash: archive.artifactHash,
    metricHash: archive.metricHash,
    state: 'claimed',
    attemptCount: 1,
    profileHash,
    claimId,
    claimExpiresAt: new Date(Date.parse(now) + WEEKLY_INTERPRETATION_CLAIM_LEASE_MS).toISOString(),
    skipReason: null,
    failureCode: null,
    interpretation: null,
    createdAt: now,
    updatedAt: now,
  });
}

function settleExisting(
  transaction: FirebaseFirestore.Transaction,
  controlRef: FirebaseFirestore.DocumentReference,
  control: StoredWeeklyInterpretationControl,
  now: string,
): WeeklyInterpretationStableResult | Readonly<{ action: 'retry_later'; notBefore: string }> {
  if (control.state !== 'claimed') return stable(control);
  if (!control.claimExpiresAt) {
    throw new DomainError('INTERNAL', 'Weekly interpretation claim expiry is unavailable.');
  }
  if (Date.parse(control.claimExpiresAt) > Date.parse(now)) {
    return Object.freeze({ action: 'retry_later', notBefore: control.claimExpiresAt });
  }
  const uncertain: StoredWeeklyInterpretationControl = Object.freeze({
    ...control,
    state: 'uncertain',
    claimId: null,
    claimExpiresAt: null,
    failureCode: 'provider_result_uncertain',
    updatedAt: now,
  });
  transaction.update(controlRef, encodeStoredWeeklyInterpretationControl(uncertain));
  return stable(uncertain);
}

function requireAuthoritySnapshots(
  archive: FirebaseFirestore.DocumentSnapshot | undefined,
  control: FirebaseFirestore.DocumentSnapshot | undefined,
): readonly [FirebaseFirestore.DocumentSnapshot, FirebaseFirestore.DocumentSnapshot] {
  if (!archive || !control) {
    throw new DomainError('INTERNAL', 'Weekly interpretation authority read is incomplete.');
  }
  return [archive, control];
}

function stable(control: StoredWeeklyInterpretationControl): WeeklyInterpretationStableResult {
  if (control.state === 'claimed') {
    throw new DomainError('INTERNAL', 'Weekly interpretation has not settled.');
  }
  return Object.freeze({
    action: 'stable',
    interpretation: control.interpretation,
    state: control.state,
  });
}

function validateControlState(control: StoredWeeklyInterpretationControl): void {
  const timeOrder = Date.parse(control.updatedAt) >= Date.parse(control.createdAt);
  const coherent = control.state === 'skipped'
    ? control.attemptCount === 0
      && control.profileHash === null
      && control.claimId === null
      && control.claimExpiresAt === null
      && control.skipReason !== null
      && control.failureCode === null
      && control.interpretation === null
    : control.state === 'claimed'
      ? control.attemptCount === 1
        && control.profileHash !== null
        && control.claimId !== null
        && control.claimExpiresAt !== null
        && control.skipReason === null
        && control.failureCode === null
        && control.interpretation === null
      : control.state === 'complete'
        ? control.attemptCount === 1
          && control.profileHash !== null
          && control.claimId === null
          && control.claimExpiresAt === null
          && control.skipReason === null
          && control.failureCode === null
          && control.interpretation !== null
          && control.profileHash === weeklyInterpretationProfileHash(profileFrom(control.interpretation))
        : control.state === 'failed'
          ? control.attemptCount === 1
            && control.profileHash !== null
            && control.claimId === null
            && control.claimExpiresAt === null
            && control.skipReason === null
            && (control.failureCode === 'provider_unavailable'
              || control.failureCode === 'provider_invalid')
            && control.interpretation === null
          : control.state === 'uncertain'
            && control.attemptCount === 1
            && control.profileHash !== null
            && control.claimId === null
            && control.claimExpiresAt === null
            && control.skipReason === null
            && control.failureCode === 'provider_result_uncertain'
            && control.interpretation === null;
  if (!timeOrder || !coherent) {
    throw new DomainError('INTERNAL', 'Stored weekly interpretation state is inconsistent.');
  }
}

function profileFrom(interpretation: NonNullable<StoredWeeklyInterpretationControl['interpretation']>) {
  return {
    workload: 'weekly_strategic_review' as const,
    model: interpretation.model,
    reasoningEffort: interpretation.reasoningEffort as 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max',
    timeoutMs: 20_000,
    maxTurns: 1,
    maxToolCalls: 0,
    maxOutputTokens: 900,
    maxTotalToolOutputBytes: 0,
    routingConfigId: interpretation.routingConfigId,
    evaluationReceiptId: interpretation.evaluationReceiptId,
  };
}

function timestampValue(value: unknown, label: string): string {
  if (!(value instanceof Timestamp)) {
    throw new DomainError('INTERNAL', `Stored weekly interpretation ${label} is invalid.`);
  }
  return value.toDate().toISOString();
}

function nullableHash(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new DomainError('INTERNAL', 'Stored weekly interpretation profile hash is invalid.');
  }
  return value;
}

function nullableClaimId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new DomainError('INTERNAL', 'Stored weekly interpretation claim ID is invalid.');
  }
  validateWeeklyInterpretationClaimId(value);
  return value;
}

function nullableSkipReason(value: unknown): WeeklyInterpretationSkipReason | null {
  if (value === null) return null;
  if (value !== 'routing_disabled' && value !== 'routing_invalid') {
    throw new DomainError('INTERNAL', 'Stored weekly interpretation skip reason is invalid.');
  }
  return value;
}

function assertSkipReason(value: unknown): asserts value is WeeklyInterpretationSkipReason {
  if (value !== 'routing_disabled' && value !== 'routing_invalid') {
    throw new DomainError('INVALID_ARGUMENT', 'Weekly interpretation skip reason is invalid.');
  }
}

function assertFinalFailureCode(
  value: unknown,
): asserts value is Exclude<WeeklyInterpretationFailureCode, 'provider_result_uncertain'> {
  if (value !== 'provider_unavailable' && value !== 'provider_invalid') {
    throw new DomainError('INVALID_ARGUMENT', 'Weekly interpretation failure code is invalid.');
  }
}

function nullableFailureCode(value: unknown): WeeklyInterpretationFailureCode | null {
  if (value === null) return null;
  if (
    value !== 'provider_unavailable'
    && value !== 'provider_invalid'
    && value !== 'provider_result_uncertain'
  ) {
    throw new DomainError('INTERNAL', 'Stored weekly interpretation failure code is invalid.');
  }
  return value;
}

function normalizedInstant(value: string, label: string): string {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    throw new DomainError('INVALID_ARGUMENT', `Weekly interpretation ${label} is invalid.`);
  }
  return value;
}

function assertUid(uid: string): void {
  if (!UID_PATTERN.test(uid)) {
    throw new DomainError('INVALID_ARGUMENT', 'Weekly interpretation owner is invalid.');
  }
}

function assertReportId(reportId: string): void {
  if (!REPORT_ID_PATTERN.test(reportId)) {
    throw new DomainError('INVALID_ARGUMENT', 'Weekly interpretation report ID is invalid.');
  }
}
