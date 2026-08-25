import { createHash } from 'node:crypto';
import type { RuntimeReasoningEffort } from '../runtime-config';

export const AI_MODEL_ROUTING_SCHEMA_VERSION = 'life-tracker-ai-routing-v1' as const;
export const AI_MODEL_EVALUATION_SCHEMA_VERSION = 'life-tracker-model-eval-v1' as const;
export const AI_MODEL_PRICE_CATALOG_VERSION = 'openai-pricing-2026-08-25' as const;

export const LIFE_TRACKER_AI_WORKLOADS = [
  'ask',
  'coach',
  'analyze',
  'plan',
  'weekly_strategic_review',
] as const;

export type LifeTrackerAiWorkload = (typeof LIFE_TRACKER_AI_WORKLOADS)[number];
export type LifeTrackerChatMode = Exclude<LifeTrackerAiWorkload, 'weekly_strategic_review'>;
export type LifeTrackerOpenAiModel =
  | 'gpt-5.6-luna'
  | 'gpt-5.6-terra'
  | 'gpt-5.6-sol';

export interface LifeTrackerAiModelRoute {
  readonly model: LifeTrackerOpenAiModel;
  readonly reasoningEffort: RuntimeReasoningEffort;
}

export interface LifeTrackerAiRoutingPolicy {
  readonly schemaVersion: typeof AI_MODEL_ROUTING_SCHEMA_VERSION;
  readonly configId: string;
  readonly evaluationReceiptId: string;
  readonly evaluatedAt: string;
  readonly priceCatalogVersion: typeof AI_MODEL_PRICE_CATALOG_VERSION;
  readonly routes: Readonly<Record<LifeTrackerAiWorkload, LifeTrackerAiModelRoute>>;
}

export interface LifeTrackerAiExecutionProfile {
  readonly workload: LifeTrackerAiWorkload;
  readonly model: string;
  readonly reasoningEffort: RuntimeReasoningEffort;
  readonly timeoutMs: number;
  readonly maxTurns: number;
  readonly maxToolCalls: number;
  readonly maxOutputTokens: number;
  readonly maxTotalToolOutputBytes: number;
  readonly routingConfigId: string | null;
  readonly evaluationReceiptId: string | null;
}

export interface AiRoutingRuntimeStringValue {
  value(): string;
}

export interface AiRoutingRuntimeParameters {
  readonly enabled: AiRoutingRuntimeStringValue;
  readonly config: AiRoutingRuntimeStringValue;
}

export interface WorkloadGuardrail {
  readonly maximumModelTier: number;
  readonly maximumReasoningEffort: number;
  readonly timeoutMs: number;
  readonly maxTurns: number;
  readonly maxToolCalls: number;
  readonly maxOutputTokens: number;
  readonly maxTotalToolOutputBytes: number;
}

const MODEL_TIER: Readonly<Record<LifeTrackerOpenAiModel, number>> = Object.freeze({
  'gpt-5.6-luna': 1,
  'gpt-5.6-terra': 2,
  'gpt-5.6-sol': 3,
});

const REASONING_TIER: Readonly<Record<RuntimeReasoningEffort, number>> = Object.freeze({
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
});

const WORKLOAD_GUARDRAILS: Readonly<Record<LifeTrackerAiWorkload, WorkloadGuardrail>> =
  Object.freeze({
    ask: Object.freeze({
      maximumModelTier: MODEL_TIER['gpt-5.6-terra'],
      maximumReasoningEffort: REASONING_TIER.low,
      timeoutMs: 20_000,
      maxTurns: 3,
      maxToolCalls: 6,
      maxOutputTokens: 800,
      maxTotalToolOutputBytes: 256_000,
    }),
    coach: Object.freeze({
      maximumModelTier: MODEL_TIER['gpt-5.6-terra'],
      maximumReasoningEffort: REASONING_TIER.low,
      timeoutMs: 20_000,
      maxTurns: 3,
      maxToolCalls: 6,
      maxOutputTokens: 800,
      maxTotalToolOutputBytes: 256_000,
    }),
    analyze: Object.freeze({
      maximumModelTier: MODEL_TIER['gpt-5.6-sol'],
      maximumReasoningEffort: REASONING_TIER.high,
      timeoutMs: 30_000,
      maxTurns: 5,
      maxToolCalls: 10,
      maxOutputTokens: 1_200,
      maxTotalToolOutputBytes: 512_000,
    }),
    plan: Object.freeze({
      maximumModelTier: MODEL_TIER['gpt-5.6-sol'],
      maximumReasoningEffort: REASONING_TIER.high,
      timeoutMs: 30_000,
      maxTurns: 6,
      maxToolCalls: 12,
      maxOutputTokens: 1_500,
      maxTotalToolOutputBytes: 512_000,
    }),
    weekly_strategic_review: Object.freeze({
      maximumModelTier: MODEL_TIER['gpt-5.6-sol'],
      maximumReasoningEffort: REASONING_TIER.high,
      timeoutMs: 20_000,
      maxTurns: 1,
      maxToolCalls: 0,
      maxOutputTokens: 900,
      maxTotalToolOutputBytes: 0,
    }),
  });

