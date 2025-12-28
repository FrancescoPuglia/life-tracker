import { sanitizeForStorage } from './database';
import {
  collection,
  doc,
  addDoc,
  setDoc,
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
import { firestore } from './firebase';
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

  constructor() {
    // 🔥 CRITICAL FIX: Restore userId immediately in constructor
    this.restoreUserId();
  }

  async init(): Promise<void> {
    // 🔥 CRITICAL: Always try to restore userId first
    this.restoreUserId();
    
    if (this.isInitialized) {
      // 🔇 EMERGENCY: console.log disabled
      return;
    }
    
    if (!firestore) {
      console.warn('⚠️ Firebase Firestore not available - skipping adapter initialization');
      return;
    }
    
    try {
      await enableNetwork(firestore);
      this.isInitialized = true;
      console.log('✅ Firebase adapter initialized successfully:', {
        userId: this.userId || 'not set',
        isInitialized: this.isInitialized
      });
    } catch (error) {
      console.error('❌ Failed to initialize Firebase adapter:', error);
      return;
    }
  }

  setUserId(userId: string): void {
    console.log('🔥 setUserId called:', userId);
    this.userId = userId;
    
    // Persist to sessionStorage for refresh survival
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('firebase_userId', userId);
      console.log('💾 userId persisted to sessionStorage:', userId);
    }
  }

  // 🔥 CRITICAL: Restore userId from sessionStorage
  private restoreUserId(): void {
    if (typeof window === 'undefined') {
      return;
    }
    
    const savedUserId = sessionStorage.getItem('firebase_userId');
    
    if (savedUserId) {
      if (!this.userId) {
        this.userId = savedUserId;
        console.log('💾 userId restored from sessionStorage:', this.userId);
      } else if (this.userId !== savedUserId) {
        console.warn('⚠️ userId mismatch - current:', this.userId, 'saved:', savedUserId);
        // Trust the sessionStorage value (more recent)
        this.userId = savedUserId;
      }
    }
  }

  // 🔥 NEW: Public method to get current userId
  getUserId(): string | null {
    this.restoreUserId();
    return this.userId;
  }

  private getUserCollection(collectionName: string): string {
    // 🔥 CRITICAL: Always restore before accessing
    this.restoreUserId();
    
    if (!this.userId) {
      const error = 'User ID not set. Call setUserId() first or ensure sessionStorage has firebase_userId.';
      console.error('❌ getUserCollection failed:', error);
      throw new Error(error);
    }
    
    const path = `users/${this.userId}/${collectionName}`;
    return path;
  }

  async create<T extends { id?: string }>(collectionName: string, data: T): Promise<T> {
    await this.init();
    console.log('📝 Firebase create():', {
      collectionName,
      userId: this.userId,
      dataId: data.id,
      firestore: !!firestore,
      isInitialized: this.isInitialized,
      data
    });
    
    if (!firestore || !this.isInitialized) {
      throw new Error('Firebase Firestore not initialized');
    }
    
    if (!this.userId) {
      throw new Error('Firebase userId not set');
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
        // Use custom ID with setDoc
        const docRef = doc(collectionRef, data.id);
        await setDoc(docRef, sanitizeForStorage(dataWithTimestamps));
        console.log('✅ Firebase setDoc SUCCESS:', data.id);
        return this.convertTimestampsToDates({ ...data, ...dataWithTimestamps }) as T;
      } else {
        // Auto-generate ID
        const docRef = await addDoc(collectionRef, sanitizeForStorage(dataWithTimestamps));
        console.log('✅ Firebase addDoc SUCCESS:', docRef.id);
        const newData = { ...data, id: docRef.id, ...dataWithTimestamps };
        return this.convertTimestampsToDates(newData) as T;
      }
    } catch (error: any) {
      console.error('❌ Firebase create FAILED:', {
        collectionName,
        error: error?.message,
        code: error?.code
      });
      throw error;
    }
  }

  async read<T>(collectionName: string, id: string): Promise<T | null> {
    await this.init();
    
    if (!firestore) {
      throw new Error('Firebase Firestore not initialized');
    }
    
    if (!this.userId) {
      console.warn('⚠️ FirebaseAdapter.read: userId not set, returning null');
      return null;
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
    
    if (!this.userId) {
      throw new Error('Firebase userId not set. Call setUserId() first.');
    }
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const docRef = doc(firestore, collectionPath, data.id);
      
      const dataWithTimestamps = {
        ...data,
        updatedAt: serverTimestamp(),
      };
      
      this.convertDatesToTimestamps(dataWithTimestamps);
      
      await updateDoc(docRef, sanitizeForStorage(dataWithTimestamps));
      return this.convertTimestampsToDates(dataWithTimestamps) as T;
    } catch (error: any) {
      console.error('❌ Firebase update FAILED:', {
        collectionName,
        error: error?.message,
        code: error?.code
      });
      throw error;
    }
  }

  async delete(collectionName: string, id: string): Promise<void> {
    await this.init();
    
    if (!firestore) {
      throw new Error('Firebase Firestore not initialized');
    }
    
    if (!this.userId) {
      throw new Error('Firebase userId not set. Call setUserId() first.');
    }
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const docRef = doc(firestore, collectionPath, id);
      await deleteDoc(docRef);
      console.log('✅ Firebase delete SUCCESS:', id);
    } catch (error) {
      console.error(`Failed to delete document from ${collectionName}:`, error);
      throw error;
    }
  }

  async getAll<T>(collectionName: string): Promise<T[]> {
    await this.init();
    // 🔇 EMERGENCY: console.log disabled to stop spam
    
    if (!firestore) {
      throw new Error('Firebase Firestore not initialized');
    }
    
    // 🔥 CRITICAL: If no userId, return empty array (don't crash)
    if (!this.userId) {
      console.warn('⚠️ Firebase getAll: userId not set, returning empty array');
      return [];
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
      // 🔇 EMERGENCY: console.log disabled to stop spam
      return results;
    } catch (error) {
      console.error(`❌ Failed to get all documents from ${collectionName}:`, error);
      throw error;
    }
  }

  async getByIndex<T>(collectionName: string, field: string, value: any): Promise<T[]> {
    await this.init();
    
    if (!firestore) {
      throw new Error('Firebase Firestore not initialized');
    }
    
    if (!this.userId) {
      console.warn('⚠️ FirebaseAdapter.getByIndex: userId not set, returning empty array');
      return [];
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
    
    if (!this.userId) {
      console.warn('⚠️ FirebaseAdapter.query: userId not set, returning empty array');
      return [];
    }
    
    try {
      const collectionPath = this.getUserCollection(collectionName);
      const collectionRef = collection(firestore, collectionPath);
      
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
    
    if (!this.userId) {
      console.warn('Firebase userId not set - cannot subscribe');
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
          converted[key] = converted[key].toDate();
        } else if (Array.isArray(converted[key])) {
          converted[key] = converted[key].map((item: any) => this.convertTimestampsToDates(item));
        } else {
          converted[key] = this.convertTimestampsToDates(converted[key]);
        }
      }
    });
    return converted;
  }

  // 🔥 NEW: Clear stored userId (for logout)
  clearUserId(): void {
    this.userId = null;
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('firebase_userId');
      console.log('🗑️ userId cleared from sessionStorage');
    }
  }

  destroy(): void {
    this.unsubscribers.forEach(unsubscribe => unsubscribe());
    this.unsubscribers.clear();
    this.clearUserId();
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

// (FIX) Non esportare più l'istanza globale qui. Usa solo la factory createFirebaseAdapter.