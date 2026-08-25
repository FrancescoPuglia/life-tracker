/**
 * 🎯 HIERARCHICAL ROLLUP ENGINE
 * 
 * Calculates actual hours from completed Sessions or explicit block actual
 * intervals and rolls them up: execution → Task → Project → Goal.
 * 
 * This function is called whenever a TimeBlock status changes to 'completed'
 * to update progress metrics across the hierarchy.
 */

import { TimeBlock, Task, Project, Goal, Session } from '@/types';
import { db } from './database';
import { parseCompletedSessionEvidence, validExecutionInterval } from './executionEvidence';

export interface RollupResult {
  taskUpdates: { id: string; actualMinutes: number; actualHours: number }[];
  projectUpdates: { id: string; actualMinutes: number; actualHours: number }[];
  goalUpdates: { id: string; actualMinutes: number; actualHours: number }[];
}

/**
 * Calculate explicit actual duration from an executed TimeBlock. Planned
 * windows are not execution evidence.
 */
function calculateTimeBlockActualMinutes(timeBlock: TimeBlock): number {
  if (timeBlock.status !== 'completed' && timeBlock.status !== 'overrun') return 0;
  const interval = validExecutionInterval(timeBlock.actualStartTime, timeBlock.actualEndTime);
  return interval ? Math.round((interval.end - interval.start) / 60_000) : 0;
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
    const [allTimeBlocks, allSessions, allTasks, allProjects, allGoals] = await Promise.all([
      db.getAll<TimeBlock>('timeBlocks'),
      db.getAll<Session>('sessions'),
      db.getAll<Task>('tasks'),
      db.getAll<Project>('projects'),
      db.getAll<Goal>('goals')
    ]);

    // Filter by userId and exclude soft-deleted entities
    const userTimeBlocks = allTimeBlocks.filter(tb => tb.userId === userId && !tb.deleted);
    const userSessions = allSessions.filter(session => session.userId === userId && !session.deleted);
    const userTasks = allTasks.filter(t => t.userId === userId && !t.deleted);
    const userProjects = allProjects.filter(p => p.userId === userId && !p.deleted);
    const userGoals = allGoals.filter(g => g.userId === userId && !g.deleted);

    const taskById = new Map(userTasks.map(task => [task.id, task]));
    const projectById = new Map(userProjects.map(project => [project.id, project]));
    const goalById = new Map(userGoals.map(goal => [goal.id, goal]));
    const blockById = new Map(userTimeBlocks.map(block => [block.id, block]));
    const blocksWithValidSessions = new Set<string>();

    // Group authoritative execution evidence by Task, Project, and Goal.
    const taskActualMinutes = new Map<string, number>();
    const projectActualMinutes = new Map<string, number>();
    const goalActualMinutes = new Map<string, number>();

    const recordActual = (
      taskId: string | undefined,
      projectId: string | undefined,
      goalId: string | undefined,
      actualMinutes: number,
    ) => {
      if (actualMinutes <= 0) return;
      const task = taskId ? taskById.get(taskId) : undefined;
      if (task) {
        taskActualMinutes.set(task.id, (taskActualMinutes.get(task.id) || 0) + actualMinutes);
        return;
      }
      const project = projectId ? projectById.get(projectId) : undefined;
      if (project) {
        projectActualMinutes.set(project.id, (projectActualMinutes.get(project.id) || 0) + actualMinutes);
        return;
      }
      const goal = goalId ? goalById.get(goalId) : undefined;
      if (goal) goalActualMinutes.set(goal.id, (goalActualMinutes.get(goal.id) || 0) + actualMinutes);
    };

    // Sessions are primary, including Sessions linked to a TimeBlock.
    for (const session of userSessions) {
      const evidence = parseCompletedSessionEvidence(session);
      if (!evidence) continue;
      const linkedBlock = evidence.timeBlockId ? blockById.get(evidence.timeBlockId) : undefined;
      if (evidence.timeBlockId) blocksWithValidSessions.add(evidence.timeBlockId);
      recordActual(
        session.taskId || linkedBlock?.taskId,
        session.projectId || linkedBlock?.projectId,
        session.goalIds?.[0] || linkedBlock?.goalId,
        evidence.netMinutes,
      );
    }

    // Explicit block actual intervals are fallback evidence only when no valid
    // linked Session exists.
    for (const timeBlock of userTimeBlocks) {
      if (blocksWithValidSessions.has(timeBlock.id)) continue;
      recordActual(
        timeBlock.taskId,
        timeBlock.projectId,
        timeBlock.goalId,
        calculateTimeBlockActualMinutes(timeBlock),
      );
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
    const taskUpdates = userTasks.map(({ id }) => {
      const minutes = taskActualMinutes.get(id) || 0;
      return {
        id,
        actualMinutes: minutes,
        actualHours: Math.round(minutes / 60 * 100) / 100,
      };
    });

    const projectUpdates = userProjects.map(({ id }) => {
      const minutes = projectActualMinutes.get(id) || 0;
      return {
        id,
        actualMinutes: minutes,
        actualHours: Math.round(minutes / 60 * 100) / 100,
      };
    });

    const goalUpdates = userGoals.map(({ id }) => {
      const minutes = goalActualMinutes.get(id) || 0;
      return {
        id,
        actualMinutes: minutes,
        actualHours: Math.round(minutes / 60 * 100) / 100,
      };
    });

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
    const [allTimeBlocks, allSessions, allTasks, allProjects, allGoals] = await Promise.all([
      db.getAll<TimeBlock>('timeBlocks'),
      db.getAll<Session>('sessions'),
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

    const linkedSessionMinutes = allSessions
      .filter(session => session.userId === userId && session.timeBlockId === timeBlock.id)
      .map(parseCompletedSessionEvidence)
      .filter((evidence): evidence is NonNullable<typeof evidence> => evidence !== null)
      .reduce((sum, evidence) => sum + evidence.netMinutes, 0);
    const actualMinutes = linkedSessionMinutes > 0
      ? linkedSessionMinutes
      : calculateTimeBlockActualMinutes(timeBlock);

    return {
      timeBlock: {
        id: timeBlock.id,
        title: timeBlock.title,
        status: timeBlock.status,
        actualMinutes,
        actualSource: linkedSessionMinutes > 0 ? 'completed_sessions' : 'explicit_block_actual',
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
