import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Goal, Session, TimeBlock } from '@/types';

const getByIndexMock = vi.fn();
vi.mock('@/lib/database', () => ({
  db: { getByIndex: (...args: unknown[]) => getByIndexMock(...args) },
}));

vi.mock('@/components/WeeklyPlanning/WpiWeeklyExecutionSummary', () => ({
  default: () => null,
}));

let mockData: {
  status: 'ready' | 'error';
  userId: string;
  timeBlocks: TimeBlock[];
  sessions?: Session[];
  tasks: never[];
  projects: never[];
  goals: Goal[];
};
vi.mock('@/providers/DataProvider', () => ({
  useDataContext: () => mockData,
}));

import WeeklyExecution from './WeeklyExecution';

function monday(hour: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  const weekday = date.getDay();
  date.setDate(date.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  date.setHours(hour, 0, 0, 0);
  return date;
}

function goal(): Goal {
  return {
    id: 'goal-1',
    userId: 'owner-1',
    domainId: 'domain-1',
    title: 'LAVORO',
    status: 'active',
    priority: 'high',
    targetDate: monday(20),
    timeAllocationTarget: 0,
    keyResults: [],
    category: 'important_not_urgent',
    complexity: 'moderate',
    createdAt: monday(7),
    updatedAt: monday(7),
  } as Goal;
}

function block(over: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id: 'block-1',
    userId: 'owner-1',
    domainId: 'domain-1',
    goalId: 'goal-1',
    title: 'Deep work',
    type: 'work',
    status: 'completed',
    startTime: monday(9),
    endTime: monday(11),
    createdAt: new Date(monday(9).getTime() - 86_400_000),
    updatedAt: monday(11),
    ...over,
  } as TimeBlock;
}

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    userId: 'owner-1',
    domainId: 'domain-1',
    timeBlockId: 'block-1',
    goalIds: ['goal-1'],
    startTime: monday(9),
    endTime: new Date(monday(9).getTime() + 30 * 60_000),
    duration: 1_800,
    status: 'completed',
    tags: [],
    createdAt: monday(9),
    updatedAt: monday(10),
    ...over,
  } as Session;
}

beforeEach(() => {
  getByIndexMock.mockReset();
  mockData = {
    status: 'ready',
    userId: 'owner-1',
    timeBlocks: [],
    tasks: [],
    projects: [],
    goals: [goal()],
  };
});

describe('WeeklyExecution', () => {
  it('uses linked Session net time instead of a duplicated block interval', async () => {
    mockData.timeBlocks = [block({ actualStartTime: monday(9), actualEndTime: monday(11) })];
    getByIndexMock.mockResolvedValue([session()]);
    render(<WeeklyExecution />);

    await waitFor(() => expect(screen.getAllByText('25%').length).toBeGreaterThan(0));
    expect(screen.getByText(/30m reali/)).toBeInTheDocument();
    expect(getByIndexMock).toHaveBeenCalledWith('sessions', 'userId', 'owner-1');
  });

  it('labels missing block evidence as a partial lower bound', async () => {
    mockData.timeBlocks = [block()];
    getByIndexMock.mockResolvedValue([]);
    render(<WeeklyExecution />);

    await waitFor(() => expect(screen.getAllByText('≥ 0%').length).toBeGreaterThan(0));
    expect(screen.getByText(/tempo pianificato non viene usato come sostituto/i)).toBeInTheDocument();
  });

  it('does not render missing Sessions as zero and supports retry', async () => {
    mockData.timeBlocks = [block()];
    getByIndexMock.mockRejectedValueOnce(new Error('offline'));
    render(<WeeklyExecution />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/non mostrerà il dato mancante come zero/i)).toBeInTheDocument();
    expect(screen.queryByText('0%')).toBeNull();

    getByIndexMock.mockResolvedValueOnce([session()]);
    fireEvent.click(screen.getByRole('button', { name: /riprova/i }));
    await waitFor(() => expect(screen.getAllByText('25%').length).toBeGreaterThan(0));
  });
});
