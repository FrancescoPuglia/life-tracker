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
      attemptedAuthAccounts: 1,
      deletedAuthAccounts: 0,
      userAndAuthCleanupComplete: false,
    });
    expect(fetchSpy.mock.calls.some(([input]) => String(input).includes('accounts:delete'))).toBe(false);
  });
});
