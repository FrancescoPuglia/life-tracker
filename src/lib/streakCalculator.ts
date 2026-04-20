/**
 * Streak Calculator - Momentum Tracking Engine
 * Tracks consecutive days of user activity across all data sources
 */

import { TimeBlock, HabitLog, Task } from '@/types';

export interface StreakData {
  currentStreak: number;
  bestStreak: number;
  lastActivityDate: string | null;
  totalActiveDays: number;
  streakHistory: Array<{
    startDate: string;
    endDate: string;
    length: number;
  }>;
}

interface StreakDay {
  date: string; // YYYY-MM-DD
  hasActivity: boolean;
  activityCount: number;
  sources: string[]; // e.g., ['timeblock', 'habit', 'task']
}

/**
 * Check if a date string (YYYY-MM-DD) represents today in local timezone
 */
function isToday(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkDate = new Date(dateStr + 'T00:00:00');
  return checkDate.getTime() === today.getTime();
}

/**
 * Check if date2 is exactly 1 day after date1 (handles timezone correctly)
 */
function isConsecutiveDay(date1Str: string, date2Str: string): boolean {
  const d1 = new Date(date1Str + 'T00:00:00');
  const d2 = new Date(date2Str + 'T00:00:00');
  const diffMs = d2.getTime() - d1.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays === 1;
}

/**
 * Calculate streak data from multiple activity sources
 *
 * Definition of "active day":
 * - At least 1 completed time block, OR
 * - At least 1 habit logged, OR
 * - At least 1 task completed
 *
 * Streak rules:
 * - Must be consecutive days (no gaps)
 * - Timezone-aware (uses local midnight as day boundary)
 * - Current streak breaks if yesterday had no activity
 */
export function calculateStreak(
  timeBlocks: TimeBlock[],
  habitLogs: HabitLog[],
  completedTasks: Task[]
): StreakData {
  const activityByDate = new Map<string, StreakDay>();

  // Helper to ensure date entry exists
  const ensureDate = (dateStr: string) => {
    if (!activityByDate.has(dateStr)) {
      activityByDate.set(dateStr, {
        date: dateStr,
        hasActivity: false,
        activityCount: 0,
        sources: []
      });
    }
  };

  // Process completed time blocks
  timeBlocks
    .filter(block => block.status === 'completed' && !block.deleted)
    .forEach(block => {
      const dateStr = new Date(block.startTime).toISOString().split('T')[0];
      ensureDate(dateStr);
      const day = activityByDate.get(dateStr)!;
      day.hasActivity = true;
      day.activityCount++;
      if (!day.sources.includes('timeblock')) {
        day.sources.push('timeblock');
      }
    });

  // Process habit logs
  habitLogs
    .filter(log => log.completed)
    .forEach(log => {
      // habitLog.date is a Date object - convert to YYYY-MM-DD
      const dateStr = new Date(log.date).toISOString().split('T')[0];
      ensureDate(dateStr);
      const day = activityByDate.get(dateStr)!;
      day.hasActivity = true;
      day.activityCount++;
      if (!day.sources.includes('habit')) {
        day.sources.push('habit');
      }
    });

  // Process completed tasks (use completedAt date)
  completedTasks
    .filter(task => task.completedAt && !task.deleted)
    .forEach(task => {
      const dateStr = new Date(task.completedAt!).toISOString().split('T')[0];
      ensureDate(dateStr);
      const day = activityByDate.get(dateStr)!;
      day.hasActivity = true;
      day.activityCount++;
      if (!day.sources.includes('task')) {
        day.sources.push('task');
      }
    });

  // Sort all dates
  const sortedDates = Array.from(activityByDate.keys()).sort();
  const activeDates = sortedDates.filter(date => activityByDate.get(date)!.hasActivity);

  if (activeDates.length === 0) {
    return {
      currentStreak: 0,
      bestStreak: 0,
      lastActivityDate: null,
      totalActiveDays: 0,
      streakHistory: []
    };
  }

  // Calculate all streaks
  const streaks: Array<{ startDate: string; endDate: string; length: number }> = [];
  let streakStart = activeDates[0];
  let streakLength = 1;

  for (let i = 1; i < activeDates.length; i++) {
    const prevDate = activeDates[i - 1];
    const currDate = activeDates[i];

    if (isConsecutiveDay(prevDate, currDate)) {
      streakLength++;
    } else {
      // Streak broken
      streaks.push({
        startDate: streakStart,
        endDate: prevDate,
        length: streakLength
      });
      streakStart = currDate;
      streakLength = 1;
    }
  }

  // Add final streak
  streaks.push({
    startDate: streakStart,
    endDate: activeDates[activeDates.length - 1],
    length: streakLength
  });

  // Find best streak
  const bestStreak = Math.max(...streaks.map(s => s.length), 0);

  // Calculate current streak
  const lastActivityDate = activeDates[activeDates.length - 1];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  const todayStr = new Date().toISOString().split('T')[0];

  let currentStreak = 0;

  // Current streak is valid if:
  // 1. Last activity was today, OR
  // 2. Last activity was yesterday
  if (isToday(lastActivityDate)) {
    // Activity today - streak is ongoing
    currentStreak = streaks[streaks.length - 1].length;
  } else if (lastActivityDate === yesterdayStr) {
    // Activity yesterday - streak is still alive (user has until end of today)
    currentStreak = streaks[streaks.length - 1].length;
  } else {
    // Last activity was 2+ days ago - streak is broken
    currentStreak = 0;
  }

  return {
    currentStreak,
    bestStreak,
    lastActivityDate,
    totalActiveDays: activeDates.length,
    streakHistory: streaks
  };
}

/**
 * Get a motivational message based on streak status
 */
export function getStreakMessage(streak: StreakData): string {
  if (streak.currentStreak === 0) {
    if (streak.bestStreak > 0) {
      return `Your best streak was ${streak.bestStreak} days. Start a new one today!`;
    }
    return 'Complete an action today to start your streak!';
  }

  if (streak.currentStreak === 1) {
    return "Great start! Keep the momentum going tomorrow.";
  }

  if (streak.currentStreak >= 30) {
    return `🔥 Legendary! ${streak.currentStreak} days of pure consistency!`;
  }

  if (streak.currentStreak >= 14) {
    return `💪 Incredible! ${streak.currentStreak} days strong!`;
  }

  if (streak.currentStreak >= 7) {
    return `⚡ Amazing! ${streak.currentStreak} days in a row!`;
  }

  return `🎯 ${streak.currentStreak} day streak - keep it up!`;
}
