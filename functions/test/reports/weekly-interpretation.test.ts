import { describe, expect, it, vi } from 'vitest';
import type { ResponsesClientLike } from '../../src/ai/responses-adapter';
import {
  AI_MODEL_PRICE_CATALOG_VERSION,
  AI_MODEL_ROUTING_SCHEMA_VERSION,
  parseLifeTrackerAiRoutingPolicy,
  routedExecutionProfile,
} from '../../src/ai/model-routing';
import type { UserPlanningPreferences } from '../../src/domain/types';
import {
  OpenAiWeeklyInterpretationGenerator,
  WEEKLY_INTERPRETATION_JSON_SCHEMA,
  WeeklyStrategicInterpretationService,
  buildScientificExecutionReport,
  buildWeeklyInterpretationMetricContext,
  composeScientificReportEmail,
  createStoredScientificReportArchive,
  createWeeklyStrategicInterpretation,
  validateWeeklyStrategicInterpretation,
  weeklyInterpretationProviderIdempotencyKey,
  type ScientificReportInput,
  type WeeklyInterpretationProviderResult,
  type WeeklyInterpretationRepository,
  type WeeklyInterpretationStableResult,
} from '../../src/reports';

const UID = 'weekly-interpretation-owner';
const NOW = '2026-08-25T20:00:00.000Z';
const CLAIM_ID = `weekly_interpretation_claim_${'c'.repeat(48)}`;
const PLANNING_PREFERENCES: UserPlanningPreferences = {
  source: 'persisted', defaultsApplied: [], timezone: 'Europe/Rome',
  workingHours: { start: '07:00', end: '22:00' },
  maxDailyPlannedMinutes: 600, maxWeeklyPlannedMinutes: 3_000,
  minBufferMinutes: 15, maxConsecutiveHighEnergyBlocks: 2,
};

class FakeRepository implements WeeklyInterpretationRepository {
  readonly events: string[] = [];
  skipped: Awaited<ReturnType<WeeklyInterpretationRepository['settleSkipped']>> = {
    action: 'stable', interpretation: null, state: 'skipped',
  };
  claimResult: Awaited<ReturnType<WeeklyInterpretationRepository['claim']>> = {
    action: 'generate', claimId: CLAIM_ID,
  };
  failureCode: string | null = null;
  completed: WeeklyInterpretationStableResult | null = null;

  async settleSkipped() {
    this.events.push('skip');
    return this.skipped;
  }

  async claim() {
    this.events.push('claim');
    return this.claimResult;
  }

  async finalizeSuccess(input: Parameters<WeeklyInterpretationRepository['finalizeSuccess']>[0]) {
    this.events.push('success');
    this.completed = { action: 'stable', interpretation: input.interpretation, state: 'complete' };
    return this.completed;
  }

  async finalizeFailure(input: Parameters<WeeklyInterpretationRepository['finalizeFailure']>[0]) {
    this.events.push('failure');
    this.failureCode = input.failureCode;
    return { action: 'stable', interpretation: null, state: 'failed' } as const;
  }
}

