// ⚠️ RISK PREDICTOR - Trajectory Analysis & Future Problem Detection
// MODALITÀ PSICOPATICO APOCALITTICO 🔥🔥🔥🔥🔥

import {
  RiskPredictor, GoalRiskAssessment, RiskFactor, TrajectoryPrediction
} from '@/types/ai-enhanced';
import { Goal, KeyResult, Task, TimeBlock, Session, HabitLog } from '@/types';

interface PredictionContext {
  historicalData: any[];
  currentProgress: Record<string, number>;
  velocityData: Record<string, number[]>; // Weekly velocities
  consistencyMetrics: Record<string, number>;
  resourceConstraints: {
    timeAvailable: number;    // hours per week
    energyCapacity: number;   // 0-1 scale  
    skillLevel: number;       // 0-1 scale
    externalFactors: string[];
  };
  seasonalPatterns: Record<string, number>;
  riskPatterns: Array<{
    pattern: string;
    frequency: number;
    impact: 'low' | 'medium' | 'high';
    triggers: string[];
  }>;
}

interface VelocityAnalysis {
  current: number;        // Progress per week
  required: number;       // Needed to hit deadline  
  trending: number;       // 4-week trend
  consistency: number;    // Variance measure (0-1)
  sustainability: number; // Burnout risk (0-1)
  confidence: number;     // Prediction confidence
}

interface BottleneckAnalysis {
  timeBottlenecks: Array<{
    resource: string;
    severity: number;
    impact: string[];
    mitigation: string[];
  }>;
  skillBottlenecks: Array<{
    skill: string;
    gap: number;
    learningTime: number;
    alternatives: string[];
  }>;
  dependencyBottlenecks: Array<{
    dependency: string;
    blockingTasks: string[];
    criticalPath: boolean;
    riskLevel: number;
  }>;
  energyBottlenecks: Array<{
    pattern: string;
    frequency: number;
    energyImpact: number;
    solutions: string[];
  }>;
}

interface RiskSimulation {
  scenario: string;
  probability: number;
  impact: 'catastrophic' | 'major' | 'moderate' | 'minor';
  timeToImpact: number; // days
  preventionStrategies: string[];
  contingencyPlans: string[];
  earlyWarnings: string[];
}

export class UltraSmartRiskPredictor implements RiskPredictor {
  private predictionCache: Map<string, { result: any; timestamp: Date; ttl: number }> = new Map();
  private riskPatterns: Array<{ pattern: RegExp; risk: string; severity: number }> = [];
  private historicalAccuracy: number = 0.75; // Track prediction accuracy over time

  constructor() {
    this.initializeRiskPatterns();
  }

  // 🎯 MAIN RISK ASSESSMENT ENGINE
  async assessGoalRisk(goal: Goal, keyResults: KeyResult[], historicalData: any[]): Promise<GoalRiskAssessment> {
    console.log('⚠️ RISK PREDICTOR: Analyzing goal risk for', goal.title);

    try {
      // 🔥 BUILD PREDICTION CONTEXT
      const context = await this.buildPredictionContext(goal, keyResults, historicalData);
      
      // 📊 VELOCITY ANALYSIS
      const velocityAnalysis = this.analyzeVelocity(goal, keyResults, context);
      
      // 🔍 BOTTLENECK DETECTION
      const bottlenecks = await this.identifyBottlenecks(goal, keyResults, context);
      
      // 🎭 RISK SIMULATION
      const simulations = await this.runRiskSimulations(goal, context, velocityAnalysis);
      
      // 🧠 MACHINE LEARNING PATTERN DETECTION
      const mlRisks = this.detectMLPatterns(goal, context);
      
      // ⚡ COMPREHENSIVE RISK CALCULATION
      const riskLevel = this.calculateOverallRisk(velocityAnalysis, bottlenecks, simulations, mlRisks);
      
      // 🎯 GENERATE RECOMMENDATIONS
      const recommendations = this.generateSmartRecommendations(
        goal, velocityAnalysis, bottlenecks, simulations, riskLevel
      );

      const assessment: GoalRiskAssessment = {
        goalId: goal.id,
        riskLevel: riskLevel.level,
        confidence: riskLevel.confidence,
        currentVelocity: velocityAnalysis.current,
        requiredVelocity: velocityAnalysis.required,
        estimatedCompletion: this.calculateEstimatedCompletion(goal, velocityAnalysis),
        riskFactors: this.consolidateRiskFactors(bottlenecks, simulations, mlRisks),
        recommendations
      };

      console.log('⚠️ RISK ASSESSMENT COMPLETE:', assessment);
      return assessment;

    } catch (error) {
      console.error('⚠️ RISK PREDICTOR ERROR:', error);
      return this.createFallbackAssessment(goal);
    }
  }

