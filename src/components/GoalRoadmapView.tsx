"use client";

import { useState, useEffect, useMemo } from 'react';
import { 
  Target, Trophy, MapPin, Rocket, User, ChevronRight,
  Clock, CheckCircle, Circle, Play, Pause
} from 'lucide-react';
import type { Goal, GoalRoadmap, GoalMilestone, TimeBlock, Project, Task } from '@/types';

// ============================================================================
// PROGRESS CALCULATION UTILITIES
// ============================================================================

interface ProgressData {
  totalActualHours: number;
  totalTargetHours: number;
  progressPercentage: number;
  milestoneProgress: Array<{
    milestone: GoalMilestone;
    isReached: boolean;
    progressToThis: number;
  }>;
}

function calculateGoalProgress(
  goal: Goal,
  roadmap: GoalRoadmap,
  timeBlocks: TimeBlock[],
  projects: Project[],
  tasks: Task[]
): ProgressData {
  // Calculate actual hours from completed timeBlocks
  const completedBlocks = timeBlocks.filter(tb => 
    tb.status === 'completed' && 
    (tb.goalId === goal.id || 
     (tb.projectId && projects.some(p => p.id === tb.projectId && p.goalId === goal.id)) ||
     (tb.taskId && tasks.some(t => t.id === tb.taskId && 
       projects.some(p => p.id === t.projectId && p.goalId === goal.id))))
  );

  const totalActualHours = completedBlocks.reduce((sum, block) => {
    const duration = block.actualEndTime && block.actualStartTime
      ? (block.actualEndTime.getTime() - block.actualStartTime.getTime()) / (1000 * 60 * 60)
      : (block.endTime.getTime() - block.startTime.getTime()) / (1000 * 60 * 60);
    return sum + duration;
  }, 0);

  // Calculate target hours from goal, projects, or tasks
  let totalTargetHours = 0;
  if (goal.targetHours) {
    totalTargetHours = goal.targetHours;
  } else {
    const goalProjects = projects.filter(p => p.goalId === goal.id);
    totalTargetHours = goalProjects.reduce((sum, project) => {
      if (project.totalHoursTarget) {
        return sum + project.totalHoursTarget;
      }
      const projectTasks = tasks.filter(t => t.projectId === project.id);
      const projectTaskHours = projectTasks.reduce((taskSum, task) => 
        taskSum + (task.estimatedMinutes || 60) / 60, 0
      );
      return sum + projectTaskHours;
    }, 0);
  }

  // If no target hours found, use default estimation
  if (totalTargetHours === 0) {
    totalTargetHours = Math.max(100, totalActualHours * 2); // Default fallback
  }

  // 🔧 SHERLOCK FIX: Apply same precision fix as OKRManager for 0.1% accuracy
  const progressPercentage = totalTargetHours > 0 ? 
    Math.round((totalActualHours / totalTargetHours) * 100 * 10) / 10 : 0;

  // Calculate milestone progress
  const milestoneProgress = roadmap.milestones
    .sort((a, b) => a.order - b.order)
    .map((milestone, index) => {
      const cumulativeTargetHours = roadmap.milestones
        .slice(0, index + 1)
        .reduce((sum, m) => sum + (m.requiredHours || totalTargetHours / roadmap.milestones.length), 0);
      
      const isReached = totalActualHours >= cumulativeTargetHours || milestone.status === 'completed';
      const progressToThis = totalTargetHours > 0 ? (cumulativeTargetHours / totalTargetHours) * 100 : 0;
      
      return { milestone, isReached, progressToThis };
    });

  return {
    totalActualHours,
    totalTargetHours,
    progressPercentage: Math.min(progressPercentage, 100),
    milestoneProgress
  };
}

// ============================================================================
// SVG PATH GENERATORS
// ============================================================================

interface PathPoint {
  x: number;
  y: number;
  milestone?: GoalMilestone;
}

function generateLinearPath(width: number, height: number, milestoneCount: number): PathPoint[] {
  const points: PathPoint[] = [];
  const margin = 60;
  const pathWidth = width - 2 * margin;
  const pathHeight = height - 2 * margin;
  
  for (let i = 0; i <= milestoneCount; i++) {
    const progress = milestoneCount > 0 ? i / milestoneCount : 0;
    points.push({
      x: margin + pathWidth * progress,
      y: margin + pathHeight * 0.5 // Center vertically
    });
  }
  
  return points;
}

