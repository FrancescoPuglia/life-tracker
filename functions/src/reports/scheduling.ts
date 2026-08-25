import { createHash } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { canonicalJson } from '../domain/integrity';
import type { NotificationPreferences } from '../notifications/domain';
import { validateEmailMailbox, type EmailMailbox } from './email-provider';
import { resolveReportPeriod } from './period';
import type { ScientificReportType } from './types';

export const REPORT_SCHEDULE_POLICY_SCHEMA_VERSION =
  'scientific-report-schedule-policy-v1' as const;
export const REPORT_SCHEDULE_CANDIDATE_SCHEMA_VERSION =
  'scientific-report-schedule-candidate-v1' as const;
export const REPORT_DAILY_CATCH_UP_MS = 36 * 60 * 60_000;
export const REPORT_WEEKLY_CATCH_UP_MS = 8 * 24 * 60 * 60_000;

export interface ScientificReportSchedulePolicy {
  readonly schemaVersion: typeof REPORT_SCHEDULE_POLICY_SCHEMA_VERSION;
  readonly uid: string;
  readonly timezone: string;
  readonly locale: string;
  /** In-memory delivery authority only; never copy this value into a run record or task payload. */
  readonly recipient: EmailMailbox | null;
  readonly emailEnabled: boolean;
  readonly dailyReport: Readonly<{ enabled: boolean; localTime: string }>;
  readonly weeklyReport: Readonly<{
    enabled: boolean;
    isoWeekday: number;
    localTime: string;
  }>;
}

export interface ScientificReportScheduleCandidate {
  readonly schemaVersion: typeof REPORT_SCHEDULE_CANDIDATE_SCHEMA_VERSION;
  readonly id: string;
  readonly uid: string;
  readonly reportType: ScientificReportType;
  /** Daily date or completed calendar-week Sunday passed to the source loader. */
  readonly localDate: string;
  /** Deterministic report/idempotency period identity. */
  readonly localStartDate: string;
  readonly scheduledFor: string;
  readonly expectedScheduleVersion: string;
  /** One-way envelope authority; the mailbox itself is absent from the candidate. */
  readonly recipientAuthorityHash: string;
}

export function deriveScientificReportSchedulePolicy(
  preferences: NotificationPreferences,
): ScientificReportSchedulePolicy {
  assertUid(preferences.uid);
  const recipient = validatedRecipient(preferences.reportRecipient);
  return Object.freeze({
    schemaVersion: REPORT_SCHEDULE_POLICY_SCHEMA_VERSION,
    uid: preferences.uid,
    timezone: validatedTimezone(preferences.timezone),
    locale: validatedLocale(preferences.locale),
    recipient,
    emailEnabled: preferences.emailEnabled === true && recipient !== null,
    dailyReport: Object.freeze({ ...preferences.dailyReport }),
    weeklyReport: Object.freeze({ ...preferences.weeklyReport }),
  });
}

/**
 * Returns at most the most recent Daily and Weekly occurrence. Durable run
 * claims decide whether either occurrence has already been consumed, so a
 * scheduler retry never needs an unbounded historical scan.
 */
export function planDueScientificReportRuns(
  policy: ScientificReportSchedulePolicy,
  now: string,
): readonly ScientificReportScheduleCandidate[] {
  validatePolicy(policy);
  const nowInstant = normalizedInstant(now);
  if (!policy.emailEnabled || !policy.recipient) return Object.freeze([]);

  const candidates: ScientificReportScheduleCandidate[] = [];
  if (policy.dailyReport.enabled) {
    const occurrence = mostRecentOccurrence(
      nowInstant,
      policy.timezone,
      policy.dailyReport.localTime,
      null,
    );
    if (ageMilliseconds(nowInstant, occurrence.instant) <= REPORT_DAILY_CATCH_UP_MS) {
      candidates.push(candidate(policy, 'daily', occurrence.localDate, occurrence.instant));
    }
  }
  if (policy.weeklyReport.enabled) {
    const occurrence = mostRecentOccurrence(
      nowInstant,
      policy.timezone,
      policy.weeklyReport.localTime,
      policy.weeklyReport.isoWeekday,
    );
    if (ageMilliseconds(nowInstant, occurrence.instant) <= REPORT_WEEKLY_CATCH_UP_MS) {
      candidates.push(candidate(policy, 'weekly', occurrence.localDate, occurrence.instant));
    }
  }
  return Object.freeze(candidates);
}

export function reportScheduleVersion(
  policy: ScientificReportSchedulePolicy,
  reportType: ScientificReportType,
): string {
  validatePolicy(policy);
  if (!policy.recipient) throw new Error('Report recipient authority is unavailable.');
  const schedule = reportType === 'daily' ? policy.dailyReport : policy.weeklyReport;
  return sha256(canonicalJson({
    schemaVersion: REPORT_SCHEDULE_POLICY_SCHEMA_VERSION,
    uid: policy.uid,
    reportType,
    timezone: policy.timezone,
    locale: policy.locale,
    emailEnabled: policy.emailEnabled,
    recipient: policy.recipient.email,
    schedule,
  }));
}

