// src/lib/performance/metrics.ts
//
// Pure aggregation engine for the Performance Review section.
// No React, no DB, no I/O — inputs are plain entity snapshots (the same
// arrays DataProvider already holds) and every formula is documented in
// the Metric Glossary in `./types.ts`.

import type { Goal, Project, Session, Task, TimeBlock } from '@/types';
import {
  MAX_EXECUTION_INTERVAL_MS,
  parseCompletedSessionEvidence,
  proportionalSessionMinutes,
  validExecutionInterval,
  type CompletedSessionEvidence,
} from '@/lib/executionEvidence';
import {
  addDays,
  addMonths,
  countDays,
  dayKey,
  enumerateDays,
  enumerateMonths,
  monthKey,
  resolvePeriod,
  startOfDay,
} from './period';
import type {
  ActivityDetailRow,
  CarryOverTask,
  EntityStatus,
  GoalPerformance,
  PerformanceDataQuality,
  PerformanceFilters,
  PerformanceHeatmapDay,
  PerformanceOverview,
  PerformancePeriod,
  PerformanceSummary,
  PerformanceTimePoint,
  ProjectPerformance,
} from './types';
import { EMPTY_FILTERS } from './types';
import { buildInsights } from './insights';

// ============================================================================
// TUNABLES (documented thresholds — every consumer must import from here)
// ============================================================================

/** executionRatio at/above which an entity is 'ahead' of its plan. */
export const STATUS_AHEAD_RATIO = 1.15;
/** executionRatio below which an entity is 'behind' its plan. */
export const STATUS_BEHIND_RATIO = 0.85;
/** A project with open tasks and no execution for this many days is 'inactive'. */
export const INACTIVE_AFTER_DAYS = 14;
/** Hard cap for a single block/session duration; longer raw data is corrupt. */
const MAX_ITEM_MS = MAX_EXECUTION_INTERVAL_MS;

/** Sentinel accepted by `PerformanceFilters.goalId` to select unattributed time. */
export const UNASSIGNED_ID = '__unassigned__';
export const UNASSIGNED_LABEL = 'Unassigned';

// ============================================================================
// INPUT
// ============================================================================

export interface PerformanceInput {
  /** Optional defense-in-depth owner scope. UI callers must supply it. */
  ownerUid?: string;
  timeBlocks: TimeBlock[];
  sessions: Session[];
  tasks: Task[];
  projects: Project[];
  goals: Goal[];
}

// ============================================================================
// SMALL PURE HELPERS
// ============================================================================

interface Interval {
  start: number; // epoch ms
  end: number; // epoch ms (exclusive)
}

function overlapMinutes(a: Interval, b: Interval): number {
  const ms = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  return ms > 0 ? ms / 60000 : 0;
}

function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function endOfDayMs(date: Date): number {
  return addDays(startOfDay(date), 1).getTime() - 1;
}

/**
 * Executed = the block actually ran. Mirrors the "single source of truth"
 * semantics of `weeklyPlanner/analytics.isCompletedStatus`: an 'overrun'
 * block ran past/short of its plan but it ran, and SessionManager records
 * real actual times on it. (CLAUDE.md's rollup counts 'completed' only;
 * the difference is surfaced via `dataQuality.overrunBlockCount`.)
 */
export function isExecutedStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'overrun';
}

function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) ? ratio : null;
}

// ============================================================================
// ATTRIBUTION (mirrors lib/hierarchicalRollup.ts precedence)
// ============================================================================

interface Lookup {
  taskById: Map<string, Task>;
  projectById: Map<string, Project>;
  goalById: Map<string, Goal>;
}

interface Attribution {
  taskId: string | null;
  projectId: string | null;
  goalId: string | null;
  /** True when a referenced parent entity no longer exists. */
  missingParent: boolean;
}

function resolveAttribution(
  ref: { taskId?: string | null; projectId?: string | null; goalId?: string | null },
  lookup: Lookup
): Attribution {
  let missingParent = false;

  let task: Task | null = null;
  if (ref.taskId) {
    task = lookup.taskById.get(ref.taskId) ?? null;
    if (!task) missingParent = true;
  }

  // Task chain wins (rollup precedence); fall back to the block's own links.
  let projectId: string | null = task?.projectId || ref.projectId || null;
  let project: Project | null = null;
  if (projectId) {
    project = lookup.projectById.get(projectId) ?? null;
    if (!project) {
      missingParent = true;
      projectId = null;
    }
  }

  let goalId: string | null = project?.goalId || task?.goalId || ref.goalId || null;
  if (goalId && !lookup.goalById.has(goalId)) {
    missingParent = true;
    goalId = null;
  }

  return { taskId: task ? task.id : null, projectId, goalId, missingParent };
}

/** Attribution chain for a Task row (due dates, completions). */
function resolveTaskAttribution(task: Task, lookup: Lookup): Attribution {
  return resolveAttribution(
    { taskId: undefined, projectId: task.projectId || null, goalId: task.goalId || null },
    lookup
  );
}

function matchesFilters(attr: Attribution, filters: PerformanceFilters): boolean {
  if (filters.goalId) {
    if (filters.goalId === UNASSIGNED_ID) {
      if (attr.goalId !== null) return false;
    } else if (attr.goalId !== filters.goalId) {
      return false;
    }
  }
  if (filters.projectId && attr.projectId !== filters.projectId) return false;
  return true;
}

// ============================================================================
// WINDOW AGGREGATION
// ============================================================================

interface DayAgg {
  date: Date;
  planned: number;
  actual: number;
  unplanned: number;
  measured: number;
  tasksCompleted: number;
  goalIds: Set<string | null>;
}

