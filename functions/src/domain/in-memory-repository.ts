import { randomUUID } from 'node:crypto';
import { capabilityHashMatches } from './capabilities';
import { DomainError } from './errors';
import {
  hashEntityState,
  hashPlanningPreferences,
  hashResultState,
  hashValidationScopeRecords,
  validationScopeKey,
  verifyStoredPlan,
} from './integrity';
import type {
  ApplyPlanRequest,
  AuditableRepository,
  RollbackExecutionRequest,
  SavePreviewRequest,
} from './repository';
import type {
  ApprovalRecord,
  AuditEvent,
  ChangeSnapshot,
  EntityCollection,
  EntityRecord,
  EntityReference,
  PreviewValidationRequirements,
  PlanActionResult,
  ReadPage,
  ReadPageRequest,
  StoredChangePlan,
  StoredExecution,
  UserPlanningPreferences,
  ValidationScopeQuery,
} from './types';
import { ENTITY_COLLECTIONS } from './types';

type CollectionStore = Map<string, EntityRecord>;
type UserStore = Map<EntityCollection, CollectionStore>;

interface IdempotencyEntry {
  readonly action: 'apply' | 'rollback';
  readonly planId: string;
  readonly capabilityHash: string;
  readonly result: PlanActionResult;
}

const DEFAULT_PLANNING_PREFERENCES: UserPlanningPreferences = Object.freeze({
  source: 'product_default',
  defaultsApplied: Object.freeze([
    'timezone',
    'workingHours',
    'maxDailyPlannedMinutes',
    'maxWeeklyPlannedMinutes',
    'minBufferMinutes',
    'maxConsecutiveHighEnergyBlocks',
  ]),
  timezone: 'Europe/Rome',
  workingHours: Object.freeze({ start: '07:00', end: '22:00' }),
  maxDailyPlannedMinutes: 600,
  maxWeeklyPlannedMinutes: 3_000,
  minBufferMinutes: 15,
  maxConsecutiveHighEnergyBlocks: 2,
});

/** Deterministic adapter for unit/integration tests; it never contacts Firestore. */
export class InMemoryRepository implements AuditableRepository {
  private readonly users = new Map<string, UserStore>();
  private readonly plans = new Map<string, StoredChangePlan>();
  private readonly snapshots = new Map<string, ChangeSnapshot>();
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly executions = new Map<string, StoredExecution>();
  private readonly audits: AuditEvent[] = [];
  private readonly idempotency = new Map<string, IdempotencyEntry>();
  private readonly planningPreferences = new Map<string, UserPlanningPreferences>();
  private transactionTail: Promise<void> = Promise.resolve();

  seed(uid: string, collection: EntityCollection, records: readonly Readonly<Record<string, unknown>>[]): void {
    const store = this.collection(uid, collection);
    for (const source of records) {
      const id = String(source.id);
      const now = new Date(0).toISOString();
      store.set(id, {
        ...structuredClone(source),
        id,
        _version: typeof source._version === 'number' ? source._version : 1,
        createdAt: typeof source.createdAt === 'string' ? source.createdAt : now,
        updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : now,
      } as EntityRecord);
    }
  }

  async listEntities(
    uid: string,
    collection: EntityCollection,
    request: ReadPageRequest,
  ): Promise<ReadPage<EntityRecord>> {
    if (request.limit < 1 || request.limit > 200) {
      throw new DomainError('LIMIT_EXCEEDED', 'Repository page limit must be between 1 and 200.');
    }
    const fingerprint = queryFingerprint(collection, request);
    const offset = request.cursor ? decodeCursor(request.cursor, fingerprint) : 0;
    const values = [...this.collection(uid, collection).values()]
      .filter((record) => !isSoftDeleted(record) && matchesFilter(record, request))
      .sort((a, b) => compareRecords(a, b));
    const items = values.slice(offset, offset + request.limit).map(clone);
    const nextOffset = offset + items.length;
    return {
      items,
      nextCursor: nextOffset < values.length ? encodeCursor(fingerprint, nextOffset) : null,
    };
  }

  async getEntity(
    uid: string,
    collection: EntityCollection,
    id: string,
  ): Promise<EntityRecord | null> {
    const record = this.collection(uid, collection).get(id);
    return record && !isSoftDeleted(record) ? clone(record) : null;
  }

