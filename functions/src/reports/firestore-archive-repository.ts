import {
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';
import { DomainError } from '../domain/errors';
import {
  REPORT_ARCHIVE_IDEMPOTENCY_SCHEMA_VERSION,
  REPORT_ARCHIVE_SCHEMA_VERSION,
  type ReportArchiveIdempotencyRecord,
  type SaveScientificReportArchiveResult,
  type ScientificReportArchivePage,
  type ScientificReportArchiveRepository,
  type StoredScientificReportArchive,
  createReportArchiveIdempotencyRecord,
  createStoredScientificReportArchive,
  reportArchiveSummary,
  scientificReportArtifactHash,
  validateScientificExecutionReport,
  validateStoredReportDeliveryState,
} from './archive';
import type { ScientificExecutionReport, ScientificReportType } from './types';
import {
  REPORT_FORMULA_VERSION,
  REPORT_METRIC_SCHEMA_VERSION,
  REPORT_SCHEMA_VERSION,
} from './types';

const MAX_ARCHIVE_HISTORY_RESULTS = 100;
const REPORT_ID_PATTERN = /^report_[0-9a-f]{56}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Admin-only persistence. Every path is derived from the verified owner UID
 * and deterministic report ID; no caller can provide a Firestore path.
 */
export class FirestoreScientificReportArchiveRepository
implements ScientificReportArchiveRepository {
  constructor(private readonly firestore: Firestore) {}

  async saveGeneratedReport(
    uid: string,
    report: ScientificExecutionReport,
    now: string,
  ): Promise<SaveScientificReportArchiveResult> {
    assertUid(uid);
    const candidate = createStoredScientificReportArchive(uid, report, now);
    const marker = createReportArchiveIdempotencyRecord(candidate);
    const archiveRef = this.archiveRef(uid, candidate.id);
    const markerRef = this.idempotencyRef(uid, candidate.id);

    return this.firestore.runTransaction(async (transaction) => {
      const [archiveSnapshot, markerSnapshot] = await transaction.getAll(archiveRef, markerRef);
      if (!archiveSnapshot || !markerSnapshot) {
        throw new DomainError('INTERNAL', 'Report archive authority read is incomplete.');
      }
      if (archiveSnapshot.exists !== markerSnapshot.exists) {
        throw new DomainError('INTERNAL', 'Report archive idempotency state is inconsistent.');
      }
      if (archiveSnapshot.exists) {
        const existing = decodeStoredScientificReportArchiveSnapshot(uid, archiveSnapshot);
        const existingMarker = decodeReportArchiveIdempotencySnapshot(uid, markerSnapshot);
        assertReportArchiveMarkerCoherence(existing, existingMarker);
        if (existing.artifactHash !== candidate.artifactHash) {
          throw new DomainError(
            'CONFLICT',
            'A different immutable report already exists for this owner and period.',
          );
        }
        return Object.freeze({ archive: existing, idempotentReplay: true });
      }

      transaction.create(archiveRef, encodeStoredScientificReportArchive(candidate));
      transaction.create(markerRef, encodeReportArchiveIdempotencyRecord(marker));
      return Object.freeze({ archive: candidate, idempotentReplay: false });
    });
  }

  async getArchive(uid: string, reportId: string): Promise<StoredScientificReportArchive | null> {
    assertUid(uid);
    assertReportId(reportId);
    const snapshot = await this.archiveRef(uid, reportId).get();
    return snapshot.exists ? decodeStoredScientificReportArchiveSnapshot(uid, snapshot) : null;
  }

  async listArchiveSummaries(
    uid: string,
    maximum: number,
  ): Promise<ScientificReportArchivePage> {
    assertUid(uid);
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > MAX_ARCHIVE_HISTORY_RESULTS) {
      throw new DomainError('LIMIT_EXCEEDED', 'Report history limit must be between 1 and 100.');
    }
    const snapshot = await this.firestore.collection(`users/${uid}/reportArchives`)
      .where('userId', '==', uid)
      .orderBy('generatedAt', 'desc')
      .limit(maximum + 1)
      .get();
    const decoded = snapshot.docs.map((document) =>
      decodeStoredScientificReportArchiveSnapshot(uid, document));
    return Object.freeze({
      items: Object.freeze(decoded.slice(0, maximum).map(reportArchiveSummary)),
      overflow: decoded.length > maximum,
    });
  }

  private archiveRef(uid: string, reportId: string) {
    return this.firestore.doc(`users/${uid}/reportArchives/${reportId}`);
  }

  private idempotencyRef(uid: string, reportId: string) {
    return this.firestore.doc(`users/${uid}/reportIdempotency/${reportId}`);
  }
}

