// src/lib/weeklyPlanner/scoring.test.ts
import { describe, it, expect } from 'vitest';
import { scorePlanRealism } from './scoring';
import {
  DEFAULT_PLANNING_CONSTRAINTS,
  type DraftTimeBlock,
  type GoalMappingCandidate,
  type PlanConflict,
  type PlanWarning,
  type WeekDay,
} from './types';

function block(over: Partial<DraftTimeBlock>): DraftTimeBlock {
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
    sourceText: '',
    isRoutine: false,
    ...over,
  };
}

function mapped(intentId: string): GoalMappingCandidate {
  return {
    intentId,
    status: 'mapped',
    confidence: 1,
    reason: 'fixture',
    matchedKeywords: [],
    goalId: 'g',
  };
}

describe('scorePlanRealism', () => {
  it('clean plan scores high', () => {
    const blocks: DraftTimeBlock[] = [
      block({ id: 'b1', intentId: 'i1', day: 0, startTime: '09:00', endTime: '10:00', durationMinutes: 60 }),
      block({ id: 'b2', intentId: 'i2', day: 1, startTime: '09:00', endTime: '10:00', durationMinutes: 60 }),
    ];
    const score = scorePlanRealism(
      blocks,
      [],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
      [mapped('i1'), mapped('i2')],
    );
    expect(score.overallScore).toBeGreaterThanOrEqual(95);
    expect(score.totalPlannedMinutes).toBe(120);
  });

  it('weekly overload lowers the score (vs. clean plan)', () => {
    const cleanBlocks = [block({ id: 'b', intentId: 'i', durationMinutes: 60 })];
    const clean = scorePlanRealism(
      cleanBlocks,
      [],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
      [mapped('i')],
    );

    const heavyBlocks: DraftTimeBlock[] = [];
    for (let d = 0 as WeekDay; d <= 6; d++) {
      heavyBlocks.push(
        block({
          id: `b${d}`,
          intentId: `i${d}`,
          day: d as WeekDay,
          durationMinutes: 600,
          startTime: '08:00',
          endTime: '18:00',
        }),
      );
    }
    const heavy = scorePlanRealism(
      heavyBlocks,
      [],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
      heavyBlocks.map((b) => mapped(b.intentId)),
    );

    expect(heavy.overallScore).toBeLessThan(clean.overallScore);
    expect(heavy.weeklyOverloadPenalty).toBeGreaterThan(0);
  });

  it('errors penalize more than warnings', () => {
    const blocks = [block({ id: 'b', intentId: 'i' })];
    const errorConflicts: PlanConflict[] = [
      { id: 'c', type: 'overlap', severity: 'error', message: '', blockIds: ['b'], intentIds: ['i'] },
    ];
    const warningConflicts: PlanConflict[] = [
      { id: 'c', type: 'outside_constraints', severity: 'warning', message: '', blockIds: ['b'], intentIds: ['i'] },
    ];
    const withError = scorePlanRealism(
      blocks,
      errorConflicts,
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
      [mapped('i')],
    );
    const withWarning = scorePlanRealism(
      blocks,
      warningConflicts,
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
      [mapped('i')],
    );
    expect(withError.overallScore).toBeLessThan(withWarning.overallScore);
  });

  it('clamps to [0, 100]', () => {
    const blocks: DraftTimeBlock[] = [
      block({ id: 'b', intentId: 'i', durationMinutes: 10000, startTime: '07:00', endTime: '22:00' }),
    ];
    const manyConflicts: PlanConflict[] = Array.from({ length: 50 }).map((_, i) => ({
      id: `c${i}`,
      type: 'overlap',
      severity: 'error',
      message: '',
      blockIds: [],
      intentIds: [],
    }));
    const manyWarnings: PlanWarning[] = Array.from({ length: 50 }).map((_, i) => ({
      id: `w${i}`,
      type: 'missing_goal',
      message: '',
      blockIds: [],
      intentIds: [],
    }));
    const r = scorePlanRealism(blocks, manyConflicts, manyWarnings, DEFAULT_PLANNING_CONSTRAINTS, []);
    expect(r.overallScore).toBeGreaterThanOrEqual(0);
    expect(r.overallScore).toBeLessThanOrEqual(100);
  });

  it('reports goal coverage', () => {
    const r = scorePlanRealism(
      [block({ id: 'b', intentId: 'i' })],
      [],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
      [mapped('i')],
    );
    expect(r.goalCoverageScore).toBe(100);
  });
});
