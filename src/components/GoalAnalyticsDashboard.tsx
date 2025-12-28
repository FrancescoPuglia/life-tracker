'use client';

import { useState, useEffect } from 'react';
import { Goal, GoalAnalytics, StrategicAllocation } from '@/types';
import { goalAnalyticsEngine } from '@/lib/goalAnalyticsEngine';

interface GoalAnalyticsDashboardProps {
  goals: Goal[];
  userId: string;
  selectedGoalId?: string;
  onGoalSelect: (goalId: string) => void;
}

export default function GoalAnalyticsDashboard({ 
  goals, 
  userId, 
  selectedGoalId,
  onGoalSelect 
}: GoalAnalyticsDashboardProps) {
  const [goalAnalytics, setGoalAnalytics] = useState<GoalAnalytics[]>([]);
  const [strategicAllocation, setStrategicAllocation] = useState<StrategicAllocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState(30);

  useEffect(() => {
    loadAnalytics();
  }, [goals, selectedPeriod]);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      // 🔥 SAFE LOADING: Process goals one by one to isolate errors
      const activeGoals = goals.filter(g => g.status === 'active');
      const analytics: GoalAnalytics[] = [];
      
      for (const goal of activeGoals) {
        try {
          const goalAnalytics = await goalAnalyticsEngine.calculateGoalAnalytics(goal.id, selectedPeriod);
          analytics.push(goalAnalytics);
        } catch (goalError) {
          console.warn(`🚨 Failed to load analytics for goal "${goal.title}" (${goal.id}):`, goalError);
          // Continue with other goals instead of failing completely
        }
      }
      
      let allocation: StrategicAllocation | null = null;
      try {
        allocation = await goalAnalyticsEngine.calculateStrategicAllocation(userId);
      } catch (allocationError) {
        console.warn('🚨 Failed to load strategic allocation:', allocationError);
      }

      setGoalAnalytics(analytics);
      setStrategicAllocation(allocation);
    } catch (error) {
      console.error('🚨 Critical error loading goal analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const selectedAnalytics = goalAnalytics.find(a => a.goalId === selectedGoalId);
  const selectedGoal = goals.find(g => g.id === selectedGoalId);

  if (loading) {
    return (
      <div className="glass-card p-8 text-center">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-gray-600">🧠 Analyzing your goal performance...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900 flex items-center">
            🎯 Goal Analytics Dashboard
          </h2>
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(Number(e.target.value))}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
        </div>

        {/* Goal Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {goalAnalytics.map((analytics) => {
            const goal = goals.find(g => g.id === analytics.goalId);
            if (!goal) return null;

            const isSelected = selectedGoalId === goal.id;
            
            return (
              <div
                key={goal.id}
                onClick={() => onGoalSelect(goal.id)}
                className={`cursor-pointer rounded-xl p-4 border-2 transition-all duration-200 transform hover:scale-105 ${
                  isSelected 
                    ? 'border-blue-500 bg-blue-50 shadow-lg' 
                    : 'border-gray-200 bg-white hover:border-blue-300'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-bold text-gray-900 truncate">{goal.title}</h3>
                  <div className={`px-2 py-1 rounded-full text-xs font-bold ${getPriorityColor(goal.priority)}`}>
                    {goal.priority.toUpperCase()}
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Progress:</span>
                    <span className="font-bold text-blue-600">{analytics.completion.currentProgress.toFixed(1)}%</span>
                  </div>
                  
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, analytics.completion.currentProgress)}%` }}
                    ></div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-gray-500">Hours/week:</span>
                      <span className="ml-1 font-bold">{analytics.timeInvestment.weeklyActual.toFixed(1)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Efficiency:</span>
                      <span className={`ml-1 font-bold ${getEfficiencyColor(analytics.roi.efficiency)}`}>
                        {analytics.roi.efficiency.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  
                  <div className={`text-xs font-bold ${getTrackStatusColor(analytics.completion.onTrackStatus)}`}>
                    📊 {analytics.completion.onTrackStatus.replace('_', ' ').toUpperCase()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Strategic Allocation Overview */}
      {strategicAllocation && (
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
            ⚖️ Strategic Time Allocation
          </h3>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Misalignment Score */}
            <div className="bg-gradient-to-r from-gray-50 to-blue-50 rounded-xl p-4">
              <h4 className="font-bold text-gray-800 mb-2">📈 Alignment Score</h4>
              <div className="flex items-center space-x-4">
                <div className="flex-1">
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div 
                      className={`h-3 rounded-full transition-all duration-500 ${
                        strategicAllocation.misalignmentScore < 30 ? 'bg-green-500' :
                        strategicAllocation.misalignmentScore < 60 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${100 - strategicAllocation.misalignmentScore}%` }}
                    ></div>
                  </div>
                </div>
                <span className="font-bold text-lg">
                  {(100 - strategicAllocation.misalignmentScore).toFixed(0)}%
                </span>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{strategicAllocation.currentAllocation.length}</div>
                <div className="text-xs text-gray-600">Active Goals</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{strategicAllocation.rebalancingSuggestions.length}</div>
                <div className="text-xs text-gray-600">Rebalance Ideas</div>
              </div>
            </div>
          </div>

          {/* Rebalancing Suggestions */}
          {strategicAllocation.rebalancingSuggestions.length > 0 && (
            <div className="mt-6">
              <h4 className="font-bold text-gray-800 mb-3">🔄 Rebalancing Suggestions</h4>
              <div className="space-y-2">
                {strategicAllocation.rebalancingSuggestions.slice(0, 3).map((suggestion, index) => (
                  <div key={index} className="bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-800">
                        Move <strong>{suggestion.hours}h</strong> from {getGoalTitle(suggestion.fromGoal, goals)} 
                        → {getGoalTitle(suggestion.toGoal, goals)}
                      </span>
                      <span className="text-xs bg-yellow-200 px-2 py-1 rounded">
                        +{suggestion.expectedBenefit}% impact
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">{suggestion.reasoning}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detailed Goal Analysis */}
      {selectedAnalytics && selectedGoal && (
        <div className="space-y-6">
          {/* Goal Performance Overview */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-gray-900">
                🎯 {selectedGoal.title} - Deep Dive Analysis
              </h3>
              <div className={`px-3 py-1 rounded-full text-sm font-bold ${getTrackStatusColor(selectedAnalytics.completion.onTrackStatus)}`}>
                {selectedAnalytics.completion.onTrackStatus.replace('_', ' ').toUpperCase()}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Progress Card */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600 mb-1">
                    {selectedAnalytics.completion.currentProgress.toFixed(1)}%
                  </div>
                  <div className="text-sm text-gray-600">Current Progress</div>
                  <div className="w-full bg-blue-200 rounded-full h-2 mt-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, selectedAnalytics.completion.currentProgress)}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* Time Investment Card */}
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-600 mb-1">
                    {selectedAnalytics.timeInvestment.weeklyActual.toFixed(1)}h
                  </div>
                  <div className="text-sm text-gray-600">This Week</div>
                  <div className="text-xs text-gray-500 mt-1">
                    Target: {selectedAnalytics.timeInvestment.weeklyTarget}h
                    ({selectedAnalytics.timeInvestment.adherencePercentage.toFixed(0)}%)
                  </div>
                </div>
              </div>

              {/* ROI Card */}
              <div className="bg-gradient-to-r from-purple-50 to-violet-50 rounded-xl p-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-purple-600 mb-1">
                    {selectedAnalytics.roi.progressPerHour.toFixed(1)}
                  </div>
                  <div className="text-sm text-gray-600">Progress/Hour</div>
                  <div className={`text-xs font-bold mt-1 ${getEfficiencyColor(selectedAnalytics.roi.efficiency)}`}>
                    {selectedAnalytics.roi.efficiency.toUpperCase()}
                  </div>
                </div>
              </div>

              {/* Completion Estimate */}
              <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-xl p-4">
                <div className="text-center">
                  <div className="text-lg font-bold text-orange-600 mb-1">
                    {formatDate(selectedAnalytics.completion.estimatedCompletionDate)}
                  </div>
                  <div className="text-sm text-gray-600">Est. Completion</div>
                  <div className="text-xs text-gray-500 mt-1">
                    Confidence: {selectedAnalytics.completion.confidence.toFixed(0)}%
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Time Investment Trends */}
          <div className="glass-card p-6">
            <h4 className="text-lg font-bold text-gray-900 mb-4">📈 Time Investment Trends</h4>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Daily Trend Chart */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h5 className="font-bold text-gray-800 mb-3">Daily Time Investment</h5>
                <div className="space-y-2">
                  {selectedAnalytics.timeInvestment.dailyTrend.slice(-7).map((day, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">{day.date}</span>
                      <div className="flex items-center space-x-2">
                        <div className="w-24 bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-blue-500 h-2 rounded-full"
                            style={{ width: `${Math.min(100, (day.hours / 8) * 100)}%` }}
                          ></div>
                        </div>
                        <span className="text-sm font-bold text-gray-800">{day.hours.toFixed(1)}h</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Efficiency Insights */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h5 className="font-bold text-gray-800 mb-3">⚡ Efficiency Insights</h5>
                <div className="space-y-3">
                  <div>
                    <span className="text-sm text-gray-600">Best Time Slots:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedAnalytics.efficiency.optimalTimeBlocks.map((time, index) => (
                        <span key={index} className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">
                          {time}
                        </span>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <span className="text-sm text-gray-600">Best Days:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedAnalytics.efficiency.bestDaysOfWeek.map((day, index) => (
                        <span key={index} className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">
                          {day}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="text-center">
                      <div className="text-lg font-bold text-purple-600">
                        {selectedAnalytics.efficiency.moodImpactCorrelation.toFixed(2)}
                      </div>
                      <div className="text-gray-600">Mood Impact</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-orange-600">
                        {selectedAnalytics.efficiency.energyImpactCorrelation.toFixed(2)}
                      </div>
                      <div className="text-gray-600">Energy Impact</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-blue-600">
                        {selectedAnalytics.efficiency.focusImpactCorrelation.toFixed(2)}
                      </div>
                      <div className="text-gray-600">Focus Impact</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Recommendations */}
          <div className="glass-card p-6">
            <h4 className="text-lg font-bold text-gray-900 mb-4">🎯 AI Recommendations</h4>
            <div className="space-y-4">
              {selectedAnalytics.recommendations.slice(0, 3).map((rec, index) => (
                <div key={index} className={`rounded-xl p-4 border-l-4 ${getRecommendationStyle(rec.priority)}`}>
                  <div className="flex items-start justify-between mb-2">
                    <h5 className="font-bold text-gray-900">{rec.title}</h5>
                    <div className="flex items-center space-x-2">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${getPriorityBadge(rec.priority)}`}>
                        {rec.priority.toUpperCase()}
                      </span>
                      <span className="text-xs text-gray-500">+{rec.expectedImpact}% impact</span>
                    </div>
                  </div>
                  <p className="text-gray-700 text-sm mb-3">{rec.description}</p>
                  
                  <div className="space-y-2">
                    <div className="text-xs text-gray-600">
                      <strong>Actions:</strong>
                    </div>
                    <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                      {rec.actions.map((action, actionIndex) => (
                        <li key={actionIndex}>{action}</li>
                      ))}
                    </ul>
                  </div>
                  
                  <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                    <span>Timeline: {rec.timeline}</span>
                    <span>Effort: {rec.effort}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper functions
const getPriorityColor = (priority: string) => {
  switch (priority) {
    case 'critical': return 'bg-red-100 text-red-800';
    case 'high': return 'bg-orange-100 text-orange-800';
    case 'medium': return 'bg-yellow-100 text-yellow-800';
    case 'low': return 'bg-green-100 text-green-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};

const getEfficiencyColor = (efficiency: string) => {
  switch (efficiency) {
    case 'exceptional': return 'text-green-600';
    case 'high': return 'text-blue-600';
    case 'medium': return 'text-yellow-600';
    case 'low': return 'text-orange-600';
    case 'critical': return 'text-red-600';
    default: return 'text-gray-600';
  }
};

const getTrackStatusColor = (status: string) => {
  switch (status) {
    case 'ahead': return 'text-green-600 bg-green-100';
    case 'on_track': return 'text-blue-600 bg-blue-100';
    case 'behind': return 'text-yellow-600 bg-yellow-100';
    case 'critical': return 'text-red-600 bg-red-100';
    default: return 'text-gray-600 bg-gray-100';
  }
};

const getRecommendationStyle = (priority: string) => {
  switch (priority) {
    case 'critical': return 'bg-red-50 border-red-400';
    case 'high': return 'bg-orange-50 border-orange-400';
    case 'medium': return 'bg-yellow-50 border-yellow-400';
    case 'low': return 'bg-green-50 border-green-400';
    default: return 'bg-gray-50 border-gray-400';
  }
};

const getPriorityBadge = (priority: string) => {
  switch (priority) {
    case 'critical': return 'bg-red-200 text-red-800';
    case 'high': return 'bg-orange-200 text-orange-800';
    case 'medium': return 'bg-yellow-200 text-yellow-800';
    case 'low': return 'bg-green-200 text-green-800';
    default: return 'bg-gray-200 text-gray-800';
  }
};

const getGoalTitle = (goalId: string, goals: Goal[]): string => {
  const goal = goals.find(g => g.id === goalId);
  return goal ? goal.title.substring(0, 20) + (goal.title.length > 20 ? '...' : '') : 'Unknown Goal';
};

const formatDate = (date: Date): string => {
  const today = new Date();
  const diffTime = Math.abs(date.getTime() - today.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return date > today ? 'Tomorrow' : 'Yesterday';
  if (diffDays < 30) return `${diffDays} days`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};