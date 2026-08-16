import type { EntityCollection, EntityRecord } from './types';

const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const PUBLIC_FIELDS: Readonly<Record<EntityCollection, readonly string[]>> = {
  goals: ['id', 'title', 'description', 'status', 'priority', 'targetDate', 'targetHours', 'timeAllocationTarget', 'category', 'complexity', 'estimatedHours', 'domainId', 'createdAt', 'updatedAt'],
  keyResults: ['id', 'title', 'description', 'status', 'targetValue', 'currentValue', 'unit', 'progress', 'goalId', 'domainId', 'createdAt', 'updatedAt'],
  projects: ['id', 'name', 'description', 'status', 'priority', 'goalId', 'domainId', 'dueDate', 'weeklyHoursTarget', 'totalHoursTarget', 'createdAt', 'updatedAt'],
  tasks: ['id', 'title', 'description', 'status', 'priority', 'estimatedMinutes', 'dueDate', 'projectId', 'goalId', 'domainId', 'createdAt', 'updatedAt'],
  timeBlocks: ['id', 'title', 'startTime', 'endTime', 'actualStartTime', 'actualEndTime', 'status', 'type', 'taskId', 'projectId', 'goalId', 'domainId', 'notes', 'protected', 'locked', 'isLocked', 'fixed', 'flexibility', 'createdAt', 'updatedAt'],
  habits: ['id', 'name', 'description', 'frequency', 'targetValue', 'unit', 'isActive', 'streakCount', 'bestStreak', 'domainId', 'createdAt', 'updatedAt'],
  habitLogs: ['id', 'habitId', 'date', 'dateKey', 'completed', 'value', 'notes', 'createdAt', 'updatedAt'],
  sessions: ['id', 'status', 'startTime', 'endTime', 'duration', 'tags', 'notes', 'mood', 'energy', 'focus', 'timeBlockId', 'taskId', 'projectId', 'goalIds', 'domainId', 'createdAt', 'updatedAt'],
  notes: ['id', 'entityType', 'entityId', 'title', 'docJson', 'tags', 'isPinned', 'domainId', 'createdAt', 'updatedAt'],
  goalRoadmaps: ['id', 'goalId', 'title', 'description', 'milestones', 'avatarStyle', 'pathStyle', 'totalDistance', 'domainId', 'createdAt', 'updatedAt'],
  domains: ['id', 'name', 'color', 'icon', 'createdAt', 'updatedAt'],
};

export function sanitizeEntity(
  collection: EntityCollection,
  entity: EntityRecord,
): Readonly<Record<string, unknown>> {
  const output: Record<string, unknown> = {};
  const budget = { remaining: 20_000 };
  for (const field of PUBLIC_FIELDS[collection]) {
    const value = entity[field];
    if (value !== undefined) output[field] = boundedValue(value, budget, 0);
  }
  return output;
}

function boundedValue(
  value: unknown,
  budget: { remaining: number },
  depth: number,
): unknown {
  if (budget.remaining <= 0) return '[truncated]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const safe = value
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .slice(0, Math.min(8_000, budget.remaining));
    budget.remaining -= safe.length;
    return safe;
  }
  if (depth >= 6) return '[truncated-depth]';
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => boundedValue(item, budget, depth + 1));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      const safeKey = key.slice(0, 100);
      if (!safeKey || DANGEROUS_OBJECT_KEYS.has(safeKey)) continue;
      result[safeKey] = boundedValue(item, budget, depth + 1);
      if (budget.remaining <= 0) break;
    }
    return result;
  }
  return String(value).slice(0, Math.min(200, budget.remaining));
}
