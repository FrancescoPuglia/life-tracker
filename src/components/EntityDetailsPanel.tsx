"use client";

import { useState } from 'react';
import { 
  FileText, Map, Plus, Edit3, Trash2, Eye, 
  MessageSquare, Bookmark, Tag, Calendar 
} from 'lucide-react';
import { RichNoteEditor, NoteViewer } from './RichNoteEditor';
import { GoalRoadmapView } from './GoalRoadmapView';
import type { Goal, Project, Task, Note, NoteTemplate, GoalRoadmap, TimeBlock } from '@/types';
import { useDataContext } from '@/providers/DataProvider';

// ============================================================================
// ENTITY DETAILS PANEL - Notes & Roadmap Integration
// ============================================================================

interface EntityDetailsPanelProps {
  entityType: 'goal' | 'project' | 'task';
  entity: Goal | Project | Task;
  timeBlocks: TimeBlock[];
  projects?: Project[]; // For goal context
  tasks?: Task[]; // For project context
  className?: string;
}

type TabType = 'notes' | 'roadmap' | 'templates';

export function EntityDetailsPanel({ 
  entityType, 
  entity, 
  timeBlocks,
  projects = [],
  tasks = [],
  className = "" 
}: EntityDetailsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('notes');
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  const {
    notes,
    noteTemplates,
    goalRoadmaps,
    goals,
    createNote,
    updateNote,
    deleteNote,
    getNotesForEntity,
    getOrCreateRoadmapForGoal,
    userId
  } = useDataContext();

  // Get entity-specific data
  const entityNotes = getNotesForEntity(entityType, entity.id);
  const entityRoadmap = entityType === 'goal' 
    ? goalRoadmaps.find(r => r.goalId === entity.id)
    : null;

  // Handle note operations
  const handleCreateNote = async (noteData: Partial<Note>) => {
    try {
      await createNote({
        ...noteData,
        entityType,
        entityId: entity.id
      });
      setIsCreatingNote(false);
    } catch (error) {
      console.error('[EntityDetailsPanel] Create note failed:', error);
    }
  };

  const handleUpdateNote = async (noteData: Partial<Note>) => {
    if (!editingNote) return;
    
    try {
      await updateNote(editingNote.id, noteData);
      setEditingNote(null);
    } catch (error) {
      console.error('[EntityDetailsPanel] Update note failed:', error);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      await deleteNote(noteId);
    } catch (error) {
      console.error('[EntityDetailsPanel] Delete note failed:', error);
    }
  };

  const handleCreateRoadmap = async () => {
    if (entityType === 'goal') {
      try {
        await getOrCreateRoadmapForGoal(entity.id);
      } catch (error) {
        console.error('[EntityDetailsPanel] Create roadmap failed:', error);
      }
    }
  };

  return (
    <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white capitalize">
          {entityType} Details: {'title' in entity ? entity.title : 'name' in entity ? entity.name : 'Unknown'}
        </h3>
        
        {/* Tab Navigation */}
        <div className="flex items-center gap-1 mt-4">
          <button
            onClick={() => setActiveTab('notes')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'notes'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800'
            }`}
          >
            <FileText className="h-4 w-4" />
            Notes ({entityNotes.length})
          </button>

          {entityType === 'goal' && (
            <button
              onClick={() => setActiveTab('roadmap')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === 'roadmap'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800'
              }`}
            >
              <Map className="h-4 w-4" />
              Roadmap
            </button>
          )}

          <button
            onClick={() => setActiveTab('templates')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'templates'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800'
            }`}
          >
            <Bookmark className="h-4 w-4" />
            Templates
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-4">
        {/* NOTES TAB */}
        {activeTab === 'notes' && (
          <div className="space-y-6">
            {/* Create Note Button */}
            {!isCreatingNote && !editingNote && (
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-gray-900 dark:text-white">
                  {entityType === 'goal' ? 'Goal' : entityType === 'project' ? 'Project' : 'Task'} Notes
                </h4>
                <button
                  onClick={() => setIsCreatingNote(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Add Note
                </button>
              </div>
            )}

            {/* Create Note Form */}
            {isCreatingNote && (
              <RichNoteEditor
                entityType={entityType}
                entityId={entity.id}
                placeholder={`Write notes about this ${entityType}...`}
                currentUserId={userId}
                onSave={handleCreateNote}
                onCancel={() => setIsCreatingNote(false)}
                autoFocus
              />
            )}

            {/* Edit Note Form */}
            {editingNote && (
              <RichNoteEditor
                note={editingNote}
                entityType={entityType}
                entityId={entity.id}
                currentUserId={userId}
                onSave={handleUpdateNote}
                onCancel={() => setEditingNote(null)}
                autoFocus
              />
            )}

            {/* Notes List */}
            {!isCreatingNote && !editingNote && (
              <div className="space-y-4">
                {entityNotes.length === 0 ? (
                  <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                    <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-medium mb-2">No notes yet</p>
                    <p className="text-sm">Add your first note to start documenting your progress and insights.</p>
                  </div>
                ) : (
                  entityNotes.map(note => (
                    <div key={note.id} className="relative group">
                      {/* Note Actions */}
                      <div className="absolute top-4 right-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <button
                          onClick={() => setEditingNote(note)}
                          className="p-2 bg-white dark:bg-gray-800 text-gray-600 hover:text-blue-600 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm transition-colors"
                          title="Edit note"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteNote(note.id)}
                          className="p-2 bg-white dark:bg-gray-800 text-gray-600 hover:text-red-600 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm transition-colors"
                          title="Delete note"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <NoteViewer note={note} />
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* ROADMAP TAB */}
        {activeTab === 'roadmap' && entityType === 'goal' && (
          <div className="space-y-6">
            {!entityRoadmap ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <Map className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium mb-2">No roadmap yet</p>
                <p className="text-sm mb-6">Create a visual roadmap to track your goal progress with milestones.</p>
                <button
                  onClick={handleCreateRoadmap}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors mx-auto"
                >
                  <Map className="h-5 w-5" />
                  Create Roadmap
                </button>
              </div>
            ) : (
              <GoalRoadmapView
                goal={entity as Goal}
                roadmap={entityRoadmap}
                timeBlocks={timeBlocks}
                projects={projects}
                tasks={tasks}
                onMilestoneClick={(milestone) => {
                  console.log('[EntityDetailsPanel] Milestone clicked:', milestone);
                }}
              />
            )}
          </div>
        )}

        {/* TEMPLATES TAB */}
        {activeTab === 'templates' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-900 dark:text-white">Note Templates</h4>
              <button
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Create Template
              </button>
            </div>

            {noteTemplates.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <Bookmark className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium mb-2">No templates yet</p>
                <p className="text-sm">Create reusable note templates for common types of documentation.</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {noteTemplates.map(template => (
                  <div
                    key={template.id}
                    className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-300 dark:hover:border-blue-600 transition-colors cursor-pointer"
                    onClick={() => {
                      setIsCreatingNote(true);
                      // Pre-fill with template content
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h5 className="font-medium text-gray-900 dark:text-white">{template.title}</h5>
                        {template.description && (
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{template.description}</p>
                        )}
                        {template.category && (
                          <span className="inline-block mt-2 px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs rounded-full">
                            {template.category}
                          </span>
                        )}
                      </div>
                      <button className="p-2 text-gray-400 hover:text-blue-600 transition-colors">
                        <Eye className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default EntityDetailsPanel;