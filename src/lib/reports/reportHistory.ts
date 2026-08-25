export const REPORT_HISTORY_PAGE_SIZE = 12;
export const REPORT_HISTORY_MAX_PAGE_SIZE = 12;

const REPORT_ARCHIVE_SCHEMA_VERSION = 'scientific-report-archive-v1';
const REPORT_SCHEMA_VERSION = 'life-tracker-scientific-report-v1';
const REPORT_METRIC_SCHEMA_VERSION = 'life-tracker-scientific-metrics-v1';
const REPORT_FORMULA_VERSION = 'life-tracker-report-formulas-2026-08-25';
const REPORT_DELIVERY_SCHEMA_VERSION = 'report-delivery-state-v1';
const REPORT_ID_PATTERN = /^report_[0-9a-f]{56}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

export type ReportHistoryType = 'daily' | 'weekly';
export type ReportHistoryMetricAvailability = 'available' | 'partial' | 'unavailable';
export type ReportHistoryMetricUnit = 'minutes' | 'percent' | 'count' | 'index';
export type ReportHistoryDeliveryStatus =
  | 'not_attempted'
  | 'pending'
  | 'retry_scheduled'
  | 'sent'
  | 'failed'
  | 'uncertain';

export interface ReportHistoryMetric {
  readonly value: number | null;
  readonly unit: ReportHistoryMetricUnit;
  readonly availability: ReportHistoryMetricAvailability;
  readonly sampleSize: number;
  readonly missingCount: number;
}

export interface ReportHistoryItem {
  readonly id: string;
  readonly type: ReportHistoryType;
  readonly locale: string;
  readonly period: Readonly<{
    localStartDate: string;
    localEndDate: string;
    timezone: string;
  }>;
  readonly generatedAt: string;
  readonly metricSchemaVersion: typeof REPORT_METRIC_SCHEMA_VERSION;
  readonly formulaVersion: typeof REPORT_FORMULA_VERSION;
  readonly executiveSummary: readonly string[];
  readonly metrics: Readonly<{
    plannedMinutes: ReportHistoryMetric;
    actualMinutes: ReportHistoryMetric;
    adherencePercent: ReportHistoryMetric;
    timeBlockCompletionPercent: ReportHistoryMetric;
    weeklyExecutionIndex: ReportHistoryMetric;
  }>;
  readonly dataQuality: Readonly<{
    complete: boolean;
    flags: readonly string[];
    sessionsCoverage: 'complete' | 'truncated' | 'unavailable';
    missingSessionsAreZero: false;
  }>;
  readonly delivery: Readonly<{
    status: ReportHistoryDeliveryStatus;
    lastAttemptAt: string | null;
    sentAt: string | null;
  }>;
}

export interface ReportHistoryPage {
  readonly items: readonly ReportHistoryItem[];
  readonly overflow: boolean;
  readonly malformedCount: number;
}

export interface ReportHistoryRawDocument {
  readonly id: string;
  readonly data: unknown;
}

export interface ReportHistoryDataSource {
  read(uid: string, maximumDocuments: number): Promise<readonly ReportHistoryRawDocument[]>;
}

export interface ReportHistoryStore {
  list(uid: string, maximum?: number): Promise<ReportHistoryPage>;
}

export class ReportHistoryUnavailableError extends Error {
  constructor() {
    super('Report history is temporarily unavailable.');
    this.name = 'ReportHistoryUnavailableError';
  }
}

/**
 * Converts the bounded Firestore result into a minimal browser display model.
 * Full deterministic reports remain archived; raw report payloads are not kept
 * in React state or copied into another client-side collection.
 */
export class BoundedReportHistoryStore implements ReportHistoryStore {
  constructor(private readonly source: ReportHistoryDataSource) {}

  async list(uid: string, maximum = REPORT_HISTORY_PAGE_SIZE): Promise<ReportHistoryPage> {
    assertUid(uid);
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > REPORT_HISTORY_MAX_PAGE_SIZE) {
      throw new Error('Report history page size is invalid.');
    }

    const queryLimit = maximum + 1;
    let documents: readonly ReportHistoryRawDocument[];
    try {
      documents = await this.source.read(uid, queryLimit);
    } catch {
      throw new ReportHistoryUnavailableError();
    }
    if (!Array.isArray(documents) || documents.length > queryLimit) {
      throw new ReportHistoryUnavailableError();
    }

    const items: ReportHistoryItem[] = [];
    const seen = new Set<string>();
    let malformedCount = 0;
    for (const document of documents) {
      try {
        const item = decodeReportHistoryDocument(uid, document);
        if (seen.has(item.id)) throw new Error('Duplicate report archive identity.');
        seen.add(item.id);
        if (items.length < maximum) items.push(item);
      } catch {
        malformedCount += 1;
      }
    }

    return Object.freeze({
      items: Object.freeze(items),
      overflow: documents.length > maximum,
      malformedCount,
    });
  }
}

