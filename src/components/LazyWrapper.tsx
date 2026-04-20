import { Suspense, ReactNode } from 'react';

interface LazyWrapperProps {
  children: ReactNode;
}

/**
 * Wrapper component for lazy-loaded components
 * Shows spinner while component is loading
 */
export function LazyWrapper({ children }: LazyWrapperProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="text-sm text-gray-500">Loading...</p>
          </div>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
