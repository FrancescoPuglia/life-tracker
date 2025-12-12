import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  enableNetwork,
  disableNetwork,
  writeBatch,
  serverTimestamp,
  Timestamp,
  QuerySnapshot,
  DocumentData,
  Query,
  DocumentSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { 
  User, Domain, Goal, KeyResult, Project, Task, TimeBlock, Session, 
  Habit, HabitLog, Metric, CalendarEvent, Deadline, JournalEntry, 
  Insight, Achievement, KPI 
} from '@/types';

export interface DatabaseAdapter {
  init(): Promise<void>;
  create<T extends { id?: string }>(collection: string, data: T): Promise<T>;
  read<T>(collection: string, id: string): Promise<T | null>;
  update<T extends { id: string }>(collection: string, data: T): Promise<T>;
  delete(collection: string, id: string): Promise<void>;
  getAll<T>(collection: string): Promise<T[]>;
  getByIndex<T>(collection: string, field: string, value: any): Promise<T[]>;
  query<T>(collection: string, constraints: QueryConstraint[]): Promise<T[]>;
  subscribe<T>(collection: string, callback: (data: T[]) => void): () => void;
  isOnline(): boolean;
  enableOffline(): Promise<void>;
  enableOnline(): Promise<void>;
}

export interface QueryConstraint {
  type: 'where' | 'orderBy' | 'limit' | 'startAfter';
  field?: string;
  operator?: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains';
  value?: any;
  direction?: 'asc' | 'desc';
  limitTo?: number;
  startAfterDoc?: any;
}

export class FirebaseAdapter implements DatabaseAdapter {
  private isInitialized = false;
  private userId: string | null = null;
  private unsubscribers: Map<string, () => void> = new Map();

