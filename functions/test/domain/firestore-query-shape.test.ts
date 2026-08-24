import { Timestamp, type Query } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { applyValidationIntervalBounds } from '../../src/domain/firestore-repository';

describe('Firestore validation query shape', () => {
  it('orders interval inequalities exactly like the deployed composite index', () => {
    const calls: unknown[][] = [];
    const query = {
      where(...args: unknown[]) {
        calls.push(['where', ...args]);
        return this;
      },
      orderBy(...args: unknown[]) {
        calls.push(['orderBy', ...args]);
        return this;
      },
    } as unknown as Query;

    expect(applyValidationIntervalBounds(
      query,
      '2026-08-25T00:00:00.000Z',
      '2026-08-26T00:00:00.000Z',
    )).toBe(query);
    expect(calls).toEqual([
      ['where', 'startTime', '<', expect.any(Timestamp)],
      ['where', 'endTime', '>', expect.any(Timestamp)],
      ['orderBy', 'startTime', 'asc'],
      ['orderBy', 'endTime', 'asc'],
    ]);
  });
});
