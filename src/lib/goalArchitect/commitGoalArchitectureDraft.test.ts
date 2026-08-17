// src/lib/goalArchitect/commitGoalArchitectureDraft.test.ts

import { describe, expect, it, vi } from 'vitest';
import {
  commitGoalArchitectureDraft,
  draftGoalToCreateGoalPayload,
  draftKeyResultToCreateKeyResultPayload,
  draftProjectToCreateProjectPayload,
  draftTaskToCreateTaskPayload,
  gaiKey,
  validateDraftForGoalArchitectCommit,
  type CommitGoalPayload,
  type CommitKeyResultPayload,
  type CommitProjectPayload,
  type CommitTaskPayload,
  type CreateGoalFn,
  type CreateKeyResultFn,
  type CreateProjectFn,
  type CreateTaskFn,
  type GoalArchitectCommitInput,
} from './commitGoalArchitectureDraft';
import { parseGoalArchitecture } from './parseGoalArchitecture';
import { createChessGoalArchitectInputText } from './parserFixtures';
import type { GoalArchitectureDraft } from './types';

// ============================================================================
// HELPERS
// ============================================================================

function makeChessDraft(): GoalArchitectureDraft {
  return parseGoalArchitecture(createChessGoalArchitectInputText());
}

interface FakeCreateFns {
  createGoal: CreateGoalFn;
  createProject: CreateProjectFn;
  createTask: CreateTaskFn;
  createKeyResult: CreateKeyResultFn;
  goalCalls: CommitGoalPayload[];
  projectCalls: CommitProjectPayload[];
  taskCalls: CommitTaskPayload[];
  krCalls: CommitKeyResultPayload[];
  callOrder: string[];
}

function makeFakeCreateFns(overrides?: {
  goalReturns?: (input: CommitGoalPayload, index: number) => string | undefined;
  projectReturns?: (
    input: CommitProjectPayload,
    index: number,
  ) => string | undefined;
  taskReturns?: (input: CommitTaskPayload, index: number) => string | undefined;
  krReturns?: (
    input: CommitKeyResultPayload,
    index: number,
  ) => string | undefined;
  goalThrows?: boolean;
  projectThrowsOnIndex?: number;
}): FakeCreateFns {
  let goalIndex = 0;
  let projectIndex = 0;
  let taskIndex = 0;
  let krIndex = 0;
  const goalCalls: CommitGoalPayload[] = [];
  const projectCalls: CommitProjectPayload[] = [];
  const taskCalls: CommitTaskPayload[] = [];
  const krCalls: CommitKeyResultPayload[] = [];
  const callOrder: string[] = [];

  const createGoal: CreateGoalFn = async (input) => {
    if (overrides?.goalThrows) {
      callOrder.push(`goal:throw`);
      throw new Error('boom');
    }
    callOrder.push(`goal:${input.title}`);
    goalCalls.push(input);
    const i = goalIndex++;
    if (overrides?.goalReturns) return overrides.goalReturns(input, i);
    return `real-goal-${i}`;
  };
  const createProject: CreateProjectFn = async (input) => {
    const i = projectIndex++;
    if (overrides?.projectThrowsOnIndex === i) {
      callOrder.push(`project:throw:${i}`);
      throw new Error('proj-fail');
    }
    callOrder.push(`project:${input.name}`);
    projectCalls.push(input);
    if (overrides?.projectReturns) return overrides.projectReturns(input, i);
    return `real-project-${i}`;
  };
  const createTask: CreateTaskFn = async (input) => {
    callOrder.push(`task:${input.title}`);
    taskCalls.push(input);
    const i = taskIndex++;
    if (overrides?.taskReturns) return overrides.taskReturns(input, i);
    return `real-task-${i}`;
  };
  const createKeyResult: CreateKeyResultFn = async (input) => {
    callOrder.push(`kr:${input.title}`);
    krCalls.push(input);
    const i = krIndex++;
    if (overrides?.krReturns) return overrides.krReturns(input, i);
    return `real-kr-${i}`;
  };

  return {
    createGoal,
    createProject,
    createTask,
    createKeyResult,
    goalCalls,
    projectCalls,
    taskCalls,
    krCalls,
    callOrder,
  };
}

function baseInput(
  draft: GoalArchitectureDraft | null,
  fns: Partial<FakeCreateFns> = {},
): GoalArchitectCommitInput {
  return {
    draft,
    existingGoals: [],
    existingProjects: [],
    existingTasks: [],
    existingKeyResults: [],
    createGoal: fns.createGoal,
    createProject: fns.createProject,
    createTask: fns.createTask,
    createKeyResult: fns.createKeyResult,
  };
}

