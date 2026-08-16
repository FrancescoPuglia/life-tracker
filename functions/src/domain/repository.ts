import type {
  AuditEvent,
  ChangeSnapshot,
  EntityCollection,
  EntityRecord,
  EntityReference,
  ImmutableChangePlan,
  PlanActionResult,
  ReadPage,
  ReadPageRequest,
  StoredChangePlan,
} from './types';

export interface SavePreviewRequest {
  readonly plan: ImmutableChangePlan;
  readonly snapshot: ChangeSnapshot;
  readonly audit: AuditEvent;
}

export interface PlanActionRequest {
  readonly uid: string;
  readonly planId: string;
  /** SHA-256 of the caller-provided key. Raw idempotency keys are never stored. */
  readonly idempotencyKeyHash: string;
  readonly requestId: string;
  readonly now: string;
}

/**
 * Persistence boundary for both AI tools and a future MCP transport.
 *
 * A Firestore implementation must scope entity access to
 * users/{uid}/{collection}/{id}. savePreview stores plan, snapshot and preview
 * audit atomically where possible. applyPlanAtomically/rollbackPlanAtomically
 * must use a Firestore transaction covering ownership, hash/status/expiry,
 * snapshot version checks, entity writes, idempotency and the append-only audit.
 * Server-only paths are exported by SERVER_ONLY_PATHS in types.ts.
 */
export interface Repository {
  listEntities(
    uid: string,
    collection: EntityCollection,
    request: ReadPageRequest,
  ): Promise<ReadPage<EntityRecord>>;

  getEntity(
    uid: string,
    collection: EntityCollection,
    id: string,
  ): Promise<EntityRecord | null>;

  /** A consistent read of all refs, used for optimistic concurrency. */
  captureSnapshot(
    uid: string,
    planId: string,
    refs: readonly EntityReference[],
    createdAt: string,
  ): Promise<ChangeSnapshot>;

  savePreview(request: SavePreviewRequest): Promise<StoredChangePlan>;

  getPlan(uid: string, planId: string): Promise<StoredChangePlan | null>;

  applyPlanAtomically(request: PlanActionRequest): Promise<PlanActionResult>;

  rollbackPlanAtomically(request: PlanActionRequest): Promise<PlanActionResult>;

  /** Append-only rejection/conflict audit; never exposed as an AI read tool. */
  recordAudit(event: AuditEvent): Promise<void>;
}

/** Optional test/operations inspection surface; never register it as an AI tool. */
export interface AuditableRepository extends Repository {
  listAuditEventsForUser(uid: string): Promise<readonly AuditEvent[]>;
}