  async getUserPlanningPreferences(uid: string): Promise<UserPlanningPreferences> {
    return clone(this.planningPreferences.get(uid) ?? DEFAULT_PLANNING_PREFERENCES);
  }

  setPlanningPreferencesForTest(uid: string, preferences: UserPlanningPreferences): void {
    this.planningPreferences.set(uid, clone(preferences));
  }

  async captureSnapshot(
    uid: string,
    planId: string,
    refs: readonly EntityReference[],
    createdAt: string,
    validation: PreviewValidationRequirements = {
      refs: [],
      scopes: [],
      planningPreferencesHash: null,
    },
  ): Promise<ChangeSnapshot> {
    const entries = refs.map(({ collection, id }) => {
      const record = this.collection(uid, collection).get(id);
      return {
        collection,
        id,
        existed: Boolean(record),
        version: record?._version ?? null,
        contentHash: record ? hashEntityState(record) : null,
        value: record ? clone(record) : null,
      };
    });
    const scopes = validation.scopes.map((scope) => {
      const records = validationScopeRecords(this.user(uid), scope);
      const stateHash = hashValidationScopeRecords(records);
      if (stateHash !== scope.expectedStateHash) {
        throw new DomainError('STATE_CHANGED', 'Validation scope changed while creating the preview.');
      }
      return {
        collection: scope.collection,
        field: scope.field,
        value: scope.value,
        from: scope.from,
        to: scope.to,
        maxItems: scope.maxItems,
        stateHash,
        itemCount: records.length,
      };
    });
    const planningPreferencesHash = validation.planningPreferencesHash;
    if (
      planningPreferencesHash
      && hashPlanningPreferences(this.planningPreferences.get(uid) ?? DEFAULT_PLANNING_PREFERENCES) !== planningPreferencesHash
    ) {
      throw new DomainError('STATE_CHANGED', 'Planning preferences changed while creating the preview.');
    }
    return { id: planId, uid, planId, createdAt, entries, scopes, planningPreferencesHash };
  }

  async savePreview(request: SavePreviewRequest): Promise<StoredChangePlan> {
    return this.withTransaction(() => {
      const { plan, snapshot, approval, audit } = request;
      if (
        plan.uid !== snapshot.uid ||
        plan.uid !== approval.uid ||
        plan.uid !== audit.uid ||
        plan.id !== snapshot.planId ||
        plan.id !== approval.planId ||
        plan.hash !== approval.planHash ||
        plan.baseStateHash !== approval.baseStateHash
      ) {
        throw new DomainError('FORBIDDEN', 'Preview ownership mismatch.');
      }
      const key = planKey(plan.uid, plan.id);
      if (this.plans.has(key) || this.snapshots.has(key) || this.approvals.has(key)) {
        throw new DomainError('CONFLICT', 'Plan already exists.');
      }
      const stored: StoredChangePlan = { ...clone(plan), status: 'previewed' };
      this.plans.set(key, stored);
      this.snapshots.set(key, clone(snapshot));
      this.approvals.set(key, clone(approval));
      this.appendAudit(audit);
      return clone(stored);
    });
  }

  async getPlan(uid: string, planId: string): Promise<StoredChangePlan | null> {
    const plan = this.plans.get(planKey(uid, planId));
    return plan ? clone(plan) : null;
  }

