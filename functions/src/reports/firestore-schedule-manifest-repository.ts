import { canonicalJson } from '../domain/integrity';
import { DomainError } from '../domain/errors';
import {
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { deriveFirestoreScientificReportSchedulePolicy } from './firestore-schedule-authority';
import type { ScientificReportRunServiceResult } from './report-run';
import {
  REPORT_SCHEDULE_MANIFEST_MAX_RUNTIME_FAILURES,
  REPORT_SCHEDULE_MANIFEST_SCHEMA_VERSION,
  type BoundedScientificReportScheduleTargetBatch,
  type LoadDueScientificReportScheduleResult,
  type RecordScientificReportScheduleResult,
  type ScientificReportScheduleManifestRepository,
  type ScientificReportScheduleManifestResultCode,
  type ScientificReportScheduleTarget,
  type StoredScientificReportScheduleManifest,
} from './schedule-manifest';
import {
  authorizeScientificReportScheduleCandidate,
  nextScientificReportScheduleCandidate,
  planDueScientificReportRuns,
  scientificReportScheduleCandidateForPeriod,
  type ScientificReportScheduleCandidate,
  type ScientificReportSchedulePolicy,
  validateScientificReportScheduleCandidate,
} from './scheduling';
import type { ScientificReportType } from './types';

const MANIFEST_COLLECTION = 'reportScheduleManifests';
const MAXIMUM_DUE_QUERY = 20;
const RUNTIME_FAILURE_BACKOFF_MS = 5 * 60_000;

/**
 * Server-only schedule manifests. Queryable state contains timing and one-way
 * authority only; the current mailbox remains in the preference transaction.
 */
export class FirestoreScientificReportScheduleManifestRepository
implements ScientificReportScheduleManifestRepository {
  constructor(private readonly firestore: Firestore) {}

  async reconcileOwner(
    uid: string,
    now: string,
  ): Promise<Readonly<{ activeCount: number }>> {
    assertUid(uid);
    const timestamp = normalizeInstant(now, 'Report manifest reconciliation time');
    return this.firestore.runTransaction(async (transaction) => {
      const refs = this.refs(uid);
      const snapshots = await transaction.getAll(
        refs.user,
        refs.preferences,
        refs.daily,
        refs.weekly,
      );
      const [userSnapshot, preferenceSnapshot, dailySnapshot, weeklySnapshot]
        = completeSnapshots(snapshots, 'Report manifest authority read is incomplete.');
      const policy = deriveFirestoreScientificReportSchedulePolicy(
        uid,
        userSnapshot,
        preferenceSnapshot,
      );
      let activeCount = 0;
      for (const [reportType, snapshot] of [
        ['daily', dailySnapshot],
        ['weekly', weeklySnapshot],
      ] as const) {
        const current = safeDecodeManifest(uid, reportType, snapshot);
        const desired = reconciledManifest(current, policy, reportType, timestamp);
        if (desired.state === 'active') activeCount += 1;
        if (!current || canonicalJson(current) !== canonicalJson(desired)) {
          transaction.set(snapshot.ref, encodeStoredScientificReportScheduleManifest(desired));
        }
      }
      return Object.freeze({ activeCount });
    });
  }

  async listDue(
    uid: string,
    now: string,
    maximum: number,
  ): Promise<BoundedScientificReportScheduleTargetBatch> {
    assertUid(uid);
    const timestamp = normalizeInstant(now, 'Due report query time');
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > MAXIMUM_DUE_QUERY) {
      throw new DomainError('INVALID_ARGUMENT', 'Due report query limit is invalid.');
    }
    const snapshot = await this.firestore.collectionGroup(MANIFEST_COLLECTION)
      .where('userId', '==', uid)
      .where('state', '==', 'active')
      .where('availableAt', '<=', Timestamp.fromDate(new Date(timestamp)))
      .orderBy('availableAt', 'asc')
      .orderBy('reportType', 'asc')
      .limit(maximum + 1)
      .get();
    const selected = snapshot.docs.slice(0, maximum);
    return Object.freeze({
      targets: Object.freeze(selected.map((document) => manifestTarget(uid, document))),
      overflow: snapshot.size > maximum,
    });
  }

  async loadDueCandidate(
    target: ScientificReportScheduleTarget,
    now: string,
  ): Promise<LoadDueScientificReportScheduleResult> {
    validateTarget(target);
    const timestamp = normalizeInstant(now, 'Due report authority time');
    return this.firestore.runTransaction(async (transaction) => {
      const refs = this.refs(target.uid);
      const manifestRef = refs[target.reportType];
      const snapshots = await transaction.getAll(
        manifestRef,
        refs.user,
        refs.preferences,
      );
      const [manifestSnapshot, userSnapshot, preferenceSnapshot] = completeThree(
        snapshots,
        'Due report authority read is incomplete.',
      );
      const policy = deriveFirestoreScientificReportSchedulePolicy(
        target.uid,
        userSnapshot,
        preferenceSnapshot,
      );
      const stored = safeDecodeManifest(target.uid, target.reportType, manifestSnapshot);
      const desiredCandidate = desiredCandidateForManifest(
        stored,
        policy,
        target.reportType,
        timestamp,
      );
      if (!stored) {
        transaction.set(manifestRef, encodeStoredScientificReportScheduleManifest(
          manifestForCandidate(null, target.uid, target.reportType, desiredCandidate, timestamp),
        ));
        return Object.freeze({ action: 'no_op' });
      }
      if (
        !desiredCandidate
        || stored.state !== 'active'
        || !stored.candidate
        || !sameCandidate(stored.candidate, desiredCandidate)
      ) {
        const reconciled = manifestForCandidate(
          stored,
          target.uid,
          target.reportType,
          desiredCandidate,
          timestamp,
        );
        if (canonicalJson(stored) !== canonicalJson(reconciled)) {
          transaction.set(manifestRef, encodeStoredScientificReportScheduleManifest(reconciled));
        }
        return Object.freeze({ action: 'no_op' });
      }
      if (!stored.availableAt || Date.parse(stored.availableAt) > Date.parse(timestamp)) {
        return Object.freeze({ action: 'no_op' });
      }
      const authorization = authorizeScientificReportScheduleCandidate(policy, stored.candidate);
      if (authorization.action !== 'allow') {
        transaction.set(manifestRef, encodeStoredScientificReportScheduleManifest(
          manifestForCandidate(
            stored,
            target.uid,
            target.reportType,
            desiredCandidate,
            timestamp,
          ),
        ));
        return Object.freeze({ action: 'no_op' });
      }
      return Object.freeze({ action: 'execute', candidate: stored.candidate });
    });
  }

  async recordRunResult(input: Readonly<{
    target: ScientificReportScheduleTarget;
    candidate: ScientificReportScheduleCandidate;
    result: ScientificReportRunServiceResult;
    now: string;
  }>): Promise<RecordScientificReportScheduleResult> {
    validateTarget(input.target);
    validateCandidateForTarget(input.target, input.candidate);
    const timestamp = normalizeInstant(input.now, 'Report schedule result time');
    return this.firestore.runTransaction(async (transaction) => {
      const refs = this.refs(input.target.uid);
      const manifestRef = refs[input.target.reportType];
      const snapshots = await transaction.getAll(
        manifestRef,
        refs.user,
        refs.preferences,
      );
      const [manifestSnapshot, userSnapshot, preferenceSnapshot] = completeThree(
        snapshots,
        'Report schedule result authority read is incomplete.',
      );
      const policy = deriveFirestoreScientificReportSchedulePolicy(
        input.target.uid,
        userSnapshot,
        preferenceSnapshot,
      );
      const stored = safeDecodeManifest(
        input.target.uid,
        input.target.reportType,
        manifestSnapshot,
      );
      if (!stored || stored.state !== 'active' || !stored.candidate) {
        return Object.freeze({ action: 'no_op' });
      }
      if (!sameCandidate(stored.candidate, input.candidate)) {
        return Object.freeze({ action: 'no_op' });
      }
      assertTransitionTime(stored, timestamp);

      if (input.result.outcome === 'retry_later') {
        const notBefore = normalizeInstant(input.result.notBefore, 'Report schedule retry time');
        if (Date.parse(notBefore) <= Date.parse(timestamp)) {
          throw new DomainError('INTERNAL', 'Report schedule retry time is not in the future.');
        }
        const current = desiredCandidateForManifest(
          stored,
          policy,
          input.target.reportType,
          timestamp,
        );
        if (!current || !sameCandidate(current, input.candidate)) {
          transaction.set(manifestRef, encodeStoredScientificReportScheduleManifest(
            manifestForCandidate(
              stored,
              input.target.uid,
              input.target.reportType,
              current,
              timestamp,
            ),
          ));
          return Object.freeze({ action: 'advanced' });
        }
        transaction.set(manifestRef, encodeStoredScientificReportScheduleManifest(Object.freeze({
          ...stored,
          availableAt: notBefore,
          runtimeFailureCount: 0,
          lastResultCode: 'retry_scheduled',
          updatedAt: timestamp,
        })));
        return Object.freeze({ action: 'retry_scheduled' });
      }

      const advanced = advancedManifest(
        stored,
        policy,
        input.candidate,
        timestamp,
        resultCode(input.result),
      );
      transaction.set(manifestRef, encodeStoredScientificReportScheduleManifest(advanced));
      return Object.freeze({ action: 'advanced' });
    });
  }

  async recordInvocationFailure(input: Readonly<{
    target: ScientificReportScheduleTarget;
    candidate: ScientificReportScheduleCandidate;
    now: string;
  }>): Promise<RecordScientificReportScheduleResult> {
    validateTarget(input.target);
    validateCandidateForTarget(input.target, input.candidate);
    const timestamp = normalizeInstant(input.now, 'Report runtime failure time');
    return this.firestore.runTransaction(async (transaction) => {
      const refs = this.refs(input.target.uid);
      const manifestRef = refs[input.target.reportType];
      const snapshots = await transaction.getAll(
        manifestRef,
        refs.user,
        refs.preferences,
      );
      const [manifestSnapshot, userSnapshot, preferenceSnapshot] = completeThree(
        snapshots,
        'Report runtime failure authority read is incomplete.',
      );
      const policy = deriveFirestoreScientificReportSchedulePolicy(
        input.target.uid,
        userSnapshot,
        preferenceSnapshot,
      );
      const stored = safeDecodeManifest(
        input.target.uid,
        input.target.reportType,
        manifestSnapshot,
      );
      if (
        !stored
        || stored.state !== 'active'
        || !stored.candidate
        || !sameCandidate(stored.candidate, input.candidate)
      ) {
        return Object.freeze({ action: 'no_op' });
      }
      assertTransitionTime(stored, timestamp);
      const current = desiredCandidateForManifest(
        stored,
        policy,
        input.target.reportType,
        timestamp,
      );
      if (!current || !sameCandidate(current, input.candidate)) {
        transaction.set(manifestRef, encodeStoredScientificReportScheduleManifest(
          manifestForCandidate(
            stored,
            input.target.uid,
            input.target.reportType,
            current,
            timestamp,
          ),
        ));
        return Object.freeze({ action: 'advanced' });
      }

      const failureCount = stored.runtimeFailureCount + 1;
      if (failureCount >= REPORT_SCHEDULE_MANIFEST_MAX_RUNTIME_FAILURES) {
        transaction.set(manifestRef, encodeStoredScientificReportScheduleManifest(
          advancedManifest(
            stored,
            policy,
            input.candidate,
            timestamp,
            'runtime_attempts_exhausted',
          ),
        ));
        return Object.freeze({ action: 'advanced' });
      }
      const availableAt = addMilliseconds(
        timestamp,
        RUNTIME_FAILURE_BACKOFF_MS * failureCount,
      );
      transaction.set(manifestRef, encodeStoredScientificReportScheduleManifest(Object.freeze({
        ...stored,
        availableAt,
        runtimeFailureCount: failureCount,
        lastResultCode: 'runtime_unavailable',
        updatedAt: timestamp,
      })));
      return Object.freeze({ action: 'retry_scheduled' });
    });
  }

  private refs(uid: string) {
    assertUid(uid);
    const collection = this.firestore.collection(`users/${uid}/${MANIFEST_COLLECTION}`);
    return {
      user: this.firestore.doc(`users/${uid}`),
      preferences: this.firestore.doc(`users/${uid}/notificationPreferences/default`),
      daily: collection.doc('daily'),
      weekly: collection.doc('weekly'),
    } as const;
  }
}