  // 📈 TRAJECTORY PREDICTION ENGINE
  async predictTrajectory(goal: Goal, currentProgress: number): Promise<TrajectoryPrediction> {
    console.log('📈 TRAJECTORY PREDICTION for', goal.title, 'at', currentProgress * 100, '%');

    try {
      const context = await this.buildPredictionContext(goal, [], []);
      const velocityData = context.velocityData[goal.id] || [0.1, 0.15, 0.2]; // Default velocity pattern
      
      // 🎯 MONTE CARLO SIMULATION
      const scenarios = this.runMonteCarloSimulation(goal, currentProgress, velocityData, 1000);
      
      // 🔍 MILESTONE PREDICTION
      const keyMilestones = this.predictKeyMilestones(goal, scenarios, currentProgress);
      
      // ⚠️ BLOCKER PREDICTION
      const blockers = this.predictBlockers(goal, context, scenarios);

      return {
        goalId: goal.id,
        scenarios: {
          conservative: scenarios.conservative,
          realistic: scenarios.realistic,
          optimistic: scenarios.optimistic
        },
        keyMilestones,
        blockers
      };

    } catch (error) {
      console.error('📈 TRAJECTORY PREDICTION ERROR:', error);
      return this.createFallbackTrajectory(goal);
    }
  }

  // 🔍 BOTTLENECK IDENTIFICATION SUPREME
  async identifyBottlenecks(goal: Goal, tasks: Task[]): Promise<RiskFactor[]> {
    console.log('🔍 BOTTLENECK ANALYSIS for goal:', goal.title);

    const context = await this.buildPredictionContext(goal, [], []);
    const bottlenecks = await this.analyzeBottlenecks(goal, tasks, context);
    
    const riskFactors: RiskFactor[] = [];

    // TIME BOTTLENECKS
    for (const timeBottleneck of bottlenecks.timeBottlenecks) {
      riskFactors.push({
        type: 'resource',
        description: `Time constraint: ${timeBottleneck.resource} (${timeBottleneck.severity * 100}% severity)`,
        impact: timeBottleneck.severity > 0.7 ? 'high' : timeBottleneck.severity > 0.4 ? 'medium' : 'low',
        mitigation: timeBottleneck.mitigation.join(', ')
      });
    }

    // SKILL BOTTLENECKS
    for (const skillBottleneck of bottlenecks.skillBottlenecks) {
      riskFactors.push({
        type: 'scope',
        description: `Skill gap: ${skillBottleneck.skill} (${skillBottleneck.gap * 100}% gap)`,
        impact: skillBottleneck.gap > 0.6 ? 'high' : skillBottleneck.gap > 0.3 ? 'medium' : 'low',
        mitigation: `Learning time required: ${skillBottleneck.learningTime} hours. Alternatives: ${skillBottleneck.alternatives.join(', ')}`
      });
    }

    // DEPENDENCY BOTTLENECKS
    for (const depBottleneck of bottlenecks.dependencyBottlenecks) {
      riskFactors.push({
        type: 'dependencies',
        description: `Dependency risk: ${depBottleneck.dependency} blocking ${depBottleneck.blockingTasks.length} tasks`,
        impact: depBottleneck.criticalPath ? 'high' : depBottleneck.riskLevel > 0.5 ? 'medium' : 'low',
        mitigation: 'Consider parallel work streams, backup plans, or stakeholder escalation'
      });
    }

    return riskFactors;
  }

