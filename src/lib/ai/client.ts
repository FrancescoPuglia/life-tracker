import { auth } from '@/lib/firebase';

export const AI_CHAT_MODES = ['ask', 'plan', 'analyze', 'coach'] as const;

export type AIChatMode = (typeof AI_CHAT_MODES)[number];

export interface AIConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIPlanPreview {
  id: string;
  hash: string;
  expiresAt: string;
  operationCount: number;
  diff: AIPlanDiffEntry[];
  warnings: string[];
  conflicts: string[];
  status: string;
}

export interface AIPlanDiffEntry {
  action: 'create' | 'update' | 'delete' | 'replace';
  entityType: string;
  entityId?: string;
  summary: string;
  changedFields: string[];
}

export interface AIChatResult {
  message: string;
  plan?: AIPlanPreview;
}

export type AIClientErrorCode =
  | 'not_configured'
  | 'auth_required'
  | 'session_expired'
  | 'forbidden'
  | 'rate_limited'
  | 'conflict'
  | 'invalid_request'
  | 'invalid_response'
  | 'unavailable';

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_MESSAGE_LENGTH = 4_000;
const MAX_RESPONSE_MESSAGE_LENGTH = 20_000;
const MAX_PLAN_NOTICE_LENGTH = 500;
const MAX_PLAN_OPERATIONS = 50;
const PLAN_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;
const ENTITY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
const PLAN_ACTIONS = ['create', 'update', 'delete', 'replace'] as const;

const SAFE_ERROR_MESSAGES: Record<AIClientErrorCode, string> = {
  not_configured: 'Il backend AI non è configurato per questa installazione.',
  auth_required: 'Accedi al tuo account per usare l’AI cloud.',
  session_expired: 'La sessione è scaduta. Accedi di nuovo e riprova.',
  forbidden: 'Non sei autorizzato a eseguire questa operazione.',
  rate_limited: 'Hai raggiunto il limite di richieste. Attendi un momento e riprova.',
  conflict: 'Il piano è in conflitto con modifiche più recenti. Genera una nuova anteprima.',
  invalid_request: 'La richiesta non è valida. Controlla il testo e riprova.',
  invalid_response: 'Il backend AI ha restituito una risposta non valida.',
  unavailable: 'Il servizio AI non è raggiungibile in questo momento. Riprova più tardi.',
};

export class AIClientError extends Error {
  constructor(
    public readonly code: AIClientErrorCode,
    public readonly status?: number,
  ) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = 'AIClientError';
  }
}

/**
 * Returns the configured external backend origin/path. Relative URLs are
 * deliberately rejected: a GitHub Pages export must never fall back to a
 * same-origin Next.js route that does not exist at runtime.
 */
export function getAIBackendBaseUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_AI_API_BASE_URL?.trim();
  if (!configured) return null;

  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function isAIBackendConfigured(): boolean {
  return getAIBackendBaseUrl() !== null;
}

export async function requestAIChat(input: {
  message: string;
  mode: AIChatMode;
  history?: AIConversationMessage[];
}): Promise<AIChatResult> {
  const message = normalizeRequiredText(input.message, MAX_MESSAGE_LENGTH);
  if (!AI_CHAT_MODES.includes(input.mode)) {
    throw new AIClientError('invalid_request', 400);
  }

  const history = (input.history ?? [])
    .slice(-MAX_HISTORY_MESSAGES)
    .map((entry) => {
      if (entry.role !== 'user' && entry.role !== 'assistant') {
        throw new AIClientError('invalid_request', 400);
      }
      return {
        role: entry.role,
        content: normalizeHistoryText(entry.content),
      };
    });

  const data = await authenticatedRequest('/v1/chat', {
    body: {
      message,
      mode: input.mode,
      history,
    },
  });

  return normalizeChatResult(data);
}

export async function applyAIPlan(
  planId: string,
  idempotencyKey: string,
): Promise<AIChatResult> {
  return requestPlanAction(planId, 'apply', idempotencyKey);
}

export async function rollbackAIPlan(
  planId: string,
  idempotencyKey: string,
): Promise<AIChatResult> {
  return requestPlanAction(planId, 'rollback', idempotencyKey);
}

export function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new AIClientError('unavailable');
}

async function requestPlanAction(
  planId: string,
  action: 'apply' | 'rollback',
  idempotencyKey: string,
): Promise<AIChatResult> {
  if (!PLAN_ID_PATTERN.test(planId) || !isValidIdempotencyKey(idempotencyKey)) {
    throw new AIClientError('invalid_request', 400);
  }

  const data = await authenticatedRequest(`/v1/plans/${encodeURIComponent(planId)}/${action}`, {
    body: { idempotencyKey },
  });

  return normalizeChatResult(data, action === 'apply'
    ? 'Piano applicato in modo sicuro.'
    : 'Rollback completato.');
}

