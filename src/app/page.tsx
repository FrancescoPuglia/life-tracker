'use client';

import { useState, useEffect } from 'react';
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
  const [activeTab, setActiveTab] = useState<'planner' | 'habits' | 'okr' | 'analytics' | 'goal_analytics' | 'badges'>('planner');
  const [selectedGoalId, setSelectedGoalId] = useState<string | undefined>();
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [isLoading, setIsLoading] = useState(true);

  const sessionManager = SessionManager.getInstance();

  // Initialize auth state listener
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChange((user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });

    return unsubscribe;
  }, [auth]);

  // Initialize database and load data
  useEffect(() => {
    const initializeApp = async () => {
      try {
        await db.init();
        if (currentUser) {
          await loadData();
        } else if (!authLoading) {
          // Show auth modal for anonymous users after auth loading is complete
          setShowAuthModal(true);
        }
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to initialize app:', error);
        setIsLoading(false);
      }
    };

    if (!authLoading) {
      initializeApp();
    }
  }, [currentUser, authLoading]);

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
    try {
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

      // 🔧 FIX: Deserialize dates from IndexedDB (dates are stored as strings)
      const deserializedTimeBlocks = allTimeBlocks.map(block => ({
        ...block,
        startTime: new Date(block.startTime),
        endTime: new Date(block.endTime),
        createdAt: new Date(block.createdAt),
        updatedAt: new Date(block.updatedAt),
        actualStartTime: block.actualStartTime ? new Date(block.actualStartTime) : undefined,
        actualEndTime: block.actualEndTime ? new Date(block.actualEndTime) : undefined,
      }));

      setTimeBlocks(deserializedTimeBlocks);
      setGoals(allGoals);
      setKeyResults(allKeyResults);
      setProjects(allProjects);
      setTasks(allTasks);
      setHabits(allHabits);
      setHabitLogs(allHabitLogs);

      // Load current session
      if (currentUser) {
        const activeSessions = await db.getActiveSessions(currentUser.uid);
        if (activeSessions.length > 0) {
          setCurrentSession(activeSessions[0]);
        }

        // Load analytics data and user stats
        await loadAnalyticsData();
        await calculateUserStats();
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  };

  const calculateUserStats = async () => {
    try {
      const allSessions = await db.getAll<Session>('sessions');
      const userSessions = allSessions.filter(s => s.userId === 'user-1');
      
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
      
      const userId = 'user-1';
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
  const handleStartSession = async (taskId?: string) => {
    try {
      const session = await sessionManager.startSession(taskId, undefined, 'default');
      setCurrentSession(session);
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
      await sessionManager.stopSession();
      setCurrentSession(null);
      await loadData(); // Refresh data after stopping session
    } catch (error) {
      console.error('Failed to stop session:', error);
    }
  };

  // Time block management
  const handleCreateTimeBlock = async (blockData: Partial<TimeBlock>) => {
    console.log('🔥 PSYCHOPATH: === STARTING handleCreateTimeBlock ===');
    console.log('🔥 PSYCHOPATH: Input data:', blockData);
    
    try {
      console.log('🔥 PSYCHOPATH: Database adapter type:', db.isUsingFirebase ? 'Firebase' : 'IndexedDB');
      
      // 🔥 PSYCHOPATH FIX: Ensure proper data structure with unique ID
      const blockToCreate: TimeBlock = {
        ...blockData,
        id: `timeblock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: blockData.userId || 'user-1',
        domainId: blockData.domainId || 'domain-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TimeBlock;
      
      console.log('🔥 PSYCHOPATH: About to create block with:', blockToCreate);
      
      // 🔥 ACTUAL DATABASE CALL WITH PROPER ERROR HANDLING
      const createdBlock = await db.create<TimeBlock>('timeBlocks', blockToCreate);
      console.log('🔥 PSYCHOPATH: ✅ Database create SUCCESS:', createdBlock);
      
      // Update state with the created block
      const updatedBlocks = [...timeBlocks, createdBlock];
      console.log('🔥 PSYCHOPATH: Updating state. Old count:', timeBlocks.length, 'New count:', updatedBlocks.length);
      
      setTimeBlocks(updatedBlocks);
      console.log('🔥 PSYCHOPATH: ✅ State updated successfully');
      
    } catch (error) {
      console.error('❌ PSYCHOPATH: CRITICAL ERROR in handleCreateTimeBlock:', error);
      console.error('❌ PSYCHOPATH: Error details:', {
        name: error?.name,
        message: error?.message,
        stack: error?.stack
      });
      
      // 🔥 FALLBACK: Add to state even if DB fails
      const fallbackBlock: TimeBlock = {
        ...blockData,
        id: `fallback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: blockData.userId || 'user-1',
        domainId: blockData.domainId || 'domain-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TimeBlock;
      
      console.log('🔥 PSYCHOPATH: Using fallback mode, adding to state:', fallbackBlock);
      setTimeBlocks([...timeBlocks, fallbackBlock]);
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
      const newHabit = await db.create<Habit>('habits', habitData as Habit);
      setHabits([...habits, newHabit]);
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
          userId: 'user-1',
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
    try {
      const newGoal = await db.create<Goal>('goals', goalData as Goal);
      setGoals([...goals, newGoal]);
    } catch (error) {
      console.error('Failed to create goal:', error);
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
      const newKeyResult = await db.create<KeyResult>('keyResults', keyResultData as KeyResult);
      setKeyResults([...keyResults, newKeyResult]);
    } catch (error) {
      console.error('Failed to create key result:', error);
    }
  };

  const handleUpdateKeyResult = async (id: string, updates: Partial<KeyResult>) => {
    try {
      const existingKR = keyResults.find(kr => kr.id === id);
      if (existingKR) {
        const updatedKR = { ...existingKR, ...updates, updatedAt: new Date() };
        await db.update('keyResults', updatedKR);
        setKeyResults(keyResults.map(kr => kr.id === id ? updatedKR : kr));
      }
    } catch (error) {
      console.error('Failed to update key result:', error);
    }
  };

  const handleCreateProject = async (projectData: Partial<Project>) => {
    try {
      const newProject = await db.create<Project>('projects', projectData as Project);
      setProjects([...projects, newProject]);
    } catch (error) {
      console.error('Failed to create project:', error);
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
            <div className="w-20 h-20 border-4 border-transparent rounded-full animate-spin neon-border"></div>
          </div>
          <h2 className="text-3xl font-bold holographic-text mb-4">LIFE TRACKER</h2>
          <p className="text-gray-300 text-lg">
            {authLoading ? 'Checking authentication...' : 'Initializing system...'}
          </p>
          <div className="mt-6 flex justify-center space-x-2">
            {[...Array(3)].map((_, i) => (
              <div 
                key={i}
                className="w-3 h-3 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 animate-pulse"
                style={{ animationDelay: `${i * 0.3}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Auth Modal */}
      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => setShowAuthModal(false)} 
      />

      {/* Daily Motivation */}
      {currentUser && <DailyMotivation />}

      {/* NOW Bar - Always visible at top */}
      <div className="glass-navbar fixed top-0 left-0 right-0 z-40">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between">
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
                  <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold">
                    {currentUser.displayName?.[0] || currentUser.email?.[0] || 'U'}
                  </div>
                  <div className="hidden md:block">
                    <div className="text-sm font-medium text-white">
                      {currentUser.displayName || 'User'}
                    </div>
                    <div className="text-xs text-gray-400">
                      {currentUser.email}
                    </div>
                  </div>
                  <button
                    onClick={() => auth.signOut()}
                    className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 rounded transition-colors"
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="btn-futuristic bg-gradient-to-r from-blue-500 to-purple-600 text-sm px-4 py-2"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="pt-20 pb-8">
        {currentUser ? (
          <div className="max-w-7xl mx-auto px-4 space-y-6">
            {/* KPI Dashboard */}
            <div className="futuristic-card">
              <KPIDashboard 
                kpis={todayKPIs}
                onRefresh={loadData}
              />
            </div>

            {/* Navigation Tabs */}
            <div className="futuristic-card">
            <div className="border-b border-gray-700">
              <nav className="flex space-x-8 px-6">
                {[
                  { id: 'planner', label: 'Time Planner', icon: '🚀' },
                  { id: 'habits', label: 'Habits', icon: '🔥' },
                  { id: 'okr', label: 'Goals & Projects', icon: '🎯' },
                  { id: 'analytics', label: 'Analytics', icon: '📊' },
                  { id: 'goal_analytics', label: 'Goal Intelligence', icon: '🧠' },
                  { id: 'badges', label: 'Badges', icon: '🏆' },
                ].map(({ id, label, icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id as any)}
                    className={`flex items-center space-x-3 py-4 text-sm font-medium border-b-2 transition-all duration-300 btn-futuristic ${
                      activeTab === id
                        ? 'border-blue-400 text-blue-400 neon-text'
                        : 'border-transparent text-gray-400 hover:text-white'
                    }`}
                  >
                    <span className="text-xl">{icon}</span>
                    <span className="font-semibold tracking-wider">{label}</span>
                  </button>
                ))}
              </nav>
            </div>

            {/* Tab Content */}
            <div className="p-6">
              {activeTab === 'planner' && (
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
        ) : (
          // Landing page for non-authenticated users
          <div className="max-w-4xl mx-auto px-4 text-center py-20">
            <div className="space-y-8">
              <h1 className="text-6xl font-bold holographic-text mb-6">
                LIFE TRACKER
              </h1>
              <p className="text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed">
                Transform your productivity with evidence-based time tracking, habit formation, and goal achievement. 
                Know every second what to do.
              </p>
              
              <div className="grid md:grid-cols-3 gap-8 mt-16">
                <div className="glass-card p-8">
                  <div className="text-4xl mb-4">🚀</div>
                  <h3 className="text-xl font-bold neon-text mb-3">Smart Planning</h3>
                  <p className="text-gray-300">
                    Drag-and-drop timeboxing with automatic conflict detection and real-time adjustments.
                  </p>
                </div>
                
                <div className="glass-card p-8">
                  <div className="text-4xl mb-4">🔥</div>
                  <h3 className="text-xl font-bold neon-text mb-3">Habit Mastery</h3>
                  <p className="text-gray-300">
                    Build lasting habits with streak tracking, implementation intentions, and smart reminders.
                  </p>
                </div>
                
                <div className="glass-card p-8">
                  <div className="text-4xl mb-4">📊</div>
                  <h3 className="text-xl font-bold neon-text mb-3">Deep Analytics</h3>
                  <p className="text-gray-300">
                    Correlation analysis, performance trends, and actionable insights powered by your data.
                  </p>
                </div>
              </div>
              
              <div className="mt-12">
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="btn-futuristic bg-gradient-to-r from-blue-500 to-purple-600 text-lg px-8 py-4 pulse-glow"
                >
                  🚀 START YOUR JOURNEY
                </button>
                <p className="text-sm text-gray-400 mt-4">
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