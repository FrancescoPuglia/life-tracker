import { describe, expect, it } from 'vitest';
import type { Session } from '@/types';
import {
  completeSessionAt,
  pauseSessionAt,
  resumeSessionAt,
  selectRestorableSession,
  sessionElapsedSeconds,
  timeBlockStatusAfterSession,
} from './sessionTiming';

describe('persisted Session timing', () => {
  it('keeps one Session and excludes paused wall time from the final duration', () => {
    const started = session({
      startTime: at('08:00'),
      activeSegmentStartedAt: at('08:00'),
    });
    const paused = pauseSessionAt(started, at('08:10'));
    expect(paused).toMatchObject({ id: 'session-1', status: 'paused', duration: 600 });

    const resumed = resumeSessionAt(paused, at('08:20'));
    expect(resumed).toMatchObject({
      id: 'session-1',
      status: 'active',
      duration: 600,
      activeSegmentStartedAt: at('08:20'),
    });
    expect(sessionElapsedSeconds(resumed, at('08:30'))).toBe(1_200);

    const completed = completeSessionAt(resumed, at('08:30'));
    expect(completed).toMatchObject({
      id: 'session-1',
      status: 'completed',
      startTime: at('08:00'),
      endTime: at('08:30'),
      duration: 1_200,
      activeSegmentStartedAt: null,
    });
  });

  it('supports legacy paused records and rejects ambiguous active timing', () => {
    const legacyPaused = session({
      status: 'paused',
      startTime: at('08:00'),
      endTime: at('08:12'),
      duration: undefined,
    });
    expect(sessionElapsedSeconds(legacyPaused, at('08:20'))).toBe(720);
    expect(resumeSessionAt(legacyPaused, at('08:20')).duration).toBe(720);

    expect(sessionElapsedSeconds(session({ duration: 300 }), at('08:20'))).toBeNull();
  });

  it('does not resurrect the paused record created by the legacy resume flow', () => {
    const stranded = session({
      id: 'old-paused',
      status: 'paused',
      timeBlockId: 'block-1',
      endTime: at('08:10'),
      duration: 600,
      updatedAt: at('08:10'),
    });
    const laterCompleted = session({
      id: 'legacy-resume',
      status: 'completed',
      timeBlockId: 'block-1',
      startTime: at('08:20'),
      endTime: at('08:30'),
      duration: 600,
      createdAt: at('08:20'),
      updatedAt: at('08:30'),
    });
    expect(selectRestorableSession('owner-1', [stranded, laterCompleted])).toBeNull();
  });

  it('fails closed on two independent resumable Sessions or a foreign owner', () => {
    expect(() => selectRestorableSession('owner-1', [
      session({ id: 'one' }),
      session({ id: 'two', timeBlockId: 'block-2' }),
    ])).toThrow('require recovery');
    expect(selectRestorableSession('owner-1', [session({ userId: 'owner-2' })])).toBeNull();
  });

  it('uses overrun only for execution beyond plan and leaves a short stop in progress', () => {
    const block = { startTime: at('08:00'), endTime: at('09:00') };
    expect(timeBlockStatusAfterSession(block, 20 * 60)).toBe('in_progress');
    expect(timeBlockStatusAfterSession(block, 48 * 60)).toBe('completed');
    expect(timeBlockStatusAfterSession(block, 61 * 60)).toBe('overrun');
  });
});

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    userId: 'owner-1',
    domainId: 'domain-1',
    timeBlockId: 'block-1',
    startTime: at('08:00'),
    status: 'active',
    tags: [],
    createdAt: at('08:00'),
    updatedAt: at('08:00'),
    ...overrides,
  };
}

function at(clock: string): Date {
  return new Date(`2026-08-25T${clock}:00.000Z`);
}
