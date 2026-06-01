// src/lib/goalArchitect/types.ts
// Goal Architect Intelligence — pure domain model.
//
// This module is intentionally free of React, persistence, AI calls, parser
// logic and DataProvider knowledge. It only defines the shape of a goal
// architecture *draft* (a tree of Goal → Projects → Tasks + Key Results
// + validation issues + confidence + summary) so that later prompts can:
//   • Prompt 2: NL → draft (parser/compiler)
//   • Prompt 3: review UI
//   • Prompt 4: safe commit pipeline
//   • Prompt 5: QA and documentation
//
// No `any`. No external types. No imports from this codebase — staying pure
// keeps the unit tests independent of the rest of the app.

// ============================================================================
// PRIMITIVES
// ============================================================================

/**
 * Priority levels for a draft entity. Mirrors the production `Priority` union
 * in `src/types/index.ts`, but redeclared locally to keep this module pure
 * (no cross-imports from the live domain).
 */
export type DraftPriority = 'critical' | 'high' | 'medium' | 'low';

export type DraftEntityKind = 'goal' | 'project' | 'task' | 'key_result';

/**
 * Lifecycle of a draft. Note: in this prompt nothing is ever transitioned to
 * `committed` — it exists only so future prompts have a stable union.
 */
export type GoalArchitectDraftStatus =
  | 'draft'
  | 'valid'
  | 'invalid'
  | 'committed';

export type GoalArchitectSeverity = 'info' | 'warning' | 'error';

/**
 * Closed union of issue codes. Adding a new code is a breaking change for
 * downstream code (UI badges, severity rules) — that is intentional.
 */
export type GoalArchitectIssueCode =
  | 'missing_goal'
  | 'missing_title'
  | 'missing_parent'
  | 'duplicate_title'
  | 'similar_title'
  | 'invalid_hours'
  | 'missing_hours'
  | 'hours_mismatch'
  | 'invalid_due_date'
  | 'invalid_priority'
  | 'too_few_key_results'
  | 'too_many_key_results'
  | 'orphan_task'
  | 'orphan_key_result'
  | 'unsupported_field'
  | 'inconsistent_structure';

// ============================================================================
// ISSUES
// ============================================================================

export interface GoalArchitectIssue {
  id: string;
  code: GoalArchitectIssueCode;
  severity: GoalArchitectSeverity;
  entityKind?: DraftEntityKind;
  entityId?: string;
  field?: string;
  message: string;
  suggestion?: string;
}

// ============================================================================
// CONFIDENCE
// ============================================================================

/**
 * Confidence about a single field of a draft entity. `value` is clamped by
 * convention to [0, 1]. Producers are expected to clamp before construction;
 * consumers may defensively re-clamp for display.
 */
export interface FieldConfidence {
  value: number;
  reason: string;
}

export interface DraftConfidence {
  overall: number;
  title?: FieldConfidence;
  hours?: FieldConfidence;
  dueDate?: FieldConfidence;
  priority?: FieldConfidence;
  hierarchy?: FieldConfidence;
}

// ============================================================================
// KEY RESULT UNITS
// ============================================================================

export type KeyResultUnit =
  | 'percent'
  | 'hours'
  | 'days'
  | 'sessions'
  | 'courses'
  | 'videos'
  | 'studies'
  | 'tasks'
  | 'books'
  | 'custom';

// ============================================================================
// DRAFT ENTITIES
// ============================================================================

export interface KeyResultDraft {
  id: string;
  title: string;
  description?: string;
  targetValue?: number;
  currentValue?: number;
  unit?: KeyResultUnit;
  /** Free-form unit string when `unit === 'custom'`. */
  customUnit?: string;
  parentGoalId: string;
  sourceText?: string;
  confidence?: DraftConfidence;
}

export interface TaskDraft {
  id: string;
  title: string;
  description?: string;
  estimatedHours?: number;
  /** ISO-8601 calendar date (`YYYY-MM-DD`) or full ISO datetime. */
  dueDateISO?: string;
  priority?: DraftPriority;
  parentGoalId: string;
  /** Optional — a task may live directly under the goal. */
  parentProjectId?: string;
  sourceText?: string;
  confidence?: DraftConfidence;
}

export interface ProjectDraft {
  id: string;
  title: string;
  description?: string;
  targetHours?: number;
  dueDateISO?: string;
  priority?: DraftPriority;
  parentGoalId: string;
  taskIds: string[];
  sourceText?: string;
  confidence?: DraftConfidence;
}

export interface GoalDraft {
  id: string;
  title: string;
  description?: string;
  targetHours?: number;
  dueDateISO?: string;
  priority?: DraftPriority;
  projectIds: string[];
  /** Tasks attached straight to the goal (no project parent). */
  directTaskIds: string[];
  keyResultIds: string[];
  sourceText?: string;
  confidence?: DraftConfidence;
}

// ============================================================================
// SUMMARY
// ============================================================================

export interface GoalArchitectureSummary {
  goalCount: number;
  projectCount: number;
  taskCount: number;
  keyResultCount: number;
  /** Pulled from the goal draft when present, otherwise undefined. */
  totalGoalTargetHours?: number;
  totalProjectTargetHours: number;
  totalTaskEstimatedHours: number;
  orphanTaskCount: number;
  orphanKeyResultCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  isStructurallyValid: boolean;
  canCommit: boolean;
}

// ============================================================================
// DRAFT ROOT
// ============================================================================

export interface GoalArchitectureDraft {
  id: string;
  /** Bump on every breaking structural change of this module. */
  version: number;
  status: GoalArchitectDraftStatus;
  createdAtISO: string;
  updatedAtISO: string;
  sourceText?: string;
  goal: GoalDraft | null;
  projects: ProjectDraft[];
  tasks: TaskDraft[];
  keyResults: KeyResultDraft[];
  issues: GoalArchitectIssue[];
  summary: GoalArchitectureSummary;
  confidence: DraftConfidence;
}

// ============================================================================
// VALIDATION RESULT
// ============================================================================

export interface GoalArchitectureValidationResult {
  status: GoalArchitectDraftStatus;
  canCommit: boolean;
  issues: GoalArchitectIssue[];
  summary: GoalArchitectureSummary;
}

// ============================================================================
// VERSIONING
// ============================================================================

/**
 * Current schema version. Stored on every draft so persisted drafts (in
 * later prompts) can be migrated safely.
 */
export const GOAL_ARCHITECT_DRAFT_VERSION = 1;

// ============================================================================
// TYPE GUARDS
// ============================================================================

const KEY_RESULT_UNITS: ReadonlySet<KeyResultUnit> = new Set<KeyResultUnit>([
  'percent',
  'hours',
  'days',
  'sessions',
  'courses',
  'videos',
  'studies',
  'tasks',
  'books',
  'custom',
]);

export function isKeyResultUnit(value: unknown): value is KeyResultUnit {
  return typeof value === 'string' && KEY_RESULT_UNITS.has(value as KeyResultUnit);
}

const DRAFT_PRIORITIES: ReadonlySet<DraftPriority> = new Set<DraftPriority>([
  'critical',
  'high',
  'medium',
  'low',
]);

export function isDraftPriority(value: unknown): value is DraftPriority {
  return typeof value === 'string' && DRAFT_PRIORITIES.has(value as DraftPriority);
}

const ENTITY_KINDS: ReadonlySet<DraftEntityKind> = new Set<DraftEntityKind>([
  'goal',
  'project',
  'task',
  'key_result',
]);

export function isDraftEntityKind(value: unknown): value is DraftEntityKind {
  return typeof value === 'string' && ENTITY_KINDS.has(value as DraftEntityKind);
}
