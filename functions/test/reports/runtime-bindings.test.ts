import { describe, expect, it, vi } from 'vitest';
import type { ResponsesClientLike } from '../../src/ai/responses-adapter';
import {
  AI_MODEL_PRICE_CATALOG_VERSION,
  AI_MODEL_ROUTING_SCHEMA_VERSION,
} from '../../src/ai/model-routing';
import type { UserPlanningPreferences } from '../../src/domain/types';
import type {
  FinalizeReportEmailDeliveryInput,
  PrepareReportEmailDeliveryInput,
  ScientificReportEmailDeliveryRepository,
} from '../../src/reports/email-delivery';
import {
  createLazyResendScientificReportDeliveryService,
  createLazyWeeklyStrategicInterpretationService,
  createScientificReportRuntimeGate,
  deliverScheduledScientificReports,
  reconcileScientificReportSchedules,
  type ScientificReportAiRuntimeParameters,
  type ScientificReportRuntimeParameters,
} from '../../src/reports/runtime-bindings';
import type { ResendEmailClient } from '../../src/reports/resend-email-provider';
import {
  buildScientificExecutionReport,
  buildWeeklyInterpretationMetricContext,
  createStoredScientificReportArchive,
  type ScientificReportInput,
  type WeeklyInterpretationRepository,
  type WeeklyInterpretationStableResult,
} from '../../src/reports';

const UID = 'owner-1';
const REPORT_ID = `report_${'a'.repeat(56)}`;
const NOW = '2026-08-25T20:00:00.000Z';
const INTERPRETATION_CLAIM_ID = `weekly_interpretation_claim_${'c'.repeat(48)}`;
const PLANNING_PREFERENCES: UserPlanningPreferences = {
  source: 'persisted', defaultsApplied: [], timezone: 'Europe/Rome',
  workingHours: { start: '07:00', end: '22:00' },
  maxDailyPlannedMinutes: 600, maxWeeklyPlannedMinutes: 3_000,
  minBufferMinutes: 15, maxConsecutiveHighEnergyBlocks: 2,
};

