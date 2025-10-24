'use client';

import { useState, useEffect } from 'react';
import { Session, TimeBlock } from '@/types';

interface NowBarProps {
  currentSession?: Session | null;
  currentTimeBlock?: TimeBlock | null;
  onStartSession: (taskId?: string) => void;
  onPauseSession: () => void;
  onStopSession: () => void;
}

export default function NowBar({ 
  currentSession, 
  currentTimeBlock, 
  onStartSession, 
  onPauseSession, 
  onStopSession 
}: NowBarProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [sessionDuration, setSessionDuration] = useState(0);
  const [timeBlockRemaining, setTimeBlockRemaining] = useState(0);
  const [isOverrun, setIsOverrun] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);

      // Update session duration
      if (currentSession && currentSession.status === 'active') {
        const duration = Math.floor((now.getTime() - currentSession.startTime.getTime()) / 1000);
        setSessionDuration(duration);
      }

      // Update time block countdown
      if (currentTimeBlock) {
        const remaining = Math.floor((currentTimeBlock.endTime.getTime() - now.getTime()) / 1000);
        setTimeBlockRemaining(remaining);
        setIsOverrun(remaining < 0);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [currentSession, currentTimeBlock]);

  const formatTime = (seconds: number) => {
    const hours = Math.floor(Math.abs(seconds) / 3600);
    const minutes = Math.floor((Math.abs(seconds) % 3600) / 60);
    const secs = Math.abs(seconds) % 60;
    
    if (hours > 0) {
      return `${seconds < 0 ? '-' : ''}${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${seconds < 0 ? '-' : ''}${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatClock = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getNextBlock = () => {
    // This would typically come from props or context
    return null; // Placeholder
  };

  return (
    <div className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 shadow-sm z-50">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Current Time */}
          <div className="flex items-center space-x-6">
            <div className="text-2xl font-mono font-bold text-gray-900">
              {formatClock(currentTime)}
            </div>
            
            {/* Time Block Info */}
            {currentTimeBlock && (
              <div className="flex items-center space-x-4">
                <div className="text-sm">
                  <div className="font-medium text-gray-900">{currentTimeBlock.title}</div>
                  <div className={`text-xs ${isOverrun ? 'text-red-600' : 'text-gray-500'}`}>
                    {isOverrun ? 'Overrun: ' : 'Remaining: '}
                    {formatTime(timeBlockRemaining)}
                  </div>
                </div>
                
                {/* Progress Bar */}
                <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-300 ${
                      isOverrun ? 'bg-red-500' : 'bg-blue-500'
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(0, 
                        ((currentTimeBlock.endTime.getTime() - currentTime.getTime()) / 
                         (currentTimeBlock.endTime.getTime() - currentTimeBlock.startTime.getTime())) * 100
                      ))}%`
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Current Task & Session Info */}
          <div className="flex items-center space-x-4">
            {currentSession && (
              <div className="text-sm">
                <div className="font-medium text-gray-900">
                  Session: {formatTime(sessionDuration)}
                </div>
                <div className="text-xs text-gray-500">
                  {currentSession.tags.join(', ') || 'No tags'}
                </div>
              </div>
            )}
            
            {/* What / Why / How */}
            <div className="max-w-md">
              <div className="text-sm space-y-1">
                <div>
                  <span className="text-xs font-medium text-gray-500">WHAT:</span>
                  <span className="ml-2 text-gray-900">
                    {currentTimeBlock?.title || 'No active time block'}
                  </span>
                </div>
                <div>
                  <span className="text-xs font-medium text-gray-500">WHY:</span>
                  <span className="ml-2 text-gray-600">
                    {currentTimeBlock?.description || 'Not specified'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Session Controls */}
          <div className="flex items-center space-x-2">
            {!currentSession ? (
              <button
                onClick={() => onStartSession()}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Start Session
              </button>
            ) : currentSession.status === 'active' ? (
              <>
                <button
                  onClick={onPauseSession}
                  className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
                >
                  Pause
                </button>
                <button
                  onClick={onStopSession}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Stop
                </button>
              </>
            ) : (
              <button
                onClick={() => onStartSession()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Resume
              </button>
            )}
          </div>

          {/* Next Up */}
          <div className="text-sm">
            <div className="text-xs font-medium text-gray-500 mb-1">NEXT UP:</div>
            <div className="text-gray-900">
              {getNextBlock()?.title || 'No upcoming blocks'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}