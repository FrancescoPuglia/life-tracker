'use client';

import { useState, useEffect } from 'react';
import { 
  Session, TimeBlock, KPI, Goal, KeyResult, Project, Task, 
  Habit, HabitLog, AnalyticsData 
} from '@/types';
import { SessionManager } from '@/utils/sessionManager';
import { db } from '@/lib/database';

import NowBar from '@/components/NowBar';
import KPIDashboard from '@/components/KPIDashboard';
import TimeBlockPlanner from '@/components/TimeBlockPlanner';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';
import HabitsTracker from '@/components/HabitsTracker';
import OKRManager from '@/components/OKRManager';

export default function HomePage() {
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

  // UI states
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'planner' | 'habits' | 'okr' | 'analytics'>('planner');
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [isLoading, setIsLoading] = useState(true);

  const sessionManager = SessionManager.getInstance();

  // Initialize database and load data
  useEffect(() => {
    const initializeApp = async () => {
      try {
        await db.init();
        await loadData();
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to initialize app:', error);
        setIsLoading(false);
      }
    };

    initializeApp();
  }, []);

  // Update KPIs periodically
  useEffect(() => {
    const updateKPIs = async () => {
      try {
        const kpis = await db.calculateTodayKPIs('user-1');
        setTodayKPIs(kpis);
      } catch (error) {
        console.error('Failed to update KPIs:', error);
      }
    };

    updateKPIs();
    const interval = setInterval(updateKPIs, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [currentSession]);

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

      setTimeBlocks(allTimeBlocks);
      setGoals(allGoals);
      setKeyResults(allKeyResults);
      setProjects(allProjects);
      setTasks(allTasks);
      setHabits(allHabits);
      setHabitLogs(allHabitLogs);

      // Load current session
      const activeSessions = await db.getActiveSessions('user-1');
      if (activeSessions.length > 0) {
        setCurrentSession(activeSessions[0]);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
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
    try {
      const newBlock = await db.create<TimeBlock>('timeBlocks', blockData as TimeBlock);
      setTimeBlocks([...timeBlocks, newBlock]);
    } catch (error) {
      console.error('Failed to create time block:', error);
    }
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

  // Mock analytics data (in a real app, this would be calculated from actual data)
  const mockAnalyticsData: AnalyticsData = {
    planVsActual: [
      { date: '2024-01-01', planned: 8, actual: 7.5, adherence: 94 },
      { date: '2024-01-02', planned: 8, actual: 8.2, adherence: 103 },
      { date: '2024-01-03', planned: 7, actual: 6.5, adherence: 93 },
    ],
    timeAllocation: [
      { domain: 'Work', hours: 35, color: '#3b82f6' },
      { domain: 'Learning', hours: 10, color: '#10b981' },
      { domain: 'Health', hours: 8, color: '#f59e0b' },
      { domain: 'Personal', hours: 15, color: '#ef4444' },
    ],
    focusTrend: [
      { date: '2024-01-01', focusMinutes: 180, mood: 7, energy: 6 },
      { date: '2024-01-02', focusMinutes: 220, mood: 8, energy: 7 },
      { date: '2024-01-03', focusMinutes: 150, mood: 6, energy: 5 },
    ],
    correlations: [
      { factor1: 'Sleep', factor2: 'Focus', correlation: 0.7, significance: 'High' },
      { factor1: 'Exercise', factor2: 'Mood', correlation: 0.6, significance: 'Medium' },
    ],
    weeklyReview: {
      highlights: ['Completed major project milestone', 'Maintained workout streak'],
      challenges: ['Struggled with time blocking adherence', 'Interrupted focus sessions'],
      insights: ['Morning workouts boost afternoon productivity', 'Too many meeting blocks reduce deep work'],
      nextWeekGoals: ['Implement meeting-free mornings', 'Add 15min buffer between blocks'],
    },
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading Life Tracker...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* NOW Bar - Always visible at top */}
      <NowBar
        currentSession={currentSession}
        currentTimeBlock={currentTimeBlock}
        onStartSession={handleStartSession}
        onPauseSession={handlePauseSession}
        onStopSession={handleStopSession}
      />

      {/* Main Content */}
      <div className="pt-20 pb-8">
        <div className="max-w-7xl mx-auto px-4 space-y-6">
          {/* KPI Dashboard */}
          <KPIDashboard 
            kpis={todayKPIs}
            onRefresh={loadData}
          />

          {/* Navigation Tabs */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="border-b border-gray-200">
              <nav className="flex space-x-8 px-6">
                {[
                  { id: 'planner', label: 'Time Planner', icon: '📅' },
                  { id: 'habits', label: 'Habits', icon: '🔥' },
                  { id: 'okr', label: 'Goals & Projects', icon: '🎯' },
                  { id: 'analytics', label: 'Analytics', icon: '📊' },
                ].map(({ id, label, icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id as any)}
                    className={`flex items-center space-x-2 py-4 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === id
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <span>{icon}</span>
                    <span>{label}</span>
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
                  data={mockAnalyticsData}
                  timeRange={timeRange}
                  onTimeRangeChange={setTimeRange}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}