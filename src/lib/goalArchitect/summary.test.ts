// src/lib/goalArchitect/summary.test.ts

import { describe, expect, it } from 'vitest';
import {
  calculateGoalArchitectureSummary,
  calculateTotalProjectTargetHours,
  calculateTotalTaskEstimatedHours,
  countIssuesBySeverity,
  findOrphanKeyResults,
  findOrphanTasks,
} from './summary';
import {
  GOAL_ARCHITECT_DRAFT_VERSION,
  type GoalArchitectIssue,
  type GoalArchitectureDraft,
} from './types';

const ISO = '2026-01-01T00:00:00.000Z';

function emptyDraft(): GoalArchitectureDraft {
  return {
    id: 'arch-1',
    version: GOAL_ARCHITECT_DRAFT_VERSION,
    status: 'draft',
    createdAtISO: ISO,
    updatedAtISO: ISO,
    goal: null,
    projects: [],
    tasks: [],
    keyResults: [],
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
    confidence: { overall: 0 },
  };
}

function sampleDraft(): GoalArchitectureDraft {
  const goalId = 'goal-x';
  const projectAId = 'proj-a';
  const projectBId = 'proj-b';
  return {
    ...emptyDraft(),
    goal: {
      id: goalId,
      title: 'X',
      targetHours: 100,
      projectIds: [projectAId, projectBId],
      directTaskIds: [],
      keyResultIds: ['kr-1'],
    },
    projects: [
      {
        id: projectAId,
        title: 'A',
        targetHours: 40,
        parentGoalId: goalId,
        taskIds: ['t-1', 't-2'],
      },
      {
        id: projectBId,
        title: 'B',
        targetHours: 60,
        parentGoalId: goalId,
        taskIds: ['t-3'],
      },
    ],
    tasks: [
      {
        id: 't-1',
        title: 'T1',
        estimatedHours: 20,
        parentGoalId: goalId,
        parentProjectId: projectAId,
      },
      {
        id: 't-2',
        title: 'T2',
        estimatedHours: 20,
        parentGoalId: goalId,
        parentProjectId: projectAId,
      },
      {
        id: 't-3',
        title: 'T3',
        estimatedHours: 60,
        parentGoalId: goalId,
        parentProjectId: projectBId,
      },
    ],
    keyResults: [
      {
        id: 'kr-1',
        title: 'KR1',
        targetValue: 100,
        unit: 'percent',
        parentGoalId: goalId,
      },
    ],
  };
}

describe('countIssuesBySeverity', () => {
  it('groups by severity', () => {
    const issues: GoalArchitectIssue[] = [
      { id: '1', code: 'missing_title', severity: 'error', message: 'm' },
      { id: '2', code: 'missing_hours', severity: 'warning', message: 'm' },
      { id: '3', code: 'invalid_priority', severity: 'warning', message: 'm' },
      { id: '4', code: 'similar_title', severity: 'info', message: 'm' },
    ];
    expect(countIssuesBySeverity(issues)).toEqual({ info: 1, warning: 2, error: 1 });
  });

  it('returns zeros for empty input', () => {
    expect(countIssuesBySeverity([])).toEqual({ info: 0, warning: 0, error: 0 });
  });
});

describe('hours helpers', () => {
  it('sums project target hours and ignores missing/invalid', () => {
    const draft = sampleDraft();
    expect(calculateTotalProjectTargetHours(draft.projects)).toBe(100);

    draft.projects[0].targetHours = undefined;
    expect(calculateTotalProjectTargetHours(draft.projects)).toBe(60);

    draft.projects[1].targetHours = -10;
    expect(calculateTotalProjectTargetHours(draft.projects)).toBe(0);
  });

  it('sums task estimated hours', () => {
    const draft = sampleDraft();
    expect(calculateTotalTaskEstimatedHours(draft.tasks)).toBe(100);
  });
});

describe('orphan detection', () => {
  it('flags tasks whose parent project is missing', () => {
    const draft = sampleDraft();
    draft.tasks.push({
      id: 't-ghost',
      title: 'Ghost',
      parentGoalId: 'goal-x',
      parentProjectId: 'project-missing',
    });
    const orphans = findOrphanTasks(draft);
    expect(orphans.map((t) => t.id)).toEqual(['t-ghost']);
  });

  it('does NOT flag tasks intentionally directly under the goal', () => {
    const draft = sampleDraft();
    draft.tasks.push({
      id: 't-direct',
      title: 'Direct',
      parentGoalId: 'goal-x',
    });
    expect(findOrphanTasks(draft).map((t) => t.id)).toEqual([]);
  });

  it('flags key results whose parent goal differs', () => {
    const draft = sampleDraft();
    draft.keyResults.push({
      id: 'kr-2',
      title: 'KR2',
      parentGoalId: 'other-goal',
    });
    const orphans = findOrphanKeyResults(draft);
    expect(orphans.map((k) => k.id)).toEqual(['kr-2']);
  });

  it('treats all key results as orphans when no goal exists', () => {
    const draft = emptyDraft();
    draft.keyResults.push({
      id: 'kr-1',
      title: 'KR1',
      parentGoalId: 'no-goal',
    });
    expect(findOrphanKeyResults(draft).map((k) => k.id)).toEqual(['kr-1']);
  });
});

describe('calculateGoalArchitectureSummary', () => {
  it('counts entities, hours, and severities', () => {
    const draft = sampleDraft();
    const issues: GoalArchitectIssue[] = [
      { id: '1', code: 'missing_hours', severity: 'warning', message: 'm' },
    ];
    const summary = calculateGoalArchitectureSummary(draft, { issues });
    expect(summary.goalCount).toBe(1);
    expect(summary.projectCount).toBe(2);
    expect(summary.taskCount).toBe(3);
    expect(summary.keyResultCount).toBe(1);
    expect(summary.totalGoalTargetHours).toBe(100);
    expect(summary.totalProjectTargetHours).toBe(100);
    expect(summary.totalTaskEstimatedHours).toBe(100);
    expect(summary.errorCount).toBe(0);
    expect(summary.warningCount).toBe(1);
    expect(summary.canCommit).toBe(true);
    expect(summary.isStructurallyValid).toBe(true);
  });

  it('blocks commit on errors', () => {
    const draft = sampleDraft();
    const issues: GoalArchitectIssue[] = [
      { id: 'e1', code: 'missing_title', severity: 'error', message: 'm' },
    ];
    const summary = calculateGoalArchitectureSummary(draft, { issues });
    expect(summary.canCommit).toBe(false);
    expect(summary.isStructurallyValid).toBe(false);
  });

  it('blocks commit when goal is missing', () => {
    const draft = emptyDraft();
    const summary = calculateGoalArchitectureSummary(draft, { issues: [] });
    expect(summary.canCommit).toBe(false);
    expect(summary.goalCount).toBe(0);
  });

  it('omits totalGoalTargetHours when goal has no target', () => {
    const draft = sampleDraft();
    if (draft.goal) draft.goal.targetHours = undefined;
    const summary = calculateGoalArchitectureSummary(draft, { issues: [] });
    expect(summary.totalGoalTargetHours).toBeUndefined();
  });
});
