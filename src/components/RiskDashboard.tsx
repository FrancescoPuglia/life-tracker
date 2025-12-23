'use client';

// ⚠️ RISK DASHBOARD - Predictive Analytics & Future Problem Detection
// MODALITÀ PSICOPATICO APOCALITTICO 🔥🔥🔥🔥🔥

import { useState, useEffect } from 'react';
import { riskPredictor } from '@/lib/riskPredictor';
import { GoalRiskAssessment, TrajectoryPrediction, RiskFactor } from '@/types/ai-enhanced';
import { Goal, KeyResult, Task } from '@/types';
import { audioManager } from '@/lib/audioManager';

interface RiskDashboardProps {
  goals: Goal[];
  keyResults: KeyResult[];
  tasks: Task[];
  historicalData?: any[];
  onRiskAction?: (action: string, goalId: string) => void;
}

interface RiskAnalysisState {
  isAnalyzing: boolean;
  goalRisks: Record<string, GoalRiskAssessment>;
  trajectories: Record<string, TrajectoryPrediction>;
  overallRiskScore: number;
  criticalRisks: GoalRiskAssessment[];
  riskTrends: Array<{
    date: Date;
    totalRisk: number;
    criticalCount: number;
    highCount: number;
  }>;
}

interface RiskAlert {
  id: string;
  goalId: string;
  type: 'velocity_drop' | 'deadline_risk' | 'resource_shortage' | 'dependency_failure';
  severity: 'critical' | 'high' | 'medium';
  message: string;
  actionRequired: boolean;
  timeToImpact: number; // days
  recommendations: string[];
}

