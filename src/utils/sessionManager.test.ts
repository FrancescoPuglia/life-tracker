import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@/types';
import { db } from '@/lib/database';
import { SessionManager } from './sessionManager';

const OWNER = 'owner-1';
const manager = SessionManager.getInstance();

describe('SessionManager persisted-session restore', () => {
  afterEach(() => {
    manager.restoreCurrentSession(null, OWNER);
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it('persists pause/resume/stop on one Session and retains both active segments', async () => {
    vi.useFakeTimers();
    const update = vi.spyOn(db, 'update').mockImplementation(async (_collection, value) => value);
    const create = vi.spyOn(db, 'create').mockImplementation(async (_collection, value) => value);
    vi.spyOn(db, 'getAll').mockResolvedValue([]);
    manager.restoreCurrentSession(makeSession({
      startTime: at('08:00'),
      activeSegmentStartedAt: at('08:00'),
    }), OWNER);

    vi.setSystemTime(at('08:10'));
    expect(await manager.pauseSession()).toMatchObject({ id: 'session-1', duration: 600 });
    vi.setSystemTime(at('08:20'));
    expect(await manager.resumeSession()).toMatchObject({
      id: 'session-1',
      status: 'active',
      duration: 600,
      activeSegmentStartedAt: at('08:20'),
    });
    vi.setSystemTime(at('08:30'));
    expect(await manager.stopSession()).toMatchObject({
      id: 'session-1',
      status: 'completed',
      startTime: at('08:00'),
      endTime: at('08:30'),
      duration: 1_200,
    });

    expect(update).toHaveBeenCalledTimes(3);
    expect(create).not.toHaveBeenCalled();
    expect(manager.getCurrentSession()).toBeNull();
  });

  it('does not mutate in-memory authority when a lifecycle write fails', async () => {
    const original = makeSession({ activeSegmentStartedAt: at('08:00') });
    manager.restoreCurrentSession(original, OWNER);
    vi.spyOn(db, 'update').mockRejectedValue(new Error('offline'));

    await expect(manager.pauseSession()).rejects.toThrow('offline');
    expect(manager.getCurrentSession()).toBe(original);
    expect(manager.getCurrentSession()?.status).toBe('active');
    expect(manager.getCurrentSession()?.duration).toBeUndefined();
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

function at(clock: string): Date {
  return new Date(`2026-08-25T${clock}:00.000Z`);
}
