import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimeBlock } from '@/types';
import {
  defaultExecutionAlarmPreferences,
  dispatchExecutionAlarmSignal,
} from '@/lib/desktop/executionAlarm';
import ExecutionAlarmHost from './ExecutionAlarmHost';

const soundMocks = vi.hoisted(() => ({
  playOnce: vi.fn(async () => undefined),
  startBounded: vi.fn(async () => undefined),
  stop: vi.fn(),
}));

vi.mock('@/lib/desktop/executionAlarmSound', () => ({
  ExecutionAlarmSound: class {
    playOnce = soundMocks.playOnce;
    startBounded = soundMocks.startBounded;
    stop = soundMocks.stop;
  },
}));

describe('Execution Alarm host', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('shows persistent strong UI only after a validated signal and snoozes without completion', () => {
    renderHost();
    act(() => dispatchExecutionAlarmSignal(signal('strong')));

    expect(screen.getByTestId('execution-alarm-overlay')).toBeInTheDocument();
    expect(screen.getByText('Deep work')).toBeInTheDocument();
    expect(soundMocks.startBounded).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Snooze 5' }));
    expect(screen.queryByTestId('execution-alarm-overlay')).not.toBeInTheDocument();
    expect(soundMocks.stop).toHaveBeenCalled();
  });

  it('starts a linked Session and acknowledges only after the action succeeds', async () => {
    const onStartSession = vi.fn(async () => true);
    renderHost({ onStartSession });
    act(() => dispatchExecutionAlarmSignal(signal('strong')));

    fireEvent.click(screen.getByRole('button', { name: 'Avvia sessione' }));
    await waitFor(() => expect(onStartSession).toHaveBeenCalledWith('task-1', 'block-1'));
    await waitFor(() => expect(screen.queryByTestId('execution-alarm-overlay')).not.toBeInTheDocument());
  });

  it('keeps the alarm visible when Session persistence fails', async () => {
    const onStartSession = vi.fn(async () => false);
    renderHost({ onStartSession });
    act(() => dispatchExecutionAlarmSignal(signal('strong')));

    fireEvent.click(screen.getByRole('button', { name: 'Avvia sessione' }));
    await waitFor(() => expect(onStartSession).toHaveBeenCalled());
    expect(screen.getByTestId('execution-alarm-overlay')).toBeInTheDocument();
  });

  it('plays one bounded cue without persistent UI in normal mode', () => {
    renderHost();
    act(() => dispatchExecutionAlarmSignal(signal('normal')));

    expect(screen.queryByTestId('execution-alarm-overlay')).not.toBeInTheDocument();
    expect(soundMocks.playOnce).toHaveBeenCalledTimes(1);
    expect(soundMocks.startBounded).not.toHaveBeenCalled();
  });
});

function renderHost(overrides: { onStartSession?: () => Promise<boolean> } = {}) {
  return render(
    <ExecutionAlarmHost
      uid="owner-1"
      preferences={{ ...defaultExecutionAlarmPreferences(), mode: 'strong' }}
      timeBlocks={[timeBlock()]}
      tasks={[]}
      projects={[]}
      goals={[]}
      timezone="Europe/Rome"
      locale="it-IT"
      currentSession={null}
      onStartSession={overrides.onStartSession ?? (async () => true)}
      onOpenPlanner={() => undefined}
    />,
  );
}

function signal(presentation: 'normal' | 'strong') {
  return {
    dispatch: {
      jobId: 'a'.repeat(64),
      attemptId: 'b'.repeat(64),
      kind: 'at_start' as const,
      offsetMinutes: 0,
      scheduledFor: '2026-08-26T10:00:00.000Z',
      startTime: '2026-08-26T10:00:00.000Z',
      title: 'Deep work',
      plannedMinutes: 60,
      timezone: 'Europe/Rome',
      locale: 'it-IT',
    },
    context: {
      timeBlockId: 'block-1',
      taskId: 'task-1',
      goalTitle: 'Ship V3',
      projectTitle: 'Alarm',
      priority: 'high' as const,
    },
    presentation,
  };
}

function timeBlock(): TimeBlock {
  return {
    id: 'block-1', userId: 'owner-1', domainId: 'work', title: 'Deep work',
    startTime: new Date('2026-08-26T10:00:00.000Z'),
    endTime: new Date('2026-08-26T11:00:00.000Z'),
    status: 'planned', type: 'deep', createdAt: new Date(), updatedAt: new Date(),
  };
}
