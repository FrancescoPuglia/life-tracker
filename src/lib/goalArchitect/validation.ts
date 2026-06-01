// src/lib/goalArchitect/validation.ts
// Pure validation core for Goal Architect drafts.
//
// Contract:
//   • No exceptions for valid/invalid inputs — every problem is returned as
//     a `GoalArchitectIssue` so the UI can render it.
//   • Errors block commit. Warnings/info do not.
//   • Functions are pure: same draft → same issues → same summary.
//   • No I/O, no DB, no React.

import { createIssueId, normalizeForId } from './ids';
import {
  calculateGoalArchitectureSummary,
  calculateTotalProjectTargetHours,
  calculateTotalTaskEstimatedHours,
} from './summary';
import {
  isDraftPriority,
  type DraftPriority,
  type GoalArchitectIssue,
  type GoalArchitectIssueCode,
  type GoalArchitectSeverity,
  type GoalArchitectureDraft,
  type GoalArchitectureValidationResult,
  type GoalDraft,
  type KeyResultDraft,
  type ProjectDraft,
  type TaskDraft,
} from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

const MIN_KEY_RESULTS = 2;
const MAX_KEY_RESULTS = 5;
/** Absolute tolerance (in hours) for goal-vs-projects / project-vs-tasks. */
const HOURS_ABSOLUTE_TOLERANCE = 0.25;
/** Relative tolerance (fraction) when the target is non-trivial. */
const HOURS_RELATIVE_TOLERANCE = 0.05;
/** Levenshtein distance threshold (per ratio) for "similar" titles. */
const SIMILAR_TITLE_DISTANCE_RATIO = 0.2;
const SIMILAR_TITLE_MIN_LENGTH = 5;

// ============================================================================
// PUBLIC API
// ============================================================================

export function validateGoalArchitectureDraft(
  draft: GoalArchitectureDraft,
): GoalArchitectureValidationResult {
  const issues: GoalArchitectIssue[] = [];

  issues.push(...validateGoalDraft(draft.goal));

  if (draft.goal) {
    for (const project of draft.projects) {
      issues.push(...validateProjectDraft(project, draft));
    }
    for (const task of draft.tasks) {
      issues.push(...validateTaskDraft(task, draft));
    }
    for (const kr of draft.keyResults) {
      issues.push(...validateKeyResultDraft(kr, draft));
    }
    issues.push(...detectDuplicateTitles(draft));
    issues.push(...detectSimilarTitles(draft));
    issues.push(...validateHoursConsistency(draft));
  }

  const summary = calculateGoalArchitectureSummary(draft, { issues });
  const canCommit = summary.canCommit;
  const status: GoalArchitectureValidationResult['status'] = !draft.goal
    ? 'invalid'
    : summary.errorCount > 0
      ? 'invalid'
      : 'valid';

  return { status, canCommit, issues, summary };
}

// ============================================================================
// GOAL
// ============================================================================

