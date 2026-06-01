// src/lib/goalArchitect/validation.test.ts

import { describe, expect, it } from 'vitest';
import {
  isValidISODate,
  normalizePriority,
  validateGoalArchitectureDraft,
} from './validation';
import {
  GOAL_ARCHITECT_DRAFT_VERSION,
  type GoalArchitectIssue,
  type GoalArchitectureDraft,
  type GoalDraft,
} from './types';

const ISO = '2026-01-01T00:00:00.000Z';
const GOAL_ID = 'goal-x';
const PROJECT_A_ID = 'proj-a';

function baseGoal(over: Partial<GoalDraft> = {}): GoalDraft {
  return {
    id: GOAL_ID,
    title: 'Test Goal',
    targetHours: 100,
    dueDateISO: '2026-12-31',
    priority: 'critical',
    projectIds: [PROJECT_A_ID],
    directTaskIds: [],
    keyResultIds: ['kr-1', 'kr-2'],
    ...over,
  };
}

function baseDraft(over: Partial<GoalArchitectureDraft> = {}): GoalArchitectureDraft {
  return {
    id: 'arch-1',
    version: GOAL_ARCHITECT_DRAFT_VERSION,
    status: 'draft',
    createdAtISO: ISO,
    updatedAtISO: ISO,
    goal: baseGoal(),
    projects: [
      {
        id: PROJECT_A_ID,
        title: 'Project A',
        targetHours: 100,
        parentGoalId: GOAL_ID,
        taskIds: ['t-1'],
      },
    ],
    tasks: [
      {
        id: 't-1',
        title: 'Task 1',
        estimatedHours: 100,
        parentGoalId: GOAL_ID,
        parentProjectId: PROJECT_A_ID,
      },
    ],
    keyResults: [
      {
        id: 'kr-1',
        title: 'KR 1',
        targetValue: 50,
        unit: 'percent',
        parentGoalId: GOAL_ID,
      },
      {
        id: 'kr-2',
        title: 'KR 2',
        targetValue: 100,
        unit: 'sessions',
        parentGoalId: GOAL_ID,
      },
    ],
    issues: [],
    summary: {
      goalCount: 0,
      projectCount: 0,
      taskCount: 0,
      keyResultCount: 0,
      totalProjectTargetHours: 0,
      totalTaskEstimatedHours: 0,
      orphanTaskCount: 0,
      orphanKeyResultCount: 0,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      isStructurallyValid: false,
      canCommit: false,
    },
    confidence: { overall: 0.9 },
    ...over,
  };
}

function codes(issues: ReadonlyArray<GoalArchitectIssue>): string[] {
  return issues.map((i) => i.code);
}

describe('isValidISODate', () => {
  it('accepts plain date and full datetime', () => {
    expect(isValidISODate('2026-12-31')).toBe(true);
    expect(isValidISODate('2026-12-31T10:00:00Z')).toBe(true);
    expect(isValidISODate('2026-12-31T10:00:00.123+02:00')).toBe(true);
  });

  it('rejects invalid input', () => {
    expect(isValidISODate('2026/12/31')).toBe(false);
    expect(isValidISODate('31-12-2026')).toBe(false);
    expect(isValidISODate('not-a-date')).toBe(false);
    expect(isValidISODate(undefined)).toBe(false);
    expect(isValidISODate('')).toBe(false);
  });
});

describe('normalizePriority', () => {
  it('canonicalizes aliases', () => {
    expect(normalizePriority('Urgente')).toBe('critical');
    expect(normalizePriority('alta')).toBe('high');
    expect(normalizePriority('media')).toBe('medium');
    expect(normalizePriority('bassa')).toBe('low');
    expect(normalizePriority('HIGH')).toBe('high');
  });

  it('returns undefined for unknown / empty', () => {
    expect(normalizePriority(undefined)).toBeUndefined();
    expect(normalizePriority('')).toBeUndefined();
    expect(normalizePriority('extremely-high')).toBeUndefined();
  });
});

