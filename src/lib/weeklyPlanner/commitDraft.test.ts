// src/lib/weeklyPlanner/commitDraft.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  commitWeeklyPlanDraft,
  draftBlockToTimeBlockInput,
  getCommittableBlocks,
  getDateISOForWeekDay,
  isDraftBlockCommittable,
  isDuplicateDraftBlock,
  validateDraftForCommit,
  wpiKey,
  type CommitTimeBlockInput,
  type ExistingTimeBlockSnapshot,
} from './commitDraft';
import { generateWeeklyDraft } from './scheduler';
import type {
  DraftTimeBlock,
  GoalLike,
  GoalMappingCandidate,
  PlanConflict,
  ProjectLike,
  TaskLike,
  WeeklyPlanDraft,
} from './types';

const GOALS: GoalLike[] = [
  { id: 'g_chess', title: 'Chess Mastery' },
  { id: 'g_career', title: 'Career 2026' },
  { id: 'g_physique', title: 'Model Physique' },
  { id: 'g_intel', title: 'Intelligence Engine' },
];
const PROJECTS: ProjectLike[] = [
  { id: 'p_openings', title: 'Openings', goalId: 'g_chess' },
  { id: 'p_jobs', title: 'Job Applications', goalId: 'g_career' },
  { id: 'p_strength', title: 'Strength Training', goalId: 'g_physique' },
  { id: 'p_reading', title: 'Reading', goalId: 'g_intel' },
];
const TASKS: TaskLike[] = [
  {
    id: 't_catalan',
    title: 'Catalan Course',
    projectId: 'p_openings',
    goalId: 'g_chess',
  },
];

const RAW = {
  id: 'raw-commit',
  weekStartISO: '2026-01-05', // Monday
  createdAtISO: '2026-01-04T20:00:00.000Z',
} as const;

function draftFor(text: string): WeeklyPlanDraft {
  const { draft } = generateWeeklyDraft({
    raw: { ...RAW, text },
    goals: GOALS,
    projects: PROJECTS,
    tasks: TASKS,
  });
  return draft;
}

function manualBlock(over: Partial<DraftTimeBlock>): DraftTimeBlock {
  return {
    id: 'b',
    intentId: 'i',
    label: 'A',
    day: 0,
    startTime: '09:00',
    endTime: '10:00',
    durationMinutes: 60,
    activityType: 'task',
    energyLevel: 'medium',
    flexibility: 'flexible',
    confidence: 1,
    sourceText: 'A',
    isRoutine: false,
    ...over,
  };
}

// ============================================================================
// date / time helpers
// ============================================================================

describe('getDateISOForWeekDay', () => {
  it('day 0 returns the weekStartISO itself', () => {
    expect(getDateISOForWeekDay('2026-01-05', 0)).toBe('2026-01-05');
  });
  it('day N returns weekStartISO + N days', () => {
    expect(getDateISOForWeekDay('2026-01-05', 1)).toBe('2026-01-06');
    expect(getDateISOForWeekDay('2026-01-05', 6)).toBe('2026-01-11');
  });
  it('handles month rollover', () => {
    expect(getDateISOForWeekDay('2026-01-26', 6)).toBe('2026-02-01');
  });
  it('throws on malformed weekStartISO', () => {
    expect(() => getDateISOForWeekDay('not-a-date', 0)).toThrow();
  });
});

// ============================================================================
// validation
// ============================================================================

