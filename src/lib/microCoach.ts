// 🧠 MICRO COACH - Pattern-Based Performance Optimization
// MODALITÀ PSICOPATICO CERTOSINO 🔥🔥🔥🔥🔥

import {
  MicroCoach, CoachingInsight, PatternDetection, UserAnalysisData, PerformanceMetrics
} from '@/types/ai-enhanced';
import { Goal, KeyResult, Task, TimeBlock, Session, HabitLog } from '@/types';

interface CoachingContext {
  userId: string;
  timeframe: 'daily' | 'weekly' | 'monthly';
  historicalData: any[];
  currentPerformance: PerformanceMetrics;
  userProfile: UserProfile;
  recentSessions: Session[];
  completedTasks: Task[];
  habitLogs: HabitLog[];
}

interface UserProfile {
  workingStyle: 'sprint' | 'steady' | 'mixed';
  energyPattern: 'morning' | 'afternoon' | 'evening' | 'variable';
  motivationType: 'achievement' | 'progress' | 'comparison' | 'deadline';
  preferredFeedback: 'gentle' | 'direct' | 'challenging';
  riskTolerance: 'low' | 'medium' | 'high';
}

interface BehavioralPattern {
  id: string;
  name: string;
  type: 'positive' | 'negative' | 'neutral';
  frequency: number;
  confidence: number;
  dataPoints: any[];
  trigger?: string;
  impact: {
    productivity: number;
    energy: number;
    goalProgress: number;
  };
  suggestedAction?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

interface InsightTemplate {
  category: string;
  templates: Array<{
    condition: (data: any) => boolean;
    title: string;
    message: (data: any) => string;
    actionable: boolean;
    impact: 'low' | 'medium' | 'high';
    urgency: 'low' | 'medium' | 'high';
  }>;
}

export class UltraSmartMicroCoach implements MicroCoach {
  private patternHistory: Map<string, BehavioralPattern[]> = new Map();
  private insightCache: Map<string, CoachingInsight[]> = new Map();
  private userProfiles: Map<string, UserProfile> = new Map();
  private insightTemplates: InsightTemplate[] = [];

  constructor() {
    this.initializeInsightTemplates();
  }

  // 🧠 MAIN DAILY INSIGHT GENERATION
  async generateDailyInsight(userData: UserAnalysisData): Promise<CoachingInsight> {
    console.log('🧠 MICRO COACH: Generating daily insight for user');

    try {
      // 🔍 DETECT RECENT PATTERNS
      const recentPatterns = await this.detectPatterns(userData.recentSessions, 7);
      
      // 📊 ANALYZE CURRENT PERFORMANCE
      const performance = await this.analyzeCurrentPerformance(userData);
      
      // 🎯 IDENTIFY OPTIMIZATION OPPORTUNITIES
      const opportunities = await this.identifyOptimizationOpportunities(userData, recentPatterns);
      
      // 🎭 PERSONALIZE INSIGHT BASED ON USER PROFILE
      const personalizedInsight = await this.personalizeInsight(opportunities, userData);
      
      console.log('🧠 DAILY INSIGHT GENERATED:', personalizedInsight.type, '-', personalizedInsight.title);
      
      return personalizedInsight;

    } catch (error) {
      console.error('🧠 MICRO COACH ERROR:', error);
      return this.generateFallbackInsight();
    }
  }

