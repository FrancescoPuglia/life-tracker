"use client";

import { useState } from 'react';
import { 
  Plus, Upload, Image as ImageIcon, Video, Music, 
  Quote, Sparkles, X, Save, Eye, Target
} from 'lucide-react';
import type { VisionBoard, VisionItem, MediaAsset, Goal } from '@/types';
import { db } from '@/lib/database';

// ============================================================================
// VISION BOARD CREATOR - Create New Vision Board
// ============================================================================

interface VisionBoardCreatorProps {
  goalId: string;
  userId: string;
  domainId: string;
  goals?: Goal[];
  onBoardCreated?: (board: VisionBoard) => void;
  onClose?: () => void;
  className?: string;
}

export function VisionBoardCreator({
  goalId,
  userId,
  domainId,
  goals = [],
  onBoardCreated,
  onClose,
  className = ""
}: VisionBoardCreatorProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [backgroundColor, setBackgroundColor] = useState('#8b5cf6');
  const [isCreating, setIsCreating] = useState(false);
  
  const linkedGoal = goals.find(g => g.id === goalId);

  const handleCreate = async () => {
    if (!title.trim()) return;
    
    try {
      setIsCreating(true);
      
      const boardData = {
        userId,
        domainId,
        title: title.trim(),
        description: description.trim(),
        linkedGoalId: goalId,
        backgroundColor,
        isActive: true
      };

      console.log('🔍 SHERLOCK: Creating vision board locally (no Firestore)...');
      
      // BYPASS FIRESTORE - Create board locally
      const newBoard: VisionBoard = {
        id: `board_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...boardData,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      console.log('🔍 SHERLOCK: Vision board created locally!');
      onBoardCreated?.(newBoard);
    } catch (error) {
      console.error('Failed to create vision board:', error);
      // TODO: Show error toast
    } finally {
      setIsCreating(false);
    }
  };

  const suggestedTitles = [
    `${linkedGoal?.title || 'My Goal'} Vision`,
    `Dream Life 2025`,
    `Success Manifestation`,
    `Ultimate Achievement`,
    `Future Self Visualization`
  ];

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 max-w-2xl mx-auto ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Create Vision Board
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Manifest your dreams visually
            </p>
          </div>
        </div>
        
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Linked Goal */}
        {linkedGoal && (
          <div className="flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <Target className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <div>
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                Linked to Goal
              </p>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                {linkedGoal.title}
              </p>
            </div>
          </div>
        )}

        {/* Title */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-900 dark:text-white">
            Vision Board Title *
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter a meaningful title..."
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors"
            maxLength={100}
          />
          
          {/* Suggested Titles */}
          <div className="flex flex-wrap gap-2 mt-2">
            {suggestedTitles.map((suggestion, index) => (
              <button
                key={index}
                onClick={() => setTitle(suggestion)}
                className="px-3 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-full hover:bg-purple-100 hover:text-purple-700 dark:hover:bg-purple-900 dark:hover:text-purple-300 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-900 dark:text-white">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe your vision and what this board represents..."
            rows={3}
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors resize-none"
            maxLength={500}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 text-right">
            {description.length}/500
          </p>
        </div>

        {/* Background Color */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-900 dark:text-white">
            Background Theme
          </label>
          <div className="grid grid-cols-6 gap-3">
            {[
              '#8b5cf6', // Purple (default)
              '#3b82f6', // Blue
              '#10b981', // Green
              '#f59e0b', // Yellow
              '#ef4444', // Red
              '#ec4899', // Pink
              '#6366f1', // Indigo
              '#14b8a6', // Teal
              '#f97316', // Orange
              '#84cc16', // Lime
              '#1f2937'  // Dark
            ].map((color) => (
              <button
                key={color}
                onClick={() => setBackgroundColor(color)}
                className={`w-12 h-12 rounded-lg border-2 transition-all ${
                  backgroundColor === color 
                    ? 'border-gray-900 dark:border-white scale-110' 
                    : 'border-gray-200 dark:border-gray-600 hover:scale-105'
                }`}
                style={{ backgroundColor: color }}
                title={`Select ${color} theme`}
              />
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Preview
          </label>
          <div 
            className="h-32 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${backgroundColor}22, ${backgroundColor}11)`
            }}
          >
            <div className="text-center">
              <Sparkles className="h-8 w-8 mx-auto mb-2 text-gray-400" />
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {title || 'Your Vision Board'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {description || 'Add images, quotes, and videos to manifest your dreams'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 rounded-b-xl">
        {onClose && (
          <button
            onClick={onClose}
            disabled={isCreating}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
        )}
        
        <button
          onClick={handleCreate}
          disabled={!title.trim() || isCreating}
          className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isCreating ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Create Vision Board
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// MEDIA UPLOADER COMPONENT
// ============================================================================

interface MediaUploaderProps {
  userId: string;
  domainId?: string;
  onMediaUploaded?: (asset: MediaAsset) => void;
  acceptedTypes?: ('image' | 'video' | 'audio')[];
  className?: string;
}

export function MediaUploader({
  userId,
  domainId = 'default',
  onMediaUploaded,
  acceptedTypes = ['image', 'video', 'audio'],
  className = ""
}: MediaUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (files: FileList) => {
    if (!files || files.length === 0) return;
    
    const file = files[0];
    const fileType = file.type.split('/')[0] as 'image' | 'video' | 'audio';
    
    if (!acceptedTypes.includes(fileType)) {
      console.error(`File type ${fileType} not accepted`);
      return;
    }

    try {
      setIsUploading(true);
      
      // For guest users, we'll store as blob in IndexedDB
      const blobKey = `media-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Store blob
      await db.storeBlob(blobKey, file);
      
      // Create media asset record
      const assetData = {
        userId,
        domainId,
        kind: fileType,
        storage: 'indexeddb' as const,
        blobKey,
        mimeType: file.type,
        sizeBytes: file.size,
        originalName: file.name,
        ...(fileType === 'image' && {
          width: 800, // TODO: Get actual dimensions
          height: 600
        }),
        ...(fileType === 'video' && {
          durationSec: 30 // TODO: Get actual duration
        }),
        ...(fileType === 'audio' && {
          durationSec: 180 // TODO: Get actual duration
        })
      };

      const mediaAsset = await db.createMediaAsset(assetData);
      onMediaUploaded?.(mediaAsset);
      
    } catch (error) {
      console.error('Failed to upload media:', error);
      // TODO: Show error toast
    } finally {
      setIsUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileUpload(e.dataTransfer.files);
  };

  const getAcceptedMimeTypes = () => {
    const mimeTypes: string[] = [];
    if (acceptedTypes.includes('image')) mimeTypes.push('image/*');
    if (acceptedTypes.includes('video')) mimeTypes.push('video/*');
    if (acceptedTypes.includes('audio')) mimeTypes.push('audio/*');
    return mimeTypes.join(',');
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragging 
            ? 'border-purple-400 bg-purple-50 dark:bg-purple-900/20' 
            : 'border-gray-300 dark:border-gray-600 hover:border-purple-300'
        }`}
      >
        {isUploading ? (
          <div className="space-y-3">
            <div className="w-12 h-12 mx-auto border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
            <p className="text-sm text-gray-600 dark:text-gray-400">Uploading media...</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-center gap-2">
              {acceptedTypes.includes('image') && <ImageIcon className="h-8 w-8 text-gray-400" />}
              {acceptedTypes.includes('video') && <Video className="h-8 w-8 text-gray-400" />}
              {acceptedTypes.includes('audio') && <Music className="h-8 w-8 text-gray-400" />}
            </div>
            
            <div>
              <p className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Drop your media here
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                or click to browse files
              </p>
            </div>

            <input
              type="file"
              accept={getAcceptedMimeTypes()}
              onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
        )}
      </div>

      {/* Upload Buttons */}
      <div className="grid grid-cols-3 gap-3">
        <button
          disabled={!acceptedTypes.includes('image') || isUploading}
          className="flex flex-col items-center gap-2 p-4 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (e) => {
              const files = (e.target as HTMLInputElement).files;
              if (files) handleFileUpload(files);
            };
            input.click();
          }}
        >
          <ImageIcon className="h-6 w-6 text-blue-500" />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Images</span>
        </button>

        <button
          disabled={!acceptedTypes.includes('video') || isUploading}
          className="flex flex-col items-center gap-2 p-4 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'video/*';
            input.onchange = (e) => {
              const files = (e.target as HTMLInputElement).files;
              if (files) handleFileUpload(files);
            };
            input.click();
          }}
        >
          <Video className="h-6 w-6 text-red-500" />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Videos</span>
        </button>

        <button
          disabled={!acceptedTypes.includes('audio') || isUploading}
          className="flex flex-col items-center gap-2 p-4 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'audio/*';
            input.onchange = (e) => {
              const files = (e.target as HTMLInputElement).files;
              if (files) handleFileUpload(files);
            };
            input.click();
          }}
        >
          <Music className="h-6 w-6 text-green-500" />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Audio</span>
        </button>
      </div>
    </div>
  );
}

export default VisionBoardCreator;