/** @internal Shared with the server-only report-run transaction adapter. */
export function encodeStoredScientificReportArchive(
  archive: StoredScientificReportArchive,
): DocumentData {
  return {
    schemaVersion: archive.schemaVersion,
    id: archive.id,
    userId: archive.userId,
    ownerHash: archive.ownerHash,
    type: archive.type,
    localStartDate: archive.localStartDate,
    localEndDate: archive.localEndDate,
    timezone: archive.timezone,
    reportSchemaVersion: archive.reportSchemaVersion,
    metricSchemaVersion: archive.metricSchemaVersion,
    formulaVersion: archive.formulaVersion,
    metricHash: archive.metricHash,
    artifactHash: archive.artifactHash,
    report: archive.report,
    delivery: encodeStoredReportDeliveryState(archive.delivery),
    generatedAt: Timestamp.fromDate(new Date(archive.generatedAt)),
    createdAt: Timestamp.fromDate(new Date(archive.createdAt)),
    updatedAt: Timestamp.fromDate(new Date(archive.updatedAt)),
  };
}

/** @internal Shared with the server-only report-run transaction adapter. */
export function encodeReportArchiveIdempotencyRecord(
  marker: ReportArchiveIdempotencyRecord,
): DocumentData {
  return {
    schemaVersion: marker.schemaVersion,
    id: marker.id,
    userId: marker.userId,
    reportId: marker.reportId,
    reportType: marker.reportType,
    localStartDate: marker.localStartDate,
    metricHash: marker.metricHash,
    artifactHash: marker.artifactHash,
    createdAt: Timestamp.fromDate(new Date(marker.createdAt)),
  };
}

/** @internal Shared with the server-only delivery transaction adapter. */
export function decodeStoredScientificReportArchiveSnapshot(
  uid: string,
  snapshot: DocumentSnapshot,
): StoredScientificReportArchive {
  const value = snapshot.data() ?? {};
  if (
    value.schemaVersion !== REPORT_ARCHIVE_SCHEMA_VERSION
    || value.id !== snapshot.id
    || value.userId !== uid
    || value.reportSchemaVersion !== REPORT_SCHEMA_VERSION
    || value.metricSchemaVersion !== REPORT_METRIC_SCHEMA_VERSION
    || value.formulaVersion !== REPORT_FORMULA_VERSION
  ) {
    throw new DomainError('INTERNAL', 'Stored report archive identity or schema is invalid.');
  }
  assertReportId(snapshot.id);
  const report = validateScientificExecutionReport(uid, value.report, 'INTERNAL');
  const type = reportTypeValue(value.type);
  const generatedAt = timestampValue(value.generatedAt, 'Stored report generation time');
  const createdAt = timestampValue(value.createdAt, 'Stored report creation time');
  const updatedAt = timestampValue(value.updatedAt, 'Stored report update time');
  const metricHash = hashValue(value.metricHash, 'Stored report metric hash');
  const artifactHash = hashValue(value.artifactHash, 'Stored report artifact hash');
  const ownerHash = hashValue(value.ownerHash, 'Stored report owner hash');
  const localStartDate = localDateValue(value.localStartDate, 'Stored report start date');
  const localEndDate = localDateValue(value.localEndDate, 'Stored report end date');
  const timezone = shortString(value.timezone, 'Stored report timezone', 100);
  const deliveryValue = objectValue(value.delivery, 'Stored report delivery state');
  const delivery = validateStoredReportDeliveryState({
    ...deliveryValue,
    lastAttemptAt: nullableTimestampValue(deliveryValue.lastAttemptAt, 'Stored report attempt time'),
    sentAt: nullableTimestampValue(deliveryValue.sentAt, 'Stored report sent time'),
  });
  if (
    report.id !== snapshot.id
    || report.ownerHash !== ownerHash
    || report.type !== type
    || report.period.localStartDate !== localStartDate
    || report.period.localEndDate !== localEndDate
    || report.period.timezone !== timezone
    || report.metrics.metricHash !== metricHash
    || scientificReportArtifactHash(report) !== artifactHash
    || report.generatedAt !== generatedAt
    || Date.parse(updatedAt) < Date.parse(createdAt)
  ) {
    throw new DomainError('INTERNAL', 'Stored report archive is internally inconsistent.');
  }
  return Object.freeze({
    schemaVersion: REPORT_ARCHIVE_SCHEMA_VERSION,
    id: snapshot.id,
    userId: uid,
    ownerHash,
    type,
    localStartDate,
    localEndDate,
    timezone,
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    metricSchemaVersion: REPORT_METRIC_SCHEMA_VERSION,
    formulaVersion: REPORT_FORMULA_VERSION,
    metricHash,
    artifactHash,
    report,
    delivery,
    generatedAt,
    createdAt,
    updatedAt,
  });
}

