// src/lib/weeklyPlanner/scoring.ts
// Realism score = "how likely is this plan to actually happen?"
// Pure function — no randomness, no time of day. The score is fully
// explainable through `notes`: each deduction adds one line so the UI can
// surface it. The math is intentionally simple — heavier weights belong
// in a future "calibration" pass driven by real outcomes (Prompt 5).

import type {
  DraftTimeBlock,
  GoalMappingCandidate,
  PlanConflict,
  PlanningConstraint,
  PlanRealismScore,
  PlanWarning,
  WeekDay,
} from './types';
import { allWeekDays, timeToMinutes } from './timeUtils';

export function scorePlanRealism(
  blocks: ReadonlyArray<DraftTimeBlock>,
  conflicts: ReadonlyArray<PlanConflict>,
  warnings: ReadonlyArray<PlanWarning>,
  constraints: PlanningConstraint,
  mappings: ReadonlyArray<GoalMappingCandidate>,
): PlanRealismScore {
  const notes: string[] = [];
  let score = 100;

  const totalPlannedMinutes = blocks.reduce(
    (acc, b) => acc + b.durationMinutes,
    0,
  );
  const dailyLoadMinutes = computeDailyLoad(blocks);

  // ----- Weekly overload -----
  let weeklyOverloadPenalty = 0;
  if (totalPlannedMinutes > constraints.maxWeeklyPlannedMinutes) {
    const excess = totalPlannedMinutes - constraints.maxWeeklyPlannedMinutes;
    weeklyOverloadPenalty = clampUp(Math.ceil(excess / 60) * 5, 30);
    score -= weeklyOverloadPenalty;
    notes.push(`Settimana sovraccarica (+${excess} min): −${weeklyOverloadPenalty}`);
  }

  // ----- Daily overload -----
  let dailyOverloadPenalty = 0;
  for (const day of allWeekDays()) {
    const m = dailyLoadMinutes[day];
    if (m > constraints.maxDailyPlannedMinutes) {
      const excess = m - constraints.maxDailyPlannedMinutes;
      dailyOverloadPenalty += clampUp(Math.ceil(excess / 60) * 3, 15);
    }
  }
  if (dailyOverloadPenalty > 0) {
    score -= dailyOverloadPenalty;
    notes.push(`Sovraccarico giornaliero: −${dailyOverloadPenalty}`);
  }

  // ----- Conflicts (deduped: weekly_overload already counted above) -----
  let conflictPenalty = 0;
  for (const c of conflicts) {
    if (c.type === 'weekly_overload' || c.type === 'daily_overload') continue;
    if (c.severity === 'error') conflictPenalty += 10;
    else if (c.severity === 'warning') conflictPenalty += 5;
    else conflictPenalty += 2;
  }
  if (conflictPenalty > 0) {
    score -= conflictPenalty;
    notes.push(`Conflitti: −${conflictPenalty}`);
  }

  // ----- Warnings -----
  const warningPenalty = warnings.length * 3;
  if (warningPenalty > 0) {
    score -= warningPenalty;
    notes.push(`Warning (${warnings.length}): −${warningPenalty}`);
  }

  // ----- Context switches (per day, beyond a healthy 4-transition limit) -----
  const contextSwitchPenalty = computeContextSwitchPenalty(blocks);
  if (contextSwitchPenalty > 0) {
    score -= contextSwitchPenalty;
    notes.push(`Troppi cambi di contesto: −${contextSwitchPenalty}`);
  }

  // ----- Recovery (back-to-back days with avg buffer < 15 min) -----
  const recoveryPenalty = computeRecoveryPenalty(blocks);
  if (recoveryPenalty > 0) {
    score -= recoveryPenalty;
    notes.push(`Recovery insufficiente: −${recoveryPenalty}`);
  }

  // ----- Goal coverage -----
  const goalCoverageScore = computeGoalCoverage(mappings);
  if (goalCoverageScore < 80 && mappings.length > 0) {
    const penalty = Math.round((80 - goalCoverageScore) / 10);
    score -= penalty;
    notes.push(`Goal coverage ${goalCoverageScore}%: −${penalty}`);
  }

  const overallScore = Math.max(0, Math.min(100, Math.round(score)));

  return {
    overallScore,
    totalPlannedMinutes,
    dailyLoadMinutes,
    weeklyOverloadPenalty,
    dailyOverloadPenalty,
    contextSwitchPenalty,
    conflictPenalty,
    recoveryPenalty,
    goalCoverageScore,
    notes,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function computeDailyLoad(
  blocks: ReadonlyArray<DraftTimeBlock>,
): Record<WeekDay, number> {
  const out: Record<WeekDay, number> = {
    0: 0,
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
  };
  for (const b of blocks) out[b.day] += b.durationMinutes;
  return out;
}

function computeContextSwitchPenalty(
  blocks: ReadonlyArray<DraftTimeBlock>,
): number {
  const byDay: Record<WeekDay, DraftTimeBlock[]> = {
    0: [],
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
  };
  for (const b of blocks) byDay[b.day].push(b);

  let penalty = 0;
  for (const day of allWeekDays()) {
    const sorted = [...byDay[day]].sort(
      (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
    );
    let switches = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].activityType !== sorted[i - 1].activityType) switches++;
    }
    if (switches > 4) penalty += (switches - 4) * 2;
  }
  return penalty;
}

function computeRecoveryPenalty(
  blocks: ReadonlyArray<DraftTimeBlock>,
): number {
  const byDay: Record<WeekDay, DraftTimeBlock[]> = {
    0: [],
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
  };
  for (const b of blocks) byDay[b.day].push(b);

  let penalty = 0;
  for (const day of allWeekDays()) {
    const sorted = [...byDay[day]].sort(
      (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
    );
    if (sorted.length < 2) continue;
    let totalGap = 0;
    let count = 0;
    for (let i = 1; i < sorted.length; i++) {
      const gap =
        timeToMinutes(sorted[i].startTime) -
        timeToMinutes(sorted[i - 1].endTime);
      totalGap += Math.max(0, gap);
      count++;
    }
    const avg = count > 0 ? totalGap / count : 0;
    if (avg < 15) penalty += 5;
  }
  return penalty;
}

function computeGoalCoverage(
  mappings: ReadonlyArray<GoalMappingCandidate>,
): number {
  if (mappings.length === 0) return 100;
  const ok = mappings.filter(
    (m) => m.status === 'mapped' || m.status === 'maintenance',
  ).length;
  return Math.round((ok / mappings.length) * 100);
}

function clampUp(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}
