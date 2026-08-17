import { randomUUID } from 'node:crypto';
import { CapabilityIssuer, hashCapability } from '../capabilities';
import { DomainError, isDomainError } from '../errors';
import {
  hashIdempotencyKey,
  hashPlan,
  hashSnapshotState,
  hashValidationScopeRecords,
  validationScopeKey,
  verifyStoredPlan,
} from '../integrity';
import {
  assertAuthenticated,
  normalizePublicOperation,
  REFERENCE_FIELDS,
  validateWritableField,
} from '../policy';
import type { Repository } from '../repository';
import { sanitizeEntity } from '../sanitize';
import { isProtectedTimeBlock } from '../timeblock-policy';
import type { PreviewChangesArgs } from '../schemas';
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
  PreviewValidationRequirements,
  ReadFilter,
  EntityReference,
  ValidationScopeExpectation,
  WriteValue,
  StoredChangePlan,
} from '../types';

export interface ChangePlanServiceOptions {
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
  readonly previewTtlMs?: number;
  readonly rollbackTtlMs?: number;
  readonly capabilityIssuer?: CapabilityIssuer;
}

export interface ApplyPlanInput {
  readonly planId: string;
  readonly approvalCapability: string;
  readonly idempotencyKey: string;
}

export interface RollbackExecutionInput {
  readonly executionId: string;
  readonly rollbackCapability: string;
  readonly idempotencyKey: string;
}

export interface PreviewMetadata {
  readonly reason?: string;
  readonly assumptions?: readonly string[];
  readonly expectedImpact?: readonly string[];
  readonly validation?: PreviewValidationRequirements;
}

const DEFAULT_TTL_MS = 15 * 60_000;
const DEFAULT_ROLLBACK_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_OPERATIONS = 100;
const MAX_STORED_PLAN_BYTES = 750_000;
const MAX_STORED_SNAPSHOT_BYTES = 750_000;
// ToolExecutor permits 256 KiB. Leave envelope headroom so a preview cannot
// be persisted and then become impossible to return to the authenticated UI.
const MAX_PUBLIC_PREVIEW_BYTES = 240_000;
const AI_DELETABLE_COLLECTIONS = new Set<EntityCollection>(['timeBlocks', 'notes']);
const UNMAPPED_TIMEBLOCK_TYPES = new Set(['break', 'buffer', 'travel', 'admin']);
const MAX_VALIDATION_SCOPE_ITEMS = 2_000;

export class ChangePlanService {
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly previewTtlMs: number;
  private readonly rollbackTtlMs: number;
  private readonly capabilityIssuer: CapabilityIssuer | undefined;

  constructor(
    private readonly repository: Repository,
    options: ChangePlanServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.previewTtlMs = options.previewTtlMs ?? DEFAULT_TTL_MS;
    this.rollbackTtlMs = options.rollbackTtlMs ?? DEFAULT_ROLLBACK_TTL_MS;
    this.capabilityIssuer = options.capabilityIssuer;
  }

  async previewChanges(context: AuthContext, args: PreviewChangesArgs): Promise<PublicChangePlan> {
    const operations: ChangeOperation[] = args.operations.map((operation) => ({
      op: operation.op,
      collection: operation.collection,
      id: operation.id,
      values: normalizePublicOperation(operation),
    }));
    return this.previewOperations(context, 'preview_changes', operations, [], [], {
      reason: args.reason,
    });
  }

