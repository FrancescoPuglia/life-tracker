import { randomUUID } from 'node:crypto';
import { DomainError, isDomainError } from '../errors';
import { hashIdempotencyKey, hashPlan, verifyStoredPlan } from '../integrity';
import {
  assertAuthenticated,
  normalizePublicOperation,
  REFERENCE_FIELDS,
  validateWritableField,
} from '../policy';
import type { Repository } from '../repository';
import { sanitizeEntity } from '../sanitize';
import type { PlanActionArgs, PreviewChangesArgs } from '../schemas';
import type {
  AuditEvent,
  AuthContext,
  ChangeDiff,
  ChangeOperation,
  EntityCollection,
  EntityRecord,
  ImmutableChangePlan,
  PlanActionResult,
  PublicChangePlan,
  PublicChangeDiff,
  ReadFilter,
  WriteValue,
  StoredChangePlan,
} from '../types';

export interface ChangePlanServiceOptions {
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
  readonly previewTtlMs?: number;
}

const DEFAULT_TTL_MS = 15 * 60_000;
const MAX_OPERATIONS = 100;

export class ChangePlanService {
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly previewTtlMs: number;

  constructor(
    private readonly repository: Repository,
    options: ChangePlanServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.previewTtlMs = options.previewTtlMs ?? DEFAULT_TTL_MS;
  }

  async previewChanges(context: AuthContext, args: PreviewChangesArgs): Promise<PublicChangePlan> {
    const operations: ChangeOperation[] = args.operations.map((operation) => ({
      op: operation.op,
      collection: operation.collection,
      id: operation.id,
      values: normalizePublicOperation(operation),
    }));
    return this.previewOperations(context, 'preview_changes', operations, [], []);
  }

  /** Used by scheduling and future Goal Architect adapters after draft creation. */
  async previewOperations(
    context: AuthContext,
    tool: string,
    operations: readonly ChangeOperation[],
    warnings: readonly string[],
    conflicts: readonly string[],
  ): Promise<PublicChangePlan> {
    assertAuthenticated(context);
    if (!operations.length || operations.length > MAX_OPERATIONS) {
      throw new DomainError('LIMIT_EXCEEDED', `A preview must contain 1-${MAX_OPERATIONS} operations.`);
    }
    await this.validateOperations(context.uid, operations);

    const planId = this.idFactory();
    const now = this.clock();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.previewTtlMs).toISOString();
    const refs = operations.map(({ collection, id }) => ({ collection, id }));
    const snapshot = await this.repository.captureSnapshot(
      context.uid,
      planId,
      refs,
      createdAt,
    );
    const snapshotByRef = new Map(snapshot.entries.map((entry) => [refKey(entry.collection, entry.id), entry]));
    const diff = operations.map((operation) => {
      const before = snapshotByRef.get(refKey(operation.collection, operation.id));
      if (!before) throw new DomainError('INTERNAL', 'Snapshot is incomplete.');
      if (operation.op === 'create' && before.existed) {
        throw new DomainError('CONFLICT', `Cannot create existing ${operation.collection}/${operation.id}.`);
      }
      if (operation.op !== 'create' && !before.existed) {
        throw new DomainError('NOT_FOUND', `${operation.collection}/${operation.id} does not exist.`);
      }
      return buildDiff(operation, before.value);
    });

