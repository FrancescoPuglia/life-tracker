'use client';

import { useState, useEffect, useRef } from 'react';
import { TimeBlock, Task, Project } from '@/types';

interface TimeBlockPlannerProps {
  timeBlocks: TimeBlock[];
  tasks: Task[];
  projects: Project[];
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
  onCreateTimeBlock,
  onUpdateTimeBlock,
  onDeleteTimeBlock,
  selectedDate,
  onDateChange
}: TimeBlockPlannerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; time: Date } | null>(null);
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
    const time = getTimeFromPosition(e.clientY);
    setDragStart({ x: e.clientX, y: e.clientY, time });
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !dragStart) return;
    
    // Visual feedback for drag selection could be added here
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDragging || !dragStart) return;
    
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
  };

  const handleCreateBlock = () => {
    if (newBlockData.startTime && newBlockData.endTime) {
      onCreateTimeBlock({
        ...newBlockData,
        id: `block-${Date.now()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setShowCreateModal(false);
      setNewBlockData({});
    }
  };

  const getBlockColor = (block: TimeBlock) => {
    switch (block.type) {
      case 'work': return 'bg-blue-100 border-blue-300 text-blue-800';
      case 'break': return 'bg-green-100 border-green-300 text-green-800';
      case 'focus': return 'bg-purple-100 border-purple-300 text-purple-800';
      case 'meeting': return 'bg-yellow-100 border-yellow-300 text-yellow-800';
      case 'admin': return 'bg-gray-100 border-gray-300 text-gray-800';
      default: return 'bg-blue-100 border-blue-300 text-blue-800';
    }
  };

  const getStatusIndicator = (block: TimeBlock) => {
    const now = new Date();
    const isOverdue = block.status === 'planned' && now > block.endTime;
    const isActive = block.status === 'in_progress';
    const isCompleted = block.status === 'completed';
    
    if (isCompleted) return '✓';
    if (isActive) return '▶';
    if (isOverdue) return '⚠';
    return '';
  };

  const filteredBlocks = timeBlocks.filter(block => {
    const blockDate = new Date(block.startTime);
    return blockDate.toDateString() === selectedDate.toDateString();
  });

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Time Planner</h2>
          <p className="text-sm text-gray-600">{formatDate(selectedDate)}</p>
        </div>
        
        <div className="flex items-center space-x-2">
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
          className="relative h-96 overflow-y-auto"
          style={{ height: `${24 * HOUR_HEIGHT}px` }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          {/* Hour Grid */}
          {HOURS.map(hour => (
            <div
              key={hour}
              className="absolute left-0 right-0 border-t border-gray-100"
              style={{ top: `${hour * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
            >
              <div className="absolute left-2 top-1 text-xs text-gray-500 font-mono">
                {formatTime(hour)}
              </div>
            </div>
          ))}

          {/* Time Blocks */}
          {filteredBlocks.map(block => (
            <div
              key={block.id}
              className={`absolute left-16 right-4 border-l-4 rounded-lg p-2 cursor-pointer ${getBlockColor(block)}`}
              style={{
                top: `${getPositionFromTime(block.startTime)}px`,
                height: `${getDurationHeight(block.startTime, block.endTime)}px`,
                minHeight: '40px'
              }}
              onClick={() => setSelectedBlock(block)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{block.title}</div>
                  <div className="text-xs opacity-75 truncate">{block.description}</div>
                  <div className="text-xs opacity-75">
                    {block.startTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })} - 
                    {block.endTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className="text-sm">{getStatusIndicator(block)}</div>
              </div>
            </div>
          ))}

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

      {/* Create Block Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 max-w-full">
            <h3 className="text-lg font-semibold mb-4">Create Time Block</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  type="text"
                  value={newBlockData.title || ''}
                  onChange={(e) => setNewBlockData({ ...newBlockData, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="What are you working on?"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={newBlockData.type || 'work'}
                  onChange={(e) => setNewBlockData({ ...newBlockData, type: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="work">Work</option>
                  <option value="focus">Deep Focus</option>
                  <option value="meeting">Meeting</option>
                  <option value="break">Break</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={newBlockData.description || ''}
                  onChange={(e) => setNewBlockData({ ...newBlockData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={3}
                  placeholder="Why are you doing this?"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={newBlockData.startTime?.toTimeString().slice(0, 5) || ''}
                    onChange={(e) => {
                      const [hours, minutes] = e.target.value.split(':');
                      const time = new Date(selectedDate);
                      time.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                      setNewBlockData({ ...newBlockData, startTime: time });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                  <input
                    type="time"
                    value={newBlockData.endTime?.toTimeString().slice(0, 5) || ''}
                    onChange={(e) => {
                      const [hours, minutes] = e.target.value.split(':');
                      const time = new Date(selectedDate);
                      time.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                      setNewBlockData({ ...newBlockData, endTime: time });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>
            
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBlock}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}