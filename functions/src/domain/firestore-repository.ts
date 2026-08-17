import { randomUUID } from 'node:crypto';
import {
  FieldPath,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type Transaction,
} from 'firebase-admin/firestore';
import { capabilityHashMatches } from './capabilities';
import { entityAfterCreate, entityAfterUpdate } from './entity-mutation';
import { DomainError } from './errors';
import {
  hashEntityState,
  hashPlanningPreferences,
  hashResultState,
  hashSnapshotState,
  hashValidationScopeRecords,
  validationScopeKey,
  verifyStoredPlan,
} from './integrity';
import { assertEntityId } from './policy';
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
  ValidationScopeSnapshot,
} from './types';
import { SERVER_ONLY_PATHS } from './types';

const UID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_SCAN_PER_PAGE = 500;
const SCAN_BATCH_SIZE = 100;
const MAX_AUDIT_RESULTS = 500;
const EPOCH = new Date(0).toISOString();

const PRODUCT_DEFAULT_PREFERENCES: UserPlanningPreferences = Object.freeze({
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
  // Reuse the established Weekly Planning Intelligence product constraint.
  // Keeping it in the returned preference object makes the fallback visible
  // to the user/model instead of silently applying it inside scheduling.
  workingHours: Object.freeze({ start: '07:00', end: '22:00' }),
  maxDailyPlannedMinutes: 600,
  maxWeeklyPlannedMinutes: 3_000,
  minBufferMinutes: 15,
  maxConsecutiveHighEnergyBlocks: 2,
});

const ENTITY_DATE_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'startTime',
  'endTime',
  'actualStartTime',
  'actualEndTime',
  'completedAt',
  'dueDate',
  'deadline',
  'targetDate',
  'date',
  'timestamp',
  'earnedAt',
]);

interface TransactionResult {
  readonly result: PlanActionResult;
  readonly replay: boolean;
}

/** Injectable verification seam used by emulator failure-injection tests. */
export interface FirestoreRepositoryVerificationHooks {
  readonly beforeVerification?: (
    action: PlanActionResult['status'],
    executionId: string,
  ) => void | Promise<void>;
}

/**
 * Production persistence adapter. Every public method derives document paths
 * from the verified UID and allowlisted collection type; callers cannot pass
 * arbitrary Firestore paths or collection names.
 */
export class FirestoreRepository implements AuditableRepository {
  constructor(
    private readonly firestore: Firestore,
    private readonly verificationHooks: FirestoreRepositoryVerificationHooks = {},
  ) {}

  async listEntities(
    uid: string,
    collection: EntityCollection,
    request: ReadPageRequest,
  ): Promise<ReadPage<EntityRecord>> {
    assertUid(uid);
    if (request.limit < 1 || request.limit > 200) {
      throw new DomainError('LIMIT_EXCEEDED', 'Repository page limit must be between 1 and 200.');
    }

    const fingerprint = queryFingerprint(collection, request);
    let lastId = request.cursor ? decodeCursor(request.cursor, fingerprint) : null;
    let scanned = 0;
    let exhausted = false;
    const items: EntityRecord[] = [];
    const collectionRef = this.firestore.collection(`users/${uid}/${collection}`);

    while (items.length < request.limit && scanned < MAX_SCAN_PER_PAGE && !exhausted) {
      const remainingScan = MAX_SCAN_PER_PAGE - scanned;
      const batchSize = Math.min(SCAN_BATCH_SIZE, remainingScan);
      let query = collectionRef.orderBy(FieldPath.documentId()).limit(batchSize);
      if (lastId) query = query.startAfter(lastId);
      const snapshot = await query.get();
      exhausted = snapshot.size < batchSize;
      if (snapshot.empty) break;

      for (const document of snapshot.docs) {
        lastId = document.id;
        scanned += 1;
        const record = normalizeEntitySnapshot(uid, document);
        if (!isSoftDeleted(record) && matchesFilter(record, request)) items.push(record);
        if (items.length >= request.limit || scanned >= MAX_SCAN_PER_PAGE) break;
      }
    }

    return {
      items,
      nextCursor: exhausted || !lastId ? null : encodeCursor(fingerprint, lastId),
    };
  }

  async getEntity(
    uid: string,
    collection: EntityCollection,
    id: string,
  ): Promise<EntityRecord | null> {
    assertUid(uid);
    assertEntityId(id);
    const snapshot = await this.entityRef(uid, collection, id).get();
    if (!snapshot.exists) return null;
    const record = normalizeEntitySnapshot(uid, snapshot);
    return isSoftDeleted(record) ? null : record;
  }

  async getUserPlanningPreferences(uid: string): Promise<UserPlanningPreferences> {
    assertUid(uid);
    const snapshot = await this.firestore.doc(`users/${uid}`).get();
    return this.planningPreferencesFromData(
      uid,
      snapshot.exists ? decodeFirestore(snapshot.data() ?? {}) : null,
    );
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
    assertUid(uid);
    assertEntityId(planId);
    if (refs.length < 1 || refs.length > 400) {
      throw new DomainError('LIMIT_EXCEEDED', 'A snapshot must contain 1-400 entities.');
    }
    const references = refs.map(({ collection, id }) => this.entityRef(uid, collection, id));
    const documents = await this.firestore.getAll(...references);
    const entries = documents.map((document, index) => {
      const reference = refs[index];
      if (!reference) throw new DomainError('INTERNAL', 'Snapshot reference mismatch.');
      const record = document.exists ? normalizeEntitySnapshot(uid, document) : null;
      return {
        collection: reference.collection,
        id: reference.id,
        existed: Boolean(record),
        version: record?._version ?? null,
        contentHash: record ? hashEntityState(record) : null,
        value: record,
      };
    });
    const scopes: ValidationScopeSnapshot[] = [];
    for (const expectation of validation.scopes) {
      const records = await this.readValidationScope(uid, expectation);
      const stateHash = hashValidationScopeRecords(records);
      if (stateHash !== expectation.expectedStateHash) {
        throw new DomainError('STATE_CHANGED', 'Validation scope changed while creating the preview.');
      }
      scopes.push({
        collection: expectation.collection,
        field: expectation.field,
        value: expectation.value,
        from: expectation.from,
        to: expectation.to,
        maxItems: expectation.maxItems,
        stateHash,
        itemCount: records.length,
      });
    }
    const planningPreferencesHash = validation.planningPreferencesHash;
    if (
      planningPreferencesHash
      && hashPlanningPreferences(await this.getUserPlanningPreferences(uid)) !== planningPreferencesHash
    ) {
      throw new DomainError('STATE_CHANGED', 'Planning preferences changed while creating the preview.');
    }
    return { id: planId, uid, planId, createdAt, entries, scopes, planningPreferencesHash };
  }

