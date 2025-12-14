// 🔄 RE-PLANNING ENGINE - Real-Time Dynamic Adaptation
// MODALITÀ PSICOPATICO ESTREMO 🔥🔥🔥🔥

import {
  RePlanningEngine, RePlanningTrigger, RePlanningOptions, RePlanningResult,
  ScheduleChange, AlternativeSchedule
} from '@/types/ai-enhanced';
import { TimeBlock, Task, Goal } from '@/types';
import { autoScheduler } from './autoScheduler';
import { audioManager } from './audioManager';

interface AdaptationContext {
  currentSchedule: TimeBlock[];
  remainingTasks: Task[];
  goals: Goal[];
  userEnergyLevel: number;
  currentTime: Date;
  workingHoursRemaining: number;
  disruptionSeverity: 'low' | 'medium' | 'high' | 'critical';
}

interface RealTimeMetrics {
  plannedVsActual: number;
  energyDrift: number;
  goalProgressRate: number;
  contextSwitches: number;
  bufferUtilization: number;
  stressLevel: number;
}

interface EmergencyMode {
  active: boolean;
  reason: string;
  fallbackStrategy: 'compress' | 'postpone' | 'delegate' | 'simplify';
  recoveryTime: number; // minutes needed
}

export class UltraSmartRePlanningEngine implements RePlanningEngine {
  private adaptationHistory: RePlanningResult[] = [];
  private realTimeMetrics: RealTimeMetrics = {
    plannedVsActual: 1.0,
    energyDrift: 0,
    goalProgressRate: 1.0,
    contextSwitches: 0,
    bufferUtilization: 0.5,
    stressLevel: 0.3
  };
  private emergencyMode: EmergencyMode = {
    active: false,
    reason: '',
    fallbackStrategy: 'compress',
    recoveryTime: 0
  };

  // 🎯 MAIN RE-PLANNING HANDLER
  async handleTrigger(trigger: RePlanningTrigger, options: RePlanningOptions): Promise<RePlanningResult> {
    console.log('🔄 RE-PLANNING ENGINE: Processing trigger', trigger.type, 'with strategy', options.strategy);
    
    try {
      // 🔥 ANALYZE DISRUPTION IMPACT
      const context = await this.analyzeDisruptionContext(trigger, options);
      
      // 🧠 SELECT ADAPTIVE STRATEGY
      const adaptiveStrategy = this.selectOptimalAdaptiveStrategy(trigger, context, options);
      
      // ⚡ EXECUTE RE-PLANNING
      const result = await this.executeAdaptiveRePlanning(trigger, context, adaptiveStrategy, options);
      
      // 📊 LEARN FROM ADAPTATION
      await this.updateAdaptationIntelligence(trigger, result, context);
      
      // 🎮 PROVIDE FEEDBACK
      this.provideFeedback(result, trigger);
      
      console.log('🔄 RE-PLANNING COMPLETE:', result);
      return result;

    } catch (error) {
      console.error('🔄 RE-PLANNING CRITICAL ERROR:', error);
      return this.createEmergencyFallback(trigger, options);
    }
  }

  // 🚨 EMERGENCY RECOVERY SUGGESTIONS
  async suggestRecovery(missedBlocks: TimeBlock[], remainingDay: TimeBlock[]): Promise<RePlanningResult> {
    console.log('🚨 RECOVERY MODE: Handling', missedBlocks.length, 'missed blocks');
    
    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(18, 0, 0, 0); // Assume 6 PM end
    
    const availableMinutes = Math.max(0, (endOfDay.getTime() - now.getTime()) / (1000 * 60));
    
    if (availableMinutes < 30) {
      // CRITICAL: Less than 30 minutes left
      return this.handleCriticalTimeShortage(missedBlocks, remainingDay);
    }
    
    // 🔥 RECOVERY STRATEGIES
    const recoveryStrategies = [
      this.createCompressionRecovery(missedBlocks, remainingDay, availableMinutes),
      this.createPostponementRecovery(missedBlocks, remainingDay),
      this.createSimplificationRecovery(missedBlocks, remainingDay),
      this.createInterleavingRecovery(missedBlocks, remainingDay)
    ];
    
    // Select best recovery strategy
    const bestStrategy = recoveryStrategies.reduce((best, current) => 
      current.confidence > best.confidence ? current : best
    );
    
    return bestStrategy;
  }

