// src/lib/weeklyPlanner/conflicts.ts
// Pure detector. Takes the (already-placed) draft blocks plus the original
// intents and surfaces every issue worth showing to the user.
//
// Severity convention:
//   error   → block must be fixed (overlap, invalid time, missing duration)
//   warning → suggested fix but commit is technically possible (overload,
//             outside_constraints, weekly_overload, routine_collision)
//   info    → soft hint (used by the scorer; the detector emits warnings)

import type {
  DraftTimeBlock,
  ParsedIntent,
  PlanConflict,
  PlanningConstraint,
  PlanWarning,
  WeekDay,
} from './types';
import {
  allWeekDays,
  createStableId,
  emptyDailyRecord,
  timeToMinutes,
  weekdayName,
} from './timeUtils';

export interface ConflictDetectionResult {
  conflicts: PlanConflict[];
  warnings: PlanWarning[];
}

// ============================================================================
// PUBLIC API
// ============================================================================

export function detectConflicts(
  blocks: ReadonlyArray<DraftTimeBlock>,
  intents: ReadonlyArray<ParsedIntent>,
  constraints: PlanningConstraint,
): ConflictDetectionResult {
  const conflicts: PlanConflict[] = [];
  const warnings: PlanWarning[] = [];

  const byDay = groupByDay(blocks);

  detectOverlaps(byDay, conflicts);
  detectDailyOverload(byDay, constraints, conflicts);
  detectWeeklyOverload(blocks, constraints, conflicts);
  detectInvalidTimes(blocks, conflicts);
  detectMissingDurations(blocks, conflicts);
  detectOutsideConstraints(blocks, constraints, conflicts);
  detectTooManyHighEnergyBlocks(byDay, constraints, warnings);
  detectMissingGoals(blocks, warnings);
  detectUnscheduledIntents(blocks, intents, warnings);

  return { conflicts, warnings };
}

// ============================================================================
// DETECTORS
// ============================================================================

function detectOverlaps(
  byDay: Record<WeekDay, DraftTimeBlock[]>,
  out: PlanConflict[],
): void {
  for (const day of allWeekDays()) {
    const sorted = sortByStart(byDay[day]);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        const aS = timeToMinutes(a.startTime);
        const aE = timeToMinutes(a.endTime);
        const bS = timeToMinutes(b.startTime);
        const bE = timeToMinutes(b.endTime);
        // Once b starts after a ends, no further j can overlap (sorted).
        if (bS >= aE) break;
        if (Math.max(aS, bS) < Math.min(aE, bE)) {
          const isRoutineCollision = a.isRoutine && b.isRoutine;
          out.push({
            id: createStableId(
              'conflict',
              `overlap:${a.id}:${b.id}`,
              0,
            ),
            type: isRoutineCollision ? 'routine_collision' : 'overlap',
            severity: 'error',
            message: `Conflitto: '${a.label}' e '${b.label}' si sovrappongono ${weekdayName(day)}.`,
            blockIds: [a.id, b.id],
            intentIds: uniq([a.intentId, b.intentId]),
          });
        }
      }
    }
  }
}

function detectDailyOverload(
  byDay: Record<WeekDay, DraftTimeBlock[]>,
  constraints: PlanningConstraint,
  out: PlanConflict[],
): void {
  for (const day of allWeekDays()) {
    const total = byDay[day].reduce((acc, b) => acc + b.durationMinutes, 0);
    if (total > constraints.maxDailyPlannedMinutes) {
      out.push({
        id: createStableId('conflict', `daily_overload:${day}`, 0),
        type: 'daily_overload',
        severity: 'warning',
        message: `${capitalize(weekdayName(day))} è sovraccarico: ${total} minuti pianificati su ${constraints.maxDailyPlannedMinutes} disponibili.`,
        blockIds: byDay[day].map((b) => b.id),
        intentIds: uniq(byDay[day].map((b) => b.intentId)),
      });
    }
  }
}

function detectWeeklyOverload(
  blocks: ReadonlyArray<DraftTimeBlock>,
  constraints: PlanningConstraint,
  out: PlanConflict[],
): void {
  const total = blocks.reduce((acc, b) => acc + b.durationMinutes, 0);
  if (total > constraints.maxWeeklyPlannedMinutes) {
    out.push({
      id: createStableId('conflict', 'weekly_overload', 0),
      type: 'weekly_overload',
      severity: 'warning',
      message: `Settimana sovraccarica: ${total} minuti pianificati su ${constraints.maxWeeklyPlannedMinutes} disponibili.`,
      blockIds: blocks.map((b) => b.id),
      intentIds: uniq(blocks.map((b) => b.intentId)),
    });
  }
}

