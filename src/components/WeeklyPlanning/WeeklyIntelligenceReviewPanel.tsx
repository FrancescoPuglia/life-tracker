'use client';

// src/components/WeeklyPlanning/WeeklyIntelligenceReviewPanel.tsx
// Plan-vs-actual review for the current week's WPI-tagged TimeBlocks.
// Reads no state — the parent owns the computation and passes `result`.

import type {
  CalibrationLabel,
  WpiAnalyticsResult,
} from '@/lib/weeklyPlanner';
import {
  dayLabelLong,
  dayLabelShort,
  minutesToHoursLabel,
} from './weeklyPlanningUi';

export interface WeeklyIntelligenceReviewPanelProps {
  result: WpiAnalyticsResult | null;
}

export default function WeeklyIntelligenceReviewPanel({
  result,
}: WeeklyIntelligenceReviewPanelProps) {
  return (
    <section
      aria-label="Weekly Intelligence Review"
      className="rounded-2xl border border-gray-100 bg-white/80 backdrop-blur-sm shadow-sm overflow-hidden"
      data-testid="weekly-intelligence-review-panel"
    >
      <header className="border-b border-gray-100 px-5 py-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Weekly Intelligence Review
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Compare generated plans with real execution. Misura solo i
            TimeBlock taggati con WPI_KEY.
          </p>
        </div>
        {result && (
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
            week {result.weekly.weekStartISO}
          </span>
        )}
      </header>

      {!result || result.weekly.generatedBlocks === 0 ? (
        <EmptyState />
      ) : (
        <ReviewContent result={result} />
      )}
    </section>
  );
}

// ============================================================================
// EMPTY STATE
// ============================================================================

function EmptyState() {
  return (
    <div
      className="px-5 py-8 text-center"
      data-testid="wpi-review-empty-state"
    >
      <p className="text-sm font-medium text-gray-700">
        No Weekly Intelligence TimeBlocks found for this week yet.
      </p>
      <p className="text-xs text-gray-500 mt-1.5 max-w-md mx-auto">
        Genera e approva una bozza per iniziare a misurare il rapporto fra
        piano e esecuzione reale.
      </p>
    </div>
  );
}

// ============================================================================
// MAIN CONTENT
// ============================================================================

