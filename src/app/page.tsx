'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Session, TimeBlock, KPI, Goal, KeyResult, Project, Task, 
  Habit, HabitLog, AnalyticsData 
} from '@/types';
import { computeDurationMinutes } from '@/utils/dateUtils';
import { SessionManager } from '@/utils/sessionManager';
import { db, buildHabitLogPayload, sanitizeForStorage } from '@/lib/database';
import { useAuth, AuthUser } from '@/lib/auth';

import NowBar from '@/components/NowBar';
import KPIDashboard from '@/components/KPIDashboard';
import TimeBlockPlanner from '@/components/TimeBlockPlanner';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';
import GoalAnalyticsDashboard from '@/components/GoalAnalyticsDashboard';
import HabitsTracker from '@/components/HabitsTracker';
import OKRManager from '@/components/OKRManager';
import DailyMotivation from '@/components/DailyMotivation';
import BadgeSystem from '@/components/BadgeSystem';
import AuthModal from '@/components/AuthModal';
import SyncStatusIndicator from '@/components/SyncStatus';
import GamingEffects from '@/components/GamingEffects';
import AIInputBar from '@/components/AIInputBar';
import SmartScheduler from '@/components/SmartScheduler';
import RealTimeAdaptation from '@/components/RealTimeAdaptation';
import MicroCoachDashboard from '@/components/MicroCoachDashboard';
import { audioManager } from '@/lib/audioManager';

// ============================================================================
// CONSTANTS & TYPES
// ============================================================================

const BUILD_ID = `2025-12-21-fix2-${Date.now().toString(36)}`;
const DEBUG_INIT = process.env.NODE_ENV === 'development';
const DEBUG_UI = process.env.NEXT_PUBLIC_DEBUG_INIT === '1';

type AuthStatus = 'unknown' | 'signedOut' | 'signedIn';
type InitStatus = 'idle' | 'loading' | 'ready' | 'error';
type ActiveTab = 'planner' | 'smart_scheduler' | 'adaptation' | 'micro_coach' | 'habits' | 'okr' | 'analytics' | 'goal_analytics' | 'badges';

// ============================================================================
// UTILITIES
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

function toDateSafe(value: unknown, fallback?: Date): Date {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      if (d instanceof Date && !isNaN(d.getTime())) return d;
    } catch { /* ignore */ }
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  return fallback ?? new Date();
}

