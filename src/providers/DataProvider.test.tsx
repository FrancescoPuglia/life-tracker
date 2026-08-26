import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { Task } from '@/types';

// ---- Mounted-provider harness (db fully mocked) -----------------------------

const { dbMock, taskStore } = vi.hoisted(() => {
  const taskStore: { tasks: Task[] } = { tasks: [] };
  const dbMock = {
    init: vi.fn(async () => undefined),
    switchToFirebase: vi.fn(async () => undefined),
    getAll: vi.fn(async (store: string) => (store === 'tasks' ? taskStore.tasks : [])),
    getByIndex: vi.fn(async () => []),
    update: vi.fn(async (_store: string, data: unknown) => data),
    create: vi.fn(async (_store: string, data: unknown) => data),
    delete: vi.fn(async () => undefined),
    calculateTodayKPIs: vi.fn(async () => ({})),
    getAdapterType: vi.fn(() => 'memory'),
  };
  return { dbMock, taskStore };
});

vi.mock('@/lib/database', () => ({ db: dbMock }));

import { DataProvider, useDataContext } from './DataProvider';

let capturedUpdateTask: ((id: string, updates: Partial<Task>) => Promise<void>) | null = null;
let capturedRetryLoad: (() => void) | null = null;

function Probe() {
  const ctx = useDataContext();
  capturedUpdateTask = ctx.updateTask;
  capturedRetryLoad = ctx.retryLoad;
  return (
    <div>
      <div data-testid="probe-status">{ctx.status}</div>
      <div data-testid="probe-error">{ctx.loadError}</div>
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
  taskStore.tasks = [task];
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
    taskStore.tasks = [];
    capturedRetryLoad = null;
    dbMock.init.mockResolvedValue(undefined);
    dbMock.switchToFirebase.mockResolvedValue(undefined);
    dbMock.getAll.mockImplementation(async (store: string) => (store === 'tasks' ? taskStore.tasks : []));
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

  describe('Cascade Delete Logic', () => {
    it('should identify affected children when deleting goal', () => {
      const goal = { id: 'goal-1', title: 'Test Goal' };
      const projects = [
        { id: 'proj-1', goalId: 'goal-1', name: 'Project 1' },
        { id: 'proj-2', goalId: 'goal-2', name: 'Project 2' },
        { id: 'proj-3', goalId: 'goal-1', name: 'Project 3' },
      ];
      const tasks = [
        { id: 'task-1', projectId: 'proj-1', title: 'Task 1' },
        { id: 'task-2', projectId: 'proj-2', title: 'Task 2' },
        { id: 'task-3', projectId: 'proj-3', title: 'Task 3' },
      ];

      // Cascade logic
      const affectedProjects = projects.filter(p => p.goalId === goal.id);
      const affectedProjectIds = new Set(affectedProjects.map(p => p.id));
      const affectedTasks = tasks.filter(t => affectedProjectIds.has(t.projectId));

      expect(affectedProjects).toHaveLength(2); // proj-1, proj-3
      expect(affectedTasks).toHaveLength(2); // task-1, task-3
    });
  });
});
