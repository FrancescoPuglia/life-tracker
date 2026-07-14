// src/lib/performance/types.ts
//
// Typed data contract for the Performance Review section (Plan vs Actual OS).
//
// ============================================================================
// METRIC GLOSSARY (single source of truth — keep in sync with docs/audit)
// ============================================================================
//
// All internal quantities are expressed in MINUTES (integers unless noted).
// Hours/percentages are formatting concerns of the UI layer only.
//
// PLANNED MINUTES
//   Sum of the planned window (startTime → endTime) of every valid TimeBlock
//   that was *scheduled in advance* (createdAt < startTime), clipped to the
//   selected period. Excluded: soft-deleted blocks, status 'cancelled',
//   type 'break' / 'buffer' (explicitly non-productive slack in the domain).
//   Blocks created at/after their own startTime are retro-logged execution,
//   NOT plan — counting them as plan would make Plan ≈ Actual by definition.
//
// ACTUAL MINUTES
//   Sum of executed time of blocks with status 'completed' or 'overrun'
//   (see `weeklyPlanner/analytics.isCompletedStatus`: an overrun block still
//   ran), measured on [actualStartTime||startTime, actualEndTime||endTime],
//   clipped to the period — PLUS completed Sessions that have NO timeBlockId.
//   Sessions linked to a TimeBlock are already absorbed by that block
//   (SessionManager writes actual times onto the block on stop), so they are
//   skipped to avoid double counting.
//
// UNPLANNED MINUTES (subset of Actual)
//   Actual minutes coming from retro-logged blocks (createdAt >= startTime)
//   plus orphan completed sessions. "Planned executed" is the complement.
//
// VARIANCE / EXECUTION RATIO
//   varianceMinutes = actualMinutes − plannedMinutes.
//   executionRatio  = actualMinutes / plannedMinutes, `null` when
//   plannedMinutes = 0 (never Infinity/NaN).
//
// PLANNED TASKS / PLAN FULFILLMENT
//   A task is "planned for the period" when its dueDate falls in the period
//   OR at least one advance-planned block in the period links to it.
//   It is "fulfilled" when completedAt < period.end and — if it had a due
//   date inside the period — completedAt <= end-of-day(dueDate).
//
// ON-TIME RATE
//   Among tasks *completed in the period that have a dueDate*:
//   completedAt <= end-of-day(dueDate). Tasks without dueDate are excluded
//   from the denominator.
//
// CARRY-OVER
//   Planned tasks not fulfilled by period end, split into the only
//   categories derivable from the data: still open / completed late /
//   cancelled. (Reschedules are not tracked by the schema — documented gap.)
//
// ACTIVE DAY
//   An elapsed day of the period with actualMinutes > 0 or ≥1 task
//   completed. elapsedDays counts days from period start through
//   min(today, period end).
//
// DATA COVERAGE
//   measuredMinutes  = actual minutes backed by real actualStart/actualEnd
//                      timestamps (or session durations).
//   assumedMinutes   = actual minutes where the planned window was used as
//                      a fallback for a completed block.
//   coverageRate     = measured / (measured + assumed), null when no actual.
//   Plus honesty counters: unclassified time, orphan sessions, open
//   sessions (excluded), blocks whose parent entities are missing, tasks
//   completed without any tracked time, estimated-but-unscheduled minutes.
//
// PERIOD COMPARISON
//   When the current period is partial, the previous period is compared on
//   the same elapsed calendar span (e.g. on the 14th of a month: first 14
//   days vs first 14 days), shifting `now` back by exactly one period using
//   calendar arithmetic (DST-safe), never raw milliseconds.
//
// ATTRIBUTION CHAIN (mirrors lib/hierarchicalRollup.ts)
//   TimeBlock → taskId → task.projectId → project.goalId, falling back to
//   block.projectId → project.goalId, then block.goalId. Time that cannot
//   be attributed to any goal is reported as "Unassigned", never dropped.
// ============================================================================

export type PerformancePeriodType = 'week' | 'month' | 'year';

