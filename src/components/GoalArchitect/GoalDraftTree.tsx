'use client';

// src/components/GoalArchitect/GoalDraftTree.tsx
// Renders Projects → Tasks plus the "direct tasks" bucket for tasks attached
// straight to the Goal (no project parent).

import type {
  GoalArchitectIssue,
  ProjectDraft,
  TaskDraft,
} from '@/lib/goalArchitect';
import ProjectDraftCard, {
  type ProjectDraftEdit,
} from './ProjectDraftCard';
import TaskDraftRow, { type TaskDraftEdit } from './TaskDraftRow';

export interface GoalDraftTreeProps {
  projects: ReadonlyArray<ProjectDraft>;
  tasks: ReadonlyArray<TaskDraft>;
  issues: ReadonlyArray<GoalArchitectIssue>;
  onProjectChange: (projectId: string, patch: ProjectDraftEdit) => void;
  onTaskChange: (taskId: string, patch: TaskDraftEdit) => void;
}

export default function GoalDraftTree({
  projects,
  tasks,
  issues,
  onProjectChange,
  onTaskChange,
}: GoalDraftTreeProps) {
  const tasksByProject = new Map<string, TaskDraft[]>();
  const directTasks: TaskDraft[] = [];
  for (const task of tasks) {
    if (task.parentProjectId) {
      const bucket = tasksByProject.get(task.parentProjectId) ?? [];
      bucket.push(task);
      tasksByProject.set(task.parentProjectId, bucket);
    } else {
      directTasks.push(task);
    }
  }

  return (
    <section
      aria-label="Goal draft tree"
      data-testid="goal-architect-tree"
      className="space-y-4"
    >
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 px-1">
          Projects ({projects.length})
        </h3>
        {projects.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-500 italic rounded-xl border border-dashed border-gray-200 bg-white">
            Nessun Project nella bozza. Aggiungili nel testo input.
          </p>
        ) : (
          projects.map((project) => (
            <ProjectDraftCard
              key={project.id}
              project={project}
              tasks={tasksByProject.get(project.id) ?? []}
              issues={issues}
              onProjectChange={onProjectChange}
              onTaskChange={onTaskChange}
            />
          ))
        )}
      </div>

      {directTasks.length > 0 && (
        <section
          aria-label="Direct tasks"
          data-testid="goal-architect-direct-tasks"
          className="rounded-2xl border border-amber-100 bg-amber-50/30 overflow-hidden"
        >
          <header className="border-b border-amber-100 px-5 py-3">
            <h3 className="text-sm font-semibold text-amber-900">
              Tasks directly linked to Goal
            </h3>
            <p className="text-[11px] text-amber-700/80 mt-0.5">
              Questi task non hanno un Project parent. Considera di raggrupparli.
            </p>
          </header>
          <ul className="divide-y divide-amber-100 bg-white">
            {directTasks.map((task) => (
              <TaskDraftRow
                key={task.id}
                task={task}
                hasWarning
                onChange={onTaskChange}
              />
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