describe('validateDraftForCommit', () => {
  it('blocks commit when any block is unmapped', () => {
    const draft = draftFor('Lunedì laundry alle 14.'); // no fixture matches
    const v = validateDraftForCommit(draft, []);
    expect(v.canCommit).toBe(false);
    expect(v.blockedReasons.some((r) => r.type === 'unmapped_block')).toBe(true);
  });

  it('blocks commit when any block is needs_review', () => {
    const draft = draftFor('Lunedì studio cose 1 ora.');
    // Force a needs_review mapping on one block.
    const m: GoalMappingCandidate = {
      intentId: draft.parsedIntents[0]?.id ?? 'x',
      status: 'needs_review',
      goalId: 'g_chess',
      confidence: 0.6,
      reason: 'test',
      matchedKeywords: [],
    };
    if (draft.blocks[0]) draft.blocks[0].mapping = m;
    const v = validateDraftForCommit(draft, []);
    expect(v.canCommit).toBe(false);
    expect(v.blockedReasons.some((r) => r.type === 'needs_review')).toBe(true);
  });

  it('blocks commit when a block is in an error-severity conflict', () => {
    const draft = draftFor('Lunedì Catalana 2 ore.');
    if (draft.blocks[0]) {
      draft.blocks[0].mapping = {
        intentId: draft.blocks[0].intentId,
        status: 'mapped',
        taskId: 't_catalan',
        projectId: 'p_openings',
        goalId: 'g_chess',
        confidence: 1,
        reason: 'fixture',
        matchedKeywords: [],
      };
    }
    const errorConflict: PlanConflict = {
      id: 'c',
      type: 'overlap',
      severity: 'error',
      message: 'x',
      blockIds: [draft.blocks[0]?.id ?? 'b'],
      intentIds: [draft.blocks[0]?.intentId ?? 'i'],
    };
    draft.conflicts = [errorConflict];
    const v = validateDraftForCommit(draft, []);
    expect(v.canCommit).toBe(false);
    expect(v.blockedReasons.some((r) => r.type === 'error_conflict')).toBe(true);
  });

  it('skips maintenance blocks (non-blocking) and commits the rest', () => {
    const draft = draftFor(
      'Mi sveglio ogni giorno alle 7. Lunedì Catalana 2 ore.',
    );
    const v = validateDraftForCommit(draft, []);
    // Every routine block is skipped as maintenance — those are non-blocking.
    expect(v.skipped.some((s) => s.reason === 'maintenance')).toBe(true);
    // The chess block is committable iff its mapping resolved to a task.
    const catalanaBlock = draft.blocks.find(
      (b) => b.mapping?.taskId === 't_catalan',
    );
    expect(catalanaBlock).toBeDefined();
    expect(v.committableBlocks.some((b) => b.id === catalanaBlock?.id)).toBe(true);
    // canCommit becomes true because at least one committable block exists.
    expect(v.canCommit).toBe(true);
  });

  it('emits no_committable_blocks when every block is maintenance', () => {
    const draft = draftFor('Mi sveglio ogni giorno alle 7.');
    const v = validateDraftForCommit(draft, []);
    expect(v.canCommit).toBe(false);
    expect(
      v.blockedReasons.some((r) => r.type === 'no_committable_blocks'),
    ).toBe(true);
  });
});

// ============================================================================
// duplicates
// ============================================================================

describe('isDuplicateDraftBlock', () => {
  function buildMapped(): { draft: WeeklyPlanDraft; block: DraftTimeBlock } {
    const draft = draftFor('Lunedì Catalana 2 ore.');
    const block = draft.blocks[0];
    if (!block) throw new Error('missing block fixture');
    return { draft, block };
  }

  it('detects duplicates by WPI_KEY', () => {
    const { draft, block } = buildMapped();
    const existing: ExistingTimeBlockSnapshot[] = [
      {
        id: 'tb1',
        notes: `something\nWPI_KEY: ${wpiKey(draft.id, block.id)}\n`,
        startTime: new Date('2099-01-01T00:00:00Z'), // intentionally wrong
        endTime: new Date('2099-01-01T01:00:00Z'),
      },
    ];
    expect(isDuplicateDraftBlock(block, existing, draft)).toBe(true);
  });

  it('detects structural duplicates by (entity, date, start, end)', () => {
    const { draft, block } = buildMapped();
    const dateISO = getDateISOForWeekDay(draft.weekStartISO, block.day);
    const start = new Date(`${dateISO}T${block.startTime}:00`);
    const end = new Date(`${dateISO}T${block.endTime}:00`);
    const existing: ExistingTimeBlockSnapshot[] = [
      {
        id: 'tb_existing',
        startTime: start,
        endTime: end,
        taskId: block.mapping?.taskId,
      },
    ];
    expect(isDuplicateDraftBlock(block, existing, draft)).toBe(true);
  });

  it('does NOT flag duplicate when entity differs', () => {
    const { draft, block } = buildMapped();
    const dateISO = getDateISOForWeekDay(draft.weekStartISO, block.day);
    const start = new Date(`${dateISO}T${block.startTime}:00`);
    const end = new Date(`${dateISO}T${block.endTime}:00`);
    const existing: ExistingTimeBlockSnapshot[] = [
      {
        id: 'tb_other',
        startTime: start,
        endTime: end,
        taskId: 'completely-different-task',
      },
    ];
    expect(isDuplicateDraftBlock(block, existing, draft)).toBe(false);
  });
});

// ============================================================================
// mapping
// ============================================================================

describe('draftBlockToTimeBlockInput', () => {
  it('maps every required field of the DataProvider.createTimeBlock payload', () => {
    const draft = draftFor('Lunedì Catalana 2 ore.');
    const block = draft.blocks[0];
    expect(block).toBeDefined();
    if (!block) return;
    const payload: CommitTimeBlockInput = draftBlockToTimeBlockInput(block, draft);
    expect(payload.title).toBe(block.label);
    expect(payload.status).toBe('planned');
    expect(payload.type).toBe('deep'); // chess → deep
    expect(payload.taskId).toBe('t_catalan');
    expect(payload.projectId).toBe('p_openings');
    expect(payload.goalId).toBe('g_chess');
    expect(payload.startTime).toBeInstanceOf(Date);
    expect(payload.endTime).toBeInstanceOf(Date);
    expect(payload.endTime.getTime() - payload.startTime.getTime()).toBe(
      block.durationMinutes * 60_000,
    );
    expect(payload.notes).toMatch(/WPI_KEY: wpi:/);
    expect(payload.notes).toContain(`wpi:${draft.id}:${block.id}`);
  });

  it('throws on malformed weekStartISO via getDateISOForWeekDay', () => {
    const draft = draftFor('Lunedì Catalana 2 ore.');
    const block = draft.blocks[0];
    if (!block) return;
    const broken: WeeklyPlanDraft = { ...draft, weekStartISO: 'nope' };
    expect(() => draftBlockToTimeBlockInput(block, broken)).toThrow();
  });
});

