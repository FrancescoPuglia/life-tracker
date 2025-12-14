// 🎯 GOAL-TO-PLAN ENGINE - Automatic Action Generation
// MODALITÀ PSICOPATICO CERTOSINO 🔥

import {
  GoalToPlanEngine, GoalDecomposition, Milestone, WeeklyScheduleRecommendation,
  TimeSlot, UserPreferences
} from '@/types/ai-enhanced';
import { Goal, KeyResult, Task, TimeBlock } from '@/types';

interface DecompositionStrategy {
  name: string;
  description: string;
  apply: (goal: Goal, keyResults: KeyResult[]) => Promise<Milestone[]>;
}

export class SmartGoalToPlanEngine implements GoalToPlanEngine {
  private strategies: DecompositionStrategy[];

  constructor() {
    this.strategies = [
      this.createTimeBasedStrategy(),
      this.createMilestoneBasedStrategy(),
      this.createSkillBasedStrategy(),
      this.createProjectBasedStrategy(),
      this.createHabitBasedStrategy()
    ];
  }

  // 🎯 MAIN DECOMPOSITION METHOD
  async decompose(goal: Goal, keyResults: KeyResult[]): Promise<GoalDecomposition> {
    console.log('🎯 GOAL DECOMPOSITION: Starting for goal:', goal.title);

    try {
      // Generate milestones using best strategy
      const milestones = await this.generateMilestones(goal, keyResults);
      console.log('🎯 Generated', milestones.length, 'milestones');

      // Generate tasks for each milestone
      const tasks = await this.generateTasks(milestones);
      console.log('🎯 Generated', tasks.length, 'tasks');

      // Generate time blocks for immediate execution
      const timeBlocks = await this.generateTimeBlocks(tasks, goal);
      console.log('🎯 Generated', timeBlocks.length, 'time blocks');

      // Create weekly schedule recommendation
      const weeklySchedule = await this.recommendSchedule(goal, tasks);

      const decomposition: GoalDecomposition = {
        goal,
        milestones,
        tasks,
        timeBlocks,
        weeklySchedule
      };

      console.log('🎯 GOAL DECOMPOSITION COMPLETE:', decomposition);
      return decomposition;

    } catch (error) {
      console.error('🎯 GOAL DECOMPOSITION ERROR:', error);
      throw new Error(`Failed to decompose goal: ${(error as Error).message}`);
    }
  }

  // 🏆 MILESTONE GENERATION
  async generateMilestones(goal: Goal, keyResults: KeyResult[]): Promise<Milestone[]> {
    console.log('🏆 MILESTONE GENERATION: For goal', goal.title);

    // Choose best strategy based on goal characteristics
    const strategy = this.selectBestStrategy(goal, keyResults);
    console.log('🏆 Using strategy:', strategy.name);

    const milestones = await strategy.apply(goal, keyResults);

    // Enhance milestones with dependencies and ordering
    const enhancedMilestones = this.enhanceMilestonesWithDependencies(milestones);
    
    // Validate and adjust timeline
    const validatedMilestones = this.validateMilestoneTimeline(enhancedMilestones, goal);

    return validatedMilestones;
  }

  // 📋 TASK GENERATION
  async generateTasks(milestones: Milestone[]): Promise<Task[]> {
    console.log('📋 TASK GENERATION: For', milestones.length, 'milestones');
    
    const allTasks: Task[] = [];

    for (const milestone of milestones) {
      console.log('📋 Generating tasks for milestone:', milestone.title);
      
      const milestoneTasks = await this.generateTasksForMilestone(milestone);
      allTasks.push(...milestoneTasks);
      
      // Update milestone with task IDs
      milestone.tasks = milestoneTasks.map(t => t.id);
    }

    // Add inter-milestone dependencies
    const tasksWithDependencies = this.addTaskDependencies(allTasks, milestones);
    
    return tasksWithDependencies;
  }

