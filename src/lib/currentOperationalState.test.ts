import { describe, expect, it } from 'vitest';
import type { Goal, KeyResult, Project, Session, Task, TimeBlock } from '@/types';
import {
  reconcileCurrentOperationalSelection,
  selectCurrentOperationalState,
} from './currentOperationalState';

const OWNER = 'owner-1';

describe('current operational referential integrity', () => {
  it('reproduces the production ghost and excludes it without erasing historical evidence', () => {
    const ghost = task({
      id: 'legacy-task',
      title: 'i 100 studi che bisogna conoscere',
      priority: 'critical',
      projectId: 'deleted-project',
      goalId: 'deleted-goal',
    });
    const future = block({
      id: 'future-orphan',
      taskId: ghost.id,
      projectId: ghost.projectId,
      goalId: ghost.goalId,
      status: 'planned',
    });
    const past = block({
      id: 'past-completed',
      taskId: ghost.id,
      projectId: ghost.projectId,
      goalId: ghost.goalId,
      status: 'completed',
    });
    const cancelled = block({
      id: 'past-cancelled',
      taskId: ghost.id,
      status: 'cancelled',
    });
    const overrun = block({
      id: 'past-overrun',
      taskId: ghost.id,
      status: 'overrun',
    });
    const completedSession = session({
      taskId: ghost.id,
      timeBlockId: past.id,
      status: 'completed',
    });
    const immutableReportEvidence = Object.freeze({ reportId: 'report-1', artifactHash: 'hash' });

    const result = selectCurrentOperationalState({
      ownerUid: OWNER,
      goals: [],
      keyResults: [keyResult()],
      projects: [project({ id: 'deleted-project', goalId: 'deleted-goal' })],
      tasks: [ghost],
      timeBlocks: [future, past, cancelled, overrun],
    });

    expect(result.goals).toEqual([]);
    expect(result.keyResults).toEqual([]);
    expect(result.projects).toEqual([]);
    expect(result.tasks).toEqual([]);
    expect(result.timeBlocks.map(({ id }) => id)).toEqual([
      'past-completed', 'past-cancelled', 'past-overrun',
    ]);
    expect(result.issues).toEqual([
      { entity: 'keyResult', id: 'kr-1', reason: 'missing_goal' },
      { entity: 'project', id: 'deleted-project', reason: 'missing_goal' },
      { entity: 'task', id: 'legacy-task', reason: 'missing_project' },
      { entity: 'timeBlock', id: 'future-orphan', reason: 'missing_task' },
    ]);
    expect(completedSession).toMatchObject({ taskId: ghost.id, timeBlockId: past.id, status: 'completed' });
    expect(immutableReportEvidence).toEqual({ reportId: 'report-1', artifactHash: 'hash' });
  });

  it('keeps the remaining valid test Goal hierarchy and every coherent current candidate', () => {
    const testGoal = goal({ id: 'goal-p', title: 'p' });
    const testProject = project({ id: 'project-p', goalId: testGoal.id });
    const testTask = task({ id: 'task-p', projectId: testProject.id, goalId: testGoal.id });
    const currentBlock = block({
      id: 'block-p',
      taskId: testTask.id,
      projectId: testProject.id,
      goalId: testGoal.id,
    });

    const result = selectCurrentOperationalState({
      ownerUid: OWNER,
      goals: [testGoal],
      keyResults: [keyResult({ goalId: testGoal.id })],
      projects: [testProject],
      tasks: [testTask],
      timeBlocks: [currentBlock],
    });

    expect(result.goals.map(({ title }) => title)).toEqual(['p']);
    expect(result.projects.map(({ id }) => id)).toEqual(['project-p']);
    expect(result.tasks.map(({ id }) => id)).toEqual(['task-p']);
    expect(result.timeBlocks.map(({ id }) => id)).toEqual(['block-p']);
    expect(result.issues).toEqual([]);
  });

  it('fails closed on partial, foreign, multi-goal, and link-free current references', () => {
    const activeGoal = goal();
    const activeProject = project();
    const result = selectCurrentOperationalState({
      ownerUid: OWNER,
      goals: [activeGoal, goal({ id: 'foreign-goal', userId: 'owner-2' })],
      keyResults: [],
      projects: [activeProject],
      tasks: [
        task({ id: 'valid' }),
        task({ id: 'missing-project', projectId: '' }),
        task({ id: 'stale-extra-goal', goalIds: [activeGoal.id, 'deleted-goal'] }),
        task({ id: 'foreign', userId: 'owner-2' }),
      ],
      timeBlocks: [
        block({ id: 'valid-block', taskId: 'valid' }),
        block({ id: 'link-free', taskId: undefined, projectId: undefined, goalId: undefined }),
        block({ id: 'stale-goal', goalId: 'deleted-goal', taskId: undefined }),
      ],
    });

    expect(result.tasks.map(({ id }) => id)).toEqual(['valid']);
    expect(result.timeBlocks.map(({ id }) => id)).toEqual(['valid-block']);
    expect(result.issues).toEqual(expect.arrayContaining([
      { entity: 'task', id: 'missing-project', reason: 'missing_project' },
      { entity: 'task', id: 'stale-extra-goal', reason: 'missing_goal' },
      { entity: 'timeBlock', id: 'link-free', reason: 'missing_reference' },
      { entity: 'timeBlock', id: 'stale-goal', reason: 'missing_goal' },
    ]));
  });

  it('is deterministic and idempotent without mutating the authoritative snapshot', () => {
    const raw = {
      ownerUid: OWNER,
      goals: [goal()],
      keyResults: [keyResult()],
      projects: [project()],
      tasks: [task()],
      timeBlocks: [block()],
    };
    const before = raw.tasks[0];
    const first = selectCurrentOperationalState(raw);
    const second = selectCurrentOperationalState(raw);

    expect(second).toEqual(first);
    expect(raw.tasks[0]).toBe(before);
    expect(raw.tasks[0].deleted).toBeUndefined();
  });

  it('clears selected Goal and Project IDs when a listener removes their hierarchy', () => {
    expect(reconcileCurrentOperationalSelection(
      'deleted-goal',
      'deleted-project',
      [goal({ id: 'goal-p', title: 'p' })],
      [project({ id: 'project-p', goalId: 'goal-p' })],
    )).toEqual({ goalId: null, projectId: null });
    expect(reconcileCurrentOperationalSelection(
      'goal-p',
      'deleted-project',
      [goal({ id: 'goal-p', title: 'p' })],
      [project({ id: 'project-p', goalId: 'goal-p' })],
    )).toEqual({ goalId: 'goal-p', projectId: null });
  });
});

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1', userId: OWNER, domainId: 'domain-1', title: 'Goal', status: 'active',
    priority: 'high', targetDate: new Date('2026-12-31T00:00:00.000Z'),
    timeAllocationTarget: 5, keyResults: [], category: 'important_not_urgent',
    complexity: 'moderate', createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'), ...overrides,
  };
}