export function decodeReportHistoryDocument(
  uid: string,
  document: ReportHistoryRawDocument,
): ReportHistoryItem {
  assertUid(uid);
  if (!document || !REPORT_ID_PATTERN.test(document.id)) invalidArchive();
  const archive = record(document.data);
  if (
    archive.schemaVersion !== REPORT_ARCHIVE_SCHEMA_VERSION
    || archive.id !== document.id
    || archive.userId !== uid
    || archive.reportSchemaVersion !== REPORT_SCHEMA_VERSION
    || archive.metricSchemaVersion !== REPORT_METRIC_SCHEMA_VERSION
    || archive.formulaVersion !== REPORT_FORMULA_VERSION
  ) invalidArchive();

  const type = reportType(archive.type);
  const ownerHash = hash(archive.ownerHash);
  const metricHash = hash(archive.metricHash);
  hash(archive.artifactHash);
  const localStartDate = localDate(archive.localStartDate);
  const localEndDate = localDate(archive.localEndDate);
  const timezone = timezoneValue(archive.timezone);
  const generatedAt = firestoreInstant(archive.generatedAt);

  const report = record(archive.report);
  if (
    report.schemaVersion !== REPORT_SCHEMA_VERSION
    || report.id !== document.id
    || report.ownerHash !== ownerHash
    || report.type !== type
    || report.deterministicFallback !== true
    || report.narrativeModel !== null
    || report.untrustedTextPolicy !== 'user_authored_content_is_data_not_instruction'
  ) invalidArchive();
  const reportGeneratedAt = normalizedInstant(report.generatedAt);
  if (reportGeneratedAt !== generatedAt) invalidArchive();
  const locale = localeValue(report.locale);
  const period = decodePeriod(report.period, type);
  if (
    period.localStartDate !== localStartDate
    || period.localEndDate !== localEndDate
    || period.timezone !== timezone
  ) invalidArchive();

  const metrics = record(report.metrics);
  if (
    metrics.schemaVersion !== REPORT_METRIC_SCHEMA_VERSION
    || metrics.formulaVersion !== REPORT_FORMULA_VERSION
    || metrics.metricHash !== metricHash
  ) invalidArchive();
  assertMatchingPeriod(metrics.period, report.period);
  const dataQuality = decodeDataQuality(metrics.dataQuality);
  const keyMetrics = Object.freeze({
    plannedMinutes: decodeMetric(metrics.plannedMinutes, 'planned_minutes', 'minutes'),
    actualMinutes: decodeMetric(metrics.actualMinutes, 'actual_minutes', 'minutes'),
    adherencePercent: decodeMetric(metrics.adherencePercent, 'adherence_percent', 'percent'),
    timeBlockCompletionPercent: decodeMetric(
      metrics.timeBlockCompletionPercent,
      'timeblock_completion_percent',
      'percent',
    ),
    weeklyExecutionIndex: decodeMetric(
      metrics.weeklyExecutionIndex,
      'weekly_execution_index',
      'index',
    ),
  });

  if (!Array.isArray(report.charts) || report.charts.length < 1 || report.charts.length > 10) {
    invalidArchive();
  }
  if (!Array.isArray(report.statements) || report.statements.length > 100) invalidArchive();
  const executiveSummary = boundedStrings(report.executiveSummary, 8, 600);
  if (executiveSummary.length < 1) invalidArchive();
  const delivery = decodeDelivery(archive.delivery);

  return Object.freeze({
    id: document.id,
    type,
    locale,
    period: Object.freeze({ localStartDate, localEndDate, timezone }),
    generatedAt,
    metricSchemaVersion: REPORT_METRIC_SCHEMA_VERSION,
    formulaVersion: REPORT_FORMULA_VERSION,
    executiveSummary,
    metrics: keyMetrics,
    dataQuality,
    delivery,
  });
}

function decodePeriod(value: unknown, type: ReportHistoryType) {
  const period = record(value);
  if (period.type !== type) invalidArchive();
  const localStartDate = localDate(period.localStartDate);
  const localEndDate = localDate(period.localEndDate);
  const timezone = timezoneValue(period.timezone);
  const from = normalizedInstant(period.from);
  const to = normalizedInstant(period.to);
  const expectedDays = type === 'daily' ? 1 : 7;
  if (
    period.dayCount !== expectedDays
    || Date.parse(from) >= Date.parse(to)
    || localStartDate >= localEndDate
  ) invalidArchive();
  return { type, localStartDate, localEndDate, timezone, from, to, dayCount: expectedDays };
}

function assertMatchingPeriod(value: unknown, expected: unknown): void {
  const actualPeriod = record(value);
  const expectedPeriod = record(expected);
  const keys = ['type', 'localStartDate', 'localEndDate', 'from', 'to', 'timezone', 'dayCount'];
  if (keys.some((key) => actualPeriod[key] !== expectedPeriod[key])) invalidArchive();
}