interface EntityAgg {
  planned: number;
  /** Planned minutes matured up to `now` (status reference for partial periods). */
  plannedElapsed: number;
  actual: number;
  unplanned: number;
  plannedTasks: number;
  completedPlannedTasks: number;
  completedTasksInPeriod: number;
  activeProjectIds: Set<string>;
}

function emptyEntityAgg(): EntityAgg {
  return {
    planned: 0,
    plannedElapsed: 0,
    actual: 0,
    unplanned: 0,
    plannedTasks: 0,
    completedPlannedTasks: 0,
    completedTasksInPeriod: 0,
    activeProjectIds: new Set(),
  };
}

interface WindowAgg {
  planned: number;
  /** Planned minutes matured up to `now` (≤ planned). */
  plannedElapsed: number;
  actual: number;
  plannedExecuted: number;
  unplanned: number;
  measured: number;
  plannedTasks: number;
  completedPlannedTasks: number;
  completedTasksInPeriod: number;
  onTimeCompleted: number;
  completedWithDueDate: number;
  days: Map<string, DayAgg>;
  goalAgg: Map<string | null, EntityAgg>;
  projectAgg: Map<string, EntityAgg>;
  activity: ActivityDetailRow[];
  carryOver: CarryOverTask[];
  quality: PerformanceDataQuality;
}

function emptyQuality(): PerformanceDataQuality {
  return {
    actualAvailability: 'complete',
    measuredMinutes: 0,
    actualSourceCount: 0,
    blocksMissingActualCount: 0,
    coverageRate: null,
    unclassifiedMinutes: 0,
    orphanSessionCount: 0,
    orphanSessionMinutes: 0,
    openSessionCount: 0,
    overrunBlockCount: 0,
    blocksWithMissingParents: 0,
    completedTasksWithoutTime: 0,
    estimatedUnscheduledMinutes: 0,
    anomalousDurationCount: 0,
    excludedBreakMinutes: 0,
    cancelledPlannedMinutes: 0,
  };
}

function getDayAgg(days: Map<string, DayAgg>, date: Date): DayAgg {
  const key = dayKey(date);
  let agg = days.get(key);
  if (!agg) {
    agg = {
      date: startOfDay(date),
      planned: 0,
      actual: 0,
      unplanned: 0,
      measured: 0,
      tasksCompleted: 0,
      goalIds: new Set(),
    };
    days.set(key, agg);
  }
  return agg;
}

function getEntityAgg<K>(map: Map<K, EntityAgg>, key: K): EntityAgg {
  let agg = map.get(key);
  if (!agg) {
    agg = emptyEntityAgg();
    map.set(key, agg);
  }
  return agg;
}

/** Walk each local calendar day the interval overlaps inside the window. */
function eachOverlapDay(
  interval: Interval,
  window: Interval,
  cb: (dayStart: Date, minutes: number) => void
): void {
  const from = Math.max(interval.start, window.start);
  const to = Math.min(interval.end, window.end);
  if (to <= from) return;
  let cursor = startOfDay(new Date(from));
  while (cursor.getTime() < to) {
    const next = addDays(cursor, 1);
    const minutes = overlapMinutes(interval, {
      start: cursor.getTime(),
      end: next.getTime(),
    });
    if (minutes > 0) cb(cursor, minutes);
    cursor = next;
  }
}

/**
 * Aggregate one window. `collectDetail` controls whether activity rows and
 * carry-over lists are built (skipped for the comparison window).
 */