  private planningPreferencesFromData(uid: string, data: unknown): UserPlanningPreferences {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return clone(PRODUCT_DEFAULT_PREFERENCES);
    }
    const record = data as Record<string, unknown>;
    assertEmbeddedOwnership(uid, record);
    const preferences = asRecord(record.preferences);
    if (!preferences) return clone(PRODUCT_DEFAULT_PREFERENCES);

    const defaultsApplied: string[] = [];
    const timezone = validTimeZone(preferences.timezone)
      ? preferences.timezone
      : usePreferenceDefault(
        'timezone',
        PRODUCT_DEFAULT_PREFERENCES.timezone,
        defaultsApplied,
      );
    const hours = asRecord(preferences.workingHours);
    let workingHours: UserPlanningPreferences['workingHours'];
    if (hours && validClock(hours.start) && validClock(hours.end) && hours.start < hours.end) {
      workingHours = { start: hours.start, end: hours.end };
    } else {
      workingHours = usePreferenceDefault(
        'workingHours',
        PRODUCT_DEFAULT_PREFERENCES.workingHours,
        defaultsApplied,
      );
    }
    const maxDailyPlannedMinutes = preferenceInteger(
      'maxDailyPlannedMinutes',
      preferences.maxDailyPlannedMinutes,
      60,
      24 * 60,
      PRODUCT_DEFAULT_PREFERENCES.maxDailyPlannedMinutes,
      defaultsApplied,
    );
    const maxWeeklyPlannedMinutes = preferenceInteger(
      'maxWeeklyPlannedMinutes',
      preferences.maxWeeklyPlannedMinutes,
      60,
      7 * 24 * 60,
      PRODUCT_DEFAULT_PREFERENCES.maxWeeklyPlannedMinutes,
      defaultsApplied,
    );
    const minBufferMinutes = preferenceInteger(
      'minBufferMinutes',
      preferences.minBufferMinutes,
      0,
      240,
      PRODUCT_DEFAULT_PREFERENCES.minBufferMinutes,
      defaultsApplied,
    );
    const maxConsecutiveHighEnergyBlocks = preferenceInteger(
      'maxConsecutiveHighEnergyBlocks',
      preferences.maxConsecutiveHighEnergyBlocks,
      1,
      24,
      PRODUCT_DEFAULT_PREFERENCES.maxConsecutiveHighEnergyBlocks,
      defaultsApplied,
    );
    return {
      source: defaultsApplied.length ? 'persisted_with_defaults' : 'persisted',
      defaultsApplied,
      timezone,
      workingHours,
      maxDailyPlannedMinutes,
      maxWeeklyPlannedMinutes,
      minBufferMinutes,
      maxConsecutiveHighEnergyBlocks,
    };
  }

  async savePreview(request: SavePreviewRequest): Promise<StoredChangePlan> {
    const { plan, snapshot, approval, audit } = request;
    assertPreviewRelationships(plan, snapshot, approval, audit);
    assertSnapshotIntegrity(snapshot);
    const planRef = this.firestore.doc(SERVER_ONLY_PATHS.changePlan(plan.uid, plan.id));
    const snapshotRef = this.firestore.doc(SERVER_ONLY_PATHS.snapshot(plan.uid, plan.id));
    const approvalRef = this.firestore.doc(SERVER_ONLY_PATHS.approval(plan.uid, plan.id));
    const auditRef = this.auditRef(audit);
    const stored: StoredChangePlan = { ...clone(plan), status: 'previewed' };

    await this.firestore.runTransaction(async (transaction) => {
      const existing = await transaction.getAll(planRef, snapshotRef, approvalRef, auditRef);
      if (existing.some((document) => document.exists)) {
        throw new DomainError('CONFLICT', 'Plan already exists.');
      }
      transaction.create(planRef, encodeServer(stored));
      transaction.create(snapshotRef, {
        ...encodeServer(snapshot),
        purgeAt: Timestamp.fromDate(new Date(plan.expiresAt)),
      });
      transaction.create(approvalRef, encodeServer(approval));
      transaction.create(auditRef, encodeServer(audit));
    });
    return clone(stored);
  }

  async getPlan(uid: string, planId: string): Promise<StoredChangePlan | null> {
    assertUid(uid);
    assertEntityId(planId);
    const snapshot = await this.firestore.doc(SERVER_ONLY_PATHS.changePlan(uid, planId)).get();
    return snapshot.exists ? decodeOwnedServerDocument<StoredChangePlan>(snapshot, uid) : null;
  }

  async applyPlanAtomically(request: ApplyPlanRequest): Promise<PlanActionResult> {
    assertUid(request.uid);
    assertEntityId(request.planId);
    assertEntityId(request.executionId);
    const transactionResult = await this.firestore.runTransaction(async (transaction): Promise<TransactionResult> => {
      const idempotencyRef = this.idempotencyRef(request.uid, 'apply', request.idempotencyKeyHash);
      const idempotencySnapshot = await transaction.get(idempotencyRef);
      if (idempotencySnapshot.exists) {
        return replayResult(
          idempotencySnapshot,
          request.uid,
          'apply',
          request.planId,
          request.approvalCapabilityHash,
        );
      }

      const planRef = this.firestore.doc(SERVER_ONLY_PATHS.changePlan(request.uid, request.planId));
      const snapshotRef = this.firestore.doc(SERVER_ONLY_PATHS.snapshot(request.uid, request.planId));
      const approvalRef = this.firestore.doc(SERVER_ONLY_PATHS.approval(request.uid, request.planId));
      const executionRef = this.firestore.doc(SERVER_ONLY_PATHS.execution(request.uid, request.executionId));
      const auditId = request.executionId;
      const auditRef = this.firestore.doc(`${SERVER_ONLY_PATHS.auditCollection}/${request.uid}_${auditId}`);
      const [planSnapshot, beforeSnapshot, approvalSnapshot, executionSnapshot, auditSnapshot] =
        await transaction.getAll(planRef, snapshotRef, approvalRef, executionRef, auditRef);
      if (!planSnapshot || !beforeSnapshot || !approvalSnapshot || !executionSnapshot || !auditSnapshot) {
        throw new DomainError('INTERNAL', 'Plan transaction read is incomplete.');
      }
      if (!planSnapshot.exists || !beforeSnapshot.exists || !approvalSnapshot.exists) {
        throw new DomainError('NOT_FOUND', 'Change plan not found.');
      }
      if (executionSnapshot.exists || auditSnapshot.exists) {
        throw new DomainError('CONFLICT', 'Execution identifier already exists.');
      }

      const plan = decodeOwnedServerDocument<StoredChangePlan>(planSnapshot, request.uid);
      const snapshot = decodeOwnedServerDocument<ChangeSnapshot>(beforeSnapshot, request.uid);
      const approval = decodeOwnedServerDocument<ApprovalRecord>(approvalSnapshot, request.uid);
      validateApply(request, plan, snapshot, approval);

      const snapshotEntityRefs = snapshot.entries.map(({ collection, id }) =>
        this.entityRef(request.uid, collection, id));
      const entitySnapshots = await transaction.getAll(...snapshotEntityRefs);
      const snapshotRecords = entitySnapshots.map((document) =>
        document.exists ? normalizeEntitySnapshot(request.uid, document) : null,
      );
      const scopeRecords: EntityRecord[][] = [];
      for (const scope of snapshot.scopes) {
        scopeRecords.push([...(await this.readValidationScope(request.uid, scope, transaction))]);
      }
      const preferencesSnapshot = snapshot.planningPreferencesHash
        ? await transaction.get(this.firestore.doc(`users/${request.uid}`))
        : null;
      assertSnapshotCurrent(snapshot, snapshotRecords);
      assertValidationScopesCurrent(snapshot, scopeRecords);
      if (snapshot.planningPreferencesHash) {
        const preferences = this.planningPreferencesFromData(
          request.uid,
          preferencesSnapshot?.exists ? decodeFirestore(preferencesSnapshot.data() ?? {}) : null,
        );
        if (hashPlanningPreferences(preferences) !== snapshot.planningPreferencesHash) {
          throw new DomainError('STATE_CHANGED', 'The preview is stale because planning preferences changed.');
        }
      }

      const currentByKey = new Map(snapshot.entries.map((entry, index) => [
        refKey(entry.collection, entry.id),
        snapshotRecords[index] ?? null,
      ]));
      const operationEntityRefs = plan.operations.map(({ collection, id }) =>
        this.entityRef(request.uid, collection, id));
      const operationKeys = new Set(plan.operations.map((operation) => refKey(operation.collection, operation.id)));
      const appliedDependencyStateHashes = Object.fromEntries(
        snapshot.entries
          .filter((entry) => !operationKeys.has(refKey(entry.collection, entry.id)))
          .map((entry) => {
            const current = currentByKey.get(refKey(entry.collection, entry.id)) ?? null;
            return [refKey(entry.collection, entry.id), current ? hashEntityState(current) : null];
          }),
      );

      const appliedVersions: Record<string, number | null> = {};
      const appliedStateHashes: Record<string, string | null> = {};
      const afterByKey = new Map<string, EntityRecord | null>();
      for (let index = 0; index < plan.operations.length; index += 1) {
        const operation = plan.operations[index];
        const entityRef = operationEntityRefs[index];
        const current = operation
          ? currentByKey.get(refKey(operation.collection, operation.id)) ?? null
          : null;
        if (!operation || !entityRef) throw new DomainError('INTERNAL', 'Plan operation mismatch.');
        const key = refKey(operation.collection, operation.id);
        if (operation.op === 'create') {
          if (current) throw new DomainError('STATE_CHANGED', 'The preview is stale.');
          const created = entityAfterCreate(
            request.uid,
            operation.collection,
            operation.id,
            operation.values,
            request.now,
          );
          transaction.create(entityRef, encodeEntity(created));
          appliedVersions[key] = created._version;
          appliedStateHashes[key] = hashEntityState(created);
          afterByKey.set(key, created);
        } else if (operation.op === 'update') {
          if (!current) throw new DomainError('STATE_CHANGED', 'The preview is stale.');
          const updated = entityAfterUpdate(
            request.uid,
            operation.collection,
            current,
            operation.values,
            request.now,
          );
          transaction.set(entityRef, encodeEntity(updated));
          appliedVersions[key] = updated._version;
          appliedStateHashes[key] = hashEntityState(updated);
          afterByKey.set(key, updated);
        } else {
          if (!current) throw new DomainError('STATE_CHANGED', 'The preview is stale.');
          transaction.delete(entityRef);
          appliedVersions[key] = null;
          appliedStateHashes[key] = null;
          afterByKey.set(key, null);
        }
      }

      const appliedScopeHashes = Object.fromEntries(snapshot.scopes.map((scope, index) => [
        validationScopeKey(scope),
        hashValidationScopeRecords(applyOperationsToScope(scopeRecords[index] ?? [], scope, afterByKey)),
      ]));

      const updatedPlan: StoredChangePlan = {
        ...plan,
        status: 'applied',
        appliedAt: request.now,
        appliedVersions,
        appliedStateHashes,
        appliedDependencyStateHashes,
        appliedScopeHashes,
      };
      const affected = plan.operations.map(({ collection, id }) => ({ collection, id }));
      const result: PlanActionResult = {
        executionId: request.executionId,
        planId: plan.id,
        hash: plan.hash,
        status: 'applied',
        idempotentReplay: false,
        verified: false,
        affected,
        receipt: {
          executionId: request.executionId,
          planId: plan.id,
          changesetHash: plan.hash,
          status: 'applied',
          verified: false,
          timestamp: request.now,
          affected,
          rollbackAvailable: true,
          rollbackExpiresAt: request.rollbackExpiresAt,
        },
      };
      const execution: StoredExecution = {
        id: request.executionId,
        uid: request.uid,
        planId: plan.id,
        requestId: request.requestId,
        applyAuditId: auditId,
        auditId,
        idempotencyKeyHash: request.idempotencyKeyHash,
        createdAt: request.now,
        status: 'applied',
        verified: false,
        rollbackCapabilityHash: request.rollbackCapabilityHash,
        rollbackExpiresAt: request.rollbackExpiresAt,
        result: withoutReplay(result),
      };
      const audit = actionAudit(
        updatedPlan,
        request.uid,
        request.requestId,
        auditId,
        'apply',
        request.now,
        false,
        appliedStateHashes,
        request.executionId,
        request.idempotencyKeyHash,
      );

      transaction.set(planRef, encodeServer(updatedPlan));
      transaction.update(snapshotRef, {
        purgeAt: Timestamp.fromDate(new Date(request.rollbackExpiresAt)),
      });
      transaction.set(approvalRef, encodeServer({
        ...approval,
        status: 'consumed',
        consumedAt: request.now,
        executionId: request.executionId,
      } satisfies ApprovalRecord));
      transaction.create(executionRef, encodeServer(execution));
      transaction.create(auditRef, encodeServer(audit));
      transaction.create(idempotencyRef, encodeServer({
        uid: request.uid,
        action: 'apply',
        resourceId: plan.id,
        executionId: request.executionId,
        createdAt: request.now,
        capabilityHash: request.approvalCapabilityHash,
        result: withoutRollback(result),
      }));
      return { result, replay: false };
    });

    return this.verifyAndMark(request.uid, transactionResult.result, transactionResult.replay, request.idempotencyKeyHash);
  }

  async rollbackExecutionAtomically(request: RollbackExecutionRequest): Promise<PlanActionResult> {
    assertUid(request.uid);
    assertEntityId(request.executionId);
    const transactionResult = await this.firestore.runTransaction(async (transaction): Promise<TransactionResult> => {
      const idempotencyRef = this.idempotencyRef(request.uid, 'rollback', request.idempotencyKeyHash);
      const idempotencySnapshot = await transaction.get(idempotencyRef);
      if (idempotencySnapshot.exists) {
        return replayResult(
          idempotencySnapshot,
          request.uid,
          'rollback',
          request.executionId,
          request.rollbackCapabilityHash,
        );
      }

      const executionRef = this.firestore.doc(SERVER_ONLY_PATHS.execution(request.uid, request.executionId));
      const executionSnapshot = await transaction.get(executionRef);
      if (!executionSnapshot.exists) throw new DomainError('NOT_FOUND', 'Execution not found.');
      const execution = decodeOwnedServerDocument<StoredExecution>(executionSnapshot, request.uid);
      validateRollback(request, execution);

      const planRef = this.firestore.doc(SERVER_ONLY_PATHS.changePlan(request.uid, execution.planId));
      const snapshotRef = this.firestore.doc(SERVER_ONLY_PATHS.snapshot(request.uid, execution.planId));
      const auditId = randomUUID();
      const auditRef = this.firestore.doc(`${SERVER_ONLY_PATHS.auditCollection}/${request.uid}_${auditId}`);
      const applyIdempotencyRef = this.idempotencyRef(
        request.uid,
        'apply',
        execution.idempotencyKeyHash,
      );
      const [planSnapshot, beforeSnapshot, auditSnapshot, applyIdempotencySnapshot] = await transaction.getAll(
        planRef,
        snapshotRef,
        auditRef,
        applyIdempotencyRef,
      );
      if (!planSnapshot || !beforeSnapshot || !auditSnapshot || !applyIdempotencySnapshot) {
        throw new DomainError('INTERNAL', 'Rollback transaction read is incomplete.');
      }
      if (!planSnapshot.exists || !beforeSnapshot.exists) throw new DomainError('NOT_FOUND', 'Execution not found.');
      if (!applyIdempotencySnapshot.exists) throw new DomainError('INTERNAL', 'Original apply receipt is unavailable.');
      if (auditSnapshot.exists) throw new DomainError('CONFLICT', 'Audit identifier already exists.');
      const plan = decodeOwnedServerDocument<StoredChangePlan>(planSnapshot, request.uid);
      const snapshot = decodeOwnedServerDocument<ChangeSnapshot>(beforeSnapshot, request.uid);
      assertSnapshotIntegrity(snapshot);
      verifyStoredPlan(plan);
      if (plan.status !== 'applied' || !plan.appliedStateHashes) {
        throw new DomainError('APPROVAL_REPLAYED', 'Execution was already actioned.');
      }

      const snapshotEntityRefs = snapshot.entries.map(({ collection, id }) =>
        this.entityRef(request.uid, collection, id));
      const entitySnapshots = await transaction.getAll(...snapshotEntityRefs);
      const snapshotRecords = entitySnapshots.map((document) =>
        document.exists ? normalizeEntitySnapshot(request.uid, document) : null,
      );
      const scopeRecords: EntityRecord[][] = [];
      for (const scope of snapshot.scopes) {
        scopeRecords.push([...(await this.readValidationScope(request.uid, scope, transaction))]);
      }
      const preferencesSnapshot = snapshot.planningPreferencesHash
        ? await transaction.get(this.firestore.doc(`users/${request.uid}`))
        : null;
      const currentByKey = new Map(snapshot.entries.map((entry, index) => [
        refKey(entry.collection, entry.id),
        snapshotRecords[index] ?? null,
      ]));
      const operationRecords = plan.operations.map((operation) =>
        currentByKey.get(refKey(operation.collection, operation.id)) ?? null);
      assertAppliedStateCurrent(plan, operationRecords);
      assertAppliedDependenciesCurrent(plan, snapshot, currentByKey);
      assertAppliedScopesCurrent(plan, snapshot, scopeRecords);
      if (snapshot.planningPreferencesHash) {
        const preferences = this.planningPreferencesFromData(
          request.uid,
          preferencesSnapshot?.exists ? decodeFirestore(preferencesSnapshot.data() ?? {}) : null,
        );
        if (hashPlanningPreferences(preferences) !== snapshot.planningPreferencesHash) {
          throw new DomainError('STATE_CHANGED', 'Rollback refused because planning preferences changed after apply.');
        }
      }

      const restoredStateHashes: Record<string, string | null> = {};
      const entryByKey = new Map(snapshot.entries.map((entry) => [refKey(entry.collection, entry.id), entry]));
      for (let index = 0; index < plan.operations.length; index += 1) {
        const operation = plan.operations[index];
        if (!operation) throw new DomainError('INTERNAL', 'Rollback operation mismatch.');
        const entry = entryByKey.get(refKey(operation.collection, operation.id));
        const entityRef = this.entityRef(request.uid, operation.collection, operation.id);
        const current = operationRecords[index] ?? null;
        if (!entry || !entityRef) throw new DomainError('INTERNAL', 'Rollback snapshot mismatch.');
        const key = refKey(entry.collection, entry.id);
        if (!entry.existed) {
          transaction.delete(entityRef);
          restoredStateHashes[key] = null;
        } else if (entry.value) {
          const restored: EntityRecord = {
            ...clone(entry.value),
            id: entry.id,
            userId: request.uid,
            _version: (current?._version ?? entry.version ?? 0) + 1,
            updatedAt: request.now,
          };
          transaction.set(entityRef, encodeEntity(restored));
          restoredStateHashes[key] = hashEntityState(restored);
        } else {
          throw new DomainError('INTERNAL', 'Rollback snapshot is incomplete.');
        }
      }

      const updatedPlan: StoredChangePlan = {
        ...plan,
        status: 'rolled_back',
        rolledBackAt: request.now,
      };
      const affected = plan.operations.map(({ collection, id }) => ({ collection, id }));
      const result: PlanActionResult = {
        executionId: execution.id,
        planId: plan.id,
        hash: plan.hash,
        status: 'rolled_back',
        idempotentReplay: false,
        verified: false,
        affected,
        receipt: {
          executionId: execution.id,
          planId: plan.id,
          changesetHash: plan.hash,
          status: 'rolled_back',
          verified: false,
          timestamp: request.now,
          affected,
          rollbackAvailable: false,
          rollbackExpiresAt: null,
        },
      };
      const updatedExecution: StoredExecution = {
        ...execution,
        applyAuditId: execution.applyAuditId ?? execution.auditId,
        auditId,
        rollbackAuditId: auditId,
        status: 'rolled_back',
        verified: false,
        rollbackConsumedAt: request.now,
        restoredStateHashes,
        result: withoutReplay(result),
      };
      const audit = actionAudit(
        updatedPlan,
        request.uid,
        request.requestId,
        auditId,
        'rollback',
        request.now,
        false,
        restoredStateHashes,
        execution.id,
        request.idempotencyKeyHash,
      );

      transaction.set(planRef, encodeServer(updatedPlan));
      transaction.update(snapshotRef, {
        purgeAt: Timestamp.fromDate(new Date(request.now)),
      });
      transaction.set(executionRef, encodeServer(updatedExecution));
      transaction.create(auditRef, encodeServer(audit));
      transaction.create(idempotencyRef, encodeServer({
        uid: request.uid,
        action: 'rollback',
        resourceId: request.executionId,
        executionId: request.executionId,
        createdAt: request.now,
        capabilityHash: request.rollbackCapabilityHash,
        result: withoutRollback(result),
      }));
      transaction.update(applyIdempotencyRef, {
        result: encodeServer(withoutRollback(result)),
      });
      return { result, replay: false };
    });

    return this.verifyAndMark(request.uid, transactionResult.result, transactionResult.replay, request.idempotencyKeyHash);
  }

  async getExecution(uid: string, executionId: string): Promise<StoredExecution | null> {
    assertUid(uid);
    assertEntityId(executionId);
    const snapshot = await this.firestore.doc(SERVER_ONLY_PATHS.execution(uid, executionId)).get();
    return snapshot.exists ? decodeOwnedServerDocument<StoredExecution>(snapshot, uid) : null;
  }

  async recordAudit(event: AuditEvent): Promise<void> {
    assertUid(event.uid);
    if (event.uid !== event.actorUid) throw new DomainError('FORBIDDEN', 'Audit actor mismatch.');
    await this.auditRef(event).create(encodeServer(event));
  }

  async listAuditEventsForUser(uid: string): Promise<readonly AuditEvent[]> {
    assertUid(uid);
    const snapshot = await this.firestore
      .collection(SERVER_ONLY_PATHS.auditCollection)
      .where('uid', '==', uid)
      .limit(MAX_AUDIT_RESULTS)
      .get();
    return snapshot.docs
      .map((document) => decodeOwnedServerDocument<AuditEvent>(document, uid))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  private async verifyAndMark(
    uid: string,
    result: PlanActionResult,
    replay: boolean,
    idempotencyKeyHash: string,
  ): Promise<PlanActionResult> {
    if (result.verified) return { ...result, idempotentReplay: replay || result.idempotentReplay };
    try {
      await this.verificationHooks.beforeVerification?.(result.status, result.executionId);
      const execution = await this.getExecution(uid, result.executionId);
      if (!execution) {
        throw new DomainError('COMMITTED_UNVERIFIED', 'Execution verification record is unavailable.');
      }
      const expected = result.status === 'applied'
        ? (await this.getPlan(execution.uid, execution.planId))?.appliedStateHashes
        : execution.restoredStateHashes;
      if (!expected) {
        throw new DomainError('COMMITTED_UNVERIFIED', 'Committed state is missing verification metadata.');
      }
      await this.verifyExpectedHashes(execution.uid, expected);
      const verified: PlanActionResult = {
        ...result,
        idempotentReplay: replay || result.idempotentReplay,
        verified: true,
        receipt: { ...result.receipt, verified: true },
      };
      const executionRef = this.firestore.doc(SERVER_ONLY_PATHS.execution(execution.uid, execution.id));
      const idempotencyRef = this.idempotencyRef(
        execution.uid,
        result.status === 'applied' ? 'apply' : 'rollback',
        idempotencyKeyHash,
      );
      const auditRef = this.firestore.doc(`${SERVER_ONLY_PATHS.auditCollection}/${execution.uid}_${execution.auditId}`);
      const batch = this.firestore.batch();
      batch.update(executionRef, {
        verified: true,
        result: encodeServer(withoutReplay(verified)),
      });
      batch.update(idempotencyRef, { result: encodeServer(withoutRollback(verified)) });
      if (result.status === 'rolled_back') {
        const originalApplyRef = this.idempotencyRef(
          execution.uid,
          'apply',
          execution.idempotencyKeyHash,
        );
        batch.update(originalApplyRef, { result: encodeServer(withoutRollback(verified)) });
      }
      batch.update(auditRef, { 'metadata.verified': true });
      await batch.commit();
      return verified;
    } catch (error) {
      if (error instanceof DomainError && error.code === 'COMMITTED_UNVERIFIED') throw error;
      throw new DomainError('COMMITTED_UNVERIFIED', 'The committed change could not be verified yet.');
    }
  }

  private async verifyExpectedHashes(
    uid: string,
    expected: Readonly<Record<string, string | null>>,
  ): Promise<void> {
    const entries = Object.entries(expected);
    const references = entries.map(([key]) => {
      const [collection, id, extra] = key.split('/');
      if (extra || !collection || !id) throw new DomainError('COMMITTED_UNVERIFIED', 'Invalid verification reference.');
      return this.entityRef(uid, collection as EntityCollection, id);
    });
    const documents = await this.firestore.getAll(...references);
    for (let index = 0; index < entries.length; index += 1) {
      const expectedHash = entries[index]?.[1];
      const document = documents[index];
      if (!document) throw new DomainError('COMMITTED_UNVERIFIED', 'Verification read is incomplete.');
      const actualHash = document.exists
        ? hashEntityState(normalizeEntitySnapshot(uid, document))
        : null;
      if (actualHash !== expectedHash) {
        throw new DomainError('COMMITTED_UNVERIFIED', 'Committed state changed before verification.');
      }
    }
  }

  private async readValidationScope(
    uid: string,
    scope: ValidationScopeQuery,
    transaction?: Transaction,
  ): Promise<readonly EntityRecord[]> {
    assertUid(uid);
    if (!Number.isInteger(scope.maxItems) || scope.maxItems < 1 || scope.maxItems > 2_000) {
      throw new DomainError('LIMIT_EXCEEDED', 'Validation scope bound is invalid.');
    }
    let query: Query<DocumentData> = this.firestore.collection(`users/${uid}/${scope.collection}`);
    if (scope.field) {
      if (!scope.value) throw new DomainError('INVALID_ARGUMENT', 'Validation scope value is missing.');
      assertEntityId(scope.value);
      query = query.where(scope.field, '==', scope.value);
    } else if (scope.value) {
      throw new DomainError('INVALID_ARGUMENT', 'Validation scope field is missing.');
    }
    if (scope.from || scope.to) {
      if (!scope.from || !scope.to || Date.parse(scope.from) >= Date.parse(scope.to)) {
        throw new DomainError('INVALID_ARGUMENT', 'Validation scope interval is invalid.');
      }
      query = query
        .where('startTime', '<', Timestamp.fromDate(new Date(scope.to)))
        .where('endTime', '>', Timestamp.fromDate(new Date(scope.from)));
    }
    query = query.limit(scope.maxItems + 1);
    const snapshot = transaction ? await transaction.get(query) : await query.get();
    if (snapshot.size > scope.maxItems) {
      throw new DomainError('LIMIT_EXCEEDED', 'Validation scope exceeds its safe bound.');
    }
    return snapshot.docs
      .map((document) => normalizeEntitySnapshot(uid, document))
      .filter((record) => !isSoftDeleted(record) && matchesValidationScope(record, scope))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private entityRef(
    uid: string,
    collection: EntityCollection,
    id: string,
  ): DocumentReference<DocumentData> {
    assertUid(uid);
    assertEntityId(id);
    return this.firestore.doc(SERVER_ONLY_PATHS.entity(uid, collection, id));
  }

  private auditRef(event: AuditEvent): DocumentReference<DocumentData> {
    assertEntityId(event.id);
    return this.firestore.doc(`${SERVER_ONLY_PATHS.auditCollection}/${event.uid}_${event.id}`);
  }

  private idempotencyRef(
    uid: string,
    action: 'apply' | 'rollback',
    keyHash: string,
  ): DocumentReference<DocumentData> {
    if (!/^[a-f0-9]{64}$/.test(keyHash)) throw new DomainError('INVALID_ARGUMENT', 'Invalid idempotency key.');
    return this.firestore.doc(SERVER_ONLY_PATHS.idempotency(uid, `${action}_${keyHash}`));
  }
}

function assertPreviewRelationships(
  plan: StoredChangePlan | SavePreviewRequest['plan'],
  snapshot: ChangeSnapshot,
  approval: ApprovalRecord,
  audit: AuditEvent,
): void {
  assertUid(plan.uid);
  if (
    plan.uid !== snapshot.uid ||
    plan.uid !== approval.uid ||
    plan.uid !== audit.uid ||
    plan.uid !== audit.actorUid ||
    plan.id !== snapshot.planId ||
    plan.id !== approval.planId ||
    plan.id !== audit.planId ||
    plan.hash !== approval.planHash ||
    plan.baseStateHash !== approval.baseStateHash ||
    plan.baseStateHash !== hashSnapshotState(snapshot)
  ) {
    throw new DomainError('FORBIDDEN', 'Preview ownership or integrity mismatch.');
  }
}

function validateApply(
  request: ApplyPlanRequest,
  plan: StoredChangePlan,
  snapshot: ChangeSnapshot,
  approval: ApprovalRecord,
): void {
  verifyStoredPlan(plan);
  assertSnapshotIntegrity(snapshot);
  assertPreviewRelationships(plan, snapshot, approval, {
    id: 'validation-only',
    uid: request.uid,
    actorUid: request.uid,
    requestId: request.requestId,
    planId: plan.id,
    tool: plan.tool,
    action: 'preview',
    outcome: 'success',
    timestamp: request.now,
    entityRefs: [],
    metadata: {},
  });
  if (plan.status !== 'previewed' || approval.status === 'consumed') {
    throw new DomainError('APPROVAL_REPLAYED', 'Approval was already consumed.');
  }
  if (Date.parse(plan.expiresAt) <= Date.parse(request.now) || Date.parse(approval.expiresAt) <= Date.parse(request.now)) {
    throw new DomainError('EXPIRED', 'Approval expired.');
  }
  if (plan.conflicts.length) throw new DomainError('CONFLICT', 'Plan has unresolved conflicts.');
  if (!capabilityHashMatches(request.approvalCapabilityHash, approval.capabilityHash)) {
    throw new DomainError('APPROVAL_REQUIRED', 'Approval does not match this plan.');
  }
}

function assertSnapshotIntegrity(snapshot: ChangeSnapshot): void {
  for (const entry of snapshot.entries) {
    if (!entry.existed) {
      if (entry.value !== null || entry.version !== null || entry.contentHash !== null) {
        throw new DomainError('CONFLICT', 'Change snapshot integrity check failed.');
      }
      continue;
    }
    if (
      !entry.value
      || entry.value.id !== entry.id
      || entry.value.userId !== snapshot.uid
      || entry.value._version !== entry.version
      || hashEntityState(entry.value) !== entry.contentHash
    ) {
      throw new DomainError('CONFLICT', 'Change snapshot integrity check failed.');
    }
  }
}

function validateRollback(request: RollbackExecutionRequest, execution: StoredExecution): void {
  if (execution.status !== 'applied' || execution.rollbackConsumedAt) {
    throw new DomainError('APPROVAL_REPLAYED', 'Rollback capability was already consumed.');
  }
  if (Date.parse(execution.rollbackExpiresAt) <= Date.parse(request.now)) {
    throw new DomainError('EXPIRED', 'Rollback capability expired.');
  }
  if (!capabilityHashMatches(request.rollbackCapabilityHash, execution.rollbackCapabilityHash)) {
    throw new DomainError('APPROVAL_REQUIRED', 'Rollback capability is invalid.');
  }
}

function assertSnapshotCurrent(
  snapshot: ChangeSnapshot,
  currentRecords: readonly (EntityRecord | null)[],
): void {
  for (let index = 0; index < snapshot.entries.length; index += 1) {
    const entry = snapshot.entries[index];
    if (!entry) throw new DomainError('INTERNAL', 'Snapshot entry mismatch.');
    const current = currentRecords[index] ?? null;
    if (
      !entry ||
      entry.existed !== Boolean(current) ||
      entry.version !== (current?._version ?? null) ||
      entry.contentHash !== (current ? hashEntityState(current) : null)
    ) {
      throw new DomainError('STATE_CHANGED', 'The preview is stale.');
    }
  }
}

function assertValidationScopesCurrent(
  snapshot: ChangeSnapshot,
  scopeRecords: readonly (readonly EntityRecord[])[],
): void {
  for (let index = 0; index < snapshot.scopes.length; index += 1) {
    const scope = snapshot.scopes[index];
    const records = scopeRecords[index];
    if (
      !scope
      || !records
      || records.length !== scope.itemCount
      || hashValidationScopeRecords(records) !== scope.stateHash
    ) {
      throw new DomainError('STATE_CHANGED', 'The preview is stale because its validation scope changed.');
    }
  }
}

function assertAppliedStateCurrent(
  plan: StoredChangePlan,
  currentRecords: readonly (EntityRecord | null)[],
): void {
  for (let index = 0; index < plan.operations.length; index += 1) {
    const operation = plan.operations[index];
    if (!operation) throw new DomainError('INTERNAL', 'Plan operation mismatch.');
    const current = currentRecords[index] ?? null;
    const key = refKey(operation.collection, operation.id);
    if (
      plan.appliedVersions?.[key] !== (current?._version ?? null) ||
      plan.appliedStateHashes?.[key] !== (current ? hashEntityState(current) : null)
    ) {
      throw new DomainError('STATE_CHANGED', 'Rollback refused because state changed after apply.');
    }
  }
}

function assertAppliedDependenciesCurrent(
  plan: StoredChangePlan,
  snapshot: ChangeSnapshot,
  currentByKey: ReadonlyMap<string, EntityRecord | null>,
): void {
  const operationKeys = new Set(plan.operations.map((operation) => refKey(operation.collection, operation.id)));
  for (const entry of snapshot.entries) {
    const key = refKey(entry.collection, entry.id);
    if (operationKeys.has(key)) continue;
    const current = currentByKey.get(key) ?? null;
    if ((current ? hashEntityState(current) : null) !== plan.appliedDependencyStateHashes?.[key]) {
      throw new DomainError('STATE_CHANGED', 'Rollback refused because referenced state changed after apply.');
    }
  }
}

function assertAppliedScopesCurrent(
  plan: StoredChangePlan,
  snapshot: ChangeSnapshot,
  scopeRecords: readonly (readonly EntityRecord[])[],
): void {
  for (let index = 0; index < snapshot.scopes.length; index += 1) {
    const scope = snapshot.scopes[index];
    const records = scopeRecords[index];
    if (
      !scope
      || !records
      || hashValidationScopeRecords(records) !== plan.appliedScopeHashes?.[validationScopeKey(scope)]
    ) {
      throw new DomainError('STATE_CHANGED', 'Rollback refused because dependent state changed after apply.');
    }
  }
}

function applyOperationsToScope(
  before: readonly EntityRecord[],
  scope: ValidationScopeQuery,
  afterByKey: ReadonlyMap<string, EntityRecord | null>,
): readonly EntityRecord[] {
  const records = new Map(before.map((record) => [record.id, record]));
  for (const [key, after] of afterByKey) {
    const separator = key.indexOf('/');
    const collection = key.slice(0, separator);
    const id = key.slice(separator + 1);
    if (collection !== scope.collection || !id) continue;
    records.delete(id);
    if (after && !isSoftDeleted(after) && matchesValidationScope(after, scope)) records.set(id, after);
  }
  const output = [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (output.length > scope.maxItems) {
    throw new DomainError('LIMIT_EXCEEDED', 'Applied validation scope exceeds its safe bound.');
  }
  return output;
}

function replayResult(
  snapshot: DocumentSnapshot,
  uid: string,
  action: 'apply' | 'rollback',
  resourceId: string,
  capabilityHash: string,
): TransactionResult {
  const data = decodeOwnedServerDocument<Record<string, unknown>>(snapshot, uid);
  if (data.action !== action || data.resourceId !== resourceId) {
    throw new DomainError('CONFLICT', 'Idempotency key was already used for another operation.');
  }
  if (typeof data.capabilityHash !== 'string'
    || !capabilityHashMatches(capabilityHash, data.capabilityHash)) {
    throw new DomainError('APPROVAL_REQUIRED', 'Idempotent replay capability is invalid.');
  }
  const result = asRecord(data.result);
  if (!result) throw new DomainError('INTERNAL', 'Idempotency receipt is invalid.');
  return {
    result: { ...(result as unknown as PlanActionResult), idempotentReplay: true },
    replay: true,
  };
}

function actionAudit(
  plan: StoredChangePlan,
  uid: string,
  requestId: string,
  id: string,
  action: 'apply' | 'rollback',
  timestamp: string,
  verified: boolean,
  resultStateHashes: Readonly<Record<string, string | null>>,
  executionId: string,
  idempotencyKeyHash: string,
): AuditEvent {
  return {
    id,
    uid,
    actorUid: uid,
    requestId,
    planId: plan.id,
    tool: plan.tool,
    action,
    outcome: 'success',
    timestamp,
    entityRefs: plan.operations.map(({ collection, id: entityId }) => ({ collection, id: entityId })),
    metadata: {
      operationCount: plan.operations.length,
      changesetHash: plan.hash,
      baseStateHash: plan.baseStateHash,
      resultStateHash: hashResultState(resultStateHashes),
      executionId,
      idempotencyKeyHash,
      rollbackStatus: action === 'apply' ? 'available' : 'consumed',
      verified,
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

function normalizeEntitySnapshot(uid: string, snapshot: DocumentSnapshot): EntityRecord {
  const decoded = decodeFirestore(snapshot.data() ?? {});
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new DomainError('INTERNAL', 'Entity data is invalid.');
  }
  const data = decoded as Record<string, unknown>;
  assertEmbeddedOwnership(uid, data);
  if (data.id !== undefined && data.id !== snapshot.id) {
    throw new DomainError('FORBIDDEN', 'Entity identity is inconsistent.');
  }
  const version = typeof data._version === 'number' && Number.isInteger(data._version) && data._version >= 0
    ? data._version
    : 0;
  return {
    ...data,
    id: snapshot.id,
    userId: uid,
    _version: version,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : EPOCH,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : EPOCH,
  } as EntityRecord;
}

function decodeOwnedServerDocument<T>(snapshot: DocumentSnapshot, uid: string): T {
  const decoded = decodeFirestore(snapshot.data() ?? {});
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new DomainError('INTERNAL', 'Server record is invalid.');
  }
  const record = decoded as Record<string, unknown>;
  if (record.uid !== uid) throw new DomainError('FORBIDDEN', 'Resource is unavailable.');
  return clone(record) as T;
}

function assertEmbeddedOwnership(uid: string, data: Record<string, unknown>): void {
  for (const field of ['userId', 'uid', 'ownerId', 'ownerUid'] as const) {
    const owner = data[field];
    if (owner !== undefined && owner !== uid) {
      throw new DomainError('FORBIDDEN', 'Resource is unavailable.');
    }
  }
}

function encodeEntity(value: EntityRecord): DocumentData {
  return encodeEntityValue(value) as DocumentData;
}

function encodeEntityValue(value: unknown, key?: string): unknown {
  if (typeof value === 'string' && key && ENTITY_DATE_FIELDS.has(key) && isIsoInstant(value)) {
    return Timestamp.fromDate(new Date(value));
  }
  if (Array.isArray(value)) return value.map((item) => encodeEntityValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([entryKey, item]) => [entryKey, encodeEntityValue(item, entryKey)]),
    );
  }
  return value;
}

function encodeServer(value: unknown): DocumentData {
  return stripUndefined(clone(value)) as DocumentData;
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)]),
    );
  }
  return value;
}

