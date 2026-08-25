import { Temporal } from '@js-temporal/polyfill';
import type { ReportPeriod, ScientificReportType, TimeOfDayBucket } from './types';

export const REPORT_TIMEZONE_FALLBACK = 'Europe/Rome' as const;

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAY_LABELS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export function normalizeReportTimezone(value: string): string {
  try {
    Temporal.PlainDate.from('2000-01-01').toZonedDateTime({
      timeZone: value,
      plainTime: Temporal.PlainTime.from('00:00'),
    });
    return value;
  } catch {
    return REPORT_TIMEZONE_FALLBACK;
  }
}

export function parseLocalDate(value: string): Temporal.PlainDate {
  if (!LOCAL_DATE_PATTERN.test(value)) throw new Error('Invalid report local date.');
  const parsed = Temporal.PlainDate.from(value);
  if (parsed.toString() !== value) throw new Error('Invalid report local date.');
  return parsed;
}

export function reportPeriodFromDates(
  type: ScientificReportType,
  localStartDate: string,
  localEndDate: string,
  requestedTimezone: string,
): ReportPeriod {
  const startDate = parseLocalDate(localStartDate);
  const endDate = parseLocalDate(localEndDate);
  const dayCount = startDate.until(endDate, { largestUnit: 'days' }).days;
  if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 31) {
    throw new Error('Invalid report period length.');
  }
  const timezone = normalizeReportTimezone(requestedTimezone);
  const midnight = Temporal.PlainTime.from('00:00');
  const from = startDate
    .toZonedDateTime({ timeZone: timezone, plainTime: midnight })
    .toInstant()
    .toString();
  const to = endDate
    .toZonedDateTime({ timeZone: timezone, plainTime: midnight })
    .toInstant()
    .toString();
  return {
    type,
    localStartDate: startDate.toString(),
    localEndDate: endDate.toString(),
    from,
    to,
    timezone,
    dayCount,
  };
}

export function resolveReportPeriod(
  type: ScientificReportType,
  localDate: string,
  requestedTimezone: string,
): ReportPeriod {
  const anchor = parseLocalDate(localDate);
  const start = type === 'weekly'
    ? anchor.subtract({ days: anchor.dayOfWeek - 1 })
    : anchor;
  const end = start.add({ days: type === 'weekly' ? 7 : 1 });
  return reportPeriodFromDates(type, start.toString(), end.toString(), requestedTimezone);
}

export function enumeratePeriodDates(period: ReportPeriod): readonly string[] {
  const output: string[] = [];
  let cursor = parseLocalDate(period.localStartDate);
  const end = parseLocalDate(period.localEndDate);
  while (Temporal.PlainDate.compare(cursor, end) < 0) {
    output.push(cursor.toString());
    cursor = cursor.add({ days: 1 });
  }
  return output;
}

export function nextDailyPeriod(period: ReportPeriod): ReportPeriod {
  const start = parseLocalDate(period.localEndDate);
  return reportPeriodFromDates(
    'daily',
    start.toString(),
    start.add({ days: 1 }).toString(),
    period.timezone,
  );
}

export function fourWeekPeriods(period: ReportPeriod): readonly ReportPeriod[] {
  const lastIncludedDay = parseLocalDate(period.localEndDate).subtract({ days: 1 });
  const currentWeekStart = lastIncludedDay.subtract({ days: lastIncludedDay.dayOfWeek - 1 });
  const output: ReportPeriod[] = [];
  for (let offset = 3; offset >= 0; offset -= 1) {
    const start = currentWeekStart.subtract({ weeks: offset });
    output.push(reportPeriodFromDates(
      'weekly',
      start.toString(),
      start.add({ days: 7 }).toString(),
      period.timezone,
    ));
  }
  return output;
}

export function instantEpochMilliseconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  try {
    return Number(Temporal.Instant.from(value).epochMilliseconds);
  } catch {
    return null;
  }
}

export function localDateForEpoch(epochMilliseconds: number, timezone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds)
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .toString();
}

export function localHourForEpoch(epochMilliseconds: number, timezone: string): number {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds)
    .toZonedDateTimeISO(timezone)
    .hour;
}

export function localWeekdayForEpoch(epochMilliseconds: number, timezone: string): number {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds)
    .toZonedDateTimeISO(timezone)
    .dayOfWeek;
}

export function weekdayLabel(dayOfWeek: number): string {
  return WEEKDAY_LABELS[dayOfWeek - 1] ?? 'Unknown';
}

export function timeOfDayBucket(hour: number): TimeOfDayBucket {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 24) return 'evening';
  return 'night';
}

export function localEndOfDayEpoch(localDate: string, timezone: string): number {
  const next = parseLocalDate(localDate).add({ days: 1 });
  return Number(next.toZonedDateTime({
    timeZone: timezone,
    plainTime: Temporal.PlainTime.from('00:00'),
  }).toInstant().epochMilliseconds) - 1;
}

export function localDateIsLastOfMonth(localDate: string): boolean {
  const date = parseLocalDate(localDate);
  return date.add({ days: 1 }).month !== date.month;
}
