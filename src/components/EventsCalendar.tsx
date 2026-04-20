'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Calendar as CalendarIcon, Plus, X, ChevronLeft, ChevronRight,
  Target, Flag, Clock, Star, Edit3, Trash2, Link
} from 'lucide-react';
import type { ImportantEvent, EventCategory, Goal } from '@/types';

// ============================================================================
// LOCAL STORAGE PERSISTENCE
// ============================================================================

const EVENTS_STORAGE_KEY = 'life_tracker_events';

function loadEvents(): ImportantEvent[] {
  try {
    const stored = localStorage.getItem(EVENTS_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return parsed.map((e: any) => ({
      ...e,
      date: new Date(e.date),
      endDate: e.endDate ? new Date(e.endDate) : undefined,
      createdAt: new Date(e.createdAt),
      updatedAt: new Date(e.updatedAt),
    }));
  } catch {
    return [];
  }
}

function saveEvents(events: ImportantEvent[]) {
  try {
    localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
  } catch { /* storage unavailable */ }
}

// ============================================================================
// CONSTANTS
// ============================================================================

const CATEGORY_CONFIG: Record<EventCategory, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  deadline: { label: 'Deadline', color: 'text-red-400', bg: 'bg-red-500/20 border-red-500/30', icon: <Flag className="w-3.5 h-3.5" /> },
  milestone: { label: 'Milestone', color: 'text-yellow-400', bg: 'bg-yellow-500/20 border-yellow-500/30', icon: <Star className="w-3.5 h-3.5" /> },
  meeting: { label: 'Meeting', color: 'text-blue-400', bg: 'bg-blue-500/20 border-blue-500/30', icon: <Clock className="w-3.5 h-3.5" /> },
  personal: { label: 'Personale', color: 'text-green-400', bg: 'bg-green-500/20 border-green-500/30', icon: <Star className="w-3.5 h-3.5" /> },
  review: { label: 'Review', color: 'text-purple-400', bg: 'bg-purple-500/20 border-purple-500/30', icon: <CalendarIcon className="w-3.5 h-3.5" /> },
  other: { label: 'Altro', color: 'text-gray-400', bg: 'bg-gray-500/20 border-gray-500/30', icon: <CalendarIcon className="w-3.5 h-3.5" /> },
};

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ============================================================================
// COMPONENT
// ============================================================================

interface EventsCalendarProps {
  goals?: Goal[];
  className?: string;
}

