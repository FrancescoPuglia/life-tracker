import { createHash } from 'node:crypto';
import { DomainError } from './errors';
import type { EntityRecord, ImmutableChangePlan, StoredChangePlan } from './types';

export function hashPlan(plan: Omit<ImmutableChangePlan, 'hash'>): string {
  return createHash('sha256').update(canonicalJson(plan)).digest('hex');
}

export function verifyStoredPlan(plan: StoredChangePlan): void {
  const {
    hash,
    status: _status,
    appliedAt: _appliedAt,
    rolledBackAt: _rolledBackAt,
    appliedVersions: _versions,
    appliedStateHashes: _stateHashes,
    ...immutable
  } = plan;
  if (hashPlan(immutable) !== hash) {
    throw new DomainError('CONFLICT', 'Change plan integrity check failed.');
  }
}

export function hashEntityState(record: EntityRecord): string {
  return createHash('sha256').update(canonicalJson(record)).digest('hex');
}

export function hashIdempotencyKey(
  uid: string,
  planId: string,
  action: 'apply' | 'rollback',
  key: string,
): string {
  return createHash('sha256').update(`${uid}\0${planId}\0${action}\0${key}`).digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}