export function validateGoalDraft(
  goal: GoalDraft | null,
): GoalArchitectIssue[] {
  const issues: GoalArchitectIssue[] = [];

  if (!goal) {
    issues.push(
      issue({
        code: 'missing_goal',
        severity: 'error',
        message: 'La bozza non contiene un Goal.',
        suggestion: 'Definisci almeno un Goal prima di continuare.',
      }),
    );
    return issues;
  }

  if (isBlank(goal.title)) {
    issues.push(
      issue({
        code: 'missing_title',
        severity: 'error',
        entityKind: 'goal',
        entityId: goal.id,
        field: 'title',
        message: 'Il Goal non ha un titolo.',
      }),
    );
  }

  if (typeof goal.targetHours === 'number') {
    if (!Number.isFinite(goal.targetHours) || goal.targetHours < 0) {
      issues.push(
        issue({
          code: 'invalid_hours',
          severity: 'error',
          entityKind: 'goal',
          entityId: goal.id,
          field: 'targetHours',
          message: `Goal: targetHours non valido (${String(goal.targetHours)}).`,
        }),
      );
    }
  } else {
    issues.push(
      issue({
        code: 'missing_hours',
        severity: 'warning',
        entityKind: 'goal',
        entityId: goal.id,
        field: 'targetHours',
        message: 'Goal: manca un target di ore complessivo.',
        suggestion: 'Aggiungi un targetHours per misurare il progresso.',
      }),
    );
  }

  if (goal.dueDateISO !== undefined) {
    if (!isValidISODate(goal.dueDateISO)) {
      issues.push(
        issue({
          code: 'invalid_due_date',
          severity: 'error',
          entityKind: 'goal',
          entityId: goal.id,
          field: 'dueDateISO',
          message: `Goal: data di scadenza non valida (${goal.dueDateISO}).`,
        }),
      );
    }
  } else {
    issues.push(
      issue({
        code: 'invalid_due_date',
        severity: 'warning',
        entityKind: 'goal',
        entityId: goal.id,
        field: 'dueDateISO',
        message: 'Goal: manca una data di scadenza.',
        suggestion: 'Imposta una targetDate per il Goal.',
      }),
    );
  }

  if (goal.priority !== undefined && !isDraftPriority(goal.priority)) {
    issues.push(
      issue({
        code: 'invalid_priority',
        severity: 'error',
        entityKind: 'goal',
        entityId: goal.id,
        field: 'priority',
        message: `Goal: priorità non valida (${String(goal.priority)}).`,
      }),
    );
  }

  const krCount = goal.keyResultIds.length;
  if (krCount < MIN_KEY_RESULTS) {
    issues.push(
      issue({
        code: 'too_few_key_results',
        severity: 'warning',
        entityKind: 'goal',
        entityId: goal.id,
        field: 'keyResultIds',
        message: `Goal: solo ${krCount} Key Result definiti (consigliati almeno ${MIN_KEY_RESULTS}).`,
      }),
    );
  } else if (krCount > MAX_KEY_RESULTS) {
    issues.push(
      issue({
        code: 'too_many_key_results',
        severity: 'warning',
        entityKind: 'goal',
        entityId: goal.id,
        field: 'keyResultIds',
        message: `Goal: ${krCount} Key Result (massimo consigliato ${MAX_KEY_RESULTS}).`,
      }),
    );
  }

  return issues;
}

// ============================================================================
// PROJECT
// ============================================================================

export function validateProjectDraft(
  project: ProjectDraft,
  draft: GoalArchitectureDraft,
): GoalArchitectIssue[] {
  const issues: GoalArchitectIssue[] = [];

  if (isBlank(project.title)) {
    issues.push(
      issue({
        code: 'missing_title',
        severity: 'error',
        entityKind: 'project',
        entityId: project.id,
        field: 'title',
        message: 'Project: titolo mancante.',
      }),
    );
  }

  if (!draft.goal || project.parentGoalId !== draft.goal.id) {
    issues.push(
      issue({
        code: 'missing_parent',
        severity: 'error',
        entityKind: 'project',
        entityId: project.id,
        field: 'parentGoalId',
        message: 'Project: il parent Goal non corrisponde al Goal della bozza.',
      }),
    );
  }

  if (typeof project.targetHours === 'number') {
    if (!Number.isFinite(project.targetHours) || project.targetHours < 0) {
      issues.push(
        issue({
          code: 'invalid_hours',
          severity: 'error',
          entityKind: 'project',
          entityId: project.id,
          field: 'targetHours',
          message: `Project '${project.title}': targetHours non valido.`,
        }),
      );
    }
  } else {
    issues.push(
      issue({
        code: 'missing_hours',
        severity: 'warning',
        entityKind: 'project',
        entityId: project.id,
        field: 'targetHours',
        message: `Project '${project.title}': manca targetHours.`,
      }),
    );
  }

  if (project.dueDateISO !== undefined && !isValidISODate(project.dueDateISO)) {
    issues.push(
      issue({
        code: 'invalid_due_date',
        severity: 'error',
        entityKind: 'project',
        entityId: project.id,
        field: 'dueDateISO',
        message: `Project '${project.title}': data di scadenza non valida.`,
      }),
    );
  }

  if (project.priority !== undefined && !isDraftPriority(project.priority)) {
    issues.push(
      issue({
        code: 'invalid_priority',
        severity: 'error',
        entityKind: 'project',
        entityId: project.id,
        field: 'priority',
        message: `Project '${project.title}': priorità non valida.`,
      }),
    );
  }

  if (project.taskIds.length === 0) {
    issues.push(
      issue({
        code: 'inconsistent_structure',
        severity: 'warning',
        entityKind: 'project',
        entityId: project.id,
        field: 'taskIds',
        message: `Project '${project.title}': nessun Task definito.`,
      }),
    );
  }

  return issues;
}

