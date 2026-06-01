// src/lib/goalArchitect/types.test.ts
// Smoke tests for the type-guard helpers exposed by the domain module.

import { describe, expect, it } from 'vitest';
import {
  GOAL_ARCHITECT_DRAFT_VERSION,
  isDraftEntityKind,
  isDraftPriority,
  isKeyResultUnit,
} from './types';

describe('types', () => {
  it('exposes a stable schema version', () => {
    expect(GOAL_ARCHITECT_DRAFT_VERSION).toBe(1);
  });

  describe('isDraftPriority', () => {
    it('accepts every canonical priority', () => {
      for (const p of ['critical', 'high', 'medium', 'low']) {
        expect(isDraftPriority(p)).toBe(true);
      }
    });

    it('rejects unknown strings and non-strings', () => {
      expect(isDraftPriority('urgent')).toBe(false);
      expect(isDraftPriority('')).toBe(false);
      expect(isDraftPriority(undefined)).toBe(false);
      expect(isDraftPriority(null)).toBe(false);
      expect(isDraftPriority(42)).toBe(false);
    });
  });

  describe('isDraftEntityKind', () => {
    it('accepts the four supported kinds', () => {
      expect(isDraftEntityKind('goal')).toBe(true);
      expect(isDraftEntityKind('project')).toBe(true);
      expect(isDraftEntityKind('task')).toBe(true);
      expect(isDraftEntityKind('key_result')).toBe(true);
    });

    it('rejects unknown kinds', () => {
      expect(isDraftEntityKind('milestone')).toBe(false);
      expect(isDraftEntityKind('')).toBe(false);
    });
  });

  describe('isKeyResultUnit', () => {
    it('accepts canonical units', () => {
      for (const u of [
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
      ]) {
        expect(isKeyResultUnit(u)).toBe(true);
      }
    });

    it('rejects unknown units', () => {
      expect(isKeyResultUnit('km')).toBe(false);
      expect(isKeyResultUnit(undefined)).toBe(false);
    });
  });
});
