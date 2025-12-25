'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react';
import { 
  TimeBlock, Goal, KeyResult, Project, Task, Habit, HabitLog, KPI 
} from '@/types';
import { db, sanitizeForStorage } from '@/lib/database';
import { toDateSafe } from '@/utils/dateUtils';

// ============================================================================
// DATA STATE MACHINE
// States: idle -> loading -> ready | error
// Transitions are deterministic and FINAL
// ============================================================================

type DataStatus = 'idle' | 'loading' | 'ready' | 'error';

// ============================================================================
// UTILITIES - Pure functions, no state
// ============================================================================

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

type TimeBlockStatus = TimeBlock["status"];

function normalizeTimeBlockStatus(input: unknown): TimeBlockStatus {
  const s = String(input ?? "").trim().toLowerCase();
  if (["completed", "complete", "done"].includes(s)) return "completed";
  if (["in_progress", "in-progress", "inprogress"].includes(s)) return "in_progress";
  if (["cancelled", "canceled", "cancel"].includes(s)) return "cancelled";
  if (["overrun"].includes(s)) return "overrun";
  return "planned";
}

// toDateSafe now imported from @/utils/dateUtils

function deserializeTimeBlock(block: any): TimeBlock {
  // Debug log behind feature flag
  if (process.env.NEXT_PUBLIC_DEBUG_TIMEBLOCK === '1') {
    console.log('[DataProvider] Deserializing timeBlock:', {
      id: block.id,
      rawStartTime: block.startTime,
      rawEndTime: block.endTime,
      startType: typeof block.startTime,
      endType: typeof block.endTime,
      hasToDate: block.startTime && typeof block.startTime.toDate === 'function',
      isStartDate: block.startTime instanceof Date,
      isEndDate: block.endTime instanceof Date,
      startTimeValid: block.startTime instanceof Date ? !isNaN(block.startTime.getTime()) : 'not-date',
      endTimeValid: block.endTime instanceof Date ? !isNaN(block.endTime.getTime()) : 'not-date'
    });
  }

  const startTime = toDateSafe(block.startTime);
  const endTime = toDateSafe(block.endTime);
  
  // EXTREME DEBUG: Log the parsed results
  if (process.env.NEXT_PUBLIC_DEBUG_TIMEBLOCK === '1') {
    console.log('[DataProvider] Deserialized timeBlock results:', {
      id: block.id,
      parsedStart: startTime.toISOString(),
      parsedEnd: endTime.toISOString(),
      startHour: startTime.getHours(),
      endHour: endTime.getHours(),
      isSameDay: startTime.toDateString() === endTime.toDateString()
    });
  }

  return {
    ...block,
    startTime,
    endTime,
    createdAt: toDateSafe(block.createdAt),
    updatedAt: toDateSafe(block.updatedAt),
    actualStartTime: block.actualStartTime ? toDateSafe(block.actualStartTime) : undefined,
    actualEndTime: block.actualEndTime ? toDateSafe(block.actualEndTime) : undefined,
    status: normalizeTimeBlockStatus(block.status),
  };
}

function deserializeGoal(goal: any): Goal {
  return {
    ...goal,
    domainId: goal.domainId ?? '',
    targetDate: toDateSafe(goal.targetDate),
    createdAt: toDateSafe(goal.createdAt) ?? new Date(),
    updatedAt: toDateSafe(goal.updatedAt) ?? new Date(),
  };
}

function deserializeProject(project: any): Project {
  return {
    ...project,
    dueDate: project.dueDate ? toDateSafe(project.dueDate) : undefined,
    createdAt: toDateSafe(project.createdAt),
    updatedAt: toDateSafe(project.updatedAt),
  };
}

function deserializeTask(task: any): Task {
  return {
    ...task,
    dueDate: task.dueDate ? toDateSafe(task.dueDate) : undefined,
    deadline: task.deadline ? toDateSafe(task.deadline) : undefined,
    completedAt: task.completedAt ? toDateSafe(task.completedAt) : undefined,
    createdAt: toDateSafe(task.createdAt),
    updatedAt: toDateSafe(task.updatedAt),
  };
}

function deserializeKeyResult(kr: any): KeyResult {
  return {
    ...kr,
    createdAt: toDateSafe(kr.createdAt),
    updatedAt: toDateSafe(kr.updatedAt),
  };
}

