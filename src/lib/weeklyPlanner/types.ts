// src/lib/weeklyPlanner/types.ts
// Weekly Planning Intelligence — deterministic core types.
// Local-first, no React, no DB, no AI. All exported types must be strict
// (no `any`). Domain entity adapters (GoalLike/ProjectLike/TaskLike) are
// intentionally minimal so the core can be tested in isolation.

// ============================================================================
// PRIMITIVES
// ============================================================================

/**
 * 0=Monday, 1=Tuesday, … 6=Sunday. Keep the Monday-first convention used
 * by the existing TimeBlockPlanner week math (`TimeBlockPlanner.tsx:71`).
 */
export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ActivityType =
  | 'routine'
  | 'task'
  | 'event'
  | 'deep_work'
  | 'exercise'
  | 'reading'
  | 'career'
  | 'chess'
  | 'maintenance'
  | 'unknown';

export type EnergyLevel = 'low' | 'medium' | 'high';

export type Flexibility = 'fixed' | 'flexible';

export type MappingStatus =
  | 'mapped'
  | 'unmapped'
  | 'needs_review'
  | 'maintenance';

export type ConflictType =
  | 'overlap'
  | 'daily_overload'
  | 'weekly_overload'
  | 'missing_goal'
  | 'missing_duration'
  | 'invalid_time'
  | 'outside_constraints'
  | 'too_many_high_energy_blocks'
  | 'unscheduled_intent'
  | 'routine_collision';

export type ConflictSeverity = 'info' | 'warning' | 'error';

export type TimeWindow = 'morning' | 'afternoon' | 'evening' | 'night';

export type Recurrence =
  | 'once'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'x_times_weekly';

// ============================================================================
// INPUT
// ============================================================================

export interface WeeklyIntentRaw {
  id: string;
  text: string;
  weekStartISO: string;
  createdAtISO: string;
}

export interface ParsedIntent {
  id: string;
  label: string;
  sourceText: string;
  activityType: ActivityType;
  preferredDays: WeekDay[];
  preferredTime?: string;
  preferredTimeWindow?: TimeWindow;
  durationMinutes?: number;
  recurrence?: Recurrence;
  timesPerWeek?: number;
  priority: number;
  flexibility: Flexibility;
  energyLevel: EnergyLevel;
  confidence: number;
  notes?: string;
}

// ============================================================================
// DOMAIN ADAPTERS (intentionally tiny — keeps the engine decoupled)
// ============================================================================

export interface GoalLike {
  id: string;
  title: string;
  description?: string;
  priority?: number;
}

export interface ProjectLike {
  id: string;
  goalId?: string;
  title: string;
  description?: string;
  priority?: number;
}

export interface TaskLike {
  id: string;
  projectId?: string;
  goalId?: string;
  title: string;
  description?: string;
  estimatedMinutes?: number;
  priority?: number;
}

// ============================================================================
// MAPPING
// ============================================================================

export interface GoalMappingCandidate {
  intentId: string;
  status: MappingStatus;
  goalId?: string;
  projectId?: string;
  taskId?: string;
  confidence: number;
  reason: string;
  matchedKeywords: string[];
}

// ============================================================================
// CONSTRAINTS / PREFERENCES
// ============================================================================

export interface PlanningConstraint {
  earliestHour: string;
  latestHour: string;
  maxDailyPlannedMinutes: number;
  maxWeeklyPlannedMinutes: number;
  minBufferMinutes: number;
  maxConsecutiveHighEnergyBlocks: number;
}

export interface SchedulingPreference {
  preferredDeepWorkWindow: 'morning' | 'afternoon' | 'evening';
  preferredExerciseWindow: 'morning' | 'afternoon' | 'evening';
  preferredReadingWindow: 'morning' | 'afternoon' | 'evening';
  defaultTaskDurationMinutes: number;
  defaultRoutineDurationMinutes: number;
}

export const DEFAULT_PLANNING_CONSTRAINTS: PlanningConstraint = {
  earliestHour: '07:00',
  latestHour: '22:00',
  maxDailyPlannedMinutes: 600,
  maxWeeklyPlannedMinutes: 3000,
  minBufferMinutes: 15,
  maxConsecutiveHighEnergyBlocks: 2,
};

export const DEFAULT_SCHEDULING_PREFERENCES: SchedulingPreference = {
  preferredDeepWorkWindow: 'morning',
  preferredExerciseWindow: 'afternoon',
  preferredReadingWindow: 'evening',
  defaultTaskDurationMinutes: 60,
  defaultRoutineDurationMinutes: 30,
};

// ============================================================================
// ROUTINE & BLOCK
// ============================================================================

export interface RoutineRule {
  id: string;
  label: string;
  sourceIntentId: string;
  daysOfWeek: WeekDay[];
  startTime?: string;
  durationMinutes: number;
  flexibility: Flexibility;
  energyLevel: EnergyLevel;
}

export interface DraftTimeBlock {
  id: string;
  intentId: string;
  label: string;
  day: WeekDay;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  activityType: ActivityType;
  energyLevel: EnergyLevel;
  flexibility: Flexibility;
  mapping?: GoalMappingCandidate;
  confidence: number;
  sourceText: string;
  isRoutine: boolean;
}

// ============================================================================
// CONFLICTS / WARNINGS / SCORING
// ============================================================================

export interface PlanConflict {
  id: string;
  type: ConflictType;
  severity: ConflictSeverity;
  message: string;
  blockIds: string[];
  intentIds: string[];
}

export interface PlanWarning {
  id: string;
  type: ConflictType;
  message: string;
  blockIds: string[];
  intentIds: string[];
}

export interface PlanRealismScore {
  overallScore: number;
  totalPlannedMinutes: number;
  dailyLoadMinutes: Record<WeekDay, number>;
  weeklyOverloadPenalty: number;
  dailyOverloadPenalty: number;
  contextSwitchPenalty: number;
  conflictPenalty: number;
  recoveryPenalty: number;
  goalCoverageScore: number;
  notes: string[];
}

// ============================================================================
// FINAL DRAFT
// ============================================================================

export interface WeeklyPlanDraft {
  id: string;
  weekStartISO: string;
  sourceIntent: WeeklyIntentRaw;
  parsedIntents: ParsedIntent[];
  blocks: DraftTimeBlock[];
  conflicts: PlanConflict[];
  warnings: PlanWarning[];
  realismScore: PlanRealismScore;
  generatedAtISO: string;
  status: 'draft';
}

export interface WeeklyPlannerInput {
  raw: WeeklyIntentRaw;
  goals: GoalLike[];
  projects: ProjectLike[];
  tasks: TaskLike[];
  constraints?: Partial<PlanningConstraint>;
  preferences?: Partial<SchedulingPreference>;
}

export interface WeeklyPlannerResult {
  draft: WeeklyPlanDraft;
}

// ============================================================================
// CONSTRAINT / PREFERENCE MERGING (deterministic, exported for reuse + tests)
// ============================================================================

export function mergeConstraints(
  partial?: Partial<PlanningConstraint>,
): PlanningConstraint {
  return { ...DEFAULT_PLANNING_CONSTRAINTS, ...(partial ?? {}) };
}

export function mergePreferences(
  partial?: Partial<SchedulingPreference>,
): SchedulingPreference {
  return { ...DEFAULT_SCHEDULING_PREFERENCES, ...(partial ?? {}) };
}
