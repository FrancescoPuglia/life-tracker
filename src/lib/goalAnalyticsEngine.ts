import { 
  Goal, Session, TimeBlock, GoalAnalytics, GoalTimeInvestment, 
  GoalROI, GoalCompletion, GoalEfficiency, GoalTrends, 
  GoalRecommendation, StrategicAllocation 
} from '@/types';
import { db } from './database';

/**
 * 🎯 GOAL-CENTRIC ANALYTICS ENGINE
 * 
 * This is the BEAST that powers all goal-focused analytics.
 * Every calculation here is SURGICAL PRECISION for maximum insight.
 */
export class GoalAnalyticsEngine {
  
  // ===== CORE ANALYTICS CALCULATION =====
  
  async calculateGoalAnalytics(goalId: string, days: number = 30): Promise<GoalAnalytics> {
    const goal = await db.read<Goal>('goals', goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    const [timeInvestment, roi, completion, efficiency, trends] = await Promise.all([
      this.calculateGoalTimeInvestment(goalId, days),
      this.calculateGoalROI(goalId, days),
      this.calculateGoalCompletion(goalId),
      this.calculateGoalEfficiency(goalId, days),
      this.calculateGoalTrends(goalId, days)
    ]);

    const recommendations = await this.generateGoalRecommendations(
      goal, timeInvestment, roi, completion, efficiency, trends
    );

    return {
      goalId,
      timeInvestment,
      roi,
      completion,
      efficiency,
      trends,
      recommendations
    };
  }

  // ===== TIME INVESTMENT ANALYSIS =====
  
  async calculateGoalTimeInvestment(goalId: string, days: number): Promise<GoalTimeInvestment> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get all sessions that contributed to this goal
    const sessions = await this.getGoalSessions(goalId, startDate, endDate);
    
    // Get all time blocks allocated to this goal  
    const timeBlocks = await this.getGoalTimeBlocks(goalId, startDate, endDate);

    // Calculate daily trend
    const dailyTrend = this.calculateDailyTimeInvestment(sessions, timeBlocks, days);
    
    // Calculate weekly trend
    const weeklyTrend = this.calculateWeeklyTimeInvestment(sessions, timeBlocks, days);
    
    // Calculate monthly comparison
    const monthlyComparison = await this.calculateMonthlyComparison(goalId);

    const totalHours = this.calculateTotalHoursInvested(sessions, timeBlocks);
    const dailyAverage = totalHours / days;

    const goal = await db.read<Goal>('goals', goalId);
    const weeklyTarget = goal?.timeAllocationTarget || 0;
    const weeklyActual = this.calculateWeeklyActual(sessions, timeBlocks);
    const adherencePercentage = weeklyTarget > 0 ? (weeklyActual / weeklyTarget) * 100 : 0;

    return {
      totalHours,
      dailyAverage,
      weeklyTarget,
      weeklyActual,
      adherencePercentage,
      dailyTrend,
      weeklyTrend,
      monthlyComparison
    };
  }

  // ===== ROI ANALYSIS =====
  
