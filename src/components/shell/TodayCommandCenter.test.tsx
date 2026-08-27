import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Goal, Project, Task, TimeBlock } from '@/types';
import { defaultNotificationPreferences } from '@/lib/notifications/preferences';
import TodayCommandCenter, { type TodayCommandCenterProps } from './TodayCommandCenter';

describe('Today Command Center', () => {
  it('shows missing execution evidence honestly instead of using planned minutes', () => {
    renderToday({
      timeBlocks: [makeBlock({ status: 'completed' })],
      sessions: [],
      sessionCoverage: 'ready',
    });

    const pulse = screen.getByTestId('today-execution-pulse');
    expect(within(pulse).getByText('Effettivo noto')).toBeInTheDocument();
    expect(within(pulse).getByText('0 min')).toBeInTheDocument();
    expect(within(pulse).getByText('Aderenza').parentElement).toHaveTextContent('—');
    expect(screen.getByTestId('today-execution-quality')).toHaveTextContent(
      '1 blocco eseguito senza evidenza effettiva',
    );
  });

  it('does not render unavailable Sessions as zero execution', () => {
    renderToday({
      timeBlocks: [makeBlock({ status: 'completed' })],
      sessions: [],
      sessionCoverage: 'error',
    });

    expect(screen.getAllByText('Non disponibile').length).toBeGreaterThan(0);
    expect(screen.getByTestId('today-execution-quality')).toHaveTextContent(
      'l’esecuzione non viene indicata come zero',
    );
    expect(screen.getByTestId('today-start-focus')).toBeDisabled();
    expect(screen.getByTestId('today-start-focus')).toHaveTextContent('Sessioni non disponibili');
  });

  it('links Start to the active TimeBlock and exposes Ask AI and upcoming commitments', () => {
    const onStartFocus = vi.fn();
    const onOpenAskAI = vi.fn();
    const active = makeBlock({
      id: 'active-block',
      taskId: 'task-1',
      title: 'Current focus',
      startTime: new Date('2026-08-25T09:30:00.000Z'),
      endTime: new Date('2026-08-25T10:30:00.000Z'),
    });
    const next = makeBlock({
      id: 'next-block',
      title: 'Next commitment',
      startTime: new Date('2026-08-25T11:00:00.000Z'),
      endTime: new Date('2026-08-25T12:00:00.000Z'),
    });
    renderToday({ timeBlocks: [next, active], onStartFocus, onOpenAskAI });

    fireEvent.click(screen.getByTestId('today-start-focus'));
    expect(onStartFocus).toHaveBeenCalledWith('task-1', 'active-block');
    fireEvent.click(screen.getByTestId('today-ask-ai'));
    expect(onOpenAskAI).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('today-upcoming-commitments')).toHaveTextContent('Next commitment');
  });

  it('shows reminder policy plus native permission and links Settings', () => {
    const onOpenTab = vi.fn();
    renderToday({ onOpenTab });

    const reminder = screen.getByTestId('today-reminder-state');
    expect(reminder).toHaveTextContent('Desktopattivo');
    expect(reminder).toHaveTextContent('Prima del blocco15m');
    expect(reminder).toHaveTextContent('Europe/Rome');
    fireEvent.click(screen.getByRole('button', { name: 'Apri impostazioni →' }));
    expect(onOpenTab).toHaveBeenCalledWith('settings');
  });

  it('captures a note through the bounded parent action and normalizes failures', async () => {
    const onQuickCapture = vi.fn(async () => undefined);
    const view = renderToday({ onQuickCapture });
    fireEvent.change(screen.getByLabelText('Nota rapida'), {
      target: { value: 'A useful thought' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva nota' }));
    await screen.findByText('Nota salvata nel Second Brain.');
    expect(onQuickCapture).toHaveBeenCalledWith('A useful thought');

    onQuickCapture.mockRejectedValueOnce(new Error('private provider detail'));
    fireEvent.change(screen.getByLabelText('Nota rapida'), {
      target: { value: 'Try again' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva nota' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('restano invariati'));
    expect(view.container).not.toHaveTextContent('private provider detail');
  });

  it('never reconstructs the observed critical priority from a deleted Goal hierarchy', () => {
    renderToday({
      goals: [],
      projects: [],
      tasks: [makeTask({
        title: 'i 100 studi che bisogna conoscere',
        priority: 'critical',
        projectId: 'deleted-project',
        goalId: 'deleted-goal',
      })],
    });

    expect(screen.queryByText('i 100 studi che bisogna conoscere')).not.toBeInTheDocument();
    expect(screen.getByText('Non ci sono attività prioritarie aperte.')).toBeInTheDocument();
  });

  it('shows a valid disposable priority, then keeps it absent after hierarchy deletion and rerender', () => {
    const goal = makeGoal();
    const project = makeProject();
    const legacy = makeTask({
      title: 'i 100 studi che bisogna conoscere',
      priority: 'critical',
    });
    const props = {
      goals: [goal],
      projects: [project],
      tasks: [legacy],
    };
    const view = renderToday(props);
    expect(screen.getByText(legacy.title)).toBeInTheDocument();

    view.rerender(<TodayCommandCenter {...buildTodayProps({
      goals: [],
      projects: [],
      tasks: [legacy],
    })} />);

    expect(screen.queryByText(legacy.title)).not.toBeInTheDocument();
    expect(screen.getByText('Non ci sono attività prioritarie aperte.')).toBeInTheDocument();
  });
});

function renderToday(overrides: Partial<TodayCommandCenterProps> = {}) {
  return render(<TodayCommandCenter {...buildTodayProps(overrides)} />);
}

function buildTodayProps(overrides: Partial<TodayCommandCenterProps> = {}): TodayCommandCenterProps {
  const preferences = {
    ...defaultNotificationPreferences(),
    desktopEnabled: true,
  };
  return {
    now: new Date('2026-08-25T10:00:00.000Z'),
    ownerUid: 'owner-1',
    timezone: 'Europe/Rome',
    locale: 'it-IT',
    preferenceStatus: 'ready',
    reminderPreferences: preferences,
    nativeStatus: {
      available: true,
      notificationPermission: 'granted',
      autostartEnabled: true,
    },
    timeBlocks: [],
    sessions: [],
    sessionCoverage: 'ready',
    currentSessionStatus: null,
    tasks: [],
    goals: [],
    projects: [],
    streakData: {
      currentStreak: 2,
      bestStreak: 5,
      lastActivityDate: '2026-08-24',
      totalActiveDays: 8,
      streakHistory: [],
    },
    onOpenTab: vi.fn(),
    onOpenAskAI: vi.fn(),
    onStartFocus: vi.fn(),
    onQuickCapture: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makeBlock(overrides: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id: 'block-1',
    userId: 'owner-1',
    domainId: 'domain-1',
    title: 'Focus block',
    startTime: new Date('2026-08-25T08:00:00.000Z'),
    endTime: new Date('2026-08-25T09:00:00.000Z'),
    status: 'planned',
    type: 'focus',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    userId: 'owner-1',
    domainId: 'domain-1',
    projectId: 'project-1',
    goalId: 'goal-1',
    title: 'Priority task',
    status: 'pending',
    priority: 'high',
    estimatedMinutes: 30,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    userId: 'owner-1',
    domainId: 'domain-1',
    title: 'Disposable Goal',
    status: 'active',
    priority: 'high',
    targetDate: new Date('2026-12-31T00:00:00.000Z'),
    timeAllocationTarget: 5,
    keyResults: [],
    category: 'important_not_urgent',
    complexity: 'moderate',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    userId: 'owner-1',
    domainId: 'domain-1',
    goalId: 'goal-1',
    name: 'Disposable Project',
    status: 'active',
    priority: 'high',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}
