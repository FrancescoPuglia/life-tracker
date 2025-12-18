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
  theme: 'light' | 'dark' | 'auto';
  notifications: boolean;
  focusMode: boolean;
}

export interface Domain {
  id: string;
  name: string;
  color: string;
  icon: string;
  userId: string;
  createdAt: Date;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  domainId: string;
  userId: string;
  status: 'active' | 'completed' | 'paused';
  targetDate: Date;
  deadline?: Date; // Alias for targetDate for AI compatibility
  createdAt: Date;
  updatedAt: Date;
  keyResults: KeyResult[];
  // ===== GOAL-CENTRIC ANALYTICS ENHANCEMENTS =====
  timeAllocationTarget: number;  // Hours per week target
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: 'urgent_important' | 'important_not_urgent' | 'urgent_not_important' | 'neither';
  complexity: 'simple' | 'moderate' | 'complex' | 'expert';
  estimatedHours?: number; // Total hours estimated to complete
  actualHoursSpent?: number; // Calculated field for analytics
  progressVelocity?: number; // Progress per hour (calculated)
}

export interface KeyResult {
  id: string;
  goalId: string;
  userId: string; // 🔥 PSYCHOPATH FIX: Add missing userId
  title: string;
  description: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  progress: number;
  status: 'active' | 'completed' | 'at_risk';
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  goalId?: string;
  domainId: string;
  userId: string;
  status: 'active' | 'completed' | 'paused';
  priority: 'low' | 'medium' | 'high';
  dueDate?: Date;
  weeklyHoursTarget?: number;
  totalHoursTarget?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  projectId?: string;
  goalId?: string;
  goalIds?: string[]; // For AI multi-goal support
  domainId: string;
  userId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'todo';
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedMinutes: number;
  estimatedDuration?: number; // Alias for estimatedMinutes for AI compatibility
  actualMinutes?: number;
  dueDate?: Date;
  deadline?: Date; // Alias for dueDate for AI compatibility
  completedAt?: Date;
  ifThenPlan?: string;
  why?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimeBlock {
  id: string;
  title: string;
  description?: string;
  taskId?: string;
  taskIds?: string[]; // For AI multi-task support
  projectId?: string;
  goalId?: string;
  domainId: string;
  userId: string;
  startTime: Date;
  endTime: Date;
  actualStartTime?: Date;
  actualEndTime?: Date;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled' | 'overrun';
  type: 'work' | 'break' | 'buffer' | 'travel' | 'meeting' | 'focus' | 'admin' | 'deep' | 'shallow';
  color?: string; // Custom hex color override (e.g., #3b82f6)
  location?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  // ===== GOAL-CENTRIC ANALYTICS ENHANCEMENTS =====
  goalIds?: string[];        // Multiple goals per time block
  goalAllocation?: {         // Time percentage allocation per goal
    [goalId: string]: number; // 0-100% how much of this time block is for each goal
  };
  expectedImpact?: {         // Expected progress impact per goal
    [goalId: string]: number; // 0-100 estimated progress points
  };
}

export interface Session {
  id: string;
  timeBlockId?: string;
  taskId?: string;
  projectId?: string;
  domainId: string;
  userId: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: 'active' | 'paused' | 'completed';
  tags: string[];
  notes?: string;
  mood?: number;
  energy?: number;
  energyLevel?: number; // Alias for energy for AI compatibility
  focus?: number;
  createdAt: Date;
  updatedAt: Date;
  // ===== GOAL-CENTRIC ANALYTICS ENHANCEMENTS =====
  goalIds?: string[];        // Multiple goals per session
  goalContribution?: {       // Actual contribution scoring
    [goalId: string]: number; // 0-100% how much this session helped each goal
  };
  progressMade?: {           // Actual progress made per goal
    [goalId: string]: number; // Progress points achieved
  };
  learnings?: string[];      // Key learnings/insights from this session
  blockers?: string[];       // What blocked progress (for analytics)
}

export interface Habit {
  id: string;
  name: string;
  description?: string;
  domainId: string;
  userId: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  targetValue?: number;
  unit?: string;
  isActive: boolean;
  streakCount: number;
  bestStreak: number;
  createdAt: Date;
  updatedAt: Date;
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
  priority: 'low' | 'medium' | 'high' | 'critical';
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
  benchmarkComparison: number; // vs average for similar goals
  trendDirection: 'improving' | 'stable' | 'declining';
  optimalSessionLength: number; // hours
}

export interface GoalCompletion {
  currentProgress: number;
  estimatedCompletionDate: Date;
  onTrackStatus: 'ahead' | 'on_track' | 'behind' | 'critical';
  confidence: number; // 0-100%
  bottlenecks: Array<{ type: string; impact: number; solution: string }>;
  milestones: Array<{ date: Date; target: number; actual?: number }>;
  riskFactors: Array<{ factor: string; probability: number; impact: number }>;
}

export interface GoalEfficiency {
  sessionsCount: number;
  averageSessionLength: number;
  optimalTimeBlocks: string[]; // time of day when most productive
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
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  expectedImpact: number; // 0-100%
  effort: 'low' | 'medium' | 'high';
  timeline: string;
  actions: string[];
  reasoning: string;
}

export interface StrategicAllocation {
  currentAllocation: Array<{ goalId: string; hours: number; percentage: number; priority: string }>;
  recommendedAllocation: Array<{ goalId: string; hours: number; reason: string; impact: number }>;
  misalignmentScore: number; // 0-100, 0 = perfect alignment
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