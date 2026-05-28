// src/lib/weeklyPlanner/commitDraft.ts
// Safe draft → real TimeBlock commit pipeline.
//
// Design:
//   - Pure module. No React, no DataProvider import. The caller injects the
//     `createTimeBlock` callback (which in practice is `DataProvider.createTimeBlock`)
//     and the current `existingTimeBlocks` snapshot.
//   - Sequential awaits, never `Promise.all`, so a race between two clicks or
//     between this commit and the next one cannot duplicate.
//   - WPI_KEY idempotency: every block carries `wpi:${draft.id}:${block.id}` in
//     its notes. A duplicate is anything that already has the same key, OR is
//     structurally identical (same entity link + same start/end on same date).
//   - "Block" status (committable / skipped / blocking) is derived from a
//     single rule table so the UI and the runtime agree on every classification.

import type {
  ActivityType,
  ConflictType,
  DraftTimeBlock,
  PlanConflict,
  WeeklyPlanDraft,
  WeekDay,
} from './types';
import { timeToMinutes } from './timeUtils';

// ============================================================================
// I/O TYPES (kept minimal so they don't couple this module to `@/types`)
// ============================================================================

/**
 * Subset of `TimeBlock` we need to construct. Every field below also exists
 * on the real `TimeBlock`, so passing this object directly into
 * `DataProvider.createTimeBlock(data: Partial<TimeBlock>)` type-checks.
 */
export interface CommitTimeBlockInput {
  title: string;
  startTime: Date;
  endTime: Date;
  status: 'planned';
  type: TimeBlockKind;
  taskId?: string;
  projectId?: string;
  goalId?: string;
  notes?: string;
}

export type TimeBlockKind =
  | 'work'
  | 'break'
  | 'buffer'
  | 'travel'
  | 'meeting'
  | 'focus'
  | 'admin'
  | 'deep'
  | 'shallow';

/**
 * Subset of an existing `TimeBlock` used for duplicate detection AND for
 * downstream WPI analytics (Prompt 5). The `title`/`status`/`type` fields
 * are optional here because the commit pipeline doesn't read them, but the
 * analytics module does. Real TimeBlocks have `startTime: Date`, drafts
 * read from storage may have stringified dates — we accept both.
 */
export interface ExistingTimeBlockSnapshot {
  id: string;
  title?: string;
  notes?: string;
  startTime: Date | string;
  endTime: Date | string;
  status?: string;
  type?: string;
  taskId?: string;
  projectId?: string;
  goalId?: string;
}

export type CreateTimeBlockFn = (
  input: CommitTimeBlockInput,
) => Promise<unknown> | unknown;

// ============================================================================
// RESULT TYPES
// ============================================================================

export type SkipReason =
  | 'maintenance'
  | 'unmapped'
  | 'needs_review'
  | 'duplicate'
  | 'invalid'
  | 'error_conflict';

export type BlockedReasonType =
  | 'error_conflict'
  | 'unmapped_block'
  | 'needs_review'
  | 'invalid_time'
  | 'missing_entity_link'
  | 'no_committable_blocks';

export interface CommitBlockedReason {
  type: BlockedReasonType;
  message: string;
  blockId?: string;
  intentId?: string;
}

export interface CommitSkippedItem {
  blockId: string;
  label: string;
  reason: SkipReason;
  message: string;
}

export interface CommitCreatedItem {
  blockId: string;
  label: string;
  message: string;
}

export type CommitStatus = 'success' | 'partial' | 'blocked';

export interface CommitDraftResult {
  status: CommitStatus;
  createdCount: number;
  skippedCount: number;
  duplicateCount: number;
  blockedReasons: CommitBlockedReason[];
  created: CommitCreatedItem[];
  skipped: CommitSkippedItem[];
  message: string;
}

export interface CommitDraftInput {
  draft: WeeklyPlanDraft;
  existingTimeBlocks: ReadonlyArray<ExistingTimeBlockSnapshot>;
  createTimeBlock: CreateTimeBlockFn;
}

// ============================================================================
// PRE-FLIGHT VALIDATION (pure, no side effects)
// ============================================================================

export interface CommitValidationResult {
  canCommit: boolean;
  blockedReasons: CommitBlockedReason[];
  committableBlocks: DraftTimeBlock[];
  skipped: CommitSkippedItem[];
  duplicateCount: number;
}

