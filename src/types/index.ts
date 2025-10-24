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
  createdAt: Date;
  updatedAt: Date;
  keyResults: KeyResult[];
}

export interface KeyResult {
  id: string;
  goalId: string;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  projectId?: string;
  goalId?: string;
  domainId: string;
  userId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  estimatedMinutes: number;
  actualMinutes?: number;
  dueDate?: Date;
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
  projectId?: string;
  domainId: string;
  userId: string;
  startTime: Date;
  endTime: Date;
  actualStartTime?: Date;
  actualEndTime?: Date;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled' | 'overrun';
  type: 'work' | 'break' | 'buffer' | 'travel' | 'meeting' | 'focus' | 'admin';
  location?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
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
  focus?: number;
  createdAt: Date;
  updatedAt: Date;
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
}