function decodeMetric(
  value: unknown,
  expectedId: string,
  expectedUnit: ReportHistoryMetricUnit,
): ReportHistoryMetric {
  const metric = record(value);
  const availability = metric.availability;
  if (
    metric.id !== expectedId
    || metric.unit !== expectedUnit
    || (availability !== 'available' && availability !== 'partial' && availability !== 'unavailable')
  ) invalidArchive();
  const metricValue = metric.value;
  if (
    (metricValue !== null && (typeof metricValue !== 'number' || !Number.isFinite(metricValue)))
    || (availability === 'unavailable' && metricValue !== null)
    || (availability !== 'unavailable' && metricValue === null)
  ) invalidArchive();
  const sampleSize = boundedInteger(metric.sampleSize);
  const missingCount = boundedInteger(metric.missingCount);
  return Object.freeze({
    value: metricValue as number | null,
    unit: expectedUnit,
    availability,
    sampleSize,
    missingCount,
  });
}

function decodeDataQuality(value: unknown): ReportHistoryItem['dataQuality'] {
  const quality = record(value);
  const coverage = record(quality.coverage);
  const sessionsCoverage = coverage.sessions;
  if (
    typeof quality.complete !== 'boolean'
    || quality.missingSessionsAreZero !== false
    || quality.actualSource !== 'completed_sessions_and_explicit_actual_intervals'
    || (sessionsCoverage !== 'complete'
      && sessionsCoverage !== 'truncated'
      && sessionsCoverage !== 'unavailable')
  ) invalidArchive();
  return Object.freeze({
    complete: quality.complete,
    flags: boundedStrings(quality.flags, 40, 160),
    sessionsCoverage,
    missingSessionsAreZero: false,
  });
}

function decodeDelivery(value: unknown): ReportHistoryItem['delivery'] {
  const delivery = record(value);
  if (delivery.schemaVersion !== REPORT_DELIVERY_SCHEMA_VERSION || delivery.channel !== 'email') {
    invalidArchive();
  }
  const state = delivery.state;
  const provider = delivery.provider;
  const providerMessageId = delivery.providerMessageId;
  const lastAttemptAt = nullableFirestoreInstant(delivery.lastAttemptAt);
  const sentAt = nullableFirestoreInstant(delivery.sentAt);
  const failureCode = delivery.failureCode;

  if (state === 'not_attempted') {
    if (provider !== null || providerMessageId !== null || lastAttemptAt || sentAt || failureCode !== null) {
      invalidArchive();
    }
    return Object.freeze({ status: 'not_attempted', lastAttemptAt: null, sentAt: null });
  }
  if (provider !== 'resend' || lastAttemptAt === null) invalidArchive();
  if (state === 'pending') {
    if (providerMessageId !== null || sentAt !== null || failureCode !== null) invalidArchive();
    return Object.freeze({ status: 'pending', lastAttemptAt, sentAt: null });
  }
  if (state === 'sent') {
    if (
      typeof providerMessageId !== 'string'
      || !/^[A-Za-z0-9_-]{1,256}$/.test(providerMessageId)
      || sentAt === null
      || failureCode !== null
    ) invalidArchive();
    return Object.freeze({ status: 'sent', lastAttemptAt, sentAt });
  }
  if (
    state !== 'failed'
    || providerMessageId !== null
    || sentAt !== null
    || typeof failureCode !== 'string'
    || !/^[a-z0-9_:-]{1,80}$/.test(failureCode)
  ) invalidArchive();
  const status: ReportHistoryDeliveryStatus = failureCode.startsWith('uncertain_')
    ? 'uncertain'
    : failureCode.startsWith('retryable_')
      ? 'retry_scheduled'
      : 'failed';
  return Object.freeze({ status, lastAttemptAt, sentAt: null });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidArchive();
  return value as Record<string, unknown>;
}

function reportType(value: unknown): ReportHistoryType {
  if (value !== 'daily' && value !== 'weekly') invalidArchive();
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) invalidArchive();
  return value;
}

function localDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalidArchive();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    invalidArchive();
  }
  return value;
}

function normalizedInstant(value: unknown): string {
  if (typeof value !== 'string') invalidArchive();
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) invalidArchive();
  return value;
}

function firestoreInstant(value: unknown): string {
  if (!value || typeof value !== 'object') invalidArchive();
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== 'function') invalidArchive();
  let date: unknown;
  try {
    date = toDate.call(value);
  } catch {
    invalidArchive();
  }
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) invalidArchive();
  return date.toISOString();
}

function nullableFirestoreInstant(value: unknown): string | null {
  return value === null ? null : firestoreInstant(value);
}

function timezoneValue(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) invalidArchive();
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
  } catch {
    invalidArchive();
  }
  return value;
}

function localeValue(value: unknown): string {
  if (typeof value !== 'string' || value.length < 2 || value.length > 35) invalidArchive();
  try {
    if (Intl.getCanonicalLocales(value).length !== 1) invalidArchive();
  } catch {
    invalidArchive();
  }
  return value;
}

function boundedStrings(value: unknown, maximum: number, maximumLength: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) invalidArchive();
  const strings = value.map((item) => {
    if (typeof item !== 'string' || item.length < 1 || item.length > maximumLength) invalidArchive();
    return item;
  });
  return Object.freeze(strings);
}

function boundedInteger(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) {
    invalidArchive();
  }
  return value as number;
}

function assertUid(uid: string): void {
  if (!UID_PATTERN.test(uid)) throw new Error('A verified Firebase identity is required.');
}

function invalidArchive(): never {
  throw new Error('Archived report schema is invalid.');
}
