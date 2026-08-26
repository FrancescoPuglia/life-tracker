import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  TestTimestamp: class TestTimestamp {
    readonly seconds: number;
    readonly nanoseconds: number;

    constructor(seconds: number, nanoseconds: number) {
      this.seconds = seconds;
      this.nanoseconds = nanoseconds;
    }

    static fromDate(value: Date) {
      const milliseconds = value.getTime();
      const seconds = Math.floor(milliseconds / 1000);
      return new this(seconds, (milliseconds - seconds * 1000) * 1_000_000);
    }

    toDate() {
      return new Date(this.seconds * 1000 + this.nanoseconds / 1_000_000);
    }
  },
  TestServerTimestamp: class TestServerTimestamp {
    readonly kind = 'server-timestamp';
  },
  doc: vi.fn((_firestore: unknown, path: string, id: string) => ({ path, id })),
  enableNetwork: vi.fn(async () => undefined),
  getDocs: vi.fn(async () => ({
    forEach: (_visit: (snapshot: { id: string; data: () => unknown }) => void) => undefined,
    docs: [],
  })),
  getDocFromServer: vi.fn(async () => ({ exists: () => false })),
  getDocsFromServer: vi.fn(async () => ({
    forEach: (_visit: (snapshot: { id: string; data: () => unknown }) => void) => undefined,
    docs: [],
  })),
  onSnapshot: vi.fn(() => () => undefined),
  query: vi.fn((reference: unknown, ...constraints: unknown[]) => ({ reference, constraints })),
  where: vi.fn((field: string, operator: string, value: unknown) => ({
    type: 'where',
    field,
    operator,
    value,
  })),
  serverTimestamp: vi.fn(),
  updateDoc: vi.fn(async (_document: unknown, _data: unknown) => undefined),
  batchDelete: vi.fn(),
  batchCommit: vi.fn(async () => undefined),
  writeBatch: vi.fn(),
}));

firestoreMocks.serverTimestamp.mockImplementation(
  () => new firestoreMocks.TestServerTimestamp(),
);
firestoreMocks.writeBatch.mockImplementation(() => ({
  delete: firestoreMocks.batchDelete,
  commit: firestoreMocks.batchCommit,
}));

