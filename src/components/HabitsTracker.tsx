'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Habit, HabitLog } from '@/types';
import { formatDateSafe, formatDateStringSafe } from '@/utils/dateUtils';
import { CheckCircle, Circle, Flame, Calendar, Plus, Edit, Trash2 } from 'lucide-react';

interface HabitsTrackerProps {
  habits: Habit[];
  habitLogs: HabitLog[];
  onCreateHabit: (habit: Partial<Habit>) => void;
  onUpdateHabit: (id: string, updates: Partial<Habit>) => void;
  onDeleteHabit: (id: string) => void;
  onLogHabit: (habitId: string, completed: boolean, value?: number, notes?: string) => void;
  currentUserId?: string; // 🔥 CRITICAL FIX
}

export default function HabitsTracker({
  habits,
  habitLogs,
  onCreateHabit,
  onUpdateHabit,
  onDeleteHabit,
  onLogHabit,
  currentUserId // 🔥 CRITICAL FIX
}: HabitsTrackerProps) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [newHabitData, setNewHabitData] = useState<Partial<Habit>>({});

  // Refs to maintain focus
  const nameInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);

  // Optimized callbacks to prevent re-render issues
  const handleNameChange = useCallback((value: string) => {
    setNewHabitData((prev: any) => ({ ...prev, name: value }));
  }, []);

  const handleDescriptionChange = useCallback((value: string) => {
    setNewHabitData((prev: any) => ({ ...prev, description: value }));
  }, []);

  const handleFrequencyChange = useCallback((value: string) => {
    setNewHabitData((prev: any) => ({ ...prev, frequency: value }));
  }, []);

  const handleUnitChange = useCallback((value: string) => {
    setNewHabitData((prev: any) => ({ ...prev, unit: value }));
  }, []);

  const handleTargetValueChange = useCallback((value: number | undefined) => {
    setNewHabitData((prev: any) => ({ ...prev, targetValue: value }));
  }, []);

  const today = new Date();
  const isToday = formatDateStringSafe(selectedDate) === formatDateStringSafe(today);

  const getTodayLogs = () => {
    const dateStr = formatDateStringSafe(selectedDate);
    return habitLogs.filter(log => 
      formatDateStringSafe(log.date) === dateStr && dateStr !== 'Invalid Date'
    );
  };

  const getHabitLog = (habitId: string) => {
    return getTodayLogs().find(log => log.habitId === habitId);
  };

  const calculateStreak = (habit: Habit): number => {
    const sortedLogs = habitLogs
      .filter(log => log.habitId === habit.id && log.completed)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (sortedLogs.length === 0) return 0;

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < sortedLogs.length; i++) {
      const logDate = new Date(sortedLogs[i].date);
      logDate.setHours(0, 0, 0, 0);
      
      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() - i);

      if (logDate.getTime() === expectedDate.getTime()) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  };

  const getCompletionRate = (habit: Habit, days: number = 30): number => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const logsInPeriod = habitLogs.filter(log => {
      const logDate = new Date(log.date);
      return log.habitId === habit.id && 
             logDate >= startDate && 
             logDate <= endDate;
    });

    const completedLogs = logsInPeriod.filter(log => log.completed);
    return logsInPeriod.length > 0 ? (completedLogs.length / logsInPeriod.length) * 100 : 0;
  };

  const getStreakEmoji = (streak: number): string => {
    if (streak >= 100) return '🔥💯';
    if (streak >= 50) return '🔥🔥';
    if (streak >= 30) return '🔥';
    if (streak >= 7) return '✨';
    if (streak >= 3) return '💪';
    return '';
  };

  const handleCreateHabit = () => {
    if (!currentUserId) {
      console.error('Cannot create habit: userId not available');
      return;
    }

    if (newHabitData.name) {
      onCreateHabit({
        ...newHabitData,
        id: `habit-${Date.now()}`,
        userId: currentUserId,
        domainId: 'default',
        isActive: true,
        streakCount: 0,
        bestStreak: 0,
        frequency: newHabitData.frequency || 'daily',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setShowCreateModal(false);
      setNewHabitData({});
    }
  };

  const handleEditHabit = () => {
    if (editingHabit && newHabitData.name) {
      onUpdateHabit(editingHabit.id, {
        ...newHabitData,
        updatedAt: new Date(),
      });
      setEditingHabit(null);
      setNewHabitData({});
    }
  };

  const handleToggleHabit = async (habit: Habit) => {
    const existingLog = getHabitLog(habit.id);
    const newCompleted = !existingLog?.completed;
    // Optimistic UI update
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let rollback = false;
    let logId = existingLog?.id || `log-${Date.now()}`;
    // Use onLogHabit directly - optimistic updates are handled in parent component (page.tsx)
    try {
      await onLogHabit(habit.id, newCompleted, existingLog?.value, existingLog?.notes ?? '');
      
      // Update streak count
      if (newCompleted) {
        const newStreak = calculateStreak(habit) + 1;
        onUpdateHabit(habit.id, {
          streakCount: newStreak,
          bestStreak: Math.max(habit.bestStreak, newStreak),
        });

        // 🎉 TRIGGER DOPAMINE REWARD FOR HABIT COMPLETION!
        if (typeof window !== 'undefined' && (window as any).strategicDopamine) {
          (window as any).strategicDopamine.triggerHabitCompletion(habit.id, newStreak);
        }
      } else {
        onUpdateHabit(habit.id, {
          streakCount: Math.max(0, habit.streakCount - 1),
        });
      }
    } catch (error) {
      // Error feedback - optimistic rollback handled in parent
      console.error('Failed to log habit:', error);
    }
  };

  const HabitCard = ({ habit }: { habit: Habit }) => {
    const log = getHabitLog(habit.id);
    const streak = calculateStreak(habit);
    const completionRate = getCompletionRate(habit);
    
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => handleToggleHabit(habit)}
                disabled={!isToday}
                className={`transition-colors ${!isToday ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {log?.completed ? (
                  <CheckCircle className="w-6 h-6 text-green-600" />
                ) : (
                  <Circle className="w-6 h-6 text-gray-400 hover:text-green-600" />
                )}
              </button>
              
              <div>
                <h3 className="font-medium text-gray-900">{habit.name}</h3>
                {habit.description && (
                  <p className="text-sm text-gray-600">{habit.description}</p>
                )}
              </div>
            </div>

            <div className="mt-3 flex items-center space-x-4 text-sm">
              {/* Streak */}
              <div className="flex items-center space-x-1">
                <Flame className="w-4 h-4 text-orange-500" />
                <span className="font-medium">{streak}</span>
                <span className="text-gray-600">day streak</span>
                {getStreakEmoji(streak) && (
                  <span className="text-lg">{getStreakEmoji(streak)}</span>
                )}
              </div>

              {/* Completion Rate */}
              <div className="flex items-center space-x-1">
                <Calendar className="w-4 h-4 text-blue-500" />
                <span className="font-medium">{Math.round(completionRate)}%</span>
                <span className="text-gray-600">this month</span>
              </div>

              {/* Frequency */}
              <div className="text-gray-500 capitalize">
                {habit.frequency}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-3">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-green-400 to-green-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${completionRate}%` }}
                ></div>
              </div>
            </div>

            {/* Value/Notes for today */}
            {log && (log.value !== undefined || log.notes) && (
              <div className="mt-2 p-2 bg-gray-50 rounded text-sm">
                {log.value !== undefined && (
                  <div>Value: {log.value} {habit.unit}</div>
                )}
                {log.notes && (
                  <div className="text-gray-600">{log.notes}</div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center space-x-1">
            <button
              onClick={() => {
                setEditingHabit(habit);
                setNewHabitData(habit);
              }}
              className="p-1 text-gray-400 hover:text-gray-600"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={() => onDeleteHabit(habit.id)}
              className="p-1 text-gray-400 hover:text-red-600"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const HabitModal = ({ isEdit = false }) => {
    if (typeof window === 'undefined') return null; // SSR safety

    const modalContent = (
      <div 
        className="modal-portal fixed inset-0 z-[9999] flex items-center justify-center p-4"
        style={{ 
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)'
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowCreateModal(false);
            setEditingHabit(null);
            setNewHabitData({});
          }
        }}
      >
        <div 
          className="bg-white rounded-lg shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
          style={{
            transform: 'translateZ(0)', // Force hardware acceleration
            position: 'relative',
            zIndex: 10000
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-gray-900">
                {isEdit ? 'Edit Habit' : 'Create New Habit'}
              </h3>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingHabit(null);
                  setNewHabitData({});
                }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                type="button"
              >
                ×
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={newHabitData.name || ''}
                  onChange={(e) => handleNameChange(e.target.value)}
                  style={{
                    color: 'black',
                    backgroundColor: 'white',
                    border: '2px solid #007bff',
                    fontSize: '16px'
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                  placeholder="e.g., Morning meditation"
                  autoFocus
                  autoComplete="off"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  ref={descriptionInputRef}
                  value={newHabitData.description || ''}
                  onChange={(e) => handleDescriptionChange(e.target.value)}
                  style={{
                    color: 'black',
                    backgroundColor: 'white',
                    border: '2px solid #007bff',
                    fontSize: '16px'
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                  rows={2}
                  placeholder="Optional description"
                  autoComplete="off"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
                  <select
                    value={newHabitData.frequency || 'daily'}
                    onChange={(e) => handleFrequencyChange(e.target.value)}
                    style={{
                      color: '#111827',
                      backgroundColor: '#ffffff',
                      WebkitTextFillColor: '#111827',
                      textShadow: 'none'
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit (Optional)</label>
                  <input
                    type="text"
                    value={newHabitData.unit || ''}
                    onChange={(e) => handleUnitChange(e.target.value)}
                    style={{
                      color: 'black',
                      backgroundColor: 'white',
                      border: '1px solid #ccc'
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                    placeholder="e.g., minutes, pages"
                  />
                </div>
              </div>
              
              {newHabitData.unit && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Target Value</label>
                  <input
                    type="number"
                    value={newHabitData.targetValue || ''}
                    onChange={(e) => handleTargetValueChange(parseInt(e.target.value) || undefined)}
                    style={{
                      color: 'black',
                      backgroundColor: 'white',
                      border: '1px solid #ccc'
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                    placeholder="e.g., 20"
                  />
                </div>
              )}
            </div>
            
            <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingHabit(null);
                  setNewHabitData({});
                }}
                className="px-6 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={isEdit ? handleEditHabit : handleCreateHabit}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                type="button"
              >
                {isEdit ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );

    return createPortal(modalContent, document.body);
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-gray-200">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Habits Tracker</h2>
          <p className="text-sm text-gray-600">
            {formatDateSafe(selectedDate, { 
              weekday: 'long',
              month: 'long',
              day: 'numeric'
            }, 'Invalid Date')}
          </p>
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setSelectedDate(new Date(selectedDate.getTime() - 24 * 60 * 60 * 1000))}
            className="p-2 text-gray-400 hover:text-gray-600"
          >
            ←
          </button>
          <button
            onClick={() => setSelectedDate(new Date())}
            className="px-3 py-1 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
          >
            Today
          </button>
          <button
            onClick={() => setSelectedDate(new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000))}
            className="p-2 text-gray-400 hover:text-gray-600"
          >
            →
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="ml-4 flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            <span>Add Habit</span>
          </button>
        </div>
      </div>

      {/* Habits List */}
      <div className="p-6">
        {habits.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">No habits yet. Start building better habits today!</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Create Your First Habit
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {habits.filter(habit => habit.isActive).map(habit => (
              <HabitCard key={habit.id} habit={habit} />
            ))}
          </div>
        )}
      </div>

      {/* Summary Stats */}
      {habits.length > 0 && (
        <div className="border-t border-gray-200 p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {getTodayLogs().filter(log => log.completed).length}
              </div>
              <div className="text-sm text-gray-600">Completed Today</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {habits.filter(h => h.streakCount > 0).length}
              </div>
              <div className="text-sm text-gray-600">Active Streaks</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {Math.max(...habits.map(h => h.bestStreak), 0)}
              </div>
              <div className="text-sm text-gray-600">Best Streak</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {Math.round(habits.reduce((sum, h) => sum + getCompletionRate(h), 0) / habits.length || 0)}%
              </div>
              <div className="text-sm text-gray-600">Avg Completion</div>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {showCreateModal && <HabitModal />}
      {editingHabit && <HabitModal isEdit />}
    </div>
  );
}