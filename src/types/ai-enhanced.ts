// 🧠 AI-ENHANCED DATA SCHEMA - Complete AI Integration Types

import { TimeBlock, Task, Goal, KeyResult } from '@/types';

// ===== AI ENGINE CORE TYPES =====

export interface AIEngine {
  naturalLanguageParser: NaturalLanguageParser;
  goalToPlanEngine: GoalToPlanEngine;
  autoScheduler: AutoScheduler;
  rePlanningEngine: RePlanningEngine;
  riskPredictor: RiskPredictor;
  microCoach: MicroCoach;
  secondBrain: SecondBrain;
}

// ===== NATURAL LANGUAGE PROCESSING =====

export interface NLParseRequest {
  input: string;
  context?: {
    currentDate: Date;
    activeGoals: Goal[];
    existingTasks: Task[];
    userPreferences: UserPreferences;
  };
}

export interface NLParseResult {
  confidence: number;
  parsedItems: ParsedItem[];
  clarificationNeeded?: ClarificationRequest[];
  rawInput: string;
}

export interface ParsedItem {
  type: 'task' | 'timeblock' | 'goal' | 'habit';
  data: ParsedTask | ParsedTimeBlock | ParsedGoal | ParsedHabit;
  confidence: number;
}

export interface ParsedTask {
  title: string;
  estimatedDuration?: number; // minutes
  deadline?: Date;
  priority: 'low' | 'medium' | 'high' | 'critical';
  goalId?: string;
  context: string[];
  energyRequired: 'low' | 'medium' | 'high';
  type: 'deep' | 'shallow' | 'admin' | 'creative';
  dependencies?: string[]; // task IDs
  recurrence?: RecurrencePattern;
}

export interface ParsedTimeBlock {
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  type: 'deep' | 'shallow' | 'break' | 'meeting' | 'admin';
  taskIds?: string[];
  energyLevel: 'low' | 'medium' | 'high';
  flexibility: number; // 0-1, how moveable this block is
}

export interface ParsedGoal {
  title: string;
  description?: string;
  deadline?: Date;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  measurable: boolean;
  keyResultsIdeas?: string[];
}

export interface ParsedHabit {
  title: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  category: string;
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'any';
  estimatedDuration?: number;
}

export interface ClarificationRequest {
  field: string;
  question: string;
  options?: string[];
  required: boolean;
}

export interface NaturalLanguageParser {
  parse(request: NLParseRequest): Promise<NLParseResult>;
  processClarification(originalRequest: NLParseRequest, answers: Record<string, any>): Promise<NLParseResult>;
}

// ===== GOAL-TO-PLAN ENGINE =====

export interface GoalDecomposition {
  goal: Goal;
  milestones: Milestone[];
  tasks: Task[];
  timeBlocks: TimeBlock[];
  weeklySchedule: WeeklyScheduleRecommendation;
}

export interface Milestone {
  id: string;
  goalId: string;
  title: string;
  description?: string;
  deadline: Date;
  progress: number; // 0-100
  dependencies?: string[];
  tasks: string[]; // task IDs
}

export interface WeeklyScheduleRecommendation {
  goalId: string;
  recommendedHoursPerWeek: number;
  preferredDays: string[]; // ['monday', 'tuesday', ...]
  preferredTimeSlots: TimeSlot[];
  reasoning: string;
}

export interface TimeSlot {
  start: string; // "09:00"
  end: string;   // "11:00"
  days: string[];
}

export interface GoalToPlanEngine {
  decompose(goal: Goal, keyResults: KeyResult[]): Promise<GoalDecomposition>;
  generateMilestones(goal: Goal, keyResults: KeyResult[]): Promise<Milestone[]>;
  generateTasks(milestones: Milestone[]): Promise<Task[]>;
  recommendSchedule(goal: Goal, tasks: Task[]): Promise<WeeklyScheduleRecommendation>;
}

// ===== AUTO-SCHEDULER =====

export interface SchedulingConstraints {
  userPreferences: UserPreferences;
  existingBlocks: TimeBlock[];
  energyProfile: EnergyProfile;
  deadlines: Deadline[];
  bufferPreferences: BufferPreferences;
}