function aggregateWindow(
  input: PerformanceInput,
  windowStart: Date,
  windowEnd: Date,
  filters: PerformanceFilters,
  lookup: Lookup,
  collectDetail: boolean,
  now: Date
): WindowAgg {
  const window: Interval = { start: windowStart.getTime(), end: windowEnd.getTime() };
  const windowClosed = window.end <= now.getTime();
  /** Portion of the window already in the past — the matured plan lives here. */
  const elapsedWindow: Interval = {
    start: window.start,
    end: Math.min(now.getTime(), window.end),
  };
  const quality = emptyQuality();
  const days = new Map<string, DayAgg>();
  const goalAgg = new Map<string | null, EntityAgg>();
  const projectAgg = new Map<string, EntityAgg>();
  const activity: ActivityDetailRow[] = [];
  const carryOver: CarryOverTask[] = [];

  let planned = 0;
  let plannedElapsed = 0;
  let actual = 0;
  let plannedExecuted = 0;
  let unplanned = 0;

  /** Tasks referenced by an advance-planned block overlapping the window. */
  const scheduledTaskIds = new Set<string>();
  /** Tasks referenced by ANY counted block overlapping the window. */
  const taskIdsWithBlocks = new Set<string>();
  /** Actual minutes attributed to each task inside the window. */
  const taskActualMinutes = new Map<string, number>();

  const goalName = (id: string | null): string =>
    id === null ? UNASSIGNED_LABEL : lookup.goalById.get(id)?.title || 'Untitled goal';
  const projectName = (id: string | null): string =>
    id === null ? '—' : lookup.projectById.get(id)?.name || 'Untitled project';

  const blockById = new Map(input.timeBlocks.map((block) => [block.id, block]));
  const validSessions: Array<Readonly<{
    session: Session;
    evidence: CompletedSessionEvidence;
  }>> = [];
  const blocksWithValidSessions = new Set<string>();

  // Parse Sessions first because they are the primary execution source. A
  // valid linked Session suppresses the block's duplicated explicit actual
  // interval even when the Session falls outside this particular window.
  for (const session of input.sessions) {
    if (session.deleted === true) continue;
    if (session.status !== 'completed') {
      const startsInWindow =
        isValidDate(session.startTime)
        && session.startTime.getTime() >= window.start
        && session.startTime.getTime() < window.end;
      if (startsInWindow) quality.openSessionCount += 1;
      continue;
    }
    const evidence = parseCompletedSessionEvidence(session);
    if (!evidence) {
      const hasValidStart = isValidDate(session.startTime);
      const hasValidEnd = isValidDate(session.endTime);
      const mayAffectWindow = !hasValidStart || (
        session.startTime.getTime() < window.end
        && (hasValidEnd
          ? (session.endTime as Date).getTime() > window.start
          : session.startTime.getTime() >= window.start)
      );
      if (mayAffectWindow) quality.anomalousDurationCount += 1;
      continue;
    }
    validSessions.push({ session, evidence });
    if (evidence.timeBlockId) blocksWithValidSessions.add(evidence.timeBlockId);
  }

  // -------------------------------------------------------------- TimeBlocks
  for (const block of input.timeBlocks) {
    if (block.deleted) continue;
    if (!isValidDate(block.startTime) || !isValidDate(block.endTime)) {
      const mayAffectWindow = !isValidDate(block.startTime) || (
        block.startTime.getTime() >= window.start
        && block.startTime.getTime() < window.end
      );
      if (mayAffectWindow) quality.anomalousDurationCount += 1;
      continue;
    }

    const plannedInterval: Interval = {
      start: block.startTime.getTime(),
      end: block.endTime.getTime(),
    };
    if (plannedInterval.end - plannedInterval.start > MAX_ITEM_MS) {
      plannedInterval.end = plannedInterval.start + MAX_ITEM_MS;
      quality.anomalousDurationCount += 1;
    }
    const plannedOverlap = overlapMinutes(plannedInterval, window);

    // Cancelled blocks: their plan is void — visible in quality, never counted.
    if (block.status === 'cancelled') {
      if (plannedOverlap > 0) quality.cancelledPlannedMinutes += plannedOverlap;
      continue;
    }

    // Breaks/buffers are rest & slack, not invested work (see glossary).
    if (block.type === 'break' || block.type === 'buffer') {
      if (plannedOverlap > 0) quality.excludedBreakMinutes += plannedOverlap;
      continue;
    }

    const attr = resolveAttribution(block, lookup);
    if (!matchesFilters(attr, filters)) continue;

    // Scheduled in advance ⇒ it is plan; otherwise it is retro-logged execution.
    const plannedInAdvance = isValidDate(block.createdAt)
      ? block.createdAt.getTime() < plannedInterval.start
      : true; // corrupt createdAt: give the block the benefit of the doubt

    const executed = isExecutedStatus(block.status);

    // Completed Sessions are primary. Use the block's explicit actual interval
    // only when no valid linked Session exists. Never substitute the plan.
    let actualInterval: Interval | null = null;
    let timeSource: 'measured' | 'missing' | 'none' = 'none';
    const hasLinkedSession = blocksWithValidSessions.has(block.id);
    if (executed && !hasLinkedSession) {
      const explicit = validExecutionInterval(block.actualStartTime, block.actualEndTime);
      if (explicit) {
        actualInterval = { start: explicit.start, end: explicit.end };
        timeSource = 'measured';
      } else if (block.actualStartTime !== undefined || block.actualEndTime !== undefined) {
        quality.anomalousDurationCount += 1;
      }
    }
    const actualOverlap = actualInterval ? overlapMinutes(actualInterval, window) : 0;

    const countsPlanned = plannedInAdvance && plannedOverlap > 0;
    const countsActual = actualOverlap > 0;
    const missingActualInWindow =
      executed && !hasLinkedSession && actualInterval === null && plannedOverlap > 0;
    if (!countsPlanned && !countsActual && !missingActualInWindow) continue;

    if (attr.missingParent) quality.blocksWithMissingParents += 1;
    if (block.status === 'overrun' && plannedOverlap > 0) quality.overrunBlockCount += 1;

    // Source filter narrows by time provenance (task counters are documented
    // as unaffected — they have no provenance dimension).
    const passesSource =
      filters.source === 'all' ||
      (filters.source === 'planned' && plannedInAdvance) ||
      (filters.source === 'unplanned' && !plannedInAdvance);
    if (!passesSource) continue;

    if (missingActualInWindow) {
      quality.blocksMissingActualCount += 1;
      timeSource = 'missing';
    }

    if (block.taskId) {
      taskIdsWithBlocks.add(block.taskId);
      if (plannedInAdvance && plannedOverlap > 0) scheduledTaskIds.add(block.taskId);
    }

    const gAgg = getEntityAgg(goalAgg, attr.goalId);
    const pAgg = attr.projectId ? getEntityAgg(projectAgg, attr.projectId) : null;

    if (countsPlanned) {
      planned += plannedOverlap;
      gAgg.planned += plannedOverlap;
      if (pAgg) pAgg.planned += plannedOverlap;
      const elapsedOverlap = overlapMinutes(plannedInterval, elapsedWindow);
      plannedElapsed += elapsedOverlap;
      gAgg.plannedElapsed += elapsedOverlap;
      if (pAgg) pAgg.plannedElapsed += elapsedOverlap;
      eachOverlapDay(plannedInterval, window, (dayStart, minutes) => {
        getDayAgg(days, dayStart).planned += minutes;
      });
    }

    if (countsActual && actualInterval) {
      actual += actualOverlap;
      gAgg.actual += actualOverlap;
      if (pAgg && attr.projectId) {
        pAgg.actual += actualOverlap;
        gAgg.activeProjectIds.add(attr.projectId);
      }
      if (plannedInAdvance) plannedExecuted += actualOverlap;
      else {
        unplanned += actualOverlap;
        gAgg.unplanned += actualOverlap;
        if (pAgg) pAgg.unplanned += actualOverlap;
      }
      quality.measuredMinutes += actualOverlap;
      quality.actualSourceCount += 1;
      if (attr.goalId === null) quality.unclassifiedMinutes += actualOverlap;
      if (attr.taskId) {
        taskActualMinutes.set(
          attr.taskId,
          (taskActualMinutes.get(attr.taskId) || 0) + actualOverlap
        );
      }
      eachOverlapDay(actualInterval, window, (dayStart, minutes) => {
        const dayAgg = getDayAgg(days, dayStart);
        dayAgg.actual += minutes;
        dayAgg.goalIds.add(attr.goalId);
        if (!plannedInAdvance) dayAgg.unplanned += minutes;
        dayAgg.measured += minutes;
      });
    }

    if (collectDetail) {
      const anchor = countsActual && actualInterval ? actualInterval.start : plannedInterval.start;
      activity.push({
        id: block.id,
        source: 'timeblock',
        date: new Date(anchor),
        dayKey: dayKey(new Date(Math.max(anchor, window.start))),
        title: block.title || 'Untitled block',
        goalId: attr.goalId,
        goalName: goalName(attr.goalId),
        projectId: attr.projectId,
        projectName: projectName(attr.projectId),
        taskId: attr.taskId,
        taskTitle: attr.taskId ? lookup.taskById.get(attr.taskId)?.title ?? null : null,
        plannedMinutes: countsPlanned ? Math.round(plannedOverlap) : 0,
        actualMinutes: Math.round(actualOverlap),
        status: block.status,
        plannedInAdvance,
        timeSource,
      });
    }
  }

  // ---------------------------------------------------------------- Sessions
  for (const { session, evidence } of validSessions) {
    const interval: Interval = {
      start: evidence.interval.start,
      end: evidence.interval.end,
    };
    const linkedBlock = evidence.timeBlockId ? blockById.get(evidence.timeBlockId) ?? null : null;
    const attr = resolveAttribution(
      {
        taskId: session.taskId || linkedBlock?.taskId,
        projectId: session.projectId || linkedBlock?.projectId,
        goalId: session.goalIds?.[0] || linkedBlock?.goalId,
      },
      lookup
    );
    if (!matchesFilters(attr, filters)) continue;

    const minutes = proportionalSessionMinutes(evidence, window);
    if (minutes <= 0) continue;

    // Rest/slack stays excluded even when it has a linked execution Session.
    if (linkedBlock?.type === 'break' || linkedBlock?.type === 'buffer') {
      quality.excludedBreakMinutes += minutes;
      continue;
    }

    const linkedPlannedInterval = linkedBlock
      && !linkedBlock.deleted
      && linkedBlock.status !== 'cancelled'
      && isValidDate(linkedBlock.startTime)
      && isValidDate(linkedBlock.endTime)
      ? { start: linkedBlock.startTime.getTime(), end: linkedBlock.endTime.getTime() }
      : null;
    const plannedInAdvance = linkedPlannedInterval !== null
      && (isValidDate(linkedBlock?.createdAt)
        ? linkedBlock.createdAt.getTime() < linkedPlannedInterval.start
        : true);
    const passesSource =
      filters.source === 'all'
      || (filters.source === 'planned' && plannedInAdvance)
      || (filters.source === 'unplanned' && !plannedInAdvance);
    if (!passesSource) continue;

    if (attr.missingParent) quality.blocksWithMissingParents += 1;

    actual += minutes;
    if (plannedInAdvance) plannedExecuted += minutes;
    else unplanned += minutes;
    quality.measuredMinutes += minutes;
    quality.actualSourceCount += 1;
    if (!linkedBlock) {
      quality.orphanSessionCount += 1;
      quality.orphanSessionMinutes += minutes;
    }
    if (attr.goalId === null) quality.unclassifiedMinutes += minutes;

    const gAgg = getEntityAgg(goalAgg, attr.goalId);
    gAgg.actual += minutes;
    if (!plannedInAdvance) gAgg.unplanned += minutes;
    if (attr.projectId) {
      const pAgg = getEntityAgg(projectAgg, attr.projectId);
      pAgg.actual += minutes;
      if (!plannedInAdvance) pAgg.unplanned += minutes;
      gAgg.activeProjectIds.add(attr.projectId);
    }
    if (attr.taskId) {
      taskActualMinutes.set(attr.taskId, (taskActualMinutes.get(attr.taskId) || 0) + minutes);
    }

    const wallMinutes = (interval.end - interval.start) / 60_000;
    eachOverlapDay(interval, window, (dayStart, overlappedWallMinutes) => {
      const dayMinutes = evidence.netMinutes * overlappedWallMinutes / wallMinutes;
      const dayAgg = getDayAgg(days, dayStart);
      dayAgg.actual += dayMinutes;
      if (!plannedInAdvance) dayAgg.unplanned += dayMinutes;
      dayAgg.measured += dayMinutes;
      dayAgg.goalIds.add(attr.goalId);
    });

    if (collectDetail) {
      activity.push({
        id: session.id,
        source: 'session',
        date: new Date(interval.start),
        dayKey: dayKey(new Date(Math.max(interval.start, window.start))),
        title: session.notes || 'Tracked session',
        goalId: attr.goalId,
        goalName: goalName(attr.goalId),
        projectId: attr.projectId,
        projectName: projectName(attr.projectId),
        taskId: attr.taskId,
        taskTitle: attr.taskId ? lookup.taskById.get(attr.taskId)?.title ?? null : null,
        plannedMinutes: 0,
        actualMinutes: Math.round(minutes),
        status: 'session',
        plannedInAdvance,
        timeSource: 'measured',
      });
    }
  }

  // ------------------------------------------------------------------- Tasks
  let plannedTasks = 0;
  let completedPlannedTasks = 0;
  let completedTasksInPeriod = 0;
  let onTimeCompleted = 0;
  let completedWithDueDate = 0;

  for (const task of input.tasks) {
    if (task.deleted) continue;
    const attr = resolveTaskAttribution(task, lookup);
    if (!matchesFilters(attr, filters)) continue;

    const due = isValidDate(task.dueDate) ? task.dueDate : null;
    const dueInWindow =
      due !== null && due.getTime() >= window.start && due.getTime() < window.end;
    const scheduled = scheduledTaskIds.has(task.id);
    const isPlannedTask = dueInWindow || scheduled;

    // Some historical records carry status 'completed' without a completedAt
    // (older UI paths never wrote it — fixed in DataProvider.updateTask on
    // 2026-07-15). Fall back to updatedAt so real completions are not
    // reported as never-done; the trade-off (an edit after completion shifts
    // the date) only applies to those legacy rows.
    const completedAt = isValidDate(task.completedAt)
      ? task.completedAt
      : task.status === 'completed' && isValidDate(task.updatedAt)
        ? task.updatedAt
        : null;
    const completedInWindow =
      completedAt !== null &&
      completedAt.getTime() >= window.start &&
      completedAt.getTime() < window.end;

    if (completedInWindow) {
      completedTasksInPeriod += 1;
      const gAgg = getEntityAgg(goalAgg, attr.goalId);
      gAgg.completedTasksInPeriod += 1;
      if (attr.projectId) getEntityAgg(projectAgg, attr.projectId).completedTasksInPeriod += 1;
      getDayAgg(days, completedAt as Date).tasksCompleted += 1;
      if (due) {
        completedWithDueDate += 1;
        if ((completedAt as Date).getTime() <= endOfDayMs(due)) onTimeCompleted += 1;
      }
      if ((taskActualMinutes.get(task.id) || 0) === 0) {
        quality.completedTasksWithoutTime += 1;
      }
    }

    if (isPlannedTask) {
      plannedTasks += 1;
      const gAgg = getEntityAgg(goalAgg, attr.goalId);
      gAgg.plannedTasks += 1;
      const pAgg = attr.projectId ? getEntityAgg(projectAgg, attr.projectId) : null;
      if (pAgg) pAgg.plannedTasks += 1;

      const fulfilled =
        completedAt !== null &&
        completedAt.getTime() < window.end &&
        (dueInWindow ? completedAt.getTime() <= endOfDayMs(due as Date) : true);

      if (fulfilled) {
        completedPlannedTasks += 1;
        gAgg.completedPlannedTasks += 1;
        if (pAgg) pAgg.completedPlannedTasks += 1;
      } else if (collectDetail) {
        // During a still-running period, an open task whose due date has not
        // passed yet is "upcoming", not carried over.
        const duePassed = due !== null && endOfDayMs(due) < now.getTime();
        const slipped =
          windowClosed || duePassed || completedAt !== null || task.status === 'cancelled';
        if (slipped) {
          const outcome: CarryOverTask['outcome'] =
            task.status === 'cancelled'
              ? 'cancelled'
              : completedAt !== null
                ? 'completed-late'
                : 'open';
          carryOver.push({
            taskId: task.id,
            taskTitle: task.title || 'Untitled task',
            projectId: attr.projectId,
            projectName: projectName(attr.projectId),
            goalId: attr.goalId,
            goalName: goalName(attr.goalId),
            dueDate: due,
            outcome,
          });
        }
      }

      // Estimated-but-unscheduled = due work with an estimate that never got
      // calendar space AND is still undone (completed work is covered by
      // `completedTasksWithoutTime` instead).
      if (
        dueInWindow &&
        !taskIdsWithBlocks.has(task.id) &&
        task.status !== 'cancelled' &&
        completedAt === null &&
        typeof task.estimatedMinutes === 'number' &&
        task.estimatedMinutes > 0
      ) {
        quality.estimatedUnscheduledMinutes += task.estimatedMinutes;
      }
    }
  }

  quality.coverageRate = safeRatio(
    quality.actualSourceCount,
    quality.actualSourceCount + quality.blocksMissingActualCount
  );
  quality.actualAvailability =
    quality.blocksMissingActualCount > 0
    || quality.openSessionCount > 0
    || quality.anomalousDurationCount > 0
      ? 'partial'
      : 'complete';

  return {
    planned,
    plannedElapsed,
    actual,
    plannedExecuted,
    unplanned,
    measured: quality.measuredMinutes,
    plannedTasks,
    completedPlannedTasks,
    completedTasksInPeriod,
    onTimeCompleted,
    completedWithDueDate,
    days,
    goalAgg,
    projectAgg,
    activity,
    carryOver,
    quality,
  };
}

