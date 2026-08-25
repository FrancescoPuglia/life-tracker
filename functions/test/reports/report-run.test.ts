import { describe, expect, it, vi } from 'vitest';
import {
  AI_MODEL_PRICE_CATALOG_VERSION,
  AI_MODEL_ROUTING_SCHEMA_VERSION,
  parseLifeTrackerAiRoutingPolicy,
  routedExecutionProfile,
} from '../../src/ai/model-routing';
import type { UserPlanningPreferences } from '../../src/domain/types';
import { normalizeNotificationPreferences } from '../../src/notifications/domain';
import {
  ScientificReportRunService,
  buildScientificExecutionReport,
  buildWeeklyInterpretationMetricContext,
  createWeeklyStrategicInterpretation,
  createStoredScientificReportArchive,
  deriveScientificReportSchedulePolicy,
  planDueScientificReportRuns,
  type AuthorizeScientificReportRunDeliveryResult,
  type ClaimScientificReportRunResult,
  type CommitScientificReportRunResult,
  type FinalizeScientificReportRunDeliveryResult,
  type RecordScientificReportRunFailureResult,
  type ScientificReportEmailDeliveryServiceResult,
  type ScientificReportInput,
  type ScientificReportRunRepository,
  type ScientificReportScheduleCandidate,
  type StoredScientificReportArchive,
  type WeeklyInterpretationProviderResult,
} from '../../src/reports';

const UID = 'report-run-owner';
const NOW = '2026-08-25T21:00:00.000Z';
const GENERATED_AT = '2026-08-25T21:00:01.000Z';
const RECIPIENT = { email: 'francesco@example.com', name: null } as const;
const PLANNING_PREFERENCES: UserPlanningPreferences = {
  source: 'persisted',
  defaultsApplied: [],
  timezone: 'Europe/Rome',
  workingHours: { start: '07:00', end: '22:00' },
  maxDailyPlannedMinutes: 600,
  maxWeeklyPlannedMinutes: 3_000,
  minBufferMinutes: 15,
  maxConsecutiveHighEnergyBlocks: 2,
};

class FakeRunRepository implements ScientificReportRunRepository {
  readonly events: string[] = [];
  claim: ClaimScientificReportRunResult;
  archive: StoredScientificReportArchive | null = null;
  commitResult: CommitScientificReportRunResult | null = null;
  generationFailure: RecordScientificReportRunFailureResult = {
    action: 'retry_later', stage: 'generation', notBefore: '2026-08-25T21:05:00.000Z',
  };
  authorization: AuthorizeScientificReportRunDeliveryResult = {
    action: 'deliver', claimId: `report_delivery_${'d'.repeat(48)}`, recipient: RECIPIENT,
  };
  finalization: FinalizeScientificReportRunDeliveryResult = {
    action: 'completed', delivery: 'accepted',
  };
  deliveryFailure: RecordScientificReportRunFailureResult = {
    action: 'retry_later', stage: 'delivery', notBefore: '2026-08-25T21:10:00.000Z',
  };
  committedReport: Parameters<ScientificReportRunRepository['commitGeneratedReport']>[0]['report']
    | null = null;

  constructor(readonly candidate: ScientificReportScheduleCandidate) {
    this.claim = {
      action: 'generate',
      claimId: `report_generation_${'a'.repeat(48)}`,
      generatedAt: GENERATED_AT,
      reportId: report(candidate).id,
      timezone: 'Europe/Rome',
      locale: 'it-IT',
    };
  }

  async claimGeneration(): Promise<ClaimScientificReportRunResult> {
    this.events.push('claim');
    return this.claim;
  }

  async getArchive(): Promise<StoredScientificReportArchive | null> {
    this.events.push('archive_lookup');
    return this.archive;
  }

  async commitGeneratedReport(
    input: Parameters<ScientificReportRunRepository['commitGeneratedReport']>[0],
  ): Promise<CommitScientificReportRunResult> {
    this.events.push('commit');
    this.committedReport = input.report;
    if (this.commitResult) return this.commitResult;
    const archive = createStoredScientificReportArchive(UID, input.report, NOW);
    this.archive = archive;
    return { action: 'archived', archive, idempotentReplay: false };
  }