  async init(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      // Test connection
      await enableNetwork(db);
      this.isInitialized = true;
      console.log('Firebase adapter initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Firebase adapter:', error);
      throw error;
    }
  }

  setUserId(userId: string): void {
    this.userId = userId;
  }

  private getUserCollection(collectionName: string): string {
    if (!this.userId) {
      throw new Error('User ID not set. Call setUserId() first.');
    }
    return `users/${this.userId}/${collectionName}`;
  }

  async create<T extends { id?: string }>(collectionName: string, data: T): Promise<T> {
    await this.init();
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const collectionRef = collection(db, collectionPath);
      
      // Prepare data with timestamps
      const dataWithTimestamps: any = {
        ...data,
        createdAt: (data as any).createdAt ? Timestamp.fromDate(new Date((data as any).createdAt)) : serverTimestamp(),
        updatedAt: (data as any).updatedAt ? Timestamp.fromDate(new Date((data as any).updatedAt)) : serverTimestamp(),
      };

      if (data.id) {
        // Use provided ID
        const docRef = doc(db, collectionPath, data.id);
        await updateDoc(docRef, dataWithTimestamps);
        return data;
      } else {
        // Auto-generate ID
        const docRef = await addDoc(collectionRef, dataWithTimestamps);
        return {
          ...data,
          id: docRef.id,
        } as T;
      }
    } catch (error) {
      console.error(`Failed to create document in ${collectionName}:`, error);
      throw error;
    }
  }

  async read<T>(collectionName: string, id: string): Promise<T | null> {
    await this.init();
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const docRef = doc(db, collectionPath, id);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return this.convertFirestoreDoc(docSnap) as T;
      }
      return null;
    } catch (error) {
      console.error(`Failed to read document ${id} from ${collectionName}:`, error);
      throw error;
    }
  }

  async update<T extends { id: string }>(collectionName: string, data: T): Promise<T> {
    await this.init();
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const docRef = doc(db, collectionPath, data.id);
      
      const dataWithTimestamps = {
        ...data,
        updatedAt: serverTimestamp(),
      };
      
      await updateDoc(docRef, dataWithTimestamps);
      return data;
    } catch (error) {
      console.error(`Failed to update document ${data.id} in ${collectionName}:`, error);
      throw error;
    }
  }

  async delete(collectionName: string, id: string): Promise<void> {
    await this.init();
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const docRef = doc(db, collectionPath, id);
      await deleteDoc(docRef);
    } catch (error) {
      console.error(`Failed to delete document ${id} from ${collectionName}:`, error);
      throw error;
    }
  }

  async getAll<T>(collectionName: string): Promise<T[]> {
    await this.init();
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const collectionRef = collection(db, collectionPath);
      const querySnapshot = await getDocs(collectionRef);
      
      return querySnapshot.docs.map(doc => this.convertFirestoreDoc(doc)) as T[];
    } catch (error) {
      console.error(`Failed to get all documents from ${collectionName}:`, error);
      throw error;
    }
  }

  async getByIndex<T>(collectionName: string, field: string, value: any): Promise<T[]> {
    await this.init();
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const collectionRef = collection(db, collectionPath);
      const q = query(collectionRef, where(field, '==', value));
      const querySnapshot = await getDocs(q);
      
      return querySnapshot.docs.map(doc => this.convertFirestoreDoc(doc)) as T[];
    } catch (error) {
      console.error(`Failed to query ${collectionName} by ${field}:`, error);
      throw error;
    }
  }

  async query<T>(collectionName: string, constraints: QueryConstraint[]): Promise<T[]> {
    await this.init();
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const collectionRef = collection(db, collectionPath);
      
      let q: Query = collectionRef;
      
      for (const constraint of constraints) {
        switch (constraint.type) {
          case 'where':
            if (constraint.field && constraint.operator && constraint.value !== undefined) {
              q = query(q, where(constraint.field, constraint.operator, constraint.value));
            }
            break;
          case 'orderBy':
            if (constraint.field) {
              q = query(q, orderBy(constraint.field, constraint.direction || 'asc'));
            }
            break;
          case 'limit':
            if (constraint.limitTo) {
              q = query(q, limit(constraint.limitTo));
            }
            break;
          case 'startAfter':
            if (constraint.startAfterDoc) {
              q = query(q, startAfter(constraint.startAfterDoc));
            }
            break;
        }
      }
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => this.convertFirestoreDoc(doc)) as T[];
    } catch (error) {
      console.error(`Failed to execute query on ${collectionName}:`, error);
      throw error;
    }
  }

  subscribe<T>(collectionName: string, callback: (data: T[]) => void): () => void {
    const collectionPath = this.getUserCollection(collectionName);
    const collectionRef = collection(db, collectionPath);
    
    const unsubscribe = onSnapshot(collectionRef, (snapshot) => {
      const data = snapshot.docs.map(doc => this.convertFirestoreDoc(doc)) as T[];
      callback(data);
    }, (error) => {
      console.error(`Subscription error for ${collectionName}:`, error);
    });
    
    // Store unsubscriber
    const key = `${this.userId}-${collectionName}`;
    this.unsubscribers.set(key, unsubscribe);
    
    return () => {
      unsubscribe();
      this.unsubscribers.delete(key);
    };
  }

  unsubscribeAll(): void {
    this.unsubscribers.forEach(unsubscribe => unsubscribe());
    this.unsubscribers.clear();
  }

  isOnline(): boolean {
    return navigator.onLine;
  }

  async enableOffline(): Promise<void> {
    try {
      await disableNetwork(db);
      console.log('Firebase offline mode enabled');
    } catch (error) {
      console.error('Failed to enable offline mode:', error);
      throw error;
    }
  }

  async enableOnline(): Promise<void> {
    try {
      await enableNetwork(db);
      console.log('Firebase online mode enabled');
    } catch (error) {
      console.error('Failed to enable online mode:', error);
      throw error;
    }
  }

  private convertFirestoreDoc(doc: DocumentSnapshot<DocumentData>): any {
    const data = doc.data();
    if (!data) return null;
    
    const converted: any = { id: doc.id, ...data };
    
    // Convert Firestore Timestamps to JavaScript Dates
    Object.keys(converted).forEach(key => {
      if (converted[key] instanceof Timestamp) {
        converted[key] = (converted[key] as Timestamp).toDate();
      }
    });
    
    return converted;
  }

  // Batch operations
  async batchWrite(operations: Array<{
    type: 'create' | 'update' | 'delete';
    collection: string;
    id?: string;
    data?: any;
  }>): Promise<void> {
    await this.init();
    
    try {
      const batch = writeBatch(db);
      
      for (const operation of operations) {
        const collectionPath = this.getUserCollection(operation.collection);
        
        switch (operation.type) {
          case 'create':
            if (operation.data) {
              const docRef = operation.id 
                ? doc(db, collectionPath, operation.id)
                : doc(collection(db, collectionPath));
              batch.set(docRef, {
                ...operation.data,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
            break;
          case 'update':
            if (operation.id && operation.data) {
              const docRef = doc(db, collectionPath, operation.id);
              batch.update(docRef, {
                ...operation.data,
                updatedAt: serverTimestamp(),
              });
            }
            break;
          case 'delete':
            if (operation.id) {
              const docRef = doc(db, collectionPath, operation.id);
              batch.delete(docRef);
            }
            break;
        }
      }
      
      await batch.commit();
      console.log('Batch write completed successfully');
    } catch (error) {
      console.error('Batch write failed:', error);
      throw error;
    }
  }
}

export const firebaseAdapter = new FirebaseAdapter();