// ============================================================================
// SUMMARY / SERIES / BREAKDOWN BUILDERS
// ============================================================================

function buildSummary(agg: WindowAgg, windowStart: Date, windowEnd: Date, now: Date): PerformanceSummary {
  const totalDays = countDays(windowStart, windowEnd);
  const elapsedEnd = new Date(
    Math.min(Math.max(now.getTime(), windowStart.getTime()), windowEnd.getTime())
  );
  const elapsedDays =
    now.getTime() <= windowStart.getTime() ? 0 : countDays(windowStart, addDays(startOfDay(elapsedEnd), 1));

  let activeDays = 0;
  for (const [, day] of Array.from(agg.days.entries())) {
    if (day.date.getTime() >= windowStart.getTime() && day.date.getTime() < elapsedEnd.getTime()) {
      if (day.actual > 0 || day.tasksCompleted > 0) activeDays += 1;
    }
  }

  return {
    plannedMinutes: Math.round(agg.planned),
    plannedElapsedMinutes: Math.round(agg.plannedElapsed),
    actualMinutes: Math.round(agg.actual),
    varianceMinutes: Math.round(agg.actual - agg.planned),
    executionRatio: safeRatio(agg.actual, agg.planned),
    executionRatioToDate: safeRatio(agg.actual, agg.plannedElapsed),
    plannedExecutedMinutes: Math.round(agg.plannedExecuted),
    unplannedMinutes: Math.round(agg.unplanned),
    plannedTasks: agg.plannedTasks,
    completedPlannedTasks: agg.completedPlannedTasks,
    planFulfillmentRate: safeRatio(agg.completedPlannedTasks, agg.plannedTasks),
    completedTasksInPeriod: agg.completedTasksInPeriod,
    onTimeRate: safeRatio(agg.onTimeCompleted, agg.completedWithDueDate),
    activeDays: Math.min(activeDays, Math.max(elapsedDays, 0)),
    elapsedDays: Math.min(Math.max(elapsedDays, 0), totalDays),
    totalDays,
  };
}

