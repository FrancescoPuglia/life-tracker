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
}));

firestoreMocks.serverTimestamp.mockImplementation(
  () => new firestoreMocks.TestServerTimestamp(),
);

vi.mock('./firebase', () => ({ firestore: { kind: 'test-firestore' } }));
vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(),
  collection: vi.fn((_firestore: unknown, path: string) => ({ path })),
  deleteDoc: vi.fn(),
  disableNetwork: vi.fn(async () => undefined),
  doc: firestoreMocks.doc,
  enableNetwork: firestoreMocks.enableNetwork,
  getDoc: vi.fn(),
  getDocs: firestoreMocks.getDocs,
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
});

function adapterFor(uid: string): FirebaseAdapter {
  const adapter = new FirebaseAdapter();
  adapter.setUserId(uid);
  return adapter;
}
