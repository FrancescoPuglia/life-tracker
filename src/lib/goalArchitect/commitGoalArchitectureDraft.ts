// src/lib/goalArchitect/commitGoalArchitectureDraft.ts
// Safe Goal Architect draft → real Goal/Project/Task/KeyResult commit.
//
// Design:
//   • Pure module. No React, no DataProvider import. Callers inject the
//     `createGoal/createProject/createTask/createKeyResult` functions plus a
//     snapshot of currently-existing entities for duplicate detection.
//   • Sequential awaits, never `Promise.all`. A failed call doesn't poison
//     the others; we record it and continue when safe.
//   • GAI_KEY idempotency: every created entity carries
//     `GAI_KEY: gai:<draftId>:<entityKind>:<draftEntityId>` in its
//     `description` field. Re-running the same commit detects this string
//     and skips the entity as a duplicate.
//   • No invented IDs. The pipeline uses the real id returned by each
//     create function to wire children. If a parent id cannot be resolved
//     (the create returned `undefined`), descendants are skipped — never
//     created with a `goalId: ''` or `projectId: ''`.
//   • No destructive rollback. Partial failures are reported via
//     `status: 'partial'` + `errors[]` so the user can fix and re-run.

import {
  calculateGoalArchitectureSummary,
} from './summary';
import {
  validateGoalArchitectureDraft,
} from './validation';
import { normalizeForId } from './ids';
import type {
  DraftEntityKind,
  DraftPriority,
  GoalArchitectureDraft,
  KeyResultDraft,
  ProjectDraft,
  TaskDraft,
} from './types';

// ============================================================================
// SNAPSHOT TYPES (decoupled from `@/types`)
// ============================================================================

export interface ExistingGoalSnapshot {
  id: string;
  title: string;
  description?: string;
}

export interface ExistingProjectSnapshot {
  id: string;
  name: string;
  description?: string;
  goalId?: string;
}

export interface ExistingTaskSnapshot {
  id: string;
  title: string;
  description?: string;
  projectId?: string;
  goalId?: string;
  estimatedMinutes?: number;
}

export interface ExistingKeyResultSnapshot {
  id: string;
  title: string;
  description?: string;
  goalId?: string;
}

// ============================================================================
// PAYLOAD TYPES (structurally compatible with `Partial<Goal/Project/...>`)
// ============================================================================

export interface CommitGoalPayload {
  title: string;
  description?: string;
  status?: 'active';
  priority?: DraftPriority;
  targetDate?: Date;
  targetHours?: number;
  timeAllocationTarget?: number;
  domainId?: string;
}

export interface CommitProjectPayload {
  name: string;
  description?: string;
  goalId: string;
  status?: 'active';
  priority?: DraftPriority;
  dueDate?: Date;
  totalHoursTarget?: number;
  domainId?: string;
}

export interface CommitTaskPayload {
  title: string;
  description?: string;
  projectId: string;
  goalId?: string;
  status?: 'pending' | 'todo';
  priority?: DraftPriority;
  estimatedMinutes: number;
  dueDate?: Date;
  domainId?: string;
}

export interface CommitKeyResultPayload {
  title: string;
  description?: string;
  goalId: string;
  targetValue?: number;
  currentValue?: number;
  unit?: string;
  status?: 'active';
  domainId?: string;
}

// ============================================================================
// CREATE FUNCTION TYPES
// ============================================================================

export type CreateGoalFn = (
  input: CommitGoalPayload,
) => Promise<string | undefined>;

export type CreateProjectFn = (
  input: CommitProjectPayload,
) => Promise<string | undefined>;

export type CreateTaskFn = (
  input: CommitTaskPayload,
) => Promise<string | undefined>;

export type CreateKeyResultFn = (
  input: CommitKeyResultPayload,
) => Promise<string | undefined>;

// ============================================================================
// RESULT TYPES
// ============================================================================

export type GoalArchitectCommitStatus =
  | 'success'
  | 'partial'
  | 'blocked'
  | 'failed';

