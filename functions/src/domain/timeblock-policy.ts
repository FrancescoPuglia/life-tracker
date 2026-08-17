import type { EntityRecord } from './types';

/**
 * TimeBlocks whose position/history is authoritative and must never be
 * changed by an AI proposal. Keep every scheduling/read/write boundary on
 * this single predicate so executed history cannot be reclassified as free.
 */
export function isProtectedTimeBlock(record: EntityRecord): boolean {
  return record.protected === true
    || record.locked === true
    || record.isLocked === true
    || record.fixed === true
    || record.flexibility === 'fixed'
    || record.status === 'completed'
    || record.status === 'in_progress'
    || record.status === 'overrun';
}