  // 🔍 ADVANCED PATTERN DETECTION ENGINE
  async detectPatterns(historicalData: any[], timeframeDays: number): Promise<PatternDetection[]> {
    console.log('🔍 PATTERN DETECTION: Analyzing', historicalData.length, 'data points');

    const patterns: PatternDetection[] = [];
    
    try {
      // 1. 📊 PRODUCTIVITY PATTERNS
      const productivityPatterns = await this.detectProductivityPatterns(historicalData);
      patterns.push(...productivityPatterns);
      
      // 2. ⚡ ENERGY PATTERNS
      const energyPatterns = await this.detectEnergyPatterns(historicalData);
      patterns.push(...energyPatterns);
      
      // 3. 🎯 GOAL COMPLETION PATTERNS
      const goalPatterns = await this.detectGoalPatterns(historicalData);
      patterns.push(...goalPatterns);
      
      // 4. 🕒 TIME MANAGEMENT PATTERNS
      const timePatterns = await this.detectTimeManagementPatterns(historicalData);
      patterns.push(...timePatterns);
      
      // 5. 🔄 HABIT CONSISTENCY PATTERNS
      const habitPatterns = await this.detectHabitPatterns(historicalData);
      patterns.push(...habitPatterns);

      // 🔥 PRIORITIZE AND FILTER SIGNIFICANT PATTERNS
      const significantPatterns = this.filterSignificantPatterns(patterns);
      
      console.log('🔍 DETECTED', significantPatterns.length, 'significant patterns');
      return significantPatterns;

    } catch (error) {
      console.error('🔍 PATTERN DETECTION ERROR:', error);
      return [];
    }
  }

  // 🎯 OPTIMIZATION SUGGESTIONS
  async suggestOptimizations(currentPerformance: PerformanceMetrics): Promise<CoachingInsight[]> {
    console.log('🎯 OPTIMIZATION ENGINE: Analyzing performance metrics');

    const optimizations: CoachingInsight[] = [];

    try {
      // 🚀 PRODUCTIVITY OPTIMIZATIONS
      if (currentPerformance.productivity.planAdherence < 0.7) {
        optimizations.push({
          id: `opt-planning-${Date.now()}`,
          type: 'planning',
          title: 'Improve Planning Accuracy',
          message: `Your plan adherence is ${Math.round(currentPerformance.productivity.planAdherence * 100)}%. Consider shorter time blocks and more realistic estimates.`,
          evidence: [`Plan adherence: ${Math.round(currentPerformance.productivity.planAdherence * 100)}%`],
          actionable: true,
          implementationCost: 'low',
          expectedImpact: 'high',
          urgency: 'medium',
          categories: ['planning', 'productivity']
        });
      }

      // ⚡ ENERGY OPTIMIZATIONS
      if (currentPerformance.wellbeing.energyConsistency < 0.6) {
        optimizations.push({
          id: `opt-energy-${Date.now()}`,
          type: 'energy',
          title: 'Stabilize Energy Levels',
          message: `Your energy levels are inconsistent (${Math.round(currentPerformance.wellbeing.energyConsistency * 100)}% consistency). Try scheduling demanding tasks during your natural high-energy periods.`,
          evidence: [`Energy consistency: ${Math.round(currentPerformance.wellbeing.energyConsistency * 100)}%`],
          actionable: true,
          implementationCost: 'medium',
          expectedImpact: 'high',
          urgency: 'high',
          categories: ['energy', 'wellbeing']
        });
      }

      // 🎯 GOAL ALIGNMENT OPTIMIZATIONS
      if (currentPerformance.goalProgress.atRiskGoals > 2) {
        optimizations.push({
          id: `opt-goals-${Date.now()}`,
          type: 'goal_alignment',
          title: 'Focus on Critical Goals',
          message: `You have ${currentPerformance.goalProgress.atRiskGoals} goals at risk. Consider reducing scope or reallocating time to your most important objectives.`,
          evidence: [`At-risk goals: ${currentPerformance.goalProgress.atRiskGoals}`],
          actionable: true,
          implementationCost: 'high',
          expectedImpact: 'high',
          urgency: 'critical',
          categories: ['goals', 'prioritization']
        });
      }

      // 🔥 BURNOUT PREVENTION
      if (currentPerformance.wellbeing.burnoutRisk > 0.7) {
        optimizations.push({
          id: `opt-burnout-${Date.now()}`,
          type: 'energy',
          title: 'Burnout Prevention Required',
          message: `High burnout risk detected (${Math.round(currentPerformance.wellbeing.burnoutRisk * 100)}%). Take immediate action to reduce workload and increase recovery time.`,
          evidence: [`Burnout risk: ${Math.round(currentPerformance.wellbeing.burnoutRisk * 100)}%`],
          actionable: true,
          implementationCost: 'medium',
          expectedImpact: 'critical',
          urgency: 'critical',
          categories: ['wellbeing', 'energy']
        });
      }

      console.log('🎯 GENERATED', optimizations.length, 'optimization suggestions');
      return optimizations.slice(0, 5); // Return top 5 suggestions

    } catch (error) {
      console.error('🎯 OPTIMIZATION ERROR:', error);
      return [];
    }
  }

