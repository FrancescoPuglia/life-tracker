'use client';

import { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Goal, KeyResult, Project, Task } from '@/types';
import { Plus, Target, TrendingUp, Calendar, CheckCircle, AlertCircle, Clock } from 'lucide-react';

interface OKRManagerProps {
  goals: Goal[];
  keyResults: KeyResult[];
  projects: Project[];
  tasks: Task[];
  onCreateGoal: (goal: Partial<Goal>) => void;
  onUpdateGoal: (id: string, updates: Partial<Goal>) => void;
  onCreateKeyResult: (keyResult: Partial<KeyResult>) => void;
  onUpdateKeyResult: (id: string, updates: Partial<KeyResult>) => void;
  onCreateProject: (project: Partial<Project>) => void;
  onUpdateProject: (id: string, updates: Partial<Project>) => void;
  onCreateTask: (task: Partial<Task>) => void;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
}

export default function OKRManager({
  goals,
  keyResults,
  projects,
  tasks,
  onCreateGoal,
  onUpdateGoal,
  onCreateKeyResult,
  onUpdateKeyResult,
  onCreateProject,
  onUpdateProject,
  onCreateTask,
  onUpdateTask
}: OKRManagerProps) {
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [showCreateModal, setShowCreateModal] = useState<'goal' | 'keyResult' | 'project' | 'task' | null>(null);
  const [newItemData, setNewItemData] = useState<any>({});

  // Refs to maintain focus
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);

  // Optimized callbacks to prevent re-render issues
  const handleTitleChange = useCallback((value: string) => {
    const fieldName = showCreateModal === 'project' ? 'name' : 'title';
    setNewItemData(prev => ({ ...prev, [fieldName]: value }));
  }, [showCreateModal]);

  const handleDescriptionChange = useCallback((value: string) => {
    setNewItemData(prev => ({ ...prev, description: value }));
  }, []);

  const getGoalKeyResults = (goalId: string) => {
    return keyResults.filter(kr => kr.goalId === goalId);
  };

  const getGoalProjects = (goalId: string) => {
    return projects.filter(p => p.goalId === goalId);
  };

  const getProjectTasks = (projectId: string) => {
    return tasks.filter(t => t.projectId === projectId);
  };

  const calculateGoalProgress = (goalId: string): number => {
    const goalKeyResults = getGoalKeyResults(goalId);
    if (goalKeyResults.length === 0) return 0;
    
    const totalProgress = goalKeyResults.reduce((sum, kr) => sum + kr.progress, 0);
    return totalProgress / goalKeyResults.length;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-600 bg-green-50';
      case 'active': return 'text-blue-600 bg-blue-50';
      case 'at_risk': return 'text-red-600 bg-red-50';
      case 'paused': return 'text-yellow-600 bg-yellow-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'text-red-600 bg-red-50';
      case 'medium': return 'text-yellow-600 bg-yellow-50';
      case 'low': return 'text-green-600 bg-green-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const handleCreateItem = () => {
    const now = new Date();
    const baseData = {
      id: `${showCreateModal}-${Date.now()}`,
      userId: 'user-1',
      domainId: 'default',
      createdAt: now,
      updatedAt: now,
    };

    switch (showCreateModal) {
      case 'goal':
        onCreateGoal({ ...newItemData, ...baseData, status: 'active' });
        break;
      case 'keyResult':
        onCreateKeyResult({ 
          ...newItemData, 
          ...baseData, 
          goalId: selectedGoal?.id,
          currentValue: 0,
          progress: 0,
          status: 'active'
        });
        break;
      case 'project':
        onCreateProject({ 
          ...newItemData, 
          ...baseData, 
          goalId: selectedGoal?.id,
          status: 'active',
          priority: 'medium'
        });
        break;
      case 'task':
        onCreateTask({ 
          ...newItemData, 
          ...baseData,
          status: 'pending',
          priority: 'medium',
          estimatedMinutes: 60
        });
        break;
    }

    setShowCreateModal(null);
    setNewItemData({});
  };

  const GoalCard = ({ goal }: { goal: Goal }) => {
    const progress = calculateGoalProgress(goal.id);
    const goalKeyResults = getGoalKeyResults(goal.id);
    const goalProjects = getGoalProjects(goal.id);
    
    return (
      <div 
        className={`bg-white border-2 rounded-lg p-6 cursor-pointer transition-all ${
          selectedGoal?.id === goal.id ? 'border-blue-500 shadow-md' : 'border-gray-200 hover:border-gray-300'
        }`}
        onClick={() => setSelectedGoal(selectedGoal?.id === goal.id ? null : goal)}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{goal.title}</h3>
            <p className="text-gray-600 text-sm mb-3">{goal.description}</p>
            
            <div className="flex items-center space-x-4 text-sm">
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(goal.status)}`}>
                {goal.status}
              </span>
              <span className="text-gray-500 flex items-center">
                <Calendar className="w-4 h-4 mr-1" />
                {goal.targetDate.toLocaleDateString()}
              </span>
            </div>
          </div>
          
          <div className="text-right">
            <div className="text-2xl font-bold text-blue-600">{Math.round(progress)}%</div>
            <div className="text-xs text-gray-500">Progress</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Key Results & Projects Summary */}
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{goalKeyResults.length} Key Results</span>
          <span>{goalProjects.length} Projects</span>
        </div>
      </div>
    );
  };

  const KeyResultCard = ({ keyResult }: { keyResult: KeyResult }) => (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-medium text-gray-900">{keyResult.title}</h4>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(keyResult.status)}`}>
          {keyResult.status}
        </span>
      </div>
      
      <p className="text-sm text-gray-600 mb-3">{keyResult.description}</p>
      
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-500">
          {keyResult.currentValue} / {keyResult.targetValue} {keyResult.unit}
        </span>
        <span className="text-sm font-medium text-blue-600">
          {Math.round(keyResult.progress)}%
        </span>
      </div>
      
      <div className="w-full bg-gray-200 rounded-full h-1.5">
        <div
          className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${keyResult.progress}%` }}
        />
      </div>
    </div>
  );

  const ProjectCard = ({ project }: { project: Project }) => {
    const projectTasks = getProjectTasks(project.id);
    const completedTasks = projectTasks.filter(t => t.status === 'completed').length;
    const progress = projectTasks.length > 0 ? (completedTasks / projectTasks.length) * 100 : 0;
    
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-start justify-between mb-2">
          <h4 className="font-medium text-gray-900">{project.name}</h4>
          <div className="flex items-center space-x-2">
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getPriorityColor(project.priority)}`}>
              {project.priority}
            </span>
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(project.status)}`}>
              {project.status}
            </span>
          </div>
        </div>
        
        <p className="text-sm text-gray-600 mb-3">{project.description}</p>
        
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-500">
            {completedTasks} / {projectTasks.length} tasks completed
          </span>
          <span className="text-sm font-medium text-green-600">
            {Math.round(progress)}%
          </span>
        </div>
        
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div
            className="bg-green-500 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        
        {project.dueDate && (
          <div className="mt-2 text-xs text-gray-500 flex items-center">
            <Clock className="w-3 h-3 mr-1" />
            Due: {project.dueDate.toLocaleDateString()}
          </div>
        )}
      </div>
    );
  };

  const TaskCard = ({ task }: { task: Task }) => (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-1">
            {task.status === 'completed' ? (
              <CheckCircle className="w-4 h-4 text-green-600" />
            ) : task.status === 'in_progress' ? (
              <Clock className="w-4 h-4 text-blue-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-gray-400" />
            )}
            <h5 className="font-medium text-gray-900 text-sm">{task.title}</h5>
          </div>
          
          {task.description && (
            <p className="text-xs text-gray-600 mb-2">{task.description}</p>
          )}
          
          <div className="flex items-center space-x-3 text-xs text-gray-500">
            <span className={`px-1.5 py-0.5 rounded text-xs ${getPriorityColor(task.priority)}`}>
              {task.priority}
            </span>
            <span>{task.estimatedMinutes}min</span>
            {task.dueDate && (
              <span>Due: {task.dueDate.toLocaleDateString()}</span>
            )}
          </div>
          
          {task.ifThenPlan && (
            <div className="mt-2 p-2 bg-blue-50 rounded text-xs">
              <strong>If-Then:</strong> {task.ifThenPlan}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const CreateModal = () => {
    if (!showCreateModal) return null;
    if (typeof window === 'undefined') return null; // SSR safety

    const modalTitle = {
      goal: 'Create New Goal',
      keyResult: 'Create Key Result',
      project: 'Create Project',
      task: 'Create Task'
    }[showCreateModal];

    // Debug: Log current state
    console.log('CreateModal State:', { 
      showCreateModal, 
      newItemData,
      titleValue: showCreateModal === 'project' ? newItemData.name : newItemData.title,
      descriptionValue: newItemData.description
    });

    const modalContent = (
      <div 
        className="modal-portal fixed inset-0 z-[9999] flex items-center justify-center p-4" 
        style={{ 
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)'
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowCreateModal(null);
            setNewItemData({});
          }
        }}
      >
        <div 
          className="bg-white rounded-lg shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
          style={{
            transform: 'translateZ(0)', // Force hardware acceleration
            position: 'relative',
            zIndex: 10000
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-gray-900">{modalTitle}</h3>
              <button
                onClick={() => {
                  setShowCreateModal(null);
                  setNewItemData({});
                }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                type="button"
              >
                ×
              </button>
            </div>
          
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {showCreateModal === 'keyResult' ? 'Key Result' : 'Title'}
                </label>
                <input
                  ref={titleInputRef}
                  id="modal-title-input"
                  type="text"
                  value={showCreateModal === 'project' ? (newItemData.name || '') : (newItemData.title || '')}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  style={{
                    color: 'black',
                    backgroundColor: 'white',
                    border: '2px solid #007bff',
                    fontSize: '16px'
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                  placeholder={`Enter ${showCreateModal} title`}
                  autoFocus
                  autoComplete="off"
                />
            </div>
            
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  ref={descriptionInputRef}
                  id="modal-description-input"
                  value={newItemData.description || ''}
                  onChange={(e) => handleDescriptionChange(e.target.value)}
                  style={{
                    color: 'black',
                    backgroundColor: 'white',
                    border: '2px solid #007bff',
                    fontSize: '16px'
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                  rows={3}
                  placeholder="Description"
                  autoComplete="off"
                />
            </div>

            {showCreateModal === 'goal' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Date</label>
                <input
                  id="modal-date-input"
                  type="date"
                  value={newItemData.targetDate ? newItemData.targetDate.toISOString().split('T')[0] : ''}
                  onChange={(e) => setNewItemData({ ...newItemData, targetDate: new Date(e.target.value) })}
                  style={{
                    color: '#111827',
                    backgroundColor: '#ffffff',
                    WebkitTextFillColor: '#111827',
                    textShadow: 'none'
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                />
              </div>
            )}

            {showCreateModal === 'keyResult' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Target Value</label>
                  <input
                    id="modal-target-value-input"
                    type="number"
                    value={newItemData.targetValue || ''}
                    onChange={(e) => setNewItemData({ ...newItemData, targetValue: parseInt(e.target.value) || 0 })}
                    style={{
                      color: 'black',
                      backgroundColor: 'white',
                      border: '1px solid #ccc'
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                  <input
                    id="modal-unit-input"
                    type="text"
                    value={newItemData.unit || ''}
                    onChange={(e) => setNewItemData({ ...newItemData, unit: e.target.value })}
                    style={{
                      color: 'black',
                      backgroundColor: 'white',
                      border: '1px solid #ccc'
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                    placeholder="e.g., users, $, %"
                  />
                </div>
              </div>
            )}

            {(showCreateModal === 'project' || showCreateModal === 'task') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select
                  id="modal-priority-select"
                  value={newItemData.priority || 'medium'}
                  onChange={(e) => setNewItemData({ ...newItemData, priority: e.target.value })}
                  style={{
                    color: '#111827',
                    backgroundColor: '#ffffff',
                    WebkitTextFillColor: '#111827',
                    textShadow: 'none'
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            )}

            {showCreateModal === 'task' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Estimated Minutes</label>
                  <input
                    id="modal-estimated-minutes-input"
                    type="number"
                    value={newItemData.estimatedMinutes || 60}
                    onChange={(e) => setNewItemData({ ...newItemData, estimatedMinutes: parseInt(e.target.value) || 60 })}
                    style={{
                      color: 'black',
                      backgroundColor: 'white',
                      border: '1px solid #ccc'
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">If-Then Plan</label>
                  <textarea
                    id="modal-if-then-input"
                    value={newItemData.ifThenPlan || ''}
                    onChange={(e) => setNewItemData({ ...newItemData, ifThenPlan: e.target.value })}
                    style={{
                      color: 'black',
                      backgroundColor: 'white',
                      border: '1px solid #ccc'
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                    rows={2}
                    placeholder="If [context/time/location], then [specific action]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Why (Purpose)</label>
                  <input
                    id="modal-why-input"
                    type="text"
                    value={newItemData.why || ''}
                    onChange={(e) => setNewItemData({ ...newItemData, why: e.target.value })}
                    style={{
                      color: 'black',
                      backgroundColor: 'white',
                      border: '1px solid #ccc'
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                    placeholder="Why is this important?"
                  />
                </div>
              </>
            )}
          </div>
          
            <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200">
              <button
                onClick={() => {
                  setShowCreateModal(null);
                  setNewItemData({});
                }}
                className="px-6 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateItem}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                type="button"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      </div>
    );

    return createPortal(modalContent, document.body);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">OKR Management</h2>
        <button
          onClick={() => setShowCreateModal('goal')}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          <span>New Goal</span>
        </button>
      </div>

      {/* Goals Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {goals.map(goal => (
          <GoalCard key={goal.id} goal={goal} />
        ))}
      </div>

      {/* Selected Goal Details */}
      {selectedGoal && (
        <div className="bg-gray-50 rounded-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-semibold text-gray-900">{selectedGoal.title}</h3>
            <div className="flex space-x-2">
              <button
                onClick={() => setShowCreateModal('keyResult')}
                className="flex items-center space-x-1 px-3 py-1 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
              >
                <Plus className="w-3 h-3" />
                <span>Key Result</span>
              </button>
              <button
                onClick={() => setShowCreateModal('project')}
                className="flex items-center space-x-1 px-3 py-1 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700"
              >
                <Plus className="w-3 h-3" />
                <span>Project</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Key Results */}
            <div>
              <h4 className="font-medium text-gray-900 mb-3 flex items-center">
                <Target className="w-4 h-4 mr-2" />
                Key Results
              </h4>
              <div className="space-y-3">
                {getGoalKeyResults(selectedGoal.id).map(kr => (
                  <KeyResultCard key={kr.id} keyResult={kr} />
                ))}
              </div>
            </div>

            {/* Projects */}
            <div>
              <h4 className="font-medium text-gray-900 mb-3 flex items-center">
                <TrendingUp className="w-4 h-4 mr-2" />
                Projects
              </h4>
              <div className="space-y-3">
                {getGoalProjects(selectedGoal.id).map(project => (
                  <div key={project.id}>
                    <ProjectCard project={project} />
                    
                    {/* Project Tasks */}
                    <div className="mt-2 ml-4 space-y-2">
                      {getProjectTasks(project.id).slice(0, 3).map(task => (
                        <TaskCard key={task.id} task={task} />
                      ))}
                      {getProjectTasks(project.id).length > 3 && (
                        <div className="text-xs text-gray-500 text-center py-1">
                          +{getProjectTasks(project.id).length - 3} more tasks
                        </div>
                      )}
                      <button
                        onClick={() => setShowCreateModal('task')}
                        className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-gray-400 hover:text-gray-600"
                      >
                        + Add Task
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal will be rendered via portal */}
      <CreateModal />
    </div>
  );
}