function reconciledManifest(
  current: StoredScientificReportScheduleManifest | null,
  policy: ScientificReportSchedulePolicy,
  reportType: ScientificReportType,
  now: string,
): StoredScientificReportScheduleManifest {
  const candidate = desiredCandidateForManifest(current, policy, reportType, now);
  if (
    current?.state === 'active'
    && current.candidate
    && candidate
    && sameCandidate(current.candidate, candidate)
  ) return current;
  if (current?.state === 'disabled' && candidate === null) return current;
  return manifestForCandidate(current, policy.uid, reportType, candidate, now);
}

function manifestForCandidate(
  current: StoredScientificReportScheduleManifest | null,
  uid: string,
  reportType: ScientificReportType,
  candidate: ScientificReportScheduleCandidate | null,
  now: string,
  lastResultCode: ScientificReportScheduleManifestResultCode = 'authority_reconciled',
): StoredScientificReportScheduleManifest {
  if (candidate) validateCandidateForTarget({ uid, reportType }, candidate);
  if (current) assertTransitionTime(current, now);
  return Object.freeze({
    schemaVersion: REPORT_SCHEDULE_MANIFEST_SCHEMA_VERSION,
    id: reportType,
    userId: uid,
    reportType,
    state: candidate ? 'active' : 'disabled',
    candidate,
    availableAt: candidate ? candidate.scheduledFor : null,
    runtimeFailureCount: 0,
    lastResultCode,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  });
}

