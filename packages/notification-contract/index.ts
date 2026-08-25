export const DESKTOP_REMINDER_API_SCHEMA_VERSION = 'desktop-reminder-api-v1' as const;
export const DESKTOP_REMINDER_FUNCTION_NAME = 'desktopReminderApi' as const;
export const DESKTOP_REMINDER_FUNCTION_REGION = 'europe-west1' as const;

export type DesktopReminderKind = 'offset' | 'at_start' | 'missed_start';

export interface DesktopReminderCandidate {
  readonly jobId: string;
  readonly scheduledFor: string;
}

export interface DesktopReminderDispatch {
  readonly jobId: string;
  readonly attemptId: string;
  readonly kind: DesktopReminderKind;
  readonly offsetMinutes: number | null;
  readonly scheduledFor: string;
  /** Untrusted owner-authored display text, normalized and bounded by the server. */
  readonly title: string;
  readonly startTime: string;
  readonly plannedMinutes: number;
  readonly timezone: string;
  readonly locale: string;
}

export type DesktopReminderApiRequest =
  | Readonly<{
    schemaVersion: typeof DESKTOP_REMINDER_API_SCHEMA_VERSION;
    action: 'list';
  }>
  | Readonly<{
    schemaVersion: typeof DESKTOP_REMINDER_API_SCHEMA_VERSION;
    action: 'claim';
    jobId: string;
  }>;

export interface DesktopReminderListResponse {
  readonly schemaVersion: typeof DESKTOP_REMINDER_API_SCHEMA_VERSION;
  readonly action: 'list';
  readonly serverNow: string;
  readonly refreshAfterMs: number;
  readonly overflow: boolean;
  readonly jobs: readonly DesktopReminderCandidate[];
}

export type DesktopReminderClaimResponse =
  | Readonly<{
    schemaVersion: typeof DESKTOP_REMINDER_API_SCHEMA_VERSION;
    action: 'claim';
    status: 'dispatch';
    dispatch: DesktopReminderDispatch;
  }>
  | Readonly<{
    schemaVersion: typeof DESKTOP_REMINDER_API_SCHEMA_VERSION;
    action: 'claim';
    status: 'not_ready';
    notBefore: string;
  }>
  | Readonly<{
    schemaVersion: typeof DESKTOP_REMINDER_API_SCHEMA_VERSION;
    action: 'claim';
    status: 'no_op';
  }>;

export type DesktopReminderApiResponse =
  | DesktopReminderListResponse
  | DesktopReminderClaimResponse;

export function desktopReminderListRequest(): DesktopReminderApiRequest {
  return Object.freeze({
    schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
    action: 'list',
  });
}

export function desktopReminderClaimRequest(jobId: string): DesktopReminderApiRequest {
  return Object.freeze({
    schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
    action: 'claim',
    jobId: hash(jobId, 'Desktop reminder job ID'),
  });
}

export function parseDesktopReminderApiRequest(value: unknown): DesktopReminderApiRequest {
  const source = record(value, 'Desktop reminder request');
  if (source.schemaVersion !== DESKTOP_REMINDER_API_SCHEMA_VERSION) {
    invalid('Desktop reminder request schema');
  }
  if (source.action === 'list') {
    exact(source, ['action', 'schemaVersion'], 'Desktop reminder list request');
    return desktopReminderListRequest();
  }
  if (source.action === 'claim') {
    exact(source, ['action', 'jobId', 'schemaVersion'], 'Desktop reminder claim request');
    return desktopReminderClaimRequest(hash(source.jobId, 'Desktop reminder job ID'));
  }
  return invalid('Desktop reminder request action');
}

