import {
  parseLifePlanActionResponse,
  parseLifePlanPreview,
  type LifePlanAction,
  type LifePlanActionResponse,
  type LifePlanPreview,
} from '@life-tracker/ai-contract';

const PROVIDER_CREDENTIAL_PATTERNS = [
  /sk-(?:proj-)?[A-Za-z0-9_-]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
] as const;

const FORBIDDEN_EVIDENCE_KEYS = new Set([
  'password',
  'idtoken',
  'refreshtoken',
  'accesstoken',
  'approvalcapability',
  'rollbackcapability',
  'authorization',
  'openaiapikey',
  'clientsecret',
  'privatekey',
]);

export interface ExpectedPlanChange {
  readonly tool: string;
  readonly action: LifePlanAction;
  readonly entityType: string;
  readonly entityId?: string;
  readonly title: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly changedFields: readonly string[];
  readonly beforeFields?: Readonly<Record<string, unknown>>;
  readonly afterFields: Readonly<Record<string, unknown>>;
  readonly requiresWpiMarker?: boolean;
}

export interface ExpectedActionResult {
  readonly planId: string;
  readonly changesetHash: string;
  readonly status: 'applied' | 'rolled_back';
  readonly idempotentReplay: boolean;
  readonly affected: readonly Readonly<{ collection: string; id: string }>[];
  readonly executionId?: string;
}

export interface SafeStagingHttpFailure {
  readonly status: number;
  readonly errorCode: string;
  readonly requestId: string | null;
}

export class StagingHttpFailure extends Error {
  readonly evidence: SafeStagingHttpFailure;

  constructor(evidence: SafeStagingHttpFailure) {
    super('Staging HTTP request failed safely.');
    this.name = 'StagingHttpFailure';
    this.evidence = evidence;
  }
}

/** Retain only an allowlisted failure tuple; never retain the response body. */
export function requireStagingHttpStatus(
  status: number,
  body: unknown,
  requestId: string | null,
  expectedStatus = 200,
): void {
  if (status === expectedStatus) return;
  throw new StagingHttpFailure({
    status,
    errorCode: safeErrorCode(body),
    requestId: safeRequestId(requestId),
  });
}

export function stagingHttpFailureEvidence(error: unknown): SafeStagingHttpFailure | null {
  return error instanceof StagingHttpFailure ? error.evidence : null;
}

export function requireFrontendBuildCommit(actual: string | null, expected: string): void {
  if (!/^[a-f0-9]{40}$/.test(expected) || actual !== expected) {
    throw new Error('Staging frontend source marker does not match the clean committed checkout.');
  }
}

/**
 * Response checks deliberately throw fixed classifications. Never let an
 * assertion framework serialize a body that can contain an approval or
 * rollback capability into CI output.
 */
export function assertNoProviderCredentialMaterial(value: unknown): void {
  const serialized = safeSerialize(value);
  if (
    PROVIDER_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(serialized))
    || serialized.includes('OPENAI_API_KEY')
  ) {
    fail('Staging response contained forbidden provider credential material.');
  }
}

/** Evidence artifacts are stricter than live responses and must never retain capabilities. */
export function assertEvidenceSafe(value: unknown): void {
  assertNoProviderCredentialMaterial(value);
  visitEvidence(value, 0);
}

/** Never let a failed no-plan assertion serialize an approval capability. */
export function assertNoPlan(value: unknown): void {
  if (value !== undefined) {
    fail('Staging analysis unexpectedly returned a mutation proposal.');
  }
}