function advancedManifest(
  current: StoredScientificReportScheduleManifest,
  policy: ScientificReportSchedulePolicy,
  processed: ScientificReportScheduleCandidate,
  now: string,
  resultCodeValue: ScientificReportScheduleManifestResultCode,
): StoredScientificReportScheduleManifest {
  const due = currentCandidate(policy, processed.reportType, now);
  if (!due) {
    return manifestForCandidate(
      current,
      policy.uid,
      processed.reportType,
      null,
      now,
      resultCodeValue,
    );
  }
  const next = due.localStartDate > processed.localStartDate
    ? due
    : nextScientificReportScheduleCandidate(policy, processed);
  return manifestForCandidate(
    current,
    policy.uid,
    processed.reportType,
    next,
    now,
    resultCodeValue,
  );
}

function currentCandidate(
  policy: ScientificReportSchedulePolicy,
  reportType: ScientificReportType,
  now: string,
): ScientificReportScheduleCandidate | null {
  return planDueScientificReportRuns(policy, now)
    .find((candidate) => candidate.reportType === reportType) ?? null;
}

function desiredCandidateForManifest(
  current: StoredScientificReportScheduleManifest | null,
  policy: ScientificReportSchedulePolicy,
  reportType: ScientificReportType,
  now: string,
): ScientificReportScheduleCandidate | null {
  const due = currentCandidate(policy, reportType, now);
  if (current?.state !== 'active' || !current.candidate) return due;
  const schedule = reportType === 'daily' ? policy.dailyReport : policy.weeklyReport;
  if (!policy.emailEnabled || !policy.recipient || !schedule.enabled) return null;
  const mapped = scientificReportScheduleCandidateForPeriod(
    policy,
    reportType,
    current.candidate.localStartDate,
  );
  if (!due || mapped.localStartDate >= due.localStartDate) return mapped;
  return due;
}

