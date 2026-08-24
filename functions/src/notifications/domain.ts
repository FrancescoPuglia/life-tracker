import { createHash } from 'node:crypto';

export const NOTIFICATION_SCHEMA_VERSION = 'notification-preferences-v1' as const;
export const REMINDER_JOB_SCHEMA_VERSION = 'reminder-job-v1' as const;
export const REMINDER_TASK_SCHEMA_VERSION = 'reminder-task-v1' as const;
export const PRODUCT_TIMEZONE_FALLBACK = 'Europe/Rome' as const;

export const NOTIFICATION_CHANNELS = ['desktop', 'whatsapp', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type ReminderChannel = Extract<NotificationChannel, 'desktop' | 'whatsapp'>;
export type ReminderKind = 'offset' | 'at_start' | 'missed_start' | 'snooze';

export interface QuietHours {
  readonly enabled: boolean;
  readonly start: string;
  readonly end: string;
}

export interface NotificationPreferences {
  readonly schemaVersion: typeof NOTIFICATION_SCHEMA_VERSION;
  readonly uid: string;
  readonly timezone: string;
  readonly locale: string;
  readonly quietHours: QuietHours;
  readonly desktopEnabled: boolean;
  readonly whatsappEnabled: boolean;
  readonly emailEnabled: boolean;
  readonly reminderOffsetsMinutes: readonly number[];
  readonly atStartEnabled: boolean;
  readonly missedStart: Readonly<{
    enabled: boolean;
    afterMinutes: number;
  }>;
  readonly maxRemindersPerBlock: number;
  readonly dailyReport: Readonly<{
    enabled: boolean;
    localTime: string;
  }>;
  readonly weeklyReport: Readonly<{
    enabled: boolean;
    isoWeekday: number;
    localTime: string;
  }>;
}

export interface ReminderPolicy {
  readonly timezone: string;
  readonly quietHours: QuietHours;
  readonly channels: readonly ReminderChannel[];
  readonly offsetsMinutes: readonly number[];
  readonly atStartEnabled: boolean;
  readonly missedStartEnabled: boolean;
  readonly missedStartAfterMinutes: number;
  readonly maxRemindersPerBlock: number;
  readonly version: string;
}

export type ReminderTimeBlockStatus =
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'overrun';

export interface ReminderTimeBlock {
  readonly uid: string;
  readonly id: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly status: ReminderTimeBlockStatus;
  readonly deleted: boolean;
  readonly reminderEnabled: boolean;
  readonly actualStartTime: string | null;
  readonly actualEndTime: string | null;
  readonly scheduleVersion: string;
}

export interface ReminderJob {
  readonly schemaVersion: typeof REMINDER_JOB_SCHEMA_VERSION;
  readonly id: string;
  readonly uid: string;
  readonly timeBlockId: string;
  readonly channel: ReminderChannel;
  readonly kind: Exclude<ReminderKind, 'snooze'>;
  readonly offsetMinutes: number | null;
  readonly scheduledFor: string;
  readonly expectedTimeBlockVersion: string;
  readonly expectedPolicyVersion: string;
  readonly idempotencyKey: string;
}

export interface ReminderTaskPayload {
  readonly schemaVersion: typeof REMINDER_TASK_SCHEMA_VERSION;
  readonly uid: string;
  readonly jobId: string;
}

export type ReminderSuppressionReason =
  | 'job_owner_mismatch'
  | 'time_block_missing'
  | 'time_block_owner_mismatch'
  | 'time_block_deleted'
  | 'reminder_disabled'
  | 'time_block_cancelled'
  | 'time_block_completed'
  | 'time_block_ended'
  | 'time_block_changed'
  | 'policy_changed'
  | 'channel_disabled'
  | 'quiet_hours'
  | 'already_started'
  | 'delivery_limit_reached'
  | 'idempotency_consumed';

export type ReminderDeliveryDecision =
  | Readonly<{ action: 'send' }>
  | Readonly<{ action: 'retry_later'; notBefore: string }>
  | Readonly<{ action: 'suppress'; reason: ReminderSuppressionReason }>;

export interface ReminderDeliveryInput {
  readonly job: ReminderJob;
  readonly authenticatedUid: string;
  readonly timeBlock: ReminderTimeBlock | null;
  readonly policy: ReminderPolicy;
  readonly now: string;
  readonly hasStartedSession: boolean;
  /** Durable provider-call claims; consuming a slot before send bounds concurrency. */
  readonly consumedDeliverySlotsForBlockAndChannel: number;
  readonly idempotencyConsumed: boolean;
}

export function normalizeNotificationPreferences(
  uid: string,
  value: unknown,
  persistedTimezone: unknown,
): NotificationPreferences {
  assertUid(uid);
  const source = asRecord(value);
  if (source?.userId !== undefined && source.userId !== uid) {
    throw new Error('Notification preferences owner does not match the authenticated path.');
  }
  const fallbackTimezone = validTimezone(persistedTimezone)
    ? persistedTimezone
    : PRODUCT_TIMEZONE_FALLBACK;
  const timezone = validTimezone(source?.timezone) ? source.timezone : fallbackTimezone;
  const quietSource = asRecord(source?.quietHours);
  const quietStart = validClock(quietSource?.start) ? quietSource.start : '22:30';
  const quietEnd = validClock(quietSource?.end) ? quietSource.end : '07:00';
  const quietEnabled = quietSource?.enabled === true && quietStart !== quietEnd;
  const missedSource = asRecord(source?.missedStart);
  const dailySource = asRecord(source?.dailyReport);
  const weeklySource = asRecord(source?.weeklyReport);

  return Object.freeze({
    schemaVersion: NOTIFICATION_SCHEMA_VERSION,
    uid,
    timezone,
    locale: validLocale(source?.locale) ? source.locale : 'it-IT',
    quietHours: Object.freeze({
      enabled: quietEnabled,
      start: quietStart,
      end: quietEnd,
    }),
    desktopEnabled: source?.desktopEnabled === true,
    whatsappEnabled: source?.whatsappEnabled === true,
    emailEnabled: source?.emailEnabled === true,
    reminderOffsetsMinutes: Object.freeze(normalizeOffsets(source?.reminderOffsetsMinutes)),
    atStartEnabled: source?.atStartEnabled !== false,
    missedStart: Object.freeze({
      enabled: missedSource?.enabled === true,
      afterMinutes: boundedInteger(missedSource?.afterMinutes, 1, 240, 10),
    }),
    maxRemindersPerBlock: boundedInteger(source?.maxRemindersPerBlock, 1, 8, 3),
    dailyReport: Object.freeze({
      enabled: dailySource?.enabled === true,
      localTime: validClock(dailySource?.localTime) ? dailySource.localTime : '22:30',
    }),
    weeklyReport: Object.freeze({
      enabled: weeklySource?.enabled === true,
      isoWeekday: boundedInteger(weeklySource?.isoWeekday, 1, 7, 7),
      localTime: validClock(weeklySource?.localTime) ? weeklySource.localTime : '20:30',
    }),
  });
}

export function deriveReminderPolicy(preferences: NotificationPreferences): ReminderPolicy {
  const channels: ReminderChannel[] = [];
  if (preferences.desktopEnabled) channels.push('desktop');
  if (preferences.whatsappEnabled) channels.push('whatsapp');
  const material = {
    timezone: preferences.timezone,
    quietHours: preferences.quietHours,
    channels,
    offsetsMinutes: preferences.reminderOffsetsMinutes,
    atStartEnabled: preferences.atStartEnabled,
    missedStartEnabled: preferences.missedStart.enabled,
    missedStartAfterMinutes: preferences.missedStart.afterMinutes,
    maxRemindersPerBlock: preferences.maxRemindersPerBlock,
  };
  return Object.freeze({
    ...material,
    channels: Object.freeze(channels),
    version: sha256(stableStringify(material)),
  });
}

export function createReminderTimeBlock(
  uid: string,
  id: string,
  value: Readonly<Record<string, unknown>>,
): ReminderTimeBlock {
  assertUid(uid);
  assertId(id, 'TimeBlock ID');
  if (value.userId !== uid) {
    throw new Error('TimeBlock owner does not match the authenticated path.');
  }
  const startTime = instant(value.startTime, 'TimeBlock startTime');
  const endTime = instant(value.endTime, 'TimeBlock endTime');
  if (Date.parse(startTime) >= Date.parse(endTime)) {
    throw new Error('TimeBlock endTime must be after startTime.');
  }
  const status = reminderStatus(value.status);
  const deleted = value.deleted === true;
  const reminderEnabled = value.reminderEnabled !== false;
  const actualStartTime = optionalInstant(value.actualStartTime, 'TimeBlock actualStartTime');
  const actualEndTime = optionalInstant(value.actualEndTime, 'TimeBlock actualEndTime');
  const versionMaterial = {
    uid,
    id,
    startTime,
    endTime,
    status,
    deleted,
    reminderEnabled,
    actualStartTime,
    actualEndTime,
  };
  return Object.freeze({
    ...versionMaterial,
    scheduleVersion: sha256(stableStringify(versionMaterial)),
  });
}

export function planReminderJobs(
  timeBlock: ReminderTimeBlock,
  policy: ReminderPolicy,
  now: string,
): readonly ReminderJob[] {
  const nowMs = Date.parse(instant(now, 'Reminder reconciliation time'));
  if (
    timeBlock.deleted
    || !timeBlock.reminderEnabled
    || timeBlock.status === 'cancelled'
    || timeBlock.status === 'completed'
    || timeBlock.status === 'overrun'
    || timeBlock.actualEndTime
    || policy.channels.length === 0
  ) {
    return Object.freeze([]);
  }

  const startMs = Date.parse(timeBlock.startTime);
  const moments: Array<{
    kind: Exclude<ReminderKind, 'snooze'>;
    offsetMinutes: number | null;
    scheduledForMs: number;
  }> = policy.offsetsMinutes.map((offsetMinutes) => ({
    kind: 'offset',
    offsetMinutes,
    scheduledForMs: startMs - offsetMinutes * 60_000,
  }));
  if (policy.atStartEnabled) {
    moments.push({ kind: 'at_start', offsetMinutes: 0, scheduledForMs: startMs });
  }
  if (policy.missedStartEnabled) {
    moments.push({
      kind: 'missed_start',
      offsetMinutes: -policy.missedStartAfterMinutes,
      scheduledForMs: startMs + policy.missedStartAfterMinutes * 60_000,
    });
  }

  const selected = moments
    .filter((moment) => moment.scheduledForMs >= nowMs)
    .sort((left, right) => left.scheduledForMs - right.scheduledForMs)
    .slice(0, policy.maxRemindersPerBlock);
  const jobs: ReminderJob[] = [];
  for (const moment of selected) {
    const scheduledFor = new Date(moment.scheduledForMs).toISOString();
    for (const channel of policy.channels) {
      const identityMaterial = [
        REMINDER_JOB_SCHEMA_VERSION,
        timeBlock.uid,
        timeBlock.id,
        timeBlock.scheduleVersion,
        policy.version,
        channel,
        moment.kind,
        scheduledFor,
      ].join('\u0000');
      const id = sha256(identityMaterial);
      jobs.push(Object.freeze({
        schemaVersion: REMINDER_JOB_SCHEMA_VERSION,
        id,
        uid: timeBlock.uid,
        timeBlockId: timeBlock.id,
        channel,
        kind: moment.kind,
        offsetMinutes: moment.offsetMinutes,
        scheduledFor,
        expectedTimeBlockVersion: timeBlock.scheduleVersion,
        expectedPolicyVersion: policy.version,
        idempotencyKey: sha256(`delivery\u0000${id}`),
      }));
    }
  }
  return Object.freeze(jobs);
}

export function reminderTaskPayload(job: ReminderJob): ReminderTaskPayload {
  return Object.freeze({
    schemaVersion: REMINDER_TASK_SCHEMA_VERSION,
    uid: job.uid,
    jobId: job.id,
  });
}

export function parseReminderTaskPayload(value: unknown): ReminderTaskPayload {
  const source = asRecord(value);
  if (
    !source
    || (Object.getPrototypeOf(source) !== Object.prototype
      && Object.getPrototypeOf(source) !== null)
    || Object.getOwnPropertySymbols(source).length > 0
    || Object.keys(source).sort().join(',') !== 'jobId,schemaVersion,uid'
    || source.schemaVersion !== REMINDER_TASK_SCHEMA_VERSION
    || typeof source.uid !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(source.uid)
    || typeof source.jobId !== 'string'
    || !/^[a-f0-9]{64}$/.test(source.jobId)
  ) {
    throw new Error('Reminder task payload identity or schema is invalid.');
  }
  return Object.freeze({
    schemaVersion: REMINDER_TASK_SCHEMA_VERSION,
    uid: source.uid,
    jobId: source.jobId,
  });
}

export function evaluateReminderDelivery(
  input: ReminderDeliveryInput,
): ReminderDeliveryDecision {
  const now = instant(input.now, 'Reminder delivery time');
  const nowMs = Date.parse(now);
  if (input.job.uid !== input.authenticatedUid) {
    return suppress('job_owner_mismatch');
  }
  if (!input.timeBlock) return suppress('time_block_missing');
  if (input.timeBlock.uid !== input.authenticatedUid) {
    return suppress('time_block_owner_mismatch');
  }
  if (input.timeBlock.deleted) return suppress('time_block_deleted');
  if (!input.timeBlock.reminderEnabled) return suppress('reminder_disabled');
  if (input.timeBlock.status === 'cancelled') return suppress('time_block_cancelled');
  if (input.timeBlock.status === 'completed' || input.timeBlock.status === 'overrun') {
    return suppress('time_block_completed');
  }
  if (nowMs >= Date.parse(input.timeBlock.endTime) || input.timeBlock.actualEndTime) {
    return suppress('time_block_ended');
  }
  if (
    input.job.kind === 'missed_start'
    && (
      input.hasStartedSession
      || input.timeBlock.status === 'in_progress'
      || Boolean(input.timeBlock.actualStartTime)
    )
  ) {
    return suppress('already_started');
  }
  if (input.timeBlock.scheduleVersion !== input.job.expectedTimeBlockVersion) {
    return suppress('time_block_changed');
  }
  if (input.policy.version !== input.job.expectedPolicyVersion) {
    return suppress('policy_changed');
  }
  if (!input.policy.channels.includes(input.job.channel)) {
    return suppress('channel_disabled');
  }
  if (input.idempotencyConsumed) return suppress('idempotency_consumed');
  if (
    input.consumedDeliverySlotsForBlockAndChannel
    >= input.policy.maxRemindersPerBlock
  ) {
    return suppress('delivery_limit_reached');
  }
  if (isWithinQuietHours(now, input.policy.timezone, input.policy.quietHours)) {
    return suppress('quiet_hours');
  }
  const scheduledForMs = Date.parse(input.job.scheduledFor);
  if (nowMs < scheduledForMs) {
    return Object.freeze({ action: 'retry_later', notBefore: input.job.scheduledFor });
  }
  return Object.freeze({ action: 'send' });
}

export function isWithinQuietHours(
  at: string,
  timezone: string,
  quietHours: QuietHours,
): boolean {
  if (!quietHours.enabled) return false;
  if (!validTimezone(timezone)) throw new Error('Reminder timezone is invalid.');
  if (!validClock(quietHours.start) || !validClock(quietHours.end)) {
    throw new Error('Quiet hours are invalid.');
  }
  if (quietHours.start === quietHours.end) return false;
  const date = new Date(instant(at, 'Quiet-hours instant'));
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  const localMinutes = hour * 60 + minute;
  const start = clockMinutes(quietHours.start);
  const end = clockMinutes(quietHours.end);
  return start < end
    ? localMinutes >= start && localMinutes < end
    : localMinutes >= start || localMinutes < end;
}

function suppress(reason: ReminderSuppressionReason): ReminderDeliveryDecision {
  return Object.freeze({ action: 'suppress', reason });
}

function normalizeOffsets(value: unknown): number[] {
  if (!Array.isArray(value)) return [15];
  const normalized = [...new Set(value
    .filter((item): item is number => Number.isInteger(item) && item >= 1 && item <= 1_440))];
  return (normalized.length ? normalized : [15])
    .sort((left, right) => right - left)
    .slice(0, 8);
}

function reminderStatus(value: unknown): ReminderTimeBlockStatus {
  if (
    value === 'planned'
    || value === 'in_progress'
    || value === 'completed'
    || value === 'cancelled'
    || value === 'overrun'
  ) {
    return value;
  }
  throw new Error('TimeBlock reminder status is invalid.');
}

function optionalInstant(value: unknown, label: string): string | null {
  return value === undefined || value === null ? null : instant(value, label);
}

function instant(value: unknown, label: string): string {
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (
    value
    && typeof value === 'object'
    && 'toDate' in value
    && typeof value.toDate === 'function'
  ) {
    date = value.toDate();
  } else if (
    value
    && typeof value === 'object'
    && 'seconds' in value
    && 'nanoseconds' in value
    && typeof value.seconds === 'number'
    && typeof value.nanoseconds === 'number'
  ) {
    date = new Date(value.seconds * 1_000 + Math.floor(value.nanoseconds / 1_000_000));
  } else if (typeof value === 'string') {
    date = new Date(value);
  } else {
    throw new Error(`${label} is invalid.`);
  }
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid.`);
  return date.toISOString();
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function validLocale(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 2 || value.length > 35) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

function validClock(value: unknown): value is string {
  return typeof value === 'string'
    && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function clockMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? value as number
    : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function assertUid(value: string): void {
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(value)) throw new Error('Authenticated UID is invalid.');
}

function assertId(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(record[key])}`
  )).join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