function keyResult(overrides: Partial<KeyResult> = {}): KeyResult {
  return {
    id: 'kr-1', userId: OWNER, domainId: 'domain-1', goalId: 'goal-1', title: 'KR',
    targetValue: 1, currentValue: 0, status: 'active',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'), ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1', userId: OWNER, domainId: 'domain-1', goalId: 'goal-1',
    name: 'Project', status: 'active', priority: 'high',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'), ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1', userId: OWNER, domainId: 'domain-1', projectId: 'project-1',
    goalId: 'goal-1', title: 'Task', status: 'pending', priority: 'critical',
    estimatedMinutes: 30, createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'), ...overrides,
  };
}

function block(overrides: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id: 'block-1', userId: OWNER, domainId: 'domain-1', title: 'Block', taskId: 'task-1',
    startTime: new Date('2026-08-28T09:00:00.000Z'),
    endTime: new Date('2026-08-28T10:00:00.000Z'), status: 'planned', type: 'focus',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'), ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1', userId: OWNER, domainId: 'domain-1', status: 'completed', tags: [],
    startTime: new Date('2026-08-27T09:00:00.000Z'),
    endTime: new Date('2026-08-27T10:00:00.000Z'), duration: 3_600,
    createdAt: new Date('2026-08-27T09:00:00.000Z'),
    updatedAt: new Date('2026-08-27T10:00:00.000Z'), ...overrides,
  };
}