  async recordGenerationFailure(): Promise<RecordScientificReportRunFailureResult> {
    this.events.push('generation_failure');
    return this.generationFailure;
  }

  async authorizeDelivery(): Promise<AuthorizeScientificReportRunDeliveryResult> {
    this.events.push('authorize');
    return this.authorization;
  }

  async finalizeDelivery(): Promise<FinalizeScientificReportRunDeliveryResult> {
    this.events.push('finalize');
    return this.finalization;
  }

  async recordDeliveryInvocationFailure(): Promise<RecordScientificReportRunFailureResult> {
    this.events.push('delivery_failure');
    return this.deliveryFailure;
  }
}

describe('scientific report run orchestration', () => {
  it('claims, loads, deterministically archives, re-authorizes, and only then hands off email', async () => {
    const candidate = dueCandidate();
    const repository = new FakeRunRepository(candidate);
    const sourceInput = input(candidate);
    const source = {
      load: vi.fn(async (context, request) => {
        repository.events.push('source');
        expect(context).toMatchObject({ uid: UID, requestId: `report-run:${candidate.id}` });
        expect(request).toEqual({ reportType: 'daily', localDate: '2026-08-25', locale: 'it-IT' });
        return sourceInput;
      }),
    };
    const delivery = {
      deliver: vi.fn(async (request): Promise<ScientificReportEmailDeliveryServiceResult> => {
        repository.events.push('deliver');
        expect(request.to).toEqual(RECIPIENT);
        expect(request.reportId).toBe(report(candidate).id);
        return { outcome: 'accepted' };
      }),
    };

    await expect(new ScientificReportRunService(repository, source, delivery)
      .execute(candidate, NOW)).resolves.toEqual({
      outcome: 'completed',
      reportId: report(candidate).id,
      archiveReused: false,
      delivery: 'accepted',
    });
    expect(repository.events).toEqual([
      'claim', 'archive_lookup', 'source', 'commit', 'authorize', 'deliver', 'finalize',
    ]);
    expect(repository.committedReport?.generatedAt).toBe(GENERATED_AT);
    expect(source.load).toHaveBeenCalledTimes(1);
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(repository.committedReport)).not.toContain(RECIPIENT.email);
  });

  it('reuses an immutable archive without rereading mutable source state', async () => {
    const candidate = dueCandidate();
    const repository = new FakeRunRepository(candidate);
    const existingReport = report(candidate);
    repository.archive = createStoredScientificReportArchive(UID, existingReport, NOW);
    repository.claim = {
      action: 'resume_delivery',
      reportId: existingReport.id,
    };
    repository.finalization = { action: 'completed', delivery: 'already_sent' };
    const source = { load: vi.fn(async () => input(candidate)) };
    const delivery = { deliver: vi.fn(async () => ({
      outcome: 'no_op', reason: 'already_sent',
    } as const)) };

    await expect(new ScientificReportRunService(repository, source, delivery)
      .execute(candidate, NOW)).resolves.toEqual({
      outcome: 'completed',
      reportId: existingReport.id,
      archiveReused: true,
      delivery: 'already_sent',
    });
    expect(source.load).not.toHaveBeenCalled();
    expect(repository.events).toEqual([
      'claim', 'archive_lookup', 'authorize', 'finalize',
    ]);
  });

  it('persists bounded source and source-authority failures before any archive or delivery', async () => {
    const candidate = dueCandidate();
    const unavailable = new FakeRunRepository(candidate);
    const unavailableSource = { load: vi.fn(async () => { throw new Error('private source'); }) };
    const delivery = { deliver: vi.fn() };
    await expect(new ScientificReportRunService(unavailable, unavailableSource, delivery)
      .execute(candidate, NOW)).resolves.toEqual({
      outcome: 'retry_later',
      stage: 'generation',
      notBefore: '2026-08-25T21:05:00.000Z',
    });
    expect(unavailable.events).toEqual(['claim', 'archive_lookup', 'generation_failure']);

    const changed = new FakeRunRepository(candidate);
    const changedInput = { ...input(candidate), timezone: 'UTC' };
    await new ScientificReportRunService(
      changed,
      { load: vi.fn(async () => changedInput) },
      delivery,
    ).execute(candidate, NOW);
    expect(changed.events).toEqual(['claim', 'archive_lookup', 'generation_failure']);
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it('stops on stale commit/delivery authority and safely records delivery invocation failure', async () => {
    const candidate = dueCandidate();
    const staleCommit = new FakeRunRepository(candidate);
    staleCommit.commitResult = { action: 'suppressed', reason: 'schedule_changed' };
    const source = { load: vi.fn(async () => input(candidate)) };
    const delivery = { deliver: vi.fn(async () => ({ outcome: 'accepted' } as const)) };
    await expect(new ScientificReportRunService(staleCommit, source, delivery)
      .execute(candidate, NOW)).resolves.toEqual({
      outcome: 'no_op', reason: 'schedule_changed',
    });
    expect(delivery.deliver).not.toHaveBeenCalled();

    const staleDelivery = new FakeRunRepository(candidate);
    staleDelivery.authorization = { action: 'suppressed', reason: 'recipient_changed' };
    await expect(new ScientificReportRunService(staleDelivery, source, delivery)
      .execute(candidate, NOW)).resolves.toEqual({
      outcome: 'no_op', reason: 'recipient_changed',
    });

    const failedDelivery = new FakeRunRepository(candidate);
    const throwingDelivery = { deliver: vi.fn(async () => { throw new Error('private provider'); }) };
    await expect(new ScientificReportRunService(failedDelivery, source, throwingDelivery)
      .execute(candidate, NOW)).resolves.toEqual({
      outcome: 'retry_later',
      stage: 'delivery',
      notBefore: '2026-08-25T21:10:00.000Z',
    });
    expect(failedDelivery.events.at(-1)).toBe('delivery_failure');
  });

  it('resolves a metric-bound weekly addendum after archive commit and before delivery authority', async () => {
    const candidate = weeklyDueCandidate();
    const repository = new FakeRunRepository(candidate);
    const source = {
      load: vi.fn(async () => {
        repository.events.push('source');
        return input(candidate);
      }),
    };
    const interpretation = {
      resolve: vi.fn(async (uid: string, archive: StoredScientificReportArchive) => {
        repository.events.push('interpret');
        const context = buildWeeklyInterpretationMetricContext(uid, archive);
        return {
          outcome: 'ready' as const,
          state: 'complete' as const,
          interpretation: createWeeklyStrategicInterpretation(
            uid,
            archive,
            weeklyProfile(),
            context,
            weeklyProviderResult(context.scalarMetrics.slice(0, 2).map((metric) => metric.id)),
            NOW,
          ),
        };
      }),
    };
    const delivery = {
      deliver: vi.fn(async (request): Promise<ScientificReportEmailDeliveryServiceResult> => {
        repository.events.push('deliver');
        expect(request.interpretation?.reportArtifactHash).toBe(repository.archive?.artifactHash);
        return { outcome: 'accepted' };
      }),
    };

    await expect(new ScientificReportRunService(
      repository,
      source,
      delivery,
      buildScientificExecutionReport,
      interpretation,
    ).execute(candidate, NOW)).resolves.toMatchObject({
      outcome: 'completed', delivery: 'accepted', archiveReused: false,
    });
    expect(repository.events).toEqual([
      'claim', 'archive_lookup', 'source', 'commit', 'interpret', 'authorize', 'deliver', 'finalize',
    ]);
    expect(interpretation.resolve).toHaveBeenCalledTimes(1);
  });

  it('does not authorize weekly email while an existing interpretation claim is unresolved', async () => {
    const candidate = weeklyDueCandidate();
    const repository = new FakeRunRepository(candidate);
    const source = { load: vi.fn(async () => input(candidate)) };
    const delivery = { deliver: vi.fn() };
    const interpretation = {
      resolve: vi.fn(async () => {
        repository.events.push('interpret');
        return { outcome: 'retry_later' as const, notBefore: '2026-08-25T21:10:00.000Z' };
      }),
    };

    await expect(new ScientificReportRunService(
      repository,
      source,
      delivery,
      buildScientificExecutionReport,
      interpretation,
    ).execute(candidate, NOW)).resolves.toEqual({
      outcome: 'retry_later',
      stage: 'delivery',
      notBefore: '2026-08-25T21:10:00.000Z',
    });
    expect(repository.events).toEqual(['claim', 'archive_lookup', 'commit', 'interpret']);
    expect(delivery.deliver).not.toHaveBeenCalled();
  });
});

function dueCandidate(): ScientificReportScheduleCandidate {
  const preferences = normalizeNotificationPreferences(UID, {
    userId: UID,
    emailEnabled: true,
    reportRecipient: RECIPIENT.email,
    dailyReport: { enabled: true, localTime: '22:30' },
  }, 'Europe/Rome');
  return planDueScientificReportRuns(
    deriveScientificReportSchedulePolicy(preferences),
    NOW,
  )[0]!;
}

function weeklyDueCandidate(): ScientificReportScheduleCandidate {
  const preferences = normalizeNotificationPreferences(UID, {
    userId: UID,
    emailEnabled: true,
    reportRecipient: RECIPIENT.email,
    dailyReport: { enabled: false, localTime: '22:30' },
    weeklyReport: { enabled: true, isoWeekday: 2, localTime: '22:30' },
  }, 'Europe/Rome');
  const candidate = planDueScientificReportRuns(
    deriveScientificReportSchedulePolicy(preferences),
    NOW,
  ).find((item) => item.reportType === 'weekly');
  if (!candidate) throw new Error('Missing weekly schedule candidate.');
  return candidate;
}

function input(candidate: ScientificReportScheduleCandidate): ScientificReportInput {
  return {
    uid: UID,
    reportType: candidate.reportType,
    localDate: candidate.localDate,
    timezone: 'Europe/Rome',
    locale: 'it-IT',
    generatedAt: NOW,
    preferences: PLANNING_PREFERENCES,
    coverage: {
      goals: 'complete', projects: 'complete', tasks: 'complete', timeBlocks: 'complete',
      sessions: 'complete', habits: 'complete', habitLogs: 'complete',
    },
    records: {
      goals: [], projects: [], tasks: [], timeBlocks: [], sessions: [], habits: [], habitLogs: [],
    },
  };
}

function report(candidate: ScientificReportScheduleCandidate) {
  return buildScientificExecutionReport({ ...input(candidate), generatedAt: GENERATED_AT });
}

function weeklyProfile() {
  return routedExecutionProfile(parseLifeTrackerAiRoutingPolicy(JSON.stringify({
    schemaVersion: AI_MODEL_ROUTING_SCHEMA_VERSION,
    evaluationReceiptId: `model_eval_${'b'.repeat(64)}`,
    evaluatedAt: NOW,
    priceCatalogVersion: AI_MODEL_PRICE_CATALOG_VERSION,
    routes: {
      ask: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
      coach: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
      analyze: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
      plan: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
      weekly_strategic_review: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
    },
  })), 'weekly_strategic_review');
}

function weeklyProviderResult(metricIds: readonly string[]): WeeklyInterpretationProviderResult {
  return {
    providerResponseId: 'response_report_run_weekly',
    providerModel: 'gpt-5.6-luna',
    inputTokens: 1_000,
    cachedInputTokens: 100,
    outputTokens: 120,
    reasoningTokens: 20,
    totalTokens: 1_120,
    latencyMs: 900,
    draft: {
      summary: 'The available evidence supports one cautious scheduling experiment while preserving uncertainty.',
      strongestPattern: {
        kind: 'INFERENCE',
        text: 'Execution appears more stable where planned work has clearer completion evidence.',
        metricIds,
        confidence: 'moderate',
        uncertainty: 'The available sample is limited and execution evidence may be incomplete.',
      },
      largestUncertainty: {
        kind: 'INFERENCE',
        text: 'Incomplete execution capture limits how confidently the weekly pattern can be interpreted.',
        metricIds,
        confidence: 'low',
        uncertainty: 'Missing or partial Session evidence may change the apparent pattern.',
      },
      nextWeekExperiment: {
        kind: 'RECOMMENDATION',
        text: 'Keep one scheduling variable stable and capture every completed Session before comparing again.',
        metricIds,
        confidence: 'moderate',
        uncertainty: 'The experiment may be inconclusive if execution capture remains incomplete.',
      },
    },
  };
}