function decodeFirestore(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(decodeFirestore);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, decodeFirestore(item)]),
    );
  }
  return value;
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
    : recordTimestamp(record);
  const end = typeof record.endTime === 'string' ? Date.parse(record.endTime) : Number.NaN;
  if (Number.isFinite(start) && Number.isFinite(end) && start < end) {
    // TimeBlocks and Sessions are half-open intervals. Select every record
    // that overlaps [from,to), including one that started before the range.
    if (filter.from && end <= Date.parse(filter.from)) return false;
    if (filter.to && start >= Date.parse(filter.to)) return false;
  } else {
    // Point-in-time records (for example HabitLogs) include the lower bound.
    if (filter.from && start < Date.parse(filter.from)) return false;
    if (filter.to && start >= Date.parse(filter.to)) return false;
  }
  return true;
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

function isSoftDeleted(record: EntityRecord): boolean {
  return record.deleted === true;
}

function recordTimestamp(record: EntityRecord): number {
  for (const field of ['startTime', 'date', 'updatedAt', 'createdAt'] as const) {
    if (typeof record[field] === 'string') {
      const parsed = Date.parse(record[field]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function queryFingerprint(collection: EntityCollection, request: ReadPageRequest): string {
  return Buffer.from(JSON.stringify([collection, request.filter])).toString('base64url');
}

function encodeCursor(fingerprint: string, lastId: string): string {
  return Buffer.from(JSON.stringify({ fingerprint, lastId })).toString('base64url');
}

function decodeCursor(cursor: string, fingerprint: string): string {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    const record = asRecord(decoded);
    if (!record || record.fingerprint !== fingerprint || typeof record.lastId !== 'string') throw new Error('invalid');
    assertEntityId(record.lastId);
    return record.lastId;
  } catch {
    throw new DomainError('INVALID_ARGUMENT', 'Invalid or stale pagination cursor.');
  }
}

function withoutReplay(
  result: PlanActionResult,
): Omit<PlanActionResult, 'idempotentReplay' | 'rollback'> {
  const { idempotentReplay: _replay, rollback: _rollback, ...stored } = result;
  return clone(stored);
}

function withoutRollback(result: PlanActionResult): Omit<PlanActionResult, 'rollback'> {
  const { rollback: _rollback, ...stored } = result;
  return clone(stored);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function assertUid(uid: string): void {
  if (!UID_PATTERN.test(uid)) throw new DomainError('UNAUTHENTICATED', 'Verified Firebase identity is invalid.');
}

function validTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function validClock(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function usePreferenceDefault<T>(field: string, fallback: T, defaultsApplied: string[]): T {
  defaultsApplied.push(field);
  return fallback;
}

function preferenceInteger(
  field: string,
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  defaultsApplied: string[],
): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : usePreferenceDefault(field, fallback, defaultsApplied);
}

function isIsoInstant(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function refKey(collection: EntityCollection, id: string): string {
  return `${collection}/${id}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
