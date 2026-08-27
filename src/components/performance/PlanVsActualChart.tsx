'use client';

// Plan vs Reality — the section's main chart.
//
// Two views on ONE value axis (never dual-axis):
//   • Daily/Monthly bars: Planned (context gray) beside Actual (stacked:
//     planned-executed blue + unplanned amber, 1px surface gaps).
//   • Cumulative lines: running Planned vs Actual, with a 10% actual wash —
//     shows at a glance whether the gap is growing or shrinking.
// Clicking a bucket drills the activity table to that day/month.

import { useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PerformancePeriod, PerformanceTimePoint } from '@/lib/performance/types';
import { formatAxisMinutes, formatMinutes, formatSignedMinutes } from '@/lib/performance/format';
import { CHART_COLORS } from './theme';

interface PlanVsActualChartProps {
  points: PerformanceTimePoint[];
  period: PerformancePeriod;
  selectedKey: string | null;
  onSelectKey: (key: string | null) => void;
}

type ViewMode = 'buckets' | 'cumulative';

interface TooltipRowProps {
  color: string;
  label: string;
  value: string;
  isLine?: boolean;
}

function TooltipRow({ color, label, value, isLine }: TooltipRowProps) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        aria-hidden="true"
        className={isLine ? 'inline-block w-3.5 rounded-full' : 'inline-block w-2.5 h-2.5 rounded-[3px]'}
        style={{ backgroundColor: color, height: isLine ? 2 : undefined }}
      />
      <span className="font-semibold text-slate-900 tabular-nums">{value}</span>
      <span className="text-slate-500">{label}</span>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  mode,
}: {
  active?: boolean;
  payload?: Array<{ payload: PerformanceTimePoint }>;
  mode: ViewMode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const dateLabel = point.start.toLocaleDateString('en-US', {
    weekday: point.key.length === 7 ? undefined : 'short',
    month: 'short',
    day: point.key.length === 7 ? undefined : 'numeric',
    year: point.key.length === 7 ? 'numeric' : undefined,
  });
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {dateLabel}
        {point.isToday ? ' · today' : ''}
      </div>
      {mode === 'buckets' ? (
        <>
          <TooltipRow color={CHART_COLORS.planned} label="planned" value={formatMinutes(point.plannedMinutes)} />
          <TooltipRow color={CHART_COLORS.actual} label="actual" value={formatMinutes(point.actualMinutes)} />
          {point.unplannedMinutes > 0 && (
            <TooltipRow
              color={CHART_COLORS.unplanned}
              label="of it unplanned"
              value={formatMinutes(point.unplannedMinutes)}
            />
          )}
          <div className="text-xs text-slate-500 pt-0.5">
            Variance <span className="font-semibold text-slate-700">{formatSignedMinutes(point.varianceMinutes)}</span>
            {point.tasksCompleted > 0 && (
              <span>
                {' '}
                · {point.tasksCompleted} task{point.tasksCompleted === 1 ? '' : 's'} done
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <TooltipRow
            color={CHART_COLORS.planned}
            label="planned so far"
            value={formatMinutes(point.cumulativePlannedMinutes)}
            isLine
          />
          <TooltipRow
            color={CHART_COLORS.actualLine}
            label="actual so far"
            value={formatMinutes(point.cumulativeActualMinutes)}
            isLine
          />
          <div className="text-xs text-slate-500 pt-0.5">
            Gap{' '}
            <span className="font-semibold text-slate-700">
              {formatSignedMinutes(point.cumulativeActualMinutes - point.cumulativePlannedMinutes)}
            </span>
          </div>
        </>
      )}
      <div className="text-[10px] text-slate-400">Click to inspect this {point.key.length === 7 ? 'month' : 'day'}</div>
    </div>
  );
}

export default function PlanVsActualChart({
  points,
  period,
  selectedKey,
  onSelectKey,
}: PlanVsActualChartProps) {
  const [mode, setMode] = useState<ViewMode>('buckets');

  const data = useMemo(
    () =>
      points.map((p) => {
        // UI boundary guard: a single NaN/Infinity poisons the whole Y scale
        // (recharts then draws no bars, no ticks, no tooltips).
        const finite = (v: number) => (Number.isFinite(v) ? v : 0);
        const actualMinutes = finite(p.actualMinutes);
        const unplannedMinutes = finite(p.unplannedMinutes);
        return {
          ...p,
          plannedMinutes: finite(p.plannedMinutes),
          actualMinutes,
          unplannedMinutes,
          cumulativePlannedMinutes: finite(p.cumulativePlannedMinutes),
          cumulativeActualMinutes: finite(p.cumulativeActualMinutes),
          plannedExecutedMinutes: Math.max(0, actualMinutes - unplannedMinutes),
          // Recharts needs plain fields; keep Date objects off the axis payload.
          axisLabel: p.label,
        };
      }),
    [points]
  );

  const todayPoint = points.find((p) => p.isToday);
  const hasAnyData = points.some((p) => p.plannedMinutes > 0 || p.actualMinutes > 0);
  const barSize = period.type === 'week' ? 22 : period.type === 'month' ? 9 : 16;

  const handleClick = (state: unknown) => {
    const s = state as { activePayload?: Array<{ payload: PerformanceTimePoint }> } | null;
    const key = s?.activePayload?.[0]?.payload?.key;
    if (key) onSelectKey(selectedKey === key ? null : key);
  };

  return (
    <section
      aria-label="Grafico piano ed esecuzione"
      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
      data-testid="plan-vs-actual-chart"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Piano ed esecuzione reale</h3>
          <p className="text-xs text-slate-500">
            {mode === 'buckets'
              ? `Tempo pianificato ed eseguito per ${period.type === 'year' ? 'mese' : 'giorno'}`
              : 'Totali progressivi: lo scarto cresce o si riduce?'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Legend (≥2 series → always present) */}
          <div className="hidden sm:flex items-center gap-3 text-[11px] text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: CHART_COLORS.planned }} aria-hidden="true" />
              Pianificato
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: CHART_COLORS.actual }} aria-hidden="true" />
              Eseguito
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: CHART_COLORS.unplanned }} aria-hidden="true" />
              Non pianificato
            </span>
          </div>
          <div role="group" aria-label="Vista grafico" className="flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
            {(
              [
                ['buckets', period.type === 'year' ? 'Mensile' : 'Giornaliero'],
                ['cumulative', 'Cumulativo'],
              ] as Array<[ViewMode, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                  mode === value ? 'bg-white text-blue-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!hasAnyData ? (
        <div className="h-[260px] flex items-center justify-center text-sm text-slate-400">
          No planned or executed time in this period.
        </div>
      ) : (
        <div className="h-[280px]" role="img" aria-label={buildChartSummary(points, period)}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              onClick={handleClick}
              barGap={2}
            >
              <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} strokeWidth={1} />
              <XAxis
                dataKey="axisLabel"
                tickLine={false}
                axisLine={{ stroke: CHART_COLORS.grid }}
                tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
                interval={period.type === 'month' ? 2 : 0}
              />
              <YAxis
                tickFormatter={formatAxisMinutes}
                tickLine={false}
                axisLine={false}
                width={44}
                tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
              />
              <Tooltip
                content={<ChartTooltip mode={mode} />}
                cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                isAnimationActive={false}
              />
              {todayPoint && mode === 'buckets' && (
                <ReferenceLine x={todayPoint.label} stroke={CHART_COLORS.today} strokeWidth={1} />
              )}
              {/* Series MUST be direct children of the chart: recharts finds
                  them by scanning children, and its react-is fragment
                  detection fails under Next's vendored React 19 — a Bar/Line
                  wrapped in <>…</> silently disappears (the 2026-07 empty
                  chart). Conditional `&&` children are safe; fragments are
                  not. */}
              {mode === 'buckets' && (
                  <Bar
                    dataKey="plannedMinutes"
                    name="Pianificato"
                    maxBarSize={barSize}
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  >
                    {data.map((p) => (
                      <Cell
                        key={p.key}
                        fill={p.isFuture ? CHART_COLORS.plannedFuture : CHART_COLORS.planned}
                        opacity={selectedKey && selectedKey !== p.key ? 0.35 : 1}
                      />
                    ))}
                  </Bar>
              )}
              {mode === 'buckets' && (
                  <Bar
                    dataKey="plannedExecutedMinutes"
                    name="Eseguito pianificato"
                    stackId="actual"
                    maxBarSize={barSize}
                    isAnimationActive={false}
                  >
                    {data.map((p) => (
                      <Cell
                        key={p.key}
                        fill={CHART_COLORS.actual}
                        opacity={selectedKey && selectedKey !== p.key ? 0.35 : 1}
                      />
                    ))}
                  </Bar>
              )}
              {mode === 'buckets' && (
                  <Bar
                    dataKey="unplannedMinutes"
                    name="Eseguito non pianificato"
                    stackId="actual"
                    maxBarSize={barSize}
                    radius={[2, 2, 0, 0]}
                    isAnimationActive={false}
                  >
                    {data.map((p) => (
                      <Cell
                        key={p.key}
                        fill={CHART_COLORS.unplanned}
                        stroke="#ffffff"
                        strokeWidth={1}
                        opacity={selectedKey && selectedKey !== p.key ? 0.35 : 1}
                      />
                    ))}
                  </Bar>
              )}
              {mode === 'cumulative' && (
                  <Line
                    type="monotone"
                    dataKey="cumulativePlannedMinutes"
                    name="Pianificato cumulativo"
                    stroke={CHART_COLORS.planned}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, stroke: '#ffffff', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
              )}
              {mode === 'cumulative' && (
                  <Line
                    type="monotone"
                    dataKey="cumulativeActualMinutes"
                    name="Eseguito cumulativo"
                    stroke={CHART_COLORS.actualLine}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, stroke: '#ffffff', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Screen-reader table twin — values are never color/hover-gated.
          Wrapped in a sr-only DIV: a table styled sr-only directly keeps its
          content width (display:table treats width as a minimum) and forces
          horizontal scroll on narrow viewports. */}
      <div className="sr-only">
      <table>
        <caption>Minuti pianificati ed eseguiti per {period.type === 'year' ? 'mese' : 'giorno'}</caption>
        <thead>
          <tr>
            <th scope="col">Periodo</th>
            <th scope="col">Pianificato</th>
            <th scope="col">Eseguito</th>
            <th scope="col">Non pianificato</th>
            <th scope="col">Scarto</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}>
              <th scope="row">{p.key}</th>
              <td>{formatMinutes(p.plannedMinutes)}</td>
              <td>{formatMinutes(p.actualMinutes)}</td>
              <td>{formatMinutes(p.unplannedMinutes)}</td>
              <td>{formatSignedMinutes(p.varianceMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}

function buildChartSummary(points: PerformanceTimePoint[], period: PerformancePeriod): string {
  const planned = points.reduce((s, p) => s + p.plannedMinutes, 0);
  const actual = points.reduce((s, p) => s + p.actualMinutes, 0);
  return `Bar chart comparing planned and actual time per ${
    period.type === 'year' ? 'month' : 'day'
  }. Total planned ${formatMinutes(planned)}, total actual ${formatMinutes(actual)}.`;
}