describe('validateGoalArchitectureDraft', () => {
  it('returns valid status with canCommit=true for a clean draft', () => {
    const result = validateGoalArchitectureDraft(baseDraft());
    expect(result.status).toBe('valid');
    expect(result.canCommit).toBe(true);
    expect(result.summary.errorCount).toBe(0);
  });

  it('emits missing_goal error when goal is null', () => {
    const result = validateGoalArchitectureDraft(baseDraft({ goal: null }));
    expect(codes(result.issues)).toContain('missing_goal');
    expect(result.canCommit).toBe(false);
    expect(result.status).toBe('invalid');
  });

  it('emits missing_title error for empty goal title', () => {
    const draft = baseDraft({ goal: baseGoal({ title: '   ' }) });
    const result = validateGoalArchitectureDraft(draft);
    expect(codes(result.issues)).toContain('missing_title');
    expect(result.canCommit).toBe(false);
  });

  it('emits invalid_hours error for negative goal targetHours', () => {
    const draft = baseDraft({ goal: baseGoal({ targetHours: -5 }) });
    const result = validateGoalArchitectureDraft(draft);
    expect(codes(result.issues)).toContain('invalid_hours');
    expect(result.canCommit).toBe(false);
  });

  it('emits invalid_due_date error for malformed dueDateISO', () => {
    const draft = baseDraft({ goal: baseGoal({ dueDateISO: '31/12/2026' }) });
    const result = validateGoalArchitectureDraft(draft);
    const dueDateErrors = result.issues.filter(
      (i) => i.code === 'invalid_due_date' && i.severity === 'error',
    );
    expect(dueDateErrors.length).toBeGreaterThan(0);
    expect(result.canCommit).toBe(false);
  });

  it('flags a project whose parent goal does not match', () => {
    const draft = baseDraft();
    draft.projects[0].parentGoalId = 'unknown-goal';
    const result = validateGoalArchitectureDraft(draft);
    expect(codes(result.issues)).toContain('missing_parent');
    expect(result.canCommit).toBe(false);
  });

  it('flags a task whose parent project does not exist', () => {
    const draft = baseDraft();
    draft.tasks[0].parentProjectId = 'project-ghost';
    const result = validateGoalArchitectureDraft(draft);
    expect(codes(result.issues)).toContain('orphan_task');
    expect(result.canCommit).toBe(false);
  });

  it('warns when a task is linked directly to the goal', () => {
    const draft = baseDraft();
    draft.tasks[0].parentProjectId = undefined;
    const result = validateGoalArchitectureDraft(draft);
    const warnings = result.issues.filter(
      (i) => i.code === 'orphan_task' && i.severity === 'warning',
    );
    expect(warnings.length).toBe(1);
    // Warnings must NOT block commit.
    expect(result.canCommit).toBe(true);
  });

  it('warns on duplicate project titles', () => {
    const draft = baseDraft();
    draft.projects.push({
      id: 'proj-b',
      title: 'Project A',
      targetHours: 0,
      parentGoalId: GOAL_ID,
      taskIds: [],
    });
    const result = validateGoalArchitectureDraft(draft);
    const duplicates = result.issues.filter((i) => i.code === 'duplicate_title');
    expect(duplicates.length).toBeGreaterThanOrEqual(2);
  });

  it('warns on duplicate task titles within the same project', () => {
    const draft = baseDraft();
    draft.tasks.push({
      id: 't-2',
      title: 'Task 1',
      estimatedHours: 0,
      parentGoalId: GOAL_ID,
      parentProjectId: PROJECT_A_ID,
    });
    const result = validateGoalArchitectureDraft(draft);
    expect(codes(result.issues)).toContain('duplicate_title');
  });

  it('warns on duplicate key result titles', () => {
    const draft = baseDraft();
    draft.keyResults.push({
      id: 'kr-3',
      title: 'KR 1',
      targetValue: 1,
      unit: 'sessions',
      parentGoalId: GOAL_ID,
    });
    const result = validateGoalArchitectureDraft(draft);
    expect(codes(result.issues)).toContain('duplicate_title');
  });

  it('warns when there are fewer than the recommended key results', () => {
    const draft = baseDraft();
    draft.keyResults = [draft.keyResults[0]];
    if (draft.goal) draft.goal.keyResultIds = ['kr-1'];
    const result = validateGoalArchitectureDraft(draft);
    expect(codes(result.issues)).toContain('too_few_key_results');
    expect(result.canCommit).toBe(true);
  });

  it('warns when there are too many key results', () => {
    const draft = baseDraft();
    if (!draft.goal) throw new Error('goal expected');
    draft.goal.keyResultIds = ['1', '2', '3', '4', '5', '6'];
    const result = validateGoalArchitectureDraft(draft);
    expect(codes(result.issues)).toContain('too_many_key_results');
  });

  it('warns on goal vs project hours mismatch', () => {
    const draft = baseDraft();
    if (draft.goal) draft.goal.targetHours = 500;
    const result = validateGoalArchitectureDraft(draft);
    expect(codes(result.issues)).toContain('hours_mismatch');
    // Mismatch is a warning, not a blocker.
    expect(result.canCommit).toBe(true);
  });

  it('warns on project vs task hours mismatch', () => {
    const draft = baseDraft();
    draft.projects[0].targetHours = 10;
    draft.tasks[0].estimatedHours = 100;
    const result = validateGoalArchitectureDraft(draft);
    const mismatches = result.issues.filter((i) => i.code === 'hours_mismatch');
    expect(mismatches.length).toBeGreaterThan(0);
  });

  it('does not block commit on warnings alone', () => {
    const draft = baseDraft();
    if (draft.goal) draft.goal.targetHours = undefined;
    const result = validateGoalArchitectureDraft(draft);
    expect(result.summary.warningCount).toBeGreaterThan(0);
    expect(result.canCommit).toBe(true);
  });

  it('blocks commit on a single error', () => {
    const draft = baseDraft();
    draft.tasks[0].title = '';
    const result = validateGoalArchitectureDraft(draft);
    expect(result.canCommit).toBe(false);
    expect(result.summary.errorCount).toBeGreaterThan(0);
  });

  it('flags invalid_priority when an unknown priority sneaks in', () => {
    const draft = baseDraft();
    // Cast through unknown to bypass the union without using `any`.
    const goal = draft.goal as unknown as { priority: string } | null;
    if (goal) goal.priority = 'extremely-high';
    const result = validateGoalArchitectureDraft(draft);
    expect(codes(result.issues)).toContain('invalid_priority');
    expect(result.canCommit).toBe(false);
  });
});