async function authenticatedRequest(
  path: string,
  options: { body: Record<string, unknown> },
): Promise<unknown> {
  const baseUrl = getAIBackendBaseUrl();
  if (!baseUrl) throw new AIClientError('not_configured');

  const currentUser = auth.currentUser;
  if (!currentUser) throw new AIClientError('auth_required', 401);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const initialToken = await currentUser.getIdToken(false);
    let response = await sendRequest(
      `${baseUrl}${path}`,
      initialToken,
      options.body,
      controller.signal,
    );

    // A token may expire between acquisition and verification. Refresh once;
    // never retry any other status automatically.
    if (response.status === 401) {
      const refreshedToken = await currentUser.getIdToken(true);
      response = await sendRequest(
        `${baseUrl}${path}`,
        refreshedToken,
        options.body,
        controller.signal,
      );
    }

    if (!response.ok) throw mapHttpError(response.status);

    try {
      return await response.json();
    } catch {
      throw new AIClientError('invalid_response', response.status);
    }
  } catch (error) {
    if (error instanceof AIClientError) throw error;
    throw new AIClientError('unavailable');
  } finally {
    clearTimeout(timeout);
  }
}

function sendRequest(
  url: string,
  token: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });
}

function mapHttpError(status: number): AIClientError {
  if (status === 401) return new AIClientError('session_expired', status);
  if (status === 403) return new AIClientError('forbidden', status);
  if (status === 409) return new AIClientError('conflict', status);
  if (status === 429) return new AIClientError('rate_limited', status);
  if (status === 400 || status === 404 || status === 413 || status === 422) {
    return new AIClientError('invalid_request', status);
  }
  return new AIClientError('unavailable', status);
}

function normalizeChatResult(
  value: unknown,
  fallbackMessage?: string,
): AIChatResult {
  const record = asRecord(value);
  if (!record) throw new AIClientError('invalid_response');

  // `response` is accepted only for a short compatibility window while old
  // environments move to the canonical `message` field.
  const rawMessage = typeof record.message === 'string'
    ? record.message
    : typeof record.response === 'string'
      ? record.response
      : fallbackMessage;
  if (!rawMessage) throw new AIClientError('invalid_response');

  const plan = normalizePlan(record.plan);
  return {
    message: normalizeResponseText(rawMessage, MAX_RESPONSE_MESSAGE_LENGTH),
    ...(plan ? { plan } : {}),
  };
}

function normalizePlan(value: unknown): AIPlanPreview | undefined {
  if (value === undefined || value === null) return undefined;
  const plan = asRecord(value);
  if (!plan) throw new AIClientError('invalid_response');

  if (
    typeof plan.id !== 'string'
    || !PLAN_ID_PATTERN.test(plan.id)
    || typeof plan.hash !== 'string'
    || plan.hash.length < 8
    || plan.hash.length > 256
    || typeof plan.expiresAt !== 'string'
    || Number.isNaN(Date.parse(plan.expiresAt))
    || !Array.isArray(plan.operations)
    || plan.operations.length > MAX_PLAN_OPERATIONS
    || !Array.isArray(plan.diff)
    || plan.diff.length !== plan.operations.length
    || !Array.isArray(plan.warnings)
    || !Array.isArray(plan.conflicts)
    || typeof plan.status !== 'string'
  ) {
    throw new AIClientError('invalid_response');
  }

  return {
    id: plan.id,
    hash: plan.hash,
    expiresAt: plan.expiresAt,
    operationCount: plan.operations.length,
    diff: normalizePlanDiff(plan.diff),
    warnings: normalizeNotices(plan.warnings),
    conflicts: normalizeNotices(plan.conflicts),
    status: normalizeResponseText(plan.status, 64),
  };
}

function normalizePlanDiff(values: unknown[]): AIPlanDiffEntry[] {
  return values.map((value) => {
    const entry = asRecord(value);
    if (
      !entry
      || typeof entry.action !== 'string'
      || !PLAN_ACTIONS.includes(entry.action as AIPlanDiffEntry['action'])
      || typeof entry.entityType !== 'string'
      || !ENTITY_NAME_PATTERN.test(entry.entityType)
      || (entry.entityId !== undefined && (
        typeof entry.entityId !== 'string'
        || !PLAN_ID_PATTERN.test(entry.entityId)
      ))
      || typeof entry.summary !== 'string'
      || !Array.isArray(entry.changedFields)
      || entry.changedFields.length > 30
      || !entry.changedFields.every((field) => (
        typeof field === 'string' && FIELD_NAME_PATTERN.test(field)
      ))
    ) {
      throw new AIClientError('invalid_response');
    }

    return {
      action: entry.action as AIPlanDiffEntry['action'],
      entityType: entry.entityType,
      ...(entry.entityId ? { entityId: entry.entityId as string } : {}),
      summary: normalizeResponseText(entry.summary, MAX_PLAN_NOTICE_LENGTH),
      changedFields: [...entry.changedFields] as string[],
    };
  });
}

function normalizeNotices(values: unknown[]): string[] {
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .slice(0, 20)
    .map((value) => normalizeResponseText(value, MAX_PLAN_NOTICE_LENGTH));
}

function normalizeRequiredText(value: string, maxLength: number): string {
  const normalized = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AIClientError('invalid_request', 400);
  }
  return normalized;
}

function normalizeHistoryText(value: string): string {
  if (typeof value !== 'string') throw new AIClientError('invalid_request', 400);
  const normalized = stripControlCharacters(value).trim();
  if (!normalized) throw new AIClientError('invalid_request', 400);
  return normalized.slice(0, MAX_HISTORY_MESSAGE_LENGTH);
}

function normalizeResponseText(value: string, maxLength: number): string {
  const normalized = stripControlCharacters(value).trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AIClientError('invalid_response');
  }
  return normalized;
}

function stripControlCharacters(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function isValidIdempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,160}$/.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname === '::1';
}
