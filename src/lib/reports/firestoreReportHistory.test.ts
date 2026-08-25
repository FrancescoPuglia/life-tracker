import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  collection: vi.fn(() => 'archive-collection'),
  where: vi.fn(() => 'owner-constraint'),
  orderBy: vi.fn(() => 'newest-constraint'),
  limit: vi.fn(() => 'limit-constraint'),
  query: vi.fn(() => 'archive-query'),
  getDocs: vi.fn(async () => ({
    docs: [{ id: 'report-id', data: () => ({ safe: true }) }],
  })),
}));

vi.mock('firebase/firestore', () => firestoreMocks);
vi.mock('@/lib/firebase', () => ({ firestore: 'firestore-instance' }));

import { FirestoreReportHistoryDataSource } from './firestoreReportHistory';

describe('Firestore report history source', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the exact owner-scoped newest-first bounded query', async () => {
    const source = new FirestoreReportHistoryDataSource();
    await expect(source.read('owner-1', 13)).resolves.toEqual([
      { id: 'report-id', data: { safe: true } },
    ]);

    expect(firestoreMocks.collection).toHaveBeenCalledWith(
      'firestore-instance',
      'users',
      'owner-1',
      'reportArchives',
    );
    expect(firestoreMocks.where).toHaveBeenCalledWith('userId', '==', 'owner-1');
    expect(firestoreMocks.orderBy).toHaveBeenCalledWith('generatedAt', 'desc');
    expect(firestoreMocks.limit).toHaveBeenCalledWith(13);
    expect(firestoreMocks.query).toHaveBeenCalledWith(
      'archive-collection',
      'owner-constraint',
      'newest-constraint',
      'limit-constraint',
    );
    expect(firestoreMocks.getDocs).toHaveBeenCalledWith('archive-query');
  });
});