function deserializeHabit(habit: any): Habit {
  return {
    ...habit,
    createdAt: toDateSafe(habit.createdAt),
    updatedAt: toDateSafe(habit.updatedAt),
  };
}

function deserializeHabitLog(log: any): HabitLog {
  return {
    ...log,
    date: toDateSafe(log.date),
    createdAt: toDateSafe(log.createdAt),
  };
}

// ============================================================================
// CONTEXT TYPE
// ============================================================================

interface DataContextValue {
  // Status
  status: DataStatus;
  userId: string;
  
  // Data (already filtered by userId)
  timeBlocks: TimeBlock[];
  goals: Goal[];
  keyResults: KeyResult[];
  projects: Project[];
  tasks: Task[];
  habits: Habit[];
  habitLogs: HabitLog[];
  kpis: KPI;
  
  // CRUD handlers
  createTimeBlock: (data: Partial<TimeBlock>) => Promise<void>;
  updateTimeBlock: (id: string, updates: Partial<TimeBlock>) => Promise<void>;
  deleteTimeBlock: (id: string) => Promise<void>;
  
  createGoal: (data: Partial<Goal>) => Promise<string | undefined>;
  updateGoal: (id: string, updates: Partial<Goal>) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  
  createKeyResult: (data: Partial<KeyResult>) => Promise<string | undefined>;
  updateKeyResult: (id: string, updates: Partial<KeyResult>) => Promise<void>;
  deleteKeyResult: (id: string) => Promise<void>;
  
  createProject: (data: Partial<Project>) => Promise<string | undefined>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  
  createTask: (data: Partial<Task>) => Promise<string | undefined>;
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  
  createHabit: (data: Partial<Habit>) => Promise<void>;
  updateHabit: (id: string, updates: Partial<Habit>) => Promise<void>;
  deleteHabit: (id: string) => Promise<void>;
  logHabit: (habitId: string, completed: boolean, value?: number) => Promise<void>;
  
  // Utils
  loadTimeBlocksForDate: (date: Date) => Promise<void>;
  refreshKPIs: () => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function useDataContext() {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error('useDataContext must be used within DataProvider');
  }
  return ctx;
}

// ============================================================================
// PROVIDER
// ============================================================================

interface DataProviderProps {
  userId: string;
  children: ReactNode;
}