export function requireExactPlan(
  status: number,
  value: unknown,
  expected: ExpectedPlanChange,
): LifePlanPreview {
  if (status !== 200) fail('Staging proposal did not return HTTP 200.');
  let plan: LifePlanPreview;
  try {
    plan = parseLifePlanPreview(value);
  } catch {
    fail('Staging proposal violated the canonical LifePlan contract.');
  }

  if (
    plan.tool !== expected.tool
    || plan.status !== 'previewed'
    || plan.operations.length !== 1
    || plan.diff.length !== 1
    || plan.conflicts.length !== 0
    || plan.destructiveOperationCount !== 0
  ) {
    fail('Staging proposal did not contain one conflict-free non-destructive operation.');
  }

  const operation = plan.operations[0];
  const diff = plan.diff[0];
  if (
    !operation
    || !diff
    || operation.action !== expected.action
    || operation.entityType !== expected.entityType
    || (expected.entityId !== undefined && operation.entityId !== expected.entityId)
    || diff.action !== expected.action
    || diff.entityType !== expected.entityType
    || diff.entityId !== operation.entityId
    || diff.title !== expected.title
  ) {
    fail('Staging proposal operation identity did not match the requested change.');
  }

  if (expected.action === 'create' ? diff.before !== null : diff.before === null) {
    fail('Staging proposal before-state did not match the requested action.');
  }
  const computedChangedFields = changedFields(diff.before, diff.after);
  if (
    !sameStrings(diff.changedFields, expected.changedFields)
    || !sameStrings(computedChangedFields, expected.changedFields)
  ) {
    fail('Staging proposal changed fields outside the exact requested scope.');
  }
  if (
    !diff.after
    || canonicalInstant(diff.after.startTime) !== canonicalInstant(expected.startTime)
    || canonicalInstant(diff.after.endTime) !== canonicalInstant(expected.endTime)
  ) {
    fail('Staging proposal after-state interval did not match the requested change.');
  }
  if (
    (expected.beforeFields && !fieldsMatch(diff.before, expected.beforeFields))
    || !fieldsMatch(diff.after, expected.afterFields)
  ) {
    fail('Staging proposal before/after values did not match the exact requested change.');
  }
  if (expected.requiresWpiMarker) {
    const notes = diff.after.notes;
    const escapedId = escapeRegExp(operation.entityId);
    if (
      typeof notes !== 'string'
      || !new RegExp(`^WPI_KEY: wpi:ai_draft_[a-f0-9]{20}:${escapedId}$`).test(notes)
    ) {
      fail('Staging proposal did not contain exactly one server-generated WPI marker.');
    }
  }
  return plan;
}

export function requireExactActionResponse(
  status: number,
  value: unknown,
  expected: ExpectedActionResult,
): LifePlanActionResponse {
  if (status !== 200) fail('Staging plan action did not return HTTP 200.');
  let result: LifePlanActionResponse;
  try {
    result = parseLifePlanActionResponse(value);
  } catch {
    fail('Staging plan action violated the canonical action contract.');
  }

  if (
    result.planId !== expected.planId
    || result.hash !== expected.changesetHash
    || result.status !== expected.status
    || result.idempotentReplay !== expected.idempotentReplay
    || !result.verified
    || (expected.executionId !== undefined && result.executionId !== expected.executionId)
    || !sameReferences(result.receipt.affected, expected.affected)
  ) {
    fail('Staging plan action was not bound to the expected plan, status, and affected set.');
  }
  return result;
}

export function assertCapabilityShape(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{32,512}$/.test(value)) {
    fail('Staging action capability had an invalid shape.');
  }
}

function sameReferences(
  actual: readonly Readonly<{ collection: string; id: string }>[],
  expected: readonly Readonly<{ collection: string; id: string }>[],
): boolean {
  if (actual.length !== expected.length) return false;
  const normalize = (values: readonly Readonly<{ collection: string; id: string }>[]) =>
    values.map(({ collection, id }) => `${collection}\0${id}`).sort();
  const left = normalize(actual);
  const right = normalize(expected);
  return left.every((value, index) => value === right[index]);
}

function safeErrorCode(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'UNKNOWN';
  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return 'UNKNOWN';
  const code = (error as Record<string, unknown>).code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_:-]{0,79}$/.test(code) ? code : 'UNKNOWN';
}

function safeRequestId(value: string | null): string | null {
  return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

function canonicalInstant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function fieldsMatch(
  actual: Readonly<Record<string, unknown>> | null,
  expected: Readonly<Record<string, unknown>>,
): boolean {
  if (!actual) return false;
  return Object.entries(expected).every(([key, value]) =>
    canonicalJson(actual[key]) === canonicalJson(value));
}

function changedFields(
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>> | null,
): readonly string[] {
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...fields]
    .filter((field) => canonicalJson(before?.[field]) !== canonicalJson(after?.[field]))
    .filter((field) => !['id', 'createdAt', 'updatedAt'].includes(field))
    .sort();
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(',')}}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function visitEvidence(value: unknown, depth: number): void {
  if (depth > 12) fail('Staging evidence exceeded its safe nesting bound.');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return;
  if (typeof value === 'string') return;
  if (Array.isArray(value)) {
    for (const item of value) visitEvidence(item, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object') {
    fail('Staging evidence contained an unsupported value.');
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_EVIDENCE_KEYS.has(key.replace(/[^A-Za-z0-9]/g, '').toLowerCase())) {
      fail('Staging evidence contained a forbidden credential or capability field.');
    }
    visitEvidence(nested, depth + 1);
  }
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    fail('Staging value could not be inspected safely.');
  }
}

function fail(message: string): never {
  throw new Error(message);
}
