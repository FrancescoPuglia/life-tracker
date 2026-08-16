/*
 * Adapter around the existing Weekly Planning Intelligence pure core.
 * `require` is intentional: esbuild follows these literal paths and bundles
 * the proven WPI invariants into the Functions artifact without deploying the
 * whole Next.js application or coupling this layer to React/DataProvider.
 */

interface WpiBlock {
  id: string;
  intentId: string;
  label: string;
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  activityType: string;
  energyLevel: string;
  flexibility: string;
  mapping?: Readonly<Record<string, unknown>>;
  confidence: number;
  sourceText: string;
  isRoutine: boolean;
}

interface WpiDraft {
  id: string;
  weekStartISO: string;
  sourceIntent: Readonly<Record<string, unknown>>;
  parsedIntents: readonly Readonly<Record<string, unknown>>[];
  blocks: readonly WpiBlock[];
  conflicts: readonly Readonly<Record<string, unknown>>[];
  warnings: readonly Readonly<Record<string, unknown>>[];
  realismScore: Readonly<Record<string, unknown>>;
  generatedAtISO: string;
  status: 'draft';
}

interface WpiModule {
  detectConflicts(
    blocks: readonly WpiBlock[],
    intents: readonly Readonly<Record<string, unknown>>[],
    constraints: Readonly<Record<string, unknown>>,
  ): {
    conflicts: readonly Readonly<Record<string, unknown>>[];
    warnings: readonly Readonly<Record<string, unknown>>[];
  };
}

interface WpiCommitModule {
  validateDraftForCommit(
    draft: WpiDraft,
    existing: readonly Readonly<Record<string, unknown>>[],
  ): {
    canCommit: boolean;
    blockedReasons: readonly Readonly<Record<string, unknown>>[];
    committableBlocks: readonly WpiBlock[];
  };
  draftBlockToTimeBlockInput(
    block: WpiBlock,
    draft: WpiDraft,
  ): Readonly<Record<string, unknown>>;
}

const conflictsModule = require('../../../../src/lib/weeklyPlanner/conflicts') as WpiModule;
const commitModule = require('../../../../src/lib/weeklyPlanner/commitDraft') as WpiCommitModule;

const DEFAULT_CONSTRAINTS = Object.freeze({
  earliestHour: '00:00',
  latestHour: '24:00',
  maxDailyPlannedMinutes: 24 * 60,
  maxWeeklyPlannedMinutes: 7 * 24 * 60,
  minBufferMinutes: 0,
  maxConsecutiveHighEnergyBlocks: 24,
});

export interface WpiValidationResult {
  readonly conflicts: readonly string[];
  readonly warnings: readonly string[];
  readonly generatedNotes: Readonly<Record<string, string>>;
}

export function validateWithWeeklyPlanningIntelligence(
  draft: WpiDraft,
): WpiValidationResult {
  const detected = conflictsModule.detectConflicts(
    draft.blocks,
    draft.parsedIntents,
    DEFAULT_CONSTRAINTS,
  );
  const completeDraft: WpiDraft = {
    ...draft,
    conflicts: detected.conflicts,
    warnings: detected.warnings,
  };

  // Productive blocks use WPI's mapping/review validation. Calendar-only
  // break/buffer/admin blocks are intentionally excluded from entity mapping.
  const mappedIds = new Set(
    completeDraft.blocks
      .filter((block) => Boolean(block.mapping && block.mapping.status === 'mapped'))
      .map((block) => block.id),
  );
  const mappedDraft: WpiDraft = {
    ...completeDraft,
    blocks: completeDraft.blocks.filter((block) => mappedIds.has(block.id)),
    conflicts: completeDraft.conflicts.filter((conflict) =>
      Array.isArray(conflict.blockIds) && conflict.blockIds.some((id) => typeof id === 'string' && mappedIds.has(id)),
    ),
  };
  const validation = mappedDraft.blocks.length
    ? commitModule.validateDraftForCommit(mappedDraft, [])
    : { canCommit: true, blockedReasons: [], committableBlocks: [] };

  const generatedNotes: Record<string, string> = {};
  for (const block of validation.committableBlocks) {
    // The WPI converter remains the source for WPI_KEY/idempotency metadata.
    // Its Date values are deliberately ignored; Temporal supplies the instants.
    const converted = commitModule.draftBlockToTimeBlockInput(block, completeDraft);
    if (typeof converted.notes === 'string') generatedNotes[block.id] = converted.notes;
  }

  const conflicts = detected.conflicts
    .filter((conflict) => conflict.severity === 'error')
    .map(messageOf);
  conflicts.push(...validation.blockedReasons.map(messageOf));
  const warnings = [
    ...detected.conflicts.filter((conflict) => conflict.severity !== 'error').map(messageOf),
    ...detected.warnings.map(messageOf),
  ];
  return { conflicts: unique(conflicts), warnings: unique(warnings), generatedNotes };
}

function messageOf(value: Readonly<Record<string, unknown>>): string {
  return typeof value.message === 'string' ? value.message : 'Weekly Planning Intelligence validation failed.';
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

export type { WpiBlock, WpiDraft };