export function parseDesktopReminderApiResponse(value: unknown): DesktopReminderApiResponse {
  const source = record(value, 'Desktop reminder response');
  if (source.schemaVersion !== DESKTOP_REMINDER_API_SCHEMA_VERSION) {
    invalid('Desktop reminder response schema');
  }
  if (source.action === 'list') {
    exact(
      source,
      ['action', 'jobs', 'overflow', 'refreshAfterMs', 'schemaVersion', 'serverNow'],
      'Desktop reminder list response',
    );
    if (!Array.isArray(source.jobs) || source.jobs.length > 64) {
      invalid('Desktop reminder candidate list');
    }
    const jobs = source.jobs.map((candidate, index) => {
      const item = record(candidate, `Desktop reminder candidate ${index}`);
      exact(item, ['jobId', 'scheduledFor'], `Desktop reminder candidate ${index}`);
      return Object.freeze({
        jobId: hash(item.jobId, 'Desktop reminder job ID'),
        scheduledFor: instant(item.scheduledFor, 'Desktop reminder schedule'),
      });
    });
    if (new Set(jobs.map((job) => job.jobId)).size !== jobs.length) {
      invalid('Desktop reminder candidate identities');
    }
    return Object.freeze({
      schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
      action: 'list',
      serverNow: instant(source.serverNow, 'Desktop reminder server time'),
      refreshAfterMs: integer(source.refreshAfterMs, 5_000, 300_000, 'Desktop refresh interval'),
      overflow: booleanValue(source.overflow, 'Desktop reminder overflow'),
      jobs: Object.freeze(jobs),
    });
  }
  if (source.action !== 'claim') return invalid('Desktop reminder response action');
  if (source.status === 'no_op') {
    exact(source, ['action', 'schemaVersion', 'status'], 'Desktop reminder no-op response');
    return Object.freeze({
      schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
      action: 'claim',
      status: 'no_op',
    });
  }
  if (source.status === 'not_ready') {
    exact(
      source,
      ['action', 'notBefore', 'schemaVersion', 'status'],
      'Desktop reminder not-ready response',
    );
    return Object.freeze({
      schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
      action: 'claim',
      status: 'not_ready',
      notBefore: instant(source.notBefore, 'Desktop reminder not-before time'),
    });
  }
  if (source.status !== 'dispatch') return invalid('Desktop reminder claim status');
  exact(
    source,
    ['action', 'dispatch', 'schemaVersion', 'status'],
    'Desktop reminder dispatch response',
  );
  return Object.freeze({
    schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
    action: 'claim',
    status: 'dispatch',
    dispatch: parseDispatch(source.dispatch),
  });
}

function parseDispatch(value: unknown): DesktopReminderDispatch {
  const source = record(value, 'Desktop reminder dispatch');
  exact(source, [
    'attemptId', 'jobId', 'kind', 'locale', 'offsetMinutes', 'plannedMinutes',
    'scheduledFor', 'startTime', 'timezone', 'title',
  ], 'Desktop reminder dispatch');
  const kind = enumValue(
    source.kind,
    ['offset', 'at_start', 'missed_start'] as const,
    'Desktop reminder kind',
  );
  const offsetMinutes = source.offsetMinutes === null
    ? null
    : integer(source.offsetMinutes, -240, 1_440, 'Desktop reminder offset');
  if (
    (kind === 'offset' && (offsetMinutes === null || offsetMinutes < 1))
    || (kind === 'at_start' && offsetMinutes !== 0)
    || (kind === 'missed_start' && (offsetMinutes === null || offsetMinutes >= 0))
  ) {
    invalid('Desktop reminder kind and offset');
  }
  const timezone = text(source.timezone, 1, 100, 'Desktop reminder timezone');
  const locale = text(source.locale, 2, 35, 'Desktop reminder locale');
  try {
    new Intl.DateTimeFormat(locale, { timeZone: timezone }).format(new Date(0));
  } catch {
    invalid('Desktop reminder locale or timezone');
  }
  return Object.freeze({
    jobId: hash(source.jobId, 'Desktop reminder job ID'),
    attemptId: hash(source.attemptId, 'Desktop reminder attempt ID'),
    kind,
    offsetMinutes,
    scheduledFor: instant(source.scheduledFor, 'Desktop reminder schedule'),
    title: text(source.title, 1, 160, 'Desktop reminder title'),
    startTime: instant(source.startTime, 'Desktop reminder start time'),
    plannedMinutes: integer(source.plannedMinutes, 1, 10_080, 'Desktop planned minutes'),
    timezone,
    locale,
  });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(label);
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== Object.prototype
    && prototype !== null
    && prototype?.constructor?.name !== 'Object'
  ) {
    invalid(label);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) invalid(label);
  return value as Record<string, unknown>;
}

function exact(source: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(source).sort().join(',') !== [...keys].sort().join(',')) invalid(label);
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(label);
  return value;
}

function instant(value: unknown, label: string): string {
  if (typeof value !== 'string') invalid(label);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || value.length > 64) invalid(label);
  return date.toISOString();
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid(label);
  }
  return value as number;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') invalid(label);
  return value;
}

function text(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): string {
  if (
    typeof value !== 'string'
    || value.length < minimum
    || value.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    invalid(label);
  }
  return value;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) invalid(label);
  return value as T[number];
}

function invalid(label: string): never {
  throw new Error(`${label} is invalid.`);
}