  // 🧠 VELOCITY ANALYSIS ENGINE
  private analyzeVelocity(goal: Goal, keyResults: KeyResult[], context: PredictionContext): VelocityAnalysis {
    const goalId = goal.id;
    const velocityHistory = context.velocityData[goalId] || [0.05, 0.1, 0.15, 0.12]; // Weekly progress %
    
    // Current velocity (last 2 weeks average)
    const recentVelocity = velocityHistory.slice(-2);
    const current = recentVelocity.reduce((sum, v) => sum + v, 0) / recentVelocity.length;
    
    // Required velocity calculation
    const now = new Date();
    const deadline = new Date(goal.targetDate);
    const weeksRemaining = Math.max(1, (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 7));
    const currentProgress = this.calculateCurrentProgress(goal, keyResults);
    const progressNeeded = 1 - currentProgress;
    const required = progressNeeded / weeksRemaining;
    
    // Trending analysis (4-week linear regression)
    const trending = this.calculateTrend(velocityHistory.slice(-4));
    
    // Consistency analysis (coefficient of variation)
    const mean = velocityHistory.reduce((sum, v) => sum + v, 0) / velocityHistory.length;
    const variance = velocityHistory.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / velocityHistory.length;
    const consistency = 1 - Math.sqrt(variance) / mean; // Higher = more consistent
    
    // Sustainability analysis (burnout risk)
    const maxSustainableVelocity = 0.25; // 25% progress per week max
    const sustainability = Math.max(0, 1 - (required / maxSustainableVelocity));
    
    // Confidence calculation
    const velocityRatio = Math.min(2, current / Math.max(0.01, required));
    const confidence = Math.min(0.95, consistency * sustainability * Math.min(1, velocityRatio));

    return {
      current,
      required,
      trending,
      consistency,
      sustainability,
      confidence
    };
  }

  // 🔍 COMPREHENSIVE BOTTLENECK ANALYSIS
  private async analyzeBottlenecks(goal: Goal, tasks: Task[], context: PredictionContext): Promise<BottleneckAnalysis> {
    const timeBottlenecks = this.analyzeTimeBottlenecks(goal, tasks, context);
    const skillBottlenecks = this.analyzeSkillBottlenecks(goal, tasks, context);
    const dependencyBottlenecks = this.analyzeDependencyBottlenecks(goal, tasks, context);
    const energyBottlenecks = this.analyzeEnergyBottlenecks(goal, context);

    return {
      timeBottlenecks,
      skillBottlenecks,
      dependencyBottlenecks,
      energyBottlenecks
    };
  }

  // ⏰ TIME BOTTLENECK ANALYSIS
  private analyzeTimeBottlenecks(goal: Goal, tasks: Task[], context: PredictionContext): Array<{
    resource: string;
    severity: number;
    impact: string[];
    mitigation: string[];
  }> {
    const bottlenecks = [];
    
    // Total time required vs available
    const totalTaskTime = tasks.reduce((sum, task) => sum + (task.estimatedMinutes || 60), 0) / 60; // Convert to hours
    const availableTime = context.resourceConstraints.timeAvailable;
    const timeRatio = totalTaskTime / availableTime;
    
    if (timeRatio > 1.2) { // 120% over-allocation
      bottlenecks.push({
        resource: 'Total Time Allocation',
        severity: Math.min(1, (timeRatio - 1) * 2), // Scale to 0-1
        impact: [
          'Goal deadline at risk',
          'Potential quality compromise',
          'Burnout risk increase',
          'Other goals may suffer'
        ],
        mitigation: [
          'Reduce scope or delegate tasks',
          'Extend deadline if possible',
          'Increase time allocation',
          'Parallelize work streams',
          'Focus on highest impact activities'
        ]
      });
    }
    
    // Deep work time shortage
    const deepWorkTasks = tasks.filter(task => 
      (task.title + ' ' + task.description).toLowerCase().includes('design') ||
      (task.title + ' ' + task.description).toLowerCase().includes('create') ||
      (task.title + ' ' + task.description).toLowerCase().includes('analyze')
    );
    const deepWorkTime = deepWorkTasks.reduce((sum, task) => sum + (task.estimatedMinutes || 60), 0) / 60;
    const availableDeepWork = availableTime * 0.4; // Assume 40% can be deep work
    
    if (deepWorkTime > availableDeepWork * 1.1) {
      bottlenecks.push({
        resource: 'Deep Work Time',
        severity: Math.min(1, deepWorkTime / availableDeepWork - 1),
        impact: [
          'Complex tasks may be rushed',
          'Quality concerns for critical deliverables',
          'Innovation and creativity constrained'
        ],
        mitigation: [
          'Protect larger time blocks for deep work',
          'Eliminate non-essential meetings',
          'Batch similar shallow tasks',
          'Consider alternative approaches requiring less deep thought'
        ]
      });
    }

    return bottlenecks;
  }

  // 🎓 SKILL BOTTLENECK ANALYSIS
  private analyzeSkillBottlenecks(goal: Goal, tasks: Task[], context: PredictionContext): Array<{
    skill: string;
    gap: number;
    learningTime: number;
    alternatives: string[];
  }> {
    const bottlenecks = [];
    const requiredSkills = this.extractRequiredSkills(goal, tasks);
    const currentSkillLevel = context.resourceConstraints.skillLevel;
    
    for (const skill of requiredSkills) {
      const skillGap = this.calculateSkillGap(skill, currentSkillLevel);
      
      if (skillGap > 0.2) { // Significant skill gap
        bottlenecks.push({
          skill,
          gap: skillGap,
          learningTime: skillGap * 40, // Assume 40 hours per skill level
          alternatives: this.getSkillAlternatives(skill)
        });
      }
    }

    return bottlenecks;
  }