export interface UserPreferences {
  workingHours: {
    start: string; // "09:00"
    end: string;   // "17:00"
  };
  deepWorkPreferences: {
    preferredTimes: TimeSlot[];
    maxBlockDuration: number; // minutes
    breaksBetween: number; // minutes
  };
  energyManagement: {
    highEnergyTimes: TimeSlot[];
    lowEnergyTimes: TimeSlot[];
  };
  contextSwitching: {
    minimumBlockDuration: number;
    maxTasksPerBlock: number;
  };
  breakPreferences: {
    shortBreakDuration: number; // 15
    longBreakDuration: number;  // 30
    breakFrequency: number;     // every 90 minutes
  };
}

export interface EnergyProfile {
  hourlyProfile: Record<string, number>; // "09": 0.8, "14": 0.6
  weeklyPattern: Record<string, number>;  // "monday": 0.9, "friday": 0.6
  personalFactors: {
    morningPerson: boolean;
    afternoonCrash: boolean;
    eveningBoost: boolean;
  };
}

export interface BufferPreferences {
  betweenTasks: number;     // minutes
  beforeDeadlines: number;  // hours
  dayStartBuffer: number;   // minutes
  dayEndBuffer: number;     // minutes
}

export interface SchedulingResult {
  schedule: TimeBlock[];
  conflicts: SchedulingConflict[];
  alternatives: AlternativeSchedule[];
  reasoning: string;
  confidence: number;
}

export interface SchedulingConflict {
  type: 'overlap' | 'energy_mismatch' | 'deadline_risk' | 'preference_violation';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  suggestions: string[];
}

export interface AlternativeSchedule {
  name: string;
  description: string;
  schedule: TimeBlock[];
  tradeoffs: string[];
  confidence: number;
}

export interface AutoScheduler {
  schedule(tasks: Task[], constraints: SchedulingConstraints): Promise<SchedulingResult>;
  optimizeExisting(blocks: TimeBlock[], constraints: SchedulingConstraints): Promise<SchedulingResult>;
  findAvailableSlots(duration: number, constraints: SchedulingConstraints): Promise<TimeSlot[]>;
}

// ===== RE-PLANNING ENGINE =====

export interface RePlanningTrigger {
  type: 'session_end' | 'overrun' | 'missed_block' | 'energy_change' | 'external_interrupt';
  timestamp: Date;
  affectedBlockId?: string;
  context: Record<string, any>;
}

export interface RePlanningOptions {
  strategy: 'save_day' | 'save_goal' | 'save_energy' | 'minimal_change';
  aggressiveness: 'conservative' | 'moderate' | 'aggressive';
  priorityGoals?: string[]; // goal IDs that cannot be compromised
}

export interface RePlanningResult {
  newSchedule: TimeBlock[];
  changes: ScheduleChange[];
  alternatives: AlternativeSchedule[];
  reasoning: string;
  impact: {
    goalsAffected: string[];
    deadlinesRisk: string[];
    energyImpact: 'positive' | 'neutral' | 'negative';
  };
}

export interface ScheduleChange {
  type: 'moved' | 'shortened' | 'cancelled' | 'postponed' | 'merged';
  originalBlock: TimeBlock;
  newBlock?: TimeBlock;
  reasoning: string;
}

export interface RePlanningEngine {
  handleTrigger(trigger: RePlanningTrigger, options: RePlanningOptions): Promise<RePlanningResult>;
  suggestRecovery(missedBlocks: TimeBlock[], remainingDay: TimeBlock[]): Promise<RePlanningResult>;
  adaptToEnergyChange(currentEnergy: number, originalSchedule: TimeBlock[]): Promise<RePlanningResult>;
}

// ===== RISK PREDICTOR =====

export interface GoalRiskAssessment {
  goalId: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  currentVelocity: number;        // progress per week
  requiredVelocity: number;       // needed to hit deadline
  estimatedCompletion: Date;
  riskFactors: RiskFactor[];
  recommendations: string[];
}

export interface RiskFactor {
  type: 'velocity' | 'consistency' | 'dependencies' | 'resource' | 'scope';
  description: string;
  impact: 'low' | 'medium' | 'high';
  mitigation?: string;
}

export interface TrajectoryPrediction {
  goalId: string;
  scenarios: {
    conservative: { completion: Date; probability: number };
    realistic: { completion: Date; probability: number };
    optimistic: { completion: Date; probability: number };
  };
  keyMilestones: { milestone: string; predictedDate: Date }[];
  blockers: string[];
}

