// src/types/index.ts
// Tipi centrali del progetto (Life Tracker)

export type Theme = 'light' | 'dark' | 'auto';

// ====== COMMON ======
export interface BaseEntity {
  id: string;
  userId: string;
  domainId: string;
  deleted?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ====== OKR / STATUS ======
export type GoalStatus = 'active' | 'completed' | 'paused' | 'at_risk' | 'archived';
export type Priority = 'critical' | 'high' | 'medium' | 'low';

export type KeyResultStatus = 'active' | 'completed' | 'at_risk';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled' | 'todo';

export type TimeBlockStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled' | 'overrun';
export type SessionStatus = 'active' | 'paused' | 'completed';
export type HabitFrequency = 'daily' | 'weekly' | 'monthly';

// ============================================================================
// CORE USER / DOMAIN
// ============================================================================

export interface User {
  id: string;
  name: string;
  email: string;
  preferences: UserPreferences;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPreferences {
  timezone: string;
  workingHours: {
    start: string;
    end: string;
  };
  theme: Theme;
  notifications: boolean;
  focusMode: boolean;
}

export interface Domain extends BaseEntity {
  name: string;
  color: string;
  icon: string;
  domainId?: never; // per evitare confusione: Domain NON ha domainId
}

// ============================================================================
// OKR: GOAL / KEY RESULT / PROJECT / TASK
// ============================================================================

export interface Goal extends BaseEntity {
  title: string;
  description?: string;

  domainId: string; // qui è obbligatorio nel tuo progetto
  status: GoalStatus;
  priority: Priority;

  targetDate: Date;
  deadline?: Date; // Alias for targetDate for AI compatibility

  targetHours?: number; // utile per OKRManager
  timeAllocationTarget: number; // Hours per week target



  keyResults: KeyResult[];

  // ===== GOAL-CENTRIC ANALYTICS ENHANCEMENTS =====
  category: 'urgent_important' | 'important_not_urgent' | 'urgent_not_important' | 'neither';
  complexity: 'simple' | 'moderate' | 'complex' | 'expert';
  estimatedHours?: number; // Total hours estimated to complete
  actualHoursSpent?: number; // Calculated field for analytics
  progressVelocity?: number; // Progress per hour (calculated)
}

export interface KeyResult extends BaseEntity {
  // Nota: in alcuni dati legacy userId può mancare,
  // ma nel TUO file era required. Qui lo teniamo required via BaseEntity.
  goalId: string;
  title: string;
  description?: string;

  targetValue: number;
  currentValue: number;

  unit?: string;
  progress?: number;

  status: KeyResultStatus;
}

export interface Project extends BaseEntity {
  name: string;
  description?: string;

  // 🔥 CRITICO: per OKRManager dev’essere OBBLIGATORIO
  goalId: string;

  domainId: string;

  status: GoalStatus;
  priority: Priority;

  dueDate?: Date;
  weeklyHoursTarget?: number;
  totalHoursTarget?: number;
}

export interface Task extends BaseEntity {
  title: string;
  description?: string;

  // 🔥 CRITICO: per OKRManager dev’essere OBBLIGATORIO
  projectId: string;

  goalId?: string;
  goalIds?: string[]; // For AI multi-goal support

  domainId: string;

  status: TaskStatus;
  priority: Priority;

  estimatedMinutes: number;
  estimatedDuration?: number; // Alias for estimatedMinutes for AI compatibility
  actualMinutes?: number;

  dueDate?: Date;
  deadline?: Date; // Alias for dueDate for AI compatibility
  completedAt?: Date;

  ifThenPlan?: string;
  why?: string;
}

// ============================================================================
// TIME / SESSION
// ============================================================================

export interface TimeBlock extends BaseEntity {
  title: string;
  description?: string;

  taskId?: string;
  taskIds?: string[]; // For AI multi-task support

  projectId?: string;
  goalId?: string;

  domainId: string;

  startTime: Date;
  endTime: Date;

  actualStartTime?: Date;
  actualEndTime?: Date;