  // 🔗 DEPENDENCY BOTTLENECK ANALYSIS
  private analyzeDependencyBottlenecks(goal: Goal, tasks: Task[], context: PredictionContext): Array<{
    dependency: string;
    blockingTasks: string[];
    criticalPath: boolean;
    riskLevel: number;
  }> {
    // Simplified dependency analysis
    // In a real implementation, this would analyze task dependencies
    const bottlenecks = [];
    
    // External stakeholder dependencies
    const stakeholderTasks = tasks.filter(task => 
      (task.description || '').toLowerCase().includes('approval') ||
      (task.description || '').toLowerCase().includes('review') ||
      (task.description || '').toLowerCase().includes('feedback')
    );
    
    if (stakeholderTasks.length > 0) {
      bottlenecks.push({
        dependency: 'External Stakeholder Approvals',
        blockingTasks: stakeholderTasks.map(t => t.title),
        criticalPath: stakeholderTasks.length > tasks.length * 0.3, // >30% of tasks
        riskLevel: 0.6 // Moderate risk by default
      });
    }

    return bottlenecks;
  }

  // ⚡ ENERGY BOTTLENECK ANALYSIS
  private analyzeEnergyBottlenecks(goal: Goal, context: PredictionContext): Array<{
    pattern: string;
    frequency: number;
    energyImpact: number;
    solutions: string[];
  }> {
    const bottlenecks = [];
    
    // High energy requirement vs capacity
    const energyCapacity = context.resourceConstraints.energyCapacity;
    const goalIntensity = this.calculateGoalIntensity(goal);
    
    if (goalIntensity > energyCapacity * 1.2) {
      bottlenecks.push({
        pattern: 'High Intensity vs Energy Capacity Mismatch',
        frequency: 0.8, // 80% of time
        energyImpact: goalIntensity - energyCapacity,
        solutions: [
          'Break goal into smaller, less intensive milestones',
          'Increase recovery time between intensive periods',
          'Build energy capacity through better habits',
          'Delegate high-energy tasks where possible',
          'Time intensive work during natural energy peaks'
        ]
      });
    }

    return bottlenecks;
  }

  // 🎭 RISK SIMULATION ENGINE
  private async runRiskSimulations(goal: Goal, context: PredictionContext, velocity: VelocityAnalysis): Promise<RiskSimulation[]> {
    const simulations: RiskSimulation[] = [];

    // Velocity decline simulation
    if (velocity.trending < 0) {
      simulations.push({
        scenario: 'Continued Velocity Decline',
        probability: Math.abs(velocity.trending) * 0.7,
        impact: velocity.current < velocity.required * 0.5 ? 'catastrophic' : 
               velocity.current < velocity.required * 0.7 ? 'major' : 'moderate',
        timeToImpact: 14, // 2 weeks
        preventionStrategies: [
          'Identify and address root causes of slowdown',
          'Simplify approach or reduce scope',
          'Add resources or support',
          'Improve processes and remove blockers'
        ],
        contingencyPlans: [
          'Extend deadline with stakeholder approval',
          'Reduce scope to core deliverables',
          'Bring in additional resources',
          'Switch to minimum viable approach'
        ],
        earlyWarnings: [
          'Two consecutive weeks of declining progress',
          'Increasing task completion times',
          'Rising stress levels or team complaints',
          'Missed intermediate milestones'
        ]
      });
    }

    // Resource shortage simulation
    if (context.resourceConstraints.timeAvailable < 20) { // Less than 20 hours per week
      simulations.push({
        scenario: 'Time Resource Shortage',
        probability: 0.6,
        impact: 'major',
        timeToImpact: 7, // 1 week
        preventionStrategies: [
          'Negotiate for more time allocation',
          'Eliminate non-essential activities',
          'Improve efficiency through better tools/processes',
          'Outsource or delegate where possible'
        ],
        contingencyPlans: [
          'Extend timeline',
          'Reduce deliverable scope',
          'Work overtime (unsustainable)',
          'Pause other projects temporarily'
        ],
        earlyWarnings: [
          'Calendar consistently over 80% booked',
          'Frequent overtime or weekend work',
          'Other projects falling behind',
          'Stress indicators rising'
        ]
      });
    }

    // External dependency risk
    simulations.push({
      scenario: 'External Dependency Delay',
      probability: 0.3,
      impact: 'moderate',
      timeToImpact: 21, // 3 weeks
      preventionStrategies: [
        'Build buffer time into dependencies',
        'Maintain regular communication with stakeholders',
        'Develop backup plans for critical dependencies',
        'Start dependency requests early'
      ],
      contingencyPlans: [
        'Escalate to higher management',
        'Find alternative providers/approaches',
        'Work around the dependency temporarily',
        'Adjust timeline to accommodate delay'
      ],
      earlyWarnings: [
        'Stakeholder communication slowing down',
        'Missed dependency milestones',
        'Changes in external priorities',
        'Resource constraints at dependency source'
      ]
    });

    return simulations;
  }