    const planWithoutHash: Omit<ImmutableChangePlan, 'hash'> = {
      id: planId,
      uid: context.uid,
      requestId: context.requestId,
      tool,
      createdAt,
      expiresAt,
      snapshotId: snapshot.id,
      operations: structuredClone(operations),
      diff,
      warnings: [...warnings],
      conflicts: [...conflicts],
    };
    const plan: ImmutableChangePlan = {
      ...planWithoutHash,
      hash: hashPlan(planWithoutHash),
    };
    const stored = await this.repository.savePreview({
      plan,
      snapshot,
      audit: auditFor(plan, context, 'preview', 'success', createdAt),
    });
    return publicPlan(stored);
  }

  async getPlan(context: AuthContext, planId: string): Promise<PublicChangePlan> {
    assertAuthenticated(context);
    const plan = await this.repository.getPlan(context.uid, planId);
    if (!plan) throw new DomainError('NOT_FOUND', 'Change plan not found.');
    return publicPlan(plan);
  }

  async applyPlan(context: AuthContext, args: PlanActionArgs): Promise<PlanActionResult> {
    return this.performAction(context, args, 'apply');
  }

  async rollbackPlan(context: AuthContext, args: PlanActionArgs): Promise<PlanActionResult> {
    return this.performAction(context, args, 'rollback');
  }

  private async performAction(
    context: AuthContext,
    args: PlanActionArgs,
    action: 'apply' | 'rollback',
  ): Promise<PlanActionResult> {
    assertAuthenticated(context);
    let plan: StoredChangePlan | null = null;
    try {
      plan = await this.repository.getPlan(context.uid, args.planId);
      if (!plan) throw new DomainError('NOT_FOUND', 'Change plan not found.');
      verifyStoredPlan(plan);
      if (plan.uid !== context.uid) throw new DomainError('FORBIDDEN', 'Plan ownership mismatch.');
      if (action === 'apply') {
        if (plan.conflicts.length) throw new DomainError('CONFLICT', 'Plan has unresolved conflicts.');
        if (Date.parse(plan.expiresAt) <= this.clock().getTime() && plan.status === 'previewed') {
          throw new DomainError('EXPIRED', 'Change plan has expired.');
        }
      }
      const request = {
        uid: context.uid,
        planId: plan.id,
        idempotencyKeyHash: hashIdempotencyKey(context.uid, plan.id, action, args.idempotencyKey),
        requestId: context.requestId,
        now: this.clock().toISOString(),
      };
      return action === 'apply'
        ? await this.repository.applyPlanAtomically(request)
        : await this.repository.rollbackPlanAtomically(request);
    } catch (error) {
      const now = this.clock().toISOString();
      await this.repository.recordAudit({
        id: randomUUID(),
        uid: context.uid,
        actorUid: context.uid,
        requestId: context.requestId,
        planId: args.planId,
        tool: plan?.tool ?? `${action}_plan`,
        action,
        outcome: isDomainError(error) && error.code === 'CONFLICT' ? 'conflict' : 'rejected',
        timestamp: now,
        entityRefs: plan?.operations.map(({ collection, id }) => ({ collection, id })) ?? [],
        metadata: { errorCode: isDomainError(error) ? error.code : 'INTERNAL' },
      });
      throw error;
    }
  }

  private async validateOperations(uid: string, operations: readonly ChangeOperation[]): Promise<void> {
    const refs = new Set<string>();
    const existingByRef = new Map<string, EntityRecord | null>();
    for (const operation of operations) {
      const key = refKey(operation.collection, operation.id);
      if (refs.has(key)) throw new DomainError('INVALID_ARGUMENT', `Duplicate operation for ${key}.`);
      refs.add(key);
      for (const [field, value] of Object.entries(operation.values)) {
        validateWritableField(operation.collection, field, value);
      }
      if (operation.op === 'delete' && Object.keys(operation.values).length) {
        throw new DomainError('INVALID_ARGUMENT', 'Delete operations cannot carry values.');
      }
      if (operation.op !== 'delete' && !Object.keys(operation.values).length) {
        throw new DomainError('INVALID_ARGUMENT', `${operation.op} requires values.`);
      }
      const existing = await this.repository.getEntity(uid, operation.collection, operation.id);
      existingByRef.set(key, existing);
      if (operation.op !== 'create' && !existing) {
        throw new DomainError('NOT_FOUND', `${operation.collection}/${operation.id} does not exist.`);
      }
      if (
        operation.op === 'delete' &&
        operation.collection === 'timeBlocks' &&
        existing &&
        (existing.status === 'completed' || existing.protected === true)
      ) {
        throw new DomainError('FORBIDDEN', 'Completed or protected time blocks cannot be deleted.');
      }
      if (operation.op === 'delete') await this.assertNoInboundReferences(uid, operation.collection, operation.id);
    }

    const mergedByRef = new Map<string, EntityRecord | null>();
    for (const operation of operations) {
      const key = refKey(operation.collection, operation.id);
      const existing = existingByRef.get(key) ?? null;
      const merged = operation.op === 'delete'
        ? null
        : ({
            ...(existing ?? {}),
            id: operation.id,
            ...operation.values,
            _version: existing?._version ?? 0,
            createdAt: existing?.createdAt ?? '',
            updatedAt: existing?.updatedAt ?? '',
          } as EntityRecord);
      mergedByRef.set(key, merged);
      if (operation.op === 'create') assertRequiredCreateFields(operation.collection, merged);
      assertTemporalGeometry(operation.collection, merged);
    }

    const resolve = async (collection: EntityCollection, id: string): Promise<EntityRecord | null> => {
      const key = refKey(collection, id);
      if (mergedByRef.has(key)) return mergedByRef.get(key) ?? null;
      return this.repository.getEntity(uid, collection, id);
    };
    for (const operation of operations) {
      const merged = mergedByRef.get(refKey(operation.collection, operation.id));
      if (merged) await assertReferenceChain(operation.collection, merged, resolve);
    }
  }

  private async assertOwnedReferences(
    uid: string,
    values: Readonly<Record<string, WriteValue>>,
  ): Promise<void> {
    for (const [field, collection] of Object.entries(REFERENCE_FIELDS)) {
      const target = values[field];
      if (target === undefined || target === null) continue;
      if (typeof target !== 'string') throw new DomainError('INVALID_ARGUMENT', `Invalid ${field}.`);
      if (!(await this.repository.getEntity(uid, collection, target))) {
        throw new DomainError('FORBIDDEN', `Referenced ${collection} is unavailable for this user.`);
      }
    }
  }

  private async assertNoInboundReferences(
    uid: string,
    collection: EntityCollection,
    id: string,
  ): Promise<void> {
    const lookups: readonly [EntityCollection, keyof ReadFilter][] =
      collection === 'domains'
        ? [['goals', 'domainId'], ['keyResults', 'domainId'], ['projects', 'domainId'], ['tasks', 'domainId'], ['timeBlocks', 'domainId'], ['habits', 'domainId'], ['notes', 'domainId']]
        : collection === 'goals'
          ? [['keyResults', 'goalId'], ['projects', 'goalId'], ['tasks', 'goalId'], ['timeBlocks', 'goalId']]
          : collection === 'projects'
            ? [['tasks', 'projectId'], ['timeBlocks', 'projectId'], ['notes', 'projectId']]
            : collection === 'tasks'
              ? [['timeBlocks', 'taskId']]
              : [];
    for (const [childCollection, field] of lookups) {
      const filter: ReadFilter = emptyFilter();
      const page = await this.repository.listEntities(uid, childCollection, {
        filter: { ...filter, [field]: id },
        cursor: null,
        limit: 1,
      });
      if (page.items.length) {
        throw new DomainError('CONFLICT', `Cannot delete referenced ${collection}/${id}.`);
      }
    }
  }
}

