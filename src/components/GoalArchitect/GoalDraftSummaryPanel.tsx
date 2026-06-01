'use client';

// src/components/GoalArchitect/GoalDraftSummaryPanel.tsx
// Roll-up metrics across the entire draft: counts, hours and commit-readiness.

import type { GoalArchitectureDraft } from '@/lib/goalArchitect';
import { hoursLabel } from './goalArchitectUi';

export interface GoalDraftSummaryPanelProps {
  draft: GoalArchitectureDraft;
}

export default function GoalDraftSummaryPanel({
  draft,
}: GoalDraftSummaryPanelProps) {
  const s = draft.summary;
  const goalHours = s.totalGoalTargetHours;
  const projectHours = s.totalProjectTargetHours;
  const taskHours = s.totalTaskEstimatedHours;

  const goalVsProjectsMismatch =
    typeof goalHours === 'number' &&
    projectHours > 0 &&
    Math.abs(goalHours - projectHours) > 0.25;
  const projectVsTasksMismatch =
    projectHours > 0 &&
    taskHours > 0 &&
    Math.abs(projectHours - taskHours) > 0.25;

  return (
    <section
      aria-label="Draft summary"
      data-testid="goal-architect-summary"
      className="rounded-2xl border border-gray-100 bg-white/80 backdrop-blur-sm shadow-sm overflow-hidden"
    >
      <header className="border-b border-gray-100 px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Draft summary</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Questa è una bozza. Nessun Goal, Project o Task è stato ancora creato.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <Badge color={s.errorCount > 0 ? 'rose' : 'emerald'}>
            {s.errorCount > 0 ? `${s.errorCount} errors` : 'no errors'}
          </Badge>
          <Badge color={s.warningCount > 0 ? 'amber' : 'sky'}>
            {s.warningCount} warnings
          </Badge>
          <Badge color="indigo">{s.infoCount} info</Badge>
          <Badge color={s.canCommit ? 'emerald' : 'rose'}>
            {s.canCommit ? 'Can commit' : 'Cannot commit'}
          </Badge>
        </div>
      </header>

      <div className="px-5 py-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Projects" value={s.projectCount} />
        <SummaryCard label="Tasks" value={s.taskCount} />
        <SummaryCard label="Key Results" value={s.keyResultCount} />
        <SummaryCard
          label="Direct tasks (no project)"
          value={(draft.goal?.directTaskIds.length ?? 0)}
        />
      </div>

      <div className="px-5 pb-5 grid gap-3 sm:grid-cols-3">
        <HoursCard
          label="Goal target"
          value={hoursLabel(goalHours)}
          highlight
        />
        <HoursCard
          label="Σ Project hours"
          value={hoursLabel(projectHours)}
          warn={goalVsProjectsMismatch}
        />
        <HoursCard
          label="Σ Task hours"
          value={hoursLabel(taskHours)}
          warn={projectVsTasksMismatch}
        />
      </div>

      {(goalVsProjectsMismatch || projectVsTasksMismatch) && (
        <p
          className="px-5 pb-4 text-xs text-amber-700"
          data-testid="goal-architect-hours-warning"
        >
          ⚠ Disallineamento ore tra livelli: rivedere i target prima del commit.
        </p>
      )}
    </section>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">
        {value}
      </p>
    </div>
  );
}

function HoursCard({
  label,
  value,
  highlight = false,
  warn = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  const cls = warn
    ? 'border-amber-200 bg-amber-50'
    : highlight
      ? 'border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50'
      : 'border-gray-100 bg-white';
  const textCls = warn
    ? 'text-amber-800'
    : highlight
      ? 'text-blue-700'
      : 'text-gray-900';
  return (
    <div className={`rounded-xl border px-4 py-3 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        {label}
      </p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${textCls}`}>{value}</p>
    </div>
  );
}

function Badge({
  color,
  children,
}: {
  color: 'rose' | 'amber' | 'emerald' | 'sky' | 'indigo';
  children: React.ReactNode;
}) {
  const cls =
    color === 'rose'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : color === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : color === 'emerald'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : color === 'indigo'
            ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
            : 'border-sky-200 bg-sky-50 text-sky-700';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}