function buildTimeSeries(
  agg: WindowAgg,
  period: PerformancePeriod,
  now: Date
): PerformanceTimePoint[] {
  const todayKey = dayKey(now);
  const points: PerformanceTimePoint[] = [];
  let cumulativePlanned = 0;
  let cumulativeActual = 0;

  if (period.type === 'year') {
    const months = enumerateMonths(period.start, period.end);
    const byMonth = new Map<string, { planned: number; actual: number; unplanned: number; tasks: number }>();
    for (const [key, day] of Array.from(agg.days.entries())) {
      const mk = key.slice(0, 7);
      const bucket = byMonth.get(mk) || { planned: 0, actual: 0, unplanned: 0, tasks: 0 };
      bucket.planned += day.planned;
      bucket.actual += day.actual;
      bucket.unplanned += day.unplanned;
      bucket.tasks += day.tasksCompleted;
      byMonth.set(mk, bucket);
    }
    for (const monthStart of months) {
      const mk = monthKey(monthStart);
      const bucket = byMonth.get(mk) || { planned: 0, actual: 0, unplanned: 0, tasks: 0 };
      cumulativePlanned += bucket.planned;
      cumulativeActual += bucket.actual;
      points.push({
        key: mk,
        label: monthStart.toLocaleDateString('en-US', { month: 'short' }),
        start: monthStart,
        end: addMonths(monthStart, 1),
        plannedMinutes: Math.round(bucket.planned),
        actualMinutes: Math.round(bucket.actual),
        unplannedMinutes: Math.round(bucket.unplanned),
        varianceMinutes: Math.round(bucket.actual - bucket.planned),
        cumulativePlannedMinutes: Math.round(cumulativePlanned),
        cumulativeActualMinutes: Math.round(cumulativeActual),
        tasksCompleted: bucket.tasks,
        isToday: monthKey(now) === mk,
        isFuture: monthStart.getTime() > now.getTime(),
      });
    }
    return points;
  }

  const dayStarts = enumerateDays(period.start, period.end);
  for (const dayStart of dayStarts) {
    const key = dayKey(dayStart);
    const day = agg.days.get(key);
    const planned = day?.planned ?? 0;
    const actual = day?.actual ?? 0;
    cumulativePlanned += planned;
    cumulativeActual += actual;
    points.push({
      key,
      label:
        period.type === 'week'
          ? dayStart.toLocaleDateString('en-US', { weekday: 'short' })
          : String(dayStart.getDate()),
      start: dayStart,
      end: addDays(dayStart, 1),
      plannedMinutes: Math.round(planned),
      actualMinutes: Math.round(actual),
      unplannedMinutes: Math.round(day?.unplanned ?? 0),
      varianceMinutes: Math.round(actual - planned),
      cumulativePlannedMinutes: Math.round(cumulativePlanned),
      cumulativeActualMinutes: Math.round(cumulativeActual),
      tasksCompleted: day?.tasksCompleted ?? 0,
      isToday: key === todayKey,
      isFuture: dayStart.getTime() > now.getTime(),
    });
  }
  return points;
}