/** Resolved period boundaries. `end` is EXCLUSIVE ([start, end)). */
export interface PerformancePeriod {
  type: PerformancePeriodType;
  /** Inclusive start (local time, midnight-aligned). */
  start: Date;
  /** Exclusive end (local time, midnight-aligned). */
  end: Date;
  /** True when `now` falls inside the period. */
  isCurrent: boolean;
  /** True when the period has not fully elapsed yet. */
  isPartial: boolean;
  /** Previous period boundaries (for trend comparison). */
  comparisonStart: Date;
  /**
   * Exclusive end of the comparison window. Equals the full previous period
   * when this period is complete; clipped to the same elapsed calendar span
   * when this period is partial.
   */
  comparisonEnd: Date;
}

export type EntityStatus = 'ahead' | 'on-track' | 'behind' | 'no-plan' | 'inactive' | 'no-data';

export interface PerformanceSummary {
  plannedMinutes: number;
  actualMinutes: number;
  varianceMinutes: number;
  /** actual / planned — null when plannedMinutes is 0. */
  executionRatio: number | null;
  /** Actual minutes from advance-planned blocks. */
  plannedExecutedMinutes: number;
  /** Actual minutes from retro-logged blocks + orphan sessions. */
  unplannedMinutes: number;
  /** Tasks due in the period or linked by planned blocks in the period. */
  plannedTasks: number;
  /** Planned tasks fulfilled (see glossary). */
  completedPlannedTasks: number;
  /** completedPlannedTasks / plannedTasks — null when no planned tasks. */
  planFulfillmentRate: number | null;
  /** Tasks whose completedAt falls inside the period (any origin). */
  completedTasksInPeriod: number;
  /** On-time completions / completed-with-dueDate — null when denominator 0. */
  onTimeRate: number | null;
  /** Elapsed days with any execution (actual > 0 or a task completed). */
  activeDays: number;
  /** Days elapsed so far (≤ totalDays). */
  elapsedDays: number;
  /** Total calendar days in the period. */
  totalDays: number;
}

export interface PerformanceDataQuality {
  /** Actual minutes backed by real timestamps (block actuals or sessions). */
  measuredMinutes: number;
  /** Actual minutes derived from the planned window fallback. */
  assumedMinutes: number;
  /** measured / (measured + assumed) — null when there is no actual time. */
  coverageRate: number | null;
  /** Actual minutes that could not be attributed to any goal. */
  unclassifiedMinutes: number;
  /** Completed sessions without a timeBlockId (counted as unplanned actual). */
  orphanSessionCount: number;
  orphanSessionMinutes: number;
  /** Sessions still active/paused — excluded from every total. */
  openSessionCount: number;
  /** Executed blocks with status 'overrun' (counted in actual). */
  overrunBlockCount: number;
  /** Blocks pointing to a task/project/goal that no longer exists. */
  blocksWithMissingParents: number;
  /** Tasks completed in the period with zero attributed actual minutes. */
  completedTasksWithoutTime: number;
  /** Σ estimatedMinutes of tasks due in the period with no linked block. */
  estimatedUnscheduledMinutes: number;
  /** Blocks whose raw duration exceeded 24h and was capped. */
  anomalousDurationCount: number;
  /** Planned/actual minutes excluded because of type break/buffer. */
  excludedBreakMinutes: number;
  /** Planned minutes lost to cancelled blocks (visible, not counted). */
  cancelledPlannedMinutes: number;
}

/** One bucket of the main time series (a day, or a month in year view). */
export interface PerformanceTimePoint {
  /** Stable key: 'YYYY-MM-DD' for days, 'YYYY-MM' for months. */
  key: string;
  /** Short axis label (e.g. 'Mon 14', 'Jan'). */
  label: string;
  start: Date;
  /** Exclusive. */
  end: Date;
  plannedMinutes: number;
  actualMinutes: number;
  unplannedMinutes: number;
  varianceMinutes: number;
  cumulativePlannedMinutes: number;
  cumulativeActualMinutes: number;
  tasksCompleted: number;
  isToday: boolean;
  isFuture: boolean;
}

/** One day cell of the consistency heatmap. */
export interface PerformanceHeatmapDay {
  key: string; // 'YYYY-MM-DD'
  date: Date;
  plannedMinutes: number;
  actualMinutes: number;
  /** actual / planned for the day — null when nothing was planned. */
  planRatio: number | null;
  tasksCompleted: number;
  /** Distinct goals with actual time on the day (names for the tooltip). */
  goalNames: string[];
  isToday: boolean;
  isFuture: boolean;
}