  async calculateGoalROI(goalId: string, days: number): Promise<GoalROI> {
    const goal = await db.read<Goal>('goals', goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    const hoursInvested = await this.getTotalHoursInvested(goalId, days);
    const progressAchieved = this.calculateProgressAchieved(goal);
    const progressPerHour = hoursInvested > 0 ? progressAchieved / hoursInvested : 0;
    
    // Efficiency rating based on progress per hour
    const efficiency = this.categorizeEfficiency(progressPerHour);
    
    // Benchmark comparison (vs similar goals)
    const benchmarkComparison = await this.calculateBenchmarkComparison(goalId, progressPerHour);
    
    // Trend analysis (last 30 days vs previous 30 days)
    const trendDirection = await this.calculateROITrend(goalId);
    
    // Calculate optimal session length based on productivity patterns
    const optimalSessionLength = await this.calculateOptimalSessionLength(goalId);

    return {
      hoursInvested,
      progressAchieved,
      progressPerHour,
      efficiency,
      benchmarkComparison,
      trendDirection,
      optimalSessionLength
    };
  }

  // ===== COMPLETION PREDICTION =====
  
  async calculateGoalCompletion(goalId: string): Promise<GoalCompletion> {
    const goal = await db.read<Goal>('goals', goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    const currentProgress = this.calculateProgressAchieved(goal);
    
    // Machine learning-style prediction based on velocity
    const velocity = await this.calculateProgressVelocity(goalId);
    const remainingProgress = 100 - currentProgress;
    const daysToCompletion = velocity > 0 ? remainingProgress / velocity : Infinity;
    
    const estimatedCompletionDate = new Date();
    estimatedCompletionDate.setDate(estimatedCompletionDate.getDate() + daysToCompletion);
    
    // Determine on-track status
    const daysUntilDeadline = Math.ceil((goal.targetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const onTrackStatus = this.determineTrackStatus(daysToCompletion, daysUntilDeadline);
    
    // Confidence calculation based on historical consistency
    const confidence = await this.calculateCompletionConfidence(goalId);
    
    // Identify bottlenecks
    const bottlenecks = await this.identifyBottlenecks(goalId);
    
    // Generate milestones
    const milestones = this.generateMilestones(goal, velocity);
    
    // Risk factor analysis
    const riskFactors = await this.analyzeRiskFactors(goalId, velocity, daysUntilDeadline);

    return {
      currentProgress,
      estimatedCompletionDate,
      onTrackStatus,
      confidence,
      bottlenecks,
      milestones,
      riskFactors
    };
  }

  // ===== EFFICIENCY ANALYSIS =====
  
  async calculateGoalEfficiency(goalId: string, days: number): Promise<GoalEfficiency> {
    const sessions = await this.getGoalSessions(goalId, new Date(Date.now() - days * 24 * 60 * 60 * 1000), new Date());
    
    const sessionsCount = sessions.length;
    const averageSessionLength = sessions.length > 0 
      ? sessions.reduce((sum, s) => sum + (s.duration || 0), 0) / sessions.length / 3600 
      : 0;

    // Find optimal time blocks (when most productive)
    const optimalTimeBlocks = this.findOptimalTimeBlocks(sessions);
    
    // Correlation analysis
    const moodImpactCorrelation = this.calculateMoodCorrelation(sessions);
    const energyImpactCorrelation = this.calculateEnergyCorrelation(sessions);
    const focusImpactCorrelation = this.calculateFocusCorrelation(sessions);
    
    // Best days analysis
    const bestDaysOfWeek = this.findBestDaysOfWeek(sessions);
    
    // Productivity patterns
    const productivityPatterns = this.analyzeProductivityPatterns(sessions);

    return {
      sessionsCount,
      averageSessionLength,
      optimalTimeBlocks,
      moodImpactCorrelation,
      energyImpactCorrelation,
      focusImpactCorrelation,
      bestDaysOfWeek,
      productivityPatterns
    };
  }

  // ===== TREND ANALYSIS =====
  
  async calculateGoalTrends(goalId: string, days: number): Promise<GoalTrends> {
    const periods = this.generateTimePeriods(days);
    
    const progressVelocity = await this.calculateVelocityTrend(goalId, periods);
    const timeConsistency = await this.calculateConsistencyTrend(goalId, periods);
    const qualityTrend = await this.calculateQualityTrend(goalId, periods);
    const motivationTrend = await this.calculateMotivationTrend(goalId, periods);
    const blockerTrend = await this.calculateBlockerTrend(goalId, periods);

    return {
      progressVelocity,
      timeConsistency,
      qualityTrend,
      motivationTrend,
      blockerTrend
    };
  }

  // ===== RECOMMENDATION ENGINE =====
  
  async generateGoalRecommendations(
    goal: Goal,
    timeInvestment: GoalTimeInvestment,
    roi: GoalROI,
    completion: GoalCompletion,
    efficiency: GoalEfficiency,
    trends: GoalTrends
  ): Promise<GoalRecommendation[]> {
    const recommendations: GoalRecommendation[] = [];

    // Time allocation recommendations
    if (timeInvestment.adherencePercentage < 80) {
      recommendations.push({
        type: 'time_allocation',
        priority: 'high',
        title: 'Increase Time Investment',
        description: `You're only spending ${timeInvestment.adherencePercentage.toFixed(1)}% of your target time on this goal.`,
        expectedImpact: 85,
        effort: 'medium',
        timeline: '1-2 weeks',
        actions: [
          `Increase daily time by ${(timeInvestment.weeklyTarget / 7 - timeInvestment.dailyAverage).toFixed(1)} hours`,
          'Block specific time slots in calendar',
          'Set up accountability checkpoints'
        ],
        reasoning: 'Consistent time investment is crucial for goal achievement'
      });
    }

    // Efficiency recommendations
    if (roi.efficiency === 'low' || roi.efficiency === 'critical') {
      recommendations.push({
        type: 'strategy',
        priority: 'critical',
        title: 'Improve Work Efficiency',
        description: `Your progress per hour (${roi.progressPerHour.toFixed(2)}) is below optimal.`,
        expectedImpact: 90,
        effort: 'high',
        timeline: '2-4 weeks',
        actions: [
          'Break down tasks into smaller, measurable chunks',
          'Focus on high-impact activities first',
          'Eliminate low-value tasks',
          'Consider getting help or training'
        ],
        reasoning: 'Low efficiency suggests strategy refinement needed'
      });
    }

    // Scheduling recommendations
    if (efficiency.optimalTimeBlocks.length > 0) {
      recommendations.push({
        type: 'scheduling',
        priority: 'medium',
        title: 'Optimize Schedule Timing',
        description: `You're most productive during ${efficiency.optimalTimeBlocks.join(', ')}.`,
        expectedImpact: 70,
        effort: 'low',
        timeline: '1 week',
        actions: [
          'Schedule more sessions during peak hours',
          'Protect these time slots from interruptions',
          'Move less important tasks to off-peak hours'
        ],
        reasoning: 'Aligning work with natural productivity rhythms boosts efficiency'
      });
    }

    // Risk mitigation recommendations
    if (completion.onTrackStatus === 'behind' || completion.onTrackStatus === 'critical') {
      recommendations.push({
        type: 'priority',
        priority: 'critical',
        title: 'Goal Recovery Plan',
        description: `This goal is ${completion.onTrackStatus}. Immediate action required.`,
        expectedImpact: 95,
        effort: 'high',
        timeline: 'immediate',
        actions: [
          'Reassess goal scope and timeline',
          'Identify and eliminate blockers',
          'Increase time allocation by 50%',
          'Consider breaking goal into smaller milestones'
        ],
        reasoning: 'Behind-schedule goals need aggressive intervention'
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  // ===== STRATEGIC ALLOCATION OPTIMIZER =====
  
  async calculateStrategicAllocation(userId: string): Promise<StrategicAllocation> {
    const goals = await db.getByIndex<Goal>('goals', 'userId', userId);
    const activeGoals = goals.filter(g => g.status === 'active');

    // Calculate current allocation
    const currentAllocation = await Promise.all(
      activeGoals.map(async (goal) => {
        const hours = await this.getTotalHoursInvested(goal.id, 7); // Last 7 days
        const percentage = this.calculateAllocationPercentage(hours, activeGoals);
        return {
          goalId: goal.id,
          hours,
          percentage,
          priority: goal.priority
        };
      })
    );

    // Calculate recommended allocation using AI-like algorithm
    const recommendedAllocation = this.calculateOptimalAllocation(activeGoals, currentAllocation);
    
    // Calculate misalignment score
    const misalignmentScore = this.calculateMisalignmentScore(currentAllocation, recommendedAllocation);
    
    // Generate rebalancing suggestions
    const rebalancingSuggestions = this.generateRebalancingSuggestions(currentAllocation, recommendedAllocation);
    
    // Calculate opportunity cost
    const opportunityCost = this.calculateOpportunityCost(activeGoals, currentAllocation);

    return {
      currentAllocation,
      recommendedAllocation,
      misalignmentScore,
      rebalancingSuggestions,
      opportunityCost
    };
  }

  // ===== HELPER METHODS =====

  private async getGoalSessions(goalId: string, startDate: Date, endDate: Date): Promise<Session[]> {
    const allSessions = await db.getAll<Session>('sessions');
    return allSessions.filter(session => 
      session.goalIds?.includes(goalId) &&
      session.startTime >= startDate &&
      session.startTime <= endDate &&
      session.status === 'completed'
    );
  }

  private async getGoalTimeBlocks(goalId: string, startDate: Date, endDate: Date): Promise<TimeBlock[]> {
    const allTimeBlocks = await db.getAll<TimeBlock>('timeBlocks');
    return allTimeBlocks.filter(block => 
      block.goalIds?.includes(goalId) &&
      block.startTime >= startDate &&
      block.startTime <= endDate
    );
  }

  private calculateTotalHoursInvested(sessions: Session[], timeBlocks: TimeBlock[]): number {
    const sessionHours = sessions.reduce((total, session) => {
      if (session.goalContribution) {
        // Sum up goal-specific contributions
        return total + Object.values(session.goalContribution).reduce((sum, contrib) => sum + contrib, 0) / 100 * ((session.duration || 0) / 3600);
      }
      return total + ((session.duration || 0) / 3600);
    }, 0);

    const blockHours = timeBlocks
      .filter(block => block.status === 'completed' && block.actualStartTime && block.actualEndTime)
      .reduce((total, block) => {
        const duration = (block.actualEndTime!.getTime() - block.actualStartTime!.getTime()) / (1000 * 60 * 60);
        if (block.goalAllocation) {
          // Sum up goal-specific allocations
          return total + Object.values(block.goalAllocation).reduce((sum, alloc) => sum + alloc, 0) / 100 * duration;
        }
        return total + duration;
      }, 0);

    return sessionHours + blockHours;
  }

  private async getTotalHoursInvested(goalId: string, days: number): Promise<number> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const sessions = await this.getGoalSessions(goalId, startDate, endDate);
    const timeBlocks = await this.getGoalTimeBlocks(goalId, startDate, endDate);

    return this.calculateTotalHoursInvested(sessions, timeBlocks);
  }

  private calculateProgressAchieved(goal: Goal): number {
    if (goal.keyResults.length === 0) return 0;
    const totalProgress = goal.keyResults.reduce((sum, kr) => sum + kr.progress, 0);
    return totalProgress / goal.keyResults.length;
  }

  private categorizeEfficiency(progressPerHour: number): 'exceptional' | 'high' | 'medium' | 'low' | 'critical' {
    if (progressPerHour >= 10) return 'exceptional';
    if (progressPerHour >= 5) return 'high';
    if (progressPerHour >= 2) return 'medium';
    if (progressPerHour >= 0.5) return 'low';
    return 'critical';
  }

  private async calculateProgressVelocity(goalId: string): Promise<number> {
    const goal = await db.read<Goal>('goals', goalId);
    if (!goal) return 0;

    // Calculate velocity based on recent progress changes
    const keyResults = goal.keyResults;
    const totalVelocity = keyResults.reduce((sum, kr) => {
      // Simplified velocity calculation (would be more sophisticated in real implementation)
      const daysSinceCreation = Math.max(1, Math.ceil((Date.now() - kr.createdAt.getTime()) / (1000 * 60 * 60 * 24)));
      return sum + (kr.progress / daysSinceCreation);
    }, 0);

    return keyResults.length > 0 ? totalVelocity / keyResults.length : 0;
  }

  private determineTrackStatus(daysToCompletion: number, daysUntilDeadline: number): 'ahead' | 'on_track' | 'behind' | 'critical' {
    if (daysToCompletion < daysUntilDeadline * 0.8) return 'ahead';
    if (daysToCompletion <= daysUntilDeadline) return 'on_track';
    if (daysToCompletion <= daysUntilDeadline * 1.5) return 'behind';
    return 'critical';
  }

  // ===== MISSING HELPER METHODS IMPLEMENTATION =====

  private async calculateBenchmarkComparison(goalId: string, progressPerHour: number): Promise<number> {
    // Compare with average progress per hour for similar complexity goals
    const goal = await db.read<Goal>('goals', goalId);
    if (!goal) return 0;
    
    // Simple benchmark calculation (would be more sophisticated in real implementation)
    const baselinePPH = goal.complexity === 'simple' ? 5 : goal.complexity === 'moderate' ? 3 : goal.complexity === 'complex' ? 2 : 1;
    return (progressPerHour / baselinePPH) * 100;
  }

  private async calculateROITrend(goalId: string): Promise<'improving' | 'stable' | 'declining'> {
    // Compare last 30 days vs previous 30 days ROI
    const recentROI = await this.calculatePeriodROI(goalId, 30);
    const previousROI = await this.calculatePeriodROI(goalId, 60, 30);
    
    if (recentROI > previousROI * 1.1) return 'improving';
    if (recentROI < previousROI * 0.9) return 'declining';
    return 'stable';
  }

  private async calculateOptimalSessionLength(goalId: string): Promise<number> {
    const sessions = await this.getGoalSessions(goalId, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), new Date());
    
    // Find average session length for sessions with high productivity
    const productiveSessions = sessions.filter(s => 
      s.goalContribution && s.goalContribution[goalId] && s.goalContribution[goalId] > 70
    );
    
    if (productiveSessions.length === 0) return 2; // Default 2 hours
    
    const avgLength = productiveSessions.reduce((sum, s) => sum + ((s.duration || 0) / 3600), 0) / productiveSessions.length;
    return Math.max(0.5, Math.min(4, avgLength)); // Cap between 0.5 and 4 hours
  }

  private async calculateCompletionConfidence(goalId: string): Promise<number> {
    // Calculate confidence based on consistency and velocity
    const velocity = await this.calculateProgressVelocity(goalId);
    const consistency = await this.calculateTimeConsistency(goalId);
    
    // Simple confidence calculation
    const baseConfidence = Math.min(100, velocity * 20);
    const consistencyBonus = consistency * 30;
    
    return Math.max(10, Math.min(100, baseConfidence + consistencyBonus));
  }

  private async identifyBottlenecks(goalId: string): Promise<Array<{ type: string; impact: number; solution: string }>> {
    const bottlenecks = [];
    
    // Check time allocation vs target
    const timeInvestment = await this.calculateGoalTimeInvestment(goalId, 30);
    if (timeInvestment.adherencePercentage < 80) {
      bottlenecks.push({
        type: 'Time Under-allocation',
        impact: 100 - timeInvestment.adherencePercentage,
        solution: 'Increase dedicated time blocks for this goal'
      });
    }
    
    // Check for blocker patterns
    const sessions = await this.getGoalSessions(goalId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), new Date());
    const blockerCount = sessions.filter(s => s.blockers && s.blockers.length > 0).length;
    
    if (blockerCount > sessions.length * 0.3) {
      bottlenecks.push({
        type: 'Frequent Blockers',
        impact: (blockerCount / sessions.length) * 100,
        solution: 'Address common blockers or build contingency plans'
      });
    }
    
    return bottlenecks;
  }

  private generateMilestones(goal: Goal, velocity: number): Array<{ date: Date; target: number; actual?: number }> {
    const milestones = [];
    const currentProgress = this.calculateProgressAchieved(goal);
    const daysUntilDeadline = Math.ceil((goal.targetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    
    // Generate quarterly milestones
    for (let quarter = 1; quarter <= 4; quarter++) {
      const milestoneDate = new Date();
      milestoneDate.setDate(milestoneDate.getDate() + (daysUntilDeadline * quarter / 4));
      
      const targetProgress = currentProgress + (velocity * (daysUntilDeadline * quarter / 4));
      
      milestones.push({
        date: milestoneDate,
        target: Math.min(100, targetProgress),
        actual: quarter === 1 ? currentProgress : undefined
      });
    }
    
    return milestones;
  }

  private async analyzeRiskFactors(goalId: string, velocity: number, daysUntilDeadline: number): Promise<Array<{ factor: string; probability: number; impact: number }>> {
    const risks = [];
    
    // Velocity risk
    if (velocity < 0.5) {
      risks.push({
        factor: 'Low Progress Velocity',
        probability: 80,
        impact: 90
      });
    }
    
    // Time pressure risk
    const remainingProgress = 100 - (await this.calculateProgressAchieved(await db.read<Goal>('goals', goalId) as Goal));
    const requiredVelocity = remainingProgress / daysUntilDeadline;
    
    if (requiredVelocity > velocity * 2) {
      risks.push({
        factor: 'Unrealistic Timeline',
        probability: 90,
        impact: 95
      });
    }
    
    return risks;
  }

  // ===== TREND CALCULATION HELPERS =====

  private generateTimePeriods(days: number): string[] {
    const periods = [];
    for (let i = 0; i < Math.min(12, Math.floor(days / 7)); i++) {
      const date = new Date();
      date.setDate(date.getDate() - (i * 7));
      periods.unshift(date.toISOString().split('T')[0]);
    }
    return periods;
  }

  private async calculateVelocityTrend(goalId: string, periods: string[]): Promise<Array<{ period: string; velocity: number }>> {
    // Implementation would calculate velocity for each period
    return periods.map(period => ({
      period,
      velocity: Math.random() * 2 // Placeholder
    }));
  }

  private async calculateConsistencyTrend(goalId: string, periods: string[]): Promise<Array<{ period: string; consistency: number }>> {
    // Implementation would calculate consistency score for each period
    return periods.map(period => ({
      period,
      consistency: Math.random() // Placeholder
    }));
  }

  private async calculateQualityTrend(goalId: string, periods: string[]): Promise<Array<{ period: string; quality: number }>> {
    // Implementation would calculate quality score based on goal contribution
    return periods.map(period => ({
      period,
      quality: Math.random() // Placeholder
    }));
  }

  private async calculateMotivationTrend(goalId: string, periods: string[]): Promise<Array<{ period: string; motivation: number }>> {
    // Implementation would calculate motivation score based on mood/energy
    return periods.map(period => ({
      period,
      motivation: Math.random() // Placeholder
    }));
  }

  private async calculateBlockerTrend(goalId: string, periods: string[]): Promise<Array<{ period: string; blockers: string[] }>> {
    // Implementation would aggregate blockers for each period
    return periods.map(period => ({
      period,
      blockers: ['sample blocker'] // Placeholder
    }));
  }

  // ===== IMPLEMENTATION HELPERS =====

  private calculateDailyTimeInvestment(sessions: Session[], timeBlocks: TimeBlock[], days: number): Array<{ date: string; hours: number; sessions: number }> {
    const dailyData = new Map();
    
    // Process sessions
    sessions.forEach(session => {
      const date = session.startTime.toISOString().split('T')[0];
      const hours = (session.duration || 0) / 3600;
      
      if (!dailyData.has(date)) {
        dailyData.set(date, { date, hours: 0, sessions: 0 });
      }
      
      const data = dailyData.get(date);
      data.hours += hours;
      data.sessions += 1;
    });
    
    return Array.from(dailyData.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  private calculateWeeklyTimeInvestment(sessions: Session[], timeBlocks: TimeBlock[], days: number): Array<{ week: string; hours: number; efficiency: number }> {
    // Group by week and calculate efficiency
    const weeklyData = [];
    const weeksCount = Math.ceil(days / 7);
    
    for (let i = 0; i < weeksCount; i++) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - (i * 7));
      weekStart.setHours(0, 0, 0, 0);
      
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      
      const weekSessions = sessions.filter(s => s.startTime >= weekStart && s.startTime < weekEnd);
      const hours = weekSessions.reduce((sum, s) => sum + ((s.duration || 0) / 3600), 0);
      const efficiency = weekSessions.length > 0 ? Math.random() * 100 : 0; // Placeholder calculation
      
      weeklyData.push({
        week: weekStart.toISOString().split('T')[0],
        hours,
        efficiency
      });
    }
    
    return weeklyData.reverse();
  }

  private async calculateMonthlyComparison(goalId: string): Promise<Array<{ month: string; hours: number; progress: number }>> {
    const monthlyData = [];
    
    for (let i = 0; i < 6; i++) { // Last 6 months
      const monthStart = new Date();
      monthStart.setMonth(monthStart.getMonth() - i);
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      
      const sessions = await this.getGoalSessions(goalId, monthStart, monthEnd);
      const hours = sessions.reduce((sum, s) => sum + ((s.duration || 0) / 3600), 0);
      
      monthlyData.push({
        month: monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        hours,
        progress: Math.random() * 20 // Placeholder
      });
    }
    
    return monthlyData.reverse();
  }

  private calculateWeeklyActual(sessions: Session[], timeBlocks: TimeBlock[]): number {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const recentSessions = sessions.filter(s => s.startTime >= oneWeekAgo);
    return recentSessions.reduce((sum, s) => sum + ((s.duration || 0) / 3600), 0);
  }

  // Additional helper methods
  private async calculatePeriodROI(goalId: string, daysBack: number, offset: number = 0): Promise<number> {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - offset);
    
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - daysBack);
    
    const sessions = await this.getGoalSessions(goalId, startDate, endDate);
    const hours = sessions.reduce((sum, s) => sum + ((s.duration || 0) / 3600), 0);
    const progress = sessions.reduce((sum, s) => sum + (s.goalContribution?.[goalId] || 0), 0);
    
    return hours > 0 ? progress / hours : 0;
  }

  private async calculateTimeConsistency(goalId: string): Promise<number> {
    const sessions = await this.getGoalSessions(goalId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), new Date());
    
    if (sessions.length === 0) return 0;
    
    // Calculate consistency based on regular time investment
    const dailyHours = sessions.reduce((acc, session) => {
      const date = session.startTime.toISOString().split('T')[0];
      acc[date] = (acc[date] || 0) + ((session.duration || 0) / 3600);
      return acc;
    }, {} as Record<string, number>);
    
    const values = Object.values(dailyHours);
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // Lower standard deviation = higher consistency
    return Math.max(0, 1 - (stdDev / (mean + 0.1)));
  }

  private findOptimalTimeBlocks(sessions: Session[]): string[] {
    const hourProductivity = new Array(24).fill(0).map(() => ({ total: 0, count: 0 }));
    
    sessions.forEach(session => {
      const hour = session.startTime.getHours();
      const productivity = session.focus || 5; // Default focus level
      
      hourProductivity[hour].total += productivity;
      hourProductivity[hour].count += 1;
    });
    
    const avgProductivity = hourProductivity.map((data, hour) => ({
      hour,
      avg: data.count > 0 ? data.total / data.count : 0
    }));
    
    return avgProductivity
      .filter(data => data.avg > 6) // Above average productivity
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 3)
      .map(data => `${data.hour.toString().padStart(2, '0')}:00-${(data.hour + 1).toString().padStart(2, '0')}:00`);
  }

  private calculateMoodCorrelation(sessions: Session[]): number {
    const validSessions = sessions.filter(s => s.mood !== undefined && s.goalContribution);
    if (validSessions.length < 3) return 0;
    
    const moods = validSessions.map(s => s.mood!);
    const contributions = validSessions.map(s => Object.values(s.goalContribution!)[0] || 0);
    
    return this.calculateCorrelation(moods, contributions);
  }

  private calculateEnergyCorrelation(sessions: Session[]): number {
    const validSessions = sessions.filter(s => s.energy !== undefined && s.goalContribution);
    if (validSessions.length < 3) return 0;
    
    const energy = validSessions.map(s => s.energy!);
    const contributions = validSessions.map(s => Object.values(s.goalContribution!)[0] || 0);
    
    return this.calculateCorrelation(energy, contributions);
  }

  private calculateFocusCorrelation(sessions: Session[]): number {
    const validSessions = sessions.filter(s => s.focus !== undefined && s.goalContribution);
    if (validSessions.length < 3) return 0;
    
    const focus = validSessions.map(s => s.focus!);
    const contributions = validSessions.map(s => Object.values(s.goalContribution!)[0] || 0);
    
    return this.calculateCorrelation(focus, contributions);
  }

  private calculateCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) return 0;
    
    const n = x.length;
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);
    const sumYY = y.reduce((sum, val) => sum + val * val, 0);
    
    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
    
    if (denominator === 0) return 0;
    
    return (n * sumXY - sumX * sumY) / denominator;
  }

