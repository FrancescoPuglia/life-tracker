"use client";

import { useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { 
  LazyVisionBoardList, 
  LazyVisionBoardView, 
  LazyRitualMode,
  preloadVisionBoardComponents,
  useVisionBoardPerformance
} from './VisionBoardLoader';
import type { VisionBoard, Goal, Project, Task } from '@/types';
import { db } from '@/lib/database';

// ============================================================================
// VISION BOARD MANAGER - Main Integration Component
// ============================================================================

interface VisionBoardManagerProps {
  userId: string;
  currentUserId?: string;
  goals?: Goal[];
  projects?: Project[];
  tasks?: Task[];
  className?: string;
}

type ViewMode = 'list' | 'board' | 'ritual';

export function VisionBoardManager({
  userId,
  currentUserId,
  goals = [],
  projects = [],
  tasks = [],
  className = ""
}: VisionBoardManagerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedBoard, setSelectedBoard] = useState<VisionBoard | null>(null);
  const [visionBoards, setVisionBoards] = useState<VisionBoard[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const performance = useVisionBoardPerformance();

  // Load vision boards on mount
  useEffect(() => {
    loadVisionBoards();
    
    // Preload components for better UX
    preloadVisionBoardComponents();
  }, [userId]);

  const loadVisionBoards = async () => {
    try {
      setIsLoading(true);
      const boards = await db.getVisionBoards(userId);
      setVisionBoards(boards);
    } catch (error) {
      console.error('Failed to load vision boards:', error);
      // Could show error toast here
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateBoard = async () => {
    try {
      const newBoard = await db.createVisionBoard({
        userId,
        domainId: 'default', // TODO: Get from user context
        title: 'New Vision Board',
        description: 'Manifest your dreams and goals',
        isActive: false
      });
      
      setVisionBoards(prev => [newBoard, ...prev]);
      setSelectedBoard(newBoard);
      setViewMode('board');
    } catch (error) {
      console.error('Failed to create vision board:', error);
    }
  };

  const handleEditBoard = (board: VisionBoard) => {
    setSelectedBoard(board);
    setViewMode('board');
  };

  const handleViewBoard = (board: VisionBoard) => {
    setSelectedBoard(board);
    setViewMode('board');
  };

  const handleRitualMode = (board: VisionBoard) => {
    setSelectedBoard(board);
    setViewMode('ritual');
  };

  const handleBackToList = () => {
    setSelectedBoard(null);
    setViewMode('list');
    // Refresh boards list in case of changes
    loadVisionBoards();
  };

  const handleCloseRitual = () => {
    setViewMode(selectedBoard ? 'board' : 'list');
  };

  // Performance monitoring
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('Vision Board Performance Metrics:', performance);
    }
  }, [performance]);

  // Render based on view mode
  switch (viewMode) {
    case 'ritual':
      return selectedBoard ? (
        <LazyRitualMode
          board={selectedBoard}
          linkedGoal={goals.find(g => g.id === selectedBoard.linkedGoalId)}
          onClose={handleCloseRitual}
        />
      ) : null;

    case 'board':
      return selectedBoard ? (
        <LazyVisionBoardView
          board={selectedBoard}
          userId={userId}
          goals={goals}
          projects={projects}
          tasks={tasks}
          onBack={handleBackToList}
          onRitualMode={() => handleRitualMode(selectedBoard)}
          className={className}
        />
      ) : null;

    case 'list':
    default:
      return (
        <LazyVisionBoardList
          userId={userId}
          goals={goals}
          onCreateBoard={handleCreateBoard}
          onEditBoard={handleEditBoard}
          onViewBoard={handleViewBoard}
          onRitualMode={handleRitualMode}
          className={className}
        />
      );
  }
}

// ============================================================================
// VISION BOARD NAVIGATION COMPONENT
// ============================================================================

interface VisionBoardNavProps {
  userId: string;
  onNavigate?: () => void;
  className?: string;
}

export function VisionBoardNav({
  userId,
  onNavigate,
  className = ""
}: VisionBoardNavProps) {
  const [boardCount, setBoardCount] = useState(0);
  const [hasActiveBoard, setHasActiveBoard] = useState(false);

  useEffect(() => {
    loadBoardStats();
  }, [userId]);

  const loadBoardStats = async () => {
    try {
      const [boards, activeBoards] = await Promise.all([
        db.getVisionBoards(userId),
        db.getActiveVisionBoards(userId)
      ]);
      
      setBoardCount(boards.length);
      setHasActiveBoard(activeBoards.length > 0);
    } catch (error) {
      console.error('Failed to load board stats:', error);
    }
  };

  return (
    <button
      onClick={() => {
        preloadVisionBoardComponents(); // Start preloading
        onNavigate?.();
      }}
      onMouseEnter={preloadVisionBoardComponents} // Preload on hover
      className={`relative group flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 hover:from-purple-100 hover:to-blue-100 dark:hover:from-purple-900/30 dark:hover:to-blue-900/30 transition-all duration-200 ${className}`}
    >
      <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg">
        <Sparkles className="h-5 w-5 text-white" />
      </div>
      
      <div className="flex-1 text-left">
        <div className="font-medium text-gray-900 dark:text-white">
          Vision Boards
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {boardCount === 0 ? 'Start manifesting' : `${boardCount} boards`}
        </div>
      </div>

      {hasActiveBoard && (
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-pulse" />
      )}

      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="w-5 h-5 text-gray-400">
          →
        </div>
      </div>
    </button>
  );
}

// ============================================================================
// QUICK RITUAL LAUNCHER
// ============================================================================

interface QuickRitualProps {
  userId: string;
  className?: string;
}

export function QuickRitual({
  userId,
  className = ""
}: QuickRitualProps) {
  const [activeBoard, setActiveBoard] = useState<VisionBoard | null>(null);
  const [isRitualOpen, setIsRitualOpen] = useState(false);

  useEffect(() => {
    loadActiveBoard();
  }, [userId]);

  const loadActiveBoard = async () => {
    try {
      const activeBoards = await db.getActiveVisionBoards(userId);
      if (activeBoards.length > 0) {
        setActiveBoard(activeBoards[0]); // Use the first active board
      }
    } catch (error) {
      console.error('Failed to load active board:', error);
    }
  };

  const startRitual = () => {
    if (activeBoard) {
      preloadVisionBoardComponents();
      setIsRitualOpen(true);
    }
  };

  if (!activeBoard) {
    return null; // Don't show if no active board
  }

  return (
    <>
      <button
        onClick={startRitual}
        onMouseEnter={preloadVisionBoardComponents}
        className={`flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all transform hover:scale-105 shadow-lg ${className}`}
      >
        <Sparkles className="h-4 w-4" />
        <span>Quick Ritual</span>
      </button>

      {isRitualOpen && activeBoard && (
        <LazyRitualMode
          board={activeBoard}
          onClose={() => setIsRitualOpen(false)}
        />
      )}
    </>
  );
}

export default VisionBoardManager;