function assertRequiredCreateFields(collection: EntityCollection, entity: EntityRecord): void {
  const requiredByCollection: Readonly<Record<EntityCollection, readonly string[]>> = {
    domains: ['name', 'color', 'icon'],
    goals: ['title', 'domainId', 'status', 'priority', 'targetDate', 'timeAllocationTarget', 'category', 'complexity', 'keyResults'],
    keyResults: ['title', 'goalId', 'domainId', 'targetValue', 'currentValue', 'status'],
    projects: ['name', 'goalId', 'domainId', 'status', 'priority'],
    tasks: ['title', 'projectId', 'domainId', 'status', 'priority', 'estimatedMinutes'],
    timeBlocks: ['title', 'startTime', 'endTime', 'domainId', 'status', 'type'],
    habits: ['name', 'domainId', 'frequency', 'isActive', 'streakCount', 'bestStreak'],
    sessions: [],
    notes: ['title', 'entityType', 'domainId'],
  };
  if (collection === 'notes') {
    throw new DomainError('FORBIDDEN', 'Rich-text notes cannot be created through generic AI writes.');
  }
  for (const field of requiredByCollection[collection]) {
    if (entity[field] === undefined || entity[field] === null || entity[field] === '') {
      throw new DomainError('INVALID_ARGUMENT', `Creating ${collection} requires '${field}'.`);
    }
  }
}

