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
});