export interface RiskPredictor {
  assessGoalRisk(goal: Goal, keyResults: KeyResult[], historicalData: any[]): Promise<GoalRiskAssessment>;
  predictTrajectory(goal: Goal, currentProgress: number): Promise<TrajectoryPrediction>;
  identifyBottlenecks(goal: Goal, tasks: Task[]): Promise<RiskFactor[]>;
}

// ===== MICRO COACH =====

export interface CoachingInsight {
  id: string;
  type: 'productivity' | 'energy' | 'goal_alignment' | 'habits' | 'planning';
  title: string;
  message: string;
  evidence: string[];           // data points supporting this insight
  actionable: boolean;
  implementationCost: 'low' | 'medium' | 'high';
  expectedImpact: 'low' | 'medium' | 'high';
  urgency: 'low' | 'medium' | 'high';
  categories: string[];
}

export interface PatternDetection {
  pattern: string;
  frequency: number;
  confidence: number;
  dataPoints: any[];
  suggestedAction?: string;
}

export interface MicroCoach {
  generateDailyInsight(userData: UserAnalysisData): Promise<CoachingInsight>;
  detectPatterns(historicalData: any[], timeframe: number): Promise<PatternDetection[]>;
  suggestOptimizations(currentPerformance: PerformanceMetrics): Promise<CoachingInsight[]>;
}

// ===== SECOND BRAIN (RAG) =====

export interface SemanticSearch {
  query: string;
  filters?: {
    dateRange?: { start: Date; end: Date };
    dataTypes?: ('tasks' | 'goals' | 'sessions' | 'notes' | 'insights')[];
    relevanceThreshold?: number;
  };
}

export interface SearchResult {
  id: string;
  type: 'task' | 'goal' | 'session' | 'note' | 'insight';
  content: string;
  relevanceScore: number;
  context: Record<string, any>;
  timestamp: Date;
}

export interface ConversationalQuery {
  question: string;
  context?: SearchResult[];
  followUp?: boolean;
}

export interface ConversationalResponse {
  answer: string;
  confidence: number;
  sources: SearchResult[];
  followUpQuestions?: string[];
  dataInsights?: string[];
}

export interface SecondBrain {
  semanticSearch(query: SemanticSearch): Promise<SearchResult[]>;
  askQuestion(query: ConversationalQuery): Promise<ConversationalResponse>;
  indexNewData(data: any, type: string): Promise<void>;
  generateSummary(timeframe: { start: Date; end: Date }): Promise<string>;
}

// ===== SUPPORTING TYPES =====

export interface RecurrencePattern {
  type: 'daily' | 'weekly' | 'monthly' | 'custom';
  interval: number;
  daysOfWeek?: number[]; // 0=Sunday, 1=Monday, ...
  endDate?: Date;
  exceptions?: Date[];
}

export interface Deadline {
  taskId?: string;
  goalId?: string;
  date: Date;
  type: 'soft' | 'hard';
  importance: 'low' | 'medium' | 'high' | 'critical';
}

export interface UserAnalysisData {
  recentSessions: any[];
  completedTasks: Task[];
  goalProgress: Record<string, number>;
  energyLevels: Record<string, number>;
  habitConsistency: Record<string, number>;
  planningAccuracy: {
    estimationError: number;
    completionRate: number;
  };
}

export interface PerformanceMetrics {
  productivity: {
    tasksCompletedPerDay: number;
    focusTimePerDay: number;
    planAdherence: number;
  };
  goalProgress: {
    weeklyVelocity: Record<string, number>;
    milestonesHit: number;
    atRiskGoals: number;
  };
  wellbeing: {
    energyConsistency: number;
    workLifeBalance: number;
    burnoutRisk: number;
  };
}

// ===== AI CONFIGURATION =====

export interface AIConfig {
  providers: {
    nlp: 'openai' | 'anthropic' | 'local';
    embeddings: 'openai' | 'local';
    reasoning: 'openai' | 'anthropic' | 'local';
  };
  endpoints?: {
    nlpAPI?: string;
    embeddingsAPI?: string;
    reasoningAPI?: string;
  };
  privacy: {
    localFirst: boolean;
    dataRetention: number; // days
    anonymization: boolean;
  };
  performance: {
    cachingEnabled: boolean;
    batchProcessing: boolean;
    backgroundUpdates: boolean;
  };
}