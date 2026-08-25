'use client';

import { useState, useEffect } from 'react';
import { Session, TimeBlock } from '@/types';
import { sessionElapsedSeconds } from '@/lib/sessionTiming';

interface NowBarProps {
  currentSession?: Session | null;
  currentTimeBlock?: TimeBlock | null;
  nextTimeBlock?: TimeBlock | null;
  sessionStateReady?: boolean;
  onStartSession: (taskId?: string, timeBlockId?: string) => void;
  onPauseSession: () => void;
  onStopSession: () => void;
}

export default function NowBar({ 
  currentSession, 
  currentTimeBlock, 
  nextTimeBlock,
  sessionStateReady = true,
  onStartSession, 
  onPauseSession, 
  onStopSession 
}: NowBarProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [sessionDuration, setSessionDuration] = useState(0);
  const [timeBlockRemaining, setTimeBlockRemaining] = useState(0);
  const [isOverrun, setIsOverrun] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const now = new Date();
      setCurrentTime(now);

      const duration = currentSession ? sessionElapsedSeconds(currentSession, now) : 0;
      setSessionDuration(duration ?? 0);

      // Update time block countdown
      if (currentTimeBlock) {
        const remaining = Math.floor((currentTimeBlock.endTime.getTime() - now.getTime()) / 1000);
        setTimeBlockRemaining(remaining);
        setIsOverrun(remaining < 0);
      } else {
        setTimeBlockRemaining(0);
        setIsOverrun(false);
      }
    };
    refresh();
    const timer = setInterval(refresh, 1000);

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

  return (
    <div className="w-full bg-transparent">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Current Time */}
          <div className="flex items-center space-x-6">
            <div className="text-3xl font-mono font-bold neon-text">
              {formatClock(currentTime)}
            </div>
            
            {/* Time Block Info */}
            {currentTimeBlock && (
              <div className="flex items-center space-x-4 glass-card p-4">
                <div className="text-sm">
                  <div className="font-medium text-white text-lg">{currentTimeBlock.title}</div>
                  <div className={`text-xs ${isOverrun ? 'text-red-400' : 'text-blue-300'}`}>
                    {isOverrun ? '⚠️ Overrun: ' : '⏰ Remaining: '}
                    <span className="font-mono font-bold">
                      {formatTime(timeBlockRemaining)}
                    </span>
                  </div>
                </div>
                
                {/* Progress Bar */}
                <div className="w-40 futuristic-progress">
                  <div 
                    className={`progress-fill-futuristic ${
                      isOverrun ? 'bg-gradient-to-r from-red-500 to-orange-500' : ''
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
          <div className="flex items-center space-x-3">
            {!currentSession ? (
              <button
                onClick={() => onStartSession(currentTimeBlock?.taskId, currentTimeBlock?.id)}
                disabled={!sessionStateReady}
                className="btn-futuristic bg-gradient-to-r from-green-500 to-emerald-600 flex items-center space-x-2 pulse-glow disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>▶️</span>
                <span>{sessionStateReady ? 'START POWER' : 'CHECKING SESSIONS'}</span>
              </button>
            ) : currentSession.status === 'active' ? (
              <>
                <button
                  onClick={onPauseSession}
                  className="btn-futuristic bg-gradient-to-r from-yellow-500 to-orange-600"
                >
                  ⏸️ PAUSE
                </button>
                <button
                  onClick={onStopSession}
                  className="btn-futuristic bg-gradient-to-r from-red-500 to-pink-600"
                >
                  ⏹️ STOP
                </button>
              </>
            ) : (
              <button
                onClick={() => onStartSession()}
                className="btn-futuristic bg-gradient-to-r from-blue-500 to-purple-600 pulse-glow"
              >
                🔄 RESUME
              </button>
            )}
          </div>

          {/* Next Up */}
          <div className="text-sm">
            <div className="text-xs font-medium text-gray-500 mb-1">NEXT UP:</div>
            <div className="text-gray-900">
              {nextTimeBlock?.title || 'No upcoming blocks'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
