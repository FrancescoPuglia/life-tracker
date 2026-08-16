import { randomUUID } from 'node:crypto';
import { DomainError } from './errors';
import { hashEntityState, verifyStoredPlan } from './integrity';
import type {
  AuditableRepository,
  PlanActionRequest,
  SavePreviewRequest,
} from './repository';
import type {
  AuditEvent,
  ChangeSnapshot,
  EntityCollection,
  EntityRecord,
  EntityReference,
  PlanActionResult,
  ReadPage,
  ReadPageRequest,
  StoredChangePlan,
} from './types';
import { ENTITY_COLLECTIONS } from './types';

type CollectionStore = Map<string, EntityRecord>;
type UserStore = Map<EntityCollection, CollectionStore>;

interface IdempotencyEntry {
  readonly action: 'apply' | 'rollback';
  readonly planId: string;
  readonly result: PlanActionResult;
}

/** Deterministic adapter for unit/integration tests; it never contacts Firestore. */
export class InMemoryRepository implements AuditableRepository {
  private readonly users = new Map<string, UserStore>();
  private readonly plans = new Map<string, StoredChangePlan>();
  private readonly snapshots = new Map<string, ChangeSnapshot>();
  private readonly audits: AuditEvent[] = [];
  private readonly idempotency = new Map<string, IdempotencyEntry>();
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
      .filter((record) => matchesFilter(record, request))
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
    return record ? clone(record) : null;
  }

  async captureSnapshot(
    uid: string,
    planId: string,
    refs: readonly EntityReference[],
    createdAt: string,
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
    return { id: planId, uid, planId, createdAt, entries };
  }

  async savePreview(request: SavePreviewRequest): Promise<StoredChangePlan> {
    return this.withTransaction(() => {
      const { plan, snapshot, audit } = request;
      if (plan.uid !== snapshot.uid || plan.uid !== audit.uid || plan.id !== snapshot.planId) {
        throw new DomainError('FORBIDDEN', 'Preview ownership mismatch.');
      }
      const key = planKey(plan.uid, plan.id);
      if (this.plans.has(key) || this.snapshots.has(key)) {
        throw new DomainError('CONFLICT', 'Plan already exists.');
      }
      const stored: StoredChangePlan = { ...clone(plan), status: 'previewed' };
      this.plans.set(key, stored);
      this.snapshots.set(key, clone(snapshot));
      this.appendAudit(audit);
      return clone(stored);
    });
  }

  async getPlan(uid: string, planId: string): Promise<StoredChangePlan | null> {
    const plan = this.plans.get(planKey(uid, planId));
    return plan ? clone(plan) : null;
  }

  async applyPlanAtomically(request: PlanActionRequest): Promise<PlanActionResult> {
    return this.withTransaction(() => {
      const idempotencyPath = `${request.uid}:apply:${request.idempotencyKeyHash}`;
      const replay = this.idempotency.get(idempotencyPath);
      if (replay) return { ...clone(replay.result), idempotentReplay: true };

      const key = planKey(request.uid, request.planId);
      const plan = this.plans.get(key);
      const snapshot = this.snapshots.get(key);
      if (!plan || !snapshot) throw new DomainError('NOT_FOUND', 'Change plan not found.');
      verifyStoredPlan(plan);
      if (plan.uid !== request.uid || snapshot.uid !== request.uid) {
        throw new DomainError('FORBIDDEN', 'Plan ownership mismatch.');
      }
      if (plan.status !== 'previewed') throw new DomainError('CONFLICT', 'Plan was already actioned.');
      if (Date.parse(plan.expiresAt) <= Date.parse(request.now)) throw new DomainError('EXPIRED', 'Change plan expired.');
      if (plan.conflicts.length) throw new DomainError('CONFLICT', 'Plan has unresolved conflicts.');
      this.assertSnapshotStillCurrent(request.uid, snapshot);

      const staged = cloneUserStore(this.user(request.uid));
      const appliedVersions: Record<string, number | null> = {};
      const appliedStateHashes: Record<string, string | null> = {};
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

      this.users.set(request.uid, staged);
      const updated: StoredChangePlan = {
        ...plan,
        status: 'applied',
        appliedAt: request.now,
        appliedVersions,
        appliedStateHashes,
      };
      this.plans.set(key, updated);
      const result: PlanActionResult = {
        planId: plan.id,
        hash: plan.hash,
        status: 'applied',
        idempotentReplay: false,
        affected: plan.operations.map(({ collection, id }) => ({ collection, id })),
      };
      this.idempotency.set(idempotencyPath, { action: 'apply', planId: plan.id, result });
      this.appendAudit(actionAudit(updated, request, 'apply'));
      return clone(result);
    });
  }

  async rollbackPlanAtomically(request: PlanActionRequest): Promise<PlanActionResult> {
    return this.withTransaction(() => {
      const idempotencyPath = `${request.uid}:rollback:${request.idempotencyKeyHash}`;
      const replay = this.idempotency.get(idempotencyPath);
      if (replay) return { ...clone(replay.result), idempotentReplay: true };

      const key = planKey(request.uid, request.planId);
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

      const staged = cloneUserStore(this.user(request.uid));
      for (const entry of snapshot.entries) {
        const collection = staged.get(entry.collection);
        if (!collection) throw new DomainError('INTERNAL', 'Missing collection store.');
        const current = collection.get(entry.id);
        if (!entry.existed) {
          collection.delete(entry.id);
        } else if (entry.value) {
          const nextVersion = (current?._version ?? entry.version ?? 0) + 1;
          collection.set(entry.id, {
            ...clone(entry.value),
            _version: nextVersion,
            updatedAt: request.now,
          });
        }
      }

      this.users.set(request.uid, staged);
      const updated: StoredChangePlan = {
        ...plan,
        status: 'rolled_back',
        rolledBackAt: request.now,
      };
      this.plans.set(key, updated);
      const result: PlanActionResult = {
        planId: plan.id,
        hash: plan.hash,
        status: 'rolled_back',
        idempotentReplay: false,
        affected: plan.operations.map(({ collection, id }) => ({ collection, id })),
      };
      this.idempotency.set(idempotencyPath, { action: 'rollback', planId: plan.id, result });
      this.appendAudit(actionAudit(updated, request, 'rollback'));
      return clone(result);
    });
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
        throw new DomainError('CONFLICT', `Entity ${refKey(entry.collection, entry.id)} changed after preview.`);
      }
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
        throw new DomainError('CONFLICT', `Entity ${key} changed after apply; rollback refused.`);
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
  const timestamp = typeof record.startTime === 'string'
    ? Date.parse(record.startTime)
    : Date.parse(record.updatedAt);
  if (filter.from && timestamp < Date.parse(filter.from)) return false;
  if (filter.to && timestamp >= Date.parse(filter.to)) return false;
  return true;
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
  plan: StoredChangePlan,
  request: PlanActionRequest,
  action: 'apply' | 'rollback',
): AuditEvent {
  return {
    id: randomUUID(),
    uid: request.uid,
    actorUid: request.uid,
    requestId: request.requestId,
    planId: plan.id,
    tool: plan.tool,
    action,
    outcome: 'success',
    timestamp: request.now,
    entityRefs: plan.operations.map(({ collection, id }) => ({ collection, id })),
    metadata: { operationCount: plan.operations.length },
  };
}

function refKey(collection: EntityCollection, id: string): string {
  return `${collection}/${id}`;
}

function planKey(uid: string, planId: string): string {
  return `${uid}/${planId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
