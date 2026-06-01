// src/lib/goalArchitect/ids.test.ts

import { describe, expect, it } from 'vitest';
import {
  createDraftId,
  createIssueId,
  normalizeForId,
  slugifyDraftTitle,
  stableHash,
} from './ids';

describe('normalizeForId', () => {
  it('strips Italian accents and lowercases', () => {
    expect(normalizeForId('Università di Bologna')).toBe('universita-di-bologna');
    expect(normalizeForId('Però')).toBe('pero');
    expect(normalizeForId('Caffè latte')).toBe('caffe-latte');
  });

  it('collapses multiple spaces and trims punctuation', () => {
    expect(normalizeForId('  Calcolo   e   Visualizzazione  ')).toBe(
      'calcolo-e-visualizzazione',
    );
    expect(normalizeForId('Calcolo, Visualizzazione!')).toBe(
      'calcolo-visualizzazione',
    );
  });

  it('falls back to "untitled" for empty / whitespace input', () => {
    expect(normalizeForId('')).toBe('untitled');
    expect(normalizeForId('   ')).toBe('untitled');
    expect(normalizeForId('!!!')).toBe('untitled');
  });

  it('drops unsupported characters but keeps digits and dashes', () => {
    expect(normalizeForId('Plan-2026 / Q1')).toBe('plan-2026-q1');
  });
});

describe('slugifyDraftTitle', () => {
  it('is a deterministic alias of normalizeForId', () => {
    expect(slugifyDraftTitle('Career Command Center')).toBe(
      normalizeForId('Career Command Center'),
    );
  });
});

describe('stableHash', () => {
  it('returns the same value for the same input', () => {
    expect(stableHash('chess')).toBe(stableHash('chess'));
  });

  it('returns different values for different inputs', () => {
    expect(stableHash('chess')).not.toBe(stableHash('chess2'));
    expect(stableHash('a')).not.toBe(stableHash('b'));
  });

  it('handles empty string deterministically', () => {
    expect(stableHash('')).toBe(stableHash(''));
    expect(typeof stableHash('')).toBe('string');
    expect(stableHash('').length).toBeGreaterThan(0);
  });
});

describe('createDraftId', () => {
  it('is deterministic across calls', () => {
    const a = createDraftId('project', 'Calcolo e Visualizzazione', 'goal-scacchi');
    const b = createDraftId('project', 'Calcolo e Visualizzazione', 'goal-scacchi');
    expect(a).toBe(b);
  });

  it('encodes prefix, parent and slug in a human-readable shape', () => {
    const id = createDraftId('project', 'Calcolo e Visualizzazione', 'goal-scacchi');
    expect(id.startsWith('project_')).toBe(true);
    expect(id).toContain('goal-scacchi');
    expect(id).toContain('calcolo-e-visualizzazione');
  });

  it('disambiguates same-title children of different parents', () => {
    const a = createDraftId('task', 'Aperture', 'project-1');
    const b = createDraftId('task', 'Aperture', 'project-2');
    expect(a).not.toBe(b);
  });

  it('omits parent segment when not provided', () => {
    const id = createDraftId('goal', 'Scacchi — Chess Mastery');
    expect(id.startsWith('goal_')).toBe(true);
    // No double underscore from a missing parent segment.
    expect(id.includes('__')).toBe(false);
  });

  it('uses the canonical prefix for each kind', () => {
    expect(createDraftId('goal', 'g').startsWith('goal_')).toBe(true);
    expect(createDraftId('project', 'p').startsWith('project_')).toBe(true);
    expect(createDraftId('task', 't').startsWith('task_')).toBe(true);
    expect(createDraftId('key_result', 'k').startsWith('kr_')).toBe(true);
  });
});

describe('createIssueId', () => {
  it('is deterministic across calls', () => {
    const a = createIssueId('missing_title', 'task-1', 'title');
    const b = createIssueId('missing_title', 'task-1', 'title');
    expect(a).toBe(b);
  });

  it('distinguishes different codes / fields / entities', () => {
    const a = createIssueId('missing_title', 'task-1', 'title');
    const b = createIssueId('missing_title', 'task-2', 'title');
    const c = createIssueId('missing_title', 'task-1', 'description');
    const d = createIssueId('invalid_hours', 'task-1', 'title');
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it('tolerates missing entity / field', () => {
    const id = createIssueId('missing_goal');
    expect(id.startsWith('issue_missing_goal_')).toBe(true);
    expect(id).toContain('none');
  });
});