  // 🧠 MACHINE LEARNING PATTERN DETECTION
  private detectMLPatterns(goal: Goal, context: PredictionContext): Array<{ pattern: string; risk: number; evidence: string[] }> {
    const patterns = [];

    // Historical failure pattern analysis
    for (const riskPattern of context.riskPatterns) {
      const goalText = (goal.title + ' ' + goal.description).toLowerCase();
      const patternMatches = riskPattern.triggers.filter(trigger => goalText.includes(trigger.toLowerCase()));
      
      if (patternMatches.length > 0) {
        patterns.push({
          pattern: riskPattern.pattern,
          risk: riskPattern.frequency * (riskPattern.impact === 'high' ? 0.9 : riskPattern.impact === 'medium' ? 0.6 : 0.3),
          evidence: patternMatches
        });
      }
    }

    // Seasonal pattern detection
    const month = new Date().getMonth();
    const seasonalRisk = context.seasonalPatterns[month.toString()] || 0.5;
    
    if (seasonalRisk > 0.7 || seasonalRisk < 0.3) {
      patterns.push({
        pattern: 'Seasonal Performance Variation',
        risk: Math.abs(seasonalRisk - 0.5) * 2,
        evidence: [`Historical ${seasonalRisk > 0.7 ? 'high' : 'low'} performance in ${this.getMonthName(month)}`]
      });
    }

    return patterns;
  }

  // 📊 MONTE CARLO SIMULATION
  private runMonteCarloSimulation(goal: Goal, currentProgress: number, velocityData: number[], iterations: number): {
    conservative: { completion: Date; probability: number };
    realistic: { completion: Date; probability: number };
    optimistic: { completion: Date; probability: number };
  } {
    const results: number[] = [];
    const progressRemaining = 1 - currentProgress;
    const baseVelocity = velocityData[velocityData.length - 1] || 0.1;
    
    for (let i = 0; i < iterations; i++) {
      // Simulate velocity variations
      const velocityVariation = 1 + (Math.random() - 0.5) * 0.4; // ±20% variation
      const simulatedVelocity = baseVelocity * velocityVariation;
      
      // Account for productivity decline over time
      const fatigueFactors = Math.random() * 0.2 + 0.9; // 90-100% efficiency
      const effectiveVelocity = simulatedVelocity * fatigueFactors;
      
      const weeksToComplete = progressRemaining / Math.max(0.01, effectiveVelocity);
      results.push(weeksToComplete);
    }
    
    results.sort((a, b) => a - b);
    
    const now = new Date();
    const percentile10 = results[Math.floor(iterations * 0.1)];
    const percentile50 = results[Math.floor(iterations * 0.5)];
    const percentile90 = results[Math.floor(iterations * 0.9)];
    
    return {
      optimistic: {
        completion: new Date(now.getTime() + percentile10 * 7 * 24 * 60 * 60 * 1000),
        probability: 0.9
      },
      realistic: {
        completion: new Date(now.getTime() + percentile50 * 7 * 24 * 60 * 60 * 1000),
        probability: 0.5
      },
      conservative: {
        completion: new Date(now.getTime() + percentile90 * 7 * 24 * 60 * 60 * 1000),
        probability: 0.1
      }
    };
  }