// ============================================================================
// TASK
// ============================================================================

export function validateTaskDraft(
  task: TaskDraft,
  draft: GoalArchitectureDraft,
): GoalArchitectIssue[] {
  const issues: GoalArchitectIssue[] = [];

  if (isBlank(task.title)) {
    issues.push(
      issue({
        code: 'missing_title',
        severity: 'error',
        entityKind: 'task',
        entityId: task.id,
        field: 'title',
        message: 'Task: titolo mancante.',
      }),
    );
  }

  if (!draft.goal || task.parentGoalId !== draft.goal.id) {
    issues.push(
      issue({
        code: 'missing_parent',
        severity: 'error',
        entityKind: 'task',
        entityId: task.id,
        field: 'parentGoalId',
        message: 'Task: parent Goal non corrispondente al Goal della bozza.',
      }),
    );
  }

  if (task.parentProjectId !== undefined) {
    const exists = draft.projects.some((p) => p.id === task.parentProjectId);
    if (!exists) {
      issues.push(
        issue({
          code: 'orphan_task',
          severity: 'error',
          entityKind: 'task',
          entityId: task.id,
          field: 'parentProjectId',
          message: `Task '${task.title}': parent Project '${task.parentProjectId}' inesistente.`,
        }),
      );
    }
  } else {
    issues.push(
      issue({
        code: 'orphan_task',
        severity: 'warning',
        entityKind: 'task',
        entityId: task.id,
        field: 'parentProjectId',
        message: `Task '${task.title}': collegato direttamente al Goal senza Project.`,
        suggestion: 'Valuta di raggrupparlo in un Project.',
      }),
    );
  }

  if (typeof task.estimatedHours === 'number') {
    if (!Number.isFinite(task.estimatedHours) || task.estimatedHours < 0) {
      issues.push(
        issue({
          code: 'invalid_hours',
          severity: 'error',
          entityKind: 'task',
          entityId: task.id,
          field: 'estimatedHours',
          message: `Task '${task.title}': estimatedHours non valido.`,
        }),
      );
    }
  } else {
    issues.push(
      issue({
        code: 'missing_hours',
        severity: 'warning',
        entityKind: 'task',
        entityId: task.id,
        field: 'estimatedHours',
        message: `Task '${task.title}': manca estimatedHours.`,
      }),
    );
  }

  if (task.dueDateISO !== undefined && !isValidISODate(task.dueDateISO)) {
    issues.push(
      issue({
        code: 'invalid_due_date',
        severity: 'error',
        entityKind: 'task',
        entityId: task.id,
        field: 'dueDateISO',
        message: `Task '${task.title}': data di scadenza non valida.`,
      }),
    );
  }

  if (task.priority !== undefined && !isDraftPriority(task.priority)) {
    issues.push(
      issue({
        code: 'invalid_priority',
        severity: 'error',
        entityKind: 'task',
        entityId: task.id,
        field: 'priority',
        message: `Task '${task.title}': priorità non valida.`,
      }),
    );
  }

  return issues;
}

// ============================================================================
// KEY RESULT
// ============================================================================