  // 🔍 PRODUCTIVITY PATTERN DETECTION
  private async detectProductivityPatterns(data: any[]): Promise<PatternDetection[]> {
    const patterns: PatternDetection[] = [];

    // Morning vs afternoon productivity
    const morningProductivity = this.calculateTimeSlotProductivity(data, 6, 12);
    const afternoonProductivity = this.calculateTimeSlotProductivity(data, 12, 18);
    
    if (morningProductivity > afternoonProductivity * 1.3) {
      patterns.push({
        pattern: 'morning_productivity_peak',
        frequency: 0.8,
        confidence: 0.85,
        dataPoints: data.filter(d => this.getHour(d.timestamp) < 12),
        suggestedAction: 'Schedule your most challenging tasks in the morning'
      });
    }

    // Context switching penalty
    const contextSwitches = this.analyzeContextSwitching(data);
    if (contextSwitches.frequency > 0.7) {
      patterns.push({
        pattern: 'excessive_context_switching',
        frequency: contextSwitches.frequency,
        confidence: 0.9,
        dataPoints: contextSwitches.instances,
        suggestedAction: 'Group similar tasks together to reduce context switching'
      });
    }

    // Deep work effectiveness
    const deepWorkEffectiveness = this.analyzeDeepWorkSessions(data);
    if (deepWorkEffectiveness.averageEffectiveness > 0.8) {
      patterns.push({
        pattern: 'deep_work_strength',
        frequency: deepWorkEffectiveness.frequency,
        confidence: 0.8,
        dataPoints: deepWorkEffectiveness.sessions,
        suggestedAction: 'Increase the number of deep work sessions'
      });
    }

    return patterns;
  }

  // ⚡ ENERGY PATTERN DETECTION
  private async detectEnergyPatterns(data: any[]): Promise<PatternDetection[]> {
    const patterns: PatternDetection[] = [];

    // Weekly energy pattern
    const weeklyEnergyPattern = this.analyzeWeeklyEnergyPattern(data);
    const mondayEnergy = weeklyEnergyPattern.monday || 0;
    const fridayEnergy = weeklyEnergyPattern.friday || 0;
    
    if (mondayEnergy > fridayEnergy * 1.2) {
      patterns.push({
        pattern: 'monday_energy_advantage',
        frequency: 0.9,
        confidence: 0.8,
        dataPoints: data.filter(d => this.getDayOfWeek(d.timestamp) === 1),
        suggestedAction: 'Front-load challenging goals at the start of the week'
      });
    }

    // Post-lunch energy dip
    const lunchDipSeverity = this.analyzeLunchDip(data);
    if (lunchDipSeverity > 0.6) {
      patterns.push({
        pattern: 'post_lunch_energy_dip',
        frequency: 0.8,
        confidence: 0.9,
        dataPoints: data.filter(d => this.getHour(d.timestamp) >= 13 && this.getHour(d.timestamp) <= 15),
        suggestedAction: 'Schedule lighter tasks or breaks between 1-3 PM'
      });
    }

    return patterns;
  }

  // 🎯 GOAL COMPLETION PATTERN DETECTION
  private async detectGoalPatterns(data: any[]): Promise<PatternDetection[]> {
    const patterns: PatternDetection[] = [];

    // Goal completion timing
    const goalCompletionTiming = this.analyzeGoalCompletionTiming(data);
    if (goalCompletionTiming.lastMinuteRush > 0.7) {
      patterns.push({
        pattern: 'last_minute_goal_completion',
        frequency: goalCompletionTiming.lastMinuteRush,
        confidence: 0.85,
        dataPoints: goalCompletionTiming.instances,
        suggestedAction: 'Break down goals into smaller milestones with earlier deadlines'
      });
    }

    // Goal abandonment pattern
    const abandonmentRate = this.analyzeGoalAbandonment(data);
    if (abandonmentRate.rate > 0.3) {
      patterns.push({
        pattern: 'high_goal_abandonment',
        frequency: abandonmentRate.rate,
        confidence: 0.8,
        dataPoints: abandonmentRate.abandonedGoals,
        suggestedAction: 'Set more realistic goals or break them into smaller chunks'
      });
    }

    return patterns;
  }

