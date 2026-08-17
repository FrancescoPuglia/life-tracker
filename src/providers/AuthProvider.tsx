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
    // Subscribe to the active auth adapter; implementations keep this object
    // stable, and a replacement adapter receives a fresh listener.
    // Timeout: if auth doesn't resolve in 5s, assume signedOut
    let timeout: ReturnType<typeof setTimeout> | undefined = undefined;
    timeout = setTimeout(() => {
      console.warn('[AuthProvider] Auth timeout - assuming signedOut');
      setUser(null);
      setStatus('signedOut');
    }, 5000);
    const unsubscribe = auth.onAuthStateChange((authUser) => {
      clearTimeout(timeout);
      setUser(authUser ?? null);
      setStatus(authUser ? 'signedIn' : 'signedOut');
    });
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [auth]);

  const handleSignIn = useCallback(async (email: string, password: string) => {
    await auth.signIn(email, password);
    // Non chiudere modal qui, AuthGate farà il resto
  }, [auth]);

  const handleSignUp = useCallback(async (email: string, password: string, displayName?: string) => {
    await auth.signUp(email, password, displayName);
  }, [auth]);

  const handleSendPasswordReset = useCallback(async (email: string) => {
    await auth.sendPasswordReset(email);
  }, [auth]);

  const handleSignInWithGoogle = useCallback(async () => {
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
