import { describe, expect, it, vi } from 'vitest';
import { cleanupStagingResources } from '../../../e2e/staging/cleanup';

const configuration = {
  projectId: 'life-tracker-staging',
  firebaseApiKey: 'public-web-key',
};

describe('live staging fixture cleanup', () => {
  it('deduplicates explicit documents, removes them, then deletes Auth', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), method: String(init?.method) });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const report = await cleanupStagingResources(configuration, [{
      identity: { uid: 'user-a', idToken: 'private-id-token' },
      documents: [['tasks', 'task-1'], ['tasks', 'task-1'], ['goals', 'goal-1']],
    }], fetchMock);

    expect(report).toMatchObject({
      attemptedUserDocuments: 2,
      deletedUserDocuments: 2,
      attemptedAuthAccounts: 1,
      deletedAuthAccounts: 1,
      userAndAuthCleanupComplete: true,
      serverArtifactPolicy: 'durable_audit_and_ttl_managed_ephemeral_records',
    });
    expect(calls).toHaveLength(3);
    expect(calls.at(-1)?.url).toContain('identitytoolkit.googleapis.com/v1/accounts:delete');
    expect(calls.at(-1)?.method).toBe('POST');
  });

  it('treats already-absent documents as clean but retains Auth when a document cannot be removed', async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/tasks/absent')) return new Response('{}', { status: 404 });
      if (url.includes('/tasks/denied')) return new Response('{}', { status: 403 });
      return new Response('{}', { status: 200 });
    });
    const fetchMock = fetchSpy as unknown as typeof fetch;

    const report = await cleanupStagingResources(configuration, [{
      identity: { uid: 'user-a', idToken: 'private-id-token' },
      documents: [['tasks', 'absent'], ['tasks', 'denied']],
    }], fetchMock);

    expect(report).toMatchObject({
      attemptedUserDocuments: 2,
      deletedUserDocuments: 1,
      attemptedAuthAccounts: 0,
      deletedAuthAccounts: 0,
      userAndAuthCleanupComplete: false,
    });
    expect(fetchSpy.mock.calls.some(([input]) => String(input).includes('accounts:delete'))).toBe(false);
  });

  it('proves a Rules-denied missing document absent before deleting Auth', async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/tasks/proposed-only')) return new Response('{}', { status: 403 });
      if (url.endsWith(':runQuery')) return new Response('[{"readTime":"2026-08-24T00:00:00Z"}]', { status: 200 });
      return new Response('{}', { status: 200 });
    });

    const report = await cleanupStagingResources(configuration, [{
      identity: { uid: 'user-a', idToken: 'private-id-token' },
      documents: [['tasks', 'proposed-only']],
    }], fetchSpy as unknown as typeof fetch);

    expect(report).toMatchObject({
      attemptedUserDocuments: 1,
      deletedUserDocuments: 1,
      attemptedAuthAccounts: 1,
      deletedAuthAccounts: 1,
      userAndAuthCleanupComplete: true,
    });
    const queryCall = fetchSpy.mock.calls.find(([input]) => String(input).endsWith(':runQuery'));
    expect(queryCall?.[1]?.method).toBe('POST');
    expect(String(queryCall?.[1]?.body)).toContain('"fieldPath":"userId"');
    expect(String(queryCall?.[1]?.body)).toContain('"stringValue":"user-a"');
    expect(String(queryCall?.[1]?.body)).toContain('"limit":101');
  });

  it('retains Auth when the exact owner query does not prove absence', async () => {
    const exactName = 'projects/life-tracker-staging/databases/(default)/documents/users/user-a/tasks/still-present';
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/tasks/still-present')) return new Response('{}', { status: 403 });
      if (url.endsWith(':runQuery')) {
        return new Response(JSON.stringify([{ document: { name: exactName } }]), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });

    const report = await cleanupStagingResources(configuration, [{
      identity: { uid: 'user-a', idToken: 'private-id-token' },
      documents: [['tasks', 'still-present']],
    }], fetchSpy as unknown as typeof fetch);

    expect(report).toMatchObject({
      deletedUserDocuments: 0,
      attemptedAuthAccounts: 0,
      userAndAuthCleanupComplete: false,
    });
    expect(fetchSpy.mock.calls.some(([input]) => String(input).includes('accounts:delete'))).toBe(false);
  });

  it('retries only a cleanup DELETE transport exception and releases every response body', async () => {
    const responses: Response[] = [];
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/tasks/task-1') && fetchSpy.mock.calls.length === 1) {
        throw new TypeError('transient cleanup transport failure');
      }
      const response = new Response('{}', {
        status: String(input).includes('/tasks/task-1') ? 404 : 200,
      });
      responses.push(response);
      return response;
    });

    const report = await cleanupStagingResources(configuration, [{
      identity: { uid: 'user-a', idToken: 'private-id-token' },
      documents: [['tasks', 'task-1']],
    }], fetchSpy as unknown as typeof fetch);

    expect(report).toMatchObject({
      attemptedUserDocuments: 1,
      deletedUserDocuments: 1,
      attemptedAuthAccounts: 1,
      deletedAuthAccounts: 1,
      userAndAuthCleanupComplete: true,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(responses.every((response) => response.bodyUsed)).toBe(true);
  });

  it('deletes Auth when no fixture document write was attempted', async () => {
    const fetchSpy = vi.fn(async (_input: string | URL | Request) =>
      new Response('{}', { status: 200 }));

    const report = await cleanupStagingResources(configuration, [{
      identity: { uid: 'user-a', idToken: 'private-id-token' },
      documents: [],
    }], fetchSpy as unknown as typeof fetch);

    expect(report).toMatchObject({
      attemptedUserDocuments: 0,
      deletedUserDocuments: 0,
      attemptedAuthAccounts: 1,
      deletedAuthAccounts: 1,
      userAndAuthCleanupComplete: true,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('accounts:delete');
  });
});