  async applyPlanAtomically(request: ApplyPlanRequest): Promise<PlanActionResult> {
    return this.withTransaction(() => {
      const idempotencyPath = `${request.uid}:apply:${request.idempotencyKeyHash}`;
      const replay = this.idempotency.get(idempotencyPath);
      if (replay) {
        assertIdempotencyCapability(replay, request.approvalCapabilityHash);
        return { ...clone(replay.result), idempotentReplay: true };
      }

      const key = planKey(request.uid, request.planId);
      const plan = this.plans.get(key);
      const snapshot = this.snapshots.get(key);
      const approval = this.approvals.get(key);
      if (!plan || !snapshot || !approval) throw new DomainError('NOT_FOUND', 'Change plan not found.');
      verifyStoredPlan(plan);
      if (plan.uid !== request.uid || snapshot.uid !== request.uid || approval.uid !== request.uid) {
        throw new DomainError('FORBIDDEN', 'Plan ownership mismatch.');
      }
      if (approval.status === 'consumed') throw new DomainError('APPROVAL_REPLAYED', 'Approval was already consumed.');
      if (
        approval.planHash !== plan.hash ||
        approval.baseStateHash !== plan.baseStateHash ||
        !capabilityHashMatches(request.approvalCapabilityHash, approval.capabilityHash)
      ) {
        throw new DomainError('APPROVAL_REQUIRED', 'Approval does not match this exact plan.');
      }
      if (plan.status !== 'previewed') throw new DomainError('APPROVAL_REPLAYED', 'Plan was already actioned.');
      if (Date.parse(plan.expiresAt) <= Date.parse(request.now)) throw new DomainError('EXPIRED', 'Change plan expired.');
      if (Date.parse(approval.expiresAt) <= Date.parse(request.now)) throw new DomainError('EXPIRED', 'Approval expired.');
      if (plan.conflicts.length) throw new DomainError('CONFLICT', 'Plan has unresolved conflicts.');
      this.assertSnapshotStillCurrent(request.uid, snapshot);
      this.assertValidationGuardsStillCurrent(request.uid, snapshot);

      const staged = cloneUserStore(this.user(request.uid));
      const appliedVersions: Record<string, number | null> = {};
      const appliedStateHashes: Record<string, string | null> = {};
      const operationKeys = new Set(plan.operations.map((operation) => refKey(operation.collection, operation.id)));
      const appliedDependencyStateHashes = Object.fromEntries(
        snapshot.entries
          .filter((entry) => !operationKeys.has(refKey(entry.collection, entry.id)))
          .map((entry) => {
            const current = this.collection(request.uid, entry.collection).get(entry.id);
            return [refKey(entry.collection, entry.id), current ? hashEntityState(current) : null];
          }),
      );
      for (const operation of plan.operations) {
        const collection = staged.get(operation.collection);
        if (!collection) throw new DomainError('INTERNAL', 'Missing collection store.');
        const current = collection.get(operation.id);
        const reference = refKey(operation.collection, operation.id);
        if (operation.op === 'create') {
          if (current) throw new DomainError('CONFLICT', `Entity ${reference} now exists.`);
          const created = {
            id: operation.id,
            ...structuredClone(operation.values),
            userId: request.uid,
            _version: 1,
            createdAt: request.now,
            updatedAt: request.now,
          } as EntityRecord;
          collection.set(operation.id, created);
          appliedVersions[reference] = 1;
          appliedStateHashes[reference] = hashEntityState(created);
        } else if (operation.op === 'update') {
          if (!current) throw new DomainError('CONFLICT', `Entity ${reference} was removed.`);
          const version = current._version + 1;
          const updatedRecord = {
            ...current,
            ...structuredClone(operation.values),
            id: operation.id,
            _version: version,
            updatedAt: request.now,
          };
          collection.set(operation.id, updatedRecord);
          appliedVersions[reference] = version;
          appliedStateHashes[reference] = hashEntityState(updatedRecord);
        } else {
          if (!current) throw new DomainError('CONFLICT', `Entity ${reference} was removed.`);
          collection.delete(operation.id);
          appliedVersions[reference] = null;
          appliedStateHashes[reference] = null;
        }
      }

      const appliedScopeHashes = Object.fromEntries(snapshot.scopes.map((scope) => [
        validationScopeKey(scope),
        hashValidationScopeRecords(validationScopeRecords(staged, scope)),
      ]));
      this.users.set(request.uid, staged);
      const updated: StoredChangePlan = {
        ...plan,
        status: 'applied',
        appliedAt: request.now,
        appliedVersions,
        appliedStateHashes,
        appliedDependencyStateHashes,
        appliedScopeHashes,
      };
      this.plans.set(key, updated);
      this.approvals.set(key, {
        ...approval,
        status: 'consumed',
        consumedAt: request.now,
        executionId: request.executionId,
      });
      const affected = plan.operations.map(({ collection, id }) => ({ collection, id }));
      const result: PlanActionResult = {
        executionId: request.executionId,
        planId: plan.id,
        hash: plan.hash,
        status: 'applied',
        idempotentReplay: false,
        verified: true,
        affected,
        receipt: {
          executionId: request.executionId,
          planId: plan.id,
          changesetHash: plan.hash,
          status: 'applied',
          verified: true,
          timestamp: request.now,
          affected,
          rollbackAvailable: true,
          rollbackExpiresAt: request.rollbackExpiresAt,
        },
      };
      this.executions.set(executionKey(request.uid, request.executionId), {
        id: request.executionId,
        uid: request.uid,
        planId: plan.id,
        requestId: request.requestId,
        applyAuditId: request.executionId,
        auditId: request.executionId,
        idempotencyKeyHash: request.idempotencyKeyHash,
        createdAt: request.now,
        status: 'applied',
        verified: true,
        rollbackCapabilityHash: request.rollbackCapabilityHash,
        rollbackExpiresAt: request.rollbackExpiresAt,
        result: withoutReplay(result),
      });
      this.idempotency.set(idempotencyPath, {
        action: 'apply',
        planId: plan.id,
        capabilityHash: request.approvalCapabilityHash,
        result,
      });
      this.appendAudit(actionAudit(
        request.executionId,
        updated,
        request,
        'apply',
        appliedStateHashes,
      ));
      return clone(result);
    });
  }