export type GoalArchitectBlockedCode =
  | 'no_draft'
  | 'no_goal'
  | 'validation_error'
  | 'cannot_commit'
  | 'missing_create_goal'
  | 'missing_create_project'
  | 'missing_create_task'
  | 'unsupported_create_key_result';

export interface GoalArchitectBlockedReason {
  code: GoalArchitectBlockedCode;
  message: string;
  entityKind?: DraftEntityKind;
  entityId?: string;
}

export interface GoalArchitectCommitCreated {
  draftId: string;
  title: string;
  entityKind: DraftEntityKind;
  realId?: string;
}

export interface GoalArchitectCommitSkipped {
  draftId: string;
  title: string;
  entityKind: DraftEntityKind;
  reason:
    | 'duplicate'
    | 'parent_unresolved'
    | 'unsupported_create_key_result'
    | 'invalid'
    | 'error';
  message: string;
}

export interface GoalArchitectCommitDuplicate {
  draftId: string;
  existingId: string;
  title: string;
  entityKind: DraftEntityKind;
  reason: 'gai_key' | 'structural';
}

export interface GoalArchitectCommitError {
  draftId: string;
  title: string;
  entityKind: DraftEntityKind;
  message: string;
}

export interface GoalArchitectCommitResult {
  status: GoalArchitectCommitStatus;
  createdGoals: GoalArchitectCommitCreated[];
  createdProjects: GoalArchitectCommitCreated[];
  createdTasks: GoalArchitectCommitCreated[];
  createdKeyResults: GoalArchitectCommitCreated[];
  skipped: GoalArchitectCommitSkipped[];
  duplicates: GoalArchitectCommitDuplicate[];
  blockedReasons: GoalArchitectBlockedReason[];
  errors: GoalArchitectCommitError[];
  message: string;
}

// ============================================================================
// INPUT
// ============================================================================

export interface GoalArchitectCommitInput {
  draft: GoalArchitectureDraft | null;
  existingGoals: ReadonlyArray<ExistingGoalSnapshot>;
  existingProjects: ReadonlyArray<ExistingProjectSnapshot>;
  existingTasks: ReadonlyArray<ExistingTaskSnapshot>;
  existingKeyResults: ReadonlyArray<ExistingKeyResultSnapshot>;
  createGoal?: CreateGoalFn;
  createProject?: CreateProjectFn;
  createTask?: CreateTaskFn;
  createKeyResult?: CreateKeyResultFn;
  /** Default domainId for created entities. Defaults to "default". */
  domainId?: string;
}

// ============================================================================
// GAI_KEY HELPERS
// ============================================================================

const GAI_KEY_PREFIX = 'GAI_KEY:';

export function gaiKey(
  draftId: string,
  entityKind: DraftEntityKind,
  draftEntityId: string,
): string {
  return `gai:${draftId}:${entityKind}:${draftEntityId}`;
}

function appendGaiKey(description: string | undefined, key: string): string {
  const trimmed = (description ?? '').trim();
  const marker = `${GAI_KEY_PREFIX} ${key}`;
  if (trimmed.includes(marker)) return trimmed;
  return trimmed.length === 0 ? marker : `${trimmed}\n\n${marker}`;
}

function descriptionContainsGaiKey(
  description: string | undefined,
  key: string,
): boolean {
  if (!description) return false;
  return description.includes(`${GAI_KEY_PREFIX} ${key}`);
}

// ============================================================================
// DUPLICATE DETECTION
// ============================================================================

export interface DuplicateMatch {
  existingId: string;
  reason: 'gai_key' | 'structural';
}

export function findDuplicateGoal(
  draft: GoalArchitectureDraft,
  goalDraftId: string,
  title: string,
  existingGoals: ReadonlyArray<ExistingGoalSnapshot>,
): DuplicateMatch | undefined {
  const key = gaiKey(draft.id, 'goal', goalDraftId);
  for (const g of existingGoals) {
    if (descriptionContainsGaiKey(g.description, key)) {
      return { existingId: g.id, reason: 'gai_key' };
    }
  }
  const norm = normalizeForId(title);
  for (const g of existingGoals) {
    if (normalizeForId(g.title) === norm) {
      return { existingId: g.id, reason: 'structural' };
    }
  }
  return undefined;
}