  // 🎯 SMART RECOMMENDATIONS ENGINE
  private generateSmartRecommendations(
    goal: Goal,
    velocity: VelocityAnalysis,
    bottlenecks: BottleneckAnalysis,
    simulations: RiskSimulation[],
    riskLevel: { level: 'low' | 'medium' | 'high' | 'critical'; confidence: number }
  ): string[] {
    const recommendations: string[] = [];

    // Velocity-based recommendations
    if (velocity.current < velocity.required * 0.8) {
      recommendations.push(`🚀 Increase velocity by ${Math.round((velocity.required / velocity.current - 1) * 100)}% to stay on track`);
      recommendations.push('📊 Focus on highest-impact activities only');
      recommendations.push('⚡ Consider scope reduction or timeline extension');
    }

    if (velocity.consistency < 0.6) {
      recommendations.push('🎯 Improve consistency: establish regular work rhythm and remove blockers');
    }

    if (velocity.sustainability < 0.7) {
      recommendations.push('⚠️ Current pace unsustainable - plan for recovery periods');
      recommendations.push('🔄 Consider distributing work more evenly over time');
    }

    // Bottleneck-based recommendations
    if (bottlenecks.timeBottlenecks.length > 0) {
      recommendations.push('⏰ Critical time constraints detected - prioritize ruthlessly');
      recommendations.push('🔥 Eliminate all non-essential activities');
    }

    if (bottlenecks.skillBottlenecks.length > 0) {
      const topSkillGap = bottlenecks.skillBottlenecks[0];
      recommendations.push(`🎓 Address skill gap: ${topSkillGap.skill} (${topSkillGap.learningTime}h learning time)`);
      recommendations.push(`🤝 Consider: ${topSkillGap.alternatives.join(', ')}`);
    }

    if (bottlenecks.dependencyBottlenecks.length > 0) {
      recommendations.push('🔗 Proactively manage external dependencies');
      recommendations.push('📞 Escalate critical blockers to stakeholders');
    }

    // Risk level recommendations
    if (riskLevel.level === 'critical') {
      recommendations.push('🚨 CRITICAL: Immediate intervention required');
      recommendations.push('🎯 Focus on minimum viable outcome only');
      recommendations.push('📞 Escalate to leadership for additional resources');
    } else if (riskLevel.level === 'high') {
      recommendations.push('⚠️ HIGH RISK: Weekly progress reviews needed');
      recommendations.push('🔄 Prepare contingency plans');
    }

    // Simulation-based recommendations
    const highProbRisks = simulations.filter(sim => sim.probability > 0.5);
    if (highProbRisks.length > 0) {
      recommendations.push(`🎭 Prepare for likely scenario: ${highProbRisks[0].scenario}`);
      recommendations.push(`📋 Implement early warnings: ${highProbRisks[0].earlyWarnings[0]}`);
    }

    return recommendations.slice(0, 8); // Limit to top 8 recommendations
  }

  // 🔧 UTILITY METHODS
  private initializeRiskPatterns(): void {
    this.riskPatterns = [
      { pattern: /complex|difficult|challenging/i, risk: 'scope_creep', severity: 0.7 },
      { pattern: /learn|new|unfamiliar/i, risk: 'skill_gap', severity: 0.6 },
      { pattern: /team|collaborate|coordinate/i, risk: 'dependency', severity: 0.5 },
      { pattern: /tight|urgent|asap/i, risk: 'time_pressure', severity: 0.8 },
      { pattern: /perfect|excellent|best/i, risk: 'perfectionism', severity: 0.4 }
    ];
  }

  private async buildPredictionContext(goal: Goal, keyResults: KeyResult[], historicalData: any[]): Promise<PredictionContext> {
    // Build comprehensive context - simplified for demo
    return {
      historicalData,
      currentProgress: { [goal.id]: this.calculateCurrentProgress(goal, keyResults) },
      velocityData: { [goal.id]: [0.05, 0.1, 0.15, 0.12] }, // Mock weekly velocities
      consistencyMetrics: { [goal.id]: 0.7 },
      resourceConstraints: {
        timeAvailable: goal.timeAllocationTarget || 10, // hours per week
        energyCapacity: 0.8,
        skillLevel: 0.7,
        externalFactors: ['stakeholder_availability', 'resource_competition']
      },
      seasonalPatterns: {
        '0': 0.3, '1': 0.4, '2': 0.6, '3': 0.7, '4': 0.8, '5': 0.9, // Jan-June
        '6': 0.7, '7': 0.6, '8': 0.8, '9': 0.9, '10': 0.7, '11': 0.4  // Jul-Dec
      },
      riskPatterns: [
        { pattern: 'scope_creep', frequency: 0.3, impact: 'high', triggers: ['complex', 'comprehensive', 'complete'] },
        { pattern: 'skill_gap', frequency: 0.4, impact: 'medium', triggers: ['learn', 'new', 'unfamiliar'] },
        { pattern: 'dependency_delay', frequency: 0.2, impact: 'high', triggers: ['approval', 'review', 'stakeholder'] }
      ]
    };
  }