  // ⚡ ENERGY-BASED ADAPTATION
  async adaptToEnergyChange(currentEnergy: number, originalSchedule: TimeBlock[]): Promise<RePlanningResult> {
    console.log('⚡ ENERGY ADAPTATION: Current energy', currentEnergy, 'vs planned');
    
    const energyDrift = this.calculateEnergyDrift(currentEnergy, originalSchedule);
    const adaptationNeeded = Math.abs(energyDrift) > 0.3; // 30% threshold
    
    if (!adaptationNeeded) {
      return this.createNoChangeResult('Energy levels within acceptable range');
    }

    const newSchedule: TimeBlock[] = [];
    const changes: ScheduleChange[] = [];
    const now = new Date();
    
    for (const block of originalSchedule) {
      const blockStart = new Date(block.startTime);
      
      // Skip past blocks
      if (blockStart <= now) {
        newSchedule.push(block);
        continue;
      }
      
      const optimalEnergy = this.getOptimalEnergyForBlock(block);
      const energyMismatch = Math.abs(currentEnergy - optimalEnergy);
      
      if (energyMismatch > 0.4) {
        // Significant mismatch - adapt the block
        const adaptedBlock = await this.adaptBlockForEnergy(block, currentEnergy, originalSchedule);
        
        if (adaptedBlock.id !== block.id || 
            adaptedBlock.startTime.getTime() !== block.startTime.getTime()) {
          changes.push({
            type: 'moved',
            originalBlock: block,
            newBlock: adaptedBlock,
            reasoning: `Energy adaptation: moved to better match current energy level (${Math.round(currentEnergy * 100)}%)`
          });
        }
        
        newSchedule.push(adaptedBlock);
      } else {
        newSchedule.push(block);
      }
    }
    
    return {
      confidence: 0.7,
      newSchedule,
      changes,
      alternatives: await this.generateEnergyAlternatives(currentEnergy, originalSchedule),
      reasoning: `Schedule adapted for current energy level (${Math.round(currentEnergy * 100)}%). ${changes.length} changes made.`,
      impact: {
        goalsAffected: this.getAffectedGoals(changes),
        deadlinesRisk: this.assessDeadlineRisk(changes),
        energyImpact: energyDrift > 0 ? 'positive' : 'negative'
      }
    };
  }

  // 🧠 DISRUPTION ANALYSIS
  private async analyzeDisruptionContext(trigger: RePlanningTrigger, options: RePlanningOptions): Promise<AdaptationContext> {
    const now = new Date();
    const endOfWorkDay = new Date(now);
    endOfWorkDay.setHours(18, 0, 0, 0);
    
    const workingHoursRemaining = Math.max(0, (endOfWorkDay.getTime() - now.getTime()) / (1000 * 60 * 60));
    
    // Assess disruption severity
    let disruptionSeverity: 'low' | 'medium' | 'high' | 'critical' = 'low';
    
    switch (trigger.type) {
      case 'session_end':
        disruptionSeverity = 'low';
        break;
      case 'overrun':
        const overrunMinutes = trigger.context.overrunDuration || 0;
        if (overrunMinutes > 60) disruptionSeverity = 'high';
        else if (overrunMinutes > 30) disruptionSeverity = 'medium';
        else disruptionSeverity = 'low';
        break;
      case 'missed_block':
        disruptionSeverity = 'medium';
        break;
      case 'external_interrupt':
        const interruptDuration = trigger.context.estimatedDuration || 0;
        if (interruptDuration > 120) disruptionSeverity = 'critical';
        else if (interruptDuration > 60) disruptionSeverity = 'high';
        else disruptionSeverity = 'medium';
        break;
      case 'energy_change':
        const energyDrop = trigger.context.energyDrop || 0;
        if (energyDrop > 0.5) disruptionSeverity = 'high';
        else if (energyDrop > 0.3) disruptionSeverity = 'medium';
        else disruptionSeverity = 'low';
        break;
    }

    return {
      currentSchedule: trigger.context.currentSchedule || [],
      remainingTasks: trigger.context.remainingTasks || [],
      goals: trigger.context.goals || [],
      userEnergyLevel: trigger.context.currentEnergy || 0.7,
      currentTime: now,
      workingHoursRemaining,
      disruptionSeverity
    };
  }