// ============================================================================
// commit pipeline
// ============================================================================

describe('commitWeeklyPlanDraft', () => {
  it('returns blocked + zero creations when nothing is committable', async () => {
    const draft = draftFor('Mi sveglio ogni giorno alle 7.');
    const create = vi.fn();
    const result = await commitWeeklyPlanDraft({
      draft,
      existingTimeBlocks: [],
      createTimeBlock: create,
    });
    expect(result.status).toBe('blocked');
    expect(result.createdCount).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('commits only mapped, non-maintenance, conflict-free blocks', async () => {
    const draft = draftFor(
      'Mi sveglio ogni giorno alle 7. Lunedì Catalana 2 ore.',
    );
    const created: CommitTimeBlockInput[] = [];
    const create = vi.fn(async (input: CommitTimeBlockInput) => {
      created.push(input);
    });
    const result = await commitWeeklyPlanDraft({
      draft,
      existingTimeBlocks: [],
      createTimeBlock: create,
    });
    expect(result.status).toBe('success');
    expect(result.createdCount).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0].taskId).toBe('t_catalan');
    expect(created[0].notes).toContain('WPI_KEY: wpi:');
    expect(
      result.skipped.some((s) => s.reason === 'maintenance'),
    ).toBe(true);
  });

  it('is idempotent: second commit detects WPI_KEY duplicates and creates nothing', async () => {
    const draft = draftFor('Lunedì Catalana 2 ore.');
    const created: CommitTimeBlockInput[] = [];
    const create = vi.fn(async (input: CommitTimeBlockInput) => {
      created.push(input);
    });

    // First commit.
    const r1 = await commitWeeklyPlanDraft({
      draft,
      existingTimeBlocks: [],
      createTimeBlock: create,
    });
    expect(r1.createdCount).toBeGreaterThan(0);

    // Simulate the freshly-committed TimeBlock in existing data.
    const simulatedExisting: ExistingTimeBlockSnapshot[] = created.map(
      (p, idx) => ({
        id: `tb_sim_${idx}`,
        notes: p.notes,
        startTime: p.startTime,
        endTime: p.endTime,
        taskId: p.taskId,
        projectId: p.projectId,
        goalId: p.goalId,
      }),
    );

    // Second commit with the existing snapshot.
    const create2 = vi.fn(async () => {});
    const r2 = await commitWeeklyPlanDraft({
      draft,
      existingTimeBlocks: simulatedExisting,
      createTimeBlock: create2,
    });
    expect(r2.createdCount).toBe(0);
    expect(create2).not.toHaveBeenCalled();
    expect(r2.duplicateCount).toBeGreaterThan(0);
  });

  it('reports partial when createTimeBlock throws on one block', async () => {
    // Two committable chess blocks on different days.
    const draft = draftFor('Lunedì Catalana 1 ora. Martedì Catalana 1 ora.');
    let calls = 0;
    const create = vi.fn(async () => {
      calls++;
      if (calls === 2) throw new Error('boom');
    });
    const result = await commitWeeklyPlanDraft({
      draft,
      existingTimeBlocks: [],
      createTimeBlock: create,
    });
    expect(result.status).toBe('partial');
    expect(result.createdCount).toBe(1);
    expect(result.skipped.some((s) => /boom/.test(s.message))).toBe(true);
  });
});

// ============================================================================
// committability helpers
// ============================================================================

describe('isDraftBlockCommittable / getCommittableBlocks', () => {
  it('isDraftBlockCommittable returns false for unmapped', () => {
    const block = manualBlock({ activityType: 'task' });
    expect(isDraftBlockCommittable(block, [])).toBe(false);
  });

  it('isDraftBlockCommittable returns true for fully mapped, non-conflict', () => {
    const block = manualBlock({
      activityType: 'chess',
      mapping: {
        intentId: 'i',
        status: 'mapped',
        taskId: 't',
        confidence: 1,
        reason: 'fixture',
        matchedKeywords: [],
      },
    });
    expect(isDraftBlockCommittable(block, [])).toBe(true);
  });

  it('getCommittableBlocks filters out maintenance and duplicates', () => {
    const draft = draftFor(
      'Mi sveglio ogni giorno alle 7. Lunedì Catalana 2 ore.',
    );
    const blocks = getCommittableBlocks(draft, []);
    // Routine "sveglia" blocks must not appear.
    expect(blocks.every((b) => b.activityType !== 'routine')).toBe(true);
    // The chess block must appear.
    expect(blocks.some((b) => b.activityType === 'chess')).toBe(true);
  });
});
