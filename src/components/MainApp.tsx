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
import AIInputBarV2 from '@/components/ai/AIInputBarV2';
import SmartScheduler from '@/components/SmartScheduler';
import RealTimeAdaptation from '@/components/RealTimeAdaptation';
import VisionBoardEnhanced from '@/components/VisionBoardEnhanced';
import DailyLoginStreakSystem from '@/components/DailyLoginStreakSystem';
import DopamineRewardSystem from '@/components/DopamineRewardSystem';
import StrategicDopamineSystem from '@/components/StrategicDopamineSystem';
import NotesPage from '@/components/NotesPage';
import { audioManager } from '@/lib/audioManager';

// ============================================================================
// TYPES
// ============================================================================

type ActiveTab = 'planner' | 'smart_scheduler' | 'adaptation' | 'micro_coach' | 'habits' | 'okr' | 'analytics' | 'goal_analytics' | 'badges' | 'vision-board' | 'notes';

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
      
      // NO dopamine for creation - only for COMPLETION!
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
    <StrategicDopamineSystem
      onTimeBlockCompleted={(timeBlockId) => {
        console.log('🎉 Strategic dopamine: Time block completed!', timeBlockId);
        audioManager.levelUp?.();
      }}
      onGoalAchieved={(goalId) => {
        console.log('🎉🎉🎉 Strategic dopamine: GOAL ACHIEVED!', goalId);
        audioManager.perfectDay?.();
      }}
    >
      <div className="min-h-screen" data-testid="app-ready">
        <GamingEffects />
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        <DailyMotivation />

      {/* Header */}
      <header className="gaming-card fixed top-0 left-0 right-0 z-40 border-0 border-b-2 border-blue-200/30">
        <div className="max-w-7xl mx-auto px-6">
          
          {/* Top Row: Brand + User */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center space-x-4">
              <div className="text-2xl font-black bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
                ⚡ LifeTracker
              </div>
              <div className="achievement-badge">
                v{buildId}
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <SyncStatusIndicator />
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold shadow-lg">
                  {(user.displayName?.[0]) || (user.email?.[0]) || 'U'}
                </div>
                <div className="hidden lg:block">
                  <div className="text-sm font-semibold text-gray-800">
                    {user.displayName || 'Productivity Master'}
                  </div>
                  <div className="text-xs text-gray-500">{user.email}</div>
                </div>
                <button
                  onClick={() => {
                    signOut();
                    audioManager.buttonFeedback();
                  }}
                  className="btn-gaming variant-danger text-xs px-4 py-2"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>
          
          {/* Bottom Row: NowBar */}
          <div className="pb-1">
            <NowBar
              currentSession={currentSession}
              currentTimeBlock={currentTimeBlock}
              onStartSession={handleStartSession}
              onPauseSession={handlePauseSession}
              onStopSession={handleStopSession}
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="pt-16 pb-8 bg-gradient-to-br from-neutral-50 to-neutral-100 min-h-screen">
        <div className="container mx-auto">
          <div className="grid-responsive gap-6">
            {/* Left Sidebar */}
            <div className="space-y-6">
              {/* Daily Login Streak System */}
              <DailyLoginStreakSystem 
                showCompact={true}
                className="w-full"
                onStreakUpdate={(streak) => {
                  // Strategic dopamine: Only trigger when streak increases
                  if (typeof window !== 'undefined' && (window as any).strategicDopamine) {
                    // Daily login reward is handled automatically by StrategicDopamineSystem
                  }
                  
                  // Additional streak milestones (3, 7, 30 days)
                  if (typeof window !== 'undefined' && (window as any).dopamineSystem && streak.currentStreak > 1) {
                    (window as any).dopamineSystem.triggerStreakReward(streak.currentStreak);
                  }
                }}
              />
              
              {/* AI Assistant */}
              <div className="card-elevated card-body hover-lift transition-smooth">
                <div className="mb-4">
                  <h3 className="heading-3 flex items-center gap-3">
                    🧠 AI Assistant
                    <span className="badge badge-primary text-xs">AI</span>
                  </h3>
                  <p className="text-small">Create tasks and blocks with natural language</p>
                </div>
                <AIInputBarV2
                  userId={data.userId}
                  goals={data.goals}
                  projects={data.projects}
                  tasks={data.tasks}
                  timeBlocks={data.timeBlocks}
                  sessions={[]} // TODO: Implementare sessions nel DataProvider
                  habits={data.habits}
                  habitLogs={data.habitLogs}
                  domains={[]} // TODO: Implementare domains nel DataProvider
                  onCreateTimeBlock={handleCreateTimeBlock}
                  onUpdateTimeBlock={data.updateTimeBlock}
                  onDeleteTimeBlock={data.deleteTimeBlock}
                  onUpdateTask={data.updateTask}
                  className="w-full"
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
              <div className="gaming-card">
                <div className="p-4 border-b border-gray-200/50">
                  <h3 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent flex items-center gap-2">
                    🎮 Modules
                  </h3>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-1 gap-3">
                    {[
                      { id: 'planner', label: 'Time Planner', icon: '📅', description: 'Plan your day', color: 'from-blue-400 to-blue-600' },
                      { id: 'smart_scheduler', label: 'Auto Scheduler', icon: '⚡', description: 'AI scheduling', color: 'from-yellow-400 to-orange-600' },
                      { id: 'adaptation', label: 'Auto-Replan', icon: '🔄', description: 'Real-time adaptation', color: 'from-green-400 to-green-600' },
                      { id: 'micro_coach', label: 'AI Coach', icon: '🧠', description: 'Performance insights', color: 'from-purple-400 to-purple-600' },
                      { id: 'habits', label: 'Habits', icon: '🔥', description: 'Track habits', color: 'from-red-400 to-red-600' },
                      { id: 'okr', label: 'Goals & Projects', icon: '🎯', description: 'Manage objectives', color: 'from-indigo-400 to-indigo-600' },
                      { id: 'notes', label: 'Second Brain', icon: '🧠', description: 'Smart notes', color: 'from-violet-400 to-violet-600' },
                      { id: 'vision-board', label: 'Vision Board', icon: '✧', description: 'Manifest dreams', color: 'from-pink-400 to-purple-600' },
                      { id: 'analytics', label: 'Analytics', icon: '📊', description: 'Performance data', color: 'from-cyan-400 to-cyan-600' },
                      { id: 'goal_analytics', label: 'Goal Intelligence', icon: '🎯', description: 'Goal insights', color: 'from-teal-400 to-teal-600' },
                      { id: 'badges', label: 'Achievements', icon: '🏆', description: 'Milestones', color: 'from-amber-400 to-amber-600' },
                    ].map(({ id, label, icon, description, color }) => (
                      <button
                        key={id}
                        onClick={() => {
                          setActiveTab(id as ActiveTab);
                          audioManager.buttonFeedback();
                          // NO dopamine for simple navigation - only for achievements!
                        }}
                        className={`
                          group relative p-4 rounded-xl transition-all duration-300 text-left
                          ${activeTab === id 
                            ? `bg-gradient-to-r ${color} text-white shadow-lg transform scale-105` 
                            : 'bg-white/50 hover:bg-white/80 text-gray-700 hover:shadow-md hover:scale-102'
                          }
                          border-2 ${activeTab === id ? 'border-white/30' : 'border-gray-200/50 hover:border-gray-300/50'}
                          backdrop-blur-sm
                        `}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`text-2xl ${activeTab === id ? '' : 'group-hover:scale-110'} transition-transform duration-200`}>
                            {icon}
                          </div>
                          <div className="flex-1">
                            <div className={`font-semibold ${activeTab === id ? 'text-white' : 'text-gray-800'}`}>
                              {label}
                            </div>
                            <div className={`text-sm ${activeTab === id ? 'text-white/90' : 'text-gray-500'}`}>
                              {description}
                            </div>
                          </div>
                          {activeTab === id && (
                            <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="gaming-card">
              <div className="p-6 border-b border-gradient-to-r from-blue-200/30 to-purple-200/30">
                <h2 className="text-3xl font-black bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent flex items-center gap-3">
                  {activeTab === 'planner' && '📅 Time Planner'}
                  {activeTab === 'smart_scheduler' && '⚡ Auto Scheduler'}
                  {activeTab === 'adaptation' && '🔄 Auto Replan'}
                  {activeTab === 'micro_coach' && '🧠 AI Coach'}
                  {activeTab === 'habits' && '🔥 Habits Tracker'}
                  {activeTab === 'okr' && '🎯 Goals & Projects'}
                  {activeTab === 'notes' && '🧠 Second Brain'}
                  {activeTab === 'vision-board' && '✧ Vision Board'}
                  {activeTab === 'analytics' && '📊 Analytics Dashboard'}
                  {activeTab === 'goal_analytics' && '🎯 Goal Intelligence'}
                  {activeTab === 'badges' && '🏆 Achievements'}
                  <div className="achievement-badge ml-auto">ACTIVE</div>
                </h2>
              </div>
              <div className="p-6 particle-container relative overflow-hidden">
                {/* Animated background particles */}
                <div className="absolute top-0 left-0 w-4 h-4 particle" style={{ top: '10%', left: '5%' }}></div>
                <div className="absolute top-0 left-0 w-3 h-3 particle" style={{ top: '30%', left: '15%', animationDelay: '2s' }}></div>
                <div className="absolute top-0 left-0 w-2 h-2 particle" style={{ top: '60%', left: '8%', animationDelay: '4s' }}></div>
                <div className="absolute top-0 left-0 w-3 h-3 particle" style={{ top: '80%', left: '20%', animationDelay: '1s' }}></div>
                <div className="absolute top-0 right-0 w-4 h-4 particle" style={{ top: '20%', right: '10%', animationDelay: '3s' }}></div>
                <div className="absolute top-0 right-0 w-2 h-2 particle" style={{ top: '50%', right: '5%', animationDelay: '5s' }}></div>
                
                {/* Content */}
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
                  <div className="p-6">
                    <div className="max-w-4xl mx-auto">
                      <div className="mb-6">
                        <h1 className="text-2xl font-bold text-gray-900 mb-2">🧠 AI Assistant</h1>
                        <p className="text-gray-600">Il tuo assistente intelligente che vede tutto e ti aiuta a ottimizzare la produttività</p>
                      </div>
                      
                      <AIInputBarV2
                        userId={data.userId}
                        goals={data.goals}
                        projects={data.projects}
                        tasks={data.tasks}
                        timeBlocks={data.timeBlocks}
                        sessions={[]}
                        habits={data.habits}
                        habitLogs={data.habitLogs}
                        domains={[]}
                        onCreateTimeBlock={data.createTimeBlock}
                        onUpdateTimeBlock={data.updateTimeBlock}
                        onDeleteTimeBlock={data.deleteTimeBlock}
                        onUpdateTask={data.updateTask}
                        className="w-full"
                      />
                    </div>
                  </div>
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

                {activeTab === 'notes' && (
                  <div className="w-full h-full">
                    <NotesPage />
                  </div>
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

                {activeTab === 'vision-board' && (
                  <VisionBoardEnhanced 
                    onBack={() => setActiveTab('planner')}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dopamine Reward System */}
      <DopamineRewardSystem 
        onRewardTriggered={(reward) => {
          // Play sound effects based on reward rarity
          if (reward.rarity === 'legendary') {
            audioManager.perfectDay?.();
          } else if (reward.rarity === 'epic') {
            audioManager.levelUp?.();
          } else {
            audioManager.taskCompleted?.();
          }
        }}
      />

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
    </StrategicDopamineSystem>
  );
}