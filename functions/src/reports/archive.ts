import { createHash } from 'node:crypto';
import { canonicalJson } from '../domain/integrity';
import { DomainError, type DomainErrorCode } from '../domain/errors';
import { reportIdempotencyKey, reportOwnerHash } from './report-builder';
import type {
  ReportPeriod,
  ScientificExecutionReport,
  ScientificReportType,
} from './types';
import {
  REPORT_CHART_SCHEMA_VERSION,
  REPORT_FORMULA_VERSION,
  REPORT_METRIC_SCHEMA_VERSION,
  REPORT_SCHEMA_VERSION,
} from './types';

export const REPORT_ARCHIVE_SCHEMA_VERSION = 'scientific-report-archive-v1' as const;
export const REPORT_ARCHIVE_IDEMPOTENCY_SCHEMA_VERSION =
  'scientific-report-idempotency-v1' as const;
export const REPORT_DELIVERY_STATE_SCHEMA_VERSION = 'report-delivery-state-v1' as const;
/** Leaves material headroom below Firestore's 1 MiB document limit. */
export const REPORT_ARCHIVE_MAX_REPORT_BYTES = 700_000;

export type ReportDeliveryState = 'not_attempted' | 'pending' | 'sent' | 'failed';
export type ReportEmailProviderId = 'resend';

export interface StoredReportDeliveryState {
  readonly schemaVersion: typeof REPORT_DELIVERY_STATE_SCHEMA_VERSION;
  readonly channel: 'email';
  readonly state: ReportDeliveryState;
  readonly provider: ReportEmailProviderId | null;
  readonly providerMessageId: string | null;
  readonly lastAttemptAt: string | null;
  readonly sentAt: string | null;
  /** Stable non-secret code only; provider bodies and credentials are never archived. */
  readonly failureCode: string | null;
}

export interface StoredScientificReportArchive {
  readonly schemaVersion: typeof REPORT_ARCHIVE_SCHEMA_VERSION;
  readonly id: string;
  /** Required for Rules query constraints; always derived from verified auth. */
  readonly userId: string;
  readonly ownerHash: string;
  readonly type: ScientificReportType;
  readonly localStartDate: string;
  readonly localEndDate: string;
  readonly timezone: string;
  readonly reportSchemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly metricSchemaVersion: typeof REPORT_METRIC_SCHEMA_VERSION;
  readonly formulaVersion: typeof REPORT_FORMULA_VERSION;
  readonly metricHash: string;
  /** Hash of report content excluding only the generation instant. */
  readonly artifactHash: string;
  readonly report: ScientificExecutionReport;
  readonly delivery: StoredReportDeliveryState;
  readonly generatedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScientificReportArchiveSummary {
  readonly id: string;
  readonly type: ScientificReportType;
  readonly period: ReportPeriod;
  readonly generatedAt: string;
  readonly metricSchemaVersion: typeof REPORT_METRIC_SCHEMA_VERSION;
  readonly formulaVersion: typeof REPORT_FORMULA_VERSION;
  readonly metricHash: string;
  readonly artifactHash: string;
  readonly dataQualityFlags: readonly string[];
  readonly delivery: StoredReportDeliveryState;
}

export interface ScientificReportArchivePage {
  readonly items: readonly ScientificReportArchiveSummary[];
  readonly overflow: boolean;
}

export interface SaveScientificReportArchiveResult {
  readonly archive: StoredScientificReportArchive;
  readonly idempotentReplay: boolean;
}

export interface ScientificReportArchiveRepository {
  saveGeneratedReport(
    uid: string,
    report: ScientificExecutionReport,
    now: string,
  ): Promise<SaveScientificReportArchiveResult>;

  getArchive(uid: string, reportId: string): Promise<StoredScientificReportArchive | null>;

  listArchiveSummaries(uid: string, maximum: number): Promise<ScientificReportArchivePage>;
}

export interface ReportArchiveIdempotencyRecord {
  readonly schemaVersion: typeof REPORT_ARCHIVE_IDEMPOTENCY_SCHEMA_VERSION;
  readonly id: string;
  readonly userId: string;
  readonly reportId: string;
  readonly reportType: ScientificReportType;
  readonly localStartDate: string;
  readonly metricHash: string;
  readonly artifactHash: string;
  readonly createdAt: string;
}

function fail(code: DomainErrorCode, message: string): never {
  throw new DomainError(code, message);
}

function recordValue(
  value: unknown,
  label: string,
  code: DomainErrorCode,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, `${label} is invalid.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(code, `${label} contains an unsupported object.`);
  }
  return value as Record<string, unknown>;
}

function normalizedInstant(value: unknown, label: string, code: DomainErrorCode): string {
  if (typeof value !== 'string') fail(code, `${label} is invalid.`);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) fail(code, `${label} is invalid.`);
  return new Date(epoch).toISOString();
}

function assertHash(value: unknown, label: string, code: DomainErrorCode): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    fail(code, `${label} is invalid.`);
  }
}

function assertLocalDate(value: unknown, label: string, code: DomainErrorCode): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(code, `${label} is invalid.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    fail(code, `${label} is invalid.`);
  }
}

