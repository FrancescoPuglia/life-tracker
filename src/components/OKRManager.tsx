"use client";

import { useState, useMemo, useCallback, useEffect, useRef, useContext, createContext, type ReactNode } from 'react';

import { createPortal } from 'react-dom';

import { 
  Target, Calendar, Clock, TrendingUp, Plus, Trash2, Edit3, 
  CheckCircle, AlertTriangle, Flag, ChevronRight, X, Loader2,
  FolderOpen, ListTodo, AlertCircle, Check, FileText, Map, Sparkles
} from 'lucide-react';
import type { Task, TaskStatus, Goal, KeyResult, Project, TimeBlock, Priority, GoalStatus, Note, NoteTemplate, GoalRoadmap } from '@/types';
import { RichNoteEditor } from './RichNoteEditor';
import { GoalRoadmapView } from './GoalRoadmapView';
import { LazyVisionBoardView } from './VisionBoard';
import { useDataContext } from '@/providers/DataProvider';


// ============================================================================
// TYPES - Importati da '@/types'
// ============================================================================

interface OKRManagerProps {
  goals: Goal[];
  keyResults: KeyResult[];
  projects: Project[];
  tasks: Task[];
  timeBlocks?: TimeBlock[];
  currentUserId?: string;
  isLoading?: boolean;

  onCreateGoal: (goal: Partial<Goal>) => Promise<string | void> | string | void;
  onUpdateGoal: (id: string, updates: Partial<Goal>) => Promise<void> | void;
  onDeleteGoal?: (id: string) => Promise<void> | void;

  onCreateKeyResult: (kr: Partial<KeyResult>) => Promise<string | void> | string | void;
  onUpdateKeyResult: (id: string, updates: Partial<KeyResult>) => Promise<void> | void;
  onDeleteKeyResult?: (id: string) => Promise<void> | void;

  onCreateProject: (project: Partial<Project>) => Promise<string | void> | string | void;
  onUpdateProject: (id: string, updates: Partial<Project>) => Promise<void> | void;
  onDeleteProject?: (id: string) => Promise<void> | void;

  onCreateTask: (task: Partial<Task>) => Promise<string | void> | string | void;
  onUpdateTask: (id: string, updates: Partial<Task>) => Promise<void> | void;
  onDeleteTask?: (id: string) => Promise<void> | void;
}

type CreateModalType = "goal" | "keyResult" | "project" | "task" | null;
type Mode = "planned" | "actual";

// ============================================================================
// CONTEXT
// ============================================================================

interface OKRContextValue {
  currentUserId: string | undefined;
  selectedGoalId: string | null;
  selectedProjectId: string | null;
  setSelectedGoalId: (id: string | null) => void;
  setSelectedProjectId: (id: string | null) => void;
  timeBlocks: TimeBlock[];
  projects: Project[];
  tasks: Task[];
  keyResults: KeyResult[];
}

const OKRContext = createContext<OKRContextValue | null>(null);

function useOKRContext() {
  const ctx = useContext(OKRContext);
  if (!ctx) throw new Error("useOKRContext must be used within OKRManager");
  return ctx;
}

// ============================================================================
// UTILITIES
// ============================================================================