export default function RiskDashboard({
  goals,
  keyResults,
  tasks,
  historicalData = [],
  onRiskAction
}: RiskDashboardProps) {
  const [state, setState] = useState<RiskAnalysisState>({
    isAnalyzing: false,
    goalRisks: {},
    trajectories: {},
    overallRiskScore: 0,
    criticalRisks: [],
    riskTrends: []
  });

  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const [showAlerts, setShowAlerts] = useState(true);
  const [riskAlerts, setRiskAlerts] = useState<RiskAlert[]>([]);
  const [analysisMode, setAnalysisMode] = useState<'overview' | 'detailed' | 'predictions'>('overview');
  const [autoRefresh, setAutoRefresh] = useState(true);

  // 🚀 INITIALIZE RISK ANALYSIS
  useEffect(() => {
    if (goals.length > 0) {
      performRiskAnalysis();
    }
  }, [goals, keyResults, tasks]);

  // ⏰ AUTO-REFRESH RISK ANALYSIS
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      performRiskAnalysis();
    }, 300000); // Every 5 minutes

    return () => clearInterval(interval);
  }, [autoRefresh, goals]);

  // 🔍 MAIN RISK ANALYSIS ENGINE
  const performRiskAnalysis = async () => {
    setState(prev => ({ ...prev, isAnalyzing: true }));
    
    try {
      console.log('⚠️ RISK ANALYSIS: Analyzing', goals.length, 'goals');
      
      const goalRisks: Record<string, GoalRiskAssessment> = {};
      const trajectories: Record<string, TrajectoryPrediction> = {};
      const alerts: RiskAlert[] = [];

      // 🎯 ANALYZE EACH GOAL
      for (const goal of goals) {
        if (goal.status === 'completed') continue; // Skip completed goals
        
        const goalKeyResults = keyResults.filter(kr => kr.goalId === goal.id);
        const goalTasks = tasks.filter(task => task.goalId === goal.id);
        
        try {
          // Risk assessment
          const riskAssessment = await riskPredictor.assessGoalRisk(goal, goalKeyResults, historicalData);
          goalRisks[goal.id] = riskAssessment;
          
          // Trajectory prediction
          const currentProgress = goalKeyResults.length > 0 
            ? goalKeyResults.reduce((sum, kr) => sum + (kr.progress ?? 0), 0) / (goalKeyResults.length * 100)
            : 0;
          
          const trajectory = await riskPredictor.predictTrajectory(goal, currentProgress);
          trajectories[goal.id] = trajectory;
          
          // Generate alerts for high-risk situations
          const alert = generateRiskAlert(goal, riskAssessment, trajectory);
          if (alert) {
            alerts.push(alert);
          }
          
        } catch (error) {
          console.warn('Risk analysis failed for goal:', goal.title, error);
        }
      }

      // 📊 CALCULATE OVERALL METRICS
      const allRisks = Object.values(goalRisks);
      const overallRiskScore = calculateOverallRisk(allRisks);
      const criticalRisks = allRisks.filter(risk => risk.riskLevel === 'critical' || risk.riskLevel === 'high');
      
      // 📈 UPDATE RISK TRENDS
      const newTrend = {
        date: new Date(),
        totalRisk: overallRiskScore,
        criticalCount: allRisks.filter(r => r.riskLevel === 'critical').length,
        highCount: allRisks.filter(r => r.riskLevel === 'high').length
      };

      setState(prev => ({
        ...prev,
        isAnalyzing: false,
        goalRisks,
        trajectories,
        overallRiskScore,
        criticalRisks,
        riskTrends: [...prev.riskTrends.slice(-9), newTrend] // Keep last 10 data points
      }));

      setRiskAlerts(alerts);
      
      // 🎮 AUDIO FEEDBACK
      if (criticalRisks.length > 0) {
        audioManager.play('error');
      } else if (overallRiskScore > 0.6) {
        audioManager.buttonFeedback();
      }

      console.log('⚠️ RISK ANALYSIS COMPLETE:', {
        goalCount: goals.length,
        overallRisk: Math.round(overallRiskScore * 100),
        criticalRisks: criticalRisks.length,
        alerts: alerts.length
      });

    } catch (error) {
      console.error('⚠️ RISK ANALYSIS ERROR:', error);
      setState(prev => ({ ...prev, isAnalyzing: false }));
    }
  };

  // 🚨 ALERT GENERATION
  const generateRiskAlert = (goal: Goal, risk: GoalRiskAssessment, trajectory: TrajectoryPrediction): RiskAlert | null => {
    const now = new Date();
    const deadline = new Date(goal.targetDate);
    const daysToDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    
    // Critical velocity alert
    if (risk.riskLevel === 'critical' || (risk.currentVelocity < risk.requiredVelocity * 0.5 && daysToDeadline < 30)) {
      return {
        id: `velocity-${goal.id}-${Date.now()}`,
        goalId: goal.id,
        type: 'velocity_drop',
        severity: 'critical',
        message: `Goal "${goal.title}" severely behind schedule. Current velocity ${Math.round(risk.currentVelocity * 100)}% vs required ${Math.round(risk.requiredVelocity * 100)}%`,
        actionRequired: true,
        timeToImpact: Math.max(1, daysToDeadline),
        recommendations: risk.recommendations.slice(0, 3)
      };
    }
    
    // Deadline risk alert
    if (trajectory.scenarios.realistic.completion > deadline && daysToDeadline < 60) {
      return {
        id: `deadline-${goal.id}-${Date.now()}`,
        goalId: goal.id,
        type: 'deadline_risk',
        severity: daysToDeadline < 14 ? 'critical' : 'high',
        message: `Goal "${goal.title}" unlikely to meet deadline. Predicted completion: ${trajectory.scenarios.realistic.completion.toLocaleDateString()}`,
        actionRequired: true,
        timeToImpact: Math.max(1, daysToDeadline),
        recommendations: [
          'Reduce scope to essential deliverables',
          'Extend deadline if possible',
          'Add resources or support',
          'Focus on highest-impact activities'
        ]
      };
    }

    return null;
  };

  // 📊 OVERALL RISK CALCULATION
  const calculateOverallRisk = (risks: GoalRiskAssessment[]): number => {
    if (risks.length === 0) return 0;
    
    const riskValues = risks.map(risk => {
      switch (risk.riskLevel) {
        case 'critical': return 1.0;
        case 'high': return 0.75;
        case 'medium': return 0.5;
        case 'low': return 0.25;
        default: return 0.5;
      }
    });
    
    const weightedSum = riskValues.reduce((sum, value, index) => {
      const goal = goals[index];
      const weight = goal?.priority === 'critical' ? 2 : goal?.priority === 'high' ? 1.5 : 1;
      return sum + value * weight;
    }, 0);
    
    const totalWeight = riskValues.reduce((sum, _, index) => {
      const goal = goals[index];
      const weight = goal?.priority === 'critical' ? 2 : goal?.priority === 'high' ? 1.5 : 1;
      return sum + weight;
    }, 0);
    
    return weightedSum / totalWeight;
  };

  // 🎨 STYLING HELPERS
  const getRiskColor = (level: string): string => {
    switch (level) {
      case 'critical': return 'text-red-400 bg-red-900/20 border-red-400';
      case 'high': return 'text-orange-400 bg-orange-900/20 border-orange-400';
      case 'medium': return 'text-yellow-400 bg-yellow-900/20 border-yellow-400';
      case 'low': return 'text-green-400 bg-green-900/20 border-green-400';
      default: return 'text-gray-400 bg-gray-900/20 border-gray-400';
    }
  };

  const getRiskIcon = (level: string): string => {
    switch (level) {
      case 'critical': return '🚨';
      case 'high': return '⚠️';
      case 'medium': return '⚡';
      case 'low': return '✅';
      default: return '❓';
    }
  };

  const getOverallRiskLevel = (): { level: string; color: string; icon: string } => {
    if (state.overallRiskScore > 0.8) return { level: 'CRITICAL', color: 'text-red-400', icon: '🚨' };
    if (state.overallRiskScore > 0.6) return { level: 'HIGH', color: 'text-orange-400', icon: '⚠️' };
    if (state.overallRiskScore > 0.4) return { level: 'MEDIUM', color: 'text-yellow-400', icon: '⚡' };
    return { level: 'LOW', color: 'text-green-400', icon: '✅' };
  };

  const formatVelocity = (velocity: number): string => {
    return `${Math.round(velocity * 100)}%/week`;
  };

  const formatDaysUntil = (date: Date): string => {
    const now = new Date();
    const days = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 7) return `${days} days`;
    if (days < 30) return `${Math.ceil(days / 7)} weeks`;
    return `${Math.ceil(days / 30)} months`;
  };

  const selectedGoalData = selectedGoal ? state.goalRisks[selectedGoal] : null;
  const selectedTrajectory = selectedGoal ? state.trajectories[selectedGoal] : null;
  const overallRisk = getOverallRiskLevel();

  return (
    <div className="risk-dashboard space-y-6">
      {/* 🎯 HEADER & CONTROLS */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold holographic-text flex items-center space-x-3">
            <span>⚠️</span>
            <span>RISK PREDICTOR</span>
            <span className="text-xs bg-gradient-to-r from-red-500 to-orange-500 text-white px-2 py-1 rounded-full animate-pulse">
              APOCALITTICO MODE
            </span>
          </h2>
          <p className="text-gray-300 text-sm mt-1">
            Predictive analytics • Future problem detection • Trajectory forecasting
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`btn-gaming text-xs px-3 py-2 ${
              autoRefresh ? 'bg-green-600' : 'bg-gray-600'
            }`}
          >
            {autoRefresh ? '🔄 Auto' : '⏸️ Manual'}
          </button>
          
          <button
            onClick={performRiskAnalysis}
            disabled={state.isAnalyzing}
            onMouseEnter={() => audioManager.buttonHover()}
            className="btn-gaming px-4 py-2 bg-gradient-to-r from-red-600 to-orange-600"
          >
            {state.isAnalyzing ? (
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Analyzing...</span>
              </div>
            ) : (
              <span>⚠️ Analyze Risks</span>
            )}
          </button>
        </div>
      </div>

      {/* 🚨 CRITICAL ALERTS */}
      {showAlerts && riskAlerts.length > 0 && (
        <div className="space-y-3">
          {riskAlerts.slice(0, 3).map((alert, index) => (
            <div key={alert.id} className={`border rounded-lg p-4 ${getRiskColor(alert.severity)} animate-pulse-slow`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <span className="text-2xl">{alert.type === 'velocity_drop' ? '📉' : 
                                                  alert.type === 'deadline_risk' ? '⏰' :
                                                  alert.type === 'resource_shortage' ? '⚡' : '🔗'}</span>
                    <span className="font-bold uppercase">{alert.severity} ALERT</span>
                    <span className="text-sm opacity-75">
                      Impact in {alert.timeToImpact} day{alert.timeToImpact !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <p className="mb-3">{alert.message}</p>
                  <div className="space-y-1">
                    {alert.recommendations.slice(0, 2).map((rec, i) => (
                      <div key={i} className="text-sm opacity-90">• {rec}</div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center space-x-2 ml-4">
                  <button
                    onClick={() => onRiskAction?.('view', alert.goalId)}
                    className="btn-gaming text-xs px-3 py-1 bg-blue-600"
                  >
                    View Goal
                  </button>
                  <button
                    onClick={() => setRiskAlerts(prev => prev.filter(a => a.id !== alert.id))}
                    className="text-lg opacity-50 hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 📊 OVERALL RISK OVERVIEW */}
      <div className="glass-card p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="text-center">
            <div className={`text-4xl font-bold ${overallRisk.color} mb-2`}>
              {overallRisk.icon} {Math.round(state.overallRiskScore * 100)}%
            </div>
            <div className="text-sm text-gray-400">Overall Risk</div>
            <div className={`text-xs ${overallRisk.color} font-bold mt-1`}>
              {overallRisk.level}
            </div>
          </div>

          <div className="text-center">
            <div className="text-3xl font-bold text-red-400 mb-2">
              {state.criticalRisks.filter(r => r.riskLevel === 'critical').length}
            </div>
            <div className="text-sm text-gray-400">Critical Risks</div>
          </div>

          <div className="text-center">
            <div className="text-3xl font-bold text-orange-400 mb-2">
              {state.criticalRisks.filter(r => r.riskLevel === 'high').length}
            </div>
            <div className="text-sm text-gray-400">High Risks</div>
          </div>

          <div className="text-center">
            <div className="text-3xl font-bold text-cyan-400 mb-2">
              {Object.keys(state.goalRisks).length}
            </div>
            <div className="text-sm text-gray-400">Goals Analyzed</div>
          </div>
        </div>

        {/* RISK TREND MINI-CHART */}
        {state.riskTrends.length > 3 && (
          <div className="mt-6 p-4 bg-gray-900/50 rounded-lg">
            <h4 className="text-sm font-bold text-cyan-400 mb-3">📈 Risk Trend (Last 10 Analyses)</h4>
            <div className="flex items-end space-x-2 h-16">
              {state.riskTrends.map((trend, index) => (
                <div
                  key={index}
                  className="flex-1 bg-gradient-to-t from-red-600 to-orange-400 rounded-t opacity-70 hover:opacity-100 transition-opacity"
                  style={{ height: `${trend.totalRisk * 100}%` }}
                  title={`Risk: ${Math.round(trend.totalRisk * 100)}% (${trend.criticalCount} critical, ${trend.highCount} high)`}
                ></div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 🎯 GOAL-SPECIFIC RISK ANALYSIS */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold neon-text">Goal Risk Analysis</h3>
          <div className="flex items-center space-x-2">
            <select
              value={selectedGoal || ''}
              onChange={(e) => setSelectedGoal(e.target.value || null)}
              className="bg-gray-900 border border-cyan-400/30 rounded px-3 py-1 text-white text-sm"
            >
              <option value="">All Goals Overview</option>
              {goals.filter(g => g.status !== 'completed').map(goal => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedGoal && selectedGoalData ? (
          /* DETAILED GOAL ANALYSIS */
          <div className="space-y-6">
            <div className={`border rounded-lg p-4 ${getRiskColor(selectedGoalData.riskLevel)}`}>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-lg font-bold">
                  {getRiskIcon(selectedGoalData.riskLevel)} {goals.find(g => g.id === selectedGoal)?.title}
                </h4>
                <div className="flex items-center space-x-3">
                  <span className="font-mono text-sm">
                    {Math.round(selectedGoalData.confidence * 100)}% confidence
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-2xl font-bold">
                    {formatVelocity(selectedGoalData.currentVelocity)}
                  </div>
                  <div className="text-sm opacity-75">Current Velocity</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">
                    {formatVelocity(selectedGoalData.requiredVelocity)}
                  </div>
                  <div className="text-sm opacity-75">Required Velocity</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">
                    {formatDaysUntil(selectedGoalData.estimatedCompletion)}
                  </div>
                  <div className="text-sm opacity-75">Est. Completion</div>
                </div>
              </div>

              {/* RISK FACTORS */}
              {selectedGoalData.riskFactors.length > 0 && (
                <div className="mb-4">
                  <h5 className="font-bold mb-2">⚠️ Risk Factors:</h5>
                  <div className="space-y-2">
                    {selectedGoalData.riskFactors.map((factor, index) => (
                      <div key={index} className="bg-black/20 rounded p-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium capitalize">{factor.type}</span>
                          <span className={`text-xs px-2 py-1 rounded ${getRiskColor(factor.impact)}`}>
                            {factor.impact.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-sm opacity-90 mb-1">{factor.description}</p>
                        {factor.mitigation && (
                          <p className="text-xs opacity-75">💡 {factor.mitigation}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* RECOMMENDATIONS */}
              <div>
                <h5 className="font-bold mb-2">🎯 Recommendations:</h5>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {selectedGoalData.recommendations.map((rec, index) => (
                    <div key={index} className="bg-black/20 rounded p-2 text-sm">
                      {rec}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* TRAJECTORY PREDICTION */}
            {selectedTrajectory && (
              <div className="bg-gray-900/50 border border-gray-600/30 rounded-lg p-4">
                <h5 className="font-bold text-cyan-400 mb-3">📈 Trajectory Prediction</h5>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="text-center">
                    <div className="text-lg font-bold text-green-400">
                      {formatDaysUntil(selectedTrajectory.scenarios.optimistic.completion)}
                    </div>
                    <div className="text-sm text-gray-400">Optimistic (10%)</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-yellow-400">
                      {formatDaysUntil(selectedTrajectory.scenarios.realistic.completion)}
                    </div>
                    <div className="text-sm text-gray-400">Realistic (50%)</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-red-400">
                      {formatDaysUntil(selectedTrajectory.scenarios.conservative.completion)}
                    </div>
                    <div className="text-sm text-gray-400">Conservative (90%)</div>
                  </div>
                </div>

                {selectedTrajectory.keyMilestones.length > 0 && (
                  <div className="mb-4">
                    <h6 className="font-medium mb-2">🎯 Key Milestones:</h6>
                    <div className="space-y-1">
                      {selectedTrajectory.keyMilestones.map((milestone, index) => (
                        <div key={index} className="flex justify-between text-sm">
                          <span>{milestone.milestone}</span>
                          <span className="opacity-75">{formatDaysUntil(milestone.predictedDate)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedTrajectory.blockers.length > 0 && (
                  <div>
                    <h6 className="font-medium mb-2">🚧 Predicted Blockers:</h6>
                    <div className="space-y-1">
                      {selectedTrajectory.blockers.map((blocker, index) => (
                        <div key={index} className="text-sm bg-red-900/20 rounded p-2">
                          {blocker}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* ALL GOALS OVERVIEW */
          <div className="space-y-3">
            {Object.entries(state.goalRisks).map(([goalId, risk]) => {
              const goal = goals.find(g => g.id === goalId);
              if (!goal) return null;

              return (
                <div
                  key={goalId}
                  className={`border rounded-lg p-4 cursor-pointer transition-all hover:bg-white/5 ${getRiskColor(risk.riskLevel)}`}
                  onClick={() => setSelectedGoal(goalId)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <span className="text-xl">{getRiskIcon(risk.riskLevel)}</span>
                        <span className="font-bold">{goal.title}</span>
                        <span className={`text-xs px-2 py-1 rounded ${getRiskColor(risk.riskLevel)}`}>
                          {risk.riskLevel.toUpperCase()}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <div className="opacity-75">Current Velocity</div>
                          <div className="font-mono">{formatVelocity(risk.currentVelocity)}</div>
                        </div>
                        <div>
                          <div className="opacity-75">Required Velocity</div>
                          <div className="font-mono">{formatVelocity(risk.requiredVelocity)}</div>
                        </div>
                        <div>
                          <div className="opacity-75">Est. Completion</div>
                          <div className="font-mono">{formatDaysUntil(risk.estimatedCompletion)}</div>
                        </div>
                        <div>
                          <div className="opacity-75">Confidence</div>
                          <div className="font-mono">{Math.round(risk.confidence * 100)}%</div>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg">→</div>
                      <div className="text-xs opacity-75">Click for details</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 💡 RISK INSIGHTS & TIPS */}
      <div className="glass-card p-4">
        <details>
          <summary className="cursor-pointer font-bold text-cyan-400 hover:text-cyan-300 mb-3">
            💡 Risk Analysis Insights
          </summary>
          <div className="space-y-3 mt-3 text-sm text-gray-300">
            <p><strong>🎯 Velocity Analysis:</strong> Compares current progress rate vs required rate to meet deadlines</p>
            <p><strong>📈 Trajectory Prediction:</strong> Monte Carlo simulation with 1000+ scenarios for completion forecasting</p>
            <p><strong>🔍 Bottleneck Detection:</strong> Identifies time, skill, dependency, and energy constraints automatically</p>
            <p><strong>🧠 Pattern Recognition:</strong> Uses historical data and ML to predict likely failure patterns</p>
            <p><strong>🎭 Risk Simulation:</strong> Models various failure scenarios with probability and impact assessment</p>
            <p><strong>⚠️ Early Warning System:</strong> Alerts before problems become critical with actionable recommendations</p>
          </div>
        </details>
      </div>
    </div>
  );
}