  // 🎯 ADAPTIVE STRATEGY SELECTION
  private selectOptimalAdaptiveStrategy(
    trigger: RePlanningTrigger, 
    context: AdaptationContext, 
    options: RePlanningOptions
  ): string {
    const strategies = {
      'micro_adjustment': { cost: 0.1, effectiveness: 0.6, timeRequired: 5 },
      'block_compression': { cost: 0.3, effectiveness: 0.8, timeRequired: 10 },
      'schedule_shift': { cost: 0.5, effectiveness: 0.9, timeRequired: 15 },
      'goal_reprioritization': { cost: 0.7, effectiveness: 0.95, timeRequired: 20 },
      'emergency_simplification': { cost: 0.9, effectiveness: 0.7, timeRequired: 30 }
    };

    // Factor in user strategy preference
    if (options.strategy === 'minimal_change') {
      return 'micro_adjustment';
    } else if (options.strategy === 'save_day') {
      return context.disruptionSeverity === 'critical' ? 'emergency_simplification' : 'block_compression';
    } else if (options.strategy === 'save_goal') {
      return 'goal_reprioritization';
    } else if (options.strategy === 'save_energy') {
      return context.userEnergyLevel < 0.3 ? 'emergency_simplification' : 'schedule_shift';
    }

    // Smart selection based on context
    if (context.disruptionSeverity === 'critical' || context.workingHoursRemaining < 2) {
      return 'emergency_simplification';
    } else if (context.disruptionSeverity === 'high' || context.workingHoursRemaining < 4) {
      return 'goal_reprioritization';
    } else if (context.disruptionSeverity === 'medium') {
      return 'schedule_shift';
    } else {
      return 'micro_adjustment';
    }
  }

  // ⚡ EXECUTE ADAPTIVE RE-PLANNING
  private async executeAdaptiveRePlanning(
    trigger: RePlanningTrigger,
    context: AdaptationContext,
    strategy: string,
    options: RePlanningOptions
  ): Promise<RePlanningResult> {
    console.log('⚡ EXECUTING STRATEGY:', strategy);

    switch (strategy) {
      case 'micro_adjustment':
        return this.executeMicroAdjustment(trigger, context, options);
      
      case 'block_compression':
        return this.executeBlockCompression(trigger, context, options);
      
      case 'schedule_shift':
        return this.executeScheduleShift(trigger, context, options);
      
      case 'goal_reprioritization':
        return this.executeGoalReprioritization(trigger, context, options);
      
      case 'emergency_simplification':
        return this.executeEmergencySimplification(trigger, context, options);
      
      default:
        return this.executeBlockCompression(trigger, context, options);
    }
  }

  // 🔧 MICRO ADJUSTMENT STRATEGY
  private async executeMicroAdjustment(
    trigger: RePlanningTrigger,
    context: AdaptationContext,
    options: RePlanningOptions
  ): Promise<RePlanningResult> {
    const newSchedule = [...context.currentSchedule];
    const changes: ScheduleChange[] = [];
    
    // Find next block to adjust
    const now = context.currentTime;
    const nextBlock = newSchedule.find(block => new Date(block.startTime) > now);
    
    if (nextBlock && trigger.type === 'overrun') {
      // Slight delay to next block
      const delay = Math.min(15, trigger.context.overrunDuration || 10); // Max 15 min delay
      
      const adjustedBlock = {
        ...nextBlock,
        startTime: new Date(nextBlock.startTime.getTime() + delay * 60 * 1000),
        endTime: new Date(nextBlock.endTime.getTime() + delay * 60 * 1000)
      };
      
      const blockIndex = newSchedule.findIndex(b => b.id === nextBlock.id);
      newSchedule[blockIndex] = adjustedBlock;
      
      changes.push({
        type: 'moved',
        originalBlock: nextBlock,
        newBlock: adjustedBlock,
        reasoning: `Micro-adjustment: delayed by ${delay} minutes due to ${trigger.type}`
      });
    }
    
    return {
      confidence: 0.7,
      newSchedule,
      changes,
      alternatives: [],
      reasoning: `Minor adjustment made to accommodate ${trigger.type}. Minimal impact on schedule.`,
      impact: {
        goalsAffected: [],
        deadlinesRisk: [],
        energyImpact: 'neutral'
      }
    };
  }