export function validateKeyResultDraft(
  keyResult: KeyResultDraft,
  draft: GoalArchitectureDraft,
): GoalArchitectIssue[] {
  const issues: GoalArchitectIssue[] = [];

  if (isBlank(keyResult.title)) {
    issues.push(
      issue({
        code: 'missing_title',
        severity: 'error',
        entityKind: 'key_result',
        entityId: keyResult.id,
        field: 'title',
        message: 'Key Result: titolo mancante.',
      }),
    );
  }

  if (!draft.goal || keyResult.parentGoalId !== draft.goal.id) {
    issues.push(
      issue({
        code: 'orphan_key_result',
        severity: 'error',
        entityKind: 'key_result',
        entityId: keyResult.id,
        field: 'parentGoalId',
        message: `Key Result '${keyResult.title}': non collegato al Goal della bozza.`,
      }),
    );
  }

  if (typeof keyResult.targetValue === 'number') {
    if (!Number.isFinite(keyResult.targetValue) || keyResult.targetValue < 0) {
      issues.push(
        issue({
          code: 'invalid_hours',
          severity: 'error',
          entityKind: 'key_result',
          entityId: keyResult.id,
          field: 'targetValue',
          message: `Key Result '${keyResult.title}': targetValue non valido.`,
        }),
      );
    }
  } else {
    issues.push(
      issue({
        code: 'missing_hours',
        severity: 'warning',
        entityKind: 'key_result',
        entityId: keyResult.id,
        field: 'targetValue',
        message: `Key Result '${keyResult.title}': targetValue mancante.`,
      }),
    );
  }

  if (typeof keyResult.currentValue === 'number') {
    if (!Number.isFinite(keyResult.currentValue) || keyResult.currentValue < 0) {
      issues.push(
        issue({
          code: 'invalid_hours',
          severity: 'error',
          entityKind: 'key_result',
          entityId: keyResult.id,
          field: 'currentValue',
          message: `Key Result '${keyResult.title}': currentValue non valido.`,
        }),
      );
    }
  }

  if (keyResult.unit === undefined) {
    issues.push(
      issue({
        code: 'unsupported_field',
        severity: 'warning',
        entityKind: 'key_result',
        entityId: keyResult.id,
        field: 'unit',
        message: `Key Result '${keyResult.title}': unità mancante.`,
      }),
    );
  }

  return issues;
}

// ============================================================================
// DUPLICATES
// ============================================================================

export function detectDuplicateTitles(
  draft: GoalArchitectureDraft,
): GoalArchitectIssue[] {
  const issues: GoalArchitectIssue[] = [];

  // Projects under the same goal
  const projectByTitle = new Map<string, ProjectDraft[]>();
  for (const project of draft.projects) {
    const key = normalizeForId(project.title);
    const bucket = projectByTitle.get(key) ?? [];
    bucket.push(project);
    projectByTitle.set(key, bucket);
  }
  for (const bucket of projectByTitle.values()) {
    if (bucket.length > 1) {
      for (const project of bucket) {
        issues.push(
          issue({
            code: 'duplicate_title',
            severity: 'warning',
            entityKind: 'project',
            entityId: project.id,
            field: 'title',
            message: `Project '${project.title}': titolo duplicato nel Goal.`,
          }),
        );
      }
    }
  }

  // Tasks within the same project
  const taskByProjectAndTitle = new Map<string, TaskDraft[]>();
  for (const task of draft.tasks) {
    const projectKey = task.parentProjectId ?? '__direct__';
    const key = `${projectKey}::${normalizeForId(task.title)}`;
    const bucket = taskByProjectAndTitle.get(key) ?? [];
    bucket.push(task);
    taskByProjectAndTitle.set(key, bucket);
  }
  for (const bucket of taskByProjectAndTitle.values()) {
    if (bucket.length > 1) {
      for (const task of bucket) {
        issues.push(
          issue({
            code: 'duplicate_title',
            severity: 'warning',
            entityKind: 'task',
            entityId: task.id,
            field: 'title',
            message: `Task '${task.title}': titolo duplicato nello stesso Project.`,
          }),
        );
      }
    }
  }

  // Key Results in the goal
  const krByTitle = new Map<string, KeyResultDraft[]>();
  for (const kr of draft.keyResults) {
    const key = normalizeForId(kr.title);
    const bucket = krByTitle.get(key) ?? [];
    bucket.push(kr);
    krByTitle.set(key, bucket);
  }
  for (const bucket of krByTitle.values()) {
    if (bucket.length > 1) {
      for (const kr of bucket) {
        issues.push(
          issue({
            code: 'duplicate_title',
            severity: 'warning',
            entityKind: 'key_result',
            entityId: kr.id,
            field: 'title',
            message: `Key Result '${kr.title}': titolo duplicato.`,
          }),
        );
      }
    }
  }

  return issues;
}

// ============================================================================
// SIMILAR TITLES (cheap Levenshtein)
// ============================================================================

