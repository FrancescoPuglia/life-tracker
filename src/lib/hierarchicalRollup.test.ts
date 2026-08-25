import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { Goal, Project, Session, Task, TimeBlock } from '@/types';

const dbMock = vi.hoisted(() => ({
  getAll: vi.fn(),
  update: vi.fn(async (_collection: string, value: unknown) => value),
}));

vi.mock('./database', () => ({ db: dbMock }));

import { calculateProgressPercentage, performHierarchicalRollup } from './hierarchicalRollup';

describe('hierarchicalRollup', () => {
  beforeEach(() => {
    dbMock.getAll.mockReset();
    dbMock.update.mockClear();
  });

  describe('calculateProgressPercentage', () => {
    it('should calculate percentage correctly', () => {
      expect(calculateProgressPercentage(5, 10)).toBe(50);
      expect(calculateProgressPercentage(10, 10)).toBe(100);
      expect(calculateProgressPercentage(7.5, 10)).toBe(75);
      expect(calculateProgressPercentage(2.5, 10)).toBe(25);
    });

    it('should clamp to 100% maximum', () => {
      expect(calculateProgressPercentage(15, 10)).toBe(100);
      expect(calculateProgressPercentage(200, 10)).toBe(100);
      expect(calculateProgressPercentage(10.1, 10)).toBe(100);
    });

    it('should handle zero target', () => {
      expect(calculateProgressPercentage(5, 0)).toBe(0);
      expect(calculateProgressPercentage(5, undefined)).toBe(0);
      expect(calculateProgressPercentage(100, 0)).toBe(0);
    });

    it('should handle zero actual hours', () => {
      expect(calculateProgressPercentage(0, 10)).toBe(0);
      expect(calculateProgressPercentage(0, 0)).toBe(0);
    });

    it('should handle negative values gracefully', () => {
      // Edge case: negative hours should be treated as 0
      expect(calculateProgressPercentage(-5, 10)).toBe(0);
      expect(calculateProgressPercentage(5, -10)).toBe(0);
    });

    it('should round to nearest integer', () => {
      expect(calculateProgressPercentage(1, 3)).toBe(33); // 33.33... rounded
      expect(calculateProgressPercentage(2, 3)).toBe(67); // 66.66... rounded
      expect(calculateProgressPercentage(1, 7)).toBe(14); // 14.28... rounded
    });
  });

  it('rolls up linked Session net time once and never substitutes a planned block', async () => {
    const owner = 'owner-1';
    const goal = entity<Goal>({ id: 'goal-1', userId: owner, title: 'Goal' });
    const project = entity<Project>({ id: 'project-1', userId: owner, goalId: goal.id, name: 'Project' });
    const task = entity<Task>({ id: 'task-1', userId: owner, projectId: project.id, title: 'Task' });
    const linkedBlock = entity<TimeBlock>({
      id: 'block-1',
      userId: owner,
      taskId: task.id,
      title: 'Executed',
      type: 'work',
      status: 'completed',
      startTime: new Date('2026-08-25T08:00:00.000Z'),
      endTime: new Date('2026-08-25T09:00:00.000Z'),
      actualStartTime: new Date('2026-08-25T08:00:00.000Z'),
      actualEndTime: new Date('2026-08-25T10:00:00.000Z'),
    });
    const missingBlock = entity<TimeBlock>({
      id: 'block-missing',
      userId: owner,
      projectId: project.id,
      title: 'Missing evidence',
      type: 'work',
      status: 'completed',
      startTime: new Date('2026-08-25T10:00:00.000Z'),
      endTime: new Date('2026-08-25T11:00:00.000Z'),
    });
    const linkedSession = entity<Session>({
      id: 'session-1',
      userId: owner,
      domainId: 'domain-1',
      taskId: task.id,
      timeBlockId: linkedBlock.id,
      startTime: new Date('2026-08-25T08:00:00.000Z'),
      endTime: new Date('2026-08-25T08:30:00.000Z'),
      duration: 1_800,
      status: 'completed',
      tags: [],
    });
    const foreignSession = entity<Session>({ ...linkedSession, id: 'foreign', userId: 'owner-2', duration: 7_200 });
    const collections: Record<string, unknown[]> = {
      timeBlocks: [linkedBlock, missingBlock],
      sessions: [linkedSession, foreignSession],
      tasks: [task],
      projects: [project],
      goals: [goal],
    };
    dbMock.getAll.mockImplementation(async (collection: string) => collections[collection] ?? []);

    const result = await performHierarchicalRollup(owner);

    expect(result.taskUpdates).toEqual([{ id: task.id, actualMinutes: 30, actualHours: 0.5 }]);
    expect(result.projectUpdates).toEqual([{ id: project.id, actualMinutes: 30, actualHours: 0.5 }]);
    expect(result.goalUpdates).toEqual([{ id: goal.id, actualMinutes: 30, actualHours: 0.5 }]);
    expect(dbMock.update).toHaveBeenCalledTimes(3);
  });
});

function entity<T>(partial: Partial<T>): T {
  return {
    createdAt: new Date('2026-08-24T08:00:00.000Z'),
    updatedAt: new Date('2026-08-25T08:00:00.000Z'),
    domainId: 'domain-1',
    status: 'active',
    ...partial,
  } as T;
}
