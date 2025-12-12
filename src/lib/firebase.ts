import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, enableNetwork, disableNetwork } from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

// Firebase configuration
const firebaseConfig = {
  // Configurazione da inserire dopo aver creato il progetto Firebase
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'demo-project.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'demo-project',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'demo-project.appspot.com',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '123456789',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || 'demo-app-id',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || 'G-DEMO',
};

// Initialize Firebase with lazy initialization pattern
let app: any = null;
let db: any = null;
let auth: any = null;
let initPromise: Promise<void> | null = null;

function initializeFirebaseIfNeeded() {
  if (initPromise) return initPromise;
  
  initPromise = new Promise<void>((resolve) => {
    // Only initialize in browser with proper config
    if (typeof window === 'undefined') {
      console.log('🏗️ Firebase init skipped - SSR environment');
      resolve();
      return;
    }
    
    const hasValidConfig = process.env.NEXT_PUBLIC_FIREBASE_API_KEY && 
                          process.env.NEXT_PUBLIC_FIREBASE_API_KEY !== 'demo-api-key';
    
    if (!hasValidConfig) {
      console.log('⚠️ Firebase not configured - using offline mode');
      resolve();
      return;
    }

    try {
      app = initializeApp(firebaseConfig);
      db = getFirestore(app);
      auth = getAuth(app);
      console.log('✅ Firebase initialized successfully');
    } catch (error) {
      console.error('❌ Firebase initialization failed:', error);
      app = null;
      db = null;
      auth = null;
    }
    
    resolve();
  });
  
  return initPromise;
}

// Auto-initialize on module load only in browser
if (typeof window !== 'undefined') {
  initializeFirebaseIfNeeded();
}

// Export getters for lazy access
export const getFirestoreDB = () => {
  initializeFirebaseIfNeeded();
  return db;
};

export const getFirebaseAuth = () => {
  initializeFirebaseIfNeeded();
  return auth;
};

// For backward compatibility
export { db, auth };

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

export default app;