function assertTemporalGeometry(collection: EntityCollection, current: EntityRecord | null): void {
  if (collection !== 'timeBlocks' || !current) return;
  const start = current.startTime;
  const end = current.endTime;
  if (typeof start !== 'string' || typeof end !== 'string' || Date.parse(start) >= Date.parse(end)) {
    throw new DomainError('INVALID_ARGUMENT', 'A time block must have a valid positive half-open interval.');
  }
}

type EntityResolver = (collection: EntityCollection, id: string) => Promise<EntityRecord | null>;

async function assertReferenceChain(
  collection: EntityCollection,
  entity: EntityRecord,
  resolve: EntityResolver,
): Promise<void> {
  const domainId = stringField(entity, 'domainId', collection !== 'domains');
  if (domainId && !(await resolve('domains', domainId))) {
    throw new DomainError('FORBIDDEN', 'Referenced domain is unavailable for this user.');
  }
  if (collection === 'domains' || collection === 'habits' || collection === 'goals' || collection === 'notes') {
    if (collection === 'notes') await assertNoteReference(entity, resolve);
    return;
  }

  if (collection === 'keyResults') {
    const goal = await requireReference(resolve, 'goals', stringField(entity, 'goalId', true));
    assertSameDomain(entity, goal, 'key result', 'goal');
    return;
  }

  if (collection === 'projects') {
    const goal = await requireReference(resolve, 'goals', stringField(entity, 'goalId', true));
    assertSameDomain(entity, goal, 'project', 'goal');
    return;
  }

  if (collection === 'tasks') {
    const project = await requireReference(resolve, 'projects', stringField(entity, 'projectId', true));
    assertSameDomain(entity, project, 'task', 'project');
    if (typeof project.goalId !== 'string') throw new DomainError('CONFLICT', 'Task project has no goal.');
    if (entity.goalId !== undefined && entity.goalId !== null && entity.goalId !== project.goalId) {
      throw new DomainError('CONFLICT', 'Task goalId does not match its project goalId.');
    }
    return;
  }

  if (collection === 'timeBlocks') {
    const task = typeof entity.taskId === 'string' ? await requireReference(resolve, 'tasks', entity.taskId) : null;
    const projectId = typeof entity.projectId === 'string' ? entity.projectId : (typeof task?.projectId === 'string' ? task.projectId : null);
    const project = projectId ? await requireReference(resolve, 'projects', projectId) : null;
    const goalId = typeof entity.goalId === 'string'
      ? entity.goalId
      : typeof project?.goalId === 'string'
        ? project.goalId
        : null;
    const goal = goalId ? await requireReference(resolve, 'goals', goalId) : null;
    for (const [label, parent] of [['task', task], ['project', project], ['goal', goal]] as const) {
      if (parent) assertSameDomain(entity, parent, 'time block', label);
    }
    if (task && project && task.projectId !== project.id) throw new DomainError('CONFLICT', 'Time block task/project mismatch.');
    if (project && goal && project.goalId !== goal.id) throw new DomainError('CONFLICT', 'Time block project/goal mismatch.');
  }
}

