import { describe, expect, it } from 'vitest';
import type { Session, TimeBlock } from '@/types';
import { collectGoalExecutionEvidence } from './goalAnalyticsEngine';

const GOAL = 'goal-1';

function block(over: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id: 'block-1',
    userId: 'owner-1',
    domainId: 'domain-1',
    goalId: GOAL,
    title: 'Block',
    type: 'work',
    status: 'completed',
    startTime: new Date('2026-08-25T08:00:00.000Z'),
    endTime: new Date('2026-08-25T09:00:00.000Z'),
    createdAt: new Date('2026-08-24T08:00:00.000Z'),
    updatedAt: new Date('2026-08-25T09:00:00.000Z'),
    ...over,
  };
}

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    userId: 'owner-1',
    domainId: 'domain-1',
    timeBlockId: 'block-1',
    startTime: new Date('2026-08-25T08:00:00.000Z'),
    endTime: new Date('2026-08-25T08:30:00.000Z'),
    duration: 1_800,
    status: 'completed',
    tags: [],
    createdAt: new Date('2026-08-25T08:00:00.000Z'),
    updatedAt: new Date('2026-08-25T08:30:00.000Z'),
    ...over,
  };
}

describe('Goal Analytics execution evidence', () => {
  it('uses a linked Session once instead of the duplicated block interval', () => {
    const sources = collectGoalExecutionEvidence(
      GOAL,
      [session()],
      [block({
        actualStartTime: new Date('2026-08-25T08:00:00.000Z'),
        actualEndTime: new Date('2026-08-25T10:00:00.000Z'),
      })],
    );
    expect(sources.map((source) => source.minutes)).toEqual([30]);
  });

  it('accepts explicit actual fallback, ignores missing evidence, and honors allocation shares', () => {
    const explicit = block({
      id: 'explicit',
      goalAllocation: { [GOAL]: 25, 'goal-2': 75 },
      actualStartTime: new Date('2026-08-25T09:00:00.000Z'),
      actualEndTime: new Date('2026-08-25T11:00:00.000Z'),
    });
    const missing = block({ id: 'missing' });
    const sources = collectGoalExecutionEvidence(GOAL, [], [explicit, missing]);
    expect(sources.map((source) => source.minutes)).toEqual([30]);
  });

  it('lets explicit Session allocation override its linked block allocation', () => {
    const sources = collectGoalExecutionEvidence(
      GOAL,
      [session({ goalContribution: { [GOAL]: 20, 'goal-2': 80 } })],
      [block()],
    );
    expect(sources[0]?.minutes).toBe(6);
  });
});