function candidate(
  policy: ScientificReportSchedulePolicy,
  reportType: ScientificReportType,
  deliveryLocalDate: string,
  scheduledInstant: Temporal.Instant,
): ScientificReportScheduleCandidate {
  if (!policy.recipient) throw new Error('Report recipient authority is unavailable.');
  const localDate = reportType === 'weekly'
    ? Temporal.PlainDate.from(deliveryLocalDate)
      .subtract({ days: policy.weeklyReport.isoWeekday % 7 })
      .toString()
    : deliveryLocalDate;
  const period = resolveReportPeriod(reportType, localDate, policy.timezone);
  const idDigest = sha256([
    REPORT_SCHEDULE_CANDIDATE_SCHEMA_VERSION,
    policy.uid,
    reportType,
    period.localStartDate,
  ].join('\0'));
  return Object.freeze({
    schemaVersion: REPORT_SCHEDULE_CANDIDATE_SCHEMA_VERSION,
    id: `report_run_${idDigest.slice(0, 48)}`,
    uid: policy.uid,
    reportType,
    localDate,
    localStartDate: period.localStartDate,
    scheduledFor: instantString(scheduledInstant),
    expectedScheduleVersion: reportScheduleVersion(policy, reportType),
    recipientAuthorityHash: sha256(
      `life-tracker-report-recipient-v1\0${policy.uid}\0${policy.recipient.email}`,
    ),
  });
}

function mostRecentOccurrence(
  now: Temporal.Instant,
  timezone: string,
  localTime: string,
  isoWeekday: number | null,
): Readonly<{ localDate: string; instant: Temporal.Instant }> {
  const nowLocal = now.toZonedDateTimeISO(timezone);
  let date = nowLocal.toPlainDate();
  if (isoWeekday !== null) {
    const daysBack = (date.dayOfWeek - isoWeekday + 7) % 7;
    date = date.subtract({ days: daysBack });
  }
  let instant = occurrenceInstant(date, localTime, timezone);
  if (Temporal.Instant.compare(instant, now) > 0) {
    date = date.subtract({ days: isoWeekday === null ? 1 : 7 });
    instant = occurrenceInstant(date, localTime, timezone);
  }
  return Object.freeze({ localDate: date.toString(), instant });
}

function occurrenceInstant(
  date: Temporal.PlainDate,
  localTime: string,
  timezone: string,
): Temporal.Instant {
  const plainDateTime = date.toPlainDateTime(Temporal.PlainTime.from(localTime));
  // "compatible" deterministically shifts a skipped spring time forward and
  // selects the earlier duplicate autumn time, so one local schedule has one run.
  return plainDateTime.toZonedDateTime(timezone, { disambiguation: 'compatible' }).toInstant();
}

function normalizedInstant(value: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new Error('Report scheduler instant is invalid.');
  }
}

function instantString(value: Temporal.Instant): string {
  return new Date(Number(value.epochMilliseconds)).toISOString();
}

function ageMilliseconds(now: Temporal.Instant, scheduled: Temporal.Instant): number {
  return Number(now.epochMilliseconds - scheduled.epochMilliseconds);
}

function validatedRecipient(value: string | null): EmailMailbox | null {
  if (value === null) return null;
  const mailbox = Object.freeze({ email: value, name: null });
  try {
    validateEmailMailbox(mailbox, 'Report recipient');
    return mailbox;
  } catch {
    return null;
  }
}

function validatePolicy(policy: ScientificReportSchedulePolicy): void {
  if (
    !policy
    || policy.schemaVersion !== REPORT_SCHEDULE_POLICY_SCHEMA_VERSION
    || policy.timezone !== validatedTimezone(policy.timezone)
    || policy.locale !== validatedLocale(policy.locale)
    || !validClock(policy.dailyReport.localTime)
    || !validClock(policy.weeklyReport.localTime)
    || !Number.isInteger(policy.weeklyReport.isoWeekday)
    || policy.weeklyReport.isoWeekday < 1
    || policy.weeklyReport.isoWeekday > 7
  ) {
    throw new Error('Scientific report schedule policy is invalid.');
  }
  assertUid(policy.uid);
  if (policy.recipient !== null) validateEmailMailbox(policy.recipient, 'Report recipient');
  if (policy.emailEnabled && policy.recipient === null) {
    throw new Error('Scientific report email authority is inconsistent.');
  }
}

function validatedTimezone(value: string): string {
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(value);
    return value;
  } catch {
    throw new Error('Scientific report timezone is invalid.');
  }
}

function validatedLocale(value: string): string {
  try {
    if (typeof value !== 'string' || value.length < 2 || value.length > 35) throw new Error();
    if (Intl.getCanonicalLocales(value).length !== 1) throw new Error();
    return value;
  } catch {
    throw new Error('Scientific report locale is invalid.');
  }
}

function validClock(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function assertUid(value: string): void {
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(value)) {
    throw new Error('Scientific report owner is invalid.');
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
