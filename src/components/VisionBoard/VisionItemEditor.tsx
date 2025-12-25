"use client";

import { useState } from 'react';
import { 
  Plus, Save, X, Quote, Target, Star, 
  Image as ImageIcon, Video, Music, Link, Sparkles
} from 'lucide-react';
import type { VisionItem, MediaAsset, Goal, Project, Task } from '@/types';
import { MediaUploader } from './VisionBoardCreator';
import { db } from '@/lib/database';

// ============================================================================
// VISION ITEM EDITOR - Add/Edit Individual Vision Items
// ============================================================================

interface VisionItemEditorProps {
  boardId: string;
  userId: string;
  domainId: string;
  item?: VisionItem; // For editing existing items
  goals?: Goal[];
  projects?: Project[];
  tasks?: Task[];
  onSave?: (item: VisionItem) => void;
  onCancel?: () => void;
  className?: string;
}

type ItemType = 'image' | 'video' | 'audio' | 'quote';

export function VisionItemEditor({
  boardId,
  userId,
  domainId,
  item,
  goals = [],
  projects = [],
  tasks = [],
  onSave,
  onCancel,
  className = ""
}: VisionItemEditorProps) {
  const [itemType, setItemType] = useState<ItemType>(item?.type || 'image');
  const [text, setText] = useState(item?.text || '');
  const [caption, setCaption] = useState(item?.caption || '');
  const [linkedGoalId, setLinkedGoalId] = useState(item?.linkedGoalId || '');
  const [linkedProjectId, setLinkedProjectId] = useState(item?.linkedProjectId || '');
  const [linkedTaskId, setLinkedTaskId] = useState(item?.linkedTaskId || '');
  const [isPinned, setIsPinned] = useState(item?.isPinned || false);
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isEditing = !!item;

  const handleSave = async () => {
    try {
      setIsSaving(true);
      
      const itemData: Omit<VisionItem, 'id' | 'createdAt' | 'updatedAt'> = {
        userId,
        domainId,
        boardId,
        type: itemType,
        caption: caption.trim(),
        linkedGoalId: linkedGoalId || undefined,
        linkedProjectId: linkedProjectId || undefined,
        linkedTaskId: linkedTaskId || undefined,
        isPinned,
        order: item?.order || Date.now(), // Use timestamp for new items
        x: item?.x || Math.random() * 400 + 50, // Random position for new items
        y: item?.y || Math.random() * 300 + 50,
        width: item?.width || getDefaultWidth(),
        height: item?.height || getDefaultHeight()
      };

      // Add type-specific data
      if (itemType === 'quote') {
        itemData.text = text.trim();
      } else if (selectedAsset || item?.assetId) {
        itemData.assetId = selectedAsset?.id || item?.assetId;
      }

      let savedItem: VisionItem;
      if (isEditing && item) {
        savedItem = await db.updateVisionItem({ ...item, ...itemData });
      } else {
        savedItem = await db.createVisionItem(itemData);
      }

      onSave?.(savedItem);
    } catch (error) {
      console.error('Failed to save vision item:', error);
      // TODO: Show error toast
    } finally {
      setIsSaving(false);
    }
  };

  const getDefaultWidth = () => {
    switch (itemType) {
      case 'image': return 300;
      case 'video': return 320;
      case 'audio': return 280;
      case 'quote': return 250;
      default: return 250;
    }
  };

  const getDefaultHeight = () => {
    switch (itemType) {
      case 'image': return 200;
      case 'video': return 180;
      case 'audio': return 120;
      case 'quote': return 150;
      default: return 150;
    }
  };

  const canSave = () => {
    if (itemType === 'quote') {
      return text.trim().length > 0;
    }
    return selectedAsset || item?.assetId;
  };

  const popularQuotes = [
    "The future belongs to those who believe in the beauty of their dreams.",
    "Dream big and dare to fail.",
    "Your limitation—it's only your imagination.",
    "Great things never come from comfort zones.",
    "Success is not final, failure is not fatal: it is the courage to continue that counts.",
    "The way to get started is to quit talking and begin doing.",
    "Don't watch the clock; do what it does. Keep going.",
    "Believe you can and you're halfway there."
  ];

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 max-w-2xl mx-auto ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
          {isEditing ? 'Edit Vision Item' : 'Add Vision Item'}
        </h2>
        
        {onCancel && (
          <button
            onClick={onCancel}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Item Type Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-900 dark:text-white">
            Item Type
          </label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { type: 'image' as const, icon: ImageIcon, label: 'Image', color: 'blue' },
              { type: 'video' as const, icon: Video, label: 'Video', color: 'red' },
              { type: 'audio' as const, icon: Music, label: 'Audio', color: 'green' },
              { type: 'quote' as const, icon: Quote, label: 'Quote', color: 'yellow' }
            ].map(({ type, icon: Icon, label, color }) => (
              <button
                key={type}
                onClick={() => setItemType(type)}
                className={`flex flex-col items-center gap-2 p-4 border rounded-lg transition-all ${
                  itemType === type
                    ? `border-${color}-500 bg-${color}-50 dark:bg-${color}-900/20 text-${color}-700 dark:text-${color}-300`
                    : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <Icon className="h-6 w-6" />
                <span className="text-sm font-medium">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Media Upload (for image/video/audio) */}
        {(itemType === 'image' || itemType === 'video' || itemType === 'audio') && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-900 dark:text-white">
              {itemType === 'image' ? 'Upload Image' : 
               itemType === 'video' ? 'Upload Video' : 
               'Upload Audio'}
            </label>
            
            {!selectedAsset && !item?.assetId && (
              <MediaUploader
                userId={userId}
                domainId={domainId}
                acceptedTypes={[itemType]}
                onMediaUploaded={setSelectedAsset}
              />
            )}
            
            {(selectedAsset || item?.assetId) && (
              <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-center gap-3">
                  {itemType === 'image' ? <ImageIcon className="h-5 w-5 text-green-600" /> : 
                   itemType === 'video' ? <Video className="h-5 w-5 text-green-600" /> :
                   <Music className="h-5 w-5 text-green-600" />}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">
                      {itemType === 'image' ? 'Image uploaded' : 
                       itemType === 'video' ? 'Video uploaded' : 
                       'Audio uploaded'}
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-400">
                      {selectedAsset?.originalName || 'Media file ready'}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedAsset(null)}
                    className="p-1 text-green-600 hover:text-green-800 transition-colors"
                    title="Remove media"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quote Text (for quotes) */}
        {itemType === 'quote' && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-900 dark:text-white">
              Quote Text *
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter an inspiring quote..."
              rows={4}
              className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors resize-none"
              maxLength={300}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 text-right">
              {text.length}/300
            </p>
            
            {/* Popular Quotes */}
            <div className="space-y-2">
              <p className="text-xs text-gray-600 dark:text-gray-400">Popular quotes:</p>
              <div className="grid grid-cols-1 gap-2 max-h-32 overflow-y-auto">
                {popularQuotes.map((quote, index) => (
                  <button
                    key={index}
                    onClick={() => setText(quote)}
                    className="text-left p-2 text-xs bg-gray-50 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 hover:bg-purple-50 hover:text-purple-700 dark:hover:bg-purple-900 dark:hover:text-purple-300 transition-colors"
                  >
                    "{quote}"
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Caption */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-900 dark:text-white">
            Caption {itemType === 'quote' && '(Author/Source)'}
          </label>
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={
              itemType === 'quote' 
                ? "Author or source..." 
                : "Add a caption to describe this item..."
            }
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors"
            maxLength={100}
          />
        </div>

        {/* Link to Goals/Projects/Tasks */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
            <Link className="h-4 w-4" />
            Link to Goal/Project/Task (Optional)
          </label>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Goal */}
            <select
              value={linkedGoalId}
              onChange={(e) => {
                setLinkedGoalId(e.target.value);
                if (e.target.value) {
                  setLinkedProjectId('');
                  setLinkedTaskId('');
                }
              }}
              className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="">Select Goal</option>
              {goals.map(goal => (
                <option key={goal.id} value={goal.id}>{goal.title}</option>
              ))}
            </select>

            {/* Project */}
            <select
              value={linkedProjectId}
              onChange={(e) => {
                setLinkedProjectId(e.target.value);
                if (e.target.value) {
                  setLinkedGoalId('');
                  setLinkedTaskId('');
                }
              }}
              className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="">Select Project</option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>

            {/* Task */}
            <select
              value={linkedTaskId}
              onChange={(e) => {
                setLinkedTaskId(e.target.value);
                if (e.target.value) {
                  setLinkedGoalId('');
                  setLinkedProjectId('');
                }
              }}
              className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="">Select Task</option>
              {tasks.map(task => (
                <option key={task.id} value={task.id}>{task.title}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Pin for Ritual Mode */}
        <div className="flex items-center gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
          <Star className={`h-5 w-5 ${isPinned ? 'text-yellow-600 fill-current' : 'text-gray-400'}`} />
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-900 dark:text-white cursor-pointer">
              Pin for Ritual Mode
            </label>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Pinned items will be featured in your manifestation rituals
            </p>
          </div>
          <button
            onClick={() => setIsPinned(!isPinned)}
            className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors focus:outline-none ${
              isPinned ? 'bg-yellow-500' : 'bg-gray-200 dark:bg-gray-600'
            }`}
          >
            <span
              className={`inline-block w-4 h-4 transform transition-transform bg-white rounded-full ${
                isPinned ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 rounded-b-xl">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
        )}
        
        <button
          onClick={handleSave}
          disabled={!canSave() || isSaving}
          className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isSaving ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {isEditing ? 'Update Item' : 'Add Item'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default VisionItemEditor;