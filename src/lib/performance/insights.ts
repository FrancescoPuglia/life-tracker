// src/lib/performance/insights.ts
//
// Deterministic insight engine for the Performance Review section.
// Every rule is a pure function of the computed overview: no randomness,
// no language model, no moralizing. Each rule documents its condition and
// threshold; insights link back to the data that produced them via
// `link` (goal / project / day filters).

import { formatMinutes, formatPercent, formatPointsDelta } from './format';
import type {
  GoalPerformance,
  PerformanceInsight,
  PerformanceOverview,
  ProjectPerformance,
} from './types';

// ---------------------------------------------------------------- thresholds
/** Minimum negative goal variance (minutes) to call out under-investment. */
export const GOAL_UNDER_PLAN_MIN = 60;
/** Minimum positive goal variance (minutes) to call out over-investment. */
export const GOAL_OVER_PLAN_MIN = 90;
/** Minimum share of unplanned time worth flagging. */
export const UNPLANNED_WARN_SHARE = 0.4;
export const UNPLANNED_INFO_SHARE = 0.25;
/** Minimum actual minutes before share-based rules apply. */
const MIN_ACTUAL_FOR_SHARES = 120;
/** A day with planned ≥ this and zero execution is a missed plan. */
export const DAY_PLAN_MISSED_MIN = 120;
/** Day overload: actual ≥ 1.5 × plan and at least this much over. */
export const DAY_OVERLOAD_EXTRA_MIN = 120;
/** Coverage below this is a data-quality warning. */
export const LOW_COVERAGE_THRESHOLD = 0.5;
/** Top-goal concentration share. */
export const CONCENTRATION_SHARE = 0.6;
/** Minimum trend improvement (minutes) for the "most improved" rule. */
export const IMPROVED_GOAL_MIN = 120;
/** Fulfillment delta (rate points as 0..1) to call a change. */
export const FULFILLMENT_DELTA = 0.1;
/** Consistency delta (active-day rate points as 0..1) to call a change. */
export const CONSISTENCY_DELTA = 0.2;
/** How many insights the engine returns; the panel opens with the top few
 *  and reveals the rest behind "Show more". */
export const MAX_INSIGHTS = 8;

function realGoals(overview: PerformanceOverview): GoalPerformance[] {
  return overview.goals.filter((g) => g.goalId !== null);
}

