import type {
  LifePlanDiffEntry,
  LifePlanPreview,
} from '@life-tracker/ai-contract';

export const ENTITY_COLLECTIONS = [
  'goals',
  'keyResults',
  'projects',
  'tasks',
  'timeBlocks',
  'habits',
  'habitLogs',
  'sessions',
  'notes',
  'goalRoadmaps',
  'domains',
] as const;

export type EntityCollection = (typeof ENTITY_COLLECTIONS)[number];
export type WritableEntityCollection = Exclude<
  EntityCollection,
  'sessions' | 'habitLogs' | 'goalRoadmaps'
>;

export interface AiOrchestrationMetadata {
  readonly model: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
}

export interface AuthContext {
  /** Always derived from a verified Firebase ID token by the transport. */
  readonly uid: string;
  readonly requestId: string;
  /** Added only inside the server-side Responses tool loop. */
  readonly orchestration?: AiOrchestrationMetadata;
}

export interface EntityRecord {
  readonly id: string;
  readonly _version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly [key: string]: unknown;
}

/** Must be denied for all direct client writes by Firestore Rules. */
export const SERVER_VERSION_FIELD = '_version' as const;

export interface ReadFilter {
  readonly query: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly status: string | null;
  readonly domainId: string | null;
  readonly projectId: string | null;
  readonly goalId: string | null;
  readonly taskId: string | null;
}

