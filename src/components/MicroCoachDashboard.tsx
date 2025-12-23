'use client';

// 🧠 MICRO COACH DASHBOARD - AI-Powered Performance Insights
// MODALITÀ PSICOPATICO ESTREMO 🔥🔥🔥🔥🔥

import { useState, useEffect } from 'react';
import { microCoach } from '@/lib/microCoach';
import { CoachingInsight, PatternDetection, UserAnalysisData, PerformanceMetrics } from '@/types/ai-enhanced';
import { Goal, KeyResult, Task, Session, HabitLog } from '@/types';
import { audioManager } from '@/lib/audioManager';
import RiskDashboard from './RiskDashboard';
import SecondBrainChat from './SecondBrainChat';

interface MicroCoachDashboardProps {
  goals: Goal[];
  keyResults: KeyResult[];
  tasks: Task[];
  sessions: Session[];
  habitLogs: HabitLog[];
  timeBlocks?: any[]; // For Second Brain integration
  onInsightAction?: (action: string, insight: CoachingInsight) => void;
}

interface CoachingState {
  dailyInsight: CoachingInsight | null;
  recentPatterns: PatternDetection[];
  optimizations: CoachingInsight[];
  isAnalyzing: boolean;
  analysisHistory: Array<{
    date: Date;
    insight: CoachingInsight;
    implemented: boolean;
  }>;
  userPerformance: PerformanceMetrics | null;
}

interface InsightInteraction {
  insightId: string;
  viewed: boolean;
  implemented: boolean;
  feedback: 'helpful' | 'not_helpful' | 'neutral' | null;
  notes?: string;
}

