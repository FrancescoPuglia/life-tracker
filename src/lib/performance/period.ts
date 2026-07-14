// src/lib/performance/period.ts
//
// Period boundary math for the Performance Review section.
//
// All arithmetic uses LOCAL calendar time via Date setters (setDate /
// setMonth / setFullYear), which the JS engine resolves against the
// device timezone — Europe/Rome for this app's user. That keeps day
// boundaries correct across DST transitions (23h/25h days) without a
// timezone library: we never add raw milliseconds to cross day borders.
//
// Weeks start on Monday and end on Sunday (ISO-8601), matching
// `WeeklyExecution.getWeekBounds`. Period ends are EXCLUSIVE ([start, end)).

import type { PerformancePeriod, PerformancePeriodType } from './types';

/** Midnight (00:00:00.000 local) of the given date. */
export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Midnight of the Monday of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return d;
}

export function startOfMonth(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
}

export function startOfYear(date: Date): Date {
  const d = startOfDay(date);
  d.setMonth(0, 1);
  return d;
}

/** Add whole calendar days (DST-safe: uses setDate). */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const targetDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  // Clamp to the target month's length (Jan 31 + 1 month → Feb 28/29).
  const daysInTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(targetDay, daysInTarget));
  return d;
}

export function addYears(date: Date, years: number): Date {
  return addMonths(date, years * 12);
}

/** 'YYYY-MM-DD' in local time (never toISOString — that would shift by UTC). */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM' in local time. */
export function monthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Whole calendar days in [start, end) — DST-safe (counts midnights). */
export function countDays(start: Date, end: Date): number {
  let count = 0;
  let cursor = startOfDay(start);
  while (cursor.getTime() < end.getTime()) {
    cursor = addDays(cursor, 1);
    count += 1;
  }
  return count;
}

/** Shift a timestamp back/forward by exactly one period, calendar-aligned. */
export function shiftByPeriod(date: Date, type: PerformancePeriodType, offset: number): Date {
  if (type === 'week') return addDays(date, 7 * offset);
  if (type === 'month') return addMonths(date, offset);
  return addYears(date, offset);
}

function periodStart(anchor: Date, type: PerformancePeriodType): Date {
  if (type === 'week') return startOfWeek(anchor);
  if (type === 'month') return startOfMonth(anchor);
  return startOfYear(anchor);
}

/**
 * Resolve the period of the given `type` containing `anchor`, with the
 * aligned comparison window against the previous period (see glossary in
 * `types.ts`). `now` is injectable for tests.
 */
export function resolvePeriod(
  anchor: Date,
  type: PerformancePeriodType,
  now: Date = new Date()
): PerformancePeriod {
  const start = periodStart(anchor, type);
  const end = shiftByPeriod(start, type, 1);

  const isCurrent = now.getTime() >= start.getTime() && now.getTime() < end.getTime();
  // Partial = the period has not fully elapsed yet (current or future).
  const isPartial = end.getTime() > now.getTime();

  const comparisonStart = shiftByPeriod(start, type, -1);
  // Full previous period by default; when the current period is still
  // running, clip the comparison window to the same elapsed calendar span
  // by shifting `now` back one period (calendar-aligned, DST-safe).
  let comparisonEnd = start;
  if (isCurrent) {
    const shiftedNow = shiftByPeriod(now, type, -1);
    comparisonEnd = new Date(
      Math.min(Math.max(shiftedNow.getTime(), comparisonStart.getTime()), start.getTime())
    );
  }

  return { type, start, end, isCurrent, isPartial, comparisonStart, comparisonEnd };
}

/** The period adjacent to `period` (offset −1 = previous, +1 = next). */
export function navigatePeriod(
  period: PerformancePeriod,
  offset: number,
  now: Date = new Date()
): PerformancePeriod {
  return resolvePeriod(shiftByPeriod(period.start, period.type, offset), period.type, now);
}

/** Every day of [start, end) as day starts (length = countDays). */
export function enumerateDays(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  let cursor = startOfDay(start);
  while (cursor.getTime() < end.getTime()) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** Every month start of [start, end) (used by the year view). */
export function enumerateMonths(start: Date, end: Date): Date[] {
  const months: Date[] = [];
  let cursor = startOfMonth(start);
  while (cursor.getTime() < end.getTime()) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return months;
}

/** ISO-8601 week number (for the week period label). */
export function isoWeekNumber(date: Date): number {
  // Thursday of the same ISO week determines the year/week pairing.
  const d = startOfDay(date);
  const dayNumber = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dayNumber + 3);
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const firstDayNumber = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNumber + 3);
  const diffMs = d.getTime() - firstThursday.getTime();
  return 1 + Math.round(diffMs / (7 * 24 * 3600 * 1000));
}
