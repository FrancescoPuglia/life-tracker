import { auth } from '@/lib/firebase';
import { getConfiguredAIBackendBaseUrl } from '@/lib/ai/backendConfig';
import { firebaseConfig } from '@/config/firebaseConfig';
import {
  parseLifePlanActionResponse,
  parseLifePlanPreview,
  type LifePlanActionResponse,
  type LifePlanPreview,
} from '@life-tracker/ai-contract';

export const AI_CHAT_MODES = ['ask', 'plan', 'analyze', 'coach'] as const;

export type AIChatMode = (typeof AI_CHAT_MODES)[number];

export interface AIConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type AIPlanPreview = LifePlanPreview;
export type AIPlanActionResult = LifePlanActionResponse;

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
  | 'state_changed'
  | 'approval_expired'
  | 'approval_replayed'
  | 'committed_unverified'
  | 'invalid_request'
  | 'invalid_response'
  | 'unavailable';

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_MESSAGE_LENGTH = 4_000;
const MAX_RESPONSE_MESSAGE_LENGTH = 20_000;
const PLAN_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;

const SAFE_ERROR_MESSAGES: Record<AIClientErrorCode, string> = {
  not_configured: 'Il backend AI non è configurato per questa installazione.',
  auth_required: 'Accedi al tuo account per usare l’AI cloud.',
  session_expired: 'La sessione è scaduta. Accedi di nuovo e riprova.',
  forbidden: 'Non sei autorizzato a eseguire questa operazione.',
  rate_limited: 'Hai raggiunto il limite di richieste. Attendi un momento e riprova.',
  conflict: 'Il piano è in conflitto con modifiche più recenti. Genera una nuova anteprima.',
  state_changed: 'L’anteprima non è più aggiornata. Genera un nuovo piano prima di applicarlo.',
  approval_expired: 'L’approvazione è scaduta. Genera una nuova anteprima.',
  approval_replayed: 'Questa approvazione è già stata usata. Le modifiche non sono state applicate di nuovo.',
  committed_unverified: 'Le modifiche potrebbero essere state salvate, ma la verifica non è riuscita. Riprova con la stessa richiesta.',
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
  return getConfiguredAIBackendBaseUrl();
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
  plan: AIPlanPreview,
  idempotencyKey: string,
): Promise<AIPlanActionResult> {
  return requestPlanAction(
    `/v1/plans/${encodeURIComponent(plan.id)}/apply`,
    {
      approvalCapability: plan.approval.capability,
      idempotencyKey,
    },
    {
      planId: plan.id,
      hash: plan.hash,
      status: 'applied',
    },
  );
}

export async function rollbackAIExecution(
  executionId: string,
  rollbackCapability: string,
  idempotencyKey: string,
  expectedPlan: Readonly<{ planId: string; hash: string }>,
): Promise<AIPlanActionResult> {
  return requestPlanAction(
    `/v1/executions/${encodeURIComponent(executionId)}/rollback`,
    { rollbackCapability, idempotencyKey },
    {
      executionId,
      planId: expectedPlan.planId,
      hash: expectedPlan.hash,
      status: 'rolled_back',
    },
  );
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
  path: string,
  body: Readonly<Record<string, string>>,
  expected: Readonly<{
    executionId?: string;
    planId: string;
    hash: string;
    status: 'applied' | 'rolled_back';
  }>,
): Promise<AIPlanActionResult> {
  const resourceId = path.split('/')[3] ?? '';
  const capability = body.approvalCapability ?? body.rollbackCapability ?? '';
  if (
    !PLAN_ID_PATTERN.test(resourceId)
    || !isValidIdempotencyKey(body.idempotencyKey ?? '')
    || !isValidCapability(capability)
  ) {
    throw new AIClientError('invalid_request', 400);
  }

  const data = await authenticatedRequest(path, { body: { ...body } });
  try {
    const result = parseLifePlanActionResponse(data);
    const authoritativeRollbackReplay = expected.status === 'applied'
      && result.status === 'rolled_back'
      && result.idempotentReplay;
    if (
      result.planId !== expected.planId
      || result.hash !== expected.hash
      || (result.status !== expected.status && !authoritativeRollbackReplay)
      || (expected.executionId !== undefined && result.executionId !== expected.executionId)
    ) {
      throw new Error('response binding mismatch');
    }
    return result;
  } catch {
    throw new AIClientError('invalid_response');
  }
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
    const initialToken = await getProjectBoundFirebaseToken(currentUser, false);
    let response = await sendRequest(
      `${baseUrl}${path}`,
      initialToken,
      options.body,
      controller.signal,
    );

    // A token may expire between acquisition and verification. Refresh once;
    // never retry any other status automatically.
    if (response.status === 401) {
      const refreshedToken = await getProjectBoundFirebaseToken(currentUser, true);
      response = await sendRequest(
        `${baseUrl}${path}`,
        refreshedToken,
        options.body,
        controller.signal,
      );
    }

    if (!response.ok) throw await mapHttpError(response);

    try {
      return await response.json();
    } catch {
      throw new AIClientError('invalid_response', response.status);
    }
  } catch (error) {
    if (error instanceof AIClientError) throw error;
    if (isFirebaseSessionCredentialError(error)) {
      throw new AIClientError('session_expired', 401);
    }
    throw new AIClientError('unavailable');
  } finally {
    clearTimeout(timeout);
  }
}

async function getProjectBoundFirebaseToken(
  currentUser: NonNullable<typeof auth.currentUser>,
  forceRefresh: boolean,
): Promise<string> {
  const tokenResult = await currentUser.getIdTokenResult(forceRefresh);
  const expectedProjectId = firebaseConfig.projectId;
  const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;
  if (
    tokenResult.claims.aud !== expectedProjectId
    || tokenResult.claims.iss !== expectedIssuer
  ) {
    throw new AIClientError('session_expired', 401);
  }
  return tokenResult.token;
}

function isFirebaseSessionCredentialError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && new Set([
    'auth/id-token-expired',
    'auth/invalid-user-token',
    'auth/user-disabled',
    'auth/user-token-expired',
  ]).has(code);
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

async function mapHttpError(response: Response): Promise<AIClientError> {
  const status = response.status;
  const serverCode = await readServerErrorCode(response);
  if (status === 401) return new AIClientError('session_expired', status);
  if (status === 403) return new AIClientError('forbidden', status);
  if (status === 409 && serverCode === 'STATE_CHANGED') return new AIClientError('state_changed', status);
  if (status === 409 && serverCode === 'EXPIRED') return new AIClientError('approval_expired', status);
  if (status === 409 && serverCode === 'APPROVAL_REPLAYED') return new AIClientError('approval_replayed', status);
  if (status === 409) return new AIClientError('conflict', status);
  if (status === 429) return new AIClientError('rate_limited', status);
  if (status === 503 && serverCode === 'COMMITTED_UNVERIFIED') {
    return new AIClientError('committed_unverified', status);
  }
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
  try {
    return parseLifePlanPreview(value);
  } catch {
    throw new AIClientError('invalid_response');
  }
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

function isValidCapability(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,512}$/.test(value);
}

async function readServerErrorCode(response: Response): Promise<string | null> {
  try {
    const envelope = asRecord(await response.json());
    const error = asRecord(envelope?.error);
    return typeof error?.code === 'string' ? error.code : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
