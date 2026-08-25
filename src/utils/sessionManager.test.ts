import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '@/types';
import { SessionManager } from './sessionManager';

const OWNER = 'owner-1';
const manager = SessionManager.getInstance();

describe('SessionManager persisted-session restore', () => {
  afterEach(() => {
    manager.restoreCurrentSession(null, OWNER);
  });

  it('restores only an active or paused Session owned by the authenticated user', () => {
    const paused = makeSession({ status: 'paused' });
    expect(manager.restoreCurrentSession(paused, OWNER)).toBe(paused);
    expect(manager.getCurrentSession()).toBe(paused);

    expect(() => manager.restoreCurrentSession(
      makeSession({ userId: 'owner-2' }),
      OWNER,
    )).toThrow('cannot be restored for this owner');
    expect(() => manager.restoreCurrentSession(
      makeSession({ status: 'completed' }),
      OWNER,
    )).toThrow('cannot be restored for this owner');
  });

  it('prevents a paused restored Session from being replaced by a new Session', async () => {
    manager.restoreCurrentSession(makeSession({ status: 'paused' }), OWNER);
    await expect(manager.startSession(undefined, undefined, 'domain-1', OWNER)).rejects.toThrow(
      'already in progress',
    );
  });
});

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    userId: OWNER,
    domainId: 'domain-1',
    startTime: new Date('2026-08-25T08:00:00.000Z'),
    status: 'active',
    tags: [],
    createdAt: new Date('2026-08-25T08:00:00.000Z'),
    updatedAt: new Date('2026-08-25T08:00:00.000Z'),
    ...overrides,
  };
}
