import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../src/domain/errors';
import { createApiHandler } from '../../src/http/handler';
import type {
  ApiApplication,
  HttpRequestLike,
  HttpResponseLike,
  RateLimiter,
  TokenVerifier,
} from '../../src/http/types';

const VALID_TOKEN = 'opaque-test-token-segment-safe-length';
const ALLOWED_ORIGIN = 'https://francescopuglia.github.io';
const FIXED_NOW = new Date('2026-08-16T12:00:00.000Z');

class ResponseRecorder implements HttpResponseLike {
  statusCode = 200;
  readonly headers = new Map<string, string>();
  body: unknown;
  ended = false;

  status(code: number): HttpResponseLike {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  json(value: unknown): void {
    this.body = value;
    this.ended = true;
  }

  send(value?: unknown): void {
    this.body = value;
    this.ended = true;
  }

  end(): void {
    this.ended = true;
  }
}

describe('Life Tracker HTTP API boundary', () => {
  let application: ApiApplication;
  let tokenVerifier: TokenVerifier;
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    application = {
      chat: vi.fn(async () => ({ message: 'grounded answer' })),
      applyPlan: vi.fn(async () => ({ executionId: 'execution-1', status: 'applied' })),
      rollbackExecution: vi.fn(async () => ({ executionId: 'execution-1', status: 'rolled_back' })),
    };
    tokenVerifier = {
      verifyBearerToken: vi.fn(async () => ({ uid: 'verified-user-a' })),
    };
    rateLimiter = { consume: vi.fn(async () => undefined) };
  });

