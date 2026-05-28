// src/components/WeeklyPlanning/weeklyPlanningAdapters.ts
// Converts the app's real domain models into the lightweight *Like shapes
// consumed by the deterministic weeklyPlanner core. Keeps the engine
// decoupled from `@/types` and lets us evolve either side independently.

import type { GoalLike, ProjectLike, TaskLike } from '@/lib/weeklyPlanner';

// ============================================================================
// Structural input shapes — intentionally permissive so the adapter works
// with the real Goal/Project/Task and any future variant. No `any`.
// ============================================================================

export interface GoalSource {
  id: string;
  title?: string;
  name?: string;
  description?: string;
  priority?: number | string;
}

export interface ProjectSource {
  id: string;
  // Real `Project` uses `name`, but legacy data may have `title` instead.
  name?: string;
  title?: string;
  description?: string;
  goalId?: string;
  priority?: number | string;
}

export interface TaskSource {
  id: string;
  title?: string;
  name?: string;
  description?: string;
  projectId?: string;
  goalId?: string;
  estimatedMinutes?: number;
  priority?: number | string;
}

// ============================================================================
// Priority mapping — the weeklyPlanner engine works on a numeric scale,
// the real domain uses a string union. Map deterministically.
// ============================================================================

const STRING_PRIORITY: Record<string, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
};

function normalizePriority(p?: number | string): number | undefined {
  if (p === undefined || p === null) return undefined;
  if (typeof p === 'number') return p;
  const key = p.toLowerCase();
  return STRING_PRIORITY[key] ?? undefined;
}

function nonEmpty(s: string | undefined): string | undefined {
  if (s === undefined || s === null) return undefined;
  const t = s.trim();
  return t.length > 0 ? t : undefined;
}

// ============================================================================
// Public adapters
// ============================================================================

export function toGoalLike(goal: GoalSource): GoalLike {
  return {
    id: goal.id,
    title: nonEmpty(goal.title) ?? nonEmpty(goal.name) ?? '(senza titolo)',
    description: nonEmpty(goal.description),
    priority: normalizePriority(goal.priority),
  };
}

export function toProjectLike(project: ProjectSource): ProjectLike {
  return {
    id: project.id,
    title: nonEmpty(project.name) ?? nonEmpty(project.title) ?? '(senza titolo)',
    description: nonEmpty(project.description),
    goalId: project.goalId,
    priority: normalizePriority(project.priority),
  };
}

export function toTaskLike(task: TaskSource): TaskLike {
  return {
    id: task.id,
    title: nonEmpty(task.title) ?? nonEmpty(task.name) ?? '(senza titolo)',
    description: nonEmpty(task.description),
    projectId: task.projectId,
    goalId: task.goalId,
    estimatedMinutes: task.estimatedMinutes,
    priority: normalizePriority(task.priority),
  };
}

export function toGoalLikes(goals: ReadonlyArray<GoalSource>): GoalLike[] {
  return goals.map(toGoalLike);
}
export function toProjectLikes(
  projects: ReadonlyArray<ProjectSource>,
): ProjectLike[] {
  return projects.map(toProjectLike);
}
export function toTaskLikes(tasks: ReadonlyArray<TaskSource>): TaskLike[] {
  return tasks.map(toTaskLike);
}
