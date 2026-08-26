'use client';

import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Brain, ChevronDown, LogOut, Volume2, VolumeX, Zap } from 'lucide-react';
import { Session, TimeBlock, AnalyticsData } from '@/types';
import { SessionManager } from '@/utils/sessionManager';
import { db } from '@/lib/database';
import { useAuthContext } from '@/providers/AuthProvider';
import { useDataContext } from '@/providers/DataProvider';

// Always-loaded components (small, needed immediately)
import NowBar from '@/components/NowBar';
// KPIDashboard, DailyLoginStreakSystem, StreakCounter and ContextualMotivation
// used to render as permanent cards inside the left sidebar. They were moved
// out of the navigation in the UX overhaul; if you need to bring them back,
// they live under @/components/.
import AuthModal from '@/components/AuthModal';
import SyncStatusIndicator from '@/components/SyncStatus';
import DailyMotivation from '@/components/DailyMotivation';
// (DailyLoginStreakSystem + StreakCounter removed from sidebar — see note above.)
import DopamineRewardSystem from '@/components/DopamineRewardSystem';
import StrategicDopamineSystem from '@/components/StrategicDopamineSystem';
import BlockCountdown from '@/components/BlockCountdown';
// (ContextualMotivation removed from sidebar.)
import { audioManager } from '@/lib/audioManager';
import { calculateStreak, StreakData } from '@/lib/streakCalculator';
import { getVoiceService } from '@/lib/voice/voiceService';
import {
  defaultNotificationPreferences,
  notificationPreferencesStore,
  type EditableNotificationPreferences,
} from '@/lib/notifications/preferences';
import {
  desktopNativeBridge,
  type DesktopNativeStatus,
} from '@/lib/desktop/nativeBridge';
import { DESKTOP_REMINDER_REFRESH_EVENT } from '@/lib/desktop/reminderCoordinator';
import {
  EXECUTION_ALARM_PREFERENCES_EVENT,
  EXECUTION_ALARM_STOP_EVENT,
  defaultExecutionAlarmPreferences,
  executionAlarmPreferencesStore,
  normalizeExecutionAlarmPreferences,
  type ExecutionAlarmPreferences,
} from '@/lib/desktop/executionAlarm';
import {
  buildQuickCaptureNote,
  completedSessionNetMinutes,
  type TodaySessionCoverage,
} from '@/lib/todayExecution';
import { selectRestorableSession } from '@/lib/sessionTiming';

// Lazy-loaded heavy components (loaded on demand by tab)
// This reduces initial bundle size by ~400KB
const TimeBlockPlanner = lazy(() => import('@/components/TimeBlockPlanner'));
const AnalyticsDashboard = lazy(() => import('@/components/AnalyticsDashboard'));
const ReportHistory = lazy(() => import('@/components/reports/ReportHistory'));
const PerformanceDashboard = lazy(() => import('@/components/performance/PerformanceDashboard'));
const GoalAnalyticsDashboard = lazy(() => import('@/components/GoalAnalyticsDashboard'));
const HabitsTracker = lazy(() => import('@/components/HabitsTracker'));
const OKRManager = lazy(() => import('@/components/OKRManager'));
const BadgeSystem = lazy(() => import('@/components/BadgeSystem'));
const AIInputBarV2 = lazy(() => import('@/components/ai/AIInputBarV2'));
const SmartScheduler = lazy(() => import('@/components/SmartScheduler'));
const RealTimeAdaptation = lazy(() => import('@/components/RealTimeAdaptation'));
const VisionBoardEnhanced = lazy(() => import('@/components/VisionBoardEnhanced'));
const NotesPage = lazy(() => import('@/components/NotesPage'));
const EventsCalendar = lazy(() => import('@/components/EventsCalendar'));
const HeroWall = lazy(() => import('@/components/HeroWall'));
const WeeklyExecution = lazy(() => import('@/components/WeeklyExecution'));
const VoiceSettings = lazy(() => import('@/components/VoiceSettings'));
const WeeklyPlanningTab = lazy(() => import('@/components/WeeklyPlanning/WeeklyPlanningTab'));
const GoalArchitectTab = lazy(() => import('@/components/GoalArchitect/GoalArchitectTab'));
const DesktopSettings = lazy(() => import('@/components/settings/DesktopSettings'));