export function validateDraftForCommit(
  draft: WeeklyPlanDraft,
  existingTimeBlocks: ReadonlyArray<ExistingTimeBlockSnapshot>,
): CommitValidationResult {
  const blockedReasons: CommitBlockedReason[] = [];
  const skipped: CommitSkippedItem[] = [];
  const committable: DraftTimeBlock[] = [];

  const errorConflictBlockIds = collectErrorConflictBlockIds(draft.conflicts);
  let duplicateCount = 0;

  for (const block of draft.blocks) {
    const decision = classifyBlock(block, errorConflictBlockIds);

    if (decision.kind === 'commit') {
      // Duplicate check happens here so it counts toward `skipped` not `blocked`.
      if (isDuplicateDraftBlock(block, existingTimeBlocks, draft)) {
        duplicateCount++;
        skipped.push({
          blockId: block.id,
          label: block.label,
          reason: 'duplicate',
          message: 'TimeBlock già esistente per questo slot — non sarà ricreato.',
        });
      } else {
        committable.push(block);
      }
      continue;
    }

    // Non-commit decisions are split into "skip" (info) vs "blocked" (must fix).
    skipped.push({
      blockId: block.id,
      label: block.label,
      reason: decision.skipReason,
      message: decision.message,
    });
    if (decision.blocking) {
      blockedReasons.push({
        type: decision.blockedReasonType,
        message: decision.message,
        blockId: block.id,
        intentId: block.intentId,
      });
    }
  }

  if (committable.length === 0 && blockedReasons.length === 0) {
    blockedReasons.push({
      type: 'no_committable_blocks',
      message:
        'Nessun blocco può essere committato: tutti sono di manutenzione, duplicati o invalidi.',
    });
  }

  return {
    canCommit: blockedReasons.length === 0 && committable.length > 0,
    blockedReasons,
    committableBlocks: committable,
    skipped,
    duplicateCount,
  };
}

// ============================================================================
// PER-BLOCK CLASSIFIER (single source of truth for UI + runtime)
// ============================================================================

type BlockDecision =
  | { kind: 'commit' }
  | {
      kind: 'skip';
      skipReason: SkipReason;
      message: string;
      blocking: false;
    }
  | {
      kind: 'skip';
      skipReason: SkipReason;
      message: string;
      blocking: true;
      blockedReasonType: BlockedReasonType;
    };

function classifyBlock(
  block: DraftTimeBlock,
  errorConflictBlockIds: ReadonlySet<string>,
): BlockDecision {
  // 1. Invalid duration / time geometry (always blocking — engine bug).
  if (block.durationMinutes <= 0) {
    return {
      kind: 'skip',
      skipReason: 'invalid',
      message: `Durata non valida per "${block.label}".`,
      blocking: true,
      blockedReasonType: 'invalid_time',
    };
  }
  let startMin: number;
  let endMin: number;
  try {
    startMin = timeToMinutes(block.startTime);
    endMin = timeToMinutes(block.endTime);
  } catch {
    return {
      kind: 'skip',
      skipReason: 'invalid',
      message: `Orario malformato per "${block.label}".`,
      blocking: true,
      blockedReasonType: 'invalid_time',
    };
  }
  if (endMin <= startMin) {
    return {
      kind: 'skip',
      skipReason: 'invalid',
      message: `Orario non valido per "${block.label}" (${block.startTime}–${block.endTime}).`,
      blocking: true,
      blockedReasonType: 'invalid_time',
    };
  }

  // 2. Error-severity conflict → blocking until resolved.
  if (errorConflictBlockIds.has(block.id)) {
    return {
      kind: 'skip',
      skipReason: 'error_conflict',
      message: `"${block.label}" è coinvolto in un conflitto severo: risolvere prima del commit.`,
      blocking: true,
      blockedReasonType: 'error_conflict',
    };
  }

  // 3. Mapping status decides commit eligibility.
  const status = block.mapping?.status;

  if (status === 'maintenance' || block.activityType === 'maintenance') {
    return {
      kind: 'skip',
      skipReason: 'maintenance',
      message: `"${block.label}" è una routine di manutenzione: non viene committata in questo MVP.`,
      blocking: false,
    };
  }

  if (!status || status === 'unmapped') {
    return {
      kind: 'skip',
      skipReason: 'unmapped',
      message: `"${block.label}" non è collegato a nessun Goal/Project/Task.`,
      blocking: true,
      blockedReasonType: 'unmapped_block',
    };
  }

  if (status === 'needs_review') {
    return {
      kind: 'skip',
      skipReason: 'needs_review',
      message: `"${block.label}" ha mapping ambiguo: confermare manualmente prima del commit.`,
      blocking: true,
      blockedReasonType: 'needs_review',
    };
  }

  // 4. Mapped but with no entity link → defensive guard (shouldn't happen but
  //    DataProvider.createTimeBlock would throw, so we surface clearly).
  const m = block.mapping;
  if (!m || (!m.taskId && !m.projectId && !m.goalId)) {
    return {
      kind: 'skip',
      skipReason: 'unmapped',
      message: `"${block.label}" è marcato come mapped ma non ha taskId/projectId/goalId.`,
      blocking: true,
      blockedReasonType: 'missing_entity_link',
    };
  }

  return { kind: 'commit' };
}