export function findDuplicateProject(
  draft: GoalArchitectureDraft,
  project: ProjectDraft,
  realGoalId: string,
  existingProjects: ReadonlyArray<ExistingProjectSnapshot>,
): DuplicateMatch | undefined {
  const key = gaiKey(draft.id, 'project', project.id);
  for (const p of existingProjects) {
    if (descriptionContainsGaiKey(p.description, key)) {
      return { existingId: p.id, reason: 'gai_key' };
    }
  }
  const norm = normalizeForId(project.title);
  for (const p of existingProjects) {
    if (p.goalId !== realGoalId) continue;
    if (normalizeForId(p.name) === norm) {
      return { existingId: p.id, reason: 'structural' };
    }
  }
  return undefined;
}

export function findDuplicateTask(
  draft: GoalArchitectureDraft,
  task: TaskDraft,
  parentProjectId: string | undefined,
  realGoalId: string,
  existingTasks: ReadonlyArray<ExistingTaskSnapshot>,
): DuplicateMatch | undefined {
  const key = gaiKey(draft.id, 'task', task.id);
  for (const t of existingTasks) {
    if (descriptionContainsGaiKey(t.description, key)) {
      return { existingId: t.id, reason: 'gai_key' };
    }
  }
  const norm = normalizeForId(task.title);
  const estimatedMinutes = draftHoursToMinutes(task.estimatedHours);
  for (const t of existingTasks) {
    if (parentProjectId && t.projectId !== parentProjectId) continue;
    if (!parentProjectId && t.goalId !== realGoalId) continue;
    if (normalizeForId(t.title) !== norm) continue;
    const estMatches =
      estimatedMinutes === undefined ||
      t.estimatedMinutes === undefined ||
      t.estimatedMinutes === estimatedMinutes;
    if (estMatches) {
      return { existingId: t.id, reason: 'structural' };
    }
  }
  return undefined;
}

export function findDuplicateKeyResult(
  draft: GoalArchitectureDraft,
  keyResult: KeyResultDraft,
  realGoalId: string,
  existingKeyResults: ReadonlyArray<ExistingKeyResultSnapshot>,
): DuplicateMatch | undefined {
  const key = gaiKey(draft.id, 'key_result', keyResult.id);
  for (const kr of existingKeyResults) {
    if (descriptionContainsGaiKey(kr.description, key)) {
      return { existingId: kr.id, reason: 'gai_key' };
    }
  }
  const norm = normalizeForId(keyResult.title);
  for (const kr of existingKeyResults) {
    if (kr.goalId !== realGoalId) continue;
    if (normalizeForId(kr.title) === norm) {
      return { existingId: kr.id, reason: 'structural' };
    }
  }
  return undefined;
}

// ============================================================================
// VALIDATION
// ============================================================================

export interface GoalArchitectCommitValidationResult {
  canCommit: boolean;
  blockedReasons: GoalArchitectBlockedReason[];
}

