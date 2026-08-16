import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@/lib/firebase';
import {
  AIClientError,
  applyAIPlan,
  getAIBackendBaseUrl,
  requestAIChat,
  rollbackAIPlan,
} from './client';

const API_BASE_URL = 'https://ai.example.test/life-tracker';

function setCurrentUser(getIdToken: ReturnType<typeof vi.fn> | null) {
  (auth as unknown as { currentUser: unknown }).currentUser = getIdToken
    ? { getIdToken }
    : null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('authenticated AI client', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_AI_API_BASE_URL = API_BASE_URL;
    setCurrentUser(vi.fn().mockResolvedValue('firebase-id-token'));
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_AI_API_BASE_URL;
    setCurrentUser(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requires an absolute configured backend and never falls back to a local route', async () => {
    process.env.NEXT_PUBLIC_AI_API_BASE_URL = '/api';
    expect(getAIBackendBaseUrl()).toBeNull();

    await expect(requestAIChat({ message: 'Ciao', mode: 'ask' })).rejects.toMatchObject({
      code: 'not_configured',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows plain HTTP only for loopback development backends', () => {
    process.env.NEXT_PUBLIC_AI_API_BASE_URL = 'http://api.example.test';
    expect(getAIBackendBaseUrl()).toBeNull();

    process.env.NEXT_PUBLIC_AI_API_BASE_URL = 'http://127.0.0.1:5001/local-api/';
    expect(getAIBackendBaseUrl()).toBe('http://127.0.0.1:5001/local-api');
  });

  it('requires a signed-in Firebase user before making a request', async () => {
    setCurrentUser(null);

    await expect(requestAIChat({ message: 'Ciao', mode: 'ask' })).rejects.toMatchObject({
      code: 'auth_required',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends only message, mode, and bounded history with a Firebase bearer token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'Risposta sicura' }));

    const result = await requestAIChat({
      message: '  Organizza domani  ',
      mode: 'plan',
      history: [{ role: 'assistant', content: 'Contesto conversazione' }],
    });

    expect(result).toEqual({ message: 'Risposta sicura' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/v1/chat`);
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer firebase-id-token',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      message: 'Organizza domani',
      mode: 'plan',
      history: [{ role: 'assistant', content: 'Contesto conversazione' }],
    });
    expect(body).not.toHaveProperty('userId');
    expect(body).not.toHaveProperty('uid');
    expect(body).not.toHaveProperty('context');
  });

  it('refreshes an expired token once after 401 and reuses the same request body', async () => {
    const getIdToken = vi.fn()
      .mockResolvedValueOnce('stale-token')
      .mockResolvedValueOnce('fresh-token');
    setCurrentUser(getIdToken);
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: 'ignored' }, 401))
      .mockResolvedValueOnce(jsonResponse({ message: 'Autenticato' }));

    await expect(requestAIChat({ message: 'Ciao', mode: 'ask' })).resolves.toEqual({
      message: 'Autenticato',
    });

    expect(getIdToken).toHaveBeenNthCalledWith(1, false);
    expect(getIdToken).toHaveBeenNthCalledWith(2, true);
    expect(fetch).toHaveBeenCalledTimes(2);
    const first = vi.mocked(fetch).mock.calls[0][1];
    const second = vi.mocked(fetch).mock.calls[1][1];
    expect(first?.body).toBe(second?.body);
    expect(first?.headers).toMatchObject({ Authorization: 'Bearer stale-token' });
    expect(second?.headers).toMatchObject({ Authorization: 'Bearer fresh-token' });
  });

  it.each([
    [403, 'forbidden'],
    [409, 'conflict'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
  ] as const)('maps HTTP %s to a safe %s error without exposing response details', async (status, code) => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      error: 'internal stack and provider details must stay hidden',
    }, status));

    let caught: unknown;
    try {
      await requestAIChat({ message: 'Ciao', mode: 'ask' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AIClientError);
    const error = caught as AIClientError;
    expect(error.code).toBe(code);
    expect(error.message).not.toContain('internal stack');
    expect(error.message).not.toContain('provider details');
  });

  it('normalizes a canonical immutable plan preview without exposing operations', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      message: 'Controlla il piano',
      plan: {
        id: 'plan_123',
        hash: '0123456789abcdef',
        expiresAt: '2030-01-01T10:00:00.000Z',
        operations: [{ collection: 'tasks', before: { private: true } }],
        diff: [{
          action: 'update',
          entityType: 'task',
          entityId: 'task_123',
          summary: 'Sposta la scadenza al giorno successivo',
          changedFields: ['dueDate'],
          before: { private: 'must not be copied' },
        }],
        warnings: ['Un blocco protetto sarà preservato'],
        conflicts: [],
        status: 'preview',
      },
    }));

    await expect(requestAIChat({ message: 'Pianifica', mode: 'plan' })).resolves.toEqual({
      message: 'Controlla il piano',
      plan: {
        id: 'plan_123',
        hash: '0123456789abcdef',
        expiresAt: '2030-01-01T10:00:00.000Z',
        operationCount: 1,
        diff: [{
          action: 'update',
          entityType: 'task',
          entityId: 'task_123',
          summary: 'Sposta la scadenza al giorno successivo',
          changedFields: ['dueDate'],
        }],
        warnings: ['Un blocco protetto sarà preservato'],
        conflicts: [],
        status: 'preview',
      },
    });
  });

  it('uses authenticated plan endpoints and keeps the idempotency key in the body', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ message: 'Piano applicato' }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Rollback completato' }));
    const idempotencyKey = 'idem_1234567890123456';

    await applyAIPlan('plan_123', idempotencyKey);
    await rollbackAIPlan('plan_123', idempotencyKey);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      `${API_BASE_URL}/v1/plans/plan_123/apply`,
      expect.objectContaining({ body: JSON.stringify({ idempotencyKey }) }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `${API_BASE_URL}/v1/plans/plan_123/rollback`,
      expect.objectContaining({ body: JSON.stringify({ idempotencyKey }) }),
    );
  });

  it('rejects invalid plan identifiers before network access', async () => {
    await expect(applyAIPlan('../cross-user', 'idem_1234567890123456')).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
