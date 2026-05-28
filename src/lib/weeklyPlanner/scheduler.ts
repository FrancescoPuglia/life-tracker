// src/lib/weeklyPlanner/scheduler.ts
// Orchestrates the deterministic pipeline:
//   parse → map → expand → resolve overlaps → detect → score
// Produces a WeeklyPlanDraft. Never touches DataProvider, IDB, or Firebase.

import { detectConflicts } from './conflicts';
import { mapIntentsToGoals } from './goalMapper';
import { parseWeeklyIntent } from './parser';
import { expandRoutineIntents } from './routineEngine';
import { scorePlanRealism } from './scoring';
import {
  ActivityType,
  DraftTimeBlock,
  PlanningConstraint,
  WeekDay,
  WeeklyPlanDraft,
  WeeklyPlannerInput,
  WeeklyPlannerResult,
  mergeConstraints,
  mergePreferences,
} from './types';
import {
  PlacedSlot,
  allWeekDays,
  createStableId,
  findNextAvailableSlot,
  minutesToTime,
  timeToMinutes,
} from './timeUtils';

// ============================================================================
// PUBLIC API
// ============================================================================

export function generateWeeklyDraft(
  input: WeeklyPlannerInput,
): WeeklyPlannerResult {
  const constraints = mergeConstraints(input.constraints);
  const preferences = mergePreferences(input.preferences);

  const parsedIntents = parseWeeklyIntent(input.raw);
  const mappings = mapIntentsToGoals(
    parsedIntents,
    input.goals,
    input.projects,
    input.tasks,
  );
  const expanded = expandRoutineIntents(
    parsedIntents,
    mappings,
    constraints,
    preferences,
  );
  const resolved = resolveSchedule(expanded, constraints);

  const { conflicts, warnings } = detectConflicts(
    resolved,
    parsedIntents,
    constraints,
  );
  const realismScore = scorePlanRealism(
    resolved,
    conflicts,
    warnings,
    constraints,
    mappings,
  );

  const draft: WeeklyPlanDraft = {
    id: createStableId('draft', input.raw.id, 0),
    weekStartISO: input.raw.weekStartISO,
    sourceIntent: input.raw,
    parsedIntents,
    blocks: resolved,
    conflicts,
    warnings,
    realismScore,
    generatedAtISO: deriveGeneratedAtISO(input.raw.createdAtISO),
    status: 'draft',
  };

  return { draft };
}

// ============================================================================
// SCHEDULE RESOLUTION
// ============================================================================

/**
 * Greedy: fixed blocks first, then flexible by activity priority. Each
 * flexible block is slid forward by buffer increments until it fits in the
 * working-hours window. Anything that cannot fit is dropped — the conflict
 * detector turns it into an `unscheduled_intent` warning.
 */
function resolveSchedule(
  blocks: ReadonlyArray<DraftTimeBlock>,
  constraints: PlanningConstraint,
): DraftTimeBlock[] {
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

  const earliestMin = timeToMinutes(constraints.earliestHour);
  const latestMin = timeToMinutes(constraints.latestHour);
  const buffer = constraints.minBufferMinutes;

  const out: DraftTimeBlock[] = [];

  for (const day of allWeekDays()) {
    const queue = sortForPlacement(byDay[day]);
    const placed: PlacedSlot[] = [];
    const dayResult: DraftTimeBlock[] = [];

    for (const block of queue) {
      if (block.flexibility === 'fixed') {
        // Fixed blocks are placed as-is even if they overlap. The conflict
        // detector flags the collision so the user can decide what to drop.
        dayResult.push(block);
        placed.push({
          startMinutes: timeToMinutes(block.startTime),
          endMinutes: timeToMinutes(block.endTime),
        });
        continue;
      }

      const preferred = Math.max(timeToMinutes(block.startTime), earliestMin);
      const slot = findNextAvailableSlot(
        preferred,
        block.durationMinutes,
        placed,
        earliestMin,
        latestMin,
        buffer,
      );
      if (slot === null) {
        // Drop — will become an `unscheduled_intent` warning.
        continue;
      }
      const newStart = minutesToTime(slot);
      const newEnd = minutesToTime(slot + block.durationMinutes);
      dayResult.push({ ...block, startTime: newStart, endTime: newEnd });
      placed.push({
        startMinutes: slot,
        endMinutes: slot + block.durationMinutes,
      });
    }

    // Re-sort by start time for downstream consumers (UI + conflict checks).
    dayResult.sort(
      (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
    );
    out.push(...dayResult);
  }

  return out;
}

function sortForPlacement(
  blocks: ReadonlyArray<DraftTimeBlock>,
): DraftTimeBlock[] {
  return [...blocks].sort((a, b) => {
    // Fixed before flexible — a fixed block occupies its slot, others fit around.
    if (a.flexibility !== b.flexibility) {
      return a.flexibility === 'fixed' ? -1 : 1;
    }
    const pA = activityOrder(a.activityType);
    const pB = activityOrder(b.activityType);
    if (pA !== pB) return pA - pB;
    return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
  });
}

/**
 * Lower number = placed earlier. Routines win because they anchor the day
 * (wake-up at 07:00 must not be displaced by a flexible task).
 */
function activityOrder(t: ActivityType): number {
  switch (t) {
    case 'routine':
      return 0;
    case 'career':
    case 'deep_work':
      return 1;
    case 'chess':
      return 2;
    case 'exercise':
      return 3;
    case 'event':
    case 'task':
      return 4;
    case 'reading':
      return 5;
    case 'maintenance':
      return 6;
    case 'unknown':
    default:
      return 7;
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function deriveGeneratedAtISO(input: string): string {
  // Defensive: if the upstream `createdAtISO` is malformed, fall back to
  // a deterministic empty string rather than `new Date()` (which would
  // make the result non-deterministic and break tests).
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  return d.toISOString();
}