  // 🕒 TIME MANAGEMENT PATTERN DETECTION
  private async detectTimeManagementPatterns(data: any[]): Promise<PatternDetection[]> {
    const patterns: PatternDetection[] = [];

    // Task estimation accuracy
    const estimationAccuracy = this.analyzeEstimationAccuracy(data);
    if (estimationAccuracy.overestimationBias > 0.3) {
      patterns.push({
        pattern: 'chronic_overestimation',
        frequency: estimationAccuracy.frequency,
        confidence: 0.8,
        dataPoints: estimationAccuracy.instances,
        suggestedAction: 'Add 25% buffer time to your estimates'
      });
    }

    // Break timing effectiveness
    const breakEffectiveness = this.analyzeBreakEffectiveness(data);
    if (breakEffectiveness.optimalFrequency > 0) {
      patterns.push({
        pattern: 'effective_break_timing',
        frequency: breakEffectiveness.consistency,
        confidence: 0.7,
        dataPoints: breakEffectiveness.effectiveBreaks,
        suggestedAction: `Take breaks every ${breakEffectiveness.optimalFrequency} minutes for optimal focus`
      });
    }

    return patterns;
  }

  // 🔄 HABIT CONSISTENCY PATTERNS
  private async detectHabitPatterns(data: any[]): Promise<PatternDetection[]> {
    const patterns: PatternDetection[] = [];

    // Habit streak patterns
    const habitStreaks = this.analyzeHabitStreaks(data);
    const averageStreakLength = habitStreaks.averageStreak;
    
    if (averageStreakLength > 7) {
      patterns.push({
        pattern: 'strong_habit_formation',
        frequency: habitStreaks.consistency,
        confidence: 0.9,
        dataPoints: habitStreaks.longStreaks,
        suggestedAction: 'Leverage your habit-forming strength to build new positive habits'
      });
    }

    // Weekend habit drop-off
    const weekendDropOff = this.analyzeWeekendHabitDropOff(data);
    if (weekendDropOff.dropRate > 0.5) {
      patterns.push({
        pattern: 'weekend_habit_dropoff',
        frequency: weekendDropOff.dropRate,
        confidence: 0.8,
        dataPoints: weekendDropOff.instances,
        suggestedAction: 'Create simplified weekend versions of your weekday habits'
      });
    }

    return patterns;
  }

  // 🧠 PERSONALIZATION ENGINE
  private async personalizeInsight(opportunities: CoachingInsight[], userData: UserAnalysisData): Promise<CoachingInsight> {
    // Select the highest priority insight
    const prioritizedInsights = opportunities.sort((a, b) => {
      const urgencyWeight = { critical: 4, high: 3, medium: 2, low: 1 };
      const impactWeight = { high: 3, medium: 2, low: 1 };
      
      const scoreA = urgencyWeight[a.urgency] * 2 + impactWeight[a.expectedImpact];
      const scoreB = urgencyWeight[b.urgency] * 2 + impactWeight[b.expectedImpact];
      
      return scoreB - scoreA;
    });

    if (prioritizedInsights.length === 0) {
      return this.generatePositiveReinforcementInsight(userData);
    }

    const selectedInsight = prioritizedInsights[0];

    // Personalize tone and messaging based on user profile
    // For now, return as-is, but this could be enhanced with user preferences
    return selectedInsight;
  }

  // 🎯 POSITIVE REINFORCEMENT FALLBACK
  private generatePositiveReinforcementInsight(userData: UserAnalysisData): CoachingInsight {
    const completionRate = userData.completedTasks.length / (userData.completedTasks.length + 5); // Assume some incomplete tasks
    
    return {
      id: `positive-${Date.now()}`,
      type: 'productivity',
      title: 'Great Momentum!',
      message: `You're maintaining strong productivity with ${userData.completedTasks.length} completed tasks recently. Keep leveraging your current systems and consider expanding successful patterns to new areas.`,
      evidence: [`Completed ${userData.completedTasks.length} tasks`, `${Math.round(completionRate * 100)}% completion rate`],
      actionable: false,
      implementationCost: 'low',
      expectedImpact: 'medium',
      urgency: 'low',
      categories: ['motivation', 'productivity']
    };
  }