  async rollbackExecutionAtomically(request: RollbackExecutionRequest): Promise<PlanActionResult> {
    return this.withTransaction(() => {
      const idempotencyPath = `${request.uid}:rollback:${request.idempotencyKeyHash}`;
      const replay = this.idempotency.get(idempotencyPath);
      if (replay) {
        assertIdempotencyCapability(replay, request.rollbackCapabilityHash);
        return { ...clone(replay.result), idempotentReplay: true };
      }

      const executionKeyValue = executionKey(request.uid, request.executionId);
      const execution = this.executions.get(executionKeyValue);
      if (!execution) throw new DomainError('NOT_FOUND', 'Execution not found.');
      if (execution.uid !== request.uid) throw new DomainError('FORBIDDEN', 'Execution ownership mismatch.');
      if (execution.rollbackConsumedAt) {
        throw new DomainError('APPROVAL_REPLAYED', 'Rollback capability was already consumed.');
      }
      if (Date.parse(execution.rollbackExpiresAt) <= Date.parse(request.now)) {
        throw new DomainError('EXPIRED', 'Rollback capability expired.');
      }
      if (!capabilityHashMatches(request.rollbackCapabilityHash, execution.rollbackCapabilityHash)) {
        throw new DomainError('APPROVAL_REQUIRED', 'Rollback capability is invalid.');
      }

      const key = planKey(request.uid, execution.planId);
      const plan = this.plans.get(key);
      const snapshot = this.snapshots.get(key);
      if (!plan || !snapshot) throw new DomainError('NOT_FOUND', 'Change plan not found.');
      verifyStoredPlan(plan);
      if (plan.uid !== request.uid || snapshot.uid !== request.uid) {
        throw new DomainError('FORBIDDEN', 'Plan ownership mismatch.');
      }
      if (plan.status === 'rolled_back') throw new DomainError('CONFLICT', 'Plan was already rolled back with another key.');
      if (plan.status !== 'applied' || !plan.appliedVersions || !plan.appliedStateHashes) {
        throw new DomainError('CONFLICT', 'Only an applied plan can be rolled back.');
      }
      this.assertAppliedVersionsStillCurrent(request.uid, plan);
      this.assertRollbackGuardsStillCurrent(request.uid, plan, snapshot);

      const staged = cloneUserStore(this.user(request.uid));
      const restoredStateHashes: Record<string, string | null> = {};
      const entriesByKey = new Map(snapshot.entries.map((entry) => [refKey(entry.collection, entry.id), entry]));
      for (const operation of plan.operations) {
        const entry = entriesByKey.get(refKey(operation.collection, operation.id));
        if (!entry) throw new DomainError('INTERNAL', 'Rollback snapshot mismatch.');
        const collection = staged.get(entry.collection);
        if (!collection) throw new DomainError('INTERNAL', 'Missing collection store.');
        const current = collection.get(entry.id);
        if (!entry.existed) {
          collection.delete(entry.id);
          restoredStateHashes[refKey(entry.collection, entry.id)] = null;
        } else if (entry.value) {
          const nextVersion = (current?._version ?? entry.version ?? 0) + 1;
          const restored = {
            ...clone(entry.value),
            _version: nextVersion,
            updatedAt: request.now,
          };
          collection.set(entry.id, restored);
          restoredStateHashes[refKey(entry.collection, entry.id)] = hashEntityState(restored);
        }
      }

      this.users.set(request.uid, staged);
      const updated: StoredChangePlan = {
        ...plan,
        status: 'rolled_back',
        rolledBackAt: request.now,
      };
      this.plans.set(key, updated);
      const affected = plan.operations.map(({ collection, id }) => ({ collection, id }));
      const result: PlanActionResult = {
        executionId: execution.id,
        planId: plan.id,
        hash: plan.hash,
        status: 'rolled_back',
        idempotentReplay: false,
        verified: true,
        affected,
        receipt: {
          executionId: execution.id,
          planId: plan.id,
          changesetHash: plan.hash,
          status: 'rolled_back',
          verified: true,
          timestamp: request.now,
          affected,
          rollbackAvailable: false,
          rollbackExpiresAt: null,
        },
      };
      const rollbackAuditId = randomUUID();
      this.executions.set(executionKeyValue, {
        ...execution,
        applyAuditId: execution.applyAuditId ?? execution.auditId,
        auditId: rollbackAuditId,
        rollbackAuditId,
        status: 'rolled_back',
        verified: true,
        rollbackConsumedAt: request.now,
        restoredStateHashes,
        result: withoutReplay(result),
      });
      this.idempotency.set(idempotencyPath, {
        action: 'rollback',
        planId: plan.id,
        capabilityHash: request.rollbackCapabilityHash,
        result,
      });
      const applyPath = `${request.uid}:apply:${execution.idempotencyKeyHash}`;
      const applyEntry = this.idempotency.get(applyPath);
      if (applyEntry) {
        this.idempotency.set(applyPath, { ...applyEntry, result });
      }
      this.appendAudit(actionAudit(
        rollbackAuditId,
        updated,
        request,
        'rollback',
        restoredStateHashes,
      ));
      return clone(result);
    });
  }

