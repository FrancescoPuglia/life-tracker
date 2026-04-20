import { describe, it, expect } from 'vitest';
import { calculateStreak, getStreakMessage } from './streakCalculator';
import { TimeBlock, HabitLog, Task } from '@/types';

describe('streakCalculator', () => {
  describe('calculateStreak', () => {
    it('should return zero streak when no activity', () => {
      const result = calculateStreak([], [], []);

      expect(result.currentStreak).toBe(0);
      expect(result.bestStreak).toBe(0);
      expect(result.totalActiveDays).toBe(0);
      expect(result.lastActivityDate).toBeNull();
    });

    it('should calculate streak from completed time blocks', () => {
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const timeBlocks: TimeBlock[] = [
        {
          id: 'tb1',
          userId: 'user1',
          domainId: 'domain1',
          title: 'Work',
          type: 'work' as const,
          startTime: yesterday,
          endTime: yesterday,
          status: 'completed',
          deleted: false,
          createdAt: yesterday,
          updatedAt: yesterday
        },
        {
          id: 'tb2',
          userId: 'user1',
          domainId: 'domain1',
          title: 'Work',
          type: 'work' as const,
          startTime: today,
          endTime: today,
          status: 'completed',
          deleted: false,
          createdAt: today,
          updatedAt: today
        }
      ];

      const result = calculateStreak(timeBlocks, [], []);

      expect(result.currentStreak).toBe(2);
      expect(result.bestStreak).toBe(2);
      expect(result.totalActiveDays).toBe(2);
    });

    it('should not count deleted time blocks', () => {
      const today = new Date();

      const timeBlocks: TimeBlock[] = [
        {
          id: 'tb1',
          userId: 'user1',
          domainId: 'domain1',
          title: 'Work',
          type: 'work' as const,
          startTime: today,
          endTime: today,
          status: 'completed',
          deleted: true, // DELETED
          createdAt: today,
          updatedAt: today
        }
      ];

      const result = calculateStreak(timeBlocks, [], []);

      expect(result.currentStreak).toBe(0);
      expect(result.totalActiveDays).toBe(0);
    });

    it('should not count planned time blocks (only completed)', () => {
      const today = new Date();

      const timeBlocks: TimeBlock[] = [
        {
          id: 'tb1',
          userId: 'user1',
          domainId: 'domain1',
          title: 'Work',
          type: 'work' as const,
          startTime: today,
          endTime: today,
          status: 'planned', // NOT COMPLETED
          deleted: false,
          createdAt: today,
          updatedAt: today
        }
      ];

      const result = calculateStreak(timeBlocks, [], []);

      expect(result.currentStreak).toBe(0);
    });

    it('should calculate streak from habit logs', () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      const habitLogs: HabitLog[] = [
        {
          id: 'hl1',
          habitId: 'habit1',
          userId: 'user1',
          date: yesterday,
          completed: true,
          createdAt: yesterday
        },
        {
          id: 'hl2',
          habitId: 'habit1',
          userId: 'user1',
          date: new Date(),
          completed: true,
          createdAt: new Date()
        }
      ];

      const result = calculateStreak([], habitLogs, []);

      expect(result.currentStreak).toBe(2);
      expect(result.bestStreak).toBe(2);
    });

    it('should calculate streak from completed tasks', () => {
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const tasks: Task[] = [
        {
          id: 'task1',
          userId: 'user1',
          domainId: 'domain1',
          projectId: 'proj1',
          title: 'Task 1',
          status: 'completed' as any,
          priority: 'medium' as any,
          estimatedMinutes: 60,
          completedAt: yesterday,
          deleted: false,
          createdAt: yesterday,
          updatedAt: yesterday
        },
        {
          id: 'task2',
          userId: 'user1',
          domainId: 'domain1',
          projectId: 'proj1',
          title: 'Task 2',
          status: 'completed' as any,
          priority: 'medium' as any,
          estimatedMinutes: 60,
          completedAt: today,
          deleted: false,
          createdAt: today,
          updatedAt: today
        }
      ];

      const result = calculateStreak([], [], tasks);

      expect(result.currentStreak).toBe(2);
      expect(result.bestStreak).toBe(2);
    });

    it('should break streak on missing day', () => {
      const today = new Date();
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const timeBlocks: TimeBlock[] = [
        {
          id: 'tb1',
          userId: 'user1',
          domainId: 'domain1',
          title: 'Work',
          type: 'work' as const,
          startTime: threeDaysAgo,
          endTime: threeDaysAgo,
          status: 'completed',
          deleted: false,
          createdAt: threeDaysAgo,
          updatedAt: threeDaysAgo
        },
        {
          id: 'tb2',
          userId: 'user1',
          domainId: 'domain1',
          title: 'Work',
          type: 'work' as const,
          startTime: today,
          endTime: today,
          status: 'completed',
          deleted: false,
          createdAt: today,
          updatedAt: today
        }
      ];

      const result = calculateStreak(timeBlocks, [], []);

      // Current streak should be 1 (only today)
      // Best streak should be 1 (longest was either day1 or day2, both 1)
      expect(result.currentStreak).toBe(1);
      expect(result.totalActiveDays).toBe(2);
      expect(result.streakHistory.length).toBe(2); // Two separate streaks
    });

    it('should combine multiple activity sources for same day', () => {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];

      const timeBlocks: TimeBlock[] = [
        {
          id: 'tb1',
          userId: 'user1',
          domainId: 'domain1',
          title: 'Work',
          type: 'work' as const,
          startTime: today,
          endTime: today,
          status: 'completed',
          deleted: false,
          createdAt: today,
          updatedAt: today
        }
      ];

      const habitLogs: HabitLog[] = [
        {
          id: 'hl1',
          habitId: 'habit1',
          userId: 'user1',
          date: today,
          completed: true,
          createdAt: today
        }
      ];

      const result = calculateStreak(timeBlocks, habitLogs, []);

      expect(result.currentStreak).toBe(1);
      expect(result.totalActiveDays).toBe(1);
      // Should count as one day with multiple activities
    });
  });

  describe('getStreakMessage', () => {
    it('should return appropriate message for zero streak', () => {
      const message = getStreakMessage({
        currentStreak: 0,
        bestStreak: 0,
        lastActivityDate: null,
        totalActiveDays: 0,
        streakHistory: []
      });

      expect(message).toContain('start');
    });

    it('should return appropriate message for long streak', () => {
      const message = getStreakMessage({
        currentStreak: 30,
        bestStreak: 30,
        lastActivityDate: new Date().toISOString().split('T')[0],
        totalActiveDays: 30,
        streakHistory: []
      });

      expect(message).toContain('30');
      expect(message).toContain('Legendary');
    });

    it('should encourage for broken streak with past best', () => {
      const message = getStreakMessage({
        currentStreak: 0,
        bestStreak: 10,
        lastActivityDate: '2025-01-01',
        totalActiveDays: 10,
        streakHistory: []
      });

      expect(message).toContain('10');
      expect(message).toContain('new one');
    });
  });
});