  // 🆘 FALLBACK INSIGHT
  private generateFallbackInsight(): CoachingInsight {
    const tips = [
      'Focus on your most important goal today and make meaningful progress',
      'Take regular breaks to maintain energy and focus throughout the day',
      'Review your completed tasks to recognize your progress and achievements',
      'Plan tomorrow\'s top 3 priorities before ending your workday',
      'Celebrate small wins to maintain motivation and positive momentum'
    ];

    const randomTip = tips[Math.floor(Math.random() * tips.length)];

    return {
      id: `fallback-${Date.now()}`,
      type: 'productivity',
      title: 'Daily Productivity Tip',
      message: randomTip,
      evidence: ['General best practice'],
      actionable: true,
      implementationCost: 'low',
      expectedImpact: 'medium',
      urgency: 'low',
      categories: ['productivity', 'general']
    };
  }

  // 🔧 UTILITY FUNCTIONS
  private filterSignificantPatterns(patterns: PatternDetection[]): PatternDetection[] {
    return patterns.filter(pattern => 
      pattern.confidence > 0.7 && 
      pattern.frequency > 0.5
    ).sort((a, b) => (b.confidence * b.frequency) - (a.confidence * a.frequency));
  }

  private calculateTimeSlotProductivity(data: any[], startHour: number, endHour: number): number {
    const timeSlotData = data.filter(d => {
      const hour = this.getHour(d.timestamp);
      return hour >= startHour && hour < endHour;
    });
    
    if (timeSlotData.length === 0) return 0;
    
    return timeSlotData.reduce((sum, d) => sum + (d.productivity || 0.5), 0) / timeSlotData.length;
  }

  private getHour(timestamp: string | Date): number {
    return new Date(timestamp).getHours();
  }

  private getDayOfWeek(timestamp: string | Date): number {
    return new Date(timestamp).getDay();
  }

  private analyzeContextSwitching(data: any[]): { frequency: number; instances: any[] } {
    // Simplified implementation - would analyze task type switches
    const switches = data.filter((d, i) => 
      i > 0 && data[i-1].taskType !== d.taskType
    );
    
    return {
      frequency: switches.length / Math.max(data.length - 1, 1),
      instances: switches
    };
  }

  private analyzeDeepWorkSessions(data: any[]): { averageEffectiveness: number; frequency: number; sessions: any[] } {
    const deepWorkSessions = data.filter(d => d.sessionType === 'deep_work' || d.duration > 60);
    
    return {
      averageEffectiveness: deepWorkSessions.reduce((sum, s) => sum + (s.effectiveness || 0.5), 0) / Math.max(deepWorkSessions.length, 1),
      frequency: deepWorkSessions.length / Math.max(data.length, 1),
      sessions: deepWorkSessions
    };
  }

  private analyzeWeeklyEnergyPattern(data: any[]): Record<string, number> {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const pattern: Record<string, number> = {};
    
    days.forEach((day, index) => {
      const dayData = data.filter(d => this.getDayOfWeek(d.timestamp) === index);
      pattern[day] = dayData.reduce((sum, d) => sum + (d.energyLevel || 0.5), 0) / Math.max(dayData.length, 1);
    });
    
    return pattern;
  }

  private analyzeLunchDip(data: any[]): number {
    const lunchTimeData = data.filter(d => {
      const hour = this.getHour(d.timestamp);
      return hour >= 13 && hour <= 15;
    });
    
    const preData = data.filter(d => {
      const hour = this.getHour(d.timestamp);
      return hour >= 10 && hour <= 12;
    });
    
    if (lunchTimeData.length === 0 || preData.length === 0) return 0;
    
    const lunchEnergy = lunchTimeData.reduce((sum, d) => sum + (d.energyLevel || 0.5), 0) / lunchTimeData.length;
    const preEnergy = preData.reduce((sum, d) => sum + (d.energyLevel || 0.5), 0) / preData.length;
    
    return Math.max(0, (preEnergy - lunchEnergy) / preEnergy);
  }