// ============================================================================
// VALIDATION
// ============================================================================

describe('validateDraftForGoalArchitectCommit', () => {
  it('blocks when no draft is supplied', () => {
    const v = validateDraftForGoalArchitectCommit(baseInput(null));
    expect(v.canCommit).toBe(false);
    expect(v.blockedReasons.some((r) => r.code === 'no_draft')).toBe(true);
  });

  it('blocks when draft has no goal', () => {
    const draft = parseGoalArchitecture('random text without any goal');
    const v = validateDraftForGoalArchitectCommit(baseInput(draft));
    expect(v.canCommit).toBe(false);
    expect(v.blockedReasons.some((r) => r.code === 'no_goal')).toBe(true);
  });

  it('blocks when draft has error issues', () => {
    const draft = makeChessDraft();
    // Force a validation error by clearing the goal title.
    if (draft.goal) draft.goal.title = '';
    const fns = makeFakeCreateFns();
    const v = validateDraftForGoalArchitectCommit({
      draft,
      existingGoals: [],
      existingProjects: [],
      existingTasks: [],
      existingKeyResults: [],
      createGoal: fns.createGoal,
      createProject: fns.createProject,
      createTask: fns.createTask,
      createKeyResult: fns.createKeyResult,
    });
    expect(v.canCommit).toBe(false);
    expect(
      v.blockedReasons.some(
        (r) => r.code === 'validation_error' || r.code === 'cannot_commit',
      ),
    ).toBe(true);
  });

  it('blocks when createGoal is missing', () => {
    const draft = makeChessDraft();
    const v = validateDraftForGoalArchitectCommit({
      draft,
      existingGoals: [],
      existingProjects: [],
      existingTasks: [],
      existingKeyResults: [],
      // createGoal omitted intentionally
    });
    expect(v.canCommit).toBe(false);
    expect(v.blockedReasons.some((r) => r.code === 'missing_create_goal')).toBe(
      true,
    );
  });

  it('allows commit when dependencies are present', () => {
    const draft = makeChessDraft();
    const fns = makeFakeCreateFns();
    const v = validateDraftForGoalArchitectCommit({
      draft,
      existingGoals: [],
      existingProjects: [],
      existingTasks: [],
      existingKeyResults: [],
      createGoal: fns.createGoal,
      createProject: fns.createProject,
      createTask: fns.createTask,
      createKeyResult: fns.createKeyResult,
    });
    expect(v.canCommit).toBe(true);
    expect(v.blockedReasons).toEqual([]);
  });
});

// ============================================================================
// PAYLOAD MAPPING
// ============================================================================

describe('payload mapping', () => {
  it('Goal payload includes GAI_KEY in description', () => {
    const draft = makeChessDraft();
    const payload = draftGoalToCreateGoalPayload(draft, 'default');
    expect(payload).not.toBeNull();
    expect(payload?.title).toBe(draft.goal?.title);
    expect(payload?.description).toContain('GAI_KEY:');
    expect(payload?.description).toContain(
      gaiKey(draft.id, 'goal', draft.goal?.id ?? ''),
    );
    expect(payload?.targetDate).toBeInstanceOf(Date);
    expect(payload?.targetHours).toBe(draft.goal?.targetHours);
    expect(payload?.domainId).toBe('default');
  });

  it('Project payload uses `name` and the real goalId', () => {
    const draft = makeChessDraft();
    const project = draft.projects[0];
    const payload = draftProjectToCreateProjectPayload(
      project,
      draft,
      'real-goal-x',
      'default',
    );
    expect(payload.name).toBe(project.title);
    expect(payload.goalId).toBe('real-goal-x');
    expect(payload.totalHoursTarget).toBe(project.targetHours);
    expect(payload.description).toContain('GAI_KEY:');
  });

  it('Task payload converts hours to minutes', () => {
    const draft = makeChessDraft();
    const task = draft.tasks.find((t) => (t.estimatedHours ?? 0) > 0);
    if (!task) throw new Error('Chess fixture should have an estimated task');
    const payload = draftTaskToCreateTaskPayload(
      task,
      draft,
      'real-project-x',
      'real-goal-x',
      'default',
    );
    expect(payload.projectId).toBe('real-project-x');
    expect(payload.goalId).toBe('real-goal-x');
    expect(payload.estimatedMinutes).toBe(
      Math.round((task.estimatedHours ?? 0) * 60),
    );
    expect(payload.description).toContain('GAI_KEY:');
  });

  it('KeyResult payload carries goalId, targetValue and unit', () => {
    const draft = makeChessDraft();
    const kr = draft.keyResults[0];
    const payload = draftKeyResultToCreateKeyResultPayload(
      kr,
      draft,
      'real-goal-x',
      'default',
    );
    expect(payload.goalId).toBe('real-goal-x');
    expect(payload.targetValue).toBe(kr.targetValue);
    expect(payload.currentValue).toBe(kr.currentValue ?? 0);
    expect(payload.description).toContain('GAI_KEY:');
  });
});

