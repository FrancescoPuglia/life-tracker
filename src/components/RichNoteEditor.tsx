"use client";

import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { useState, useCallback, useRef } from 'react';
import { 
  Bold, Italic, List, ListOrdered, Quote, Code, Image as ImageIcon, 
  Save, FileText, Upload, Eye 
} from 'lucide-react';
import type { Note, NoteTemplate } from '@/types';

// ============================================================================
// IMAGE UPLOAD UTILITIES
// ============================================================================

// Convert file to base64 for guest users
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

// Mock Firebase Storage upload for logged users (placeholder)
const uploadToFirebaseStorage = async (file: File, userId: string): Promise<string> => {
  // TODO: Implement Firebase Storage upload
  console.warn('[RichNoteEditor] Firebase Storage upload not yet implemented, using base64 fallback');
  return fileToBase64(file);
};

// ============================================================================
// TOOLBAR COMPONENT
// ============================================================================

interface ToolbarProps {
  editor: Editor | null;
  onSave?: () => void;
  onImageUpload?: (file: File) => void;
  isSaving?: boolean;
}

function Toolbar({ editor, onSave, onImageUpload, isSaving }: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onImageUpload?.(file);
    }
  };

  if (!editor) return null;

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 p-2 flex items-center gap-1">
      {/* Text Formatting */}
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`p-2 rounded-md transition-colors ${
          editor.isActive('bold')
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
            : 'hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
        type="button"
        title="Bold"
      >
        <Bold className="h-4 w-4" />
      </button>

      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`p-2 rounded-md transition-colors ${
          editor.isActive('italic')
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
            : 'hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
        type="button"
        title="Italic"
      >
        <Italic className="h-4 w-4" />
      </button>

      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

      {/* Lists */}
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`p-2 rounded-md transition-colors ${
          editor.isActive('bulletList')
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
            : 'hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
        type="button"
        title="Bullet List"
      >
        <List className="h-4 w-4" />
      </button>

      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`p-2 rounded-md transition-colors ${
          editor.isActive('orderedList')
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
            : 'hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
        type="button"
        title="Numbered List"
      >
        <ListOrdered className="h-4 w-4" />
      </button>

      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

      {/* Blockquote & Code */}
      <button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={`p-2 rounded-md transition-colors ${
          editor.isActive('blockquote')
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
            : 'hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
        type="button"
        title="Quote"
      >
        <Quote className="h-4 w-4" />
      </button>

      <button
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={`p-2 rounded-md transition-colors ${
          editor.isActive('code')
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
            : 'hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
        type="button"
        title="Inline Code"
      >
        <Code className="h-4 w-4" />
      </button>

      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

      {/* Image Upload */}
      <button
        onClick={handleImageClick}
        className="p-2 rounded-md transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
        type="button"
        title="Upload Image"
      >
        <ImageIcon className="h-4 w-4" />
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex-1" />

      {/* Save Button */}
      {onSave && (
        <button
          onClick={onSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          type="button"
        >
          {isSaving ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ============================================================================
// MAIN RICH NOTE EDITOR COMPONENT
// ============================================================================

interface RichNoteEditorProps {
  note?: Note;
  template?: NoteTemplate;
  entityType?: 'goal' | 'project' | 'task' | 'global';
  entityId?: string;
  placeholder?: string;
  currentUserId?: string;
  onSave?: (noteData: Partial<Note>) => Promise<void>;
  onCancel?: () => void;
  className?: string;
  autoFocus?: boolean;
}

export function RichNoteEditor({
  note,
  template,
  entityType = 'global',
  entityId,
  placeholder = "Start writing your note...",
  currentUserId,
  onSave,
  onCancel,
  className = "",
  autoFocus = false
}: RichNoteEditorProps) {
  const [title, setTitle] = useState(note?.title || template?.title || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isPreview, setIsPreview] = useState(false);

  // Initialize editor with content from note or template
  const initialContent = note?.docJson || template?.docJson || { type: 'doc', content: [] };

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({
        inline: false,
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg'
        }
      }),
      Placeholder.configure({
        placeholder: placeholder
      })
    ],
    content: initialContent,
    autofocus: autoFocus,
    editable: !isPreview,
    immediatelyRender: false, // Fix SSR hydration mismatch
    onUpdate: ({ editor }) => {
      // Could implement auto-save here if needed
    }
  });

  // Handle image upload
  const handleImageUpload = useCallback(async (file: File) => {
    if (!editor) return;

    try {
      let imageUrl: string;
      
      if (currentUserId && currentUserId !== 'guest') {
        // For logged users, upload to Firebase Storage
        imageUrl = await uploadToFirebaseStorage(file, currentUserId);
      } else {
        // For guest users, convert to base64
        imageUrl = await fileToBase64(file);
      }

      // Insert image at current cursor position
      editor.chain().focus().setImage({ src: imageUrl }).run();
    } catch (error) {
      console.error('[RichNoteEditor] Image upload failed:', error);
      // TODO: Show error toast to user
    }
  }, [editor, currentUserId]);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!editor || !onSave) return;

    setIsSaving(true);
    try {
      const docJson = editor.getJSON();
      
      const noteData: Partial<Note> = {
        title: title.trim() || 'Untitled Note',
        docJson,
        entityType,
        entityId,
        templateId: template?.id
      };

      await onSave(noteData);
    } catch (error) {
      console.error('[RichNoteEditor] Save failed:', error);
      // TODO: Show error toast to user
    } finally {
      setIsSaving(false);
    }
  }, [editor, title, entityType, entityId, template?.id, onSave]);

  // Toggle preview mode
  const togglePreview = useCallback(() => {
    setIsPreview(!isPreview);
    if (editor) {
      editor.setEditable(isPreview);
    }
  }, [editor, isPreview]);

  return (
    <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden ${className}`}>
      {/* Title Input */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Note title..."
          className="w-full text-lg font-semibold bg-transparent border-none outline-none placeholder-gray-400 dark:placeholder-gray-500"
          disabled={isPreview}
        />
      </div>

      {/* Toolbar */}
      <Toolbar 
        editor={editor} 
        onSave={handleSave}
        onImageUpload={handleImageUpload}
        isSaving={isSaving}
      />

      {/* Preview Toggle */}
      <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <FileText className="h-4 w-4" />
          {isPreview ? 'Preview Mode' : 'Edit Mode'}
        </div>
        
        <button
          onClick={togglePreview}
          className="flex items-center gap-2 px-3 py-1 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          type="button"
        >
          <Eye className="h-4 w-4" />
          {isPreview ? 'Edit' : 'Preview'}
        </button>
      </div>

      {/* Editor Content */}
      <div className="p-4">
        <EditorContent 
          editor={editor} 
          className={`prose prose-sm max-w-none dark:prose-invert ${
            isPreview ? 'pointer-events-none' : ''
          }`}
        />
      </div>

      {/* Action Buttons */}
      {(onSave || onCancel) && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3 justify-end">
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              type="button"
            >
              Cancel
            </button>
          )}
          
          {onSave && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              type="button"
            >
              {isSaving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Note
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SIMPLE NOTE VIEWER FOR READ-ONLY DISPLAY
// ============================================================================

interface NoteViewerProps {
  note: Note;
  className?: string;
  showTitle?: boolean;
  showMeta?: boolean;
}

export function NoteViewer({ note, className = "", showTitle = true, showMeta = true }: NoteViewerProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({
        inline: false,
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg'
        }
      })
    ],
    content: note.docJson,
    editable: false,
    immediatelyRender: false // Fix SSR hydration mismatch
  });

  return (
    <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden ${className}`}>
      {showTitle && (
        <div className="border-b border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {note.title}
          </h3>
          
          {showMeta && (
            <div className="mt-2 flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
              <span>Created {new Date(note.createdAt).toLocaleDateString()}</span>
              {note.tags && note.tags.length > 0 && (
                <div className="flex items-center gap-1">
                  {note.tags.map(tag => (
                    <span
                      key={tag}
                      className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="p-4">
        <EditorContent 
          editor={editor} 
          className="prose prose-sm max-w-none dark:prose-invert pointer-events-none"
        />
      </div>
    </div>
  );
}

export default RichNoteEditor;