  private analyzeGoalCompletionTiming(data: any[]): { lastMinuteRush: number; instances: any[] } {
    const goalCompletions = data.filter(d => d.type === 'goal_completed');
    const lastMinuteCompletions = goalCompletions.filter(d => {
      // Simplified - would check if completed near deadline
      return d.completionTimeline && d.completionTimeline < 0.2; // Last 20% of timeline
    });
    
    return {
      lastMinuteRush: lastMinuteCompletions.length / Math.max(goalCompletions.length, 1),
      instances: lastMinuteCompletions
    };
  }

  private analyzeGoalAbandonment(data: any[]): { rate: number; abandonedGoals: any[] } {
    const allGoals = data.filter(d => d.type === 'goal_created' || d.type === 'goal_completed' || d.type === 'goal_abandoned');
    const abandonedGoals = allGoals.filter(d => d.type === 'goal_abandoned');
    
    return {
      rate: abandonedGoals.length / Math.max(allGoals.length, 1),
      abandonedGoals
    };
  }

  private analyzeEstimationAccuracy(data: any[]): { overestimationBias: number; frequency: number; instances: any[] } {
    const tasksWithEstimates = data.filter(d => d.estimatedDuration && d.actualDuration);
    const overestimations = tasksWithEstimates.filter(d => d.actualDuration > d.estimatedDuration * 1.2);
    
    return {
      overestimationBias: overestimations.length / Math.max(tasksWithEstimates.length, 1),
      frequency: tasksWithEstimates.length / Math.max(data.length, 1),
      instances: overestimations
    };
  }

  private analyzeBreakEffectiveness(data: any[]): { optimalFrequency: number; consistency: number; effectiveBreaks: any[] } {
    const breaks = data.filter(d => d.type === 'break');
    // Simplified analysis
    return {
      optimalFrequency: 90, // Standard recommendation
      consistency: breaks.length > 0 ? 0.7 : 0,
      effectiveBreaks: breaks
    };
  }

  private analyzeHabitStreaks(data: any[]): { averageStreak: number; consistency: number; longStreaks: any[] } {
    const habits = data.filter(d => d.type === 'habit_log');
    // Simplified implementation
    return {
      averageStreak: habits.length > 0 ? 5 : 0,
      consistency: habits.length > 0 ? 0.8 : 0,
      longStreaks: habits.filter(h => h.streak > 7)
    };
  }

  private analyzeWeekendHabitDropOff(data: any[]): { dropRate: number; instances: any[] } {
    const weekdayHabits = data.filter(d => {
      const day = this.getDayOfWeek(d.timestamp);
      return day > 0 && day < 6 && d.type === 'habit_log';
    });
    
    const weekendHabits = data.filter(d => {
      const day = this.getDayOfWeek(d.timestamp);
      return (day === 0 || day === 6) && d.type === 'habit_log';
    });
    
    const expectedWeekendHabits = weekdayHabits.length * (2/5); // Scale down for weekend
    const actualWeekendHabits = weekendHabits.length;
    
    return {
      dropRate: Math.max(0, (expectedWeekendHabits - actualWeekendHabits) / expectedWeekendHabits),
      instances: weekendHabits
    };
  }

  private async analyzeCurrentPerformance(userData: UserAnalysisData): Promise<PerformanceMetrics> {
    return {
      productivity: {
        tasksCompletedPerDay: userData.completedTasks.length / 7,
        focusTimePerDay: userData.recentSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / 7,
        planAdherence: userData.planningAccuracy.completionRate
      },
      goalProgress: {
        weeklyVelocity: userData.goalProgress,
        milestonesHit: Object.values(userData.goalProgress).filter(p => p > 0.8).length,
        atRiskGoals: Object.values(userData.goalProgress).filter(p => p < 0.3).length
      },
      wellbeing: {
        energyConsistency: this.calculateEnergyConsistency(userData.energyLevels),
        workLifeBalance: 0.7, // Simplified
        burnoutRisk: this.calculateBurnoutRisk(userData)
      }
    };
  }