function toDateSafe(x: unknown): Date | null {
  if (!x) return null;
  if (x instanceof Date) return isNaN(x.getTime()) ? null : x;
  if (typeof x === "object" && x !== null && "toDate" in x) {
    const fn = (x as { toDate: () => Date }).toDate;
    if (typeof fn === "function") {
      try {
        const d = fn.call(x);
        return d instanceof Date && !isNaN(d.getTime()) ? d : null;
      } catch {
        return null;
      }
    }
  }
  if (typeof x === "string" || typeof x === "number") {
    const d = new Date(x);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatDateSafe(x: unknown): string {
  const d = toDateSafe(x);
  if (!d) return "—";
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function formatISOSafe(x: unknown): string {
  const d = toDateSafe(x);
  return d ? d.toISOString() : "";
}

function computeDurationMinutes(start: unknown, end: unknown): number {
  const s = toDateSafe(start);
  const e = toDateSafe(end);
  if (!s || !e) return 0;
  const diff = (e.getTime() - s.getTime()) / 60000;
  if (!Number.isFinite(diff) || diff < 0) return 0;
  return Math.round(diff);
}

function formatHours(h: number): string {
  if (!Number.isFinite(h) || h < 0) return "0";
  return (Math.round(h * 10) / 10).toFixed(1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ============================================================================
// EDITABLE TEXT COMPONENT - Supreme Detective Implementation
// ============================================================================

interface EditableTextProps {
  value: string;
  onSave: (newValue: string) => void;
  className?: string;
  placeholder?: string;
  maxLength?: number;
  variant?: 'title' | 'subtitle' | 'body';
}

function EditableText({ 
  value, 
  onSave, 
  className = '', 
  placeholder = 'Enter text...', 
  maxLength = 100,
  variant = 'body' 
}: EditableTextProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const variantClasses = {
    title: 'text-lg font-semibold text-gray-900',
    subtitle: 'font-medium text-gray-900', 
    body: 'font-medium text-sm text-gray-900'
  };

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === value || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      await onSave(trimmed);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save:', error);
      setEditValue(value); // Revert on error
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          className={`
            flex-1 min-w-0 px-2 py-1 bg-white border border-blue-300 rounded 
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
            ${variantClasses[variant]} ${className}
          `}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={isSubmitting}
        />
        {isSubmitting && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-0 flex-1 group">
      <span className={`truncate ${variantClasses[variant]} ${className}`}>
        {value}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsEditing(true);
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50"
        title="Rename"
        aria-label="Rename"
      >
        <Edit3 className="w-3 h-3" />
      </button>
    </div>
  );
}

// ✅ FIX: Include "overrun" status for actual time
function statusAllowed(mode: Mode, status?: string): boolean {
  if (!status) return false;
  
  // 🔍 DETECTIVE DEBUG - Status filtering investigation
  if (process.env.NODE_ENV !== 'production') {
    console.log('[statusAllowed] DETECTIVE DEBUG:', { mode, status, result: mode === "actual" ? (status === "completed" || status === "overrun") : ["planned", "in_progress", "completed"].includes(status) });
  }
  
  if (mode === "actual") {
    return status === "completed" || status === "overrun"; // CRITICAL FIX
  }
  return ["planned", "in_progress", "completed"].includes(status);
}

// ============================================================================
// AGGREGATION - Anti double-count logic
// ============================================================================

interface AggregationResult {
  totalMinutes: number;
  entriesCount: number;
  debugInfo?: {
    viaProject: number;
    directGoal: number;
    viaTask: number;
  };
}

function aggregateGoalMinutes(args: {
  goalId: string;
  mode: Mode;
  timeBlocks: TimeBlock[];
  projects: Project[];
  userId: string;
}): AggregationResult {
  const { goalId, mode, timeBlocks, projects, userId } = args;

  const userTimeBlocks = timeBlocks.filter((tb) => !tb.userId || tb.userId === userId);
  const goalProjectIds = new Set(
    projects.filter((p) => !p.deleted && p.goalId === goalId && p.userId === userId).map((p) => p.id)
  );

  const seen = new Set<string>();
  let totalMinutes = 0;
  let viaProject = 0;
  let directGoal = 0;
  let viaTask = 0;

  for (const tb of userTimeBlocks) {
    if (!statusAllowed(mode, tb.status)) continue;

    const startISO = formatISOSafe(tb.startTime);
    const endISO = formatISOSafe(tb.endTime);
    const uniqueKey = tb.id || `${startISO}|${endISO}|${tb.projectId ?? ""}|${tb.taskId ?? ""}|${tb.status}`;

    if (seen.has(uniqueKey)) continue;

    const inGoalProject = !!tb.projectId && goalProjectIds.has(tb.projectId);
    const matchesGoal = tb.goalId === goalId || (Array.isArray(tb.goalIds) && tb.goalIds.includes(goalId));

    let shouldCount = false;
    if (inGoalProject) {
      shouldCount = true;
      if (tb.taskId) viaTask++;
      else viaProject++;
    } else if (matchesGoal) {
      shouldCount = true;
      directGoal++;
    }

    if (!shouldCount) continue;
    seen.add(uniqueKey);

    let duration: number;
    if (mode === "actual" && tb.actualStartTime && tb.actualEndTime) {
      duration = computeDurationMinutes(tb.actualStartTime, tb.actualEndTime);
    } else {
      duration = computeDurationMinutes(tb.startTime, tb.endTime);
    }

    totalMinutes += duration;
  }

  return { totalMinutes, entriesCount: seen.size, debugInfo: { viaProject, directGoal, viaTask } };
}

function aggregateProjectMinutes(args: {
  projectId: string;
  mode: Mode;
  timeBlocks: TimeBlock[];
  userId: string;
}): AggregationResult {
  const { projectId, mode, timeBlocks, userId } = args;

  const userTimeBlocks = timeBlocks.filter((tb) => !tb.userId || tb.userId === userId);
  
  // 🔍 DETECTIVE DEBUG - Critical aggregation investigation
  if (process.env.NODE_ENV !== 'production') {
    console.log('[aggregateProjectMinutes] DETECTIVE DEBUG:', {
      projectId,
      mode,
      totalTimeBlocks: timeBlocks.length,
      userTimeBlocks: userTimeBlocks.length,
      matchingProjectBlocks: userTimeBlocks.filter(tb => tb.projectId === projectId),
      statusAllowedBlocks: userTimeBlocks.filter(tb => statusAllowed(mode, tb.status)),
      finalMatchingBlocks: userTimeBlocks.filter(tb => 
        statusAllowed(mode, tb.status) && tb.projectId === projectId
      )
    });
  }
  
  const seen = new Set<string>();
  let totalMinutes = 0;

  for (const tb of userTimeBlocks) {
    if (!statusAllowed(mode, tb.status)) continue;
    if (tb.projectId !== projectId) continue;

    const startISO = formatISOSafe(tb.startTime);
    const endISO = formatISOSafe(tb.endTime);
    const uniqueKey = tb.id || `${startISO}|${endISO}|${tb.taskId ?? ""}|${tb.status}`;

    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);

    let duration: number;
    if (mode === "actual" && tb.actualStartTime && tb.actualEndTime) {
      duration = computeDurationMinutes(tb.actualStartTime, tb.actualEndTime);
    } else {
      duration = computeDurationMinutes(tb.startTime, tb.endTime);
    }

    totalMinutes += duration;
  }

  return { totalMinutes, entriesCount: seen.size };
}

function aggregateTaskMinutes(args: {
  taskId: string;
  mode: Mode;
  timeBlocks: TimeBlock[];
  userId: string;
}): AggregationResult {
  const { taskId, mode, timeBlocks, userId } = args;

  const userTimeBlocks = timeBlocks.filter((tb) => !tb.userId || tb.userId === userId);
  const seen = new Set<string>();
  let totalMinutes = 0;

  for (const tb of userTimeBlocks) {
    if (!statusAllowed(mode, tb.status)) continue;
    if (tb.taskId !== taskId) continue;

    const startISO = formatISOSafe(tb.startTime);
    const endISO = formatISOSafe(tb.endTime);
    const uniqueKey = tb.id || `${startISO}|${endISO}|${tb.status}`;

    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);

    let duration: number;
    if (mode === "actual" && tb.actualStartTime && tb.actualEndTime) {
      duration = computeDurationMinutes(tb.actualStartTime, tb.actualEndTime);
    } else {
      duration = computeDurationMinutes(tb.startTime, tb.endTime);
    }

    totalMinutes += duration;
  }

  return { totalMinutes, entriesCount: seen.size };
}

// ============================================================================
// HOOKS - Metrics calculation
// ============================================================================

function useGoalMetrics(goal: Goal) {
  const { timeBlocks, projects, keyResults, currentUserId } = useOKRContext();

  return useMemo(() => {
    if (!currentUserId) {
      return { 
        plannedHours: 0, 
        actualHours: 0, 
        targetHours: 0, 
        weeklyHoursTarget: 0,
        progress: 0, 
        krProgress: null,
        variance: 0,
        efficiency: 0
      };
    }

    const plannedResult = aggregateGoalMinutes({
      goalId: goal.id,
      mode: "planned",
      timeBlocks,
      projects,
      userId: currentUserId,
    });

    const actualResult = aggregateGoalMinutes({
      goalId: goal.id,
      mode: "actual",
      timeBlocks,
      projects,
      userId: currentUserId,
    });

    const plannedHours = plannedResult.totalMinutes / 60;
    const actualHours = actualResult.totalMinutes / 60;

    // ✅ FIX: Use correct field name
    const weeklyHoursTarget = goal.timeAllocationTarget ?? 0;

    // ✅ FIX: Use nullish coalescing consistently
    let targetHours = 0;
    if ((goal.targetHours ?? 0) > 0) {
      targetHours = goal.targetHours ?? 0;
    } else if ((goal.timeAllocationTarget ?? 0) > 0) {
      targetHours = goal.timeAllocationTarget ?? 0;
    } else {
      const goalProjects = projects.filter((p) => !p.deleted && p.goalId === goal.id && p.userId === currentUserId);
      targetHours = goalProjects.reduce((sum, p) => sum + (p.totalHoursTarget ?? 0), 0);
    }

    const hoursProgress = targetHours > 0 ? clamp((actualHours / targetHours) * 100, 0, 100) : 0;

    // ✅ FIX: KeyResult progress without startValue
    const goalKRs = keyResults.filter((kr) => !kr.deleted && kr.goalId === goal.id && (kr.targetValue ?? 0) > 0);
    let krProgress: number | null = null;

    if (goalKRs.length > 0) {
      const avgKR = goalKRs.reduce((sum, kr) => {
        const current = kr.currentValue ?? 0;
        const target = kr.targetValue ?? 0;
        const pct = target > 0 ? (current / target) * 100 : 0;
        return sum + clamp(pct, 0, 100);
      }, 0) / goalKRs.length;

      krProgress = Math.round(avgKR);
    }

    // 🎯 CHRISTMAS FIX: Prioritize ACTUAL HOURS over Key Results for life tracking
    // This is a goal-centric time tracking app - hours are the primary metric!
    // 🔧 SHERLOCK FIX: Preserve small percentages (0.1% shouldn't become 0%)
    const progress = targetHours > 0 && actualHours > 0 ? Math.round(hoursProgress * 10) / 10 : (krProgress !== null ? krProgress : 0);
    const variance = actualHours - targetHours;
    const efficiency = plannedHours > 0 ? (actualHours / plannedHours) * 100 : 0;

    return { 
      plannedHours, 
      actualHours, 
      targetHours, 
      weeklyHoursTarget, 
      progress, 
      krProgress,
      variance,
      efficiency: Math.round(efficiency)
    };
  }, [goal, timeBlocks, projects, keyResults, currentUserId]);
}

function useProjectMetrics(project: Project) {
  const { timeBlocks, tasks, currentUserId } = useOKRContext();

  return useMemo(() => {
    if (!currentUserId) {
      return { plannedHours: 0, actualHours: 0, completedTasks: 0, totalTasks: 0, progress: 0 };
    }

    // 🔍 DETECTIVE DEBUG - Critical Progress Bug Investigation
    if (process.env.NODE_ENV !== 'production') {
      console.log('[useProjectMetrics] DETECTIVE DEBUG:', {
        projectId: project.id,
        projectName: project.name,
        totalTimeBlocks: timeBlocks.length,
        timeBlocksForProject: timeBlocks.filter(tb => tb.projectId === project.id),
        completedTimeBlocks: timeBlocks.filter(tb => tb.projectId === project.id && tb.status === 'completed'),
        currentUserId
      });
    }

    const plannedResult = aggregateProjectMinutes({
      projectId: project.id,
      mode: "planned",
      timeBlocks,
      userId: currentUserId,
    });

    const actualResult = aggregateProjectMinutes({
      projectId: project.id,
      mode: "actual",
      timeBlocks,
      userId: currentUserId,
    });

    const projectTasks = tasks.filter(
      (t) => !t.deleted && t.projectId === project.id && t.userId === currentUserId
    );
    const completedTasks = projectTasks.filter((t) => t.status === "completed").length;
    const totalTasks = projectTasks.length;

    // 🔧 SHERLOCK FIX: Always prioritize HOURS over tasks for progress calculation
    // This aligns with the GOAL-CENTRIC time tracking philosophy!
    let progress = 0;
    const actualHours = actualResult.totalMinutes / 60;
    const targetHours = project.totalHoursTarget ?? 0;
    
    if (targetHours > 0 && actualHours > 0) {
      // Primary: Hours-based progress (like goals)
      progress = (actualHours / targetHours) * 100;
    } else if (totalTasks > 0) {
      // Fallback: Task completion percentage
      progress = (completedTasks / totalTasks) * 100;
    }

    return {
      plannedHours: plannedResult.totalMinutes / 60,
      actualHours,
      completedTasks,
      totalTasks,
      progress: Math.round(progress * 10) / 10, // 🔧 Preserve decimal precision
    };
  }, [project, timeBlocks, tasks, currentUserId]);
}

function useTaskMetrics(task: Task) {
  const { timeBlocks, currentUserId } = useOKRContext();

  return useMemo(() => {
    if (!currentUserId) {
      return { plannedMinutes: 0, actualMinutes: 0, progress: 0, isOvertime: false };
    }

    const plannedResult = aggregateTaskMinutes({
      taskId: task.id,
      mode: "planned",
      timeBlocks,
      userId: currentUserId,
    });

    const actualResult = aggregateTaskMinutes({
      taskId: task.id,
      mode: "actual",
      timeBlocks,
      userId: currentUserId,
    });

    const estimated = task.estimatedMinutes ?? 0;
    let progress = 0;

    if (task.status === "completed") {
      progress = 100;
    } else if (estimated > 0) {
      progress = clamp((actualResult.totalMinutes / estimated) * 100, 0, 99);
    } else if (plannedResult.totalMinutes > 0) {
      progress = clamp((actualResult.totalMinutes / plannedResult.totalMinutes) * 100, 0, 99);
    }

    const isOvertime = estimated > 0 && actualResult.totalMinutes > estimated;

    return {
      plannedMinutes: plannedResult.totalMinutes,
      actualMinutes: actualResult.totalMinutes,
      progress: Math.round(progress),
      isOvertime,
    };
  }, [task, timeBlocks, currentUserId]);
}

// ============================================================================
// UI COMPONENTS
// ============================================================================

const STATUS_CONFIG: Record<string, { label: string; className: string; icon?: ReactNode }> = {
  active: { label: "Active", className: "bg-blue-50 text-blue-700 border-blue-200" },
  completed: { label: "Completed", className: "bg-green-50 text-green-700 border-green-200", icon: <CheckCircle className="w-3 h-3" /> },
  paused: { label: "Paused", className: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  at_risk: { label: "At Risk", className: "bg-red-50 text-red-700 border-red-200", icon: <AlertTriangle className="w-3 h-3" /> },
  archived: { label: "Archived", className: "bg-gray-50 text-gray-500 border-gray-200" },
  pending: { label: "Pending", className: "bg-gray-50 text-gray-600 border-gray-200" },
  in_progress: { label: "In Progress", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  blocked: { label: "Blocked", className: "bg-red-50 text-red-700 border-red-200" },
};

const PRIORITY_CONFIG: Record<Priority, { label: string; className: string }> = {
  critical: { label: "Critical", className: "bg-red-100 text-red-800 border-red-300" },
  high: { label: "High", className: "bg-orange-50 text-orange-700 border-orange-200" },
  medium: { label: "Medium", className: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  low: { label: "Low", className: "bg-green-50 text-green-700 border-green-200" },
};

function StatusBadge({ status }: { status?: string }) {
  const config = status ? STATUS_CONFIG[status] : null;
  if (!config) return <span className="text-xs text-gray-400">—</span>;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${config.className}`}>
      {config.icon}
      {config.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority?: Priority }) {
  const config = priority ? PRIORITY_CONFIG[priority] : null;
  if (!config) return null;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${config.className}`}>
      <Flag className="w-3 h-3" />
      {config.label}
    </span>
  );
}

function ProgressBar({ progress, size = "md", color = "blue" }: { progress: number; size?: "sm" | "md"; color?: "blue" | "green" | "indigo" }) {
  const heightClass = size === "sm" ? "h-1.5" : "h-2";
  const colorClass = {
    blue: "bg-blue-500",
    green: "bg-green-500",
    indigo: "bg-indigo-500",
  }[color];

  return (
    <div className={`w-full bg-gray-200 rounded-full ${heightClass} overflow-hidden`}>
      <div
        className={`${colorClass} ${heightClass} rounded-full transition-all duration-500`}
        style={{ width: `${clamp(progress, 0, 100)}%` }}
      />
    </div>
  );
}

function MetricRow({ icon, label, value, subValue }: { icon: ReactNode; label: string; value: string; subValue?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-1.5 text-gray-600">
        {icon}
        {label}
      </span>
      <span className="font-medium text-gray-900">
        {value}
        {subValue && <span className="text-gray-400 ml-1">{subValue}</span>}
      </span>
    </div>
  );
}

function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3 text-gray-400">
        {icon}
      </div>
      <h4 className="text-sm font-medium text-gray-900 mb-1">{title}</h4>
      <p className="text-xs text-gray-500 mb-3">{description}</p>
      {action}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 animate-pulse">
      <div className="h-5 bg-gray-200 rounded w-3/4 mb-3" />
      <div className="h-3 bg-gray-100 rounded w-1/2 mb-4" />
      <div className="flex gap-2 mb-4">
        <div className="h-6 bg-gray-100 rounded-full w-16" />
        <div className="h-6 bg-gray-100 rounded w-14" />
      </div>
      <div className="h-2 bg-gray-200 rounded-full" />
    </div>
  );
}

// ============================================================================
// MAIN CARDS
// ============================================================================

interface GoalCardProps {
  goal: Goal;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate?: (id: string, updates: Partial<Goal>) => void;
  onDelete?: () => void;
  onShowNotes?: (goalId: string) => void;
  onShowRoadmap?: (goalId: string) => void;
  onShowVisionBoard?: (goalId: string) => void;
}

function GoalCard({ goal, isSelected, onSelect, onUpdate, onDelete, onShowNotes, onShowRoadmap, onShowVisionBoard }: GoalCardProps) {
  const metrics = useGoalMetrics(goal);

  return (
    <div
      className={`
        bg-white border-2 rounded-xl p-5 cursor-pointer transition-all duration-200
        ${isSelected ? "border-blue-500 shadow-lg ring-2 ring-blue-100" : "border-gray-200 hover:border-gray-300 hover:shadow-md"}
      `}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      aria-pressed={isSelected}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          {onUpdate ? (
            <EditableText
              value={goal.title}
              onSave={(newTitle) => onUpdate(goal.id, { title: newTitle })}
              variant="title"
              placeholder="Goal title..."
              maxLength={200}
            />
          ) : (
            <h3 className="text-lg font-semibold text-gray-900 truncate">{goal.title}</h3>
          )}
          {goal.description && (
            <p className="text-sm text-gray-500 mt-1 line-clamp-2">{goal.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onShowNotes && (
            <button
              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onShowNotes(goal.id);
              }}
              aria-label="Goal Notes"
              title="Notes"
            >
              <FileText className="w-4 h-4" />
            </button>
          )}
          
          {onShowRoadmap && (
            <button
              className="p-1.5 rounded-lg text-gray-400 hover:text-green-500 hover:bg-green-50 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onShowRoadmap(goal.id);
              }}
              aria-label="Goal Roadmap"
              title="Roadmap"
            >
              <Map className="w-4 h-4" />
            </button>
          )}

          {onShowVisionBoard && (
            <button
              className="p-1.5 rounded-lg text-gray-400 hover:text-purple-500 hover:bg-purple-50 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onShowVisionBoard(goal.id);
              }}
              aria-label="Goal Vision Board"
              title="Vision Board"
            >
              <Sparkles className="w-4 h-4" />
            </button>
          )}
          
          {onDelete && (
            <button
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label="Delete goal"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <StatusBadge status={goal.status} />
        <PriorityBadge priority={goal.priority} />
        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
          <Calendar className="w-3 h-3" />
          {formatDateSafe(goal.targetDate)}
        </span>
      </div>

      <div className="space-y-2 mb-4">
        {metrics.weeklyHoursTarget > 0 && (
          <MetricRow
            icon={<Calendar className="w-3.5 h-3.5" />}
            label="Weekly Target"
            value={`${formatHours(metrics.weeklyHoursTarget)}h`}
          />
        )}
        <MetricRow
          icon={<Target className="w-3.5 h-3.5" />}
          label="Total Target"
          value={metrics.targetHours > 0 ? `${formatHours(metrics.targetHours)}h` : "—"}
        />
        <MetricRow
          icon={<Clock className="w-3.5 h-3.5" />}
          label="Planned"
          value={`${formatHours(metrics.plannedHours)}h`}
        />
        <MetricRow
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          label="Actual"
          value={`${formatHours(metrics.actualHours)}h`}
          subValue={metrics.targetHours > 0 ? `/ ${formatHours(metrics.targetHours)}h` : undefined}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-lg font-bold text-blue-600">{metrics.progress}%</span>
          {metrics.krProgress !== null && (
            <span className="text-xs text-gray-500">Based on Key Results</span>
          )}
        </div>
        <ProgressBar progress={metrics.progress} />
      </div>

      {isSelected && (
        <div className="mt-3 pt-3 border-t border-blue-100 flex items-center gap-1 text-xs text-blue-600">
          <ChevronRight className="w-3 h-3" />
          <span>Viewing details below</span>
        </div>
      )}
    </div>
  );
}