function resultCode(
  result: ScientificReportRunServiceResult,
): ScientificReportScheduleManifestResultCode {
  if (result.outcome === 'completed') return 'completed';
  if (result.outcome === 'failed') return 'run_failed';
  return 'no_op';
}

function manifestTarget(
  uid: string,
  snapshot: QueryDocumentSnapshot,
): ScientificReportScheduleTarget {
  const segments = snapshot.ref.path.split('/');
  const value = snapshot.data();
  if (
    segments.length !== 4
    || segments[0] !== 'users'
    || segments[1] !== uid
    || segments[2] !== MANIFEST_COLLECTION
    || (segments[3] !== 'daily' && segments[3] !== 'weekly')
    || value.userId !== uid
    || value.reportType !== segments[3]
    || value.state !== 'active'
    || !(value.availableAt instanceof Timestamp)
  ) {
    throw new DomainError('INTERNAL', 'Due report manifest identity is invalid.');
  }
  return Object.freeze({ uid, reportType: segments[3] });
}

function safeDecodeManifest(
  uid: string,
  reportType: ScientificReportType,
  snapshot: DocumentSnapshot,
): StoredScientificReportScheduleManifest | null {
  if (!snapshot.exists) return null;
  try {
    return decodeStoredScientificReportScheduleManifest(uid, reportType, snapshot);
  } catch {
    return null;
  }
}

