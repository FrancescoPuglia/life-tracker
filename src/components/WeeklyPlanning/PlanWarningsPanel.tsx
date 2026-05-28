'use client';

// src/components/WeeklyPlanning/PlanWarningsPanel.tsx
// Aggregates conflicts (severity-tagged) and warnings into a single
// scannable list. Stays calm — clear copy, no drama, no exclamation marks.

import type { PlanConflict, PlanWarning } from '@/lib/weeklyPlanner';
import { severityStyle } from './weeklyPlanningUi';

export interface PlanWarningsPanelProps {
  conflicts: ReadonlyArray<PlanConflict>;
  warnings: ReadonlyArray<PlanWarning>;
}

export default function PlanWarningsPanel({
  conflicts,
  warnings,
}: PlanWarningsPanelProps) {
  const errors = conflicts.filter((c) => c.severity === 'error');
  const warns = conflicts.filter((c) => c.severity === 'warning');
  const infos = conflicts.filter((c) => c.severity === 'info');

  const isClean =
    errors.length === 0 && warns.length === 0 && infos.length === 0 && warnings.length === 0;

  return (
    <section
      aria-label="Plan warnings"
      className="rounded-2xl border border-gray-100 bg-white/80 backdrop-blur-sm shadow-sm overflow-hidden"
    >
      <header className="border-b border-gray-100 px-5 py-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Conflitti & avvisi
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Rivedi i problemi prima del commit (Prompt 4).
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <CountBadge label="Error" count={errors.length} color="rose" />
          <CountBadge label="Warn" count={warns.length} color="amber" />
          <CountBadge label="Info" count={infos.length + warnings.length} color="sky" />
        </div>
      </header>

      {isClean ? (
        <div className="px-5 py-6 text-center">
          <p className="text-sm font-medium text-emerald-700">
            Nessun conflitto rilevato.
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Rivedi comunque la bozza prima dell&apos;approvazione.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {errors.map((c) => (
            <ConflictRow key={c.id} conflict={c} />
          ))}
          {warns.map((c) => (
            <ConflictRow key={c.id} conflict={c} />
          ))}
          {infos.map((c) => (
            <ConflictRow key={c.id} conflict={c} />
          ))}
          {warnings.map((w) => (
            <WarningRow key={w.id} warning={w} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ConflictRow({ conflict }: { conflict: PlanConflict }) {
  const s = severityStyle(conflict.severity);
  return (
    <li
      className={`px-5 py-3 flex items-start gap-3 border-l-4 ${s.accent} bg-white`}
      data-testid="conflict-row"
    >
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${s.badge} shrink-0`}
      >
        {s.label}
      </span>
      <div className="min-w-0">
        <p className="text-sm text-gray-800">{conflict.message}</p>
        <p className="text-[10px] uppercase tracking-wider text-gray-400 mt-1">
          {conflict.type.replace(/_/g, ' ')}
        </p>
      </div>
    </li>
  );
}

function WarningRow({ warning }: { warning: PlanWarning }) {
  return (
    <li
      className="px-5 py-3 flex items-start gap-3 border-l-4 border-sky-300 bg-white"
      data-testid="warning-row"
    >
      <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700 shrink-0">
        Info
      </span>
      <div className="min-w-0">
        <p className="text-sm text-gray-800">{warning.message}</p>
        <p className="text-[10px] uppercase tracking-wider text-gray-400 mt-1">
          {warning.type.replace(/_/g, ' ')}
        </p>
      </div>
    </li>
  );
}

function CountBadge({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: 'rose' | 'amber' | 'sky';
}) {
  const classes =
    color === 'rose'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : color === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-sky-200 bg-sky-50 text-sky-700';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${classes}`}
    >
      <span>{label}</span>
      <span className="font-semibold tabular-nums">{count}</span>
    </span>
  );
}
