import { createHash } from 'node:crypto';
import { DomainError } from './errors';
import type {
  ChangeSnapshot,
  EntityRecord,
  ImmutableChangePlan,
  StoredChangePlan,
  UserPlanningPreferences,
  ValidationScopeQuery,
} from './types';

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
    appliedDependencyStateHashes: _dependencyStateHashes,
    appliedScopeHashes: _scopeHashes,
    ...immutable
  } = plan;
  if (hashPlan(immutable) !== hash) {
    throw new DomainError('CONFLICT', 'Change plan integrity check failed.');
  }
}

export function hashEntityState(record: EntityRecord): string {
  return createHash('sha256').update(canonicalJson(record)).digest('hex');
}

export function hashSnapshotState(
  snapshot: Pick<ChangeSnapshot, 'entries' | 'scopes' | 'planningPreferencesHash'>,
): string {
  return createHash('sha256').update(canonicalJson({
    entries: [...snapshot.entries]
      .map(({ collection, id, existed, version, contentHash }) => ({
        collection,
        id,
        existed,
        version,
        contentHash,
      }))
      .sort((a, b) => `${a.collection}/${a.id}`.localeCompare(`${b.collection}/${b.id}`)),
    scopes: [...snapshot.scopes]
      .map(({ collection, field, value, from, to, maxItems, stateHash, itemCount }) => ({
        collection, field, value, from, to, maxItems, stateHash, itemCount,
      }))
      .sort((a, b) => validationScopeKey(a).localeCompare(validationScopeKey(b))),
    planningPreferencesHash: snapshot.planningPreferencesHash,
  })).digest('hex');
}

/**
 * A rollback snapshot is immutable plan state, not an independently mutable
 * bag of entries. Verify the complete binding again at rollback time so a
 * server-side corruption that removes a dependency/scope cannot narrow the
 * safety checks while leaving per-entry hashes internally consistent.
 */
export function verifySnapshotPlanBinding(
  plan: Pick<ImmutableChangePlan, 'uid' | 'id' | 'snapshotId' | 'baseStateHash'>,
  snapshot: ChangeSnapshot,
): void {
  if (
    snapshot.uid !== plan.uid
    || snapshot.id !== plan.snapshotId
    || snapshot.planId !== plan.id
    || hashSnapshotState(snapshot) !== plan.baseStateHash
  ) {
    throw new DomainError('CONFLICT', 'Change snapshot binding check failed.');
  }
}

export function hashValidationScopeRecords(records: readonly EntityRecord[]): string {
  return createHash('sha256').update(canonicalJson(
    records
      .map((record) => ({ id: record.id, contentHash: hashEntityState(record) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  )).digest('hex');
}

export function hashPlanningPreferences(preferences: UserPlanningPreferences): string {
  return createHash('sha256').update(canonicalJson(preferences)).digest('hex');
}

export function validationScopeKey(scope: ValidationScopeQuery): string {
  return canonicalJson({
    collection: scope.collection,
    field: scope.field,
    value: scope.value,
    from: scope.from,
    to: scope.to,
    maxItems: scope.maxItems,
  });
}

export function hashResultState(
  stateHashes: Readonly<Record<string, string | null>>,
): string {
  return createHash('sha256').update(canonicalJson(stateHashes)).digest('hex');
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