export function validateDraftForGoalArchitectCommit(
  input: GoalArchitectCommitInput,
): GoalArchitectCommitValidationResult {
  const blockedReasons: GoalArchitectBlockedReason[] = [];

  if (!input.draft) {
    blockedReasons.push({
      code: 'no_draft',
      message: 'Nessuna bozza disponibile per il commit.',
    });
    return { canCommit: false, blockedReasons };
  }
  if (!input.draft.goal) {
    blockedReasons.push({
      code: 'no_goal',
      message: 'La bozza non contiene un Goal: impossibile committare.',
    });
  }
  if (input.draft.goal) {
    // Re-run validation defensively: callers may have edited and forgotten
    // to recompute. We rely on the validator as the single source of truth.
    const validation = validateGoalArchitectureDraft(input.draft);
    if (validation.summary.errorCount > 0) {
      blockedReasons.push({
        code: 'validation_error',
        message: `${validation.summary.errorCount} blocking issue(s) prevent commit.`,
      });
    }
    if (!validation.canCommit) {
      blockedReasons.push({
        code: 'cannot_commit',
        message: 'La bozza non è strutturalmente pronta per il commit.',
      });
    }
  }
  if (!input.createGoal) {
    blockedReasons.push({
      code: 'missing_create_goal',
      message: 'Missing createGoal dependency — cannot commit.',
    });
  }
  if (input.draft && input.draft.projects.length > 0 && !input.createProject) {
    blockedReasons.push({
      code: 'missing_create_project',
      message: 'Missing createProject dependency — cannot commit projects.',
    });
  }
  if (input.draft && input.draft.tasks.length > 0 && !input.createTask) {
    blockedReasons.push({
      code: 'missing_create_task',
      message: 'Missing createTask dependency — cannot commit tasks.',
    });
  }

  // Note: missing createKeyResult is NOT a hard blocker — KRs degrade to
  // 'skipped' at commit time with reason `unsupported_create_key_result`.
  // Deduplicate blockedReasons by code so the UI doesn't double-render
  // (validation_error + cannot_commit often coincide).
  const seen = new Set<string>();
  const deduped = blockedReasons.filter((r) => {
    if (seen.has(r.code)) return false;
    seen.add(r.code);
    return true;
  });

  return {
    canCommit: deduped.length === 0,
    blockedReasons: deduped,
  };
}

export function isDraftCommittable(
  input: GoalArchitectCommitInput,
): boolean {
  return validateDraftForGoalArchitectCommit(input).canCommit;
}

// ============================================================================
// PAYLOAD MAPPING
// ============================================================================

function draftHoursToMinutes(hours: number | undefined): number | undefined {
  if (hours === undefined) return undefined;
  if (!Number.isFinite(hours) || hours < 0) return undefined;
  return Math.round(hours * 60);
}

