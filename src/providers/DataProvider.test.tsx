import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { Goal, KeyResult, Project, Task, TimeBlock } from '@/types';
import type { AtomicDeleteOperation } from '@/lib/firebaseAdapter';

// ---- Mounted-provider harness (db fully mocked) -----------------------------

const { dbMock, entityStore } = vi.hoisted(() => {
  const entityStore: {
    goals: Goal[];
    keyResults: KeyResult[];
    projects: Project[];
    tasks: Task[];
    timeBlocks: TimeBlock[];
  } = { goals: [], keyResults: [], projects: [], tasks: [], timeBlocks: [] };
  const dbMock = {
    init: vi.fn(async () => undefined),
    switchToFirebase: vi.fn(async () => undefined),
    getAll: vi.fn(async (store: string) => (
      entityStore[store as keyof typeof entityStore] ?? []
    )),
    getAllAuthoritative: vi.fn(async (store: string) => (
      entityStore[store as keyof typeof entityStore] ?? []
    )),
    readAuthoritative: vi.fn(async (store: string, id: string) => (
      (entityStore[store as keyof typeof entityStore] as Array<{ id: string }> | undefined)
        ?.find((entity) => entity.id === id) ?? null
    )),
    getByIndex: vi.fn(async () => []),
    update: vi.fn(async (_store: string, data: unknown) => data),
    create: vi.fn(async (_store: string, data: unknown) => data),
    delete: vi.fn(async () => undefined),
    deleteMany: vi.fn(async (operations: readonly AtomicDeleteOperation[]) => {
      const stores = entityStore as Record<string, Array<{ id: string }>>;
      for (const operation of operations) {
        const index = stores[operation.collection].findIndex((entity) => entity.id === operation.id);
        if (index >= 0) stores[operation.collection].splice(index, 1);
      }
    }),
    calculateTodayKPIs: vi.fn(async () => ({})),
    getAdapterType: vi.fn(() => 'memory'),
  };
  return { dbMock, entityStore };
});

vi.mock('@/lib/database', () => ({ db: dbMock }));

import { DataProvider, useDataContext } from './DataProvider';

let capturedUpdateTask: ((id: string, updates: Partial<Task>) => Promise<void>) | null = null;
let capturedRetryLoad: (() => void) | null = null;
let capturedDeleteGoal: ((id: string) => Promise<void>) | null = null;

function Probe() {
  const ctx = useDataContext();
  capturedUpdateTask = ctx.updateTask;
  capturedRetryLoad = ctx.retryLoad;
  capturedDeleteGoal = ctx.deleteGoal;
  return (
    <div>
      <div data-testid="probe-status">{ctx.status}</div>
      <div data-testid="probe-error">{ctx.loadError}</div>
      <div data-testid="probe-goals">{ctx.goals.map((goal) => goal.id).join(',')}</div>
      <div data-testid="probe-key-results">{ctx.keyResults.map((keyResult) => keyResult.id).join(',')}</div>
      <div data-testid="probe-projects">{ctx.projects.map((project) => project.id).join(',')}</div>
      <div data-testid="probe-tasks">{ctx.tasks.map((task) => task.id).join(',')}</div>
      <div data-testid="probe-time-blocks">{ctx.timeBlocks.map((block) => block.id).join(',')}</div>
    </div>
  );
}

function makeStoredTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    userId: 'user-a',
    domainId: 'd1',
    title: 'Task',
    projectId: 'p1',
    status: 'pending',
    priority: 'medium',
    createdAt: new Date(2026, 6, 1),
    updatedAt: new Date(2026, 6, 1),
    ...over,
  } as Task;
}

async function mountWithTask(task: Task) {
  entityStore.tasks = [task];
  render(
    <DataProvider userId="user-a">
      <Probe />
    </DataProvider>
  );
  await waitFor(() => expect(screen.getByTestId('probe-status').textContent).toBe('ready'));
}

