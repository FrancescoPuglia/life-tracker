// src/components/performance/theme.ts
//
// Chart color roles for the Performance Review section.
//
// Method (dataviz skill): every color does exactly one job. The main chart is
// an EMPHASIS form — Actual (the story) wears the brand accent, Planned (the
// reference) wears a deliberate de-emphasis gray, Unplanned wears a separate
// hue because it is a different provenance, not a rank.
//
// Palette validated with the dataviz validator on the white card surface:
//   #3b82f6 + #f59e0b → CVD worst pair ΔE 132.6 (target ≥ 12) — PASS.
//   #f59e0b is 2.15:1 vs white (sub-3:1) → relief rule: values are always
//   readable via tooltips, direct labels and the activity table (never
//   color-gated). #64748b (planned gray) is context, not identity: its low
//   chroma is intentional (emphasis pattern), contrast 4.75:1 ≥ 3:1.

export const CHART_COLORS = {
  /** Planned time — context reference (de-emphasis gray, slate-500). */
  planned: 'var(--lt-chart-planned)',
  /** Lighter planned for not-yet-elapsed days (plan still open). */
  plannedFuture: 'var(--lt-chart-planned-future)',
  /** Executed time that was planned in advance (brand accent, blue-500). */
  actual: 'var(--lt-chart-actual)',
  /** Cumulative actual line (blue-600 for a firmer 2px stroke). */
  actualLine: 'var(--lt-chart-actual-strong)',
  /** Executed time that was NOT planned in advance (amber-500). */
  unplanned: 'var(--lt-chart-unplanned)',
  /** Hairline grid (slate-200) — solid, recessive. */
  grid: 'var(--lt-chart-grid)',
  /** Axis ink (slate-400). */
  axis: 'var(--lt-chart-axis)',
  /** Today reference line (blue-300). */
  today: '#93c5fd',
} as const;

/** Sequential blue ramp (Tailwind blue 100→700) for the consistency heatmap. */
export const HEAT_RAMP = [
  'var(--lt-chart-heat-1)',
  'var(--lt-chart-heat-2)',
  'var(--lt-chart-heat-3)',
  'var(--lt-chart-heat-4)',
  'var(--lt-chart-heat-5)',
  'var(--lt-chart-heat-6)',
  'var(--lt-chart-heat-7)',
];
/** Empty day cell (slate-100). */
export const HEAT_EMPTY = 'var(--lt-chart-empty)';

import type { EntityStatus, InsightKind } from '@/lib/performance/types';

export interface StatusMeta {
  label: string;
  /** Tailwind classes for the chip (bg + text). Never color-alone: label + symbol ride along. */
  className: string;
  /** Short textual symbol so state survives grayscale. */
  symbol: string;
}

export const STATUS_META: Record<EntityStatus, StatusMeta> = {
  ahead: { label: 'In anticipo', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', symbol: '▲' },
  'on-track': { label: 'In linea', className: 'bg-blue-50 text-blue-700 border-blue-200', symbol: '●' },
  behind: { label: 'In ritardo', className: 'bg-red-50 text-red-700 border-red-200', symbol: '▼' },
  /** Plan exists but is entirely in the future — nothing exigible today. */
  'not-due': { label: 'Non ancora dovuto', className: 'bg-slate-50 text-slate-500 border-slate-200', symbol: '◷' },
  'no-plan': { label: 'Nessun piano', className: 'bg-amber-50 text-amber-700 border-amber-200', symbol: '◇' },
  inactive: { label: 'Inattivo', className: 'bg-slate-100 text-slate-600 border-slate-200', symbol: '⏸' },
  'no-data': { label: 'Nessun dato', className: 'bg-slate-50 text-slate-500 border-slate-200', symbol: '–' },
};

export const INSIGHT_META: Record<InsightKind, { className: string; iconClassName: string }> = {
  positive: { className: 'border-emerald-200 bg-emerald-50/60', iconClassName: 'text-emerald-600' },
  warning: { className: 'border-amber-200 bg-amber-50/60', iconClassName: 'text-amber-600' },
  information: { className: 'border-blue-200 bg-blue-50/60', iconClassName: 'text-blue-600' },
  'data-quality': { className: 'border-slate-200 bg-slate-50/80', iconClassName: 'text-slate-500' },
};

import { formatMinutes } from '@/lib/performance/format';

/**
 * Native-tooltip explanation of a status chip, with the numbers that
 * produced it (formula lives in metrics.entityStatus — this only narrates).
 */
export function describeStatus(
  status: EntityStatus,
  row: { plannedMinutes: number; plannedElapsedMinutes: number; actualMinutes: number }
): string {
  const done = formatMinutes(row.actualMinutes);
  const toDate = formatMinutes(row.plannedElapsedMinutes);
  switch (status) {
    case 'ahead':
      return `In anticipo sul piano di oggi: ${done} eseguiti rispetto a ${toDate} pianificati finora.`;
    case 'on-track':
      return `In linea con il piano di oggi: ${done} eseguiti rispetto a ${toDate} pianificati finora.`;
    case 'behind':
      return `In ritardo a oggi: ${done} eseguiti rispetto a ${toDate} pianificati finora (piano completo ${formatMinutes(row.plannedMinutes)}).`;
    case 'not-due':
      return `Nulla è ancora dovuto: ${formatMinutes(row.plannedMinutes)} pianificati sono più avanti nel periodo.`;
    case 'no-plan':
      return `${done} eseguiti senza tempo pianificato nel periodo.`;
    case 'inactive':
      return 'Attività aperte ma nessuna esecuzione tracciata da oltre 14 giorni.';
    case 'no-data':
      return 'Nessun piano e nessuna esecuzione nel periodo.';
  }
}

/** Quantize a value into the heat ramp; returns HEAT_EMPTY for zero/absent. */
export function heatColor(value: number, max: number): string {
  if (!Number.isFinite(value) || value <= 0 || max <= 0) return HEAT_EMPTY;
  const idx = Math.min(
    HEAT_RAMP.length - 1,
    Math.floor((value / max) * HEAT_RAMP.length)
  );
  return HEAT_RAMP[idx];
}

/** Ratio-of-plan bins: 0 · <50% · <80% · <100% · ≥100% (fixed, documented). */
export function heatRatioColor(ratio: number | null): string {
  if (ratio === null || ratio <= 0) return HEAT_EMPTY;
  if (ratio < 0.5) return HEAT_RAMP[1];
  if (ratio < 0.8) return HEAT_RAMP[2];
  if (ratio < 1) return HEAT_RAMP[4];
  return HEAT_RAMP[6];
}
