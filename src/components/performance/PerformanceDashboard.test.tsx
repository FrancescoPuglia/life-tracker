// src/components/performance/PerformanceDashboard.test.tsx
//
// Component tests for the Performance Review tab: rendering with fixture
// data, period switching, filter drill-down, user isolation of the session
// query, empty state and session-error recovery.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Goal, Project, Session, Task, TimeBlock } from '@/types';

// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// ---- Mocks ------------------------------------------------------------------

const getByIndexMock = vi.fn();
vi.mock('@/lib/database', () => ({
  db: { getByIndex: (...args: unknown[]) => getByIndexMock(...args) },
}));

interface MockData {
  status: 'ready' | 'error';
  userId: string;
  timeBlocks: TimeBlock[];
  goals: Goal[];
  projects: Project[];
  tasks: Task[];
}
let mockData: MockData;
vi.mock('@/providers/DataProvider', () => ({
  useDataContext: () => mockData,
}));

import PerformanceDashboard from './PerformanceDashboard';

// ---- Fixtures (relative to the real current week) ----------------------------

const NOW = new Date();

function thisWeekDay(offsetFromMonday: number, hour: number): Date {
  const d = new Date(NOW);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day) + offsetFromMonday);
  d.setHours(hour, 0, 0, 0);
  return d;
}

let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

function makeGoal(title: string): Goal {
  return {
    id: uid('goal'),
    userId: 'user-a',
    domainId: 'd1',
    title,
    status: 'active',
    priority: 'high',
    targetDate: thisWeekDay(6, 23),
    timeAllocationTarget: 0,
    keyResults: [],
    category: 'important_not_urgent',
    complexity: 'moderate',
    createdAt: new Date(2025, 0, 1),
    updatedAt: new Date(2025, 0, 1),
  } as Goal;
}

function makeProject(name: string, goalId: string): Project {
  return {
    id: uid('project'),
    userId: 'user-a',
    domainId: 'd1',
    name,
    goalId,
    status: 'active',
    priority: 'high',
    createdAt: new Date(2025, 0, 1),
    updatedAt: new Date(2025, 0, 1),
  } as Project;
}

function makeBlock(over: Partial<TimeBlock>): TimeBlock {
  const startTime = over.startTime ?? thisWeekDay(0, 9);
  return {
    id: uid('block'),
    userId: 'user-a',
    domainId: 'd1',
    title: 'Deep work',
    type: 'work',
    status: 'completed',
    startTime,
    endTime: over.endTime ?? new Date(startTime.getTime() + 2 * 3600 * 1000),
    createdAt: new Date(startTime.getTime() - 24 * 3600 * 1000),
    updatedAt: startTime,
    ...over,
  } as TimeBlock;
}

function makeSession(over: Partial<Session>): Session {
  const startTime = over.startTime ?? thisWeekDay(1, 8);
  return {
    id: uid('session'),
    userId: 'user-a',
    domainId: 'd1',
    startTime,
    endTime: new Date(startTime.getTime() + 30 * 60 * 1000),
    duration: 1800,
    status: 'completed',
    tags: [],
    createdAt: startTime,
    updatedAt: startTime,
    ...over,
  } as Session;
}

function buildFixture() {
  const goalWork = makeGoal('LAVORO');
  const goalChess = makeGoal('SCACCHI');
  const projectWork = makeProject('Client Alpha', goalWork.id);
  const projectChess = makeProject('Opening Prep', goalChess.id);
  const blocks = [
    // Monday: planned 2h, executed 2h (measured) on LAVORO.
    makeBlock({
      projectId: projectWork.id,
      startTime: thisWeekDay(0, 9),
      endTime: thisWeekDay(0, 11),
      actualStartTime: thisWeekDay(0, 9),
      actualEndTime: thisWeekDay(0, 11),
    }),
    // Monday: planned 1h on SCACCHI, never executed (still 'planned').
    makeBlock({
      projectId: projectChess.id,
      status: 'planned',
      startTime: thisWeekDay(0, 18),
      endTime: thisWeekDay(0, 19),
    }),
  ];
  return { goalWork, goalChess, projectWork, projectChess, blocks };
}

function setMockData(partial?: Partial<MockData>) {
  const fixture = buildFixture();
  mockData = {
    status: 'ready',
    userId: 'user-a',
    timeBlocks: fixture.blocks,
    goals: [fixture.goalWork, fixture.goalChess],
    projects: [fixture.projectWork, fixture.projectChess],
    tasks: [],
    ...partial,
  };
  return fixture;
}

beforeEach(() => {
  seq = 0;
  getByIndexMock.mockReset();
  getByIndexMock.mockResolvedValue([]);
});

// ---- Tests --------------------------------------------------------------------

