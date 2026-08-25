import { describe, expect, it } from 'vitest';
import { createRuntimeConfigMetadata, type RuntimeConfigInput } from '../src/runtime-config';

const BASE: RuntimeConfigInput = {
  model: 'gpt-5.6-sol',
  reasoningEffort: 'medium',
  providerBaseUrl: 'https://api.openai.com/v1',
  allowedOrigins: new Set([
    'https://life-tracker-staging.web.app',
    'https://tauri.localhost',
    'http://127.0.0.1:3300',
  ]),
  promptVersion: 'life-tracker-secure-v1',
  schemaVersion: 'life-plan-v1',
  timeoutMs: 30_000,
  maxTurns: 6,
  maxToolCalls: 12,
  maxOutputTokens: 1_500,
};

describe('runtime configuration attestation', () => {
  it('is deterministic across origin insertion order and exposes only safe metadata', () => {
    const first = createRuntimeConfigMetadata(BASE);
    const second = createRuntimeConfigMetadata({
      ...BASE,
      allowedOrigins: new Set([...BASE.allowedOrigins].reverse()),
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      configId: 'sha256:6ef03a915ff73a9d688bd416fd13a622b9effc9c5573963d39eb85d563e50a7f',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      promptVersion: 'life-tracker-secure-v1',
      schemaVersion: 'life-plan-v1',
    });
    expect(first).not.toHaveProperty('providerBaseUrl');
    expect(first).not.toHaveProperty('allowedOrigins');
  });

  it.each([
    ['model', { model: 'gpt-5.6-terra' }],
    ['reasoning', { reasoningEffort: 'high' as const }],
    ['provider', { providerBaseUrl: 'http://127.0.0.1:8787/v1' }],
    ['origins', { allowedOrigins: new Set(['http://127.0.0.1:3300']) }],
    ['prompt', { promptVersion: 'life-tracker-secure-v2' }],
    ['schema', { schemaVersion: 'life-plan-v2' }],
    ['limits', { maxToolCalls: 8 }],
  ])('changes when the %s policy changes', (_label, change) => {
    expect(createRuntimeConfigMetadata({ ...BASE, ...change }).configId)
      .not.toBe(createRuntimeConfigMetadata(BASE).configId);
  });

  it('fails closed on invalid or empty public policy fields', () => {
    expect(() => createRuntimeConfigMetadata({ ...BASE, model: 'bad model\n' })).toThrow();
    expect(() => createRuntimeConfigMetadata({
      ...BASE,
      reasoningEffort: 'invalid' as RuntimeConfigInput['reasoningEffort'],
    })).toThrow();
    expect(() => createRuntimeConfigMetadata({ ...BASE, allowedOrigins: new Set() })).toThrow();
    expect(() => createRuntimeConfigMetadata({ ...BASE, maxTurns: 0 })).toThrow();
  });

  it('attests evaluated routing only when present and keeps legacy metadata unchanged', () => {
    const routing = {
      configId: `sha256:${'a'.repeat(64)}`,
      evaluationReceiptId: `model_eval_${'b'.repeat(64)}`,
      evaluatedAt: '2026-08-25T12:00:00.000Z',
      priceCatalogVersion: 'openai-pricing-2026-08-25',
      routes: [
        { workload: 'plan', model: 'gpt-5.6-sol', reasoningEffort: 'medium' },
        { workload: 'ask', model: 'gpt-5.6-luna', reasoningEffort: 'low' },
        { workload: 'coach', model: 'gpt-5.6-luna', reasoningEffort: 'low' },
        { workload: 'analyze', model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
        { workload: 'weekly_strategic_review', model: 'gpt-5.6-sol', reasoningEffort: 'medium' },
      ],
    } as const;
    const routed = createRuntimeConfigMetadata({ ...BASE, routing });

    expect(createRuntimeConfigMetadata(BASE).configId)
      .toBe('sha256:6ef03a915ff73a9d688bd416fd13a622b9effc9c5573963d39eb85d563e50a7f');
    expect(routed.configId).not.toBe(createRuntimeConfigMetadata(BASE).configId);
    expect(routed.routing?.routes.map((item) => item.workload)).toEqual([
      'analyze', 'ask', 'coach', 'plan', 'weekly_strategic_review',
    ]);
    expect(routed).not.toHaveProperty('providerBaseUrl');
    expect(routed).not.toHaveProperty('allowedOrigins');

    expect(() => createRuntimeConfigMetadata({
      ...BASE,
      routing: { ...routing, routes: routing.routes.slice(0, 4) },
    })).toThrow('routes');
    expect(() => createRuntimeConfigMetadata({
      ...BASE,
      routing: { ...routing, routes: routing.routes.map(() => routing.routes[0]!) },
    })).toThrow('incomplete');
  });
});