/** @internal Shared with the server-only delivery transaction adapter. */
export function encodeStoredReportDeliveryState(
  delivery: StoredScientificReportArchive['delivery'],
): DocumentData {
  return {
    ...delivery,
    lastAttemptAt: delivery.lastAttemptAt
      ? Timestamp.fromDate(new Date(delivery.lastAttemptAt))
      : null,
    sentAt: delivery.sentAt
      ? Timestamp.fromDate(new Date(delivery.sentAt))
      : null,
  };
}

/** @internal Shared with the server-only report-run transaction adapter. */
export function decodeReportArchiveIdempotencySnapshot(
  uid: string,
  snapshot: DocumentSnapshot,
): ReportArchiveIdempotencyRecord {
  const value = snapshot.data() ?? {};
  if (
    value.schemaVersion !== REPORT_ARCHIVE_IDEMPOTENCY_SCHEMA_VERSION
    || value.id !== snapshot.id
    || value.reportId !== snapshot.id
    || value.userId !== uid
  ) {
    throw new DomainError('INTERNAL', 'Stored report idempotency identity is invalid.');
  }
  assertReportId(snapshot.id);
  return Object.freeze({
    schemaVersion: REPORT_ARCHIVE_IDEMPOTENCY_SCHEMA_VERSION,
    id: snapshot.id,
    userId: uid,
    reportId: snapshot.id,
    reportType: reportTypeValue(value.reportType),
    localStartDate: localDateValue(value.localStartDate, 'Stored report idempotency date'),
    metricHash: hashValue(value.metricHash, 'Stored report idempotency metric hash'),
    artifactHash: hashValue(value.artifactHash, 'Stored report idempotency artifact hash'),
    createdAt: timestampValue(value.createdAt, 'Stored report idempotency creation time'),
  });
}

/** @internal Shared with the server-only report-run transaction adapter. */
export function assertReportArchiveMarkerCoherence(
  archive: StoredScientificReportArchive,
  marker: ReportArchiveIdempotencyRecord,
): void {
  if (
    marker.id !== archive.id
    || marker.userId !== archive.userId
    || marker.reportId !== archive.id
    || marker.reportType !== archive.type
    || marker.localStartDate !== archive.localStartDate
    || marker.metricHash !== archive.metricHash
    || marker.artifactHash !== archive.artifactHash
    || marker.createdAt !== archive.createdAt
  ) {
    throw new DomainError('INTERNAL', 'Stored report idempotency marker is inconsistent.');
  }
}

function assertUid(uid: string): void {
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(uid)) {
    throw new DomainError('UNAUTHENTICATED', 'A verified Firebase identity is required.');
  }
}

function assertReportId(reportId: string): void {
  if (!REPORT_ID_PATTERN.test(reportId)) {
    throw new DomainError('INVALID_ARGUMENT', 'Report identifier is invalid.');
  }
}

function reportTypeValue(value: unknown): ScientificReportType {
  if (value !== 'daily' && value !== 'weekly') {
    throw new DomainError('INTERNAL', 'Stored report type is invalid.');
  }
  return value;
}

function hashValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new DomainError('INTERNAL', `${label} is invalid.`);
  }
  return value;
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

function shortString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
    throw new DomainError('INTERNAL', `${label} is invalid.`);
  }
  return value;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError('INTERNAL', `${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function timestampValue(value: unknown, label: string): string {
  if (!(value instanceof Timestamp)) throw new DomainError('INTERNAL', `${label} is invalid.`);
  return value.toDate().toISOString();
}

function nullableTimestampValue(value: unknown, label: string): string | null {
  return value === null ? null : timestampValue(value, label);
}
