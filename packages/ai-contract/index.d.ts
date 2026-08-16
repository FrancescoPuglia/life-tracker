export type LifePlanAction = 'create' | 'update' | 'move' | 'delete';
export type LifePlanStatus = 'previewed' | 'applied' | 'rolled_back';

export interface LifePlanOperationSummary {
  readonly action: LifePlanAction;
  readonly entityType: string;
  readonly entityId: string;
}

export interface LifePlanDiffEntry extends LifePlanOperationSummary {
  readonly summary: string;
  readonly title: string | null;
  readonly changedFields: readonly string[];
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
}

export interface LifePlanApproval {
  readonly required: true;
  readonly capability: string;
  readonly expiresAt: string;
}

export interface LifePlanPreview {
  readonly id: string;
  readonly tool: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly baseStateHash: string;
  readonly hash: string;
  readonly status: LifePlanStatus;
  readonly operations: readonly LifePlanOperationSummary[];
  readonly diff: readonly LifePlanDiffEntry[];
  readonly reason: string;
  readonly warnings: readonly string[];
  readonly conflicts: readonly string[];
  readonly assumptions: readonly string[];
  readonly expectedImpact: readonly string[];
  readonly destructiveOperationCount: number;
  readonly approval: LifePlanApproval;
}

export interface LifeEntityReference {
  readonly collection: string;
  readonly id: string;
}

export interface LifeExecutionReceipt {
  readonly executionId: string;
  readonly planId: string;
  readonly changesetHash: string;
  readonly status: 'applied' | 'rolled_back';
  readonly verified: boolean;
  readonly timestamp: string;
  readonly affected: readonly LifeEntityReference[];
  readonly rollbackAvailable: boolean;
  readonly rollbackExpiresAt: string | null;
}

export interface LifePlanActionResponse {
  readonly message: string;
  readonly executionId: string;
  readonly planId: string;
  readonly hash: string;
  readonly status: 'applied' | 'rolled_back';
  readonly idempotentReplay: boolean;
  readonly verified: boolean;
  readonly receipt: LifeExecutionReceipt;
  readonly requestId?: string;
  readonly rollback?: Readonly<{
    readonly capability: string;
    readonly expiresAt: string;
  }>;
}

export declare const LIFE_PLAN_ACTIONS: readonly LifePlanAction[];
export declare const LIFE_PLAN_STATUSES: readonly LifePlanStatus[];
export declare function parseLifePlanPreview(value: unknown): LifePlanPreview;
export declare function parseLifePlanActionResponse(value: unknown): LifePlanActionResponse;