describe('PerformanceDashboard', () => {
  it('renders the KPI grid from real fixture data with no NaN/Infinity', async () => {
    setMockData();
    const { container } = render(<PerformanceDashboard />);

    await waitFor(() => expect(screen.getByTestId('performance-dashboard')).toBeInTheDocument());

    const actualTile = screen.getByTestId('kpi-actual');
    expect(within(actualTile).getByText('2h')).toBeInTheDocument();
    const plannedTile = screen.getByTestId('kpi-planned');
    expect(within(plannedTile).getByText('3h')).toBeInTheDocument();

    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('Infinity');
  });

  it('queries sessions for the signed-in user and drops foreign records', async () => {
    setMockData();
    getByIndexMock.mockResolvedValue([
      makeSession({}), // user-a, 30m orphan session
      makeSession({ userId: 'user-b', duration: 36000 }), // must never count
    ]);
    render(<PerformanceDashboard />);

    await waitFor(() => expect(screen.getByTestId('performance-dashboard')).toBeInTheDocument());
    expect(getByIndexMock).toHaveBeenCalledWith('sessions', 'userId', 'user-a');

    // 2h block + 30m own session = 2h 30m; the 10h foreign session is excluded.
    const actualTile = screen.getByTestId('kpi-actual');
    expect(within(actualTile).getByText('2h 30m')).toBeInTheDocument();
  });

  it('switches Week / Month / Year and navigates periods', async () => {
    setMockData();
    render(<PerformanceDashboard />);
    await waitFor(() => expect(screen.getByTestId('performance-dashboard')).toBeInTheDocument());

    const label = () => screen.getByTestId('period-label').textContent ?? '';
    expect(label()).toContain('W'); // week label carries the ISO week number

    fireEvent.click(screen.getByTestId('period-month'));
    expect(label()).toBe(
      NOW.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    );

    fireEvent.click(screen.getByTestId('period-year'));
    expect(label()).toBe(String(NOW.getFullYear()));

    fireEvent.click(screen.getByTestId('period-prev'));
    expect(label()).toBe(String(NOW.getFullYear() - 1));
    // Off the current period → the "Current" shortcut appears and returns home.
    fireEvent.click(screen.getByTestId('period-today'));
    expect(label()).toBe(String(NOW.getFullYear()));
  });

  it('drills every panel down to a goal when its row is clicked', async () => {
    const fixture = setMockData();
    render(<PerformanceDashboard />);
    await waitFor(() => expect(screen.getByTestId('performance-dashboard')).toBeInTheDocument());

    // Both projects visible before filtering.
    expect(screen.getByTestId(`project-row-${fixture.projectWork.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`project-row-${fixture.projectChess.id}`)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`goal-row-${fixture.goalWork.id}`));

    await waitFor(() => {
      expect(screen.queryByTestId(`project-row-${fixture.projectChess.id}`)).toBeNull();
    });
    expect(screen.getByTestId(`project-row-${fixture.projectWork.id}`)).toBeInTheDocument();
    // KPI now reflects only LAVORO (2h actual, 2h planned).
    expect(within(screen.getByTestId('kpi-planned')).getByText('2h')).toBeInTheDocument();

    // Reset restores the full view.
    fireEvent.click(screen.getByTestId('filter-reset'));
    await waitFor(() =>
      expect(screen.getByTestId(`project-row-${fixture.projectChess.id}`)).toBeInTheDocument()
    );
  });

  it('filters the activity table to a day selected on the heatmap', async () => {
    setMockData();
    render(<PerformanceDashboard />);
    await waitFor(() => expect(screen.getByTestId('performance-dashboard')).toBeInTheDocument());

    const monday = thisWeekDay(0, 0);
    const mondayKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(
      monday.getDate()
    ).padStart(2, '0')}`;
    fireEvent.click(screen.getByTestId(`heat-cell-${mondayKey}`));

    const chip = await screen.findByTestId('clear-day-filter');
    expect(chip.textContent).toContain(mondayKey);
    fireEvent.click(chip);
    await waitFor(() => expect(screen.queryByTestId('clear-day-filter')).toBeNull());
  });

  it('shows the empty state when the period has no plan, no execution, no tasks', async () => {
    setMockData({ timeBlocks: [], goals: [], projects: [] });
    render(<PerformanceDashboard onNavigate={() => {}} />);

    await waitFor(() =>
      expect(screen.getByTestId('performance-empty-state')).toBeInTheDocument()
    );
    expect(screen.getByText(/Nothing planned or tracked/i)).toBeInTheDocument();
    expect(screen.getByText(/Open Time Planner/i)).toBeInTheDocument();
  });

  it('degrades gracefully when sessions fail to load, with a retry', async () => {
    setMockData();
    getByIndexMock.mockRejectedValueOnce(new Error('firestore offline'));
    render(<PerformanceDashboard />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/actual execution is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByTestId('performance-dashboard')).toBeNull();

    getByIndexMock.mockResolvedValueOnce([makeSession({})]);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() =>
      expect(screen.getByTestId('performance-dashboard')).toBeInTheDocument()
    );
    expect(within(screen.getByTestId('kpi-actual')).getByText('2h 30m')).toBeInTheDocument();
  });

  it('renders insights derived from the data and applies their link filters', async () => {
    const fixture = setMockData();
    render(<PerformanceDashboard />);
    await waitFor(() => expect(screen.getByTestId('performance-dashboard')).toBeInTheDocument());

    // SCACCHI has 1h planned and zero execution → under-plan/idle insight exists.
    const insight = screen.getByTestId('insight-goal-under-plan');
    expect(insight.textContent).toContain('SCACCHI');

    fireEvent.click(insight);
    await waitFor(() => {
      expect(screen.queryByTestId(`project-row-${fixture.projectWork.id}`)).toBeNull();
    });
    expect(screen.getByTestId(`project-row-${fixture.projectChess.id}`)).toBeInTheDocument();
  });
});
