import { initializeApp, getApp, getApps } from 'firebase/app';
import { initializeFirestore, connectFirestoreEmulator, enableNetwork, disableNetwork, enableMultiTabIndexedDbPersistence } from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { firebaseConfig } from '../config/firebaseConfig';

// Initialize Firebase directly - no lazy loading needed with hardcoded config

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Initialize Firestore with ignoreUndefinedProperties: true
export const firestore = initializeFirestore(app, { ignoreUndefinedProperties: true });

console.log('✅ Firebase initialized successfully with hardcoded config');

// Firestore offline persistence - one-shot setup
let persistenceAttempted = false;
export async function ensureFirestorePersistence(firestoreInstance: any): Promise<void> {
  if (persistenceAttempted) return;
  persistenceAttempted = true;
  
  if (typeof window === 'undefined') return;
  
  try {
    await enableMultiTabIndexedDbPersistence(firestoreInstance);
    console.log('✅ Firestore offline persistence enabled');
  } catch (error: any) {
    if (error.code === 'failed-precondition') {
      console.warn('⚠️ Firestore persistence failed: Multiple tabs open');
    } else if (error.code === 'unimplemented') {
      console.warn('⚠️ Firestore persistence not available');
    } else {
      console.error('❌ Firestore persistence error:', error);
    }
  }
}

// Export app as default
export default app;

// Development mode setup
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  // Connect to emulators in development if available
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
    try {
      connectFirestoreEmulator(firestore, 'localhost', 8080);
      connectAuthEmulator(auth, 'http://localhost:9099');
    } catch (error) {
      console.log('Firebase emulators already connected or not available');
    }
  }
}

// Offline/Online management
export const enableOffline = () => {
  return disableNetwork(firestore);
};

export const enableOnline = () => {
  return enableNetwork(firestore);
};