function assertReportData(
  value: unknown,
  code: DomainErrorCode,
  depth = 0,
  ancestors: Set<object> = new Set<object>(),
): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(code, 'Scientific report contains a non-finite number.');
    return;
  }
  if (typeof value !== 'object') fail(code, 'Scientific report contains unsupported data.');
  if (depth > 40 || ancestors.has(value)) {
    fail(code, 'Scientific report structure is invalid.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    fail(code, 'Scientific report contains an unsupported object.');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail(code, 'Scientific report contains an unsupported key.');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) assertReportData(item, code, depth + 1, ancestors);
      return;
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (!key || key.length > 160) fail(code, 'Scientific report contains an invalid key.');
      assertReportData(item, code, depth + 1, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function withoutKey(
  value: Record<string, unknown>,
  omittedKey: string,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== omittedKey));
}

/** @internal Runtime validation for both generated and persisted artifacts. */
export function validateScientificExecutionReport(
  uid: string,
  input: unknown,
  code: DomainErrorCode = 'INVALID_ARGUMENT',
): ScientificExecutionReport {
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(uid)) fail(code, 'Scientific report owner is invalid.');
  assertReportData(input, code);
  const report = recordValue(input, 'Scientific report', code);
  if (report.schemaVersion !== REPORT_SCHEMA_VERSION) fail(code, 'Scientific report schema is invalid.');
  if (report.type !== 'daily' && report.type !== 'weekly') fail(code, 'Scientific report type is invalid.');
  if (typeof report.id !== 'string' || !/^report_[0-9a-f]{56}$/.test(report.id)) {
    fail(code, 'Scientific report ID is invalid.');
  }
  assertHash(report.ownerHash, 'Scientific report owner hash', code);
  if (report.ownerHash !== reportOwnerHash(uid)) fail(code, 'Scientific report ownership is invalid.');
  const generatedAt = normalizedInstant(report.generatedAt, 'Scientific report generation time', code);
  if (report.generatedAt !== generatedAt) fail(code, 'Scientific report generation time is not normalized.');
  if (report.deterministicFallback !== true || report.narrativeModel !== null) {
    fail(code, 'Scientific report deterministic policy is invalid.');
  }
  if (report.untrustedTextPolicy !== 'user_authored_content_is_data_not_instruction') {
    fail(code, 'Scientific report text policy is invalid.');
  }

  const period = recordValue(report.period, 'Scientific report period', code);
  assertLocalDate(period.localStartDate, 'Scientific report start date', code);
  assertLocalDate(period.localEndDate, 'Scientific report end date', code);
  if (period.type !== report.type || typeof period.timezone !== 'string' || !period.timezone) {
    fail(code, 'Scientific report period identity is invalid.');
  }
  const expectedId = reportIdempotencyKey(uid, report.type, period.localStartDate);
  if (report.id !== expectedId) fail(code, 'Scientific report idempotency identity is invalid.');

  const metrics = recordValue(report.metrics, 'Scientific report metrics', code);
  if (
    metrics.schemaVersion !== REPORT_METRIC_SCHEMA_VERSION
    || metrics.formulaVersion !== REPORT_FORMULA_VERSION
  ) {
    fail(code, 'Scientific report metric version is invalid.');
  }
  assertHash(metrics.metricHash, 'Scientific report metric hash', code);
  if (metrics.metricHash !== sha256(withoutKey(metrics, 'metricHash'))) {
    fail(code, 'Scientific report metric hash does not match its deterministic values.');
  }
  if (canonicalJson(metrics.period) !== canonicalJson(report.period)) {
    fail(code, 'Scientific report metric period is inconsistent.');
  }

  if (!Array.isArray(report.charts) || report.charts.length < 1 || report.charts.length > 10) {
    fail(code, 'Scientific report chart set is invalid.');
  }
  for (const chartInput of report.charts) {
    const chart = recordValue(chartInput, 'Scientific report chart', code);
    if (chart.schemaVersion !== REPORT_CHART_SCHEMA_VERSION || chart.metricHash !== metrics.metricHash) {
      fail(code, 'Scientific report chart authority is invalid.');
    }
    assertHash(chart.dataHash, 'Scientific report chart data hash', code);
    if (chart.dataHash !== sha256(withoutKey(chart, 'dataHash'))) {
      fail(code, 'Scientific report chart hash does not match its data.');
    }
  }

  const byteLength = Buffer.byteLength(JSON.stringify(report), 'utf8');
  if (byteLength > REPORT_ARCHIVE_MAX_REPORT_BYTES) {
    fail(
      code === 'INTERNAL' ? 'INTERNAL' : 'LIMIT_EXCEEDED',
      'Scientific report exceeds the safe archive size.',
    );
  }
  return input as ScientificExecutionReport;
}

