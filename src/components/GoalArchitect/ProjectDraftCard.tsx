'use client';

// src/components/GoalArchitect/ProjectDraftCard.tsx
// Card for a ProjectDraft + its child tasks, with inline editing.

import { ChangeEvent } from 'react';
import type {
  DraftPriority,
  GoalArchitectIssue,
  ProjectDraft,
  TaskDraft,
} from '@/lib/goalArchitect';
import TaskDraftRow, { type TaskDraftEdit } from './TaskDraftRow';
import {
  confidenceLabel,
  hoursLabel,
  interpretConfidence,
  priorityStyle,
} from './goalArchitectUi';

export interface ProjectDraftEdit {
  title?: string;
  targetHours?: number;
  dueDateISO?: string;
  priority?: DraftPriority;
}

export interface ProjectDraftCardProps {
  project: ProjectDraft;
  tasks: ReadonlyArray<TaskDraft>;
  issues: ReadonlyArray<GoalArchitectIssue>;
  onProjectChange: (projectId: string, patch: ProjectDraftEdit) => void;
  onTaskChange: (taskId: string, patch: TaskDraftEdit) => void;
}

const PRIORITY_OPTIONS: ReadonlyArray<{ value: '' | DraftPriority; label: string }> = [
  { value: '', label: '—' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export default function ProjectDraftCard({
  project,
  tasks,
  issues,
  onProjectChange,
  onTaskChange,
}: ProjectDraftCardProps) {
  const conf = interpretConfidence(project.confidence?.overall ?? 0);
  const pri = priorityStyle(project.priority);
  const projectIssues = issues.filter((i) => i.entityId === project.id);
  const taskIssuesById = new Map<string, GoalArchitectIssue[]>();
  for (const i of issues) {
    if (i.entityId && i.entityKind === 'task') {
      const bucket = taskIssuesById.get(i.entityId) ?? [];
      bucket.push(i);
      taskIssuesById.set(i.entityId, bucket);
    }
  }

  const handleTitle = (e: ChangeEvent<HTMLInputElement>) => {
    onProjectChange(project.id, { title: e.target.value });
  };
  const handleHours = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const parsed = raw === '' ? undefined : parseFloat(raw);
    onProjectChange(project.id, {
      targetHours:
        parsed === undefined || !Number.isFinite(parsed) ? undefined : parsed,
    });
  };
  const handleDate = (e: ChangeEvent<HTMLInputElement>) => {
    onProjectChange(project.id, { dueDateISO: e.target.value || undefined });
  };
  const handlePriority = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value as '' | DraftPriority;
    onProjectChange(project.id, { priority: v === '' ? undefined : v });
  };

  return (
    <article
      data-testid="goal-architect-project-card"
      className="rounded-xl border border-gray-100 bg-white overflow-hidden"
    >
      <header className="border-b border-gray-100 px-4 py-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
        <div className="sm:col-span-5">
          <input
            type="text"
            value={project.title}
            onChange={handleTitle}
            data-testid={`goal-architect-project-title-${project.id}`}
            aria-label="Project title"
            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
          />
        </div>
        <div className="sm:col-span-2">
          <input
            type="number"
            min={0}
            step="0.25"
            value={project.targetHours ?? ''}
            onChange={handleHours}
            data-testid={`goal-architect-project-hours-${project.id}`}
            aria-label="Project target hours"
            placeholder="hours"
            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
          />
        </div>
        <div className="sm:col-span-2">
          <input
            type="date"
            value={project.dueDateISO?.slice(0, 10) ?? ''}
            onChange={handleDate}
            aria-label="Project due date"
            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
          />
        </div>
        <div className="sm:col-span-2">
          <select
            value={project.priority ?? ''}
            onChange={handlePriority}
            aria-label="Project priority"
            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-1 flex items-center justify-end gap-1.5 text-[10px]">
          {pri && (
            <span
              className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-medium ${pri.badge}`}
            >
              {pri.label}
            </span>
          )}
          <span
            className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-medium ${conf.badge}`}
            title={`Confidence ${confidenceLabel(project.confidence?.overall ?? 0)}`}
          >
            {confidenceLabel(project.confidence?.overall ?? 0)}
          </span>
        </div>
      </header>

      <div className="px-4 py-2 text-[11px] text-gray-500 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <span>
          {tasks.length} task{tasks.length === 1 ? '' : 's'} ·{' '}
          {hoursLabel(project.targetHours)} target
        </span>
        {projectIssues.length > 0 && (
          <span className="text-amber-700">
            ⚠ {projectIssues.length} issue{projectIssues.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {tasks.length === 0 ? (
        <p className="px-4 py-4 text-xs text-gray-400 italic">
          Nessun task per questo project. Aggiungi task nel testo input e
          rigenera la bozza.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {tasks.map((task) => (
            <TaskDraftRow
              key={task.id}
              task={task}
              hasWarning={(taskIssuesById.get(task.id) ?? []).length > 0}
              onChange={onTaskChange}
            />
          ))}
        </ul>
      )}
    </article>
  );
}
