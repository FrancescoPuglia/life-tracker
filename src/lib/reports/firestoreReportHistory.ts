import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { firestore } from '@/lib/firebase';
import {
  BoundedReportHistoryStore,
  type ReportHistoryDataSource,
  type ReportHistoryRawDocument,
} from './reportHistory';

export class FirestoreReportHistoryDataSource implements ReportHistoryDataSource {
  async read(uid: string, maximumDocuments: number): Promise<readonly ReportHistoryRawDocument[]> {
    const archiveCollection = collection(firestore, 'users', uid, 'reportArchives');
    const archiveQuery = query(
      archiveCollection,
      where('userId', '==', uid),
      orderBy('generatedAt', 'desc'),
      limit(maximumDocuments),
    );
    const snapshot = await getDocs(archiveQuery);
    return Object.freeze(snapshot.docs.map((document) => Object.freeze({
      id: document.id,
      data: document.data(),
    })));
  }
}

export const reportHistoryStore = new BoundedReportHistoryStore(
  new FirestoreReportHistoryDataSource(),
);