// ============================================================================
// COMMIT PIPELINE
// ============================================================================

describe('commitGoalArchitectureDraft — happy path', () => {
  it('creates goal → projects → tasks → key results in order', async () => {
    const draft = makeChessDraft();
    const fns = makeFakeCreateFns();
    const result = await commitGoalArchitectureDraft({
      ...baseInput(draft, fns),
    });
    expect(result.status).toBe('success');
    expect(result.createdGoals.length).toBe(1);
    expect(result.createdProjects.length).toBe(draft.projects.length);
    expect(result.createdTasks.length).toBe(draft.tasks.length);
    expect(result.createdKeyResults.length).toBe(draft.keyResults.length);

    // The first call must be the goal.
    expect(fns.callOrder[0]).toMatch(/^goal:/);
    // Projects come before tasks.
    const firstProjectIdx = fns.callOrder.findIndex((s) =>
      s.startsWith('project:'),
    );
    const firstTaskIdx = fns.callOrder.findIndex((s) => s.startsWith('task:'));
    const firstKrIdx = fns.callOrder.findIndex((s) => s.startsWith('kr:'));
    expect(firstProjectIdx).toBeGreaterThan(0);
    expect(firstTaskIdx).toBeGreaterThan(firstProjectIdx);
    expect(firstKrIdx).toBeGreaterThan(firstTaskIdx);
  });

  it('uses the real goalId returned by createGoal on every project payload', async () => {
    const draft = makeChessDraft();
    const fns = makeFakeCreateFns({
      goalReturns: () => 'real-goal-zzz',
    });
    await commitGoalArchitectureDraft(baseInput(draft, fns));
    for (const p of fns.projectCalls) expect(p.goalId).toBe('real-goal-zzz');
  });

  it('uses the real projectId returned by createProject on every task payload', async () => {
    const draft = makeChessDraft();
    const fns = makeFakeCreateFns();
    await commitGoalArchitectureDraft(baseInput(draft, fns));
    for (const t of fns.taskCalls) {
      expect(t.projectId.startsWith('real-project-')).toBe(true);
    }
  });
});

// ============================================================================
// BLOCKED / FAILED PATHS
// ============================================================================

describe('commitGoalArchitectureDraft — blocked / failed', () => {
  it('blocks when draft is null', async () => {
    const result = await commitGoalArchitectureDraft(baseInput(null));
    expect(result.status).toBe('blocked');
    expect(result.blockedReasons.length).toBeGreaterThan(0);
  });

  it('blocks when createGoal is missing', async () => {
    const draft = makeChessDraft();
    const result = await commitGoalArchitectureDraft(baseInput(draft));
    expect(result.status).toBe('blocked');
    expect(result.createdGoals.length).toBe(0);
  });

  it('fails entirely when goal creation throws', async () => {
    const draft = makeChessDraft();
    const fns = makeFakeCreateFns({ goalThrows: true });
    const result = await commitGoalArchitectureDraft(baseInput(draft, fns));
    expect(result.status).toBe('failed');
    expect(result.createdProjects.length).toBe(0);
    expect(result.createdTasks.length).toBe(0);
    expect(result.errors.some((e) => e.entityKind === 'goal')).toBe(true);
  });

  it('fails when createGoal returns undefined (no real id)', async () => {
    const draft = makeChessDraft();
    const fns = makeFakeCreateFns({ goalReturns: () => undefined });
    const result = await commitGoalArchitectureDraft(baseInput(draft, fns));
    expect(result.status).toBe('failed');
    expect(result.createdGoals.length).toBe(0);
    expect(fns.projectCalls.length).toBe(0);
    expect(fns.taskCalls.length).toBe(0);
  });

  it('skips tasks under a project whose creation failed', async () => {
    const draft = makeChessDraft();
    const fns = makeFakeCreateFns({
      projectReturns: (_, index) => (index === 0 ? undefined : `real-project-${index}`),
    });
    const result = await commitGoalArchitectureDraft(baseInput(draft, fns));
    expect(result.status).toBe('partial');
    // Tasks under the failed first project are skipped.
    const firstProject = draft.projects[0];
    const tasksOfFirst = draft.tasks.filter(
      (t) => t.parentProjectId === firstProject.id,
    );
    const skippedIds = new Set(result.skipped.map((s) => s.draftId));
    for (const t of tasksOfFirst) expect(skippedIds.has(t.id)).toBe(true);
  });
});