  // 🗜️ BLOCK COMPRESSION STRATEGY
  private async executeBlockCompression(
    trigger: RePlanningTrigger,
    context: AdaptationContext,
    options: RePlanningOptions
  ): Promise<RePlanningResult> {
    const newSchedule: TimeBlock[] = [];
    const changes: ScheduleChange[] = [];
    const now = context.currentTime;
    
    let compressionTarget = 0; // minutes to recover
    
    if (trigger.type === 'overrun') {
      compressionTarget = trigger.context.overrunDuration || 30;
    } else if (trigger.type === 'external_interrupt') {
      compressionTarget = trigger.context.estimatedDuration || 60;
    } else {
      compressionTarget = 30; // Default
    }
    
    let remainingCompression = compressionTarget;
    
    for (const block of context.currentSchedule) {
      const blockStart = new Date(block.startTime);
      
      // Skip past blocks
      if (blockStart <= now) {
        newSchedule.push(block);
        continue;
      }
      
      if (remainingCompression > 0 && this.canCompress(block)) {
        const maxCompression = this.getMaxCompressionForBlock(block);
        const actualCompression = Math.min(remainingCompression, maxCompression);
        
        const compressedBlock = {
          ...block,
          endTime: new Date(block.endTime.getTime() - actualCompression * 60 * 1000)
        };
        
        newSchedule.push(compressedBlock);
        remainingCompression -= actualCompression;
        
        changes.push({
          type: 'shortened',
          originalBlock: block,
          newBlock: compressedBlock,
          reasoning: `Compressed by ${actualCompression} minutes to recover schedule`
        });
      } else {
        newSchedule.push(block);
      }
    }
    
    return {
      confidence: 0.7,
      newSchedule,
      changes,
      alternatives: await this.generateCompressionAlternatives(context, compressionTarget),
      reasoning: `Schedule compressed to recover ${compressionTarget} minutes. ${changes.length} blocks affected.`,
      impact: {
        goalsAffected: this.getAffectedGoals(changes),
        deadlinesRisk: this.assessDeadlineRisk(changes),
        energyImpact: 'negative' // Compression increases stress
      }
    };
  }

  // 📅 SCHEDULE SHIFT STRATEGY  
  private async executeScheduleShift(
    trigger: RePlanningTrigger,
    context: AdaptationContext,
    options: RePlanningOptions
  ): Promise<RePlanningResult> {
    const newSchedule: TimeBlock[] = [];
    const changes: ScheduleChange[] = [];
    const now = context.currentTime;
    
    // Calculate shift amount
    let shiftAmount = 0; // minutes
    if (trigger.type === 'overrun') {
      shiftAmount = trigger.context.overrunDuration || 30;
    } else if (trigger.type === 'external_interrupt') {
      shiftAmount = trigger.context.estimatedDuration || 60;
    }
    
    let cumulativeShift = 0;
    
    for (const block of context.currentSchedule) {
      const blockStart = new Date(block.startTime);
      
      // Skip past blocks
      if (blockStart <= now) {
        newSchedule.push(block);
        continue;
      }
      
      // Apply shift
      const shiftedBlock = {
        ...block,
        startTime: new Date(block.startTime.getTime() + cumulativeShift * 60 * 1000),
        endTime: new Date(block.endTime.getTime() + cumulativeShift * 60 * 1000)
      };
      
      newSchedule.push(shiftedBlock);
      
      if (cumulativeShift === 0 && shiftAmount > 0) {
        cumulativeShift = shiftAmount;
        changes.push({
          type: 'moved',
          originalBlock: block,
          newBlock: shiftedBlock,
          reasoning: `Shifted by ${shiftAmount} minutes due to ${trigger.type}`
        });
      }
    }
    
    return {
      confidence: 0.7,
      newSchedule,
      changes,
      alternatives: [],
      reasoning: `Schedule shifted by ${shiftAmount} minutes. Impact cascade managed through remaining blocks.`,
      impact: {
        goalsAffected: this.getAffectedGoals(changes),
        deadlinesRisk: this.assessDeadlineRisk(changes),
        energyImpact: 'neutral'
      }
    };
  }