describe('scientific report runtime bindings', () => {
  it('exports only one secret-bound scheduled endpoint and a secret-free preference trigger', () => {
    const scheduled = endpoint(deliverScheduledScientificReports);
    const preference = endpoint(reconcileScientificReportSchedules);

    expect(scheduled).toMatchObject({
      region: ['europe-west1'],
      ingressSettings: 'ALLOW_INTERNAL_ONLY',
      minInstances: 0,
      maxInstances: 1,
      concurrency: 1,
      secretEnvironmentVariables: [{ key: 'RESEND_API_KEY' }, { key: 'OPENAI_API_KEY' }],
      scheduleTrigger: { schedule: '*/5 * * * *', timeZone: 'Etc/UTC' },
    });
    expect(preference).toMatchObject({
      region: ['europe-west1'],
      ingressSettings: 'ALLOW_INTERNAL_ONLY',
      minInstances: 0,
      maxInstances: 1,
      concurrency: 1,
    });
    expect(JSON.stringify(preference)).not.toMatch(/secretEnvironment|OPENAI|TWILIO|RESEND/i);
    expect(JSON.stringify(scheduled)).not.toMatch(/TWILIO/i);
  });

  it('reads only the kill switch in the exact default-off state', () => {
    const parameters = fakeParameters({ enabled: 'false' });
    const gate = createScientificReportRuntimeGate(parameters.values);

    expect(gate.allowedOwnerUid()).toBeNull();
    expect(parameters.reads.enabled).toBe(1);
    expect(totalReads(parameters.reads)).toBe(1);
  });

  it('rejects the unresolved owner sentinel before any sender or secret read', () => {
    const parameters = fakeParameters({ ownerUid: 'not-configured' });
    const gate = createScientificReportRuntimeGate(parameters.values);

    expect(() => gate.allowedOwnerUid()).toThrow('owner UID');
    expect(parameters.reads.enabled).toBe(1);
    expect(parameters.reads.ownerUid).toBe(1);
    expect(parameters.reads.fromEmail).toBe(0);
    expect(parameters.reads.resendApiKey).toBe(0);
  });

  it('rejects a forged owner before reading sender configuration or secret', async () => {
    const parameters = fakeParameters();
    const repository = new FakeEmailRepository();
    const factory = vi.fn<() => ResendEmailClient>();
    const delivery = createLazyResendScientificReportDeliveryService(
      repository,
      parameters.values,
      factory,
    );

    await expect(delivery.deliver({
      uid: 'other-owner',
      reportId: REPORT_ID,
      to: { email: 'recipient@example.test', name: null },
      now: '2026-08-25T21:00:00.000Z',
    })).rejects.toThrow('owner');
    expect(parameters.reads.enabled).toBe(1);
    expect(parameters.reads.ownerUid).toBe(1);
    expect(parameters.reads.fromEmail).toBe(0);
    expect(parameters.reads.resendApiKey).toBe(0);
    expect(factory).not.toHaveBeenCalled();
    expect(repository.getCalls).toBe(0);
  });

  it('validates non-secret sender authority before reading the Resend secret', async () => {
    const parameters = fakeParameters({ fromEmail: 'not-configured' });
    const repository = new FakeEmailRepository();
    const factory = vi.fn<() => ResendEmailClient>();
    const delivery = createLazyResendScientificReportDeliveryService(
      repository,
      parameters.values,
      factory,
    );

    await expect(delivery.deliver(deliveryInput())).rejects.toThrow('sender');
    expect(parameters.reads.resendApiKey).toBe(0);
    expect(factory).not.toHaveBeenCalled();
    expect(repository.getCalls).toBe(0);
  });

  it('constructs one client lazily for the fixed owner and never invokes it without an archive', async () => {
    const parameters = fakeParameters();
    const repository = new FakeEmailRepository();
    const send = vi.fn();
    const factory = vi.fn((): ResendEmailClient => ({ emails: { send } }));
    const delivery = createLazyResendScientificReportDeliveryService(
      repository,
      parameters.values,
      factory,
    );

    await expect(delivery.deliver(deliveryInput())).resolves.toEqual({
      outcome: 'no_op', reason: 'report_missing',
    });
    await expect(delivery.deliver(deliveryInput())).resolves.toEqual({
      outcome: 'no_op', reason: 'report_missing',
    });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(repository.getCalls).toBe(2);
    expect(send).not.toHaveBeenCalled();
    expect(parameters.reads.enabled).toBe(2);
    expect(parameters.reads.ownerUid).toBe(2);
    expect(parameters.reads.fromEmail).toBe(1);
    expect(parameters.reads.fromName).toBe(1);
    expect(parameters.reads.resendApiKey).toBe(1);
  });

  it('settles routing-off weekly reports without reading route, endpoint, or OpenAI secret', async () => {
    const parameters = fakeAiParameters({ routingEnabled: 'false' });
    const repository = new FakeInterpretationRepository();
    const factory = vi.fn();
    const service = createLazyWeeklyStrategicInterpretationService(
      repository,
      parameters.values,
      factory,
    );

    await expect(service.resolve(UID, weeklyArchive(), NOW)).resolves.toEqual({
      outcome: 'ready', interpretation: null, state: 'skipped',
    });
    expect(repository.events).toEqual(['skip:routing_disabled']);
    expect(parameters.reads).toMatchObject({
      routingEnabled: 1, routingConfig: 0, openAiApiKey: 0, openAiBaseUrl: 0,
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it('does not read OpenAI connection material when a durable control is already stable', async () => {
    const parameters = fakeAiParameters();
    const repository = new FakeInterpretationRepository();
    repository.claimResult = { action: 'stable', interpretation: null, state: 'skipped' };
    const factory = vi.fn();
    const service = createLazyWeeklyStrategicInterpretationService(
      repository,
      parameters.values,
      factory,
    );

    await expect(service.resolve(UID, weeklyArchive(), NOW)).resolves.toMatchObject({
      outcome: 'ready', state: 'skipped',
    });
    expect(repository.events).toEqual(['claim']);
    expect(parameters.reads).toMatchObject({
      routingEnabled: 1, routingConfig: 1, openAiApiKey: 0, openAiBaseUrl: 0,
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it('constructs a zero-retry OpenAI client only after the durable generation claim', async () => {
    const archive = weeklyArchive();
    const parameters = fakeAiParameters();
    const repository = new FakeInterpretationRepository();
    const context = buildWeeklyInterpretationMetricContext(UID, archive);
    const metricIds = context.scalarMetrics.slice(0, 2).map((metric) => metric.id);
    const create = vi.fn(async () => ({
      id: 'response_runtime_weekly',
      model: 'gpt-5.6-luna',
      status: 'completed' as const,
      output: [{ type: 'message' }],
      output_text: JSON.stringify({
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
      }),
      usage: {
        input_tokens: 1_000,
        input_tokens_details: { cached_tokens: 100 },
        output_tokens: 120,
        output_tokens_details: { reasoning_tokens: 20 },
        total_tokens: 1_120,
      },
    }));
    const client: ResponsesClientLike = { responses: { create } };
    const factory = vi.fn(() => client);
    const service = createLazyWeeklyStrategicInterpretationService(
      repository,
      parameters.values,
      factory,
    );

    const result = await service.resolve(UID, archive, NOW);
    expect(result.outcome).toBe('ready');
    if (result.outcome !== 'ready') throw new Error('Expected a ready interpretation.');
    expect(result.interpretation?.reportArtifactHash).toBe(archive.artifactHash);
    expect(repository.events).toEqual(['claim', 'success']);
    expect(factory).toHaveBeenCalledWith(
      'not-a-real-openai-test-key-value',
      {
        baseURL: 'https://api.openai.com/v1',
        allowLoopback: false,
        maxRetries: 0,
      },
    );
    expect(parameters.reads).toMatchObject({
      routingEnabled: 1, routingConfig: 1, openAiApiKey: 1, openAiBaseUrl: 1,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

class RuntimeReader {
  reads = 0;

  constructor(private readonly content: string) {}

  value(): string {
    this.reads += 1;
    return this.content;
  }
}

function fakeParameters(
  overrides: Partial<Record<keyof ScientificReportRuntimeParameters, string>> = {},
) {
  const raw = {
    enabled: 'true',
    ownerUid: UID,
    fromEmail: 'reports@example.test',
    fromName: 'Life Tracker Reports',
    resendApiKey: 'not-a-real-resend-test-key-value',
    ...overrides,
  };
  const readers = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, new RuntimeReader(value)]),
  ) as Record<keyof ScientificReportRuntimeParameters, RuntimeReader>;
  const reads = {} as Record<keyof ScientificReportRuntimeParameters, number>;
  Object.defineProperties(reads, Object.fromEntries(
    Object.entries(readers).map(([key, reader]) => [key, {
      enumerable: true,
      get: () => reader.reads,
    }]),
  ));
  return {
    values: readers as ScientificReportRuntimeParameters,
    reads,
  };
}

function fakeAiParameters(
  overrides: Partial<Record<keyof ScientificReportAiRuntimeParameters, string>> = {},
) {
  const raw = {
    routingEnabled: 'true',
    routingConfig: routingManifest(),
    openAiApiKey: 'not-a-real-openai-test-key-value',
    openAiBaseUrl: 'https://api.openai.com/v1',
    ...overrides,
  };
  const readers = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, new RuntimeReader(value)]),
  ) as Record<keyof ScientificReportAiRuntimeParameters, RuntimeReader>;
  const reads = {} as Record<keyof ScientificReportAiRuntimeParameters, number>;
  Object.defineProperties(reads, Object.fromEntries(
    Object.entries(readers).map(([key, reader]) => [key, {
      enumerable: true,
      get: () => reader.reads,
    }]),
  ));
  return { values: readers as ScientificReportAiRuntimeParameters, reads };
}

function totalReads(reads: Record<keyof ScientificReportRuntimeParameters, number>): number {
  return Object.values(reads).reduce((total, value) => total + value, 0);
}

class FakeEmailRepository implements ScientificReportEmailDeliveryRepository {
  getCalls = 0;

  async getArchive() {
    this.getCalls += 1;
    return null;
  }

  async prepareEmailDelivery(_input: PrepareReportEmailDeliveryInput): Promise<never> {
    throw new Error('Unexpected email preparation.');
  }

  async finalizeEmailDelivery(_input: FinalizeReportEmailDeliveryInput): Promise<never> {
    throw new Error('Unexpected email finalization.');
  }
}

class FakeInterpretationRepository implements WeeklyInterpretationRepository {
  readonly events: string[] = [];
  claimResult: Awaited<ReturnType<WeeklyInterpretationRepository['claim']>> = {
    action: 'generate', claimId: INTERPRETATION_CLAIM_ID,
  };
  private completed: WeeklyInterpretationStableResult | null = null;

  async settleSkipped(input: Parameters<WeeklyInterpretationRepository['settleSkipped']>[0]) {
    this.events.push(`skip:${input.reason}`);
    return { action: 'stable', interpretation: null, state: 'skipped' } as const;
  }

  async claim() {
    this.events.push('claim');
    return this.completed ?? this.claimResult;
  }

  async finalizeSuccess(input: Parameters<WeeklyInterpretationRepository['finalizeSuccess']>[0]) {
    this.events.push('success');
    this.completed = {
      action: 'stable', interpretation: input.interpretation, state: 'complete',
    };
    return this.completed;
  }

  async finalizeFailure() {
    this.events.push('failure');
    this.completed = { action: 'stable', interpretation: null, state: 'failed' };
    return this.completed;
  }
}

function weeklyArchive() {
  const report = buildScientificExecutionReport(reportInput());
  if (report.type !== 'weekly') throw new Error('Expected a weekly report.');
  return createStoredScientificReportArchive(UID, report, NOW);
}

function reportInput(): ScientificReportInput {
  return {
    uid: UID,
    reportType: 'weekly',
    localDate: '2026-08-25',
    timezone: 'Europe/Rome',
    locale: 'en',
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

function routingManifest(): string {
  return JSON.stringify({
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
  });
}

function deliveryInput() {
  return {
    uid: UID,
    reportId: REPORT_ID,
    to: { email: 'recipient@example.test', name: null },
    now: '2026-08-25T21:00:00.000Z',
  };
}

function endpoint(value: unknown): Record<string, unknown> {
  return (value as { __endpoint: Record<string, unknown> }).__endpoint;
}
