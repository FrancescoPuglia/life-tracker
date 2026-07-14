// src/lib/performance/format.ts
//
// Human formatting for the Performance Review section. All quantities are
// minutes/ratios internally; only this module (used by the UI) turns them
// into "12h 30m" / "83%" strings. Never returns 'NaN' or 'Infinity'.

import { isoWeekNumber } from './period';
import type { PerformancePeriod } from './types';

/** U+2212 minus sign — typographically correct for negative quantities. */
const MINUS = '−';

/** 753 → "12h 33m", 45 → "45m", 120 → "2h", −135 → "−2h 15m", 0 → "0m". */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) return '—';
  const rounded = Math.round(Math.abs(minutes));
  const sign = minutes < 0 && rounded > 0 ? MINUS : '';
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}

/** Signed variant: +90 → "+1h 30m", −45 → "−45m", 0 → "0m". */
export function formatSignedMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) return '—';
  const rounded = Math.round(minutes);
  if (rounded > 0) return `+${formatMinutes(rounded)}`;
  return formatMinutes(rounded);
}

/** 0.834 → "83%", null → "—". Ratio is 0..n (can exceed 1). */
export function formatPercent(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 100)}%`;
}

/** Delta between two rates in percentage points: +0.12 → "+12 pt". */
export function formatPointsDelta(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return '—';
  const points = Math.round(delta * 100);
  if (points > 0) return `+${points} pt`;
  if (points < 0) return `${MINUS}${Math.abs(points)} pt`;
  return '0 pt';
}

/** Axis tick: 90 → "1.5h", 60 → "1h", 30 → "30m", 0 → "0". */
export function formatAxisMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes === 0) return '0';
  if (Math.abs(minutes) < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

/** "Mon, Oct 14" */
export function formatDayLong(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Oct 14" */
export function formatDayShort(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Header label: week "13–19 Oct 2025 · W42", month "October 2025", year "2025". */
export function formatPeriodLabel(period: PerformancePeriod): string {
  const { type, start, end } = period;
  const lastDay = new Date(end.getTime() - 1);
  if (type === 'year') return String(start.getFullYear());
  if (type === 'month') {
    return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  const monthShort = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' });
  const week = `W${isoWeekNumber(start)}`;
  const sameMonth =
    start.getMonth() === lastDay.getMonth() && start.getFullYear() === lastDay.getFullYear();
  if (sameMonth) {
    return `${start.getDate()}–${lastDay.getDate()} ${monthShort(lastDay)} ${lastDay.getFullYear()} · ${week}`;
  }
  return `${start.getDate()} ${monthShort(start)} – ${lastDay.getDate()} ${monthShort(lastDay)} ${lastDay.getFullYear()} · ${week}`;
}

/** Relative "3d ago" / "today" for last-activity cells. */
export function formatDaysAgo(date: Date | null, now: Date = new Date()): string {
  if (!date) return 'never';
  const ms = now.getTime() - date.getTime();
  const days = Math.floor(ms / (24 * 3600 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}
