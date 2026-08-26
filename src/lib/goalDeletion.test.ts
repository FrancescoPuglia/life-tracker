import { describe, expect, it } from 'vitest';

import type { Goal, KeyResult, Project, Task } from '@/types';
import { buildGoalDeletionPlan } from './goalDeletion';

const ownerUid = 'owner-a';

describe('buildGoalDeletionPlan', () => {
  it('covers the Goal, Key Results, Projects, and every directly or transitively linked Task', () => {
    const plan = buildGoalDeletionPlan({
      ownerUid,
      goal: goal(),
      keyResults: [keyResult('kr-linked', 'goal-a'), keyResult('kr-other', 'goal-b')],
      projects: [project('project-linked', 'goal-a'), project('project-other', 'goal-b')],
      tasks: [
        task('task-project', { projectId: 'project-linked' }),
        task('task-goal', { projectId: 'project-other', goalId: 'goal-a' }),
        task('task-goals', { projectId: 'project-other', goalIds: ['goal-a', 'goal-b'] }),
        task('task-other', { projectId: 'project-other', goalId: 'goal-b' }),
      ],
    });

    expect(plan.keyResultIds).toEqual(['kr-linked']);
    expect(plan.projectIds).toEqual(['project-linked']);
    expect(plan.taskIds).toEqual(['task-project', 'task-goal', 'task-goals']);
    expect(plan.operations).toEqual([
      { collection: 'keyResults', id: 'kr-linked' },
      { collection: 'tasks', id: 'task-project' },
      { collection: 'tasks', id: 'task-goal' },
      { collection: 'tasks', id: 'task-goals' },
      { collection: 'projects', id: 'project-linked' },
      { collection: 'goals', id: 'goal-a' },
    ]);
  });

  it('never includes foreign-owner children even when their references match', () => {
    const plan = buildGoalDeletionPlan({
      ownerUid,
      goal: goal(),
      keyResults: [keyResult('foreign-kr', 'goal-a', 'owner-b')],
      projects: [project('foreign-project', 'goal-a', 'owner-b')],
      tasks: [task('foreign-task', { projectId: 'foreign-project', goalId: 'goal-a', userId: 'owner-b' })],
    });

    expect(plan.operations).toEqual([{ collection: 'goals', id: 'goal-a' }]);
  });

  it('fails closed when the Goal is not owned by the authenticated user', () => {
    expect(() => buildGoalDeletionPlan({
      ownerUid,
      goal: goal({ userId: 'owner-b' }),
      keyResults: [],
      projects: [],
      tasks: [],
    })).toThrow('authenticated owner');
  });
});

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-a',
    userId: ownerUid,
    domainId: 'domain-a',
    title: 'Disposable Goal',
    status: 'active',
    priority: 'high',
    targetDate: new Date('2026-12-31T00:00:00.000Z'),
    timeAllocationTarget: 5,
    keyResults: [],
    category: 'important_not_urgent',
    complexity: 'moderate',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function keyResult(id: string, goalId: string, userId = ownerUid): KeyResult {
  return {
    id,
    userId,
    domainId: 'domain-a',
    goalId,
    title: id,
    targetValue: 1,
    currentValue: 0,
    status: 'active',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function project(id: string, goalId: string, userId = ownerUid): Project {
  return {
    id,
    userId,
    domainId: 'domain-a',
    goalId,
    name: id,
    status: 'active',
    priority: 'medium',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function task(
  id: string,
  overrides: Partial<Task>,
): Task {
  return {
    id,
    userId: ownerUid,
    domainId: 'domain-a',
    projectId: '',
    title: id,
    status: 'pending',
    priority: 'medium',
    estimatedMinutes: 30,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}
