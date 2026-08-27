'use client';

// Consistency heatmap — a calendar of execution intensity.
//
// Week: one row of large cells with the value printed inside (no color-only
// reading). Month: a Mon-first calendar grid. Year: a contribution-style
// grid, weeks as columns. One sequential blue ramp; the metric switcher
// changes the data, never the hue. Every cell is a focusable button with a
// full text description; a shared tooltip mirrors it for pointer users.

import { useMemo, useState } from 'react';
import type { PerformanceHeatmapDay, PerformancePeriod } from '@/lib/performance/types';
import { dayKey as toDayKey, startOfWeek, addDays } from '@/lib/performance/period';
import { formatMinutes, formatPercent } from '@/lib/performance/format';
import { HEAT_RAMP, HEAT_EMPTY, heatColor, heatRatioColor } from './theme';

type HeatMetric = 'actual' | 'planRatio' | 'tasks';

const METRICS: Array<[HeatMetric, string, string]> = [
  ['actual', 'Tempo eseguito', 'Minuti eseguiti al giorno'],
  ['planRatio', '% del piano', 'Quota del piano giornaliero eseguita'],
  ['tasks', 'Attività completate', 'Attività completate al giorno'],
];

interface ConsistencyHeatmapProps {
  days: PerformanceHeatmapDay[];
  period: PerformancePeriod;
  selectedKey: string | null;
  onSelectKey: (key: string | null) => void;
}