export default function EventsCalendar({ goals = [], className = '' }: EventsCalendarProps) {
  const [events, setEvents] = useState<ImportantEvent[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ImportantEvent | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Load events on mount
  useEffect(() => {
    setEvents(loadEvents());
  }, []);

  // Persist on change
  const persistEvents = useCallback((updated: ImportantEvent[]) => {
    setEvents(updated);
    saveEvents(updated);
  }, []);

  // Calendar grid computation
  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Monday-based week
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;

    const days: { date: Date; isCurrentMonth: boolean }[] = [];

    // Previous month padding
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      days.push({ date: d, isCurrentMonth: false });
    }

    // Current month
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }

    // Next month padding (fill to 42 = 6 weeks)
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }

    return days;
  }, [currentDate]);

  // Events by date key
  const eventsByDate = useMemo(() => {
    const map = new Map<string, ImportantEvent[]>();
    for (const event of events) {
      const key = toDateKey(new Date(event.date));
      const existing = map.get(key) || [];
      existing.push(event);
      map.set(key, existing);
    }
    return map;
  }, [events]);

  // Today's key
  const todayKey = toDateKey(new Date());

  // Navigation
  const goToPrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };
  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };
  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // CRUD
  const createEvent = (data: Omit<ImportantEvent, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newEvent: ImportantEvent = {
      ...data,
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    persistEvents([...events, newEvent]);
    setShowCreateModal(false);
  };

  const updateEvent = (id: string, updates: Partial<ImportantEvent>) => {
    persistEvents(events.map(e =>
      e.id === id ? { ...e, ...updates, updatedAt: new Date() } : e
    ));
    setEditingEvent(null);
  };

  const deleteEvent = (id: string) => {
    persistEvents(events.filter(e => e.id !== id));
    setEditingEvent(null);
  };

  const toggleComplete = (id: string) => {
    persistEvents(events.map(e =>
      e.id === id ? { ...e, completed: !e.completed, updatedAt: new Date() } : e
    ));
  };

  // Upcoming events (next 14 days, sorted)
  const upcomingEvents = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    return events
      .filter(e => {
        const d = new Date(e.date);
        return d >= now && d <= twoWeeksLater && !e.completed;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [events]);

  // Selected day events
  const selectedDayEvents = selectedDate ? (eventsByDate.get(selectedDate) || []) : [];

  return (
    <div className={`bg-gray-900 rounded-2xl border border-gray-700/50 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700/50">
        <div className="flex items-center gap-3">
          <CalendarIcon className="w-5 h-5 text-cyan-400" />
          <h2 className="text-lg font-bold text-white">Eventi Importanti</h2>
        </div>
        <button
          onClick={() => { setEditingEvent(null); setShowCreateModal(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nuovo
        </button>
      </div>

      <div className="flex flex-col lg:flex-row">
        {/* Calendar Grid */}
        <div className="flex-1 p-4">
          {/* Month Navigation */}
          <div className="flex items-center justify-between mb-4">
            <button onClick={goToPrevMonth} className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors">
              <ChevronLeft className="w-5 h-5 text-gray-400" />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-white">
                {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
              </span>
              <button onClick={goToToday} className="text-xs text-cyan-400 hover:text-cyan-300 px-2 py-0.5 rounded border border-cyan-500/30">
                Oggi
              </button>
            </div>
            <button onClick={goToNextMonth} className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors">
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-center text-xs font-medium text-gray-500 py-1">{d}</div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-px bg-gray-800 rounded-lg overflow-hidden">
            {calendarDays.map(({ date, isCurrentMonth }, i) => {
              const key = toDateKey(date);
              const dayEvents = eventsByDate.get(key) || [];
              const isToday = key === todayKey;
              const isSelected = key === selectedDate;

              return (
                <button
                  key={i}
                  onClick={() => setSelectedDate(key === selectedDate ? null : key)}
                  className={`relative min-h-[48px] p-1 text-left transition-colors
                    ${isCurrentMonth ? 'bg-gray-900' : 'bg-gray-900/50'}
                    ${isSelected ? 'ring-2 ring-cyan-500 z-10' : ''}
                    hover:bg-gray-800`}
                >
                  <span className={`text-xs font-medium block mb-0.5
                    ${isToday ? 'bg-cyan-500 text-white w-5 h-5 rounded-full flex items-center justify-center' : ''}
                    ${isCurrentMonth ? 'text-gray-300' : 'text-gray-600'}`}>
                    {date.getDate()}
                  </span>
                  {/* Event dots */}
                  {dayEvents.length > 0 && (
                    <div className="flex gap-0.5 flex-wrap">
                      {dayEvents.slice(0, 3).map((e, j) => (
                        <div key={j} className={`w-1.5 h-1.5 rounded-full ${
                          e.completed ? 'bg-gray-600' :
                          e.category === 'deadline' ? 'bg-red-400' :
                          e.category === 'milestone' ? 'bg-yellow-400' :
                          e.category === 'meeting' ? 'bg-blue-400' :
                          e.category === 'personal' ? 'bg-green-400' :
                          'bg-purple-400'
                        }`} />
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="text-[8px] text-gray-500">+{dayEvents.length - 3}</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sidebar: Upcoming + Selected Day */}
        <div className="lg:w-72 border-t lg:border-t-0 lg:border-l border-gray-700/50 p-4">
          {/* Selected Day Events */}
          {selectedDate && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">
                {new Date(selectedDate + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}
              </h3>
              {selectedDayEvents.length === 0 ? (
                <p className="text-xs text-gray-500">Nessun evento</p>
              ) : (
                <div className="space-y-2">
                  {selectedDayEvents.map(event => {
                    const cat = CATEGORY_CONFIG[event.category];
                    return (
                      <div key={event.id} className={`p-2.5 rounded-lg border ${cat.bg} ${event.completed ? 'opacity-50' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <button onClick={() => toggleComplete(event.id)} className={`flex-shrink-0 ${cat.color}`}>
                              {cat.icon}
                            </button>
                            <span className={`text-sm font-medium truncate ${event.completed ? 'line-through text-gray-500' : 'text-white'}`}>
                              {event.title}
                            </span>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => setEditingEvent(event)} className="text-gray-500 hover:text-gray-300">
                              <Edit3 className="w-3 h-3" />
                            </button>
                            <button onClick={() => deleteEvent(event.id)} className="text-gray-500 hover:text-red-400">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        {event.description && (
                          <p className="text-xs text-gray-400 mt-1 ml-5">{event.description}</p>
                        )}
                        {event.goalId && (
                          <div className="flex items-center gap-1 mt-1 ml-5">
                            <Link className="w-2.5 h-2.5 text-cyan-400" />
                            <span className="text-[10px] text-cyan-400 truncate">
                              {goals.find(g => g.id === event.goalId)?.title || 'Goal'}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Upcoming Events */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              Prossimi 14 giorni
            </h3>
            {upcomingEvents.length === 0 ? (
              <p className="text-xs text-gray-500">Nessun evento in arrivo</p>
            ) : (
              <div className="space-y-2">
                {upcomingEvents.slice(0, 8).map(event => {
                  const cat = CATEGORY_CONFIG[event.category];
                  const eventDate = new Date(event.date);
                  const daysUntil = Math.ceil((eventDate.getTime() - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24));
                  return (
                    <div key={event.id} className="flex items-center gap-2 group">
                      <span className={`flex-shrink-0 ${cat.color}`}>{cat.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-white truncate">{event.title}</p>
                        <p className="text-[10px] text-gray-500">
                          {daysUntil === 0 ? 'Oggi' : daysUntil === 1 ? 'Domani' : `Tra ${daysUntil} giorni`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingEvent) && (
        <EventFormModal
          event={editingEvent}
          goals={goals}
          selectedDate={selectedDate}
          onSave={(data) => {
            if (editingEvent) {
              updateEvent(editingEvent.id, data);
            } else {
              createEvent(data as Omit<ImportantEvent, 'id' | 'createdAt' | 'updatedAt'>);
            }
          }}
          onClose={() => { setShowCreateModal(false); setEditingEvent(null); }}
        />
      )}
    </div>
  );
}

// ============================================================================
// EVENT FORM MODAL
// ============================================================================

interface EventFormModalProps {
  event: ImportantEvent | null;
  goals: Goal[];
  selectedDate: string | null;
  onSave: (data: Partial<ImportantEvent>) => void;
  onClose: () => void;
}

function EventFormModal({ event, goals, selectedDate, onSave, onClose }: EventFormModalProps) {
  const defaultDate = selectedDate || toDateKey(new Date());
  const [title, setTitle] = useState(event?.title || '');
  const [description, setDescription] = useState(event?.description || '');
  const [date, setDate] = useState(event ? toDateKey(new Date(event.date)) : defaultDate);
  const [category, setCategory] = useState<EventCategory>(event?.category || 'deadline');
  const [goalId, setGoalId] = useState(event?.goalId || '');
  const [userId] = useState(event?.userId || 'local');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      date: new Date(date + 'T12:00:00'),
      category,
      goalId: goalId || undefined,
      userId,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-800 rounded-2xl border border-gray-700 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="text-lg font-bold text-white">{event ? 'Modifica Evento' : 'Nuovo Evento'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Titolo</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              placeholder="Es: Scadenza progetto X..."
              autoFocus
            />
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Data</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Categoria</label>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(CATEGORY_CONFIG) as [EventCategory, typeof CATEGORY_CONFIG[EventCategory]][]).map(([key, config]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCategory(key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors
                    ${category === key ? `${config.bg} ${config.color}` : 'border-gray-600 text-gray-400 hover:border-gray-500'}`}
                >
                  {config.icon}
                  {config.label}
                </button>
              ))}
            </div>
          </div>

          {/* Link to Goal */}
          {goals.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Collega a Goal</label>
              <select
                value={goalId}
                onChange={e => setGoalId(e.target.value)}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              >
                <option value="">Nessun goal</option>
                {goals.filter(g => g.status === 'active').map(g => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
            </div>
          )}

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Descrizione (opzionale)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              placeholder="Dettagli..."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
              Annulla
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {event ? 'Salva' : 'Crea'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