export interface GoalPerformance {
  /** null → "Unassigned" bucket (time not attributable to any goal). */
  goalId: string | null;
  goalName: string;
  goalStatus: string | null;
  plannedMinutes: number;
  actualMinutes: number;
  varianceMinutes: number;
  executionRatio: number | null;
  /** Share of the period's total actual minutes (0..1, null when total 0). */
  shareOfActual: number | null;
  plannedTasks: number;
  completedPlannedTasks: number;
  completedTasksInPeriod: number;
  /** Projects of this goal with any activity in the period. */
  activeProjects: number;
  /** Actual minutes in the aligned previous window. */
  previousActualMinutes: number;
  /** Δ actual vs previous window (minutes). */
  trendMinutes: number;
  status: EntityStatus;
}

export interface ProjectPerformance {
  /** null → block time attached to a goal directly (no project). */
  projectId: string | null;
  projectName: string;
  goalId: string | null;
  goalName: string;
  projectStatus: string | null;
  plannedMinutes: number;
  actualMinutes: number;
  varianceMinutes: number;
  executionRatio: number | null;
  completedTasksInPeriod: number;
  /** Current open tasks (pending / in_progress / todo / blocked). */
  openTasks: number;
  /** Planned-for-period tasks not fulfilled (carry-over). */
  carryOverTasks: number;
  /** Most recent execution timestamp across all time (not only period). */
  lastActivityAt: Date | null;
  previousActualMinutes: number;
  trendMinutes: number;
  status: EntityStatus;
}

export type InsightKind = 'positive' | 'warning' | 'information' | 'data-quality';

/** Filter payload an insight can apply when clicked. */
export interface PerformanceFilterLink {
  goalId?: string;
  projectId?: string;
  dayKey?: string;
}

export interface PerformanceInsight {
  id: string;
  rule: string;
  kind: InsightKind;
  /** Higher = more relevant; used for ranking, never displayed raw. */
  priority: number;
  title: string;
  description: string;
  link?: PerformanceFilterLink;
}

/** Row of the detailed activity table (drill-down / audit trail). */
export interface ActivityDetailRow {
  id: string;
  source: 'timeblock' | 'session';
  date: Date;
  dayKey: string;
  title: string;
  goalId: string | null;
  goalName: string;
  projectId: string | null;
  projectName: string;
  taskId: string | null;
  taskTitle: string | null;
  /** Planned minutes inside the period (0 for sessions / retro blocks). */
  plannedMinutes: number;
  /** Actual minutes inside the period. */
  actualMinutes: number;
  status: string;
  /** True when scheduled in advance (createdAt < startTime). */
  plannedInAdvance: boolean;
  /** 'measured' = real timestamps; 'assumed' = planned-window fallback. */
  timeSource: 'measured' | 'assumed' | 'none';
}

export interface CarryOverTask {
  taskId: string;
  taskTitle: string;
  projectId: string | null;
  projectName: string;
  goalId: string | null;
  goalName: string;
  dueDate: Date | null;
  outcome: 'open' | 'completed-late' | 'cancelled';
}

export interface PerformanceFilters {
  goalId: string | null;
  projectId: string | null;
  /** 'all' | 'planned' | 'unplanned' — narrows actual-time sources. */
  source: 'all' | 'planned' | 'unplanned';
}

export const EMPTY_FILTERS: PerformanceFilters = {
  goalId: null,
  projectId: null,
  source: 'all',
};

/** Everything the dashboard needs, computed in one pass. */
export interface PerformanceOverview {
  period: PerformancePeriod;
  summary: PerformanceSummary;
  /** Summary of the aligned previous window (same filters). */
  previousSummary: PerformanceSummary;
  timeSeries: PerformanceTimePoint[];
  heatmap: PerformanceHeatmapDay[];
  goals: GoalPerformance[];
  projects: ProjectPerformance[];
  insights: PerformanceInsight[];
  activity: ActivityDetailRow[];
  carryOver: CarryOverTask[];
  dataQuality: PerformanceDataQuality;
}
