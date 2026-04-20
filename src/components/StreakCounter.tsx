'use client';

import React from 'react';
import { Zap, TrendingUp, Calendar, Award } from 'lucide-react';
import { StreakData, getStreakMessage } from '@/lib/streakCalculator';

interface StreakCounterProps {
  streak: StreakData;
  compact?: boolean;
}

export default function StreakCounter({ streak, compact = false }: StreakCounterProps) {
  const message = getStreakMessage(streak);
  const streakColor =
    streak.currentStreak >= 30 ? 'from-purple-500 to-pink-500' :
    streak.currentStreak >= 14 ? 'from-orange-500 to-red-500' :
    streak.currentStreak >= 7 ? 'from-blue-500 to-indigo-500' :
    streak.currentStreak > 0 ? 'from-green-500 to-teal-500' :
    'from-gray-400 to-gray-500';

  if (compact) {
    return (
      <div className="flex items-center space-x-3 bg-gradient-to-r from-gray-50 to-white px-4 py-2 rounded-lg border border-gray-200 shadow-sm">
        <div className={`flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br ${streakColor} text-white shadow-md`}>
          <Zap className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-gray-900">{streak.currentStreak}</span>
            <span className="text-sm text-gray-500">day streak</span>
          </div>
          {streak.bestStreak > streak.currentStreak && (
            <div className="text-xs text-gray-400">
              Best: {streak.bestStreak} days
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-white to-gray-50 rounded-xl shadow-lg border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className={`flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-br ${streakColor} text-white shadow-lg`}>
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Momentum Tracker</h3>
            <p className="text-sm text-gray-500">Keep your streak alive!</p>
          </div>
        </div>
      </div>

      {/* Current Streak Display */}
      <div className="flex items-center justify-center mb-6">
        <div className="text-center">
          <div className="flex items-baseline justify-center space-x-2 mb-2">
            <span className={`text-6xl font-bold bg-gradient-to-r ${streakColor} bg-clip-text text-transparent`}>
              {streak.currentStreak}
            </span>
            <span className="text-2xl text-gray-500 font-medium">
              {streak.currentStreak === 1 ? 'day' : 'days'}
            </span>
          </div>
          <p className="text-sm font-medium text-gray-700">{message}</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="bg-white rounded-lg p-3 border border-gray-200">
          <div className="flex items-center space-x-2 mb-1">
            <Award className="w-4 h-4 text-yellow-500" />
            <span className="text-xs font-medium text-gray-600">Best</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{streak.bestStreak}</div>
        </div>

        <div className="bg-white rounded-lg p-3 border border-gray-200">
          <div className="flex items-center space-x-2 mb-1">
            <Calendar className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-medium text-gray-600">Active Days</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{streak.totalActiveDays}</div>
        </div>

        <div className="bg-white rounded-lg p-3 border border-gray-200">
          <div className="flex items-center space-x-2 mb-1">
            <TrendingUp className="w-4 h-4 text-green-500" />
            <span className="text-xs font-medium text-gray-600">Streaks</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{streak.streakHistory.length}</div>
        </div>
      </div>

      {/* Last Activity */}
      {streak.lastActivityDate && (
        <div className="text-xs text-gray-500 text-center">
          Last activity: {new Date(streak.lastActivityDate).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}