export function DataProvider({ userId, children }: DataProviderProps) {
  // State machine
  const [status, setStatus] = useState<DataStatus>('idle');
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null);
  
  // Data state
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [keyResults, setKeyResults] = useState<KeyResult[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLog[]>([]);
  const [kpis, setKpis] = useState<KPI>({
    focusMinutes: 0,
    planVsActual: 0,
    activeStreaks: 0,
    keyResultsProgress: 0,
  });

  // ========== DATA LOADING & REHYDRATION ========== 
  useEffect(() => {
    // Always reload when userId or adapter mode changes
    if (!userId) return;
    setStatus('loading');
    (async () => {
      await db.init();
      // Forza adapter: se userId valido, sempre Firebase
      if (userId && db.switchToFirebase) {
        try {
          const { ensureFirestorePersistence, firestore } = await import('@/lib/firebase');
          try { await ensureFirestorePersistence(firestore); } catch (e) { console.warn('[DataProvider] Persistence warning:', e); }
          await db.switchToFirebase(userId);
        } catch (e) {
          console.warn('[DataProvider] Firebase switch failed, using local:', e);
        }
      }
      // Carica tutto
      const [rawTimeBlocks, rawGoals, rawProjects, rawTasks, rawKeyResults, rawHabits, rawHabitLogs] = await Promise.all([
        db.getAll<TimeBlock>('timeBlocks').catch(() => []),
        db.getAll<Goal>('goals').catch(() => []),
        db.getAll<Project>('projects').catch(() => []),
        db.getAll<Task>('tasks').catch(() => []),
        db.getAll<KeyResult>('keyResults').catch(() => []),
        db.getAll<Habit>('habits').catch(() => []),
        db.getAll<HabitLog>('habitLogs').catch(() => []),
      ]);
      if (process.env.NODE_ENV !== 'production') {
        console.log('[DataProvider] [REHYDRATE] source:', db.getAdapterType(), { userId });
        console.log('[DataProvider] [REHYDRATE] counts:', {
          goals: rawGoals.length, projects: rawProjects.length, tasks: rawTasks.length, timeBlocks: rawTimeBlocks.length
        });
        console.log('[DataProvider] [REHYDRATE] rawTimeBlocks:', rawTimeBlocks);
        console.log('[DataProvider] [REHYDRATE] rawGoals:', rawGoals);
      }

      // Debug timeBlock rehydration behind feature flag
      if (process.env.NEXT_PUBLIC_DEBUG_TIMEBLOCK === '1' && rawTimeBlocks.length > 0) {
        console.log('[DataProvider] Rehydrating timeBlocks:', {
          count: rawTimeBlocks.length,
          samples: rawTimeBlocks.slice(0, 3).map(tb => ({
            id: tb.id,
            rawStart: tb.startTime,
            rawEnd: tb.endTime,
            startType: typeof tb.startTime,
            endType: typeof tb.endTime
          }))
        });
      }

      // Debug project rehydration behind feature flag
      if (process.env.NEXT_PUBLIC_DEBUG_TIMEBLOCK === '1' && rawProjects.length > 0) {
        console.log('[DataProvider] Rehydrating projects:', {
          count: rawProjects.length,
          projects: rawProjects.map(p => ({
            id: p.id,
            name: p.name,
            goalId: p.goalId,
            userId: p.userId
          }))
        });
      }
      setTimeBlocks(rawTimeBlocks.map(deserializeTimeBlock).filter(x => x.userId === userId));
      setGoals(rawGoals.map(deserializeGoal).filter(x => x.userId === userId && !x.deleted));
      setProjects(rawProjects.map(deserializeProject).filter(x => x.userId === userId && !x.deleted));
      setTasks(rawTasks.map(deserializeTask).filter(x => x.userId === userId && !x.deleted));
      setKeyResults(rawKeyResults.map(deserializeKeyResult).filter(x => x.userId === userId && !x.deleted));
      setHabits(rawHabits.map(deserializeHabit).filter(x => x.userId === userId && !x.deleted));
      setHabitLogs(rawHabitLogs.map(deserializeHabitLog).filter(x => x.userId === userId));
      try {
        const newKpis = await db.calculateTodayKPIs(userId);
        setKpis(newKpis);
      } catch (e) {
        console.warn('[DataProvider] KPI calculation failed:', e);
      }
      setLoadedForUser(userId);
      setStatus('ready');
      if (process.env.NODE_ENV !== 'production') {
        console.log('[DataProvider] [REHYDRATE] done for user:', userId);
      }
    })();
  }, [userId, db.getAdapterType()]);

  // ========== KPI Refresh (must be above TimeBlock CRUD for deps) ==========
  const refreshKPIs = useCallback(async () => {
    try {
      const newKpis = await db.calculateTodayKPIs(userId);
      setKpis(newKpis);
    } catch (error) {
      console.warn('[DataProvider] Refresh KPIs failed:', error);
    }
  }, [userId]);

  // ========== CRUD: TimeBlock ========== 
  const createTimeBlock = useCallback(async (data: Partial<TimeBlock>) => {
    // Use today as fallback reference if times can't be parsed
    const today = new Date();
    const startTime = data.startTime ? toDateSafe(data.startTime, today) : new Date();
    const endTime = data.endTime ? toDateSafe(data.endTime, today) : new Date(startTime.getTime() + 60 * 60 * 1000);
    const now = new Date();
    
    const block: TimeBlock = {
      ...data,
      id: generateId('timeblock'),
      userId,
      domainId: data.domainId || 'domain-1',
      startTime,
      endTime,
      status: normalizeTimeBlockStatus(data.status || 'planned'),
      createdAt: now,
      updatedAt: now,
    } as TimeBlock;

    // Debug log behind feature flag
    if (process.env.NEXT_PUBLIC_DEBUG_TIMEBLOCK === '1') {
      console.log('[DataProvider] Creating timeBlock:', {
        id: block.id,
        rawStart: data.startTime,
        rawEnd: data.endTime,
        parsedStart: startTime.toISOString(),
        parsedEnd: endTime.toISOString(),
        userId,
        adapter: db.getAdapterType()
      });
    }

    // 🔍 DETECTIVE DEBUG - Progress bug investigation
    if (process.env.NODE_ENV !== 'production') {
      console.log('[DataProvider] DETECTIVE: createTimeBlock with connections:', {
        blockId: block.id,
        title: block.title,
        projectId: block.projectId,
        goalId: block.goalId,
        taskId: block.taskId,
        status: block.status,
        hasProjectConnection: !!block.projectId,
        inputData: data
      });
    }

    // Optimistic
    setTimeBlocks(prev => [...prev, block]);

    try {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[DataProvider] [DEBUG] createTimeBlock: about to call db.create', {
          userId,
          adapter: db.getAdapterType(),
          block
        });
      }
      const saved = await db.create<TimeBlock>('timeBlocks', block);
      setTimeBlocks(prev => prev.map(b => b.id === block.id ? deserializeTimeBlock(saved) : b));
      await refreshKPIs();
      if (process.env.NODE_ENV !== 'production') {
        console.log('[DataProvider] [PROGRESS] createTimeBlock', {
          timeBlocksCount: (timeBlocks?.length || 0) + 1,
          goalId: block.goalId, projectId: block.projectId, taskId: block.taskId,
          saved
        });
      }
    } catch (error) {
      console.error('[DataProvider] Create timeblock failed:', error);
      setTimeBlocks(prev => prev.filter(b => b.id !== block.id));
    }
  }, [userId, refreshKPIs, timeBlocks]);

  const updateTimeBlock = useCallback(async (id: string, updates: Partial<TimeBlock>) => {
    const existing = timeBlocks.find(b => b.id === id);
    if (!existing) return;
    
    // EXTREME DEBUG: Log what we're updating
    if (process.env.NEXT_PUBLIC_DEBUG_TIMEBLOCK === '1') {
      console.log('[DataProvider] updateTimeBlock called:', {
        id,
        updates,
        existingStartTime: existing.startTime,
        existingEndTime: existing.endTime,
        existingStartType: typeof existing.startTime,
        existingEndType: typeof existing.endTime,
        updatesStartTime: updates.startTime,
        updatesEndTime: updates.endTime,
        updatesStartType: typeof updates.startTime,
        updatesEndType: typeof updates.endTime
      });
    }
    
    const updated: TimeBlock = {
      ...existing,
      ...updates,
      status: normalizeTimeBlockStatus(updates.status ?? existing.status),
      startTime: updates.startTime ? toDateSafe(updates.startTime, existing.startTime) : existing.startTime,
      endTime: updates.endTime ? toDateSafe(updates.endTime, existing.endTime) : existing.endTime,
      updatedAt: new Date(),
    };
    
    // EXTREME DEBUG: Log the result
    if (process.env.NEXT_PUBLIC_DEBUG_TIMEBLOCK === '1') {
      console.log('[DataProvider] updateTimeBlock result:', {
        id,
        updatedStartTime: updated.startTime,
        updatedEndTime: updated.endTime,
        updatedStartISO: updated.startTime.toISOString(),
        updatedEndISO: updated.endTime.toISOString()
      });
    }

    // 🔍 DETECTIVE DEBUG - Status change investigation  
    if (process.env.NODE_ENV !== 'production' && updates.status) {
      console.log('[DataProvider] DETECTIVE: TimeBlock status changed:', {
        blockId: id,
        title: updated.title,
        oldStatus: existing.status,
        newStatus: updated.status,
        projectId: updated.projectId,
        goalId: updated.goalId,
        taskId: updated.taskId,
        hasProjectConnection: !!updated.projectId
      });
    }
    
    setTimeBlocks(prev => prev.map(b => b.id === id ? updated : b));
    try {
      await db.update('timeBlocks', sanitizeForStorage(updated));
      await refreshKPIs();
      if (process.env.NODE_ENV !== 'production') {
        console.log('[DataProvider] [PROGRESS] updateTimeBlock', {
          id, goalId: updated.goalId, projectId: updated.projectId, taskId: updated.taskId
        });
      }
    } catch (error) {
      console.error('[DataProvider] Update timeblock failed:', error);
      setTimeBlocks(prev => prev.map(b => b.id === id ? existing : b));
    }
  }, [timeBlocks, refreshKPIs]);

  const deleteTimeBlock = useCallback(async (id: string) => {
    const existing = timeBlocks.find(b => b.id === id);
    if (!existing) return;
    
    setTimeBlocks(prev => prev.filter(b => b.id !== id));
    try {
      await db.delete('timeBlocks', id);
      await refreshKPIs();
      if (process.env.NODE_ENV !== 'production') {
        console.log('[DataProvider] [PROGRESS] deleteTimeBlock', { id });
      }
    } catch (error) {
      console.error('[DataProvider] Delete timeblock failed:', error);
      setTimeBlocks(prev => [...prev, existing]);
    }
  }, [timeBlocks, refreshKPIs]);

  // ========== CRUD: Goal ==========
  const createGoal = useCallback(async (data: Partial<Goal>): Promise<string | undefined> => {
    const now = new Date();
    const goal: Goal = {
      ...data,
      id: generateId('goal'),
      userId,
      status: data.status || 'active',
      priority: data.priority || 'medium',
      targetDate: data.targetDate ? toDateSafe(data.targetDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    } as Goal;

    setGoals(prev => [...prev, goal]);

    try {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[DataProvider] [DEBUG] createGoal: about to call db.create', {
          userId,
          adapter: db.getAdapterType(),
          goal
        });
      }
      const saved = await db.create<Goal>('goals', goal);
      setGoals(prev => prev.map(g => g.id === goal.id ? deserializeGoal(saved) : g));
      if (process.env.NODE_ENV !== 'production') {
        console.log('[DataProvider] [PROGRESS] createGoal', { goalId: goal.id, saved });
      }
      return saved.id;
    } catch (error) {
      console.error('[DataProvider] Create goal failed:', error);
      setGoals(prev => prev.filter(g => g.id !== goal.id));
      return undefined;
    }
  }, [userId]);

  const updateGoal = useCallback(async (id: string, updates: Partial<Goal>) => {
    const existing = goals.find(g => g.id === id);
    if (!existing) return;

    const updated = { ...existing, ...updates, updatedAt: new Date() };
    setGoals(prev => prev.map(g => g.id === id ? updated : g));

    try {
      await db.update('goals', updated);
    } catch (error) {
      console.error('[DataProvider] Update goal failed:', error);
      setGoals(prev => prev.map(g => g.id === id ? existing : g));
    }
  }, [goals]);

  const deleteGoal = useCallback(async (id: string) => {
    const existing = goals.find(g => g.id === id);
    if (!existing) return;

    setGoals(prev => prev.filter(g => g.id !== id));

    try {
      await db.update('goals', { ...existing, deleted: true, updatedAt: new Date() });
    } catch (error) {
      console.error('[DataProvider] Delete goal failed:', error);
      setGoals(prev => [...prev, existing]);
    }
  }, [goals]);

  // ========== CRUD: KeyResult ==========
  const createKeyResult = useCallback(async (data: Partial<KeyResult>): Promise<string | undefined> => {
    const now = new Date();
    const kr: KeyResult = {
      ...data,
      id: generateId('keyresult'),
      userId,
      goalId: data.goalId || '',
      currentValue: data.currentValue || 0,
      targetValue: data.targetValue || 100,
      progress: 0,
      status: data.status || 'active',
      createdAt: now,
      updatedAt: now,
    } as KeyResult;

    setKeyResults(prev => [...prev, kr]);

    try {
      const saved = await db.create<KeyResult>('keyResults', kr);
      setKeyResults(prev => prev.map(k => k.id === kr.id ? deserializeKeyResult(saved) : k));
      return saved.id;
    } catch (error) {
      console.error('[DataProvider] Create keyResult failed:', error);
      setKeyResults(prev => prev.filter(k => k.id !== kr.id));
      return undefined;
    }
  }, [userId]);

  const updateKeyResult = useCallback(async (id: string, updates: Partial<KeyResult>) => {
    const existing = keyResults.find(k => k.id === id);
    if (!existing) return;

    const updated = { ...existing, ...updates, updatedAt: new Date() };
    setKeyResults(prev => prev.map(k => k.id === id ? updated : k));

    try {
      await db.update('keyResults', updated);
    } catch (error) {
      console.error('[DataProvider] Update keyResult failed:', error);
      setKeyResults(prev => prev.map(k => k.id === id ? existing : k));
    }
  }, [keyResults]);

  const deleteKeyResult = useCallback(async (id: string) => {
    const existing = keyResults.find(k => k.id === id);
    if (!existing) return;

    setKeyResults(prev => prev.filter(k => k.id !== id));

    try {
      await db.update('keyResults', { ...existing, deleted: true, updatedAt: new Date() });
    } catch (error) {
      console.error('[DataProvider] Delete keyResult failed:', error);
      setKeyResults(prev => [...prev, existing]);
    }
  }, [keyResults]);

  // ========== CRUD: Project ==========
  const createProject = useCallback(async (data: Partial<Project>): Promise<string | undefined> => {
    const now = new Date();
    const project: Project = {
      ...data,
      id: generateId('project'),
      userId,
      goalId: data.goalId || '',
      status: data.status || 'active',
      priority: data.priority || 'medium',
      createdAt: now,
      updatedAt: now,
    } as Project;

    // EXTREME DEBUG: Log project creation
    if (process.env.NEXT_PUBLIC_DEBUG_TIMEBLOCK === '1') {
      console.log('[DataProvider] createProject called:', {
        inputData: data,
        finalProject: project,
        projectName: project.name,
        projectId: project.id,
        goalId: project.goalId
      });
    }

    setProjects(prev => [...prev, project]);

    try {
      const saved = await db.create<Project>('projects', project);
      setProjects(prev => prev.map(p => p.id === project.id ? deserializeProject(saved) : p));
      return saved.id;
    } catch (error) {
      console.error('[DataProvider] Create project failed:', error);
      setProjects(prev => prev.filter(p => p.id !== project.id));
      return undefined;
    }
  }, [userId]);

  const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
    const existing = projects.find(p => p.id === id);
    if (!existing) return;

    const updated = { ...existing, ...updates, updatedAt: new Date() };
    setProjects(prev => prev.map(p => p.id === id ? updated : p));

    try {
      await db.update('projects', updated);
    } catch (error) {
      console.error('[DataProvider] Update project failed:', error);
      setProjects(prev => prev.map(p => p.id === id ? existing : p));
    }
  }, [projects]);

  const deleteProject = useCallback(async (id: string) => {
    const existing = projects.find(p => p.id === id);
    if (!existing) return;

    setProjects(prev => prev.filter(p => p.id !== id));

    try {
      await db.delete('projects', id);
    } catch (error) {
      console.error('[DataProvider] Delete project failed:', error);
      setProjects(prev => [...prev, existing]);
    }
  }, [projects]);

  // ========== CRUD: Task ==========
  const createTask = useCallback(async (data: Partial<Task>): Promise<string | undefined> => {
    const now = new Date();
    const task: Task = {
      ...data,
      id: generateId('task'),
      userId,
      projectId: data.projectId || '',
      status: data.status || 'pending',
      priority: data.priority || 'medium',
      estimatedMinutes: data.estimatedMinutes || 60,
      createdAt: now,
      updatedAt: now,
    } as Task;

    // EXTREME DEBUG: Log task creation
    if (process.env.NEXT_PUBLIC_DEBUG_TIMEBLOCK === '1') {
      console.log('[DataProvider] createTask called:', {
        inputData: data,
        finalTask: task,
        taskTitle: task.title,
        taskId: task.id,
        projectId: task.projectId,
        goalId: task.goalId
      });
    }

    setTasks(prev => [...prev, task]);

    try {
      const saved = await db.create<Task>('tasks', task);
      setTasks(prev => prev.map(t => t.id === task.id ? deserializeTask(saved) : t));
      return saved.id;
    } catch (error) {
      console.error('[DataProvider] Create task failed:', error);
      setTasks(prev => prev.filter(t => t.id !== task.id));
      return undefined;
    }
  }, [userId]);

  const updateTask = useCallback(async (id: string, updates: Partial<Task>) => {
    const existing = tasks.find(t => t.id === id);
    if (!existing) return;

    const updated = { ...existing, ...updates, updatedAt: new Date() };
    setTasks(prev => prev.map(t => t.id === id ? updated : t));

    try {
      await db.update('tasks', updated);
    } catch (error) {
      console.error('[DataProvider] Update task failed:', error);
      setTasks(prev => prev.map(t => t.id === id ? existing : t));
    }
  }, [tasks]);

  const deleteTask = useCallback(async (id: string) => {
    const existing = tasks.find(t => t.id === id);
    if (!existing) return;

    setTasks(prev => prev.filter(t => t.id !== id));

    try {
      await db.delete('tasks', id);
    } catch (error) {
      console.error('[DataProvider] Delete task failed:', error);
      setTasks(prev => [...prev, existing]);
    }
  }, [tasks]);

  // ========== CRUD: Habit ==========
  const createHabit = useCallback(async (data: Partial<Habit>) => {
    const now = new Date();
    const habit: Habit = {
      ...data,
      id: generateId('habit'),
      userId,
      createdAt: now,
      updatedAt: now,
    } as Habit;

    setHabits(prev => [...prev, habit]);

    try {
      const saved = await db.create<Habit>('habits', habit);
      setHabits(prev => prev.map(h => h.id === habit.id ? deserializeHabit(saved) : h));
    } catch (error) {
      console.error('[DataProvider] Create habit failed:', error);
      setHabits(prev => prev.filter(h => h.id !== habit.id));
    }
  }, [userId]);

  const updateHabit = useCallback(async (id: string, updates: Partial<Habit>) => {
    const existing = habits.find(h => h.id === id);
    if (!existing) return;

    const updated = { ...existing, ...updates, updatedAt: new Date() };
    setHabits(prev => prev.map(h => h.id === id ? updated : h));

    try {
      await db.update('habits', updated);
    } catch (error) {
      console.error('[DataProvider] Update habit failed:', error);
      setHabits(prev => prev.map(h => h.id === id ? existing : h));
    }
  }, [habits]);

  const deleteHabit = useCallback(async (id: string) => {
    const existing = habits.find(h => h.id === id);
    if (!existing) return;

    setHabits(prev => prev.filter(h => h.id !== id));

    try {
      await db.delete('habits', id);
    } catch (error) {
      console.error('[DataProvider] Delete habit failed:', error);
      setHabits(prev => [...prev, existing]);
    }
  }, [habits]);

  const logHabit = useCallback(async (habitId: string, completed: boolean, value?: number) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = habitLogs.find(log => 
      log.habitId === habitId && 
      new Date(log.date).toDateString() === today.toDateString()
    );

    const logData: HabitLog = {
      id: existing?.id || generateId('habitlog'),
      habitId,
      userId,
      date: today,
      completed,
      value: value ?? existing?.value,
      createdAt: existing?.createdAt || new Date(),
    } as HabitLog;

    if (existing) {
      setHabitLogs(prev => prev.map(log => log.id === existing.id ? logData : log));
    } else {
      setHabitLogs(prev => [...prev, logData]);
    }

    try {
      if (existing) {
        await db.update('habitLogs', logData);
      } else {
        await db.create('habitLogs', logData);
      }
    } catch (error) {
      console.error('[DataProvider] Log habit failed:', error);
      if (existing) {
        setHabitLogs(prev => prev.map(log => log.id === existing.id ? existing : log));
      } else {
        setHabitLogs(prev => prev.filter(log => log.id !== logData.id));
      }
    }
  }, [userId, habitLogs]);

  // ========== Utils ==========
  const loadTimeBlocksForDate = useCallback(async (date: Date) => {
    try {
      const dateBlocks = await db.getTimeBlocksForDate(userId, date);
      const deserialized = dateBlocks.map(deserializeTimeBlock);
      
      setTimeBlocks(prev => {
        const existingIds = new Set(prev.map(b => b.id));
        const newBlocks = deserialized.filter(b => !existingIds.has(b.id));
        return [...prev, ...newBlocks];
      });
    } catch (error) {
      console.warn('[DataProvider] Load blocks for date failed:', error);
    }
  }, [userId]);



  // ========== Context Value ==========
  const value: DataContextValue = useMemo(() => ({
    status,
    userId,
    timeBlocks,
    goals,
    keyResults,
    projects,
    tasks,
    habits,
    habitLogs,
    kpis,
    createTimeBlock,
    updateTimeBlock,
    deleteTimeBlock,
    createGoal,
    updateGoal,
    deleteGoal,
    createKeyResult,
    updateKeyResult,
    deleteKeyResult,
    createProject,
    updateProject,
    deleteProject,
    createTask,
    updateTask,
    deleteTask,
    createHabit,
    updateHabit,
    deleteHabit,
    logHabit,
    loadTimeBlocksForDate,
    refreshKPIs,
  }), [
    status, userId, timeBlocks, goals, keyResults, projects, tasks, habits, habitLogs, kpis,
    createTimeBlock, updateTimeBlock, deleteTimeBlock,
    createGoal, updateGoal, deleteGoal,
    createKeyResult, updateKeyResult, deleteKeyResult,
    createProject, updateProject, deleteProject,
    createTask, updateTask, deleteTask,
    createHabit, updateHabit, deleteHabit, logHabit,
    loadTimeBlocksForDate, refreshKPIs,

  ]);

  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  );
}

