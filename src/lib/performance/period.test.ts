import { describe, it, expect } from 'vitest';
import {
  addDays,
  addMonths,
  countDays,
  dayKey,
  enumerateDays,
  enumerateMonths,
  isoWeekNumber,
  monthKey,
  navigatePeriod,
  resolvePeriod,
  shiftByPeriod,
  startOfWeek,
} from './period';

// Local-time constructor helper (year, monthIndex, day, hour?, min?)
const d = (y: number, m: number, day: number, h = 0, min = 0) => new Date(y, m, day, h, min);

describe('period boundaries', () => {
  it('weeks start on Monday and end on the next Monday (exclusive)', () => {
    // Wed 2025-10-15
    const period = resolvePeriod(d(2025, 9, 15), 'week', d(2025, 9, 15, 12));
    expect(dayKey(period.start)).toBe('2025-10-13');
    expect(dayKey(period.end)).toBe('2025-10-20');
    expect(period.isCurrent).toBe(true);
    expect(period.isPartial).toBe(true);
  });

  it('a Sunday belongs to the week starting the previous Monday', () => {
    expect(dayKey(startOfWeek(d(2025, 9, 19)))).toBe('2025-10-13'); // Sun Oct 19
  });

  it('handles a week spanning two months', () => {
    const period = resolvePeriod(d(2025, 9, 1), 'week', d(2025, 11, 1));
    expect(dayKey(period.start)).toBe('2025-09-29');
    expect(dayKey(period.end)).toBe('2025-10-06');
    expect(period.isCurrent).toBe(false);
    expect(period.isPartial).toBe(false);
  });

  it('resolves month boundaries including the 31st', () => {
    const period = resolvePeriod(d(2025, 0, 31), 'month', d(2025, 5, 1));
    expect(dayKey(period.start)).toBe('2025-01-01');
    expect(dayKey(period.end)).toBe('2025-02-01');
    expect(countDays(period.start, period.end)).toBe(31);
  });

  it('handles leap-year February', () => {
    const period = resolvePeriod(d(2024, 1, 10), 'month', d(2025, 0, 1));
    expect(countDays(period.start, period.end)).toBe(29);
    expect(enumerateDays(period.start, period.end)).toHaveLength(29);
  });

  it('resolves year boundaries and leap-year length', () => {
    const year = resolvePeriod(d(2024, 6, 4), 'year', d(2025, 0, 1));
    expect(dayKey(year.start)).toBe('2024-01-01');
    expect(dayKey(year.end)).toBe('2025-01-01');
    expect(countDays(year.start, year.end)).toBe(366);
    expect(enumerateMonths(year.start, year.end)).toHaveLength(12);
  });
});

describe('DST transitions (Europe/Rome local time)', () => {
  // In 2025 Rome springs forward on Mar 30 and falls back on Oct 26.
  it('keeps 7 unique day keys across the spring-forward week', () => {
    const period = resolvePeriod(d(2025, 2, 27), 'week', d(2025, 5, 1)); // week Mar 24–30
    const days = enumerateDays(period.start, period.end);
    expect(days).toHaveLength(7);
    const keys = days.map(dayKey);
    expect(new Set(keys).size).toBe(7);
    expect(keys[6]).toBe('2025-03-30');
    // Every enumerated day starts at local midnight even across the shift.
    for (const day of days) expect(day.getHours()).toBe(0);
  });

  it('keeps 7 unique day keys across the fall-back week', () => {
    const period = resolvePeriod(d(2025, 9, 22), 'week', d(2025, 11, 1)); // week Oct 20–26
    const days = enumerateDays(period.start, period.end);
    expect(days).toHaveLength(7);
    expect(days.map(dayKey)[6]).toBe('2025-10-26');
    expect(countDays(period.start, period.end)).toBe(7);
  });
});

describe('comparison window (partial periods)', () => {
  it('clips the previous month to the same elapsed span', () => {
    const now = d(2025, 9, 14, 15, 30); // Oct 14, 15:30
    const period = resolvePeriod(now, 'month', now);
    expect(dayKey(period.comparisonStart)).toBe('2025-09-01');
    // Same elapsed calendar span: through Sep 14, 15:30.
    expect(dayKey(period.comparisonEnd)).toBe('2025-09-14');
    expect(period.comparisonEnd.getHours()).toBe(15);
  });

  it('uses the full previous period when the period is complete', () => {
    const now = d(2025, 11, 1);
    const period = resolvePeriod(d(2025, 9, 10), 'month', now);
    expect(dayKey(period.comparisonStart)).toBe('2025-09-01');
    expect(dayKey(period.comparisonEnd)).toBe('2025-10-01');
  });

  it('compares year-to-date against the same span of the previous year', () => {
    const now = d(2025, 6, 1, 9); // Jul 1, 09:00
    const period = resolvePeriod(now, 'year', now);
    expect(dayKey(period.comparisonStart)).toBe('2024-01-01');
    expect(dayKey(period.comparisonEnd)).toBe('2024-07-01');
  });
});

describe('navigation and calendar arithmetic', () => {
  it('navigates to previous and next periods', () => {
    const now = d(2025, 9, 15, 12);
    const current = resolvePeriod(now, 'week', now);
    const prev = navigatePeriod(current, -1, now);
    const next = navigatePeriod(current, 1, now);
    expect(dayKey(prev.start)).toBe('2025-10-06');
    expect(dayKey(next.start)).toBe('2025-10-20');
    expect(prev.isCurrent).toBe(false);
    expect(next.isPartial).toBe(true); // future period has not elapsed
  });

  it('clamps month-end when adding months', () => {
    expect(dayKey(addMonths(d(2025, 0, 31), 1))).toBe('2025-02-28');
    expect(dayKey(addMonths(d(2024, 0, 31), 1))).toBe('2024-02-29');
    expect(dayKey(shiftByPeriod(d(2025, 2, 31), 'month', -1))).toBe('2025-02-28');
  });

  it('addDays crosses month and year borders', () => {
    expect(dayKey(addDays(d(2025, 11, 31), 1))).toBe('2026-01-01');
    expect(monthKey(addDays(d(2025, 11, 31), 1))).toBe('2026-01');
  });
});

describe('isoWeekNumber', () => {
  it('matches known ISO week values', () => {
    expect(isoWeekNumber(d(2025, 0, 1))).toBe(1); // Wed Jan 1 2025 → W1
    expect(isoWeekNumber(d(2024, 11, 30))).toBe(1); // Mon Dec 30 2024 → W1 of 2025
    expect(isoWeekNumber(d(2025, 9, 13))).toBe(42);
    expect(isoWeekNumber(d(2026, 0, 1))).toBe(1);
  });
});
