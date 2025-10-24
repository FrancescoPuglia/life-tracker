'use client';

import { useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Area, AreaChart
} from 'recharts';
import { Calendar, TrendingUp, Clock, Target, Zap, Brain } from 'lucide-react';

interface AnalyticsData {
  planVsActual: Array<{
    date: string;
    planned: number;
    actual: number;
    adherence: number;
  }>;
  timeAllocation: Array<{
    domain: string;
    hours: number;
    color: string;
  }>;
  focusTrend: Array<{
    date: string;
    focusMinutes: number;
    mood: number;
    energy: number;
  }>;
  correlations: Array<{
    factor1: string;
    factor2: string;
    correlation: number;
    significance: string;
  }>;
  weeklyReview: {
    highlights: string[];
    challenges: string[];
    insights: string[];
    nextWeekGoals: string[];
  };
}

interface AnalyticsDashboardProps {
  data: AnalyticsData;
  timeRange: '7d' | '30d' | '90d';
  onTimeRangeChange: (range: '7d' | '30d' | '90d') => void;
}

export default function AnalyticsDashboard({ 
  data, 
  timeRange, 
  onTimeRangeChange 
}: AnalyticsDashboardProps) {
  const [selectedChart, setSelectedChart] = useState<'overview' | 'planvsactual' | 'allocation' | 'correlations'>('overview');

  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#F97316'];

  const formatPercentage = (value: number) => `${Math.round(value)}%`;
  const formatHours = (value: number) => `${value.toFixed(1)}h`;

  const averageAdherence = data.planVsActual.length > 0 
    ? data.planVsActual.reduce((sum, item) => sum + item.adherence, 0) / data.planVsActual.length 
    : 0;

  const totalPlannedHours = data.planVsActual.reduce((sum, item) => sum + item.planned, 0);
  const totalActualHours = data.planVsActual.reduce((sum, item) => sum + item.actual, 0);

  const averageFocus = data.focusTrend.length > 0
    ? data.focusTrend.reduce((sum, item) => sum + item.focusMinutes, 0) / data.focusTrend.length
    : 0;

  const PlanVsActualChart = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Plan vs Actual</h3>
        <div className="flex items-center space-x-4 text-sm">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-blue-500 rounded"></div>
            <span>Planned</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-green-500 rounded"></div>
            <span>Actual</span>
          </div>
        </div>
      </div>
      
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data.planVsActual}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip 
            formatter={(value: number, name: string) => [formatHours(value), name]}
            labelFormatter={(label) => `Date: ${label}`}
          />
          <Bar dataKey="planned" fill="#3B82F6" name="Planned Hours" />
          <Bar dataKey="actual" fill="#10B981" name="Actual Hours" />
        </BarChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-3 gap-4 mt-4">
        <div className="bg-blue-50 rounded-lg p-3">
          <div className="text-sm font-medium text-blue-600">Avg Adherence</div>
          <div className="text-xl font-bold text-blue-900">{formatPercentage(averageAdherence)}</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-sm font-medium text-gray-600">Total Planned</div>
          <div className="text-xl font-bold text-gray-900">{formatHours(totalPlannedHours)}</div>
        </div>
        <div className="bg-green-50 rounded-lg p-3">
          <div className="text-sm font-medium text-green-600">Total Actual</div>
          <div className="text-xl font-bold text-green-900">{formatHours(totalActualHours)}</div>
        </div>
      </div>
    </div>
  );

  const TimeAllocationChart = () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Time Allocation</h3>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={data.timeAllocation}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ domain, percent }) => `${domain} (${(percent * 100).toFixed(0)}%)`}
              outerRadius={80}
              fill="#8884d8"
              dataKey="hours"
            >
              {data.timeAllocation.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value: number) => [formatHours(value), 'Hours']} />
          </PieChart>
        </ResponsiveContainer>

        <div className="space-y-2">
          {data.timeAllocation.map((item, index) => (
            <div key={item.domain} className="flex items-center justify-between p-2 bg-gray-50 rounded">
              <div className="flex items-center space-x-2">
                <div 
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: item.color || COLORS[index % COLORS.length] }}
                ></div>
                <span className="text-sm font-medium">{item.domain}</span>
              </div>
              <span className="text-sm text-gray-600">{formatHours(item.hours)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const FocusTrendChart = () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Focus & Wellbeing Trends</h3>
      
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data.focusTrend}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis yAxisId="left" />
          <YAxis yAxisId="right" orientation="right" domain={[0, 10]} />
          <Tooltip />
          <Bar yAxisId="left" dataKey="focusMinutes" fill="#8B5CF6" name="Focus Minutes" />
          <Line yAxisId="right" type="monotone" dataKey="mood" stroke="#F59E0B" name="Mood" />
          <Line yAxisId="right" type="monotone" dataKey="energy" stroke="#EF4444" name="Energy" />
        </LineChart>
      </ResponsiveContainer>

      <div className="text-center text-sm text-gray-600">
        Average daily focus: {Math.round(averageFocus)} minutes
      </div>
    </div>
  );

  const CorrelationsView = () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">Pattern Correlations</h3>
      
      <div className="space-y-3">
        {data.correlations.map((correlation, index) => (
          <div key={index} className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-gray-900">
                  {correlation.factor1} ↔ {correlation.factor2}
                </div>
                <div className="text-sm text-gray-600">
                  Significance: {correlation.significance}
                </div>
              </div>
              <div className={`text-lg font-bold ${
                correlation.correlation > 0.5 ? 'text-green-600' :
                correlation.correlation > 0.2 ? 'text-yellow-600' :
                correlation.correlation > -0.2 ? 'text-gray-600' :
                correlation.correlation > -0.5 ? 'text-orange-600' : 'text-red-600'
              }`}>
                {correlation.correlation > 0 ? '+' : ''}{(correlation.correlation * 100).toFixed(0)}%
              </div>
            </div>
            
            <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
              <div 
                className={`h-2 rounded-full ${
                  correlation.correlation > 0 ? 'bg-green-500' : 'bg-red-500'
                }`}
                style={{ 
                  width: `${Math.abs(correlation.correlation) * 100}%`,
                  marginLeft: correlation.correlation < 0 ? `${(1 - Math.abs(correlation.correlation)) * 100}%` : '0'
                }}
              ></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const WeeklyReview = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-gray-900">Weekly Review</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="bg-green-50 rounded-lg p-4">
            <h4 className="font-medium text-green-800 mb-2 flex items-center">
              <TrendingUp className="w-4 h-4 mr-2" />
              Highlights
            </h4>
            <ul className="space-y-1">
              {data.weeklyReview.highlights.map((highlight, index) => (
                <li key={index} className="text-sm text-green-700">• {highlight}</li>
              ))}
            </ul>
          </div>

          <div className="bg-red-50 rounded-lg p-4">
            <h4 className="font-medium text-red-800 mb-2 flex items-center">
              <Target className="w-4 h-4 mr-2" />
              Challenges
            </h4>
            <ul className="space-y-1">
              {data.weeklyReview.challenges.map((challenge, index) => (
                <li key={index} className="text-sm text-red-700">• {challenge}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-blue-50 rounded-lg p-4">
            <h4 className="font-medium text-blue-800 mb-2 flex items-center">
              <Brain className="w-4 h-4 mr-2" />
              Insights
            </h4>
            <ul className="space-y-1">
              {data.weeklyReview.insights.map((insight, index) => (
                <li key={index} className="text-sm text-blue-700">• {insight}</li>
              ))}
            </ul>
          </div>

          <div className="bg-purple-50 rounded-lg p-4">
            <h4 className="font-medium text-purple-800 mb-2 flex items-center">
              <Zap className="w-4 h-4 mr-2" />
              Next Week Goals
            </h4>
            <ul className="space-y-1">
              {data.weeklyReview.nextWeekGoals.map((goal, index) => (
                <li key={index} className="text-sm text-purple-700">• {goal}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900">Analytics Dashboard</h2>
        
        <div className="flex items-center space-x-4">
          {/* Time Range Selector */}
          <div className="flex bg-gray-100 rounded-lg p-1">
            {(['7d', '30d', '90d'] as const).map((range) => (
              <button
                key={range}
                onClick={() => onTimeRangeChange(range)}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  timeRange === range
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : '90 Days'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart Navigation */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8 px-6">
          {[
            { id: 'overview', label: 'Overview', icon: Calendar },
            { id: 'planvsactual', label: 'Plan vs Actual', icon: Target },
            { id: 'allocation', label: 'Time Allocation', icon: Clock },
            { id: 'correlations', label: 'Correlations', icon: TrendingUp },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSelectedChart(id as any)}
              className={`flex items-center space-x-2 py-4 text-sm font-medium border-b-2 transition-colors ${
                selectedChart === id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Chart Content */}
      <div className="p-6">
        {selectedChart === 'overview' && <WeeklyReview />}
        {selectedChart === 'planvsactual' && <PlanVsActualChart />}
        {selectedChart === 'allocation' && <TimeAllocationChart />}
        {selectedChart === 'correlations' && <CorrelationsView />}
      </div>
    </div>
  );
}