export function detectSimilarTitles(
  draft: GoalArchitectureDraft,
): GoalArchitectIssue[] {
  const issues: GoalArchitectIssue[] = [];
  const projects = draft.projects;
  for (let i = 0; i < projects.length; i++) {
    for (let j = i + 1; j < projects.length; j++) {
      const a = projects[i];
      const b = projects[j];
      const sa = normalizeForId(a.title);
      const sb = normalizeForId(b.title);
      if (sa === sb) continue; // exact duplicates handled elsewhere
      if (sa.length < SIMILAR_TITLE_MIN_LENGTH) continue;
      if (sb.length < SIMILAR_TITLE_MIN_LENGTH) continue;
      const distance = levenshtein(sa, sb);
      const longest = Math.max(sa.length, sb.length);
      if (distance / longest <= SIMILAR_TITLE_DISTANCE_RATIO) {
        issues.push(
          issue({
            code: 'similar_title',
            severity: 'warning',
            entityKind: 'project',
            entityId: a.id,
            field: 'title',
            message: `Project '${a.title}' e '${b.title}' hanno titoli molto simili.`,
          }),
        );
      }
    }
  }
  return issues;
}

// ============================================================================
// HOURS CONSISTENCY
// ============================================================================

export function validateHoursConsistency(
  draft: GoalArchitectureDraft,
): GoalArchitectIssue[] {
  const issues: GoalArchitectIssue[] = [];

  if (draft.goal && typeof draft.goal.targetHours === 'number' && draft.projects.length > 0) {
    const sumProjects = calculateTotalProjectTargetHours(draft.projects);
    if (sumProjects > 0 && !withinTolerance(draft.goal.targetHours, sumProjects)) {
      issues.push(
        issue({
          code: 'hours_mismatch',
          severity: 'warning',
          entityKind: 'goal',
          entityId: draft.goal.id,
          field: 'targetHours',
          message: `Goal targetHours (${draft.goal.targetHours}h) ≠ somma Project (${roundTo(sumProjects, 2)}h).`,
        }),
      );
    }
  }

  for (const project of draft.projects) {
    if (typeof project.targetHours !== 'number') continue;
    const projectTasks = draft.tasks.filter(
      (t) => t.parentProjectId === project.id,
    );
    if (projectTasks.length === 0) continue;
    const sumTasks = calculateTotalTaskEstimatedHours(projectTasks);
    if (sumTasks === 0) continue;
    if (!withinTolerance(project.targetHours, sumTasks)) {
      issues.push(
        issue({
          code: 'hours_mismatch',
          severity: 'warning',
          entityKind: 'project',
          entityId: project.id,
          field: 'targetHours',
          message: `Project '${project.title}': targetHours (${project.targetHours}h) ≠ somma Task (${roundTo(sumTasks, 2)}h).`,
        }),
      );
    }
  }

  return issues;
}

// ============================================================================
// PRIORITY NORMALIZATION
// ============================================================================

const PRIORITY_ALIASES: Record<string, DraftPriority> = {
  critical: 'critical',
  crit: 'critical',
  urgent: 'critical',
  urgente: 'critical',
  alta: 'high',
  altissima: 'critical',
  high: 'high',
  h: 'high',
  media: 'medium',
  medium: 'medium',
  med: 'medium',
  m: 'medium',
  bassa: 'low',
  low: 'low',
  l: 'low',
};

export function normalizePriority(
  value: string | undefined,
): DraftPriority | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;
  if (isDraftPriority(trimmed)) return trimmed;
  return PRIORITY_ALIASES[trimmed];
}

// ============================================================================
// DATE VALIDATION
// ============================================================================

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

export function isValidISODate(value: string | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'string') return false;
  if (!ISO_DATE_RE.test(value)) return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

interface IssueDraft {
  code: GoalArchitectIssueCode;
  severity: GoalArchitectSeverity;
  message: string;
  entityKind?: GoalArchitectIssue['entityKind'];
  entityId?: string;
  field?: string;
  suggestion?: string;
}

function issue(spec: IssueDraft): GoalArchitectIssue {
  return {
    id: createIssueId(spec.code, spec.entityId, spec.field),
    code: spec.code,
    severity: spec.severity,
    entityKind: spec.entityKind,
    entityId: spec.entityId,
    field: spec.field,
    message: spec.message,
    suggestion: spec.suggestion,
  };
}

function isBlank(value: string | undefined | null): boolean {
  if (typeof value !== 'string') return true;
  return value.trim().length === 0;
}

function withinTolerance(expected: number, actual: number): boolean {
  const diff = Math.abs(expected - actual);
  if (diff <= HOURS_ABSOLUTE_TOLERANCE) return true;
  const denom = Math.max(Math.abs(expected), Math.abs(actual), 1);
  return diff / denom <= HOURS_RELATIVE_TOLERANCE;
}

function roundTo(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}
