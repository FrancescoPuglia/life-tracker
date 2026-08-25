import { describe, expect, it, vi } from 'vitest';
import { normalizeNotificationPreferences } from '../../src/notifications/domain';
import {
  ScientificReportScheduleManifestService,
  deriveScientificReportSchedulePolicy,
  planDueScientificReportRuns,
  type BoundedScientificReportScheduleTargetBatch,
  type LoadDueScientificReportScheduleResult,
  type RecordScientificReportScheduleResult,
  type ScientificReportRunServiceResult,
  type ScientificReportScheduleCandidate,
  type ScientificReportScheduleManifestRepository,
  type ScientificReportScheduleTarget,
} from '../../src/reports';

const UID = 'report-owner';
const NOW = '2026-08-25T21:00:00.000Z';

class FakeManifestRepository implements ScientificReportScheduleManifestRepository {
  readonly events: string[] = [];
  readonly runResults: ScientificReportRunServiceResult[] = [];
  batch: BoundedScientificReportScheduleTargetBatch = {
    targets: [{ uid: UID, reportType: 'daily' }],
    overflow: false,
  };
  loadResult: LoadDueScientificReportScheduleResult = {
    action: 'execute', candidate: candidate(),
  };
  failureResult: RecordScientificReportScheduleResult = { action: 'retry_scheduled' };

  async reconcileOwner(uid: string): Promise<Readonly<{ activeCount: number }>> {
    this.events.push(`reconcile:${uid}`);
    return { activeCount: 1 };
  }

  async listDue(uid: string, now: string, maximum: number) {
    this.events.push(`list:${uid}:${now}:${maximum}`);
    return structuredClone(this.batch);
  }

  async loadDueCandidate(target: ScientificReportScheduleTarget) {
    this.events.push(`load:${target.reportType}`);
    return structuredClone(this.loadResult);
  }

  async recordRunResult(input: Readonly<{ result: ScientificReportRunServiceResult }>) {
    this.events.push(`record:${input.result.outcome}`);
    this.runResults.push(structuredClone(input.result));
    return { action: input.result.outcome === 'retry_later' ? 'retry_scheduled' : 'advanced' } as const;
  }

  async recordInvocationFailure() {
    this.events.push('record:runtime_failure');
    return this.failureResult;
  }
}

describe('scientific report schedule manifest orchestration', () => {
  it('reconciles and executes a due report in strict sequential order', async () => {
    const repository = new FakeManifestRepository();
    const executor = {
      execute: vi.fn(async (): Promise<ScientificReportRunServiceResult> => {
        repository.events.push('execute');
        return {
          outcome: 'completed',
          reportId: `report_${'a'.repeat(56)}`,
          archiveReused: false,
          delivery: 'accepted',
        };
      }),
    };
    const service = new ScientificReportScheduleManifestService(repository, executor);

    await expect(service.reconcileOwner(UID, NOW)).resolves.toEqual({ activeCount: 1 });
    await expect(service.runDue(UID, NOW, 10)).resolves.toEqual({
      selectedCount: 1,
      executedCount: 1,
      completedCount: 1,
      retryCount: 0,
      noOpCount: 0,
      failedCount: 0,
      runtimeFailureCount: 0,
      overflow: false,
    });
    expect(repository.events).toEqual([
      `reconcile:${UID}`,
      `list:${UID}:${NOW}:10`,
      'load:daily',
      'execute',
      'record:completed',
    ]);
  });

  it('counts safe no-op and retry results without treating them as runtime failures', async () => {
    const repository = new FakeManifestRepository();
    repository.batch = {
      targets: [
        { uid: UID, reportType: 'daily' },
        { uid: UID, reportType: 'weekly' },
      ],
      overflow: true,
    };
    let call = 0;
    const executor = {
      async execute(): Promise<ScientificReportRunServiceResult> {
        call += 1;
        return call === 1
          ? { outcome: 'retry_later', stage: 'delivery', notBefore: '2026-08-25T21:10:00.000Z' }
          : { outcome: 'no_op', reason: 'schedule_disabled' };
      },
    };
    const service = new ScientificReportScheduleManifestService(repository, executor);

    await expect(service.runDue(UID, NOW, 2)).resolves.toMatchObject({
      selectedCount: 2,
      executedCount: 2,
      retryCount: 1,
      noOpCount: 1,
      runtimeFailureCount: 0,
      overflow: true,
    });
    expect(repository.runResults.map((result) => result.outcome)).toEqual([
      'retry_later', 'no_op',
    ]);
  });

  it('persists a sanitized runtime failure and continues no external loop', async () => {
    const repository = new FakeManifestRepository();
    const executor = {
      execute: vi.fn(async () => {
        throw new Error('private provider credential and mailbox detail');
      }),
    };
    const service = new ScientificReportScheduleManifestService(repository, executor);

    await expect(service.runDue(UID, NOW, 1)).resolves.toMatchObject({
      executedCount: 1,
      retryCount: 1,
      runtimeFailureCount: 1,
    });
    expect(repository.events).toContain('record:runtime_failure');
    expect(JSON.stringify(repository)).not.toContain('private provider');
  });

  it('does not execute a manifest that becomes stale during its authority load', async () => {
    const repository = new FakeManifestRepository();
    repository.loadResult = { action: 'no_op' };
    const executor = { execute: vi.fn() };
    const service = new ScientificReportScheduleManifestService(repository, executor);

    await expect(service.runDue(UID, NOW, 1)).resolves.toMatchObject({
      executedCount: 0,
      noOpCount: 1,
    });
    expect(executor.execute).not.toHaveBeenCalled();
    expect(repository.runResults).toEqual([]);
  });
});

function candidate(): ScientificReportScheduleCandidate {
  const preferences = normalizeNotificationPreferences(UID, {
    userId: UID,
    emailEnabled: true,
    reportRecipient: 'francesco@example.test',
    dailyReport: { enabled: true, localTime: '22:30' },
  }, 'Europe/Rome');
  return planDueScientificReportRuns(
    deriveScientificReportSchedulePolicy(preferences),
    NOW,
  )[0]!;
}