vi.mock('./firebase', () => ({ firestore: { kind: 'test-firestore' } }));
vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(),
  collection: vi.fn((_firestore: unknown, path: string) => ({ path })),
  deleteDoc: vi.fn(),
  disableNetwork: vi.fn(async () => undefined),
  doc: firestoreMocks.doc,
  enableNetwork: firestoreMocks.enableNetwork,
  getDoc: vi.fn(),
  getDocFromServer: firestoreMocks.getDocFromServer,
  getDocs: firestoreMocks.getDocs,
  getDocsFromServer: firestoreMocks.getDocsFromServer,
  limit: vi.fn(),
  onSnapshot: firestoreMocks.onSnapshot,
  orderBy: vi.fn(),
  query: firestoreMocks.query,
  serverTimestamp: firestoreMocks.serverTimestamp,
  setDoc: vi.fn(),
  startAfter: vi.fn(),
  Timestamp: firestoreMocks.TestTimestamp,
  updateDoc: firestoreMocks.updateDoc,
  where: firestoreMocks.where,
  writeBatch: firestoreMocks.writeBatch,
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

  it('normalizes legacy timestamp maps before an owner-scoped update', async () => {
    const adapter = adapterFor('alice');

    await adapter.update('timeBlocks', {
      id: 'block-1',
      userId: 'alice',
      startTime: { seconds: 1_786_435_200, nanoseconds: 123_000_000 },
      endTime: { seconds: 1_786_438_800, nanoseconds: 456_000_000 },
      status: 'planned',
      type: 'work',
    });

    expect(firestoreMocks.updateDoc).toHaveBeenCalledOnce();
    const payload = firestoreMocks.updateDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.startTime).toBeInstanceOf(firestoreMocks.TestTimestamp);
    expect(payload.endTime).toBeInstanceOf(firestoreMocks.TestTimestamp);
    expect(payload.updatedAt).toBeInstanceOf(firestoreMocks.TestServerTimestamp);
    expect((payload.startTime as InstanceType<typeof firestoreMocks.TestTimestamp>).nanoseconds)
      .toBe(123_000_000);
  });

  it('normalizes legacy timestamp maps when reading existing documents', async () => {
    firestoreMocks.getDocs.mockResolvedValueOnce({
      docs: [],
      forEach: (visit: (snapshot: { id: string; data: () => unknown }) => void) => visit({
        id: 'block-1',
        data: () => ({
          userId: 'alice',
          startTime: { seconds: 1_786_435_200, nanoseconds: 123_000_000 },
          endTime: { seconds: 1_786_438_800, nanoseconds: 456_000_000 },
        }),
      }),
    });
    const adapter = adapterFor('alice');

    const [timeBlock] = await adapter.getAll<{
      startTime: Date;
      endTime: Date;
    }>('timeBlocks');

    expect(timeBlock?.startTime).toBeInstanceOf(Date);
    expect(timeBlock?.endTime).toBeInstanceOf(Date);
    expect(timeBlock?.startTime.getUTCMilliseconds()).toBe(123);
    expect(timeBlock?.endTime.getUTCMilliseconds()).toBe(456);
  });

  it('commits an owner-scoped Goal hierarchy as one Firestore batch', async () => {
    const adapter = adapterFor('alice');

    await adapter.deleteMany([
      { collection: 'keyResults', id: 'kr-1' },
      { collection: 'tasks', id: 'task-1' },
      { collection: 'projects', id: 'project-1' },
      { collection: 'goals', id: 'goal-1' },
    ]);

    expect(firestoreMocks.writeBatch).toHaveBeenCalledOnce();
    expect(firestoreMocks.batchDelete.mock.calls.map(([reference]) => reference)).toEqual([
      { path: 'users/alice/keyResults', id: 'kr-1' },
      { path: 'users/alice/tasks', id: 'task-1' },
      { path: 'users/alice/projects', id: 'project-1' },
      { path: 'users/alice/goals', id: 'goal-1' },
    ]);
    expect(firestoreMocks.batchCommit).toHaveBeenCalledOnce();
  });

  it('uses server-only owner-scoped reads to construct destructive state', async () => {
    const adapter = adapterFor('alice');

    await adapter.readAuthoritative('goals', 'goal-1');
    await adapter.getAllAuthoritative('projects');

    expect(firestoreMocks.getDocFromServer).toHaveBeenCalledWith({
      path: 'users/alice/goals',
      id: 'goal-1',
    });
    expect(firestoreMocks.getDocsFromServer).toHaveBeenCalledWith(expect.objectContaining({
      constraints: [expect.objectContaining({ field: 'userId', value: 'alice' })],
    }));
  });

  it('does not report deletion before the authoritative batch commit resolves', async () => {
    let acknowledge!: () => void;
    firestoreMocks.batchCommit.mockImplementationOnce(() => new Promise<void>((resolve) => {
      acknowledge = resolve;
    }));
    const adapter = adapterFor('alice');
    let resolved = false;
    const deletion = adapter.deleteMany([{ collection: 'goals', id: 'goal-1' }])
      .then(() => { resolved = true; });

    await vi.waitFor(() => expect(firestoreMocks.batchCommit).toHaveBeenCalledOnce());
    expect(resolved).toBe(false);
    acknowledge();
    await deletion;
    expect(resolved).toBe(true);
  });

  it('propagates server rejection without attempting a partial fallback', async () => {
    firestoreMocks.batchCommit.mockRejectedValueOnce(new Error('permission-denied'));
    const adapter = adapterFor('alice');

    await expect(adapter.deleteMany([
      { collection: 'projects', id: 'project-1' },
      { collection: 'goals', id: 'goal-1' },
    ])).rejects.toThrow('permission-denied');
    expect(firestoreMocks.batchCommit).toHaveBeenCalledOnce();
  });

  it.each([
    [[{ collection: 'goals', id: '../other' }], 'invalid document id'],
    [[
      { collection: 'goals', id: 'goal-1' },
      { collection: 'goals', id: 'goal-1' },
    ], 'duplicate document'],
  ] as const)('rejects unsafe atomic deletion input', async (operations, message) => {
    const adapter = adapterFor('alice');

    await expect(adapter.deleteMany(operations)).rejects.toThrow(message);
    expect(firestoreMocks.writeBatch).not.toHaveBeenCalled();
  });
});

function adapterFor(uid: string): FirebaseAdapter {
  const adapter = new FirebaseAdapter();
  adapter.setUserId(uid);
  return adapter;
}
