import { describe, expect, it } from 'vitest';
import type { Session, TimeBlock } from '@/types';
import { aggregateExecutionWindow, collectBlockExecutionRecords } from './executionAggregation';

const OWNER = 'owner-1';
const START = new Date('2026-08-25T00:00:00.000Z');
const END = new Date('2026-08-26T00:00:00.000Z');

function block(over: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id: 'block-1',
    userId: OWNER,
    domainId: 'domain-1',
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
    userId: OWNER,
    domainId: 'domain-1',
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

describe('execution window aggregation', () => {
  it('uses linked Sessions as primary, adds orphan Sessions, and ignores foreign owners', () => {
    const linkedBlock = block({
      actualStartTime: new Date('2026-08-25T08:00:00.000Z'),
      actualEndTime: new Date('2026-08-25T10:00:00.000Z'),
    });
    const aggregate = aggregateExecutionWindow({
      ownerUid: OWNER,
      start: START,
      end: END,
      timeBlocks: [linkedBlock, block({ id: 'foreign-block', userId: 'owner-2' })],
      sessions: [
        session({ timeBlockId: linkedBlock.id }),
        session({ id: 'orphan', timeBlockId: undefined, duration: 900, endTime: new Date('2026-08-25T08:15:00.000Z') }),
        session({ id: 'foreign', userId: 'owner-2', duration: 7_200 }),
      ],
    });

    expect(aggregate.plannedMinutes).toBe(60);
    expect(aggregate.actualMinutes).toBe(45);
    expect(aggregate.actualSourceCount).toBe(2);
    expect(aggregate.blocksMissingActualCount).toBe(0);
    expect(aggregate.availability).toBe('complete');
    expect(aggregate.actualMinutesByDomainId.get('domain-1')).toBe(45);
  });

  it('uses an explicit block actual interval only without a valid linked Session', () => {
    const aggregate = aggregateExecutionWindow({
      ownerUid: OWNER,
      start: START,
      end: END,
      timeBlocks: [block({
        actualStartTime: new Date('2026-08-25T08:10:00.000Z'),
        actualEndTime: new Date('2026-08-25T08:30:00.000Z'),
      })],
      sessions: [],
    });
    expect(aggregate.actualMinutes).toBe(20);
    expect(aggregate.actualSourceCount).toBe(1);
    expect(aggregate.availability).toBe('complete');
  });

  it('marks missing execution evidence partial and never substitutes planned duration', () => {
    const aggregate = aggregateExecutionWindow({
      ownerUid: OWNER,
      start: START,
      end: END,
      timeBlocks: [block()],
      sessions: [],
    });
    expect(aggregate.plannedMinutes).toBe(60);
    expect(aggregate.actualMinutes).toBe(0);
    expect(aggregate.blocksMissingActualCount).toBe(1);
    expect(aggregate.availability).toBe('partial');
  });

  it('excludes break Sessions and treats an open Session as partial coverage', () => {
    const breakBlock = block({ id: 'break', type: 'break' });
    const aggregate = aggregateExecutionWindow({
      ownerUid: OWNER,
      start: START,
      end: END,
      timeBlocks: [breakBlock],
      sessions: [
        session({ timeBlockId: breakBlock.id }),
        session({ id: 'open', status: 'active', endTime: undefined, duration: undefined }),
      ],
    });
    expect(aggregate.plannedMinutes).toBe(0);
    expect(aggregate.actualMinutes).toBe(0);
    expect(aggregate.openSessionCount).toBe(1);
    expect(aggregate.availability).toBe('partial');
  });
});

describe('per-block execution evidence', () => {
  it('uses linked Session net time before an explicit block interval', () => {
    const records = collectBlockExecutionRecords({
      ownerUid: OWNER,
      timeBlocks: [block({
        actualStartTime: new Date('2026-08-25T08:00:00.000Z'),
        actualEndTime: new Date('2026-08-25T10:00:00.000Z'),
      })],
      sessions: [session({ timeBlockId: 'block-1' })],
    });
    expect(records.get('block-1')).toEqual({
      blockId: 'block-1',
      actualMinutes: 30,
      source: 'completed_sessions',
      sourceCount: 1,
    });
  });

  it('preserves missing evidence and accepts a Session even if its linked block is still planned', () => {
    const records = collectBlockExecutionRecords({
      ownerUid: OWNER,
      timeBlocks: [
        block({ id: 'missing' }),
        block({ id: 'still-planned', status: 'planned' }),
      ],
      sessions: [session({ timeBlockId: 'still-planned' })],
    });
    expect(records.get('missing')?.source).toBe('missing');
    expect(records.get('missing')?.actualMinutes).toBeNull();
    expect(records.get('still-planned')?.actualMinutes).toBe(30);
  });

  it('preserves real Session evidence when the linked scheduling block was later cancelled', () => {
    const records = collectBlockExecutionRecords({
      ownerUid: OWNER,
      timeBlocks: [block({ status: 'cancelled' })],
      sessions: [session({ timeBlockId: 'block-1' })],
    });
    expect(records.get('block-1')?.actualMinutes).toBe(30);
    expect(records.get('block-1')?.source).toBe('completed_sessions');
  });

  it('ignores foreign Sessions even when their timeBlockId collides', () => {
    const records = collectBlockExecutionRecords({
      ownerUid: OWNER,
      timeBlocks: [block()],
      sessions: [session({ userId: 'owner-2', timeBlockId: 'block-1' })],
    });
    expect(records.get('block-1')?.source).toBe('missing');
  });
});
