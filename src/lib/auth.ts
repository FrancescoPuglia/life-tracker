import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
  sendPasswordResetEmail,
  updateProfile,
  sendEmailVerification,
  AuthError
} from 'firebase/auth';
import { auth } from './firebase';
import { db } from './database';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
}

class AuthManager {
  private static instance: AuthManager;
  private listeners: ((user: AuthUser | null) => void)[] = [];
  private currentUser: AuthUser | null = null;
  
  static getInstance(): AuthManager {
    if (!AuthManager.instance) {
      AuthManager.instance = new AuthManager();
    }
    return AuthManager.instance;
  }

  constructor() {
    if (typeof window !== 'undefined') {
      this.initAuthStateListener();
    }
  }

  private initAuthStateListener() {
    if (!auth) {
      console.warn('⚠️ Firebase Auth not initialized - skipping auth state listener');
      return;
    }
    
    onAuthStateChanged(auth, (firebaseUser: FirebaseUser | null) => {
      const user = firebaseUser ? this.mapFirebaseUser(firebaseUser) : null;
      this.currentUser = user;
      
      // Switch database to Firebase when user logs in
      if (user) {
        db.switchToFirebase(user.uid).catch(error => {
          console.error('Failed to switch to Firebase:', error);
        });
      }
      
      // Notify all listeners
      this.listeners.forEach(listener => listener(user));
    });
  }

  private mapFirebaseUser(firebaseUser: FirebaseUser): AuthUser {
    return {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName,
      photoURL: firebaseUser.photoURL,
      emailVerified: firebaseUser.emailVerified,
    };
  }

  getCurrentUser(): AuthUser | null {
    return this.currentUser;
  }

  onAuthStateChange(listener: (user: AuthUser | null) => void): () => void {
    this.listeners.push(listener);
    
    // Immediately call with current state
    listener(this.currentUser);
    
    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  async signInWithEmail(email: string, password: string): Promise<AuthUser> {
    if (!auth) {
      throw new Error('Firebase Auth not initialized. Please check your Firebase configuration.');
    }
    
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      return this.mapFirebaseUser(userCredential.user);
    } catch (error) {
      throw this.handleAuthError(error as AuthError);
    }
  }

  async signUpWithEmail(email: string, password: string, displayName?: string): Promise<AuthUser> {
    if (!auth) {
      throw new Error('Firebase Auth not initialized. Please check your Firebase configuration.');
    }
    
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      
      // Update profile with display name
      if (displayName) {
        await updateProfile(userCredential.user, { displayName });
      }
      
      // Send email verification
      await sendEmailVerification(userCredential.user);
      
      return this.mapFirebaseUser(userCredential.user);
    } catch (error) {
      throw this.handleAuthError(error as AuthError);
    }
  }

  async signInWithGoogle(): Promise<AuthUser> {
    if (!auth) {
      throw new Error('Firebase Auth not initialized. Please check your Firebase configuration.');
    }
    
    try {
      const provider = new GoogleAuthProvider();
      // Add scopes for better user info
      provider.addScope('profile');
      provider.addScope('email');
      
      const userCredential = await signInWithPopup(auth, provider);
      return this.mapFirebaseUser(userCredential.user);
    } catch (error) {
      throw this.handleAuthError(error as AuthError);
    }
  }

  async signOut(): Promise<void> {
    if (!auth) {
      throw new Error('Firebase Auth not initialized. Please check your Firebase configuration.');
    }
    
    try {
      await signOut(auth);
      // Switch back to IndexedDB when user signs out
      await db.switchToIndexedDB();
    } catch (error) {
      throw this.handleAuthError(error as AuthError);
    }
  }

  async sendPasswordReset(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      throw this.handleAuthError(error as AuthError);
    }
  }

  async updateUserProfile(updates: { displayName?: string; photoURL?: string }): Promise<void> {
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('No authenticated user');
      
      await updateProfile(user, updates);
    } catch (error) {
      throw this.handleAuthError(error as AuthError);
    }
  }

  async sendEmailVerification(): Promise<void> {
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('No authenticated user');
      
      await sendEmailVerification(user);
    } catch (error) {
      throw this.handleAuthError(error as AuthError);
    }
  }

  private handleAuthError(error: AuthError): Error {
    let message = 'An authentication error occurred';
    
    switch (error.code) {
      case 'auth/user-not-found':
        message = 'No user found with this email address';
        break;
      case 'auth/wrong-password':
        message = 'Incorrect password';
        break;
      case 'auth/email-already-in-use':
        message = 'An account already exists with this email address';
        break;
      case 'auth/weak-password':
        message = 'Password should be at least 6 characters';
        break;
      case 'auth/invalid-email':
        message = 'Invalid email address';
        break;
      case 'auth/too-many-requests':
        message = 'Too many failed attempts. Try again later';
        break;
      case 'auth/popup-closed-by-user':
        message = 'Sign-in popup was closed';
        break;
      case 'auth/cancelled-popup-request':
        message = 'Sign-in was cancelled';
        break;
      case 'auth/network-request-failed':
        message = 'Network error. Check your internet connection';
        break;
      default:
        message = error.message || 'Authentication failed';
    }
    
    console.error('Auth Error:', error);
    return new Error(message);
  }

  isSignedIn(): boolean {
    return this.currentUser !== null;
  }

  requireAuth(): AuthUser {
    if (!this.currentUser) {
      throw new Error('Authentication required');
    }
    return this.currentUser;
  }
}

export const authManager = AuthManager.getInstance();

// Hook-like function for React components
export const useAuth = () => {
  return {
    signIn: authManager.signInWithEmail.bind(authManager),
    signUp: authManager.signUpWithEmail.bind(authManager),
    signInWithGoogle: authManager.signInWithGoogle.bind(authManager),
    signOut: authManager.signOut.bind(authManager),
    sendPasswordReset: authManager.sendPasswordReset.bind(authManager),
    updateProfile: authManager.updateUserProfile.bind(authManager),
    sendEmailVerification: authManager.sendEmailVerification.bind(authManager),
    getCurrentUser: authManager.getCurrentUser.bind(authManager),
    onAuthStateChange: authManager.onAuthStateChange.bind(authManager),
    isSignedIn: authManager.isSignedIn.bind(authManager),
    requireAuth: authManager.requireAuth.bind(authManager),
  };
};