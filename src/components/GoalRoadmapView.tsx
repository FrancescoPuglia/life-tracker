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

  const progressPercentage = totalTargetHours > 0 ? (totalActualHours / totalTargetHours) * 100 : 0;

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
        <g transform={`translate(${x - 20}, ${y - 20})`} className={`${baseClasses} ${pulseClasses}`}>
          <circle 
            cx="20" cy="20" r="18" 
            fill="#3B82F6" stroke="#1E40AF" strokeWidth="2"
            className="drop-shadow-lg"
          />
          <circle cx="15" cy="15" r="2" fill="white" />
          <circle cx="25" cy="15" r="2" fill="white" />
          <path d="M 12 25 Q 20 30 28 25" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
          {isMoving && (
            <g opacity="0.7">
              <circle cx="8" cy="32" r="3" fill="#3B82F6" />
              <circle cx="32" cy="32" r="3" fill="#3B82F6" />
            </g>
          )}
        </g>
      );

    case 'rocket':
      return (
        <g transform={`translate(${x - 15}, ${y - 25})`} className={`${baseClasses} ${pulseClasses}`}>
          <path 
            d="M15 5 L25 15 L20 20 L15 25 L10 20 L5 15 Z" 
            fill="#EF4444" stroke="#DC2626" strokeWidth="2"
            className="drop-shadow-lg"
          />
          <circle cx="15" cy="15" r="4" fill="#FCD34D" />
          {isMoving && (
            <g opacity="0.8">
              <path d="M10 25 Q15 35 20 25" fill="#F97316" />
              <path d="M12 30 Q15 38 18 30" fill="#FBBF24" />
            </g>
          )}
        </g>
      );

    case 'progress_bar':
    default:
      return (
        <g transform={`translate(${x - 25}, ${y - 10})`} className={baseClasses}>
          <rect 
            x="0" y="0" width="50" height="20" rx="10" 
            fill="white" stroke="#D1D5DB" strokeWidth="2"
            className="drop-shadow-lg"
          />
          <rect 
            x="2" y="2" width={`${Math.min(progress, 100) * 0.46}`} height="16" rx="8" 
            fill="#10B981"
            className="transition-all duration-500"
          />
          <text 
            x="25" y="14" 
            textAnchor="middle" 
            className="text-xs font-bold fill-gray-700"
          >
            {Math.round(progress)}%
          </text>
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
  const Icon = isReached ? CheckCircle : Circle;
  const color = isReached ? "#10B981" : isActive ? "#3B82F6" : "#9CA3AF";
  
  return (
    <g 
      transform={`translate(${point.x}, ${point.y})`}
      className="cursor-pointer group"
      onClick={onClick}
    >
      {/* Milestone circle */}
      <circle 
        cx="0" cy="0" r="12" 
        fill="white" 
        stroke={color} 
        strokeWidth="3"
        className="drop-shadow-md group-hover:scale-110 transition-transform"
      />
      
      {/* Icon */}
      {isReached ? (
        <CheckCircle 
          x="-8" y="-8" 
          width="16" height="16" 
          fill={color}
          className="pointer-events-none"
        />
      ) : (
        <circle cx="0" cy="0" r="4" fill={color} />
      )}
      
      {/* Milestone label */}
      <g transform="translate(0, 35)">
        <rect 
          x="-30" y="-10" width="60" height="20" rx="10" 
          fill="rgba(0,0,0,0.8)" 
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        />
        <text 
          x="0" y="2" 
          textAnchor="middle" 
          className="text-xs font-medium fill-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        >
          {milestone.title}
        </text>
      </g>
      
      {/* Emoji/Icon if provided */}
      {milestone.icon && (
        <text 
          x="0" y="-25" 
          textAnchor="middle" 
          className="text-lg pointer-events-none"
        >
          {milestone.icon}
        </text>
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
              {Math.round(progressData.progressPercentage)}%
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
          {/* Background grid (subtle) */}
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#F3F4F6" strokeWidth="1" opacity="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          
          {/* Path trail */}
          <path 
            d={svgPath} 
            fill="none" 
            stroke="#E5E7EB" 
            strokeWidth="8" 
            strokeLinecap="round"
            className="drop-shadow-sm"
          />
          
          {/* Progress path */}
          <path 
            d={svgPath} 
            fill="none" 
            stroke="#3B82F6" 
            strokeWidth="6" 
            strokeLinecap="round"
            strokeDasharray={`${progressData.progressPercentage * 2} ${200 - progressData.progressPercentage * 2}`}
            className="drop-shadow-sm"
          />
          
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