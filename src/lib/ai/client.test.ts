import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@/lib/firebase';
import {
  AIClientError,
  applyAIPlan,
  getAIBackendBaseUrl,
  requestAIChat,
  rollbackAIExecution,
  type AIPlanPreview,
} from './client';

const API_BASE_URL = 'https://europe-west1-life-tracker-12000.cloudfunctions.net/lifeTrackerAiApi';
const FIREBASE_PROJECT_ID = 'life-tracker-12000';
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;

function tokenResult(
  token: string,
  claims: Readonly<Record<string, unknown>> = {
    aud: FIREBASE_PROJECT_ID,
    iss: FIREBASE_ISSUER,
  },
) {
  return { token, claims };
}

function setCurrentUser(getIdTokenResult: ReturnType<typeof vi.fn> | null) {
  (auth as unknown as { currentUser: unknown }).currentUser = getIdTokenResult
    ? { getIdTokenResult }
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
    setCurrentUser(vi.fn().mockResolvedValue(tokenResult('firebase-id-token')));
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_AI_API_BASE_URL;
    delete process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR;
    setCurrentUser(null);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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

  it('rejects arbitrary HTTPS hosts and allows only the exact emulator path in explicit development', () => {
    process.env.NEXT_PUBLIC_AI_API_BASE_URL = 'https://attacker.example/lifeTrackerAiApi';
    expect(getAIBackendBaseUrl()).toBeNull();

    vi.stubEnv('NODE_ENV', 'development');
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR = 'true';
    process.env.NEXT_PUBLIC_AI_API_BASE_URL =
      'http://127.0.0.1:5001/life-tracker-12000/europe-west1/lifeTrackerAiApi/';
    expect(getAIBackendBaseUrl()).toBe(
      'http://127.0.0.1:5001/life-tracker-12000/europe-west1/lifeTrackerAiApi',
    );
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
    const getIdTokenResult = vi.fn()
      .mockResolvedValueOnce(tokenResult('stale-token'))
      .mockResolvedValueOnce(tokenResult('fresh-token'));
    setCurrentUser(getIdTokenResult);
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: 'ignored' }, 401))
      .mockResolvedValueOnce(jsonResponse({ message: 'Autenticato' }));

    await expect(requestAIChat({ message: 'Ciao', mode: 'ask' })).resolves.toEqual({
      message: 'Autenticato',
    });

    expect(getIdTokenResult).toHaveBeenNthCalledWith(1, false);
    expect(getIdTokenResult).toHaveBeenNthCalledWith(2, true);
    expect(fetch).toHaveBeenCalledTimes(2);
    const first = vi.mocked(fetch).mock.calls[0][1];
    const second = vi.mocked(fetch).mock.calls[1][1];
    expect(first?.body).toBe(second?.body);
    expect(first?.headers).toMatchObject({ Authorization: 'Bearer stale-token' });
    expect(second?.headers).toMatchObject({ Authorization: 'Bearer fresh-token' });
  });

  it('stops after one token refresh when the backend still returns 401', async () => {
    const getIdTokenResult = vi.fn()
      .mockResolvedValueOnce(tokenResult('stale-token'))
      .mockResolvedValueOnce(tokenResult('refreshed-but-invalid-token'));
    setCurrentUser(getIdTokenResult);
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHENTICATED' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHENTICATED' } }, 401));

    await expect(requestAIChat({ message: 'Ciao', mode: 'ask' })).rejects.toMatchObject({
      code: 'session_expired',
      status: 401,
    });
    expect(getIdTokenResult).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['audience', { aud: 'other-project', iss: FIREBASE_ISSUER }],
    ['issuer', { aud: FIREBASE_PROJECT_ID, iss: 'https://securetoken.google.com/other-project' }],
    ['missing claims', {}],
  ] as const)('rejects a token with a mismatched %s before network access', async (_label, claims) => {
    setCurrentUser(vi.fn().mockResolvedValue(tokenResult('must-not-leave-browser', claims)));

    await expect(requestAIChat({ message: 'Ciao', mode: 'ask' })).rejects.toMatchObject({
      code: 'session_expired',
      status: 401,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('distinguishes rejected Firebase credentials from a network outage', async () => {
    setCurrentUser(vi.fn().mockRejectedValue({ code: 'auth/user-token-expired' }));

    await expect(requestAIChat({ message: 'Ciao', mode: 'ask' })).rejects.toMatchObject({
      code: 'session_expired',
      status: 401,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps Firebase token network failures recoverable as unavailable', async () => {
    setCurrentUser(vi.fn().mockRejectedValue({ code: 'auth/network-request-failed' }));

    await expect(requestAIChat({ message: 'Ciao', mode: 'ask' })).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(fetch).not.toHaveBeenCalled();
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

  it('validates the canonical immutable plan preview shared with the backend', async () => {
    const plan = validPlan();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      message: 'Controlla il piano',
      plan,
    }));

    await expect(requestAIChat({ message: 'Pianifica', mode: 'plan' })).resolves.toEqual({
      message: 'Controlla il piano',
      plan,
    });
  });

  it('binds apply to the exact approval and rollback to its execution capability', async () => {
    const plan = validPlan();
    const applyResult = validActionResult();
    const rollbackResult = validActionResult({ status: 'rolled_back', rollback: false });
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(applyResult))
      .mockResolvedValueOnce(jsonResponse(rollbackResult));
    const idempotencyKey = 'idem_1234567890123456';

    await applyAIPlan(plan, idempotencyKey);
    await rollbackAIExecution(
      applyResult.executionId,
      applyResult.rollback!.capability,
      idempotencyKey,
      { planId: plan.id, hash: plan.hash },
    );

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      `${API_BASE_URL}/v1/plans/plan_123/apply`,
      expect.objectContaining({
        body: JSON.stringify({
          approvalCapability: plan.approval.capability,
          idempotencyKey,
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `${API_BASE_URL}/v1/executions/execution_123/rollback`,
      expect.objectContaining({
        body: JSON.stringify({
          rollbackCapability: applyResult.rollback!.capability,
          idempotencyKey,
        }),
      }),
    );
  });

  it('accepts an authoritative rolled-back apply replay but rejects a fresh status mismatch', async () => {
    const rolledBackReplay = validActionResult({
      status: 'rolled_back',
      rollback: false,
      idempotentReplay: true,
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(rolledBackReplay))
      .mockResolvedValueOnce(jsonResponse({
        ...rolledBackReplay,
        idempotentReplay: false,
      }));

    await expect(applyAIPlan(validPlan(), 'idem_1234567890123456')).resolves.toMatchObject({
      status: 'rolled_back',
      idempotentReplay: true,
    });
    await expect(applyAIPlan(validPlan(), 'idem_1234567890123456')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('rejects invalid plan identifiers before network access', async () => {
    await expect(applyAIPlan({ ...validPlan(), id: '../cross-user' }, 'idem_1234567890123456')).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps stale state from the typed backend code and requires a fresh preview', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      error: { code: 'STATE_CHANGED', message: 'safe message' },
      requestId: 'request_123',
    }, 409));

    await expect(applyAIPlan(validPlan(), 'idem_1234567890123456')).rejects.toMatchObject({
      code: 'state_changed',
      status: 409,
    });
  });

  it('rejects a well-formed action response that is not bound to the submitted plan', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      ...validActionResult(),
      planId: 'different_plan',
      receipt: {
        ...validActionResult().receipt,
        planId: 'different_plan',
      },
    }));

    await expect(applyAIPlan(validPlan(), 'idem_1234567890123456')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

function validPlan(): AIPlanPreview {
  return {
    id: 'plan_123',
    tool: 'preview_changes',
    createdAt: '2029-12-31T10:00:00.000Z',
    expiresAt: '2030-01-01T10:00:00.000Z',
    baseStateHash: 'a'.repeat(64),
    hash: 'b'.repeat(64),
    status: 'previewed',
    operations: [{ action: 'update', entityType: 'tasks', entityId: 'task_123' }],
    diff: [{
      action: 'update',
      entityType: 'tasks',
      entityId: 'task_123',
      summary: 'Sposta la scadenza al giorno successivo.',
      title: 'Task importante',
      changedFields: ['dueDate'],
      before: { dueDate: '2029-12-31' },
      after: { dueDate: '2030-01-01' },
    }],
    reason: 'Pianificazione richiesta dall’utente.',
    warnings: ['Un blocco protetto sarà preservato'],
    conflicts: [],
    assumptions: [],
    expectedImpact: ['Una scadenza viene aggiornata.'],
    destructiveOperationCount: 0,
    approval: {
      required: true,
      capability: 'a'.repeat(43),
      expiresAt: '2030-01-01T10:00:00.000Z',
    },
  };
}

function validActionResult(options: {
  status?: 'applied' | 'rolled_back';
  rollback?: boolean;
  idempotentReplay?: boolean;
} = {}) {
  const status = options.status ?? 'applied';
  const rollback = options.rollback ?? true;
  return {
    message: status === 'applied' ? 'Piano applicato' : 'Rollback completato',
    executionId: 'execution_123',
    planId: 'plan_123',
    hash: 'b'.repeat(64),
    status,
    idempotentReplay: options.idempotentReplay ?? false,
    verified: true,
    receipt: {
      executionId: 'execution_123',
      planId: 'plan_123',
      changesetHash: 'b'.repeat(64),
      status,
      verified: true,
      timestamp: '2030-01-01T10:00:01.000Z',
      affected: [{ collection: 'tasks', id: 'task_123' }],
      rollbackAvailable: status === 'applied' && rollback,
      rollbackExpiresAt: status === 'applied' && rollback
        ? '2030-01-08T10:00:01.000Z'
        : null,
    },
    ...(status === 'applied' && rollback
      ? { rollback: { capability: 'r'.repeat(43), expiresAt: '2030-01-08T10:00:01.000Z' } }
      : {}),
  };
}