function collectErrorConflictBlockIds(
  conflicts: ReadonlyArray<PlanConflict>,
): ReadonlySet<string> {
  const out = new Set<string>();
  const blockingTypes: ReadonlySet<ConflictType> = new Set<ConflictType>([
    'overlap',
    'routine_collision',
    'invalid_time',
    'missing_duration',
  ]);
  for (const c of conflicts) {
    if (c.severity === 'error' || blockingTypes.has(c.type)) {
      for (const id of c.blockIds) out.add(id);
    }
  }
  return out;
}

// ============================================================================
// PUBLIC HELPERS (exposed for the UI and tests)
// ============================================================================

export function getCommittableBlocks(
  draft: WeeklyPlanDraft,
  existingTimeBlocks: ReadonlyArray<ExistingTimeBlockSnapshot>,
): DraftTimeBlock[] {
  return validateDraftForCommit(draft, existingTimeBlocks).committableBlocks;
}

export function isDraftBlockCommittable(
  block: DraftTimeBlock,
  conflicts: ReadonlyArray<PlanConflict>,
): boolean {
  const errorIds = collectErrorConflictBlockIds(conflicts);
  return classifyBlock(block, errorIds).kind === 'commit';
}

// ============================================================================
// DATE / TIME MAPPING
// ============================================================================

