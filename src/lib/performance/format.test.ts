import { describe, it, expect } from 'vitest';
import {
  formatAxisMinutes,
  formatDaysAgo,
  formatMinutes,
  formatPercent,
  formatPeriodLabel,
  formatPointsDelta,
  formatSignedMinutes,
} from './format';
import { resolvePeriod } from './period';

const d = (y: number, m: number, day: number) => new Date(y, m, day);

describe('formatMinutes', () => {
  it('formats compact hour/minute strings', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(753)).toBe('12h 33m');
  });

  it('uses a typographic minus for negatives and never shows NaN', () => {
    expect(formatMinutes(-135)).toBe('−2h 15m');
    expect(formatMinutes(-0.2)).toBe('0m');
    expect(formatMinutes(Number.NaN)).toBe('—');
    expect(formatMinutes(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatSignedMinutes', () => {
  it('adds an explicit plus only for positive values', () => {
    expect(formatSignedMinutes(90)).toBe('+1h 30m');
    expect(formatSignedMinutes(-45)).toBe('−45m');
    expect(formatSignedMinutes(0)).toBe('0m');
  });
});

describe('formatPercent / formatPointsDelta', () => {
  it('renders ratios and guards nulls', () => {
    expect(formatPercent(0.834)).toBe('83%');
    expect(formatPercent(1.5)).toBe('150%');
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(Number.NaN)).toBe('—');
  });

  it('renders point deltas with sign', () => {
    expect(formatPointsDelta(0.12)).toBe('+12 pt');
    expect(formatPointsDelta(-0.07)).toBe('−7 pt');
    expect(formatPointsDelta(0)).toBe('0 pt');
    expect(formatPointsDelta(null)).toBe('—');
  });
});

describe('formatAxisMinutes', () => {
  it('is compact for chart ticks', () => {
    expect(formatAxisMinutes(0)).toBe('0');
    expect(formatAxisMinutes(30)).toBe('30m');
    expect(formatAxisMinutes(60)).toBe('1h');
    expect(formatAxisMinutes(90)).toBe('1.5h');
    expect(formatAxisMinutes(480)).toBe('8h');
  });
});

describe('formatPeriodLabel', () => {
  it('labels a week inside one month', () => {
    const p = resolvePeriod(d(2025, 9, 15), 'week', d(2025, 9, 15));
    expect(formatPeriodLabel(p)).toBe('13–19 Oct 2025 · W42');
  });

  it('labels a week spanning two months', () => {
    const p = resolvePeriod(d(2025, 9, 1), 'week', d(2025, 9, 1));
    expect(formatPeriodLabel(p)).toBe('29 Sep – 5 Oct 2025 · W40');
  });

  it('labels months and years', () => {
    expect(formatPeriodLabel(resolvePeriod(d(2025, 9, 3), 'month', d(2025, 9, 3)))).toBe(
      'October 2025'
    );
    expect(formatPeriodLabel(resolvePeriod(d(2025, 9, 3), 'year', d(2025, 9, 3)))).toBe('2025');
  });
});

describe('formatDaysAgo', () => {
  const now = new Date(2025, 9, 15, 12);
  it('humanizes relative days', () => {
    expect(formatDaysAgo(null, now)).toBe('never');
    expect(formatDaysAgo(new Date(2025, 9, 15, 8), now)).toBe('today');
    expect(formatDaysAgo(new Date(2025, 9, 14, 8), now)).toBe('yesterday');
    expect(formatDaysAgo(new Date(2025, 9, 1), now)).toBe('14d ago');
  });
});