/** @internal Exact server-owned decoder used by emulator assertions. */
export function decodeStoredScientificReportScheduleManifest(
  uid: string,
  reportType: ScientificReportType,
  snapshot: DocumentSnapshot,
): StoredScientificReportScheduleManifest {
  assertUid(uid);
  assertReportType(reportType);
  const value = snapshot.data() ?? {};
  const keys = [
    'availableAt', 'candidate', 'createdAt', 'id', 'lastResultCode',
    'reportType', 'runtimeFailureCount', 'schemaVersion', 'state', 'updatedAt', 'userId',
  ];
  if (
    Object.keys(value).sort().join(',') !== keys.sort().join(',')
    || snapshot.id !== reportType
    || value.schemaVersion !== REPORT_SCHEDULE_MANIFEST_SCHEMA_VERSION
    || value.id !== reportType
    || value.userId !== uid
    || value.reportType !== reportType
  ) {
    throw new DomainError('INTERNAL', 'Stored report manifest identity or schema is invalid.');
  }
  const state = value.state;
  if (state !== 'active' && state !== 'disabled') {
    throw new DomainError('INTERNAL', 'Stored report manifest state is invalid.');
  }
  const candidate = value.candidate === null
    ? null
    : decodeCandidate(value.candidate, uid, reportType);
  const manifest: StoredScientificReportScheduleManifest = Object.freeze({
    schemaVersion: REPORT_SCHEDULE_MANIFEST_SCHEMA_VERSION,
    id: reportType,
    userId: uid,
    reportType,
    state,
    candidate,
    availableAt: nullableTimestamp(value.availableAt, 'Stored report availability'),
    runtimeFailureCount: integerValue(
      value.runtimeFailureCount,
      0,
      REPORT_SCHEDULE_MANIFEST_MAX_RUNTIME_FAILURES - 1,
      'Stored report runtime failure count',
    ),
    lastResultCode: manifestResultCode(value.lastResultCode),
    createdAt: timestampValue(value.createdAt, 'Stored report manifest creation time'),
    updatedAt: timestampValue(value.updatedAt, 'Stored report manifest update time'),
  });
  assertManifestCoherence(manifest);
  return manifest;
}

/** @internal Exact server-owned encoder; candidate authority has no mailbox. */
export function encodeStoredScientificReportScheduleManifest(
  manifest: StoredScientificReportScheduleManifest,
): DocumentData {
  assertManifestCoherence(manifest);
  return {
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    userId: manifest.userId,
    reportType: manifest.reportType,
    state: manifest.state,
    candidate: manifest.candidate ? encodeCandidate(manifest.candidate) : null,
    availableAt: manifest.availableAt ? toTimestamp(manifest.availableAt) : null,
    runtimeFailureCount: manifest.runtimeFailureCount,
    lastResultCode: manifest.lastResultCode,
    createdAt: toTimestamp(manifest.createdAt),
    updatedAt: toTimestamp(manifest.updatedAt),
  };
}

