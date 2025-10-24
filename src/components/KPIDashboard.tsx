'use client';

import { KPI } from '@/types';
import { useEffect, useState } from 'react';

interface KPIDashboardProps {
  kpis: KPI;
  onRefresh: () => void;
}

export default function KPIDashboard({ kpis, onRefresh }: KPIDashboardProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleRefresh = async () => {
    setIsLoading(true);
    await onRefresh();
    setIsLoading(false);
  };

  const formatPercentage = (value: number) => {
    return `${Math.round(value)}%`;
  };

  const getMoodEmoji = (mood?: number) => {
    if (!mood) return '😐';
    if (mood >= 8) return '😄';
    if (mood >= 6) return '🙂';
    if (mood >= 4) return '😐';
    if (mood >= 2) return '🙁';
    return '😞';
  };

  const getEnergyColor = (energy?: number) => {
    if (!energy) return 'bg-gray-400';
    if (energy >= 8) return 'bg-green-500';
    if (energy >= 6) return 'bg-yellow-500';
    if (energy >= 4) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getAdherenceColor = (percentage: number) => {
    if (percentage >= 90) return 'text-green-600 bg-green-50';
    if (percentage >= 70) return 'text-yellow-600 bg-yellow-50';
    if (percentage >= 50) return 'text-orange-600 bg-orange-50';
    return 'text-red-600 bg-red-50';
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Today's KPIs</h2>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="px-3 py-1 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
        >
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {/* Focus Minutes */}
        <div className="bg-blue-50 rounded-lg p-4">
          <div className="text-xs font-medium text-blue-600 mb-1">FOCUS MINUTES</div>
          <div className="text-2xl font-bold text-blue-900">{kpis.focusMinutes}</div>
          <div className="text-xs text-blue-600">mins</div>
        </div>

        {/* Plan vs Actual */}
        <div className={`rounded-lg p-4 ${getAdherenceColor(kpis.planVsActual)}`}>
          <div className="text-xs font-medium mb-1">PLAN vs ACTUAL</div>
          <div className="text-2xl font-bold">{formatPercentage(kpis.planVsActual)}</div>
          <div className="text-xs">adherence</div>
        </div>

        {/* Active Streaks */}
        <div className="bg-green-50 rounded-lg p-4">
          <div className="text-xs font-medium text-green-600 mb-1">ACTIVE STREAKS</div>
          <div className="text-2xl font-bold text-green-900">{kpis.activeStreaks}</div>
          <div className="text-xs text-green-600">habits</div>
        </div>

        {/* Key Results Progress */}
        <div className="bg-purple-50 rounded-lg p-4">
          <div className="text-xs font-medium text-purple-600 mb-1">KEY RESULTS</div>
          <div className="text-2xl font-bold text-purple-900">
            {formatPercentage(kpis.keyResultsProgress)}
          </div>
          <div className="text-xs text-purple-600">progress</div>
        </div>

        {/* Sleep Hours */}
        {kpis.sleepHours && (
          <div className="bg-indigo-50 rounded-lg p-4">
            <div className="text-xs font-medium text-indigo-600 mb-1">SLEEP</div>
            <div className="text-2xl font-bold text-indigo-900">{kpis.sleepHours.toFixed(1)}</div>
            <div className="text-xs text-indigo-600">hours</div>
          </div>
        )}

        {/* Mood */}
        <div className="bg-yellow-50 rounded-lg p-4">
          <div className="text-xs font-medium text-yellow-600 mb-1">MOOD</div>
          <div className="text-2xl font-bold text-yellow-900">
            {getMoodEmoji(kpis.mood)}
          </div>
          <div className="text-xs text-yellow-600">{kpis.mood || 'N/A'}/10</div>
        </div>

        {/* Energy */}
        <div className="bg-orange-50 rounded-lg p-4">
          <div className="text-xs font-medium text-orange-600 mb-1">ENERGY</div>
          <div className="flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${getEnergyColor(kpis.energy)}`}></div>
            <div className="text-lg font-bold text-orange-900">{kpis.energy || 'N/A'}</div>
          </div>
          <div className="text-xs text-orange-600">/10</div>
        </div>
      </div>

      {/* One Win */}
      {kpis.dailyWin && (
        <div className="mt-6 p-4 bg-gradient-to-r from-green-50 to-blue-50 rounded-lg">
          <div className="text-xs font-medium text-gray-600 mb-1">TODAY'S WIN 🎉</div>
          <div className="text-sm text-gray-900">{kpis.dailyWin}</div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="mt-6 flex flex-wrap gap-2">
        <button className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
          Log Mood
        </button>
        <button className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
          Log Energy
        </button>
        <button className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
          Add Win
        </button>
        <button className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
          Quick Note
        </button>
      </div>
    </div>
  );
}