// src/lib/goalArchitect/summary.ts
// Pure derivation of summary metrics for a GoalArchitectureDraft.
//
// `calculateGoalArchitectureSummary` is the entry point. It accepts a draft
// plus the *current* issue list (computed by validation) and returns a fully
// formed `GoalArchitectureSummary`. It is split into small helpers so the
// validator and the future commit pipeline can reuse the same primitives.

import type {
  GoalArchitectIssue,
  GoalArchitectureDraft,
  GoalArchitectureSummary,
  KeyResultDraft,
  ProjectDraft,
  TaskDraft,
} from './types';

// ============================================================================
// COUNTS
// ============================================================================

export interface IssueSeverityCounts {
  info: number;
  warning: number;
  error: number;
}

export function countIssuesBySeverity(
  issues: ReadonlyArray<GoalArchitectIssue>,
): IssueSeverityCounts {
  const out: IssueSeverityCounts = { info: 0, warning: 0, error: 0 };
  for (const issue of issues) {
    if (issue.severity === 'error') out.error += 1;
    else if (issue.severity === 'warning') out.warning += 1;
    else out.info += 1;
  }
  return out;
}

// ============================================================================
// HOURS
// ============================================================================

function safeNumber(value: number | undefined): number {
  if (typeof value !== 'number') return 0;
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  return value;
}

export function calculateTotalProjectTargetHours(
  projects: ReadonlyArray<ProjectDraft>,
): number {
  let total = 0;
  for (const p of projects) total += safeNumber(p.targetHours);
  return total;
}

export function calculateTotalTaskEstimatedHours(
  tasks: ReadonlyArray<TaskDraft>,
): number {
  let total = 0;
  for (const t of tasks) total += safeNumber(t.estimatedHours);
  return total;
}

// ============================================================================
// ORPHANS
// ============================================================================

/**
 * A "structurally orphan" task is one whose declared parent project doesn't
 * exist in the draft. Tasks that intentionally live directly under the goal
 * (no `parentProjectId`) are NOT orphans here — that is enforced separately
 * by validation as a warning, not by this structural check.
 */
export function findOrphanTasks(
  draft: GoalArchitectureDraft,
): TaskDraft[] {
  const projectIds = new Set(draft.projects.map((p) => p.id));
  const out: TaskDraft[] = [];
  for (const task of draft.tasks) {
    if (task.parentProjectId && !projectIds.has(task.parentProjectId)) {
      out.push(task);
    }
  }
  return out;
}

export function findOrphanKeyResults(
  draft: GoalArchitectureDraft,
): KeyResultDraft[] {
  const goalId = draft.goal?.id ?? null;
  if (!goalId) return [...draft.keyResults];
  const out: KeyResultDraft[] = [];
  for (const kr of draft.keyResults) {
    if (kr.parentGoalId !== goalId) out.push(kr);
  }
  return out;
}

// ============================================================================
// AGGREGATE
// ============================================================================

export interface SummaryComputationOptions {
  issues?: ReadonlyArray<GoalArchitectIssue>;
}

/**
 * Build the summary derived state. `issues` defaults to `draft.issues` so
 * the function can be called both during validation (with the *new* issue
 * list, before mutating the draft) and after (to recompute idempotently).
 */
export function calculateGoalArchitectureSummary(
  draft: GoalArchitectureDraft,
  options: SummaryComputationOptions = {},
): GoalArchitectureSummary {
  const issues = options.issues ?? draft.issues;
  const severity = countIssuesBySeverity(issues);

  const orphanTasks = findOrphanTasks(draft);
  const orphanKeyResults = findOrphanKeyResults(draft);

  const totalProjectTargetHours = calculateTotalProjectTargetHours(
    draft.projects,
  );
  const totalTaskEstimatedHours = calculateTotalTaskEstimatedHours(draft.tasks);

  const goalCount = draft.goal ? 1 : 0;
  const isStructurallyValid =
    severity.error === 0 &&
    !!draft.goal &&
    orphanTasks.length === 0 &&
    orphanKeyResults.length === 0;

  const canCommit = isStructurallyValid;

  return {
    goalCount,
    projectCount: draft.projects.length,
    taskCount: draft.tasks.length,
    keyResultCount: draft.keyResults.length,
    totalGoalTargetHours:
      typeof draft.goal?.targetHours === 'number'
        ? safeNumber(draft.goal.targetHours)
        : undefined,
    totalProjectTargetHours,
    totalTaskEstimatedHours,
    orphanTaskCount: orphanTasks.length,
    orphanKeyResultCount: orphanKeyResults.length,
    errorCount: severity.error,
    warningCount: severity.warning,
    infoCount: severity.info,
    isStructurallyValid,
    canCommit,
  };
}
