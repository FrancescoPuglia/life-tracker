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
      className="h-full flex flex-col rounded-xl border border-slate-200 bg-white px-4 py-3 min-w-0"
      title={title}
      data-testid={testId}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 truncate">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-slate-900 leading-none tabular-nums">{value}</div>
      <div className="mt-auto pt-1.5 flex items-baseline gap-1.5 text-xs leading-snug">
        {delta !== undefined && (
          <span className={`font-semibold tabular-nums shrink-0 ${deltaClass}`}>{delta}</span>
        )}
        {sub && <span className="text-slate-400 truncate">{sub}</span>}
      </div>
    </div>
  );
}

export default function PerfKpiGrid({ summary, previous, dataQuality, isPartial }: PerfKpiGridProps) {
  // Short on the card, spelled out in the tooltip (title) of each tile.
  const vsLabel = isPartial ? 'rispetto al precedente alla stessa data' : 'rispetto al periodo precedente';
  const vsExplainer = isPartial
    ? ' Comparison uses the same elapsed span of the previous period (first N days vs first N days).'
    : ' Comparison uses the full previous period.';

  const fulfillmentDelta =
    summary.planFulfillmentRate !== null && previous.planFulfillmentRate !== null
      ? summary.planFulfillmentRate - previous.planFulfillmentRate
      : null;
  const actualIsPartial = dataQuality.actualAvailability === 'partial';
  const partialReason = actualIsPartial
    ? ` Execution evidence is partial (${dataQuality.blocksMissingActualCount} executed blocks missing actual, ${dataQuality.openSessionCount} open sessions, ${dataQuality.anomalousDurationCount} invalid intervals), so this is a measured lower bound.`
    : '';

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5"
      data-testid="perf-kpi-grid"
      role="group"
      aria-label="Indicatori principali di rendimento"
    >
      <Tile
        testId="kpi-actual"
        label={actualIsPartial ? 'Eseguito noto' : 'Eseguito'}
        value={formatMinutes(summary.actualMinutes)}
        delta={`${formatSignedMinutes(summary.actualMinutes - previous.actualMinutes)}`}
        sub={vsLabel}
        title={`Actual = completed Session net time plus an explicit block actual interval only when no valid linked Session exists. Planned windows are never actual fallback.${partialReason}${vsExplainer}`}
      />
      <Tile
        testId="kpi-planned"
        label="Pianificato"
        value={formatMinutes(summary.plannedMinutes)}
        delta={formatSignedMinutes(summary.plannedMinutes - previous.plannedMinutes)}
        sub={vsLabel}
        title={`Planned = time blocks scheduled in advance (created before their start), minus cancelled blocks and breaks, clipped to the period.${vsExplainer}`}
      />
      <Tile
        testId="kpi-execution"
        label="Piano ed esecuzione"
        value={formatPercent(summary.executionRatio)}
        delta={formatSignedMinutes(summary.varianceMinutes)}
        sub={
          isPartial && summary.executionRatioToDate !== null
            ? `scarto · ${formatPercent(summary.executionRatioToDate)} del piano a oggi`
            : 'scarto'
        }
        title={`Execution ratio = known actual ÷ planned (full period). Variance = known actual − planned. While the period is in progress, 'of plan to date' compares actual against only the plan matured so far. Shown as — when nothing was planned; over 100% is not automatically good.${actualIsPartial ? ' Actual evidence is partial, so interpret this ratio as a lower bound.' : ''}`}
      />
      <Tile
        testId="kpi-tasks"
        label="Attività pianificate completate"
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
        title={`Tasks due in the period or scheduled by planned blocks, completed on time (by their due date, or by period end when they have none).${vsExplainer}`}
      />
      <Tile
        testId="kpi-unplanned"
        label="Non pianificato"
        value={formatMinutes(summary.unplannedMinutes)}
        delta={
          summary.actualMinutes > 0
            ? formatPercent(summary.unplannedMinutes / summary.actualMinutes)
            : undefined
        }
        sub="dell’eseguito"
        title="Executed time with no advance plan: retro-logged blocks plus sessions not linked to any block."
      />
      <Tile
        testId="kpi-active-days"
        label="Giorni attivi"
        value={`${summary.activeDays}/${summary.elapsedDays}`}
        delta={`${summary.activeDays - previous.activeDays >= 0 ? '+' : ''}${summary.activeDays - previous.activeDays}`}
        sub={vsLabel}
        title={`Elapsed days with at least one executed block/session or one completed task.${vsExplainer}`}
      />
      <Tile
        testId="kpi-coverage"
        label="Copertura evidenze"
        value={formatPercent(dataQuality.coverageRate)}
        sub={
          dataQuality.coverageRate !== null
            ? `${dataQuality.actualSourceCount} fonti · ${formatMinutes(dataQuality.measuredMinutes)}`
            : 'nessuna esecuzione registrata'
        }
        title="Valid completed Session or explicit-block actual sources divided by those sources plus executed blocks missing actual evidence. Missing evidence is never replaced with planned duration."
      />
    </div>
  );
}
