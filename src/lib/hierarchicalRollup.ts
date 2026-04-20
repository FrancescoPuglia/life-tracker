/**
 * 🎯 HIERARCHICAL ROLLUP ENGINE
 * 
 * Calculates actual hours from completed TimeBlocks and rolls them up through
 * the hierarchy: TimeBlock → Task → Project → Goal
 * 
 * This function is called whenever a TimeBlock status changes to 'completed'
 * to update progress metrics across the hierarchy.
 */

import { TimeBlock, Task, Project, Goal } from '@/types';
import { db } from './database';

export interface RollupResult {
  taskUpdates: { id: string; actualMinutes: number; actualHours: number }[];
  projectUpdates: { id: string; actualMinutes: number; actualHours: number }[];
  goalUpdates: { id: string; actualMinutes: number; actualHours: number }[];
}

/**
 * Calculate actual duration from a completed TimeBlock
 * Uses actualStartTime/actualEndTime if available, otherwise startTime/endTime
 */
function calculateTimeBlockActualMinutes(timeBlock: TimeBlock): number {
  if (timeBlock.status !== 'completed') return 0;
  
  const startTime = timeBlock.actualStartTime || timeBlock.startTime;
  const endTime = timeBlock.actualEndTime || timeBlock.endTime;
  
  const durationMs = endTime.getTime() - startTime.getTime();
  const durationMinutes = Math.max(0, Math.round(durationMs / (1000 * 60)));
  
  return durationMinutes;
}

/**
 * Main hierarchical rollup function
 * Recalculates actual hours for all affected Goals, Projects, and Tasks
 * based on completed TimeBlocks
 */
export async function performHierarchicalRollup(
  userId: string,
  affectedTimeBlockIds: string[] = []
): Promise<RollupResult> {
  try {
    // Get all data
    const [allTimeBlocks, allTasks, allProjects, allGoals] = await Promise.all([
      db.getAll<TimeBlock>('timeBlocks'),
      db.getAll<Task>('tasks'),
      db.getAll<Project>('projects'),
      db.getAll<Goal>('goals')
    ]);

    // Filter by userId and exclude soft-deleted entities
    const userTimeBlocks = allTimeBlocks.filter(tb => tb.userId === userId);
    const userTasks = allTasks.filter(t => t.userId === userId && !t.deleted);
    const userProjects = allProjects.filter(p => p.userId === userId && !p.deleted);
    const userGoals = allGoals.filter(g => g.userId === userId && !g.deleted);

    // Calculate actual minutes for each completed TimeBlock
    const completedBlocks = userTimeBlocks.filter(tb => tb.status === 'completed');
    
    // Group TimeBlocks by Task, Project, and Goal
    const taskActualMinutes = new Map<string, number>();
    const projectActualMinutes = new Map<string, number>();
    const goalActualMinutes = new Map<string, number>();

    // Rollup from TimeBlocks
    for (const timeBlock of completedBlocks) {
      const actualMinutes = calculateTimeBlockActualMinutes(timeBlock);
      
      if (actualMinutes > 0) {
        // Direct to Task
        if (timeBlock.taskId) {
          taskActualMinutes.set(
            timeBlock.taskId, 
            (taskActualMinutes.get(timeBlock.taskId) || 0) + actualMinutes
          );
        }
        
        // Direct to Project (if no taskId)
        if (timeBlock.projectId && !timeBlock.taskId) {
          projectActualMinutes.set(
            timeBlock.projectId,
            (projectActualMinutes.get(timeBlock.projectId) || 0) + actualMinutes
          );
        }
        
        // Direct to Goal (if no projectId or taskId)
        if (timeBlock.goalId && !timeBlock.projectId && !timeBlock.taskId) {
          goalActualMinutes.set(
            timeBlock.goalId,
            (goalActualMinutes.get(timeBlock.goalId) || 0) + actualMinutes
          );
        }
      }
    }

    // Rollup from Tasks to Projects
    for (const task of userTasks) {
      const taskMinutes = taskActualMinutes.get(task.id) || 0;
      if (taskMinutes > 0 && task.projectId) {
        projectActualMinutes.set(
          task.projectId,
          (projectActualMinutes.get(task.projectId) || 0) + taskMinutes
        );
      }
    }

    // Rollup from Projects to Goals
    for (const project of userProjects) {
      const projectMinutes = projectActualMinutes.get(project.id) || 0;
      if (projectMinutes > 0 && project.goalId) {
        goalActualMinutes.set(
          project.goalId,
          (goalActualMinutes.get(project.goalId) || 0) + projectMinutes
        );
      }
    }

    // Prepare updates
    const taskUpdates = Array.from(taskActualMinutes.entries()).map(([id, minutes]) => ({
      id,
      actualMinutes: minutes,
      actualHours: Math.round(minutes / 60 * 100) / 100 // Round to 2 decimal places
    }));

    const projectUpdates = Array.from(projectActualMinutes.entries()).map(([id, minutes]) => ({
      id,
      actualMinutes: minutes,
      actualHours: Math.round(minutes / 60 * 100) / 100
    }));

    const goalUpdates = Array.from(goalActualMinutes.entries()).map(([id, minutes]) => ({
      id,
      actualMinutes: minutes,
      actualHours: Math.round(minutes / 60 * 100) / 100
    }));

    // Apply updates to database
    await Promise.all([
      ...taskUpdates.map(update => 
        db.update('tasks', { id: update.id, actualMinutes: update.actualMinutes, actualHours: update.actualHours, updatedAt: new Date() })
      ),
      ...projectUpdates.map(update => 
        db.update('projects', { id: update.id, actualMinutes: update.actualMinutes, actualHours: update.actualHours, updatedAt: new Date() })
      ),
      ...goalUpdates.map(update => 
        db.update('goals', { id: update.id, actualMinutes: update.actualMinutes, actualHours: update.actualHours, updatedAt: new Date() })
      )
    ]);

    console.log('🎯 Hierarchical Rollup Complete:', {
      userId,
      tasksUpdated: taskUpdates.length,
      projectsUpdated: projectUpdates.length,
      goalsUpdated: goalUpdates.length,
      affectedTimeBlocks: affectedTimeBlockIds.length
    });

    return {
      taskUpdates,
      projectUpdates,
      goalUpdates
    };

  } catch (error) {
    console.error('❌ Hierarchical Rollup Failed:', error);
    throw error;
  }
}