function deserializeTimeBlock(block: any): TimeBlock {
  return {
    ...block,
    startTime: toDateSafe(block.startTime),
    endTime: toDateSafe(block.endTime),
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
    targetDate: toDateSafe(goal.targetDate),
    createdAt: toDateSafe(goal.createdAt),
    updatedAt: toDateSafe(goal.updatedAt),
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
// MAIN COMPONENT
// ============================================================================

export default function HomePage() {
  const auth = useAuth();
  
  // ========== AUTH STATE ==========
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('unknown');
  const [initStatus, setInitStatus] = useState<InitStatus>('idle');
  const [lastStep, setLastStep] = useState<string>('Starting...');
  const [showAuthModal, setShowAuthModal] = useState(false);

  // ========== SESSION STATE ==========
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [currentTimeBlock, setCurrentTimeBlock] = useState<TimeBlock | null>(null);
  const [todayKPIs, setTodayKPIs] = useState<KPI>({
    focusMinutes: 0,
    planVsActual: 0,
    activeStreaks: 0,
    keyResultsProgress: 0,
  });

  // ========== DATA STATE ==========
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [keyResults, setKeyResults] = useState<KeyResult[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLog[]>([]);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  
  // 🔥 NEW: Track if data has been loaded for current user
  const [dataLoadedForUser, setDataLoadedForUser] = useState<string | null>(null);

  // ========== UI STATE ==========
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<ActiveTab>('planner');
  const [selectedGoalId, setSelectedGoalId] = useState<string | undefined>();
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [timeBlockError, setTimeBlockError] = useState<string | null>(null);
  const [userStats, setUserStats] = useState({
    maxStreak: 0,
    totalFocusMinutes: 0,
    goalsCompleted: 0,
    goalsCreated: 0,
    totalSessions: 0,
    timeBlocksCreated: 0,
    daysTracked: 0,
    earlySessionsCount: 0,
    eveningSessionsCount: 0,
    weeklyFocusMinutes: 0
  });

  // ========== REFS ==========
  const t0 = useRef(performance.now());
  const runId = useRef(`run-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`);

  const sessionManager = SessionManager.getInstance();

  // ========== DERIVED STATE ==========
  
  const effectiveUserId = useMemo(() => {
    if (authStatus !== 'signedIn' || !currentUser?.uid) {
      return undefined;
    }
    return currentUser.uid;
  }, [authStatus, currentUser?.uid]);

  const filteredGoals = useMemo(() => {
    if (!effectiveUserId) return [];
    return goals.filter(g => !g.deleted && g.userId === effectiveUserId);
  }, [goals, effectiveUserId]);

  const filteredProjects = useMemo(() => {
    if (!effectiveUserId) return [];
    return projects.filter(p => !p.deleted && p.userId === effectiveUserId);
  }, [projects, effectiveUserId]);

  const filteredTasks = useMemo(() => {
    if (!effectiveUserId) return [];
    return tasks.filter(t => !t.deleted && t.userId === effectiveUserId);
  }, [tasks, effectiveUserId]);

  const filteredTimeBlocks = useMemo(() => {
    if (!effectiveUserId) return [];
    return timeBlocks.filter(tb => tb.userId === effectiveUserId);
  }, [timeBlocks, effectiveUserId]);

  const filteredKeyResults = useMemo(() => {
    if (!effectiveUserId) return [];
    return keyResults.filter(kr => !kr.deleted && kr.userId === effectiveUserId);
  }, [keyResults, effectiveUserId]);

  const filteredHabits = useMemo(() => {
    if (!effectiveUserId) return [];
    return habits.filter(h => !h.deleted && h.userId === effectiveUserId);
  }, [habits, effectiveUserId]);

  const filteredHabitLogs = useMemo(() => {
    if (!effectiveUserId) return [];
    return habitLogs.filter(log => log.userId === effectiveUserId);
  }, [habitLogs, effectiveUserId]);

  // ========== LOGGING ==========
  const trace = useCallback((...args: any[]) => {
    if (!DEBUG_INIT) return;
    console.log(`[${runId.current}][${Math.round(performance.now() - t0.current)}ms]`, ...args);
  }, []);

  // ========== AUTH STATE MACHINE ==========
  useEffect(() => {
    trace('AUTH:start', 'Setting up auth state listener');
    
    // 🔥 INCREASED TIMEOUT: 5 seconds instead of 2.5
    const authTimeout = setTimeout(() => {
      trace('AUTH:timeout', 'Auth state timeout - assuming signed out');
      setCurrentUser(null);
      setAuthStatus('signedOut');
      setLastStep('AUTH:timeout');
    }, 5000);
    
    const unsubscribe = auth.onAuthStateChange((user) => {
      trace('AUTH:resolved', user ? `SIGNED_IN uid=${user.uid}` : 'SIGNED_OUT');
      clearTimeout(authTimeout);
      setCurrentUser(user);
      setAuthStatus(user ? 'signedIn' : 'signedOut');
      setLastStep(user ? 'AUTH:signedIn' : 'AUTH:signedOut');
    });
    
    return () => {
      clearTimeout(authTimeout);
      unsubscribe();
    };
  }, []);

  // ========== 🔥 CRITICAL FIX: SEPARATE DATA LOADING EFFECT ==========
  useEffect(() => {
    if (!effectiveUserId) {
      trace('DATA:skip', 'No effectiveUserId yet');
      return;
    }
    
    // Skip if already loaded for this user
    if (dataLoadedForUser === effectiveUserId) {
      trace('DATA:skip', 'Data already loaded for this user');
      return;
    }
    
    trace('DATA:load:start', `Loading data for user ${effectiveUserId}`);
    setInitStatus('loading');
    setLastStep('DATA:loading');
    
    const loadAllData = async () => {
      try {
        // Step 1: Ensure database is initialized
        trace('DB:init:start', 'Initializing database');
        await db.init();
        trace('DB:init:ok', 'Database initialized');
        
        // Step 2: Switch to Firebase
        trace('FIREBASE:switch:start', 'Switching to Firebase');
        try {
          const { ensureFirestorePersistence, firestore } = await import('@/lib/firebase');
          
          try {
            await ensureFirestorePersistence(firestore);
          } catch (e: any) {
            trace('FIREBASE:persistence:warn', e?.message);
          }
          
          await db.switchToFirebase(effectiveUserId);
          trace('FIREBASE:switch:ok', 'Switched to Firebase');
        } catch (error: any) {
          trace('FIREBASE:switch:error', error.message);
        }
        
        // Step 3: Load all data in parallel
        trace('DATA:fetch:start', 'Fetching all data');
        
        const [
          allTimeBlocks,
          allGoals,
          allProjects,
          allTasks,
          allKeyResults,
          allHabits,
          allHabitLogs,
        ] = await Promise.all([
          db.getAll<TimeBlock>('timeBlocks').catch(() => []),
          db.getAll<Goal>('goals').catch(() => []),
          db.getAll<Project>('projects').catch(() => []),
          db.getAll<Task>('tasks').catch(() => []),
          db.getAll<KeyResult>('keyResults').catch(() => []),
          db.getAll<Habit>('habits').catch(() => []),
          db.getAll<HabitLog>('habitLogs').catch(() => []),
        ]);
        
        trace('DATA:fetch:ok', {
          timeBlocks: allTimeBlocks.length,
          goals: allGoals.length,
          projects: allProjects.length,
          tasks: allTasks.length,
        });
        
        // Step 4: Deserialize and filter by userId
        const userTimeBlocks = allTimeBlocks
          .map(deserializeTimeBlock)
          .filter(tb => tb.userId === effectiveUserId);
        
        const userGoals = allGoals
          .map(deserializeGoal)
          .filter(g => g.userId === effectiveUserId);
        
        const userProjects = allProjects
          .map(deserializeProject)
          .filter(p => p.userId === effectiveUserId);
        
        const userTasks = allTasks
          .map(deserializeTask)
          .filter(t => t.userId === effectiveUserId);
        
        const userKeyResults = allKeyResults
          .map(deserializeKeyResult)
          .filter(kr => kr.userId === effectiveUserId);
        
        const userHabits = allHabits
          .map(deserializeHabit)
          .filter(h => h.userId === effectiveUserId);
        
        const userHabitLogs = allHabitLogs
          .map(deserializeHabitLog)
          .filter(log => log.userId === effectiveUserId);
        
        trace('DATA:filtered', {
          timeBlocks: userTimeBlocks.length,
          goals: userGoals.length,
        });
        
        // Step 5: Update state
        setTimeBlocks(userTimeBlocks);
        setGoals(userGoals);
        setProjects(userProjects);
        setTasks(userTasks);
        setKeyResults(userKeyResults);
        setHabits(userHabits);
        setHabitLogs(userHabitLogs);
        
        // Mark as loaded
        setDataLoadedForUser(effectiveUserId);
        setInitStatus('ready');
        setLastStep('DATA:ready');
        
        trace('DATA:load:complete', 'All data loaded successfully');
        
        // Background: Load KPIs
        try {
          const kpis = await db.calculateTodayKPIs(effectiveUserId);
          setTodayKPIs(kpis);
        } catch (e) {
          trace('KPI:error', e);
        }
        
        // Init audio in background
        audioManager.init().catch(() => {});
        
      } catch (error: any) {
        trace('DATA:load:error', error.message);
        console.error('Failed to load data:', error);
        setLastStep(`DATA:error:${error.message}`);
        setInitStatus('ready'); // Still show UI
      }
    };
    
    loadAllData();
  }, [effectiveUserId, dataLoadedForUser]);

  // ========== KPI & CURRENT BLOCK UPDATES ==========
  useEffect(() => {
    if (!effectiveUserId) return;
    
    const updateKPIs = async () => {
      try {
        const kpis = await db.calculateTodayKPIs(effectiveUserId);
        setTodayKPIs(kpis);
      } catch (error) {
        console.error('Failed to update KPIs:', error);
      }
    };

    const interval = setInterval(updateKPIs, 60000);
    return () => clearInterval(interval);
  }, [effectiveUserId, currentSession]);

  useEffect(() => {
    const updateCurrentTimeBlock = () => {
      const now = new Date();
      const activeBlock = filteredTimeBlocks.find(block => 
        block.startTime <= now && 
        block.endTime >= now && 
        block.status !== 'completed'
      );
      setCurrentTimeBlock(activeBlock || null);
    };

    updateCurrentTimeBlock();
    const interval = setInterval(updateCurrentTimeBlock, 10000);
    return () => clearInterval(interval);
  }, [filteredTimeBlocks]);

  // Load timeBlocks for selected date on-demand
  useEffect(() => {
    if (!effectiveUserId) return;
    
    const loadTimeBlocksForDate = async () => {
      const selectedDateStr = selectedDate.toDateString();
      const todayStr = new Date().toDateString();
      
      if (selectedDateStr === todayStr) return;
      
      const hasBlocksForDate = timeBlocks.some(block => 
        new Date(block.startTime).toDateString() === selectedDateStr
      );
      
      if (!hasBlocksForDate) {
        try {
          const dateBlocks = await db.getTimeBlocksForDate(effectiveUserId, selectedDate);
          const deserializedBlocks = dateBlocks.map(deserializeTimeBlock);
          
          setTimeBlocks(prev => {
            const existingIds = new Set(prev.map(b => b.id));
            const newBlocks = deserializedBlocks.filter(b => !existingIds.has(b.id));
            return [...prev, ...newBlocks];
          });
        } catch (error) {
          console.warn('Failed to load blocks for date:', error);
        }
      }
    };

    loadTimeBlocksForDate();
  }, [selectedDate, effectiveUserId]);

  // Reload analytics when timeRange changes
  useEffect(() => {
    if (!effectiveUserId || initStatus !== 'ready') return;
    
    const loadAnalytics = async () => {
      try {
        setAnalyticsLoading(true);
        const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;

        const [planVsActual, timeAllocation, focusTrend, correlations, weeklyReview] = await Promise.all([
          db.calculatePlanVsActualData(effectiveUserId, days),
          db.calculateTimeAllocation(effectiveUserId, days),
          db.calculateFocusTrend(effectiveUserId, days),
          db.calculateCorrelations(effectiveUserId, days),
          db.generateWeeklyReview(effectiveUserId),
        ]);

        setAnalyticsData({
          planVsActual,
          timeAllocation,
          focusTrend,
          correlations,
          weeklyReview,
        });
      } catch (error) {
        console.error('Analytics loading failed:', error);
      } finally {
        setAnalyticsLoading(false);
      }
    };
    
    loadAnalytics();
  }, [timeRange, effectiveUserId, initStatus]);

  // ========== SESSION HANDLERS ==========
  const handleStartSession = async (taskId?: string, timeBlockId?: string) => {
    if (!effectiveUserId) return;
    
    try {
      const session = await sessionManager.startSession(taskId, timeBlockId, 'default', effectiveUserId);
      setCurrentSession(session);
      audioManager.buttonFeedback();
    } catch (error) {
      console.error('Failed to start session:', error);
    }
  };

  const handlePauseSession = async () => {
    try {
      const session = await sessionManager.pauseSession();
      setCurrentSession(session);
    } catch (error) {
      console.error('Failed to pause session:', error);
    }
  };

  const handleStopSession = async () => {
    try {
      const completedSession = await sessionManager.stopSession();
      setCurrentSession(null);
      
      if (completedSession && effectiveUserId) {
        const updatedKPIs = await db.calculateTodayKPIs(effectiveUserId);
        setTodayKPIs(updatedKPIs);
      }
    } catch (error) {
      console.error('Failed to stop session:', error);
    }
  };

  // ========== TIMEBLOCK HANDLERS ==========
  const handleCreateTimeBlock = useCallback(async (blockData: Partial<TimeBlock>) => {
    if (!effectiveUserId) {
      console.error('Cannot create time block: user not authenticated');
      setTimeBlockError('Please sign in to create time blocks');
      return;
    }

    setTimeBlockError(null);
    
    const startTime = blockData.startTime ? toDateSafe(blockData.startTime) : new Date();
    const endTime = blockData.endTime ? toDateSafe(blockData.endTime) : new Date(startTime.getTime() + 60 * 60 * 1000);
    const now = new Date();
    
    const blockToCreate: TimeBlock = {
      ...blockData,
      id: generateId('timeblock'),
      userId: effectiveUserId,
      domainId: blockData.domainId || 'domain-1',
      startTime,
      endTime,
      status: normalizeTimeBlockStatus(blockData.status || 'planned'),
      createdAt: now,
      updatedAt: now,
    } as TimeBlock;

    setTimeBlocks(prev => [...prev, blockToCreate]);

    try {
      const createdBlock = await db.create<TimeBlock>('timeBlocks', blockToCreate);
      const deserializedBlock = deserializeTimeBlock(createdBlock);
      
      setTimeBlocks(prev => prev.map(block => 
        block.id === blockToCreate.id ? deserializedBlock : block
      ));
      
      audioManager.taskCompleted();
    } catch (error: any) {
      console.error('Failed to create time block:', error);
      setTimeBlocks(prev => prev.filter(block => block.id !== blockToCreate.id));
      setTimeBlockError(error?.message || 'Failed to save time block');
    }
  }, [effectiveUserId]);

  const handleUpdateTimeBlock = useCallback(async (id: string, updates: Partial<TimeBlock>): Promise<void> => {
    const existingBlock = timeBlocks.find(b => b.id === id);
    if (!existingBlock) return;
    
    const updatedBlock: TimeBlock = {
      ...existingBlock,
      ...updates,
      status: normalizeTimeBlockStatus(updates.status ?? existingBlock.status),
      startTime: updates.startTime ? toDateSafe(updates.startTime) : existingBlock.startTime,
      endTime: updates.endTime ? toDateSafe(updates.endTime) : existingBlock.endTime,
      actualStartTime: updates.actualStartTime ? toDateSafe(updates.actualStartTime) : existingBlock.actualStartTime,
      actualEndTime: updates.actualEndTime ? toDateSafe(updates.actualEndTime) : existingBlock.actualEndTime,
      updatedAt: new Date(),
    };
    
    setTimeBlocks(prev => prev.map(b => b.id === id ? updatedBlock : b));
    
    try {
      await db.update('timeBlocks', sanitizeForStorage(updatedBlock));
      
      if (updates.status && updates.status !== existingBlock.status && effectiveUserId) {
        const updatedKPIs = await db.calculateTodayKPIs(effectiveUserId);
        setTodayKPIs(updatedKPIs);
      }
    } catch (error) {
      console.error('Failed to update time block:', error);
      setTimeBlocks(prev => prev.map(b => b.id === id ? existingBlock : b));
    }
  }, [timeBlocks, effectiveUserId]);

  const handleDeleteTimeBlock = useCallback(async (id: string) => {
    const existingBlock = timeBlocks.find(b => b.id === id);
    if (!existingBlock) return;
    
    setTimeBlocks(prev => prev.filter(b => b.id !== id));
    
    try {
      await db.delete('timeBlocks', id);
    } catch (error) {
      console.error('Failed to delete time block:', error);
      setTimeBlocks(prev => [...prev, existingBlock]);
    }
  }, [timeBlocks]);

  // ========== GOAL HANDLERS ==========
  const handleCreateGoal = useCallback(async (goalData: Partial<Goal>): Promise<string | undefined> => {
    if (!effectiveUserId) {
      console.error('Cannot create goal: user not authenticated');
      return undefined;
    }

    const now = new Date();
    const goalToCreate: Goal = {
      ...goalData,
      id: generateId('goal'),
      userId: effectiveUserId,
      domainId: goalData.domainId || 'domain-1',
      status: goalData.status || 'active',
      priority: goalData.priority || 'medium',
      targetDate: goalData.targetDate ? toDateSafe(goalData.targetDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      keyResults: [],
      timeAllocationTarget: goalData.timeAllocationTarget || 0,
      category: goalData.category || 'important_not_urgent',
      complexity: goalData.complexity || 'moderate',
      createdAt: now,
      updatedAt: now,
    } as Goal;

    setGoals(prev => [...prev, goalToCreate]);

    try {
      const savedGoal = await db.create<Goal>('goals', goalToCreate);
      const deserializedGoal = deserializeGoal(savedGoal);
      
      setGoals(prev => prev.map(g => g.id === goalToCreate.id ? deserializedGoal : g));
      
      return deserializedGoal.id;
    } catch (error) {
      console.error('Failed to create goal:', error);
      setGoals(prev => prev.filter(g => g.id !== goalToCreate.id));
      return undefined;
    }
  }, [effectiveUserId]);

  const handleUpdateGoal = useCallback(async (id: string, updates: Partial<Goal>) => {
    const existingGoal = goals.find(g => g.id === id);
    if (!existingGoal) return;

    const updatedGoal = { ...existingGoal, ...updates, updatedAt: new Date() };
    setGoals(prev => prev.map(g => g.id === id ? updatedGoal : g));

    try {
      await db.update('goals', updatedGoal);
    } catch (error) {
      console.error('Failed to update goal:', error);
      setGoals(prev => prev.map(g => g.id === id ? existingGoal : g));
    }
  }, [goals]);

  const handleDeleteGoal = useCallback(async (id: string) => {
    const existingGoal = goals.find(g => g.id === id);
    if (!existingGoal) return;

    setGoals(prev => prev.map(g => g.id === id ? { ...g, deleted: true } : g));

    try {
      await db.update('goals', { ...existingGoal, deleted: true, updatedAt: new Date() });
    } catch (error) {
      console.error('Failed to delete goal:', error);
      setGoals(prev => prev.map(g => g.id === id ? existingGoal : g));
    }
  }, [goals]);

  // ========== KEY RESULT HANDLERS ==========
  const handleCreateKeyResult = useCallback(async (krData: Partial<KeyResult>): Promise<string | undefined> => {
    if (!effectiveUserId) {
      console.error('Cannot create key result: user not authenticated');
      return undefined;
    }

    const now = new Date();
    const krToCreate: KeyResult = {
      ...krData,
      id: generateId('keyresult'),
      userId: effectiveUserId,
      goalId: krData.goalId || '',
      currentValue: krData.currentValue || 0,
      targetValue: krData.targetValue || 100,
      progress: 0,
      status: krData.status || 'active',
      createdAt: now,
      updatedAt: now,
    } as KeyResult;

    setKeyResults(prev => [...prev, krToCreate]);

    try {
      const savedKR = await db.create<KeyResult>('keyResults', krToCreate);
      const deserializedKR = deserializeKeyResult(savedKR);
      
      setKeyResults(prev => prev.map(kr => kr.id === krToCreate.id ? deserializedKR : kr));
      
      return deserializedKR.id;
    } catch (error) {
      console.error('Failed to create key result:', error);
      setKeyResults(prev => prev.filter(kr => kr.id !== krToCreate.id));
      return undefined;
    }
  }, [effectiveUserId]);

  const handleUpdateKeyResult = useCallback(async (id: string, updates: Partial<KeyResult>) => {
    const existingKR = keyResults.find(kr => kr.id === id);
    if (!existingKR) return;

    const updatedKR = { ...existingKR, ...updates, updatedAt: new Date() };
    setKeyResults(prev => prev.map(kr => kr.id === id ? updatedKR : kr));

    try {
      await db.update('keyResults', updatedKR);
      
      if (updatedKR.progress >= 100 && existingKR.progress < 100) {
        audioManager.perfectDay();
      } else if ((updatedKR.progress || 0) > (existingKR.progress || 0)) {
        audioManager.taskCompleted();
      }
    } catch (error) {
      console.error('Failed to update key result:', error);
      setKeyResults(prev => prev.map(kr => kr.id === id ? existingKR : kr));
    }
  }, [keyResults]);

  const handleDeleteKeyResult = useCallback(async (id: string) => {
    const existingKR = keyResults.find(kr => kr.id === id);
    if (!existingKR) return;

    setKeyResults(prev => prev.map(kr => kr.id === id ? { ...kr, deleted: true } : kr));

    try {
      await db.update('keyResults', { ...existingKR, deleted: true, updatedAt: new Date() });
    } catch (error) {
      console.error('Failed to delete key result:', error);
      setKeyResults(prev => prev.map(kr => kr.id === id ? existingKR : kr));
    }
  }, [keyResults]);

  // ========== PROJECT HANDLERS ==========
  const handleCreateProject = useCallback(async (projectData: Partial<Project>): Promise<string | undefined> => {
    if (!effectiveUserId) {
      console.error('Cannot create project: user not authenticated');
      return undefined;
    }

    const now = new Date();
    const projectToCreate: Project = {
      ...projectData,
      id: generateId('project'),
      userId: effectiveUserId,
      domainId: projectData.domainId || 'domain-1',
      goalId: projectData.goalId || '',
      status: projectData.status || 'active',
      priority: projectData.priority || 'medium',
      createdAt: now,
      updatedAt: now,
    } as Project;

    setProjects(prev => [...prev, projectToCreate]);

    try {
      const savedProject = await db.create<Project>('projects', projectToCreate);
      const deserializedProject = deserializeProject(savedProject);
      
      setProjects(prev => prev.map(p => p.id === projectToCreate.id ? deserializedProject : p));
      
      return deserializedProject.id;
    } catch (error) {
      console.error('Failed to create project:', error);
      setProjects(prev => prev.filter(p => p.id !== projectToCreate.id));
      return undefined;
    }
  }, [effectiveUserId]);

  const handleUpdateProject = useCallback(async (id: string, updates: Partial<Project>) => {
    const existingProject = projects.find(p => p.id === id);
    if (!existingProject) return;

    const updatedProject = { ...existingProject, ...updates, updatedAt: new Date() };
    setProjects(prev => prev.map(p => p.id === id ? updatedProject : p));

    try {
      await db.update('projects', updatedProject);
    } catch (error) {
      console.error('Failed to update project:', error);
      setProjects(prev => prev.map(p => p.id === id ? existingProject : p));
    }
  }, [projects]);

  const handleDeleteProject = useCallback(async (id: string) => {
    const existingProject = projects.find(p => p.id === id);
    if (!existingProject) return;
    
    const projectTasks = tasks.filter(t => t.projectId === id);

    setProjects(prev => prev.filter(p => p.id !== id));
    setTasks(prev => prev.filter(t => t.projectId !== id));

    try {
      await db.delete('projects', id);
      for (const task of projectTasks) {
        await db.delete('tasks', task.id);
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
      setProjects(prev => [...prev, existingProject]);
      setTasks(prev => [...prev, ...projectTasks]);
    }
  }, [projects, tasks]);

  // ========== TASK HANDLERS ==========
  const handleCreateTask = useCallback(async (taskData: Partial<Task>): Promise<string | undefined> => {
    if (!effectiveUserId) {
      console.error('Cannot create task: user not authenticated');
      return undefined;
    }

    const now = new Date();
    const taskToCreate: Task = {
      ...taskData,
      id: generateId('task'),
      userId: effectiveUserId,
      domainId: taskData.domainId || 'domain-1',
      projectId: taskData.projectId || '',
      status: taskData.status || 'pending',
      priority: taskData.priority || 'medium',
      estimatedMinutes: taskData.estimatedMinutes || 60,
      createdAt: now,
      updatedAt: now,
    } as Task;

    setTasks(prev => [...prev, taskToCreate]);

    try {
      const savedTask = await db.create<Task>('tasks', taskToCreate);
      const deserializedTask = deserializeTask(savedTask);
      
      setTasks(prev => prev.map(t => t.id === taskToCreate.id ? deserializedTask : t));
      
      return deserializedTask.id;
    } catch (error) {
      console.error('Failed to create task:', error);
      setTasks(prev => prev.filter(t => t.id !== taskToCreate.id));
      return undefined;
    }
  }, [effectiveUserId]);

  const handleUpdateTask = useCallback(async (id: string, updates: Partial<Task>) => {
    const existingTask = tasks.find(t => t.id === id);
    if (!existingTask) return;

    const updatedTask = { ...existingTask, ...updates, updatedAt: new Date() };
    setTasks(prev => prev.map(t => t.id === id ? updatedTask : t));

    try {
      await db.update('tasks', updatedTask);
    } catch (error) {
      console.error('Failed to update task:', error);
      setTasks(prev => prev.map(t => t.id === id ? existingTask : t));
    }
  }, [tasks]);

  const handleDeleteTask = useCallback(async (id: string) => {
    const existingTask = tasks.find(t => t.id === id);
    if (!existingTask) return;

    setTasks(prev => prev.filter(t => t.id !== id));

    try {
      await db.delete('tasks', id);
    } catch (error) {
      console.error('Failed to delete task:', error);
      setTasks(prev => [...prev, existingTask]);
    }
  }, [tasks]);

  // ========== HABIT HANDLERS ==========
  const handleCreateHabit = useCallback(async (habitData: Partial<Habit>) => {
    if (!effectiveUserId) return;

    const now = new Date();
    const habitToCreate: Habit = {
      ...habitData,
      id: generateId('habit'),
      userId: effectiveUserId,
      createdAt: now,
      updatedAt: now,
    } as Habit;

    setHabits(prev => [...prev, habitToCreate]);

    try {
      const savedHabit = await db.create<Habit>('habits', habitToCreate);
      setHabits(prev => prev.map(h => h.id === habitToCreate.id ? deserializeHabit(savedHabit) : h));
      audioManager.play('achievementUnlock');
    } catch (error) {
      console.error('Failed to create habit:', error);
      setHabits(prev => prev.filter(h => h.id !== habitToCreate.id));
    }
  }, [effectiveUserId]);

  const handleUpdateHabit = useCallback(async (id: string, updates: Partial<Habit>) => {
    const existingHabit = habits.find(h => h.id === id);
    if (!existingHabit) return;

    const updatedHabit = { ...existingHabit, ...updates, updatedAt: new Date() };
    setHabits(prev => prev.map(h => h.id === id ? updatedHabit : h));

    try {
      await db.update('habits', updatedHabit);
    } catch (error) {
      console.error('Failed to update habit:', error);
      setHabits(prev => prev.map(h => h.id === id ? existingHabit : h));
    }
  }, [habits]);

  const handleDeleteHabit = useCallback(async (id: string) => {
    const existingHabit = habits.find(h => h.id === id);
    if (!existingHabit) return;

    setHabits(prev => prev.filter(h => h.id !== id));

    try {
      await db.delete('habits', id);
    } catch (error) {
      console.error('Failed to delete habit:', error);
      setHabits(prev => [...prev, existingHabit]);
    }
  }, [habits]);

  const handleLogHabit = useCallback(async (habitId: string, completed: boolean, value?: number, notes?: string) => {
    if (!effectiveUserId) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingLog = habitLogs.find(log => 
      log.habitId === habitId && 
      new Date(log.date).toDateString() === today.toDateString()
    );

    const logData: HabitLog = {
      id: existingLog?.id || generateId('habitlog'),
      habitId,
      userId: effectiveUserId,
      date: today,
      completed,
      value: value !== undefined ? value : existingLog?.value,
      notes: notes || existingLog?.notes || '',
      createdAt: existingLog?.createdAt || new Date(),
    } as HabitLog;

    if (existingLog) {
      setHabitLogs(prev => prev.map(log => log.id === existingLog.id ? logData : log));
    } else {
      setHabitLogs(prev => [...prev, logData]);
    }

    try {
      if (existingLog) {
        await db.update('habitLogs', logData);
      } else {
        await db.create('habitLogs', logData);
      }
      
      if (completed) {
        audioManager.taskCompleted();
      }
    } catch (error) {
      console.error('Failed to log habit:', error);
      if (existingLog) {
        setHabitLogs(prev => prev.map(log => log.id === existingLog.id ? existingLog : log));
      } else {
        setHabitLogs(prev => prev.filter(log => log.id !== logData.id));
      }
    }
  }, [effectiveUserId, habitLogs]);

  // ========== OTHER HANDLERS ==========
  const handleBadgeUnlocked = (badge: any) => {
    console.log('Badge unlocked:', badge.name);
    audioManager.play('achievementUnlock');
  };

  // ========== RENDER HELPERS ==========
  const emptyAnalyticsData: AnalyticsData = {
    planVsActual: [],
    timeAllocation: [],
    focusTrend: [],
    correlations: [],
    weeklyReview: {
      highlights: ['Loading...'],
      challenges: ['Loading...'],
      insights: ['Loading...'],
      nextWeekGoals: ['Loading...'],
    },
  };

  // ========== RENDER: AUTH STATES ==========
  
  if (authStatus === 'unknown') {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-8">
            <div className="w-20 h-20 border-4 border-blue-200 rounded-full border-r-blue-600 animate-spin" />
          </div>
          <h2 className="text-3xl font-bold text-white mb-4">Life Tracker</h2>
          <p className="text-slate-300 text-lg">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (authStatus === 'signedOut') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900">
        <AuthModal isOpen={true} onClose={() => {}} />
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-4xl md:text-6xl font-bold text-white mb-6">Life Tracker</h1>
            <p className="text-xl text-slate-300 max-w-2xl mx-auto">Please sign in to continue</p>
          </div>
        </div>
      </div>
    );
  }

  if (authStatus === 'signedIn' && initStatus === 'loading') {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-8">
            <div className="w-20 h-20 border-4 border-blue-200 rounded-full border-r-blue-600 animate-spin" />
          </div>
          <h2 className="text-3xl font-bold text-white mb-4">Life Tracker</h2>
          <p className="text-slate-300 text-lg">Loading your data...</p>
          {DEBUG_UI && (
            <div className="mt-4 bg-black/40 border border-white/20 rounded-lg p-3 text-left max-w-sm mx-auto">
              <div className="text-sm text-white">Step: {lastStep}</div>
              <div className="text-sm text-green-300">User: {effectiveUserId?.slice(0, 8)}...</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const dbError = db.getDatabaseError?.();
  if (dbError && dbError.type === 'VersionError') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="max-w-md mx-auto text-center p-8 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl">
          <div className="text-6xl mb-6">⚠️</div>
          <h2 className="text-2xl font-bold text-white mb-4">Database Version Conflict</h2>
          <p className="text-slate-300 mb-6">{dbError.message}</p>
          
          {dbError.canReset && (
            <button
              onClick={async () => {
                await db.resetLocalDatabase?.();
                db.clearDatabaseError?.();
                window.location.reload();
              }}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg mb-4"
            >
              Reset Local Database
            </button>
          )}
          
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  if (authStatus !== 'signedIn' || !currentUser) {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold text-white mb-4">Loading...</h2>
          <p className="text-slate-300">Auth: {authStatus}</p>
        </div>
      </div>
    );
  }

  // ========== RENDER: MAIN APP ==========
  return (
    <div className="min-h-screen" data-testid="app-ready">
      <GamingEffects />
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      <DailyMotivation />

      {/* Header */}
      <div className="bg-white/90 backdrop-blur-md border-b border-neutral-200 shadow-lg fixed top-0 left-0 right-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              ⚡ LifeTracker
            </div>
            <div className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full font-mono">
              {BUILD_ID}
            </div>
          </div>
          
          <div className="flex-1 mx-8">
            <NowBar
              currentSession={currentSession}
              currentTimeBlock={currentTimeBlock}
              onStartSession={handleStartSession}
              onPauseSession={handlePauseSession}
              onStopSession={handleStopSession}
            />
          </div>
          
          <div className="flex items-center space-x-4 ml-4">
            <SyncStatusIndicator />
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white text-sm font-bold">
                {(currentUser.displayName?.[0]) || (currentUser.email?.[0]) || 'U'}
              </div>
              <div className="hidden md:block">
                <div className="text-sm font-medium text-neutral-900">
                  {currentUser.displayName || 'User'}
                </div>
                <div className="text-xs text-neutral-500">{currentUser.email}</div>
              </div>
              <button
                onClick={() => {
                  auth.signOut();
                  setDataLoadedForUser(null);
                  audioManager.buttonFeedback();
                }}
                className="btn btn-outline text-xs px-3 py-1"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="pt-24 pb-8 bg-gradient-to-br from-neutral-50 to-neutral-100 min-h-screen">
        <div className="container mx-auto">
          <div className="grid-responsive gap-6">
            {/* Left Sidebar */}
            <div className="space-y-6">
              {/* AI Assistant */}
              <div className="card-elevated card-body hover-lift transition-smooth">
                <div className="mb-4">
                  <h3 className="heading-3 flex items-center gap-3">
                    🧠 AI Assistant
                    <span className="badge badge-primary text-xs">AI</span>
                  </h3>
                  <p className="text-small">Create tasks and blocks with natural language</p>
                </div>
                <AIInputBar
                  onCreateTimeBlock={handleCreateTimeBlock}
                  onCreateTask={handleCreateTask}
                  onCreateGoal={handleCreateGoal}
                  onCreateHabit={handleCreateHabit}
                  goals={filteredGoals}
                  existingTasks={filteredTasks}
                  userPreferences={{}}
                  className="w-full"
                  currentUserId={effectiveUserId}
                />
              </div>

              {/* KPI Dashboard */}
              <div className="card-elevated hover-lift transition-smooth">
                <div className="card-header">
                  <h3 className="heading-3">Today's Progress</h3>
                </div>
                <div className="card-body">
                  <KPIDashboard 
                    kpis={todayKPIs}
                    onRefresh={async () => {
                      if (effectiveUserId) {
                        const updatedKPIs = await db.calculateTodayKPIs(effectiveUserId);
                        setTodayKPIs(updatedKPIs);
                      }
                    }}
                  />
                </div>
              </div>

              {/* Module Navigation */}
              <div className="card-elevated hover-lift transition-smooth">
                <div className="card-header">
                  <h3 className="heading-3">Modules</h3>
                </div>
                <div className="card-body">
                  <div className="module-grid">
                    {[
                      { id: 'planner', label: 'Time Planner', icon: '📅', description: 'Plan your day' },
                      { id: 'smart_scheduler', label: 'Auto Scheduler', icon: '⚡', description: 'AI scheduling' },
                      { id: 'adaptation', label: 'Auto-Replan', icon: '🔄', description: 'Real-time adaptation' },
                      { id: 'micro_coach', label: 'AI Coach', icon: '🧠', description: 'Performance insights' },
                      { id: 'habits', label: 'Habits', icon: '🔥', description: 'Track habits' },
                      { id: 'okr', label: 'Goals & Projects', icon: '🎯', description: 'Manage objectives' },
                      { id: 'analytics', label: 'Analytics', icon: '📊', description: 'Performance data' },
                      { id: 'goal_analytics', label: 'Goal Intelligence', icon: '🎯', description: 'Goal insights' },
                      { id: 'badges', label: 'Achievements', icon: '🏆', description: 'Milestones' },
                    ].map(({ id, label, icon, description }) => (
                      <div
                        key={id}
                        onClick={() => {
                          setActiveTab(id as ActiveTab);
                          audioManager.buttonFeedback();
                        }}
                        className={`module-card ${activeTab === id ? 'active' : ''}`}
                      >
                        <span className="module-icon">{icon}</span>
                        <h4 className="module-title">{label}</h4>
                        <p className="module-description">{description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="card-elevated shadow-xl">
              <div className="card-header">
                <h2 className="heading-2">
                  {activeTab === 'planner' && '📅 Time Planner'}
                  {activeTab === 'smart_scheduler' && '⚡ Auto Scheduler'}
                  {activeTab === 'adaptation' && '🔄 Auto Replan'}
                  {activeTab === 'micro_coach' && '🧠 AI Coach'}
                  {activeTab === 'habits' && '🔥 Habits Tracker'}
                  {activeTab === 'okr' && '🎯 Goals & Projects'}
                  {activeTab === 'analytics' && '📊 Analytics Dashboard'}
                  {activeTab === 'goal_analytics' && '🎯 Goal Intelligence'}
                  {activeTab === 'badges' && '🏆 Achievements'}
                </h2>
              </div>
              <div className="card-body">
                {activeTab === 'planner' && (
                  <>
                    {timeBlockError && (
                      <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {timeBlockError}
                      </div>
                    )}
                    <TimeBlockPlanner
                      timeBlocks={filteredTimeBlocks}
                      tasks={filteredTasks}
                      projects={filteredProjects}
                      goals={filteredGoals}
                      onCreateTimeBlock={handleCreateTimeBlock}
                      onUpdateTimeBlock={handleUpdateTimeBlock}
                      onDeleteTimeBlock={handleDeleteTimeBlock}
                      selectedDate={selectedDate}
                      onDateChange={setSelectedDate}
                      currentUserId={effectiveUserId}
                      isReady={initStatus === 'ready'}
                    />
                  </>
                )}

                {activeTab === 'smart_scheduler' && (
                  <SmartScheduler
                    tasks={filteredTasks}
                    existingTimeBlocks={filteredTimeBlocks}
                    goals={filteredGoals}
                    onScheduleGenerated={(schedule) => console.log('Schedule generated:', schedule)}
                    onTimeBlocksCreated={async (blocks) => {
                      for (const block of blocks) {
                        await handleCreateTimeBlock(block);
                      }
                      audioManager.perfectDay();
                    }}
                    userPreferences={{}}
                  />
                )}

                {activeTab === 'adaptation' && (
                  <RealTimeAdaptation
                    currentSchedule={filteredTimeBlocks}
                    tasks={filteredTasks}
                    goals={filteredGoals}
                    currentSession={currentSession}
                    userEnergyLevel={0.7}
                    onScheduleAdapted={async (newSchedule, changes) => {
                      setTimeBlocks(newSchedule);
                      audioManager.perfectDay();
                    }}
                  />
                )}

                {activeTab === 'micro_coach' && (
                  <MicroCoachDashboard
                    goals={filteredGoals}
                    keyResults={filteredKeyResults}
                    tasks={filteredTasks}
                    sessions={[]}
                    habitLogs={filteredHabitLogs}
                    timeBlocks={filteredTimeBlocks}
                    onInsightAction={(action, insight) => {
                      if (action === 'implement') {
                        audioManager.perfectDay();
                      }
                    }}
                  />
                )}

                {activeTab === 'habits' && (
                  <HabitsTracker
                    habits={filteredHabits}
                    habitLogs={filteredHabitLogs}
                    onCreateHabit={handleCreateHabit}
                    onUpdateHabit={handleUpdateHabit}
                    onDeleteHabit={handleDeleteHabit}
                    onLogHabit={handleLogHabit}
                    currentUserId={effectiveUserId}
                  />
                )}

                {activeTab === 'okr' && (
                  <OKRManager
                    goals={filteredGoals}
                    keyResults={filteredKeyResults}
                    projects={filteredProjects}
                    tasks={filteredTasks}
                    timeBlocks={filteredTimeBlocks}
                    currentUserId={effectiveUserId}
                    isLoading={initStatus === 'loading'}
                    
                    onCreateGoal={handleCreateGoal}
                    onUpdateGoal={handleUpdateGoal}
                    onDeleteGoal={handleDeleteGoal}
                    
                    onCreateKeyResult={handleCreateKeyResult}
                    onUpdateKeyResult={handleUpdateKeyResult}
                    onDeleteKeyResult={handleDeleteKeyResult}
                    
                    onCreateProject={handleCreateProject}
                    onUpdateProject={handleUpdateProject}
                    onDeleteProject={handleDeleteProject}
                    
                    onCreateTask={handleCreateTask}
                    onUpdateTask={handleUpdateTask}
                    onDeleteTask={handleDeleteTask}
                  />
                )}

                {activeTab === 'analytics' && (
                  <AnalyticsDashboard
                    data={analyticsData || emptyAnalyticsData}
                    timeRange={timeRange}
                    onTimeRangeChange={setTimeRange}
                  />
                )}

                {activeTab === 'goal_analytics' && (
                  <GoalAnalyticsDashboard
                    goals={filteredGoals}
                    userId={effectiveUserId || ''}
                    selectedGoalId={selectedGoalId}
                    onGoalSelect={setSelectedGoalId}
                  />
                )}

                {activeTab === 'badges' && (
                  <BadgeSystem
                    userStats={userStats}
                    onBadgeUnlocked={handleBadgeUnlocked}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-neutral-200 bg-neutral-50 py-3">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex justify-between items-center text-xs text-neutral-500">
            <span>Life Tracker © 2025</span>
            <span className="font-mono">build: {BUILD_ID}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}