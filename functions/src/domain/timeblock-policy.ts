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
    || record.status === 'overrun'
    // Explicit actual timestamps are authoritative execution evidence even
    // when an older client has not yet advanced the planned status. AI
    // scheduling must never rewrite history underneath those measurements.
    || hasTimestamp(record.actualStartTime)
    || hasTimestamp(record.actualEndTime);
}

/**
 * Cancelled blocks remain authoritative history, but they are not current
 * calendar commitments. Preserve the record while excluding it from overlap
 * and capacity calculations.
 */
export function isActiveScheduleTimeBlock(record: EntityRecord): boolean {
  return record.status !== 'cancelled';
}

function hasTimestamp(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
