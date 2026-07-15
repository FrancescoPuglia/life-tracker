import { describe, it, expect } from 'vitest';
import type { Goal, Project, Session, Task, TimeBlock } from '@/types';
import { resolvePeriod } from './period';
import {
  computePerformanceOverview,
  isExecutedStatus,
  UNASSIGNED_ID,
  UNASSIGNED_LABEL,
  type PerformanceInput,
} from './metrics';
import { EMPTY_FILTERS, type PerformanceFilters } from './types';
import { MAX_INSIGHTS } from './insights';

// ============================================================================
// FIXTURES — Wed 2025-10-15 12:00 local; current week = Mon 13 → Mon 20 Oct.
// ============================================================================

const NOW = new Date(2025, 9, 15, 12, 0);
const WEEK = resolvePeriod(NOW, 'week', NOW);

const at = (day: number, hour: number, minute = 0) => new Date(2025, 9, day, hour, minute);

let seq = 0;
const uid = (prefix: string) => `${prefix}-${++seq}`;

function makeGoal(over: Partial<Goal> = {}): Goal {
  return {
    id: uid('goal'),
    userId: 'u1',
    domainId: 'd1',
    title: 'Goal',
    status: 'active',
    priority: 'medium',
    targetDate: at(30, 0),
    timeAllocationTarget: 0,
    keyResults: [],
    category: 'important_not_urgent',
    complexity: 'moderate',
    createdAt: at(1, 0),
    updatedAt: at(1, 0),
    ...over,
  } as Goal;
}

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: uid('project'),
    userId: 'u1',
    domainId: 'd1',
    name: 'Project',
    goalId: '',
    status: 'active',
    priority: 'medium',
    createdAt: at(1, 0),
    updatedAt: at(1, 0),
    ...over,
  } as Project;
}

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: uid('task'),
    userId: 'u1',
    domainId: 'd1',
    title: 'Task',
    projectId: '',
    status: 'pending',
    priority: 'medium',
    estimatedMinutes: 60,
    createdAt: at(1, 0),
    updatedAt: at(1, 0),
    ...over,
  } as Task;
}

function makeBlock(over: Partial<TimeBlock> = {}): TimeBlock {
  const startTime = over.startTime ?? at(13, 10);
  const endTime = over.endTime ?? at(13, 12);
  return {
    id: uid('block'),
    userId: 'u1',
    domainId: 'd1',
    title: 'Block',
    type: 'work',
    status: 'planned',
    startTime,
    endTime,
    // Scheduled in advance by default (createdAt before startTime).
    createdAt: over.createdAt ?? new Date(startTime.getTime() - 24 * 3600 * 1000),
    updatedAt: startTime,
    ...over,
  } as TimeBlock;
}

function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: uid('session'),
    userId: 'u1',
    domainId: 'd1',
    startTime: at(14, 9),
    status: 'completed',
    tags: [],
    createdAt: at(14, 9),
    updatedAt: at(14, 9),
    ...over,
  } as Session;
}

function input(partial: Partial<PerformanceInput> = {}): PerformanceInput {
  return {
    timeBlocks: [],
    sessions: [],
    tasks: [],
    projects: [],
    goals: [],
    ...partial,
  };
}

function compute(
  partial: Partial<PerformanceInput>,
  filters: PerformanceFilters = EMPTY_FILTERS,
  period = WEEK,
  now = NOW
) {
  return computePerformanceOverview(input(partial), period, filters, now);
}