  status: TimeBlockStatus;
  type:
    | 'work'
    | 'break'
    | 'buffer'
    | 'travel'
    | 'meeting'
    | 'focus'
    | 'admin'
    | 'deep'
    | 'shallow';

  color?: string; // Custom hex color override (e.g., #3b82f6)
  location?: string;
  notes?: string;

  // ===== GOAL-CENTRIC ANALYTICS ENHANCEMENTS =====
  goalIds?: string[]; // Multiple goals per time block
  goalAllocation?: {
    [goalId: string]: number; // 0-100% how much of this time block is for each goal
  };
  expectedImpact?: {
    [goalId: string]: number; // 0-100 estimated progress points
  };
}

export interface Session extends BaseEntity {
  timeBlockId?: string;
  taskId?: string;
  projectId?: string;

  domainId: string;

  startTime: Date;
  endTime?: Date;

  duration?: number;
  status: SessionStatus;

  tags: string[];
  notes?: string;

  mood?: number;
  energy?: number;
  energyLevel?: number; // Alias for energy for AI compatibility
  focus?: number;

  // ===== GOAL-CENTRIC ANALYTICS ENHANCEMENTS =====
  goalIds?: string[];
  goalContribution?: {
    [goalId: string]: number;
  };
  progressMade?: {
    [goalId: string]: number;
  };
  learnings?: string[];
  blockers?: string[];
}

// ============================================================================
// HABITS
// ============================================================================

export interface Habit extends BaseEntity {
  name: string;
  description?: string;

  domainId: string;

  frequency: HabitFrequency;

  targetValue?: number;
  unit?: string;

  isActive: boolean;

