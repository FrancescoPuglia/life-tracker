'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useAuth, AuthUser } from '@/lib/auth';

// ============================================================================
// AUTH STATE MACHINE
// States: unknown -> signedIn | signedOut
// Transitions are ONE-WAY and FINAL (no loops)
// ============================================================================

type AuthStatus = 'unknown' | 'signedIn' | 'signedOut';

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used within AuthProvider');
  }
  return ctx;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const auth = useAuth();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('unknown');

  useEffect(() => {
    // RULE: This effect runs ONCE and sets up the listener
    // The listener will fire ONCE with the auth state
    // After that, status is FINAL (signedIn or signedOut)
    console.log('AuthProvider subscribe', { auth });
    // Timeout: if auth doesn't resolve in 5s, assume signedOut
    let timeout: ReturnType<typeof setTimeout> | undefined = undefined;
    timeout = setTimeout(() => {
      console.warn('[AuthProvider] Auth timeout - assuming signedOut');
      setUser(null);
      setStatus('signedOut');
      console.log('AuthProvider status => signedOut (timeout)');
    }, 5000);
    const unsubscribe = auth.onAuthStateChange((authUser) => {
      console.log('AuthProvider onAuthStateChanged', { uid: authUser?.uid ?? null });
      clearTimeout(timeout);
      setUser(authUser ?? null);
      setStatus(authUser ? 'signedIn' : 'signedOut');
      console.log('AuthProvider status =>', authUser ? 'signedIn' : 'signedOut');
    });
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, []); // Empty deps = runs once

  // LOG: quale auth instance?
  useEffect(() => {
    console.log('[AuthProvider] Using auth instance:', auth);
  }, [auth]);

  const handleSignIn = useCallback(async (email: string, password: string) => {
    console.log('[AuthProvider] handleSignIn called', { email });
    await auth.signIn(email, password);
    // Non chiudere modal qui, AuthGate farà il resto
  }, [auth]);

  const handleSignUp = useCallback(async (email: string, password: string, displayName?: string) => {
    console.log('[AuthProvider] handleSignUp called', { email });
    await auth.signUp(email, password, displayName);
  }, [auth]);

  const handleSendPasswordReset = useCallback(async (email: string) => {
    console.log('[AuthProvider] handleSendPasswordReset called', { email });
    await auth.sendPasswordReset(email);
  }, [auth]);

  const handleSignInWithGoogle = useCallback(async () => {
    console.log('[AuthProvider] handleSignInWithGoogle called');
    await auth.signInWithGoogle();
  }, [auth]);

  const handleSignOut = useCallback(async () => {
    await auth.signOut();
    setUser(null);
    setStatus('signedOut');
  }, [auth]);

  return (
    <AuthContext.Provider value={{
      user,
      status,
      signIn: handleSignIn,
      signUp: handleSignUp,
      sendPasswordReset: handleSendPasswordReset,
      signInWithGoogle: handleSignInWithGoogle,
      signOut: handleSignOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}