/** Recursively assert no NaN / Infinity anywhere in the DTO. */
function assertFiniteDeep(value: unknown, path = 'root'): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `${path} must be finite, got ${value}`).toBe(true);
    return;
  }
  if (value instanceof Date) {
    expect(Number.isNaN(value.getTime()), `${path} must be a valid Date`).toBe(false);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertFiniteDeep(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertFiniteDeep(v, `${path}.${k}`);
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('empty and degenerate inputs', () => {
  it('returns a fully-zero, finite overview for an empty dataset', () => {
    const overview = compute({});
    expect(overview.summary.plannedMinutes).toBe(0);
    expect(overview.summary.actualMinutes).toBe(0);
    expect(overview.summary.executionRatio).toBeNull();
    expect(overview.summary.planFulfillmentRate).toBeNull();
    expect(overview.summary.onTimeRate).toBeNull();
    expect(overview.dataQuality.coverageRate).toBeNull();
    expect(overview.goals).toHaveLength(0);
    expect(overview.projects).toHaveLength(0);
    expect(overview.timeSeries).toHaveLength(7);
    expect(overview.heatmap).toHaveLength(7);
    assertFiniteDeep(overview);
  });

  it('never emits NaN/Infinity even with actual > 0 and planned = 0', () => {
    const overview = compute({
      timeBlocks: [
        makeBlock({
          status: 'completed',
          startTime: at(13, 10),
          endTime: at(13, 12),
          createdAt: at(13, 12), // retro-logged
          goalId: undefined,
        }),
      ],
    });
    expect(overview.summary.plannedMinutes).toBe(0);
    expect(overview.summary.actualMinutes).toBe(120);
    expect(overview.summary.executionRatio).toBeNull();
    assertFiniteDeep(overview);
  });
});

describe('planned time', () => {
  it('counts advance-scheduled blocks, all statuses except cancelled', () => {
    const goal = makeGoal();
    const overview = compute({
      goals: [goal],
      timeBlocks: [
        makeBlock({ goalId: goal.id, startTime: at(13, 9), endTime: at(13, 11) }), // planned
        makeBlock({
          goalId: goal.id,
          startTime: at(14, 9),
          endTime: at(14, 10),
          status: 'in_progress',
        }),
        makeBlock({
          goalId: goal.id,
          startTime: at(15, 9),
          endTime: at(15, 10),
          status: 'cancelled',
        }),
      ],
    });
    expect(overview.summary.plannedMinutes).toBe(180); // 120 + 60, cancelled excluded
    expect(overview.dataQuality.cancelledPlannedMinutes).toBe(60);
  });

  it('excludes break/buffer blocks from planned time but reports them', () => {
    const overview = compute({
      timeBlocks: [
        makeBlock({ type: 'break', startTime: at(13, 12), endTime: at(13, 13), goalId: 'x' }),
        makeBlock({ type: 'buffer', startTime: at(13, 13), endTime: at(13, 14), goalId: 'x' }),
      ],
    });
    expect(overview.summary.plannedMinutes).toBe(0);
    expect(overview.dataQuality.excludedBreakMinutes).toBe(120);
  });

  it('does NOT count retro-logged blocks as plan', () => {
    const overview = compute({
      timeBlocks: [
        makeBlock({
          status: 'completed',
          startTime: at(13, 10),
          endTime: at(13, 11),
          createdAt: at(13, 11, 30), // created after the block ran
          goalId: 'g-any',
        }),
      ],
    });
    expect(overview.summary.plannedMinutes).toBe(0);
    expect(overview.summary.actualMinutes).toBe(60);
    expect(overview.summary.unplannedMinutes).toBe(60);
  });
});

describe('actual time and data coverage', () => {
  it('uses measured actual timestamps when available', () => {
    const overview = compute({
      timeBlocks: [
        makeBlock({
          status: 'completed',
          startTime: at(13, 10),
          endTime: at(13, 12),
          actualStartTime: at(13, 10),
          actualEndTime: at(13, 13), // ran 3h instead of 2h
        }),
      ],
    });
    expect(overview.summary.plannedMinutes).toBe(120);
    expect(overview.summary.actualMinutes).toBe(180);
    expect(overview.summary.varianceMinutes).toBe(60);
    expect(overview.dataQuality.measuredMinutes).toBe(180);
    expect(overview.dataQuality.coverageRate).toBe(1);
  });

  it('falls back to the planned window for completed blocks without actuals', () => {
    const overview = compute({
      timeBlocks: [
        makeBlock({ status: 'completed', startTime: at(13, 10), endTime: at(13, 12) }),
      ],
    });
    expect(overview.summary.actualMinutes).toBe(120);
    expect(overview.dataQuality.assumedMinutes).toBe(120);
    expect(overview.dataQuality.coverageRate).toBe(0);
  });

  it("counts 'overrun' blocks as executed and reports them", () => {
    expect(isExecutedStatus('overrun')).toBe(true);
    const overview = compute({
      timeBlocks: [
        makeBlock({
          status: 'overrun',
          startTime: at(13, 10),
          endTime: at(13, 12),
          actualStartTime: at(13, 10),
          actualEndTime: at(13, 11),
        }),
      ],
    });
    expect(overview.summary.actualMinutes).toBe(60);
    expect(overview.dataQuality.overrunBlockCount).toBe(1);
  });

  it('does not double count a session linked to its completed block', () => {
    const block = makeBlock({
      status: 'completed',
      startTime: at(13, 10),
      endTime: at(13, 12),
      actualStartTime: at(13, 10),
      actualEndTime: at(13, 12),
    });
    const overview = compute({
      timeBlocks: [block],
      sessions: [
        makeSession({
          timeBlockId: block.id,
          startTime: at(13, 10),
          endTime: at(13, 12),
          duration: 7200,
        }),
      ],
    });
    expect(overview.summary.actualMinutes).toBe(120); // not 240
  });

  it('counts orphan completed sessions as unplanned measured actual', () => {
    const overview = compute({
      sessions: [makeSession({ startTime: at(14, 9), duration: 3600 })], // no endTime → duration
    });
    expect(overview.summary.actualMinutes).toBe(60);
    expect(overview.summary.unplannedMinutes).toBe(60);
    expect(overview.dataQuality.orphanSessionCount).toBe(1);
    expect(overview.dataQuality.orphanSessionMinutes).toBe(60);
    expect(overview.dataQuality.measuredMinutes).toBe(60);
    expect(overview.dataQuality.unclassifiedMinutes).toBe(60); // no goal chain
    const unassigned = overview.goals.find((g) => g.goalId === null);
    expect(unassigned?.goalName).toBe(UNASSIGNED_LABEL);
    expect(unassigned?.actualMinutes).toBe(60);
  });

  it('excludes open sessions and counts them in quality', () => {
    const overview = compute({
      sessions: [makeSession({ status: 'active', startTime: at(15, 9) })],
    });
    expect(overview.summary.actualMinutes).toBe(0);
    expect(overview.dataQuality.openSessionCount).toBe(1);
  });

  it('keeps overlapping blocks as distinct records (documented: no dedup)', () => {
    const overview = compute({
      timeBlocks: [
        makeBlock({ status: 'completed', startTime: at(13, 10), endTime: at(13, 12) }),
        makeBlock({ status: 'completed', startTime: at(13, 11), endTime: at(13, 13) }),
      ],
    });
    expect(overview.summary.actualMinutes).toBe(240);
  });
});

describe('clipping across midnight and period borders', () => {
  it('splits a cross-midnight block between the two days', () => {
    const overview = compute({
      timeBlocks: [
        makeBlock({
          status: 'completed',
          startTime: at(13, 23),
          endTime: at(14, 1),
          actualStartTime: at(13, 23),
          actualEndTime: at(14, 1),
        }),
      ],
    });
    const mon = overview.timeSeries.find((p) => p.key === '2025-10-13');
    const tue = overview.timeSeries.find((p) => p.key === '2025-10-14');
    expect(mon?.actualMinutes).toBe(60);
    expect(tue?.actualMinutes).toBe(60);
    expect(overview.summary.actualMinutes).toBe(120);
  });

  it('attributes only the in-period part of a block crossing the period start', () => {
    // Sun Oct 12 23:00 → Mon Oct 13 01:00; week starts Mon 13.
    const overview = compute({
      timeBlocks: [
        makeBlock({
          status: 'completed',
          startTime: new Date(2025, 9, 12, 23),
          endTime: at(13, 1),
          actualStartTime: new Date(2025, 9, 12, 23),
          actualEndTime: at(13, 1),
        }),
      ],
    });
    expect(overview.summary.plannedMinutes).toBe(60);
    expect(overview.summary.actualMinutes).toBe(60);
  });

  it('caps corrupt durations at 24h and flags them', () => {
    const overview = compute({
      timeBlocks: [
        makeBlock({
          status: 'completed',
          startTime: at(13, 0),
          endTime: new Date(2025, 9, 16, 0), // 3 days long
        }),
      ],
    });
    expect(overview.summary.actualMinutes).toBe(24 * 60);
    expect(overview.dataQuality.anomalousDurationCount).toBeGreaterThan(0);
  });
});

describe('attribution chain (task → project → goal)', () => {
  it('rolls a task-linked block up to its project and goal', () => {
    const goal = makeGoal({ title: 'LAVORO' });
    const project = makeProject({ goalId: goal.id, name: 'Client X' });
    const task = makeTask({ projectId: project.id, title: 'Ship feature' });
    const overview = compute({
      goals: [goal],
      projects: [project],
      tasks: [task],
      timeBlocks: [
        makeBlock({
          taskId: task.id,
          status: 'completed',
          startTime: at(13, 9),
          endTime: at(13, 11),
        }),
      ],
    });
    const goalRow = overview.goals.find((g) => g.goalId === goal.id);
    const projectRow = overview.projects.find((p) => p.projectId === project.id);
    expect(goalRow?.actualMinutes).toBe(120);
    expect(goalRow?.activeProjects).toBe(1);
    expect(projectRow?.actualMinutes).toBe(120);
    expect(projectRow?.goalName).toBe('LAVORO');
    expect(overview.dataQuality.unclassifiedMinutes).toBe(0);
  });

  it('falls back to block links when the referenced task is missing', () => {
    const goal = makeGoal();
    const overview = compute({
      goals: [goal],
      timeBlocks: [
        makeBlock({
          taskId: 'task-that-was-hard-deleted',
          goalId: goal.id,
          status: 'completed',
          startTime: at(13, 9),
          endTime: at(13, 10),
        }),
      ],
    });
    expect(overview.dataQuality.blocksWithMissingParents).toBe(1);
    expect(overview.goals.find((g) => g.goalId === goal.id)?.actualMinutes).toBe(60);
  });

  it('shows archived goals with historical activity', () => {
    const goal = makeGoal({ title: 'Old goal', status: 'archived' });
    const overview = compute({
      goals: [goal],
      timeBlocks: [
        makeBlock({ goalId: goal.id, status: 'completed', startTime: at(13, 9), endTime: at(13, 10) }),
      ],
    });
    const row = overview.goals.find((g) => g.goalId === goal.id);
    expect(row?.actualMinutes).toBe(60);
    expect(row?.goalStatus).toBe('archived');
  });
});

describe('task metrics', () => {
  it('separates completed-in-period from plan fulfillment and on-time rate', () => {
    const project = makeProject();
    const onTime = makeTask({
      projectId: project.id,
      dueDate: at(15, 0),
      completedAt: at(14, 18),
      status: 'completed',
    });
    const late = makeTask({
      projectId: project.id,
      dueDate: at(13, 0),
      completedAt: at(16, 10), // completed in period but after due day
      status: 'completed',
    });
    // Due yesterday and still open → already slipped even mid-period.
    const open = makeTask({ projectId: project.id, dueDate: at(14, 0) });
    const overview = compute({ projects: [project], tasks: [onTime, late, open] });

    expect(overview.summary.plannedTasks).toBe(3);
    expect(overview.summary.completedPlannedTasks).toBe(1); // only the on-time one
    expect(overview.summary.completedTasksInPeriod).toBe(2);
    expect(overview.summary.onTimeRate).toBe(0.5);
    expect(overview.summary.planFulfillmentRate).toBeCloseTo(1 / 3);

    const outcomes = overview.carryOver.map((c) => c.outcome).sort();
    expect(outcomes).toEqual(['completed-late', 'open']);
  });

  it('treats tasks scheduled by advance blocks as planned tasks', () => {
    const task = makeTask({ status: 'completed', completedAt: at(14, 20) });
    const overview = compute({
      tasks: [task],
      timeBlocks: [
        makeBlock({ taskId: task.id, startTime: at(14, 9), endTime: at(14, 10), status: 'completed' }),
      ],
    });
    expect(overview.summary.plannedTasks).toBe(1);
    expect(overview.summary.completedPlannedTasks).toBe(1);
    expect(overview.summary.onTimeRate).toBeNull(); // no due date → excluded
  });

  it('flags tasks completed without tracked time and estimated-unscheduled work', () => {
    const done = makeTask({ dueDate: at(14, 0), completedAt: at(14, 12), status: 'completed' });
    const unscheduled = makeTask({ dueDate: at(17, 0), estimatedMinutes: 90 });
    const overview = compute({ tasks: [done, unscheduled] });
    expect(overview.dataQuality.completedTasksWithoutTime).toBe(1);
    expect(overview.dataQuality.estimatedUnscheduledMinutes).toBe(90);
  });

  // Regression (2026-07 "0/19 planned tasks done"): older UI paths set
  // status 'completed' without ever writing completedAt, so every completion
  // was invisible to the dashboard. Legacy rows must fall back to updatedAt.
  it('counts legacy tasks completed without completedAt via the updatedAt fallback', () => {
    const legacyDone = makeTask({
      dueDate: at(15, 0),
      status: 'completed',
      completedAt: undefined,
      updatedAt: at(14, 18), // completed (= last touched) inside the period
    });
    const overview = compute({ tasks: [legacyDone] });
    expect(overview.summary.plannedTasks).toBe(1);
    expect(overview.summary.completedPlannedTasks).toBe(1);
    expect(overview.summary.completedTasksInPeriod).toBe(1);
    expect(overview.summary.onTimeRate).toBe(1);
  });

  it('does not count open tasks without completedAt as completed', () => {
    const open = makeTask({
      dueDate: at(15, 0),
      status: 'in_progress',
      completedAt: undefined,
      updatedAt: at(14, 18),
    });
    const overview = compute({ tasks: [open] });
    expect(overview.summary.completedPlannedTasks).toBe(0);
    expect(overview.summary.completedTasksInPeriod).toBe(0);
  });

  it('keeps legacy completions out of foreign periods (updatedAt outside window)', () => {
    const doneLongAgo = makeTask({
      dueDate: at(15, 0),
      status: 'completed',
      completedAt: undefined,
      updatedAt: new Date(2025, 8, 1, 10, 0), // September — before this week
    });
    const overview = compute({ tasks: [doneLongAgo] });
    // Fulfilled (completed before period end) but not "completed in period".
    expect(overview.summary.completedPlannedTasks).toBe(1);
    expect(overview.summary.completedTasksInPeriod).toBe(0);
  });

  it('ignores cancelled and soft-deleted tasks', () => {
    const overview = compute({
      tasks: [
        makeTask({ dueDate: at(14, 0), status: 'cancelled' }),
        makeTask({ dueDate: at(14, 0), deleted: true }),
      ],
    });
    // Cancelled tasks stay in plannedTasks (they were planned) but deleted don't.
    expect(overview.summary.plannedTasks).toBe(1);
    expect(overview.carryOver[0]?.outcome).toBe('cancelled');
    expect(overview.dataQuality.estimatedUnscheduledMinutes).toBe(0); // cancelled excluded
  });
});

describe('filters', () => {
  const goalA = makeGoal({ title: 'A' });
  const goalB = makeGoal({ title: 'B' });
  const projectA = makeProject({ goalId: goalA.id, name: 'PA' });
  const projectB = makeProject({ goalId: goalB.id, name: 'PB' });
  const blocks = [
    makeBlock({ projectId: projectA.id, status: 'completed', startTime: at(13, 9), endTime: at(13, 11) }),
    makeBlock({ projectId: projectB.id, status: 'completed', startTime: at(13, 11), endTime: at(13, 12) }),
  ];
  const data = { goals: [goalA, goalB], projects: [projectA, projectB], timeBlocks: blocks };

  it('narrows every aggregate to the selected goal', () => {
    const overview = compute(data, { ...EMPTY_FILTERS, goalId: goalA.id });
    expect(overview.summary.actualMinutes).toBe(120);
    expect(overview.goals.map((g) => g.goalId)).toEqual([goalA.id]);
    expect(overview.projects.map((p) => p.projectId)).toEqual([projectA.id]);
  });

  it('narrows to the selected project', () => {
    const overview = compute(data, { ...EMPTY_FILTERS, projectId: projectB.id });
    expect(overview.summary.actualMinutes).toBe(60);
    expect(overview.projects.map((p) => p.projectId)).toEqual([projectB.id]);
  });

  it('selects unassigned time via the sentinel goal filter', () => {
    const overview = compute(
      { ...data, sessions: [makeSession({ startTime: at(14, 9), duration: 1800 })] },
      { ...EMPTY_FILTERS, goalId: UNASSIGNED_ID }
    );
    expect(overview.summary.actualMinutes).toBe(30);
    expect(overview.goals).toHaveLength(1);
    expect(overview.goals[0].goalId).toBeNull();
  });

  it('splits planned vs unplanned sources', () => {
    const withRetro = {
      ...data,
      timeBlocks: [
        ...blocks,
        makeBlock({
          projectId: projectA.id,
          status: 'completed',
          startTime: at(14, 9),
          endTime: at(14, 10),
          createdAt: at(14, 11), // retro
        }),
      ],
    };
    const plannedOnly = compute(withRetro, { ...EMPTY_FILTERS, source: 'planned' });
    const unplannedOnly = compute(withRetro, { ...EMPTY_FILTERS, source: 'unplanned' });
    expect(plannedOnly.summary.actualMinutes).toBe(180);
    expect(plannedOnly.summary.unplannedMinutes).toBe(0);
    expect(unplannedOnly.summary.actualMinutes).toBe(60);
    expect(unplannedOnly.summary.plannedMinutes).toBe(0);
  });
});

describe('period comparison and trends', () => {
  it('compares only the elapsed span of the current week', () => {
    const goal = makeGoal();
    // Previous week: block on Tue (inside comparable span Mon–Wed 12:00)
    // and block on Thu (outside — after the comparable cutoff).
    const overview = compute({
      goals: [goal],
      timeBlocks: [
        makeBlock({
          goalId: goal.id,
          status: 'completed',
          startTime: new Date(2025, 9, 7, 9), // Tue Oct 7
          endTime: new Date(2025, 9, 7, 11),
        }),
        makeBlock({
          goalId: goal.id,
          status: 'completed',
          startTime: new Date(2025, 9, 9, 9), // Thu Oct 9
          endTime: new Date(2025, 9, 9, 12),
        }),
        makeBlock({
          goalId: goal.id,
          status: 'completed',
          startTime: at(14, 9), // this week Tue
          endTime: at(14, 10),
        }),
      ],
    });
    expect(overview.previousSummary.actualMinutes).toBe(120); // Thu excluded
    const row = overview.goals.find((g) => g.goalId === goal.id);
    expect(row?.previousActualMinutes).toBe(120);
    expect(row?.trendMinutes).toBe(60 - 120);
  });
});

describe('time series, heatmap and consistency', () => {
  it('produces 7 aligned points for a week with consistent cumulatives', () => {
    const overview = compute({
      timeBlocks: [
        makeBlock({ status: 'completed', startTime: at(13, 9), endTime: at(13, 11), goalId: 'g' }),
        makeBlock({ startTime: at(16, 9), endTime: at(16, 12), goalId: 'g' }), // planned future
      ],
    });
    expect(overview.timeSeries).toHaveLength(7);
    const last = overview.timeSeries[6];
    expect(last.cumulativePlannedMinutes).toBe(overview.summary.plannedMinutes);
    expect(last.cumulativeActualMinutes).toBe(overview.summary.actualMinutes);
    expect(overview.timeSeries.find((p) => p.key === '2025-10-15')?.isToday).toBe(true);
    expect(overview.timeSeries.find((p) => p.key === '2025-10-16')?.isFuture).toBe(true);
    // Heatmap mirrors the same day aggregates.
    const heatMon = overview.heatmap.find((h) => h.key === '2025-10-13');
    expect(heatMon?.actualMinutes).toBe(120);
    expect(heatMon?.planRatio).toBe(1);
  });

  it('aggregates the year view by month', () => {
    const year = resolvePeriod(new Date(2025, 0, 1), 'year', NOW);
    const overview = compute(
      {
        timeBlocks: [
          makeBlock({
            status: 'completed',
            startTime: new Date(2025, 2, 10, 9),
            endTime: new Date(2025, 2, 10, 11),
            goalId: 'g',
          }),
        ],
      },
      EMPTY_FILTERS,
      year
    );
    expect(overview.timeSeries).toHaveLength(12);
    expect(overview.timeSeries[2].key).toBe('2025-03');
    expect(overview.timeSeries[2].actualMinutes).toBe(120);
    expect(overview.heatmap).toHaveLength(365);
  });

  it('computes active and elapsed days for a partial week', () => {
    const overview = compute({
      timeBlocks: [
        makeBlock({ status: 'completed', startTime: at(13, 9), endTime: at(13, 10), goalId: 'g' }),
      ],
      tasks: [makeTask({ completedAt: at(15, 9), status: 'completed' })],
    });
    expect(overview.summary.elapsedDays).toBe(3); // Mon, Tue, Wed(now)
    expect(overview.summary.activeDays).toBe(2); // Mon (time) + Wed (task)
  });
});

describe('goal and project status', () => {
  it('labels goals ahead / on-track / behind / no-plan', () => {
    const ahead = makeGoal({ title: 'ahead' });
    const onTrack = makeGoal({ title: 'ontrack' });
    const behind = makeGoal({ title: 'behind' });
    const noPlan = makeGoal({ title: 'noplan' });
    const overview = compute({
      goals: [ahead, onTrack, behind, noPlan],
      timeBlocks: [
        // ahead: planned 60, actual 120 → ratio 2.0
        makeBlock({
          goalId: ahead.id,
          status: 'completed',
          startTime: at(13, 10),
          endTime: at(13, 11),
          actualStartTime: at(13, 10),
          actualEndTime: at(13, 12),
        }),
        // on-track: planned 60, actual 60 → ratio 1.0
        makeBlock({ goalId: onTrack.id, status: 'completed', startTime: at(13, 14), endTime: at(13, 15) }),
        // behind: planned 240, actual 0
        makeBlock({ goalId: behind.id, startTime: at(14, 9), endTime: at(14, 13) }),
        // no-plan: retro-logged execution only
        makeBlock({
          goalId: noPlan.id,
          status: 'completed',
          startTime: at(15, 9),
          endTime: at(15, 10),
          createdAt: at(15, 10),
        }),
      ],
    });
    const byName = Object.fromEntries(overview.goals.map((g) => [g.goalName, g.status]));
    expect(byName['ahead']).toBe('ahead');
    expect(byName['ontrack']).toBe('on-track');
    expect(byName['behind']).toBe('behind');
    expect(byName['noplan']).toBe('no-plan');
  });

  // Regression (2026-07 "everything is Behind"): during an in-progress
  // period the reference is the plan matured up to NOW, not the full-period
  // plan — future blocks must not count against today's status.
  it('marks a goal with only future plan as not-due, never behind', () => {
    const goal = makeGoal({ title: 'future-only' });
    const overview = compute({
      goals: [goal],
      timeBlocks: [
        // Planned Fri 17 (NOW is Wed 15 12:00) — nothing exigible yet.
        makeBlock({ goalId: goal.id, startTime: at(17, 9), endTime: at(17, 13) }),
      ],
    });
    expect(overview.goals.find((g) => g.goalName === 'future-only')?.status).toBe('not-due');
  });

  it('judges an in-progress period against the matured plan only', () => {
    const goal = makeGoal({ title: 'paced' });
    const overview = compute({
      goals: [goal],
      timeBlocks: [
        // Matured: Mon 13, 2h planned and 2h done.
        makeBlock({
          goalId: goal.id,
          status: 'completed',
          startTime: at(13, 9),
          endTime: at(13, 11),
        }),
        // Future: Sat 18, 8h planned — must not drag the status down.
        makeBlock({ goalId: goal.id, startTime: at(18, 9), endTime: at(18, 17) }),
      ],
    });
    const row = overview.goals.find((g) => g.goalName === 'paced');
    expect(row?.plannedMinutes).toBe(600);
    expect(row?.plannedElapsedMinutes).toBe(120);
    expect(row?.status).toBe('on-track');
  });

  it('executing before any plan matured counts as ahead', () => {
    const goal = makeGoal({ title: 'early-bird' });
    const overview = compute({
      goals: [goal],
      timeBlocks: [
        makeBlock({ goalId: goal.id, startTime: at(18, 9), endTime: at(18, 11) }), // future plan
        // Retro-logged execution: real work done before any plan matured.
        makeBlock({
          goalId: goal.id,
          status: 'completed',
          startTime: at(13, 9),
          endTime: at(13, 10),
          createdAt: at(13, 10),
        }),
      ],
    });
    expect(overview.goals.find((g) => g.goalName === 'early-bird')?.status).toBe('ahead');
  });

  it('judges a closed period against the full plan (elapsed == full)', () => {
    const prevWeek = resolvePeriod(new Date(2025, 9, 8), 'week', NOW); // Oct 6 → 13, closed
    const goal = makeGoal({ title: 'closed-behind' });
    const overview = compute(
      {
        goals: [goal],
        timeBlocks: [
          makeBlock({ goalId: goal.id, startTime: new Date(2025, 9, 10, 9), endTime: new Date(2025, 9, 10, 13) }),
        ],
      },
      EMPTY_FILTERS,
      prevWeek
    );
    const row = overview.goals.find((g) => g.goalName === 'closed-behind');
    expect(row?.plannedElapsedMinutes).toBe(row?.plannedMinutes);
    expect(row?.status).toBe('behind');
  });

  it('marks stale projects with open tasks as inactive', () => {
    const goal = makeGoal();
    const project = makeProject({ goalId: goal.id });
    const overview = compute({
      goals: [goal],
      projects: [project],
      tasks: [makeTask({ projectId: project.id })], // open task
      timeBlocks: [
        makeBlock({
          projectId: project.id,
          status: 'completed',
          startTime: new Date(2025, 8, 1, 9), // Sep 1 — >14d before NOW
          endTime: new Date(2025, 8, 1, 10),
        }),
      ],
    });
    const row = overview.projects.find((p) => p.projectId === project.id);
    expect(row?.status).toBe('inactive');
    expect(row?.lastActivityAt?.getMonth()).toBe(8);
  });
});

describe('insights', () => {
  it('fires the under-plan rule for the most neglected goal', () => {
    const goal = makeGoal({ title: 'SCACCHI' });
    const overview = compute({
      goals: [goal],
      timeBlocks: [makeBlock({ goalId: goal.id, startTime: at(13, 9), endTime: at(13, 13) })],
    });
    const insight = overview.insights.find((i) => i.rule === 'goal-under-plan');
    expect(insight).toBeDefined();
    expect(insight?.title).toContain('SCACCHI');
    expect(insight?.link?.goalId).toBe(goal.id);
  });

  it('caps the engine output at MAX_INSIGHTS, ranked by priority', () => {
    // Build a messy period that trips many rules at once.
    const goals = ['G1', 'G2', 'G3', 'G4'].map((t) => makeGoal({ title: t }));
    const blocks = goals.flatMap((g, i) => [
      makeBlock({ goalId: g.id, startTime: at(13 + i, 9), endTime: at(13 + i, 13) }),
    ]);
    const overview = compute({
      goals,
      timeBlocks: [
        ...blocks,
        makeBlock({
          goalId: goals[0].id,
          status: 'completed',
          startTime: at(14, 20),
          endTime: at(14, 23),
          createdAt: at(14, 23),
        }),
      ],
    });
    expect(overview.insights.length).toBeLessThanOrEqual(MAX_INSIGHTS);
    const priorities = overview.insights.map((i) => i.priority);
    expect([...priorities].sort((a, b) => b - a)).toEqual(priorities);
  });
});
