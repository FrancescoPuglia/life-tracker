'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Habit, HabitLog } from '@/types';
import { formatDateSafe, formatDateStringSafe } from '@/utils/dateUtils';
import { CheckCircle, Circle, Flame, Calendar, Plus, Edit, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { audioManager } from '@/lib/audioManager';
import { getVoiceService } from '@/lib/voice/voiceService';

type HabitsTrackerProps = {
  habits: Habit[];
  habitLogs: HabitLog[];
  onCreateHabit: (habit: Partial<Habit>) => void;
  onUpdateHabit: (id: string, updates: Partial<Habit>) => void;
  onDeleteHabit: (id: string) => void;
  onLogHabit: (habitId: string, completed: boolean, value?: number, notes?: string) => void;
  currentUserId?: string;
};

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
        audioManager.habitCompleted(newStreak);
        getVoiceService()?.speakConfirmation('habitLogged');
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
    const completionRate = getCompletionRate(habit, 7);
    
    return (
      <article className="rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => handleToggleHabit(habit)}
                disabled={!isToday}
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-colors ${log?.completed ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:border-emerald-300'} ${!isToday ? 'cursor-not-allowed opacity-50' : ''}`}
                aria-label={log?.completed ? `Segna ${habit.name} come non completata` : `Completa ${habit.name}`}
              >
                {log?.completed ? (
                  <CheckCircle className="h-5 w-5 text-emerald-600" />
                ) : (
                  <Circle className="h-5 w-5 text-slate-400" />
                )}
              </button>
              
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-950">{habit.name}</h3>
                {habit.description && (
                  <details className="mt-1 text-sm text-slate-600">
                    <summary className="cursor-pointer text-xs font-medium text-slate-500">Dettagli</summary>
                    <p className="mt-1 max-w-3xl leading-5">{habit.description}</p>
                  </details>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              {/* Streak */}
              <div className="flex items-center space-x-1">
                <Flame className="h-4 w-4 text-amber-600" />
                <span className="font-medium">{streak}</span>
                <span className="text-slate-500">giorni di streak</span>
              </div>

              {/* Completion Rate */}
              <div className="flex items-center space-x-1">
                <Calendar className="h-4 w-4 text-blue-600" />
                <span className="font-medium">{Math.round(completionRate)}%</span>
                <span className="text-slate-500">ultimi 7 giorni</span>
              </div>

              {/* Frequency */}
              <div className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {habit.frequency === 'daily' ? 'Ogni giorno' : habit.frequency === 'weekly' ? 'Settimanale' : 'Mensile'}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-3">
              <div className="h-1.5 w-full rounded-full bg-slate-100">
                <div
                  className="h-1.5 rounded-full bg-emerald-500 transition-[width] duration-200"
                  style={{ width: `${completionRate}%` }}
                ></div>
              </div>
            </div>

            {/* Value/Notes for today */}
            {log && (log.value !== undefined || log.notes) && (
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                {log.value !== undefined && (
                  <div>Valore: {log.value} {habit.unit}</div>
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
              className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label={`Modifica ${habit.name}`}
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={() => onDeleteHabit(habit.id)}
              className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-700"
              aria-label={`Elimina ${habit.name}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </article>
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
                {isEdit ? 'Modifica abitudine' : 'Nuova abitudine'}
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={newHabitData.name || ''}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                  placeholder="Es. Meditazione mattutina"
                  autoFocus
                  autoComplete="off"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrizione</label>
                <textarea
                  ref={descriptionInputRef}
                  value={newHabitData.description || ''}
                  onChange={(e) => handleDescriptionChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none transition-colors"
                  rows={2}
                  placeholder="Dettagli facoltativi"
                  autoComplete="off"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Frequenza</label>
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
                    <option value="daily">Ogni giorno</option>
                    <option value="weekly">Settimanale</option>
                    <option value="monthly">Mensile</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unità (facoltativa)</label>
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
                    placeholder="Es. minuti, pagine"
                  />
                </div>
              </div>
              
              {newHabitData.unit && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Valore target</label>
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
                Annulla
              </button>
              <button
                onClick={isEdit ? handleEditHabit : handleCreateHabit}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                type="button"
              >
                {isEdit ? 'Salva' : 'Crea'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );

    return createPortal(modalContent, document.body);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-testid="habits-v3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">Esecuzione ricorrente</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">Abitudini</h2>
          <p className="mt-1 text-sm capitalize text-slate-600">
            {formatDateSafe(selectedDate, { 
              weekday: 'long',
              month: 'long',
              day: 'numeric'
            }, '—')}
          </p>
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setSelectedDate(new Date(selectedDate.getTime() - 24 * 60 * 60 * 1000))}
            className="lt-icon-button h-10 w-10"
            aria-label="Giorno precedente"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button
            onClick={() => setSelectedDate(new Date())}
            className="lt-button-secondary min-h-[40px] px-3"
          >
            Oggi
          </button>
          <button
            onClick={() => setSelectedDate(new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000))}
            className="lt-icon-button h-10 w-10"
            aria-label="Giorno successivo"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="lt-button-primary ml-2 min-h-[42px] px-4"
          >
            <Plus className="w-4 h-4" />
            <span>Nuova abitudine</span>
          </button>
        </div>
      </div>

      {/* Habits List */}
      <div className="p-6">
        {habits.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-10 text-center">
            <p className="mb-4 text-slate-600">Nessuna abitudine attiva. Il tracking esistente resta al sicuro.</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="lt-button-primary min-h-[42px] px-4"
            >
              Crea la prima abitudine
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
              <div className="text-sm text-gray-600">Completate oggi</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {habits.filter(h => h.streakCount > 0).length}
              </div>
              <div className="text-sm text-gray-600">Streak attive</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {Math.max(...habits.map(h => h.bestStreak), 0)}
              </div>
              <div className="text-sm text-gray-600">Streak migliore</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {Math.round(habits.reduce((sum, h) => sum + getCompletionRate(h), 0) / habits.length || 0)}%
              </div>
              <div className="text-sm text-gray-600">Aderenza media</div>
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
