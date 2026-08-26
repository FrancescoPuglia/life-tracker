'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, Plus, Sparkles } from 'lucide-react';
import { TimeBlock, Task, Project, Goal, Session } from '@/types';
import { toDateSafe, formatDateSafe, formatTimeSafe, formatDateStringSafe } from '@/utils/dateUtils';
import { audioManager } from '@/lib/audioManager';
import { getVoiceService } from '@/lib/voice/voiceService';
import { aggregateExecutionWindow } from '@/lib/executionAggregation';

type ViewMode = 'day' | 'week' | 'month';

// Temporary type for modal UI state
interface TimeBlockModalData extends Partial<TimeBlock> {
  repeatWeekly?: boolean;
  selectedDays?: boolean[];
}

interface TimeBlockPlannerProps {
  timeBlocks: TimeBlock[];
  sessions?: Session[];
  sessionCoverage?: 'loading' | 'ready' | 'error';
  tasks: Task[];
  projects: Project[];
  goals: Goal[];
  onCreateTimeBlock: (block: Partial<TimeBlock>) => void;
  onUpdateTimeBlock: (id: string, updates: Partial<TimeBlock>) => void;
  onDeleteTimeBlock: (id: string) => void;
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  currentUserId?: string; // 🔥 CRITICAL FIX
  isReady?: boolean; // Disable buttons until Firebase is ready
  /**
   * Optional tab-switch handler. When provided, the planner exposes a
   * "Generate Weekly Plan" secondary CTA that switches the host MainApp
   * to the `weekly_intel` tab.
   */
  onNavigate?: (tabId: string) => void;
}

