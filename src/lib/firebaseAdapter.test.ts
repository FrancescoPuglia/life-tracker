import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  enableNetwork: vi.fn(async () => undefined),
  getDocs: vi.fn(async () => ({ forEach: () => undefined, docs: [] })),
  onSnapshot: vi.fn(() => () => undefined),
  query: vi.fn((reference: unknown, ...constraints: unknown[]) => ({ reference, constraints })),
  where: vi.fn((field: string, operator: string, value: unknown) => ({
    type: 'where',
    field,
    operator,
    value,
  })),
}));

vi.mock('./firebase', () => ({ firestore: { kind: 'test-firestore' } }));
vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(),
  collection: vi.fn((_firestore: unknown, path: string) => ({ path })),
  deleteDoc: vi.fn(),
  disableNetwork: vi.fn(async () => undefined),
  doc: vi.fn(),
  enableNetwork: firestoreMocks.enableNetwork,
  getDoc: vi.fn(),
  getDocs: firestoreMocks.getDocs,
  limit: vi.fn(),
  onSnapshot: firestoreMocks.onSnapshot,
  orderBy: vi.fn(),
  query: firestoreMocks.query,
  serverTimestamp: vi.fn(() => ({ kind: 'server-timestamp' })),
  setDoc: vi.fn(),
  startAfter: vi.fn(),
  Timestamp: { fromDate: vi.fn((value: Date) => value) },
  updateDoc: vi.fn(),
  where: firestoreMocks.where,
  writeBatch: vi.fn(),
}));

import { FirebaseAdapter } from './firebaseAdapter';

describe('FirebaseAdapter owner-constrained collection reads', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('adds the authenticated path owner constraint to getAll and subscriptions', async () => {
    const adapter = adapterFor('alice');

    await adapter.getAll('tasks');
    const unsubscribe = adapter.subscribe('tasks', () => undefined);

    expect(firestoreMocks.where).toHaveBeenCalledWith('userId', '==', 'alice');
    expect(firestoreMocks.query).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/alice/tasks' }),
      expect.objectContaining({ field: 'userId', operator: '==', value: 'alice' }),
    );
    expect(firestoreMocks.onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: [expect.objectContaining({ field: 'userId', value: 'alice' })],
      }),
      expect.any(Function),
    );
    expect(unsubscribe).toEqual(expect.any(Function));
  });

  it('refuses an explicit cross-user indexed or generic query before Firestore', async () => {
    const adapter = adapterFor('alice');

    await expect(adapter.getByIndex('tasks', 'userId', 'bob')).resolves.toEqual([]);
    expect(firestoreMocks.getDocs).not.toHaveBeenCalled();
    await expect(adapter.query('tasks', [{
      type: 'where',
      field: 'userId',
      operator: '==',
      value: 'bob',
    }])).rejects.toThrow('cannot select another user namespace');
    expect(firestoreMocks.getDocs).not.toHaveBeenCalled();
  });

  it('combines an allowed domain filter with the authoritative owner filter', async () => {
    const adapter = adapterFor('alice');

    await adapter.getByIndex('tasks', 'projectId', 'project-1');

    expect(firestoreMocks.query).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/alice/tasks' }),
      expect.objectContaining({ field: 'userId', value: 'alice' }),
      expect.objectContaining({ field: 'projectId', value: 'project-1' }),
    );
  });
});

function adapterFor(uid: string): FirebaseAdapter {
  const adapter = new FirebaseAdapter();
  adapter.setUserId(uid);
  return adapter;
}
