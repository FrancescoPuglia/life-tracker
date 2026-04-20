'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Calendar as CalendarIcon, Plus, X, ChevronLeft, ChevronRight,
  Target, Flag, Clock, Star, Edit3, Trash2, Link, AlertTriangle,
  Trophy, BookOpen, Users, Crosshair, Zap
} from 'lucide-react';
import type { ImportantEvent, EventCategory, EventPriority, Goal } from '@/types';

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
  } catch { return []; }
}

function saveEvents(events: ImportantEvent[]) {
  try { localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events)); } catch { /* */ }
}

// ============================================================================
// CONSTANTS
// ============================================================================

const CATEGORY_CONFIG: Record<EventCategory, { label: string; color: string; bg: string; dot: string; icon: React.ReactNode }> = {
  deadline:    { label: 'Scadenza',    color: 'text-red-400',    bg: 'bg-red-500/15 border-red-500/30',    dot: 'bg-red-400',    icon: <Flag className="w-3.5 h-3.5" /> },
  tournament:  { label: 'Torneo',      color: 'text-orange-400', bg: 'bg-orange-500/15 border-orange-500/30', dot: 'bg-orange-400', icon: <Trophy className="w-3.5 h-3.5" /> },
  exam:        { label: 'Esame',       color: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30', dot: 'bg-yellow-400', icon: <BookOpen className="w-3.5 h-3.5" /> },
  milestone:   { label: 'Milestone',   color: 'text-amber-400',  bg: 'bg-amber-500/15 border-amber-500/30',  dot: 'bg-amber-400',  icon: <Star className="w-3.5 h-3.5" /> },
  meeting:     { label: 'Meeting',     color: 'text-blue-400',   bg: 'bg-blue-500/15 border-blue-500/30',   dot: 'bg-blue-400',   icon: <Users className="w-3.5 h-3.5" /> },
  appointment: { label: 'Appuntamento', color: 'text-cyan-400',  bg: 'bg-cyan-500/15 border-cyan-500/30',   dot: 'bg-cyan-400',   icon: <Clock className="w-3.5 h-3.5" /> },
  mission:     { label: 'Missione',    color: 'text-purple-400', bg: 'bg-purple-500/15 border-purple-500/30', dot: 'bg-purple-400', icon: <Crosshair className="w-3.5 h-3.5" /> },
  personal:    { label: 'Personale',   color: 'text-green-400',  bg: 'bg-green-500/15 border-green-500/30',  dot: 'bg-green-400',  icon: <Zap className="w-3.5 h-3.5" /> },
  review:      { label: 'Review',      color: 'text-indigo-400', bg: 'bg-indigo-500/15 border-indigo-500/30', dot: 'bg-indigo-400', icon: <CalendarIcon className="w-3.5 h-3.5" /> },
  other:       { label: 'Altro',       color: 'text-gray-400',   bg: 'bg-gray-500/15 border-gray-500/30',   dot: 'bg-gray-400',   icon: <CalendarIcon className="w-3.5 h-3.5" /> },
};

const PRIORITY_CONFIG: Record<EventPriority, { label: string; color: string; ring: string }> = {
  high:   { label: 'Alta',   color: 'text-red-400',    ring: 'ring-red-500/50' },
  medium: { label: 'Media',  color: 'text-yellow-400', ring: 'ring-yellow-500/30' },
  low:    { label: 'Bassa',  color: 'text-gray-400',   ring: 'ring-gray-500/20' },
};

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysUntil(date: Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
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

  useEffect(() => { setEvents(loadEvents()); }, []);

  const persistEvents = useCallback((updated: ImportantEvent[]) => {
    setEvents(updated);
    saveEvents(updated);
  }, []);

  // Calendar grid
  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;
    const days: { date: Date; isCurrentMonth: boolean }[] = [];
    for (let i = startOffset - 1; i >= 0; i--) days.push({ date: new Date(year, month, -i), isCurrentMonth: false });
    for (let i = 1; i <= lastDay.getDate(); i++) days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    return days;
  }, [currentDate]);

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

  const todayKey = toDateKey(new Date());

  // Navigation
  const goToPrevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const goToNextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const goToToday = () => { setCurrentDate(new Date()); setSelectedDate(todayKey); };

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
    persistEvents(events.map(e => e.id === id ? { ...e, ...updates, updatedAt: new Date() } : e));
    setEditingEvent(null);
  };

  const deleteEvent = (id: string) => {
    persistEvents(events.filter(e => e.id !== id));
    setEditingEvent(null);
  };

  const toggleComplete = (id: string) => {
    persistEvents(events.map(e => e.id === id ? { ...e, completed: !e.completed, updatedAt: new Date() } : e));
  };

  // Upcoming events (all future, sorted)
  const upcomingEvents = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return events
      .filter(e => !e.completed && new Date(e.date) >= now)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [events]);

  // Next key event
  const nextKeyEvent = upcomingEvents.find(e => e.priority === 'high') || upcomingEvents[0];

  // This week events
  const thisWeekEvents = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return upcomingEvents.filter(e => {
      const d = new Date(e.date);
      return d >= monday && d <= sunday;
    });
  }, [upcomingEvents]);

  // This month events
  const thisMonthEvents = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    return events.filter(e => {
      const d = new Date(e.date);
      return d.getFullYear() === year && d.getMonth() === month && !e.completed;
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [events, currentDate]);

  const selectedDayEvents = selectedDate ? (eventsByDate.get(selectedDate) || []) : [];

  return (
    <div className={`bg-gray-900 rounded-2xl border border-gray-700/50 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-gray-700/50 bg-gradient-to-r from-gray-900 to-gray-800">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <CalendarIcon className="w-6 h-6 text-cyan-400" />
            Calendario Strategico
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {events.filter(e => !e.completed).length} eventi attivi
            {upcomingEvents.length > 0 && ` - Prossimo tra ${daysUntil(new Date(upcomingEvents[0].date))} giorni`}
          </p>
        </div>
        <button onClick={() => { setEditingEvent(null); setShowCreateModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-cyan-600/20">
          <Plus className="w-4 h-4" /> Nuovo Evento
        </button>
      </div>

      <div className="flex flex-col xl:flex-row">
        {/* Calendar Grid */}
        <div className="flex-1 p-5">
          {/* Month Navigation */}
          <div className="flex items-center justify-between mb-5">
            <button onClick={goToPrevMonth} className="p-2 hover:bg-gray-800 rounded-xl transition-colors">
              <ChevronLeft className="w-5 h-5 text-gray-400" />
            </button>
            <div className="flex items-center gap-3">
              <h3 className="text-2xl font-bold text-white tracking-tight">
                {MONTHS[currentDate.getMonth()]}
              </h3>
              <span className="text-lg text-gray-500 font-medium">{currentDate.getFullYear()}</span>
              <button onClick={goToToday}
                className="text-xs text-cyan-400 hover:text-cyan-300 px-3 py-1 rounded-lg border border-cyan-500/30 hover:bg-cyan-500/10 transition-colors font-medium">
                Oggi
              </button>
            </div>
            <button onClick={goToNextMonth} className="p-2 hover:bg-gray-800 rounded-xl transition-colors">
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 mb-2">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-center text-xs font-semibold text-gray-500 py-2 uppercase tracking-wider">{d}</div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map(({ date, isCurrentMonth }, i) => {
              const key = toDateKey(date);
              const dayEvents = eventsByDate.get(key) || [];
              const isToday = key === todayKey;
              const isSelected = key === selectedDate;
              const hasHighPriority = dayEvents.some(e => e.priority === 'high' && !e.completed);

              return (
                <button key={i} onClick={() => setSelectedDate(key === selectedDate ? null : key)}
                  className={`relative min-h-[64px] p-1.5 rounded-xl text-left transition-all
                    ${isCurrentMonth ? 'bg-gray-800/40' : 'bg-gray-900/30'}
                    ${isSelected ? 'ring-2 ring-cyan-500 bg-cyan-900/20 z-10' : 'hover:bg-gray-800/60'}
                    ${isToday ? 'ring-2 ring-cyan-400/50' : ''}
                    ${hasHighPriority ? 'ring-1 ring-red-500/40' : ''}
                  `}>
                  <div className="flex items-start justify-between">
                    <span className={`text-sm font-semibold inline-flex items-center justify-center
                      ${isToday ? 'bg-cyan-500 text-white w-7 h-7 rounded-full text-xs' : ''}
                      ${isCurrentMonth ? 'text-gray-200' : 'text-gray-600'}
                    `}>
                      {date.getDate()}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="text-[10px] text-gray-500 font-medium">{dayEvents.length}</span>
                    )}
                  </div>

                  {/* Event indicators */}
                  {dayEvents.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {dayEvents.slice(0, 2).map((e, j) => {
                        const cat = CATEGORY_CONFIG[e.category] || CATEGORY_CONFIG.other;
                        return (
                          <div key={j} className={`text-[9px] px-1 py-0.5 rounded truncate font-medium ${
                            e.completed ? 'text-gray-600 line-through' :
                            e.priority === 'high' ? 'bg-red-500/20 text-red-300' :
                            `${cat.bg} ${cat.color}`
                          }`}>
                            {e.title}
                          </div>
                        );
                      })}
                      {dayEvents.length > 2 && (
                        <div className="text-[9px] text-gray-500 px-1">+{dayEvents.length - 2}</div>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Panel */}
        <div className="xl:w-80 border-t xl:border-t-0 xl:border-l border-gray-700/50 bg-gray-900/50">
          <div className="p-5 space-y-6">
            {/* Next Key Event */}
            {nextKeyEvent && (
              <div className="bg-gradient-to-br from-cyan-900/30 to-blue-900/20 rounded-xl p-4 border border-cyan-500/20">
                <div className="text-[10px] font-semibold text-cyan-400 uppercase tracking-widest mb-2">Prossimo Evento</div>
                <h4 className="text-base font-bold text-white mb-1">{nextKeyEvent.title}</h4>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  <span className={`font-bold ${daysUntil(new Date(nextKeyEvent.date)) <= 3 ? 'text-red-400' : 'text-cyan-300'}`}>
                    {daysUntil(new Date(nextKeyEvent.date)) === 0 ? 'OGGI' :
                     daysUntil(new Date(nextKeyEvent.date)) === 1 ? 'DOMANI' :
                     `${daysUntil(new Date(nextKeyEvent.date))} giorni`}
                  </span>
                </div>
                {nextKeyEvent.priority === 'high' && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-red-400 font-medium">
                    <AlertTriangle className="w-3 h-3" /> Priorita alta
                  </div>
                )}
              </div>
            )}

            {/* Selected Day Detail */}
            {selectedDate && (
              <div>
                <h3 className="text-sm font-bold text-gray-200 mb-3">
                  {new Date(selectedDate + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}
                </h3>
                {selectedDayEvents.length === 0 ? (
                  <div className="text-center py-4">
                    <p className="text-xs text-gray-500">Nessun evento</p>
                    <button onClick={() => { setEditingEvent(null); setShowCreateModal(true); }}
                      className="mt-2 text-xs text-cyan-400 hover:text-cyan-300">+ Aggiungi evento</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedDayEvents.map(event => {
                      const cat = CATEGORY_CONFIG[event.category] || CATEGORY_CONFIG.other;
                      const priority = PRIORITY_CONFIG[event.priority || 'medium'];
                      return (
                        <div key={event.id} className={`p-3 rounded-xl border transition-all ${cat.bg} ${event.completed ? 'opacity-40' : ''}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0 flex-1">
                              <button onClick={() => toggleComplete(event.id)} className={`flex-shrink-0 mt-0.5 ${cat.color}`}>
                                {cat.icon}
                              </button>
                              <div className="min-w-0">
                                <span className={`text-sm font-semibold block truncate ${event.completed ? 'line-through text-gray-500' : 'text-white'}`}>
                                  {event.title}
                                </span>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className={`text-[10px] font-medium ${priority.color}`}>{priority.label}</span>
                                  <span className={`text-[10px] ${cat.color}`}>{cat.label}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                              <button onClick={() => setEditingEvent(event)} className="text-gray-500 hover:text-gray-300 p-1">
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => deleteEvent(event.id)} className="text-gray-500 hover:text-red-400 p-1">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          {event.description && (
                            <p className="text-xs text-gray-400 mt-2 ml-5">{event.description}</p>
                          )}
                          {event.goalId && (
                            <div className="flex items-center gap-1 mt-1.5 ml-5">
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

            {/* This Week */}
            {thisWeekEvents.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Questa settimana</h3>
                <div className="space-y-2">
                  {thisWeekEvents.map(event => {
                    const cat = CATEGORY_CONFIG[event.category] || CATEGORY_CONFIG.other;
                    const days = daysUntil(new Date(event.date));
                    return (
                      <div key={event.id} className="flex items-center gap-2.5 group cursor-pointer"
                        onClick={() => { setSelectedDate(toDateKey(new Date(event.date))); }}>
                        <span className={`flex-shrink-0 ${cat.color}`}>{cat.icon}</span>
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs font-medium truncate ${event.priority === 'high' ? 'text-red-300' : 'text-white'}`}>{event.title}</p>
                        </div>
                        <span className={`text-xs font-bold flex-shrink-0 ${days <= 1 ? 'text-red-400' : days <= 3 ? 'text-yellow-400' : 'text-gray-400'}`}>
                          {days === 0 ? 'Oggi' : days === 1 ? 'Domani' : `${days}g`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* This Month */}
            {thisMonthEvents.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
                  {MONTHS[currentDate.getMonth()]}
                </h3>
                <div className="space-y-1.5">
                  {thisMonthEvents.slice(0, 8).map(event => {
                    const cat = CATEGORY_CONFIG[event.category] || CATEGORY_CONFIG.other;
                    const days = daysUntil(new Date(event.date));
                    return (
                      <div key={event.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-800/50 rounded-lg px-2 py-1.5 transition-colors"
                        onClick={() => { setSelectedDate(toDateKey(new Date(event.date))); }}>
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cat.dot}`} />
                        <span className="text-gray-300 truncate flex-1">{event.title}</span>
                        <span className={`font-semibold flex-shrink-0 ${days < 0 ? 'text-red-500' : days <= 3 ? 'text-red-400' : days <= 7 ? 'text-yellow-400' : 'text-gray-500'}`}>
                          {days < 0 ? `${Math.abs(days)}g fa` : days === 0 ? 'Oggi' : `${days}g`}
                        </span>
                      </div>
                    );
                  })}
                  {thisMonthEvents.length > 8 && (
                    <p className="text-[10px] text-gray-600 px-2">+{thisMonthEvents.length - 8} altri</p>
                  )}
                </div>
              </div>
            )}

            {/* Empty state */}
            {upcomingEvents.length === 0 && !selectedDate && (
              <div className="text-center py-8">
                <CalendarIcon className="w-10 h-10 text-gray-700 mx-auto mb-3" />
                <p className="text-sm text-gray-500 font-medium">Nessun evento pianificato</p>
                <p className="text-xs text-gray-600 mt-1">Aggiungi scadenze, tornei, esami e appuntamenti</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingEvent) && (
        <EventFormModal
          event={editingEvent} goals={goals} selectedDate={selectedDate}
          onSave={(data) => {
            if (editingEvent) { updateEvent(editingEvent.id, data); }
            else { createEvent(data as Omit<ImportantEvent, 'id' | 'createdAt' | 'updatedAt'>); }
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
  const [priority, setPriority] = useState<EventPriority>(event?.priority || 'medium');
  const [goalId, setGoalId] = useState(event?.goalId || '');
  const [userId] = useState(event?.userId || 'local');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      date: new Date(date + 'T12:00:00'),
      category, priority,
      goalId: goalId || undefined,
      userId,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-800 rounded-2xl border border-gray-700 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <h3 className="text-lg font-bold text-white">{event ? 'Modifica Evento' : 'Nuovo Evento'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Titolo</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              placeholder="Es: Torneo scacchi regionale..." autoFocus />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Data</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Categoria</label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(CATEGORY_CONFIG) as [EventCategory, typeof CATEGORY_CONFIG[EventCategory]][]).map(([key, config]) => (
                <button key={key} type="button" onClick={() => setCategory(key)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors
                    ${category === key ? `${config.bg} ${config.color}` : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}>
                  {config.icon} {config.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Priorita</label>
            <div className="flex gap-2">
              {(Object.entries(PRIORITY_CONFIG) as [EventPriority, typeof PRIORITY_CONFIG[EventPriority]][]).map(([key, config]) => (
                <button key={key} type="button" onClick={() => setPriority(key)}
                  className={`flex-1 py-2 rounded-lg border text-xs font-semibold transition-all text-center
                    ${priority === key ? `${config.color} border-current bg-gray-900 ring-2 ${config.ring}` : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}>
                  {config.label}
                </button>
              ))}
            </div>
          </div>

          {goals.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Collega a Goal</label>
              <select value={goalId} onChange={e => setGoalId(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50">
                <option value="">Nessun goal</option>
                {goals.filter(g => g.status === 'active').map(g => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Note (opzionale)</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              className="w-full px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-xl text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              placeholder="Dettagli..." />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm text-gray-400 hover:text-white transition-colors">
              Annulla
            </button>
            <button type="submit" disabled={!title.trim()}
              className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 text-white text-sm font-semibold rounded-xl transition-colors">
              {event ? 'Salva' : 'Crea Evento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