/**
 * Trigger hierarchical rollup for a specific completed TimeBlock
 * This is called when a TimeBlock is marked as completed
 */
export async function rollupForCompletedTimeBlock(
  userId: string,
  timeBlockId: string
): Promise<RollupResult> {
  return performHierarchicalRollup(userId, [timeBlockId]);
}

/**
 * Trigger full hierarchical rollup for all user data
 * This can be used for data repair or initial setup
 */
export async function fullHierarchicalRollup(userId: string): Promise<RollupResult> {
  return performHierarchicalRollup(userId, []);
}

/**
 * Get progress percentage for a Goal, Project, or Task based on actual vs target hours
 */
export function calculateProgressPercentage(
  actualHours: number,
  targetHours: number | undefined
): number {
  if (!targetHours || targetHours <= 0) return 0;
  if (actualHours < 0) return 0; // Handle negative values gracefully
  return Math.min(100, Math.round((actualHours / targetHours) * 100));
}

/**
 * Debug function to show rollup hierarchy for a specific TimeBlock
 */
export async function debugTimeBlockHierarchy(userId: string, timeBlockId: string): Promise<any> {
  try {
    const [allTimeBlocks, allTasks, allProjects, allGoals] = await Promise.all([
      db.getAll<TimeBlock>('timeBlocks'),
      db.getAll<Task>('tasks'),
      db.getAll<Project>('projects'),
      db.getAll<Goal>('goals')
    ]);

    const timeBlock = allTimeBlocks.find(tb => tb.id === timeBlockId && tb.userId === userId);
    if (!timeBlock) return { error: 'TimeBlock not found' };

    const task = timeBlock.taskId ? allTasks.find(t => t.id === timeBlock.taskId) : null;
    const project = timeBlock.projectId ? allProjects.find(p => p.id === timeBlock.projectId) : 
                   task?.projectId ? allProjects.find(p => p.id === task.projectId) : null;
    const goal = timeBlock.goalId ? allGoals.find(g => g.id === timeBlock.goalId) : 
                project?.goalId ? allGoals.find(g => g.id === project.goalId) : null;

    const actualMinutes = calculateTimeBlockActualMinutes(timeBlock);

    return {
      timeBlock: {
        id: timeBlock.id,
        title: timeBlock.title,
        status: timeBlock.status,
        actualMinutes,
        actualHours: Math.round(actualMinutes / 60 * 100) / 100
      },
      task: task ? {
        id: task.id,
        title: task.title,
        currentActualMinutes: task.actualMinutes || 0,
        currentActualHours: task.actualHours || 0,
        estimatedMinutes: task.estimatedMinutes
      } : null,
      project: project ? {
        id: project.id,
        name: project.name,
        currentActualMinutes: project.actualMinutes || 0,
        currentActualHours: project.actualHours || 0,
        totalHoursTarget: project.totalHoursTarget
      } : null,
      goal: goal ? {
        id: goal.id,
        title: goal.title,
        currentActualMinutes: goal.actualMinutes || 0,
        currentActualHours: goal.actualHours || 0,
        targetHours: goal.targetHours
      } : null,
      rollupPath: [
        timeBlock.taskId && 'Task',
        timeBlock.projectId && 'Project', 
        timeBlock.goalId && 'Goal'
      ].filter(Boolean).join(' → ') || 'Direct to hierarchy'
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}