import type { EntityCollection, EntityRecord } from './types';

export function entityAfterCreate(
  uid: string,
  collection: EntityCollection,
  id: string,
  values: Readonly<Record<string, unknown>>,
  now: string,
): EntityRecord {
  return normalizeTaskCompletion(collection, {
    ...structuredClone(values),
    id,
    userId: uid,
    _version: 1,
    createdAt: now,
    updatedAt: now,
  } as EntityRecord, null, now);
}

export function entityAfterUpdate(
  uid: string,
  collection: EntityCollection,
  current: EntityRecord,
  values: Readonly<Record<string, unknown>>,
  now: string,
): EntityRecord {
  return normalizeTaskCompletion(collection, {
    ...structuredClone(current),
    ...structuredClone(values),
    id: current.id,
    userId: uid,
    _version: current._version + 1,
    createdAt: current.createdAt,
    updatedAt: now,
  } as EntityRecord, current, now);
}

function normalizeTaskCompletion(
  collection: EntityCollection,
  record: EntityRecord,
  current: EntityRecord | null,
  now: string,
): EntityRecord {
  if (collection !== 'tasks') return record;
  const output = { ...record } as Record<string, unknown>;
  if (record.status === 'completed') {
    if (typeof record.completedAt !== 'string') output.completedAt = now;
  } else if (current?.completedAt !== undefined && current.completedAt !== null) {
    output.completedAt = null;
  }
  return output as EntityRecord;
}
