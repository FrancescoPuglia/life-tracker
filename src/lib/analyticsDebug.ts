/**
 * Analytics Debug Instrumentation (DEV ONLY)
 * Provides visibility into analytics data pipeline failures
 */

import { TimeBlock, Session } from '@/types';

export interface AnalyticsDebugInfo {
  totalTimeBlocks: number;
  userTimeBlocks: number;
  completedTimeBlocks: number;
  dateRangeStart: string;
  dateRangeEnd: string;
  sampleTimeBlocks: Array<{
    id: string;
    userId: string;
    startTime: string;
    endTime: string;
    status: string;
    title?: string;
  }>;
  userIds: string[];
  distinctDates: string[];
}

export function debugAnalytics(
  allTimeBlocks: TimeBlock[],
  userId: string,
  days: number
): AnalyticsDebugInfo {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const userTimeBlocks = allTimeBlocks.filter(block => block.userId === userId);
  const completedBlocks = userTimeBlocks.filter(block => block.status === 'completed');

  const sampleTimeBlocks = allTimeBlocks.slice(0, 5).map(block => ({
    id: block.id,
    userId: block.userId,
    startTime: new Date(block.startTime).toISOString(),
    endTime: new Date(block.endTime).toISOString(),
    status: block.status,
    title: block.title
  }));

  const userIds = Array.from(new Set(allTimeBlocks.map(block => block.userId)));
  const distinctDates = Array.from(
    new Set(
      allTimeBlocks.map(block =>
        new Date(block.startTime).toISOString().split('T')[0]
      )
    )
  ).sort();

  return {
    totalTimeBlocks: allTimeBlocks.length,
    userTimeBlocks: userTimeBlocks.length,
    completedTimeBlocks: completedBlocks.length,
    dateRangeStart: startDate.toISOString().split('T')[0],
    dateRangeEnd: endDate.toISOString().split('T')[0],
    sampleTimeBlocks,
    userIds,
    distinctDates
  };
}

export function logAnalyticsDebug(debug: AnalyticsDebugInfo, label: string = 'Analytics') {
  if (process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEBUG_ANALYTICS === '1') {
    console.group(`📊 ${label} Debug`);
    console.log('Total TimeBlocks:', debug.totalTimeBlocks);
    console.log('User TimeBlocks:', debug.userTimeBlocks);
    console.log('Completed TimeBlocks:', debug.completedTimeBlocks);
    console.log('Date Range:', debug.dateRangeStart, '→', debug.dateRangeEnd);
    console.log('User IDs in DB:', debug.userIds);
    console.log('Distinct Dates:', debug.distinctDates);
    console.log('Sample TimeBlocks:', debug.sampleTimeBlocks);
    console.groupEnd();
  }
}