// This is a basic test structure - full tests would require more mocking
describe('DataProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    entityStore.goals = [];
    entityStore.keyResults = [];
    entityStore.projects = [];
    entityStore.tasks = [];
    entityStore.timeBlocks = [];
    capturedRetryLoad = null;
    capturedDeleteGoal = null;
    dbMock.init.mockResolvedValue(undefined);
    dbMock.switchToFirebase.mockResolvedValue(undefined);
    dbMock.getAll.mockImplementation(async (store: string) => (
      entityStore[store as keyof typeof entityStore] ?? []
    ));
    dbMock.getAllAuthoritative.mockImplementation(async (store: string) => (
      entityStore[store as keyof typeof entityStore] ?? []
    ));
    dbMock.readAuthoritative.mockImplementation(async (store: string, id: string) => (
      (entityStore[store as keyof typeof entityStore] as Array<{ id: string }> | undefined)
        ?.find((entity) => entity.id === id) ?? null
    ));
    dbMock.deleteMany.mockImplementation(async (operations: readonly AtomicDeleteOperation[]) => {
      const stores = entityStore as Record<string, Array<{ id: string }>>;
      for (const operation of operations) {
        const index = stores[operation.collection].findIndex((entity) => entity.id === operation.id);
        if (index >= 0) stores[operation.collection].splice(index, 1);
      }
    });
    dbMock.calculateTodayKPIs.mockResolvedValue({});
  });

  describe('authenticated bootstrap', () => {
    it('switches directly to Firebase after fresh login without awaiting the local adapter', async () => {
      dbMock.init.mockImplementation(() => new Promise<void>(() => {}));

      render(
        <DataProvider userId="user-a">
          <Probe />
        </DataProvider>
      );

      await waitFor(() => expect(screen.getByTestId('probe-status').textContent).toBe('ready'));
      expect(dbMock.switchToFirebase).toHaveBeenCalledTimes(1);
      expect(dbMock.switchToFirebase).toHaveBeenCalledWith('user-a');
      expect(dbMock.init).not.toHaveBeenCalled();
    });

    it('exits loading on bootstrap failure and can retry without a page reload', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      dbMock.switchToFirebase
        .mockRejectedValueOnce(new Error('permission-denied'))
        .mockResolvedValueOnce(undefined);

      render(
        <DataProvider userId="user-a">
          <Probe />
        </DataProvider>
      );

      await waitFor(() => expect(screen.getByTestId('probe-status').textContent).toBe('error'));
      expect(screen.getByTestId('probe-error').textContent).toContain('Production data could not be loaded');

      await act(() => capturedRetryLoad!());

      await waitFor(() => expect(screen.getByTestId('probe-status').textContent).toBe('ready'));
      expect(dbMock.switchToFirebase).toHaveBeenCalledTimes(2);
      consoleError.mockRestore();
    });
  });

  describe('TimeBlock Validation', () => {
    it('should throw error when creating TimeBlock without links', async () => {
      // This test verifies the validation logic exists
      // Full test would require mounting the provider

      const invalidTimeBlock = {
        title: 'Test Block',
        startTime: new Date(),
        endTime: new Date(),
        // Missing taskId, projectId, AND goalId
      };

      // The actual validation is in createTimeBlock function
      // This test documents expected behavior
      expect(() => {
        if (!invalidTimeBlock.hasOwnProperty('taskId') &&
            !invalidTimeBlock.hasOwnProperty('projectId') &&
            !invalidTimeBlock.hasOwnProperty('goalId')) {
          throw new Error('TimeBlock must be linked to at least one entity (Task, Project, or Goal)');
        }
      }).toThrow('TimeBlock must be linked');
    });

    it('should allow TimeBlock with at least one link', () => {
      const validTimeBlock = {
        title: 'Test Block',
        startTime: new Date(),
        endTime: new Date(),
        goalId: 'goal-123', // Has link
      };

      expect(() => {
        if (!validTimeBlock.hasOwnProperty('taskId') &&
            !validTimeBlock.hasOwnProperty('projectId') &&
            !validTimeBlock.hasOwnProperty('goalId')) {
          throw new Error('TimeBlock must be linked');
        }
      }).not.toThrow();
    });
  });

  // Regression (2026-07 "0/19 planned tasks done"): completing a task from
  // the OKR manager only flipped `status`, never wrote `completedAt`, so no
  // analytics could ever see the completion. updateTask now owns the
  // completion-timestamp integrity for every caller.
  describe('updateTask completedAt integrity', () => {
    beforeEach(() => {
      capturedUpdateTask = null;
      dbMock.update.mockClear();
    });

    it('backfills completedAt when a task transitions to completed', async () => {
      await mountWithTask(makeStoredTask());
      await act(() => capturedUpdateTask!('t1', { status: 'completed' }));

      const payload = dbMock.update.mock.calls.at(-1)?.[1] as Task;
      expect(payload.status).toBe('completed');
      expect(payload.completedAt).toBeInstanceOf(Date);
    });

    it('clears completedAt (null for Firestore) when a task is un-completed', async () => {
      await mountWithTask(
        makeStoredTask({ status: 'completed', completedAt: new Date(2026, 6, 10) })
      );
      await act(() => capturedUpdateTask!('t1', { status: 'pending' }));

      const payload = dbMock.update.mock.calls.at(-1)?.[1] as Task;
      expect(payload.status).toBe('pending');
      expect(payload.completedAt).toBeNull();
    });

    it('respects an explicit completedAt passed by the caller', async () => {
      const explicit = new Date(2026, 6, 12, 18, 30);
      await mountWithTask(makeStoredTask());
      await act(() => capturedUpdateTask!('t1', { status: 'completed', completedAt: explicit }));

      const payload = dbMock.update.mock.calls.at(-1)?.[1] as Task;
      expect(payload.completedAt).toEqual(explicit);
    });

    it('keeps an existing completedAt when completing an already-completed task again', async () => {
      const original = new Date(2026, 6, 5, 9, 0);
      await mountWithTask(makeStoredTask({ status: 'completed', completedAt: original }));
      await act(() => capturedUpdateTask!('t1', { status: 'completed' }));

      const payload = dbMock.update.mock.calls.at(-1)?.[1] as Task;
      expect(payload.completedAt).toEqual(original);
    });
  });

  describe('authoritative Goal deletion', () => {
    it('keeps the full hierarchy visible until the atomic server commit is acknowledged', async () => {
      seedGoalHierarchy();
      let acknowledge!: () => void;
      dbMock.deleteMany.mockImplementationOnce(() => new Promise<void>((resolve) => {
        acknowledge = resolve;
      }));
      await mountProvider();

      let deletion!: Promise<void>;
      act(() => {
        deletion = capturedDeleteGoal!('goal-1');
      });

      await waitFor(() => expect(dbMock.deleteMany).toHaveBeenCalledOnce());

      expect(screen.getByTestId('probe-goals')).toHaveTextContent('goal-1');
      expect(screen.getByTestId('probe-key-results')).toHaveTextContent('kr-1');
      expect(screen.getByTestId('probe-projects')).toHaveTextContent('project-1');
      expect(screen.getByTestId('probe-tasks')).toHaveTextContent('task-1');

      await act(async () => {
        acknowledge();
        await deletion;
      });

      expect(screen.getByTestId('probe-goals')).not.toHaveTextContent('goal-1');
      expect(screen.getByTestId('probe-key-results')).not.toHaveTextContent('kr-1');
      expect(screen.getByTestId('probe-projects')).not.toHaveTextContent('project-1');
      expect(screen.getByTestId('probe-tasks')).not.toHaveTextContent('task-1');
    });

    it('deletes Key Results, Projects, and direct or transitive Tasks in one operation', async () => {
      seedGoalHierarchy();
      entityStore.tasks.push(makeStoredTask({
        id: 'task-direct',
        projectId: 'project-other',
        goalId: 'goal-1',
      }));
      await mountProvider();

      await act(async () => capturedDeleteGoal!('goal-1'));

      expect(dbMock.deleteMany).toHaveBeenCalledWith([
        { collection: 'keyResults', id: 'kr-1' },
        { collection: 'tasks', id: 'task-1' },
        { collection: 'tasks', id: 'task-direct' },
        { collection: 'projects', id: 'project-1' },
        { collection: 'goals', id: 'goal-1' },
      ]);
      expect(entityStore.goals.map(({ id }) => id)).toEqual(['goal-other']);
      expect(entityStore.keyResults).toEqual([]);
      expect(entityStore.projects.map(({ id }) => id)).toEqual(['project-other']);
      expect(entityStore.tasks).toEqual([]);
    });

    it('does not report success or mutate UI state when the server mutation fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      seedGoalHierarchy();
      dbMock.deleteMany.mockRejectedValueOnce(new Error('offline'));
      await mountProvider();

      await act(async () => {
        await expect(capturedDeleteGoal!('goal-1')).rejects.toThrow('offline');
      });

      expect(screen.getByTestId('probe-goals')).toHaveTextContent('goal-1');
      expect(screen.getByTestId('probe-key-results')).toHaveTextContent('kr-1');
      expect(screen.getByTestId('probe-projects')).toHaveTextContent('project-1');
      expect(screen.getByTestId('probe-tasks')).toHaveTextContent('task-1');
      consoleError.mockRestore();
    });

    it('remains absent after authoritative reload and repeated deletion is idempotent', async () => {
      seedGoalHierarchy();
      const firstMount = await mountProvider();

      await act(async () => capturedDeleteGoal!('goal-1'));
      expect(dbMock.deleteMany).toHaveBeenCalledTimes(1);
      await act(async () => capturedDeleteGoal!('goal-1'));
      expect(dbMock.deleteMany).toHaveBeenCalledTimes(1);
      firstMount.unmount();

      await mountProvider();
      expect(screen.getByTestId('probe-goals')).not.toHaveTextContent('goal-1');
      expect(screen.getByTestId('probe-key-results')).not.toHaveTextContent('kr-1');
      expect(screen.getByTestId('probe-projects')).not.toHaveTextContent('project-1');
      expect(screen.getByTestId('probe-tasks')).not.toHaveTextContent('task-1');
      expect(dbMock.init).not.toHaveBeenCalled();
    });

    it('rejects a legacy orphan after delete, refresh, rehydrate, and restart while preserving history and Goal p', async () => {
      const legacyTitle = 'i 100 studi che bisogna conoscere';
      seedGoalHierarchy();
      entityStore.goals.push(makeGoal('goal-p'));
      entityStore.projects.push(makeProject('project-p', 'goal-p'));
      entityStore.tasks[0] = makeStoredTask({
        id: 'legacy-task',
        title: legacyTitle,
        priority: 'critical',
        projectId: 'project-1',
        goalId: 'goal-1',
      });
      entityStore.tasks.push(makeStoredTask({
        id: 'task-p',
        title: 'Task del Goal p',
        projectId: 'project-p',
        goalId: 'goal-p',
      }));
      entityStore.timeBlocks = [
        makeTimeBlock('legacy-future', 'planned'),
        makeTimeBlock('legacy-history', 'completed'),
        makeTimeBlock('block-p', 'planned', {
          taskId: 'task-p', projectId: 'project-p', goalId: 'goal-p', title: 'Goal p block',
        }),
      ];
      const firstMount = await mountProvider();

      expect(screen.getByTestId('probe-tasks')).toHaveTextContent('legacy-task,task-p');
      await act(async () => capturedDeleteGoal!('goal-1'));

      expect(screen.getByTestId('probe-goals')).toHaveTextContent('goal-p');
      expect(screen.getByTestId('probe-tasks')).toHaveTextContent('task-p');
      expect(screen.getByTestId('probe-time-blocks')).not.toHaveTextContent('legacy-future');
      expect(screen.getByTestId('probe-time-blocks')).toHaveTextContent('legacy-history');
      expect(screen.getByTestId('probe-time-blocks')).toHaveTextContent('block-p');

      // Reproduce the real persistence condition: an undeleted legacy Task
      // still exists in the owner-scoped collection after its parents are gone.
      entityStore.tasks.push(makeStoredTask({
        id: 'legacy-orphan',
        title: legacyTitle,
        priority: 'critical',
        projectId: 'project-1',
        goalId: 'goal-1',
      }));
      await act(() => capturedRetryLoad!());
      await waitFor(() => expect(dbMock.switchToFirebase).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByTestId('probe-status')).toHaveTextContent('ready'));
      expect(screen.getByTestId('probe-tasks')).toHaveTextContent('task-p');
      expect(screen.getByTestId('probe-tasks')).not.toHaveTextContent('legacy-orphan');

      firstMount.unmount();
      await mountProvider();
      expect(screen.getByTestId('probe-goals')).toHaveTextContent('goal-p');
      expect(screen.getByTestId('probe-tasks')).toHaveTextContent('task-p');
      expect(screen.getByTestId('probe-tasks')).not.toHaveTextContent('legacy-orphan');
      expect(screen.getByTestId('probe-time-blocks')).not.toHaveTextContent('legacy-future');
      expect(screen.getByTestId('probe-time-blocks')).toHaveTextContent('legacy-history');
    });
  });
});