function encodeCandidate(candidate: ScientificReportScheduleCandidate): DocumentData {
  validateScientificReportScheduleCandidate(candidate);
  return {
    schemaVersion: candidate.schemaVersion,
    id: candidate.id,
    uid: candidate.uid,
    reportType: candidate.reportType,
    localDate: candidate.localDate,
    localStartDate: candidate.localStartDate,
    scheduledFor: toTimestamp(candidate.scheduledFor),
    expectedScheduleVersion: candidate.expectedScheduleVersion,
    recipientAuthorityHash: candidate.recipientAuthorityHash,
  };
}

function decodeCandidate(
  input: unknown,
  uid: string,
  reportType: ScientificReportType,
): ScientificReportScheduleCandidate {
  const value = plainRecord(input, 'Stored report manifest candidate');
  const keys = [
    'expectedScheduleVersion', 'id', 'localDate', 'localStartDate',
    'recipientAuthorityHash', 'reportType', 'scheduledFor', 'schemaVersion', 'uid',
  ];
  if (Object.keys(value).sort().join(',') !== keys.sort().join(',')) {
    throw new DomainError('INTERNAL', 'Stored report manifest candidate is invalid.');
  }
  const candidate = validateScientificReportScheduleCandidate({
    schemaVersion: value.schemaVersion as ScientificReportScheduleCandidate['schemaVersion'],
    id: stringValue(value.id, 'Stored report candidate ID'),
    uid: stringValue(value.uid, 'Stored report candidate owner'),
    reportType: reportTypeValue(value.reportType),
    localDate: stringValue(value.localDate, 'Stored report candidate date'),
    localStartDate: stringValue(value.localStartDate, 'Stored report candidate period'),
    scheduledFor: timestampValue(value.scheduledFor, 'Stored report candidate schedule'),
    expectedScheduleVersion: stringValue(
      value.expectedScheduleVersion,
      'Stored report candidate schedule authority',
    ),
    recipientAuthorityHash: stringValue(
      value.recipientAuthorityHash,
      'Stored report candidate recipient authority',
    ),
  });
  validateCandidateForTarget({ uid, reportType }, candidate);
  return candidate;
}

function assertManifestCoherence(manifest: StoredScientificReportScheduleManifest): void {
  assertUid(manifest.userId);
  assertReportType(manifest.reportType);
  if (manifest.id !== manifest.reportType) {
    throw new DomainError('INTERNAL', 'Stored report manifest identity is inconsistent.');
  }
  normalizeInstant(manifest.createdAt, 'Report manifest creation time');
  normalizeInstant(manifest.updatedAt, 'Report manifest update time');
  if (Date.parse(manifest.updatedAt) < Date.parse(manifest.createdAt)) {
    throw new DomainError('INTERNAL', 'Stored report manifest time is inconsistent.');
  }
  const active = manifest.state === 'active'
    && manifest.candidate !== null
    && manifest.availableAt !== null;
  const disabled = manifest.state === 'disabled'
    && manifest.candidate === null
    && manifest.availableAt === null
    && manifest.runtimeFailureCount === 0;
  if (!active && !disabled) {
    throw new DomainError('INTERNAL', 'Stored report manifest state is inconsistent.');
  }
  if (manifest.candidate) {
    validateCandidateForTarget(
      { uid: manifest.userId, reportType: manifest.reportType },
      manifest.candidate,
    );
  }
  if (manifest.availableAt) normalizeInstant(manifest.availableAt, 'Report manifest availability');
  integerValue(
    manifest.runtimeFailureCount,
    0,
    REPORT_SCHEDULE_MANIFEST_MAX_RUNTIME_FAILURES - 1,
    'Report manifest runtime failure count',
  );
  manifestResultCode(manifest.lastResultCode);
}