  /** Used by scheduling and future Goal Architect adapters after draft creation. */
  async previewOperations(
    context: AuthContext,
    tool: string,
    operations: readonly ChangeOperation[],
    warnings: readonly string[],
    conflicts: readonly string[],
    metadata: PreviewMetadata = {},
  ): Promise<PublicChangePlan> {
    assertAuthenticated(context);
    if (!operations.length || operations.length > MAX_OPERATIONS) {
      throw new DomainError('LIMIT_EXCEEDED', `A preview must contain 1-${MAX_OPERATIONS} operations.`);
    }
    const operationValidation = await this.validateOperations(context.uid, operations);
    const validation = mergeValidationRequirements(operationValidation, metadata.validation);

    const planId = this.idFactory();
    const now = this.clock();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.previewTtlMs).toISOString();
    const refs = uniqueReferences([
      ...operations.map(({ collection, id }) => ({ collection, id })),
      ...validation.refs,
    ]);
    const snapshot = await this.repository.captureSnapshot(
      context.uid,
      planId,
      refs,
      createdAt,
      validation,
    );
    // Close the validation-to-snapshot race. Service-specific scope hashes are
    // checked inside captureSnapshot; generic references/scopes are recomputed
    // once after capture and must describe the identical state.
    const postCaptureValidation = mergeValidationRequirements(
      await this.validateOperations(context.uid, operations),
      metadata.validation,
    );
    if (validationRequirementsKey(postCaptureValidation) !== validationRequirementsKey(validation)) {
      throw new DomainError('STATE_CHANGED', 'Authoritative state changed while creating the preview.');
    }
    const baseStateHash = hashSnapshotState(snapshot);
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
      baseStateHash,
      orchestration: context.orchestration ? structuredClone(context.orchestration) : null,
      operations: structuredClone(operations),
      diff,
      reason: normalizeNotice(metadata.reason ?? 'User-requested Life Tracker proposal.', 500),
      warnings: [...warnings],
      conflicts: [...conflicts],
      assumptions: normalizeNotices(metadata.assumptions ?? []),
      expectedImpact: normalizeNotices(metadata.expectedImpact ?? []),
      destructiveOperationCount: operations.filter((operation) => operation.op === 'delete').length,
    };
    const plan: ImmutableChangePlan = {
      ...planWithoutHash,
      hash: hashPlan(planWithoutHash),
    };
    const approvalCapability = this.issuer().issue('approval', context.uid, plan.id, plan.hash);
    const previewCandidate: StoredChangePlan = { ...plan, status: 'previewed' };
    assertSerializedSize(snapshot, MAX_STORED_SNAPSHOT_BYTES, 'Snapshot');
    assertSerializedSize(previewCandidate, MAX_STORED_PLAN_BYTES, 'Plan');
    assertSerializedSize(
      publicPlan(previewCandidate, approvalCapability),
      MAX_PUBLIC_PREVIEW_BYTES,
      'Public preview',
    );
    const stored = await this.repository.savePreview({
      plan,
      snapshot,
      approval: {
        uid: context.uid,
        planId: plan.id,
        planHash: plan.hash,
        baseStateHash,
        capabilityHash: hashCapability(approvalCapability),
        createdAt,
        expiresAt,
        status: 'pending',
      },
      audit: auditFor(plan, context, 'preview', 'success', createdAt),
    });
    return publicPlan(stored, approvalCapability);
  }

  async getPlan(context: AuthContext, planId: string): Promise<PublicChangePlan> {
    assertAuthenticated(context);
    const plan = await this.repository.getPlan(context.uid, planId);
    if (!plan) throw new DomainError('NOT_FOUND', 'Change plan not found.');
    verifyStoredPlan(plan);
    if (plan.uid !== context.uid) throw new DomainError('NOT_FOUND', 'Change plan not found.');
    if (plan.status !== 'previewed') {
      throw new DomainError('CONFLICT', 'Change plan is no longer awaiting approval.');
    }
    if (Date.parse(plan.expiresAt) <= this.clock().getTime()) {
      throw new DomainError('EXPIRED', 'Change plan has expired.');
    }
    const capability = this.issuer().issue('approval', context.uid, plan.id, plan.hash);
    return publicPlan(plan, capability);
  }

  async applyPlan(context: AuthContext, args: ApplyPlanInput): Promise<PlanActionResult> {
    assertAuthenticated(context);
    let plan: StoredChangePlan | null = null;
    try {
      plan = await this.repository.getPlan(context.uid, args.planId);
      if (!plan) throw new DomainError('NOT_FOUND', 'Change plan not found.');
      verifyStoredPlan(plan);
      if (plan.uid !== context.uid) throw new DomainError('FORBIDDEN', 'Plan ownership mismatch.');
      if (plan.conflicts.length) throw new DomainError('CONFLICT', 'Plan has unresolved conflicts.');
      if (Date.parse(plan.expiresAt) <= this.clock().getTime() && plan.status === 'previewed') {
        throw new DomainError('EXPIRED', 'Change plan has expired.');
      }
      const now = this.clock();
      const executionId = this.idFactory();
      const rollbackExpiresAt = new Date(now.getTime() + this.rollbackTtlMs).toISOString();
      const rollbackCapability = this.issuer().issue('rollback', context.uid, executionId, plan.hash);
      const result = await this.repository.applyPlanAtomically({
        uid: context.uid,
        planId: plan.id,
        approvalCapabilityHash: hashCapability(args.approvalCapability),
        idempotencyKeyHash: hashIdempotencyKey(context.uid, plan.id, 'apply', args.idempotencyKey),
        requestId: context.requestId,
        now: now.toISOString(),
        executionId,
        rollbackCapabilityHash: hashCapability(rollbackCapability),
        rollbackExpiresAt,
      });
      if (result.status !== 'applied' || !result.receipt.rollbackAvailable) return result;
      const replayRollbackCapability = this.issuer().issue(
        'rollback',
        context.uid,
        result.executionId,
        result.hash,
      );
      return {
        ...result,
        rollback: {
          capability: replayRollbackCapability,
          expiresAt: result.receipt.rollbackExpiresAt ?? rollbackExpiresAt,
        },
      };
    } catch (error) {
      if (isDomainError(error) && error.code === 'COMMITTED_UNVERIFIED') throw error;
      const now = this.clock().toISOString();
      await this.recordRejectedAction({
        id: randomUUID(),
        uid: context.uid,
        actorUid: context.uid,
        requestId: context.requestId,
        planId: args.planId,
        tool: plan?.tool ?? 'apply_plan',
        action: 'apply',
        outcome: isDomainError(error) && (error.code === 'CONFLICT' || error.code === 'STATE_CHANGED')
          ? 'conflict'
          : 'rejected',
        timestamp: now,
        entityRefs: plan?.operations.map(({ collection, id }) => ({ collection, id })) ?? [],
        metadata: { errorCode: isDomainError(error) ? error.code : 'INTERNAL' },
      });
      throw error;
    }
  }

  async rollbackExecution(
    context: AuthContext,
    args: RollbackExecutionInput,
  ): Promise<PlanActionResult> {
    assertAuthenticated(context);
    const execution = await this.repository.getExecution(context.uid, args.executionId);
    if (!execution) throw new DomainError('NOT_FOUND', 'Execution not found.');
    try {
      return await this.repository.rollbackExecutionAtomically({
        uid: context.uid,
        executionId: args.executionId,
        rollbackCapabilityHash: hashCapability(args.rollbackCapability),
        idempotencyKeyHash: hashIdempotencyKey(
          context.uid,
          args.executionId,
          'rollback',
          args.idempotencyKey,
        ),
        requestId: context.requestId,
        now: this.clock().toISOString(),
      });
    } catch (error) {
      if (isDomainError(error) && error.code === 'COMMITTED_UNVERIFIED') throw error;
      await this.recordRejectedAction({
        id: randomUUID(),
        uid: context.uid,
        actorUid: context.uid,
        requestId: context.requestId,
        planId: execution.planId,
        tool: 'rollback_plan',
        action: 'rollback',
        outcome: isDomainError(error) && (error.code === 'CONFLICT' || error.code === 'STATE_CHANGED')
          ? 'conflict'
          : 'rejected',
        timestamp: this.clock().toISOString(),
        entityRefs: execution.result.affected,
        metadata: { errorCode: isDomainError(error) ? error.code : 'INTERNAL' },
      });
      throw error;
    }
  }

  private async recordRejectedAction(event: AuditEvent): Promise<void> {
    try {
      await this.repository.recordAudit(event);
    } catch {
      // Rejection auditing is best-effort because it occurs after the
      // authoritative transaction has already refused the mutation. Never
      // replace the security/domain error with an audit-storage outage, and
      // never log request bodies, tokens, capabilities, or user content.
      console.error('Life Tracker rejection audit could not be persisted.', {
        requestId: event.requestId,
        action: event.action,
        code: 'AUDIT_WRITE_FAILED',
      });
    }
  }

  private issuer(): CapabilityIssuer {
    if (!this.capabilityIssuer) {
      throw new DomainError('INTERNAL', 'Approval capability service is unavailable.');
    }
    return this.capabilityIssuer;
  }

  private async validateOperations(
    uid: string,
    operations: readonly ChangeOperation[],
  ): Promise<PreviewValidationRequirements> {
    const refs = new Set<string>();
    const existingByRef = new Map<string, EntityRecord | null>();
    const dependencyRefs = new Map<string, EntityReference>();
    const dependencyRecords = new Map<string, EntityRecord | null>();
    const validationScopes = new Map<string, ValidationScopeExpectation>();
    for (const operation of operations) {
      const key = refKey(operation.collection, operation.id);
      if (refs.has(key)) throw new DomainError('INVALID_ARGUMENT', `Duplicate operation for ${key}.`);
      refs.add(key);
      for (const [field, value] of Object.entries(operation.values)) {
        validateWritableField(operation.collection, field, value);
      }
      if (operation.op === 'delete' && !AI_DELETABLE_COLLECTIONS.has(operation.collection)) {
        throw new DomainError(
          'FORBIDDEN',
          `AI deletion is not supported for ${operation.collection}; use the deterministic product workflow.`,
        );
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
        operation.op !== 'create'
        && operation.collection === 'timeBlocks'
        && existing
        && isProtectedTimeBlock(existing)
      ) {
        throw new DomainError('FORBIDDEN', 'Completed, in-progress, fixed, or locked time blocks cannot be changed by AI.');
      }
      if (operation.op === 'delete' || operation.op === 'create') {
        await this.assertNoInboundReferences(
          uid,
          operation.collection,
          operation.id,
          validationScopes,
        );
      }
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
      if (operation.op === 'create') {
        if (!merged) throw new DomainError('INTERNAL', 'Create validation state is missing.');
        assertRequiredCreateFields(operation.collection, merged);
      }
      assertTemporalGeometry(operation.collection, merged);
    }

    const resolve = async (collection: EntityCollection, id: string): Promise<EntityRecord | null> => {
      const key = refKey(collection, id);
      if (mergedByRef.has(key)) return mergedByRef.get(key) ?? null;
      if (dependencyRecords.has(key)) return dependencyRecords.get(key) ?? null;
      const entity = await this.repository.getEntity(uid, collection, id);
      dependencyRecords.set(key, entity);
      dependencyRefs.set(key, { collection, id });
      return entity;
    };
    for (const operation of operations) {
      const merged = mergedByRef.get(refKey(operation.collection, operation.id));
      if (merged) await assertReferenceChain(operation.collection, merged, resolve);
    }
    return {
      refs: [...dependencyRefs.values()].sort((a, b) => refKey(a.collection, a.id).localeCompare(refKey(b.collection, b.id))),
      scopes: [...validationScopes.values()].sort((a, b) => validationScopeKey(a).localeCompare(validationScopeKey(b))),
      planningPreferencesHash: null,
    };
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
    scopes: Map<string, ValidationScopeExpectation>,
  ): Promise<void> {
    const lookups: readonly [EntityCollection, ValidationScopeExpectation['field']][] =
      collection === 'domains'
        ? [['goals', 'domainId'], ['keyResults', 'domainId'], ['projects', 'domainId'], ['tasks', 'domainId'], ['timeBlocks', 'domainId'], ['habits', 'domainId'], ['notes', 'domainId'], ['goalRoadmaps', 'domainId']]
        : collection === 'goals'
          ? [['keyResults', 'goalId'], ['projects', 'goalId'], ['tasks', 'goalId'], ['timeBlocks', 'goalId'], ['goalRoadmaps', 'goalId']]
          : collection === 'projects'
            ? [['tasks', 'projectId'], ['timeBlocks', 'projectId'], ['notes', 'entityId']]
            : collection === 'tasks'
              ? [['timeBlocks', 'taskId'], ['sessions', 'taskId'], ['notes', 'entityId']]
              : collection === 'timeBlocks'
                ? [['sessions', 'timeBlockId']]
                : collection === 'habits'
                  ? [['habitLogs', 'habitId']]
                  : [];
    for (const [childCollection, field] of lookups) {
      if (!field) continue;
      const filter: ReadFilter = emptyFilter();
      const page = await this.repository.listEntities(uid, childCollection, {
        filter: {
          ...filter,
          ...(field === 'domainId' || field === 'goalId' || field === 'projectId' || field === 'taskId'
            ? { [field]: id }
            : {}),
        },
        cursor: null,
        limit: 1,
      });
      const exactItems = field === 'entityId' || field === 'timeBlockId' || field === 'habitId'
        ? page.items.filter((item) => item[field] === id)
        : page.items;
      if (exactItems.length) {
        throw new DomainError('CONFLICT', `Cannot delete referenced ${collection}/${id}.`);
      }
      const scope: ValidationScopeExpectation = {
        collection: childCollection,
        field,
        value: id,
        from: null,
        to: null,
        maxItems: MAX_VALIDATION_SCOPE_ITEMS,
        expectedStateHash: hashValidationScopeRecords([]),
      };
      scopes.set(validationScopeKey(scope), scope);
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
    habitLogs: [],
    sessions: [],
    notes: ['title', 'entityType', 'domainId'],
    goalRoadmaps: [],
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
  const startMs = typeof start === 'string' ? Date.parse(start) : Number.NaN;
  const endMs = typeof end === 'string' ? Date.parse(end) : Number.NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    throw new DomainError('INVALID_ARGUMENT', 'A time block must have a valid positive half-open interval.');
  }
  const mapped = typeof current.taskId === 'string'
    || typeof current.projectId === 'string'
    || typeof current.goalId === 'string';
  if (!mapped && !UNMAPPED_TIMEBLOCK_TYPES.has(String(current.type))) {
    throw new DomainError('CONFLICT', 'A productive time block requires a Goal, Project, or Task mapping.');
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

function publicPlan(plan: StoredChangePlan, approvalCapability: string): PublicChangePlan {
  return {
    id: plan.id,
    tool: plan.tool,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    baseStateHash: plan.baseStateHash,
    hash: plan.hash,
    status: plan.status,
    operations: plan.operations.map((operation, index) => ({
      action: publicAction(requirePlanDiff(plan, index)),
      entityType: operation.collection,
      entityId: operation.id,
    })),
    diff: plan.diff.map(publicDiff),
    reason: plan.reason,
    warnings: [...plan.warnings],
    conflicts: [...plan.conflicts],
    assumptions: [...plan.assumptions],
    expectedImpact: [...plan.expectedImpact],
    destructiveOperationCount: plan.destructiveOperationCount,
    approval: {
      required: true,
      capability: approvalCapability,
      expiresAt: plan.expiresAt,
    },
  };
}

function requirePlanDiff(plan: StoredChangePlan, index: number): ChangeDiff {
  const diff = plan.diff[index];
  if (!diff) throw new DomainError('INTERNAL', 'Stored plan diff is incomplete.');
  return diff;
}

function publicDiff(diff: ChangeDiff): PublicChangeDiff {
  const source = diff.after ?? diff.before;
  const candidate = source?.title ?? source?.name;
  const title = typeof candidate === 'string' ? candidate.slice(0, 120) : null;
  // Creates and deletes must expose the same complete browser-safe field set
  // that is covered by the approved changeset hash. An empty list caused the
  // UI to fall back to a small whitelist and hide material fields.
  const changed = changedFields(diff.before, diff.after);
  return {
    action: publicAction(diff),
    entityType: diff.collection,
    entityId: diff.id,
    summary: humanDiffSummary(diff, title, changed),
    changedFields: changed,
    title,
    before: diff.before,
    after: diff.after,
  };
}

function humanDiffSummary(
  diff: ChangeDiff,
  title: string | null,
  changed: readonly string[],
): string {
  const subject = title ? `“${title}”` : `${diff.collection}/${diff.id}`;
  if (diff.op === 'create') return `Create ${subject} in ${diff.collection}.`;
  if (diff.op === 'delete') return `Delete ${subject} from ${diff.collection}.`;
  if (publicAction(diff) === 'move') {
    return `Move ${subject}: ${changed.join(', ')}.`.slice(0, 500);
  }
  return changed.length
    ? `Update ${subject}: ${changed.join(', ')}.`.slice(0, 500)
    : `Update ${subject}.`;
}

function publicAction(diff: ChangeDiff): PublicChangeDiff['action'] {
  if (diff.op !== 'update') return diff.op;
  if (
    diff.collection === 'timeBlocks'
    && changedFields(diff.before, diff.after).some((field) => field === 'startTime' || field === 'endTime')
  ) {
    return 'move';
  }
  return 'update';
}

function normalizeNotices(values: readonly string[]): readonly string[] {
  return values.slice(0, 20).map((value) => normalizeNotice(value, 500));
}

function normalizeNotice(value: string, maxLength: number): string {
  const normalized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (!normalized) return 'No additional detail provided.';
  return normalized.slice(0, maxLength);
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
    metadata: {
      operationCount: plan.operations.length,
      conflictCount: plan.conflicts.length,
      baseStateHash: plan.baseStateHash,
      changesetHash: plan.hash,
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

function mergeValidationRequirements(
  first: PreviewValidationRequirements,
  second?: PreviewValidationRequirements,
): PreviewValidationRequirements {
  const refs = uniqueReferences([...(first.refs ?? []), ...(second?.refs ?? [])]);
  const scopes = new Map<string, ValidationScopeExpectation>();
  for (const scope of [...(first.scopes ?? []), ...(second?.scopes ?? [])]) {
    const key = validationScopeKey(scope);
    const existing = scopes.get(key);
    if (existing && existing.expectedStateHash !== scope.expectedStateHash) {
      throw new DomainError('STATE_CHANGED', 'Validation scope changed while creating the preview.');
    }
    scopes.set(key, scope);
  }
  const preferenceHashes = [first.planningPreferencesHash, second?.planningPreferencesHash]
    .filter((value): value is string => value !== null && value !== undefined);
  if (new Set(preferenceHashes).size > 1) {
    throw new DomainError('STATE_CHANGED', 'Planning preferences changed while creating the preview.');
  }
  return {
    refs,
    scopes: [...scopes.values()].sort((a, b) => validationScopeKey(a).localeCompare(validationScopeKey(b))),
    planningPreferencesHash: preferenceHashes[0] ?? null,
  };
}

function uniqueReferences(refs: readonly EntityReference[]): readonly EntityReference[] {
  const byKey = new Map<string, EntityReference>();
  for (const ref of refs) byKey.set(refKey(ref.collection, ref.id), ref);
  return [...byKey.values()].sort((a, b) => refKey(a.collection, a.id).localeCompare(refKey(b.collection, b.id)));
}

function validationRequirementsKey(requirements: PreviewValidationRequirements): string {
  return JSON.stringify({
    refs: requirements.refs.map((ref) => refKey(ref.collection, ref.id)),
    scopes: requirements.scopes.map((scope) => [validationScopeKey(scope), scope.expectedStateHash]),
    planningPreferencesHash: requirements.planningPreferencesHash,
  });
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

function assertSerializedSize(value: unknown, maxBytes: number, label: string): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new DomainError('INVALID_ARGUMENT', `${label} cannot be serialized safely.`);
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new DomainError('LIMIT_EXCEEDED', `${label} exceeds the safe persistence limit.`);
  }
}