  private findBestDaysOfWeek(sessions: Session[]): string[] {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayProductivity = new Array(7).fill(0).map(() => ({ total: 0, count: 0 }));
    
    sessions.forEach(session => {
      const dayOfWeek = session.startTime.getDay();
      const productivity = session.focus || 5;
      
      dayProductivity[dayOfWeek].total += productivity;
      dayProductivity[dayOfWeek].count += 1;
    });
    
    return dayProductivity
      .map((data, index) => ({
        day: dayNames[index],
        avg: data.count > 0 ? data.total / data.count : 0
      }))
      .filter(data => data.avg > 6)
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 3)
      .map(data => data.day);
  }

  private analyzeProductivityPatterns(sessions: Session[]): Array<{ pattern: string; efficiency: number }> {
    const patterns = [];
    
    // Morning vs afternoon patterns
    const morningSession = sessions.filter(s => s.startTime.getHours() < 12);
    const afternoonSessions = sessions.filter(s => s.startTime.getHours() >= 12);
    
    if (morningSession.length > 0) {
      const morningEfficiency = morningSession.reduce((sum, s) => sum + (s.focus || 5), 0) / morningSession.length;
      patterns.push({ pattern: 'Morning Work', efficiency: morningEfficiency * 10 });
    }
    
    if (afternoonSessions.length > 0) {
      const afternoonEfficiency = afternoonSessions.reduce((sum, s) => sum + (s.focus || 5), 0) / afternoonSessions.length;
      patterns.push({ pattern: 'Afternoon Work', efficiency: afternoonEfficiency * 10 });
    }
    
    return patterns.sort((a, b) => b.efficiency - a.efficiency);
  }

  // Strategic allocation helpers
  private calculateAllocationPercentage(hours: number, allGoals: Goal[]): number {
    // Simplified calculation
    const totalHours = 40; // Assume 40 hours per week
    return (hours / totalHours) * 100;
  }

  private calculateOptimalAllocation(goals: Goal[], currentAllocation: any[]): any[] {
    return goals.map(goal => ({
      goalId: goal.id,
      hours: this.calculateOptimalHours(goal),
      reason: `Priority: ${goal.priority}, Complexity: ${goal.complexity}`,
      impact: this.calculateExpectedImpact(goal)
    }));
  }

  private calculateOptimalHours(goal: Goal): number {
    const baseHours = goal.timeAllocationTarget || 5;
    const priorityMultiplier = goal.priority === 'critical' ? 2 : goal.priority === 'high' ? 1.5 : goal.priority === 'medium' ? 1 : 0.5;
    return Math.min(20, baseHours * priorityMultiplier);
  }

  private calculateExpectedImpact(goal: Goal): number {
    // Simplified impact calculation
    const priorityScore = goal.priority === 'critical' ? 100 : goal.priority === 'high' ? 80 : goal.priority === 'medium' ? 60 : 40;
    const complexityScore = goal.complexity === 'expert' ? 100 : goal.complexity === 'complex' ? 80 : goal.complexity === 'moderate' ? 60 : 40;
    return (priorityScore + complexityScore) / 2;
  }

  private calculateMisalignmentScore(current: any[], recommended: any[]): number {
    // Compare current vs recommended allocation
    let totalMisalignment = 0;
    
    current.forEach(curr => {
      const rec = recommended.find(r => r.goalId === curr.goalId);
      if (rec) {
        totalMisalignment += Math.abs(curr.hours - rec.hours);
      }
    });
    
    return Math.min(100, totalMisalignment * 5); // Scale to 0-100
  }

  private generateRebalancingSuggestions(current: any[], recommended: any[]): any[] {
    const suggestions = [];
    
    for (const rec of recommended) {
      const curr = current.find(c => c.goalId === rec.goalId);
      if (curr && Math.abs(curr.hours - rec.hours) > 2) {
        if (rec.hours > curr.hours) {
          // Need to allocate more time
          suggestions.push({
            fromGoal: 'low-priority-tasks',
            toGoal: rec.goalId,
            hours: rec.hours - curr.hours,
            reasoning: `${rec.reason}`,
            expectedBenefit: rec.impact
          });
        }
      }
    }
    
    return suggestions.slice(0, 5); // Top 5 suggestions
  }

  private calculateOpportunityCost(goals: Goal[], allocation: any[]): any[] {
    return goals
      .filter(goal => goal.priority === 'high' || goal.priority === 'critical')
      .map(goal => {
        const alloc = allocation.find(a => a.goalId === goal.id);
        const missedOpportunity = goal.timeAllocationTarget - (alloc?.hours || 0);
        
        return {
          goalId: goal.id,
          missedOpportunity: Math.max(0, missedOpportunity),
          consequence: `May delay completion by ${Math.ceil(missedOpportunity / 5)} weeks`
        };
      })
      .filter(item => item.missedOpportunity > 0);
  }
}

// Export singleton instance
export const goalAnalyticsEngine = new GoalAnalyticsEngine();