  private calculateCurrentProgress(goal: Goal, keyResults: KeyResult[]): number {
    if (keyResults.length === 0) return 0;
    const totalProgress = keyResults.reduce((sum, kr) => sum + (kr.progress || 0), 0);
    return totalProgress / (keyResults.length * 100); // Convert to 0-1 scale
  }

  private calculateTrend(velocities: number[]): number {
    if (velocities.length < 2) return 0;
    
    // Simple linear regression slope
    const n = velocities.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = velocities.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * velocities[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);
    
    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }

  private calculateOverallRisk(
    velocity: VelocityAnalysis,
    bottlenecks: BottleneckAnalysis,
    simulations: RiskSimulation[],
    mlRisks: Array<{ pattern: string; risk: number; evidence: string[] }>
  ): { level: 'low' | 'medium' | 'high' | 'critical'; confidence: number } {
    let riskScore = 0;
    let confidence = 0.5;

    // Velocity risk
    const velocityRisk = Math.max(0, (velocity.required / Math.max(0.01, velocity.current)) - 1);
    riskScore += Math.min(0.4, velocityRisk * 0.4); // Max 40% from velocity

    // Bottleneck risk
    const bottleneckCount = bottlenecks.timeBottlenecks.length + 
                           bottlenecks.skillBottlenecks.length + 
                           bottlenecks.dependencyBottlenecks.length;
    riskScore += Math.min(0.3, bottleneckCount * 0.1); // Max 30% from bottlenecks

    // Simulation risk
    const highImpactSims = simulations.filter(sim => 
      sim.impact === 'catastrophic' || sim.impact === 'major'
    );
    const simRisk = highImpactSims.reduce((sum, sim) => sum + sim.probability, 0) / simulations.length;
    riskScore += simRisk * 0.2; // Max 20% from simulations

    // ML pattern risk
    const mlRisk = mlRisks.reduce((sum, risk) => sum + risk.risk, 0) / Math.max(1, mlRisks.length);
    riskScore += mlRisk * 0.1; // Max 10% from ML

    // Confidence calculation
    confidence = Math.min(0.95, velocity.confidence * 0.6 + this.historicalAccuracy * 0.4);

    // Determine risk level
    let level: 'low' | 'medium' | 'high' | 'critical';
    if (riskScore > 0.8) level = 'critical';
    else if (riskScore > 0.6) level = 'high';
    else if (riskScore > 0.3) level = 'medium';
    else level = 'low';

    return { level, confidence };
  }

  private calculateEstimatedCompletion(goal: Goal, velocity: VelocityAnalysis): Date {
    const currentProgress = 0.3; // Simplified
    const progressRemaining = 1 - currentProgress;
    const weeksToComplete = progressRemaining / Math.max(0.01, velocity.current);
    
    const now = new Date();
    return new Date(now.getTime() + weeksToComplete * 7 * 24 * 60 * 60 * 1000);
  }

  private consolidateRiskFactors(
    bottlenecks: BottleneckAnalysis,
    simulations: RiskSimulation[],
    mlRisks: Array<{ pattern: string; risk: number; evidence: string[] }>
  ): RiskFactor[] {
    const factors: RiskFactor[] = [];

    // Add bottleneck factors
    bottlenecks.timeBottlenecks.forEach(tb => {
      factors.push({
        type: 'resource',
        description: tb.resource,
        impact: tb.severity > 0.7 ? 'high' : tb.severity > 0.4 ? 'medium' : 'low',
        mitigation: tb.mitigation.join(', ')
      });
    });

    // Add high-probability simulation risks
    simulations.filter(sim => sim.probability > 0.4).forEach(sim => {
      factors.push({
        type: 'dependencies',
        description: sim.scenario,
        impact: sim.impact === 'catastrophic' || sim.impact === 'major' ? 'high' : 'medium',
        mitigation: sim.preventionStrategies.join(', ')
      });
    });

    return factors;
  }

  private predictKeyMilestones(goal: Goal, scenarios: any, currentProgress: number): Array<{ milestone: string; predictedDate: Date }> {
    const milestones = [];
    const now = new Date();
    
    // 25%, 50%, 75%, 90% completion milestones
    const milestonePercentages = [0.25, 0.5, 0.75, 0.9];
    
    for (const percentage of milestonePercentages) {
      if (percentage > currentProgress) {
        // Estimate based on realistic scenario
        const progressNeeded = percentage - currentProgress;
        const totalProgressNeeded = 1 - currentProgress;
        const timeToRealistic = scenarios.realistic.completion.getTime() - now.getTime();
        const timeToMilestone = timeToRealistic * (progressNeeded / totalProgressNeeded);
        
        milestones.push({
          milestone: `${percentage * 100}% Complete`,
          predictedDate: new Date(now.getTime() + timeToMilestone)
        });
      }
    }

    return milestones;
  }