function ReviewContent({ result }: { result: WpiAnalyticsResult }) {
  const { weekly, calibration, hasDraft } = result;

  return (
    <div className="p-5 space-y-5">
      {!hasDraft && (
        <p
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          data-testid="wpi-review-partial-data"
        >
          Draft not found. Showing execution analytics from WPI-tagged
          TimeBlocks only.
        </p>
      )}

      {/* KPI cards */}
      <div
        className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6"
        data-testid="wpi-review-kpis"
      >
        <Kpi
          label="WPI blocks"
          value={weekly.generatedBlocks}
          sublabel={`${weekly.completedBlocks} completed · ${weekly.missedBlocks} missed`}
        />
        <Kpi
          label="Completion rate"
          value={`${pct(weekly.completionRate)}%`}
          sublabel="by block count"
          highlight
        />
        <Kpi
          label="Planned hours"
          value={minutesToHoursLabel(weekly.totalPlannedMinutes)}
          sublabel={`avg ${Math.round(weekly.averageBlockMinutes)} min`}
        />
        <Kpi
          label="Completed hours"
          value={minutesToHoursLabel(weekly.completedMinutes)}
          sublabel={`${pct(weekly.minuteCompletionRate)}% of planned`}
        />
        <Kpi
          label="Goal coverage"
          value={`${pct(weekly.goalCoverageRate)}%`}
          sublabel={`${weekly.goalLinkedBlocks} of ${weekly.generatedBlocks}`}
        />
        <Kpi
          label="Calibration"
          value={
            <CalibrationBadge label={calibration.label} compact />
          }
          sublabel={
            calibration.calibrationGap !== undefined
              ? `gap ${formatGap(calibration.calibrationGap)}`
              : '—'
          }
        />
      </div>

      {/* Day breakdown */}
      <DayBreakdown result={result} />

      {/* Calibration card */}
      <CalibrationCard result={result} />

      {/* Notes */}
      {weekly.notes.length > 0 && (
        <div className="rounded-lg border border-gray-100 bg-gray-50/70 px-3 py-2">
          <h4 className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
            Note
          </h4>
          <ul className="text-xs text-gray-600 space-y-0.5">
            {weekly.notes.slice(0, 5).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// KPI card
// ============================================================================

function Kpi({
  label,
  value,
  sublabel,
  highlight = false,
}: {
  label: string;
  value: string | number | React.ReactNode;
  sublabel?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2 ${highlight ? 'border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50' : 'border-gray-100 bg-white'}`}
    >
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        {label}
      </p>
      <p
        className={`mt-1 text-base font-bold tabular-nums ${highlight ? 'text-blue-700' : 'text-gray-900'}`}
      >
        {value}
      </p>
      {sublabel && (
        <p className="text-[10px] text-gray-500 mt-0.5">{sublabel}</p>
      )}
    </div>
  );
}

// ============================================================================
// Day breakdown
// ============================================================================

function DayBreakdown({ result }: { result: WpiAnalyticsResult }) {
  const max = Math.max(
    1,
    ...([0, 1, 2, 3, 4, 5, 6] as const).map(
      (d) => result.weekly.dayBreakdown[d].plannedMinutes,
    ),
  );
  return (
    <div data-testid="wpi-review-day-breakdown">
      <h4 className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
        Day breakdown
      </h4>
      <ul className="space-y-1.5">
        {([0, 1, 2, 3, 4, 5, 6] as const).map((d) => {
          const slot = result.weekly.dayBreakdown[d];
          const widthPct = Math.round((slot.plannedMinutes / max) * 100);
          const completedWidthPct =
            slot.plannedMinutes > 0
              ? Math.round((slot.completedMinutes / max) * 100)
              : 0;
          return (
            <li key={d} className="flex items-center gap-2 text-xs">
              <span
                className="w-8 text-gray-500 font-medium tabular-nums"
                title={dayLabelLong(d)}
              >
                {dayLabelShort(d)}
              </span>
              <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden relative">
                <div
                  className="absolute inset-y-0 left-0 bg-blue-100"
                  style={{ width: `${widthPct}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-400 to-blue-500"
                  style={{ width: `${completedWidthPct}%` }}
                />
              </div>
              <span className="w-32 text-right text-gray-600 tabular-nums">
                {minutesToHoursLabel(slot.completedMinutes)} /{' '}
                {minutesToHoursLabel(slot.plannedMinutes)}
              </span>
              <span className="w-10 text-right text-gray-500 tabular-nums">
                {slot.plannedMinutes > 0 ? `${pct(slot.completionRate)}%` : '—'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ============================================================================
// Calibration card
// ============================================================================

function CalibrationCard({ result }: { result: WpiAnalyticsResult }) {
  const { calibration } = result;
  return (
    <div
      className="rounded-xl border border-gray-100 bg-white px-4 py-3"
      data-testid="wpi-review-calibration"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-900">
          Realism calibration
        </h4>
        <CalibrationBadge label={calibration.label} />
      </div>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-3 text-xs text-gray-700">
        <CalibrationStat
          label="Predicted score"
          value={
            calibration.predictedScore !== undefined
              ? `${calibration.predictedScore}/100`
              : '—'
          }
        />
        <CalibrationStat
          label="Actual completion"
          value={`${pct(calibration.actualCompletionRate)}%`}
        />
        <CalibrationStat
          label="Gap"
          value={
            calibration.calibrationGap !== undefined
              ? formatGap(calibration.calibrationGap)
              : '—'
          }
        />
      </div>
      <p className="mt-2 text-xs text-gray-600 italic">{calibration.message}</p>
    </div>
  );
}

function CalibrationStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        {label}
      </p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function CalibrationBadge({
  label,
  compact = false,
}: {
  label: CalibrationLabel;
  compact?: boolean;
}) {
  const cls =
    label === 'well_calibrated'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : label === 'overestimated'
        ? 'border-rose-200 bg-rose-50 text-rose-700'
        : label === 'underestimated'
          ? 'border-sky-200 bg-sky-50 text-sky-700'
          : 'border-gray-200 bg-gray-50 text-gray-600';
  const text =
    label === 'well_calibrated'
      ? 'Well calibrated'
      : label === 'overestimated'
        ? 'Overestimated'
        : label === 'underestimated'
          ? 'Underestimated'
          : 'Insufficient data';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 ${compact ? 'py-0' : 'py-0.5'} text-[11px] font-semibold ${cls}`}
      data-testid="wpi-review-calibration-badge"
    >
      {text}
    </span>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function pct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100);
}

function formatGap(gap: number): string {
  const sign = gap >= 0 ? '+' : '';
  return `${sign}${gap}`;
}