function validateTarget(target: ScientificReportScheduleTarget): void {
  if (!target || typeof target !== 'object') {
    throw new DomainError('INVALID_ARGUMENT', 'Report schedule target is invalid.');
  }
  assertUid(target.uid);
  assertReportType(target.reportType);
}

function validateCandidateForTarget(
  target: ScientificReportScheduleTarget,
  candidate: ScientificReportScheduleCandidate,
): void {
  validateScientificReportScheduleCandidate(candidate);
  if (candidate.uid !== target.uid || candidate.reportType !== target.reportType) {
    throw new DomainError('INVALID_ARGUMENT', 'Report schedule candidate owner is invalid.');
  }
}

function sameCandidate(
  left: ScientificReportScheduleCandidate,
  right: ScientificReportScheduleCandidate,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function assertTransitionTime(
  current: StoredScientificReportScheduleManifest,
  now: string,
): void {
  if (Date.parse(now) < Date.parse(current.updatedAt)) {
    throw new DomainError('INTERNAL', 'Report manifest transition time moved backward.');
  }
}

function completeSnapshots(
  snapshots: readonly (DocumentSnapshot | undefined)[],
  message: string,
): [DocumentSnapshot, DocumentSnapshot, DocumentSnapshot, DocumentSnapshot] {
  if (snapshots.length !== 4 || snapshots.some((snapshot) => !snapshot)) {
    throw new DomainError('INTERNAL', message);
  }
  return snapshots as [DocumentSnapshot, DocumentSnapshot, DocumentSnapshot, DocumentSnapshot];
}

function completeThree(
  snapshots: readonly (DocumentSnapshot | undefined)[],
  message: string,
): [DocumentSnapshot, DocumentSnapshot, DocumentSnapshot] {
  if (snapshots.length !== 3 || snapshots.some((snapshot) => !snapshot)) {
    throw new DomainError('INTERNAL', message);
  }
  return snapshots as [DocumentSnapshot, DocumentSnapshot, DocumentSnapshot];
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError('INTERNAL', `${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new DomainError('INTERNAL', `${label} is invalid.`);
  return value;
}

function timestampValue(value: unknown, label: string): string {
  if (!(value instanceof Timestamp)) throw new DomainError('INTERNAL', `${label} is invalid.`);
  return value.toDate().toISOString();
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestampValue(value, label);
}

function toTimestamp(value: string): Timestamp {
  return Timestamp.fromDate(new Date(normalizeInstant(value, 'Report manifest timestamp')));
}

function normalizeInstant(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new DomainError('INVALID_ARGUMENT', `${label} is invalid.`);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new DomainError('INVALID_ARGUMENT', `${label} is invalid.`);
  const normalized = new Date(epoch).toISOString();
  if (normalized !== value) throw new DomainError('INVALID_ARGUMENT', `${label} is not normalized.`);
  return normalized;
}

function addMilliseconds(value: string, milliseconds: number): string {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function integerValue(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new DomainError('INTERNAL', `${label} is invalid.`);
  }
  return value as number;
}

function reportTypeValue(value: unknown): ScientificReportType {
  assertReportType(value);
  return value;
}

function assertReportType(value: unknown): asserts value is ScientificReportType {
  if (value !== 'daily' && value !== 'weekly') {
    throw new DomainError('INVALID_ARGUMENT', 'Report type is invalid.');
  }
}

function manifestResultCode(value: unknown): ScientificReportScheduleManifestResultCode | null {
  const values: readonly ScientificReportScheduleManifestResultCode[] = [
    'authority_reconciled', 'completed', 'no_op', 'run_failed', 'retry_scheduled',
    'runtime_unavailable', 'runtime_attempts_exhausted',
  ];
  if (value === null || values.includes(value as ScientificReportScheduleManifestResultCode)) {
    return value as ScientificReportScheduleManifestResultCode | null;
  }
  throw new DomainError('INTERNAL', 'Stored report manifest result is invalid.');
}

function assertUid(value: string): void {
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(value)) {
    throw new DomainError('UNAUTHENTICATED', 'A verified Firebase identity is required.');
  }
}