  private predictBlockers(goal: Goal, context: PredictionContext, scenarios: any): string[] {
    const blockers: string[] = [];
    
    // Predict based on historical patterns
    if (context.resourceConstraints.timeAvailable < 15) {
      blockers.push('Time allocation shortage will likely cause delays');
    }
    
    if (context.resourceConstraints.skillLevel < 0.6) {
      blockers.push('Skill gaps may require additional learning time');
    }
    
    if (scenarios.realistic.completion > new Date(goal.targetDate)) {
      blockers.push('Current velocity insufficient to meet deadline');
    }

    return blockers;
  }

  // Additional utility methods
  private extractRequiredSkills(goal: Goal, tasks: Task[]): string[] {
    const skillKeywords = [
      'programming', 'design', 'analysis', 'writing', 'presentation',
      'research', 'planning', 'leadership', 'communication', 'technical'
    ];
    
    const text = (goal.title + ' ' + goal.description + ' ' + 
                 tasks.map(t => t.title + ' ' + t.description).join(' ')).toLowerCase();
    
    return skillKeywords.filter(skill => text.includes(skill));
  }

  private calculateSkillGap(skill: string, currentLevel: number): number {
    // Simplified skill gap calculation
    const requiredLevels: Record<string, number> = {
      'programming': 0.8,
      'design': 0.7,
      'analysis': 0.6,
      'writing': 0.5,
      'presentation': 0.6
    };
    
    const required = requiredLevels[skill] || 0.6;
    return Math.max(0, required - currentLevel);
  }

  private getSkillAlternatives(skill: string): string[] {
    const alternatives: Record<string, string[]> = {
      'programming': ['Use low-code tools', 'Hire developer', 'Partner with technical team'],
      'design': ['Use templates', 'Hire designer', 'Use AI design tools'],
      'analysis': ['Use analytics tools', 'Hire analyst', 'Simplify to basic metrics'],
      'writing': ['Use writing tools', 'Hire writer', 'Focus on bullet points']
    };
    
    return alternatives[skill] || ['Delegate', 'Outsource', 'Simplify approach'];
  }

  private calculateGoalIntensity(goal: Goal): number {
    // Simplified intensity calculation based on priority and complexity
    const priorityMultiplier = goal.priority === 'critical' ? 1.0 : 
                              goal.priority === 'high' ? 0.8 :
                              goal.priority === 'medium' ? 0.6 : 0.4;
    
    const complexityMultiplier = goal.complexity === 'expert' ? 1.0 :
                                goal.complexity === 'complex' ? 0.8 :
                                goal.complexity === 'moderate' ? 0.6 : 0.4;
    
    return priorityMultiplier * complexityMultiplier;
  }

  private getMonthName(month: number): string {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return months[month];
  }

  private createFallbackAssessment(goal: Goal): GoalRiskAssessment {
    return {
      goalId: goal.id,
      riskLevel: 'medium',
      confidence: 0.3,
      currentVelocity: 0.1,
      requiredVelocity: 0.15,
      estimatedCompletion: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days
      riskFactors: [{
        type: 'velocity',
        description: 'Insufficient data for accurate risk assessment',
        impact: 'medium',
        mitigation: 'Collect more progress data and establish tracking metrics'
      }],
      recommendations: ['Set up proper progress tracking', 'Define measurable milestones']
    };
  }

  private createFallbackTrajectory(goal: Goal): TrajectoryPrediction {
    const now = new Date();
    const threeMonths = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    
    return {
      goalId: goal.id,
      scenarios: {
        conservative: { completion: new Date(threeMonths.getTime() + 30 * 24 * 60 * 60 * 1000), probability: 0.9 },
        realistic: { completion: threeMonths, probability: 0.5 },
        optimistic: { completion: new Date(threeMonths.getTime() - 30 * 24 * 60 * 60 * 1000), probability: 0.1 }
      },
      keyMilestones: [
        { milestone: '50% Complete', predictedDate: new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000) }
      ],
      blockers: ['Insufficient progress data for accurate prediction']
    };
  }
}

// 🔥 EXPORT SINGLETON
export const riskPredictor = new UltraSmartRiskPredictor();