  // 🎯 GOAL REPRIORITIZATION STRATEGY
  private async executeGoalReprioritization(
    trigger: RePlanningTrigger,
    context: AdaptationContext,
    options: RePlanningOptions
  ): Promise<RePlanningResult> {
    // Identify priority goals from options
    const priorityGoals = options.priorityGoals || [];
    const newSchedule: TimeBlock[] = [];
    const changes: ScheduleChange[] = [];
    const postponed: TimeBlock[] = [];
    
    const now = context.currentTime;
    
    // First pass: keep high-priority goal blocks
    for (const block of context.currentSchedule) {
      const blockStart = new Date(block.startTime);
      
      if (blockStart <= now) {
        newSchedule.push(block);
        continue;
      }
      
      const blockGoals = block.goalIds || [];
      const isHighPriority = blockGoals.some(goalId => priorityGoals.includes(goalId));
      const blockGoal = context.goals.find(g => blockGoals.includes(g.id));
      const isUrgentGoal = blockGoal && blockGoal.priority === 'high';
      
      if (isHighPriority || isUrgentGoal) {
        newSchedule.push(block);
      } else {
        postponed.push(block);
        changes.push({
          type: 'postponed',
          originalBlock: block,
          reasoning: `Postponed to prioritize high-priority goals`
        });
      }
    }
    
    // Try to fit some postponed blocks in available time
    const availableTime = context.workingHoursRemaining * 60; // Convert to minutes
    const scheduledTime = newSchedule.reduce((total, block) => {
      const duration = new Date(block.endTime).getTime() - new Date(block.startTime).getTime();
      return total + (duration / (1000 * 60));
    }, 0);
    
    const remainingTime = availableTime - scheduledTime;
    
    if (remainingTime > 30) {
      // Try to fit highest priority postponed blocks
      const sortedPostponed = postponed.sort((a, b) => {
        const aPriority = this.getBlockPriority(a, context.goals);
        const bPriority = this.getBlockPriority(b, context.goals);
        return bPriority - aPriority;
      });
      
      let usedTime = 0;
      for (const block of sortedPostponed) {
        const blockDuration = (new Date(block.endTime).getTime() - new Date(block.startTime).getTime()) / (1000 * 60);
        
        if (usedTime + blockDuration <= remainingTime) {
          newSchedule.push(block);
          usedTime += blockDuration;
          
          // Remove from changes (no longer postponed)
          const changeIndex = changes.findIndex(c => c.originalBlock.id === block.id);
          if (changeIndex >= 0) {
            changes.splice(changeIndex, 1);
          }
        }
      }
    }
    
    return {
      confidence: 0.7,
      newSchedule,
      changes,
      alternatives: [],
      reasoning: `Schedule reprioritized to focus on high-priority goals. ${changes.length} blocks postponed.`,
      impact: {
        goalsAffected: priorityGoals,
        deadlinesRisk: this.assessDeadlineRisk(changes),
        energyImpact: 'positive' // Less stress from focusing
      }
    };
  }

  // 🚨 EMERGENCY SIMPLIFICATION
  private async executeEmergencySimplification(
    trigger: RePlanningTrigger,
    context: AdaptationContext,
    options: RePlanningOptions
  ): Promise<RePlanningResult> {
    console.log('🚨 EMERGENCY SIMPLIFICATION ACTIVATED');
    
    this.emergencyMode.active = true;
    this.emergencyMode.reason = `Critical disruption: ${trigger.type}`;
    this.emergencyMode.fallbackStrategy = 'simplify';
    
    const newSchedule: TimeBlock[] = [];
    const changes: ScheduleChange[] = [];
    const now = context.currentTime;
    
    // Keep only absolutely critical blocks
    for (const block of context.currentSchedule) {
      const blockStart = new Date(block.startTime);
      
      if (blockStart <= now) {
        newSchedule.push(block);
        continue;
      }
      
      const isCritical = this.isCriticalBlock(block, context);
      
      if (isCritical) {
        // Simplify the block (reduce scope/complexity)
        const simplifiedBlock = this.simplifyBlock(block);
        newSchedule.push(simplifiedBlock);
        
        if (simplifiedBlock.id !== block.id || 
            JSON.stringify(simplifiedBlock) !== JSON.stringify(block)) {
          changes.push({
            type: 'shortened',
            originalBlock: block,
            newBlock: simplifiedBlock,
            reasoning: 'Emergency simplification: reduced scope to essentials only'
          });
        }
      } else {
        changes.push({
          type: 'cancelled',
          originalBlock: block,
          reasoning: 'Emergency cancellation: non-critical block removed'
        });
      }
    }
    
    return {
      confidence: 0.7,
      newSchedule,
      changes,
      alternatives: [],
      reasoning: `Emergency simplification activated. Schedule reduced to critical items only due to ${trigger.type}.`,
      impact: {
        goalsAffected: this.getAffectedGoals(changes),
        deadlinesRisk: ['Some deadlines may be at risk due to emergency simplification'],
        energyImpact: 'positive' // Less overwhelming
      }
    };
  }

