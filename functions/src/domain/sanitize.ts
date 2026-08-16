import type { EntityCollection, EntityRecord } from './types';

const PUBLIC_FIELDS: Readonly<Record<EntityCollection, readonly string[]>> = {
  goals: ['id', 'title', 'description', 'status', 'priority', 'targetDate', 'targetHours', 'timeAllocationTarget', 'category', 'complexity', 'estimatedHours', 'domainId', 'createdAt', 'updatedAt'],
  keyResults: ['id', 'title', 'description', 'status', 'targetValue', 'currentValue', 'unit', 'progress', 'goalId', 'domainId', 'createdAt', 'updatedAt'],
  projects: ['id', 'name', 'description', 'status', 'priority', 'goalId', 'domainId', 'dueDate', 'weeklyHoursTarget', 'totalHoursTarget', 'createdAt', 'updatedAt'],
  tasks: ['id', 'title', 'description', 'status', 'priority', 'estimatedMinutes', 'dueDate', 'projectId', 'goalId', 'domainId', 'createdAt', 'updatedAt'],
  timeBlocks: ['id', 'title', 'startTime', 'endTime', 'status', 'type', 'taskId', 'projectId', 'goalId', 'domainId', 'notes', 'protected', 'createdAt', 'updatedAt'],
  habits: ['id', 'name', 'description', 'frequency', 'targetValue', 'unit', 'isActive', 'streakCount', 'bestStreak', 'domainId', 'createdAt', 'updatedAt'],
  sessions: ['id', 'status', 'startTime', 'endTime', 'duration', 'tags', 'notes', 'mood', 'energy', 'focus', 'timeBlockId', 'taskId', 'projectId', 'goalIds', 'domainId', 'createdAt', 'updatedAt'],
  notes: ['id', 'entityType', 'entityId', 'title', 'tags', 'isPinned', 'domainId', 'createdAt', 'updatedAt'],
  domains: ['id', 'name', 'color', 'icon', 'createdAt', 'updatedAt'],
};

export function sanitizeEntity(
  collection: EntityCollection,
  entity: EntityRecord,
): Readonly<Record<string, unknown>> {
  const output: Record<string, unknown> = {};
  for (const field of PUBLIC_FIELDS[collection]) {
    const value = entity[field];
    if (value !== undefined) output[field] = value;
  }
  return output;
}
