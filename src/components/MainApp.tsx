'use client';

import { useState, useEffect, useCallback } from 'react';
import { Session, TimeBlock, AnalyticsData } from '@/types';
import { SessionManager } from '@/utils/sessionManager';
import { db } from '@/lib/database';
import { useAuthContext } from '@/providers/AuthProvider';
import { useDataContext } from '@/providers/DataProvider';

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
// TYPES
// ============================================================================

type ActiveTab = 'planner' | 'smart_scheduler' | 'adaptation' | 'micro_coach' | 'habits' | 'okr' | 'analytics' | 'goal_analytics' | 'badges';

interface MainAppProps {
  buildId: string;
}

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

export default function MainApp({ buildId }: MainAppProps) {
  const { user, signOut } = useAuthContext();
  const data = useDataContext();
  
  // Local UI state only
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<ActiveTab>('planner');
  const [selectedGoalId, setSelectedGoalId] = useState<string | undefined>();
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [timeBlockError, setTimeBlockError] = useState<string | null>(null);
  
  // Session state
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [currentTimeBlock, setCurrentTimeBlock] = useState<TimeBlock | null>(null);
  
  // Analytics (loaded separately, after main data)
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  
  // User stats for badges
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

  const sessionManager = SessionManager.getInstance();

  // ========== EFFECTS ==========
  
  // Update current time block
  useEffect(() => {
    const updateCurrentTimeBlock = () => {
      const now = new Date();
      const activeBlock = data.timeBlocks.find(block => 
        block.startTime <= now && 
        block.endTime >= now && 
        block.status !== 'completed'
      );
      setCurrentTimeBlock(activeBlock || null);
    };

    updateCurrentTimeBlock();
    const interval = setInterval(updateCurrentTimeBlock, 10000);
    return () => clearInterval(interval);
  }, [data.timeBlocks]);

  // Load timeBlocks for selected date
  useEffect(() => {
    const selectedDateStr = selectedDate.toDateString();
    const todayStr = new Date().toDateString();
    
    if (selectedDateStr === todayStr) return;
    
    const hasBlocksForDate = data.timeBlocks.some(block => 
      new Date(block.startTime).toDateString() === selectedDateStr
    );
    
    if (!hasBlocksForDate) {
      data.loadTimeBlocksForDate(selectedDate);
    }
  }, [selectedDate, data]);

  // Load analytics (lazy, after mount)
  useEffect(() => {
    if (data.status !== 'ready') return;
    
    const loadAnalytics = async () => {
      try {
        setAnalyticsLoading(true);
        const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;

        const [planVsActual, timeAllocation, focusTrend, correlations, weeklyReview] = await Promise.all([
          db.calculatePlanVsActualData(data.userId, days),
          db.calculateTimeAllocation(data.userId, days),
          db.calculateFocusTrend(data.userId, days),
          db.calculateCorrelations(data.userId, days),
          db.generateWeeklyReview(data.userId),
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
    
    // Delay analytics load to not block main thread
    const timeout = setTimeout(loadAnalytics, 100);
    return () => clearTimeout(timeout);
  }, [timeRange, data.userId, data.status]);

  // Init audio (lazy)
  useEffect(() => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(() => {
        audioManager.init().catch(() => {});
      });
    } else {
      setTimeout(() => {
        audioManager.init().catch(() => {});
      }, 1000);
    }
  }, []);

  // ========== SESSION HANDLERS ==========
  const handleStartSession = async (taskId?: string, timeBlockId?: string) => {
    try {
      const session = await sessionManager.startSession(taskId, timeBlockId, 'default', data.userId);
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
      
      if (completedSession) {
        data.refreshKPIs();
      }
    } catch (error) {
      console.error('Failed to stop session:', error);
    }
  };

  // ========== TIMEBLOCK WRAPPER (adds error handling) ==========
  const handleCreateTimeBlock = useCallback(async (blockData: Partial<TimeBlock>) => {
    setTimeBlockError(null);
    try {
      await data.createTimeBlock(blockData);
      audioManager.taskCompleted();
    } catch (error: any) {
      setTimeBlockError(error?.message || 'Failed to save time block');
    }
  }, [data]);

  // ========== OTHER HANDLERS ==========
  const handleBadgeUnlocked = (badge: any) => {
    console.log('Badge unlocked:', badge.name);
    audioManager.play('achievementUnlock');
  };

  // ========== RENDER ==========
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

  if (!user) return null;

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
              {buildId}
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
                {(user.displayName?.[0]) || (user.email?.[0]) || 'U'}
              </div>
              <div className="hidden md:block">
                <div className="text-sm font-medium text-neutral-900">
                  {user.displayName || 'User'}
                </div>
                <div className="text-xs text-neutral-500">{user.email}</div>
              </div>
              <button
                onClick={() => {
                  signOut();
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
                  onCreateTask={data.createTask}
                  onCreateGoal={data.createGoal}
                  onCreateHabit={data.createHabit}
                  goals={data.goals}
                  existingTasks={data.tasks}
                  userPreferences={{}}
                  className="w-full"
                  currentUserId={data.userId}
                />
              </div>

              {/* KPI Dashboard */}
              <div className="card-elevated hover-lift transition-smooth">
                <div className="card-header">
                  <h3 className="heading-3">Today's Progress</h3>
                </div>
                <div className="card-body">
                  <KPIDashboard 
                    kpis={data.kpis}
                    onRefresh={data.refreshKPIs}
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
                      timeBlocks={data.timeBlocks}
                      tasks={data.tasks}
                      projects={data.projects}
                      goals={data.goals}
                      onCreateTimeBlock={handleCreateTimeBlock}
                      onUpdateTimeBlock={data.updateTimeBlock}
                      onDeleteTimeBlock={data.deleteTimeBlock}
                      selectedDate={selectedDate}
                      onDateChange={setSelectedDate}
                      currentUserId={data.userId}
                      isReady={data.status === 'ready'}
                    />
                  </>
                )}

                {activeTab === 'smart_scheduler' && (
                  <SmartScheduler
                    tasks={data.tasks}
                    existingTimeBlocks={data.timeBlocks}
                    goals={data.goals}
                    onScheduleGenerated={(schedule) => console.log('Schedule generated:', schedule)}
                    onTimeBlocksCreated={async (blocks) => {
                      for (const block of blocks) {
                        await data.createTimeBlock(block);
                      }
                      audioManager.perfectDay();
                    }}
                    userPreferences={{}}
                  />
                )}

                {activeTab === 'adaptation' && (
                  <RealTimeAdaptation
                    currentSchedule={data.timeBlocks}
                    tasks={data.tasks}
                    goals={data.goals}
                    currentSession={currentSession}
                    userEnergyLevel={0.7}
                    onScheduleAdapted={async (newSchedule, changes) => {
                      // Would need to update blocks here
                      audioManager.perfectDay();
                    }}
                  />
                )}

                {activeTab === 'micro_coach' && (
                  <MicroCoachDashboard
                    goals={data.goals}
                    keyResults={data.keyResults}
                    tasks={data.tasks}
                    sessions={[]}
                    habitLogs={data.habitLogs}
                    timeBlocks={data.timeBlocks}
                    onInsightAction={(action, insight) => {
                      if (action === 'implement') {
                        audioManager.perfectDay();
                      }
                    }}
                  />
                )}

                {activeTab === 'habits' && (
                  <HabitsTracker
                    habits={data.habits}
                    habitLogs={data.habitLogs}
                    onCreateHabit={data.createHabit}
                    onUpdateHabit={data.updateHabit}
                    onDeleteHabit={data.deleteHabit}
                    onLogHabit={data.logHabit}
                    currentUserId={data.userId}
                  />
                )}

                {activeTab === 'okr' && (
                  <OKRManager
                    goals={data.goals}
                    keyResults={data.keyResults}
                    projects={data.projects}
                    tasks={data.tasks}
                    timeBlocks={data.timeBlocks}
                    currentUserId={data.userId}
                    isLoading={data.status === 'loading'}
                    
                    onCreateGoal={data.createGoal}
                    onUpdateGoal={data.updateGoal}
                    onDeleteGoal={data.deleteGoal}
                    
                    onCreateKeyResult={data.createKeyResult}
                    onUpdateKeyResult={data.updateKeyResult}
                    onDeleteKeyResult={data.deleteKeyResult}
                    
                    onCreateProject={data.createProject}
                    onUpdateProject={data.updateProject}
                    onDeleteProject={data.deleteProject}
                    
                    onCreateTask={data.createTask}
                    onUpdateTask={data.updateTask}
                    onDeleteTask={data.deleteTask}
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
                    goals={data.goals}
                    userId={data.userId}
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
            <span className="font-mono">build: {buildId}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}