interface KeyResultCardProps {
  keyResult: KeyResult;
  onEdit: () => void;
  onDelete?: () => void;
}

function KeyResultCard({ keyResult, onEdit, onDelete }: KeyResultCardProps) {
  // ✅ FIX: No startValue - direct percentage calculation
  const current = keyResult.currentValue ?? 0;
  const target = keyResult.targetValue ?? 0;
  const progress = target > 0 ? clamp((current / target) * 100, 0, 100) : 0;

  return (
    <div
      className="bg-gray-50 border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-all cursor-pointer group"
      onClick={onEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onEdit()}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-gray-900 truncate">{keyResult.title}</h4>
          {keyResult.description && (
            <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{keyResult.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-2">
          <StatusBadge status={keyResult.status} />
          {onDelete && (
            <button
              className="p-1 rounded text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label="Delete key result"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-mono text-gray-600">
          <span className="font-bold text-blue-600">{current}</span>
          <span className="text-gray-400"> / {target}</span>
          {keyResult.unit && <span className="ml-1 text-gray-400">{keyResult.unit}</span>}
        </span>
        <span className="text-lg font-bold text-blue-600">{Math.round(progress)}%</span>
      </div>

      <ProgressBar progress={progress} size="sm" />

      <div className="mt-2 flex items-center gap-1 text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
        <Edit3 className="w-3 h-3" />
        <span>Click to edit</span>
      </div>
    </div>
  );
}

interface ProjectCardProps {
  project: Project;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate?: (id: string, updates: Partial<Project>) => void;
  onDelete?: () => void;
}

function ProjectCard({ project, isSelected, onSelect, onUpdate, onDelete }: ProjectCardProps) {
  const metrics = useProjectMetrics(project);

  // EXTREME DEBUG: Log what we're rendering
  if (process.env.NEXT_PUBLIC_DEBUG_TIMEBLOCK === '1') {
    console.log('[OKRManager] Rendering ProjectCard:', {
      projectId: project.id,
      projectName: project.name,
      goalId: project.goalId,
      fullProject: project
    });
  }

  return (
    <div
      className={`
        bg-white border rounded-lg p-4 cursor-pointer transition-all
        ${isSelected ? "border-indigo-500 shadow-md ring-2 ring-indigo-100" : "border-gray-200 hover:border-gray-300"}
      `}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
    >
      <div className="flex items-start justify-between mb-2">
        {onUpdate ? (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-xs text-gray-400 font-mono">[PROJECT]</span>
            <EditableText
              value={project.name}
              onSave={(newName) => onUpdate(project.id, { name: newName })}
              variant="subtitle"
              placeholder="Project name..."
              maxLength={150}
              className="flex-1"
            />
          </div>
        ) : (
          <h4 className="font-medium text-gray-900 truncate flex-1">
            [PROJECT] {project.name}
          </h4>
        )}
        <div className="flex items-center gap-2 ml-2">
          <PriorityBadge priority={project.priority} />
          <StatusBadge status={project.status} />
          {onDelete && (
            <button
              className="p-1 rounded text-gray-400 hover:text-red-500 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label="Delete project"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {project.description && (
        <p className="text-sm text-gray-500 mb-3 line-clamp-2">{project.description}</p>
      )}

      <div className="flex items-center justify-between text-xs text-gray-600 mb-2">
        <span className="flex items-center gap-1">
          <ListTodo className="w-3.5 h-3.5" />
          {metrics.completedTasks} / {metrics.totalTasks} tasks
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          {formatHours(metrics.actualHours)}h
          {(project.totalHoursTarget ?? 0) > 0 && <span className="text-gray-400">/ {project.totalHoursTarget}h</span>}
        </span>
      </div>

      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-500">Progress</span>
        <span className="text-sm font-bold text-green-600">{metrics.progress}%</span>
      </div>
      <ProgressBar progress={metrics.progress} size="sm" color="green" />

      {isSelected && (
        <div className="mt-2 pt-2 border-t border-indigo-100 text-xs text-indigo-600">
          Tasks shown below
        </div>
      )}
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  onToggleComplete: () => void;
  onUpdate?: (id: string, updates: Partial<Task>) => void;
  onDelete?: () => void;
}

function TaskCard({ task, onToggleComplete, onUpdate, onDelete }: TaskCardProps) {
  const metrics = useTaskMetrics(task);
  const isCompleted = task.status === "completed";

  return (
    <div className={`bg-white border rounded-lg p-3 transition-all ${isCompleted ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <button
          className={`
            mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors
            ${isCompleted ? "bg-green-500 border-green-500 text-white" : "border-gray-300 hover:border-green-400"}
          `}
          onClick={(e) => {
            e.stopPropagation();
            onToggleComplete();
          }}
          aria-label={isCompleted ? "Mark as incomplete" : "Mark as complete"}
        >
          {isCompleted && <CheckCircle className="w-3 h-3" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            {onUpdate && !isCompleted ? (
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-xs text-gray-400 font-mono">[TASK]</span>
                <EditableText
                  value={task.title}
                  onSave={(newTitle) => onUpdate(task.id, { title: newTitle })}
                  variant="body"
                  placeholder="Task title..."
                  maxLength={150}
                  className="flex-1"
                />
              </div>
            ) : (
              <h5 className={`font-medium text-sm ${isCompleted ? "line-through text-gray-400" : "text-gray-900"}`}>
                [TASK] {task.title}
              </h5>
            )}
            {onDelete && (
              <button
                className="p-1 rounded text-gray-400 hover:text-red-500 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                aria-label="Delete task"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>

          {task.description && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{task.description}</p>
          )}

          <div className="flex items-center flex-wrap gap-2 mt-2">
            <PriorityBadge priority={task.priority} />
            <StatusBadge status={task.status} />
            {(task.estimatedMinutes ?? 0) > 0 && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {task.estimatedMinutes}min
              </span>
            )}
            {metrics.actualMinutes > 0 && (
              <span className={`text-xs flex items-center gap-1 ${metrics.isOvertime ? "text-red-600" : "text-indigo-600"}`}>
                <TrendingUp className="w-3 h-3" />
                {metrics.actualMinutes}min
                {metrics.isOvertime && " ⚠️"}
              </span>
            )}
          </div>

          {task.ifThenPlan && (
            <div className="mt-2 p-2 bg-blue-50 rounded text-xs text-blue-700">
              <strong>If-Then:</strong> {task.ifThenPlan}
            </div>
          )}

          {!isCompleted && metrics.progress > 0 && (
            <div className="mt-2">
              <ProgressBar progress={metrics.progress} size="sm" color="indigo" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MODALS
// ============================================================================

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}

function Modal({ isOpen, onClose, title, children, actions }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleEsc);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen || typeof window === "undefined") return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === overlayRef.current && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 id="modal-title" className="text-xl font-bold text-gray-900">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>

        {actions && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
            {actions}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function FormInput({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required,
  autoFocus,
  min,
  step,
}: {
  label: string;
  type?: "text" | "number" | "date" | "textarea";
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  min?: number;
  step?: number;
}) {
  const baseClass = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all";

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${baseClass} resize-none`}
          rows={3}
          autoFocus={autoFocus}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={baseClass}
          autoFocus={autoFocus}
          min={min}
          step={step}
        />
      )}
    </div>
  );
}

function FormSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ============================================================================
// CREATE MODAL
// ============================================================================

interface CreateModalContentProps {
  type: CreateModalType;
  selectedGoalId: string | null;
  selectedProjectId: string | null;
  currentUserId: string;
  onClose: () => void;
  onCreateGoal: OKRManagerProps["onCreateGoal"];
  onCreateKeyResult: OKRManagerProps["onCreateKeyResult"];
  onCreateProject: OKRManagerProps["onCreateProject"];
  onCreateTask: OKRManagerProps["onCreateTask"];
  onAutoSelect: (type: "goal" | "project", id: string) => void;
}

function CreateModalContent({
  type,
  selectedGoalId,
  selectedProjectId,
  currentUserId,
  onClose,
  onCreateGoal,
  onCreateKeyResult,
  onCreateProject,
  onCreateTask,
  onAutoSelect,
}: CreateModalContentProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, string | number>>({
    priority: "medium",
    status: "active",
  });

  const updateField = (key: string, value: string | number) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const modalTitles: Record<NonNullable<CreateModalType>, string> = {
    goal: "Create New Goal",
    keyResult: "Create Key Result",
    project: "Create Project",
    task: "Create Task",
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;

    const title = (formData.title || formData.name || "").toString().trim();
    if (!title) {
      alert("Title is required");
      return;
    }

    if (type === "project" && !selectedGoalId) {
      alert("Please select a goal first");
      return;
    }

    if (type === "task" && !selectedProjectId) {
      alert("Please select a project first");
      return;
    }

    if (type === "keyResult" && !selectedGoalId) {
      alert("Please select a goal first");
      return;
    }

    setIsSubmitting(true);

    try {
      const now = new Date();
      const baseData = {
        userId: currentUserId,
        domainId: "default",
        createdAt: now,
        updatedAt: now,
      };

      let newId: string | void;

      switch (type) {
        case "goal":
          newId = await onCreateGoal({
            id: generateId("goal"),
            ...baseData,
            title,
            description: formData.description?.toString() || "",
            status: (formData.status as GoalStatus) || "active",
            priority: (formData.priority as Priority) || "medium",
            targetDate: formData.targetDate ? new Date(formData.targetDate.toString()) : undefined,
            targetHours: Number(formData.targetHours) || 0,
            timeAllocationTarget: Number(formData.timeAllocationTarget) || 0, // ✅ FIX: Correct field name
          });
          if (newId) onAutoSelect("goal", newId);
          break;

        case "keyResult":
          // ✅ FIX: No startValue in creation
          await onCreateKeyResult({
            id: generateId("kr"),
            ...baseData,
            goalId: selectedGoalId!,
            title,
            description: formData.description?.toString() || "",
            currentValue: Number(formData.currentValue) || 0,
            targetValue: Number(formData.targetValue) || 100,
            unit: formData.unit?.toString() || "",
            status: "active",
          });
          break;

        case "project":
          newId = await onCreateProject({
            id: generateId("project"),
            ...baseData,
            goalId: selectedGoalId!,
            name: title,
            description: formData.description?.toString() || "",
            status: "active",
            priority: (formData.priority as Priority) || "medium",
            totalHoursTarget: Number(formData.totalHoursTarget) || 0,
          });
          if (newId) onAutoSelect("project", newId);
          break;

        case "task":
          await onCreateTask({
            id: generateId("task"),
            ...baseData,
            goalId: selectedGoalId || undefined,
            projectId: selectedProjectId!,
            title,
            description: formData.description?.toString() || "",
            status: "pending",
            priority: (formData.priority as Priority) || "medium",
            estimatedMinutes: Number(formData.estimatedMinutes) || 60,
            ifThenPlan: formData.ifThenPlan?.toString() || "",
          });
          break;
      }

      onClose();
    } catch (error) {
      console.error("Failed to create item:", error);
      alert("Failed to create. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!type) return null;

  return (
    <Modal
      isOpen={!!type}
      onClose={onClose}
      title={modalTitles[type]}
      actions={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 font-medium transition-colors"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Create
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormInput
          label={type === "project" ? "Project Name" : type === "keyResult" ? "Key Result" : "Title"}
          value={type === "project" ? (formData.name || "") : (formData.title || "")}
          onChange={(v) => updateField(type === "project" ? "name" : "title", v)}
          placeholder={`Enter ${type} ${type === "project" ? "name" : "title"}...`}
          required
          autoFocus
        />

        <FormInput
          label="Description"
          type="textarea"
          value={formData.description || ""}
          onChange={(v) => updateField("description", v)}
          placeholder="Optional description..."
        />

        {type === "goal" && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <FormInput
                label="Weekly Hours Target"
                type="number"
                value={formData.timeAllocationTarget || ""}
                onChange={(v) => updateField("timeAllocationTarget", v)}
                placeholder="e.g., 10"
                min={0}
              />
              <FormInput
                label="Total Hours Target"
                type="number"
                value={formData.targetHours || ""}
                onChange={(v) => updateField("targetHours", v)}
                placeholder="e.g., 100"
                min={0}
              />
            </div>
            <FormInput
              label="Target Date"
              type="date"
              value={formData.targetDate?.toString() || ""}
              onChange={(v) => updateField("targetDate", v)}
            />
          </>
        )}

        {type === "keyResult" && (
          <div className="grid grid-cols-2 gap-4">
            <FormInput
              label="Current Value"
              type="number"
              value={formData.currentValue || 0}
              onChange={(v) => updateField("currentValue", v)}
              min={0}
              autoFocus
            />
            <FormInput
              label="Target Value"
              type="number"
              value={formData.targetValue || 100}
              onChange={(v) => updateField("targetValue", v)}
              min={0}
            />
          </div>
        )}

        {type === "keyResult" && (
          <FormInput
            label="Unit"
            value={formData.unit || ""}
            onChange={(v) => updateField("unit", v)}
            placeholder="e.g., hours, users, %"
          />
        )}

        {type === "project" && (
          <FormInput
            label="Total Hours Target"
            type="number"
            value={formData.totalHoursTarget || ""}
            onChange={(v) => updateField("totalHoursTarget", v)}
            placeholder="e.g., 20"
            min={0}
          />
        )}

        {type === "task" && (
          <>
            <FormInput
              label="Estimated Minutes"
              type="number"
              value={formData.estimatedMinutes || 60}
              onChange={(v) => updateField("estimatedMinutes", v)}
              min={0}
              step={15}
            />
            <FormInput
              label="If-Then Plan"
              value={formData.ifThenPlan || ""}
              onChange={(v) => updateField("ifThenPlan", v)}
              placeholder="If [trigger], then I will [action]..."
            />
          </>
        )}

        {(type === "goal" || type === "project" || type === "task") && (
          <FormSelect
            label="Priority"
            value={(formData.priority as string) || "medium"}
            onChange={(v) => updateField("priority", v)}
            options={[
              { value: "critical", label: "🔴 Critical" },
              { value: "high", label: "🟠 High" },
              { value: "medium", label: "🟡 Medium" },
              { value: "low", label: "🟢 Low" },
            ]}
          />
        )}

        {type === "project" && !selectedGoalId && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <span className="text-sm text-amber-800">
              Select a goal first to create a project under it.
            </span>
          </div>
        )}

        {type === "task" && !selectedProjectId && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <span className="text-sm text-amber-800">
              Select a project first to create a task under it.
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ============================================================================
// KEY RESULT EDIT MODAL
// ============================================================================

interface KeyResultEditModalProps {
  keyResult: KeyResult | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, updates: Partial<KeyResult>) => void;
}

function KeyResultEditModal({ keyResult, isOpen, onClose, onSave }: KeyResultEditModalProps) {
  const [formData, setFormData] = useState({
    currentValue: 0,
    targetValue: 0,
    title: "",
    description: "",
    unit: "",
  });

  useEffect(() => {
    if (keyResult) {
      setFormData({
        currentValue: keyResult.currentValue ?? 0,
        targetValue: keyResult.targetValue ?? 0,
        title: keyResult.title || "",
        description: keyResult.description || "",
        unit: keyResult.unit || "",
      });
    }
  }, [keyResult]);

  const handleSave = () => {
    if (!keyResult) return;

    // ✅ FIX: Progress calculation without startValue
    const current = formData.currentValue;
    const target = formData.targetValue;
    const progress = target > 0 ? clamp((current / target) * 100, 0, 100) : 0;

    let status: GoalStatus = "active";
    if (progress >= 100) status = "completed";
    else if (progress < 30) status = "at_risk";

    onSave(keyResult.id, {
      ...formData,
      progress: Math.round(progress),
      status,
      updatedAt: new Date(),
    } as Partial<KeyResult>);

    onClose();
  };

  if (!keyResult) return null;

  const previewProgress = formData.targetValue > 0 
    ? clamp((formData.currentValue / formData.targetValue) * 100, 0, 100) 
    : 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Update Key Result"
      actions={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Update
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormInput
          label="Title"
          value={formData.title}
          onChange={(v) => setFormData((f) => ({ ...f, title: v }))}
        />

        <FormInput
          label="Description"
          type="textarea"
          value={formData.description}
          onChange={(v) => setFormData((f) => ({ ...f, description: v }))}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormInput
            label="Current Value"
            type="number"
            value={formData.currentValue}
            onChange={(v) => setFormData((f) => ({ ...f, currentValue: Number(v) || 0 }))}
            autoFocus
          />
          <FormInput
            label="Target Value"
            type="number"
            value={formData.targetValue}
            onChange={(v) => setFormData((f) => ({ ...f, targetValue: Number(v) || 0 }))}
          />
        </div>

        <FormInput
          label="Unit"
          value={formData.unit}
          onChange={(v) => setFormData((f) => ({ ...f, unit: v }))}
          placeholder="e.g., hours, users, %"
        />

        <div className="p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Preview Progress</span>
            <span className="text-xl font-bold text-blue-600">
              {Math.round(previewProgress)}%
            </span>
          </div>
          <ProgressBar progress={previewProgress} />
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function OKRManager(props: OKRManagerProps) {
  const {
    goals,
    keyResults,
    projects,
    tasks,
    timeBlocks = [],
    currentUserId,
    isLoading = false,
    onCreateGoal,
    onUpdateGoal,
    onDeleteGoal,
    onCreateKeyResult,
    onUpdateKeyResult,
    onDeleteKeyResult,
    onCreateProject,
    onUpdateProject,
    onDeleteProject,
    onCreateTask,
    onUpdateTask,
    onDeleteTask,
  } = props;

  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState<CreateModalType>(null);
  const [editingKeyResult, setEditingKeyResult] = useState<KeyResult | null>(null);
  
  // Notes & Roadmap state
  const [activeTab, setActiveTab] = useState<'notes' | 'roadmap' | 'vision-board'>('notes');
  const [showNotesSection, setShowNotesSection] = useState(false);
  const [showRoadmapSection, setShowRoadmapSection] = useState(false);
  const [showVisionBoardSection, setShowVisionBoardSection] = useState(false);
  
  // Access to data context for notes and roadmaps
  const {
    notes,
    noteTemplates,
    goalRoadmaps,
    createNote,
    updateNote,
    deleteNote,
    getNotesForEntity,
    getOrCreateRoadmapForGoal
  } = useDataContext();

  // --------------------------------------------------------------------------
  // DATA VISIBILITY (multi-user isolation)
  // --------------------------------------------------------------------------

  const visibleGoals = useMemo(() => {
    if (!currentUserId) return [];
    return goals.filter((g) => !g.deleted && g.userId === currentUserId);
  }, [goals, currentUserId]);

  const visibleProjects = useMemo(() => {
    if (!currentUserId) return [];
    return projects.filter((p) => !p.deleted && p.userId === currentUserId);
  }, [projects, currentUserId]);

  const visibleTasks = useMemo(() => {
    if (!currentUserId) return [];
    return tasks.filter((t) => !t.deleted && t.userId === currentUserId);
  }, [tasks, currentUserId]);

  const visibleKeyResults = useMemo(() => {
    if (!currentUserId) return [];
    // nel tuo progetto alcuni KR legacy potrebbero non avere userId
    return keyResults.filter((kr) => !kr.deleted && (!kr.userId || kr.userId === currentUserId));
  }, [keyResults, currentUserId]);

  const visibleTimeBlocks = useMemo(() => {
    if (!currentUserId) return [];
    return timeBlocks.filter((tb) => !tb.userId || tb.userId === currentUserId);
  }, [timeBlocks, currentUserId]);

  // --------------------------------------------------------------------------
  // DERIVED SELECTIONS
  // --------------------------------------------------------------------------

  const selectedGoal = useMemo(
    () => visibleGoals.find((g) => g.id === selectedGoalId) || null,
    [visibleGoals, selectedGoalId]
  );

  const goalKeyResults = useMemo(
    () => (selectedGoalId ? visibleKeyResults.filter((kr) => kr.goalId === selectedGoalId) : []),
    [visibleKeyResults, selectedGoalId]
  );

  const goalProjects = useMemo(
    () => (selectedGoalId ? visibleProjects.filter((p) => p.goalId === selectedGoalId) : []),
    [visibleProjects, selectedGoalId]
  );

  const selectedProject = useMemo(
    () => visibleProjects.find((p) => p.id === selectedProjectId) || null,
    [visibleProjects, selectedProjectId]
  );

  const projectTasks = useMemo(
    () => (selectedProjectId ? visibleTasks.filter((t) => t.projectId === selectedProjectId) : []),
    [visibleTasks, selectedProjectId]
  );

  // --------------------------------------------------------------------------
  // ACTIONS
  // --------------------------------------------------------------------------

  const handleSelectGoal = useCallback((goalId: string) => {
    setSelectedGoalId((prev) => (prev === goalId ? null : goalId));
    setSelectedProjectId(null);
  }, []);

  const handleSelectProject = useCallback((projectId: string) => {
    setSelectedProjectId((prev) => (prev === projectId ? null : projectId));
  }, []);

  const handleAutoSelect = useCallback((type: "goal" | "project", id: string) => {
    if (type === "goal") {
      setSelectedGoalId(id);
      setSelectedProjectId(null);
    } else {
      setSelectedProjectId(id);
    }
  }, []);

  const handleDeleteGoal = useCallback(
    (goalId: string) => {
      const ok = confirm("Delete this goal? (Will archive goal, projects & tasks linked to it)");
      if (!ok) return;

      if (onDeleteGoal) onDeleteGoal(goalId);
      else onUpdateGoal(goalId, { deleted: true, updatedAt: new Date() });

      if (selectedGoalId === goalId) {
        setSelectedGoalId(null);
        setSelectedProjectId(null);
      }
    },
    [onDeleteGoal, onUpdateGoal, selectedGoalId]
  );

  const handleDeleteProject = useCallback(
    (projectId: string) => {
      const ok = confirm("Delete this project? (Will archive project & tasks linked to it)");
      if (!ok) return;

      if (onDeleteProject) onDeleteProject(projectId);
      else onUpdateProject(projectId, { deleted: true, updatedAt: new Date() });

      if (selectedProjectId === projectId) setSelectedProjectId(null);
    },
    [onDeleteProject, onUpdateProject, selectedProjectId]
  );

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      const ok = confirm("Delete this task?");
      if (!ok) return;

      if (onDeleteTask) onDeleteTask(taskId);
      else onUpdateTask(taskId, { deleted: true, updatedAt: new Date() });
    },
    [onDeleteTask, onUpdateTask]
  );

  const handleToggleTaskComplete = useCallback(
    (task: Task) => {
      const newStatus: TaskStatus = task.status === "completed" ? "pending" : "completed";
      onUpdateTask(task.id, { status: newStatus, updatedAt: new Date() });
    },
    [onUpdateTask]
  );

  const handleDeleteKeyResult = useCallback(
    (krId: string) => {
      const ok = confirm("Delete this key result?");
      if (!ok) return;

      if (onDeleteKeyResult) onDeleteKeyResult(krId);
      else onUpdateKeyResult(krId, { deleted: true, updatedAt: new Date() });
    },
    [onDeleteKeyResult, onUpdateKeyResult]
  );

  // --------------------------------------------------------------------------
  // CONTEXT VALUE
  // --------------------------------------------------------------------------

  const contextValue = useMemo<OKRContextValue>(
    () => ({
      currentUserId,
      selectedGoalId,
      selectedProjectId,
      setSelectedGoalId,
      setSelectedProjectId,
      timeBlocks: visibleTimeBlocks,
      projects: visibleProjects,
      tasks: visibleTasks,
      keyResults: visibleKeyResults,
    }),
    [
      currentUserId,
      selectedGoalId,
      selectedProjectId,
      visibleTimeBlocks,
      visibleProjects,
      visibleTasks,
      visibleKeyResults,
    ]
  );

  // --------------------------------------------------------------------------
  // GUARDS / LOADING
  // --------------------------------------------------------------------------

  if (!currentUserId) {
    return (
      <div className="flex items-center justify-center min-h-[400px] bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
        <div className="text-center px-6 py-8">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Authentication Required</h3>
          <p className="text-gray-600">Please sign in to view and manage your OKRs.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <div className="h-10 w-24 bg-gray-200 rounded animate-pulse" />
          <div className="h-10 w-24 bg-gray-100 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // RENDER
  // --------------------------------------------------------------------------

  return (
    <OKRContext.Provider value={contextValue}>
      <div className="space-y-6">
        {/* Top toolbar */}
        <div className="flex flex-wrap items-center gap-2 p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
          <button
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
            onClick={() => setShowCreateModal("goal")}
          >
            <Plus className="w-4 h-4" />
            New Goal
          </button>

          {selectedGoalId && (
            <>
              <div className="w-px h-6 bg-gray-200" />
              <button
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition-colors"
                onClick={() => setShowCreateModal("project")}
              >
                <FolderOpen className="w-4 h-4" />
                Add Project
              </button>

              <button
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition-colors"
                onClick={() => setShowCreateModal("keyResult")}
              >
                <Target className="w-4 h-4" />
                Add Key Result
              </button>
            </>
          )}

          {selectedProjectId && (
            <button
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition-colors"
              onClick={() => setShowCreateModal("task")}
            >
              <ListTodo className="w-4 h-4" />
              Add Task
            </button>
          )}

          {(selectedGoalId || selectedProjectId) && (
            <button
              className="ml-auto text-sm text-gray-500 hover:text-gray-700"
              onClick={() => {
                setSelectedGoalId(null);
                setSelectedProjectId(null);
              }}
            >
              Clear selection
            </button>
          )}
        </div>

        {/* Goals grid */}
        {visibleGoals.length === 0 ? (
          <EmptyState
            icon={<Target className="w-6 h-6" />}
            title="No Goals Yet"
            description="Create your first goal to get started with OKR tracking."
            action={
              <button
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                onClick={() => setShowCreateModal("goal")}
              >
                <Plus className="w-4 h-4" />
                Create Goal
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleGoals.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                isSelected={selectedGoalId === goal.id}
                onSelect={() => handleSelectGoal(goal.id)}
                onUpdate={onUpdateGoal}
                onDelete={() => handleDeleteGoal(goal.id)}
                onShowNotes={(goalId) => {
                  setSelectedGoalId(goalId);
                  setActiveTab('notes');
                  setShowNotesSection(true);
                  setShowRoadmapSection(false);
                  setShowVisionBoardSection(false);
                }}
                onShowRoadmap={(goalId) => {
                  setSelectedGoalId(goalId);
                  setActiveTab('roadmap');
                  setShowRoadmapSection(true);
                  setShowNotesSection(false);
                  setShowVisionBoardSection(false);
                }}
                onShowVisionBoard={(goalId) => {
                  console.log('🔍 SHERLOCK DEBUG: Vision Board clicked!', {
                    goalId,
                    currentUserId,
                    visibleGoalsLength: visibleGoals.length,
                    goalExists: visibleGoals.find(g => g.id === goalId),
                    beforeSelectedGoalId: selectedGoalId
                  });
                  setSelectedGoalId(goalId);
                  setActiveTab('vision-board');
                  setShowVisionBoardSection(true);
                  setShowNotesSection(false);
                  setShowRoadmapSection(false);
                  console.log('🔍 SHERLOCK DEBUG: State updated!', {
                    newSelectedGoalId: goalId,
                    activeTab: 'vision-board',
                    showVisionBoardSection: true
                  });
                }}
              />
            ))}
          </div>
        )}

        {/* Details panel (selected goal) */}
        {(() => {
          console.log('🔍 SHERLOCK DEBUG: Details panel render check', {
            selectedGoal: !!selectedGoal,
            selectedGoalId,
            selectedGoalTitle: selectedGoal?.title
          });
          return selectedGoal;
        })() && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Key Results */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Target className="w-5 h-5 text-blue-500" />
                  Key Results
                </h3>
                <button
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                  onClick={() => setShowCreateModal("keyResult")}
                >
                  + Add
                </button>
              </div>

              {goalKeyResults.length === 0 ? (
                <EmptyState
                  icon={<Target className="w-5 h-5" />}
                  title="No Key Results"
                  description="Add key results to measure progress toward this goal."
                />
              ) : (
                <div className="space-y-3">
                  {goalKeyResults.map((kr) => (
                    <KeyResultCard
                      key={kr.id}
                      keyResult={kr}
                      onEdit={() => setEditingKeyResult(kr)}
                      onDelete={() => handleDeleteKeyResult(kr.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Projects + Tasks */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-indigo-500" />
                  Projects
                </h3>
                <button
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                  onClick={() => setShowCreateModal("project")}
                >
                  + Add
                </button>
              </div>

              {goalProjects.length === 0 ? (
                <EmptyState
                  icon={<FolderOpen className="w-5 h-5" />}
                  title="No Projects"
                  description="Add projects to organize work toward this goal."
                />
              ) : (
                <div className="space-y-3">
                  {goalProjects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      isSelected={selectedProjectId === project.id}
                      onSelect={() => handleSelectProject(project.id)}
                      onUpdate={onUpdateProject}
                      onDelete={() => handleDeleteProject(project.id)}
                    />
                  ))}
                </div>
              )}

              {/* Tasks section */}
              {selectedProjectId && (
                <div className="mt-6 pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                      <ListTodo className="w-4 h-4 text-green-500" />
                      Tasks {selectedProject ? `— ${selectedProject.name}` : ""}
                    </h4>
                    <button
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                      onClick={() => setShowCreateModal("task")}
                    >
                      + Add
                    </button>
                  </div>

                  {projectTasks.length === 0 ? (
                    <EmptyState
                      icon={<ListTodo className="w-5 h-5" />}
                      title="No Tasks"
                      description="Add tasks to break down this project."
                    />
                  ) : (
                    <div className="space-y-2">
                      {projectTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onToggleComplete={() => handleToggleTaskComplete(task)}
                          onUpdate={onUpdateTask}
                          onDelete={() => handleDeleteTask(task.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Notes & Roadmap Section */}
        {(showNotesSection || showRoadmapSection || showVisionBoardSection) && selectedGoalId && (
          <div className="mt-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            {/* Header with tabs */}
            <div className="border-b border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Goal Details: {selectedGoal?.title}
                </h3>
                <button
                  onClick={() => {
                    setShowNotesSection(false);
                    setShowRoadmapSection(false);
                    setShowVisionBoardSection(false);
                  }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              
              {/* Tab Navigation */}
              <div className="flex items-center gap-1 mt-4">
                <button
                  onClick={() => {
                    setActiveTab('notes');
                    setShowNotesSection(true);
                    setShowRoadmapSection(false);
                    setShowVisionBoardSection(false);
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === 'notes'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                      : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                  }`}
                >
                  <FileText className="w-4 h-4 inline mr-2" />
                  Notes
                </button>
                <button
                  onClick={() => {
                    setActiveTab('roadmap');
                    setShowRoadmapSection(true);
                    setShowNotesSection(false);
                    setShowVisionBoardSection(false);
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === 'roadmap'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                      : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                  }`}
                >
                  <Map className="w-4 h-4 inline mr-2" />
                  Roadmap
                </button>
                <button
                  onClick={() => {
                    setActiveTab('vision-board');
                    setShowVisionBoardSection(true);
                    setShowNotesSection(false);
                    setShowRoadmapSection(false);
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === 'vision-board'
                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
                      : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                  }`}
                >
                  <Sparkles className="w-4 h-4 inline mr-2" />
                  Vision Board
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-4">
              {activeTab === 'notes' && showNotesSection && (
                <div className="space-y-4">
                  {/* Existing notes list */}
                  {getNotesForEntity('goal', selectedGoalId).length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Existing Notes</h4>
                      {getNotesForEntity('goal', selectedGoalId).map(note => (
                        <div key={note.id} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                          <div className="flex items-start justify-between">
                            <h5 className="font-medium text-gray-900 dark:text-white">{note.title}</h5>
                            <button
                              onClick={() => deleteNote(note.id)}
                              className="text-gray-400 hover:text-red-500 transition-colors"
                              title="Delete note"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            Created {new Date(note.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Rich Text Editor for new note */}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Create New Note</h4>
                    <RichNoteEditor
                      entityType="goal"
                      entityId={selectedGoalId}
                      currentUserId={currentUserId}
                      placeholder="Write your goal notes here..."
                      onSave={async (noteData) => {
                        await createNote(noteData);
                      }}
                      className="border border-gray-200 dark:border-gray-700 rounded-lg"
                    />
                  </div>
                </div>
              )}

              {activeTab === 'roadmap' && showRoadmapSection && selectedGoal && (
                <div>
                  {(() => {
                    const existingRoadmap = goalRoadmaps.find(r => r.goalId === selectedGoalId);
                    
                    if (existingRoadmap) {
                      return (
                        <GoalRoadmapView
                          goal={selectedGoal}
                          roadmap={existingRoadmap}
                          timeBlocks={timeBlocks}
                          projects={visibleProjects}
                          tasks={visibleTasks}
                          className="border border-gray-200 dark:border-gray-700 rounded-lg"
                        />
                      );
                    } else {
                      return (
                        <div className="text-center py-8">
                          <Map className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                          <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                            Create Your Goal Roadmap
                          </h4>
                          <p className="text-gray-600 dark:text-gray-400 mb-4">
                            Visualize your journey to achieving this goal with an interactive roadmap.
                          </p>
                          <button
                            onClick={async () => {
                              const roadmap = await getOrCreateRoadmapForGoal(selectedGoalId);
                              // Roadmap will now be available in the next render
                            }}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                          >
                            Generate Roadmap
                          </button>
                        </div>
                      );
                    }
                  })()}
                </div>
              )}

              {(() => {
                console.log('🔍 SHERLOCK DEBUG: Vision Board section render check', {
                  activeTab,
                  showVisionBoardSection,
                  selectedGoal: !!selectedGoal,
                  allConditionsMet: activeTab === 'vision-board' && showVisionBoardSection && selectedGoal
                });
                return activeTab === 'vision-board' && showVisionBoardSection && selectedGoal;
              })() && (
                <div className="space-y-4">
                  <LazyVisionBoardView
                    goalId={selectedGoal?.id}
                    userId={currentUserId || 'guest'}
                    domainId={selectedGoal?.domainId}
                    goals={goals}
                    projects={projects}
                    tasks={tasks}
                    onRitualMode={() => {
                      console.log('Opening Ritual Mode for goal:', selectedGoal?.title);
                    }}
                    onBack={() => {
                      setShowVisionBoardSection(false);
                      setActiveTab('notes');
                    }}
                    className="min-h-[600px]"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Create modal */}
        <CreateModalContent
          type={showCreateModal}
          selectedGoalId={selectedGoalId}
          selectedProjectId={selectedProjectId}
          currentUserId={currentUserId}
          onClose={() => setShowCreateModal(null)}
          onCreateGoal={onCreateGoal}
          onCreateKeyResult={onCreateKeyResult}
          onCreateProject={onCreateProject}
          onCreateTask={onCreateTask}
          onAutoSelect={handleAutoSelect}
        />

        {/* Edit KR modal */}
        <KeyResultEditModal
          keyResult={editingKeyResult}
          isOpen={!!editingKeyResult}
          onClose={() => setEditingKeyResult(null)}
          onSave={onUpdateKeyResult}
        />
      </div>
    </OKRContext.Provider>
  );
}