async function assertNoteReference(entity: EntityRecord, resolve: EntityResolver): Promise<void> {
  if (entity.entityType === 'global') {
    if (entity.entityId !== null && entity.entityId !== undefined) {
      throw new DomainError('INVALID_ARGUMENT', 'Global notes cannot have entityId.');
    }
    return;
  }
  const map = { goal: 'goals', project: 'projects', task: 'tasks' } as const;
  const targetCollection = map[entity.entityType as keyof typeof map];
  if (!targetCollection || typeof entity.entityId !== 'string') {
    throw new DomainError('INVALID_ARGUMENT', 'Entity notes require a valid entityId.');
  }
  const target = await requireReference(resolve, targetCollection, entity.entityId);
  assertSameDomain(entity, target, 'note', entity.entityType as string);
}

async function requireReference(
  resolve: EntityResolver,
  collection: EntityCollection,
  id: string | null,
): Promise<EntityRecord> {
  if (!id) throw new DomainError('INVALID_ARGUMENT', `Missing required ${collection} reference.`);
  const entity = await resolve(collection, id);
  if (!entity) throw new DomainError('FORBIDDEN', `Referenced ${collection} is unavailable for this user.`);
  return entity;
}

function assertSameDomain(child: EntityRecord, parent: EntityRecord, childLabel: string, parentLabel: string): void {
  if (child.domainId !== parent.domainId) {
    throw new DomainError('CONFLICT', `${childLabel} domainId does not match its ${parentLabel}.`);
  }
}

function stringField(entity: EntityRecord, field: string, required: boolean): string | null {
  const value = entity[field];
  if (value === undefined || value === null) {
    if (required) throw new DomainError('INVALID_ARGUMENT', `Missing required field '${field}'.`);
    return null;
  }
  if (typeof value !== 'string' || !value) throw new DomainError('INVALID_ARGUMENT', `Invalid field '${field}'.`);
  return value;
}

function buildDiff(operation: ChangeOperation, before: EntityRecord | null): ChangeDiff {
  const after = operation.op === 'delete'
    ? null
    : ({ ...(before ?? {}), id: operation.id, ...operation.values } as EntityRecord);
  return {
    collection: operation.collection,
    id: operation.id,
    op: operation.op,
    before: before ? sanitizeEntity(operation.collection, before) : null,
    after: after ? sanitizeEntity(operation.collection, after) : null,
  };
}

function publicPlan(plan: StoredChangePlan): PublicChangePlan {
  return {
    planId: plan.id,
    tool: plan.tool,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    hash: plan.hash,
    status: plan.status,
    diff: plan.diff.map(publicDiff),
    warnings: [...plan.warnings],
    conflicts: [...plan.conflicts],
  };
}

function publicDiff(diff: ChangeDiff): PublicChangeDiff {
  const source = diff.after ?? diff.before;
  const candidate = source?.title ?? source?.name;
  return {
    collection: diff.collection,
    id: diff.id,
    op: diff.op,
    changedFields: diff.op === 'update'
      ? changedFields(diff.before, diff.after)
      : [],
    title: typeof candidate === 'string' ? candidate.slice(0, 120) : null,
  };
}

function changedFields(
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>> | null,
): readonly string[] {
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...fields]
    .filter((field) => JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field]))
    .filter((field) => !['id', 'createdAt', 'updatedAt'].includes(field))
    .sort()
    .slice(0, 30);
}

function auditFor(
  plan: ImmutableChangePlan,
  context: AuthContext,
  action: AuditEvent['action'],
  outcome: AuditEvent['outcome'],
  timestamp: string,
): AuditEvent {
  return {
    id: randomUUID(),
    uid: context.uid,
    actorUid: context.uid,
    requestId: context.requestId,
    planId: plan.id,
    tool: plan.tool,
    action,
    outcome,
    timestamp,
    entityRefs: plan.operations.map(({ collection, id }) => ({ collection, id })),
    metadata: { operationCount: plan.operations.length, conflictCount: plan.conflicts.length },
  };
}

function refKey(collection: EntityCollection, id: string): string {
  return `${collection}/${id}`;
}

function emptyFilter(): ReadFilter {
  return {
    query: null,
    from: null,
    to: null,
    status: null,
    domainId: null,
    projectId: null,
    goalId: null,
    taskId: null,
  };
}
