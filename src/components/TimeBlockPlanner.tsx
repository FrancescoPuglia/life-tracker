'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TimeBlock, Task, Project, Goal } from '@/types';

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
  onDateChange
}: TimeBlockPlannerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; time: Date } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ startTime: Date; endTime: Date } | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<TimeBlock | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBlockData, setNewBlockData] = useState<Partial<TimeBlock>>({});
  const plannerRef = useRef<HTMLDivElement>(null);

  const HOUR_HEIGHT = 80;
  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  const formatTime = (hour: number) => {
    return `${hour.toString().padStart(2, '0')}:00`;
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
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
      const newBlock: Partial<TimeBlock> = {
        startTime: startTime < endTime ? startTime : endTime,
        endTime: startTime < endTime ? endTime : startTime,
        title: 'New Time Block',
        status: 'planned',
        type: 'work',
        userId: 'user-1', // This should come from auth context
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

    const newBlock: Partial<TimeBlock> = {
      startTime,
      endTime,
      title: 'New Time Block',
      status: 'planned',
      type: 'work',
      userId: 'user-1',
      domainId: 'domain-1',
    };
    
    console.log('🔥 PSYCHOPATH: NewBlockData set to:', newBlock);
    setNewBlockData(newBlock);
    setShowCreateModal(true);
  };

  const handleCreateBlock = () => {
    if (newBlockData.startTime && newBlockData.endTime) {
      const blockToCreate = {
        ...newBlockData,
        id: `block-${Date.now()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      onCreateTimeBlock(blockToCreate);
      setShowCreateModal(false);
      setNewBlockData({});
    }
  };

  const getBlockColor = (block: TimeBlock) => {
    const baseClasses = 'text-white font-bold rounded-xl hover:shadow-2xl transform hover:scale-105 transition-all duration-300 border-2';
    
    switch (block.type) {
      case 'work': 
        return `${baseClasses} time-block-work text-white`;
      case 'break': 
        return `${baseClasses} time-block-break text-white`;
      case 'focus': 
        return `${baseClasses} time-block-focus text-white animate-pulse-slow`;
      case 'meeting': 
        return `${baseClasses} time-block-meeting text-gray-900 font-black`;
      case 'admin': 
        return `${baseClasses} time-block-admin text-white`;
      default: 
        return `${baseClasses} time-block-work text-white`;
    }
  };

  const getBlockIcon = (block: TimeBlock) => {
    switch (block.type) {
      case 'work': return '💼';
      case 'break': return '☕';
      case 'focus': return '🎯';
      case 'meeting': return '🤝';
      case 'admin': return '⚙️';
      default: return '📋';
    }
  };

  const getStatusIndicator = (block: TimeBlock) => {
    const now = new Date();
    const isOverdue = block.status === 'planned' && now > block.endTime;
    const isActive = block.status === 'in_progress';
    const isCompleted = block.status === 'completed';
    
    if (isCompleted) return '✅';
    if (isActive) return '🔴';
    if (isOverdue) return '⚠️';
    return '⏰';
  };

  // 🔍 PSYCHOPATH DEBUG: Analisi completa di ogni time block ricevuto
  console.log('🔥 PSYCHOPATH ANALYSIS - TimeBlocks received:', {
    count: timeBlocks.length,
    selectedDate: selectedDate.toDateString(),
    blocks: timeBlocks.map((block, index) => ({
      index,
      id: block.id,
      title: block.title,
      startTime: block.startTime,
      startTimeType: typeof block.startTime,
      startTimeIsDate: block.startTime instanceof Date,
      startTimeStr: block.startTime?.toString?.(),
      endTime: block.endTime,
      endTimeType: typeof block.endTime,
      canGetHours: typeof block.startTime?.getHours === 'function'
    }))
  });

  const filteredBlocks = timeBlocks.filter((block, index) => {
    try {
      const blockDate = new Date(block.startTime);
      const isMatch = blockDate.toDateString() === selectedDate.toDateString();
      
      console.log(`🎯 Filter block ${index}:`, {
        id: block.id,
        title: block.title,
        startTime: block.startTime,
        blockDateStr: blockDate.toDateString(),
        selectedDateStr: selectedDate.toDateString(),
        isMatch: isMatch
      });
      
      return isMatch;
    } catch (error) {
      console.error(`❌ Filter ERROR for block ${index}:`, error, block);
      return false;
    }
  });
  
  console.log('📊 FILTER RESULTS:', {
    totalBlocks: timeBlocks.length,
    filteredCount: filteredBlocks.length,
    filteredBlocks: filteredBlocks.map(b => ({ id: b.id, title: b.title }))
  });

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
    <div className="glass-card border border-gray-200 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-blue-50">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center">
            📅 Time Planner
          </h2>
          <p className="text-sm text-gray-600 font-medium">{formatDate(selectedDate)}</p>
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={() => handleQuickCreateBlock(new Date().getHours())}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Add Block
          </button>
          <div className="border-l border-gray-300 h-6"></div>
          <button
            onClick={() => onDateChange(new Date(selectedDate.getTime() - 24 * 60 * 60 * 1000))}
            className="p-2 text-gray-400 hover:text-gray-600"
          >
            ←
          </button>
          <button
            onClick={() => onDateChange(new Date())}
            className="px-3 py-1 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
          >
            Today
          </button>
          <button
            onClick={() => onDateChange(new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000))}
            className="p-2 text-gray-400 hover:text-gray-600"
          >
            →
          </button>
        </div>
      </div>

      {/* Time Grid */}
      <div className="relative">
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
                className="absolute right-4 top-1 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-500 text-white w-6 h-6 rounded-full text-xs flex items-center justify-center hover:bg-blue-600"
                title={`Add block at ${formatTime(hour)}`}
              >
                +
              </button>
            </div>
          ))}

          {/* Time Blocks */}
          {filteredBlocks.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-6 py-4 rounded-lg text-sm max-w-lg">
                <div className="font-bold mb-2">🔍 PSYCHOPATH DEBUG:</div>
                <div>Total blocks: {timeBlocks.length}</div>
                <div>Filtered blocks: {filteredBlocks.length}</div>
                <div>Selected date: {selectedDate.toDateString()}</div>
                
                {/* 🔥 SHOW ACTUAL TIME BLOCKS DATA */}
                <div className="mt-3 text-xs">
                  <div className="font-bold">Raw Time Blocks:</div>
                  {timeBlocks.slice(0, 3).map((block, i) => (
                    <div key={i} className="border-t pt-1 mt-1">
                      <div>Block {i}: {block.title}</div>
                      <div>StartTime: {block.startTime?.toString()}</div>
                      <div>Type: {typeof block.startTime}</div>
                      <div>Date: {block.startTime instanceof Date ? new Date(block.startTime).toDateString() : 'NOT A DATE'}</div>
                      <div>Match: {block.startTime instanceof Date && new Date(block.startTime).toDateString() === selectedDate.toDateString() ? '✅ YES' : '❌ NO'}</div>
                    </div>
                  ))}
                  {timeBlocks.length > 3 && <div>... and {timeBlocks.length - 3} more</div>}
                </div>
              </div>
            </div>
          )}
          
          {/* 🧪 TEST: Force render a test block to see if rendering works */}
          <div
            className="absolute left-16 right-4 rounded-xl p-3 cursor-pointer bg-gradient-to-r from-red-500 to-red-600 text-white z-20 border-4 border-yellow-300"
            style={{
              top: `${10 * 80}px`, // Hour 10
              height: `${80}px`,    // 1 hour
              minHeight: '60px'
            }}
          >
            <div className="flex items-start justify-between h-full">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate mb-1 drop-shadow-sm">
                  🧪 TEST BLOCK - If you see this, rendering works!
                </div>
                <div className="text-xs opacity-90 truncate mb-1 drop-shadow-sm">
                  Total timeBlocks: {timeBlocks.length} | Filtered: {filteredBlocks.length}
                </div>
              </div>
            </div>
          </div>
          {filteredBlocks.map((block, renderIndex) => {
            console.log(`🎨 RENDERING block ${renderIndex}:`, {
              id: block.id,
              title: block.title,
              startTime: block.startTime,
              position: getPositionFromTime(block.startTime),
              height: getDurationHeight(block.startTime, block.endTime)
            });
            
            return (
            <div
              key={block.id}
              className={`absolute left-16 right-4 rounded-xl p-3 cursor-pointer ${getBlockColor(block)} z-10`}
              style={{
                top: `${getPositionFromTime(block.startTime)}px`,
                height: `${getDurationHeight(block.startTime, block.endTime)}px`,
                minHeight: '60px'
              }}
              onClick={() => setSelectedBlock(block)}
            >
              <div className="flex items-start justify-between h-full">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate mb-1 drop-shadow-sm">
                    {getBlockIcon(block)} {block.title}
                  </div>
                  {block.description && (
                    <div className="text-xs opacity-90 truncate mb-1 drop-shadow-sm">
                      {block.description}
                    </div>
                  )}
                  <div className="text-xs opacity-80 font-mono drop-shadow-sm">
                    ⏰ {block.startTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })} - 
                    {block.endTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className="text-lg drop-shadow-sm">{getStatusIndicator(block)}</div>
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
                  {dragPreview.startTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })} - 
                  {dragPreview.endTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}
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
                
                {/* Color Preview */}
                <div className="mt-3">
                  <div className={`h-8 rounded-lg flex items-center justify-center text-sm font-bold ${getBlockColor({ type: newBlockData.type || 'work' } as TimeBlock)}`}>
                    {getBlockIcon({ type: newBlockData.type || 'work' } as TimeBlock)} Preview Color
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
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2 flex items-center">
                    🕐 Start Time
                  </label>
                  <input
                    type="time"
                    value={
                      newBlockData.startTime 
                        ? `${String(newBlockData.startTime.getHours()).padStart(2, '0')}:${String(newBlockData.startTime.getMinutes()).padStart(2, '0')}`
                        : ''
                    }
                    onChange={(e) => {
                      const [hours, minutes] = e.target.value.split(':');
                      const time = new Date(selectedDate);
                      time.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                      setNewBlockData({ ...newBlockData, startTime: time });
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
                        ? `${String(newBlockData.endTime.getHours()).padStart(2, '0')}:${String(newBlockData.endTime.getMinutes()).padStart(2, '0')}`
                        : ''
                    }
                    onChange={(e) => {
                      const [hours, minutes] = e.target.value.split(':');
                      const time = new Date(selectedDate);
                      time.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                      setNewBlockData({ ...newBlockData, endTime: time });
                    }}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 text-gray-900 bg-white"
                    style={{ color: '#111827', backgroundColor: '#ffffff' }}
                  />
                </div>
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
                  ✨ Create Block
                </button>
              </div>
            </div>
          </div>
        </div>
        , document.body
      )}
    </div>
  );
}