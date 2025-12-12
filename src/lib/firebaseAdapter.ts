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
import { db as firestore } from './firebase';
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
    
    if (!firestore) {
      console.warn('⚠️ Firebase Firestore not available - skipping adapter initialization');
      return;
    }
    
    try {
      // Test connection
      await enableNetwork(firestore);
      this.isInitialized = true;
      console.log('✅ Firebase adapter initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Firebase adapter:', error);
      // Don't throw - let the system fall back to IndexedDB
      return;
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
    
    if (!firestore || !this.isInitialized) {
      throw new Error('Firebase Firestore not initialized');
    }
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const collectionRef = collection(firestore, collectionPath);
      
      // Prepare data with timestamps
      const dataWithTimestamps: any = {
        ...data,
        createdAt: (data as any).createdAt ? Timestamp.fromDate(new Date((data as any).createdAt)) : serverTimestamp(),
        updatedAt: (data as any).updatedAt ? Timestamp.fromDate(new Date((data as any).updatedAt)) : serverTimestamp(),
      };
      
      // Convert date fields to Timestamps
      this.convertDatesToTimestamps(dataWithTimestamps);
      
      if (data.id) {
        // Use custom ID
        const docRef = doc(collectionRef, data.id);
        await updateDoc(docRef, dataWithTimestamps);
        return { ...data, ...dataWithTimestamps };
      } else {
        // Auto-generate ID
        const docRef = await addDoc(collectionRef, dataWithTimestamps);
        const newData = { ...data, id: docRef.id, ...dataWithTimestamps };
        return this.convertTimestampsToDates(newData) as T;
      }
    } catch (error) {
      console.error(`Failed to create document in ${collectionName}:`, error);
      throw error;
    }
  }

  async read<T>(collectionName: string, id: string): Promise<T | null> {
    await this.init();
    
    if (!firestore) {
      throw new Error('Firebase Firestore not initialized');
    }
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const docRef = doc(firestore, collectionPath, id);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = { id: docSnap.id, ...docSnap.data() };
        return this.convertTimestampsToDates(data) as T;
      }
      
      return null;
    } catch (error) {
      console.error(`Failed to read document from ${collectionName}:`, error);
      throw error;
    }
  }

  async update<T extends { id: string }>(collectionName: string, data: T): Promise<T> {
    await this.init();
    
    if (!firestore) {
      throw new Error('Firebase Firestore not initialized');
    }
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const docRef = doc(firestore, collectionPath, data.id);
      
      const dataWithTimestamps = {
        ...data,
        updatedAt: serverTimestamp(),
      };
      
      // Convert date fields to Timestamps
      this.convertDatesToTimestamps(dataWithTimestamps);
      
      await updateDoc(docRef, dataWithTimestamps);
      return this.convertTimestampsToDates(dataWithTimestamps) as T;
    } catch (error) {
      console.error(`Failed to update document in ${collectionName}:`, error);
      throw error;
    }
  }

  async delete(collectionName: string, id: string): Promise<void> {
    await this.init();
    
    if (!firestore) {
      throw new Error('Firebase Firestore not initialized');
    }
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const docRef = doc(firestore, collectionPath, id);
      await deleteDoc(docRef);
    } catch (error) {
      console.error(`Failed to delete document from ${collectionName}:`, error);
      throw error;
    }
  }

  async getAll<T>(collectionName: string): Promise<T[]> {
    await this.init();
    
    if (!firestore) {
      throw new Error('Firebase Firestore not initialized');
    }
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const collectionRef = collection(firestore, collectionPath);
      const querySnapshot = await getDocs(collectionRef);
      
      const results: T[] = [];
      querySnapshot.forEach(doc => {
        const data = { id: doc.id, ...doc.data() };
        results.push(this.convertTimestampsToDates(data) as T);
      });
      
      return results;
    } catch (error) {
      console.error(`Failed to get all documents from ${collectionName}:`, error);
      throw error;
    }
  }

  async getByIndex<T>(collectionName: string, field: string, value: any): Promise<T[]> {
    await this.init();
    
    if (!firestore) {
      throw new Error('Firebase Firestore not initialized');
    }
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const collectionRef = collection(firestore, collectionPath);
      const q = query(collectionRef, where(field, '==', value));
      const querySnapshot = await getDocs(q);
      
      const results: T[] = [];
      querySnapshot.forEach(doc => {
        const data = { id: doc.id, ...doc.data() };
        results.push(this.convertTimestampsToDates(data) as T);
      });
      
      return results;
    } catch (error) {
      console.error(`Failed to query documents from ${collectionName}:`, error);
      throw error;
    }
  }

  async query<T>(collectionName: string, constraints: QueryConstraint[]): Promise<T[]> {
    await this.init();
    
    if (!firestore) {
      throw new Error('Firebase Firestore not initialized');
    }
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const collectionRef = collection(firestore, collectionPath);
      
      // Build query constraints
      const queryConstraints: any[] = [];
      
      constraints.forEach(constraint => {
        switch (constraint.type) {
          case 'where':
            if (constraint.field && constraint.operator && constraint.value !== undefined) {
              queryConstraints.push(where(constraint.field, constraint.operator, constraint.value));
            }
            break;
          case 'orderBy':
            if (constraint.field) {
              queryConstraints.push(orderBy(constraint.field, constraint.direction || 'asc'));
            }
            break;
          case 'limit':
            if (constraint.limitTo) {
              queryConstraints.push(limit(constraint.limitTo));
            }
            break;
        }
      });
      
      const q = query(collectionRef, ...queryConstraints);
      const querySnapshot = await getDocs(q);
      
      const results: T[] = [];
      querySnapshot.forEach(doc => {
        const data = { id: doc.id, ...doc.data() };
        results.push(this.convertTimestampsToDates(data) as T);
      });
      
      return results;
    } catch (error) {
      console.error(`Failed to execute query on ${collectionName}:`, error);
      throw error;
    }
  }

  subscribe<T>(collectionName: string, callback: (data: T[]) => void): () => void {
    if (!firestore) {
      console.warn('Firebase Firestore not initialized - cannot subscribe');
      return () => {};
    }
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const collectionRef = collection(firestore, collectionPath);
      
      const unsubscribe = onSnapshot(collectionRef, (querySnapshot) => {
        const results: T[] = [];
        querySnapshot.forEach(doc => {
          const data = { id: doc.id, ...doc.data() };
          results.push(this.convertTimestampsToDates(data) as T);
        });
        callback(results);
      });
      
      // Store unsubscriber
      const key = `${this.userId}-${collectionName}`;
      this.unsubscribers.set(key, unsubscribe);
      
      return unsubscribe;
    } catch (error) {
      console.error(`Failed to subscribe to ${collectionName}:`, error);
      return () => {};
    }
  }

  isOnline(): boolean {
    return navigator.onLine;
  }

  async enableOffline(): Promise<void> {
    if (!firestore) return;
    try {
      await disableNetwork(firestore);
    } catch (error) {
      console.error('Failed to enable offline mode:', error);
    }
  }

  async enableOnline(): Promise<void> {
    if (!firestore) return;
    try {
      await enableNetwork(firestore);
    } catch (error) {
      console.error('Failed to enable online mode:', error);
    }
  }

  private convertDatesToTimestamps(data: any): void {
    Object.keys(data).forEach(key => {
      if (data[key] instanceof Date) {
        data[key] = Timestamp.fromDate(data[key]);
      } else if (data[key] && typeof data[key] === 'object' && !Array.isArray(data[key])) {
        this.convertDatesToTimestamps(data[key]);
      }
    });
  }

  private convertTimestampsToDates(data: any): any {
    if (!data || typeof data !== 'object') return data;
    
    const converted = { ...data };
    Object.keys(converted).forEach(key => {
      if (converted[key] && typeof converted[key] === 'object') {
        if (converted[key].toDate && typeof converted[key].toDate === 'function') {
          // It's a Firestore Timestamp
          converted[key] = converted[key].toDate();
        } else if (Array.isArray(converted[key])) {
          // It's an array, convert each item
          converted[key] = converted[key].map((item: any) => this.convertTimestampsToDates(item));
        } else {
          // It's a nested object, recurse
          converted[key] = this.convertTimestampsToDates(converted[key]);
        }
      }
    });
    return converted;
  }

  destroy(): void {
    // Unsubscribe from all listeners
    this.unsubscribers.forEach(unsubscribe => unsubscribe());
    this.unsubscribers.clear();
  }
}

// Factory function to create adapter only when Firebase is available
export function createFirebaseAdapter(): FirebaseAdapter | null {
  if (!firestore) {
    console.warn('⚠️ Firebase Firestore not initialized - adapter not available');
    return null;
  }
  
  try {
    return new FirebaseAdapter();
  } catch (error) {
    console.error('❌ Failed to create Firebase adapter:', error);
    return null;
  }
}

// Create and export the adapter instance
export const firebaseAdapter = createFirebaseAdapter();