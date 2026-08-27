export const WEEKLY_REVIEW_API_SCHEMA_VERSION = 'weekly-review-api-v1' as const;
export const WEEKLY_REVIEW_FUNCTION_NAME = 'weeklyExecutiveReviewApi' as const;
export const WEEKLY_REVIEW_FUNCTION_REGION = 'europe-west1' as const;

const REPORT_ID_PATTERN = /^report_[0-9a-f]{56}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;

export type WeeklyReviewPipelineState =
  | 'NOT_DUE'
  | 'GENERATING'
  | 'ARCHIVED'
  | 'INTERPRETING'
  | 'COMPOSED'
  | 'SENDING'
  | 'PROVIDER_ACCEPTED'
  | 'RETRY_PENDING'
  | 'FAILED';

export type WeeklyReviewApiRequest = Readonly<{
  schemaVersion: typeof WEEKLY_REVIEW_API_SCHEMA_VERSION;
  action: 'status' | 'send_test' | 'retry_delivery';
  reportId?: string;
}>;

export type WeeklyReviewStatusResponse = Readonly<{
  schemaVersion: typeof WEEKLY_REVIEW_API_SCHEMA_VERSION;
  action: 'status';
  pipelineState: WeeklyReviewPipelineState;
  schedule: Readonly<{
    enabled: boolean;
    isoWeekday: number;
    localTime: string;
    timezone: string;
    nextRunAt: string | null;
  }>;
  latest: Readonly<{
    reportId: string;
    period: string;
    deliveryState: WeeklyReviewPipelineState;
    providerAcceptedAt: string | null;
  }> | null;
}>;

export type WeeklyReviewSendResponse = Readonly<{
  schemaVersion: typeof WEEKLY_REVIEW_API_SCHEMA_VERSION;
  action: 'send_test' | 'retry_delivery';
  outcome: 'provider_accepted' | 'already_accepted' | 'retry_pending' | 'not_due' | 'failed';
  pipelineState: WeeklyReviewPipelineState;
  reportId: string | null;
  archiveId: string | null;
  period: string | null;
  providerMessageId: string | null;
  idempotencyKeyHash: string | null;
  occurredAt: string;
}>;

export type WeeklyReviewApiResponse = WeeklyReviewStatusResponse | WeeklyReviewSendResponse;

export function weeklyReviewStatusRequest(): WeeklyReviewApiRequest {
  return Object.freeze({
    schemaVersion: WEEKLY_REVIEW_API_SCHEMA_VERSION,
    action: 'status',
  });
}

export function weeklyReviewSendTestRequest(): WeeklyReviewApiRequest {
  return Object.freeze({
    schemaVersion: WEEKLY_REVIEW_API_SCHEMA_VERSION,
    action: 'send_test',
  });
}

export function weeklyReviewRetryRequest(reportId: string): WeeklyReviewApiRequest {
  assertReportId(reportId);
  return Object.freeze({
    schemaVersion: WEEKLY_REVIEW_API_SCHEMA_VERSION,
    action: 'retry_delivery',
    reportId,
  });
}

export function parseWeeklyReviewApiRequest(value: unknown): WeeklyReviewApiRequest {
  const source = record(value, 'Weekly review request');
  const action = source.action;
  if (
    source.schemaVersion !== WEEKLY_REVIEW_API_SCHEMA_VERSION
    || (action !== 'status' && action !== 'send_test' && action !== 'retry_delivery')
  ) {
    invalid('Weekly review request');
  }
  const keys = Object.keys(source).sort();
  if (action === 'retry_delivery') {
    if (keys.join(',') !== 'action,reportId,schemaVersion') invalid('Weekly review request');
    assertReportId(source.reportId);
    return Object.freeze({
      schemaVersion: WEEKLY_REVIEW_API_SCHEMA_VERSION,
      action,
      reportId: source.reportId as string,
    });
  }
  if (keys.join(',') !== 'action,schemaVersion') invalid('Weekly review request');
  return Object.freeze({ schemaVersion: WEEKLY_REVIEW_API_SCHEMA_VERSION, action });
}

export function parseWeeklyReviewApiResponse(value: unknown): WeeklyReviewApiResponse {
  const source = record(value, 'Weekly review response');
  if (source.schemaVersion !== WEEKLY_REVIEW_API_SCHEMA_VERSION) {
    invalid('Weekly review response');
  }
  if (source.action === 'status') return parseStatus(source);
  if (source.action === 'send_test' || source.action === 'retry_delivery') {
    return parseSend(source, source.action);
  }
  invalid('Weekly review response');
}

