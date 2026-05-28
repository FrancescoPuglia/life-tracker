// src/lib/weeklyPlanner/draftStore.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildWeeklyDraftStorageKey,
  deleteWeeklyPlanDraft,
  isWeeklyPlanDraftLike,
  listWeeklyPlanDraftKeys,
  loadWeeklyPlanDraft,
  saveWeeklyPlanDraft,
} from './draftStore';
import { generateWeeklyDraft } from './scheduler';
import type { WeeklyPlanDraft } from './types';

function buildSampleDraft(text: string, weekStartISO = '2026-01-05'): WeeklyPlanDraft {
  const { draft } = generateWeeklyDraft({
    raw: {
      id: 'raw-store',
      text,
      weekStartISO,
      createdAtISO: '2026-01-04T00:00:00.000Z',
    },
    goals: [],
    projects: [],
    tasks: [],
  });
  return draft;
}

describe('buildWeeklyDraftStorageKey', () => {
  it('uses the canonical prefix + user + week', () => {
    expect(buildWeeklyDraftStorageKey('user-1', '2026-01-05')).toBe(
      'weekly-plan-draft:user-1:2026-01-05',
    );
  });

  it('falls back to "local" when userIdOrLocal is empty', () => {
    expect(buildWeeklyDraftStorageKey('', '2026-01-05')).toBe(
      'weekly-plan-draft:local:2026-01-05',
    );
    expect(buildWeeklyDraftStorageKey('   ', '2026-01-05')).toBe(
      'weekly-plan-draft:local:2026-01-05',
    );
  });
});

describe('save / load / delete roundtrip', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('save followed by load returns an equivalent draft', () => {
    const draft = buildSampleDraft('Lunedì Catalana 2 ore.');
    const saved = saveWeeklyPlanDraft({
      userIdOrLocal: 'u1',
      weekStartISO: draft.weekStartISO,
      draft,
    });
    expect(saved).toBe(true);

    const loaded = loadWeeklyPlanDraft({
      userIdOrLocal: 'u1',
      weekStartISO: draft.weekStartISO,
    });
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(draft.id);
    expect(loaded?.status).toBe('draft');
    expect(loaded?.blocks.length).toBe(draft.blocks.length);
  });

  it('returns null for an unsaved key', () => {
    expect(
      loadWeeklyPlanDraft({ userIdOrLocal: 'nobody', weekStartISO: '2026-01-05' }),
    ).toBeNull();
  });

  it('delete removes the entry', () => {
    const draft = buildSampleDraft('Palestra 4 volte a settimana.');
    saveWeeklyPlanDraft({
      userIdOrLocal: 'u1',
      weekStartISO: draft.weekStartISO,
      draft,
    });
    expect(
      loadWeeklyPlanDraft({ userIdOrLocal: 'u1', weekStartISO: draft.weekStartISO }),
    ).not.toBeNull();

    deleteWeeklyPlanDraft({
      userIdOrLocal: 'u1',
      weekStartISO: draft.weekStartISO,
    });
    expect(
      loadWeeklyPlanDraft({ userIdOrLocal: 'u1', weekStartISO: draft.weekStartISO }),
    ).toBeNull();
  });

  it('listWeeklyPlanDraftKeys returns only the WPI prefix', () => {
    window.localStorage.setItem('other-key', 'noise');
    const draft = buildSampleDraft('Leggere ogni sera 30 minuti.');
    saveWeeklyPlanDraft({
      userIdOrLocal: 'u1',
      weekStartISO: draft.weekStartISO,
      draft,
    });
    const keys = listWeeklyPlanDraftKeys();
    expect(keys).toContain(`weekly-plan-draft:u1:${draft.weekStartISO}`);
    expect(keys.every((k) => k.startsWith('weekly-plan-draft:'))).toBe(true);
  });
});

describe('robustness', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns null on corrupted JSON without throwing', () => {
    const key = buildWeeklyDraftStorageKey('u1', '2026-01-05');
    window.localStorage.setItem(key, '{not valid json');
    expect(() =>
      loadWeeklyPlanDraft({ userIdOrLocal: 'u1', weekStartISO: '2026-01-05' }),
    ).not.toThrow();
    expect(
      loadWeeklyPlanDraft({ userIdOrLocal: 'u1', weekStartISO: '2026-01-05' }),
    ).toBeNull();
  });

  it('returns null for shape-mismatched JSON', () => {
    const key = buildWeeklyDraftStorageKey('u1', '2026-01-05');
    window.localStorage.setItem(key, JSON.stringify({ id: 1, status: 'wrong' }));
    expect(
      loadWeeklyPlanDraft({ userIdOrLocal: 'u1', weekStartISO: '2026-01-05' }),
    ).toBeNull();
  });

  it('refuses to save a falsy draft', () => {
    // @ts-expect-error — testing runtime guard, not type system.
    expect(saveWeeklyPlanDraft({ userIdOrLocal: 'u1', weekStartISO: '2026-01-05', draft: null })).toBe(false);
  });
});

describe('isWeeklyPlanDraftLike', () => {
  it('accepts a real draft', () => {
    const draft = buildSampleDraft('Lunedì Catalana 2 ore.');
    expect(isWeeklyPlanDraftLike(draft)).toBe(true);
  });

  it('rejects null / non-objects', () => {
    expect(isWeeklyPlanDraftLike(null)).toBe(false);
    expect(isWeeklyPlanDraftLike(undefined)).toBe(false);
    expect(isWeeklyPlanDraftLike('draft')).toBe(false);
    expect(isWeeklyPlanDraftLike(42)).toBe(false);
    expect(isWeeklyPlanDraftLike([])).toBe(false);
  });

  it('rejects shape-mismatched objects', () => {
    expect(isWeeklyPlanDraftLike({ id: 'x' })).toBe(false);
    expect(
      isWeeklyPlanDraftLike({
        id: 'x',
        weekStartISO: 'y',
        generatedAtISO: 'z',
        status: 'committed', // wrong literal
        blocks: [],
        parsedIntents: [],
        conflicts: [],
        warnings: [],
        realismScore: {},
        sourceIntent: {},
      }),
    ).toBe(false);
  });
});