  // 🔄 RECOVERY STRATEGIES
  private createCompressionRecovery(
    missedBlocks: TimeBlock[],
    remainingDay: TimeBlock[],
    availableMinutes: number
  ): RePlanningResult {
    const newSchedule: TimeBlock[] = [];
    const changes: ScheduleChange[] = [];
    
    let compressionNeeded = missedBlocks.reduce((total, block) => {
      const duration = new Date(block.endTime).getTime() - new Date(block.startTime).getTime();
      return total + (duration / (1000 * 60));
    }, 0);
    
    compressionNeeded = Math.min(compressionNeeded, availableMinutes * 0.8); // Max 80% compression
    
    let remainingCompression = compressionNeeded;
    
    for (const block of remainingDay) {
      if (remainingCompression > 0 && this.canCompress(block)) {
        const maxCompression = this.getMaxCompressionForBlock(block);
        const actualCompression = Math.min(remainingCompression, maxCompression);
        
        const compressedBlock = {
          ...block,
          endTime: new Date(block.endTime.getTime() - actualCompression * 60 * 1000)
        };
        
        newSchedule.push(compressedBlock);
        remainingCompression -= actualCompression;
        
        changes.push({
          type: 'shortened',
          originalBlock: block,
          newBlock: compressedBlock,
          reasoning: `Compressed to recover missed work`
        });
      } else {
        newSchedule.push(block);
      }
    }
    
    return {
      confidence: 0.7,
      newSchedule,
      changes,
      alternatives: [],
      reasoning: `Compressed remaining schedule to recover ${Math.round(compressionNeeded - remainingCompression)} minutes of missed work`,
      confidence: 0.7,
      impact: {
        goalsAffected: this.getAffectedGoals(changes),
        deadlinesRisk: [],
        energyImpact: 'negative'
      }
    };
  }

  private createPostponementRecovery(missedBlocks: TimeBlock[], remainingDay: TimeBlock[]): RePlanningResult {
    const changes: ScheduleChange[] = missedBlocks.map(block => ({
      type: 'postponed',
      originalBlock: block,
      reasoning: 'Postponed to tomorrow due to schedule overrun'
    }));
    
    return {
      confidence: 0.7,
      newSchedule: remainingDay,
      changes,
      alternatives: [],
      reasoning: `${missedBlocks.length} blocks postponed to tomorrow to maintain schedule quality`,
      confidence: 0.8,
      impact: {
        goalsAffected: this.getAffectedGoals(changes),
        deadlinesRisk: this.assessDeadlineRisk(changes),
        energyImpact: 'positive'
      }
    };
  }

  private createSimplificationRecovery(missedBlocks: TimeBlock[], remainingDay: TimeBlock[]): RePlanningResult {
    const newSchedule = remainingDay.map(block => this.simplifyBlock(block));
    const changes: ScheduleChange[] = [];
    
    for (let i = 0; i < remainingDay.length; i++) {
      if (JSON.stringify(remainingDay[i]) !== JSON.stringify(newSchedule[i])) {
        changes.push({
          type: 'shortened',
          originalBlock: remainingDay[i],
          newBlock: newSchedule[i],
          reasoning: 'Simplified to focus on core deliverables'
        });
      }
    }
    
    return {
      confidence: 0.7,
      newSchedule,
      changes,
      alternatives: [],
      reasoning: `Simplified remaining blocks to focus on essential outcomes only`,
      confidence: 0.9,
      impact: {
        goalsAffected: this.getAffectedGoals(changes),
        deadlinesRisk: [],
        energyImpact: 'positive'
      }
    };
  }

  private createInterleavingRecovery(missedBlocks: TimeBlock[], remainingDay: TimeBlock[]): RePlanningResult {
    // Interleave missed work into remaining blocks
    const newSchedule: TimeBlock[] = [];
    const changes: ScheduleChange[] = [];
    
    let missedWorkTime = missedBlocks.reduce((total, block) => {
      const duration = new Date(block.endTime).getTime() - new Date(block.startTime).getTime();
      return total + (duration / (1000 * 60));
    }, 0);
    
    for (const block of remainingDay) {
      if (missedWorkTime > 0 && this.canExtend(block)) {
        const extension = Math.min(30, missedWorkTime); // Max 30 min extension
        
        const extendedBlock = {
          ...block,
          endTime: new Date(block.endTime.getTime() + extension * 60 * 1000),
          description: `${block.description} + Recovery work (${extension}min)`
        };
        
        newSchedule.push(extendedBlock);
        missedWorkTime -= extension;
        
        changes.push({
          type: 'moved',
          originalBlock: block,
          newBlock: extendedBlock,
          reasoning: `Extended by ${extension} minutes to include missed work`
        });
      } else {
        newSchedule.push(block);
      }
    }
    
    return {
      confidence: 0.7,
      newSchedule,
      changes,
      alternatives: [],
      reasoning: `Interleaved ${Math.round(missedBlocks.reduce((total, block) => {
        const duration = new Date(block.endTime).getTime() - new Date(block.startTime).getTime();
        return total + (duration / (1000 * 60));
      }, 0) - missedWorkTime)} minutes of missed work into remaining schedule`,
      confidence: 0.6,
      impact: {
        goalsAffected: this.getAffectedGoals(changes),
        deadlinesRisk: [],
        energyImpact: 'neutral'
      }
    };
  }

