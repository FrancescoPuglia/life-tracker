"use client";

import React, { lazy, Suspense, useState, useEffect } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';

// Lazy load Vision Board components for performance
const VisionBoardList = lazy(() => import('./VisionBoardList').then(module => ({ default: module.VisionBoardList })));
const VisionBoardView = lazy(() => import('./VisionBoardView').then(module => ({ default: module.VisionBoardView })));
const RitualMode = lazy(() => import('./RitualMode').then(module => ({ default: module.RitualMode })));

// ============================================================================
// LOADING COMPONENTS
// ============================================================================

interface VisionBoardLoadingProps {
  text?: string;
  className?: string;
}

function VisionBoardLoading({ 
  text = "Loading your vision boards...", 
  className = "" 
}: VisionBoardLoadingProps) {
  const [loadingDots, setLoadingDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setLoadingDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className={`flex flex-col items-center justify-center min-h-[400px] ${className}`}>
      <div className="relative mb-6">
        <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center animate-pulse">
          <Sparkles className="h-8 w-8 text-white" />
        </div>
        <div className="absolute inset-0 w-16 h-16 border-4 border-purple-200 dark:border-purple-800 rounded-full animate-spin border-t-transparent"></div>
      </div>
      
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        {text}{loadingDots}
      </h3>
      
      <p className="text-sm text-gray-600 dark:text-gray-400 text-center max-w-md">
        Preparing your visual manifestation experience
      </p>

      <div className="mt-4 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Optimizing for peak inspiration</span>
      </div>
    </div>
  );
}

function RitualModeLoading() {
  return (
    <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
      <div className="text-center text-white">
        <div className="relative mb-8">
          <div className="w-24 h-24 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <div className="absolute inset-0 w-24 h-24 border-4 border-blue-500 border-b-transparent rounded-full animate-spin-reverse mx-auto"></div>
          <Sparkles className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 h-8 w-8 text-white animate-pulse" />
        </div>
        
        <h2 className="text-3xl font-bold mb-4">Entering Ritual Mode</h2>
        <p className="text-xl text-gray-300 mb-8">
          Preparing your sacred manifestation space...
        </p>

        <div className="flex justify-center space-x-1">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-2 h-8 bg-white rounded-full animate-pulse"
              style={{ 
                animationDelay: `${i * 0.3}s`,
                animationDuration: '1.5s'
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// ERROR BOUNDARY FOR VISION BOARD
// ============================================================================

interface VisionBoardErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class VisionBoardErrorBoundary extends React.Component<
  React.PropsWithChildren<{}>,
  VisionBoardErrorBoundaryState
> {
  constructor(props: React.PropsWithChildren<{}>) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): VisionBoardErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Vision Board Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[400px] flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 mx-auto mb-6 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
              <Sparkles className="h-8 w-8 text-red-600 dark:text-red-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Vision Board Temporarily Unavailable
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              We're working to restore your manifestation experience. Please try refreshing the page.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============================================================================
// LAZY LOADED WRAPPER COMPONENTS
// ============================================================================

interface LazyVisionBoardListProps {
  userId: string;
  goals?: any[];
  onCreateBoard?: () => void;
  onEditBoard?: (board: any) => void;
  onViewBoard?: (board: any) => void;
  onRitualMode?: (board: any) => void;
  className?: string;
}

export function LazyVisionBoardList(props: LazyVisionBoardListProps) {
  return (
    <VisionBoardErrorBoundary>
      <Suspense fallback={<VisionBoardLoading text="Loading vision boards" />}>
        <VisionBoardList {...props} />
      </Suspense>
    </VisionBoardErrorBoundary>
  );
}

interface LazyVisionBoardViewProps {
  board?: any; // Optional - will create if not provided
  goalId?: string; // For creating new board linked to goal
  userId: string;
  domainId?: string;
  goals?: any[];
  projects?: any[];
  tasks?: any[];
  onBack?: () => void;
  onEdit?: () => void;
  onRitualMode?: () => void;
  onBoardCreated?: (board: any) => void;
  className?: string;
}

export function LazyVisionBoardView(props: LazyVisionBoardViewProps) {
  return (
    <VisionBoardErrorBoundary>
      <Suspense fallback={<VisionBoardLoading text="Loading vision board" />}>
        <VisionBoardView {...props} />
      </Suspense>
    </VisionBoardErrorBoundary>
  );
}

interface LazyRitualModeProps {
  board: any;
  visionItems?: any[];
  linkedGoal?: any;
  onClose: () => void;
  autoplayDuration?: number;
}

export function LazyRitualMode(props: LazyRitualModeProps) {
  return (
    <VisionBoardErrorBoundary>
      <Suspense fallback={<RitualModeLoading />}>
        <RitualMode {...props} />
      </Suspense>
    </VisionBoardErrorBoundary>
  );
}

// ============================================================================
// PRELOADER UTILITY
// ============================================================================

export const preloadVisionBoardComponents = () => {
  // Preload components when user hovers over Vision Board navigation
  import('./VisionBoardList');
  import('./VisionBoardView'); 
  import('./RitualMode');
};

// ============================================================================
// PERFORMANCE MONITORING HOOK
// ============================================================================

export function useVisionBoardPerformance() {
  const [metrics, setMetrics] = useState({
    loadTime: 0,
    renderTime: 0,
    interactionTime: 0
  });

  useEffect(() => {
    const startTime = performance.now();
    
    // Measure component load time
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.name.includes('VisionBoard')) {
          setMetrics(prev => ({
            ...prev,
            loadTime: entry.duration
          }));
        }
      });
    });

    observer.observe({ entryTypes: ['measure'] });

    return () => {
      observer.disconnect();
      const endTime = performance.now();
      setMetrics(prev => ({
        ...prev,
        renderTime: endTime - startTime
      }));
    };
  }, []);

  return metrics;
}

export default LazyVisionBoardList;