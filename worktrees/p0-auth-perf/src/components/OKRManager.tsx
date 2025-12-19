'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Goal, KeyResult, Project, Task, TimeBlock } from '@/types';
import { Plus, Target, TrendingUp, Calendar, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { parseDateTime, calculateDuration, msToHours, formatHours } from '@/lib/datetime';

interface OKRManagerProps {
  goals: Goal[];
  keyResults: KeyResult[];
  projects: Project[];
  tasks: Task[];
  timeBlocks?: TimeBlock[];
  onCreateGoal: (goal: Partial<Goal>) => void;
  onUpdateGoal: (id: string, updates: Partial<Goal>) => void;
  onCreateKeyResult: (keyResult: Partial<KeyResult>) => void;
  onUpdateKeyResult: (id: string, updates: Partial<KeyResult>) => void;
  onCreateProject: (project: Partial<Project>) => void;
  onUpdateProject: (id: string, updates: Partial<Project>) => void;
  onDeleteProject?: (id: string) => void;
  onCreateTask: (task: Partial<Task>) => void;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
  currentUserId?: string; // 🔥 CRITICAL FIX
}

export default function OKRManager({
  goals,
  keyResults,
  projects,
  tasks,
  timeBlocks = [],
  onCreateGoal,
  onUpdateGoal,
  onCreateKeyResult,
  onUpdateKeyResult,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onCreateTask,
  onUpdateTask,
  currentUserId // 🔥 CRITICAL FIX
}: OKRManagerProps) {
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [showCreateModal, setShowCreateModal] = useState<'goal' | 'keyResult' | 'project' | 'task' | null>(null);
  const [newItemData, setNewItemData] = useState<any>({});
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  
  // 🔥 PSICOPATICO ENHANCEMENT: Key Result Editing
  const [editingKeyResult, setEditingKeyResult] = useState<KeyResult | null>(null);
  const [showKeyResultModal, setShowKeyResultModal] = useState(false);
  const [keyResultEditData, setKeyResultEditData] = useState<any>({});

  // Refs to maintain focus
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);

  // Optimized callbacks to prevent re-render issues
  const handleTitleChange = useCallback((value: string) => {
    const fieldName = showCreateModal === 'project' ? 'name' : 'title';
    setNewItemData((prev: any) => ({ ...prev, [fieldName]: value }));
  }, [showCreateModal]);

  const handleDescriptionChange = useCallback((value: string) => {
    setNewItemData((prev: any) => ({ ...prev, description: value }));
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

  // 🔥 P1 FIX: Hours calculation utilities with ACTUAL vs PLANNED distinction
  const calculateProjectPlannedHours = (projectId: string): number => {
    return timeBlocks
      .filter(block => block.projectId === projectId)
      .reduce((total, block) => {
        const durationMs = new Date(block.endTime).getTime() - new Date(block.startTime).getTime();
        return total + (durationMs / (1000 * 60 * 60)); // Convert to hours
      }, 0);
  };

  // 🔥 P0 TASK C + P1 TASK D: Calculate ACTUAL completed hours for projects using centralized datetime
  const calculateProjectActualHours = (projectId: string): number => {
    return timeBlocks
      .filter(block => block.projectId === projectId && block.status === 'completed')
      .reduce((total, block) => {
        // Use actualStartTime/actualEndTime if available, otherwise fallback to planned times
        const startTime = block.actualStartTime || block.startTime;
        const endTime = block.actualEndTime || block.endTime;
        const durationMs = calculateDuration(startTime, endTime);
        return total + msToHours(durationMs);
      }, 0);
  };

  const calculateGoalPlannedHours = (goalId: string): number => {
    // Sum from direct goal time blocks
    const directGoalHours = timeBlocks
      .filter(block => block.goalId === goalId || (block.goalIds && block.goalIds.includes(goalId)))
      .reduce((total, block) => {
        const durationMs = new Date(block.endTime).getTime() - new Date(block.startTime).getTime();
        const hours = durationMs / (1000 * 60 * 60);
        // If block has goal allocation, use it
        if (block.goalAllocation && block.goalAllocation[goalId]) {
          return total + (hours * block.goalAllocation[goalId] / 100);
        }
        return total + hours;
      }, 0);
    
    // Sum from project time blocks
    const goalProjects = getGoalProjects(goalId);
    const projectHours = goalProjects.reduce((total, project) => {
      return total + calculateProjectPlannedHours(project.id);
    }, 0);
    
    return directGoalHours + projectHours;
  };

  // 🔥 P0 TASK C + P1 TASK D: Calculate ACTUAL completed hours for goals using centralized datetime
  const calculateGoalActualHours = (goalId: string): number => {
    // Sum from direct goal time blocks (completed only)
    const directGoalHours = timeBlocks
      .filter(block => 
        (block.goalId === goalId || (block.goalIds && block.goalIds.includes(goalId))) &&
        block.status === 'completed'
      )
      .reduce((total, block) => {
        const startTime = block.actualStartTime || block.startTime;
        const endTime = block.actualEndTime || block.endTime;
        const durationMs = calculateDuration(startTime, endTime);
        const hours = msToHours(durationMs);
        // If block has goal allocation, use it
        if (block.goalAllocation && block.goalAllocation[goalId]) {
          return total + (hours * block.goalAllocation[goalId] / 100);
        }
        return total + hours;
      }, 0);
    
    // Sum from project time blocks (completed only)
    const goalProjects = getGoalProjects(goalId);
    const projectHours = goalProjects.reduce((total, project) => {
      return total + calculateProjectActualHours(project.id);
    }, 0);
    
    return directGoalHours + projectHours;
  };

  // 🔥 OPTIMIZED: Memoized progress calculation for all goals
  const goalProgressMap = useMemo(() => {
    const progressMap = new Map<string, number>();
    
    goals.forEach(goal => {
      const goalKeyResults = getGoalKeyResults(goal.id);
      const goalProjects = getGoalProjects(goal.id);
      
      console.log('🎯 OKR_PROGRESS_DEBUG:', {
        goalId: goal.id,
        goalTitle: goal.title,
        keyResultsCount: goalKeyResults.length,
        projectsCount: goalProjects.length
      });
      
      // Strategy 1: KeyResults with targetValue
      const validKeyResults = goalKeyResults.filter(kr => kr.targetValue > 0);
      if (validKeyResults.length > 0) {
        const totalProgress = validKeyResults.reduce((sum, kr) => {
          const krProgress = (kr.currentValue / kr.targetValue) * 100;
          console.log(`  KeyResult ${kr.title}: ${kr.currentValue}/${kr.targetValue} = ${krProgress}%`);
          return sum + Math.min(100, krProgress);
        }, 0);
        const avgProgress = totalProgress / validKeyResults.length;
        console.log(`  Traditional KR Progress: ${avgProgress}%`);
        progressMap.set(goal.id, avgProgress);
        return;
      }
      
      // Strategy 2: Hours-based progress using ACTUAL hours vs TARGET hours
      const actualHours = calculateGoalActualHours(goal.id);
      const targetHours = goalProjects.reduce((sum, project) => {
        return sum + (project.totalHoursTarget || 0);
      }, 0);
      
      console.log(`  Hours-based calculation: ${actualHours}h actual / ${targetHours}h target`);
      
      if (targetHours > 0) {
        const hoursProgress = Math.min(100, (actualHours / targetHours) * 100);
        console.log(`  Hours Progress: ${hoursProgress}%`);
        progressMap.set(goal.id, hoursProgress);
        return;
      }
      
      // Fallback: Show 0% but log that we have actual hours without targets
      if (actualHours > 0) {
        console.log(`  Fallback: ${actualHours}h actual but no targets set`);
      }
      
      progressMap.set(goal.id, 0);
    });
    
    return progressMap;
  }, [goals, keyResults, projects, timeBlocks]);

  const calculateGoalProgress = (goalId: string): number => {
    // Use memoized progress calculation
    return goalProgressMap.get(goalId) || 0;
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
      case 'critical': return 'text-red-800 bg-red-100 border border-red-200';
      case 'high': return 'text-red-600 bg-red-50';
      case 'medium': return 'text-yellow-600 bg-yellow-50';
      case 'low': return 'text-green-600 bg-green-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const handleCreateItem = () => {
    if (!currentUserId) {
      console.error('Cannot create item: userId not available');
      return;
    }

    const now = new Date();
    const baseData = {
      id: `${showCreateModal}-${Date.now()}`,
      userId: currentUserId,
      domainId: 'default',
      createdAt: now,
      updatedAt: now,
    };

    switch (showCreateModal) {
      case 'goal':
        onCreateGoal({ 
          ...newItemData, 
          ...baseData, 
          status: 'active',
          // Set default values for new analytics fields
          timeAllocationTarget: newItemData.timeAllocationTarget || 0,
          priority: newItemData.priority || 'medium',
          category: newItemData.category || 'important_not_urgent',
          complexity: newItemData.complexity || 'moderate',
          estimatedHours: newItemData.estimatedHours || undefined
        });
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
        console.log('ADD_TASK_CLICK', { 
          selectedGoal: selectedGoal?.id, 
          selectedProject: selectedProject?.id,
          currentUserId,
          newItemData 
        });
        
        // 🔥 FIX: Ensure task has proper project and goal IDs
        const taskData = { 
          ...newItemData, 
          ...baseData,
          projectId: selectedProject?.id || newItemData.projectId,
          goalId: selectedGoal?.id || newItemData.goalId,
          status: 'pending',
          priority: 'medium',
          estimatedMinutes: 60
        };
        
        console.log('CREATE_TASK_START', taskData);
        
        try {
          onCreateTask(taskData);
          console.log('CREATE_TASK_SUCCESS', taskData);
        } catch (error) {
          console.error('CREATE_TASK_ERROR', error);
        }
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
        {/* Header with title and percentage - responsive layout */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-4 gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 mb-2 truncate">{goal.title}</h3>
            <p className="text-gray-600 text-sm mb-3 line-clamp-2">{goal.description}</p>
          </div>
          
          {/* Progress percentage - always visible, mobile-friendly */}
          <div className="text-right sm:text-right sm:ml-4 flex-shrink-0">
            <div className="text-2xl font-bold text-blue-600">{Math.round(progress)}%</div>
            <div className="text-xs text-gray-500">
              {goalKeyResults.filter(kr => kr.targetValue > 0).length > 0 
                ? 'KR Progress' 
                : goalProjects.some(p => p.totalHoursTarget && p.totalHoursTarget > 0)
                  ? 'Hours Progress'
                  : 'Progress'
              }
            </div>
            {goalProjects.some(p => p.totalHoursTarget && p.totalHoursTarget > 0) && (
              <div className="text-xs text-gray-400 mt-1">
                {formatHours(calculateGoalActualHours(goal.id))}h / {goalProjects.reduce((sum, p) => sum + (p.totalHoursTarget || 0), 0)}h
              </div>
            )}
          </div>
        </div>

        {/* Badges - responsive wrap */}
        <div className="flex flex-wrap items-center gap-2 text-sm mb-3">
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(goal.status)}`}>
            {goal.status}
          </span>
          <span className={`px-2 py-1 rounded text-xs font-medium ${getPriorityColor(goal.priority)}`}>
            {goal.priority}
          </span>
          <span className="text-gray-500 flex items-center">
            <Calendar className="w-4 h-4 mr-1" />
            <span className="text-xs">{goal.targetDate.toLocaleDateString()}</span>
          </span>
        </div>
        
        {/* Time allocation info */}
        <div className="space-y-1 mb-4">
          {goal.timeAllocationTarget > 0 && (
            <div className="text-xs text-blue-600 flex items-center">
              <Clock className="w-3 h-3 mr-1" />
              Target: {goal.timeAllocationTarget}hrs/week
            </div>
          )}
          <div className="text-xs text-green-600 flex items-center">
            <Target className="w-3 h-3 mr-1" />
            Planned: {formatHours(calculateGoalPlannedHours(goal.id))}hrs
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

  // 🔥 PSICOPATICO ENHANCEMENT: Handle Key Result Update
  const handleUpdateKeyResultProgress = (keyResult: KeyResult) => {
    setEditingKeyResult(keyResult);
    setKeyResultEditData({
      currentValue: keyResult.currentValue,
      targetValue: keyResult.targetValue,
      status: keyResult.status,
      title: keyResult.title,
      description: keyResult.description,
      unit: keyResult.unit
    });
    setShowKeyResultModal(true);
  };

  const saveKeyResultUpdate = () => {
    if (!editingKeyResult) return;
    
    // 🧮 Auto-calculate progress percentage
    const progress = keyResultEditData.targetValue > 0 
      ? Math.min(100, Math.max(0, (keyResultEditData.currentValue / keyResultEditData.targetValue) * 100))
      : 0;
    
    // 🎯 Auto-update status based on progress
    let status = keyResultEditData.status;
    if (progress >= 100) {
      status = 'completed';
    } else if (progress >= 70) {
      status = 'active';
    } else if (progress < 30) {
      status = 'at_risk';
    }
    
    const updates = {
      ...keyResultEditData,
      progress: Math.round(progress),
      status,
      updatedAt: new Date()
    };
    
    console.log('🔥 PSICOPATICO: Updating Key Result:', {
      keyResultId: editingKeyResult.id,
      oldProgress: editingKeyResult.progress,
      newProgress: progress,
      oldStatus: editingKeyResult.status,
      newStatus: status
    });
    
    onUpdateKeyResult(editingKeyResult.id, updates);
    setShowKeyResultModal(false);
    setEditingKeyResult(null);
    setKeyResultEditData({});
  };

  const KeyResultCard = ({ keyResult }: { keyResult: KeyResult }) => (
    <div 
      className="bg-gray-50 border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-all cursor-pointer group"
      onClick={() => handleUpdateKeyResultProgress(keyResult)}
    >
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors">{keyResult.title}</h4>
        <div className="flex items-center space-x-2">
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(keyResult.status)}`}>
            {keyResult.status}
          </span>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity text-blue-500 text-xs font-bold">
            ✏️ EDIT
          </div>
        </div>
      </div>
      
      <p className="text-sm text-gray-600 mb-3">{keyResult.description}</p>
      
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-500 font-mono">
          <span className="font-bold text-blue-600">{keyResult.currentValue}</span> / {keyResult.targetValue} {keyResult.unit}
        </span>
        <span className="text-lg font-bold text-blue-600">
          {Math.round(keyResult.progress)}%
        </span>
      </div>
      
      <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${
            keyResult.progress >= 100 ? 'bg-green-500' :
            keyResult.progress >= 70 ? 'bg-blue-500' :
            keyResult.progress >= 30 ? 'bg-yellow-500' : 'bg-red-500'
          }`}
          style={{ width: `${Math.min(100, keyResult.progress)}%` }}
        />
      </div>
      
      <div className="text-xs text-center text-gray-500 group-hover:text-blue-600 transition-colors">
        Click to update progress
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
            {onDeleteProject && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete project "${project.name}"? This will also remove ${projectTasks.length} tasks.`)) {
                    onDeleteProject(project.id);
                  }
                }}
                className="text-red-500 hover:text-red-700 text-sm px-2 py-1 rounded"
                title="Delete Project"
              >
                🗑️
              </button>
            )}
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
        
        {/* Hours Progress */}
        <div className="mt-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-600">Planned Hours:</span>
            <span className="font-medium text-blue-600">
              {calculateProjectPlannedHours(project.id).toFixed(1)}h
              {project.totalHoursTarget && (
                <span className="text-gray-500">/{project.totalHoursTarget}h</span>
              )}
            </span>
          </div>
          {project.totalHoursTarget && project.totalHoursTarget > 0 && (
            <div className="w-full bg-gray-200 rounded-full h-1 mt-1">
              <div
                className="bg-blue-500 h-1 rounded-full transition-all duration-300"
                style={{ 
                  width: `${Math.min(100, (calculateProjectPlannedHours(project.id) / project.totalHoursTarget) * 100)}%` 
                }}
              />
            </div>
          )}
        </div>
        
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div
            className="bg-green-500 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        
        <div className="mt-2 space-y-1">
          {project.dueDate && (
            <div className="text-xs text-gray-500 flex items-center">
              <Clock className="w-3 h-3 mr-1" />
              Due: {project.dueDate.toLocaleDateString()}
            </div>
          )}
          {project.weeklyHoursTarget && (
            <div className="text-xs text-blue-600 flex items-center">
              <Clock className="w-3 h-3 mr-1" />
              Weekly: {project.weeklyHoursTarget}hrs
            </div>
          )}
          {project.totalHoursTarget && (
            <div className="text-xs text-green-600 flex items-center">
              <Target className="w-3 h-3 mr-1" />
              Total: {project.totalHoursTarget}hrs
            </div>
          )}
        </div>
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
              <>
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

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Time Allocation Target (hrs/week)</label>
                    <input
                      id="modal-time-allocation-input"
                      type="number"
                      min="0"
                      step="0.5"
                      value={newItemData.timeAllocationTarget || ''}
                      onChange={(e) => setNewItemData({ ...newItemData, timeAllocationTarget: parseFloat(e.target.value) || 0 })}
                      style={{
                        color: 'black',
                        backgroundColor: 'white',
                        border: '1px solid #ccc'
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                      placeholder="e.g., 5.0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Estimated Total Hours</label>
                    <input
                      id="modal-estimated-hours-input"
                      type="number"
                      min="0"
                      step="1"
                      value={newItemData.estimatedHours || ''}
                      onChange={(e) => setNewItemData({ ...newItemData, estimatedHours: parseInt(e.target.value) || undefined })}
                      style={{
                        color: 'black',
                        backgroundColor: 'white',
                        border: '1px solid #ccc'
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                      placeholder="e.g., 100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                    <select
                      id="modal-goal-priority-select"
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
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Complexity</label>
                    <select
                      id="modal-complexity-select"
                      value={newItemData.complexity || 'moderate'}
                      onChange={(e) => setNewItemData({ ...newItemData, complexity: e.target.value })}
                      style={{
                        color: '#111827',
                        backgroundColor: '#ffffff',
                        WebkitTextFillColor: '#111827',
                        textShadow: 'none'
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                    >
                      <option value="simple">Simple</option>
                      <option value="moderate">Moderate</option>
                      <option value="complex">Complex</option>
                      <option value="expert">Expert</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category (Eisenhower Matrix)</label>
                  <select
                    id="modal-category-select"
                    value={newItemData.category || 'important_not_urgent'}
                    onChange={(e) => setNewItemData({ ...newItemData, category: e.target.value })}
                    style={{
                      color: '#111827',
                      backgroundColor: '#ffffff',
                      WebkitTextFillColor: '#111827',
                      textShadow: 'none'
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                  >
                    <option value="urgent_important">Urgent & Important (Do First)</option>
                    <option value="important_not_urgent">Important, Not Urgent (Schedule)</option>
                    <option value="urgent_not_important">Urgent, Not Important (Delegate)</option>
                    <option value="neither">Neither (Eliminate)</option>
                  </select>
                </div>
              </>
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

            {showCreateModal === 'project' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={newItemData.dueDate ? newItemData.dueDate.toISOString().split('T')[0] : ''}
                    onChange={(e) => setNewItemData({ ...newItemData, dueDate: e.target.value ? new Date(e.target.value) : undefined })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Weekly Hours Target</label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={newItemData.weeklyHoursTarget || ''}
                      onChange={(e) => setNewItemData({ ...newItemData, weeklyHoursTarget: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                      placeholder="e.g., 5.0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Total Hours Target</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={newItemData.totalHoursTarget || ''}
                      onChange={(e) => setNewItemData({ ...newItemData, totalHoursTarget: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                      placeholder="e.g., 100"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={newItemData.priority || 'medium'}
                    onChange={(e) => setNewItemData({ ...newItemData, priority: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </>
            )}
            
            {showCreateModal === 'task' && (
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
        {goals.length === 0 ? (
          <div className="col-span-full">
            <div className="card card-body text-center py-12">
              <div className="text-6xl mb-4">🎯</div>
              <h3 className="heading-2 mb-4">No Goals Yet</h3>
              <p className="text-body mb-6">
                Create your first goal to start organizing your objectives and key results.
              </p>
              <button
                onClick={() => setShowCreateModal('goal')}
                className="btn btn-primary"
              >
                🚀 Create First Goal
              </button>
            </div>
          </div>
        ) : (
          goals.map(goal => (
            <GoalCard key={goal.id} goal={goal} />
          ))
        )}
      </div>

      {/* Selected Goal Details */}
      {selectedGoal && (
        <div className="bg-gray-50 rounded-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-semibold text-gray-900">{selectedGoal.title}</h3>
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                <span className={`px-2 py-1 rounded text-xs font-medium ${getPriorityColor(selectedGoal.priority)}`}>
                  {selectedGoal.priority} priority
                </span>
                <span className="px-2 py-1 rounded text-xs font-medium bg-purple-50 text-purple-700">
                  {selectedGoal.complexity} complexity
                </span>
                <span className="px-2 py-1 rounded text-xs font-medium bg-indigo-50 text-indigo-700">
                  {selectedGoal.category.replace('_', ' & ').replace('urgent', 'Urgent').replace('important', 'Important').replace('not', 'Not')}
                </span>
                {selectedGoal.timeAllocationTarget > 0 && (
                  <span className="px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700">
                    {selectedGoal.timeAllocationTarget}hrs/week target
                  </span>
                )}
                {selectedGoal.estimatedHours && (
                  <span className="px-2 py-1 rounded text-xs font-medium bg-green-50 text-green-700">
                    ~{selectedGoal.estimatedHours}hrs total
                  </span>
                )}
              </div>
            </div>
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
                        onClick={() => {
                          console.log('ADD_TASK_CLICK', { goalId: selectedGoal?.id, projectId: project.id, currentUserId });
                          setSelectedProject(project);
                          setNewItemData({ projectId: project.id, goalId: selectedGoal?.id });
                          setShowCreateModal('task');
                        }}
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

      {/* Modals */}
      <CreateModal />
      <KeyResultEditModal />
    </div>
  );

  // 🔥 PSICOPATICO MODAL: Key Result Editor
  function KeyResultEditModal() {
    if (!showKeyResultModal || !editingKeyResult) return null;
    if (typeof window === 'undefined') return null;

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
            setShowKeyResultModal(false);
            setEditingKeyResult(null);
            setKeyResultEditData({});
          }
        }}
      >
        <div 
          className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          style={{
            transform: 'translateZ(0)',
            position: 'relative',
            zIndex: 10000
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-gray-900 flex items-center">
                🎯 Update Key Result
              </h3>
              <button
                onClick={() => {
                  setShowKeyResultModal(false);
                  setEditingKeyResult(null);
                  setKeyResultEditData({});
                }}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none transition-colors"
                type="button"
              >
                ×
              </button>
            </div>
            
            {/* Key Result Info */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <h4 className="font-bold text-blue-900 mb-2">{editingKeyResult.title}</h4>
              <p className="text-blue-700 text-sm">{editingKeyResult.description}</p>
            </div>

            <div className="space-y-6">
              {/* Progress Input Section */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Current Value</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={keyResultEditData.currentValue || 0}
                    onChange={(e) => setKeyResultEditData({
                      ...keyResultEditData, 
                      currentValue: parseFloat(e.target.value) || 0
                    })}
                    className="w-full px-4 py-3 text-lg font-bold border-2 border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                    style={{
                      color: '#1e40af',
                      backgroundColor: '#eff6ff',
                      fontSize: '18px'
                    }}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Target Value</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={keyResultEditData.targetValue || 0}
                    onChange={(e) => setKeyResultEditData({
                      ...keyResultEditData, 
                      targetValue: parseFloat(e.target.value) || 0
                    })}
                    className="w-full px-4 py-3 text-lg font-bold border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-all"
                    style={{
                      color: '#374151',
                      backgroundColor: '#f9fafb',
                      fontSize: '18px'
                    }}
                  />
                </div>
              </div>

              {/* Unit Display */}
              <div className="text-center">
                <span className="inline-block px-4 py-2 bg-gray-100 rounded-full text-gray-700 font-medium">
                  Unit: {keyResultEditData.unit || 'units'}
                </span>
              </div>

              {/* Progress Preview */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h5 className="font-bold text-gray-900">Progress Preview</h5>
                  <span className="text-2xl font-bold text-blue-600">
                    {keyResultEditData.targetValue > 0 
                      ? Math.round(Math.min(100, Math.max(0, (keyResultEditData.currentValue / keyResultEditData.targetValue) * 100)))
                      : 0}%
                  </span>
                </div>
                
                <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
                  <div
                    className="bg-blue-500 h-3 rounded-full transition-all duration-300"
                    style={{ 
                      width: `${keyResultEditData.targetValue > 0 
                        ? Math.min(100, Math.max(0, (keyResultEditData.currentValue / keyResultEditData.targetValue) * 100))
                        : 0}%` 
                    }}
                  />
                </div>
                
                <div className="text-center text-sm text-gray-600">
                  {keyResultEditData.currentValue || 0} / {keyResultEditData.targetValue || 0} {keyResultEditData.unit || 'units'}
                </div>
              </div>

              {/* Status Override (Optional) */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Status (Auto-calculated)</label>
                <select
                  value={(() => {
                    const progress = keyResultEditData.targetValue > 0 
                      ? (keyResultEditData.currentValue / keyResultEditData.targetValue) * 100
                      : 0;
                    if (progress >= 100) return 'completed';
                    if (progress >= 70) return 'active';
                    if (progress < 30) return 'at_risk';
                    return 'active';
                  })()}
                  onChange={(e) => setKeyResultEditData({...keyResultEditData, status: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                  style={{
                    color: '#111827',
                    backgroundColor: '#ffffff'
                  }}
                >
                  <option value="active">🟡 Active</option>
                  <option value="completed">🟢 Completed</option>
                  <option value="at_risk">🔴 At Risk</option>
                </select>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex justify-end space-x-3 mt-8 pt-6 border-t border-gray-200">
              <button
                onClick={() => {
                  setShowKeyResultModal(false);
                  setEditingKeyResult(null);
                  setKeyResultEditData({});
                }}
                className="px-6 py-3 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={saveKeyResultUpdate}
                className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-bold text-lg flex items-center space-x-2"
                type="button"
              >
                <span>🚀</span>
                <span>Update Progress</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );

    return createPortal(modalContent, document.body);
  }
}
