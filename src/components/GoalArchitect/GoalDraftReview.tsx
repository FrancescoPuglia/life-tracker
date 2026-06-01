'use client';

// src/components/GoalArchitect/GoalDraftReview.tsx
// Goal header with inline editing + composition of the tree, KR panel and
// confidence panel.

import { ChangeEvent } from 'react';
import type {
  DraftPriority,
  GoalArchitectIssue,
  GoalArchitectureDraft,
  KeyResultUnit,
} from '@/lib/goalArchitect';
import GoalArchitectConfidencePanel from './GoalArchitectConfidencePanel';
import GoalDraftTree from './GoalDraftTree';
import KeyResultDraftPanel, {
  type KeyResultDraftEdit,
} from './KeyResultDraftPanel';
import type { ProjectDraftEdit } from './ProjectDraftCard';
import type { TaskDraftEdit } from './TaskDraftRow';
import {
  confidenceLabel,
  hoursLabel,
  interpretConfidence,
  priorityStyle,
} from './goalArchitectUi';

export interface GoalDraftEdit {
  title?: string;
  description?: string;
  targetHours?: number;
  dueDateISO?: string;
  priority?: DraftPriority;
}

export interface GoalDraftReviewProps {
  draft: GoalArchitectureDraft;
  onGoalChange: (patch: GoalDraftEdit) => void;
  onProjectChange: (projectId: string, patch: ProjectDraftEdit) => void;
  onTaskChange: (taskId: string, patch: TaskDraftEdit) => void;
  onKeyResultChange: (keyResultId: string, patch: KeyResultDraftEdit) => void;
}

const PRIORITY_OPTIONS: ReadonlyArray<{ value: '' | DraftPriority; label: string }> = [
  { value: '', label: '—' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export default function GoalDraftReview({
  draft,
  onGoalChange,
  onProjectChange,
  onTaskChange,
  onKeyResultChange,
}: GoalDraftReviewProps) {
  const { goal } = draft;
  return (
    <section
      aria-label="Goal draft review"
      data-testid="goal-architect-review"
      className="space-y-4"
    >
      {goal ? (
        <GoalHeader
          goal={goal}
          issues={draft.issues}
          onGoalChange={onGoalChange}
        />
      ) : (
        <p className="rounded-2xl border border-rose-200 bg-rose-50/40 px-5 py-4 text-sm text-rose-700">
          Nessun Goal interpretato. Aggiungi “Goal: …” nel testo e rigenera.
        </p>
      )}

      <GoalDraftTree
        projects={draft.projects}
        tasks={draft.tasks}
        issues={draft.issues}
        onProjectChange={onProjectChange}
        onTaskChange={onTaskChange}
      />

      <KeyResultDraftPanel
        keyResults={draft.keyResults}
        issues={draft.issues}
        onChange={onKeyResultChange}
      />

      <GoalArchitectConfidencePanel confidence={draft.confidence} />
    </section>
  );
}

function GoalHeader({
  goal,
  issues,
  onGoalChange,
}: {
  goal: NonNullable<GoalArchitectureDraft['goal']>;
  issues: ReadonlyArray<GoalArchitectIssue>;
  onGoalChange: (patch: GoalDraftEdit) => void;
}) {
  const conf = interpretConfidence(goal.confidence?.overall ?? 0);
  const pri = priorityStyle(goal.priority);
  const goalIssues = issues.filter((i) => i.entityKind === 'goal');

  const handleTitle = (e: ChangeEvent<HTMLInputElement>) => {
    onGoalChange({ title: e.target.value });
  };
  const handleDescription = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onGoalChange({ description: e.target.value || undefined });
  };
  const handleHours = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const parsed = raw === '' ? undefined : parseFloat(raw);
    onGoalChange({
      targetHours:
        parsed === undefined || !Number.isFinite(parsed) ? undefined : parsed,
    });
  };
  const handleDate = (e: ChangeEvent<HTMLInputElement>) => {
    onGoalChange({ dueDateISO: e.target.value || undefined });
  };
  const handlePriority = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value as '' | DraftPriority;
    onGoalChange({ priority: v === '' ? undefined : v });
  };

  return (
    <article
      data-testid="goal-architect-goal-header"
      className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 px-5 py-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-blue-700">
            Goal
          </p>
          <input
            type="text"
            value={goal.title}
            onChange={handleTitle}
            aria-label="Goal title"
            data-testid="goal-architect-goal-title"
            className="mt-1 w-full rounded-lg border border-transparent bg-transparent px-1 py-1 text-2xl font-bold text-gray-900 hover:border-blue-200 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200 transition"
          />
          <textarea
            value={goal.description ?? ''}
            onChange={handleDescription}
            placeholder="Descrizione opzionale del Goal..."
            rows={2}
            aria-label="Goal description"
            data-testid="goal-architect-goal-description"
            className="mt-2 w-full resize-none rounded-lg border border-transparent bg-transparent px-1 py-1 text-sm text-gray-700 placeholder:text-gray-400 hover:border-blue-200 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200 transition"
          />
        </div>
        <div className="flex flex-col items-end gap-1.5 text-[11px]">
          {pri && (
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 font-semibold ${pri.badge}`}
            >
              {pri.label}
            </span>
          )}
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 font-semibold ${conf.badge}`}
          >
            Confidence {conf.label} · {confidenceLabel(goal.confidence?.overall ?? 0)}
          </span>
          {goalIssues.length > 0 && (
            <span className="text-amber-700">
              ⚠ {goalIssues.length} issue{goalIssues.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="Target hours">
          <input
            type="number"
            min={0}
            step="0.5"
            value={goal.targetHours ?? ''}
            onChange={handleHours}
            aria-label="Goal target hours"
            data-testid="goal-architect-goal-hours"
            placeholder="hours"
            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
          />
          <p className="text-[10px] text-gray-500 mt-1">
            {hoursLabel(goal.targetHours)} target
          </p>
        </Field>
        <Field label="Due date">
          <input
            type="date"
            value={goal.dueDateISO?.slice(0, 10) ?? ''}
            onChange={handleDate}
            aria-label="Goal due date"
            data-testid="goal-architect-goal-date"
            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
          />
        </Field>
        <Field label="Priority">
          <select
            value={goal.priority ?? ''}
            onChange={handlePriority}
            aria-label="Goal priority"
            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </article>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-blue-800/70 font-semibold mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
