'use client';

// Executive summary — a KPI row of stat tiles.
// Contract per tile: label · value · sub-line · delta vs the aligned previous
// window. Time deltas stay in neutral ink (more hours is not automatically
// good); only rate metrics with an unambiguous direction get semantic color.
// Every tile carries its glossary formula in a native tooltip (title).

import type { PerformanceDataQuality, PerformanceSummary } from '@/lib/performance/types';
import {
  formatMinutes,
  formatPercent,
  formatPointsDelta,
  formatSignedMinutes,
} from '@/lib/performance/format';

interface PerfKpiGridProps {
  summary: PerformanceSummary;
  previous: PerformanceSummary;
  dataQuality: PerformanceDataQuality;
  isPartial: boolean;
}

interface TileProps {
  label: string;
  value: string;
  sub?: string;
  delta?: string;
  deltaTone?: 'neutral' | 'good' | 'bad';
  title: string;
  testId: string;
}

function Tile({ label, value, sub, delta, deltaTone = 'neutral', title, testId }: TileProps) {
  const deltaClass =
    deltaTone === 'good'
      ? 'text-emerald-700'
      : deltaTone === 'bad'
        ? 'text-red-600'
        : 'text-slate-500';
  return (
    <div
      className="rounded-xl border border-slate-200 bg-white px-4 py-3 min-w-[148px]"
      title={title}
      data-testid={testId}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900 leading-none">{value}</div>
      <div className="mt-1.5 flex items-baseline gap-2 text-xs">
        {delta !== undefined && <span className={`font-semibold ${deltaClass}`}>{delta}</span>}
        {sub && <span className="text-slate-400">{sub}</span>}
      </div>
    </div>
  );
}

export default function PerfKpiGrid({ summary, previous, dataQuality, isPartial }: PerfKpiGridProps) {
  const vsLabel = isPartial ? 'vs same elapsed span of previous period' : 'vs previous period';

  const fulfillmentDelta =
    summary.planFulfillmentRate !== null && previous.planFulfillmentRate !== null
      ? summary.planFulfillmentRate - previous.planFulfillmentRate
      : null;

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-2.5"
      data-testid="perf-kpi-grid"
      role="group"
      aria-label="Key performance indicators"
    >
      <Tile
        testId="kpi-actual"
        label="Actual"
        value={formatMinutes(summary.actualMinutes)}
        delta={`${formatSignedMinutes(summary.actualMinutes - previous.actualMinutes)}`}
        sub={vsLabel}
        title="Actual = executed time from completed/overrun blocks (real timestamps when present, planned window otherwise) + ad-hoc sessions, clipped to the period."
      />
      <Tile
        testId="kpi-planned"
        label="Planned"
        value={formatMinutes(summary.plannedMinutes)}
        delta={formatSignedMinutes(summary.plannedMinutes - previous.plannedMinutes)}
        sub={vsLabel}
        title="Planned = time blocks scheduled in advance (created before their start), minus cancelled blocks and breaks, clipped to the period."
      />
      <Tile
        testId="kpi-execution"
        label="Plan vs actual"
        value={formatPercent(summary.executionRatio)}
        delta={formatSignedMinutes(summary.varianceMinutes)}
        sub="variance"
        title="Execution ratio = actual ÷ planned. Variance = actual − planned. Shown as — when nothing was planned; over 100% is not automatically good."
      />
      <Tile
        testId="kpi-tasks"
        label="Planned tasks done"
        value={
          summary.plannedTasks > 0
            ? `${summary.completedPlannedTasks}/${summary.plannedTasks}`
            : '—'
        }
        delta={summary.planFulfillmentRate !== null ? formatPercent(summary.planFulfillmentRate) : undefined}
        deltaTone={
          fulfillmentDelta === null ? 'neutral' : fulfillmentDelta >= 0 ? 'good' : 'bad'
        }
        sub={
          fulfillmentDelta !== null ? `${formatPointsDelta(fulfillmentDelta)} ${vsLabel}` : undefined
        }
        title="Tasks due in the period or scheduled by planned blocks, completed on time (by their due date, or by period end when they have none)."
      />
      <Tile
        testId="kpi-unplanned"
        label="Unplanned"
        value={formatMinutes(summary.unplannedMinutes)}
        delta={
          summary.actualMinutes > 0
            ? formatPercent(summary.unplannedMinutes / summary.actualMinutes)
            : undefined
        }
        sub="of actual"
        title="Executed time with no advance plan: retro-logged blocks plus sessions not linked to any block."
      />
      <Tile
        testId="kpi-active-days"
        label="Active days"
        value={`${summary.activeDays}/${summary.elapsedDays}`}
        delta={`${summary.activeDays - previous.activeDays >= 0 ? '+' : ''}${summary.activeDays - previous.activeDays}`}
        sub={vsLabel}
        title="Elapsed days with at least one executed block/session or one completed task."
      />
      <Tile
        testId="kpi-coverage"
        label="Data coverage"
        value={formatPercent(dataQuality.coverageRate)}
        sub={
          dataQuality.coverageRate !== null
            ? `${formatMinutes(dataQuality.measuredMinutes)} measured`
            : 'no actual time'
        }
        title="Share of actual time backed by real start/end timestamps rather than the planned-window fallback. Low coverage = treat exact durations with care."
      />
    </div>
  );
}