/**
 * Exact false preserves the verified single-model runtime and does not even
 * read the route manifest. Exact true requires a complete evaluated policy.
 */
export function resolveAiRoutingRuntimePolicy(
  parameters: AiRoutingRuntimeParameters,
): LifeTrackerAiRoutingPolicy | null {
  const enabled = runtimeValue(parameters.enabled, 'AI routing enabled state', 16);
  if (enabled === 'false') return null;
  if (enabled !== 'true') throw new Error('AI routing enabled state is invalid.');
  return parseLifeTrackerAiRoutingPolicy(
    runtimeValue(parameters.config, 'AI routing configuration', 8_192),
  );
}

export function parseLifeTrackerAiRoutingPolicy(value: string): LifeTrackerAiRoutingPolicy {
  if (
    typeof value !== 'string'
    || value.length < 2
    || value.length > 8_192
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error('AI routing configuration is invalid.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('AI routing configuration is invalid.');
  }
  const record = exactRecord(
    parsed,
    ['evaluatedAt', 'evaluationReceiptId', 'priceCatalogVersion', 'routes', 'schemaVersion'],
    'AI routing configuration',
  );
  if (record.schemaVersion !== AI_MODEL_ROUTING_SCHEMA_VERSION) {
    throw new Error('AI routing schema is invalid.');
  }
  const evaluationReceiptId = stringValue(
    record.evaluationReceiptId,
    'AI routing evaluation receipt',
  );
  if (!/^model_eval_[0-9a-f]{64}$/u.test(evaluationReceiptId)) {
    throw new Error('AI routing evaluation receipt is invalid.');
  }
  const evaluatedAt = normalizedInstant(record.evaluatedAt, 'AI routing evaluation time');
  if (record.priceCatalogVersion !== AI_MODEL_PRICE_CATALOG_VERSION) {
    throw new Error('AI routing price catalog is invalid or stale.');
  }
  const rawRoutes = exactRecord(
    record.routes,
    [...LIFE_TRACKER_AI_WORKLOADS],
    'AI routing routes',
  );
  const routes = Object.fromEntries(LIFE_TRACKER_AI_WORKLOADS.map((workload) => [
    workload,
    parseRoute(workload, rawRoutes[workload]),
  ])) as unknown as Record<LifeTrackerAiWorkload, LifeTrackerAiModelRoute>;
  const canonical = {
    schemaVersion: AI_MODEL_ROUTING_SCHEMA_VERSION,
    evaluationReceiptId,
    evaluatedAt,
    priceCatalogVersion: AI_MODEL_PRICE_CATALOG_VERSION,
    routes,
  } as const;
  return Object.freeze({
    ...canonical,
    configId: `sha256:${sha256(canonical)}`,
    routes: Object.freeze(routes),
  });
}

export function chatWorkload(mode: string): LifeTrackerChatMode {
  if (mode === 'ask' || mode === 'coach' || mode === 'analyze' || mode === 'plan') {
    return mode;
  }
  throw new Error('AI chat workload is invalid.');
}

export function routedExecutionProfile(
  policy: LifeTrackerAiRoutingPolicy,
  workload: LifeTrackerAiWorkload,
): LifeTrackerAiExecutionProfile {
  assertWorkload(workload);
  const route = policy.routes[workload];
  if (!route) throw new Error('AI workload route is unavailable.');
  return executionProfile(
    workload,
    route,
    policy.configId,
    policy.evaluationReceiptId,
  );
}

/** Exact legacy limits preserve Goal 1 behavior whenever routing is disabled. */
export function legacyChatExecutionProfile(
  mode: string,
  model: string,
  reasoningEffort: RuntimeReasoningEffort,
): LifeTrackerAiExecutionProfile {
  const workload = chatWorkload(mode);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(model)) {
    throw new Error('Legacy AI model is invalid.');
  }
  if (REASONING_TIER[reasoningEffort] === undefined) {
    throw new Error('Legacy AI reasoning effort is invalid.');
  }
  return Object.freeze({
    workload,
    model,
    reasoningEffort,
    timeoutMs: 30_000,
    maxTurns: 6,
    maxToolCalls: 12,
    maxOutputTokens: 1_500,
    maxTotalToolOutputBytes: 512_000,
    routingConfigId: null,
    evaluationReceiptId: null,
  });
}

