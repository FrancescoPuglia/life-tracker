'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { TimeBlock, Task, Project, Goal } from '@/types';
import { toDateSafe, formatDateSafe, formatTimeSafe, formatDateStringSafe } from '@/utils/dateUtils';

type ViewMode = 'day' | 'week' | 'month';

// Temporary type for modal UI state
interface TimeBlockModalData extends Partial<TimeBlock> {
  repeatWeekly?: boolean;
  selectedDays?: boolean[];
}

interface TimeBlockPlannerProps {
  timeBlocks: TimeBlock[];
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
}

export default function TimeBlockPlanner({ 
  timeBlocks,
  tasks,
  projects,
  goals,
  onCreateTimeBlock,
  onUpdateTimeBlock,
  onDeleteTimeBlock,
  selectedDate,
  onDateChange,
  currentUserId, // 🔥 CRITICAL FIX
  isReady = false
}: TimeBlockPlannerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; time: Date } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ startTime: Date; endTime: Date } | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<TimeBlock | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBlockData, setNewBlockData] = useState<TimeBlockModalData>({});
  const plannerRef = useRef<HTMLDivElement>(null);

  const HOUR_HEIGHT = 80;
  const HOURS = Array.from({ length: 24 }, (_, i) => i);

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
        return `${start.getDate()} ${start.toLocaleDateString('en-US', { month: 'short' })} - ${end.getDate()} ${end.toLocaleDateString('en-US', { month: 'short' })} ${end.getFullYear()}`;
      }
      case 'month':
        return selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
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
    }, 'Invalid Date');
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

    console.log('🔥 PSYCHOPATH: QuickCreateBlock called with:', {
      hour,
      selectedDate: selectedDate.toDateString(),
      currentHour: new Date().getHours()
    });
    
    const startTime = new Date(selectedDate);
    startTime.setHours(hour, 0, 0, 0);
    
    const endTime = new Date(selectedDate);
    endTime.setHours(hour + 1, 0, 0, 0);

    console.log('🔥 PSYCHOPATH: Created times:', {
      startTime: startTime.toString(),
      startTimeDate: startTime.toDateString(),
      endTime: endTime.toString(),
      endTimeDate: endTime.toDateString()
    });

    const newBlock: TimeBlockModalData = {
      startTime,
      endTime,
      title: 'New Time Block',
      status: 'planned',
      type: 'work',
      userId: currentUserId,
      domainId: 'domain-1',
    };
    
    console.log('🔥 PSYCHOPATH: NewBlockData set to:', newBlock);
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
    const baseClasses = 'font-bold rounded-xl hover:shadow-2xl transform hover:scale-105 transition-all duration-300 border-2';
    
    // Use custom color if available, otherwise use default type color
    if (block.color) {
      return `${baseClasses} text-white border-opacity-60`;
    }
    
    switch (block.type) {
      case 'work': 
        return `${baseClasses} bg-blue-600 text-white border-blue-400`;
      case 'break': 
        return `${baseClasses} bg-green-600 text-white border-green-400`;
      case 'focus': 
        return `${baseClasses} bg-purple-600 text-white border-purple-400 animate-pulse-slow`;
      case 'deep':
        return `${baseClasses} bg-indigo-700 text-white border-indigo-500 shadow-lg`;
      case 'shallow':
        return `${baseClasses} bg-cyan-600 text-white border-cyan-400`;
      case 'meeting': 
        return `${baseClasses} bg-orange-600 text-white border-orange-400`;
      case 'admin': 
        return `${baseClasses} bg-gray-600 text-white border-gray-400`;
      case 'buffer':
        return `${baseClasses} bg-yellow-600 text-white border-yellow-400`;
      case 'travel':
        return `${baseClasses} bg-teal-600 text-white border-teal-400`;
      default: 
        return `${baseClasses} bg-blue-600 text-white border-blue-400`;
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


  // 🔧 SHERLOCK MEMOIZATION FIX: Prevent infinite re-rendering
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

  return (
    <div className="glass-card border border-gray-200 shadow-xl" style={{minHeight: '600px', contain: 'layout style'}}>
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-blue-50">
        <div>
          <div className="flex items-center gap-4 mb-2">
            <h2 className="text-xl font-bold text-gray-900 flex items-center">
              📅 Time Planner
            </h2>
            
            {/* View Mode Switcher - Supreme Implementation */}
            <div className="flex items-center bg-white rounded-lg border border-gray-200 overflow-hidden">
              {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors capitalize ${
                    viewMode === mode
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <p className="text-sm text-gray-600 font-medium">{getViewTitle()}</p>
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={() => handleQuickCreateBlock(new Date().getHours())}
            disabled={!isReady}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              isReady 
                ? 'bg-blue-600 text-white hover:bg-blue-700' 
                : 'bg-gray-400 text-gray-200 cursor-not-allowed'
            }`}
          >
            + Add Block
          </button>
          <div className="border-l border-gray-300 h-6"></div>
          <button
            onClick={() => navigateDate('prev')}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
            title={`Previous ${viewMode}`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDateChange(new Date())}
            className="px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 font-medium"
          >
            Today
          </button>
          <button
            onClick={() => navigateDate('next')}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
            title={`Next ${viewMode}`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Time Grid - Conditional View Rendering */}
      <div className="relative">
        {viewMode === 'day' && (
        <div 
          ref={plannerRef}
          className="relative h-96 overflow-y-auto bg-white"
          style={{ height: `${24 * HOUR_HEIGHT}px` }}
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
              className="absolute left-0 right-0 border-t border-gray-100 group hover:bg-blue-50 transition-colors"
              style={{ top: `${hour * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
            >
              <div className="absolute left-2 top-1 text-xs text-gray-500 font-mono">
                {formatTime(hour)}
              </div>
              <button
                onClick={() => handleQuickCreateBlock(hour)}
                disabled={!isReady}
                className={`absolute right-4 top-1 transition-opacity w-6 h-6 rounded-full text-xs flex items-center justify-center ${
                  isReady
                    ? 'opacity-0 group-hover:opacity-100 bg-blue-500 text-white hover:bg-blue-600'
                    : 'opacity-50 bg-gray-400 text-gray-200 cursor-not-allowed'
                }`}
                title={isReady ? `Add block at ${formatTime(hour)}` : 'Please log in first'}
              >
                +
              </button>
            </div>
          ))}

          {/* Time Blocks */}
          {filteredBlocks.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="card card-body text-center max-w-md pointer-events-auto">
                <div className="text-4xl mb-4">📅</div>
                <h3 className="heading-3 mb-3">
                  No blocks for {selectedDate.toLocaleDateString('en-US', { weekday: 'long' })}
                </h3>
                <p className="text-body mb-4">
                  Click "Add Block" or drag on the timeline to create your first time block.
                </p>
                <button
                  onClick={() => handleQuickCreateBlock(new Date().getHours())}
                  disabled={!isReady}
                  className={`px-6 py-3 ${
                    isReady 
                      ? 'btn btn-primary' 
                      : 'bg-gray-400 text-gray-200 cursor-not-allowed px-6 py-3 rounded-lg'
                  }`}
                >
                  Add Block
                </button>
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
              className={`absolute left-16 right-4 ${block.color ? 'font-bold rounded-xl hover:shadow-2xl transform hover:scale-105 transition-all duration-300 border-2 text-white' : getBlockColor(block)} border-2 border-white rounded-xl shadow-lg cursor-pointer hover:shadow-xl transition-all duration-200 z-10`}
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
              <div className="flex items-start justify-between h-full p-3">
                <div className="flex-1 min-w-0">
                  <div className="text-lg font-bold truncate mb-2 drop-shadow-sm">
                    {getBlockIcon(block)} {block.title}
                  </div>
                  {/* 🔥 PSYCHOPATH FIX: Description più piccola e meno prominente */}
                  {block.description && (
                    <div className="text-xs opacity-75 truncate mb-1 drop-shadow-sm italic">
                      {block.description}
                    </div>
                  )}
                  {/* Time display più compatto */}
                  <div className="text-xs opacity-70 font-mono drop-shadow-sm">
                    {formatTimeSafe(startTime, { hour12: false, hour: '2-digit', minute: '2-digit' }, '--:--', selectedDate)} - 
                    {formatTimeSafe(endTime, { hour12: false, hour: '2-digit', minute: '2-digit' }, '--:--', selectedDate)}
                  </div>
                </div>
                <div className="flex flex-col space-y-2">
                  {/* TOGGLE COMPLETED: Always visible */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const newStatus = block.status === 'completed' ? 'planned' : 'completed';
                      onUpdateTimeBlock(block.id, { 
                        status: newStatus,
                        ...(newStatus === 'completed' && !block.actualStartTime ? {
                          actualStartTime: block.startTime,
                          actualEndTime: block.endTime
                        } : {})
                      });
                    }}
                    className={`text-lg transition-all duration-200 hover:scale-110 ${
                      block.status === 'completed' 
                        ? 'text-green-400 hover:text-green-300' 
                        : 'text-gray-300 hover:text-green-400'
                    }`}
                    title={block.status === 'completed' ? 'Mark as planned' : 'Mark as completed'}
                  >
                    {block.status === 'completed' ? '✅' : '⭕'}
                  </button>
                  
                  {/* Status indicator */}
                  <div 
                    className="text-sm drop-shadow-sm cursor-help opacity-75" 
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
              className="absolute left-16 right-4 bg-gradient-to-r from-blue-400 to-indigo-500 border-2 border-blue-300 border-dashed rounded-xl opacity-70 z-20 flex items-center justify-center shadow-lg"
              style={{
                top: `${getPositionFromTime(dragPreview.startTime)}px`,
                height: `${getDurationHeight(dragPreview.startTime, dragPreview.endTime)}px`,
                minHeight: '60px'
              }}
            >
              <div className="text-white text-center">
                <div className="text-sm font-bold">✨ New Block</div>
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
              className="absolute left-0 right-0 h-0.5 bg-red-500 z-10"
              style={{ top: `${getPositionFromTime(new Date())}px` }}
            >
              <div className="absolute -left-2 -top-1 w-4 h-4 bg-red-500 rounded-full"></div>
            </div>
          )}
        </div>
        )}

        {/* Week View - Google Calendar Style */}
        {viewMode === 'week' && (
          <div className="bg-white" style={{minHeight: '500px', contain: 'layout'}}>
            <div className="flex">
              {/* Time Column */}
              <div className="w-16 flex-shrink-0 border-r border-gray-200">
                {/* Empty header space */}
                <div className="h-12 border-b border-gray-200"></div>
                {/* Hour slots */}
                {HOURS.map(hour => (
                  <div
                    key={hour}
                    className="border-b border-gray-100 text-xs text-gray-500 text-right pr-2 flex items-start justify-end"
                    style={{ height: `${HOUR_HEIGHT}px` }}
                  >
                    <span className="mt-1">{formatTime(hour)}</span>
                  </div>
                ))}
              </div>

              {/* Days Grid */}
              <div className="flex-1 overflow-x-auto">
                <div className="grid grid-cols-7 min-w-full" style={{minHeight: '480px', contain: 'layout'}}>
                  {getViewPeriodDates(selectedDate, 'week').map((date, dayIndex) => {
                    const dayBlocks = filteredBlocks.filter(block => {
                      // 🔧 SHERLOCK FIX: Use block's actual creation date as reference, not the current view date
                      // This prevents time blocks from "jumping" when navigating between weeks
                      const blockCreationDate = block.startTime instanceof Date 
                        ? new Date(block.startTime.getFullYear(), block.startTime.getMonth(), block.startTime.getDate())
                        : date; // fallback to current date if not a proper Date object
                      const blockDate = toDateSafe(block.startTime, blockCreationDate);
                      return formatDateStringSafe(blockDate) === formatDateStringSafe(date);
                    });

                    const isToday = date.toDateString() === new Date().toDateString();
                    
                    return (
                      <div key={dayIndex} className="border-r border-gray-200 relative">
                        {/* Day Header */}
                        <div className={`h-12 border-b border-gray-200 flex flex-col items-center justify-center text-center ${isToday ? 'bg-blue-50' : 'bg-gray-50'}`}>
                          <div className="text-xs text-gray-600 font-medium">
                            {date.toLocaleDateString('en-US', { weekday: 'short' })}
                          </div>
                          <div className={`text-sm font-bold ${isToday ? 'text-blue-600' : 'text-gray-900'}`}>
                            {date.getDate()}
                          </div>
                        </div>

                        {/* Hour Grid for this day */}
                        <div className="relative" style={{ height: `${24 * HOUR_HEIGHT}px` }}>
                          {/* Hour grid lines */}
                          {HOURS.map(hour => (
                            <div
                              key={hour}
                              className="absolute left-0 right-0 border-b border-gray-100 hover:bg-blue-50 transition-colors group cursor-pointer"
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
                                    ? 'opacity-0 group-hover:opacity-100 bg-blue-500 text-white hover:bg-blue-600'
                                    : 'opacity-50 bg-gray-400 text-gray-200 cursor-not-allowed'
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
                            // 🔧 SHERLOCK EMERGENCY FIX: Use consistent date reference like Day View
                            const startTime = toDateSafe(block.startTime, date);
                            const endTime = toDateSafe(block.endTime, date);
                            
                            // 🛠️ SHERLOCK DATA REPAIR: Fix corrupted multi-day time blocks (STABLE MODE)
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
                            
                            // 🛡️ SHERLOCK PROTECTION: Prevent excessive block heights (max 8 hours)
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
                                className={`absolute left-1 right-1 ${block.color ? 'font-bold rounded-lg hover:shadow-lg transform hover:scale-105 transition-all duration-200 border text-white' : getBlockColor(block)} rounded-lg shadow-sm cursor-pointer hover:shadow-md transition-all duration-200 z-10 border`}
                                style={{
                                  top: `${getPositionFromTime(startTime)}px`,
                                  height: `${finalHeight}px`, // 🔧 SHERLOCK FIX: Use calculated safe height
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
                                    <div className="text-xs font-bold truncate mb-1 drop-shadow-sm">
                                      {getBlockIcon(block)} {block.title}
                                      {duration > maxReasonableDuration && <span className="ml-1 text-blue-300" title="Multi-day block auto-repaired">🔧</span>}
                                      {actualDuration > maxDuration && <span className="ml-1 text-orange-300" title="Block duration truncated for display">⚠️</span>}
                                    </div>
                                    <div className="text-xs opacity-75 font-mono drop-shadow-sm">
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
                                        onUpdateTimeBlock(block.id, { 
                                          status: newStatus,
                                          ...(newStatus === 'completed' && !block.actualStartTime ? {
                                            actualStartTime: block.startTime,
                                            actualEndTime: block.endTime
                                          } : {})
                                        });
                                      }}
                                      className="text-xs hover:scale-110 transition-transform"
                                      title={block.status === 'completed' ? 'Mark as planned' : 'Mark as completed'}
                                    >
                                      {block.status === 'completed' ? '✅' : '⭕'}
                                    </button>
                                    
                                    {/* 🗑️ SHERLOCK DELETE BUTTON - Requested feature */}
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
                              className="absolute left-0 right-0 h-0.5 bg-red-500 z-20 pointer-events-none"
                              style={{ top: `${getPositionFromTime(new Date())}px` }}
                            >
                              <div className="absolute -left-1 -top-1 w-3 h-3 bg-red-500 rounded-full"></div>
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
            <div className="grid grid-cols-7 gap-2">
              {/* Day headers */}
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                <div key={day} className="text-center text-sm font-medium text-gray-600 py-2">
                  {day}
                </div>
              ))}
              
              {/* Calendar grid */}
              {(() => {
                const firstDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
                const lastDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
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
                    <div
                      key={i}
                      className={`min-h-24 p-1 border border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                        !isCurrentMonth ? 'bg-gray-50 text-gray-400' : isToday ? 'bg-blue-50 border-blue-200' : 'bg-white'
                      }`}
                      onClick={() => {
                        onDateChange(cellDate);
                        setViewMode('day');
                      }}
                    >
                      <div className={`text-sm font-medium mb-1 ${isToday ? 'text-blue-600' : 'text-gray-900'}`}>
                        {cellDate.getDate()}
                      </div>
                      
                      <div className="space-y-0.5">
                        {dayBlocks.slice(0, 3).map((block, idx) => (
                          <div
                            key={idx}
                            className="text-xs p-1 rounded truncate text-white"
                            style={{ backgroundColor: block.color || getDefaultColorForType(block.type) }}
                            title={block.title}
                          >
                            {getBlockIcon(block)} {block.title}
                          </div>
                        ))}
                        {dayBlocks.length > 3 && (
                          <div className="text-xs text-gray-500 text-center">
                            +{dayBlocks.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                  
                  currentDate.setDate(currentDate.getDate() + 1);
                }
                
                return cells;
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Help Section */}
      {filteredBlocks.length === 0 && (
        <div className="p-4 bg-gray-50 border-t border-gray-200">
          <div className="text-center text-gray-500">
            <p className="text-sm mb-2">📅 <strong>Come creare time blocks:</strong></p>
            <div className="text-xs space-y-1">
              <p>• Clicca e trascina sulla griglia per creare un blocco</p>
              <p>• Usa il pulsante "+ Add Block" nell'header</p>
              <p>• Hover su un'ora e clicca il pulsante "+" che appare</p>
            </div>
          </div>
        </div>
      )}

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
                      // 🔧 SHERLOCK FIX: Use the correct base date from existing startTime or selectedDate
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
                      // 🔧 SHERLOCK FIX: Use the correct base date from existing startTime or selectedDate
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