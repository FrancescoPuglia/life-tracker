'use client';

// src/components/WeeklyPlanning/GoalMappingReview.tsx
// One card per ParsedIntent → mapping. Shows whether each intent reached
// a Goal/Project/Task and how confident the mapper was.

import type {
  GoalLike,
  GoalMappingCandidate,
  ParsedIntent,
  ProjectLike,
  TaskLike,
} from '@/lib/weeklyPlanner';
import {
  activityStyle,
  confidenceLabel,
  dayLabelLong,
  durationLabel,
  mappingStyle,
} from './weeklyPlanningUi';

export interface GoalMappingReviewProps {
  intents: ReadonlyArray<ParsedIntent>;
  mappings: ReadonlyArray<GoalMappingCandidate>;
  goals: ReadonlyArray<GoalLike>;
  projects: ReadonlyArray<ProjectLike>;
  tasks: ReadonlyArray<TaskLike>;
}

export default function GoalMappingReview({
  intents,
  mappings,
  goals,
  projects,
  tasks,
}: GoalMappingReviewProps) {
  if (intents.length === 0) return null;

  return (
    <section
      aria-label="Goal mapping review"
      className="rounded-2xl border border-gray-100 bg-white/80 backdrop-blur-sm shadow-sm overflow-hidden"
    >
      <header className="border-b border-gray-100 px-5 py-4">
        <h3 className="text-base font-semibold text-gray-900">
          Mapping Goal · Project · Task
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Verifica come le intenzioni sono state collegate al tuo OKR.
        </p>
      </header>

      <ul className="divide-y divide-gray-100">
        {intents.map((intent) => {
          const mapping = mappings.find((m) => m.intentId === intent.id);
          return (
            <li
              key={intent.id}
              className="p-5 grid gap-3 md:grid-cols-[1fr_auto] items-start"
              data-testid="mapping-row"
            >
              <IntentSummary intent={intent} />
              <MappingSummary
                mapping={mapping}
                goals={goals}
                projects={projects}
                tasks={tasks}
              />
            </li>
          );
        })}
      </ul>

      <footer className="border-t border-gray-100 px-5 py-3 bg-gray-50/60">
        <button
          type="button"
          disabled
          className="text-xs font-medium text-gray-400 cursor-not-allowed"
          title="Available in a future prompt"
        >
          Manual remap coming soon
        </button>
      </footer>
    </section>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function IntentSummary({ intent }: { intent: ParsedIntent }) {
  const style = activityStyle(intent.activityType);
  const recurrence = intent.recurrence ?? 'once';
  const days =
    intent.preferredDays.length > 0
      ? intent.preferredDays.map(dayLabelLong).join(', ')
      : null;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.badge}`}
        >
          <span>{style.emoji}</span>
          <span>{style.label}</span>
        </span>
        <span className="text-sm font-semibold text-gray-900">
          {intent.label}
        </span>
        <span className="text-xs text-gray-400">
          · conf. {confidenceLabel(intent.confidence)}
        </span>
      </div>

      <p className="text-xs text-gray-500 italic line-clamp-2">
        “{intent.sourceText}”
      </p>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
        <Pill>📅 {recurrenceLabel(recurrence, intent.timesPerWeek)}</Pill>
        {days && <Pill>🗓️ {days}</Pill>}
        {intent.preferredTime && <Pill>⏰ {intent.preferredTime}</Pill>}
        {intent.preferredTimeWindow && (
          <Pill>🌅 {intent.preferredTimeWindow}</Pill>
        )}
        {intent.durationMinutes !== undefined && (
          <Pill>⏱️ {durationLabel(intent.durationMinutes)}</Pill>
        )}
      </div>
    </div>
  );
}

function MappingSummary({
  mapping,
  goals,
  projects,
  tasks,
}: {
  mapping: GoalMappingCandidate | undefined;
  goals: ReadonlyArray<GoalLike>;
  projects: ReadonlyArray<ProjectLike>;
  tasks: ReadonlyArray<TaskLike>;
}) {
  if (!mapping) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
        Nessun mapping disponibile.
      </div>
    );
  }
  const ms = mappingStyle(mapping.status);
  const goal = mapping.goalId
    ? goals.find((g) => g.id === mapping.goalId)
    : undefined;
  const project = mapping.projectId
    ? projects.find((p) => p.id === mapping.projectId)
    : undefined;
  const task = mapping.taskId
    ? tasks.find((t) => t.id === mapping.taskId)
    : undefined;

  return (
    <div className="md:max-w-xs space-y-2">
      <div className="flex items-center justify-end gap-2">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${ms.badge}`}
        >
          {ms.label}
        </span>
        <span className="text-[11px] text-gray-400">
          {confidenceLabel(mapping.confidence)}
        </span>
      </div>

      {(goal || project || task) && (
        <dl className="text-xs space-y-0.5 text-right">
          {goal && (
            <Row label="Goal" value={goal.title} colorClass="text-blue-700" />
          )}
          {project && (
            <Row
              label="Project"
              value={project.title}
              colorClass="text-indigo-700"
            />
          )}
          {task && (
            <Row label="Task" value={task.title} colorClass="text-cyan-700" />
          )}
        </dl>
      )}

      <p className="text-[11px] text-gray-400 italic">{mapping.reason}</p>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5">
      {children}
    </span>
  );
}

function Row({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string;
  colorClass: string;
}) {
  return (
    <div className="flex items-baseline justify-end gap-2">
      <dt className="text-[10px] uppercase tracking-wider text-gray-400">
        {label}
      </dt>
      <dd className={`font-medium ${colorClass}`}>{value}</dd>
    </div>
  );
}

function recurrenceLabel(
  r: string,
  timesPerWeek?: number,
): string {
  switch (r) {
    case 'daily':
      return 'Ogni giorno';
    case 'weekdays':
      return 'Giorni feriali';
    case 'weekly':
      return 'Settimanale';
    case 'x_times_weekly':
      return `${timesPerWeek ?? 0}× a settimana`;
    case 'once':
    default:
      return 'Una tantum';
  }
}
