import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Session, TimeBlock } from '@/types';
import NowBar from './NowBar';

describe('NowBar', () => {
  it('starts a Session with the authoritative current TimeBlock linkage and shows next up', () => {
    const onStartSession = vi.fn();
    render(
      <NowBar
        currentTimeBlock={makeBlock({ id: 'block-now', taskId: 'task-now' })}
        nextTimeBlock={makeBlock({ id: 'block-next', title: 'Next commitment' })}
        onStartSession={onStartSession}
        onPauseSession={() => undefined}
        onStopSession={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Avvia sessione/i }));
    expect(onStartSession).toHaveBeenCalledWith('task-now', 'block-now');
    expect(screen.getByText('Next commitment')).toBeInTheDocument();
  });

  it('resumes a paused persisted Session without replacing its linkage', () => {
    const onStartSession = vi.fn();
    render(
      <NowBar
        currentSession={makeSession({ status: 'paused' })}
        currentTimeBlock={makeBlock({ id: 'block-now', taskId: 'task-now' })}
        onStartSession={onStartSession}
        onPauseSession={() => undefined}
        onStopSession={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Riprendi/i }));
    expect(onStartSession).toHaveBeenCalledWith();
  });

  it('fails closed while persisted Session authority is unavailable', () => {
    const onStartSession = vi.fn();
    render(
      <NowBar
        currentTimeBlock={makeBlock()}
        sessionStateReady={false}
        onStartSession={onStartSession}
        onPauseSession={() => undefined}
        onStopSession={() => undefined}
      />,
    );

    const start = screen.getByRole('button', { name: /Verifica sessioni/i });
    expect(start).toBeDisabled();
    fireEvent.click(start);
    expect(onStartSession).not.toHaveBeenCalled();
  });
});

function makeBlock(overrides: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id: 'block-1',
    userId: 'owner-1',
    domainId: 'domain-1',
    title: 'Current focus',
    startTime: new Date(Date.now() - 30 * 60_000),
    endTime: new Date(Date.now() + 30 * 60_000),
    status: 'planned',
    type: 'focus',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    userId: 'owner-1',
    domainId: 'domain-1',
    timeBlockId: 'block-now',
    taskId: 'task-now',
    startTime: new Date(Date.now() - 15 * 60_000),
    endTime: new Date(),
    duration: 900,
    status: 'paused',
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