function generateCurvedPath(width: number, height: number, milestoneCount: number): PathPoint[] {
  const points: PathPoint[] = [];
  const margin = 60;
  const pathWidth = width - 2 * margin;
  const pathHeight = height - 2 * margin;
  
  for (let i = 0; i <= milestoneCount; i++) {
    const progress = milestoneCount > 0 ? i / milestoneCount : 0;
    const wave = Math.sin(progress * Math.PI * 2) * 0.2; // Gentle wave
    
    points.push({
      x: margin + pathWidth * progress,
      y: margin + pathHeight * (0.5 + wave)
    });
  }
  
  return points;
}

function generateMountainPath(width: number, height: number, milestoneCount: number): PathPoint[] {
  const points: PathPoint[] = [];
  const margin = 60;
  const pathWidth = width - 2 * margin;
  const pathHeight = height - 2 * margin;
  
  for (let i = 0; i <= milestoneCount; i++) {
    const progress = milestoneCount > 0 ? i / milestoneCount : 0;
    // Create mountain-like ascent: steeper at start, plateau in middle, steep at end
    let elevation = 0;
    if (progress < 0.3) {
      elevation = progress * 2; // Steep ascent
    } else if (progress < 0.7) {
      elevation = 0.6 + (progress - 0.3) * 0.5; // Gentle slope
    } else {
      elevation = 0.8 + (progress - 0.7) * 0.67; // Final push
    }
    
    points.push({
      x: margin + pathWidth * progress,
      y: margin + pathHeight * (1 - elevation) // Invert Y for upward climb
    });
  }
  
  return points;
}

