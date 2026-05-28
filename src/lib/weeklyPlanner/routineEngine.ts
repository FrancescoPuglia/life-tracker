// src/lib/weeklyPlanner/routineEngine.ts
// Expands ParsedIntent[] (recurrence + days + duration hints) into a flat
// list of DraftTimeBlock[] with provisional start/end times. Conflict
// resolution and overlap detection are handled downstream by the
// scheduler and the conflict detector.

import type {
  ActivityType,
  DraftTimeBlock,
  GoalMappingCandidate,
  ParsedIntent,
  PlanningConstraint,
  Recurrence,
  SchedulingPreference,
  TimeWindow,
  WeekDay,
} from './types';
import { computeEndTime, createStableId } from './timeUtils';

// ============================================================================
// PUBLIC API
// ============================================================================

export function expandRoutineIntents(
  intents: ReadonlyArray<ParsedIntent>,
  mappings: ReadonlyArray<GoalMappingCandidate>,
  _constraints: PlanningConstraint,
  preferences: SchedulingPreference,
): DraftTimeBlock[] {
  const mappingByIntent = indexMappingsByIntent(mappings);
  const blocks: DraftTimeBlock[] = [];

  for (const intent of intents) {
    const days = resolveDays(intent);
    if (days.length === 0) continue;

    const duration =
      intent.durationMinutes ?? defaultDuration(intent.activityType, preferences);
    const startTime = resolveStartTime(intent, preferences);
    const mapping = mappingByIntent.get(intent.id);

    for (let i = 0; i < days.length; i++) {
      blocks.push(buildBlock(intent, mapping, days[i], startTime, duration, i));
    }
  }

  return blocks;
}

// ============================================================================
// DAY RESOLUTION
// ============================================================================

function resolveDays(intent: ParsedIntent): WeekDay[] {
  // Explicit user days always win.
  if (intent.preferredDays.length > 0) return [...intent.preferredDays];

  switch (intent.recurrence) {
    case 'daily':
      return [0, 1, 2, 3, 4, 5, 6];
    case 'weekdays':
      return [0, 1, 2, 3, 4];
    case 'x_times_weekly':
      return distributeDays(intent.timesPerWeek ?? 0);
    case 'weekly':
    case 'once':
    case undefined:
    default:
      return [];
  }
}

/**
 * Distribution rules per spec:
 *   1 → Wed   |  2 → Tue, Fri    |  3 → Mon, Wed, Fri
 *   4 → Mon, Tue, Thu, Sat       |  5 → Mon–Fri
 *   6 → Mon–Sat                  |  7 → all
 * Anything ≥7 is capped at 7; anything ≤0 yields [].
 */
function distributeDays(times: number): WeekDay[] {
  const n = Math.max(0, Math.min(7, Math.floor(times)));
  switch (n) {
    case 0:
      return [];
    case 1:
      return [2];
    case 2:
      return [1, 4];
    case 3:
      return [0, 2, 4];
    case 4:
      return [0, 1, 3, 5];
    case 5:
      return [0, 1, 2, 3, 4];
    case 6:
      return [0, 1, 2, 3, 4, 5];
    case 7:
    default:
      return [0, 1, 2, 3, 4, 5, 6];
  }
}

// ============================================================================
// TIME RESOLUTION
// ============================================================================

function resolveStartTime(
  intent: ParsedIntent,
  prefs: SchedulingPreference,
): string {
  if (intent.preferredTime) return intent.preferredTime;

  // Wake-up routines: detect early and pin to 07:00 so they don't collide
  // with anything else (and so the "wake up at 7" example works without
  // requiring the user to add "alle 7" twice).
  if (
    intent.activityType === 'routine' &&
    // `svegli` covers svegli-a/-o/-arsi/-armi etc; `wake` covers English.
    /svegli|wake/i.test(intent.sourceText)
  ) {
    return '07:00';
  }

  // Activity-specific defaults take priority over the generic time-window
  // mapping so the example sentences in the spec hit the documented times.
  if (
    intent.activityType === 'reading' &&
    (intent.preferredTimeWindow === 'evening' ||
      prefs.preferredReadingWindow === 'evening')
  ) {
    return '21:00';
  }

  if (
    (intent.activityType === 'career' || intent.activityType === 'deep_work') &&
    (intent.preferredTimeWindow === 'morning' ||
      prefs.preferredDeepWorkWindow === 'morning')
  ) {
    return '09:00';
  }

  if (intent.preferredTimeWindow) {
    return timeForWindow(intent.preferredTimeWindow);
  }

  switch (intent.activityType) {
    case 'career':
    case 'deep_work':
      return timeForWindow(prefs.preferredDeepWorkWindow);
    case 'exercise':
      return timeForWindow(prefs.preferredExerciseWindow);
    case 'reading':
      return timeForWindow(prefs.preferredReadingWindow);
    case 'chess':
      return '15:00';
    case 'routine':
      return '07:30';
    case 'maintenance':
      return '12:00';
    case 'event':
    case 'task':
    case 'unknown':
    default:
      return '10:00';
  }
}

function timeForWindow(w: TimeWindow): string {
  switch (w) {
    case 'morning':
      return '09:00';
    case 'afternoon':
      return '15:00';
    case 'evening':
      return '20:30';
    case 'night':
      return '22:00';
  }
}

// ============================================================================
// DURATION RESOLUTION
// ============================================================================

function defaultDuration(
  t: ActivityType,
  prefs: SchedulingPreference,
): number {
  switch (t) {
    case 'routine':
      return prefs.defaultRoutineDurationMinutes;
    case 'exercise':
      return 75;
    case 'reading':
      return 30;
    case 'career':
    case 'deep_work':
      return 90;
    case 'chess':
      return 90;
    case 'maintenance':
      return 30;
    case 'task':
    case 'event':
    case 'unknown':
    default:
      return prefs.defaultTaskDurationMinutes;
  }
}

// ============================================================================
// BLOCK BUILDING
// ============================================================================

function buildBlock(
  intent: ParsedIntent,
  mapping: GoalMappingCandidate | undefined,
  day: WeekDay,
  startTime: string,
  durationMinutes: number,
  occurrenceIndex: number,
): DraftTimeBlock {
  const endTime = computeEndTime(startTime, durationMinutes);
  return {
    id: createStableId(
      'draftblock',
      `${intent.id}:${day}:${startTime}`,
      occurrenceIndex,
    ),
    intentId: intent.id,
    label: intent.label,
    day,
    startTime,
    endTime,
    durationMinutes,
    activityType: intent.activityType,
    energyLevel: intent.energyLevel,
    flexibility: intent.flexibility,
    mapping,
    confidence: mapping?.confidence ?? intent.confidence,
    sourceText: intent.sourceText,
    isRoutine:
      intent.recurrence === 'daily' ||
      intent.recurrence === 'weekdays' ||
      intent.recurrence === 'x_times_weekly',
  };
}

function indexMappingsByIntent(
  mappings: ReadonlyArray<GoalMappingCandidate>,
): Map<string, GoalMappingCandidate> {
  const map = new Map<string, GoalMappingCandidate>();
  for (const m of mappings) map.set(m.intentId, m);
  return map;
}