  async getExecution(uid: string, executionId: string): Promise<StoredExecution | null> {
    const execution = this.executions.get(executionKey(uid, executionId));
    return execution ? clone(execution) : null;
  }

  async listAuditEventsForUser(uid: string): Promise<readonly AuditEvent[]> {
    return this.audits.filter((event) => event.uid === uid).map(clone);
  }

  async recordAudit(event: AuditEvent): Promise<void> {
    return this.withTransaction(() => {
      this.appendAudit(event);
    });
  }

  /** Test-only helper that simulates a legitimate concurrent application write. */
  mutateForTest(uid: string, collection: EntityCollection, id: string, patch: Readonly<Record<string, unknown>>): void {
    const store = this.collection(uid, collection);
    const current = store.get(id);
    if (!current) throw new Error('Test entity not found');
    store.set(id, {
      ...current,
      ...structuredClone(patch),
      _version: current._version + 1,
      updatedAt: new Date(Date.parse(current.updatedAt) + 1_000).toISOString(),
    });
  }

  /** Simulates a legacy/client write that incorrectly preserves `_version`. */
  mutateWithoutVersionForTest(
    uid: string,
    collection: EntityCollection,
    id: string,
    patch: Readonly<Record<string, unknown>>,
  ): void {
    const store = this.collection(uid, collection);
    const current = store.get(id);
    if (!current) throw new Error('Test entity not found');
    store.set(id, { ...current, ...structuredClone(patch), _version: current._version });
  }

  private assertSnapshotStillCurrent(uid: string, snapshot: ChangeSnapshot): void {
    for (const entry of snapshot.entries) {
      const current = this.collection(uid, entry.collection).get(entry.id);
      if (
        entry.existed !== Boolean(current) ||
        (current?._version ?? null) !== entry.version ||
        (current ? hashEntityState(current) : null) !== entry.contentHash
      ) {
        throw new DomainError('STATE_CHANGED', 'The preview is stale because referenced state changed.');
      }
    }
  }

  private assertValidationGuardsStillCurrent(uid: string, snapshot: ChangeSnapshot): void {
    for (const scope of snapshot.scopes) {
      const records = validationScopeRecords(this.user(uid), scope);
      if (
        records.length !== scope.itemCount
        || hashValidationScopeRecords(records) !== scope.stateHash
      ) {
        throw new DomainError('STATE_CHANGED', 'The preview is stale because its validation scope changed.');
      }
    }
    if (
      snapshot.planningPreferencesHash
      && hashPlanningPreferences(this.planningPreferences.get(uid) ?? DEFAULT_PLANNING_PREFERENCES)
        !== snapshot.planningPreferencesHash
    ) {
      throw new DomainError('STATE_CHANGED', 'The preview is stale because planning preferences changed.');
    }
  }

