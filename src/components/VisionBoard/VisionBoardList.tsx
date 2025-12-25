"use client";

import { useState, useEffect } from 'react';
import { 
  Plus, Eye, Edit3, Trash2, Target, Calendar, 
  Image as ImageIcon, Play, Star, Share
} from 'lucide-react';
import type { VisionBoard, Goal } from '@/types';

// ============================================================================
// VISION BOARD LIST COMPONENT
// ============================================================================

interface VisionBoardListProps {
  userId: string;
  goals?: Goal[];
  onCreateBoard?: () => void;
  onEditBoard?: (board: VisionBoard) => void;
  onViewBoard?: (board: VisionBoard) => void;
  onRitualMode?: (board: VisionBoard) => void;
  className?: string;
}

export function VisionBoardList({
  userId,
  goals = [],
  onCreateBoard,
  onEditBoard,
  onViewBoard,
  onRitualMode,
  className = ""
}: VisionBoardListProps) {
  const [boards, setBoards] = useState<VisionBoard[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Mock data for initial implementation
  useEffect(() => {
    // TODO: Replace with actual database call
    const mockBoards: VisionBoard[] = [
      {
        id: '1',
        userId: userId,
        domainId: 'domain1',
        title: 'Dream Life 2025',
        description: 'My vision for an extraordinary life filled with growth and adventure',
        linkedGoalId: goals[0]?.id,
        backgroundColor: '#1e40af',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: '2', 
        userId: userId,
        domainId: 'domain1',
        title: 'Career Mastery',
        description: 'Professional excellence and leadership in my field',
        linkedGoalId: goals[1]?.id,
        backgroundColor: '#059669',
        isActive: false,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
    
    setTimeout(() => {
      setBoards(mockBoards);
      setIsLoading(false);
    }, 500);
  }, [userId, goals]);

  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-48 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Vision Boards
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Manifest your goals through visual inspiration
          </p>
        </div>

        <button
          onClick={onCreateBoard}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all duration-200 transform hover:scale-105 shadow-lg"
        >
          <Plus className="h-5 w-5" />
          Create Board
        </button>
      </div>

      {/* Vision Boards Grid */}
      {boards.length === 0 ? (
        <div className="text-center py-12">
          <div className="max-w-md mx-auto">
            <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
              <ImageIcon className="h-12 w-12 text-white" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Start Your Vision Journey
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Create your first vision board to visualize and manifest your dreams
            </p>
            <button
              onClick={onCreateBoard}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all duration-200 transform hover:scale-105 shadow-lg"
            >
              <Plus className="h-5 w-5" />
              Create First Board
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {boards.map(board => (
            <VisionBoardCard
              key={board.id}
              board={board}
              linkedGoal={goals.find(g => g.id === board.linkedGoalId)}
              onEdit={() => onEditBoard?.(board)}
              onView={() => onViewBoard?.(board)}
              onRitualMode={() => onRitualMode?.(board)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// VISION BOARD CARD COMPONENT
// ============================================================================

interface VisionBoardCardProps {
  board: VisionBoard;
  linkedGoal?: Goal;
  onEdit?: () => void;
  onView?: () => void;
  onRitualMode?: () => void;
}

function VisionBoardCard({
  board,
  linkedGoal,
  onEdit,
  onView,
  onRitualMode
}: VisionBoardCardProps) {
  return (
    <div 
      className="group relative bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 overflow-hidden border border-gray-200 dark:border-gray-700"
      style={{
        background: board.backgroundColor ? 
          `linear-gradient(135deg, ${board.backgroundColor}22, ${board.backgroundColor}11)` : 
          undefined
      }}
    >
      {/* Active Badge */}
      {board.isActive && (
        <div className="absolute top-3 right-3 z-10">
          <div className="flex items-center gap-1 px-2 py-1 bg-green-500 text-white text-xs rounded-full">
            <Star className="h-3 w-3 fill-current" />
            Active
          </div>
        </div>
      )}

      {/* Cover Image Placeholder */}
      <div 
        className="h-32 bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center"
        style={{
          background: board.backgroundColor ? 
            `linear-gradient(135deg, ${board.backgroundColor}, ${board.backgroundColor}88)` : 
            undefined
        }}
      >
        <ImageIcon className="h-12 w-12 text-white opacity-50" />
      </div>

      {/* Content */}
      <div className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 line-clamp-1">
          {board.title}
        </h3>
        
        <p className="text-gray-600 dark:text-gray-400 text-sm mb-4 line-clamp-2">
          {board.description}
        </p>

        {/* Linked Goal */}
        {linkedGoal && (
          <div className="flex items-center gap-2 mb-4 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <Target className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm text-blue-700 dark:text-blue-300 truncate">
              {linkedGoal.title}
            </span>
          </div>
        )}

        {/* Meta Info */}
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mb-4">
          <div className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {new Date(board.updatedAt).toLocaleDateString()}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onView}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <Eye className="h-4 w-4" />
            View
          </button>
          
          <button
            onClick={onRitualMode}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all"
          >
            <Play className="h-4 w-4" />
            Ritual
          </button>

          <button
            onClick={onEdit}
            className="px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <Edit3 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Hover Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
    </div>
  );
}

export default VisionBoardList;