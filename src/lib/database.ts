import { 
  User, Domain, Goal, KeyResult, Project, Task, TimeBlock, Session, 
  Habit, HabitLog, Metric, CalendarEvent, Deadline, JournalEntry, 
  Insight, Achievement, KPI, DashboardState 
} from '@/types';
import { DatabaseAdapter, firebaseAdapter } from './firebaseAdapter';

// IndexedDB Adapter (existing implementation)
class IndexedDBAdapter implements DatabaseAdapter {
  private db: IDBDatabase | null = null;
  private dbName = 'LifeTrackerDB';
  private version = 1;

  async init(): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('IndexedDB not available in server environment');
    }
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create object stores
        const stores = [
          'users', 'domains', 'goals', 'keyResults', 'projects', 'tasks',
          'timeBlocks', 'sessions', 'habits', 'habitLogs', 'metrics',
          'calendarEvents', 'deadlines', 'journalEntries', 'insights', 'achievements'
        ];

        stores.forEach(storeName => {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: 'id' });
            
            // Create indexes
            switch (storeName) {
              case 'sessions':
                store.createIndex('userId', 'userId');
                store.createIndex('status', 'status');
                store.createIndex('startTime', 'startTime');
                break;
              case 'timeBlocks':
                store.createIndex('userId', 'userId');
                store.createIndex('startTime', 'startTime');
                store.createIndex('status', 'status');
                break;
              case 'tasks':
                store.createIndex('userId', 'userId');
                store.createIndex('status', 'status');
                store.createIndex('priority', 'priority');
                store.createIndex('dueDate', 'dueDate');
                break;
              case 'habits':
                store.createIndex('userId', 'userId');
                store.createIndex('isActive', 'isActive');
                break;
              case 'habitLogs':
                store.createIndex('habitId', 'habitId');
                store.createIndex('date', 'date');
                break;
              case 'metrics':
                store.createIndex('userId', 'userId');
                store.createIndex('timestamp', 'timestamp');
                break;
              case 'insights':
                store.createIndex('userId', 'userId');
                store.createIndex('dismissed', 'dismissed');
                break;
              default:
                store.createIndex('userId', 'userId');
            }
          }
        });
      };
    });
  }

  private async getStore(storeName: string, mode: IDBTransactionMode = 'readonly') {
    if (!this.db) await this.init();
    const transaction = this.db!.transaction([storeName], mode);
    return transaction.objectStore(storeName);
  }

  async create<T extends { id?: string }>(storeName: string, data: T): Promise<T> {
    const store = await this.getStore(storeName, 'readwrite');
    
    // 🔥 PSYCHOPATH FIX: Generate unique ID if not provided
    if (!data.id) {
      data.id = `${storeName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    console.log('🔥 PSYCHOPATH: IndexedDB create called with:', {
      storeName,
      id: data.id,
      data: data
    });
    
    return new Promise((resolve, reject) => {
      // 🔥 PSYCHOPATH FIX: Use PUT instead of ADD to allow overwrites
      const request = store.put(data);
      request.onsuccess = () => {
        console.log('🔥 PSYCHOPATH: IndexedDB create SUCCESS:', data.id);
        resolve(data);
      };
      request.onerror = () => {
        console.error('🔥 PSYCHOPATH: IndexedDB create ERROR:', request.error);
        reject(request.error);
      };
    });
  }

  async read<T>(storeName: string, id: string): Promise<T | null> {
    const store = await this.getStore(storeName);
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async update<T extends { id: string }>(storeName: string, data: T): Promise<T> {
    const store = await this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(data);
      request.onsuccess = () => resolve(data);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName: string, id: string): Promise<void> {
    const store = await this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getAll<T>(storeName: string): Promise<T[]> {
    console.log(`🔥 PSYCHOPATH: IndexedDBAdapter.getAll() called for ${storeName}`);
    
    try {
      const store = await this.getStore(storeName);
      console.log(`🔥 PSYCHOPATH: IndexedDB store obtained for ${storeName}`);
      
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
          const result = request.result;
          console.log(`🔥 PSYCHOPATH: IndexedDBAdapter.getAll() SUCCESS for ${storeName}:`, {
            count: result.length,
            items: result.length > 0 ? result.map((item: any) => ({ id: item.id, userId: item.userId })) : 'No items'
          });
          resolve(result);
        };
        request.onerror = () => {
          console.error(`❌ PSYCHOPATH: IndexedDBAdapter.getAll() ERROR for ${storeName}:`, request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error(`❌ PSYCHOPATH: IndexedDBAdapter.getAll() OUTER ERROR for ${storeName}:`, error);
      throw error;
    }
  }

  async getByIndex<T>(storeName: string, indexName: string, value: any): Promise<T[]> {
    const store = await this.getStore(storeName);
    const index = store.index(indexName);
    return new Promise((resolve, reject) => {
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async query<T>(storeName: string, constraints: any[]): Promise<T[]> {
    // Simple implementation for IndexedDB - would need more complex logic for full query support
    return this.getAll<T>(storeName);
  }

  subscribe<T>(storeName: string, callback: (data: T[]) => void): () => void {
    // IndexedDB doesn't support real-time subscriptions
    // This is a simplified implementation that polls
    let isActive = true;
    const interval = setInterval(async () => {
      if (isActive) {
        try {
          const data = await this.getAll<T>(storeName);
          callback(data);
        } catch (error) {
          console.error(`Subscription error for ${storeName}:`, error);
        }
      }
    }, 5000); // Poll every 5 seconds

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }

  isOnline(): boolean {
    return navigator.onLine;
  }

  async enableOffline(): Promise<void> {
    // IndexedDB is always offline
    return Promise.resolve();
  }

  async enableOnline(): Promise<void> {
    // IndexedDB is always offline
    return Promise.resolve();
  }

  // Specific methods for common queries
  async getActiveSessions(userId: string): Promise<Session[]> {
    return this.getByIndex<Session>('sessions', 'status', 'active');
  }

  async getTodayTimeBlocks(userId: string): Promise<TimeBlock[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const store = await this.getStore('timeBlocks');
    const index = store.index('startTime');
    
    return new Promise((resolve, reject) => {
      const range = IDBKeyRange.bound(today, tomorrow, false, true);
      const request = index.getAll(range);
      request.onsuccess = () => {
        const blocks = request.result.filter((block: TimeBlock) => block.userId === userId);
        resolve(blocks);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getActiveHabits(userId: string): Promise<Habit[]> {
    const habits = await this.getByIndex<Habit>('habits', 'userId', userId);
    return habits.filter(habit => habit.isActive);
  }

  async getTodayHabitLogs(userId: string): Promise<HabitLog[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const logs = await this.getByIndex<HabitLog>('habitLogs', 'date', today);
    return logs.filter(log => log.userId === userId);
  }

  async getPendingInsights(userId: string): Promise<Insight[]> {
    const insights = await this.getByIndex<Insight>('insights', 'userId', userId);
    return insights.filter(insight => !insight.dismissed);
  }

  async calculateTodayKPIs(userId: string): Promise<KPI> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get today's completed sessions
    const sessions = await this.getByIndex<Session>('sessions', 'userId', userId);
    const todaySessions = sessions.filter(session => 
      session.startTime >= today && session.startTime < tomorrow && session.status === 'completed'
    );

    // Get today's time blocks
    const timeBlocks = await this.getTodayTimeBlocks(userId);
    
    // Calculate focus minutes
    const focusMinutes = todaySessions
      .filter(session => session.tags.includes('focus'))
      .reduce((total, session) => total + (session.duration || 0), 0);

    // Calculate plan vs actual
    const plannedMinutes = timeBlocks.reduce((total, block) => 
      total + (block.endTime.getTime() - block.startTime.getTime()) / (1000 * 60), 0
    );
    const actualMinutes = timeBlocks
      .filter(block => block.actualStartTime && block.actualEndTime)
      .reduce((total, block) => 
        total + (block.actualEndTime!.getTime() - block.actualStartTime!.getTime()) / (1000 * 60), 0
      );
    const planVsActual = plannedMinutes > 0 ? (actualMinutes / plannedMinutes) * 100 : 0;

    // Get active streaks
    const habits = await this.getActiveHabits(userId);
    const activeStreaks = habits.filter(habit => habit.streakCount > 0).length;

    return {
      focusMinutes: Math.round(focusMinutes),
      planVsActual: Math.round(planVsActual),
      activeStreaks,
      keyResultsProgress: 0, // TODO: Calculate from goals
      mood: todaySessions.find(s => s.mood !== undefined)?.mood,
      energy: todaySessions.find(s => s.energy !== undefined)?.energy,
    };
  }

  async calculatePlanVsActualData(userId: string, days: number = 7): Promise<Array<{
    date: string;
    planned: number;
    actual: number;
    adherence: number;
  }>> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = [];

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayStart = new Date(d);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(d);
      dayEnd.setHours(23, 59, 59, 999);

      // Get all time blocks for this day
      const allTimeBlocks = await this.getAll<TimeBlock>('timeBlocks');
      const dayTimeBlocks = allTimeBlocks.filter(block => 
        block.userId === userId &&
        new Date(block.startTime) >= dayStart && 
        new Date(block.startTime) <= dayEnd
      );

      // Calculate planned hours
      const plannedMinutes = dayTimeBlocks.reduce((total, block) => {
        const startTime = new Date(block.startTime);
        const endTime = new Date(block.endTime);
        return total + (endTime.getTime() - startTime.getTime()) / (1000 * 60);
      }, 0);

      // Calculate actual hours
      const actualMinutes = dayTimeBlocks.reduce((total, block) => {
        if (block.actualStartTime && block.actualEndTime) {
          const actualStart = new Date(block.actualStartTime);
          const actualEnd = new Date(block.actualEndTime);
          return total + (actualEnd.getTime() - actualStart.getTime()) / (1000 * 60);
        }
        return total;
      }, 0);

      const plannedHours = plannedMinutes / 60;
      const actualHours = actualMinutes / 60;
      const adherence = plannedHours > 0 ? (actualHours / plannedHours) * 100 : 0;

      result.push({
        date: d.toISOString().split('T')[0],
        planned: Number(plannedHours.toFixed(1)),
        actual: Number(actualHours.toFixed(1)),
        adherence: Math.round(adherence)
      });
    }

    return result;
  }

  async calculateTimeAllocation(userId: string, days: number = 7): Promise<Array<{
    domain: string;
    hours: number;
    color: string;
  }>> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get all domains
    const allDomains = await this.getAll<Domain>('domains');
    const userDomains = allDomains.filter(d => d.userId === userId);

    // Get all sessions in the period
    const allSessions = await this.getAll<Session>('sessions');
    const periodSessions = allSessions.filter(session => 
      session.userId === userId &&
      new Date(session.startTime) >= startDate &&
      new Date(session.startTime) <= endDate &&
      session.status === 'completed'
    );

    // Default colors for domains
    const defaultColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#f97316'];

    const domainHours = new Map<string, number>();

    // Calculate hours per domain
    for (const session of periodSessions) {
      const domain = userDomains.find(d => d.id === session.domainId);
      const domainName = domain?.name || 'Uncategorized';
      const hours = (session.duration || 0) / 3600; // Convert seconds to hours

      domainHours.set(domainName, (domainHours.get(domainName) || 0) + hours);
    }

    // Convert to array format
    const result = Array.from(domainHours.entries()).map(([domain, hours], index) => ({
      domain,
      hours: Number(hours.toFixed(1)),
      color: userDomains.find(d => d.name === domain)?.color || defaultColors[index % defaultColors.length]
    }));

    // Sort by hours descending
    return result.sort((a, b) => b.hours - a.hours);
  }

  async calculateFocusTrend(userId: string, days: number = 7): Promise<Array<{
    date: string;
    focusMinutes: number;
    mood: number;
    energy: number;
  }>> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = [];

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayStart = new Date(d);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(d);
      dayEnd.setHours(23, 59, 59, 999);

      // Get all sessions for this day
      const allSessions = await this.getAll<Session>('sessions');
      const daySessions = allSessions.filter(session => 
        session.userId === userId &&
        new Date(session.startTime) >= dayStart &&
        new Date(session.startTime) <= dayEnd &&
        session.status === 'completed'
      );

      // Calculate focus minutes
      const focusMinutes = daySessions
        .filter(session => session.tags.includes('focus'))
        .reduce((total, session) => total + (session.duration || 0), 0) / 60;

      // Calculate average mood and energy
      const moodSessions = daySessions.filter(s => s.mood !== undefined);
      const energySessions = daySessions.filter(s => s.energy !== undefined);

      const avgMood = moodSessions.length > 0 
        ? moodSessions.reduce((sum, s) => sum + (s.mood || 0), 0) / moodSessions.length 
        : 5;

      const avgEnergy = energySessions.length > 0
        ? energySessions.reduce((sum, s) => sum + (s.energy || 0), 0) / energySessions.length
        : 5;

      result.push({
        date: d.toISOString().split('T')[0],
        focusMinutes: Math.round(focusMinutes),
        mood: Math.round(avgMood * 10) / 10,
        energy: Math.round(avgEnergy * 10) / 10
      });
    }

    return result;
  }

  async calculateCorrelations(userId: string, days: number = 30): Promise<Array<{
    factor1: string;
    factor2: string;
    correlation: number;
    significance: string;
  }>> {
    const focusTrend = await this.calculateFocusTrend(userId, days);
    
    if (focusTrend.length < 3) {
      return []; // Need at least 3 data points for correlation
    }

    const correlations = [];

    // Calculate correlation between mood and focus
    const moodFocusCorr = this.calculatePearsonCorrelation(
      focusTrend.map(d => d.mood),
      focusTrend.map(d => d.focusMinutes)
    );

    // Calculate correlation between energy and focus
    const energyFocusCorr = this.calculatePearsonCorrelation(
      focusTrend.map(d => d.energy),
      focusTrend.map(d => d.focusMinutes)
    );

    // Calculate correlation between mood and energy
    const moodEnergyCorr = this.calculatePearsonCorrelation(
      focusTrend.map(d => d.mood),
      focusTrend.map(d => d.energy)
    );

    if (!isNaN(moodFocusCorr)) {
      correlations.push({
        factor1: 'Mood',
        factor2: 'Focus',
        correlation: Math.round(moodFocusCorr * 100) / 100,
        significance: this.getSignificance(Math.abs(moodFocusCorr))
      });
    }

    if (!isNaN(energyFocusCorr)) {
      correlations.push({
        factor1: 'Energy',
        factor2: 'Focus',
        correlation: Math.round(energyFocusCorr * 100) / 100,
        significance: this.getSignificance(Math.abs(energyFocusCorr))
      });
    }

    if (!isNaN(moodEnergyCorr)) {
      correlations.push({
        factor1: 'Mood',
        factor2: 'Energy',
        correlation: Math.round(moodEnergyCorr * 100) / 100,
        significance: this.getSignificance(Math.abs(moodEnergyCorr))
      });
    }

    return correlations;
  }

  private calculatePearsonCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) return NaN;

    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumYY = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));

    return denominator === 0 ? NaN : numerator / denominator;
  }

  private getSignificance(correlation: number): string {
    if (correlation >= 0.7) return 'High';
    if (correlation >= 0.5) return 'Medium';
    if (correlation >= 0.3) return 'Low';
    return 'None';
  }

  async generateWeeklyReview(userId: string): Promise<{
    highlights: string[];
    challenges: string[];
    insights: string[];
    nextWeekGoals: string[];
  }> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const planVsActual = await this.calculatePlanVsActualData(userId, 7);
    const timeAllocation = await this.calculateTimeAllocation(userId, 7);
    const focusTrend = await this.calculateFocusTrend(userId, 7);

    const highlights = [];
    const challenges = [];
    const insights = [];
    const nextWeekGoals = [];

    // Analyze adherence
    const avgAdherence = planVsActual.reduce((sum, day) => sum + day.adherence, 0) / planVsActual.length;
    if (avgAdherence >= 90) {
      highlights.push('Excellent planning adherence this week');
    } else if (avgAdherence < 70) {
      challenges.push('Low planning adherence - consider more realistic time blocks');
      nextWeekGoals.push('Improve time estimation accuracy');
    }

    // Analyze focus time
    const totalFocusHours = focusTrend.reduce((sum, day) => sum + day.focusMinutes, 0) / 60;
    if (totalFocusHours >= 20) {
      highlights.push('Strong focus time this week');
    } else if (totalFocusHours < 10) {
      challenges.push('Limited focused work time');
      nextWeekGoals.push('Schedule more deep focus blocks');
    }

    // Analyze domain balance
    const topDomain = timeAllocation[0];
    if (topDomain && topDomain.hours > timeAllocation.reduce((sum, d) => sum + d.hours, 0) * 0.6) {
      insights.push(`${topDomain.domain} dominated this week - consider better balance`);
      nextWeekGoals.push('Diversify time allocation across domains');
    }

    // Default content if nothing specific found
    if (highlights.length === 0) highlights.push('Keep building consistent habits');
    if (challenges.length === 0) challenges.push('Continue monitoring time allocation');
    if (insights.length === 0) insights.push('Track mood and energy for better patterns');
    if (nextWeekGoals.length === 0) nextWeekGoals.push('Maintain current momentum');

    return { highlights, challenges, insights, nextWeekGoals };
  }
}

// Main Database Wrapper
class LifeTrackerDB {
  private adapter: DatabaseAdapter;
  private useFirebase: boolean;

  constructor() {
    // Determine which adapter to use based on environment and configuration
    // Only use Firebase if we're in the browser and have proper config AND Firebase is initialized
    const hasFirebaseConfig = !!(typeof window !== 'undefined' && 
                     process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
                     process.env.NEXT_PUBLIC_FIREBASE_API_KEY !== 'demo-api-key');
    
    console.log('🔥 PSYCHOPATH: Database constructor - adapter selection:', {
      inBrowser: typeof window !== 'undefined',
      hasApiKey: !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      apiKeyValue: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      apiKeyNotDemo: process.env.NEXT_PUBLIC_FIREBASE_API_KEY !== 'demo-api-key',
      hasFirebaseConfig,
      firebaseAdapterExists: !!firebaseAdapter
    });
    
    this.useFirebase = hasFirebaseConfig && firebaseAdapter !== null;
    this.adapter = this.useFirebase ? firebaseAdapter! : new IndexedDBAdapter();
    
    console.log(`🔌 Database initialized with ${this.useFirebase ? 'Firebase' : 'IndexedDB'} adapter`);
    console.log('🔥 PSYCHOPATH: Final adapter info:', {
      useFirebase: this.useFirebase,
      adapterType: this.adapter?.constructor?.name,
      adapterInstance: !!this.adapter
    });
  }

  async init(): Promise<void> {
    await this.adapter.init();
  }

  get isUsingFirebase(): boolean {
    return this.useFirebase;
  }

  getAdapterDebugInfo(): {
    useFirebase: boolean;
    adapterType: string;
    hasAdapter: boolean;
    adapterMethods: string[];
    userId?: string;
    isInitialized?: boolean;
  } {
    const debugInfo = {
      useFirebase: this.useFirebase,
      adapterType: this.adapter?.constructor?.name || 'Unknown',
      hasAdapter: !!this.adapter,
      adapterMethods: this.adapter ? Object.getOwnPropertyNames(Object.getPrototypeOf(this.adapter)) : []
    };

    // Add Firebase-specific debug info
    if (this.useFirebase && this.adapter) {
      if ('userId' in this.adapter) {
        (debugInfo as any).userId = (this.adapter as any).userId;
      }
      if ('isInitialized' in this.adapter) {
        (debugInfo as any).isInitialized = (this.adapter as any).isInitialized;
      }
    }

    return debugInfo;
  }

  async switchToFirebase(userId: string): Promise<void> {
    console.log('🔥 PSYCHOPATH: switchToFirebase called with:', {
      userId,
      currentUseFirebase: this.useFirebase,
      firebaseAdapterExists: !!firebaseAdapter,
      currentAdapterType: this.adapter.constructor.name
    });
    
    if (!this.useFirebase && firebaseAdapter) {
      console.log('🔥 PSYCHOPATH: Switching from IndexedDB to Firebase');
      this.adapter = firebaseAdapter;
      this.useFirebase = true;
      
      if ('setUserId' in this.adapter) {
        console.log('🔥 PSYCHOPATH: Calling setUserId on adapter');
        (this.adapter as any).setUserId(userId);
      }
      
      await this.adapter.init();
      console.log('✅ Switched to Firebase adapter');
    } else if (!firebaseAdapter) {
      console.warn('⚠️ Cannot switch to Firebase - adapter not initialized');
    } else {
      console.log('🔥 PSYCHOPATH: Already using Firebase, just setting userId');
      if ('setUserId' in this.adapter) {
        console.log('🔥 PSYCHOPATH: Setting userId on existing Firebase adapter');
        (this.adapter as any).setUserId(userId);
      }
    }
  }

  async switchToIndexedDB(): Promise<void> {
    if (this.useFirebase) {
      this.adapter = new IndexedDBAdapter();
      this.useFirebase = false;
      await this.adapter.init();
      console.log('Switched to IndexedDB adapter');
    }
  }

  // Delegate all methods to the current adapter
  async create<T extends { id?: string }>(storeName: string, data: T): Promise<T> {
    console.log(`🔥 PSYCHOPATH: LifeTrackerDB.create() called for ${storeName}`, {
      useFirebase: this.useFirebase,
      adapterType: this.adapter?.constructor?.name,
      hasAdapter: !!this.adapter,
      dataId: data.id,
      dataUserId: (data as any).userId,
      timestamp: new Date().toISOString()
    });
    
    try {
      console.log(`🔥 PSYCHOPATH: About to call adapter.create(${storeName}) on ${this.adapter.constructor.name}`);
      const result = await this.adapter.create(storeName, data);
      console.log(`🔥 PSYCHOPATH: LifeTrackerDB.create() SUCCESS for ${storeName}:`, {
        resultId: result.id,
        resultUserId: (result as any).userId,
        adapterUsed: this.adapter.constructor.name
      });
      return result;
    } catch (error) {
      console.error(`❌ PSYCHOPATH: LifeTrackerDB.create() ERROR for ${storeName}:`, {
        error: error,
        errorMessage: error instanceof Error ? error.message : String(error),
        adapterType: this.adapter?.constructor?.name,
        useFirebase: this.useFirebase
      });
      throw error;
    }
  }

  async read<T>(storeName: string, id: string): Promise<T | null> {
    return this.adapter.read(storeName, id);
  }

  async update<T extends { id: string }>(storeName: string, data: T): Promise<T> {
    return this.adapter.update(storeName, data);
  }

  async delete(storeName: string, id: string): Promise<void> {
    return this.adapter.delete(storeName, id);
  }

  async getAll<T>(storeName: string): Promise<T[]> {
    console.log(`🔥 PSYCHOPATH: LifeTrackerDB.getAll() called for ${storeName}`, {
      useFirebase: this.useFirebase,
      adapterType: this.adapter?.constructor?.name,
      hasAdapter: !!this.adapter,
      adapterMethods: this.adapter ? Object.getOwnPropertyNames(Object.getPrototypeOf(this.adapter)) : [],
      timestamp: new Date().toISOString()
    });
    
    // Additional debugging to check adapter state
    if (this.useFirebase && this.adapter) {
      console.log(`🔥 PSYCHOPATH: Firebase adapter details:`, {
        hasGetAllMethod: typeof this.adapter.getAll === 'function',
        hasInitMethod: typeof this.adapter.init === 'function',
        adapterStringified: this.adapter.toString ? this.adapter.toString() : 'No toString method'
      });
      
      // Check if Firebase adapter has userId set (if it has setUserId method)
      if ('getUserId' in this.adapter) {
        console.log(`🔥 PSYCHOPATH: Firebase adapter userId:`, (this.adapter as any).getUserId());
      }
      if ('userId' in this.adapter) {
        console.log(`🔥 PSYCHOPATH: Firebase adapter userId property:`, (this.adapter as any).userId);
      }
    }
    
    try {
      console.log(`🔥 PSYCHOPATH: About to call adapter.getAll(${storeName}) on ${this.adapter.constructor.name}`);
      const result = await this.adapter.getAll(storeName);
      console.log(`🔥 PSYCHOPATH: LifeTrackerDB.getAll() result for ${storeName}:`, {
        count: result.length,
        items: result.length > 0 ? result.map((item: any) => ({ 
          id: item.id, 
          userId: item.userId,
          type: typeof item,
          keys: Object.keys(item).slice(0, 5) // Show first 5 keys
        })) : 'No items returned',
        firstItem: result.length > 0 ? JSON.stringify(result[0], null, 2) : 'No first item'
      });
      return result as T[];
    } catch (error) {
      console.error(`❌ PSYCHOPATH: LifeTrackerDB.getAll() ERROR for ${storeName}:`, {
        error: error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : 'No stack trace',
        adapterType: this.adapter?.constructor?.name,
        useFirebase: this.useFirebase
      });
      throw error;
    }
  }

  async getByIndex<T>(storeName: string, indexName: string, value: any): Promise<T[]> {
    return this.adapter.getByIndex(storeName, indexName, value);
  }

  subscribe<T>(storeName: string, callback: (data: T[]) => void): () => void {
    return this.adapter.subscribe(storeName, callback);
  }

  isOnline(): boolean {
    return this.adapter.isOnline();
  }

  async enableOffline(): Promise<void> {
    return this.adapter.enableOffline();
  }

  async enableOnline(): Promise<void> {
    return this.adapter.enableOnline();
  }

  // Specific methods for common queries (keep existing implementation)
  async getActiveSessions(userId: string): Promise<Session[]> {
    return this.getByIndex<Session>('sessions', 'status', 'active');
  }

  async getTodayTimeBlocks(userId: string): Promise<TimeBlock[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (this.useFirebase) {
      // Use Firebase query
      return (this.adapter as any).query('timeBlocks', [
        { type: 'where', field: 'startTime', operator: '>=', value: today },
        { type: 'where', field: 'startTime', operator: '<', value: tomorrow }
      ]);
    } else {
      // Fallback to IndexedDB implementation
      const store = await (this.adapter as any).getStore('timeBlocks');
      const index = store.index('startTime');
      
      return new Promise((resolve, reject) => {
        const range = IDBKeyRange.bound(today, tomorrow, false, true);
        const request = index.getAll(range);
        request.onsuccess = () => {
          const blocks = request.result.filter((block: TimeBlock) => block.userId === userId);
          resolve(blocks);
        };
        request.onerror = () => reject(request.error);
      });
    }
  }

  async getActiveHabits(userId: string): Promise<Habit[]> {
    const habits = await this.getByIndex<Habit>('habits', 'userId', userId);
    return habits.filter(habit => habit.isActive);
  }

  async getTodayHabitLogs(userId: string): Promise<HabitLog[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const logs = await this.getByIndex<HabitLog>('habitLogs', 'date', today);
    return logs.filter(log => log.userId === userId);
  }

  async getPendingInsights(userId: string): Promise<Insight[]> {
    const insights = await this.getByIndex<Insight>('insights', 'userId', userId);
    return insights.filter(insight => !insight.dismissed);
  }

  async calculateTodayKPIs(userId: string): Promise<KPI> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get today's completed sessions
    const sessions = await this.getByIndex<Session>('sessions', 'userId', userId);
    const todaySessions = sessions.filter(session => 
      session.startTime >= today && session.startTime < tomorrow && session.status === 'completed'
    );

    // Get today's time blocks
    const timeBlocks = await this.getTodayTimeBlocks(userId);
    
    // Calculate focus minutes
    const focusMinutes = todaySessions
      .filter(session => session.tags.includes('focus'))
      .reduce((total, session) => total + (session.duration || 0), 0);

    // Calculate plan vs actual
    const plannedMinutes = timeBlocks.reduce((total, block) => 
      total + (block.endTime.getTime() - block.startTime.getTime()) / (1000 * 60), 0
    );
    const actualMinutes = timeBlocks
      .filter(block => block.actualStartTime && block.actualEndTime)
      .reduce((total, block) => 
        total + (block.actualEndTime!.getTime() - block.actualStartTime!.getTime()) / (1000 * 60), 0
      );
    const planVsActual = plannedMinutes > 0 ? (actualMinutes / plannedMinutes) * 100 : 0;

    // Get active streaks
    const habits = await this.getActiveHabits(userId);
    const activeStreaks = habits.filter(habit => habit.streakCount > 0).length;

    return {
      focusMinutes: Math.round(focusMinutes),
      planVsActual: Math.round(planVsActual),
      activeStreaks,
      keyResultsProgress: 0, // TODO: Calculate from goals
      mood: todaySessions.find(s => s.mood !== undefined)?.mood,
      energy: todaySessions.find(s => s.energy !== undefined)?.energy,
    };
  }

  async calculatePlanVsActualData(userId: string, days: number = 7): Promise<Array<{
    date: string;
    planned: number;
    actual: number;
    adherence: number;
  }>> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = [];

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayStart = new Date(d);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(d);
      dayEnd.setHours(23, 59, 59, 999);

      // Get all time blocks for this day
      const allTimeBlocks = await this.getAll<TimeBlock>('timeBlocks');
      const dayTimeBlocks = allTimeBlocks.filter(block => 
        block.userId === userId &&
        new Date(block.startTime) >= dayStart && 
        new Date(block.startTime) <= dayEnd
      );

      // Calculate planned hours
      const plannedMinutes = dayTimeBlocks.reduce((total, block) => {
        const startTime = new Date(block.startTime);
        const endTime = new Date(block.endTime);
        return total + (endTime.getTime() - startTime.getTime()) / (1000 * 60);
      }, 0);

      // Calculate actual hours
      const actualMinutes = dayTimeBlocks.reduce((total, block) => {
        if (block.actualStartTime && block.actualEndTime) {
          const actualStart = new Date(block.actualStartTime);
          const actualEnd = new Date(block.actualEndTime);
          return total + (actualEnd.getTime() - actualStart.getTime()) / (1000 * 60);
        }
        return total;
      }, 0);

      const plannedHours = plannedMinutes / 60;
      const actualHours = actualMinutes / 60;
      const adherence = plannedHours > 0 ? (actualHours / plannedHours) * 100 : 0;

      result.push({
        date: d.toISOString().split('T')[0],
        planned: Number(plannedHours.toFixed(1)),
        actual: Number(actualHours.toFixed(1)),
        adherence: Math.round(adherence)
      });
    }

    return result;
  }

  async calculateTimeAllocation(userId: string, days: number = 7): Promise<Array<{
    domain: string;
    hours: number;
    color: string;
  }>> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get all domains
    const allDomains = await this.getAll<Domain>('domains');
    const userDomains = allDomains.filter(d => d.userId === userId);

    // Get all sessions in the period
    const allSessions = await this.getAll<Session>('sessions');
    const periodSessions = allSessions.filter(session => 
      session.userId === userId &&
      new Date(session.startTime) >= startDate &&
      new Date(session.startTime) <= endDate &&
      session.status === 'completed'
    );

    // Default colors for domains
    const defaultColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#f97316'];

    const domainHours = new Map<string, number>();

    // Calculate hours per domain
    for (const session of periodSessions) {
      const domain = userDomains.find(d => d.id === session.domainId);
      const domainName = domain?.name || 'Uncategorized';
      const hours = (session.duration || 0) / 3600; // Convert seconds to hours

      domainHours.set(domainName, (domainHours.get(domainName) || 0) + hours);
    }

    // Convert to array format
    const result = Array.from(domainHours.entries()).map(([domain, hours], index) => ({
      domain,
      hours: Number(hours.toFixed(1)),
      color: userDomains.find(d => d.name === domain)?.color || defaultColors[index % defaultColors.length]
    }));

    // Sort by hours descending
    return result.sort((a, b) => b.hours - a.hours);
  }

  async calculateFocusTrend(userId: string, days: number = 7): Promise<Array<{
    date: string;
    focusMinutes: number;
    mood: number;
    energy: number;
  }>> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = [];

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayStart = new Date(d);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(d);
      dayEnd.setHours(23, 59, 59, 999);

      // Get all sessions for this day
      const allSessions = await this.getAll<Session>('sessions');
      const daySessions = allSessions.filter(session => 
        session.userId === userId &&
        new Date(session.startTime) >= dayStart &&
        new Date(session.startTime) <= dayEnd &&
        session.status === 'completed'
      );

      // Calculate focus minutes
      const focusMinutes = daySessions
        .filter(session => session.tags.includes('focus'))
        .reduce((total, session) => total + (session.duration || 0), 0) / 60;

      // Calculate average mood and energy
      const moodSessions = daySessions.filter(s => s.mood !== undefined);
      const energySessions = daySessions.filter(s => s.energy !== undefined);

      const avgMood = moodSessions.length > 0 
        ? moodSessions.reduce((sum, s) => sum + (s.mood || 0), 0) / moodSessions.length 
        : 5;

      const avgEnergy = energySessions.length > 0
        ? energySessions.reduce((sum, s) => sum + (s.energy || 0), 0) / energySessions.length
        : 5;

      result.push({
        date: d.toISOString().split('T')[0],
        focusMinutes: Math.round(focusMinutes),
        mood: Math.round(avgMood * 10) / 10,
        energy: Math.round(avgEnergy * 10) / 10
      });
    }

    return result;
  }

  async calculateCorrelations(userId: string, days: number = 30): Promise<Array<{
    factor1: string;
    factor2: string;
    correlation: number;
    significance: string;
  }>> {
    const focusTrend = await this.calculateFocusTrend(userId, days);
    
    if (focusTrend.length < 3) {
      return []; // Need at least 3 data points for correlation
    }

    const correlations = [];

    // Calculate correlation between mood and focus
    const moodFocusCorr = this.calculatePearsonCorrelation(
      focusTrend.map(d => d.mood),
      focusTrend.map(d => d.focusMinutes)
    );

    // Calculate correlation between energy and focus
    const energyFocusCorr = this.calculatePearsonCorrelation(
      focusTrend.map(d => d.energy),
      focusTrend.map(d => d.focusMinutes)
    );

    // Calculate correlation between mood and energy
    const moodEnergyCorr = this.calculatePearsonCorrelation(
      focusTrend.map(d => d.mood),
      focusTrend.map(d => d.energy)
    );

    if (!isNaN(moodFocusCorr)) {
      correlations.push({
        factor1: 'Mood',
        factor2: 'Focus',
        correlation: Math.round(moodFocusCorr * 100) / 100,
        significance: this.getSignificance(Math.abs(moodFocusCorr))
      });
    }

    if (!isNaN(energyFocusCorr)) {
      correlations.push({
        factor1: 'Energy',
        factor2: 'Focus',
        correlation: Math.round(energyFocusCorr * 100) / 100,
        significance: this.getSignificance(Math.abs(energyFocusCorr))
      });
    }

    if (!isNaN(moodEnergyCorr)) {
      correlations.push({
        factor1: 'Mood',
        factor2: 'Energy',
        correlation: Math.round(moodEnergyCorr * 100) / 100,
        significance: this.getSignificance(Math.abs(moodEnergyCorr))
      });
    }

    return correlations;
  }

  private calculatePearsonCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) return NaN;

    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumYY = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));

    return denominator === 0 ? NaN : numerator / denominator;
  }

  private getSignificance(correlation: number): string {
    if (correlation >= 0.7) return 'High';
    if (correlation >= 0.5) return 'Medium';
    if (correlation >= 0.3) return 'Low';
    return 'None';
  }

  async generateWeeklyReview(userId: string): Promise<{
    highlights: string[];
    challenges: string[];
    insights: string[];
    nextWeekGoals: string[];
  }> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const planVsActual = await this.calculatePlanVsActualData(userId, 7);
    const timeAllocation = await this.calculateTimeAllocation(userId, 7);
    const focusTrend = await this.calculateFocusTrend(userId, 7);

    const highlights = [];
    const challenges = [];
    const insights = [];
    const nextWeekGoals = [];

    // Analyze adherence
    const avgAdherence = planVsActual.reduce((sum, day) => sum + day.adherence, 0) / planVsActual.length;
    if (avgAdherence >= 90) {
      highlights.push('Excellent planning adherence this week');
    } else if (avgAdherence < 70) {
      challenges.push('Low planning adherence - consider more realistic time blocks');
      nextWeekGoals.push('Improve time estimation accuracy');
    }

    // Analyze focus time
    const totalFocusHours = focusTrend.reduce((sum, day) => sum + day.focusMinutes, 0) / 60;
    if (totalFocusHours >= 20) {
      highlights.push('Strong focus time this week');
    } else if (totalFocusHours < 10) {
      challenges.push('Limited focused work time');
      nextWeekGoals.push('Schedule more deep focus blocks');
    }

    // Analyze domain balance
    const topDomain = timeAllocation[0];
    if (topDomain && topDomain.hours > timeAllocation.reduce((sum, d) => sum + d.hours, 0) * 0.6) {
      insights.push(`${topDomain.domain} dominated this week - consider better balance`);
      nextWeekGoals.push('Diversify time allocation across domains');
    }

    // Default content if nothing specific found
    if (highlights.length === 0) highlights.push('Keep building consistent habits');
    if (challenges.length === 0) challenges.push('Continue monitoring time allocation');
    if (insights.length === 0) insights.push('Track mood and energy for better patterns');
    if (nextWeekGoals.length === 0) nextWeekGoals.push('Maintain current momentum');

    return { highlights, challenges, insights, nextWeekGoals };
  }
}

export const db = new LifeTrackerDB();