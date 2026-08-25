import { describe, expect, it } from 'vitest';
import type { Session } from '@/types';
import {
  parseCompletedSessionEvidence,
  proportionalSessionMinutes,
  validExecutionInterval,
} from './executionEvidence';

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    userId: 'owner-1',
    domainId: 'domain-1',
    startTime: new Date('2026-08-25T08:00:00.000Z'),
    endTime: new Date('2026-08-25T10:00:00.000Z'),
    duration: 3_600,
    status: 'completed',
    tags: [],
    createdAt: new Date('2026-08-25T08:00:00.000Z'),
    updatedAt: new Date('2026-08-25T10:00:00.000Z'),
    ...over,
  };
}

describe('execution evidence', () => {
  it('uses persisted Session duration as net time and clips it proportionally', () => {
    const evidence = parseCompletedSessionEvidence(session());
    expect(evidence?.netMinutes).toBe(60);
    expect(evidence && proportionalSessionMinutes(evidence, {
      start: Date.parse('2026-08-25T09:00:00.000Z'),
      end: Date.parse('2026-08-25T10:00:00.000Z'),
    })).toBe(30);
  });

  it('derives an end from duration but never accepts invalid or open records', () => {
    const durationOnly = parseCompletedSessionEvidence(session({ endTime: undefined, duration: 900 }));
    expect(durationOnly?.interval.end).toBe(Date.parse('2026-08-25T08:15:00.000Z'));
    expect(parseCompletedSessionEvidence(session({ status: 'active' }))).toBeNull();
    expect(parseCompletedSessionEvidence(session({ deleted: true }))).toBeNull();
    expect(parseCompletedSessionEvidence(session({ duration: -1 }))).toBeNull();
    expect(parseCompletedSessionEvidence(session({ duration: 8_000 }))).toBeNull();
  });

  it('accepts only positive intervals no longer than 24 hours', () => {
    expect(validExecutionInterval(
      new Date('2026-08-25T08:00:00.000Z'),
      new Date('2026-08-25T09:00:00.000Z'),
    )).not.toBeNull();
    expect(validExecutionInterval(
      new Date('2026-08-25T09:00:00.000Z'),
      new Date('2026-08-25T08:00:00.000Z'),
    )).toBeNull();
    expect(validExecutionInterval(
      new Date('2026-08-25T08:00:00.000Z'),
      new Date('2026-08-26T08:00:00.001Z'),
    )).toBeNull();
  });
});
