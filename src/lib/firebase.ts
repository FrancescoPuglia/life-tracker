import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, enableNetwork, disableNetwork } from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { firebaseConfig } from '../config/firebaseConfig';

// Initialize Firebase directly - no lazy loading needed with hardcoded config
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

console.log('✅ Firebase initialized successfully with hardcoded config');

// Export app as default
export default app;

// Development mode setup
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  // Connect to emulators in development if available
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
    try {
      connectFirestoreEmulator(db, 'localhost', 8080);
      connectAuthEmulator(auth, 'http://localhost:9099');
    } catch (error) {
      console.log('Firebase emulators already connected or not available');
    }
  }
}

// Offline/Online management
export const enableOffline = () => {
  return disableNetwork(db);
};

export const enableOnline = () => {
  return enableNetwork(db);
};