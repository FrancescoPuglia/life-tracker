/**
 * 🔥 P0 TASK 2: Centralized progress calculation utilities
 * Single source of truth for all actualHours calculations
 */

import { TimeBlock, Project, Goal } from '@/types';
import { calculateDuration, msToHours } from '@/lib/datetime';

/**
 * Calculate actual completed hours for a project
 * Uses actualStartTime/actualEndTime if available, fallback to planned times
 */
export function calculateProjectActualHours(
  projectId: string, 
  timeBlocks: TimeBlock[]
): number {
  return timeBlocks
    .filter(block => block.projectId === projectId && block.status === 'completed')
    .reduce((total, block) => {
      // Use actual times if available, otherwise fallback to planned times
      const startTime = block.actualStartTime || block.startTime;
      const endTime = block.actualEndTime || block.endTime;
      const durationMs = calculateDuration(startTime, endTime);
      return total + msToHours(durationMs);
    }, 0);
}

/**
 * Calculate planned hours for a project
 * Uses planned startTime/endTime for all blocks
 */
export function calculateProjectPlannedHours(
  projectId: string, 
  timeBlocks: TimeBlock[]
): number {
  return timeBlocks
    .filter(block => block.projectId === projectId)
    .reduce((total, block) => {
      const durationMs = calculateDuration(block.startTime, block.endTime);
      return total + msToHours(durationMs);
    }, 0);
}

/**
 * Calculate actual completed hours for a goal
 * Includes direct goal timeBlocks + project timeBlocks
 */
export function calculateGoalActualHours(
  goalId: string, 
  timeBlocks: TimeBlock[], 
  projects: Project[]
): number {
  // Sum from direct goal time blocks (completed only)
  const directGoalHours = timeBlocks
    .filter(block => 
      (block.goalId === goalId || (block.goalIds && block.goalIds.includes(goalId))) &&
      block.status === 'completed'
    )
    .reduce((total, block) => {
      const startTime = block.actualStartTime || block.startTime;
      const endTime = block.actualEndTime || block.endTime;
      const durationMs = calculateDuration(startTime, endTime);
      const hours = msToHours(durationMs);
      
      // If block has goal allocation, use it
      if (block.goalAllocation && block.goalAllocation[goalId]) {
        return total + (hours * block.goalAllocation[goalId] / 100);
      }
      return total + hours;
    }, 0);
  
  // Sum from project time blocks (completed only)
  const goalProjects = projects.filter(p => p.goalId === goalId);
  const projectHours = goalProjects.reduce((total, project) => {
    return total + calculateProjectActualHours(project.id, timeBlocks);
  }, 0);
  
  return directGoalHours + projectHours;
}

/**
 * Calculate planned hours for a goal
 * Includes direct goal timeBlocks + project timeBlocks
 */
export function calculateGoalPlannedHours(
  goalId: string, 
  timeBlocks: TimeBlock[], 
  projects: Project[]
): number {
  // Sum from direct goal time blocks
  const directGoalHours = timeBlocks
    .filter(block => block.goalId === goalId || (block.goalIds && block.goalIds.includes(goalId)))
    .reduce((total, block) => {
      const durationMs = calculateDuration(block.startTime, block.endTime);
      const hours = msToHours(durationMs);
      
      // If block has goal allocation, use it
      if (block.goalAllocation && block.goalAllocation[goalId]) {
        return total + (hours * block.goalAllocation[goalId] / 100);
      }
      return total + hours;
    }, 0);
  
  // Sum from project time blocks
  const goalProjects = projects.filter(p => p.goalId === goalId);
  const projectHours = goalProjects.reduce((total, project) => {
    return total + calculateProjectPlannedHours(project.id, timeBlocks);
  }, 0);
  
  return directGoalHours + projectHours;
}

/**
 * Calculate progress percentage for a goal
 * Uses hours-based calculation if no key results available
 */
export function calculateGoalProgress(
  goal: Goal,
  timeBlocks: TimeBlock[], 
  projects: Project[]
): number {
  const actualHours = calculateGoalActualHours(goal.id, timeBlocks, projects);
  
  // Get target from goal's totalHoursTarget or sum of project targets
  const goalProjects = projects.filter(p => p.goalId === goal.id);
  let targetHours = goal.totalHoursTarget || 0;
  
  if (targetHours === 0) {
    targetHours = goalProjects.reduce((sum, project) => {
      return sum + (project.totalHoursTarget || 0);
    }, 0);
  }
  
  // If still no target, calculate from planned hours
  if (targetHours === 0) {
    targetHours = calculateGoalPlannedHours(goal.id, timeBlocks, projects);
  }
  
  if (targetHours === 0) {
    return 0; // No target to measure against
  }
  
  return Math.min(100, (actualHours / targetHours) * 100);
}

/**
 * Calculate progress percentage for a project
 */
export function calculateProjectProgress(
  project: Project,
  timeBlocks: TimeBlock[]
): number {
  const actualHours = calculateProjectActualHours(project.id, timeBlocks);
  
  let targetHours = project.totalHoursTarget || 0;
  
  // If no explicit target, use planned hours as target
  if (targetHours === 0) {
    targetHours = calculateProjectPlannedHours(project.id, timeBlocks);
  }
  
  if (targetHours === 0) {
    return 0; // No target to measure against
  }
  
  return Math.min(100, (actualHours / targetHours) * 100);
}