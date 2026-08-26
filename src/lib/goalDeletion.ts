import type { Goal, KeyResult, Project, Task } from '@/types';
import type { AtomicDeleteOperation } from './firebaseAdapter';

export interface GoalDeletionPlan {
  readonly goalId: string;
  readonly keyResultIds: readonly string[];
  readonly projectIds: readonly string[];
  readonly taskIds: readonly string[];
  readonly operations: readonly AtomicDeleteOperation[];
}

interface BuildGoalDeletionPlanInput {
  readonly ownerUid: string;
  readonly goal: Goal;
  readonly keyResults: readonly KeyResult[];
  readonly projects: readonly Project[];
  readonly tasks: readonly Task[];
}

/**
 * Builds the complete owner-scoped hierarchy that must disappear with a Goal.
 * TimeBlocks and Sessions deliberately remain as immutable execution history;
 * they may retain descriptive references to an entity that no longer exists.
 */
export function buildGoalDeletionPlan(
  input: BuildGoalDeletionPlanInput,
): GoalDeletionPlan {
  const { ownerUid, goal } = input;
  if (!ownerUid || goal.userId !== ownerUid) {
    throw new Error('Goal deletion requires the authenticated owner.');
  }

  const keyResultIds = uniqueIds(input.keyResults.filter((keyResult) => (
    keyResult.userId === ownerUid && keyResult.goalId === goal.id
  )));
  const projects = input.projects.filter((project) => (
    project.userId === ownerUid && project.goalId === goal.id
  ));
  const projectIds = uniqueIds(projects);
  const projectIdSet = new Set(projectIds);
  const taskIds = uniqueIds(input.tasks.filter((task) => (
    task.userId === ownerUid
    && (
      projectIdSet.has(task.projectId)
      || task.goalId === goal.id
      || task.goalIds?.includes(goal.id) === true
    )
  )));

  const operations: AtomicDeleteOperation[] = [
    ...keyResultIds.map((id) => ({ collection: 'keyResults' as const, id })),
    ...taskIds.map((id) => ({ collection: 'tasks' as const, id })),
    ...projectIds.map((id) => ({ collection: 'projects' as const, id })),
    { collection: 'goals', id: goal.id },
  ];

  return Object.freeze({
    goalId: goal.id,
    keyResultIds: Object.freeze(keyResultIds),
    projectIds: Object.freeze(projectIds),
    taskIds: Object.freeze(taskIds),
    operations: Object.freeze(operations),
  });
}

function uniqueIds(entities: ReadonlyArray<{ readonly id: string }>): string[] {
  return [...new Set(entities.map((entity) => entity.id))];
}