  // 🔧 UTILITY METHODS
  private calculateEnergyDrift(currentEnergy: number, schedule: TimeBlock[]): number {
    const now = new Date();
    const currentHour = now.getHours();
    const expectedEnergy = this.getExpectedEnergyForTime(currentHour);
    return currentEnergy - expectedEnergy;
  }

  private getOptimalEnergyForBlock(block: TimeBlock): number {
    const blockType = block.type;
    switch (blockType) {
      case 'focus': return 0.9;
      case 'work': return 0.7;
      case 'meeting': return 0.6;
      case 'admin': return 0.4;
      case 'break': return 0.3;
      default: return 0.6;
    }
  }

  private async adaptBlockForEnergy(block: TimeBlock, currentEnergy: number, schedule: TimeBlock[]): Promise<TimeBlock> {
    const optimalEnergy = this.getOptimalEnergyForBlock(block);
    
    if (currentEnergy < optimalEnergy - 0.3) {
      // Low energy - simplify or postpone
      if (currentEnergy < 0.3) {
        return this.simplifyBlock(block);
      } else {
        return this.createLowEnergyVariant(block);
      }
    } else if (currentEnergy > optimalEnergy + 0.3) {
      // High energy - can handle more
      return this.createHighEnergyVariant(block);
    }
    
    return block; // No change needed
  }

  private createLowEnergyVariant(block: TimeBlock): TimeBlock {
    return {
      confidence: 0.7,
      ...block,
      type: block.type === 'focus' ? 'work' : 'admin',
      description: `${block.description} (Low-energy variant)`
    };
  }

  private createHighEnergyVariant(block: TimeBlock): TimeBlock {
    return {
      confidence: 0.7,
      ...block,
      type: block.type === 'admin' ? 'work' : 'focus',
      description: `${block.description} (High-energy focus session)`
    };
  }

  private canCompress(block: TimeBlock): boolean {
    const duration = new Date(block.endTime).getTime() - new Date(block.startTime).getTime();
    const durationMinutes = duration / (1000 * 60);
    return durationMinutes > 30; // Only compress blocks longer than 30 minutes
  }

  private getMaxCompressionForBlock(block: TimeBlock): number {
    const duration = new Date(block.endTime).getTime() - new Date(block.startTime).getTime();
    const durationMinutes = duration / (1000 * 60);
    return Math.floor(durationMinutes * 0.25); // Max 25% compression
  }

  private canExtend(block: TimeBlock): boolean {
    const duration = new Date(block.endTime).getTime() - new Date(block.startTime).getTime();
    const durationMinutes = duration / (1000 * 60);
    return durationMinutes < 120; // Can extend blocks shorter than 2 hours
  }

  private isCriticalBlock(block: TimeBlock, context: AdaptationContext): boolean {
    // Check if block has high-priority goals
    const blockGoals = block.goalIds || [];
    const hasCriticalGoal = blockGoals.some(goalId => {
      const goal = context.goals.find(g => g.id === goalId);
      return goal && goal.priority === 'critical';
    });
    
    // Check if block has urgent deadline
    const now = new Date();
    const dayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const hasUrgentDeadline = new Date(block.endTime) <= dayFromNow;
    
    return hasCriticalGoal || hasUrgentDeadline || block.type === 'meeting';
  }

  private simplifyBlock(block: TimeBlock): TimeBlock {
    const duration = new Date(block.endTime).getTime() - new Date(block.startTime).getTime();
    const simplifiedDuration = Math.max(duration * 0.6, 30 * 60 * 1000); // At least 30 minutes
    
    return {
      confidence: 0.7,
      ...block,
      endTime: new Date(block.startTime.getTime() + simplifiedDuration),
      description: `${block.description} (Simplified - core essentials only)`,
      type: block.type === 'focus' ? 'work' : block.type
    };
  }

  private getBlockPriority(block: TimeBlock, goals: Goal[]): number {
    const blockGoals = block.goalIds || [];
    let maxPriority = 0;
    
    for (const goalId of blockGoals) {
      const goal = goals.find(g => g.id === goalId);
      if (goal) {
        const priorityValue = goal.priority === 'critical' ? 4 : 
                             goal.priority === 'high' ? 3 :
                             goal.priority === 'medium' ? 2 : 1;
        maxPriority = Math.max(maxPriority, priorityValue);
      }
    }
    
    return maxPriority;
  }

  private getAffectedGoals(changes: ScheduleChange[]): string[] {
    const goalIds = new Set<string>();
    
    for (const change of changes) {
      const blockGoals = change.originalBlock.goalIds || [];
      blockGoals.forEach(goalId => goalIds.add(goalId));
    }
    
    return Array.from(goalIds);
  }