// Shell components (UX overhaul)
import SidebarNavigation, { type SidebarNavId } from '@/components/shell/SidebarNavigation';
import AskAIDrawer from '@/components/shell/AskAIDrawer';
import TodayCommandCenter from '@/components/shell/TodayCommandCenter';
import ExecutionAlarmHost from '@/components/desktop/ExecutionAlarmHost';

// ============================================================================
// TYPES
// ============================================================================

type ActiveTab = 'today' | 'planner' | 'smart_scheduler' | 'adaptation' | 'micro_coach' | 'habits' | 'okr' | 'performance' | 'analytics' | 'reports' | 'goal_analytics' | 'badges' | 'vision-board' | 'notes' | 'events' | 'weekly' | 'weekly_intel' | 'goal_architect' | 'voice' | 'settings';

const PAGE_TITLES: Record<ActiveTab, string> = {
  today: 'Oggi',
  planner: 'Time Planner',
  smart_scheduler: 'Auto Scheduler',
  adaptation: 'Adatta piano',
  micro_coach: 'AI Coach',
  habits: 'Abitudini',
  okr: 'Obiettivi e progetti',
  performance: 'Performance',
  analytics: 'Analytics',
  reports: 'Report',
  goal_analytics: 'Goal Intelligence',
  badges: 'Traguardi',
  'vision-board': 'Vision Board',
  notes: 'Second Brain',
  events: 'Calendario strategico',
  weekly: 'Esecuzione settimanale',
  weekly_intel: 'Piano settimanale',
  goal_architect: 'Goal Architect',
  voice: 'Voce',
  settings: 'Impostazioni',
};

interface MainAppProps {
  buildId: string;
}

const UNAVAILABLE_NATIVE_STATUS: DesktopNativeStatus = Object.freeze({
  available: false,
  notificationPermission: 'unavailable',
  autostartEnabled: null,
});

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

