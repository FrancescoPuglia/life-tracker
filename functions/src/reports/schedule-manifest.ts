import type { ScientificReportRunServiceResult } from './report-run';
import type { ScientificReportScheduleCandidate } from './scheduling';
import type { ScientificReportType } from './types';

export const REPORT_SCHEDULE_MANIFEST_SCHEMA_VERSION =
  'scientific-report-schedule-manifest-v1' as const;
export const REPORT_SCHEDULE_MANIFEST_MAX_RUNTIME_FAILURES = 5;

export type ScientificReportScheduleManifestState = 'active' | 'disabled';

export type ScientificReportScheduleManifestResultCode =
  | 'authority_reconciled'
  | 'completed'
  | 'no_op'
  | 'run_failed'
  | 'retry_scheduled'
  | 'runtime_unavailable'
  | 'runtime_attempts_exhausted';

export interface StoredScientificReportScheduleManifest {
  readonly schemaVersion: typeof REPORT_SCHEDULE_MANIFEST_SCHEMA_VERSION;
  readonly id: ScientificReportType;
  readonly userId: string;
  readonly reportType: ScientificReportType;
  readonly state: ScientificReportScheduleManifestState;
  readonly candidate: ScientificReportScheduleCandidate | null;
  readonly availableAt: string | null;
  readonly runtimeFailureCount: number;
  readonly lastResultCode: ScientificReportScheduleManifestResultCode | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScientificReportScheduleTarget {
  readonly uid: string;
  readonly reportType: ScientificReportType;
}

export interface BoundedScientificReportScheduleTargetBatch {
  readonly targets: readonly ScientificReportScheduleTarget[];
  readonly overflow: boolean;
}

export type LoadDueScientificReportScheduleResult =
  | Readonly<{ action: 'execute'; candidate: ScientificReportScheduleCandidate }>
  | Readonly<{ action: 'no_op' }>;

export type RecordScientificReportScheduleResult = Readonly<{
  action: 'advanced' | 'retry_scheduled' | 'no_op';
}>;

export interface ScientificReportScheduleManifestRepository {
  reconcileOwner(uid: string, now: string): Promise<Readonly<{ activeCount: number }>>;

  listDue(
    uid: string,
    now: string,
    maximum: number,
  ): Promise<BoundedScientificReportScheduleTargetBatch>;

  loadDueCandidate(
    target: ScientificReportScheduleTarget,
    now: string,
  ): Promise<LoadDueScientificReportScheduleResult>;

  recordRunResult(input: Readonly<{
    target: ScientificReportScheduleTarget;
    candidate: ScientificReportScheduleCandidate;
    result: ScientificReportRunServiceResult;
    now: string;
  }>): Promise<RecordScientificReportScheduleResult>;

  recordInvocationFailure(input: Readonly<{
    target: ScientificReportScheduleTarget;
    candidate: ScientificReportScheduleCandidate;
    now: string;
  }>): Promise<RecordScientificReportScheduleResult>;
}

export interface ScientificReportScheduleRunExecutor {
  execute(
    candidate: ScientificReportScheduleCandidate,
    now: string,
  ): Promise<ScientificReportRunServiceResult>;
}

export interface ScientificReportScheduleRunSummary {
  readonly selectedCount: number;
  readonly executedCount: number;
  readonly completedCount: number;
  readonly retryCount: number;
  readonly noOpCount: number;
  readonly failedCount: number;
  readonly runtimeFailureCount: number;
  readonly overflow: boolean;
}

/** Sequential execution deliberately bounds provider and chart-renderer load. */
export class ScientificReportScheduleManifestService {
  constructor(
    private readonly repository: ScientificReportScheduleManifestRepository,
    private readonly executor: ScientificReportScheduleRunExecutor,
  ) {}

  reconcileOwner(uid: string, now: string): Promise<Readonly<{ activeCount: number }>> {
    return this.repository.reconcileOwner(uid, now);
  }

  async runDue(
    uid: string,
    now: string,
    maximum: number,
  ): Promise<ScientificReportScheduleRunSummary> {
    const batch = await this.repository.listDue(uid, now, maximum);
    let executedCount = 0;
    let completedCount = 0;
    let retryCount = 0;
    let noOpCount = 0;
    let failedCount = 0;
    let runtimeFailureCount = 0;

    for (const target of batch.targets) {
      const loaded = await this.repository.loadDueCandidate(target, now);
      if (loaded.action === 'no_op') {
        noOpCount += 1;
        continue;
      }
      executedCount += 1;
      let result: ScientificReportRunServiceResult;
      try {
        result = await this.executor.execute(loaded.candidate, now);
      } catch {
        runtimeFailureCount += 1;
        const recorded = await this.repository.recordInvocationFailure({
          target,
          candidate: loaded.candidate,
          now,
        });
        if (recorded.action === 'advanced') failedCount += 1;
        else if (recorded.action === 'retry_scheduled') retryCount += 1;
        else noOpCount += 1;
        continue;
      }

      await this.repository.recordRunResult({
        target,
        candidate: loaded.candidate,
        result,
        now,
      });
      if (result.outcome === 'completed') completedCount += 1;
      else if (result.outcome === 'retry_later') retryCount += 1;
      else if (result.outcome === 'failed') failedCount += 1;
      else noOpCount += 1;
    }

    return Object.freeze({
      selectedCount: batch.targets.length,
      executedCount,
      completedCount,
      retryCount,
      noOpCount,
      failedCount,
      runtimeFailureCount,
      overflow: batch.overflow,
    });
  }
}
