'use client';

import { ReactNode } from 'react';
import { AuthProvider, useAuthContext } from '@/providers/AuthProvider';
import { DataProvider, useDataContext } from '@/providers/DataProvider';
import AuthModal from '@/components/AuthModal';
import MainApp from '@/components/MainApp';
import DesktopReminderRuntime from '@/components/desktop/DesktopReminderRuntime';
import { BUILD_ID } from '@/lib/buildInfo';

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
      <DesktopReminderRuntime uid={user.uid} />
      <DataLoadingGate />
    </DataProvider>
  );
}

function DataLoadingGate() {
  const { status, loadError, retryLoad } = useDataContext();
  
  // State: idle or loading -> show loading
  if (status === 'idle' || status === 'loading') {
    return <LoadingScreen message="Loading your data..." />;
  }
  
  if (status === 'error') {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center px-6">
        <div className="max-w-lg text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Life Tracker</h2>
          <p role="alert" className="text-slate-200 text-lg mb-6">
            {loadError || 'Production data could not be loaded.'}
          </p>
          <button
            type="button"
            onClick={retryLoad}
            className="rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

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