function pathPointsToSVG(points: PathPoint[]): string {
  if (points.length === 0) return '';
  
  const commands = [`M ${points[0].x} ${points[0].y}`];
  
  for (let i = 1; i < points.length; i++) {
    const prevPoint = points[i - 1];
    const currPoint = points[i];
    
    // Use smooth curves for better visual appeal
    const cp1x = prevPoint.x + (currPoint.x - prevPoint.x) * 0.5;
    const cp1y = prevPoint.y;
    const cp2x = prevPoint.x + (currPoint.x - prevPoint.x) * 0.5;
    const cp2y = currPoint.y;
    
    commands.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${currPoint.x} ${currPoint.y}`);
  }
  
  return commands.join(' ');
}

// ============================================================================
// AVATAR COMPONENTS
// ============================================================================

interface AvatarProps {
  x: number;
  y: number;
  style: 'character' | 'progress_bar' | 'rocket';
  progress: number;
  isMoving?: boolean;
}

function Avatar({ x, y, style, progress, isMoving }: AvatarProps) {
  const baseClasses = "transition-all duration-1000 ease-in-out";
  const pulseClasses = isMoving ? "animate-pulse" : "";
  
  switch (style) {
    case 'character':
      return (
        <g transform={`translate(${x - 25}, ${y - 25})`} className={`${baseClasses} ${pulseClasses}`}>
          {/* Gaming Avatar - Epic Knight */}
          <defs>
            <linearGradient id="knightGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFD700" />
              <stop offset="50%" stopColor="#FFA500" />
              <stop offset="100%" stopColor="#FF6B35" />
            </linearGradient>
            <linearGradient id="shieldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4A90E2" />
              <stop offset="50%" stopColor="#357ABD" />
              <stop offset="100%" stopColor="#1E5F99" />
            </linearGradient>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
              <feMerge> 
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          
          {/* Glow Effect */}
          <circle 
            cx="25" cy="25" r="22" 
            fill="url(#knightGradient)" 
            opacity="0.3"
            filter="url(#glow)"
          />
          
          {/* Main Body */}
          <circle 
            cx="25" cy="25" r="20" 
            fill="url(#knightGradient)" 
            stroke="#B8860B" 
            strokeWidth="2"
            className="drop-shadow-xl"
          />
          
          {/* Shield */}
          <path 
            d="M 15 18 Q 15 12 20 12 L 30 12 Q 35 12 35 18 L 35 28 Q 25 35 15 28 Z"
            fill="url(#shieldGradient)"
            stroke="#1E3A8A"
            strokeWidth="1.5"
          />
          
          {/* Shield Symbol - Crown */}
          <path 
            d="M 20 20 L 22 16 L 25 18 L 28 16 L 30 20 L 28 22 L 25 20 L 22 22 Z"
            fill="#FFD700"
            stroke="#B8860B"
            strokeWidth="0.5"
          />
          
          {/* Helmet Eyes - Glowing */}
          <circle cx="21" cy="22" r="2" fill="#00FFFF" className="animate-pulse" />
          <circle cx="29" cy="22" r="2" fill="#00FFFF" className="animate-pulse" />
          
          {/* Helmet Visor */}
          <path 
            d="M 18 28 Q 25 32 32 28" 
            stroke="#FFD700" 
            strokeWidth="2" 
            fill="none" 
            strokeLinecap="round" 
          />
          
          {/* Level Badge */}
          <g transform="translate(35, 8)">
            <circle cx="0" cy="0" r="6" fill="#FF4444" stroke="#AA0000" strokeWidth="1" />
            <text x="0" y="2" textAnchor="middle" className="text-xs font-bold fill-white">
              {Math.floor(progress / 10) + 1}
            </text>
          </g>
          
          {/* Movement Effects */}
          {isMoving && (
            <g opacity="0.8">
              {/* Dust Clouds */}
              <circle cx="8" cy="40" r="4" fill="#D4AF37" opacity="0.6" className="animate-bounce" />
              <circle cx="42" cy="40" r="4" fill="#D4AF37" opacity="0.6" className="animate-bounce" />
              <circle cx="15" cy="38" r="2" fill="#DDD" opacity="0.5" className="animate-ping" />
              <circle cx="35" cy="38" r="2" fill="#DDD" opacity="0.5" className="animate-ping" />
              
              {/* Energy Trail */}
              <path 
                d="M 10 25 Q 5 20 0 25 Q 5 30 10 25" 
                fill="#00FFFF" 
                opacity="0.6"
                className="animate-pulse"
              />
            </g>
          )}
          
          {/* Progress Aura */}
          {progress > 50 && (
            <circle 
              cx="25" cy="25" r="24" 
              fill="none" 
              stroke="#FFD700" 
              strokeWidth="2" 
              opacity="0.7"
              className="animate-spin"
              strokeDasharray="8 4"
            />
          )}
        </g>
      );

    case 'rocket':
      return (
        <g transform={`translate(${x - 20}, ${y - 30})`} className={`${baseClasses} ${pulseClasses}`}>
          {/* Epic Space Rocket */}
          <defs>
            <linearGradient id="rocketGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FF6B6B" />
              <stop offset="50%" stopColor="#4ECDC4" />
              <stop offset="100%" stopColor="#45B7D1" />
            </linearGradient>
            <linearGradient id="flameGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FF4444" />
              <stop offset="50%" stopColor="#FF8800" />
              <stop offset="100%" stopColor="#FFFF00" />
            </linearGradient>
            <filter id="rocketGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
              <feMerge> 
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          
          {/* Rocket Body */}
          <path 
            d="M20 5 L30 15 L28 35 L20 45 L12 35 L10 15 Z" 
            fill="url(#rocketGradient)" 
            stroke="#2C5AA0" 
            strokeWidth="2"
            filter="url(#rocketGlow)"
            className="drop-shadow-xl"
          />
          
          {/* Rocket Nose Cone */}
          <path 
            d="M20 0 L25 10 L20 15 L15 10 Z" 
            fill="#FFD700" 
            stroke="#B8860B" 
            strokeWidth="1.5"
          />
          
          {/* Rocket Windows */}
          <circle cx="20" cy="20" r="6" fill="#00FFFF" stroke="#0099CC" strokeWidth="2" className="animate-pulse" />
          <circle cx="20" cy="20" r="3" fill="#FFFFFF" opacity="0.8" />
          
          {/* Side Boosters */}
          <rect x="8" y="25" width="4" height="15" fill="#C0392B" stroke="#A93226" strokeWidth="1" rx="2" />
          <rect x="28" y="25" width="4" height="15" fill="#C0392B" stroke="#A93226" strokeWidth="1" rx="2" />
          
          {/* Progress Indicator */}
          <g transform="translate(32, 8)">
            <circle cx="0" cy="0" r="5" fill="#00FF00" stroke="#008800" strokeWidth="1" />
            <text x="0" y="1" textAnchor="middle" className="text-xs font-bold fill-black">
              {Math.round(progress)}
            </text>
          </g>
          
          {/* Thrust Effects */}
          {isMoving && (
            <g opacity="0.9">
              {/* Main Thrust */}
              <path 
                d="M15 45 Q20 55 25 45 Q20 60 15 45" 
                fill="url(#flameGradient)" 
                className="animate-pulse"
              />
              <path 
                d="M16 45 Q20 52 24 45 Q20 58 16 45" 
                fill="#FFFF00" 
                opacity="0.8"
                className="animate-bounce"
              />
              
              {/* Side Booster Thrust */}
              <path 
                d="M8 40 Q10 48 12 40 Q10 52 8 40" 
                fill="url(#flameGradient)" 
                className="animate-pulse"
              />
              <path 
                d="M28 40 Q30 48 32 40 Q30 52 28 40" 
                fill="url(#flameGradient)" 
                className="animate-pulse"
              />
              
              {/* Spark Effects */}
              <circle cx="18" cy="50" r="1" fill="#FFFF00" className="animate-ping" />
              <circle cx="22" cy="48" r="1" fill="#FF8800" className="animate-ping" />
              <circle cx="20" cy="52" r="1" fill="#FF4444" className="animate-ping" />
            </g>
          )}
          
          {/* Speed Lines */}
          {progress > 25 && (
            <g opacity="0.6">
              <line x1="5" y1="20" x2="0" y2="18" stroke="#FFFFFF" strokeWidth="2" className="animate-pulse" />
              <line x1="35" y1="20" x2="40" y2="18" stroke="#FFFFFF" strokeWidth="2" className="animate-pulse" />
              <line x1="5" y1="30" x2="-2" y2="28" stroke="#FFFFFF" strokeWidth="2" className="animate-pulse" />
              <line x1="35" y1="30" x2="42" y2="28" stroke="#FFFFFF" strokeWidth="2" className="animate-pulse" />
            </g>
          )}
        </g>
      );

    case 'progress_bar':
    default:
      return (
        <g transform={`translate(${x - 30}, ${y - 15})`} className={baseClasses}>
          {/* Epic Gaming Progress Bar */}
          <defs>
            <linearGradient id="barGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#FF0080" />
              <stop offset="50%" stopColor="#7928CA" />
              <stop offset="100%" stopColor="#FF0080" />
            </linearGradient>
            <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#00FF41" />
              <stop offset="50%" stopColor="#00D4AA" />
              <stop offset="100%" stopColor="#0099FF" />
            </linearGradient>
            <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
              <feMerge> 
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          
          {/* Outer Glow */}
          <rect 
            x="-2" y="-2" width="64" height="24" rx="12" 
            fill="url(#barGradient)" 
            opacity="0.3"
            filter="url(#neonGlow)"
          />
          
          {/* Main Frame */}
          <rect 
            x="0" y="0" width="60" height="20" rx="10" 
            fill="#1a1a1a" 
            stroke="url(#barGradient)" 
            strokeWidth="2"
            className="drop-shadow-xl"
          />
          
          {/* Progress Fill */}
          <rect 
            x="2" y="2" 
            width={`${Math.min(progress, 100) * 0.56}`} 
            height="16" 
            rx="8" 
            fill="url(#progressGradient)"
            className="transition-all duration-1000"
            filter="url(#neonGlow)"
          />
          
          {/* Progress Segments */}
          {Array.from({ length: 10 }, (_, i) => (
            <line 
              key={i}
              x1={6 + i * 5.6} y1="4" 
              x2={6 + i * 5.6} y2="16" 
              stroke="#333" 
              strokeWidth="1" 
              opacity="0.5"
            />
          ))}
          
          {/* Central Display */}
          <rect 
            x="20" y="6" width="20" height="8" rx="4" 
            fill="#000" 
            stroke="#00FF41" 
            strokeWidth="1"
          />
          
          <text 
            x="30" y="12" 
            textAnchor="middle" 
            className="text-xs font-bold"
            fill="#00FF41"
            style={{ fontFamily: 'monospace' }}
          >
            {progress.toFixed(1)}%
          </text>
          
          {/* Side Indicators */}
          <circle 
            cx="-8" cy="10" r="3" 
            fill={progress > 0 ? "#00FF41" : "#333"} 
            className="transition-colors duration-300"
          />
          <circle 
            cx="68" cy="10" r="3" 
            fill={progress >= 100 ? "#FFD700" : "#333"} 
            className="transition-colors duration-300"
          />
          
          {/* Achievement Sparkles */}
          {progress >= 100 && (
            <g className="animate-pulse">
              <circle cx="15" cy="-5" r="2" fill="#FFD700" className="animate-ping" />
              <circle cx="45" cy="-5" r="2" fill="#FFD700" className="animate-ping" />
              <circle cx="30" cy="25" r="2" fill="#FFD700" className="animate-ping" />
            </g>
          )}
          
          {/* Level Up Effect */}
          {progress > 50 && (
            <rect 
              x="0" y="0" width="60" height="20" rx="10" 
              fill="none" 
              stroke="#FFD700" 
              strokeWidth="1" 
              opacity="0.6"
              className="animate-pulse"
              strokeDasharray="4 2"
            />
          )}
        </g>
      );
  }
}

// ============================================================================
// MILESTONE MARKER COMPONENT
// ============================================================================

interface MilestoneMarkerProps {
  point: PathPoint;
  milestone: GoalMilestone;
  isReached: boolean;
  isActive: boolean;
  onClick?: () => void;
}

function MilestoneMarker({ point, milestone, isReached, isActive, onClick }: MilestoneMarkerProps) {
  const color = isReached ? "#FFD700" : isActive ? "#00FFFF" : "#666666";
  const gemColor = isReached ? "#00FF41" : isActive ? "#FF0080" : "#888888";
  
  return (
    <g 
      transform={`translate(${point.x}, ${point.y})`}
      className="cursor-pointer group"
      onClick={onClick}
    >
      <defs>
        <linearGradient id={`gemGradient-${milestone.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={isReached ? "#FFD700" : isActive ? "#00FFFF" : "#888888"} />
          <stop offset="50%" stopColor={isReached ? "#FFA500" : isActive ? "#0099FF" : "#666666"} />
          <stop offset="100%" stopColor={isReached ? "#FF6B35" : isActive ? "#7928CA" : "#444444"} />
        </linearGradient>
        <filter id={`milestoneGlow-${milestone.id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge> 
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        <radialGradient id={`pulseGradient-${milestone.id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity="0.8" />
          <stop offset="70%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      
      {/* Outer Pulse Ring */}
      <circle 
        cx="0" cy="0" r="20" 
        fill={`url(#pulseGradient-${milestone.id})`} 
        className={`transition-all duration-500 ${isActive ? 'animate-ping' : ''}`}
        opacity={isReached || isActive ? "0.6" : "0.3"}
      />
      
      {/* Gaming Crystal/Gem Shape */}
      <g className="group-hover:scale-125 transition-transform duration-300">
        {/* Outer Crystal */}
        <path 
          d="M0,-15 L12,-8 L12,8 L0,15 L-12,8 L-12,-8 Z" 
          fill={`url(#gemGradient-${milestone.id})`} 
          stroke={color} 
          strokeWidth="2"
          filter={`url(#milestoneGlow-${milestone.id})`}
          className="drop-shadow-xl"
        />
        
        {/* Inner Facets */}
        <path 
          d="M0,-10 L8,-5 L0,0 L-8,-5 Z" 
          fill={gemColor} 
          opacity="0.6"
        />
        <path 
          d="M0,0 L8,5 L0,10 L-8,5 Z" 
          fill={gemColor} 
          opacity="0.4"
        />
        
        {/* Central Core */}
        <circle 
          cx="0" cy="0" r="4" 
          fill={isReached ? "#FFFFFF" : isActive ? "#00FFFF" : "#AAAAAA"} 
          className={`${isReached ? 'animate-pulse' : ''}`}
        />
        
        {/* Achievement Check */}
        {isReached && (
          <g className="animate-bounce">
            <circle cx="0" cy="0" r="6" fill="none" stroke="#00FF41" strokeWidth="2" />
            <path 
              d="M-3,0 L-1,2 L3,-2" 
              stroke="#00FF41" 
              strokeWidth="2" 
              fill="none" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
          </g>
        )}
      </g>
      
      {/* Epic Level Badge */}
      <g transform="translate(15, -15)">
        <circle 
          cx="0" cy="0" r="8" 
          fill={isReached ? "#FF4444" : "#333333"} 
          stroke={isReached ? "#AA0000" : "#666666"} 
          strokeWidth="1"
          className="drop-shadow-lg"
        />
        <text 
          x="0" y="3" 
          textAnchor="middle" 
          className="text-xs font-bold"
          fill={isReached ? "#FFFFFF" : "#AAAAAA"}
        >
          {milestone.order + 1}
        </text>
      </g>
      
      {/* Gaming Tooltip */}
      <g transform="translate(0, 40)" className="opacity-0 group-hover:opacity-100 transition-all duration-300">
        <rect 
          x="-40" y="-15" width="80" height="30" rx="15" 
          fill="rgba(0,0,0,0.9)" 
          stroke={color}
          strokeWidth="1"
          className="drop-shadow-2xl"
        />
        <text 
          x="0" y="-5" 
          textAnchor="middle" 
          className="text-xs font-bold fill-white pointer-events-none"
        >
          {milestone.title}
        </text>
        <text 
          x="0" y="8" 
          textAnchor="middle" 
          className="text-xs fill-gray-300 pointer-events-none"
        >
          {milestone.requiredHours || 0}h required
        </text>
        
        {/* Status Indicator */}
        <circle 
          cx="35" cy="-5" r="3" 
          fill={isReached ? "#00FF41" : isActive ? "#FFFF00" : "#FF4444"}
          className="animate-pulse"
        />
      </g>
      
      {/* Epic Emoji Icon */}
      {milestone.icon && (
        <g transform="translate(0, -30)">
          <circle 
            cx="0" cy="0" r="12" 
            fill="rgba(0,0,0,0.7)" 
            className="drop-shadow-lg"
          />
          <text 
            x="0" y="4" 
            textAnchor="middle" 
            className="text-lg pointer-events-none"
            style={{ filter: 'drop-shadow(0px 0px 4px rgba(255,255,255,0.8))' }}
          >
            {milestone.icon}
          </text>
        </g>
      )}
      
      {/* Achievement Sparkles */}
      {isReached && (
        <g className="animate-spin" style={{ animationDuration: '3s' }}>
          <circle cx="20" cy="-10" r="1" fill="#FFD700" className="animate-ping" />
          <circle cx="-20" cy="10" r="1" fill="#FFD700" className="animate-ping" />
          <circle cx="10" cy="20" r="1" fill="#FFD700" className="animate-ping" />
          <circle cx="-10" cy="-20" r="1" fill="#FFD700" className="animate-ping" />
        </g>
      )}
    </g>
  );
}

// ============================================================================
// MAIN GOAL ROADMAP VIEW COMPONENT
// ============================================================================

interface GoalRoadmapViewProps {
  goal: Goal;
  roadmap: GoalRoadmap;
  timeBlocks: TimeBlock[];
  projects: Project[];
  tasks: Task[];
  onMilestoneClick?: (milestone: GoalMilestone) => void;
  className?: string;
  width?: number;
  height?: number;
}

export function GoalRoadmapView({
  goal,
  roadmap,
  timeBlocks,
  projects,
  tasks,
  onMilestoneClick,
  className = "",
  width = 800,
  height = 400
}: GoalRoadmapViewProps) {
  const [selectedMilestone, setSelectedMilestone] = useState<GoalMilestone | null>(null);
  
  // Calculate progress data
  const progressData = useMemo(() => 
    calculateGoalProgress(goal, roadmap, timeBlocks, projects, tasks),
    [goal, roadmap, timeBlocks, projects, tasks]
  );

  // Generate path points based on style
  const pathPoints = useMemo(() => {
    const milestoneCount = roadmap.milestones.length;
    let points: PathPoint[];
    
    switch (roadmap.pathStyle) {
      case 'curved':
        points = generateCurvedPath(width, height, milestoneCount);
        break;
      case 'mountain':
        points = generateMountainPath(width, height, milestoneCount);
        break;
      case 'linear':
      default:
        points = generateLinearPath(width, height, milestoneCount);
        break;
    }
    
    // Attach milestones to points (skip first point which is the start)
    points.slice(1).forEach((point, index) => {
      if (index < roadmap.milestones.length) {
        point.milestone = roadmap.milestones[index];
      }
    });
    
    return points;
  }, [roadmap.pathStyle, roadmap.milestones, width, height]);

  // Calculate avatar position based on progress
  const avatarPosition = useMemo(() => {
    if (pathPoints.length === 0) return { x: 50, y: height / 2 };
    
    const progress = progressData.progressPercentage / 100;
    const totalPath = pathPoints.length - 1;
    const currentSegment = Math.min(Math.floor(progress * totalPath), totalPath - 1);
    const segmentProgress = (progress * totalPath) - currentSegment;
    
    if (currentSegment >= pathPoints.length - 1) {
      return pathPoints[pathPoints.length - 1];
    }
    
    const currentPoint = pathPoints[currentSegment];
    const nextPoint = pathPoints[currentSegment + 1];
    
    return {
      x: currentPoint.x + (nextPoint.x - currentPoint.x) * segmentProgress,
      y: currentPoint.y + (nextPoint.y - currentPoint.y) * segmentProgress
    };
  }, [pathPoints, progressData.progressPercentage, height]);

  const svgPath = pathPointsToSVG(pathPoints);
  
  return (
    <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Target className="h-6 w-6 text-blue-600" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {roadmap.title || `${goal.title} Roadmap`}
              </h3>
              {roadmap.description && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {roadmap.description}
                </p>
              )}
            </div>
          </div>
          
          <div className="text-right">
            <div className="text-2xl font-bold text-blue-600">
              {progressData.progressPercentage}%
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {progressData.totalActualHours.toFixed(1)}h / {progressData.totalTargetHours.toFixed(1)}h
            </div>
          </div>
        </div>
      </div>

      {/* SVG Roadmap */}
      <div className="p-6">
        <svg width={width} height={height} className="w-full h-auto">
          {/* Epic Gaming Background */}
          <defs>
            {/* Cyber Grid Pattern */}
            <pattern id="cyberGrid" width="50" height="50" patternUnits="userSpaceOnUse">
              <rect width="50" height="50" fill="#0a0a0a" />
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#00FFFF" strokeWidth="0.5" opacity="0.3" />
              <circle cx="25" cy="25" r="1" fill="#00FFFF" opacity="0.5" />
            </pattern>
            
            {/* Energy Grid Pattern */}
            <pattern id="energyGrid" width="30" height="30" patternUnits="userSpaceOnUse">
              <rect width="30" height="30" fill="transparent" />
              <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#FFD700" strokeWidth="0.3" opacity="0.2" />
              <circle cx="15" cy="15" r="0.5" fill="#FFD700" opacity="0.3" className="animate-pulse" />
            </pattern>
            
            {/* Path Gradients */}
            <linearGradient id="pathTrailGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#333333" />
              <stop offset="50%" stopColor="#666666" />
              <stop offset="100%" stopColor="#333333" />
            </linearGradient>
            
            <linearGradient id="progressPathGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#FF0080" />
              <stop offset="25%" stopColor="#00FFFF" />
              <stop offset="50%" stopColor="#FFD700" />
              <stop offset="75%" stopColor="#00FF41" />
              <stop offset="100%" stopColor="#FF6B35" />
            </linearGradient>
            
            {/* Glow Filters */}
            <filter id="pathGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
              <feMerge> 
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
            
            <filter id="energyGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
              <feMerge> 
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          
          {/* Dark Gaming Background */}
          <rect width="100%" height="100%" fill="#0a0a0a" />
          
          {/* Cyber Grid */}
          <rect width="100%" height="100%" fill="url(#cyberGrid)" opacity="0.8" />
          
          {/* Energy Grid Overlay */}
          <rect width="100%" height="100%" fill="url(#energyGrid)" opacity="0.6" />
          
          {/* Ambient Particles */}
          <g opacity="0.4">
            {Array.from({ length: 20 }, (_, i) => (
              <circle 
                key={i}
                cx={Math.random() * width} 
                cy={Math.random() * height} 
                r="1" 
                fill="#00FFFF"
                className="animate-ping"
                style={{ animationDelay: `${i * 0.5}s` }}
              />
            ))}
          </g>
          
          {/* Path Trail with Epic Styling */}
          <path 
            d={svgPath} 
            fill="none" 
            stroke="url(#pathTrailGradient)" 
            strokeWidth="12" 
            strokeLinecap="round"
            filter="url(#pathGlow)"
            className="drop-shadow-2xl"
          />
          
          {/* Progress Path with Rainbow Effect */}
          <path 
            d={svgPath} 
            fill="none" 
            stroke="url(#progressPathGradient)" 
            strokeWidth="8" 
            strokeLinecap="round"
            strokeDasharray={`${progressData.progressPercentage * 3} ${300 - progressData.progressPercentage * 3}`}
            filter="url(#energyGlow)"
            className="drop-shadow-xl"
          />
          
          {/* Energy Pulse Effect */}
          {progressData.progressPercentage > 0 && (
            <path 
              d={svgPath} 
              fill="none" 
              stroke="#FFFFFF" 
              strokeWidth="2" 
              strokeLinecap="round"
              strokeDasharray="4 8"
              strokeDashoffset="0"
              opacity="0.7"
              className="animate-pulse"
            >
              <animate 
                attributeName="stroke-dashoffset" 
                values="0;-12;0" 
                dur="2s" 
                repeatCount="indefinite"
              />
            </path>
          )}
          
          {/* Start point */}
          {pathPoints.length > 0 && (
            <g transform={`translate(${pathPoints[0].x}, ${pathPoints[0].y})`}>
              <circle cx="0" cy="0" r="8" fill="#10B981" className="drop-shadow-md" />
              <Play x="-4" y="-4" width="8" height="8" fill="white" />
            </g>
          )}
          
          {/* Milestone markers */}
          {pathPoints.slice(1).map((point, index) => {
            if (!point.milestone) return null;
            const milestoneData = progressData.milestoneProgress[index];
            return (
              <MilestoneMarker 
                key={point.milestone.id}
                point={point}
                milestone={point.milestone}
                isReached={milestoneData.isReached}
                isActive={selectedMilestone?.id === point.milestone.id}
                onClick={() => {
                  setSelectedMilestone(point.milestone!);
                  onMilestoneClick?.(point.milestone!);
                }}
              />
            );
          })}
          
          {/* End point (Trophy) */}
          {pathPoints.length > 0 && (
            <g transform={`translate(${pathPoints[pathPoints.length - 1].x}, ${pathPoints[pathPoints.length - 1].y})`}>
              <circle 
                cx="0" cy="0" r="15" 
                fill={progressData.progressPercentage >= 100 ? "#F59E0B" : "#D1D5DB"} 
                className="drop-shadow-lg" 
              />
              <Trophy 
                x="-8" y="-8" 
                width="16" height="16" 
                fill="white"
              />
            </g>
          )}
          
          {/* Avatar */}
          <Avatar 
            x={avatarPosition.x}
            y={avatarPosition.y}
            style={roadmap.avatarStyle || 'character'}
            progress={progressData.progressPercentage}
            isMoving={progressData.progressPercentage > 0 && progressData.progressPercentage < 100}
          />
        </svg>
      </div>

      {/* Selected Milestone Details */}
      {selectedMilestone && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-6 bg-gray-50 dark:bg-gray-800">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="h-4 w-4 text-blue-600" />
                <h4 className="font-semibold text-gray-900 dark:text-white">
                  {selectedMilestone.title}
                </h4>
                {selectedMilestone.icon && (
                  <span className="text-lg">{selectedMilestone.icon}</span>
                )}
              </div>
              
              {selectedMilestone.description && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  {selectedMilestone.description}
                </p>
              )}
              
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4 text-gray-500" />
                  <span className="text-gray-600 dark:text-gray-400">
                    {selectedMilestone.requiredHours || 'TBD'} hours
                  </span>
                </div>
                
                <div className={`flex items-center gap-1 ${
                  selectedMilestone.status === 'completed' 
                    ? 'text-green-600 dark:text-green-400' 
                    : 'text-gray-500'
                }`}>
                  {selectedMilestone.status === 'completed' ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <Circle className="h-4 w-4" />
                  )}
                  <span className="capitalize">{selectedMilestone.status}</span>
                </div>
              </div>
            </div>
            
            <button
              onClick={() => setSelectedMilestone(null)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default GoalRoadmapView;