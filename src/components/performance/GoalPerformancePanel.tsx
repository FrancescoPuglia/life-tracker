'use client';

// Goal Performance — one bullet row per goal.
//
// Identity comes from the row label, never from a per-goal hue (goals are
// unbounded nominal categories): every row uses the same Planned-gray track
// and Actual-blue fill, so neglected goals emerge structurally — a long gray
// track with a short blue fill. Clicking a row scopes the whole dashboard.

import type { GoalPerformance } from '@/lib/performance/types';
import { UNASSIGNED_ID } from '@/lib/performance/metrics';
import {
  formatMinutes,
  formatPercent,
  formatSignedMinutes,
} from '@/lib/performance/format';
import { CHART_COLORS, STATUS_META, describeStatus } from './theme';

interface GoalPerformancePanelProps {
  goals: GoalPerformance[];
  activeGoalId: string | null;
  onSelectGoal: (goalId: string | null) => void;
}

export default function GoalPerformancePanel({
  goals,
  activeGoalId,
  onSelectGoal,
}: GoalPerformancePanelProps) {
  const maxMinutes = Math.max(1, ...goals.map((g) => Math.max(g.plannedMinutes, g.actualMinutes)));

  return (
    <section
      aria-label="Rendimento obiettivi"
      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
      data-testid="goal-performance-panel"
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Rendimento obiettivi</h3>
          <p className="text-xs text-slate-500">
            Dove avevi promesso il tempo e dove è stato realmente investito.
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-3 text-[11px] text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: CHART_COLORS.planned }} aria-hidden="true" />
            Pianificato
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: CHART_COLORS.actual }} aria-hidden="true" />
            Eseguito
          </span>
        </div>
      </div>

      {goals.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">Nessun obiettivo con dati nel periodo.</p>
      ) : (
        <ul className="space-y-1">
          {goals.map((goal) => {
            const key = goal.goalId ?? UNASSIGNED_ID;
            const isActive = activeGoalId === key;
            const status = STATUS_META[goal.status];
            const plannedPct = (goal.plannedMinutes / maxMinutes) * 100;
            const actualPct = (goal.actualMinutes / maxMinutes) * 100;
            const elapsedPct = (goal.plannedElapsedMinutes / maxMinutes) * 100;
            // Tiny-but-real values must stay visible (min 4px sliver).
            const barWidth = (pct: number) => (pct > 0 ? `max(${pct}%, 4px)` : '0%');
            return (
              <li key={key}>
                <button
                  type="button"
                  data-testid={`goal-row-${key}`}
                  onClick={() => onSelectGoal(isActive ? null : key)}
                  aria-pressed={isActive}
                  aria-label={`${goal.goalName}: pianificato ${formatMinutes(goal.plannedMinutes)}, eseguito ${formatMinutes(
                    goal.actualMinutes
                  )}, ${status.label}. ${isActive ? 'Rimuovi filtro' : 'Filtra il cruscotto su questo obiettivo'}`}
                  className={`w-full text-left rounded-xl px-3 py-2.5 border transition-colors ${
                    isActive
                      ? 'border-blue-300 bg-blue-50/60'
                      : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="text-[13px] font-semibold text-slate-900 truncate"
                        title={goal.goalName}
                      >
                        {goal.goalName}
                      </span>
                      {goal.goalStatus === 'archived' && (
                        <span className="text-[10px] text-slate-400 uppercase tracking-wide">archiviato</span>
                      )}
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${status.className}`}
                        title={describeStatus(goal.status, goal)}
                      >
                        <span aria-hidden="true">{status.symbol}</span>
                        {status.label}
                      </span>
                    </div>
                    <div className="ml-auto flex items-baseline gap-3 text-xs whitespace-nowrap tabular-nums">
                      <span className="text-slate-500" title="Eseguito / pianificato nel periodo">
                        {formatMinutes(goal.actualMinutes)}
                        <span className="text-slate-400"> / {formatMinutes(goal.plannedMinutes)}</span>
                      </span>
                      <span
                        className="font-semibold text-slate-700 w-16 text-right"
                        title="Scarto = eseguito − pianificato nel periodo completo"
                      >
                        {formatSignedMinutes(goal.varianceMinutes)}
                      </span>
                      <span className="text-slate-400 w-10 text-right" title="Quota del tempo eseguito nel periodo">
                        {goal.shareOfActual !== null ? formatPercent(goal.shareOfActual) : '—'}
                      </span>
                    </div>
                  </div>
                  {/* Bullet bars: planned track + actual fill on one shared
                      scale; the notch marks the plan matured up to today. */}
                  <div className="space-y-1" aria-hidden="true">
                    <div className="h-2 rounded-full bg-slate-100 relative overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: barWidth(plannedPct), backgroundColor: CHART_COLORS.planned, opacity: 0.35 }}
                      />
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: barWidth(actualPct), backgroundColor: CHART_COLORS.actual }}
                      />
                      {goal.plannedElapsedMinutes > 0 &&
                        goal.plannedElapsedMinutes < goal.plannedMinutes && (
                          <div
                            className="absolute inset-y-0 w-[2px]"
                            style={{ left: `${elapsedPct}%`, backgroundColor: '#475569' }}
                          />
                        )}
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      {goal.completedPlannedTasks}/{goal.plannedTasks || 0} attività pianificate ·{' '}
                      {goal.activeProjects} progett{goal.activeProjects === 1 ? 'o attivo' : 'i attivi'}
                    </span>
                    <span className="tabular-nums">
                      {formatSignedMinutes(goal.trendMinutes)} rispetto al precedente
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