  private assertRollbackGuardsStillCurrent(
    uid: string,
    plan: StoredChangePlan,
    snapshot: ChangeSnapshot,
  ): void {
    const operationKeys = new Set(plan.operations.map((operation) => refKey(operation.collection, operation.id)));
    for (const entry of snapshot.entries) {
      const key = refKey(entry.collection, entry.id);
      if (operationKeys.has(key)) continue;
      const current = this.collection(uid, entry.collection).get(entry.id);
      if ((current ? hashEntityState(current) : null) !== plan.appliedDependencyStateHashes?.[key]) {
        throw new DomainError('STATE_CHANGED', 'Rollback refused because referenced state changed after apply.');
      }
    }
    for (const scope of snapshot.scopes) {
      const currentHash = hashValidationScopeRecords(validationScopeRecords(this.user(uid), scope));
      if (currentHash !== plan.appliedScopeHashes?.[validationScopeKey(scope)]) {
        throw new DomainError('STATE_CHANGED', 'Rollback refused because dependent state changed after apply.');
      }
    }
    if (
      snapshot.planningPreferencesHash
      && hashPlanningPreferences(this.planningPreferences.get(uid) ?? DEFAULT_PLANNING_PREFERENCES)
        !== snapshot.planningPreferencesHash
    ) {
      throw new DomainError('STATE_CHANGED', 'Rollback refused because planning preferences changed after apply.');
    }
  }

  private assertAppliedVersionsStillCurrent(uid: string, plan: StoredChangePlan): void {
    for (const operation of plan.operations) {
      const key = refKey(operation.collection, operation.id);
      const expected = plan.appliedVersions?.[key];
      const expectedHash = plan.appliedStateHashes?.[key];
      const current = this.collection(uid, operation.collection).get(operation.id);
      if (
        (current?._version ?? null) !== expected ||
        (current ? hashEntityState(current) : null) !== expectedHash
      ) {
        throw new DomainError('STATE_CHANGED', 'Rollback refused because state changed after apply.');
      }
    }
  }

  private appendAudit(event: AuditEvent): void {
    if (this.audits.some((item) => item.id === event.id)) {
      throw new DomainError('CONFLICT', 'Audit event IDs are append-only.');
    }
    this.audits.push(clone(event));
  }

  private user(uid: string): UserStore {
    let store = this.users.get(uid);
    if (!store) {
      store = new Map(ENTITY_COLLECTIONS.map((collection) => [collection, new Map()]));
      this.users.set(uid, store);
    }
    return store;
  }

  private collection(uid: string, collection: EntityCollection): CollectionStore {
    const store = this.user(uid).get(collection);
    if (!store) throw new DomainError('INTERNAL', 'Unknown collection.');
    return store;
  }

  private async withTransaction<T>(work: () => T): Promise<T> {
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return work();
    } finally {
      release();
    }
  }
}

function matchesFilter(record: EntityRecord, request: ReadPageRequest): boolean {
  const { filter } = request;
  if (filter.status && record.status !== filter.status) return false;
  for (const field of ['domainId', 'projectId', 'goalId', 'taskId'] as const) {
    if (filter[field] && record[field] !== filter[field]) return false;
  }
  if (filter.query) {
    const haystack = [record.title, record.name, record.description, record.content]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLocaleLowerCase('en-US');
    if (!haystack.includes(filter.query.toLocaleLowerCase('en-US'))) return false;
  }
  const start = typeof record.startTime === 'string'
    ? Date.parse(record.startTime)
    : Date.parse(record.updatedAt);
  const end = typeof record.endTime === 'string' ? Date.parse(record.endTime) : start;
  if (filter.from && end <= Date.parse(filter.from)) return false;
  if (filter.to && start >= Date.parse(filter.to)) return false;
  return true;
}

function validationScopeRecords(
  user: UserStore,
  scope: ValidationScopeQuery,
): readonly EntityRecord[] {
  const collection = user.get(scope.collection);
  if (!collection) throw new DomainError('INTERNAL', 'Validation collection is unavailable.');
  const records = [...collection.values()]
    .filter((record) => !isSoftDeleted(record) && matchesValidationScope(record, scope))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (records.length > scope.maxItems) {
    throw new DomainError('LIMIT_EXCEEDED', 'Validation scope exceeds its safe bound.');
  }
  return records;
}

