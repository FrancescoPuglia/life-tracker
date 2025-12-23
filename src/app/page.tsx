'use client';

import { ReactNode } from 'react';
import { AuthProvider, useAuthContext } from '@/providers/AuthProvider';
import { DataProvider, useDataContext } from '@/providers/DataProvider';
import AuthModal from '@/components/AuthModal';
import MainApp from '@/components/MainApp';

// ============================================================================
// BUILD INFO
// ============================================================================
const BUILD_ID = `2025-12-22-v3-${Date.now().toString(36)}`;

// ============================================================================
// LOADING SCREENS - Pure UI, no logic
// ============================================================================

function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-8">
          <div className="w-20 h-20 border-4 border-blue-200 rounded-full border-r-blue-600 animate-spin" />
        </div>
        <h2 className="text-3xl font-bold text-white mb-4">Life Tracker</h2>
        <p className="text-slate-300 text-lg">{message}</p>
      </div>
    </div>
  );
}

function LoginScreen() {
  const { user } = useAuthContext();
  return <AuthModal isOpen={!user} onClose={() => {}} />;
}

// ============================================================================
// AUTH GATE - Decides what to show based on auth status
// ============================================================================

function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuthContext();
  
  // State: unknown -> show loading
  if (status === 'unknown') {
    return <LoadingScreen message="Checking authentication..." />;
  }
  
  // State: signedOut -> show login
  if (status === 'signedOut') {
    return <LoginScreen />;
  }
  
  // State: signedIn -> render children (DataProvider + App)
  return <>{children}</>;
}

// ============================================================================
// DATA GATE - Wraps app with DataProvider and shows loading while data loads
// ============================================================================

function DataGate() {
  const { user } = useAuthContext();
  
  // This should never happen if AuthGate is working correctly
  if (!user) {
    return <LoadingScreen message="Preparing..." />;
  }
  
  return (
    <DataProvider userId={user.uid}>
      <DataLoadingGate />
    </DataProvider>
  );
}

function DataLoadingGate() {
  const { status } = useDataContext();
  
  // State: idle or loading -> show loading
  if (status === 'idle' || status === 'loading') {
    return <LoadingScreen message="Loading your data..." />;
  }
  
  // State: error -> show error (but still render app for graceful degradation)
  // State: ready -> render app
  return <MainApp buildId={BUILD_ID} />;
}

// ============================================================================
// PAGE - Just provider composition, nothing else
// ============================================================================

export default function HomePage() {
  return (
    <AuthProvider>
      <AuthGate>
        <DataGate />
      </AuthGate>
    </AuthProvider>
  );
}