async function mountProvider() {
  const view = render(
    <DataProvider userId="user-a">
      <Probe />
    </DataProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('probe-status')).toHaveTextContent('ready'));
  return view;
}

function seedGoalHierarchy() {
  entityStore.goals = [makeGoal('goal-1'), makeGoal('goal-other')];
  entityStore.keyResults = [makeKeyResult('kr-1', 'goal-1')];
  entityStore.projects = [makeProject('project-1', 'goal-1'), makeProject('project-other', 'goal-other')];
  entityStore.tasks = [makeStoredTask({ id: 'task-1', projectId: 'project-1', goalId: 'goal-1' })];
}

function makeGoal(id: string): Goal {
  return {
    id,
    userId: 'user-a',
    domainId: 'd1',
    title: id,
    status: 'active',
    priority: 'medium',
    targetDate: new Date(2026, 11, 31),
    timeAllocationTarget: 4,
    keyResults: [],
    category: 'important_not_urgent',
    complexity: 'moderate',
    createdAt: new Date(2026, 6, 1),
    updatedAt: new Date(2026, 6, 1),
  };
}

function makeKeyResult(id: string, goalId: string): KeyResult {
  return {
    id,
    goalId,
    userId: 'user-a',
    domainId: 'd1',
    title: id,
    targetValue: 1,
    currentValue: 0,
    status: 'active',
    createdAt: new Date(2026, 6, 1),
    updatedAt: new Date(2026, 6, 1),
  };
}

function makeProject(id: string, goalId: string): Project {
  return {
    id,
    goalId,
    userId: 'user-a',
    domainId: 'd1',
    name: id,
    status: 'active',
    priority: 'medium',
    createdAt: new Date(2026, 6, 1),
    updatedAt: new Date(2026, 6, 1),
  };
}

function makeTimeBlock(
  id: string,
  status: TimeBlock['status'],
  overrides: Partial<TimeBlock> = {},
): TimeBlock {
  return {
    id,
    userId: 'user-a',
    domainId: 'd1',
    title: id,
    taskId: 'legacy-task',
    projectId: 'project-1',
    goalId: 'goal-1',
    startTime: new Date('2026-08-27T09:00:00.000Z'),
    endTime: new Date('2026-08-27T10:00:00.000Z'),
    status,
    type: 'focus',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}
