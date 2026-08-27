import type { Goal, KeyResult, Project, Task, TimeBlock } from '@/types';

export type ReferentialIntegrityEntity = 'keyResult' | 'project' | 'task' | 'timeBlock';
export type ReferentialIntegrityReason =
  | 'missing_goal'
  | 'missing_project'
  | 'missing_task'
  | 'missing_reference';

export interface ReferentialIntegrityIssue {
  readonly entity: ReferentialIntegrityEntity;
  readonly id: string;
  readonly reason: ReferentialIntegrityReason;
}

export interface CurrentOperationalStateInput {
  readonly ownerUid: string;
  readonly goals: readonly Goal[];
  readonly keyResults: readonly KeyResult[];
  readonly projects: readonly Project[];
  readonly tasks: readonly Task[];
  readonly timeBlocks: readonly TimeBlock[];
}

export interface CurrentOperationalState {
  readonly goals: readonly Goal[];
  readonly keyResults: readonly KeyResult[];
  readonly projects: readonly Project[];
  readonly tasks: readonly Task[];
  /**
   * Current coherent blocks plus terminal historical blocks. A completed or
   * cancelled block remains available to execution history even after its
   * strategic hierarchy is deleted; a non-terminal orphan never reaches
   * Today, Now/Next, Planner candidates, reminders, or schedulers.
   */
  readonly timeBlocks: readonly TimeBlock[];
  readonly issues: readonly ReferentialIntegrityIssue[];
}

export interface CurrentOperationalSelection {
  readonly goalId: string | null;
  readonly projectId: string | null;
}

/**
 * Reconciles the authenticated snapshot into the single current operational
 * view consumed by the application. It is read-only: Firestore documents and
 * historical execution evidence are never mutated or erased here.
 */
export function selectCurrentOperationalState(
  input: CurrentOperationalStateInput,
): CurrentOperationalState {
  if (!input.ownerUid) throw new Error('Current operational state requires an authenticated owner.');

  const goals = input.goals.filter((goal) => ownedAndLive(goal, input.ownerUid));
  const goalIds = new Set(goals.map(({ id }) => id));
  const issues: ReferentialIntegrityIssue[] = [];

  const keyResults = input.keyResults.filter((keyResult) => {
    if (!ownedAndLive(keyResult, input.ownerUid)) return false;
    if (goalIds.has(keyResult.goalId)) return true;
    issues.push(issue('keyResult', keyResult.id, 'missing_goal'));
    return false;
  });

  const projects = input.projects.filter((project) => {
    if (!ownedAndLive(project, input.ownerUid)) return false;
    if (goalIds.has(project.goalId)) return true;
    issues.push(issue('project', project.id, 'missing_goal'));
    return false;
  });
  const projectIds = new Set(projects.map(({ id }) => id));

  const tasks = input.tasks.filter((task) => {
    if (!ownedAndLive(task, input.ownerUid)) return false;
    const reason = invalidTaskReferenceReason(task, projectIds, goalIds);
    if (!reason) return true;
    issues.push(issue('task', task.id, reason));
    return false;
  });
  const taskIds = new Set(tasks.map(({ id }) => id));

  const timeBlocks = input.timeBlocks.filter((block) => {
    if (!ownedAndLive(block, input.ownerUid)) return false;
    if (
      block.status === 'completed'
      || block.status === 'cancelled'
      || block.status === 'overrun'
    ) return true;
    const reason = invalidTimeBlockReferenceReason(block, taskIds, projectIds, goalIds);
    if (!reason) return true;
    issues.push(issue('timeBlock', block.id, reason));
    return false;
  });

  return Object.freeze({
    goals: Object.freeze(goals),
    keyResults: Object.freeze(keyResults),
    projects: Object.freeze(projects),
    tasks: Object.freeze(tasks),
    timeBlocks: Object.freeze(timeBlocks),
    issues: Object.freeze(issues),
  });
}

export function isTaskOperationallyCurrent(
  task: Task,
  ownerUid: string,
  goals: readonly Goal[],
  projects: readonly Project[],
): boolean {
  if (!ownedAndLive(task, ownerUid)) return false;
  const goalIds = new Set(
    goals.filter((goal) => ownedAndLive(goal, ownerUid)).map(({ id }) => id),
  );
  const projectIds = new Set(
    projects
      .filter((project) => ownedAndLive(project, ownerUid) && goalIds.has(project.goalId))
      .map(({ id }) => id),
  );
  return invalidTaskReferenceReason(task, projectIds, goalIds) === null;
}

/** Clears navigation state that no longer belongs to the current hierarchy. */
export function reconcileCurrentOperationalSelection(
  selectedGoalId: string | null,
  selectedProjectId: string | null,
  goals: readonly Goal[],
  projects: readonly Project[],
): CurrentOperationalSelection {
  const goal = selectedGoalId
    ? goals.find(({ id }) => id === selectedGoalId)
    : undefined;
  if (!goal) return Object.freeze({ goalId: null, projectId: null });
  const project = selectedProjectId
    ? projects.find(({ id }) => id === selectedProjectId && goal.id === selectedGoalId)
    : undefined;
  if (!project || project.goalId !== goal.id) {
    return Object.freeze({ goalId: goal.id, projectId: null });
  }
  return Object.freeze({ goalId: goal.id, projectId: project.id });
}

function invalidTaskReferenceReason(
  task: Task,
  projectIds: ReadonlySet<string>,
  goalIds: ReadonlySet<string>,
): ReferentialIntegrityReason | null {
  if (!validId(task.projectId) || !projectIds.has(task.projectId)) return 'missing_project';
  const referencedGoals = ids(task.goalId, ...(task.goalIds ?? []));
  return referencedGoals.some((id) => !goalIds.has(id)) ? 'missing_goal' : null;
}

function invalidTimeBlockReferenceReason(
  block: TimeBlock,
  taskIds: ReadonlySet<string>,
  projectIds: ReadonlySet<string>,
  goalIds: ReadonlySet<string>,
): ReferentialIntegrityReason | null {
  const referencedTasks = ids(block.taskId, ...(block.taskIds ?? []));
  const referencedProjects = ids(block.projectId);
  const referencedGoals = ids(
    block.goalId,
    ...(block.goalIds ?? []),
    ...Object.keys(block.goalAllocation ?? {}),
    ...Object.keys(block.expectedImpact ?? {}),
  );
  if (referencedTasks.length + referencedProjects.length + referencedGoals.length === 0) {
    return 'missing_reference';
  }
  if (referencedTasks.some((id) => !taskIds.has(id))) return 'missing_task';
  if (referencedProjects.some((id) => !projectIds.has(id))) return 'missing_project';
  if (referencedGoals.some((id) => !goalIds.has(id))) return 'missing_goal';
  return null;
}

function ownedAndLive(
  entity: Readonly<{ userId: string; deleted?: boolean }>,
  ownerUid: string,
): boolean {
  return entity.userId === ownerUid && entity.deleted !== true;
}

function ids(...values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter(validId))];
}

function validId(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function issue(
  entity: ReferentialIntegrityEntity,
  id: string,
  reason: ReferentialIntegrityReason,
): ReferentialIntegrityIssue {
  return Object.freeze({ entity, id, reason });
}