  private assessDeadlineRisk(changes: ScheduleChange[]): string[] {
    const risks: string[] = [];
    
    for (const change of changes) {
      if (change.type === 'postponed' || change.type === 'cancelled') {
        // Check if this block was approaching a deadline
        const blockEnd = new Date(change.originalBlock.endTime);
        const now = new Date();
        const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        
        if (blockEnd <= threeDaysFromNow) {
          risks.push(`${change.originalBlock.title} was scheduled within 3 days - deadline may be at risk`);
        }
      }
    }
    
    return risks;
  }

  private getExpectedEnergyForTime(hour: number): number {
    // Simple energy curve - morning high, afternoon dip, evening moderate
    if (hour >= 9 && hour <= 11) return 0.9;  // Peak morning
    if (hour >= 14 && hour <= 15) return 0.4; // Afternoon dip  
    if (hour >= 16 && hour <= 17) return 0.7; // Recovery
    if (hour >= 18) return 0.6; // Evening
    return 0.6; // Default
  }

  private async generateEnergyAlternatives(currentEnergy: number, originalSchedule: TimeBlock[]): Promise<AlternativeSchedule[]> {
    // Generate alternative schedules optimized for current energy
    return [
      {
        name: 'Energy-First',
        description: 'Prioritize energy-appropriate tasks',
        schedule: originalSchedule, // Simplified for now
        tradeoffs: ['Better energy utilization', 'Some timeline impact'],
        confidence: 0.8
      }
    ];
  }

  private async generateCompressionAlternatives(context: AdaptationContext, target: number): Promise<AlternativeSchedule[]> {
    return [
      {
        name: 'Aggressive Compression',
        description: `Compress schedule by ${target + 15} minutes`,
        schedule: [], // Simplified 
        tradeoffs: ['Faster recovery', 'Higher stress'],
        confidence: 0.6
      }
    ];
  }

  private async updateAdaptationIntelligence(trigger: RePlanningTrigger, result: RePlanningResult, context: AdaptationContext): Promise<void> {
    // Store adaptation for learning
    this.adaptationHistory.push(result);
    
    // Update metrics
    // this.realTimeMetrics.planningAccuracy = result.confidence; // TODO: Add planningAccuracy to RealTimeMetrics interface
    this.realTimeMetrics.stressLevel = context.disruptionSeverity === 'critical' ? 0.8 : 0.4;
    
    // Keep history manageable
    if (this.adaptationHistory.length > 50) {
      this.adaptationHistory.shift();
    }
  }

  private provideFeedback(result: RePlanningResult, trigger: RePlanningTrigger): void {
    if (result.confidence > 0.8) {
      audioManager.play('achievementUnlock');
    } else if (result.confidence > 0.6) {
      audioManager.taskCompleted();
    } else {
      audioManager.buttonFeedback();
    }
    
    console.log(`🔄 RE-PLANNING FEEDBACK: ${result.reasoning} (Confidence: ${Math.round(result.confidence * 100)}%)`);
  }

  private createEmergencyFallback(trigger: RePlanningTrigger, options: RePlanningOptions): RePlanningResult {
    return {
      confidence: 0.7,
      newSchedule: [],
      changes: [],
      alternatives: [],
      reasoning: 'Emergency fallback: Critical error in re-planning system',
      impact: {
        goalsAffected: [],
        deadlinesRisk: ['All planned activities may be affected'],
        energyImpact: 'negative'
      }
    };
  }

  private handleCriticalTimeShortage(missedBlocks: TimeBlock[], remainingDay: TimeBlock[]): RePlanningResult {
    return {
      confidence: 0.7,
      newSchedule: [],
      changes: missedBlocks.map(block => ({
        type: 'cancelled',
        originalBlock: block,
        reasoning: 'Critical time shortage - insufficient time remaining today'
      })),
      alternatives: [],
      reasoning: 'Critical time shortage detected. All remaining work postponed to maintain well-being.',
      confidence: 1.0,
      impact: {
        goalsAffected: [],
        deadlinesRisk: ['Some deadlines may need to be renegotiated'],
        energyImpact: 'positive'
      }
    };
  }

  private createNoChangeResult(reason: string): RePlanningResult {
    return {
      confidence: 0.7,
      newSchedule: [],
      changes: [],
      alternatives: [],
      reasoning: reason,
      impact: {
        goalsAffected: [],
        deadlinesRisk: [],
        energyImpact: 'neutral'
      }
    };
  }
}

// 🔥 EXPORT SINGLETON
export const rePlanningEngine = new UltraSmartRePlanningEngine();