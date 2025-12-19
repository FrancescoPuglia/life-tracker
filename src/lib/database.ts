import { 
  User, Domain, Goal, KeyResult, Project, Task, TimeBlock, Session, 
  Habit, HabitLog, Metric, CalendarEvent, Deadline, JournalEntry, 
  Insight, Achievement, KPI, DashboardState 
} from '@/types';
import { DatabaseAdapter, firebaseAdapter } from './firebaseAdapter';
import { firebaseConfig } from '@/config/firebaseConfig';

// No-op in-memory adapter for non-browser/server contexts
class MemoryAdapter implements DatabaseAdapter {
  private store: Record<string, any[]> = {};

  async init(): Promise<void> { return; }
  async create<T extends { id?: string }>(collection: string, data: T): Promise<T> {
    if (!this.store[collection]) this.store[collection] = [];
    if (!data.id) data.id = `${collection}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.store[collection].push(data);
    return data;
  }
  async read<T>(collection: string, id: string): Promise<T | null> {
    const items = this.store[collection] || [];
    return (items.find((item) => item.id === id) as T) || null;
  }
  async update<T extends { id: string }>(collection: string, data: T): Promise<T> {
    const items = this.store[collection] || [];
    const idx = items.findIndex((item) => item.id === data.id);
    if (idx >= 0) items[idx] = data;
    return data;
  }
  async delete(collection: string, id: string): Promise<void> {
    const items = this.store[collection] || [];
    this.store[collection] = items.filter((item) => item.id !== id);
  }
  async getAll<T>(collection: string): Promise<T[]> {
    return (this.store[collection] || []) as T[];
  }
  async getByIndex<T>(_collection: string, _field: string, _value: any): Promise<T[]> {
    return [];
  }
  async query<T>(_collection: string, _constraints: any[]): Promise<T[]> {
    return [];
  }
  subscribe<T>(_collection: string, _callback: (data: T[]) => void): () => void {
    return () => {};
  }
  isOnline(): boolean { return false; }
  async enableOffline(): Promise<void> { return; }
  async enableOnline(): Promise<void> { return; }
}

// IndexedDB version constant - single source of truth
const IDB_VERSION = 2;

// IndexedDB Adapter (existing implementation)
class IndexedDBAdapter implements DatabaseAdapter {
  private db: IDBDatabase | null = null;
  private dbName = 'LifeTrackerDB';
  private version = IDB_VERSION;

  async init(): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('IndexedDB not available in server environment');
    }
    
    console.time('IDB_OPEN');
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        console.timeEnd('IDB_OPEN');
        const error = request.error;
        
        // 🔥 P0 FIX: Handle VersionError specifically with better messaging
        if (error && error.name === 'VersionError') {
          const enhancedError = new Error(
            `VersionError: Local database version conflict (Expected: ${this.version}). ` +
            `This usually happens when opening multiple tabs or after updates. ` +
            `Close other tabs and refresh, or reset local database if the problem persists.`
          );
          enhancedError.name = 'VersionError';
          reject(enhancedError);
        } else {
          reject(error);
        }
      };
      
      request.onsuccess = () => {
        console.timeEnd('IDB_OPEN');
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

  // REMOVED: getTodayTimeBlocks - now handled by LifeTrackerDB class

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
    const allTimeBlocks = await this.getAll<TimeBlock>('timeBlocks');
    const timeBlocks = allTimeBlocks.filter(block => 
      block.userId === userId && 
      new Date(block.startTime) >= today && 
      new Date(block.startTime) < tomorrow
    );
    
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

      // 🚀 ENHANCED: Calculate actual hours from Sessions + TimeBlocks
      let actualMinutes = dayTimeBlocks.reduce((total, block) => {
        if (block.actualStartTime && block.actualEndTime) {
          const actualStart = new Date(block.actualStartTime);
          const actualEnd = new Date(block.actualEndTime);
          return total + (actualEnd.getTime() - actualStart.getTime()) / (1000 * 60);
        }
        return total;
      }, 0);
      
      // 🎯 INTELLIGENCE: Also include session data for more accurate tracking
      const allSessions = await this.getAll<Session>('sessions');
      const daySessions = allSessions.filter(session => 
        session.userId === userId &&
        new Date(session.startTime) >= dayStart &&
        new Date(session.startTime) <= dayEnd &&
        session.status === 'completed' &&
        session.duration
      );
      
      // Use session data if more accurate than timeblock data
      const sessionMinutes = daySessions.reduce((total, session) => {
        return total + (session.duration || 0) / 60; // Convert seconds to minutes
      }, 0);
      
      // Use the higher value (more accurate tracking)
      if (sessionMinutes > actualMinutes) {
        actualMinutes = sessionMinutes;
      }

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

  // Reset database method - only for recovery scenarios
  async resetDatabase(): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('Database reset not available in server environment');
    }

    // Close existing connection
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    // Delete the database
    return new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(this.dbName);
      
      deleteRequest.onsuccess = () => {
        console.log('Local database reset successfully');
        resolve();
      };
      
      deleteRequest.onerror = () => {
        console.error('Failed to reset local database:', deleteRequest.error);
        reject(deleteRequest.error);
      };

      // Handle blocked case
      deleteRequest.onblocked = () => {
        console.warn('Database reset blocked - close other tabs and try again');
        reject(new Error('Database reset blocked - close other tabs and try again'));
      };
    });
  }
}

// Main Database Wrapper
class LifeTrackerDB {
  private adapter: DatabaseAdapter;
  private useFirebase: boolean;
  private lastUserId: string | null = null;
  private _activeUserId: string | null = null; // ⚠️ FIX: Traccia userId attivo per garantire invarianti

  constructor() {
    this.useFirebase = false;
    this.adapter = new MemoryAdapter(); // Placeholder until client configures
    // ⚠️ FIX: NON chiamare configureAdapter() qui - sarà chiamato lazy in init() o switchToFirebase()
    // Questo evita race condition quando Firebase non è ancora inizializzato
  }

  private configureAdapter() {
    const inBrowser = typeof window !== 'undefined';

    console.log('🔥 PSYCHOPATH: Database adapter selection:', {
      inBrowser,
      hasApiKey: !!firebaseConfig?.apiKey,
      firebaseAdapterExists: !!firebaseAdapter,
      activeUserId: this._activeUserId
    });

    if (!inBrowser) {
      console.warn('⚠️ Database initialized in non-browser context; using in-memory adapter.');
      this.useFirebase = false;
      this.adapter = new MemoryAdapter();
      return;
    }

    // ⚠️ FIX: CRITICAL - NON selezionare FirebaseAdapter di default
    // Default: IndexedDBAdapter finché non abbiamo activeUserId e switchToFirebase() è chiamato
    // Questo garantisce INVARIANTE A: se useFirebase === true allora userId è settato
    this.useFirebase = false;
    this.adapter = new IndexedDBAdapter();

    console.log(`🔌 Database initialized with IndexedDB adapter (default)`);
    console.log('🔥 PSYCHOPATH: Final adapter info:', {
      useFirebase: this.useFirebase,
      adapterType: this.adapter?.constructor?.name,
      adapterInstance: !!this.adapter,
      activeUserId: this._activeUserId
    });
  }

  async init(): Promise<void> {
    console.time('AUTH_READY');
    
    // ⚠️ FIX: Se siamo in browser e adapter è MemoryAdapter, riconfigura lazy
    if (typeof window !== 'undefined' && this.adapter instanceof MemoryAdapter) {
      this.configureAdapter();
    }

    try {
      await this.adapter.init();
      console.timeEnd('AUTH_READY');
    } catch (error: any) {
      console.timeEnd('AUTH_READY');
      
      // Handle VersionError specifically - don't let it hang the init
      if (error && error.name === 'VersionError') {
        console.error('IndexedDB VersionError detected:', error.message);
        
        // Store error for UI to handle
        if (typeof window !== 'undefined') {
          (window as any).__lifeTrackerDBError = {
            type: 'VersionError',
            message: error.message,
            canReset: !this.useFirebase // Only allow reset for guest mode
          };
        }
        
        // Don't throw - let app continue with limited functionality
        console.warn('Database init failed but app will continue with limited functionality');
        return;
      }
      
      // For other errors, still throw
      throw error;
    }
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
      currentAdapterType: this.adapter.constructor.name,
      activeUserId: this._activeUserId
    });
    
    if (!firebaseAdapter) {
      throw new Error('Cannot switch to Firebase - adapter not initialized');
    }
    
    // ⚠️ FIX: CRITICAL - Operazione atomica per garantire INVARIANTE A
    // 1. Set activeUserId PRIMA di tutto
    this._activeUserId = userId;
    this.lastUserId = userId;
    
    // 2. Set adapter = firebaseAdapter
    this.adapter = firebaseAdapter;
    
    // 3. Chiamare adapter.setUserId(userId) SINCRONO (deve essere fatto prima di init)
    if ('setUserId' in this.adapter) {
      console.log('🔥 PSYCHOPATH: Calling setUserId on adapter (ATOMIC)');
      (this.adapter as any).setUserId(userId);
    } else {
      throw new Error('FirebaseAdapter does not have setUserId method');
    }
    
    // 4. await adapter.init()
    await this.adapter.init();
    
    // 5. Set useFirebase = true SOLO dopo che tutto è pronto
    this.useFirebase = true;
    
    console.log('✅ Switched to Firebase adapter (ATOMIC)', {
      userId,
      useFirebase: this.useFirebase,
      adapterType: this.adapter.constructor.name
    });
    
    // ⚠️ FIX: INVARIANT CHECK - Verifica che tutto sia corretto
    this.checkInvariants(userId);
  }
  
  // ⚠️ FIX: INVARIANT CHECK - Verifica invarianti A e B
  private checkInvariants(expectedUserId: string): void {
    const adapterInfo = this.getAdapterDebugInfo();
    const adapterUserId = adapterInfo.userId;
    
    console.log('🔍 INVARIANT CHECK', {
      currentUserId: expectedUserId,
      dbIsUsingFirebase: this.isUsingFirebase,
      dbActiveUserId: this._activeUserId,
      firebaseAdapterUserId: adapterUserId,
      invariantA: this.isUsingFirebase ? (adapterUserId === expectedUserId) : 'N/A (not using Firebase)',
      invariantB: this.isUsingFirebase ? (!!adapterUserId) : 'N/A (not using Firebase)'
    });
    
    // INVARIANTE A: Se useFirebase === true allora adapter userId deve essere settato e uguale a currentUser.uid
    if (this.isUsingFirebase && adapterUserId !== expectedUserId) {
      const error = `INVARIANT A VIOLATED: useFirebase=${this.isUsingFirebase}, expectedUserId=${expectedUserId}, actualUserId=${adapterUserId}`;
      console.error('❌', error);
      throw new Error(error);
    }
    
    // INVARIANTE B: Nessuna chiamata a db.create/getAll/update/delete deve raggiungere FirebaseAdapter senza userId
    if (this.isUsingFirebase && !adapterUserId) {
      const error = `INVARIANT B VIOLATED: useFirebase=${this.isUsingFirebase}, adapterUserId is null`;
      console.error('❌', error);
      throw new Error(error);
    }
  }
  
  get activeUserId(): string | null {
    return this._activeUserId;
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
    // ⚠️ FIX: INVARIANT CHECK B - Verifica che adapter sia pronto prima di operazioni
    if (this.isUsingFirebase) {
      const adapterInfo = this.getAdapterDebugInfo();
      if (!adapterInfo.userId || adapterInfo.userId !== this._activeUserId) {
        const error = `INVARIANT B VIOLATED: Cannot create - Firebase adapter userId not set or mismatch. activeUserId=${this._activeUserId}, adapterUserId=${adapterInfo.userId}`;
        console.error('❌', error);
        throw new Error(error);
      }
    }
    
    console.log(`🔥 PSYCHOPATH: LifeTrackerDB.create() called for ${storeName}`, {
      useFirebase: this.useFirebase,
      adapterType: this.adapter?.constructor?.name,
      hasAdapter: !!this.adapter,
      dataId: data.id,
      dataUserId: (data as any).userId,
      activeUserId: this._activeUserId,
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
    // ⚠️ FIX: INVARIANT CHECK B - Verifica che adapter sia pronto prima di operazioni
    if (this.isUsingFirebase) {
      const adapterInfo = this.getAdapterDebugInfo();
      if (!adapterInfo.userId || adapterInfo.userId !== this._activeUserId) {
        const error = `INVARIANT B VIOLATED: Cannot getAll - Firebase adapter userId not set or mismatch. activeUserId=${this._activeUserId}, adapterUserId=${adapterInfo.userId}`;
        console.error('❌', error);
        throw new Error(error);
      }
    }
    
    console.log(`🔥 PSYCHOPATH: LifeTrackerDB.getAll() called for ${storeName}`, {
      useFirebase: this.useFirebase,
      adapterType: this.adapter?.constructor?.name,
      hasAdapter: !!this.adapter,
      activeUserId: this._activeUserId,
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

    // Adapter-agnostic fallback: get all timeBlocks and filter in JS
    const allTimeBlocks = await this.getAll<TimeBlock>('timeBlocks');
    
    // Filter for today's blocks and matching userId
    const todayBlocks = allTimeBlocks.filter(block => {
      if (block.userId !== userId) return false;
      
      const startTime = this.toDateSafe(block.startTime);
      if (!startTime) return false;
      return startTime >= today && startTime < tomorrow;
    });

    return todayBlocks;
  }

  // 🚀 P0 OPTIMIZATION: Get timeBlocks for a specific date
  async getTimeBlocksForDate(userId: string, date: Date): Promise<TimeBlock[]> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    // Adapter-agnostic fallback: get all timeBlocks and filter in JS
    const allTimeBlocks = await this.getAll<TimeBlock>('timeBlocks');
    
    // Filter for the specific date and matching userId
    const dateBlocks = allTimeBlocks.filter(block => {
      if (block.userId !== userId) return false;
      
      const startTime = this.toDateSafe(block.startTime);
      if (!startTime) return false;
      return startTime >= dayStart && startTime < dayEnd;
    });

    return dateBlocks;
  }

  // Helper to safely convert various date formats to Date
  private toDateSafe(value: any): Date | undefined {
    if (value instanceof Date) return value;
    if (value && typeof value.toDate === 'function') return value.toDate();
    if (typeof value === 'string' || typeof value === 'number') return new Date(value);
    return undefined;
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
    const allTimeBlocks = await this.getAll<TimeBlock>('timeBlocks');
    const timeBlocks = allTimeBlocks.filter(block => 
      block.userId === userId && 
      new Date(block.startTime) >= today && 
      new Date(block.startTime) < tomorrow
    );
    
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

      // 🚀 ENHANCED: Calculate actual hours from Sessions + TimeBlocks
      let actualMinutes = dayTimeBlocks.reduce((total, block) => {
        if (block.actualStartTime && block.actualEndTime) {
          const actualStart = new Date(block.actualStartTime);
          const actualEnd = new Date(block.actualEndTime);
          return total + (actualEnd.getTime() - actualStart.getTime()) / (1000 * 60);
        }
        return total;
      }, 0);
      
      // 🎯 INTELLIGENCE: Also include session data for more accurate tracking
      const allSessions = await this.getAll<Session>('sessions');
      const daySessions = allSessions.filter(session => 
        session.userId === userId &&
        new Date(session.startTime) >= dayStart &&
        new Date(session.startTime) <= dayEnd &&
        session.status === 'completed' &&
        session.duration
      );
      
      // Use session data if more accurate than timeblock data
      const sessionMinutes = daySessions.reduce((total, session) => {
        return total + (session.duration || 0) / 60; // Convert seconds to minutes
      }, 0);
      
      // Use the higher value (more accurate tracking)
      if (sessionMinutes > actualMinutes) {
        actualMinutes = sessionMinutes;
      }

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

  // Public method to reset IndexedDB - only for guest users in recovery scenarios
  async resetLocalDatabase(): Promise<void> {
    if (this.useFirebase) {
      throw new Error('Database reset not available in logged mode - data is stored in Firebase');
    }

    if (!(this.adapter instanceof IndexedDBAdapter)) {
      throw new Error('Reset only available for IndexedDB adapter');
    }

    await (this.adapter as any).resetDatabase();
    
    // Reinitialize after reset
    this.configureAdapter();
    await this.init();
  }

  // Check if there's a database error from initialization
  getDatabaseError(): { type: string; message: string; canReset: boolean } | null {
    if (typeof window === 'undefined') return null;
    return (window as any).__lifeTrackerDBError || null;
  }

  // Clear database error (after user handles it)
  clearDatabaseError(): void {
    if (typeof window !== 'undefined') {
      delete (window as any).__lifeTrackerDBError;
    }
  }
}

export const db = new LifeTrackerDB();