export function scientificReportArtifactHash(report: ScientificExecutionReport): string {
  const value = recordValue(report, 'Scientific report', 'INVALID_ARGUMENT');
  return sha256(withoutKey(value, 'generatedAt'));
}

export function initialReportDeliveryState(): StoredReportDeliveryState {
  return Object.freeze({
    schemaVersion: REPORT_DELIVERY_STATE_SCHEMA_VERSION,
    channel: 'email',
    state: 'not_attempted',
    provider: null,
    providerMessageId: null,
    lastAttemptAt: null,
    sentAt: null,
    failureCode: null,
  });
}

export function validateStoredReportDeliveryState(
  input: unknown,
  code: DomainErrorCode = 'INTERNAL',
): StoredReportDeliveryState {
  const value = recordValue(input, 'Stored report delivery state', code);
  if (
    value.schemaVersion !== REPORT_DELIVERY_STATE_SCHEMA_VERSION
    || value.channel !== 'email'
    || !['not_attempted', 'pending', 'sent', 'failed'].includes(String(value.state))
    || (value.provider !== null && value.provider !== 'resend')
  ) {
    fail(code, 'Stored report delivery state is invalid.');
  }
  const nullableString = (item: unknown): item is string | null => item === null || typeof item === 'string';
  if (
    !nullableString(value.providerMessageId)
    || !nullableString(value.lastAttemptAt)
    || !nullableString(value.sentAt)
    || !nullableString(value.failureCode)
  ) {
    fail(code, 'Stored report delivery metadata is invalid.');
  }
  if (value.lastAttemptAt !== null) normalizedInstant(value.lastAttemptAt, 'Report attempt time', code);
  if (value.sentAt !== null) normalizedInstant(value.sentAt, 'Report sent time', code);
  const state = value.state as ReportDeliveryState;
  const coherent = state === 'not_attempted'
    ? value.provider === null
      && value.providerMessageId === null
      && value.lastAttemptAt === null
      && value.sentAt === null
      && value.failureCode === null
    : state === 'pending'
      ? value.provider === 'resend'
        && value.providerMessageId === null
        && value.lastAttemptAt !== null
        && value.sentAt === null
        && value.failureCode === null
      : state === 'sent'
        ? value.provider === 'resend'
          && typeof value.providerMessageId === 'string'
          && value.providerMessageId.length > 0
          && value.lastAttemptAt !== null
          && value.sentAt !== null
          && value.failureCode === null
        : value.provider === 'resend'
          && value.providerMessageId === null
          && value.lastAttemptAt !== null
          && value.sentAt === null
          && typeof value.failureCode === 'string'
          && /^[a-z0-9_:-]{1,80}$/.test(value.failureCode);
  if (!coherent) fail(code, 'Stored report delivery transition is inconsistent.');
  return input as StoredReportDeliveryState;
}

export function createStoredScientificReportArchive(
  uid: string,
  input: ScientificExecutionReport,
  now: string,
): StoredScientificReportArchive {
  const report = validateScientificExecutionReport(uid, input);
  const createdAt = normalizedInstant(now, 'Report archive creation time', 'INVALID_ARGUMENT');
  const artifactHash = scientificReportArtifactHash(report);
  return Object.freeze({
    schemaVersion: REPORT_ARCHIVE_SCHEMA_VERSION,
    id: report.id,
    userId: uid,
    ownerHash: report.ownerHash,
    type: report.type,
    localStartDate: report.period.localStartDate,
    localEndDate: report.period.localEndDate,
    timezone: report.period.timezone,
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    metricSchemaVersion: REPORT_METRIC_SCHEMA_VERSION,
    formulaVersion: REPORT_FORMULA_VERSION,
    metricHash: report.metrics.metricHash,
    artifactHash,
    report,
    delivery: initialReportDeliveryState(),
    generatedAt: report.generatedAt,
    createdAt,
    updatedAt: createdAt,
  });
}

export function createReportArchiveIdempotencyRecord(
  archive: StoredScientificReportArchive,
): ReportArchiveIdempotencyRecord {
  return Object.freeze({
    schemaVersion: REPORT_ARCHIVE_IDEMPOTENCY_SCHEMA_VERSION,
    id: archive.id,
    userId: archive.userId,
    reportId: archive.id,
    reportType: archive.type,
    localStartDate: archive.localStartDate,
    metricHash: archive.metricHash,
    artifactHash: archive.artifactHash,
    createdAt: archive.createdAt,
  });
}

export function reportArchiveSummary(
  archive: StoredScientificReportArchive,
): ScientificReportArchiveSummary {
  return Object.freeze({
    id: archive.id,
    type: archive.type,
    period: archive.report.period,
    generatedAt: archive.generatedAt,
    metricSchemaVersion: archive.metricSchemaVersion,
    formulaVersion: archive.formulaVersion,
    metricHash: archive.metricHash,
    artifactHash: archive.artifactHash,
    dataQualityFlags: archive.report.metrics.dataQuality.flags,
    delivery: archive.delivery,
  });
}
