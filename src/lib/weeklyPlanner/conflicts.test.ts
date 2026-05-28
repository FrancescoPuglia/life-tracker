// src/lib/weeklyPlanner/conflicts.test.ts
import { describe, it, expect } from 'vitest';
import { detectConflicts } from './conflicts';
import {
  DEFAULT_PLANNING_CONSTRAINTS,
  type DraftTimeBlock,
  type ParsedIntent,
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

describe('detectConflicts', () => {
  it('detects overlap on same day', () => {
    const { conflicts } = detectConflicts(
      [
        block({ id: 'b1', intentId: 'i1', label: 'A', startTime: '09:00', endTime: '10:30', durationMinutes: 90 }),
        block({ id: 'b2', intentId: 'i2', label: 'B', startTime: '10:00', endTime: '11:00', durationMinutes: 60 }),
      ],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
    );
    expect(conflicts.some((c) => c.type === 'overlap')).toBe(true);
  });

  it('does NOT flag overlap when blocks are on different days', () => {
    const { conflicts } = detectConflicts(
      [
        block({ id: 'b1', intentId: 'i1', day: 0, startTime: '09:00', endTime: '10:00', durationMinutes: 60 }),
        block({ id: 'b2', intentId: 'i2', day: 1, startTime: '09:00', endTime: '10:00', durationMinutes: 60 }),
      ],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
    );
    expect(conflicts.filter((c) => c.type === 'overlap')).toHaveLength(0);
  });

  it('flags daily overload', () => {
    const big = block({
      id: 'big',
      intentId: 'i',
      startTime: '08:00',
      endTime: '20:00',
      durationMinutes: 720, // > 600 default
    });
    const { conflicts } = detectConflicts([big], [], DEFAULT_PLANNING_CONSTRAINTS);
    expect(conflicts.some((c) => c.type === 'daily_overload')).toBe(true);
  });

  it('flags weekly overload', () => {
    const blocks: DraftTimeBlock[] = [];
    // Pack 7 days × 600 min each (well above the 3000 weekly cap)
    for (let d = 0; d <= 6; d++) {
      blocks.push(
        block({
          id: `b${d}`,
          intentId: `i${d}`,
          day: d as 0 | 1 | 2 | 3 | 4 | 5 | 6,
          startTime: '08:00',
          endTime: '18:00',
          durationMinutes: 600,
        }),
      );
    }
    const { conflicts } = detectConflicts(blocks, [], DEFAULT_PLANNING_CONSTRAINTS);
    expect(conflicts.some((c) => c.type === 'weekly_overload')).toBe(true);
  });

  it('emits missing_goal warning when a non-routine block has no mapping', () => {
    const { warnings } = detectConflicts(
      [block({ activityType: 'chess' })],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
    );
    expect(warnings.some((w) => w.type === 'missing_goal')).toBe(true);
  });

  it('does NOT emit missing_goal for routine blocks', () => {
    const { warnings } = detectConflicts(
      [block({ activityType: 'routine' })],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
    );
    expect(warnings.some((w) => w.type === 'missing_goal')).toBe(false);
  });

  it('flags outside_constraints when start is before earliestHour', () => {
    const { conflicts } = detectConflicts(
      [block({ startTime: '05:00', endTime: '06:00', durationMinutes: 60 })],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
    );
    expect(conflicts.some((c) => c.type === 'outside_constraints')).toBe(true);
  });

  it('flags invalid_time when end <= start', () => {
    const { conflicts } = detectConflicts(
      [block({ startTime: '10:00', endTime: '09:00', durationMinutes: 60 })],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
    );
    expect(conflicts.some((c) => c.type === 'invalid_time')).toBe(true);
  });

  it('flags routine_collision when two routine blocks overlap', () => {
    const { conflicts } = detectConflicts(
      [
        block({ id: 'r1', intentId: 'i1', activityType: 'routine', isRoutine: true, startTime: '07:00', endTime: '07:30', durationMinutes: 30 }),
        block({ id: 'r2', intentId: 'i2', activityType: 'routine', isRoutine: true, startTime: '07:15', endTime: '07:45', durationMinutes: 30 }),
      ],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
    );
    expect(conflicts.some((c) => c.type === 'routine_collision')).toBe(true);
  });

  it('emits unscheduled_intent for intents missing from blocks', () => {
    const intents: ParsedIntent[] = [
      {
        id: 'orphan',
        label: 'Lost',
        sourceText: '',
        activityType: 'task',
        preferredDays: [],
        priority: 50,
        flexibility: 'flexible',
        energyLevel: 'medium',
        confidence: 1,
      },
    ];
    const { warnings } = detectConflicts([], intents, DEFAULT_PLANNING_CONSTRAINTS);
    expect(warnings.some((w) => w.type === 'unscheduled_intent')).toBe(true);
  });

  it('emits too_many_high_energy_blocks beyond the limit', () => {
    const high: DraftTimeBlock[] = [
      block({ id: 'h1', intentId: 'i1', startTime: '09:00', endTime: '10:00', durationMinutes: 60, energyLevel: 'high' }),
      block({ id: 'h2', intentId: 'i2', startTime: '10:30', endTime: '11:30', durationMinutes: 60, energyLevel: 'high' }),
      block({ id: 'h3', intentId: 'i3', startTime: '12:00', endTime: '13:00', durationMinutes: 60, energyLevel: 'high' }),
    ];
    const { warnings } = detectConflicts(high, [], DEFAULT_PLANNING_CONSTRAINTS);
    expect(warnings.some((w) => w.type === 'too_many_high_energy_blocks')).toBe(true);
  });
});
