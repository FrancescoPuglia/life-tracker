import { describe, expect, it } from 'vitest';
import type { Session, TimeBlock } from '@/types';
import {
  buildActivityRankings,
  buildExploratoryCorrelations,
  buildFocusTrendData,
  filterOwnerActiveSessions,
  hasSessionTag,
  sanitizeForStorage,
} from './database';

const OWNER = 'owner-1';
const NOW = new Date(2026, 7, 25, 12, 0, 0);

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    userId: OWNER,
    domainId: 'domain-1',
    startTime: new Date(2026, 7, 25, 8, 0, 0),
    endTime: new Date(2026, 7, 25, 8, 30, 0),
    duration: 1_800,
    status: 'completed',
    tags: ['focus'],
    createdAt: new Date(2026, 7, 25, 8, 0, 0),
    updatedAt: new Date(2026, 7, 25, 8, 30, 0),
    ...overrides,
  };
}

function timeBlock(overrides: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id: 'block-1',
    userId: OWNER,
    domainId: 'domain-1',
    title: 'Write report',
    startTime: new Date(2026, 7, 25, 8, 0, 0),
    endTime: new Date(2026, 7, 25, 9, 0, 0),
    status: 'completed',
    type: 'focus',
    createdAt: new Date(2026, 7, 24, 12, 0, 0),
    updatedAt: new Date(2026, 7, 25, 9, 0, 0),
    ...overrides,
  };
}

describe('persisted Session tag normalization', () => {
  it('recognizes an exact string tag', () => {
    expect(hasSessionTag({ tags: ['focus', 'deep'] }, 'focus')).toBe(true);
    expect(hasSessionTag({ tags: ['deep'] }, 'focus')).toBe(false);
  });

  it.each([
    {},
    { tags: null },
    { tags: 'focus' },
    { tags: { focus: true } },
    { tags: [null, 1, false] },
  ])('treats missing or malformed persisted tags as untagged', (session) => {
    expect(hasSessionTag(session, 'focus')).toBe(false);
  });
});

describe('storage sanitization', () => {
  it('removes undefined fields without flattening SDK-owned atomic values', () => {
    class AtomicValue {
      constructor(readonly value: string) {}
    }
    const atomic = new AtomicValue('preserve-me');
    const date = new Date('2026-08-24T08:00:00.000Z');

    const sanitized = sanitizeForStorage({
      atomic,
      date,
      omitted: undefined,
      nested: { kept: false, omitted: undefined },
    });

    expect(sanitized.atomic).toBe(atomic);
    expect(sanitized.date).toBe(date);
    expect(sanitized).not.toHaveProperty('omitted');
    expect(sanitized.nested).toEqual({ kept: false });
  });
});

describe('legacy analytics execution evidence', () => {
  it('keeps missing mood and energy explicit instead of inventing neutral scores', () => {
    const trend = buildFocusTrendData(OWNER, 1, [
      session(),
      session({ id: 'foreign', userId: 'owner-2', mood: 10, energy: 10 }),
    ], NOW);

    expect(trend).toEqual([{
      date: '2026-08-25',
      focusMinutes: 30,
      mood: null,
      energy: null,
    }]);
  });

  it('requires at least seven pairwise-complete observations for exploratory correlations', () => {
    const observations = Array.from({ length: 7 }, (_, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, '0')}`,
      focusMinutes: (index + 1) * 10,
      mood: index + 1,
      energy: null,
    }));

    expect(buildExploratoryCorrelations(observations.slice(0, 6))).toEqual([]);
    expect(buildExploratoryCorrelations(observations)).toEqual([{
      factor1: 'Mood',
      factor2: 'Focus',
      correlation: 1,
      significance: 'Exploratory · N=7',
      sampleSize: 7,
    }]);
  });

  it('marks rankings partial rather than substituting a completed block planned window', () => {
    const [ranking] = buildActivityRankings(OWNER, 1, [timeBlock()], [], NOW);

    expect(ranking).toMatchObject({
      plannedHours: 1,
      actualHours: 0,
      adherenceRate: null,
      actualAvailability: 'partial',
      missingActualCount: 1,
      rank: 'insufficient_data',
    });
  });

  it('uses the owner linked Session ahead of an explicit block interval', () => {
    const block = timeBlock({
      actualStartTime: new Date(2026, 7, 25, 8, 0, 0),
      actualEndTime: new Date(2026, 7, 25, 10, 0, 0),
    });
    const [ranking] = buildActivityRankings(OWNER, 1, [block], [
      session({ timeBlockId: block.id }),
      session({ id: 'foreign', userId: 'owner-2', timeBlockId: block.id, duration: 3_600 }),
    ], NOW);

    expect(ranking).toMatchObject({
      actualHours: 0.5,
      adherenceRate: 50,
      actualAvailability: 'complete',
      missingActualCount: 0,
    });
  });
});

describe('active Session ownership', () => {
  it('excludes foreign and non-active Sessions even if an adapter returns them', () => {
    expect(filterOwnerActiveSessions(OWNER, [
      session({ id: 'owner-active', status: 'active', endTime: undefined, duration: undefined }),
      session({ id: 'foreign-active', userId: 'owner-2', status: 'active', endTime: undefined, duration: undefined }),
      session({ id: 'owner-completed' }),
    ]).map((item) => item.id)).toEqual(['owner-active']);
  });
});