function buildHeatmap(
  agg: WindowAgg,
  period: PerformancePeriod,
  lookup: Lookup,
  now: Date
): PerformanceHeatmapDay[] {
  const todayKey = dayKey(now);
  return enumerateDays(period.start, period.end).map((dayStart) => {
    const key = dayKey(dayStart);
    const day = agg.days.get(key);
    const planned = Math.round(day?.planned ?? 0);
    const actual = Math.round(day?.actual ?? 0);
    const goalNames = day
      ? Array.from(day.goalIds).map((id) =>
          id === null ? UNASSIGNED_LABEL : lookup.goalById.get(id)?.title || 'Untitled goal'
        )
      : [];
    return {
      key,
      date: dayStart,
      plannedMinutes: planned,
      actualMinutes: actual,
      planRatio: safeRatio(actual, planned),
      tasksCompleted: day?.tasksCompleted ?? 0,
      goalNames,
      isToday: key === todayKey,
      isFuture: dayStart.getTime() > now.getTime(),
    };
  });
}

/**
 * Status vs the plan the entity can be held to TODAY (see EntityStatus docs).
 *
 * During a still-running period the reference is `plannedElapsed` (the plan
 * matured up to now), never the full-period plan: a goal whose blocks sit in
 * the future is 'not-due', not 'behind'. For a closed period
 * plannedElapsed === planned, so the reference is the full plan.
 */
