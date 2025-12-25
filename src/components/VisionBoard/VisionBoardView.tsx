"use client";

import { useState, useEffect } from 'react';
import { 
  ArrowLeft, Plus, Edit3, Trash2, Download, Share, 
  Target, Play, Maximize, Grid, LayoutGrid, Quote,
  Image as ImageIcon, Video, Music, Sparkles
} from 'lucide-react';
import VisionItemEditor from './VisionItemEditor';
import { VisionBoardCreator } from './VisionBoardCreator';
import { db } from '@/lib/database';
import type { VisionBoard, VisionItem, Goal, Project, Task } from '@/types';

// ============================================================================
// VISION BOARD VIEW COMPONENT - Main Board Display
// ============================================================================

interface VisionBoardViewProps {
  board?: VisionBoard; // Optional - will create if not provided
  goalId?: string; // For creating new board linked to goal
  userId: string;
  domainId?: string;
  goals?: Goal[];
  projects?: Project[];
  tasks?: Task[];
  onBack?: () => void;
  onEdit?: () => void;
  onRitualMode?: () => void;
  onBoardCreated?: (board: VisionBoard) => void;
  className?: string;
}

export function VisionBoardView({
  board: initialBoard,
  goalId,
  userId,
  domainId = 'default',
  goals = [],
  projects = [],
  tasks = [],
  onBack,
  onEdit,
  onRitualMode,
  onBoardCreated,
  className = ""
}: VisionBoardViewProps) {
  console.log('🔍 SHERLOCK: VisionBoardView rendered with:', {
    initialBoard: !!initialBoard,
    goalId,
    userId,
    domainId,
    goalsCount: goals.length
  });

  const [board, setBoard] = useState<VisionBoard | null>(initialBoard || null);
  const [visionItems, setVisionItems] = useState<VisionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'masonry'>('masonry');
  const [isEditing, setIsEditing] = useState(false);
  const [showItemEditor, setShowItemEditor] = useState(false);
  const [editingItem, setEditingItem] = useState<VisionItem | null>(null);
  const [needsNewBoard, setNeedsNewBoard] = useState(!initialBoard);

  // Load vision items from database
  useEffect(() => {
    if (board) {
      loadVisionItems();
    } else {
      setIsLoading(false);
    }
  }, [board?.id]);

  const loadVisionItems = async () => {
    if (!board) return;
    
    try {
      setIsLoading(true);
      const items = await db.getVisionItems(board.id);
      setVisionItems(items);
    } catch (error) {
      console.error('Failed to load vision items:', error);
      setVisionItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateBoard = async (newBoard: VisionBoard) => {
    setBoard(newBoard);
    setNeedsNewBoard(false);
    onBoardCreated?.(newBoard);
  };

  const handleAddItem = () => {
    setEditingItem(null);
    setShowItemEditor(true);
  };

  const handleEditItem = (item: VisionItem) => {
    setEditingItem(item);
    setShowItemEditor(true);
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Are you sure you want to delete this vision item?')) return;
    
    try {
      await db.deleteVisionItem(itemId);
      setVisionItems(prev => prev.filter(item => item.id !== itemId));
    } catch (error) {
      console.error('Failed to delete vision item:', error);
    }
  };

  const handleSaveItem = (savedItem: VisionItem) => {
    if (editingItem) {
      // Update existing item
      setVisionItems(prev => prev.map(item => 
        item.id === savedItem.id ? savedItem : item
      ));
    } else {
      // Add new item
      setVisionItems(prev => [...prev, savedItem]);
    }
    setShowItemEditor(false);
    setEditingItem(null);
  };

  const linkedGoal = goals.find(g => g.id === board?.linkedGoalId);

  // Show Vision Board Creator if no board exists
  if (needsNewBoard && !board) {
    return (
      <div className={`space-y-6 ${className}`}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
            Back
          </button>
        </div>
        
        <VisionBoardCreator
          goalId={goalId || ''}
          userId={userId}
          domainId={domainId}
          goals={goals}
          onBoardCreated={handleCreateBoard}
          onClose={onBack}
        />
      </div>
    );
  }

  // Show Item Editor Modal
  if (showItemEditor) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <VisionItemEditor
          boardId={board?.id || ''}
          userId={userId}
          domainId={domainId}
          item={editingItem || undefined}
          goals={goals}
          projects={projects}
          tasks={tasks}
          onSave={handleSaveItem}
          onCancel={() => setShowItemEditor(false)}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="animate-pulse">
          <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded mb-6"></div>
          <div className="h-96 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {board?.title || 'Vision Board'}
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              {board?.description || 'Create your vision board'}
            </p>
            
            {linkedGoal && (
              <div className="flex items-center gap-2 mt-2">
                <Target className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm text-blue-700 dark:text-blue-300">
                  Linked to: {linkedGoal.title}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-md transition-colors ${
                viewMode === 'grid' 
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow' 
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('masonry')}
              className={`p-2 rounded-md transition-colors ${
                viewMode === 'masonry' 
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow' 
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>

          {/* Action Buttons */}
          <button
            onClick={() => {
              console.log('🔍 SHERLOCK: Edit toggle clicked, current state:', isEditing);
              setIsEditing(!isEditing);
            }}
            className={`px-4 py-2 rounded-lg transition-colors ${
              isEditing 
                ? 'bg-orange-600 text-white hover:bg-orange-700' 
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <Edit3 className="h-4 w-4" />
          </button>

          <button
            onClick={onRitualMode}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all transform hover:scale-105 shadow-lg"
          >
            <Maximize className="h-4 w-4" />
            Ritual Mode
          </button>
        </div>
      </div>

      {/* Vision Board Canvas */}
      <div className="relative">
        {/* Add Item Actions (when editing) */}
        {isEditing && (
          <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
            {/* Quick Add Buttons */}
            <div className="flex items-center gap-1 bg-white dark:bg-gray-800 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 p-1">
              <button
                onClick={() => {
                  console.log('🔍 SHERLOCK: Image button clicked');
                  setEditingItem({ type: 'image', boardId: board?.id || '', userId, domainId } as VisionItem);
                  setShowItemEditor(true);
                }}
                className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-full transition-colors"
                title="Add Image"
              >
                <ImageIcon className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setEditingItem({ type: 'video', boardId: board?.id || '', userId, domainId } as VisionItem);
                  setShowItemEditor(true);
                }}
                className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition-colors"
                title="Add Video"
              >
                <Video className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setEditingItem({ type: 'audio', boardId: board?.id || '', userId, domainId } as VisionItem);
                  setShowItemEditor(true);
                }}
                className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-full transition-colors"
                title="Add Audio"
              >
                <Music className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setEditingItem({ type: 'quote', boardId: board?.id || '', userId, domainId } as VisionItem);
                  setShowItemEditor(true);
                }}
                className="p-2 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded-full transition-colors"
                title="Add Quote"
              >
                <Quote className="h-4 w-4" />
              </button>
            </div>
            
            {/* Main Add Button */}
            <button
              onClick={handleAddItem}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-full shadow-lg hover:bg-green-700 transition-colors transform hover:scale-105"
            >
              <Plus className="h-5 w-5" />
              Add Item
            </button>
          </div>
        )}

        {/* Board Content */}
        <div 
          className="relative min-h-[600px] bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-900 dark:to-gray-800 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 overflow-hidden"
          style={{
            background: board?.backgroundColor ? 
              `linear-gradient(135deg, ${board.backgroundColor}11, ${board.backgroundColor}05)` : 
              undefined
          }}
        >
          {visionItems.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center max-w-md">
                <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
                  <Sparkles className="h-12 w-12 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  Empty Canvas
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  Start adding images, quotes, and videos to bring your vision to life
                </p>
                <button
                  onClick={() => {
                    setIsEditing(true);
                    console.log('🔍 SHERLOCK: Edit mode activated from empty state');
                  }}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all transform hover:scale-105 shadow-lg"
                >
                  <Plus className="h-5 w-5" />
                  Add First Item
                </button>
              </div>
            </div>
          ) : viewMode === 'masonry' ? (
            // Masonry Layout (Absolute Positioning)
            <div className="relative w-full h-full p-6">
              {visionItems.map(item => (
                <VisionItemCard
                  key={item.id}
                  item={item}
                  isEditing={isEditing}
                  linkedGoal={goals.find(g => g.id === item.linkedGoalId)}
                  linkedProject={projects.find(p => p.id === item.linkedProjectId)}
                  onEdit={handleEditItem}
                  onDelete={handleDeleteItem}
                  style={{
                    position: 'absolute',
                    left: item.x || 0,
                    top: item.y || 0,
                    width: item.width || 250,
                    height: item.height || 'auto'
                  }}
                />
              ))}
            </div>
          ) : (
            // Grid Layout
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
              {visionItems.map(item => (
                <VisionItemCard
                  key={item.id}
                  item={item}
                  isEditing={isEditing}
                  linkedGoal={goals.find(g => g.id === item.linkedGoalId)}
                  linkedProject={projects.find(p => p.id === item.linkedProjectId)}
                  onEdit={handleEditItem}
                  onDelete={handleDeleteItem}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// VISION ITEM CARD COMPONENT
// ============================================================================

interface VisionItemCardProps {
  item: VisionItem;
  isEditing: boolean;
  linkedGoal?: Goal;
  linkedProject?: Project;
  style?: React.CSSProperties;
  className?: string;
  onEdit?: (item: VisionItem) => void;
  onDelete?: (itemId: string) => void;
}

function VisionItemCard({
  item,
  isEditing,
  linkedGoal,
  linkedProject,
  style,
  className = "",
  onEdit,
  onDelete
}: VisionItemCardProps) {
  const getItemIcon = () => {
    switch (item.type) {
      case 'image': return <ImageIcon className="h-5 w-5" />;
      case 'video': return <Video className="h-5 w-5" />;
      case 'audio': return <Music className="h-5 w-5" />;
      case 'quote': return <Quote className="h-5 w-5" />;
      default: return <Sparkles className="h-5 w-5" />;
    }
  };

  const getItemContent = () => {
    switch (item.type) {
      case 'image':
        return (
          <div className="relative aspect-video bg-gradient-to-br from-blue-400 to-purple-500 rounded-lg flex items-center justify-center">
            <ImageIcon className="h-12 w-12 text-white opacity-50" />
            {/* TODO: Replace with actual image */}
          </div>
        );
      
      case 'video':
        return (
          <div className="relative aspect-video bg-gradient-to-br from-red-400 to-pink-500 rounded-lg flex items-center justify-center">
            <Play className="h-12 w-12 text-white opacity-75" />
          </div>
        );
      
      case 'audio':
        return (
          <div className="relative aspect-video bg-gradient-to-br from-green-400 to-teal-500 rounded-lg flex items-center justify-center">
            <Music className="h-12 w-12 text-white opacity-75" />
          </div>
        );

      case 'quote':
        return (
          <div className="relative bg-gradient-to-br from-yellow-400 to-orange-500 text-white p-6 rounded-lg min-h-[120px] flex flex-col justify-center">
            <Quote className="h-8 w-8 text-white/30 mb-2" />
            <blockquote className="text-lg font-medium italic leading-relaxed">
              "{item.text}"
            </blockquote>
            {item.caption && (
              <cite className="text-sm text-white/80 mt-3 block">
                — {item.caption}
              </cite>
            )}
          </div>
        );
      
      default:
        return (
          <div className="aspect-video bg-gradient-to-br from-gray-400 to-gray-500 rounded-lg flex items-center justify-center">
            <Sparkles className="h-12 w-12 text-white opacity-50" />
          </div>
        );
    }
  };

  return (
    <div 
      className={`group relative bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-200 dark:border-gray-700 ${className}`}
      style={style}
    >
      {/* Editing Controls */}
      {isEditing && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            onClick={() => onEdit?.(item)}
            className="p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors"
          >
            <Edit3 className="h-3 w-3" />
          </button>
          <button 
            onClick={() => onDelete?.(item.id)}
            className="p-2 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Pinned Badge */}
      {item.isPinned && (
        <div className="absolute top-2 left-2 z-10 bg-yellow-500 text-white p-1 rounded-full">
          <Sparkles className="h-3 w-3" />
        </div>
      )}

      {/* Item Content */}
      <div className="p-3">
        {getItemContent()}
        
        {/* Caption */}
        {item.caption && item.type !== 'quote' && (
          <div className="mt-3">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {item.caption}
            </p>
          </div>
        )}

        {/* Links */}
        {(linkedGoal || linkedProject) && (
          <div className="mt-3 space-y-1">
            {linkedGoal && (
              <div className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                <Target className="h-3 w-3" />
                <span className="truncate">{linkedGoal.title}</span>
              </div>
            )}
            {linkedProject && (
              <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <div className="h-3 w-3 bg-green-600 rounded-full" />
                <span className="truncate">{linkedProject.name}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hover Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
    </div>
  );
}

export default VisionBoardView;