export default function MicroCoachDashboard({
  goals,
  keyResults,
  tasks,
  sessions,
  habitLogs,
  timeBlocks = [],
  onInsightAction
}: MicroCoachDashboardProps) {
  const [state, setState] = useState<CoachingState>({
    dailyInsight: null,
    recentPatterns: [],
    optimizations: [],
    isAnalyzing: false,
    analysisHistory: [],
    userPerformance: null
  });

  const [interactions, setInteractions] = useState<Map<string, InsightInteraction>>(new Map());
  const [selectedInsight, setSelectedInsight] = useState<CoachingInsight | null>(null);
  const [viewMode, setViewMode] = useState<'insights' | 'patterns' | 'performance' | 'risk' | 'chat'>('insights');
  const [autoRefresh, setAutoRefresh] = useState(true);

  // 🧠 INITIALIZE COACHING ANALYSIS
  useEffect(() => {
    if (goals.length > 0 || tasks.length > 0 || sessions.length > 0) {
      performCoachingAnalysis();
    }
  }, [goals, keyResults, tasks, sessions, habitLogs]);

  // ⏰ AUTO-REFRESH COACHING INSIGHTS
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      performCoachingAnalysis();
    }, 1800000); // Every 30 minutes

    return () => clearInterval(interval);
  }, [autoRefresh]);

  // 🎯 MAIN COACHING ANALYSIS ENGINE
  const performCoachingAnalysis = async () => {
    setState(prev => ({ ...prev, isAnalyzing: true }));

    try {
      console.log('🧠 MICRO COACH: Starting comprehensive analysis');

      // 🔥 BUILD USER ANALYSIS DATA
      const userData: UserAnalysisData = {
        recentSessions: sessions.slice(-30), // Last 30 sessions
        completedTasks: tasks.filter(t => t.status === 'completed'),
        goalProgress: calculateGoalProgress(goals, keyResults),
        energyLevels: extractEnergyLevels(sessions),
        habitConsistency: calculateHabitConsistency(habitLogs),
        planningAccuracy: calculatePlanningAccuracy(tasks)
      };

      // 📊 GENERATE DAILY INSIGHT
      const dailyInsight = await microCoach.generateDailyInsight(userData);
      
      // 🔍 DETECT BEHAVIORAL PATTERNS
      const patterns = await microCoach.detectPatterns(
        [...sessions, ...tasks.map(t => ({ ...t, type: 'task' }))], 
        14 // Last 14 days
      );

      // 🎯 CALCULATE PERFORMANCE METRICS
      const performance = calculatePerformanceMetrics(userData);

      // 💡 GENERATE OPTIMIZATION SUGGESTIONS
      const optimizations = await microCoach.suggestOptimizations(performance);

      setState(prev => ({
        ...prev,
        isAnalyzing: false,
        dailyInsight,
        recentPatterns: patterns,
        optimizations,
        userPerformance: performance,
        analysisHistory: [
          ...prev.analysisHistory.slice(-9), // Keep last 10
          {
            date: new Date(),
            insight: dailyInsight,
            implemented: false
          }
        ]
      }));

      // 🎮 AUDIO FEEDBACK
      if (dailyInsight.urgency === 'critical') {
        audioManager.play('error');
      } else if (dailyInsight.expectedImpact === 'high') {
        audioManager.taskCompleted();
      } else {
        audioManager.buttonFeedback();
      }

      console.log('🧠 COACHING ANALYSIS COMPLETE:', {
        insight: dailyInsight.type,
        patterns: patterns.length,
        optimizations: optimizations.length
      });

    } catch (error) {
      console.error('🧠 COACHING ANALYSIS ERROR:', error);
      setState(prev => ({ ...prev, isAnalyzing: false }));
    }
  };

  // 🎯 INSIGHT INTERACTION HANDLERS
  const handleInsightInteraction = (insight: CoachingInsight, action: 'view' | 'implement' | 'dismiss') => {
    const interaction: InsightInteraction = {
      insightId: insight.id,
      viewed: true,
      implemented: action === 'implement',
      feedback: null
    };

    setInteractions(prev => new Map(prev.set(insight.id, interaction)));

    if (action === 'implement') {
      onInsightAction?.(action, insight);
      audioManager.taskCompleted();
    } else if (action === 'view') {
      setSelectedInsight(insight);
      onInsightAction?.(action, insight);
    }
  };

  const handleInsightFeedback = (insightId: string, feedback: 'helpful' | 'not_helpful' | 'neutral') => {
    setInteractions(prev => {
      const interaction = prev.get(insightId) || {
        insightId,
        viewed: true,
        implemented: false,
        feedback: null
      };
      
      return new Map(prev.set(insightId, { ...interaction, feedback }));
    });
  };

  // 📊 UTILITY FUNCTIONS
  const calculateGoalProgress = (goals: Goal[], keyResults: KeyResult[]): Record<string, number> => {
    const progress: Record<string, number> = {};
    
    goals.forEach(goal => {
      const goalKeyResults = keyResults.filter(kr => kr.goalId === goal.id);
      if (goalKeyResults.length > 0) {
        const avgProgress = goalKeyResults.reduce((sum, kr) => sum + (kr.progress ?? 0), 0) / goalKeyResults.length;
        progress[goal.id] = avgProgress / 100; // Convert to 0-1 scale
      } else {
        progress[goal.id] = 0;
      }
    });

    return progress;
  };

  const extractEnergyLevels = (sessions: Session[]): Record<string, number> => {
    const energyByDate: Record<string, number[]> = {};
    
    sessions.forEach(session => {
      const energyLevel = session.energyLevel || session.energy;
      if (energyLevel !== undefined) {
        const dateKey = new Date(session.createdAt).toDateString();
        if (!energyByDate[dateKey]) energyByDate[dateKey] = [];
        energyByDate[dateKey].push(energyLevel);
      }
    });

    const averageEnergyByDate: Record<string, number> = {};
    Object.entries(energyByDate).forEach(([date, levels]) => {
      averageEnergyByDate[date] = levels.reduce((sum, level) => sum + level, 0) / levels.length;
    });

    return averageEnergyByDate;
  };

  const calculateHabitConsistency = (habitLogs: HabitLog[]): Record<string, number> => {
    const consistency: Record<string, number> = {};
    
    // Group by habit and calculate streaks/consistency
    const habitGroups = habitLogs.reduce((groups, log) => {
      if (!groups[log.habitId]) groups[log.habitId] = [];
      groups[log.habitId].push(log);
      return groups;
    }, {} as Record<string, HabitLog[]>);

    Object.entries(habitGroups).forEach(([habitId, logs]) => {
      // Simple consistency calculation: completed days / total days
      const completedDays = logs.filter(log => log.completed).length;
      const totalDays = logs.length;
      consistency[habitId] = totalDays > 0 ? completedDays / totalDays : 0;
    });

    return consistency;
  };

  const calculatePlanningAccuracy = (tasks: Task[]): { estimationError: number; completionRate: number } => {
    const completedTasks = tasks.filter(t => t.status === 'completed');
    const totalTasks = tasks.length;
    
    const tasksWithEstimates = tasks.filter(t => t.estimatedMinutes && t.actualMinutes);
    let totalEstimationError = 0;
    
    if (tasksWithEstimates.length > 0) {
      tasksWithEstimates.forEach(task => {
        const error = Math.abs((task.actualMinutes || 0) - (task.estimatedMinutes || 0)) / (task.estimatedMinutes || 1);
        totalEstimationError += error;
      });
      totalEstimationError /= tasksWithEstimates.length;
    }

    return {
      estimationError: totalEstimationError,
      completionRate: totalTasks > 0 ? completedTasks.length / totalTasks : 0
    };
  };

  const calculatePerformanceMetrics = (userData: UserAnalysisData): PerformanceMetrics => {
    const recentTasks = userData.completedTasks.slice(-30); // Last 30 tasks
    const avgTasksPerDay = recentTasks.length / 7; // Assume weekly timeframe
    
    const totalFocusMinutes = userData.recentSessions.reduce((sum, session) => {
      return sum + (session.actualDuration || 0);
    }, 0);
    
    const avgFocusPerDay = totalFocusMinutes / 7;

    return {
      productivity: {
        tasksCompletedPerDay: avgTasksPerDay,
        focusTimePerDay: avgFocusPerDay,
        planAdherence: userData.planningAccuracy.completionRate
      },
      goalProgress: {
        weeklyVelocity: userData.goalProgress,
        milestonesHit: Object.values(userData.goalProgress).filter(p => p > 0.8).length,
        atRiskGoals: Object.values(userData.goalProgress).filter(p => p < 0.3).length
      },
      wellbeing: {
        energyConsistency: calculateEnergyConsistency(Object.values(userData.energyLevels)),
        workLifeBalance: 0.7, // Simplified
        burnoutRisk: calculateBurnoutRisk(userData)
      }
    };
  };

  const calculateEnergyConsistency = (energyValues: number[]): number => {
    if (energyValues.length === 0) return 0.5;
    
    const mean = energyValues.reduce((sum, val) => sum + val, 0) / energyValues.length;
    const variance = energyValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / energyValues.length;
    
    return Math.max(0, 1 - Math.sqrt(variance));
  };

  const calculateBurnoutRisk = (userData: UserAnalysisData): number => {
    const factors = [
      userData.planningAccuracy.completionRate < 0.6 ? 0.3 : 0,
      userData.recentSessions.length > 50 ? 0.4 : 0,
      Object.values(userData.goalProgress).filter(p => p < 0.3).length > 3 ? 0.3 : 0
    ];
    
    return Math.min(1, factors.reduce((sum, factor) => sum + factor, 0));
  };

  // 🎨 STYLING HELPERS
  const getInsightColor = (insight: CoachingInsight): string => {
    if (insight.urgency === 'critical') return 'text-red-400 bg-red-900/20 border-red-400';
    if (insight.urgency === 'high') return 'text-orange-400 bg-orange-900/20 border-orange-400';
    if (insight.urgency === 'medium') return 'text-yellow-400 bg-yellow-900/20 border-yellow-400';
    return 'text-green-400 bg-green-900/20 border-green-400';
  };

  const getInsightIcon = (type: string): string => {
    const icons: Record<string, string> = {
      'productivity': '🚀',
      'energy': '⚡',
      'goal_alignment': '🎯',
      'habits': '🔄',
      'planning': '📋'
    };
    return icons[type] || '💡';
  };

  const getImplementationCostColor = (cost: string): string => {
    switch (cost) {
      case 'low': return 'text-green-400';
      case 'medium': return 'text-yellow-400';
      case 'high': return 'text-red-400';
      case 'critical': return 'text-red-600';
      default: return 'text-gray-400';
    }
  };

  return (
    <div className="micro-coach-dashboard space-y-6">
      {/* 🧠 HEADER & CONTROLS */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold holographic-text flex items-center space-x-3">
            <span>🧠</span>
            <span>AI MICRO COACH</span>
            <span className="text-xs bg-gradient-to-r from-purple-500 to-pink-500 text-white px-2 py-1 rounded-full animate-pulse">
              PATTERN GENIUS
            </span>
          </h2>
          <p className="text-gray-300 text-sm mt-1">
            AI-powered performance insights • Pattern recognition • Personalized optimization
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex bg-gray-900 rounded-lg p-1">
            <button
              onClick={() => setViewMode('insights')}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                viewMode === 'insights' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              💡 Insights
            </button>
            <button
              onClick={() => setViewMode('patterns')}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                viewMode === 'patterns' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              🔍 Patterns
            </button>
            <button
              onClick={() => setViewMode('performance')}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                viewMode === 'performance' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              📊 Performance
            </button>
            <button
              onClick={() => setViewMode('risk')}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                viewMode === 'risk' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              ⚠️ Risk
            </button>
            <button
              onClick={() => setViewMode('chat')}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                viewMode === 'chat' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              🧠 AI Chat
            </button>
          </div>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`btn-gaming text-xs px-3 py-2 ${
              autoRefresh ? 'bg-green-600' : 'bg-gray-600'
            }`}
          >
            {autoRefresh ? '🔄 Auto' : '⏸️ Manual'}
          </button>
          
          <button
            onClick={performCoachingAnalysis}
            disabled={state.isAnalyzing}
            onMouseEnter={() => audioManager.buttonHover()}
            className="btn-gaming px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600"
          >
            {state.isAnalyzing ? (
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Analyzing...</span>
              </div>
            ) : (
              <span>🧠 Analyze</span>
            )}
          </button>
        </div>
      </div>

      {/* 💡 DAILY INSIGHT SPOTLIGHT */}
      {state.dailyInsight && (
        <div className={`glass-card p-6 border ${getInsightColor(state.dailyInsight)}`}>
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <div className="flex items-center space-x-3 mb-2">
                <span className="text-2xl">{getInsightIcon(state.dailyInsight.type)}</span>
                <h3 className="text-xl font-bold">{state.dailyInsight.title}</h3>
                <span className={`text-xs px-2 py-1 rounded ${getInsightColor(state.dailyInsight)}`}>
                  {state.dailyInsight.urgency.toUpperCase()}
                </span>
              </div>
              
              <p className="text-gray-200 mb-4">{state.dailyInsight.message}</p>
              
              {state.dailyInsight.evidence.length > 0 && (
                <div className="mb-4">
                  <h5 className="font-medium text-sm mb-2">📊 Evidence:</h5>
                  <div className="space-y-1">
                    {state.dailyInsight.evidence.map((evidence, index) => (
                      <div key={index} className="text-sm text-gray-300">• {evidence}</div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center space-x-4 text-sm">
                <div className="flex items-center space-x-1">
                  <span className="text-gray-400">Impact:</span>
                  <span className={getImplementationCostColor(state.dailyInsight.expectedImpact)}>
                    {state.dailyInsight.expectedImpact}
                  </span>
                </div>
                <div className="flex items-center space-x-1">
                  <span className="text-gray-400">Cost:</span>
                  <span className={getImplementationCostColor(state.dailyInsight.implementationCost)}>
                    {state.dailyInsight.implementationCost}
                  </span>
                </div>
                <div className="flex items-center space-x-1">
                  <span className="text-gray-400">Categories:</span>
                  <span className="text-cyan-400">{state.dailyInsight.categories.join(', ')}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col space-y-2 ml-4">
              {state.dailyInsight.actionable && (
                <button
                  onClick={() => handleInsightInteraction(state.dailyInsight!, 'implement')}
                  onMouseEnter={() => audioManager.buttonHover()}
                  className="btn-gaming text-sm px-4 py-2 bg-gradient-to-r from-green-600 to-green-700"
                >
                  ✅ Implement
                </button>
              )}
              
              <button
                onClick={() => handleInsightInteraction(state.dailyInsight!, 'view')}
                className="btn-gaming text-sm px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700"
              >
                👁️ Details
              </button>

              <div className="flex space-x-1 mt-2">
                <button
                  onClick={() => handleInsightFeedback(state.dailyInsight!.id, 'helpful')}
                  className="text-xs px-2 py-1 rounded bg-green-900/30 text-green-400 hover:bg-green-900/50"
                  title="Helpful"
                >
                  👍
                </button>
                <button
                  onClick={() => handleInsightFeedback(state.dailyInsight!.id, 'neutral')}
                  className="text-xs px-2 py-1 rounded bg-gray-900/30 text-gray-400 hover:bg-gray-900/50"
                  title="Neutral"
                >
                  😐
                </button>
                <button
                  onClick={() => handleInsightFeedback(state.dailyInsight!.id, 'not_helpful')}
                  className="text-xs px-2 py-1 rounded bg-red-900/30 text-red-400 hover:bg-red-900/50"
                  title="Not helpful"
                >
                  👎
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 📊 MAIN CONTENT BASED ON VIEW MODE */}
      {viewMode === 'insights' && (
        <div className="space-y-6">
          {/* OPTIMIZATION SUGGESTIONS */}
          {state.optimizations.length > 0 && (
            <div className="glass-card p-6">
              <h4 className="text-lg font-bold text-cyan-400 mb-4">💡 Optimization Suggestions</h4>
              <div className="space-y-3">
                {state.optimizations.map((optimization, index) => (
                  <div key={optimization.id} className={`border rounded-lg p-4 ${getInsightColor(optimization)}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                          <span className="text-lg">{getInsightIcon(optimization.type)}</span>
                          <span className="font-medium">{optimization.title}</span>
                          <span className={`text-xs px-2 py-1 rounded ${getImplementationCostColor(optimization.implementationCost)}`}>
                            {optimization.implementationCost} cost
                          </span>
                        </div>
                        <p className="text-sm text-gray-300 mb-2">{optimization.message}</p>
                        <div className="text-xs text-gray-400">
                          Categories: {optimization.categories.join(', ')}
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2 ml-4">
                        <button
                          onClick={() => handleInsightInteraction(optimization, 'implement')}
                          className="btn-gaming text-xs px-3 py-1 bg-blue-600"
                        >
                          Apply
                        </button>
                        <button
                          onClick={() => setSelectedInsight(optimization)}
                          className="text-lg opacity-50 hover:opacity-100"
                        >
                          ℹ️
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {viewMode === 'patterns' && (
        <div className="glass-card p-6">
          <h4 className="text-lg font-bold text-cyan-400 mb-4">🔍 Detected Behavioral Patterns</h4>
          {state.recentPatterns.length > 0 ? (
            <div className="space-y-3">
              {state.recentPatterns.map((pattern, index) => (
                <div key={index} className="border border-gray-600/30 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="font-medium capitalize text-cyan-400">
                          {pattern.pattern.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300">
                          {Math.round(pattern.confidence * 100)}% confidence
                        </span>
                      </div>
                      <div className="text-sm text-gray-300 mb-1">
                        Frequency: {Math.round(pattern.frequency * 100)}%
                      </div>
                      {pattern.suggestedAction && (
                        <div className="text-sm text-yellow-400">
                          💡 {pattern.suggestedAction}
                        </div>
                      )}
                    </div>
                    
                    <div className="text-right">
                      <div className="text-xs text-gray-400">
                        {pattern.dataPoints.length} data points
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-400 py-8">
              <div className="text-4xl mb-2">🔍</div>
              <p>No significant patterns detected yet.</p>
              <p className="text-sm">More data needed for pattern analysis.</p>
            </div>
          )}
        </div>
      )}

      {viewMode === 'performance' && state.userPerformance && (
        <div className="space-y-6">
          {/* PERFORMANCE METRICS OVERVIEW */}
          <div className="glass-card p-6">
            <h4 className="text-lg font-bold text-cyan-400 mb-4">📊 Performance Metrics</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* PRODUCTIVITY */}
              <div className="text-center">
                <h5 className="font-bold text-green-400 mb-3">🚀 Productivity</h5>
                <div className="space-y-2">
                  <div>
                    <div className="text-2xl font-bold">
                      {state.userPerformance.productivity.tasksCompletedPerDay.toFixed(1)}
                    </div>
                    <div className="text-sm text-gray-400">Tasks/day</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold">
                      {Math.round(state.userPerformance.productivity.focusTimePerDay)} min
                    </div>
                    <div className="text-sm text-gray-400">Focus time/day</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold">
                      {Math.round(state.userPerformance.productivity.planAdherence * 100)}%
                    </div>
                    <div className="text-sm text-gray-400">Plan adherence</div>
                  </div>
                </div>
              </div>

              {/* GOAL PROGRESS */}
              <div className="text-center">
                <h5 className="font-bold text-blue-400 mb-3">🎯 Goal Progress</h5>
                <div className="space-y-2">
                  <div>
                    <div className="text-2xl font-bold">
                      {state.userPerformance.goalProgress.milestonesHit}
                    </div>
                    <div className="text-sm text-gray-400">Milestones hit</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-red-400">
                      {state.userPerformance.goalProgress.atRiskGoals}
                    </div>
                    <div className="text-sm text-gray-400">At-risk goals</div>
                  </div>
                </div>
              </div>

              {/* WELLBEING */}
              <div className="text-center">
                <h5 className="font-bold text-purple-400 mb-3">💜 Wellbeing</h5>
                <div className="space-y-2">
                  <div>
                    <div className="text-2xl font-bold">
                      {Math.round(state.userPerformance.wellbeing.energyConsistency * 100)}%
                    </div>
                    <div className="text-sm text-gray-400">Energy consistency</div>
                  </div>
                  <div>
                    <div className={`text-lg font-bold ${
                      state.userPerformance.wellbeing.burnoutRisk > 0.7 ? 'text-red-400' :
                      state.userPerformance.wellbeing.burnoutRisk > 0.4 ? 'text-yellow-400' : 'text-green-400'
                    }`}>
                      {Math.round(state.userPerformance.wellbeing.burnoutRisk * 100)}%
                    </div>
                    <div className="text-sm text-gray-400">Burnout risk</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewMode === 'risk' && (
        <RiskDashboard
          goals={goals}
          keyResults={keyResults}
          tasks={tasks}
          historicalData={[]} // Pass actual historical data when available
          onRiskAction={(action, goalId) => {
            console.log('⚠️ RISK ACTION:', action, goalId);
            if (action === 'view') {
              // Could switch to goal analytics tab or show goal details
            }
          }}
        />
      )}

      {viewMode === 'chat' && (
        <div className="h-[600px]">
          <SecondBrainChat
            goals={goals}
            keyResults={keyResults}
            tasks={tasks}
            sessions={sessions}
            habitLogs={habitLogs}
            timeBlocks={timeBlocks}
          />
        </div>
      )}

      {/* 📚 COACHING HISTORY */}
      {state.analysisHistory.length > 0 && (
        <div className="glass-card p-4">
          <details>
            <summary className="cursor-pointer font-bold text-cyan-400 hover:text-cyan-300 mb-3">
              📚 Recent Coaching History
            </summary>
            <div className="space-y-2 mt-3">
              {state.analysisHistory.slice(-5).map((analysis, index) => (
                <div key={index} className="flex items-center justify-between text-sm bg-gray-800/30 rounded p-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-400">{analysis.date.toLocaleDateString()}</span>
                    <span className="text-cyan-400">{analysis.insight.type}</span>
                    <span className="text-gray-300">{analysis.insight.title}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    {analysis.implemented ? (
                      <span className="text-green-400">✅ Implemented</span>
                    ) : (
                      <span className="text-gray-400">⏳ Pending</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* 💡 COACHING INSIGHTS GUIDE */}
      <div className="glass-card p-4">
        <details>
          <summary className="cursor-pointer font-bold text-cyan-400 hover:text-cyan-300 mb-3">
            💡 How AI Micro Coaching Works
          </summary>
          <div className="space-y-3 mt-3 text-sm text-gray-300">
            <p><strong>🧠 Pattern Recognition:</strong> Analyzes your behavioral data to identify recurring patterns in productivity, energy, and goal completion</p>
            <p><strong>📊 Performance Analysis:</strong> Tracks key metrics like task completion, energy consistency, and goal progress to identify optimization opportunities</p>
            <p><strong>🎯 Personalized Insights:</strong> Generates daily coaching insights tailored to your working style, energy patterns, and performance metrics</p>
            <p><strong>💡 Actionable Recommendations:</strong> Provides specific, implementable suggestions with estimated impact and implementation cost</p>
            <p><strong>🔄 Continuous Learning:</strong> Adapts recommendations based on your feedback and implementation success over time</p>
            <p><strong>⚠️ Early Warning System:</strong> Detects early signs of burnout, goal drift, or productivity decline before they become critical issues</p>
          </div>
        </details>
      </div>
    </div>
  );
}