function matchesValidationScope(record: EntityRecord, scope: ValidationScopeQuery): boolean {
  if (scope.field && record[scope.field] !== scope.value) return false;
  if (scope.from || scope.to) {
    const start = typeof record.startTime === 'string' ? Date.parse(record.startTime) : Number.NaN;
    const end = typeof record.endTime === 'string' ? Date.parse(record.endTime) : Number.NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return false;
    if (scope.from && end <= Date.parse(scope.from)) return false;
    if (scope.to && start >= Date.parse(scope.to)) return false;
  }
  return true;
}

function assertIdempotencyCapability(entry: IdempotencyEntry, actualHash: string): void {
  if (!capabilityHashMatches(actualHash, entry.capabilityHash)) {
    throw new DomainError('APPROVAL_REQUIRED', 'Idempotent replay capability is invalid.');
  }
}

function isSoftDeleted(record: EntityRecord): boolean {
  return record.deleted === true;
}

function compareRecords(a: EntityRecord, b: EntityRecord): number {
  const aTime = typeof a.startTime === 'string' ? Date.parse(a.startTime) : Date.parse(a.updatedAt);
  const bTime = typeof b.startTime === 'string' ? Date.parse(b.startTime) : Date.parse(b.updatedAt);
  return aTime - bTime || a.id.localeCompare(b.id);
}

function queryFingerprint(collection: EntityCollection, request: ReadPageRequest): string {
  return Buffer.from(JSON.stringify([collection, request.filter])).toString('base64url');
}

function encodeCursor(fingerprint: string, offset: number): string {
  return Buffer.from(JSON.stringify({ fingerprint, offset })).toString('base64url');
}

function decodeCursor(cursor: string, fingerprint: string): number {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      (decoded as Record<string, unknown>).fingerprint !== fingerprint ||
      !Number.isInteger((decoded as Record<string, unknown>).offset) ||
      Number((decoded as Record<string, unknown>).offset) < 0
    ) {
      throw new Error('invalid');
    }
    return Number((decoded as Record<string, unknown>).offset);
  } catch {
    throw new DomainError('INVALID_ARGUMENT', 'Invalid or stale pagination cursor.');
  }
}

function cloneUserStore(source: UserStore): UserStore {
  return new Map(
    [...source.entries()].map(([collection, records]) => [
      collection,
      new Map([...records.entries()].map(([id, record]) => [id, clone(record)])),
    ]),
  );
}

function actionAudit(
  id: string,
  plan: StoredChangePlan,
  request: ApplyPlanRequest | RollbackExecutionRequest,
  action: 'apply' | 'rollback',
  resultStateHashes: Readonly<Record<string, string | null>>,
): AuditEvent {
  return {
    id,
    uid: request.uid,
    actorUid: request.uid,
    requestId: request.requestId,
    planId: plan.id,
    tool: plan.tool,
    action,
    outcome: 'success',
    timestamp: request.now,
    entityRefs: plan.operations.map(({ collection, id }) => ({ collection, id })),
    metadata: {
      operationCount: plan.operations.length,
      changesetHash: plan.hash,
      baseStateHash: plan.baseStateHash,
      resultStateHash: hashResultState(resultStateHashes),
      executionId: request.executionId,
      idempotencyKeyHash: request.idempotencyKeyHash,
      rollbackStatus: action === 'apply' ? 'available' : 'consumed',
      verified: true,
      ...(plan.orchestration
        ? {
            model: plan.orchestration.model,
            promptVersion: plan.orchestration.promptVersion,
            schemaVersion: plan.orchestration.schemaVersion,
          }
        : {}),
    },
  };
}

function withoutReplay(
  result: PlanActionResult,
): Omit<PlanActionResult, 'idempotentReplay' | 'rollback'> {
  const { idempotentReplay: _replay, rollback: _rollback, ...stored } = result;
  return clone(stored);
}

function refKey(collection: EntityCollection, id: string): string {
  return `${collection}/${id}`;
}

function planKey(uid: string, planId: string): string {
  return `${uid}/${planId}`;
}

function executionKey(uid: string, executionId: string): string {
  return `${uid}/${executionId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