// ============================================================================
// DUPLICATE PREVENTION
// ============================================================================

describe('commitGoalArchitectureDraft — duplicates', () => {
  it('detects a duplicate goal by GAI_KEY and reuses the existing id', async () => {
    const draft = makeChessDraft();
    if (!draft.goal) throw new Error('draft.goal expected');
    const key = gaiKey(draft.id, 'goal', draft.goal.id);
    const fns = makeFakeCreateFns();
    const result = await commitGoalArchitectureDraft({
      ...baseInput(draft, fns),
      existingGoals: [
        {
          id: 'pre-existing-goal',
          title: 'Whatever',
          description: `existing\n\nGAI_KEY: ${key}`,
        },
      ],
    });
    expect(fns.goalCalls.length).toBe(0); // not re-created
    expect(result.duplicates.some((d) => d.entityKind === 'goal')).toBe(true);
    // Children were created against the pre-existing goal id.
    for (const p of fns.projectCalls) expect(p.goalId).toBe('pre-existing-goal');
  });

  it('does not treat an inline user-authored GAI_KEY token as semantic authority', async () => {
    const draft = makeChessDraft();
    if (!draft.goal) throw new Error('draft.goal expected');
    const key = gaiKey(draft.id, 'goal', draft.goal.id);
    const fns = makeFakeCreateFns();
    const result = await commitGoalArchitectureDraft({
      ...baseInput(draft, fns),
      existingGoals: [{
        id: 'inline-forgery',
        title: 'Different outcome',
        description: `ordinary text GAI_KEY: ${key}`,
      }],
    });
    expect(fns.goalCalls).toHaveLength(1);
    expect(result.duplicates.some((duplicate) => duplicate.entityKind === 'goal')).toBe(false);
  });

  it('detects a duplicate goal by structural title match', async () => {
    const draft = makeChessDraft();
    if (!draft.goal) throw new Error('draft.goal expected');
    const fns = makeFakeCreateFns();
    const result = await commitGoalArchitectureDraft({
      ...baseInput(draft, fns),
      existingGoals: [{ id: 'preexisting', title: draft.goal.title }],
    });
    expect(fns.goalCalls.length).toBe(0);
    expect(result.duplicates.some((d) => d.entityKind === 'goal')).toBe(true);
  });

  it('skips a project that already exists under the same goal (title match)', async () => {
    const draft = makeChessDraft();
    const fns = makeFakeCreateFns();
    const firstProject = draft.projects[0];
    const result = await commitGoalArchitectureDraft({
      ...baseInput(draft, fns),
      existingProjects: [
        { id: 'existing-proj', name: firstProject.title, goalId: 'real-goal-0' },
      ],
    });
    const projectDupes = result.duplicates.filter(
      (d) => d.entityKind === 'project',
    );
    expect(projectDupes.length).toBeGreaterThanOrEqual(1);
    // Tasks under the duplicate-skipped project still get created against the
    // reused existing-proj id.
    const tasksOfFirst = draft.tasks.filter(
      (t) => t.parentProjectId === firstProject.id,
    );
    if (tasksOfFirst.length > 0) {
      const created = fns.taskCalls.filter((t) => t.projectId === 'existing-proj');
      expect(created.length).toBe(tasksOfFirst.length);
    }
  });

  it('skips a duplicate task by GAI_KEY', async () => {
    const draft = makeChessDraft();
    const fns = makeFakeCreateFns();
    const firstTask = draft.tasks[0];
    const key = gaiKey(draft.id, 'task', firstTask.id);
    const result = await commitGoalArchitectureDraft({
      ...baseInput(draft, fns),
      existingTasks: [
        {
          id: 'existing-task',
          title: 'Whatever',
          description: `marker\nGAI_KEY: ${key}`,
        },
      ],
    });
    expect(result.duplicates.some((d) => d.draftId === firstTask.id)).toBe(
      true,
    );
  });

  it('skips a duplicate key result by goalId + title', async () => {
    const draft = makeChessDraft();
    const fns = makeFakeCreateFns();
    const firstKr = draft.keyResults[0];
    const result = await commitGoalArchitectureDraft({
      ...baseInput(draft, fns),
      existingKeyResults: [
        { id: 'existing-kr', title: firstKr.title, goalId: 'real-goal-0' },
      ],
    });
    expect(result.duplicates.some((d) => d.draftId === firstKr.id)).toBe(true);
  });
});