export function routingRuntimeMetadata(policy: LifeTrackerAiRoutingPolicy) {
  return Object.freeze({
    configId: policy.configId,
    evaluationReceiptId: policy.evaluationReceiptId,
    evaluatedAt: policy.evaluatedAt,
    priceCatalogVersion: policy.priceCatalogVersion,
    routes: Object.freeze(LIFE_TRACKER_AI_WORKLOADS.map((workload) => Object.freeze({
      workload,
      model: policy.routes[workload].model,
      reasoningEffort: policy.routes[workload].reasoningEffort,
    }))),
  });
}

export function workloadGuardrail(workload: LifeTrackerAiWorkload): WorkloadGuardrail {
  assertWorkload(workload);
  return WORKLOAD_GUARDRAILS[workload];
}

function executionProfile(
  workload: LifeTrackerAiWorkload,
  route: LifeTrackerAiModelRoute,
  routingConfigId: string,
  evaluationReceiptId: string,
): LifeTrackerAiExecutionProfile {
  validateRoute(workload, route);
  const limits = WORKLOAD_GUARDRAILS[workload];
  return Object.freeze({
    workload,
    ...route,
    timeoutMs: limits.timeoutMs,
    maxTurns: limits.maxTurns,
    maxToolCalls: limits.maxToolCalls,
    maxOutputTokens: limits.maxOutputTokens,
    maxTotalToolOutputBytes: limits.maxTotalToolOutputBytes,
    routingConfigId,
    evaluationReceiptId,
  });
}

function parseRoute(
  workload: LifeTrackerAiWorkload,
  value: unknown,
): LifeTrackerAiModelRoute {
  const record = exactRecord(value, ['model', 'reasoningEffort'], `AI ${workload} route`);
  const route = Object.freeze({
    model: modelValue(record.model),
    reasoningEffort: reasoningValue(record.reasoningEffort),
  });
  validateRoute(workload, route);
  return route;
}

function validateRoute(
  workload: LifeTrackerAiWorkload,
  route: LifeTrackerAiModelRoute,
): void {
  const limits = WORKLOAD_GUARDRAILS[workload];
  if (MODEL_TIER[route.model] > limits.maximumModelTier) {
    throw new Error(`AI ${workload} route exceeds its model cost ceiling.`);
  }
  if (REASONING_TIER[route.reasoningEffort] > limits.maximumReasoningEffort) {
    throw new Error(`AI ${workload} route exceeds its reasoning cost ceiling.`);
  }
}

function modelValue(value: unknown): LifeTrackerOpenAiModel {
  if (value !== 'gpt-5.6-luna' && value !== 'gpt-5.6-terra' && value !== 'gpt-5.6-sol') {
    throw new Error('AI route model is invalid.');
  }
  return value;
}

function reasoningValue(value: unknown): RuntimeReasoningEffort {
  if (
    value !== 'none'
    && value !== 'low'
    && value !== 'medium'
    && value !== 'high'
    && value !== 'xhigh'
    && value !== 'max'
  ) {
    throw new Error('AI route reasoning effort is invalid.');
  }
  return value;
}

function assertWorkload(value: string): asserts value is LifeTrackerAiWorkload {
  if (!LIFE_TRACKER_AI_WORKLOADS.includes(value as LifeTrackerAiWorkload)) {
    throw new Error('AI workload is invalid.');
  }
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} is invalid.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields are invalid.`);
  }
  return value as Record<string, unknown>;
}

function normalizedInstant(value: unknown, label: string): string {
  const string = stringValue(value, label);
  const epoch = Date.parse(string);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== string) {
    throw new Error(`${label} is invalid.`);
  }
  return string;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function runtimeValue(
  parameter: AiRoutingRuntimeStringValue,
  label: string,
  maximum: number,
): string {
  const value = parameter.value();
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
