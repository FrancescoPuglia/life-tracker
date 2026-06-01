// src/components/GoalArchitect/goalArchitectDataAdapters.ts
// Convert DataProvider entities into the snapshot shapes consumed by the
// commit pipeline. Pure, no React. Decoupling here lets the commit module
// stay independent of `@/types`.

import type { Goal, KeyResult, Project, Task } from '@/types';
import type {
  ExistingGoalSnapshot,
  ExistingKeyResultSnapshot,
  ExistingProjectSnapshot,
  ExistingTaskSnapshot,
} from '@/lib/goalArchitect';

export function goalsToExistingGoalSnapshots(
  goals: ReadonlyArray<Goal>,
): ExistingGoalSnapshot[] {
  return goals.map((g) => ({
    id: g.id,
    title: g.title,
    description: g.description,
  }));
}

export function projectsToExistingProjectSnapshots(
  projects: ReadonlyArray<Project>,
): ExistingProjectSnapshot[] {
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    goalId: p.goalId,
  }));
}

export function tasksToExistingTaskSnapshots(
  tasks: ReadonlyArray<Task>,
): ExistingTaskSnapshot[] {
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    projectId: t.projectId,
    goalId: t.goalId,
    estimatedMinutes: t.estimatedMinutes,
  }));
}

export function keyResultsToExistingKeyResultSnapshots(
  keyResults: ReadonlyArray<KeyResult>,
): ExistingKeyResultSnapshot[] {
  return keyResults.map((kr) => ({
    id: kr.id,
    title: kr.title,
    description: kr.description,
    goalId: kr.goalId,
  }));
}
