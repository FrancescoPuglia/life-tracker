import { randomUUID } from 'node:crypto';
import { DomainError, isDomainError, type DomainErrorCode } from '../domain/errors';
import type { AuthContext } from '../domain/types';
import { parseBearerToken } from './auth';
import { applyCors } from './cors';
import { applyRequestSchema, chatRequestSchema, parsePathId, rollbackRequestSchema } from './schemas';
import type {
  ApiApplication,
  HeaderValue,
  HttpRequestLike,
  HttpResponseLike,
  RateLimiter,
  TokenVerifier,
} from './types';

const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 60_000;

export interface ApiHandlerDependencies {
  readonly application: ApiApplication;
  readonly tokenVerifier: TokenVerifier;
  readonly rateLimiter: RateLimiter;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly releaseId: string;
  readonly clock?: () => Date;
  readonly requestId?: () => string;
}

export function createApiHandler(dependencies: ApiHandlerDependencies) {
  return async (request: HttpRequestLike, response: HttpResponseLike): Promise<void> => {
    const requestId = dependencies.requestId?.() ?? randomUUID();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Request-Id', requestId);

    try {
      const origin = header(request.headers, 'origin');
      if (!applyCors(origin, dependencies.allowedOrigins, response)) {
        throw new DomainError('FORBIDDEN', 'Origin is not allowed.');
      }
      const method = request.method?.toUpperCase() ?? '';
      if (method === 'OPTIONS') {
        response.status(204).end();
        return;
      }
      const path = requestPath(request);
      if (method === 'GET' && path === '/v1/health') {
        response.status(200).json({
          status: 'ok',
          service: 'life-tracker-ai',
          releaseId: dependencies.releaseId,
          requestId,
        });
        return;
      }
      if (method !== 'POST') throw new DomainError('NOT_FOUND', 'Route not found.');
      requireJsonRequest(request);

      const token = parseBearerToken(header(request.headers, 'authorization'));
      const identity = await dependencies.tokenVerifier.verifyBearerToken(token);
      const context: AuthContext = { uid: identity.uid, requestId };
      const now = dependencies.clock?.() ?? new Date();

      if (path === '/v1/chat') {
        const body = chatRequestSchema.parse(request.body);
        await dependencies.rateLimiter.consume({
          uid: context.uid,
          bucket: 'chat',
          limit: 10,
          windowMs: RATE_WINDOW_MS,
          now,
        });
        const result = await dependencies.application.chat(context, body);
        response.status(200).json({ ...result, requestId });
        return;
      }

      const applyMatch = path.match(/^\/v1\/plans\/([^/]+)\/apply$/);
      if (applyMatch?.[1]) {
        const planId = parsePathId(applyMatch[1]);
        const body = applyRequestSchema.parse(request.body);
        await dependencies.rateLimiter.consume({
          uid: context.uid,
          bucket: 'apply',
          limit: 20,
          windowMs: RATE_WINDOW_MS,
          now,
        });
        const result = await dependencies.application.applyPlan(context, planId, body);
        response.status(200).json({ ...result, requestId });
        return;
      }

      const rollbackMatch = path.match(/^\/v1\/executions\/([^/]+)\/rollback$/);
      if (rollbackMatch?.[1]) {
        const executionId = parsePathId(rollbackMatch[1]);
        const body = rollbackRequestSchema.parse(request.body);
        await dependencies.rateLimiter.consume({
          uid: context.uid,
          bucket: 'rollback',
          limit: 20,
          windowMs: RATE_WINDOW_MS,
          now,
        });
        const result = await dependencies.application.rollbackExecution(context, executionId, body);
        response.status(200).json({ ...result, requestId });
        return;
      }

      throw new DomainError('NOT_FOUND', 'Route not found.');
    } catch (error) {
      sendError(response, requestId, error);
    }
  };
}

function requireJsonRequest(request: HttpRequestLike): void {
  const contentType = header(request.headers, 'content-type');
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new DomainError('INVALID_ARGUMENT', 'A JSON request body is required.');
  }
  const size = request.rawBody?.byteLength ?? Buffer.byteLength(JSON.stringify(request.body ?? null), 'utf8');
  if (size > MAX_BODY_BYTES) throw new DomainError('LIMIT_EXCEEDED', 'Request body is too large.');
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new DomainError('INVALID_ARGUMENT', 'A JSON object body is required.');
  }
}

function requestPath(request: HttpRequestLike): string {
  if (request.path?.startsWith('/')) return request.path;
  try {
    return new URL(request.url ?? '/', 'https://function.invalid').pathname;
  } catch {
    return '/';
  }
}

function header(headers: HttpRequestLike['headers'], name: string): HeaderValue {
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
}

function sendError(response: HttpResponseLike, requestId: string, error: unknown): void {
  const normalized = normalizeError(error);
  if (normalized.retryAfterSeconds !== undefined) {
    response.setHeader('Retry-After', String(normalized.retryAfterSeconds));
  }
  response.status(normalized.status).json({
    error: { code: normalized.code, message: normalized.message },
    requestId,
  });
}

function normalizeError(error: unknown): {
  readonly code: string;
  readonly message: string;
  readonly status: number;
  readonly retryAfterSeconds?: number;
} {
  if (isZodError(error)) return { code: 'INVALID_ARGUMENT', message: 'Invalid request.', status: 400 };
  if (!isDomainError(error)) return { code: 'INTERNAL', message: 'Request failed.', status: 500 };
  const mapping: Record<DomainErrorCode, readonly [number, string]> = {
    UNAUTHENTICATED: [401, 'Authentication is required.'],
    FORBIDDEN: [403, 'Request is not allowed.'],
    INVALID_ARGUMENT: [400, 'Invalid request.'],
    NOT_FOUND: [404, 'Resource not found.'],
    CONFLICT: [409, 'Request conflicts with current state.'],
    EXPIRED: [409, 'The requested capability has expired.'],
    UNKNOWN_TOOL: [422, 'The requested operation is not available.'],
    LIMIT_EXCEEDED: [413, 'Request exceeds a safe limit.'],
    RATE_LIMITED: [429, 'Too many requests.'],
    STATE_CHANGED: [409, 'The preview is stale; create a new preview.'],
    APPROVAL_REQUIRED: [403, 'Valid approval is required.'],
    APPROVAL_REPLAYED: [409, 'Approval has already been consumed.'],
    COMMITTED_UNVERIFIED: [503, 'The change committed but verification is pending. Retry with the same idempotency key.'],
    PROVIDER_UNAVAILABLE: [503, 'The AI provider is unavailable.'],
    INTERNAL: [500, 'Request failed.'],
  };
  const [status, message] = mapping[error.code];
  const retry = error.code === 'RATE_LIMITED' && typeof error.details?.retryAfterSeconds === 'number'
    ? Math.max(1, Math.min(3_600, Math.ceil(error.details.retryAfterSeconds)))
    : undefined;
  return retry === undefined
    ? { code: error.code, message, status }
    : { code: error.code, message, status, retryAfterSeconds: retry };
}

function isZodError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'ZodError');
}