export default function TimeBlockPlanner({
  timeBlocks,
  sessions = [],
  sessionCoverage = 'loading',
  tasks,
  projects,
  goals,
  onCreateTimeBlock,
  onUpdateTimeBlock,
  onDeleteTimeBlock,
  selectedDate,
  onDateChange,
  currentUserId, // 🔥 CRITICAL FIX
  isReady = false,
  onNavigate
}: TimeBlockPlannerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; time: Date } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ startTime: Date; endTime: Date } | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<TimeBlock | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBlockData, setNewBlockData] = useState<TimeBlockModalData>({});
  const plannerRef = useRef<HTMLDivElement>(null);

  const HOUR_HEIGHT = 64;
  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  useEffect(() => {
    if (viewMode !== 'day' || !plannerRef.current) return;
    const target = plannerRef.current;
    const frame = window.requestAnimationFrame(() => {
      const currentHour = selectedDate.toDateString() === new Date().toDateString()
        ? new Date().getHours()
        : 8;
      target.scrollTop = Math.max(0, (Math.min(currentHour, 22) - 2) * HOUR_HEIGHT);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedDate, viewMode]);

  // ============================================================================
  // VIEW MODE UTILITIES - Supreme Detective Implementation  
  // ============================================================================

  const getViewPeriodDates = (date: Date, mode: ViewMode) => {
    const baseDate = new Date(date);
    
    switch (mode) {
      case 'day':
        return [new Date(baseDate)];
        
      case 'week': {
        const startOfWeek = new Date(baseDate);
        const dayOfWeek = startOfWeek.getDay();
        const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        startOfWeek.setDate(startOfWeek.getDate() + diffToMonday);
        
        const dates = [];
        for (let i = 0; i < 7; i++) {
          const weekDate = new Date(startOfWeek);
          weekDate.setDate(weekDate.getDate() + i);
          dates.push(weekDate);
        }
        return dates;
      }
        
      case 'month': {
        const year = baseDate.getFullYear();
        const month = baseDate.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        const dates = [];
        for (let day = 1; day <= daysInMonth; day++) {
          dates.push(new Date(year, month, day));
        }
        return dates;
      }
        
      default:
        return [new Date(baseDate)];
    }
  };

  const navigateDate = (direction: 'prev' | 'next') => {
    const currentDate = new Date(selectedDate);
    
    switch (viewMode) {
      case 'day':
        currentDate.setDate(currentDate.getDate() + (direction === 'next' ? 1 : -1));
        break;
      case 'week':
        currentDate.setDate(currentDate.getDate() + (direction === 'next' ? 7 : -7));
        break;
      case 'month':
        if (direction === 'next') {
          currentDate.setMonth(currentDate.getMonth() + 1, 1);
        } else {
          currentDate.setMonth(currentDate.getMonth() - 1, 1);
        }
        break;
    }
    
    onDateChange(currentDate);
  };

  const getViewTitle = () => {
    switch (viewMode) {
      case 'day':
        return formatDate(selectedDate);
      case 'week': {
        const dates = getViewPeriodDates(selectedDate, 'week');
        const start = dates[0];
        const end = dates[dates.length - 1];
        return `${start.getDate()} ${start.toLocaleDateString('it-IT', { month: 'short' })} – ${end.getDate()} ${end.toLocaleDateString('it-IT', { month: 'short' })} ${end.getFullYear()}`;
      }
      case 'month':
        return selectedDate.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      default:
        return formatDate(selectedDate);
    }
  };

  const formatTime = (hour: number) => {
    return `${hour.toString().padStart(2, '0')}:00`;
  };

  const formatDate = (date: Date) => {
    return formatDateSafe(date, { 
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }, 'Data non disponibile');
  };

  const getTimeFromPosition = (y: number) => {
    const rect = plannerRef.current?.getBoundingClientRect();
    if (!rect) return new Date();
    
    const relativeY = y - rect.top;
    const hour = Math.floor(relativeY / HOUR_HEIGHT);
    const minutes = Math.floor((relativeY % HOUR_HEIGHT) / HOUR_HEIGHT * 60);
    
    const time = new Date(selectedDate);
    time.setHours(Math.max(0, Math.min(23, hour)), Math.max(0, Math.min(59, minutes)), 0, 0);
    return time;
  };

  const getPositionFromTime = (time: Date) => {
    const hour = time.getHours();
    const minutes = time.getMinutes();
    return hour * HOUR_HEIGHT + (minutes / 60) * HOUR_HEIGHT;
  };

  const getDurationHeight = (startTime: Date, endTime: Date) => {
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);
    return durationHours * HOUR_HEIGHT;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = plannerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const relativeY = e.clientY - rect.top;
    const time = getTimeFromPosition(e.clientY);
    setDragStart({ x: e.clientX, y: e.clientY, time });
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !dragStart) return;
    
    e.preventDefault();
    
    const currentTime = getTimeFromPosition(e.clientY);
    const startTime = dragStart.time;
    
    setDragPreview({
      startTime: startTime < currentTime ? startTime : currentTime,
      endTime: startTime < currentTime ? currentTime : startTime
    });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDragging || !dragStart) return;
    
    e.preventDefault();
    const endTime = getTimeFromPosition(e.clientY);
    const startTime = dragStart.time;
    
    if (Math.abs(endTime.getTime() - startTime.getTime()) > 15 * 60 * 1000) { // Minimum 15 minutes
      if (!currentUserId) {
        console.error('Cannot create time block: userId not available');
        return;
      }

      const newBlock: TimeBlockModalData = {
        startTime: startTime < endTime ? startTime : endTime,
        endTime: startTime < endTime ? endTime : startTime,
        title: 'New Time Block',
        status: 'planned',
        type: 'work',
        userId: currentUserId,
        domainId: 'domain-1', // This should be selectable
      };
      
      setNewBlockData(newBlock);
      setShowCreateModal(true);
    }
    
    setIsDragging(false);
    setDragStart(null);
    setDragPreview(null);
  };

  const handleQuickCreateBlock = (hour: number) => {
    if (!currentUserId) {
      console.error('Cannot create time block: userId not available');
      return;
    }

    const startTime = new Date(selectedDate);
    startTime.setHours(hour, 0, 0, 0);

    const endTime = new Date(selectedDate);
    endTime.setHours(hour + 1, 0, 0, 0);

    const newBlock: TimeBlockModalData = {
      startTime,
      endTime,
      title: 'New Time Block',
      status: 'planned',
      type: 'work',
      userId: currentUserId,
      domainId: 'domain-1',
    };

    setNewBlockData(newBlock);
    setShowCreateModal(true);
  };

  const handleCreateBlock = () => {
    if (newBlockData.startTime && newBlockData.endTime) {
      // 🔥 NEW FEATURE: Weekly Repeat Logic
      if (newBlockData.repeatWeekly && viewMode === 'week') {
        const selectedDays = newBlockData.selectedDays || [true, true, true, true, true, true, true];
        const weekDates = getViewPeriodDates(selectedDate, 'week');
        
        // Create time blocks for each selected day
        selectedDays.forEach((isSelected, dayIndex) => {
          if (isSelected && weekDates[dayIndex]) {
            const targetDate = weekDates[dayIndex];
            
            // Create start and end times for this specific day
            const dayStartTime = new Date(targetDate);
            dayStartTime.setHours(
              newBlockData.startTime!.getHours(),
              newBlockData.startTime!.getMinutes(),
              0, 0
            );
            
            const dayEndTime = new Date(targetDate);
            dayEndTime.setHours(
              newBlockData.endTime!.getHours(),
              newBlockData.endTime!.getMinutes(),
              0, 0
            );
            
            const blockToCreate = {
              ...newBlockData,
              id: `block-${Date.now()}-${dayIndex}`,
              startTime: dayStartTime,
              endTime: dayEndTime,
              createdAt: new Date(),
              updatedAt: new Date(),
              // Remove temporary properties
              repeatWeekly: undefined,
              selectedDays: undefined,
            };
            
            onCreateTimeBlock(blockToCreate);
          }
        });
      } else {
        // Single block creation (original logic)
        const blockToCreate = {
          ...newBlockData,
          id: `block-${Date.now()}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          // Remove temporary properties
          repeatWeekly: undefined,
          selectedDays: undefined,
        };
        
        onCreateTimeBlock(blockToCreate);
      }
      
      setShowCreateModal(false);
      setNewBlockData({});
    }
  };

  // Get default color for a type
  const getDefaultColorForType = (type: string): string => {
    switch (type) {
      case 'work': return '#2563eb'; // blue-600
      case 'break': return '#16a34a'; // green-600
      case 'focus': return '#9333ea'; // purple-600
      case 'deep': return '#4338ca'; // indigo-700
      case 'shallow': return '#0891b2'; // cyan-600
      case 'meeting': return '#ea580c'; // orange-600
      case 'admin': return '#4b5563'; // gray-600
      case 'buffer': return '#ca8a04'; // yellow-600
      case 'travel': return '#0d9488'; // teal-600
      default: return '#3b82f6'; // blue-500
    }
  };

  const getBlockColor = (block: TimeBlock) => {
    const baseClasses = 'font-semibold rounded-lg transition-shadow duration-150 border';
    
    // Use custom color if available, otherwise use default type color
    if (block.color) {
      return `${baseClasses} text-white border-white/30`;
    }
    
    switch (block.type) {
      case 'work': 
        return `${baseClasses} bg-blue-600 text-white border-blue-500`;
      case 'break': 
        return `${baseClasses} bg-emerald-600 text-white border-emerald-500`;
      case 'focus': 
        return `${baseClasses} bg-indigo-600 text-white border-indigo-500`;
      case 'deep':
        return `${baseClasses} bg-indigo-800 text-white border-indigo-700`;
      case 'shallow':
        return `${baseClasses} bg-cyan-700 text-white border-cyan-600`;
      case 'meeting': 
        return `${baseClasses} bg-amber-600 text-white border-amber-500`;
      case 'admin': 
        return `${baseClasses} bg-slate-600 text-white border-slate-500`;
      case 'buffer':
        return `${baseClasses} bg-amber-700 text-white border-amber-600`;
      case 'travel':
        return `${baseClasses} bg-teal-700 text-white border-teal-600`;
      default: 
        return `${baseClasses} bg-blue-600 text-white border-blue-500`;
    }
  };

  const getBlockIcon = (block: TimeBlock) => {
    switch (block.type) {
      case 'work': return '💼';
      case 'break': return '☕';
      case 'focus': return '🎯';
      case 'deep': return '🧠';
      case 'shallow': return '💭';
      case 'meeting': return '🤝';
      case 'admin': return '⚙️';
      case 'buffer': return '⏳';
      case 'travel': return '🚗';
      default: return '📋';
    }
  };

  // 🔥 P0.2 FIX: Correct overdue logic with selectedDate reference
  const getStatusIndicator = (block: TimeBlock) => {
    const now = new Date();
    // CRITICAL: Pass selectedDate as referenceDate for HH:mm strings
    const blockEndTime = toDateSafe(block.endTime, selectedDate);
    const blockStartTime = toDateSafe(block.startTime, selectedDate);
    
    // Never overdue if completed/cancelled/missed
    if (block.status === 'completed' || block.status === 'cancelled') {

      return '✅';
    }
    
    // Never overdue if in future
    if (blockEndTime > now) {
      return block.status === 'in_progress' ? '🔴' : '⏰';
    }
    
    // Overdue only when: endDateTime < now AND status not completed
    const isOverdue = now > blockEndTime;
    
    if (block.status === 'in_progress') return '🔴';
    if (isOverdue) return '⚠️';
    return '⏰';
  };

  // 🔥 P0.2 FIX: Get overdue message with selectedDate reference
  const getOverdueMessage = (block: TimeBlock) => {
    const now = new Date();
    // CRITICAL: Pass selectedDate as referenceDate for HH:mm strings
    const blockEndTime = toDateSafe(block.endTime, selectedDate);
    
    // Never overdue if completed/cancelled/missed or in future
    if (block.status === 'completed' || block.status === 'cancelled' || blockEndTime > now) {
  return null;
}

    
    const overdueMinutes = Math.floor((now.getTime() - blockEndTime.getTime()) / (1000 * 60));
    if (overdueMinutes > 60) {
      const overdueHours = Math.floor(overdueMinutes / 60);
      const remainingMinutes = overdueMinutes % 60;
      return `Overdue by ${overdueHours}h ${remainingMinutes}m`;
    }
    return `Overdue by ${overdueMinutes} minutes`;
  };


  // Prevent infinite re-rendering
  const filteredBlocks = useMemo(() => timeBlocks.filter((block, index) => {
    try {
      const blockDate = toDateSafe(block.startTime, selectedDate);
      const viewDates = getViewPeriodDates(selectedDate, viewMode);
      
      const isInViewPeriod = viewDates.some(date => 
        formatDateStringSafe(blockDate) === formatDateStringSafe(date)
      );
      
      return isInViewPeriod && formatDateStringSafe(blockDate) !== 'Invalid Date';
    } catch (error) {
      console.error(`❌ Filter ERROR for block ${index}:`, error, block);
      return false;
    }
  }), [timeBlocks, selectedDate, viewMode]); // Dependencies for memoization

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // ============================================================================
  // DAY SUMMARY — planned / completed minutes for the day view header strip.
  // Pure derivation from filteredBlocks; no extra fetches, no extra state.
  // ============================================================================
  const daySummary = useMemo(() => {
    if (!currentUserId) {
      return { plannedMin: 0, actualMin: null, pct: null, availability: 'unavailable' as const };
    }
    const dayStart = new Date(selectedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const execution = aggregateExecutionWindow({
      ownerUid: currentUserId,
      start: dayStart,
      end: dayEnd,
      timeBlocks,
      sessions: sessionCoverage === 'ready' ? sessions : [],
    });
    const plannedMin = Math.round(execution.plannedMinutes);
    if (sessionCoverage !== 'ready') {
      return { plannedMin, actualMin: null, pct: null, availability: 'unavailable' as const };
    }
    const actualMin = Math.round(execution.actualMinutes);
    const pct = execution.availability === 'complete' && plannedMin > 0
      ? Math.round(actualMin / plannedMin * 100)
      : null;
    return {
      plannedMin,
      actualMin,
      pct,
      availability: execution.availability,
    };
  }, [currentUserId, selectedDate, sessionCoverage, sessions, timeBlocks]);

  const minutesLabel = (m: number): string => {
    if (m < 60) return `${m} min`;
    const h = m / 60;
    return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`;
  };

  return (
    <div
      data-testid="time-block-planner"
      className="overflow-hidden rounded-[14px] border border-slate-200 bg-white"
      style={{ minHeight: '600px', contain: 'layout style' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-indigo-50 text-indigo-700" aria-hidden="true">
            <Calendar size={19} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold tracking-[-0.01em] text-slate-950">
                Time Planner
              </h2>

              <div className="flex items-center overflow-hidden rounded-[9px] border border-slate-200 bg-slate-50 p-0.5" aria-label="Vista planner">
                {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`min-h-[34px] rounded-[7px] px-3 text-[13px] font-semibold transition-colors ${
                      viewMode === mode
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {mode === 'day' ? 'Giorno' : mode === 'week' ? 'Settimana' : 'Mese'}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1 truncate text-sm font-medium capitalize text-slate-500">{getViewTitle()}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('weekly_intel')}
              data-testid="planner-generate-weekly-plan"
              className="lt-button-secondary min-h-[38px] px-3 text-indigo-700"
            >
              <Sparkles size={16} aria-hidden="true" /> Piano settimanale
            </button>
          )}
          <button
            type="button"
            onClick={() => handleQuickCreateBlock(new Date().getHours())}
            disabled={!isReady}
            data-testid="planner-add-block"
            className={`inline-flex min-h-[38px] items-center gap-2 rounded-[9px] px-4 text-sm font-semibold transition-colors ${
              isReady
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'cursor-not-allowed bg-slate-200 text-slate-400'
            }`}
          >
            <Plus size={16} aria-hidden="true" /> Nuovo blocco
          </button>
          <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden="true" />
          <button
            type="button"
            onClick={() => navigateDate('prev')}
            className="lt-icon-button min-h-[38px] w-9"
            title="Periodo precedente"
            aria-label="Periodo precedente"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onDateChange(new Date())}
            data-testid="planner-today-button"
            className="lt-button-secondary min-h-[38px] px-3"
          >
            Oggi
          </button>
          <button
            type="button"
            onClick={() => navigateDate('next')}
            className="lt-icon-button min-h-[38px] w-9"
            title="Periodo successivo"
            aria-label="Periodo successivo"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Day summary strip — only shown in day view (the planned/completed
          numbers map to the same selectedDate the user is looking at). */}
      {viewMode === 'day' && (
        <div
          data-testid="planner-day-summary"
          className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-slate-50/70 px-5 py-3 text-xs"
        >
          <SummaryChip label="Pianificato" value={minutesLabel(daySummary.plannedMin)} tone="neutral" />
          <SummaryChip
            label={daySummary.availability === 'partial' ? 'Effettivo noto ≥' : 'Effettivo noto'}
            value={daySummary.actualMin === null ? 'Non disponibile' : minutesLabel(daySummary.actualMin)}
            tone="emerald"
          />
          <SummaryChip
            label="Aderenza"
            value={daySummary.pct === null ? 'Non disponibile' : `${daySummary.pct}%`}
            tone={daySummary.pct !== null && daySummary.pct >= 80 ? 'emerald' : daySummary.pct !== null && daySummary.pct >= 50 ? 'blue' : 'neutral'}
            highlight
          />
          <div className="flex-1 min-w-[120px] h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full bg-cyan-600"
              style={{ width: `${daySummary.pct === null ? 0 : Math.min(100, Math.max(0, daySummary.pct))}%` }}
              data-testid="planner-day-summary-bar"
            />
          </div>
        </div>
      )}

      {/* Time Grid - Conditional View Rendering */}
      <div className="relative">
        {viewMode === 'day' && (
        <div 
          ref={plannerRef}
          className="relative min-h-[560px] overflow-y-auto bg-white"
          style={{ height: 'calc(100vh - 286px)' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            setIsDragging(false);
            setDragStart(null);
            setDragPreview(null);
          }}
        >
          {/* Hour Grid */}
          {HOURS.map(hour => (
            <div
              key={hour}
              className="group absolute left-0 right-0 border-t border-slate-100 transition-colors hover:bg-cyan-50/40"
              style={{ top: `${hour * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
            >
              <div className="absolute left-3 top-1.5 text-xs font-medium tabular-nums text-slate-500">
                {formatTime(hour)}
              </div>
              <button
                onClick={() => handleQuickCreateBlock(hour)}
                disabled={!isReady}
                className={`absolute right-4 top-1 transition-opacity w-6 h-6 rounded-full text-xs flex items-center justify-center ${
                  isReady
                    ? 'opacity-0 group-hover:opacity-100 bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'cursor-not-allowed bg-slate-300 text-slate-100 opacity-50'
                }`}
                title={isReady ? `Add block at ${formatTime(hour)}` : 'Please log in first'}
              >
                +
              </button>
            </div>
          ))}

          {/* Time Blocks — premium empty state */}
          {filteredBlocks.length === 0 && (
            <div
              data-testid="planner-empty-state"
              className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none"
            >
              <div className="pointer-events-auto max-w-md rounded-[14px] border border-dashed border-slate-300 bg-white/95 px-8 py-7 text-center shadow-sm">
                <span className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl bg-indigo-50 text-indigo-700" aria-hidden="true"><Calendar size={20} /></span>
                <h3 className="mb-2 text-base font-semibold text-slate-900">
                  Nessun blocco per {selectedDate.toLocaleDateString('it-IT', { weekday: 'long' })}
                </h3>
                <p className="mb-4 text-sm leading-6 text-slate-600">
                  Crea il primo blocco oppure genera la settimana dal Piano settimanale. Puoi anche selezionare un’ora sulla timeline.
                </p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <button
                    onClick={() => handleQuickCreateBlock(new Date().getHours())}
                    disabled={!isReady}
                    data-testid="planner-empty-add-block"
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      isReady
                        ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                        : 'cursor-not-allowed bg-slate-200 text-slate-400'
                    }`}
                  >
                    <Plus size={16} aria-hidden="true" /> Nuovo blocco
                  </button>
                  {onNavigate && (
                    <button
                      onClick={() => onNavigate('weekly_intel')}
                      data-testid="planner-empty-generate-weekly"
                      className="inline-flex min-h-[40px] items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <Sparkles size={16} aria-hidden="true" /> Piano settimanale
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Render existing blocks */}
          {filteredBlocks.map((block) => {
            // Parse times with selectedDate reference for consistent positioning
            const startTime = toDateSafe(block.startTime, selectedDate);
            const endTime = toDateSafe(block.endTime, selectedDate);
            
            // Guard for invalid durations - set minimum 1 hour for display only
            const displayEndTime = endTime <= startTime ? new Date(startTime.getTime() + 60*60*1000) : endTime;
            
            // Debug log behind feature flag
            if (process.env.NEXT_PUBLIC_DEBUG_TIMEBLOCK === '1') {
              console.log('[TimeBlockPlanner] Rendering block:', {
                id: block.id,
                rawStart: block.startTime,
                rawEnd: block.endTime,
                parsedStart: startTime.toISOString(),
                parsedEnd: endTime.toISOString(),
                displayEnd: displayEndTime.toISOString(),
                selectedDate: selectedDate.toISOString()
              });
            }
            
            return (
            <div
              key={block.id}
              className={`absolute left-16 right-4 z-10 cursor-pointer shadow-sm hover:shadow-md ${block.color ? 'rounded-lg border border-white/30 font-semibold text-white' : getBlockColor(block)}`}
              style={{
                top: `${getPositionFromTime(startTime)}px`,
                height: `${getDurationHeight(startTime, displayEndTime)}px`,
                minHeight: '60px',
                // Use custom color if available
                ...(block.color ? {
                  backgroundColor: block.color,
                  borderColor: block.color + '80' // Add transparency to border
                } : {})
              }}
              onClick={() => setSelectedBlock(block)}
            >
              <div className="flex h-full items-start justify-between p-3">
                <div className="flex-1 min-w-0">
                  <div className="mb-1 truncate text-[15px] font-semibold leading-5">
                    {getBlockIcon(block)} {block.title}
                  </div>
                  {/* Description più piccola e meno prominente */}
                  {block.description && (
                    <div className="mb-1 truncate text-xs opacity-80">
                      {block.description}
                    </div>
                  )}
                  {/* Time display più compatto */}
                  <div className="font-mono text-xs opacity-80">
                    {formatTimeSafe(startTime, { hour12: false, hour: '2-digit', minute: '2-digit' }, '--:--', selectedDate)} - 
                    {formatTimeSafe(endTime, { hour12: false, hour: '2-digit', minute: '2-digit' }, '--:--', selectedDate)}
                  </div>
                </div>
                <div className="flex flex-col space-y-2">
                  {/* Enhanced Completion Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const newStatus = block.status === 'completed' ? 'planned' : 'completed';
                      onUpdateTimeBlock(block.id, { status: newStatus });
                      if (newStatus === 'completed') {
                        audioManager.taskCompleted();
                        getVoiceService()?.speakConfirmation('blockCompleted');
                      }
                    }}
                    className={`relative text-base transition-colors ${
                      block.status === 'completed'
                        ? 'text-green-400 hover:text-green-300'
                        : 'text-white/65 hover:text-white'
                    }`}
                    title={
                      block.status === 'completed'
                        ? 'Completed - Click to mark as planned'
                        : 'Mark completed (execution time requires a Session)'
                    }
                  >
                    {block.status === 'completed' ? '✅' : '⭕'}
                  </button>
                  
                  {/* Status indicator */}
                  <div 
                    className="cursor-help text-sm opacity-75"
                    title={
                      block.status === 'completed' ? 'Completed' :
                      block.status === 'in_progress' ? 'In Progress' :
                      'Planned'
                    }
                  >
                    {block.status === 'completed' ? '✅' :
                     block.status === 'in_progress' ? '⏳' :
                     endTime < new Date() ? '⚠️' : '📋'}
                  </div>
                  
                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete "${block.title}"?`)) {
                        onDeleteTimeBlock(block.id);
                      }
                    }}
                    className="text-xs text-red-400 hover:text-red-600 bg-white/20 hover:bg-white/40 rounded px-1 transition-colors"
                    title="Delete block"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
            );
          })}

          {/* Drag Preview */}
          {dragPreview && (
            <div
              className="absolute left-16 right-4 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-indigo-400 bg-indigo-500/80 shadow-sm"
              style={{
                top: `${getPositionFromTime(dragPreview.startTime)}px`,
                height: `${getDurationHeight(dragPreview.startTime, dragPreview.endTime)}px`,
                minHeight: '60px'
              }}
            >
              <div className="text-white text-center">
                <div className="text-sm font-semibold">Nuovo blocco</div>
                <div className="text-xs opacity-90 font-mono">
                  {formatTimeSafe(dragPreview.startTime, { hour12: false, hour: '2-digit', minute: '2-digit' }, '--:--', selectedDate)} - 
                  {formatTimeSafe(dragPreview.endTime, { hour12: false, hour: '2-digit', minute: '2-digit' }, '--:--', selectedDate)}
                </div>
              </div>
            </div>
          )}

          {/* Current Time Indicator */}
          {selectedDate.toDateString() === new Date().toDateString() && (
            <div
              className="pointer-events-none absolute left-0 right-0 z-20 h-0.5 bg-cyan-500"
              style={{ top: `${getPositionFromTime(new Date())}px` }}
            >
              <div className="absolute -left-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-cyan-500"></div>
              <span className="absolute left-3 -top-4 rounded bg-cyan-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">Ora</span>
            </div>
          )}
        </div>
        )}

        {/* Week View - Google Calendar Style */}
        {viewMode === 'week' && (
          <div className="max-h-[calc(100vh-230px)] min-h-[560px] overflow-auto bg-white" style={{ contain: 'layout' }}>
            <div className="flex min-w-[980px]">
              {/* Time Column */}
              <div className="sticky left-0 z-20 w-16 flex-shrink-0 border-r border-slate-200 bg-white">
                {/* Empty header space */}
                <div className="sticky top-0 z-30 h-14 border-b border-slate-200 bg-slate-50"></div>
                {/* Hour slots */}
                {HOURS.map(hour => (
                  <div
                    key={hour}
                    className="flex items-start justify-end border-b border-slate-100 pr-2 text-right text-xs tabular-nums text-slate-500"
                    style={{ height: `${HOUR_HEIGHT}px` }}
                  >
                    <span className="mt-1">{formatTime(hour)}</span>
                  </div>
                ))}
              </div>

              {/* Days Grid */}
              <div className="min-w-0 flex-1">
                <div className="grid min-w-full grid-cols-7" style={{ minHeight: '480px', contain: 'layout' }}>
                  {getViewPeriodDates(selectedDate, 'week').map((date, dayIndex) => {
                    const dayBlocks = filteredBlocks.filter(block => {
                      // Use block's actual creation date as reference, not the current view date
                      // This prevents time blocks from "jumping" when navigating between weeks
                      const blockCreationDate = block.startTime instanceof Date 
                        ? new Date(block.startTime.getFullYear(), block.startTime.getMonth(), block.startTime.getDate())
                        : date; // fallback to current date if not a proper Date object
                      const blockDate = toDateSafe(block.startTime, blockCreationDate);
                      return formatDateStringSafe(blockDate) === formatDateStringSafe(date);
                    });

                    const isToday = date.toDateString() === new Date().toDateString();
                    
                    return (
                      <div key={dayIndex} className={`relative border-r border-slate-200 ${dayIndex >= 5 ? 'bg-slate-50/40' : 'bg-white'}`}>
                        {/* Day Header */}
                        <div className={`sticky top-0 z-20 flex h-14 flex-col items-center justify-center border-b border-slate-200 text-center ${isToday ? 'bg-indigo-50' : dayIndex >= 5 ? 'bg-slate-100' : 'bg-slate-50'}`}>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                            {date.toLocaleDateString('it-IT', { weekday: 'short' })}
                          </div>
                          <div className={`text-sm font-semibold ${isToday ? 'text-indigo-700' : 'text-slate-900'}`}>
                            {date.getDate()}
                          </div>
                        </div>

                        {/* Hour Grid for this day */}
                        <div className="relative" style={{ height: `${24 * HOUR_HEIGHT}px` }}>
                          {/* Hour grid lines */}
                          {HOURS.map(hour => (
                            <div
                              key={hour}
                              className="group absolute left-0 right-0 cursor-pointer border-b border-slate-100 transition-colors hover:bg-cyan-50/40"
                              style={{ 
                                top: `${hour * HOUR_HEIGHT}px`, 
                                height: `${HOUR_HEIGHT}px` 
                              }}
                              onClick={() => {
                                const clickDate = new Date(date);
                                clickDate.setHours(hour, 0, 0, 0);
                                if (!currentUserId) {
                                  console.error('Cannot create time block: userId not available');
                                  return;
                                }
                                const newBlock: TimeBlockModalData = {
                                  startTime: clickDate,
                                  endTime: new Date(clickDate.getTime() + 60*60*1000),
                                  title: 'New Time Block',
                                  status: 'planned',
                                  type: 'work',
                                  userId: currentUserId,
                                  domainId: 'domain-1',
                                };
                                setNewBlockData(newBlock);
                                setShowCreateModal(true);
                              }}
                            >
                              <button
                                className={`absolute right-2 top-1 transition-opacity w-5 h-5 rounded-full text-xs flex items-center justify-center ${
                                  isReady
                                    ? 'opacity-0 group-hover:opacity-100 bg-indigo-600 text-white hover:bg-indigo-700'
                                    : 'cursor-not-allowed bg-slate-300 text-slate-100 opacity-50'
                                }`}
                                title={isReady ? `Add block at ${formatTime(hour)}` : 'Please log in first'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!isReady || !currentUserId) return;
                                  const clickDate = new Date(date);
                                  clickDate.setHours(hour, 0, 0, 0);
                                  const newBlock: TimeBlockModalData = {
                                    startTime: clickDate,
                                    endTime: new Date(clickDate.getTime() + 60*60*1000),
                                    title: 'New Time Block',
                                    status: 'planned',
                                    type: 'work',
                                    userId: currentUserId,
                                    domainId: 'domain-1',
                                  };
                                  setNewBlockData(newBlock);
                                  setShowCreateModal(true);
                                }}
                              >
                                +
                              </button>
                            </div>
                          ))}

                          {/* Time blocks for this day */}
                          {dayBlocks.map((block) => {
                            // Use consistent date reference like Day View
                            const startTime = toDateSafe(block.startTime, date);
                            const endTime = toDateSafe(block.endTime, date);
                            
                            // Fix corrupted multi-day time blocks (STABLE MODE)
                            let displayEndTime;
                            const duration = endTime.getTime() - startTime.getTime();
                            const maxReasonableDuration = 24 * 60 * 60 * 1000; // 24 hours max for single block
                            
                            // 🛡️ PREVENT LOOP: Only repair once, don't trigger state updates
                            
                            if (duration > maxReasonableDuration) {
                              // ⚡ AUTO-REPAIR: If block spans multiple days, assume same-day intent
                              displayEndTime = new Date(startTime);
                              displayEndTime.setHours(endTime.getHours(), endTime.getMinutes(), endTime.getSeconds());
                              
                              // If end time is before start time (next day scenario), add 1 day
                              if (displayEndTime <= startTime) {
                                displayEndTime.setDate(displayEndTime.getDate() + 1);
                              }
                              
                              // 🔇 REMOVED: Console spam prevention
                              // Repair executed silently
                              
                              // 💾 OPTIONAL: Auto-save the repair to database (uncomment to enable)
                              // onUpdateTimeBlock(block.id, { endTime: displayEndTime });
                            } else {
                              displayEndTime = endTime <= startTime ? new Date(startTime.getTime() + 60*60*1000) : endTime;
                            }
                            
                            // Prevent excessive block heights (max 8 hours)
                            const maxDuration = 8 * 60 * 60 * 1000; // 8 hours in milliseconds
                            const actualDuration = displayEndTime.getTime() - startTime.getTime();
                            const safeDuration = Math.min(actualDuration, maxDuration);
                            const safeDisplayEndTime = new Date(startTime.getTime() + safeDuration);
                            
                            // 🔧 Calculate safe height with hard limit enforcement
                            const calculatedHeight = getDurationHeight(startTime, safeDisplayEndTime);
                            const maxVisualHeight = 8 * HOUR_HEIGHT; // 640px (8 hours × 80px)
                            const finalHeight = Math.min(calculatedHeight, maxVisualHeight);
                            
                            // 🔇 REMOVED: Diagnostic logs to prevent console spam
                            
                            return (
                              <div
                                key={block.id}
                                className={`absolute left-1 right-1 z-10 cursor-pointer rounded-lg shadow-sm hover:shadow-md ${block.color ? 'border border-white/30 font-semibold text-white' : getBlockColor(block)}`}
                                style={{
                                  top: `${getPositionFromTime(startTime)}px`,
                                  height: `${finalHeight}px`, // Use calculated safe height
                                  minHeight: '30px',
                                  ...(block.color ? {
                                    backgroundColor: block.color,
                                    borderColor: block.color + '80'
                                  } : {})
                                }}
                                onClick={() => setSelectedBlock(block)}
                                title={`${block.title} - ${formatTimeSafe(startTime, { hour12: false, hour: '2-digit', minute: '2-digit' }, '--:--', date)} to ${formatTimeSafe(displayEndTime, { hour12: false, hour: '2-digit', minute: '2-digit' }, '--:--', date)}`}
                              >
                                <div className="p-2 h-full flex flex-col justify-between">
                                  <div className="flex-1 min-w-0">
                                    <div className="mb-1 truncate text-xs font-semibold">
                                      {getBlockIcon(block)} {block.title}
                                      {duration > maxReasonableDuration && <span className="ml-1 text-blue-300" title="Multi-day block auto-repaired">🔧</span>}
                                      {actualDuration > maxDuration && <span className="ml-1 text-orange-300" title="Block duration truncated for display">⚠️</span>}
                                    </div>
                                    <div className="font-mono text-xs opacity-80">
                                      {formatTimeSafe(startTime, { hour12: false, hour: '2-digit', minute: '2-digit' }, '--:--', date)}
                                      {actualDuration > maxDuration && (
                                        <div className="text-orange-300">Duration: {Math.round(actualDuration / (1000 * 60 * 60) * 10) / 10}h (truncated)</div>
                                      )}
                                    </div>
                                  </div>
                                  
                                  {/* Quick actions */}
                                  <div className="flex justify-end space-x-1 mt-1">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const newStatus = block.status === 'completed' ? 'planned' : 'completed';
                                        onUpdateTimeBlock(block.id, { status: newStatus });
                                        if (newStatus === 'completed') {
                                          audioManager.taskCompleted();
                                          getVoiceService()?.speakConfirmation('blockCompleted');
                                        }
                                      }}
                                      className={`relative text-xs transition-colors ${
                                        block.status === 'completed'
                                          ? 'text-green-400'
                                          : 'text-white/65 hover:text-white'
                                      }`}
                                      title={
                                        block.status === 'completed'
                                          ? 'Completed - Click to mark as planned'
                                          : 'Mark completed (execution time requires a Session)'
                                      }
                                    >
                                      {block.status === 'completed' ? '✅' : '⭕'}
                                    </button>
                                    
                                    {/* Requested feature */}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (window.confirm(`Delete "${block.title}"?`)) {
                                          onDeleteTimeBlock(block.id);
                                        }
                                      }}
                                      className="text-xs text-red-400 hover:text-red-600 hover:scale-110 transition-all"
                                      title="Delete this time block"
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}

                          {/* Current time line (only for today) */}
                          {isToday && (
                            <div
                              className="pointer-events-none absolute left-0 right-0 z-20 h-0.5 bg-cyan-500"
                              style={{ top: `${getPositionFromTime(new Date())}px` }}
                            >
                              <div className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-cyan-500"></div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Month View */}
        {viewMode === 'month' && (
          <div className="bg-white p-4">
            <div className="grid grid-cols-7 border-x border-t border-slate-200 bg-slate-50">
              {/* Day headers */}
              {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map((day, index) => (
                <div key={day} className={`border-r border-slate-200 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 ${index >= 5 ? 'bg-slate-100' : ''}`}>
                  {day}
                </div>
              ))}
            </div>
            <div data-testid="planner-month-grid" className="grid grid-cols-7 overflow-hidden rounded-b-[10px] border-l border-t border-slate-200">
              {/* Calendar grid */}
              {(() => {
                const firstDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
                const startDay = new Date(firstDay);
                const mondayOffset = firstDay.getDay() === 0 ? -6 : 1 - firstDay.getDay();
                startDay.setDate(startDay.getDate() + mondayOffset);
                
                const cells = [];
                const currentDate = new Date(startDay);
                
                // Generate 6 weeks (42 days) to ensure full calendar grid
                for (let i = 0; i < 42; i++) {
                  const cellDate = new Date(currentDate);
                  const isCurrentMonth = cellDate.getMonth() === selectedDate.getMonth();
                  const isToday = cellDate.toDateString() === new Date().toDateString();
                  
                  const dayBlocks = filteredBlocks.filter(block => {
                    const blockDate = toDateSafe(block.startTime, cellDate);
                    return formatDateStringSafe(blockDate) === formatDateStringSafe(cellDate);
                  });
                  
                  cells.push(
                    <button
                      type="button"
                      key={i}
                      className={`min-h-[112px] border-b border-r border-slate-200 p-2 text-left align-top transition-colors xl:min-h-[126px] ${
                        !isCurrentMonth
                          ? 'bg-slate-50/80 text-slate-400 hover:bg-slate-100'
                          : isToday
                            ? 'bg-indigo-50/80 hover:bg-indigo-50'
                            : 'bg-white hover:bg-slate-50'
                      }`}
                      onClick={() => {
                        onDateChange(cellDate);
                        setViewMode('day');
                      }}
                    >
                      <span className={`mb-2 grid h-7 w-7 place-items-center rounded-full text-sm font-semibold ${
                        isToday ? 'bg-indigo-600 text-white' : isCurrentMonth ? 'text-slate-900' : 'text-slate-400'
                      }`}>{cellDate.getDate()}</span>
                      
                      <div className="space-y-0.5">
                        {dayBlocks.slice(0, 3).map((block, idx) => (
                          <div
                            key={idx}
                            className="truncate rounded px-1.5 py-1 text-xs font-medium text-white"
                            style={{ backgroundColor: block.color || getDefaultColorForType(block.type) }}
                            title={block.title}
                          >
                            {getBlockIcon(block)} {block.title}
                          </div>
                        ))}
                        {dayBlocks.length > 3 && (
                          <div className="pt-0.5 text-center text-xs font-medium text-slate-500">
                            +{dayBlocks.length - 3} altri
                          </div>
                        )}
                      </div>
                    </button>
                  );
                  
                  currentDate.setDate(currentDate.getDate() + 1);
                }
                
                return cells;
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Create Block Modal - Using Portal like OKRManager */}
      {showCreateModal && typeof window !== 'undefined' && createPortal(
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
                <h3 className="text-xl font-bold text-gray-900">⏰ Create Time Block</h3>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                  type="button"
                >
                  ×
                </button>
              </div>
            
              <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2 flex items-center">
                  🎯 Title
                </label>
                <input
                  type="text"
                  value={newBlockData.title || ''}
                  onChange={(e) => setNewBlockData({ ...newBlockData, title: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 text-gray-900 bg-white"
                  style={{ color: '#111827', backgroundColor: '#ffffff' }}
                  placeholder="What are you working on? 🚀"
                />
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2 flex items-center">
                  🏷️ Type
                </label>
                <select
                  value={newBlockData.type || 'work'}
                  onChange={(e) => setNewBlockData({ ...newBlockData, type: e.target.value as any })}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 text-gray-900 bg-white"
                  style={{ color: '#111827', backgroundColor: '#ffffff' }}
                >
                  <option value="work">💼 Work - Blue Power</option>
                  <option value="focus">🎯 Deep Focus - Purple Excellence</option>
                  <option value="meeting">🤝 Meeting - Golden Hour</option>
                  <option value="break">☕ Break - Emerald Zen</option>
                  <option value="admin">⚙️ Admin - Steel Gray</option>
                </select>
              </div>

              {/* 🔥 NEW FEATURE: Weekly Repeat Option */}
              {viewMode === 'week' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-3 flex items-center">
                    📅 Repeat Options
                  </label>
                  <div className="space-y-3">
                    <label className="flex items-center space-x-3 p-3 border-2 border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-all duration-200">
                      <input
                        type="checkbox"
                        checked={newBlockData.repeatWeekly || false}
                        onChange={(e) => setNewBlockData({ ...newBlockData, repeatWeekly: e.target.checked })}
                        className="w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">📄 Repeat across entire week</div>
                        <div className="text-sm text-gray-600">Create this time block for all 7 days (Mon-Sun)</div>
                      </div>
                    </label>

                    {newBlockData.repeatWeekly && (
                      <div className="ml-8 space-y-3">
                        <div className="text-sm font-medium text-gray-700">Select days to include:</div>
                        
                        {/* Quick presets */}
                        <div className="flex flex-wrap gap-2 mb-3">
                          <button
                            type="button"
                            onClick={() => setNewBlockData({ ...newBlockData, selectedDays: [true, true, true, true, true, true, true] })}
                            className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded-full hover:bg-blue-200 transition-colors"
                          >
                            📅 All week
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewBlockData({ ...newBlockData, selectedDays: [true, true, true, true, true, false, false] })}
                            className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded-full hover:bg-green-200 transition-colors"
                          >
                            💼 Weekdays only
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewBlockData({ ...newBlockData, selectedDays: [false, false, false, false, false, true, true] })}
                            className="px-3 py-1 text-xs bg-orange-100 text-orange-700 rounded-full hover:bg-orange-200 transition-colors"
                          >
                            🏠 Weekends only
                          </button>
                        </div>
                        
                        <div className="grid grid-cols-7 gap-2">
                          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => (
                            <label key={day} className="flex flex-col items-center space-y-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={(newBlockData.selectedDays || [true, true, true, true, true, true, true])[index]}
                                onChange={(e) => {
                                  const currentDays = newBlockData.selectedDays || [true, true, true, true, true, true, true];
                                  const newDays = [...currentDays];
                                  newDays[index] = e.target.checked;
                                  setNewBlockData({ ...newBlockData, selectedDays: newDays });
                                }}
                                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-1"
                              />
                              <span className="text-xs font-medium text-gray-600">{day}</span>
                            </label>
                          ))}
                        </div>
                        
                        {/* Preview message */}
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                          <div className="text-sm text-blue-800">
                            <strong>📅 Will create:</strong> {(newBlockData.selectedDays || [true, true, true, true, true, true, true]).filter(Boolean).length} time blocks 
                            ({newBlockData.startTime && newBlockData.endTime ? 
                              String(newBlockData.startTime.getHours()).padStart(2, '0') + ':' + String(newBlockData.startTime.getMinutes()).padStart(2, '0') + ' to ' + String(newBlockData.endTime.getHours()).padStart(2, '0') + ':' + String(newBlockData.endTime.getMinutes()).padStart(2, '0')
                              : 'time not set'} for selected days)
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
                
                {/* Custom Color Picker */}
                <div className="mt-3">
                  <label className="block text-sm font-semibold text-gray-800 mb-2 flex items-center">
                    🎨 Custom Color (Optional)
                  </label>
                  <div className="flex items-center space-x-3">
                    <input
                      type="color"
                      value={newBlockData.color || getDefaultColorForType(newBlockData.type || 'work')}
                      onChange={(e) => setNewBlockData({ ...newBlockData, color: e.target.value })}
                      className="w-16 h-12 rounded-lg border-2 border-gray-300 cursor-pointer"
                      title="Choose custom color"
                    />
                    <div className="flex-1">
                      <div className="text-xs text-gray-600 mb-1">Selected: {newBlockData.color || getDefaultColorForType(newBlockData.type || 'work')}</div>
                      <button
                        type="button"
                        onClick={() => setNewBlockData({ ...newBlockData, color: undefined })}
                        className="text-xs text-blue-600 hover:text-blue-800 underline"
                      >
                        🗑️ Reset to type default
                      </button>
                    </div>
                  </div>
                </div>
                
                {/* Color Preview */}
                <div className="mt-3">
                  <div 
                    className={`h-12 rounded-lg flex items-center justify-center text-sm font-bold text-white border-2 transition-all duration-200 ${!newBlockData.color ? getBlockColor({ type: newBlockData.type || 'work' } as TimeBlock) : ''}`}
                    style={newBlockData.color ? {
                      backgroundColor: newBlockData.color,
                      borderColor: newBlockData.color + '80' // Add transparency to border
                    } : {}}
                  >
                    {getBlockIcon({ type: newBlockData.type || 'work' } as TimeBlock)} 
                    {newBlockData.color ? 'Custom Color Preview' : 'Type Color Preview'}
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2 flex items-center">
                  📝 Description
                </label>
                <textarea
                  value={newBlockData.description || ''}
                  onChange={(e) => setNewBlockData({ ...newBlockData, description: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 text-gray-900 bg-white"
                  style={{ color: '#111827', backgroundColor: '#ffffff' }}
                  rows={3}
                  placeholder="Why are you doing this? What's the purpose? 🤔"
                />
              </div>
              
              {/* GOAL SELECTION - THE MAGIC HAPPENS HERE! */}
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2 flex items-center">
                  🎯 Connect to Goals
                </label>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {goals.filter(g => g.status === 'active').map(goal => (
                    <label key={goal.id} className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded-lg">
                      <input
                        type="checkbox"
                        checked={newBlockData.goalIds?.includes(goal.id) || false}
                        onChange={(e) => {
                          const currentGoals = newBlockData.goalIds || [];
                          if (e.target.checked) {
                            setNewBlockData({
                              ...newBlockData,
                              goalIds: [...currentGoals, goal.id],
                              goalAllocation: {
                                ...newBlockData.goalAllocation,
                                [goal.id]: 100 / (currentGoals.length + 1)
                              }
                            });
                          } else {
                            const filteredGoals = currentGoals.filter(id => id !== goal.id);
                            const newAllocation = { ...newBlockData.goalAllocation };
                            delete newAllocation[goal.id];
                            setNewBlockData({
                              ...newBlockData,
                              goalIds: filteredGoals,
                              goalAllocation: newAllocation
                            });
                          }
                        }}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{goal.title}</div>
                        <div className="text-xs text-gray-500">{goal.description}</div>
                        <div className={`inline-block px-2 py-1 rounded text-xs font-bold ${getPriorityColor(goal.priority)}`}>
                          {goal.priority}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
                
                {/* Goal Allocation Sliders */}
                {newBlockData.goalIds && newBlockData.goalIds.length > 1 && (
                  <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                    <div className="text-sm font-semibold text-gray-800 mb-2">⚖️ Time Allocation %</div>
                    <div className="space-y-2">
                      {newBlockData.goalIds.map(goalId => {
                        const goal = goals.find(g => g.id === goalId);
                        return (
                          <div key={goalId} className="flex items-center space-x-2">
                            <span className="text-xs font-medium text-gray-700 w-20 truncate">
                              {goal?.title}
                            </span>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={newBlockData.goalAllocation?.[goalId] || 0}
                              onChange={(e) => {
                                setNewBlockData({
                                  ...newBlockData,
                                  goalAllocation: {
                                    ...newBlockData.goalAllocation,
                                    [goalId]: Number(e.target.value)
                                  }
                                });
                              }}
                              className="flex-1"
                            />
                            <span className="text-xs font-bold text-gray-800 w-12">
                              {newBlockData.goalAllocation?.[goalId] || 0}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              
              {/* PROJECT SELECTION */}
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2 flex items-center">
                  📁 Connect to Project
                </label>
                <select
                  value={newBlockData.projectId || ''}
                  onChange={(e) => {
                    const project = projects.find(p => p.id === e.target.value);
                    setNewBlockData({
                      ...newBlockData,
                      projectId: e.target.value || undefined,
                      goalId: project?.goalId || newBlockData.goalId
                    });
                  }}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 text-gray-900 bg-white"
                >
                  <option value="">🆕 No project selected</option>
                  {projects.filter(p => p.status === 'active').map(project => (
                    <option key={project.id} value={project.id}>
                      {project.name} ({project.priority})
                    </option>
                  ))}
                </select>
              </div>
              
              {/* TASK SELECTION */}
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2 flex items-center">
                  ✅ Connect to Task
                </label>
                <select
                  value={newBlockData.taskId || ''}
                  onChange={(e) => {
                    const task = tasks.find(t => t.id === e.target.value);
                    setNewBlockData({
                      ...newBlockData,
                      taskId: e.target.value || undefined,
                      projectId: task?.projectId || newBlockData.projectId,
                      goalId: task?.goalId || newBlockData.goalId
                    });
                  }}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 text-gray-900 bg-white"
                >
                  <option value="">🆕 No task selected</option>
                  {tasks
                    .filter(t => !newBlockData.projectId || t.projectId === newBlockData.projectId)
                    .filter(t => t.status !== 'completed' && t.status !== 'cancelled')
                    .map(task => (
                    <option key={task.id} value={task.id}>
                      {task.title} ({task.estimatedMinutes}min, {task.priority})
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2 flex items-center">
                    🕐 Start Time
                  </label>
                  <input
                    type="time"
                    value={
                      newBlockData.startTime 
                        ? String(newBlockData.startTime.getHours()).padStart(2, '0') + ':' + String(newBlockData.startTime.getMinutes()).padStart(2, '0')
                        : ''
                    }
                    onChange={(e) => {
                      const [hours, minutes] = e.target.value.split(':');
                      // Use the correct base date from existing startTime or selectedDate
                      const baseDate = newBlockData.startTime instanceof Date 
                        ? new Date(newBlockData.startTime.getFullYear(), newBlockData.startTime.getMonth(), newBlockData.startTime.getDate())
                        : new Date(selectedDate);
                      baseDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                      setNewBlockData({ ...newBlockData, startTime: baseDate });
                    }}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 text-gray-900 bg-white"
                    style={{ color: '#111827', backgroundColor: '#ffffff' }}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2 flex items-center">
                    🕕 End Time
                  </label>
                  <input
                    type="time"
                    value={
                      newBlockData.endTime 
                        ? String(newBlockData.endTime.getHours()).padStart(2, '0') + ':' + String(newBlockData.endTime.getMinutes()).padStart(2, '0')
                        : ''
                    }
                    onChange={(e) => {
                      const [hours, minutes] = e.target.value.split(':');
                      // Use the correct base date from existing startTime or selectedDate
                      const baseDate = newBlockData.startTime instanceof Date 
                        ? new Date(newBlockData.startTime.getFullYear(), newBlockData.startTime.getMonth(), newBlockData.startTime.getDate())
                        : new Date(selectedDate);
                      baseDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                      setNewBlockData({ ...newBlockData, endTime: baseDate });
                    }}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 text-gray-900 bg-white"
                    style={{ color: '#111827', backgroundColor: '#ffffff' }}
                  />
                </div>
              </div>
            
              <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="px-6 py-3 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-all duration-200 font-medium"
                  type="button"
                >
                  ❌ Cancel
                </button>
                <button
                  onClick={handleCreateBlock}
                  className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-200 font-medium shadow-lg transform hover:scale-105"
                  type="button"
                >
                  Create Block
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ============================================================================
// SUMMARY CHIP — small inline metric used in the day-summary strip.
// ============================================================================

interface SummaryChipProps {
  label: string;
  value: string;
  tone: 'neutral' | 'blue' | 'emerald';
  highlight?: boolean;
}

function SummaryChip({ label, value, tone, highlight = false }: SummaryChipProps) {
  const cls =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'blue'
        ? 'border-blue-200 bg-blue-50 text-blue-700'
        : 'border-gray-200 bg-gray-50 text-gray-700';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium ${cls}`}
      data-testid={`planner-summary-${label.toLowerCase()}`}
    >
      <span className="opacity-70 text-[10px] uppercase tracking-wider">{label}</span>
      <span className={highlight ? 'font-bold tabular-nums' : 'tabular-nums'}>{value}</span>
    </span>
  );
}
