import { createHash } from 'node:crypto';

export type RuntimeReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type RuntimeAiWorkload =
  | 'ask'
  | 'coach'
  | 'analyze'
  | 'plan'
  | 'weekly_strategic_review';

export interface RuntimeModelRouteMetadata {
  readonly workload: RuntimeAiWorkload;
  readonly model: string;
  readonly reasoningEffort: RuntimeReasoningEffort;
}

export interface RuntimeModelRoutingMetadata {
  readonly configId: string;
  readonly evaluationReceiptId: string;
  readonly evaluatedAt: string;
  readonly priceCatalogVersion: string;
  readonly routes: readonly RuntimeModelRouteMetadata[];
}

export interface RuntimeConfigInput {
  readonly model: string;
  readonly reasoningEffort: RuntimeReasoningEffort;
  readonly providerBaseUrl: string;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly timeoutMs: number;
  readonly maxTurns: number;
  readonly maxToolCalls: number;
  readonly maxOutputTokens: number;
  readonly routing?: RuntimeModelRoutingMetadata;
}

/** Safe metadata exposed by health checks and receipts; sensitive values never enter it. */
export interface RuntimeConfigMetadata {
  readonly configId: string;
  readonly model: string;
  readonly reasoningEffort: RuntimeReasoningEffort;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly routing?: RuntimeModelRoutingMetadata;
}

/**
 * Attest the exact non-secret runtime policy independently from the source
 * fingerprint. The canonical manifest includes origins/provider URL only in
 * the digest; health responses expose neither value.
 */
export function createRuntimeConfigMetadata(input: RuntimeConfigInput): RuntimeConfigMetadata {
  const model = safeIdentifier(input.model, 'model');
  const reasoningEffort = safeReasoningEffort(input.reasoningEffort);
  const promptVersion = safeIdentifier(input.promptVersion, 'prompt version');
  const schemaVersion = safeIdentifier(input.schemaVersion, 'schema version');
  const providerBaseUrl = safeBoundedText(input.providerBaseUrl, 'provider base URL', 512);
  const allowedOrigins = [...input.allowedOrigins]
    .map((origin) => safeBoundedText(origin, 'allowed origin', 512))
    .sort();
  if (allowedOrigins.length === 0) throw new Error('At least one allowed origin is required.');
  const routing = input.routing ? safeRoutingMetadata(input.routing) : undefined;

  const commonManifest = {
    model,
    reasoningEffort,
    providerBaseUrl,
    allowedOrigins,
    promptVersion,
    schemaVersion,
    timeoutMs: positiveInteger(input.timeoutMs, 'timeout'),
    maxTurns: positiveInteger(input.maxTurns, 'maximum turns'),
    maxToolCalls: positiveInteger(input.maxToolCalls, 'maximum tool calls'),
    maxOutputTokens: positiveInteger(input.maxOutputTokens, 'maximum output tokens'),
  } as const;
  const canonicalManifest = routing
    ? { version: 2, ...commonManifest, routing }
    : { version: 1, ...commonManifest };
  const configId = `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalManifest))
    .digest('hex')}`;

  return Object.freeze({
    configId,
    model,
    reasoningEffort,
    promptVersion,
    schemaVersion,
    ...(routing ? { routing } : {}),
  });
}

function safeRoutingMetadata(input: RuntimeModelRoutingMetadata): RuntimeModelRoutingMetadata {
  if (!/^sha256:[0-9a-f]{64}$/.test(input.configId)) {
    throw new Error('Runtime routing configuration ID is invalid.');
  }
  if (!/^model_eval_[0-9a-f]{64}$/.test(input.evaluationReceiptId)) {
    throw new Error('Runtime routing evaluation receipt is invalid.');
  }
  const evaluatedAt = normalizedInstant(input.evaluatedAt, 'routing evaluation time');
  const priceCatalogVersion = safeIdentifier(
    input.priceCatalogVersion,
    'routing price catalog version',
  );
  if (!Array.isArray(input.routes) || input.routes.length !== 5) {
    throw new Error('Runtime routing routes are invalid.');
  }
  const workloads: readonly RuntimeAiWorkload[] = [
    'ask', 'coach', 'analyze', 'plan', 'weekly_strategic_review',
  ];
  const routes = input.routes.map((route) => {
    if (!workloads.includes(route.workload)) {
      throw new Error('Runtime routing workload is invalid.');
    }
    return Object.freeze({
      workload: route.workload,
      model: safeIdentifier(route.model, 'routing model'),
      reasoningEffort: safeReasoningEffort(route.reasoningEffort),
    });
  }).sort((left, right) => left.workload.localeCompare(right.workload));
  if (new Set(routes.map((route) => route.workload)).size !== workloads.length) {
    throw new Error('Runtime routing workloads are incomplete.');
  }
  return Object.freeze({
    configId: input.configId,
    evaluationReceiptId: input.evaluationReceiptId,
    evaluatedAt,
    priceCatalogVersion,
    routes: Object.freeze(routes),
  });
}

function safeReasoningEffort(value: string): RuntimeReasoningEffort {
  if (!['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value)) {
    throw new Error('Runtime reasoning effort is invalid.');
  }
  return value as RuntimeReasoningEffort;
}

function safeIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`Runtime ${label} is invalid.`);
  }
  return value;
}

function safeBoundedText(value: string, label: string, maximumLength: number): string {
  if (!value || value.length > maximumLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Runtime ${label} is invalid.`);
  }
  return value;
}

function normalizedInstant(value: string, label: string): string {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    throw new Error(`Runtime ${label} is invalid.`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000) {
    throw new Error(`Runtime ${label} is invalid.`);
  }
  return value;
}