export interface ReadPageRequest {
  readonly filter: ReadFilter;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface ReadPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export type ScalarPatchValue = string | number | boolean | null | readonly string[];
export type WriteValue =
  | string
  | number
  | boolean
  | null
  | readonly WriteValue[]
  | Readonly<{ [key: string]: WriteValue }>;

export interface PublicPatch {
  readonly field: string;
  readonly value: ScalarPatchValue;
}

export interface PublicChangeOperation {
  readonly op: 'create' | 'update' | 'delete';
  readonly collection: WritableEntityCollection;
  readonly id: string;
  readonly patch: readonly PublicPatch[];
}

export interface ChangeOperation {
  readonly op: 'create' | 'update' | 'delete';
  readonly collection: WritableEntityCollection;
  readonly id: string;
  readonly values: Readonly<Record<string, WriteValue>>;
}

export interface EntityReference {
  readonly collection: EntityCollection;
  readonly id: string;
}

export interface SnapshotEntry extends EntityReference {
  readonly existed: boolean;
  readonly version: number | null;
  /** Canonical SHA-256 over the complete server-side document. */
  readonly contentHash: string | null;
  readonly value: EntityRecord | null;
}

export interface ChangeSnapshot {
  readonly id: string;
  readonly uid: string;
  readonly planId: string;
  readonly createdAt: string;
  readonly entries: readonly SnapshotEntry[];
}

export interface UserPlanningPreferences {
  readonly source: 'persisted' | 'persisted_with_defaults' | 'product_default';
  /** Exact fields for which the documented product default was used. */
  readonly defaultsApplied: readonly string[];
  readonly timezone: string;
  readonly workingHours: Readonly<{
    readonly start: string;
    readonly end: string;
  }> | null;
  readonly maxDailyPlannedMinutes: number;
  readonly maxWeeklyPlannedMinutes: number;
  readonly minBufferMinutes: number;
  readonly maxConsecutiveHighEnergyBlocks: number;
}

export interface ChangeDiff {
  readonly collection: EntityCollection;
  readonly id: string;
  readonly op: ChangeOperation['op'];
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
}

export interface ImmutableChangePlan {
  readonly id: string;
  readonly uid: string;
  readonly requestId: string;
  readonly tool: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly snapshotId: string;
  readonly baseStateHash: string;
  /** Safe configuration metadata; never contains prompts, tokens, or content. */
  readonly orchestration: AiOrchestrationMetadata | null;
  readonly operations: readonly ChangeOperation[];
  readonly diff: readonly ChangeDiff[];
  readonly reason: string;
  readonly warnings: readonly string[];
  readonly conflicts: readonly string[];
  readonly assumptions: readonly string[];
  readonly expectedImpact: readonly string[];
  readonly destructiveOperationCount: number;
  readonly hash: string;
}

export type PlanStatus = 'previewed' | 'applied' | 'rolled_back';

export interface StoredChangePlan extends ImmutableChangePlan {
  readonly status: PlanStatus;
  readonly appliedAt?: string;
  readonly rolledBackAt?: string;
  /** Version after apply; null means the entity was deleted. */
  readonly appliedVersions?: Readonly<Record<string, number | null>>;
  readonly appliedStateHashes?: Readonly<Record<string, string | null>>;
}

/** Canonical browser-safe contract owned by packages/ai-contract. */
export type PublicChangeDiff = LifePlanDiffEntry;
/** Canonical browser-safe contract owned by packages/ai-contract. */
export type PublicChangePlan = LifePlanPreview;

export interface ApprovalRecord {
  readonly uid: string;
  readonly planId: string;
  readonly planHash: string;
  readonly baseStateHash: string;
  readonly capabilityHash: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: 'pending' | 'consumed';
  readonly consumedAt?: string;
  readonly executionId?: string;
}

export interface ExecutionReceipt {
  readonly executionId: string;
  readonly planId: string;
  readonly changesetHash: string;
  readonly status: 'applied' | 'rolled_back';
  readonly verified: boolean;
  readonly timestamp: string;
  readonly affected: readonly EntityReference[];
  readonly rollbackAvailable: boolean;
  readonly rollbackExpiresAt: string | null;
}

export interface PlanActionResult {
  readonly executionId: string;
  readonly planId: string;
  readonly hash: string;
  readonly status: 'applied' | 'rolled_back';
  readonly idempotentReplay: boolean;
  readonly verified: boolean;
  readonly affected: readonly EntityReference[];
  readonly receipt: ExecutionReceipt;
  readonly rollback?: Readonly<{
    readonly capability: string;
    readonly expiresAt: string;
  }>;
}

export interface StoredExecution {
  readonly id: string;
  readonly uid: string;
  readonly planId: string;
  readonly requestId: string;
  readonly auditId: string;
  readonly idempotencyKeyHash: string;
  readonly createdAt: string;
  readonly status: 'applied' | 'rolled_back';
  readonly verified: boolean;
  readonly rollbackCapabilityHash: string;
  readonly rollbackExpiresAt: string;
  readonly rollbackConsumedAt?: string;
  readonly restoredStateHashes?: Readonly<Record<string, string | null>>;
  readonly result: Omit<PlanActionResult, 'idempotentReplay' | 'rollback'>;
}

export interface AuditEvent {
  readonly id: string;
  readonly uid: string;
  readonly actorUid: string;
  readonly requestId: string;
  readonly planId: string;
  readonly tool: string;
  readonly action: 'preview' | 'apply' | 'rollback';
  readonly outcome: 'success' | 'rejected' | 'conflict';
  readonly timestamp: string;
  readonly entityRefs: readonly EntityReference[];
  /** Codes/counts only: never prompts, secrets, full entity content, or tokens. */
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export const SERVER_ONLY_PATHS = Object.freeze({
  changePlan: (uid: string, planId: string) => `aiChangePlans/${uid}_${planId}`,
  snapshot: (uid: string, planId: string) => `aiSnapshots/${uid}_${planId}`,
  approval: (uid: string, planId: string) => `aiApprovals/${uid}_${planId}`,
  execution: (uid: string, executionId: string) => `aiExecutions/${uid}_${executionId}`,
  auditCollection: 'aiAuditLogs',
  idempotency: (uid: string, keyHash: string) => `aiIdempotency/${uid}_${keyHash}`,
  rateLimit: (uid: string) => `aiRateLimits/${uid}`,
  entity: (uid: string, collection: EntityCollection, id: string) =>
    `users/${uid}/${collection}/${id}`,
});
