'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Session, TimeBlock, KPI, Goal, KeyResult, Project, Task, 
  Habit, HabitLog, AnalyticsData 
} from '@/types';
import { SessionManager } from '@/utils/sessionManager';
import { db } from '@/lib/database';
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

export default function HomePage() {
  const auth = useAuth();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [currentTimeBlock, setCurrentTimeBlock] = useState<TimeBlock | null>(null);
  const [todayKPIs, setTodayKPIs] = useState<KPI>({
    focusMinutes: 0,
    planVsActual: 0,
    activeStreaks: 0,
    keyResultsProgress: 0,
  });

  // Data states
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [keyResults, setKeyResults] = useState<KeyResult[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLog[]>([]);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
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
  const [showBadges, setShowBadges] = useState(false);

  // UI states
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'planner' | 'smart_scheduler' | 'adaptation' | 'micro_coach' | 'habits' | 'okr' | 'analytics' | 'goal_analytics' | 'badges'>('planner');
  const [selectedGoalId, setSelectedGoalId] = useState<string | undefined>();
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [isLoading, setIsLoading] = useState(true);
  const [timeBlockError, setTimeBlockError] = useState<string | null>(null);
  const adapterInfo = db.getAdapterDebugInfo();
  const [dbReadyForUser, setDbReadyForUser] = useState(false); // ⚠️ FIX: Flag per garantire che DB sia pronto per l'utente
  const isReady = true; // ⚠️ TEMP: Disabled Firebase switching for testing - use IndexedDB only
  const lastLoadedUserId = useRef<string | null>(null);
  const hasInitialized = useRef(false);

  const sessionManager = SessionManager.getInstance();

  // Initialize auth state listener
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChange((user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });

    return unsubscribe;
  }, [auth]);

  // Initialize database and load data after auth state is known and only in browser
  useEffect(() => {
    if (authLoading || typeof window === 'undefined') return;
    
    // ⚠️ FIX: Mutex per evitare race condition - solo una init alla volta
    if (hasInitialized.current) {
      console.log('⏸️ Init già in corso, skipping...');
      return;
    }
    
    const initializeApp = async () => {
      try {
        console.log('🚀 INIT START', {
          authLoading,
          currentUserId: currentUser?.uid,
          timestamp: new Date().toISOString()
        });
        
        await db.init();
        await audioManager.init(); // 🎵 Initialize gaming audio

        // ⚠️ TEMP: Disabled Firebase switching - always use IndexedDB
        console.log('⏳ User authenticated, but using IndexedDB only');
        lastLoadedUserId.current = null;
        setShowAuthModal(false);
        // ⚠️ TEMP: Load from IndexedDB only
        await loadData();
        setIsLoading(false);
        return;
        
        console.log('✅ INIT COMPLETE', {
          adapter: db.getAdapterDebugInfo(),
          timeBlocksCount: timeBlocks.length,
          goalsCount: goals.length
        });
      } catch (error) {
        console.error('❌ Failed to initialize app:', error);
        // ⚠️ FIX: Mostra errore ma NON svuotare state
        // L'utente può ancora vedere dati esistenti
      } finally {
        setIsLoading(false);
        hasInitialized.current = true;
      }
    };

    initializeApp();
  }, [currentUser?.uid, authLoading]);

  // Update KPIs periodically
  useEffect(() => {
    const updateKPIs = async () => {
      try {
        if (currentUser) {
          const kpis = await db.calculateTodayKPIs(currentUser.uid);
          setTodayKPIs(kpis);
        }
      } catch (error) {
        console.error('Failed to update KPIs:', error);
      }
    };

    updateKPIs();
    const interval = setInterval(updateKPIs, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [currentSession, currentUser]);

  // Reload analytics when timeRange changes
  useEffect(() => {
    if (!isLoading && analyticsData) {
      loadAnalyticsData();
    }
  }, [timeRange, isLoading]);

  // Update current time block
  useEffect(() => {
    const updateCurrentTimeBlock = () => {
      const now = new Date();
      const activeBlock = timeBlocks.find(block => 
        block.startTime <= now && 
        block.endTime >= now && 
        block.status !== 'completed'
      );
      setCurrentTimeBlock(activeBlock || null);
    };

    updateCurrentTimeBlock();
    const interval = setInterval(updateCurrentTimeBlock, 10000); // Update every 10 seconds

    return () => clearInterval(interval);
  }, [timeBlocks]);

  const loadData = async () => {
    if (typeof window === 'undefined') {
      console.warn('Skipping loadData on server environment');
      return;
    }
    
    // ⚠️ FIX: CRITICAL - Verifica che adapter sia pronto prima di procedere
    const adapterInfo = db.getAdapterDebugInfo();
    const currentUserId = currentUser?.uid;
    
    // Se user loggato ma adapter non è Firebase o userId non settato, NON procedere
    if (currentUserId) {
      // ⚠️ TEMP: Disabled Firebase check - always load from IndexedDB
      /*
      if (!db.isUsingFirebase) {
        console.warn('⚠️ loadData() SKIPPED: User logged in but adapter is not Firebase', {
          adapterType: adapterInfo.adapterType,
          useFirebase: db.isUsingFirebase
        });
        return; // ⚠️ NON sovrascrivere state con []
      }
      */
      
      // ⚠️ TEMP: Disabled userId mismatch check for IndexedDB
      /*
      if (adapterInfo.userId !== currentUserId) {
        console.warn('⚠️ loadData() SKIPPED: Adapter userId mismatch', {
          adapterUserId: adapterInfo.userId,
          currentUserId
        });
        return; // ⚠️ NON sovrascrivere state con []
      }
      */
    }
    
    try {
      // ⚠️ FIX: Logging chirurgico per debug adapter e userId
      console.log('📊 loadData() START', {
        adapterType: adapterInfo.adapterType,
        useFirebase: db.isUsingFirebase,
        adapterUserId: adapterInfo.userId,
        currentUserId: currentUserId,
        adapterInitialized: adapterInfo.isInitialized,
        timestamp: new Date().toISOString()
      });
      
      console.log('🔥 PSYCHOPATH: === STARTING loadData() ===');
      console.log('🔥 PSYCHOPATH: Database info:', {
        isUsingFirebase: db.isUsingFirebase,
        currentUser: currentUserId
      });
      
      const [
        allTimeBlocks,
        allGoals,
        allKeyResults,
        allProjects,
        allTasks,
        allHabits,
        allHabitLogs
      ] = await Promise.all([
        db.getAll<TimeBlock>('timeBlocks'),
        db.getAll<Goal>('goals'),
        db.getAll<KeyResult>('keyResults'),
        db.getAll<Project>('projects'),
        db.getAll<Task>('tasks'),
        db.getAll<Habit>('habits'),
        db.getAll<HabitLog>('habitLogs')
      ]);
      
      // ⚠️ FIX: Logging chirurgico per verificare dati recuperati
      console.log('📊 loadData() RETRIEVED', {
        adapterUsed: adapterInfo.adapterType,
        totalTimeBlocks: allTimeBlocks.length,
        totalGoals: allGoals.length,
        totalKeyResults: allKeyResults.length,
        totalProjects: allProjects.length,
        totalTasks: allTasks.length,
        totalHabits: allHabits.length,
        totalHabitLogs: allHabitLogs.length,
        timestamp: new Date().toISOString()
      });
      
      console.log('🔥 PSYCHOPATH: Raw data retrieved from database:', {
        timeBlocks: allTimeBlocks.length,
        goals: allGoals.length,
        keyResults: allKeyResults.length,
        projects: allProjects.length,
        tasks: allTasks.length,
        habits: allHabits.length,
        habitLogs: allHabitLogs.length
      });

      // 🔥 PSYCHOPATH CRITICAL FIX: Filter ALL data by userId
      const filterUserId = currentUserId || 'user-1';
      
      // 🔧 FIX: Deserialize dates from IndexedDB (dates are stored as strings) AND FILTER BY USER
      const deserializedTimeBlocks = allTimeBlocks
        .filter(block => block.userId === filterUserId) // 🔥 CRITICAL: Filter by user
        .map(block => ({
          ...block,
          startTime: new Date(block.startTime),
          endTime: new Date(block.endTime),
          createdAt: new Date(block.createdAt),
          updatedAt: new Date(block.updatedAt),
          actualStartTime: block.actualStartTime ? new Date(block.actualStartTime) : undefined,
          actualEndTime: block.actualEndTime ? new Date(block.actualEndTime) : undefined,
        }));

      console.log('🔥 Loaded timeBlocks for user', filterUserId, ':', deserializedTimeBlocks.map(b => ({id: b.id, userId: b.userId})));

      // 🔥 PSYCHOPATH CRITICAL FIX: Filter ALL collections by userId
      const userGoals = allGoals.filter(item => item.userId === filterUserId);
      const userKeyResults = allKeyResults.filter(item => item.userId === filterUserId);
      const userProjects = allProjects.filter(item => item.userId === filterUserId);
      const userTasks = allTasks.filter(item => item.userId === filterUserId);
      const userHabits = allHabits.filter(item => item.userId === filterUserId);
      const userHabitLogs = allHabitLogs.filter(item => item.userId === filterUserId);

      console.log('🔥 PSYCHOPATH: Data loaded and filtered:', {
        totalTimeBlocks: allTimeBlocks.length,
        userTimeBlocks: deserializedTimeBlocks.length,
        totalGoals: allGoals.length,
        userGoals: userGoals.length,
        currentUserId
      });

      // 🔥 PSICOPATICO DEBUG: Let's see what's in the goals!
      console.log('🔥 PSICOPATICO GOALS DEBUG:', {
        allGoalsDetailed: allGoals.map(g => ({ id: g.id, title: g.title, userId: g.userId })),
        userGoalsDetailed: userGoals.map(g => ({ id: g.id, title: g.title, userId: g.userId })),
        currentUserIdType: typeof currentUserId,
        currentUserIdValue: currentUserId
      });

      setTimeBlocks(deserializedTimeBlocks);
      setGoals(userGoals);
      setKeyResults(userKeyResults);
      setProjects(userProjects);
      setTasks(userTasks);
      setHabits(userHabits);
      setHabitLogs(userHabitLogs);

      // Load current session
      // ⚠️ FIX: CRITICAL - Verifica che adapter sia pronto prima di chiamare getActiveSessions
      if (currentUser && db.isUsingFirebase) {
        const adapterInfo = db.getAdapterDebugInfo();
        if (adapterInfo.userId === currentUser.uid) {
          try {
            const activeSessions = await db.getActiveSessions(currentUser.uid);
            if (activeSessions.length > 0) {
              setCurrentSession(activeSessions[0]);
            }
          } catch (error) {
            console.warn('⚠️ Failed to load active sessions:', error);
            // Non bloccare il resto del caricamento
          }
        }
      }

      // Load analytics data and user stats
      if (currentUser) {
        await loadAnalyticsData();
        await calculateUserStats();
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  };

  const migrateLocalDataToFirebase = async (localData: {
    timeBlocks: TimeBlock[];
    goals: Goal[];
    projects: Project[];
    tasks: Task[];
    habits: Habit[];
    habitLogs: HabitLog[];
  }) => {
    if (!currentUser?.uid || !db.isUsingFirebase) return;
    
    try {
      console.log('🔄 Migrating local data to Firebase...', {
        timeBlocks: localData.timeBlocks.length,
        goals: localData.goals.length,
        projects: localData.projects.length
      });
      
      // Migrate timeBlocks
      for (const block of localData.timeBlocks) {
        if (!timeBlocks.find(b => b.id === block.id)) {
          await db.create('timeBlocks', block);
          setTimeBlocks(prev => [...prev, block]);
        }
      }
      
      // Migrate goals
      for (const goal of localData.goals) {
        if (!goals.find(g => g.id === goal.id)) {
          await db.create('goals', goal);
          setGoals(prev => [...prev, goal]);
        }
      }
      
      // Migrate projects
      for (const project of localData.projects) {
        if (!projects.find(p => p.id === project.id)) {
          await db.create('projects', project);
          setProjects(prev => [...prev, project]);
        }
      }
      
      // Migrate tasks
      for (const task of localData.tasks) {
        if (!tasks.find(t => t.id === task.id)) {
          await db.create('tasks', task);
          setTasks(prev => [...prev, task]);
        }
      }
      
      // Migrate habits
      for (const habit of localData.habits) {
        if (!habits.find(h => h.id === habit.id)) {
          await db.create('habits', habit);
          setHabits(prev => [...prev, habit]);
        }
      }
      
      // Migrate habitLogs
      for (const log of localData.habitLogs) {
        if (!habitLogs.find(l => l.id === log.id)) {
          await db.create('habitLogs', log);
          setHabitLogs(prev => [...prev, log]);
        }
      }
      
      console.log('✅ Migration completed');
    } catch (error) {
      console.error('❌ Migration failed:', error);
    }
  };

  const calculateUserStats = async () => {
    try {
      const allSessions = await db.getAll<Session>('sessions');
      const userSessions = allSessions.filter(s => s.userId === (currentUser?.uid || 'user-1')); // 🔥 FIX: Use real userId
      
      // Calculate max streak from habits (real data)
      const maxStreak = habits.reduce((max, habit) => Math.max(max, habit.streakCount || 0), 0);
      
      // Calculate total focus minutes from actual sessions
      const focusSessions = userSessions.filter(s => s.tags && s.tags.includes('focus'));
      const totalFocusMinutes = focusSessions.reduce((total, s) => total + (s.duration || 0), 0) / 60;

      // Calculate goals completed and created (real data)
      const goalsCompleted = goals.filter(g => g.status === 'completed').length;
      const goalsCreated = goals.length;

      // Calculate total sessions and time blocks created (real data)
      const totalSessions = userSessions.length;
      const timeBlocksCreated = timeBlocks.length;

      // Calculate REAL days tracked based on actual data
      const uniqueDays = new Set();
      userSessions.forEach(session => {
        const day = new Date(session.startTime).toDateString();
        uniqueDays.add(day);
      });
      // Include today if user has used the app today
      if (userSessions.some(s => new Date(s.startTime).toDateString() === new Date().toDateString()) || 
          timeBlocks.length > 0 || goals.length > 0 || habits.length > 0) {
        uniqueDays.add(new Date().toDateString());
      }
      const daysTracked = uniqueDays.size;

      // Early sessions (before 8 AM) - real data
      const earlySessionsCount = userSessions.filter(s => {
        const hour = new Date(s.startTime).getHours();
        return hour < 8;
      }).length;

      // Evening sessions (after 6 PM) - real data  
      const eveningSessionsCount = userSessions.filter(s => {
        const hour = new Date(s.startTime).getHours();
        return hour >= 18;
      }).length;

      // Weekly focus minutes (real data from last 7 days)
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentFocusSessions = userSessions.filter(s => 
        new Date(s.startTime) >= oneWeekAgo && 
        s.tags && s.tags.includes('focus')
      );
      const weeklyFocusMinutes = recentFocusSessions.reduce((total, s) => total + (s.duration || 0), 0) / 60;

      setUserStats({
        maxStreak,
        totalFocusMinutes,
        goalsCompleted,
        goalsCreated,
        totalSessions,
        timeBlocksCreated,
        daysTracked,
        earlySessionsCount,
        eveningSessionsCount,
        weeklyFocusMinutes
      });
    } catch (error) {
      console.error('Failed to calculate user stats:', error);
    }
  };

  const loadAnalyticsData = async () => {
    try {
      setAnalyticsLoading(true);
      
      const userId = currentUser?.uid || 'user-1'; // 🔥 FIX: Use real userId
      const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;

      const [
        planVsActual,
        timeAllocation,
        focusTrend,
        correlations,
        weeklyReview
      ] = await Promise.all([
        db.calculatePlanVsActualData(userId, days),
        db.calculateTimeAllocation(userId, days),
        db.calculateFocusTrend(userId, days),
        db.calculateCorrelations(userId, days),
        db.generateWeeklyReview(userId)
      ]);

      // Check if we have enough data
      const hasEnoughData = planVsActual.length > 0 || timeAllocation.length > 0 || focusTrend.length > 0;

      if (!hasEnoughData) {
        // Show empty state instead of fake data
        setAnalyticsData({
          planVsActual: [],
          timeAllocation: [],
          focusTrend: [],
          correlations: [],
          weeklyReview: {
            highlights: ['Start tracking to see your patterns'],
            challenges: ['No data available yet'],
            insights: ['Create time blocks and sessions to generate insights'],
            nextWeekGoals: ['Begin using the Life Tracker consistently']
          }
        });
      } else {
        setAnalyticsData({
          planVsActual,
          timeAllocation,
          focusTrend,
          correlations,
          weeklyReview
        });
      }

      setAnalyticsLoading(false);
    } catch (error) {
      console.error('Failed to load analytics data:', error);
      setAnalyticsLoading(false);
    }
  };

  // Session management functions
  // 🚀 ENHANCED: Session management with TimeBlock integration
  const handleStartSession = async (taskId?: string, timeBlockId?: string) => {
    try {
      const session = await sessionManager.startSession(
        taskId, 
        timeBlockId, 
        'default',
        currentUser?.uid || 'user-1'
      );
      setCurrentSession(session);
      
      // 🎮 GAMING: Session start sound
      audioManager.buttonFeedback();
      
      console.log(`🚀 SESSION: Started${timeBlockId ? ' from TimeBlock' : ''}`);
    } catch (error) {
      console.error('Failed to start session:', error);
    }
  };
  
  // 🚀 NEW: Start session directly from TimeBlock
  const handleStartTimeBlockSession = async (timeBlockId: string) => {
    try {
      await handleStartSession(undefined, timeBlockId);
    } catch (error) {
      console.error('Failed to start timeblock session:', error);
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
      
      // 🚀 PERFORMANCE: Direct state update instead of full reload
      if (completedSession) {
        // Update KPIs immediately with new session data
        const updatedKPIs = await db.calculateTodayKPIs(currentUser?.uid || 'user-1');
        setTodayKPIs(updatedKPIs);
      }
    } catch (error) {
      console.error('Failed to stop session:', error);
    }
  };

  // Time block management
  const handleCreateTimeBlock = async (blockData: Partial<TimeBlock>) => {
    // ⚠️ TEMP: Disabled Firebase switching - use IndexedDB only
    
    if (process.env.NODE_ENV === 'development') {
      console.log('🔥 DEV LOG: Add TimeBlock clicked', {
        adapter: db.getAdapterDebugInfo(),
        useFirebase: db.isUsingFirebase,
        userId: currentUser?.uid,
        blockData
      });
    }
    
    console.log('🔥 PSYCHOPATH: === STARTING handleCreateTimeBlock ===');
    console.log('🔥 PSYCHOPATH: Input data:', blockData);
    setTimeBlockError(null);
    let blockToCreate: TimeBlock | null = null;
    
    try {
      console.log('🔥 PSYCHOPATH: Database adapter type:', db.isUsingFirebase ? 'Firebase' : 'IndexedDB');
      const adapterInfo = db.getAdapterDebugInfo();

      const startTime = blockData.startTime ? new Date(blockData.startTime) : new Date();
      const endTime = blockData.endTime ? new Date(blockData.endTime) : new Date(startTime.getTime() + 60 * 60 * 1000);
      const createdAt = blockData.createdAt ? new Date(blockData.createdAt) : new Date();
      const updatedAt = blockData.updatedAt ? new Date(blockData.updatedAt) : new Date();
      const userId = currentUser?.uid; // No fallback in Firebase mode
      
      // 🔥 PSYCHOPATH FIX: Ensure proper data structure with unique ID
      blockToCreate = {
        ...blockData,
        id: `timeblock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId, // 🔥 FIX: Use real userId
        domainId: blockData.domainId || 'domain-1',
        startTime,
        endTime,
        createdAt,
        updatedAt,
      } as TimeBlock;
      const optimisticBlock = blockToCreate as TimeBlock;
      
      console.log('🔥 PSYCHOPATH: About to create block with:', optimisticBlock);
      // Optimistic UI update
      setTimeBlocks(prev => [...prev, optimisticBlock]);
      
      // 🔥 ACTUAL DATABASE CALL WITH PROPER ERROR HANDLING
      const createdBlock = await db.create<TimeBlock>('timeBlocks', optimisticBlock);
      console.log('🔥 PSYCHOPATH: ✅ Database create SUCCESS:', createdBlock);
      
      // 🔥 PSYCHOPATH CRITICAL FIX: Deserialize dates for newly created block
      const deserializedBlock = {
        ...createdBlock,
        startTime: new Date(createdBlock.startTime),
        endTime: new Date(createdBlock.endTime),
        createdAt: new Date(createdBlock.createdAt),
        updatedAt: new Date(createdBlock.updatedAt),
        actualStartTime: createdBlock.actualStartTime ? new Date(createdBlock.actualStartTime) : undefined,
        actualEndTime: createdBlock.actualEndTime ? new Date(createdBlock.actualEndTime) : undefined,
      };
      
      // Update state with the created block
      setTimeBlocks(prev => prev.map(block => block.id === optimisticBlock.id ? deserializedBlock : block));
      console.log('🔥 PSYCHOPATH: Updating state. Old count:', timeBlocks.length, 'New count:', timeBlocks.length);
      console.log('🔥 PSYCHOPATH: New block dates:', {
        startTime: deserializedBlock.startTime,
        endTime: deserializedBlock.endTime,
        startTimeType: typeof deserializedBlock.startTime,
        endTimeType: typeof deserializedBlock.endTime
      });
      console.log('🔥 PSYCHOPATH: ✅ State updated successfully');
      
      // 🚀 PERFORMANCE: Direct state update - NO MORE FORCE RELOAD!
      console.log('🚀 PERFORMANCE: TimeBlock created, updating state directly');
      
      // 🎮 GAMING: Celebrate successful time block creation
      audioManager.taskCompleted();
      
      if (process.env.NODE_ENV === 'development') {
        console.log('🔥 DEV LOG: Add TimeBlock SUCCESS', {
          adapter: db.getAdapterDebugInfo(),
          useFirebase: db.isUsingFirebase,
          userId: currentUser?.uid,
          createdBlock: deserializedBlock
        });
      }
      
    } catch (error: any) {
      console.error('❌ PSYCHOPATH: CRITICAL ERROR in handleCreateTimeBlock:', error);
      console.error('❌ PSYCHOPATH: Error details:', {
        name: error?.name,
        message: error?.message,
        stack: error?.stack
      });
      const tempId = blockToCreate ? blockToCreate.id : null;
      setTimeBlocks(prev => tempId ? prev.filter(block => block.id !== tempId) : prev);
      setTimeBlockError(error?.message || 'Unable to save the time block. Please try again or check your connection.');
      
      if (process.env.NODE_ENV === 'development') {
        console.log('🔥 DEV LOG: Add TimeBlock FAILED', {
          adapter: db.getAdapterDebugInfo(),
          useFirebase: db.isUsingFirebase,
          userId: currentUser?.uid,
          error: error?.message
        });
      }
    }
    
    console.log('🔥 PSYCHOPATH: === ENDING handleCreateTimeBlock ===');
  };

  const handleUpdateTimeBlock = async (id: string, updates: Partial<TimeBlock>) => {
    try {
      const existingBlock = timeBlocks.find(b => b.id === id);
      if (existingBlock) {
        const updatedBlock = { ...existingBlock, ...updates, updatedAt: new Date() };
        await db.update('timeBlocks', updatedBlock);
        setTimeBlocks(timeBlocks.map(b => b.id === id ? updatedBlock : b));
      }
    } catch (error) {
      console.error('Failed to update time block:', error);
    }
  };

  const handleDeleteTimeBlock = async (id: string) => {
    try {
      await db.delete('timeBlocks', id);
      setTimeBlocks(timeBlocks.filter(b => b.id !== id));
    } catch (error) {
      console.error('Failed to delete time block:', error);
    }
  };

  // Habit management
  const handleCreateHabit = async (habitData: Partial<Habit>) => {
    try {
      console.log('🔥 PSYCHOPATH: Creating habit:', habitData);
      const newHabit = await db.create<Habit>('habits', habitData as Habit);
      console.log('🔥 PSYCHOPATH: Habit created successfully:', newHabit);
      
      // 🔥 PSYCHOPATH FIX: Deserialize dates
      const deserializedHabit = {
        ...newHabit,
        createdAt: new Date(newHabit.createdAt),
        updatedAt: new Date(newHabit.updatedAt)
      };
      
      const updatedHabits = [...habits, deserializedHabit];
      console.log('🔥 PSYCHOPATH: Habits count before:', habits.length, 'after:', updatedHabits.length);
      setHabits(updatedHabits);
      
      // 🚀 PERFORMANCE: State already updated above - no reload needed
      console.log('🚀 PERFORMANCE: Habit created and state updated efficiently');
      
      // 🎮 GAMING: New habit created sound
      audioManager.play('achievementUnlock');
    } catch (error) {
      console.error('Failed to create habit:', error);
    }
  };

  const handleUpdateHabit = async (id: string, updates: Partial<Habit>) => {
    try {
      const existingHabit = habits.find(h => h.id === id);
      if (existingHabit) {
        const updatedHabit = { ...existingHabit, ...updates, updatedAt: new Date() };
        await db.update('habits', updatedHabit);
        setHabits(habits.map(h => h.id === id ? updatedHabit : h));
      }
    } catch (error) {
      console.error('Failed to update habit:', error);
    }
  };

  const handleDeleteHabit = async (id: string) => {
    try {
      await db.delete('habits', id);
      setHabits(habits.filter(h => h.id !== id));
    } catch (error) {
      console.error('Failed to delete habit:', error);
    }
  };

  const handleLogHabit = async (habitId: string, completed: boolean, value?: number, notes?: string) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Check if log already exists for today
      const existingLog = habitLogs.find(log => 
        log.habitId === habitId && 
        new Date(log.date).toDateString() === today.toDateString()
      );

      if (existingLog) {
        const updatedLog = { ...existingLog, completed, value, notes, createdAt: new Date() };
        await db.update('habitLogs', updatedLog);
        setHabitLogs(habitLogs.map(log => log.id === existingLog.id ? updatedLog : log));
      } else {
        const newLog: HabitLog = {
          id: `log-${Date.now()}`,
          habitId,
          userId: currentUser?.uid || 'user-1', // 🔥 FIX: Use real userId
          date: today,
          completed,
          value,
          notes,
          createdAt: new Date(),
        };
        await db.create('habitLogs', newLog);
        setHabitLogs([...habitLogs, newLog]);
      }
    } catch (error) {
      console.error('Failed to log habit:', error);
    }
  };

  // OKR management functions
  const handleCreateGoal = async (goalData: Partial<Goal>) => {
    // ⚠️ TEMP: Disabled Firebase switching - use IndexedDB only
    
    if (process.env.NODE_ENV === 'development') {
      console.log('🔥 DEV LOG: Add Goal clicked', {
        adapter: db.getAdapterDebugInfo(),
        useFirebase: db.isUsingFirebase,
        userId: currentUser?.uid,
        goalData
      });
    }
    
    try {
      console.log('🔥 PSYCHOPATH: Creating goal:', goalData);
      
      // 🔥 PSICOPATICO CRITICAL FIX: Ensure userId is properly set
      const goalToCreate: Goal = {
        ...goalData,
        id: `goal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: currentUser?.uid, // No fallback in Firebase mode
        domainId: goalData.domainId || 'domain-1',
        status: goalData.status || 'active',
        targetDate: goalData.targetDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Default 30 days from now
        keyResults: [],
        timeAllocationTarget: goalData.timeAllocationTarget || 0,
        priority: goalData.priority || 'medium',
        category: goalData.category || 'important_not_urgent',
        complexity: goalData.complexity || 'moderate',
        createdAt: new Date(),
        updatedAt: new Date()
      } as Goal;
      
      console.log('🔥 PSICOPATICO GOAL CREATION DEBUG:', {
        goalToCreateUserId: goalToCreate.userId,
        expectedUserId: currentUser?.uid || 'user-1',
        userIdMatch: goalToCreate.userId === (currentUser?.uid || 'user-1'),
        goalTitle: goalToCreate.title,
        goalToCreate: goalToCreate
      });
      
      const newGoal = await db.create<Goal>('goals', goalToCreate);
      console.log('🔥 PSYCHOPATH: Goal created successfully:', newGoal);
      
      // 🔥 PSYCHOPATH FIX: Deserialize dates
      const deserializedGoal = {
        ...newGoal,
        targetDate: new Date(newGoal.targetDate),
        createdAt: new Date(newGoal.createdAt),
        updatedAt: new Date(newGoal.updatedAt)
      };
      
      // ⚠️ FIX: CRITICAL - Usa functional update per evitare state stale
      setGoals(prevGoals => {
        // Verifica che goal non esista già (evita duplicati)
        if (prevGoals.find(g => g.id === deserializedGoal.id)) {
          console.warn('⚠️ Goal already exists in state, updating instead');
          return prevGoals.map(g => g.id === deserializedGoal.id ? deserializedGoal : g);
        }
        const updatedGoals = [...prevGoals, deserializedGoal];
        console.log('🔥 PSYCHOPATH: Goals count before:', prevGoals.length, 'after:', updatedGoals.length);
        return updatedGoals;
      });
      
      // 🚀 PERFORMANCE: State already updated above - no reload needed
      console.log('🚀 PERFORMANCE: Goal created and state updated efficiently');
      
      if (process.env.NODE_ENV === 'development') {
        console.log('🔥 DEV LOG: Add Goal SUCCESS', {
          adapter: db.getAdapterDebugInfo(),
          useFirebase: db.isUsingFirebase,
          userId: currentUser?.uid,
          createdGoal: deserializedGoal
        });
      }
    } catch (error: any) {
      console.error('❌ PSYCHOPATH: Failed to create goal:', error);
      
      if (process.env.NODE_ENV === 'development') {
        console.log('🔥 DEV LOG: Add Goal FAILED', {
          adapter: db.getAdapterDebugInfo(),
          useFirebase: db.isUsingFirebase,
          userId: currentUser?.uid,
          error: error?.message
        });
      }
    }
  };

  const handleUpdateGoal = async (id: string, updates: Partial<Goal>) => {
    try {
      const existingGoal = goals.find(g => g.id === id);
      if (existingGoal) {
        const updatedGoal = { ...existingGoal, ...updates, updatedAt: new Date() };
        await db.update('goals', updatedGoal);
        setGoals(goals.map(g => g.id === id ? updatedGoal : g));
      }
    } catch (error) {
      console.error('Failed to update goal:', error);
    }
  };

  const handleCreateKeyResult = async (keyResultData: Partial<KeyResult>) => {
    try {
      console.log('🔥 PSYCHOPATH: Creating key result:', keyResultData);
      
      // 🔥 PSICOPATICO CRITICAL FIX: Ensure KeyResult has all required fields
      const keyResultToCreate: KeyResult = {
        ...keyResultData,
        id: `keyresult-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: currentUser?.uid || 'user-1', // 🔥 FORCE userId
        goalId: keyResultData.goalId || '',
        currentValue: keyResultData.currentValue || 0,
        progress: 0, // Start at 0%
        status: keyResultData.status || 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      } as KeyResult;
      
      const newKeyResult = await db.create<KeyResult>('keyResults', keyResultToCreate);
      console.log('🔥 PSYCHOPATH: Key Result created successfully:', newKeyResult);
      
      const updatedKeyResults = [...keyResults, newKeyResult];
      setKeyResults(updatedKeyResults);
      
      // 🚀 PERFORMANCE: State already updated above - no reload needed
      console.log('🚀 PERFORMANCE: KeyResult created and state updated efficiently');
    } catch (error) {
      console.error('❌ PSYCHOPATH: Failed to create key result:', error);
    }
  };

  const handleUpdateKeyResult = async (id: string, updates: Partial<KeyResult>) => {
    try {
      console.log('🔥 PSYCHOPATH: Updating key result:', { id, updates });
      
      const existingKR = keyResults.find(kr => kr.id === id);
      if (existingKR) {
        const updatedKR = { ...existingKR, ...updates, updatedAt: new Date() };
        await db.update('keyResults', updatedKR);
        
        const updatedKeyResults = keyResults.map(kr => kr.id === id ? updatedKR : kr);
        setKeyResults(updatedKeyResults);
        
        console.log('🔥 PSYCHOPATH: Key Result updated successfully:', {
          oldProgress: existingKR.progress,
          newProgress: updatedKR.progress,
          oldStatus: existingKR.status,
          newStatus: updatedKR.status
        });
        
        // 🎮 GAMING: Play progress sound based on achievement
        if (updatedKR.progress >= 100 && existingKR.progress < 100) {
          audioManager.perfectDay(); // Goal completed!
        } else if (updatedKR.progress > existingKR.progress) {
          audioManager.taskCompleted(); // Progress made!
        }
        
        // 🚀 PERFORMANCE: Goal percentages will auto-update on next render
        // No need to reload - React state management handles this efficiently
      }
    } catch (error) {
      console.error('❌ PSYCHOPATH: Failed to update key result:', error);
    }
  };

  const handleCreateProject = async (projectData: Partial<Project>) => {
    // ⚠️ TEMP: Disabled Firebase switching - use IndexedDB only
    
    if (process.env.NODE_ENV === 'development') {
      console.log('🔥 DEV LOG: Add Project clicked', {
        adapter: db.getAdapterDebugInfo(),
        useFirebase: db.isUsingFirebase,
        userId: currentUser?.uid,
        projectData
      });
    }
    
    try {
      const newProject = await db.create<Project>('projects', projectData as Project);
      setProjects([...projects, newProject]);
      
      if (process.env.NODE_ENV === 'development') {
        console.log('🔥 DEV LOG: Add Project SUCCESS', {
          adapter: db.getAdapterDebugInfo(),
          useFirebase: db.isUsingFirebase,
          userId: currentUser?.uid,
          createdProject: newProject
        });
      }
    } catch (error: any) {
      console.error('Failed to create project:', error);
      
      if (process.env.NODE_ENV === 'development') {
        console.log('🔥 DEV LOG: Add Project FAILED', {
          adapter: db.getAdapterDebugInfo(),
          useFirebase: db.isUsingFirebase,
          userId: currentUser?.uid,
          error: error?.message
        });
      }
    }
  };

  const handleUpdateProject = async (id: string, updates: Partial<Project>) => {
    try {
      const existingProject = projects.find(p => p.id === id);
      if (existingProject) {
        const updatedProject = { ...existingProject, ...updates, updatedAt: new Date() };
        await db.update('projects', updatedProject);
        setProjects(projects.map(p => p.id === id ? updatedProject : p));
      }
    } catch (error) {
      console.error('Failed to update project:', error);
    }
  };

  const handleBadgeUnlocked = (badge: any) => {
    // Show celebration toast or animation
    console.log('Badge unlocked:', badge.name);
  };

  const handleCreateTask = async (taskData: Partial<Task>) => {
    try {
      const newTask = await db.create<Task>('tasks', taskData as Task);
      setTasks([...tasks, newTask]);
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  const handleUpdateTask = async (id: string, updates: Partial<Task>) => {
    try {
      const existingTask = tasks.find(t => t.id === id);
      if (existingTask) {
        const updatedTask = { ...existingTask, ...updates, updatedAt: new Date() };
        await db.update('tasks', updatedTask);
        setTasks(tasks.map(t => t.id === id ? updatedTask : t));
      }
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  };

  // Default empty analytics data for loading state
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

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-8">
            <div className="w-20 h-20 border-4 border-primary-200 rounded-full border-r-primary-600" style={{ animation: 'spin 1s linear infinite' }}></div>
          </div>
          <h2 className="heading-1 text-neutral-900 mb-4">Life Tracker</h2>
          <p className="text-body text-lg">
            {authLoading ? 'Checking authentication...' : 'Initializing system...'}
          </p>
          <div className="mt-6 flex justify-center space-x-2">
            {[...Array(3)].map((_, i) => (
              <div 
                key={i}
                className="w-3 h-3 rounded-full bg-primary-500"
                style={{ animation: 'pulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.3}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* 🎮 GAMING EFFECTS OVERLAY */}
      <GamingEffects />
      
      {/* Auth Modal */}
      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => setShowAuthModal(false)} 
      />

      {/* Daily Motivation */}
      {currentUser && <DailyMotivation />}

      {/* NOW Bar - Professional Header */}
      <div className="card fixed top-0 left-0 right-0 z-40 border-l-0 border-r-0 border-t-0 rounded-none">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          {/* Left side - NOW Bar */}
          <div className="flex-1">
            <NowBar
              currentSession={currentSession}
              currentTimeBlock={currentTimeBlock}
              onStartSession={handleStartSession}
              onPauseSession={handlePauseSession}
              onStopSession={handleStopSession}
            />
          </div>
          
          {/* Right side - User controls */}
          <div className="flex items-center space-x-4 ml-4">
            {currentUser ? (
              <div className="flex items-center space-x-4">
                {/* Sync status indicator */}
                <SyncStatusIndicator />
                
                {/* User info */}
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white text-sm font-bold">
                    {currentUser.displayName?.[0] || currentUser.email?.[0] || 'U'}
                  </div>
                  <div className="hidden md:block">
                    <div className="text-sm font-medium text-neutral-900">
                      {currentUser.displayName || 'User'}
                    </div>
                    <div className="text-xs text-neutral-500">
                      {currentUser.email}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      auth.signOut();
                      audioManager.buttonFeedback();
                    }}
                    onMouseEnter={() => audioManager.buttonHover()}
                    className="btn btn-outline text-xs px-3 py-1"
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => {
                  setShowAuthModal(true);
                  audioManager.buttonFeedback();
                }}
                onMouseEnter={() => audioManager.buttonHover()}
                className="btn btn-primary text-sm px-6 py-3"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content - Professional 2-Column Layout */}
      <div className="pt-24 pb-8 bg-neutral-50">
        {currentUser ? (
          <div className="container mx-auto">
            <div className="grid-responsive gap-6">
              {/* LEFT SIDEBAR - Control Panel */}
              <div className="space-y-6">
                {/* AI Brain - Compact & Clean */}
                <div className="card card-body">
                  <div className="mb-4">
                    <h3 className="heading-3 flex items-center gap-3">
                      🧠 AI Assistant
                      <span className="badge badge-primary text-xs">AI</span>
                    </h3>
                    <p className="text-small">
                      Create tasks and blocks with natural language
                    </p>
                  </div>
                  <AIInputBar
                    onCreateTimeBlock={handleCreateTimeBlock}
                    onCreateTask={handleCreateTask}
                    onCreateGoal={handleCreateGoal}
                    onCreateHabit={handleCreateHabit}
                    goals={goals}
                    existingTasks={tasks}
                    userPreferences={{}}
                    className="w-full"
                    currentUserId={currentUser?.uid} // 🔥 CRITICAL FIX: Pass real user ID
                  />
                </div>

                {/* KPI Dashboard - Clean Cards */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="heading-3">Today's Progress</h3>
                  </div>
                  <div className="card-body">
                    <KPIDashboard 
                      kpis={todayKPIs}
                      onRefresh={loadData}
                    />
                  </div>
                </div>

                {/* Module Navigation - Professional Cards */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="heading-3">Modules</h3>
                  </div>
                  <div className="card-body">
                    <div className="module-grid">
                      {[
                        { id: 'planner', label: 'Time Planner', icon: '📅', description: 'Plan and schedule your day' },
                        { id: 'smart_scheduler', label: 'Auto Scheduler', icon: '⚡', description: 'AI-powered scheduling' },
                        { id: 'adaptation', label: 'Auto-Replan', icon: '🔄', description: 'Real-time adaptation' },
                        { id: 'micro_coach', label: 'AI Coach', icon: '🧠', description: 'Performance insights' },
                        { id: 'habits', label: 'Habits', icon: '🔥', description: 'Track daily habits' },
                        { id: 'okr', label: 'Goals & Projects', icon: '🎯', description: 'Manage objectives' },
                        { id: 'analytics', label: 'Analytics', icon: '📊', description: 'Performance data' },
                        { id: 'goal_analytics', label: 'Goal Intelligence', icon: '🎯', description: 'Goal insights' },
                        { id: 'badges', label: 'Achievements', icon: '🏆', description: 'Track milestones' },
                      ].map(({ id, label, icon, description }) => (
                        <div
                          key={id}
                          onClick={() => {
                            setActiveTab(id as any);
                            audioManager.buttonFeedback();
                          }}
                          className={`module-card ${
                            activeTab === id ? 'active' : ''
                          }`}
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

              {/* RIGHT MAIN CONTENT - Focus Area */}
              <div className="card">
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

                  {/* Module Content */}
              {activeTab === 'planner' && (
                <>
                  {timeBlockError && (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {timeBlockError}
                    </div>
                  )}
                  {process.env.NODE_ENV !== 'production' && (
                    <div className="mb-3 text-xs text-gray-500">
                      Adapter: {adapterInfo.adapterType} | Mode: {adapterInfo.useFirebase ? 'Firebase' : 'IndexedDB'} | Adapter user: {(adapterInfo as any).userId || 'n/a'} | Active user: {currentUser?.uid || 'anon'} | Store: timeBlocks
                    </div>
                  )}
                  <TimeBlockPlanner
                    timeBlocks={timeBlocks}
                    tasks={tasks}
                    projects={projects}
                    goals={goals}
                    onCreateTimeBlock={handleCreateTimeBlock}
                    onUpdateTimeBlock={handleUpdateTimeBlock}
                    onDeleteTimeBlock={handleDeleteTimeBlock}
                    selectedDate={selectedDate}
                    onDateChange={setSelectedDate}
                    currentUserId={currentUser?.uid} // 🔥 CRITICAL FIX: Pass real user ID
                    isReady={isReady}
                  />
                </>
              )}

              {activeTab === 'smart_scheduler' && (
                <SmartScheduler
                  tasks={tasks}
                  existingTimeBlocks={timeBlocks}
                  goals={goals}
                  onScheduleGenerated={(schedule) => {
                    console.log('📅 New schedule generated:', schedule);
                    // You could update the timeBlocks state here if needed
                  }}
                  onTimeBlocksCreated={async (blocks) => {
                    console.log('⚡ Creating', blocks.length, 'time blocks from smart scheduler');
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
                  currentSchedule={timeBlocks}
                  tasks={tasks}
                  goals={goals}
                  currentSession={currentSession}
                  userEnergyLevel={0.7} // Could be dynamic based on user input or ML
                  onScheduleAdapted={async (newSchedule, changes) => {
                    console.log('🔄 SCHEDULE ADAPTED:', changes.length, 'changes');
                    // Update time blocks with the adapted schedule
                    setTimeBlocks(newSchedule);
                    audioManager.perfectDay();
                  }}
                  onEmergencyMode={(active, reason) => {
                    console.log('🚨 EMERGENCY MODE:', active, reason);
                    if (active) {
                      audioManager.play('error');
                    }
                  }}
                />
              )}

              {activeTab === 'micro_coach' && (
                <MicroCoachDashboard
                  goals={goals}
                  keyResults={keyResults}
                  tasks={tasks}
                  sessions={[]} // Pass actual sessions here when available
                  habitLogs={habitLogs}
                  timeBlocks={timeBlocks}
                  onInsightAction={(action, insight) => {
                    console.log('🧠 INSIGHT ACTION:', action, insight.title);
                    if (action === 'implement') {
                      audioManager.perfectDay();
                      // Could show implementation modal or guide
                    }
                  }}
                />
              )}

              {activeTab === 'habits' && (
                <HabitsTracker
                  habits={habits}
                  habitLogs={habitLogs}
                  onCreateHabit={handleCreateHabit}
                  onUpdateHabit={handleUpdateHabit}
                  onDeleteHabit={handleDeleteHabit}
                  onLogHabit={handleLogHabit}
                  currentUserId={currentUser?.uid} // 🔥 CRITICAL FIX: Pass real user ID
                />
              )}

              {activeTab === 'okr' && (
                <OKRManager
                  goals={goals}
                  keyResults={keyResults}
                  projects={projects}
                  tasks={tasks}
                  onCreateGoal={handleCreateGoal}
                  onUpdateGoal={handleUpdateGoal}
                  onCreateKeyResult={handleCreateKeyResult}
                  onUpdateKeyResult={handleUpdateKeyResult}
                  onCreateProject={handleCreateProject}
                  onUpdateProject={handleUpdateProject}
                  onCreateTask={handleCreateTask}
                  onUpdateTask={handleUpdateTask}
                  currentUserId={currentUser?.uid} // 🔥 CRITICAL FIX: Pass real user ID
                  isReady={isReady}
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
                  goals={goals}
                  userId={currentUser?.uid || 'user-1'}
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
        ) : (
          // Landing page for non-authenticated users
          <div className="max-w-4xl mx-auto px-4 text-center py-20">
            <div className="space-y-8">
              <h1 className="heading-1 text-4xl md:text-6xl text-neutral-900 mb-6">
                Life Tracker
              </h1>
              <p className="text-xl text-neutral-600 max-w-2xl mx-auto leading-relaxed">
                Transform your productivity with evidence-based time tracking, habit formation, and goal achievement. 
                Know every second what to do.
              </p>
              
              <div className="grid md:grid-cols-3 gap-8 mt-16">
                <div className="card card-body text-center">
                  <div className="text-4xl mb-4">🚀</div>
                  <h3 className="heading-3 mb-3">Smart Planning</h3>
                  <p className="text-body">
                    Drag-and-drop timeboxing with automatic conflict detection and real-time adjustments.
                  </p>
                </div>
                
                <div className="card card-body text-center">
                  <div className="text-4xl mb-4">🔥</div>
                  <h3 className="heading-3 mb-3">Habit Mastery</h3>
                  <p className="text-body">
                    Build lasting habits with streak tracking, implementation intentions, and smart reminders.
                  </p>
                </div>
                
                <div className="card card-body text-center">
                  <div className="text-4xl mb-4">📊</div>
                  <h3 className="heading-3 mb-3">Deep Analytics</h3>
                  <p className="text-body">
                    Correlation analysis, performance trends, and actionable insights powered by your data.
                  </p>
                </div>
              </div>
              
              <div className="mt-12">
                <button
                  onClick={() => {
                    setShowAuthModal(true);
                    audioManager.buttonFeedback();
                  }}
                  onMouseEnter={() => audioManager.buttonHover()}
                  className="btn btn-primary text-lg px-10 py-5"
                >
                  🚀 Start Your Journey
                </button>
                <p className="text-small mt-4">
                  Free to use • Cloud sync with Firebase • Offline capable
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