function isoToDate(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const DEFAULT_DOMAIN_ID = 'default';

export function draftGoalToCreateGoalPayload(
  draft: GoalArchitectureDraft,
  domainId: string,
): CommitGoalPayload | null {
  const goal = draft.goal;
  if (!goal) return null;
  const key = gaiKey(draft.id, 'goal', goal.id);
  const description = appendGaiKey(goal.description, key);
  return {
    title: goal.title,
    description,
    status: 'active',
    priority: goal.priority,
    targetDate: isoToDate(goal.dueDateISO),
    targetHours: goal.targetHours,
    timeAllocationTarget: 0,
    domainId,
  };
}

export function draftProjectToCreateProjectPayload(
  project: ProjectDraft,
  draft: GoalArchitectureDraft,
  realGoalId: string,
  domainId: string,
): CommitProjectPayload {
  const key = gaiKey(draft.id, 'project', project.id);
  const description = appendGaiKey(project.description, key);
  return {
    name: project.title,
    description,
    goalId: realGoalId,
    status: 'active',
    priority: project.priority,
    dueDate: isoToDate(project.dueDateISO),
    totalHoursTarget: project.targetHours,
    domainId,
  };
}

export function draftTaskToCreateTaskPayload(
  task: TaskDraft,
  draft: GoalArchitectureDraft,
  realProjectId: string,
  realGoalId: string,
  domainId: string,
): CommitTaskPayload {
  const key = gaiKey(draft.id, 'task', task.id);
  const description = appendGaiKey(task.description, key);
  const minutes = draftHoursToMinutes(task.estimatedHours);
  return {
    title: task.title,
    description,
    projectId: realProjectId,
    goalId: realGoalId,
    status: 'pending',
    priority: task.priority,
    estimatedMinutes: minutes ?? 60,
    dueDate: isoToDate(task.dueDateISO),
    domainId,
  };
}

export function draftKeyResultToCreateKeyResultPayload(
  keyResult: KeyResultDraft,
  draft: GoalArchitectureDraft,
  realGoalId: string,
  domainId: string,
): CommitKeyResultPayload {
  const key = gaiKey(draft.id, 'key_result', keyResult.id);
  const description = appendGaiKey(keyResult.description, key);
  const unit =
    keyResult.unit === 'custom'
      ? keyResult.customUnit ?? 'custom'
      : keyResult.unit;
  return {
    title: keyResult.title,
    description,
    goalId: realGoalId,
    targetValue: keyResult.targetValue,
    currentValue: keyResult.currentValue ?? 0,
    unit,
    status: 'active',
    domainId,
  };
}

// ============================================================================
// COMMIT PIPELINE
// ============================================================================

export async function commitGoalArchitectureDraft(
  input: GoalArchitectCommitInput,
): Promise<GoalArchitectCommitResult> {
  const validation = validateDraftForGoalArchitectCommit(input);
  const skeleton = emptyResult();

  if (!validation.canCommit || !input.draft || !input.draft.goal) {
    return {
      ...skeleton,
      status: 'blocked',
      blockedReasons: validation.blockedReasons,
      message: buildBlockedMessage(validation.blockedReasons),
    };
  }

  const draft = input.draft;
  const goal = input.draft.goal;
  const createGoal = input.createGoal;
  if (!createGoal) {
    // Already covered by validation, but TypeScript-safe.
    return {
      ...skeleton,
      status: 'blocked',
      blockedReasons: validation.blockedReasons,
      message: 'Missing createGoal dependency — cannot commit.',
    };
  }

  const domainId = input.domainId ?? DEFAULT_DOMAIN_ID;
  const createdGoals: GoalArchitectCommitCreated[] = [];
  const createdProjects: GoalArchitectCommitCreated[] = [];
  const createdTasks: GoalArchitectCommitCreated[] = [];
  const createdKeyResults: GoalArchitectCommitCreated[] = [];
  const skipped: GoalArchitectCommitSkipped[] = [];
  const duplicates: GoalArchitectCommitDuplicate[] = [];
  const errors: GoalArchitectCommitError[] = [];

  // ----- GOAL ---------------------------------------------------------------
  let realGoalId: string | undefined;
  const goalDupe = findDuplicateGoal(
    draft,
    goal.id,
    goal.title,
    input.existingGoals,
  );
  if (goalDupe) {
    duplicates.push({
      draftId: goal.id,
      existingId: goalDupe.existingId,
      title: goal.title,
      entityKind: 'goal',
      reason: goalDupe.reason,
    });
    realGoalId = goalDupe.existingId;
  } else {
    const payload = draftGoalToCreateGoalPayload(draft, domainId);
    if (!payload) {
      return {
        ...skeleton,
        status: 'blocked',
        blockedReasons: [
          { code: 'no_goal', message: 'Goal payload could not be built.' },
        ],
        message: 'Goal payload could not be built.',
      };
    }
    try {
      const id = await createGoal(payload);
      if (typeof id === 'string' && id.length > 0) {
        realGoalId = id;
        createdGoals.push({
          draftId: goal.id,
          title: goal.title,
          entityKind: 'goal',
          realId: id,
        });
      } else {
        errors.push({
          draftId: goal.id,
          title: goal.title,
          entityKind: 'goal',
          message: 'createGoal did not return an id.',
        });
      }
    } catch (err) {
      errors.push({
        draftId: goal.id,
        title: goal.title,
        entityKind: 'goal',
        message: errorMessage(err),
      });
    }
  }

  // If we still don't have a real goal id, everything else is blocked.
  if (!realGoalId) {
    return {
      ...skeleton,
      status: 'failed',
      createdGoals,
      errors,
      message:
        'Goal creation failed: child entities cannot be safely committed.',
    };
  }

  // ----- PROJECTS -----------------------------------------------------------
  const draftProjectIdToReal = new Map<string, string>();
  const createProject = input.createProject;

  for (const project of draft.projects) {
    const dupe = findDuplicateProject(
      draft,
      project,
      realGoalId,
      input.existingProjects,
    );
    if (dupe) {
      duplicates.push({
        draftId: project.id,
        existingId: dupe.existingId,
        title: project.title,
        entityKind: 'project',
        reason: dupe.reason,
      });
      draftProjectIdToReal.set(project.id, dupe.existingId);
      continue;
    }
    if (!createProject) {
      // Validation would normally catch this, but defend if a caller bypassed.
      skipped.push({
        draftId: project.id,
        title: project.title,
        entityKind: 'project',
        reason: 'parent_unresolved',
        message: 'createProject not available — project not created.',
      });
      continue;
    }
    try {
      const payload = draftProjectToCreateProjectPayload(
        project,
        draft,
        realGoalId,
        domainId,
      );
      const id = await createProject(payload);
      if (typeof id === 'string' && id.length > 0) {
        draftProjectIdToReal.set(project.id, id);
        createdProjects.push({
          draftId: project.id,
          title: project.title,
          entityKind: 'project',
          realId: id,
        });
      } else {
        errors.push({
          draftId: project.id,
          title: project.title,
          entityKind: 'project',
          message: 'createProject did not return an id.',
        });
      }
    } catch (err) {
      errors.push({
        draftId: project.id,
        title: project.title,
        entityKind: 'project',
        message: errorMessage(err),
      });
    }
  }

  // ----- TASKS --------------------------------------------------------------
  const createTask = input.createTask;
  for (const task of draft.tasks) {
    let parentProjectId: string | undefined;
    if (task.parentProjectId) {
      parentProjectId = draftProjectIdToReal.get(task.parentProjectId);
      if (!parentProjectId) {
        // Parent project either failed to create or wasn't in the draft.
        skipped.push({
          draftId: task.id,
          title: task.title,
          entityKind: 'task',
          reason: 'parent_unresolved',
          message: `Project parent for "${task.title}" could not be resolved — task not created.`,
        });
        continue;
      }
    }

    const dupe = findDuplicateTask(
      draft,
      task,
      parentProjectId,
      realGoalId,
      input.existingTasks,
    );
    if (dupe) {
      duplicates.push({
        draftId: task.id,
        existingId: dupe.existingId,
        title: task.title,
        entityKind: 'task',
        reason: dupe.reason,
      });
      continue;
    }

    if (!createTask) {
      skipped.push({
        draftId: task.id,
        title: task.title,
        entityKind: 'task',
        reason: 'invalid',
        message: 'createTask not available — task not created.',
      });
      continue;
    }

    if (!parentProjectId) {
      // Direct task under the goal — DataProvider.Task model requires a
      // projectId, so direct tasks cannot be committed safely.
      skipped.push({
        draftId: task.id,
        title: task.title,
        entityKind: 'task',
        reason: 'parent_unresolved',
        message:
          `"${task.title}" was attached directly to the Goal. ` +
          `Tasks require a Project parent and cannot be committed. ` +
          `Fix: add a line like "Nel progetto <Project> crea task: ${task.title}" in the input and re-Generate, or assign this task to a Project via the OKR Manager after committing the rest.`,
      });
      continue;
    }

    try {
      const payload = draftTaskToCreateTaskPayload(
        task,
        draft,
        parentProjectId,
        realGoalId,
        domainId,
      );
      const id = await createTask(payload);
      if (typeof id === 'string' && id.length > 0) {
        createdTasks.push({
          draftId: task.id,
          title: task.title,
          entityKind: 'task',
          realId: id,
        });
      } else {
        errors.push({
          draftId: task.id,
          title: task.title,
          entityKind: 'task',
          message: 'createTask did not return an id.',
        });
      }
    } catch (err) {
      errors.push({
        draftId: task.id,
        title: task.title,
        entityKind: 'task',
        message: errorMessage(err),
      });
    }
  }

  // ----- KEY RESULTS --------------------------------------------------------
  const createKeyResult = input.createKeyResult;
  for (const kr of draft.keyResults) {
    if (!createKeyResult) {
      skipped.push({
        draftId: kr.id,
        title: kr.title,
        entityKind: 'key_result',
        reason: 'unsupported_create_key_result',
        message:
          'createKeyResult not available — key result not committed.',
      });
      continue;
    }
    const dupe = findDuplicateKeyResult(
      draft,
      kr,
      realGoalId,
      input.existingKeyResults,
    );
    if (dupe) {
      duplicates.push({
        draftId: kr.id,
        existingId: dupe.existingId,
        title: kr.title,
        entityKind: 'key_result',
        reason: dupe.reason,
      });
      continue;
    }
    try {
      const payload = draftKeyResultToCreateKeyResultPayload(
        kr,
        draft,
        realGoalId,
        domainId,
      );
      const id = await createKeyResult(payload);
      if (typeof id === 'string' && id.length > 0) {
        createdKeyResults.push({
          draftId: kr.id,
          title: kr.title,
          entityKind: 'key_result',
          realId: id,
        });
      } else {
        errors.push({
          draftId: kr.id,
          title: kr.title,
          entityKind: 'key_result',
          message: 'createKeyResult did not return an id.',
        });
      }
    } catch (err) {
      errors.push({
        draftId: kr.id,
        title: kr.title,
        entityKind: 'key_result',
        message: errorMessage(err),
      });
    }
  }

  // Use summary for parity with the validator's notion of "expected work".
  // Not strictly required, but keeps the success message in sync with the UI.
  const totalExpected =
    1 + draft.projects.length + draft.tasks.length + draft.keyResults.length;
  const totalCreatedOrDuplicated =
    createdGoals.length +
    createdProjects.length +
    createdTasks.length +
    createdKeyResults.length +
    duplicates.length;

  let status: GoalArchitectCommitStatus = 'success';
  if (errors.length > 0 || skipped.length > 0) {
    status = totalCreatedOrDuplicated > 0 ? 'partial' : 'failed';
  } else if (totalCreatedOrDuplicated === 0) {
    status = 'failed';
  } else if (totalCreatedOrDuplicated < totalExpected) {
    // No errors but fewer than expected — typically because some KRs were
    // skipped for `unsupported_create_key_result`.
    status = 'partial';
  }

  return {
    status,
    createdGoals,
    createdProjects,
    createdTasks,
    createdKeyResults,
    skipped,
    duplicates,
    blockedReasons: [],
    errors,
    message: buildResultMessage(
      status,
      createdGoals.length,
      createdProjects.length,
      createdTasks.length,
      createdKeyResults.length,
      skipped.length,
      duplicates.length,
      errors.length,
    ),
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function emptyResult(): GoalArchitectCommitResult {
  return {
    status: 'blocked',
    createdGoals: [],
    createdProjects: [],
    createdTasks: [],
    createdKeyResults: [],
    skipped: [],
    duplicates: [],
    blockedReasons: [],
    errors: [],
    message: '',
  };
}

function buildBlockedMessage(
  reasons: ReadonlyArray<GoalArchitectBlockedReason>,
): string {
  if (reasons.length === 0) return 'Commit bloccato.';
  if (reasons.length === 1) return reasons[0].message;
  return `Commit bloccato: ${reasons.map((r) => r.message).join(' · ')}`;
}

function buildResultMessage(
  status: GoalArchitectCommitStatus,
  goals: number,
  projects: number,
  tasks: number,
  keyResults: number,
  skipped: number,
  duplicates: number,
  errors: number,
): string {
  const parts: string[] = [];
  if (goals > 0) parts.push(`${goals} goal`);
  if (projects > 0) parts.push(`${projects} project${projects === 1 ? '' : 's'}`);
  if (tasks > 0) parts.push(`${tasks} task${tasks === 1 ? '' : 's'}`);
  if (keyResults > 0)
    parts.push(`${keyResults} key result${keyResults === 1 ? '' : 's'}`);
  const created = parts.length > 0 ? parts.join(', ') : 'nothing';
  const tail: string[] = [];
  if (duplicates > 0) tail.push(`${duplicates} duplicate(s) reused`);
  if (skipped > 0) tail.push(`${skipped} skipped`);
  if (errors > 0) tail.push(`${errors} error(s)`);
  const tailStr = tail.length > 0 ? ` · ${tail.join(' · ')}` : '';

  if (status === 'success') return `Created ${created}.${tailStr}`;
  if (status === 'partial') return `Partial commit: ${created}.${tailStr}`;
  if (status === 'failed') return `Commit failed.${tailStr}`;
  return `Commit blocked.${tailStr}`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown error';
}

// ============================================================================
// PUBLIC: re-export the underlying summary calculator (unused in this file
// but handy for the UI when it wants the live numbers post-commit).
// ============================================================================

export { calculateGoalArchitectureSummary };