function parseStatus(source: Record<string, unknown>): WeeklyReviewStatusResponse {
  exact(source, ['schemaVersion', 'action', 'pipelineState', 'schedule', 'latest'], 'Weekly review status');
  const pipelineState = state(source.pipelineState);
  const scheduleSource = record(source.schedule, 'Weekly review schedule');
  exact(scheduleSource, ['enabled', 'isoWeekday', 'localTime', 'timezone', 'nextRunAt'], 'Weekly review schedule');
  if (
    typeof scheduleSource.enabled !== 'boolean'
    || !Number.isInteger(scheduleSource.isoWeekday)
    || Number(scheduleSource.isoWeekday) < 1
    || Number(scheduleSource.isoWeekday) > 7
    || typeof scheduleSource.localTime !== 'string'
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(scheduleSource.localTime)
    || typeof scheduleSource.timezone !== 'string'
    || scheduleSource.timezone.length < 1
    || scheduleSource.timezone.length > 100
  ) invalid('Weekly review schedule');
  const nextRunAt = nullableInstant(scheduleSource.nextRunAt);
  let latest: WeeklyReviewStatusResponse['latest'] = null;
  if (source.latest !== null) {
    const latestSource = record(source.latest, 'Weekly review latest report');
    exact(latestSource, ['reportId', 'period', 'deliveryState', 'providerAcceptedAt'], 'Weekly review latest report');
    assertReportId(latestSource.reportId);
    const period = localDate(latestSource.period);
    latest = Object.freeze({
      reportId: latestSource.reportId as string,
      period,
      deliveryState: state(latestSource.deliveryState),
      providerAcceptedAt: nullableInstant(latestSource.providerAcceptedAt),
    });
  }
  return Object.freeze({
    schemaVersion: WEEKLY_REVIEW_API_SCHEMA_VERSION,
    action: 'status',
    pipelineState,
    schedule: Object.freeze({
      enabled: scheduleSource.enabled,
      isoWeekday: scheduleSource.isoWeekday as number,
      localTime: scheduleSource.localTime,
      timezone: scheduleSource.timezone,
      nextRunAt,
    }),
    latest,
  });
}

function parseSend(
  source: Record<string, unknown>,
  action: 'send_test' | 'retry_delivery',
): WeeklyReviewSendResponse {
  exact(source, [
    'schemaVersion', 'action', 'outcome', 'pipelineState', 'reportId', 'archiveId',
    'period', 'providerMessageId', 'idempotencyKeyHash', 'occurredAt',
  ], 'Weekly review send result');
  const outcomes = new Set([
    'provider_accepted', 'already_accepted', 'retry_pending', 'not_due', 'failed',
  ]);
  if (!outcomes.has(String(source.outcome))) invalid('Weekly review send result');
  const reportId = nullableReportId(source.reportId);
  const archiveId = nullableReportId(source.archiveId);
  if (reportId !== archiveId) invalid('Weekly review send result');
  const period = source.period === null ? null : localDate(source.period);
  const providerMessageId = nullableBoundedString(source.providerMessageId, 256);
  const idempotencyKeyHash = source.idempotencyKeyHash === null
    ? null
    : hash(source.idempotencyKeyHash);
  if (
    source.outcome === 'provider_accepted'
    && (!reportId || !period || !providerMessageId || !idempotencyKeyHash)
  ) invalid('Weekly review send result');
  return Object.freeze({
    schemaVersion: WEEKLY_REVIEW_API_SCHEMA_VERSION,
    action,
    outcome: source.outcome as WeeklyReviewSendResponse['outcome'],
    pipelineState: state(source.pipelineState),
    reportId,
    archiveId,
    period,
    providerMessageId,
    idempotencyKeyHash,
    occurredAt: instant(source.occurredAt),
  });
}

function state(value: unknown): WeeklyReviewPipelineState {
  const states: readonly WeeklyReviewPipelineState[] = [
    'NOT_DUE', 'GENERATING', 'ARCHIVED', 'INTERPRETING', 'COMPOSED', 'SENDING',
    'PROVIDER_ACCEPTED', 'RETRY_PENDING', 'FAILED',
  ];
  if (!states.includes(value as WeeklyReviewPipelineState)) invalid('Weekly review pipeline state');
  return value as WeeklyReviewPipelineState;
}

function nullableReportId(value: unknown): string | null {
  if (value === null) return null;
  assertReportId(value);
  return value as string;
}

function assertReportId(value: unknown): void {
  if (typeof value !== 'string' || !REPORT_ID_PATTERN.test(value)) invalid('Weekly review report ID');
}

function hash(value: unknown): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) invalid('Weekly review hash');
  return value;
}

function nullableBoundedString(value: unknown, maximum: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
    invalid('Weekly review provider identity');
  }
  return value;
}

function localDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    invalid('Weekly review period');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    invalid('Weekly review period');
  }
  return value;
}

function nullableInstant(value: unknown): string | null {
  return value === null ? null : instant(value);
}

function instant(value: unknown): string {
  if (typeof value !== 'string') invalid('Weekly review timestamp');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    invalid('Weekly review timestamp');
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(label);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) invalid(label);
}

function invalid(label: string): never {
  throw new Error(`${label} is invalid.`);
}