function entityStatus(
  planned: number,
  plannedElapsed: number,
  actual: number,
  options?: { openTasks?: number; lastActivityAt?: Date | null; now?: Date }
): EntityStatus {
  if (planned <= 0 && actual <= 0) {
    if (options && options.openTasks !== undefined) {
      const { openTasks, lastActivityAt, now } = options;
      if (openTasks > 0 && now) {
        const cutoff = addDays(now, -INACTIVE_AFTER_DAYS).getTime();
        if (!lastActivityAt || lastActivityAt.getTime() < cutoff) return 'inactive';
      }
    }
    return 'no-data';
  }
  if (planned <= 0) return 'no-plan';
  if (plannedElapsed <= 0) {
    // Plan exists but none of it has matured yet.
    return actual > 0 ? 'ahead' : 'not-due';
  }
  const ratio = actual / plannedElapsed;
  if (ratio >= STATUS_AHEAD_RATIO) return 'ahead';
  if (ratio < STATUS_BEHIND_RATIO) return 'behind';
  return 'on-track';
}

/** Most recent execution timestamp per project (all time, unwindowed). */
function buildLastActivityMap(input: PerformanceInput, lookup: Lookup): Map<string, Date> {
  const map = new Map<string, Date>();
  const bump = (projectId: string | null, when: Date | undefined) => {
    if (!projectId || !isValidDate(when)) return;
    const current = map.get(projectId);
    if (!current || when.getTime() > current.getTime()) map.set(projectId, when);
  };
  const blockById = new Map(input.timeBlocks.map((block) => [block.id, block]));
  const blocksWithValidSessions = new Set<string>();
  for (const session of input.sessions) {
    const evidence = parseCompletedSessionEvidence(session);
    if (!evidence) continue;
    if (evidence.timeBlockId) blocksWithValidSessions.add(evidence.timeBlockId);
    const linkedBlock = evidence.timeBlockId ? blockById.get(evidence.timeBlockId) : undefined;
    const attr = resolveAttribution(
      {
        taskId: session.taskId || linkedBlock?.taskId,
        projectId: session.projectId || linkedBlock?.projectId,
        goalId: session.goalIds?.[0] || linkedBlock?.goalId,
      },
      lookup
    );
    bump(attr.projectId, new Date(evidence.interval.end));
  }
  for (const block of input.timeBlocks) {
    if (
      block.deleted
      || !isExecutedStatus(block.status)
      || blocksWithValidSessions.has(block.id)
    ) continue;
    const interval = validExecutionInterval(block.actualStartTime, block.actualEndTime);
    if (!interval) continue;
    const attr = resolveAttribution(block, lookup);
    bump(attr.projectId, new Date(interval.end));
  }
  return map;
}

// ============================================================================
// PUBLIC ENTRY POINT
// ============================================================================