  private async identifyOptimizationOpportunities(userData: UserAnalysisData, patterns: PatternDetection[]): Promise<CoachingInsight[]> {
    const insights: CoachingInsight[] = [];

    // Convert patterns to actionable insights
    for (const pattern of patterns.slice(0, 3)) { // Top 3 patterns
      if (pattern.suggestedAction) {
        insights.push({
          id: `pattern-${pattern.pattern}-${Date.now()}`,
          type: this.getInsightTypeFromPattern(pattern.pattern),
          title: this.getPatternTitle(pattern.pattern),
          message: pattern.suggestedAction,
          evidence: [`Pattern detected with ${Math.round(pattern.confidence * 100)}% confidence`],
          actionable: true,
          implementationCost: this.getImplementationCost(pattern.pattern),
          expectedImpact: 'medium',
          urgency: 'medium',
          categories: [this.getInsightTypeFromPattern(pattern.pattern)]
        });
      }
    }

    return insights;
  }

  private calculateEnergyConsistency(energyLevels: Record<string, number>): number {
    const values = Object.values(energyLevels);
    if (values.length === 0) return 0.5;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    
    return Math.max(0, 1 - Math.sqrt(variance));
  }

  private calculateBurnoutRisk(userData: UserAnalysisData): number {
    const factors = [
      userData.planningAccuracy.completionRate < 0.6 ? 0.3 : 0,
      userData.recentSessions.length > 50 ? 0.4 : 0,
      Object.values(userData.goalProgress).filter(p => p < 0.3).length > 3 ? 0.3 : 0
    ];
    
    return Math.min(1, factors.reduce((sum, factor) => sum + factor, 0));
  }

  private getInsightTypeFromPattern(pattern: string): CoachingInsight['type'] {
    if (pattern.includes('energy')) return 'energy';
    if (pattern.includes('goal')) return 'goal_alignment';
    if (pattern.includes('habit')) return 'habits';
    if (pattern.includes('planning') || pattern.includes('time')) return 'planning';
    return 'productivity';
  }

  private getPatternTitle(pattern: string): string {
    const titles: Record<string, string> = {
      'morning_productivity_peak': 'Optimize Morning Productivity',
      'excessive_context_switching': 'Reduce Context Switching',
      'deep_work_strength': 'Leverage Deep Work Ability',
      'monday_energy_advantage': 'Capitalize on Monday Energy',
      'post_lunch_energy_dip': 'Manage Post-Lunch Energy',
      'last_minute_goal_completion': 'Improve Goal Planning',
      'high_goal_abandonment': 'Reduce Goal Abandonment',
      'chronic_overestimation': 'Improve Time Estimation',
      'effective_break_timing': 'Optimize Break Schedule',
      'strong_habit_formation': 'Build More Positive Habits',
      'weekend_habit_dropoff': 'Maintain Weekend Habits'
    };
    
    return titles[pattern] || 'Optimization Opportunity';
  }

  private getImplementationCost(pattern: string): 'low' | 'medium' | 'high' {
    const lowCost = ['morning_productivity_peak', 'effective_break_timing', 'post_lunch_energy_dip'];
    const highCost = ['high_goal_abandonment', 'weekend_habit_dropoff'];
    
    if (lowCost.includes(pattern)) return 'low';
    if (highCost.includes(pattern)) return 'high';
    return 'medium';
  }

  private initializeInsightTemplates(): void {
    // Would initialize comprehensive insight templates for different scenarios
    // This is a simplified version
    this.insightTemplates = [
      {
        category: 'productivity',
        templates: [
          {
            condition: (data) => data.planAdherence < 0.7,
            title: 'Improve Planning Accuracy',
            message: (data) => `Your plan adherence is ${Math.round(data.planAdherence * 100)}%. Consider more realistic time estimates.`,
            actionable: true,
            impact: 'high',
            urgency: 'medium'
          }
        ]
      }
    ];
  }
}

// 🏭 EXPORT SINGLETON INSTANCE
export const microCoach = new UltraSmartMicroCoach();