export default function MainApp({ buildId }: MainAppProps) {
  const { user, signOut } = useAuthContext();
  const data = useDataContext();
  
  // Local UI state only
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<ActiveTab>('today');
  const [aiDrawerOpen, setAiDrawerOpen] = useState<boolean>(false);
  const [selectedGoalId, setSelectedGoalId] = useState<string | undefined>();
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('90d'); // Changed to 90 days to capture all data
  const [timeBlockError, setTimeBlockError] = useState<string | null>(null);
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => audioManager.isEnabled());
  const [alarmPreferences, setAlarmPreferences] = useState<ExecutionAlarmPreferences>(
    defaultExecutionAlarmPreferences,
  );
  
  // Session state
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [currentTimeBlock, setCurrentTimeBlock] = useState<TimeBlock | null>(null);
  const [nextTimeBlock, setNextTimeBlock] = useState<TimeBlock | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionCoverage, setSessionCoverage] = useState<TodaySessionCoverage>('loading');
  const [notificationPreferences, setNotificationPreferences] =
    useState<EditableNotificationPreferences>(defaultNotificationPreferences);
  const [preferenceStatus, setPreferenceStatus] =
    useState<'loading' | 'ready' | 'error'>('loading');
  const [nativeStatus, setNativeStatus] =
    useState<DesktopNativeStatus>(UNAVAILABLE_NATIVE_STATUS);
  
  // Analytics (loaded separately, after main data)
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // Streak data (real activity-based momentum tracking)
  const [streakData, setStreakData] = useState<StreakData>({
    currentStreak: 0,
    bestStreak: 0,
    lastActivityDate: null,
    totalActiveDays: 0,
    streakHistory: []
  });

  // User stats for badges
  const [userStats, setUserStats] = useState({
    maxStreak: 0,
    totalFocusMinutes: 0,
    goalsCompleted: 0,
    totalSessions: 0,
    daysTracked: 0,
    earlySessionsCount: 0,
    eveningSessionsCount: 0,
    weeklyFocusMinutes: 0
  });

  const sessionManager = SessionManager.getInstance();

  const reloadSessions = useCallback(async () => {
    setSessionCoverage('loading');
    try {
      const raw = await db.getByIndex<Session>('sessions', 'userId', data.userId);
      const ownerSessions = raw.filter((session) => session.userId === data.userId && !session.deleted);
      const restored = sessionManager.restoreCurrentSession(
        selectRestorableSession(data.userId, ownerSessions),
        data.userId,
      );
      setSessions(ownerSessions);
      setCurrentSession(restored);
      setSessionCoverage('ready');
    } catch {
      const existing = sessionManager.getCurrentSession();
      const safeExisting = existing
        && existing.userId === data.userId
        && !existing.deleted
        && (existing.status === 'active' || existing.status === 'paused')
          ? existing
          : sessionManager.restoreCurrentSession(null, data.userId);
      setSessions([]);
      setCurrentSession(safeExisting);
      setSessionCoverage('error');
    }
  }, [data.userId, sessionManager]);

  const reloadTodayRuntimeStatus = useCallback(async () => {
    setPreferenceStatus('loading');
    const [preferencesResult, nativeResult] = await Promise.allSettled([
      notificationPreferencesStore.load(data.userId),
      desktopNativeBridge.readStatus(),
    ]);
    if (preferencesResult.status === 'fulfilled') {
      setNotificationPreferences(preferencesResult.value);
      setPreferenceStatus('ready');
    } else {
      setNotificationPreferences(defaultNotificationPreferences());
      setPreferenceStatus('error');
    }
    setNativeStatus(
      nativeResult.status === 'fulfilled'
        ? nativeResult.value
        : UNAVAILABLE_NATIVE_STATUS,
    );
  }, [data.userId]);

  // ========== EFFECTS ==========

  useEffect(() => {
    if (data.status !== 'ready') return;
    void reloadSessions();
  }, [data.status, reloadSessions]);

  useEffect(() => {
    if (data.status !== 'ready') return undefined;
    void reloadTodayRuntimeStatus();
    const refresh = () => { void reloadTodayRuntimeStatus(); };
    window.addEventListener(DESKTOP_REMINDER_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(DESKTOP_REMINDER_REFRESH_EVENT, refresh);
  }, [data.status, reloadTodayRuntimeStatus]);

  useEffect(() => {
    if (!user) return undefined;
    const initial = executionAlarmPreferencesStore.load(user.uid);
    setAlarmPreferences(initial);
    const initialSoundEnabled = initial.soundEnabled && !initial.muted;
    setSoundEnabled(initialSoundEnabled);
    audioManager.setEnabled(initialSoundEnabled);
    const update = (event: Event) => {
      try {
        const next = normalizeExecutionAlarmPreferences(
          (event as CustomEvent<unknown>).detail,
        );
        setAlarmPreferences(next);
        const nextSoundEnabled = next.soundEnabled && !next.muted;
        setSoundEnabled(nextSoundEnabled);
        audioManager.setEnabled(nextSoundEnabled);
      } catch {
        // Ignore malformed local events; the current validated policy remains active.
      }
    };
    window.addEventListener(EXECUTION_ALARM_PREFERENCES_EVENT, update);
    return () => window.removeEventListener(EXECUTION_ALARM_PREFERENCES_EVENT, update);
  }, [user]);
  
  // Update current time block
  useEffect(() => {
    const updateCurrentTimeBlock = () => {
      const now = new Date();
      const liveBlocks = data.timeBlocks
        .filter((block) => (
          !block.deleted
          && block.status !== 'completed'
          && block.status !== 'cancelled'
        ))
        .slice()
        .sort((left, right) => left.startTime.getTime() - right.startTime.getTime());
      const activeBlock = liveBlocks.find((block) =>
        block.startTime <= now && block.endTime > now,
      );
      const upcomingBlock = liveBlocks.find((block) => block.startTime > now);
      setCurrentTimeBlock(activeBlock || null);
      setNextTimeBlock(upcomingBlock || null);
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

        const activityRankings: AnalyticsData['activityRankings'] = [];

        setAnalyticsData({
          planVsActual,
          timeAllocation,
          focusTrend,
          correlations,
          activityRankings,
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

  // Badge execution stats use persisted completed Sessions only. Missing or
  // unavailable Sessions never fall back to planned TimeBlock windows.
  useEffect(() => {
    if (data.status !== 'ready' || sessionCoverage !== 'ready') return;
    const completedSessions = sessions
      .map((session) => ({ session, minutes: completedSessionNetMinutes(session) }))
      .filter((item): item is { session: Session; minutes: number } => item.minutes !== null);
    const totalFocusMinutes = completedSessions.reduce((sum, item) => sum + item.minutes, 0);
    const dayFormatter = new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
      timeZone: notificationPreferences.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const hourFormatter = new Intl.DateTimeFormat('en-US-u-nu-latn', {
      timeZone: notificationPreferences.timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const activeDays = new Set(
      completedSessions.map(({ session }) => dayFormatter.format(session.startTime)),
    );
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const weeklyFocusMinutes = completedSessions
      .filter(({ session }) => session.startTime >= oneWeekAgo)
      .reduce((sum, item) => sum + item.minutes, 0);
    const localHour = (session: Session) => Number(hourFormatter.format(session.startTime));
    const earlySessions = completedSessions.filter(({ session }) => localHour(session) < 8);
    const eveningSessions = completedSessions.filter(({ session }) => localHour(session) >= 20);

    setUserStats(prev => ({
      maxStreak: Math.max(prev.maxStreak, streakData.bestStreak),
      totalFocusMinutes: Math.round(totalFocusMinutes),
      goalsCompleted: data.goals.filter(g => g.status === 'completed').length,
      totalSessions: completedSessions.length,
      daysTracked: activeDays.size,
      earlySessionsCount: earlySessions.length,
      eveningSessionsCount: eveningSessions.length,
      weeklyFocusMinutes: Math.round(weeklyFocusMinutes),
    }));
  }, [
    data.status,
    data.goals,
    notificationPreferences.timezone,
    sessionCoverage,
    sessions,
    streakData.bestStreak,
  ]);

  // Calculate streak from real activity data
  useEffect(() => {
    if (data.status !== 'ready') return;

    const calculateActivityStreak = () => {
      try {
        const completedTasks = data.tasks.filter(t => t.completedAt && !t.deleted);
        const streak = calculateStreak(
          data.timeBlocks,
          data.habitLogs,
          completedTasks
        );
        setStreakData(streak);

        // Sync maxStreak to userStats for badges
        if (streak.bestStreak > userStats.maxStreak) {
          setUserStats(prev => ({ ...prev, maxStreak: streak.bestStreak }));
        }
      } catch (error) {
        console.error('Streak calculation failed:', error);
      }
    };

    // Calculate immediately and refresh periodically
    calculateActivityStreak();
    const interval = setInterval(calculateActivityStreak, 60000); // Every minute

    return () => clearInterval(interval);
  }, [data.status, data.timeBlocks.length, data.habitLogs.length, data.tasks.length]);

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
  const refreshExecutionState = async () => {
    await Promise.allSettled([
      reloadSessions(),
      data.refreshTimeBlocks(),
    ]);
  };

  const handleStartSession = async (taskId?: string, timeBlockId?: string): Promise<boolean> => {
    setSessionActionError(null);
    try {
      const session = currentSession?.status === 'paused'
        ? await sessionManager.resumeSession()
        : await sessionManager.startSession(taskId, timeBlockId, 'default', data.userId);
      if (!session) throw new Error('Session did not start.');
      setCurrentSession(session);
      audioManager.buttonFeedback();
      await refreshExecutionState();
      return true;
    } catch {
      setSessionActionError('The Session could not be started safely. No completion was recorded.');
      return false;
    }
  };

  const handlePauseSession = async () => {
    setSessionActionError(null);
    try {
      const session = await sessionManager.pauseSession();
      setCurrentSession(session);
      await refreshExecutionState();
    } catch {
      setSessionActionError('The Session could not be paused. Its persisted state was not assumed.');
    }
  };

  const handleStopSession = async () => {
    setSessionActionError(null);
    try {
      const completedSession = await sessionManager.stopSession();
      setCurrentSession(null);
      
      if (completedSession) {
        await refreshExecutionState();
        void data.refreshKPIs();
      }
    } catch {
      setSessionActionError('The Session could not be stopped safely. Reload before trying again.');
    }
  };

  const handleQuickCapture = useCallback(async (text: string) => {
    const note = buildQuickCaptureNote(text);
    const noteId = await data.createNote(note);
    if (!noteId) throw new Error('Quick capture was not persisted.');
  }, [data]);

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
  const handleBadgeUnlocked = () => {
    audioManager.play('achievementUnlock');
    getVoiceService()?.speakSystem('Badge sbloccato!');
  };

  // ========== RENDER ==========
  const emptyAnalyticsData: AnalyticsData = {
    planVsActual: [],
    timeAllocation: [],
    focusTrend: [],
    correlations: [],
    activityRankings: [], // Add missing property
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
      onTimeBlockCompleted={() => {
        audioManager.levelUp?.();
      }}
      onGoalAchieved={() => {
        audioManager.perfectDay?.();
      }}
    >
      <div className="lt-app-shell" data-testid="app-ready">
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        <DailyMotivation />
        <BlockCountdown />
        <ExecutionAlarmHost
          uid={data.userId}
          preferences={alarmPreferences}
          timeBlocks={data.timeBlocks}
          tasks={data.tasks}
          projects={data.projects}
          goals={data.goals}
          timezone={notificationPreferences.timezone}
          locale={notificationPreferences.locale}
          currentSession={currentSession}
          onStartSession={handleStartSession}
          onOpenPlanner={() => setActiveTab('planner')}
        />

        <header className="lt-topbar">
          <div className="lt-topbar-inner">
            <div className="flex min-w-0 items-center gap-3">
              <span className="lt-brand-mark" aria-hidden="true"><Zap size={17} fill="currentColor" /></span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-4 text-slate-950">Life Tracker</p>
                <p className="truncate text-xs leading-4 text-slate-500">{PAGE_TITLES[activeTab]}</p>
              </div>
            </div>

            <div className="lt-topbar-context min-w-0">
              <NowBar
                currentSession={currentSession}
                currentTimeBlock={currentTimeBlock}
                nextTimeBlock={nextTimeBlock}
                sessionStateReady={sessionCoverage === 'ready'}
                onStartSession={handleStartSession}
                onPauseSession={handlePauseSession}
                onStopSession={handleStopSession}
              />
            </div>

            <div className="flex items-center justify-end gap-1.5">
              <SyncStatusIndicator />
              <button
                type="button"
                onClick={() => {
                  const next = !(soundEnabled && !alarmPreferences.muted);
                  setSoundEnabled(next);
                  audioManager.setEnabled(next);
                  setAlarmPreferences(executionAlarmPreferencesStore.save(data.userId, {
                    ...alarmPreferences,
                    soundEnabled: next,
                    muted: !next,
                  }));
                  if (!next) window.dispatchEvent(new Event(EXECUTION_ALARM_STOP_EVENT));
                  if (next) audioManager.buttonFeedback();
                }}
                className="lt-icon-button min-h-[36px] w-9"
                aria-label={soundEnabled && !alarmPreferences.muted ? 'Silenzia allarmi e suoni' : 'Riattiva allarmi e suoni'}
                title={soundEnabled && !alarmPreferences.muted ? 'Allarmi e suoni attivi' : 'Allarmi e suoni silenziati'}
              >
                {soundEnabled && !alarmPreferences.muted
                  ? <Volume2 size={16} aria-hidden="true" />
                  : <VolumeX size={16} aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={() => setAiDrawerOpen(true)}
                data-testid="ask-ai-button"
                className="lt-button-secondary min-h-[36px] px-3 text-indigo-700"
              >
                <Brain size={16} aria-hidden="true" />
                <span>Chiedi all’AI</span>
              </button>
              <details className="relative">
                <summary className="lt-profile-summary flex min-h-[38px] cursor-pointer list-none items-center gap-1 rounded-[10px] border border-transparent px-1.5 transition-colors hover:border-slate-200 hover:bg-slate-50" aria-label="Apri menu profilo">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-xs font-bold text-white">
                    {(user.displayName?.[0]) || (user.email?.[0]) || 'U'}
                  </span>
                  <ChevronDown size={14} className="text-slate-500" aria-hidden="true" />
                </summary>
                <div className="absolute right-0 top-11 z-50 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                  <p className="truncate text-sm font-semibold text-slate-900">{user.displayName || 'Profilo personale'}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{user.email}</p>
                  <p className="mt-2 font-mono text-[11px] text-slate-400">Build {buildId.slice(0, 7)}</p>
                  <button
                    type="button"
                    onClick={() => {
                      signOut();
                      audioManager.buttonFeedback();
                    }}
                    className="mt-3 flex min-h-[40px] w-full items-center gap-2 rounded-lg px-3 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
                  >
                    <LogOut size={16} aria-hidden="true" />
                    Esci
                  </button>
                </div>
              </details>
            </div>
          </div>
        </header>

        <div className="lt-shell-body">
          <aside className="lt-sidebar-slot">
            <SidebarNavigation
              activeTab={activeTab as SidebarNavId}
              onSelect={(id) => {
                setActiveTab(id as ActiveTab);
                audioManager.buttonFeedback();
              }}
            />
          </aside>

          <main className={`lt-page ${activeTab === 'planner' ? 'lt-page--planner' : ''}`}>
            <div className="lt-page-surface">
              <div className="lt-page-content">
                {activeTab === 'today' && (
                  <>
                    {sessionActionError && (
                      <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                        {sessionActionError}
                      </div>
                    )}
                    <TodayCommandCenter
                      ownerUid={data.userId}
                      timezone={notificationPreferences.timezone}
                      locale={notificationPreferences.locale}
                      preferenceStatus={preferenceStatus}
                      reminderPreferences={notificationPreferences}
                      nativeStatus={nativeStatus}
                      timeBlocks={data.timeBlocks}
                      sessions={sessions}
                      sessionCoverage={sessionCoverage}
                      currentSessionStatus={currentSession?.status ?? null}
                      tasks={data.tasks}
                      goals={data.goals}
                      projects={data.projects}
                      streakData={streakData}
                      onOpenTab={(id) => setActiveTab(id as ActiveTab)}
                      onOpenAskAI={() => setAiDrawerOpen(true)}
                      onStartFocus={handleStartSession}
                      onQuickCapture={handleQuickCapture}
                    />
                  </>
                )}

                {activeTab === 'planner' && (
                  <>
                    {timeBlockError && (
                      <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {timeBlockError}
                      </div>
                    )}
                    <TimeBlockPlanner
                      timeBlocks={data.timeBlocks}
                      sessions={sessions}
                      sessionCoverage={sessionCoverage}
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
                      onNavigate={(id) => setActiveTab(id as ActiveTab)}
                    />
                  </>
                )}

                {activeTab === 'smart_scheduler' && (
                  <SmartScheduler
                    tasks={data.tasks}
                    existingTimeBlocks={data.timeBlocks}
                    goals={data.goals}
                    onScheduleGenerated={() => {}}
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
                      
                      <button
                        type="button"
                        onClick={() => setAiDrawerOpen(true)}
                        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      >
                        Apri l’assistente sicuro
                      </button>
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
                    sessions={sessions}
                    sessionCoverage={sessionCoverage}
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

                {activeTab === 'performance' && (
                  <Suspense fallback={null}>
                    <PerformanceDashboard onNavigate={(id) => setActiveTab(id as ActiveTab)} />
                  </Suspense>
                )}

                {activeTab === 'analytics' && (
                  <AnalyticsDashboard
                    data={analyticsData || emptyAnalyticsData}
                    timeRange={timeRange}
                    onTimeRangeChange={setTimeRange}
                  />
                )}

                {activeTab === 'reports' && (
                  <Suspense fallback={<div className="text-sm text-slate-500">Loading reports…</div>}>
                    <ReportHistory userId={user!.uid} />
                  </Suspense>
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

                {activeTab === 'weekly' && (
                  <div className="space-y-6">
                    <WeeklyExecution />
                    <HeroWall />
                  </div>
                )}

                {activeTab === 'weekly_intel' && (
                  <Suspense fallback={null}>
                    <WeeklyPlanningTab />
                  </Suspense>
                )}

                {activeTab === 'goal_architect' && (
                  <Suspense fallback={null}>
                    <GoalArchitectTab />
                  </Suspense>
                )}

                {activeTab === 'events' && (
                  <EventsCalendar
                    goals={data.goals}
                    onNavigate={(id) => setActiveTab(id as ActiveTab)}
                  />
                )}

                {activeTab === 'vision-board' && (
                  <VisionBoardEnhanced
                    onBack={() => setActiveTab('planner')}
                  />
                )}

                {activeTab === 'voice' && (
                  <VoiceSettings />
                )}

                {activeTab === 'settings' && (
                  <Suspense fallback={null}>
                    <DesktopSettings userId={user!.uid} />
                  </Suspense>
                )}
              </div>
            </div>
          </main>
        </div>

      {/* Ask AI drawer — opens on Top Bar "Ask AI" click. */}
      <AskAIDrawer open={aiDrawerOpen} onClose={() => setAiDrawerOpen(false)}>
        <Suspense fallback={<div className="text-sm text-gray-500">Loading AI…</div>}>
          <AIInputBarV2
            className="w-full"
          />
        </Suspense>
      </AskAIDrawer>

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

      </div>
    </StrategicDopamineSystem>
  );
}