export function buildInsights(overview: PerformanceOverview): PerformanceInsight[] {
  const out: PerformanceInsight[] = [];
  const { summary, previousSummary, dataQuality } = overview;
  const elapsedDays = summary.elapsedDays;

  // ---- goal-under-plan: largest negative variance -------------------------
  const under = realGoals(overview)
    .filter((g) => g.plannedMinutes > 0 && g.varianceMinutes <= -GOAL_UNDER_PLAN_MIN)
    .sort((a, b) => a.varianceMinutes - b.varianceMinutes)[0];
  if (under) {
    out.push({
      id: `goal-under-plan:${under.goalId}`,
      rule: 'goal-under-plan',
      kind: 'warning',
      priority: 80,
      title: `${under.goalName} received ${formatMinutes(Math.abs(under.varianceMinutes))} less than planned`,
      description: `Planned ${formatMinutes(under.plannedMinutes)}, executed ${formatMinutes(
        under.actualMinutes
      )} (${formatPercent(under.executionRatio)} of plan).`,
      link: { goalId: under.goalId as string },
    });
  }

  // ---- goal-idle: active goal with plan/history but zero execution --------
  if (elapsedDays >= 2) {
    const idle = realGoals(overview)
      .filter(
        (g) =>
          g.goalStatus === 'active' &&
          g.actualMinutes === 0 &&
          (g.plannedMinutes > 0 || g.previousActualMinutes > 0)
      )
      .sort((a, b) => b.plannedMinutes - a.plannedMinutes)[0];
    if (idle) {
      out.push({
        id: `goal-idle:${idle.goalId}`,
        rule: 'goal-idle',
        kind: 'warning',
        priority: 75,
        title: `${idle.goalName} has no tracked activity this period`,
        description:
          idle.plannedMinutes > 0
            ? `${formatMinutes(idle.plannedMinutes)} were planned but nothing was executed in ${elapsedDays} elapsed day${elapsedDays === 1 ? '' : 's'}.`
            : `It had ${formatMinutes(idle.previousActualMinutes)} in the previous period, zero so far in this one.`,
        link: { goalId: idle.goalId as string },
      });
    }
  }

  // ---- day-plan-missed: planned day with zero execution --------------------
  const missedDay = overview.timeSeries
    .filter(
      (p) =>
        !p.isFuture &&
        !p.isToday &&
        p.plannedMinutes >= DAY_PLAN_MISSED_MIN &&
        p.actualMinutes === 0
    )
    .sort((a, b) => b.plannedMinutes - a.plannedMinutes)[0];
  if (missedDay && overview.period.type !== 'year') {
    out.push({
      id: `day-plan-missed:${missedDay.key}`,
      rule: 'day-plan-missed',
      kind: 'warning',
      priority: 72,
      title: `${missedDay.start.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })} had a ${formatMinutes(missedDay.plannedMinutes)} plan and no execution`,
      description: 'The largest fully-missed day of the period.',
      link: { dayKey: missedDay.key },
    });
  }

  // ---- unplanned-heavy ------------------------------------------------------
  if (summary.actualMinutes >= MIN_ACTUAL_FOR_SHARES) {
    const share = summary.unplannedMinutes / summary.actualMinutes;
    if (share >= UNPLANNED_INFO_SHARE) {
      const warn = share >= UNPLANNED_WARN_SHARE;
      out.push({
        id: 'unplanned-heavy',
        rule: 'unplanned-heavy',
        kind: warn ? 'warning' : 'information',
        priority: warn ? 70 : 50,
        title: `${formatPercent(share)} of executed time was not planned in advance`,
        description: `${formatMinutes(summary.unplannedMinutes)} of ${formatMinutes(
          summary.actualMinutes
        )} came from retro-logged blocks or ad-hoc sessions.`,
      });
    }
  }

  // ---- low coverage ---------------------------------------------------------
  if (
    dataQuality.coverageRate !== null &&
    summary.actualMinutes >= 60 &&
    dataQuality.coverageRate < 0.8
  ) {
    const low = dataQuality.coverageRate < LOW_COVERAGE_THRESHOLD;
    out.push({
      id: 'low-coverage',
      rule: 'low-coverage',
      kind: 'data-quality',
      priority: low ? 68 : 48,
      title: `Only ${formatPercent(dataQuality.coverageRate)} of executed time has measured timestamps`,
      description: `${formatMinutes(
        dataQuality.assumedMinutes
      )} fall back to the planned window of completed blocks — treat exact durations with care.`,
    });
  }

  // ---- project-inactive ------------------------------------------------------
  const inactive = overview.projects.filter((p) => p.status === 'inactive');
  if (inactive.length > 0) {
    const first = inactive[0];
    out.push({
      id: `project-inactive:${first.projectId}`,
      rule: 'project-inactive',
      kind: 'warning',
      priority: 65,
      title:
        inactive.length === 1
          ? `${first.projectName} has open tasks but no activity for 14+ days`
          : `${inactive.length} projects have open tasks but no activity for 14+ days`,
      description:
        inactive.length === 1
          ? `${first.openTasks} open task${first.openTasks === 1 ? '' : 's'} and no tracked execution since ${
              first.lastActivityAt
                ? first.lastActivityAt.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })
                : 'ever'
            }.`
          : inactive
              .slice(0, 3)
              .map((p) => p.projectName)
              .join(', ') + (inactive.length > 3 ? ', …' : '.'),
      link: first.projectId ? { projectId: first.projectId } : undefined,
    });
  }

  // ---- carry-over volume -----------------------------------------------------
  if (!overview.period.isPartial && summary.plannedTasks >= 3) {
    const unfulfilled = summary.plannedTasks - summary.completedPlannedTasks;
    const share = unfulfilled / summary.plannedTasks;
    if (unfulfilled >= 3 && share >= 0.4) {
      out.push({
        id: 'carry-over-high',
        rule: 'carry-over-high',
        kind: 'warning',
        priority: 62,
        title: `${unfulfilled} of ${summary.plannedTasks} planned tasks were not completed in this period`,
        description: 'See the carry-over list for what slipped and where it lives now.',
      });
    }
  }

  // ---- project-stalled: time in, nothing shipped -------------------------------
  const stalled: ProjectPerformance | undefined = overview.projects
    .filter(
      (p) =>
        p.actualMinutes >= MIN_ACTUAL_FOR_SHARES &&
        p.completedTasksInPeriod === 0 &&
        p.openTasks > 0
    )
    .sort((a, b) => b.actualMinutes - a.actualMinutes)[0];
  if (stalled) {
    out.push({
      id: `project-stalled:${stalled.projectId}`,
      rule: 'project-stalled',
      kind: 'information',
      priority: 60,
      title: `${stalled.projectName} absorbed ${formatMinutes(stalled.actualMinutes)} without completing a task`,
      description: `${stalled.openTasks} task${stalled.openTasks === 1 ? '' : 's'} still open — time may be going to unbounded work.`,
      link: stalled.projectId ? { projectId: stalled.projectId } : undefined,
    });
  }

  // ---- fulfillment trend --------------------------------------------------------
  if (
    summary.planFulfillmentRate !== null &&
    previousSummary.planFulfillmentRate !== null &&
    previousSummary.plannedTasks >= 3 &&
    summary.plannedTasks >= 3
  ) {
    const delta = summary.planFulfillmentRate - previousSummary.planFulfillmentRate;
    if (Math.abs(delta) >= FULFILLMENT_DELTA) {
      const up = delta > 0;
      out.push({
        id: 'fulfillment-trend',
        rule: 'fulfillment-trend',
        kind: up ? 'positive' : 'warning',
        priority: 58,
        title: `Planned-task completion ${up ? 'up' : 'down'} ${formatPointsDelta(delta).replace('+', '')} vs the previous period`,
        description: `${formatPercent(summary.planFulfillmentRate)} now vs ${formatPercent(
          previousSummary.planFulfillmentRate
        )} before (${summary.completedPlannedTasks}/${summary.plannedTasks} tasks).`,
      });
    }
  }

  // ---- most improved goal ---------------------------------------------------------
  const improved = realGoals(overview)
    .filter((g) => g.trendMinutes >= IMPROVED_GOAL_MIN)
    .sort((a, b) => b.trendMinutes - a.trendMinutes)[0];
  if (improved) {
    out.push({
      id: `goal-improved:${improved.goalId}`,
      rule: 'goal-improved',
      kind: 'positive',
      priority: 56,
      title: `${improved.goalName} gained ${formatMinutes(improved.trendMinutes)} vs the previous period`,
      description: `${formatMinutes(improved.actualMinutes)} this period vs ${formatMinutes(
        improved.previousActualMinutes
      )} in the comparable window.`,
      link: { goalId: improved.goalId as string },
    });
  }

  // ---- consistency trend ------------------------------------------------------------
  if (elapsedDays >= 3 && previousSummary.elapsedDays >= 3) {
    const nowRate = summary.activeDays / elapsedDays;
    const prevRate = previousSummary.activeDays / previousSummary.elapsedDays;
    const delta = nowRate - prevRate;
    if (Math.abs(delta) >= CONSISTENCY_DELTA) {
      const up = delta > 0;
      out.push({
        id: 'consistency-trend',
        rule: 'consistency-trend',
        kind: up ? 'positive' : 'warning',
        priority: 52,
        title: `Active days ${up ? 'improved' : 'dropped'}: ${summary.activeDays}/${elapsedDays} vs ${previousSummary.activeDays}/${previousSummary.elapsedDays}`,
        description: `${formatPercent(nowRate)} of elapsed days had execution, vs ${formatPercent(prevRate)} in the previous period.`,
      });
    }
  }

  // ---- day-overload --------------------------------------------------------------------
  const overload = overview.timeSeries
    .filter(
      (p) =>
        !p.isFuture &&
        p.plannedMinutes > 0 &&
        p.actualMinutes >= p.plannedMinutes * 1.5 &&
        p.varianceMinutes >= DAY_OVERLOAD_EXTRA_MIN
    )
    .sort((a, b) => b.varianceMinutes - a.varianceMinutes)[0];
  if (overload && overview.period.type !== 'year') {
    out.push({
      id: `day-overload:${overload.key}`,
      rule: 'day-overload',
      kind: 'information',
      priority: 45,
      title: `${overload.start.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })} ran ${formatMinutes(overload.varianceMinutes)} over its plan`,
      description:
        'Heavy over-execution can mean under-estimation or overload — check what displaced the rest of the plan.',
      link: { dayKey: overload.key },
    });
  }

  // ---- concentration ----------------------------------------------------------------------
  const withActual = realGoals(overview)
    .filter((g) => g.actualMinutes > 0)
    .sort((a, b) => b.actualMinutes - a.actualMinutes);
  const top = withActual[0];
  if (
    top &&
    withActual.length >= 2 &&
    top.shareOfActual !== null &&
    top.shareOfActual >= CONCENTRATION_SHARE
  ) {
    out.push({
      id: `concentration:${top.goalId}`,
      rule: 'concentration',
      kind: 'information',
      priority: 40,
      title: `${formatPercent(top.shareOfActual)} of executed time went to ${top.goalName}`,
      description: 'One goal dominated the period — verify the other goals are consciously paused.',
      link: { goalId: top.goalId as string },
    });
  }

  return out
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .slice(0, MAX_INSIGHTS);
}