export function computePerformanceOverview(
  input: PerformanceInput,
  period: PerformancePeriod,
  filters: PerformanceFilters = EMPTY_FILTERS,
  now: Date = new Date()
): PerformanceOverview {
  const scopedInput: PerformanceInput = input.ownerUid
    ? {
        ...input,
        timeBlocks: input.timeBlocks.filter((item) => item.userId === input.ownerUid),
        sessions: input.sessions.filter((item) => item.userId === input.ownerUid),
        tasks: input.tasks.filter((item) => item.userId === input.ownerUid),
        projects: input.projects.filter((item) => item.userId === input.ownerUid),
        goals: input.goals.filter((item) => item.userId === input.ownerUid),
      }
    : input;
  const lookup: Lookup = {
    taskById: new Map(scopedInput.tasks.map((t) => [t.id, t])),
    projectById: new Map(scopedInput.projects.map((p) => [p.id, p])),
    goalById: new Map(scopedInput.goals.map((g) => [g.id, g])),
  };

  const main = aggregateWindow(scopedInput, period.start, period.end, filters, lookup, true, now);
  const prev = aggregateWindow(
    scopedInput,
    period.comparisonStart,
    period.comparisonEnd,
    filters,
    lookup,
    false,
    now
  );

  const summary = buildSummary(main, period.start, period.end, now);
  const previousSummary = buildSummary(prev, period.comparisonStart, period.comparisonEnd, now);

  // ----- Goal rows (Unassigned bucket last, neglected-but-planned visible) --
  const goalIds = new Set<string | null>(Array.from(main.goalAgg.keys()));
  if (filters.projectId) {
    // Under a project filter only that project's goal is relevant.
    const filteredProject = lookup.projectById.get(filters.projectId);
    if (filteredProject?.goalId && lookup.goalById.has(filteredProject.goalId)) {
      goalIds.add(filteredProject.goalId);
    }
  } else {
    for (const goal of scopedInput.goals) {
      if (goal.status === 'active') goalIds.add(goal.id); // show planned-but-idle goals
    }
  }
  const totalActual = summary.actualMinutes;
  const goals: GoalPerformance[] = Array.from(goalIds)
    .filter((goalId) => {
      if (!filters.goalId) return true;
      return filters.goalId === UNASSIGNED_ID ? goalId === null : goalId === filters.goalId;
    })
    .map((goalId) => {
      const agg = main.goalAgg.get(goalId) ?? emptyEntityAgg();
      const prevAgg = prev.goalAgg.get(goalId) ?? emptyEntityAgg();
      const goal = goalId ? lookup.goalById.get(goalId) : undefined;
      const planned = Math.round(agg.planned);
      const plannedElapsed = Math.round(agg.plannedElapsed);
      const actual = Math.round(agg.actual);
      return {
        goalId,
        goalName: goalId === null ? UNASSIGNED_LABEL : goal?.title || 'Untitled goal',
        goalStatus: goal?.status ?? null,
        plannedMinutes: planned,
        plannedElapsedMinutes: plannedElapsed,
        actualMinutes: actual,
        varianceMinutes: actual - planned,
        executionRatio: safeRatio(actual, planned),
        shareOfActual: safeRatio(actual, totalActual),
        plannedTasks: agg.plannedTasks,
        completedPlannedTasks: agg.completedPlannedTasks,
        completedTasksInPeriod: agg.completedTasksInPeriod,
        activeProjects: agg.activeProjectIds.size,
        previousActualMinutes: Math.round(prevAgg.actual),
        trendMinutes: actual - Math.round(prevAgg.actual),
        status: entityStatus(planned, plannedElapsed, actual),
      };
    })
    .filter((row) => {
      // Drop empty Unassigned rows; keep real goals even when idle.
      if (row.goalId === null) {
        return row.actualMinutes > 0 || row.plannedMinutes > 0;
      }
      return true;
    })
    .sort((a, b) => {
      if ((a.goalId === null) !== (b.goalId === null)) return a.goalId === null ? 1 : -1;
      return (
        Math.max(b.plannedMinutes, b.actualMinutes) - Math.max(a.plannedMinutes, a.actualMinutes)
      );
    });

  // ----- Project rows ------------------------------------------------------
  const lastActivity = buildLastActivityMap(scopedInput, lookup);
  const openStatuses = new Set(['pending', 'in_progress', 'todo', 'blocked']);
  const openTasksByProject = new Map<string, number>();
  for (const task of scopedInput.tasks) {
    if (task.deleted || !task.projectId || !openStatuses.has(task.status)) continue;
    openTasksByProject.set(task.projectId, (openTasksByProject.get(task.projectId) || 0) + 1);
  }
  const carryOverByProject = new Map<string, number>();
  for (const item of main.carryOver) {
    if (item.projectId) {
      carryOverByProject.set(item.projectId, (carryOverByProject.get(item.projectId) || 0) + 1);
    }
  }

  const projectIds = new Set<string>(Array.from(main.projectAgg.keys()));
  for (const project of scopedInput.projects) {
    if (project.status === 'active') projectIds.add(project.id);
  }
  const projects: ProjectPerformance[] = Array.from(projectIds)
    .map((projectId) => {
      const project = lookup.projectById.get(projectId);
      const goalId = project?.goalId && lookup.goalById.has(project.goalId) ? project.goalId : null;
      return { projectId, project, goalId };
    })
    .filter(({ projectId, goalId }) => {
      if (filters.projectId && projectId !== filters.projectId) return false;
      if (filters.goalId && filters.goalId !== UNASSIGNED_ID && goalId !== filters.goalId)
        return false;
      if (filters.goalId === UNASSIGNED_ID && goalId !== null) return false;
      return true;
    })
    .map(({ projectId, project, goalId }) => {
      const agg = main.projectAgg.get(projectId) ?? emptyEntityAgg();
      const prevAgg = prev.projectAgg.get(projectId) ?? emptyEntityAgg();
      const planned = Math.round(agg.planned);
      const plannedElapsed = Math.round(agg.plannedElapsed);
      const actual = Math.round(agg.actual);
      const openTasks = openTasksByProject.get(projectId) || 0;
      const last = lastActivity.get(projectId) ?? null;
      return {
        projectId,
        projectName: project?.name || 'Untitled project',
        goalId,
        goalName: goalId ? lookup.goalById.get(goalId)?.title || 'Untitled goal' : UNASSIGNED_LABEL,
        projectStatus: project?.status ?? null,
        plannedMinutes: planned,
        plannedElapsedMinutes: plannedElapsed,
        actualMinutes: actual,
        varianceMinutes: actual - planned,
        executionRatio: safeRatio(actual, planned),
        completedTasksInPeriod: agg.completedTasksInPeriod,
        openTasks,
        carryOverTasks: carryOverByProject.get(projectId) || 0,
        lastActivityAt: last,
        previousActualMinutes: Math.round(prevAgg.actual),
        trendMinutes: actual - Math.round(prevAgg.actual),
        status: entityStatus(planned, plannedElapsed, actual, {
          openTasks,
          lastActivityAt: last,
          now,
        }),
      };
    })
    .sort((a, b) => b.actualMinutes - a.actualMinutes || b.plannedMinutes - a.plannedMinutes);

  const timeSeries = buildTimeSeries(main, period, now);
  const heatmap = buildHeatmap(main, period, lookup, now);

  const activity = main.activity.sort((a, b) => b.date.getTime() - a.date.getTime());
  const carryOver = main.carryOver.sort((a, b) => {
    const at = a.dueDate ? a.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
    const bt = b.dueDate ? b.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
    return at - bt;
  });

  const overview: PerformanceOverview = {
    period,
    summary,
    previousSummary,
    timeSeries,
    heatmap,
    goals,
    projects,
    insights: [],
    activity,
    carryOver,
    dataQuality: main.quality,
  };
  overview.insights = buildInsights(overview);
  return overview;
}

/** Convenience: resolve + compute in one call (used by the dashboard). */
export function computeForAnchor(
  input: PerformanceInput,
  anchor: Date,
  type: PerformancePeriod['type'],
  filters: PerformanceFilters = EMPTY_FILTERS,
  now: Date = new Date()
): PerformanceOverview {
  return computePerformanceOverview(input, resolvePeriod(anchor, type, now), filters, now);
}