describe('post-archive weekly strategic interpretation', () => {
  it('builds bounded immutable metric-only context without user-authored entities', () => {
    const archive = weeklyArchive();
    const context = buildWeeklyInterpretationMetricContext(UID, archive);
    const serialized = JSON.stringify(context);

    expect(context.reportArtifactHash).toBe(archive.artifactHash);
    expect(context.metricHash).toBe(archive.metricHash);
    expect(context.scalarMetrics.length).toBeGreaterThan(10);
    expect(serialized).not.toMatch(/title|description|notes|label|goalId|projectId|taskId/i);
    expect(context.dataQuality.missingSessionsAreZero).toBe(false);
  });

  it('persists deterministic-only without constructing a provider when routing is off', async () => {
    const repository = new FakeRepository();
    const factory = vi.fn();
    await expect(new WeeklyStrategicInterpretationService(
      repository, () => null, factory,
    ).resolve(UID, weeklyArchive(), NOW)).resolves.toEqual({
      outcome: 'ready', interpretation: null, state: 'skipped',
    });
    expect(repository.events).toEqual(['skip']);
    expect(factory).not.toHaveBeenCalled();
  });

  it('makes one claimed generation bound to archive, metrics, and evaluated route', async () => {
    const archive = weeklyArchive();
    const repository = new FakeRepository();
    const generator = { generate: vi.fn(async () => providerResult(archive)) };
    const result = await new WeeklyStrategicInterpretationService(
      repository, () => profile(), () => generator,
    ).resolve(UID, archive, NOW);

    expect(result.outcome).toBe('ready');
    if (result.outcome !== 'ready' || !result.interpretation) throw new Error('Expected addendum.');
    expect(repository.events).toEqual(['claim', 'success']);
    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(result.interpretation).toMatchObject({
      reportId: archive.id,
      reportArtifactHash: archive.artifactHash,
      metricHash: archive.metricHash,
      model: 'gpt-5.6-luna',
      providerModel: 'gpt-5.6-luna',
      workload: 'weekly_strategic_review',
      summaryKind: 'INFERENCE',
    });
    expect(result.interpretation.artifactHash).toMatch(/^[0-9a-f]{64}$/);
    expect(validateWeeklyStrategicInterpretation(UID, archive, result.interpretation))
      .toBe(result.interpretation);
  });

  it('settles provider and schema failures as deterministic-only without escalation', async () => {
    const unavailable = new FakeRepository();
    const unavailableFactory = vi.fn(() => ({
      generate: vi.fn(async () => { throw new Error('private provider failure'); }),
    }));
    await expect(new WeeklyStrategicInterpretationService(
      unavailable, () => profile(), unavailableFactory,
    ).resolve(UID, weeklyArchive(), NOW)).resolves.toEqual({
      outcome: 'ready', interpretation: null, state: 'failed',
    });
    expect(unavailable.failureCode).toBe('provider_unavailable');
    expect(unavailableFactory).toHaveBeenCalledTimes(1);

    const archive = weeklyArchive();
    const invalid = new FakeRepository();
    const result = providerResult(archive);
    await new WeeklyStrategicInterpretationService(
      invalid,
      () => profile(),
      () => ({ generate: async () => ({
        ...result,
        draft: { ...result.draft, summary: 'Invented 99 percent result is unsafe and must fail validation.' },
      }) }),
    ).resolve(UID, archive, NOW);
    expect(invalid.failureCode).toBe('provider_invalid');
  });

  it('waits on an existing claim and never invokes a second provider', async () => {
    const repository = new FakeRepository();
    repository.claimResult = {
      action: 'retry_later', notBefore: '2026-08-25T20:10:00.000Z',
    };
    const factory = vi.fn();
    await expect(new WeeklyStrategicInterpretationService(
      repository, () => profile(), factory,
    ).resolve(UID, weeklyArchive(), NOW)).resolves.toEqual({
      outcome: 'retry_later', notBefore: '2026-08-25T20:10:00.000Z',
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it('rejects archive, model, metric-reference, numerical, and artifact tampering', () => {
    const archive = weeklyArchive();
    const artifact = createWeeklyStrategicInterpretation(
      UID,
      archive,
      profile(),
      buildWeeklyInterpretationMetricContext(UID, archive),
      providerResult(archive),
      NOW,
    );
    expect(() => validateWeeklyStrategicInterpretation(UID, {
      ...archive, metricHash: 'f'.repeat(64),
    }, artifact)).toThrow();
    expect(() => validateWeeklyStrategicInterpretation(UID, archive, {
      ...artifact, providerModel: 'gpt-5.6-sol',
    })).toThrow();
    expect(() => validateWeeklyStrategicInterpretation(UID, archive, {
      ...artifact, summaryKind: 'OBSERVED',
    })).toThrow();
    expect(() => validateWeeklyStrategicInterpretation(UID, archive, {
      ...artifact,
      strongestPattern: { ...artifact.strongestPattern, metricIds: ['forged_metric'] },
    })).toThrow();
    expect(() => validateWeeklyStrategicInterpretation(UID, archive, {
      ...artifact, summary: 'This text invents 75 percent and must be rejected by policy.',
    })).toThrow();
    expect(() => validateWeeklyStrategicInterpretation(UID, archive, {
      ...artifact,
      summary: 'This text invents seventy five minutes of execution and must fail validation.',
    })).toThrow();
    expect(() => validateWeeklyStrategicInterpretation(UID, archive, {
      ...artifact,
      summary: 'This text says scheduling causes reliable execution and must fail validation.',
    })).toThrow();
    expect(() => validateWeeklyStrategicInterpretation(UID, archive, {
      ...artifact,
      summary: 'This text hides a full width number ７ and must fail validation immediately.',
    })).toThrow();
    expect(() => validateWeeklyStrategicInterpretation(UID, archive, {
      ...artifact, artifactHash: 'a'.repeat(64),
    })).toThrow();
  });

  it('binds an optional addendum into both email forms without changing archive authority', async () => {
    const archive = weeklyArchive();
    const interpretation = createWeeklyStrategicInterpretation(
      UID,
      archive,
      profile(),
      buildWeeklyInterpretationMetricContext(UID, archive),
      providerResult(archive),
      NOW,
    );
    const deterministicOnly = await composeScientificReportEmail({ uid: UID, archive });
    const withInterpretation = await composeScientificReportEmail({
      uid: UID,
      archive,
      interpretation,
    });

    expect(withInterpretation.reportArtifactHash).toBe(deterministicOnly.reportArtifactHash);
    expect(withInterpretation.metricHash).toBe(deterministicOnly.metricHash);
    expect(withInterpretation.contentHash).not.toBe(deterministicOnly.contentHash);
    expect(deterministicOnly.html).toContain('deterministic fallback active');
    expect(withInterpretation.html).toContain('Optional Strategic Interpretation Addendum');
    expect(withInterpretation.html).not.toContain('deterministic fallback active');
    expect(withInterpretation.html).toContain('INFERENCE SUMMARY:');
    expect(withInterpretation.text).toContain('OPTIONAL STRATEGIC INTERPRETATION ADDENDUM');
    expect(withInterpretation.html).toContain('has no numerical authority');
    expect(withInterpretation.text).toContain(`artifact: ${interpretation.artifactHash}`);
    expect(withInterpretation.html).not.toMatch(/https?:\/\//i);
    await expect(composeScientificReportEmail({
      uid: UID,
      archive,
      interpretation: { ...interpretation, artifactHash: 'f'.repeat(64) },
    })).rejects.toMatchObject({ code: 'REPORT_EMAIL_COMPOSITION_FAILED' });
  });
});

describe('single-call OpenAI weekly interpretation adapter', () => {
  it('sends metric-only strict JSON with no tools and a stable idempotency key', async () => {
    const archive = weeklyArchive();
    const requests: Array<Record<string, unknown>> = [];
    const options: Array<Record<string, unknown> | undefined> = [];
    const provider = providerResult(archive);
    const client: ResponsesClientLike = { responses: { create: async (request, option) => {
      requests.push(request as Record<string, unknown>);
      options.push(option as Record<string, unknown> | undefined);
      return response(provider);
    } } };
    const idempotencyKey = weeklyInterpretationProviderIdempotencyKey(archive, profile());

    await expect(new OpenAiWeeklyInterpretationGenerator(client).generate({
      uid: UID,
      archive,
      profile: profile(),
      context: buildWeeklyInterpretationMetricContext(UID, archive),
      idempotencyKey,
    })).resolves.toMatchObject({
      providerResponseId: 'response_weekly_safe',
      providerModel: 'gpt-5.6-luna',
      outputTokens: 120,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: 'gpt-5.6-luna', store: false, max_output_tokens: 900,
      metadata: {
        report_id: archive.id,
        report_artifact_hash: archive.artifactHash,
        metric_hash: archive.metricHash,
        ai_workload: 'weekly_strategic_review',
      },
      text: { format: {
        type: 'json_schema', strict: true, schema: WEEKLY_INTERPRETATION_JSON_SCHEMA,
      } },
    });
    expect(requests[0]).not.toHaveProperty('tools');
    expect(requests[0]?.safety_identifier).toMatch(/^[0-9a-f]{64}$/);
    const providerInput = requests[0]?.input;
    expect(typeof providerInput).toBe('string');
    expect(String(providerInput).split('\n').slice(1).join('\n'))
      .not.toMatch(/title|description|notes|recipient|email/i);
    expect(options[0]).toMatchObject({ idempotencyKey });
  });

  it('rejects model drift, tool output, incomplete state, malformed JSON, and usage drift', async () => {
    const archive = weeklyArchive();
    const base = response(providerResult(archive));
    for (const changed of [
      { ...base, model: 'gpt-5.6-sol' },
      { ...base, output: [{ type: 'function_call' }] },
      { ...base, output: [{ type: 'web_search_call' }] },
      { ...base, output: [{ type: 'reasoning' }] },
      { ...base, status: 'incomplete' as const },
      { ...base, output_text: 'not json' },
      { ...base, usage: { ...base.usage, total_tokens: 999 } },
    ]) {
      const client: ResponsesClientLike = { responses: { create: async () => changed } };
      await expect(new OpenAiWeeklyInterpretationGenerator(client).generate({
        uid: UID,
        archive,
        profile: profile(),
        context: buildWeeklyInterpretationMetricContext(UID, archive),
        idempotencyKey: weeklyInterpretationProviderIdempotencyKey(archive, profile()),
      })).rejects.toThrow();
    }
  });

  it('rejects forged owner, context, and request identity before the provider boundary', async () => {
    const archive = weeklyArchive();
    const context = buildWeeklyInterpretationMetricContext(UID, archive);
    const create = vi.fn(async () => response(providerResult(archive)));
    const generator = new OpenAiWeeklyInterpretationGenerator({ responses: { create } });
    const base = {
      uid: UID,
      archive,
      profile: profile(),
      context,
      idempotencyKey: weeklyInterpretationProviderIdempotencyKey(archive, profile()),
    };

    await expect(generator.generate({
      ...base,
      uid: 'forged-owner',
    })).rejects.toThrow();
    await expect(generator.generate({
      ...base,
      context: { ...context, metricHash: 'f'.repeat(64) },
    })).rejects.toThrow();
    await expect(generator.generate({
      ...base,
      idempotencyKey: `life-tracker-weekly-interpretation/weekly_interpretation_${'f'.repeat(48)}`,
    })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});

function weeklyArchive() {
  const report = buildScientificExecutionReport(reportInput());
  if (report.type !== 'weekly') throw new Error('Expected Weekly report.');
  return createStoredScientificReportArchive(UID, report, NOW);
}

function reportInput(): ScientificReportInput {
  return {
    uid: UID, reportType: 'weekly', localDate: '2026-08-25',
    timezone: 'Europe/Rome', locale: 'en', generatedAt: NOW,
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

function profile() {
  const policy = parseLifeTrackerAiRoutingPolicy(JSON.stringify({
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
  }));
  return routedExecutionProfile(policy, 'weekly_strategic_review');
}

function providerResult(archive: ReturnType<typeof weeklyArchive>): WeeklyInterpretationProviderResult {
  const metricIds = buildWeeklyInterpretationMetricContext(UID, archive)
    .scalarMetrics.slice(0, 2).map((metric) => metric.id);
  return {
    providerResponseId: 'response_weekly_safe', providerModel: 'gpt-5.6-luna',
    inputTokens: 1_000, cachedInputTokens: 100, outputTokens: 120,
    reasoningTokens: 20, totalTokens: 1_120, latencyMs: 900,
    draft: {
      summary: 'The available evidence supports one cautious scheduling experiment while preserving uncertainty.',
      strongestPattern: {
        kind: 'INFERENCE',
        text: 'Execution appears more stable where planned work has clearer completion evidence.',
        metricIds, confidence: 'moderate',
        uncertainty: 'The available sample is limited and some execution evidence may be incomplete.',
      },
      largestUncertainty: {
        kind: 'INFERENCE',
        text: 'Incomplete execution capture limits how confidently the weekly pattern can be interpreted.',
        metricIds, confidence: 'low',
        uncertainty: 'Missing or partial Session evidence may change the apparent pattern.',
      },
      nextWeekExperiment: {
        kind: 'RECOMMENDATION',
        text: 'Keep one scheduling variable stable and capture every completed Session before comparing again.',
        metricIds, confidence: 'moderate',
        uncertainty: 'The experiment may be inconclusive if execution capture remains incomplete.',
      },
    },
  };
}

function response(result: WeeklyInterpretationProviderResult) {
  return {
    id: result.providerResponseId,
    model: result.providerModel,
    status: 'completed' as const,
    output: [{ type: 'message' }],
    output_text: JSON.stringify(result.draft),
    usage: {
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      total_tokens: result.totalTokens,
      input_tokens_details: { cached_tokens: result.cachedInputTokens },
      output_tokens_details: { reasoning_tokens: result.reasoningTokens },
    },
  };
}
