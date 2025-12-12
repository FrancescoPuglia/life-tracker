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

// Initialize Firebase only if we have real config
let app: any = null;
let db: any = null;
let auth: any = null;

const hasFirebaseConfig = typeof window !== 'undefined' && 
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY && 
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY !== 'demo-api-key';

if (hasFirebaseConfig) {
  try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    console.log('✅ Firebase initialized successfully');
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error);
    // Keep as null to prevent function calls
    app = null;
    db = null;
    auth = null;
  }
} else {
  console.warn('⚠️ Firebase not configured - using offline mode');
  // Keep as null instead of empty objects
  app = null;
  db = null;
  auth = null;
}

// Export the initialized objects
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