  // ⏰ TIME BLOCK GENERATION
  async generateTimeBlocks(tasks: Task[], goal: Goal): Promise<TimeBlock[]> {
    console.log('⏰ TIME BLOCK GENERATION: For', tasks.length, 'tasks');
    
    const timeBlocks: TimeBlock[] = [];
    const now = new Date();
    
    // Get next 7 days for scheduling
    const schedulingWindow = 7;
    
    for (let dayOffset = 0; dayOffset < schedulingWindow; dayOffset++) {
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + dayOffset);
      
      // Get high-priority tasks that could be scheduled today
      const candidateTasks = tasks.filter(task => 
        task.priority === 'high'
      ).slice(0, 3); // Max 3 time blocks per day
      
      for (const task of candidateTasks) {
        const timeBlock = this.createTimeBlockForTask(task, targetDate, goal);
        if (timeBlock) {
          timeBlocks.push(timeBlock);
        }
      }
    }
    
    return timeBlocks;
  }

  // 📅 SCHEDULE RECOMMENDATION
  async recommendSchedule(goal: Goal, tasks: Task[]): Promise<WeeklyScheduleRecommendation> {
    console.log('📅 SCHEDULE RECOMMENDATION: For goal', goal.title);

    // Calculate total estimated hours
    const totalHours = tasks.reduce((sum, task) => {
      return sum + (task.estimatedMinutes ? task.estimatedMinutes / 60 : 1);
    }, 0);

    // Recommend weekly hours (spread over realistic timeframe)
    const recommendedHoursPerWeek = Math.min(totalHours / 4, 10); // Max 10h/week per goal

    // Determine best days based on goal type
    const preferredDays = this.getPreferredDaysForGoal(goal);
    
    // Suggest optimal time slots
    const preferredTimeSlots = this.getPreferredTimeSlotsForGoal(goal);

    const reasoning = this.generateScheduleReasoning(goal, tasks, recommendedHoursPerWeek);

    return {
      goalId: goal.id,
      recommendedHoursPerWeek,
      preferredDays,
      preferredTimeSlots,
      reasoning
    };
  }

  // 🧠 STRATEGY IMPLEMENTATIONS
  private createTimeBasedStrategy(): DecompositionStrategy {
    return {
      name: 'Time-Based Decomposition',
      description: 'Break goal into time-based phases',
      apply: async (goal: Goal, keyResults: KeyResult[]) => {
        const milestones: Milestone[] = [];
        const timeframe = this.calculateGoalTimeframe(goal);
        const phases = Math.max(3, Math.min(8, Math.floor(timeframe / 30))); // 3-8 phases
        
        for (let i = 0; i < phases; i++) {
          const phaseStart = new Date();
          phaseStart.setDate(phaseStart.getDate() + (i * timeframe / phases));
          
          const phaseEnd = new Date();
          phaseEnd.setDate(phaseEnd.getDate() + ((i + 1) * timeframe / phases));

          milestones.push({
            id: `milestone-${goal.id}-phase-${i + 1}`,
            goalId: goal.id,
            title: `${goal.title} - Phase ${i + 1}`,
            description: `Complete phase ${i + 1} of ${phases} for ${goal.title}`,
            deadline: phaseEnd,
            progress: 0,
            tasks: [],
            dependencies: i > 0 ? [`milestone-${goal.id}-phase-${i}`] : undefined
          });
        }
        
        return milestones;
      }
    };
  }

  private createMilestoneBasedStrategy(): DecompositionStrategy {
    return {
      name: 'Milestone-Based Decomposition',
      description: 'Use key results as major milestones',
      apply: async (goal: Goal, keyResults: KeyResult[]) => {
        const milestones: Milestone[] = [];
        
        if (keyResults.length === 0) {
          // Create generic milestones
          return this.createGenericMilestones(goal);
        }
        
        for (let i = 0; i < keyResults.length; i++) {
          const kr = keyResults[i];
          const deadline = this.calculateMilestoneDeadline(goal, i, keyResults.length);
          
          milestones.push({
            id: `milestone-${goal.id}-kr-${kr.id}`,
            goalId: goal.id,
            title: kr.title,
            description: kr.description || `Achieve key result: ${kr.title}`,
            deadline,
            progress: kr.progress || 0,
            tasks: []
          });
        }
        
        return milestones;
      }
    };
  }

  private createSkillBasedStrategy(): DecompositionStrategy {
    return {
      name: 'Skill-Based Decomposition',
      description: 'Break down by skills to develop',
      apply: async (goal: Goal, keyResults: KeyResult[]) => {
        const skills = this.identifyRequiredSkills(goal);
        const milestones: Milestone[] = [];
        
        for (let i = 0; i < skills.length; i++) {
          const skill = skills[i];
          const deadline = new Date();
          deadline.setDate(deadline.getDate() + (i + 1) * 21); // 3 weeks per skill
          
          milestones.push({
            id: `milestone-${goal.id}-skill-${i}`,
            goalId: goal.id,
            title: `Master ${skill}`,
            description: `Develop ${skill} skill for ${goal.title}`,
            deadline,
            progress: 0,
            tasks: []
          });
        }
        
        return milestones;
      }
    };
  }

  private createProjectBasedStrategy(): DecompositionStrategy {
    return {
      name: 'Project-Based Decomposition',
      description: 'Break into sub-projects or deliverables',
      apply: async (goal: Goal, keyResults: KeyResult[]) => {
        const projects = this.identifySubProjects(goal);
        const milestones: Milestone[] = [];
        
        for (let i = 0; i < projects.length; i++) {
          const project = projects[i];
          const deadline = new Date();
          deadline.setDate(deadline.getDate() + (i + 1) * 45); // 6-7 weeks per project
          
          milestones.push({
            id: `milestone-${goal.id}-project-${i}`,
            goalId: goal.id,
            title: `Complete ${project}`,
            description: `Finish ${project} component of ${goal.title}`,
            deadline,
            progress: 0,
            tasks: []
          });
        }
        
        return milestones;
      }
    };
  }

  private createHabitBasedStrategy(): DecompositionStrategy {
    return {
      name: 'Habit-Based Decomposition',
      description: 'Build through consistent habits',
      apply: async (goal: Goal, keyResults: KeyResult[]) => {
        const habits = this.identifyRequiredHabits(goal);
        const milestones: Milestone[] = [];
        
        for (let i = 0; i < 4; i++) { // Quarterly milestones
          const deadline = new Date();
          deadline.setDate(deadline.getDate() + (i + 1) * 90); // 3 months each
          
          milestones.push({
            id: `milestone-${goal.id}-habit-q${i + 1}`,
            goalId: goal.id,
            title: `Q${i + 1} Habit Consistency`,
            description: `Maintain required habits for ${goal.title} - Quarter ${i + 1}`,
            deadline,
            progress: 0,
            tasks: []
          });
        }
        
        return milestones;
      }
    };
  }

  // 🧩 HELPER METHODS
  private selectBestStrategy(goal: Goal, keyResults: KeyResult[]): DecompositionStrategy {
    // Analyze goal characteristics to choose best strategy
    const goalText = (goal.title + ' ' + (goal.description || '')).toLowerCase();
    
    if (keyResults.length >= 3) {
      return this.strategies.find(s => s.name === 'Milestone-Based Decomposition')!;
    }
    
    if (goalText.includes('learn') || goalText.includes('skill') || goalText.includes('master')) {
      return this.strategies.find(s => s.name === 'Skill-Based Decomposition')!;
    }
    
    if (goalText.includes('habit') || goalText.includes('daily') || goalText.includes('routine')) {
      return this.strategies.find(s => s.name === 'Habit-Based Decomposition')!;
    }
    
    if (goalText.includes('project') || goalText.includes('build') || goalText.includes('create')) {
      return this.strategies.find(s => s.name === 'Project-Based Decomposition')!;
    }
    
    // Default to time-based
    return this.strategies.find(s => s.name === 'Time-Based Decomposition')!;
  }

  private calculateGoalTimeframe(goal: Goal): number {
    if (goal.deadline) {
      const now = new Date();
      const deadline = new Date(goal.deadline);
      return Math.max(30, Math.floor((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    }
    
    // Default timeframes based on goal type
    const goalText = goal.title.toLowerCase();
    if (goalText.includes('year')) return 365;
    if (goalText.includes('quarter')) return 90;
    if (goalText.includes('month')) return 30;
    if (goalText.includes('week')) return 7;
    
    return 90; // Default 3 months
  }

  private identifyRequiredSkills(goal: Goal): string[] {
    const goalText = (goal.title + ' ' + (goal.description || '')).toLowerCase();
    
    const skillMappings: Record<string, string[]> = {
      'programming': ['Algorithm Design', 'Code Architecture', 'Testing', 'Debugging'],
      'design': ['Visual Design', 'User Research', 'Prototyping', 'Design Systems'],
      'business': ['Market Research', 'Financial Planning', 'Strategy', 'Operations'],
      'fitness': ['Exercise Form', 'Nutrition Planning', 'Recovery', 'Goal Setting'],
      'learning': ['Research Skills', 'Note Taking', 'Practice Methods', 'Application']
    };
    
    for (const [domain, skills] of Object.entries(skillMappings)) {
      if (goalText.includes(domain)) {
        return skills;
      }
    }
    
    // Generic skills
    return ['Planning', 'Execution', 'Review', 'Optimization'];
  }

  private identifySubProjects(goal: Goal): string[] {
    const goalText = goal.title.toLowerCase();
    
    if (goalText.includes('app') || goalText.includes('software')) {
      return ['Requirements Analysis', 'Design & Architecture', 'Development', 'Testing', 'Deployment'];
    }
    
    if (goalText.includes('business') || goalText.includes('startup')) {
      return ['Market Research', 'Business Plan', 'MVP Development', 'Marketing Strategy', 'Launch'];
    }
    
    if (goalText.includes('book') || goalText.includes('write')) {
      return ['Research & Outline', 'First Draft', 'Revision', 'Editing', 'Publishing'];
    }
    
    // Generic projects
    return ['Planning', 'Foundation', 'Development', 'Refinement', 'Completion'];
  }

  private identifyRequiredHabits(goal: Goal): string[] {
    const goalText = (goal.title + ' ' + (goal.description || '')).toLowerCase();
    
    const habitMappings: Record<string, string[]> = {
      'fitness': ['Daily Exercise', 'Meal Planning', 'Sleep Schedule', 'Progress Tracking'],
      'learning': ['Daily Reading', 'Practice Sessions', 'Note Review', 'Skill Application'],
      'productivity': ['Daily Planning', 'Focus Blocks', 'Review Sessions', 'Task Completion'],
      'creative': ['Daily Practice', 'Inspiration Gathering', 'Skill Building', 'Project Work']
    };
    
    for (const [domain, habits] of Object.entries(habitMappings)) {
      if (goalText.includes(domain)) {
        return habits;
      }
    }
    
    return ['Daily Progress', 'Weekly Review', 'Monthly Assessment', 'Continuous Improvement'];
  }

  private createGenericMilestones(goal: Goal): Milestone[] {
    const phases = ['Foundation', 'Development', 'Refinement', 'Completion'];
    const milestones: Milestone[] = [];
    
    for (let i = 0; i < phases.length; i++) {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + (i + 1) * 30); // Monthly milestones
      
      milestones.push({
        id: `milestone-${goal.id}-generic-${i}`,
        goalId: goal.id,
        title: `${phases[i]} Phase`,
        description: `Complete ${phases[i].toLowerCase()} phase of ${goal.title}`,
        deadline,
        progress: 0,
        tasks: []
      });
    }
    
    return milestones;
  }

  private generateTasksForMilestone(milestone: Milestone): Task[] {
    const tasks: Task[] = [];
    const taskTemplates = this.getTaskTemplatesForMilestone(milestone);
    
    for (let i = 0; i < taskTemplates.length; i++) {
      const template = taskTemplates[i];
      
      tasks.push({
        id: `task-${milestone.id}-${i}`,
        title: template.title,
        description: template.description,
        estimatedDuration: template.estimatedDuration,
        priority: template.priority,
        status: 'todo',
        userId: 'user-1',
        goalIds: [milestone.goalId],
        tags: [milestone.title.split(' ')[0].toLowerCase()],
        createdAt: new Date(),
        updatedAt: new Date(),
        deadline: template.deadline
      });
    }
    
    return tasks;
  }

  private getTaskTemplatesForMilestone(milestone: Milestone): any[] {
    const title = milestone.title.toLowerCase();
    
    if (title.includes('planning') || title.includes('foundation')) {
      return [
        { title: 'Define requirements and scope', estimatedDuration: 120, priority: 'high' as const },
        { title: 'Research best practices', estimatedDuration: 90, priority: 'medium' as const },
        { title: 'Create initial plan', estimatedDuration: 60, priority: 'high' as const },
        { title: 'Set up tools and environment', estimatedDuration: 45, priority: 'medium' as const }
      ];
    }
    
    if (title.includes('development') || title.includes('building')) {
      return [
        { title: 'Start core implementation', estimatedDuration: 180, priority: 'high' as const },
        { title: 'Develop key features', estimatedDuration: 240, priority: 'high' as const },
        { title: 'Create supporting materials', estimatedDuration: 120, priority: 'medium' as const },
        { title: 'Test and validate approach', estimatedDuration: 90, priority: 'high' as const }
      ];
    }
    
    if (title.includes('completion') || title.includes('final')) {
      return [
        { title: 'Final review and polish', estimatedDuration: 90, priority: 'high' as const },
        { title: 'Documentation and cleanup', estimatedDuration: 60, priority: 'medium' as const },
        { title: 'Prepare for next phase', estimatedDuration: 30, priority: 'low' as const },
        { title: 'Celebrate completion!', estimatedDuration: 15, priority: 'low' as const }
      ];
    }
    
    // Generic tasks
    return [
      { title: `Work on ${milestone.title}`, estimatedDuration: 120, priority: 'medium' as const },
      { title: `Review progress on ${milestone.title}`, estimatedDuration: 30, priority: 'low' as const },
      { title: `Plan next steps for ${milestone.title}`, estimatedDuration: 45, priority: 'medium' as const }
    ];
  }

  private createTimeBlockForTask(task: Task, targetDate: Date, goal: Goal): TimeBlock | null {
    // Smart scheduling based on task type and goal priority
    const duration = task.estimatedDuration || 60;
    
    if (duration < 30) return null; // Skip very short tasks
    
    // Default to morning for important tasks
    const startHour = task.priority === 'critical' || task.priority === 'high' ? 9 : 14;
    
    const startTime = new Date(targetDate);
    startTime.setHours(startHour, 0, 0, 0);
    
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + duration);
    
    return {
      id: `block-${task.id}-${targetDate.toISOString().split('T')[0]}`,
      title: task.title,
      description: `Auto-scheduled for ${goal.title}`,
      startTime,
      endTime,
      type: 'work',
      status: 'planned',
      userId: 'user-1',
      domainId: 'domain-1',
      taskIds: [task.id],
      goalIds: [goal.id],
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  private enhanceMilestonesWithDependencies(milestones: Milestone[]): Milestone[] {
    // Add logical dependencies between milestones
    for (let i = 1; i < milestones.length; i++) {
      if (!milestones[i].dependencies) {
        milestones[i].dependencies = [milestones[i - 1].id];
      }
    }
    
    return milestones;
  }

  private validateMilestoneTimeline(milestones: Milestone[], goal: Goal): Milestone[] {
    // Ensure milestones have reasonable deadlines
    const now = new Date();
    
    return milestones.map((milestone, index) => {
      const minDeadline = new Date(now);
      minDeadline.setDate(minDeadline.getDate() + (index + 1) * 14); // Minimum 2 weeks apart
      
      if (!milestone.deadline || milestone.deadline < minDeadline) {
        milestone.deadline = minDeadline;
      }
      
      // Ensure deadline is before goal deadline
      if (goal.deadline && milestone.deadline > new Date(goal.deadline)) {
        const goalDeadline = new Date(goal.deadline);
        const daysBeforeGoal = (index + 1) * 7; // Stagger milestones weekly before goal
        milestone.deadline = new Date(goalDeadline.getTime() - daysBeforeGoal * 24 * 60 * 60 * 1000);
      }
      
      return milestone;
    });
  }

  private calculateMilestoneDeadline(goal: Goal, index: number, total: number): Date {
    const now = new Date();
    const goalDeadline = goal.deadline ? new Date(goal.deadline) : new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    
    const totalDuration = goalDeadline.getTime() - now.getTime();
    const milestoneInterval = totalDuration / total;
    
    return new Date(now.getTime() + (index + 1) * milestoneInterval);
  }

  private addTaskDependencies(tasks: Task[], milestones: Milestone[]): Task[] {
    // Add dependencies between tasks in different milestones
    const milestoneGroups = new Map<string, Task[]>();
    
    // Group tasks by milestone
    for (const task of tasks) {
      const milestoneId = task.goalIds?.[0] ? 
        milestones.find(m => m.tasks.includes(task.id))?.id : null;
      
      if (milestoneId) {
        if (!milestoneGroups.has(milestoneId)) {
          milestoneGroups.set(milestoneId, []);
        }
        milestoneGroups.get(milestoneId)!.push(task);
      }
    }
    
    return tasks; // For now, return as-is
  }

  private getPreferredDaysForGoal(goal: Goal): string[] {
    const goalText = goal.title.toLowerCase();
    
    if (goalText.includes('fitness') || goalText.includes('exercise')) {
      return ['monday', 'wednesday', 'friday']; // MWF schedule
    }
    
    if (goalText.includes('learning') || goalText.includes('study')) {
      return ['tuesday', 'thursday', 'saturday']; // Learning days
    }
    
    if (goalText.includes('creative') || goalText.includes('art') || goalText.includes('write')) {
      return ['saturday', 'sunday']; // Creative weekends
    }
    
    // Default business days
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  }

  private getPreferredTimeSlotsForGoal(goal: Goal): TimeSlot[] {
    const goalText = goal.title.toLowerCase();
    
    if (goalText.includes('fitness') || goalText.includes('exercise')) {
      return [
        { start: '07:00', end: '08:00', days: ['monday', 'wednesday', 'friday'] },
        { start: '18:00', end: '19:00', days: ['tuesday', 'thursday'] }
      ];
    }
    
    if (goalText.includes('creative') || goalText.includes('write')) {
      return [
        { start: '06:00', end: '08:00', days: ['saturday', 'sunday'] }
      ];
    }
    
    // Default work hours
    return [
      { start: '09:00', end: '11:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
      { start: '14:00', end: '16:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] }
    ];
  }

  private generateScheduleReasoning(goal: Goal, tasks: Task[], hoursPerWeek: number): string {
    const reasons = [];
    
    reasons.push(`Allocated ${hoursPerWeek.toFixed(1)} hours per week based on ${tasks.length} tasks`);
    
    if (goal.priority === 'high' || goal.priority === 'critical') {
      reasons.push('High priority goal requires consistent daily attention');
    }
    
    const avgTaskDuration = tasks.reduce((sum, t) => sum + (t.estimatedDuration || 60), 0) / tasks.length / 60;
    if (avgTaskDuration > 2) {
      reasons.push('Tasks require focused deep work sessions');
    }
    
    if (goal.deadline) {
      const daysUntilDeadline = Math.floor((new Date(goal.deadline).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      reasons.push(`${daysUntilDeadline} days until deadline requires steady progress`);
    }
    
    return reasons.join('. ') + '.';
  }
}

// 🔥 EXPORT SINGLETON
export const goalToPlanEngine = new SmartGoalToPlanEngine();