  streakCount: number;
  bestStreak: number;
}

export interface HabitLog {
  id: string;
  habitId: string;
  userId: string;
  date: Date;
  completed: boolean;
  value?: number;
  notes?: string;
  createdAt: Date;
}

// ============================================================================
// METRICS / CALENDAR / DEADLINES / JOURNAL / INSIGHTS / ACHIEVEMENTS
// ============================================================================

export interface Metric {
  id: string;
  name: string;
  value: number | string | boolean;
  unit?: string;
  source: 'manual' | 'session' | 'habit' | 'external';
  domainId?: string;
  taskId?: string;
  projectId?: string;
  goalId?: string;
  userId: string;
  timestamp: Date;
  createdAt: Date;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  location?: string;
  attendees?: string[];
  isAllDay: boolean;
  recurrence?: RecurrenceRule;
  userId: string;
  externalId?: string;
  source: 'internal' | 'google' | 'outlook' | 'ical';
  createdAt: Date;
  updatedAt: Date;
}

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  endDate?: Date;
  occurrences?: number;
}

export interface Deadline {
  id: string;
  title: string;
  description?: string;
  dueDate: Date;
  priority: Priority;
  status: 'pending' | 'completed' | 'overdue';
  projectId?: string;
  goalId?: string;
  taskId?: string;
  userId: string;
  reminderDays: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface JournalEntry {
  id: string;
  title?: string;
  content: string;
  mood?: number;
  energy?: number;
  gratitude?: string[];
  wins?: string[];
  challenges?: string[];
  insights?: string[];
  tags: string[];
  userId: string;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Insight {
  id: string;
  type: 'pattern' | 'correlation' | 'suggestion' | 'alert';
  title: string;
  description: string;
  data: any;
  confidence: number;
  actionable: boolean;
  dismissed: boolean;
  userId: string;
  createdAt: Date;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  type: 'streak' | 'goal' | 'milestone' | 'consistency' | 'improvement';
  icon: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
  earnedAt: Date;
  userId: string;
  data?: any;
}

// ============================================================================
// KPI / DASHBOARD / ANALYTICS
// ============================================================================

export interface KPI {
  focusMinutes: number;
  planVsActual: number;
  activeStreaks: number;
  keyResultsProgress: number;
  sleepHours?: number;
  recoveryScore?: number;
  dailyWin?: string;
  mood?: number;
  energy?: number;
}

export interface DashboardState {
  currentSession?: Session;
  activeTimeBlock?: TimeBlock;
  todayKPIs: KPI;
  upcomingBlocks: TimeBlock[];
  recentInsights: Insight[];
  achievements: Achievement[];
  goalAnalytics?: GoalAnalytics[];
  strategicAllocation?: StrategicAllocation;
}

// ===== GOAL-CENTRIC ANALYTICS INTERFACES =====

export interface GoalAnalytics {
  goalId: string;
  timeInvestment: GoalTimeInvestment;
  roi: GoalROI;
  completion: GoalCompletion;
  efficiency: GoalEfficiency;
  trends: GoalTrends;
  recommendations: GoalRecommendation[];
}

export interface GoalTimeInvestment {
  totalHours: number;
  dailyAverage: number;
  weeklyTarget: number;
  weeklyActual: number;
  adherencePercentage: number;
  dailyTrend: Array<{ date: string; hours: number; sessions: number }>;
  weeklyTrend: Array<{ week: string; hours: number; efficiency: number }>;
  monthlyComparison: Array<{ month: string; hours: number; progress: number }>;
}

export interface GoalROI {
  hoursInvested: number;
  progressAchieved: number;
  progressPerHour: number;
  efficiency: 'exceptional' | 'high' | 'medium' | 'low' | 'critical';
  benchmarkComparison: number;
  trendDirection: 'improving' | 'stable' | 'declining';
  optimalSessionLength: number;
}

export interface GoalCompletion {
  currentProgress: number;
  estimatedCompletionDate: Date;
  onTrackStatus: 'ahead' | 'on_track' | 'behind' | 'critical';
  confidence: number;
  bottlenecks: Array<{ type: string; impact: number; solution: string }>;
  milestones: Array<{ date: Date; target: number; actual?: number }>;
  riskFactors: Array<{ factor: string; probability: number; impact: number }>;
}

export interface GoalEfficiency {
  sessionsCount: number;
  averageSessionLength: number;
  optimalTimeBlocks: string[];
  moodImpactCorrelation: number;
  energyImpactCorrelation: number;
  focusImpactCorrelation: number;
  bestDaysOfWeek: string[];
  productivityPatterns: Array<{ pattern: string; efficiency: number }>;
}

export interface GoalTrends {
  progressVelocity: Array<{ period: string; velocity: number }>;
  timeConsistency: Array<{ period: string; consistency: number }>;
  qualityTrend: Array<{ period: string; quality: number }>;
  motivationTrend: Array<{ period: string; motivation: number }>;
  blockerTrend: Array<{ period: string; blockers: string[] }>;
}

export interface GoalRecommendation {
  type: 'time_allocation' | 'scheduling' | 'priority' | 'strategy' | 'tools';
  priority: Priority;
  title: string;
  description: string;
  expectedImpact: number;
  effort: 'low' | 'medium' | 'high';
  timeline: string;
  actions: string[];
  reasoning: string;
}

export interface StrategicAllocation {
  currentAllocation: Array<{ goalId: string; hours: number; percentage: number; priority: string }>;
  recommendedAllocation: Array<{ goalId: string; hours: number; reason: string; impact: number }>;
  misalignmentScore: number;
  rebalancingSuggestions: Array<{
    fromGoal: string;
    toGoal: string;
    hours: number;
    reasoning: string;
    expectedBenefit: number;
  }>;
  opportunityCost: Array<{
    goalId: string;
    missedOpportunity: number;
    consequence: string;
  }>;
}

export interface AnalyticsData {
  planVsActual: Array<{
    date: string;
    planned: number;
    actual: number;
    adherence: number;
  }>;
  timeAllocation: Array<{
    domain: string;
    hours: number;
    color: string;
  }>;
  focusTrend: Array<{
    date: string;
    focusMinutes: number;
    mood: number;
    energy: number;
  }>;
  correlations: Array<{
    factor1: string;
    factor2: string;
    correlation: number;
    significance: string;
  }>;
  weeklyReview: {
    highlights: string[];
    challenges: string[];
    insights: string[];
    nextWeekGoals: string[];
  };
}
