import type { EntityCollection, EntityRecord } from './types';
import { DomainError } from './errors';

export function entityAfterCreate(
  uid: string,
  collection: EntityCollection,
  id: string,
  values: Readonly<Record<string, unknown>>,
  now: string,
): EntityRecord {
  assertTaskCompletionIsExplicit(collection, values);
  return {
    ...structuredClone(values),
    id,
    userId: uid,
    _version: 1,
    createdAt: now,
    updatedAt: now,
  } as EntityRecord;
}

export function entityAfterUpdate(
  uid: string,
  collection: EntityCollection,
  current: EntityRecord,
  values: Readonly<Record<string, unknown>>,
  now: string,
): EntityRecord {
  assertTaskCompletionIsExplicit(collection, values);
  return {
    ...structuredClone(current),
    ...structuredClone(values),
    id: current.id,
    userId: uid,
    _version: current._version + 1,
    createdAt: current.createdAt,
    updatedAt: now,
  } as EntityRecord;
}

export function taskCompletionValuesForPreview(
  collection: EntityCollection,
  values: Readonly<Record<string, unknown>>,
  current: EntityRecord | null,
  previewedAt: string,
): Readonly<Record<string, unknown>> {
  if (collection !== 'tasks') return values;
  const status = values.status ?? current?.status;
  const completedAt = status === 'completed'
    ? (typeof current?.completedAt === 'string' ? current.completedAt : previewedAt)
    : null;
  return { ...values, completedAt };
}

function assertTaskCompletionIsExplicit(
  collection: EntityCollection,
  values: Readonly<Record<string, unknown>>,
): void {
  if (collection === 'tasks' && !Object.prototype.hasOwnProperty.call(values, 'completedAt')) {
    throw new DomainError('CONFLICT', 'Task plan predates required preview-bound completion metadata.');
  }
}