export function getDateISOForWeekDay(
  weekStartISO: string,
  day: WeekDay,
): string {
  const parts = weekStartISO.split('-').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(
      `getDateISOForWeekDay: invalid weekStartISO "${weekStartISO}"`,
    );
  }
  const [y, m, d] = parts;
  const monday = new Date(y, m - 1, d);
  const target = new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + day,
  );
  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, '0');
  const dd = String(target.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function combineDateAndTime(dateISO: string, timeHHmm: string): Date {
  const [y, m, d] = dateISO.split('-').map((n) => parseInt(n, 10));
  const [hh, mm] = timeHHmm.split(':').map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function timeBlockKindForActivity(t: ActivityType): TimeBlockKind {
  switch (t) {
    case 'chess':
    case 'career':
    case 'deep_work':
      return 'deep';
    case 'reading':
      return 'focus';
    case 'exercise':
      return 'work';
    case 'event':
      return 'meeting';
    case 'routine':
    case 'maintenance':
      // These don't commit, but the mapping exists for completeness.
      return 'admin';
    case 'task':
    case 'unknown':
    default:
      return 'work';
  }
}

export function wpiKey(draftId: string, blockId: string): string {
  return `wpi:${draftId}:${blockId}`;
}

export function draftBlockToTimeBlockInput(
  block: DraftTimeBlock,
  draft: WeeklyPlanDraft,
): CommitTimeBlockInput {
  const dateISO = getDateISOForWeekDay(draft.weekStartISO, block.day);
  const startTime = combineDateAndTime(dateISO, block.startTime);
  const endTime = combineDateAndTime(dateISO, block.endTime);

  const m = block.mapping;
  const notes =
    `Generated by Weekly Planning Intelligence.\n` +
    `Source: ${block.sourceText}\n` +
    `WPI_KEY: ${wpiKey(draft.id, block.id)}`;

  return {
    title: block.label,
    startTime,
    endTime,
    status: 'planned',
    type: timeBlockKindForActivity(block.activityType),
    taskId: m?.taskId,
    projectId: m?.projectId,
    goalId: m?.goalId,
    notes,
  };
}

// ============================================================================
// DUPLICATE DETECTION
// ============================================================================

export function isDuplicateDraftBlock(
  block: DraftTimeBlock,
  existingTimeBlocks: ReadonlyArray<ExistingTimeBlockSnapshot>,
  draft: WeeklyPlanDraft,
): boolean {
  const key = wpiKey(draft.id, block.id);

  // Cheap path 1: WPI_KEY already in an existing block's notes.
  for (const existing of existingTimeBlocks) {
    if (existing.notes && existing.notes.includes(key)) return true;
  }

  // Cheap path 2: structural — same entity link + same date + same start/end.
  const dateISO = getDateISOForWeekDay(draft.weekStartISO, block.day);
  const targetStartISO = combineDateAndTime(dateISO, block.startTime).toISOString();
  const targetEndISO = combineDateAndTime(dateISO, block.endTime).toISOString();

  const m = block.mapping;
  const targetTaskId = m?.taskId;
  const targetProjectId = m?.projectId;
  const targetGoalId = m?.goalId;

  for (const existing of existingTimeBlocks) {
    const existingStart = toIsoDate(existing.startTime);
    const existingEnd = toIsoDate(existing.endTime);
    if (existingStart !== targetStartISO || existingEnd !== targetEndISO) {
      continue;
    }
    const matchesTask = !!targetTaskId && existing.taskId === targetTaskId;
    const matchesProject = !!targetProjectId && existing.projectId === targetProjectId;
    const matchesGoal = !!targetGoalId && existing.goalId === targetGoalId;
    if (matchesTask || matchesProject || matchesGoal) return true;
  }

  return false;
}

function toIsoDate(v: Date | string): string {
  if (v instanceof Date) return v.toISOString();
  // Already an ISO string (from a re-hydrated draft) — round-trip through
  // Date to normalize formats like "2026-05-25T08:00" vs "2026-05-25T08:00:00.000Z".
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

// ============================================================================
// COMMIT PIPELINE
// ============================================================================

export async function commitWeeklyPlanDraft(
  input: CommitDraftInput,
): Promise<CommitDraftResult> {
  const validation = validateDraftForCommit(
    input.draft,
    input.existingTimeBlocks,
  );

  // Blocked: no creation attempts at all. UI shows reasons; user fixes mapping.
  if (!validation.canCommit) {
    return {
      status: 'blocked',
      createdCount: 0,
      skippedCount: validation.skipped.length,
      duplicateCount: validation.duplicateCount,
      blockedReasons: validation.blockedReasons,
      created: [],
      skipped: validation.skipped,
      message:
        validation.blockedReasons.length > 0
          ? buildBlockedMessage(validation.blockedReasons)
          : 'Nessun blocco è committabile.',
    };
  }

  const created: CommitCreatedItem[] = [];
  const skipped: CommitSkippedItem[] = [...validation.skipped];
  const committedKeys = new Set<string>();

  // Sequential awaits: no Promise.all here. A failed call doesn't poison
  // the others; we record it and continue. Idempotency Set guards against
  // accidental in-run duplicates (e.g. duplicate ids in the draft itself).
  for (const block of validation.committableBlocks) {
    const key = wpiKey(input.draft.id, block.id);
    if (committedKeys.has(key)) {
      skipped.push({
        blockId: block.id,
        label: block.label,
        reason: 'duplicate',
        message: 'Duplicato in-run — non ri-creato.',
      });
      continue;
    }
    try {
      const payload = draftBlockToTimeBlockInput(block, input.draft);
      await input.createTimeBlock(payload);
      committedKeys.add(key);
      created.push({
        blockId: block.id,
        label: block.label,
        message: `Creato TimeBlock per "${block.label}".`,
      });
    } catch (err) {
      skipped.push({
        blockId: block.id,
        label: block.label,
        reason: 'invalid',
        message: `Errore durante la creazione di "${block.label}": ${errorMessage(err)}`,
      });
    }
  }

  const status: CommitStatus =
    created.length === validation.committableBlocks.length
      ? 'success'
      : 'partial';

  return {
    status,
    createdCount: created.length,
    skippedCount: skipped.length,
    duplicateCount: validation.duplicateCount,
    blockedReasons: [],
    created,
    skipped,
    message: buildResultMessage(status, created.length, skipped.length),
  };
}

// ============================================================================
// MESSAGE BUILDERS
// ============================================================================

function buildBlockedMessage(reasons: ReadonlyArray<CommitBlockedReason>): string {
  if (reasons.length === 1) return reasons[0].message;
  const summary = summarizeBlockedReasons(reasons);
  return `Commit bloccato: ${summary}`;
}

function summarizeBlockedReasons(
  reasons: ReadonlyArray<CommitBlockedReason>,
): string {
  const counts: Record<BlockedReasonType, number> = {
    error_conflict: 0,
    unmapped_block: 0,
    needs_review: 0,
    invalid_time: 0,
    missing_entity_link: 0,
    no_committable_blocks: 0,
  };
  for (const r of reasons) counts[r.type]++;
  const parts: string[] = [];
  if (counts.unmapped_block) parts.push(`${counts.unmapped_block} non mappati`);
  if (counts.needs_review) parts.push(`${counts.needs_review} da rivedere`);
  if (counts.error_conflict) parts.push(`${counts.error_conflict} conflitti severi`);
  if (counts.invalid_time) parts.push(`${counts.invalid_time} orari invalidi`);
  if (counts.missing_entity_link)
    parts.push(`${counts.missing_entity_link} senza link entità`);
  if (counts.no_committable_blocks) parts.push('nessun blocco committabile');
  return parts.join(', ');
}

function buildResultMessage(
  status: CommitStatus,
  created: number,
  skipped: number,
): string {
  if (status === 'success') {
    return `Creati ${created} TimeBlock. ${skipped > 0 ? `${skipped} saltati.` : ''}`.trim();
  }
  if (status === 'partial') {
    return `Commit parziale: ${created} creati, ${skipped} saltati o falliti.`;
  }
  return 'Commit bloccato.';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'errore sconosciuto';
}
