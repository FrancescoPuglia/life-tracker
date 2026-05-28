'use client';

// src/components/WeeklyPlanning/RealismScorePanel.tsx
// Visual breakdown of the realism score. No chart libraries — bars are
// CSS-only so the bundle stays unchanged.

import type { PlanRealismScore, WeekDay } from '@/lib/weeklyPlanner';
import {
  dayLabelShort,
  interpretRealism,
  minutesToHoursLabel,
} from './weeklyPlanningUi';

export interface RealismScorePanelProps {
  score: PlanRealismScore;
}

const ALL_DAYS: ReadonlyArray<WeekDay> = [0, 1, 2, 3, 4, 5, 6];

export default function RealismScorePanel({ score }: RealismScorePanelProps) {
  const verdict = interpretRealism(score.overallScore);

  const maxDailyMinutes = Math.max(
    1,
    ...ALL_DAYS.map((d) => score.dailyLoadMinutes[d]),
  );

  return (
    <section
      aria-label="Realism score"
      className="rounded-2xl border border-gray-100 bg-white/80 backdrop-blur-sm shadow-sm overflow-hidden"
      data-testid="realism-score-panel"
    >
      <header className="border-b border-gray-100 px-5 py-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Realism Score
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">{verdict.hint}</p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${verdict.badge}`}
          >
            {verdict.label}
          </span>
          <span
            className="text-4xl font-black bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent tabular-nums leading-none"
            data-testid="realism-score-value"
          >
            {score.overallScore}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-gray-400">
            / 100
          </span>
        </div>
      </header>

      <div className="grid gap-4 p-5 sm:grid-cols-2">
        {/* Totals & penalties */}
        <div className="space-y-2">
          <h4 className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
            Sintesi
          </h4>
          <dl className="text-xs space-y-1">
            <Stat
              label="Tempo pianificato"
              value={minutesToHoursLabel(score.totalPlannedMinutes)}
            />
            <Stat label="Goal coverage" value={`${score.goalCoverageScore}%`} />
            <Stat
              label="Penalty conflitti"
              value={score.conflictPenalty > 0 ? `−${score.conflictPenalty}` : '0'}
              negative={score.conflictPenalty > 0}
            />
            <Stat
              label="Penalty sovraccarico settimana"
              value={
                score.weeklyOverloadPenalty > 0
                  ? `−${score.weeklyOverloadPenalty}`
                  : '0'
              }
              negative={score.weeklyOverloadPenalty > 0}
            />
            <Stat
              label="Penalty sovraccarico giorni"
              value={
                score.dailyOverloadPenalty > 0
                  ? `−${score.dailyOverloadPenalty}`
                  : '0'
              }
              negative={score.dailyOverloadPenalty > 0}
            />
            <Stat
              label="Penalty cambi contesto"
              value={
                score.contextSwitchPenalty > 0
                  ? `−${score.contextSwitchPenalty}`
                  : '0'
              }
              negative={score.contextSwitchPenalty > 0}
            />
            <Stat
              label="Penalty recovery"
              value={
                score.recoveryPenalty > 0 ? `−${score.recoveryPenalty}` : '0'
              }
              negative={score.recoveryPenalty > 0}
            />
          </dl>
        </div>

        {/* Daily load chart */}
        <div>
          <h4 className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
            Carico per giorno
          </h4>
          <ul className="space-y-1.5">
            {ALL_DAYS.map((d) => {
              const minutes = score.dailyLoadMinutes[d];
              const pct = Math.round((minutes / maxDailyMinutes) * 100);
              return (
                <li key={d} className="flex items-center gap-2 text-xs">
                  <span className="w-8 text-gray-500 font-medium tabular-nums">
                    {dayLabelShort(d)}
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-400 to-indigo-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-14 text-right text-gray-600 tabular-nums">
                    {minutesToHoursLabel(minutes)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {score.notes.length > 0 && (
        <div className="border-t border-gray-100 px-5 py-3 bg-gray-50/60">
          <h4 className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">
            Note
          </h4>
          <ul className="space-y-0.5 text-xs text-gray-600">
            {score.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  negative = false,
}: {
  label: string;
  value: string;
  negative?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd
        className={`font-semibold tabular-nums ${
          negative ? 'text-rose-600' : 'text-gray-900'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
