import { describe, expect, it } from 'vitest';
import {
  AI_MODEL_ROUTING_SCHEMA_VERSION,
  AI_MODEL_PRICE_CATALOG_VERSION,
  chatWorkload,
  legacyChatExecutionProfile,
  parseLifeTrackerAiRoutingPolicy,
  resolveAiRoutingRuntimePolicy,
  routedExecutionProfile,
  routingRuntimeMetadata,
} from '../../src/ai/model-routing';

const RECEIPT = `model_eval_${'a'.repeat(64)}`;
const EVALUATED_AT = '2026-08-25T12:00:00.000Z';

describe('evaluated AI workload routing policy', () => {
  it('reads only the exact kill switch while routing is disabled', () => {
    const enabled = new Reader('false');
    const config = new Reader('hostile config must remain unread');

    expect(resolveAiRoutingRuntimePolicy({ enabled, config })).toBeNull();
    expect(enabled.reads).toBe(1);
    expect(config.reads).toBe(0);
  });

  it('parses one complete receipt-bound policy and derives immutable cost bounds', () => {
    const policy = parseLifeTrackerAiRoutingPolicy(validConfig());

    expect(policy.configId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(routedExecutionProfile(policy, 'ask')).toMatchObject({
      model: 'gpt-5.6-luna',
      reasoningEffort: 'low',
      timeoutMs: 20_000,
      maxTurns: 3,
      maxToolCalls: 6,
      maxOutputTokens: 800,
      routingConfigId: policy.configId,
      evaluationReceiptId: RECEIPT,
    });
    expect(routedExecutionProfile(policy, 'plan')).toMatchObject({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      timeoutMs: 30_000,
      maxTurns: 6,
      maxToolCalls: 12,
      maxOutputTokens: 1_500,
    });
    expect(routedExecutionProfile(policy, 'weekly_strategic_review')).toMatchObject({
      maxTurns: 1,
      maxToolCalls: 0,
      maxOutputTokens: 900,
    });
    expect(routingRuntimeMetadata(policy)).toEqual({
      configId: policy.configId,
      evaluationReceiptId: RECEIPT,
      evaluatedAt: EVALUATED_AT,
      priceCatalogVersion: AI_MODEL_PRICE_CATALOG_VERSION,
      routes: [
        { workload: 'ask', model: 'gpt-5.6-luna', reasoningEffort: 'low' },
        { workload: 'coach', model: 'gpt-5.6-luna', reasoningEffort: 'low' },
        { workload: 'analyze', model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
        { workload: 'plan', model: 'gpt-5.6-sol', reasoningEffort: 'medium' },
        { workload: 'weekly_strategic_review', model: 'gpt-5.6-sol', reasoningEffort: 'medium' },
      ],
    });
  });

  it('rejects incomplete, unevaluated, arbitrary, and over-ceiling routes', () => {
    const base = JSON.parse(validConfig()) as any;
    expect(() => parseLifeTrackerAiRoutingPolicy(JSON.stringify({
      ...base,
      evaluationReceiptId: 'not-evaluated',
    }))).toThrow('receipt');
    const missing = structuredClone(base);
    delete missing.routes.coach;
    expect(() => parseLifeTrackerAiRoutingPolicy(JSON.stringify(missing))).toThrow('fields');
    const arbitrary = structuredClone(base);
    arbitrary.routes.analyze.model = 'gpt-unbounded-expensive';
    expect(() => parseLifeTrackerAiRoutingPolicy(JSON.stringify(arbitrary))).toThrow('model');
    const expensiveAsk = structuredClone(base);
    expensiveAsk.routes.ask.model = 'gpt-5.6-sol';
    expect(() => parseLifeTrackerAiRoutingPolicy(JSON.stringify(expensiveAsk)))
      .toThrow('cost ceiling');
    const excessiveReasoning = structuredClone(base);
    excessiveReasoning.routes.coach.reasoningEffort = 'medium';
    expect(() => parseLifeTrackerAiRoutingPolicy(JSON.stringify(excessiveReasoning)))
      .toThrow('reasoning cost ceiling');
    const staleCatalog = structuredClone(base);
    staleCatalog.priceCatalogVersion = 'openai-pricing-old';
    expect(() => parseLifeTrackerAiRoutingPolicy(JSON.stringify(staleCatalog)))
      .toThrow('catalog');
    const extra = structuredClone(base);
    extra.routes.ask.fallbackModel = 'gpt-5.6-sol';
    expect(() => parseLifeTrackerAiRoutingPolicy(JSON.stringify(extra))).toThrow('fields');
  });

  it('fails closed on malformed enable state before reading a route manifest', () => {
    const enabled = new Reader('TRUE');
    const config = new Reader(validConfig());

    expect(() => resolveAiRoutingRuntimePolicy({ enabled, config })).toThrow('enabled state');
    expect(config.reads).toBe(0);
  });

  it('preserves the exact Goal 1 legacy limits when routing is absent', () => {
    expect(legacyChatExecutionProfile('analyze', 'gpt-5.6-sol', 'medium')).toEqual({
      workload: 'analyze',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      timeoutMs: 30_000,
      maxTurns: 6,
      maxToolCalls: 12,
      maxOutputTokens: 1_500,
      maxTotalToolOutputBytes: 512_000,
      routingConfigId: null,
      evaluationReceiptId: null,
    });
    expect(chatWorkload('ask')).toBe('ask');
    expect(() => chatWorkload('weekly_strategic_review')).toThrow('chat workload');
    expect(() => legacyChatExecutionProfile('forged', 'gpt-5.6-sol', 'medium')).toThrow();
  });
});

class Reader {
  reads = 0;
  constructor(private readonly content: string) {}

  value(): string {
    this.reads += 1;
    return this.content;
  }
}

function validConfig(): string {
  return JSON.stringify({
    schemaVersion: AI_MODEL_ROUTING_SCHEMA_VERSION,
    evaluationReceiptId: RECEIPT,
    evaluatedAt: EVALUATED_AT,
    priceCatalogVersion: AI_MODEL_PRICE_CATALOG_VERSION,
    routes: {
      ask: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
      coach: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
      analyze: { model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
      plan: { model: 'gpt-5.6-sol', reasoningEffort: 'medium' },
      weekly_strategic_review: { model: 'gpt-5.6-sol', reasoningEffort: 'medium' },
    },
  });
}