function detectInvalidTimes(
  blocks: ReadonlyArray<DraftTimeBlock>,
  out: PlanConflict[],
): void {
  for (const b of blocks) {
    const s = timeToMinutes(b.startTime);
    const e = timeToMinutes(b.endTime);
    if (e <= s) {
      out.push({
        id: createStableId('conflict', `invalid_time:${b.id}`, 0),
        type: 'invalid_time',
        severity: 'error',
        message: `Orario non valido per '${b.label}' (${b.startTime}–${b.endTime}).`,
        blockIds: [b.id],
        intentIds: [b.intentId],
      });
    }
  }
}

function detectMissingDurations(
  blocks: ReadonlyArray<DraftTimeBlock>,
  out: PlanConflict[],
): void {
  for (const b of blocks) {
    if (b.durationMinutes <= 0) {
      out.push({
        id: createStableId('conflict', `missing_duration:${b.id}`, 0),
        type: 'missing_duration',
        severity: 'error',
        message: `Durata non valida per '${b.label}'.`,
        blockIds: [b.id],
        intentIds: [b.intentId],
      });
    }
  }
}

function detectOutsideConstraints(
  blocks: ReadonlyArray<DraftTimeBlock>,
  constraints: PlanningConstraint,
  out: PlanConflict[],
): void {
  const earliest = timeToMinutes(constraints.earliestHour);
  const latest = timeToMinutes(constraints.latestHour);
  for (const b of blocks) {
    const s = timeToMinutes(b.startTime);
    const e = timeToMinutes(b.endTime);
    if (s < earliest || e > latest) {
      out.push({
        id: createStableId('conflict', `outside:${b.id}`, 0),
        type: 'outside_constraints',
        severity: 'warning',
        message: `'${b.label}' (${b.startTime}–${b.endTime}) è fuori dalle ore lavorative ${constraints.earliestHour}–${constraints.latestHour}.`,
        blockIds: [b.id],
        intentIds: [b.intentId],
      });
    }
  }
}

function detectTooManyHighEnergyBlocks(
  byDay: Record<WeekDay, DraftTimeBlock[]>,
  constraints: PlanningConstraint,
  out: PlanWarning[],
): void {
  const limit = constraints.maxConsecutiveHighEnergyBlocks;
  if (limit <= 0) return;
  for (const day of allWeekDays()) {
    const sorted = sortByStart(byDay[day]);
    let streak: DraftTimeBlock[] = [];
    for (const b of sorted) {
      if (b.energyLevel === 'high') {
        streak.push(b);
        if (streak.length > limit) {
          out.push({
            id: createStableId(
              'warning',
              `high_energy:${day}:${streak[0].id}`,
              streak.length,
            ),
            type: 'too_many_high_energy_blocks',
            message: `Troppi blocchi ad alta energia consecutivi ${weekdayName(day)} (${streak.length} di seguito).`,
            blockIds: streak.map((x) => x.id),
            intentIds: uniq(streak.map((x) => x.intentId)),
          });
          // Reset to avoid double-counting the same streak chain.
          streak = [];
        }
      } else {
        streak = [];
      }
    }
  }
}

function detectMissingGoals(
  blocks: ReadonlyArray<DraftTimeBlock>,
  out: PlanWarning[],
): void {
  for (const b of blocks) {
    if (b.activityType === 'routine' || b.activityType === 'maintenance') {
      continue;
    }
    const status = b.mapping?.status;
    if (!b.mapping || status === 'unmapped') {
      out.push({
        id: createStableId('warning', `missing_goal:${b.id}`, 0),
        type: 'missing_goal',
        message: `L'attività '${b.label}' non è collegata a nessun Goal/Project/Task.`,
        blockIds: [b.id],
        intentIds: [b.intentId],
      });
    }
  }
}

function detectUnscheduledIntents(
  blocks: ReadonlyArray<DraftTimeBlock>,
  intents: ReadonlyArray<ParsedIntent>,
  out: PlanWarning[],
): void {
  const scheduled = new Set(blocks.map((b) => b.intentId));
  for (const intent of intents) {
    if (!scheduled.has(intent.id)) {
      out.push({
        id: createStableId('warning', `unscheduled:${intent.id}`, 0),
        type: 'unscheduled_intent',
        message: `Intenzione '${intent.label}' non programmabile entro i vincoli.`,
        blockIds: [],
        intentIds: [intent.id],
      });
    }
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function groupByDay(
  blocks: ReadonlyArray<DraftTimeBlock>,
): Record<WeekDay, DraftTimeBlock[]> {
  const out: Record<WeekDay, DraftTimeBlock[]> = {
    0: [],
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
  };
  void emptyDailyRecord; // silence unused import in environments without TS prune
  for (const b of blocks) out[b.day].push(b);
  return out;
}

function sortByStart(blocks: ReadonlyArray<DraftTimeBlock>): DraftTimeBlock[] {
  return [...blocks].sort(
    (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
  );
}

function uniq(xs: ReadonlyArray<string>): string[] {
  return Array.from(new Set(xs));
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