function cellDescription(day: PerformanceHeatmapDay): string {
  const date = day.date.toLocaleDateString('it-IT', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  if (day.isFuture) return `${date}: futuro`;
  const parts = [
    `pianificato ${formatMinutes(day.plannedMinutes)}`,
    `eseguito ${formatMinutes(day.actualMinutes)}`,
    `${day.tasksCompleted} attività completate`,
  ];
  if (day.planRatio !== null) parts.push(`${formatPercent(day.planRatio)} del piano`);
  return `${date}: ${parts.join(', ')}`;
}

function cellColor(day: PerformanceHeatmapDay, metric: HeatMetric, max: number): string {
  if (day.isFuture) return 'transparent';
  if (metric === 'actual') return heatColor(day.actualMinutes, max);
  if (metric === 'tasks') return heatColor(day.tasksCompleted, max);
  return heatRatioColor(day.planRatio);
}

export default function ConsistencyHeatmap({
  days,
  period,
  selectedKey,
  onSelectKey,
}: ConsistencyHeatmapProps) {
  const [metric, setMetric] = useState<HeatMetric>('actual');
  const [hovered, setHovered] = useState<PerformanceHeatmapDay | null>(null);

  const max = useMemo(() => {
    if (metric === 'actual') return Math.max(1, ...days.map((d) => d.actualMinutes));
    if (metric === 'tasks') return Math.max(1, ...days.map((d) => d.tasksCompleted));
    return 1;
  }, [days, metric]);

  // Year/month layout: weeks as columns (year) or rows (month), Monday-first.
  const weeks = useMemo(() => {
    if (days.length === 0) return [] as PerformanceHeatmapDay[][];
    const out: PerformanceHeatmapDay[][] = [];
    const firstWeekStart = startOfWeek(days[0].date);
    let cursor = firstWeekStart;
    let i = 0;
    while (i < days.length) {
      const week: PerformanceHeatmapDay[] = [];
      for (let d = 0; d < 7; d += 1) {
        const key = toDayKey(addDays(cursor, d));
        if (i < days.length && days[i].key === key) {
          week.push(days[i]);
          i += 1;
        } else {
          // Pad cells outside the period so columns stay aligned.
          week.push({
            key: `pad-${key}`,
            date: addDays(cursor, d),
            plannedMinutes: 0,
            actualMinutes: 0,
            planRatio: null,
            tasksCompleted: 0,
            goalNames: [],
            isToday: false,
            isFuture: true,
          });
        }
      }
      out.push(week);
      cursor = addDays(cursor, 7);
    }
    return out;
  }, [days]);

  const monthLabels = useMemo(() => {
    if (period.type !== 'year') return [];
    return weeks.map((week, idx) => {
      const firstReal = week.find((d) => !d.key.startsWith('pad-'));
      if (!firstReal) return '';
      const isFirstWeekOfMonth = firstReal.date.getDate() <= 7;
      if (!isFirstWeekOfMonth) return '';
      const label = firstReal.date.toLocaleDateString('en-US', { month: 'short' });
      const prev = weeks[idx - 1]?.find((d) => !d.key.startsWith('pad-'));
      if (prev && prev.date.getMonth() === firstReal.date.getMonth()) return '';
      return label;
    });
  }, [weeks, period.type]);

  const renderCell = (day: PerformanceHeatmapDay, sizeClass: string) => {
    if (day.key.startsWith('pad-')) {
      return <div key={day.key} className={`${sizeClass} rounded-[3px]`} aria-hidden="true" />;
    }
    const isSelected = selectedKey === day.key;
    return (
      <button
        key={day.key}
        type="button"
        data-testid={`heat-cell-${day.key}`}
        aria-label={cellDescription(day)}
        aria-pressed={isSelected}
        disabled={day.isFuture}
        onClick={() => onSelectKey(isSelected ? null : day.key)}
        onMouseEnter={() => setHovered(day)}
        onMouseLeave={() => setHovered(null)}
        onFocus={() => setHovered(day)}
        onBlur={() => setHovered(null)}
        className={`${sizeClass} rounded-[3px] transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
          day.isFuture ? 'border border-dashed border-slate-200 cursor-default' : 'hover:ring-2 hover:ring-blue-200'
        } ${isSelected ? 'ring-2 ring-blue-500' : ''} ${day.isToday ? 'outline outline-1 outline-blue-400' : ''}`}
        style={{ backgroundColor: cellColor(day, metric, max) }}
      />
    );
  };

  return (
    <section
      aria-label="Mappa di consistenza"
      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 relative"
      data-testid="consistency-heatmap"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Consistenza</h3>
          <p className="text-xs text-slate-500">{METRICS.find(([m]) => m === metric)?.[2]}</p>
        </div>
        <div role="group" aria-label="Heatmap metric" className="flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
          {METRICS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-testid={`heat-metric-${value}`}
              onClick={() => setMetric(value)}
              aria-pressed={metric === value}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                metric === value
                  ? 'bg-white text-blue-700 shadow-sm border border-slate-200'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Arbitrary-value 7-col classes on purpose: globals.css hijacks the
          literal `grid-cols-7` utility with `min-height: 480px` per cell
          (a Time Planner patch), which would blow these compact cells up. */}
      {period.type === 'week' && (
        <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1.5">
          {days.map((day) => (
            <div key={day.key} className="text-center">
              <div className="text-[10px] font-semibold text-slate-400 mb-1">
                {day.date.toLocaleDateString('en-US', { weekday: 'short' })}
              </div>
              {renderCell(day, 'w-full h-14')}
              <div className="mt-1 text-[10px] tabular-nums text-slate-500" aria-hidden="true">
                {day.isFuture
                  ? '·'
                  : metric === 'actual'
                    ? formatMinutes(day.actualMinutes)
                    : metric === 'tasks'
                      ? day.tasksCompleted
                      : formatPercent(day.planRatio)}
              </div>
            </div>
          ))}
        </div>
      )}

      {period.type === 'month' && (
        <div>
          <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1 mb-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
              <div key={label} className="text-center text-[10px] font-semibold text-slate-400">
                {label}
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1">
                {week.map((day) => (
                  <div key={day.key} className="relative">
                    {renderCell(day, 'w-full h-9')}
                    {!day.key.startsWith('pad-') && (
                      <span
                        aria-hidden="true"
                        className="absolute top-0.5 left-1 text-[9px] font-medium text-slate-500 pointer-events-none"
                      >
                        {day.date.getDate()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {period.type === 'year' && (
        <div className="overflow-x-auto pb-1">
          <div className="min-w-[700px]">
            <div className="flex gap-[3px] mb-1 ml-0">
              {monthLabels.map((label, i) => (
                <div key={i} className="w-[11px] text-[9px] text-slate-400 overflow-visible whitespace-nowrap">
                  {label}
                </div>
              ))}
            </div>
            <div className="flex gap-[3px]">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[3px]">
                  {week.map((day) => renderCell(day, 'w-[11px] h-[11px]'))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Ramp legend */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <span>Meno</span>
          <span className="w-3 h-3 rounded-[3px]" style={{ backgroundColor: HEAT_EMPTY }} aria-hidden="true" />
          {[0, 2, 4, 6].map((i) => (
            <span key={i} className="w-3 h-3 rounded-[3px]" style={{ backgroundColor: HEAT_RAMP[i] }} aria-hidden="true" />
          ))}
          <span>Più</span>
          {metric === 'planRatio' && <span className="ml-2">(darkest = plan fully executed)</span>}
        </div>
        {hovered && !hovered.key.startsWith('pad-') && (
          <div className="text-[11px] text-slate-600 tabular-nums" data-testid="heat-tooltip" aria-hidden="true">
            <strong>{hovered.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
            {' · '}planned {formatMinutes(hovered.plannedMinutes)} · actual {formatMinutes(hovered.actualMinutes)} ·{' '}
            {hovered.tasksCompleted} tasks
            {hovered.goalNames.length > 0 && ` · ${hovered.goalNames.slice(0, 3).join(', ')}`}
          </div>
        )}
      </div>
    </section>
  );
}