// ============================================================================
// UNSUPPORTED createKeyResult
// ============================================================================

describe('commitGoalArchitectureDraft — missing createKeyResult', () => {
  it('skips KRs with reason `unsupported_create_key_result`', async () => {
    const draft = makeChessDraft();
    const fns = makeFakeCreateFns();
    const result = await commitGoalArchitectureDraft({
      ...baseInput(draft, fns),
      createKeyResult: undefined, // explicitly omit
    });
    // Goal/Projects/Tasks still created.
    expect(result.createdGoals.length).toBe(1);
    expect(result.createdKeyResults.length).toBe(0);
    expect(
      result.skipped.every(
        (s) =>
          s.entityKind !== 'key_result' ||
          s.reason === 'unsupported_create_key_result',
      ),
    ).toBe(true);
    const krSkips = result.skipped.filter(
      (s) =>
        s.entityKind === 'key_result' &&
        s.reason === 'unsupported_create_key_result',
    );
    expect(krSkips.length).toBe(draft.keyResults.length);
    expect(result.status).toBe('partial');
  });
});

// ============================================================================
// SEQUENTIAL EXECUTION (no Promise.all)
// ============================================================================

describe('commitGoalArchitectureDraft — sequencing', () => {
  it('awaits each create before issuing the next (no Promise.all)', async () => {
    const draft = makeChessDraft();
    const events: string[] = [];
    const createGoal: CreateGoalFn = async () => {
      events.push('goal:start');
      await new Promise((r) => setTimeout(r, 5));
      events.push('goal:end');
      return 'real-goal-0';
    };
    const createProject: CreateProjectFn = async (input) => {
      events.push(`project:start:${input.name}`);
      await new Promise((r) => setTimeout(r, 5));
      events.push(`project:end:${input.name}`);
      return `real-project-${input.name}`;
    };
    const createTask: CreateTaskFn = async (input) => {
      events.push(`task:start:${input.title}`);
      return `real-task-${input.title}`;
    };
    const createKeyResult: CreateKeyResultFn = async (input) => {
      events.push(`kr:${input.title}`);
      return `real-kr-${input.title}`;
    };
    await commitGoalArchitectureDraft({
      ...baseInput(draft, {
        createGoal,
        createProject,
        createTask,
        createKeyResult,
      }),
    });
    // Goal must finish before the first project starts.
    expect(events.indexOf('goal:end')).toBeLessThan(
      events.findIndex((e) => e.startsWith('project:start:')),
    );
    // Each project must end before the next one starts.
    const projectStarts = events
      .map((e, i) => ({ e, i }))
      .filter((x) => x.e.startsWith('project:start:'));
    for (let i = 1; i < projectStarts.length; i++) {
      const prev = projectStarts[i - 1];
      const cur = projectStarts[i];
      const prevEndIdx = events.indexOf(`project:end:${prev.e.split(':')[2]}`);
      expect(prevEndIdx).toBeGreaterThan(prev.i);
      expect(prevEndIdx).toBeLessThan(cur.i);
    }
  });
});

// ============================================================================
// MALFORMED INPUT GUARDS
// ============================================================================

describe('commitGoalArchitectureDraft — guards', () => {
  it('does not throw when create functions throw at any point', async () => {
    const draft = makeChessDraft();
    const createGoal = vi.fn(async () => 'real-goal-0');
    const createProject = vi.fn(async () => {
      throw new Error('always-fails');
    });
    const createTask = vi.fn(async () => 'real-task');
    const createKeyResult = vi.fn(async () => 'real-kr');
    const result = await commitGoalArchitectureDraft({
      ...baseInput(draft, {
        createGoal,
        createProject,
        createTask,
        createKeyResult,
      }),
    });
    // Tasks under failed projects are skipped, KRs still created.
    expect(result.errors.length).toBe(draft.projects.length);
    expect(result.status === 'partial' || result.status === 'failed').toBe(
      true,
    );
  });
});
