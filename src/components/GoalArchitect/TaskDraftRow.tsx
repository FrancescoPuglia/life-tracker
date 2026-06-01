'use client';

// src/components/GoalArchitect/TaskDraftRow.tsx
// Inline-editable row for a single TaskDraft.

import { ChangeEvent } from 'react';
import type { DraftPriority, TaskDraft } from '@/lib/goalArchitect';
import {
  confidenceLabel,
  hoursLabel,
  interpretConfidence,
  priorityStyle,
} from './goalArchitectUi';

export interface TaskDraftEdit {
  title?: string;
  estimatedHours?: number;
  dueDateISO?: string;
  priority?: DraftPriority;
}

export interface TaskDraftRowProps {
  task: TaskDraft;
  hasWarning?: boolean;
  onChange: (taskId: string, patch: TaskDraftEdit) => void;
}

const PRIORITY_OPTIONS: ReadonlyArray<{ value: '' | DraftPriority; label: string }> = [
  { value: '', label: '—' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export default function TaskDraftRow({
  task,
  hasWarning,
  onChange,
}: TaskDraftRowProps) {
  const conf = interpretConfidence(task.confidence?.overall ?? 0);
  const pri = priorityStyle(task.priority);

  const handleTitle = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(task.id, { title: e.target.value });
  };
  const handleHours = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const parsed = raw === '' ? undefined : parseFloat(raw);
    onChange(task.id, {
      estimatedHours:
        parsed === undefined || !Number.isFinite(parsed) ? undefined : parsed,
    });
  };
  const handleDate = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(task.id, { dueDateISO: e.target.value || undefined });
  };
  const handlePriority = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value as '' | DraftPriority;
    onChange(task.id, { priority: v === '' ? undefined : v });
  };

  return (
    <li
      data-testid="goal-architect-task-row"
      className={`px-4 py-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center border-l-4 ${
        hasWarning ? 'border-l-amber-400 bg-amber-50/30' : 'border-l-transparent'
      }`}
    >
      <div className="sm:col-span-5">
        <input
          type="text"
          value={task.title}
          onChange={handleTitle}
          data-testid={`goal-architect-task-title-${task.id}`}
          aria-label="Task title"
          className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
        />
        {task.sourceText && task.sourceText !== task.title && (
          <p className="text-[10px] text-gray-400 mt-0.5 italic truncate">
            “{task.sourceText}”
          </p>
        )}
      </div>
      <div className="sm:col-span-2">
        <input
          type="number"
          min={0}
          step="0.25"
          value={task.estimatedHours ?? ''}
          onChange={handleHours}
          data-testid={`goal-architect-task-hours-${task.id}`}
          aria-label="Task estimated hours"
          placeholder="hours"
          className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
        />
      </div>
      <div className="sm:col-span-2">
        <input
          type="date"
          value={task.dueDateISO?.slice(0, 10) ?? ''}
          onChange={handleDate}
          aria-label="Task due date"
          className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
        />
      </div>
      <div className="sm:col-span-2">
        <select
          value={task.priority ?? ''}
          onChange={handlePriority}
          aria-label="Task priority"
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
          title={`Confidence ${confidenceLabel(task.confidence?.overall ?? 0)}`}
        >
          {confidenceLabel(task.confidence?.overall ?? 0)}
        </span>
      </div>
      <p className="sm:col-span-12 text-[10px] text-gray-400">
        {hoursLabel(task.estimatedHours)} · target {task.dueDateISO ? task.dueDateISO.slice(0, 10) : '—'}
      </p>
    </li>
  );
}
