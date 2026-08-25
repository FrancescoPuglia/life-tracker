import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TimeBlock } from '@/types';
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
    expect(within(pulse).getByText('Known actual')).toBeInTheDocument();
    expect(within(pulse).getByText('0 min')).toBeInTheDocument();
    expect(within(pulse).getByText('Adherence').parentElement).toHaveTextContent('—');
    expect(screen.getByTestId('today-execution-quality')).toHaveTextContent(
      '1 executed block missing actual evidence',
    );
  });

  it('does not render unavailable Sessions as zero execution', () => {
    renderToday({
      timeBlocks: [makeBlock({ status: 'completed' })],
      sessions: [],
      sessionCoverage: 'error',
    });

    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(screen.getByTestId('today-execution-quality')).toHaveTextContent(
      'execution is not reported as zero',
    );
    expect(screen.getByTestId('today-start-focus')).toBeDisabled();
    expect(screen.getByTestId('today-start-focus')).toHaveTextContent('Sessions unavailable');
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
    expect(reminder).toHaveTextContent('Desktopready');
    expect(reminder).toHaveTextContent('Before block15m');
    expect(reminder).toHaveTextContent('Europe/Rome');
    fireEvent.click(screen.getByRole('button', { name: 'Open reminder settings →' }));
    expect(onOpenTab).toHaveBeenCalledWith('settings');
  });

  it('captures a note through the bounded parent action and normalizes failures', async () => {
    const onQuickCapture = vi.fn(async () => undefined);
    const view = renderToday({ onQuickCapture });
    fireEvent.change(screen.getByLabelText('Quick capture note'), {
      target: { value: 'A useful thought' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    await screen.findByText('Captured in Notes.');
    expect(onQuickCapture).toHaveBeenCalledWith('A useful thought');

    onQuickCapture.mockRejectedValueOnce(new Error('private provider detail'));
    fireEvent.change(screen.getByLabelText('Quick capture note'), {
      target: { value: 'Try again' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('failed safely'));
    expect(view.container).not.toHaveTextContent('private provider detail');
  });
});

function renderToday(overrides: Partial<TodayCommandCenterProps> = {}) {
  const preferences = {
    ...defaultNotificationPreferences(),
    desktopEnabled: true,
  };
  const props: TodayCommandCenterProps = {
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
  return render(<TodayCommandCenter {...props} />);
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