  it('serves a non-secret health response without authentication', async () => {
    const response = await execute({ method: 'GET', path: '/v1/health', headers: {} });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      service: 'life-tracker-ai',
      releaseId: 'sha256:test-release',
      runtimeConfig: {
        configId: 'sha256:test-runtime',
        model: 'test-model',
        reasoningEffort: 'low',
        promptVersion: 'test-prompt',
        schemaVersion: 'test-schema',
      },
      requestId: 'request-test-1',
    });
    expect(tokenVerifier.verifyBearerToken).not.toHaveBeenCalled();
  });

  it('answers preflight only for an explicit allowed origin', async () => {
    const response = await execute({
      method: 'OPTIONS',
      path: '/v1/chat',
      headers: { origin: ALLOWED_ORIGIN },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(tokenVerifier.verifyBearerToken).not.toHaveBeenCalled();
  });

  it('rejects an untrusted browser origin before authentication', async () => {
    const response = await execute({
      method: 'POST',
      path: '/v1/chat',
      headers: jsonHeaders({ origin: 'https://attacker.example' }),
      body: validChatBody(),
    });
    expect(response.statusCode).toBe(403);
    expect(errorCode(response)).toBe('FORBIDDEN');
    expect(tokenVerifier.verifyBearerToken).not.toHaveBeenCalled();
  });

  it('denies a missing Authorization header', async () => {
    const response = await execute({
      method: 'POST',
      path: '/v1/chat',
      headers: { 'content-type': 'application/json' },
      body: validChatBody(),
    });
    expect(response.statusCode).toBe(401);
    expect(errorCode(response)).toBe('UNAUTHENTICATED');
    expect(application.chat).not.toHaveBeenCalled();
  });

  it('rejects non-JSON bodies and unsupported methods before authentication', async () => {
    const nonJson = await execute({
      method: 'POST',
      path: '/v1/chat',
      headers: { 'content-type': 'text/plain', authorization: `Bearer ${VALID_TOKEN}` },
      body: validChatBody(),
    });
    expect(nonJson.statusCode).toBe(400);
    expect(errorCode(nonJson)).toBe('INVALID_ARGUMENT');

    const unsupported = await execute({
      method: 'PUT',
      path: '/v1/chat',
      headers: jsonHeaders(),
      body: validChatBody(),
    });
    expect(unsupported.statusCode).toBe(404);
    expect(errorCode(unsupported)).toBe('NOT_FOUND');
    expect(tokenVerifier.verifyBearerToken).not.toHaveBeenCalled();
  });

  it('denies a malformed Bearer token', async () => {
    const response = await execute({
      method: 'POST',
      path: '/v1/chat',
      headers: { 'content-type': 'application/json', authorization: 'Bearer short' },
      body: validChatBody(),
    });
    expect(response.statusCode).toBe(401);
    expect(tokenVerifier.verifyBearerToken).not.toHaveBeenCalled();
  });

  it('normalizes invalid, expired, or revoked Firebase tokens', async () => {
    tokenVerifier = {
      verifyBearerToken: vi.fn(async () => {
        throw new DomainError('UNAUTHENTICATED', 'provider detail that must not leak');
      }),
    };
    const response = await execute(authenticatedRequest('/v1/chat', validChatBody()));
    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' },
      requestId: 'request-test-1',
    });
  });

  it('derives application context only from verified identity', async () => {
    const response = await execute(authenticatedRequest('/v1/chat', validChatBody()));
    expect(response.statusCode).toBe(200);
    expect(application.chat).toHaveBeenCalledWith(
      { uid: 'verified-user-a', requestId: 'request-test-1' },
      { message: 'Analyze my week', mode: 'analyze', history: [] },
    );
    expect(rateLimiter.consume).toHaveBeenCalledWith({
      uid: 'verified-user-a',
      bucket: 'chat',
      limit: 10,
      windowMs: 60_000,
      now: FIXED_NOW,
    });
  });

  it('rejects a client-supplied userId instead of treating it as authority', async () => {
    const response = await execute(authenticatedRequest('/v1/chat', {
      ...validChatBody(),
      userId: 'user-b',
    }));
    expect(response.statusCode).toBe(400);
    expect(errorCode(response)).toBe('INVALID_ARGUMENT');
    expect(application.chat).not.toHaveBeenCalled();
  });

  it('rejects oversized request bodies before token verification', async () => {
    const response = await execute({
      ...authenticatedRequest('/v1/chat', validChatBody()),
      rawBody: Buffer.alloc(64 * 1024 + 1),
    });
    expect(response.statusCode).toBe(413);
    expect(tokenVerifier.verifyBearerToken).not.toHaveBeenCalled();
  });

  it('requires exact user-held approval input for apply', async () => {
    const body = {
      approvalCapability: 'a'.repeat(43),
      idempotencyKey: 'idempotency-key-0001',
    };
    const response = await execute(authenticatedRequest('/v1/plans/plan-1/apply', body));
    expect(response.statusCode).toBe(200);
    expect(application.applyPlan).toHaveBeenCalledWith(
      { uid: 'verified-user-a', requestId: 'request-test-1' },
      'plan-1',
      body,
    );
  });

  it('routes rollback as an authenticated execution action, not a model tool', async () => {
    const body = {
      rollbackCapability: 'r'.repeat(43),
      idempotencyKey: 'idempotency-key-0002',
    };
    const response = await execute(authenticatedRequest('/v1/executions/execution-1/rollback', body));
    expect(response.statusCode).toBe(200);
    expect(application.rollbackExecution).toHaveBeenCalledWith(
      { uid: 'verified-user-a', requestId: 'request-test-1' },
      'execution-1',
      body,
    );
  });

  it('returns a shared-instance rate-limit response with Retry-After', async () => {
    rateLimiter = {
      consume: vi.fn(async () => {
        throw new DomainError('RATE_LIMITED', 'internal limiter detail', { retryAfterSeconds: 17.2 });
      }),
    };
    const response = await execute(authenticatedRequest('/v1/chat', validChatBody()));
    expect(response.statusCode).toBe(429);
    expect(errorCode(response)).toBe('RATE_LIMITED');
    expect(response.headers.get('retry-after')).toBe('18');
    expect(application.chat).not.toHaveBeenCalled();
  });

  it('does not expose unexpected error details', async () => {
    application.chat = vi.fn(async () => {
      throw new Error('private note and provider credential detail');
    });
    const response = await execute(authenticatedRequest('/v1/chat', validChatBody()));
    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('private note');
    expect(response.body).toEqual({
      error: { code: 'INTERNAL', message: 'Request failed.' },
      requestId: 'request-test-1',
    });
  });

  it('returns a typed non-secret 503 when the Responses provider is unavailable', async () => {
    application.chat = vi.fn(async () => {
      throw new DomainError('PROVIDER_UNAVAILABLE', 'private provider quota detail');
    });
    const response = await execute(authenticatedRequest('/v1/chat', validChatBody()));
    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      error: { code: 'PROVIDER_UNAVAILABLE', message: 'The AI provider is unavailable.' },
      requestId: 'request-test-1',
    });
    expect(JSON.stringify(response.body)).not.toContain('quota');
  });

  async function execute(request: HttpRequestLike): Promise<ResponseRecorder> {
    const response = new ResponseRecorder();
    const handler = createApiHandler({
      application,
      tokenVerifier,
      rateLimiter,
      allowedOrigins: new Set([ALLOWED_ORIGIN, 'http://localhost:3000']),
      releaseId: 'sha256:test-release',
      runtimeConfig: {
        configId: 'sha256:test-runtime',
        model: 'test-model',
        reasoningEffort: 'low',
        promptVersion: 'test-prompt',
        schemaVersion: 'test-schema',
      },
      clock: () => FIXED_NOW,
      requestId: () => 'request-test-1',
    });
    await handler(request, response);
    return response;
  }
});

function authenticatedRequest(path: string, body: Record<string, unknown>): HttpRequestLike {
  return { method: 'POST', path, headers: jsonHeaders(), body };
}

function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${VALID_TOKEN}`,
    ...extra,
  };
}

function validChatBody(): Record<string, unknown> {
  return { message: 'Analyze my week', mode: 'analyze', history: [] };
}

function errorCode(response: ResponseRecorder): unknown {
  return (response.body as { error?: { code?: unknown } })?.error?.code;
}
