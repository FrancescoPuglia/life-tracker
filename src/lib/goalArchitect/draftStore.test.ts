// src/lib/goalArchitect/draftStore.test.ts

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GOAL_ARCHITECT_KEY_PREFIX,
  buildGoalArchitectDraftStorageKey,
  deleteGoalArchitectureDraft,
  isGoalArchitectureDraftLike,
  listGoalArchitectureDraftKeys,
  loadGoalArchitectureDraft,
  saveGoalArchitectureDraft,
} from './draftStore';
import { parseGoalArchitecture } from './parseGoalArchitecture';
import { createChessGoalArchitectInputText } from './parserFixtures';

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe('buildGoalArchitectDraftStorageKey', () => {
  it('uses the active slot when no draft id is provided', () => {
    expect(buildGoalArchitectDraftStorageKey('user-1')).toBe(
      `${GOAL_ARCHITECT_KEY_PREFIX}:user-1:active`,
    );
  });

  it('uses the provided slot id verbatim', () => {
    expect(buildGoalArchitectDraftStorageKey('user-1', 'goal-x_abc')).toBe(
      `${GOAL_ARCHITECT_KEY_PREFIX}:user-1:goal-x_abc`,
    );
  });

  it('falls back to "local" when user id is missing or blank', () => {
    expect(buildGoalArchitectDraftStorageKey(undefined)).toBe(
      `${GOAL_ARCHITECT_KEY_PREFIX}:local:active`,
    );
    expect(buildGoalArchitectDraftStorageKey('   ')).toBe(
      `${GOAL_ARCHITECT_KEY_PREFIX}:local:active`,
    );
  });
});

describe('saveGoalArchitectureDraft / loadGoalArchitectureDraft', () => {
  it('round-trips a valid draft', () => {
    const draft = parseGoalArchitecture(createChessGoalArchitectInputText());
    const key = buildGoalArchitectDraftStorageKey('user-1');
    expect(saveGoalArchitectureDraft(key, draft)).toBe(true);
    const loaded = loadGoalArchitectureDraft(key);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(draft.id);
    expect(loaded?.projects.length).toBe(draft.projects.length);
  });

  it('returns null for a missing key', () => {
    expect(loadGoalArchitectureDraft('missing-key')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    const key = buildGoalArchitectDraftStorageKey('user-1');
    window.localStorage.setItem(key, '{not json');
    expect(loadGoalArchitectureDraft(key)).toBeNull();
  });

  it('returns null when the stored value has wrong shape', () => {
    const key = buildGoalArchitectDraftStorageKey('user-1');
    window.localStorage.setItem(key, JSON.stringify({ foo: 'bar' }));
    expect(loadGoalArchitectureDraft(key)).toBeNull();
  });

  it('refuses to save with an empty key', () => {
    const draft = parseGoalArchitecture(createChessGoalArchitectInputText());
    expect(saveGoalArchitectureDraft('', draft)).toBe(false);
  });
});

describe('deleteGoalArchitectureDraft', () => {
  it('removes the stored draft', () => {
    const draft = parseGoalArchitecture(createChessGoalArchitectInputText());
    const key = buildGoalArchitectDraftStorageKey('user-1');
    saveGoalArchitectureDraft(key, draft);
    expect(window.localStorage.getItem(key)).not.toBeNull();
    expect(deleteGoalArchitectureDraft(key)).toBe(true);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('returns true even when the key was not present', () => {
    expect(deleteGoalArchitectureDraft('not-there')).toBe(true);
  });
});

describe('listGoalArchitectureDraftKeys', () => {
  it('lists only goal-architect keys, optionally scoped by user', () => {
    const draft = parseGoalArchitecture(createChessGoalArchitectInputText());
    saveGoalArchitectureDraft(
      buildGoalArchitectDraftStorageKey('user-a'),
      draft,
    );
    saveGoalArchitectureDraft(
      buildGoalArchitectDraftStorageKey('user-b'),
      draft,
    );
    window.localStorage.setItem('weekly-plan-draft:user-a:2026-01-05', 'x');

    const all = listGoalArchitectureDraftKeys();
    expect(all.every((k) => k.startsWith(GOAL_ARCHITECT_KEY_PREFIX))).toBe(true);
    expect(all.length).toBe(2);

    const onlyA = listGoalArchitectureDraftKeys('user-a');
    expect(onlyA).toEqual([
      buildGoalArchitectDraftStorageKey('user-a'),
    ]);
  });

  it('returns an empty array when nothing is stored', () => {
    expect(listGoalArchitectureDraftKeys()).toEqual([]);
  });
});

describe('isGoalArchitectureDraftLike', () => {
  it('accepts a draft produced by the parser', () => {
    const draft = parseGoalArchitecture(createChessGoalArchitectInputText());
    expect(isGoalArchitectureDraftLike(draft)).toBe(true);
  });

  it('rejects non-objects, arrays and partial blobs', () => {
    expect(isGoalArchitectureDraftLike(null)).toBe(false);
    expect(isGoalArchitectureDraftLike(undefined)).toBe(false);
    expect(isGoalArchitectureDraftLike(42)).toBe(false);
    expect(isGoalArchitectureDraftLike([])).toBe(false);
    expect(isGoalArchitectureDraftLike({ id: 'x' })).toBe(false);
  });
});
