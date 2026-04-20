import { 
  User, Domain, Goal, KeyResult, Project, Task, TimeBlock, Session, 
  Habit, HabitLog, Metric, CalendarEvent, Deadline, JournalEntry, 
  Insight, Achievement, KPI, DashboardState, VisionBoard, VisionItem, MediaAsset,
  TimeBlockStatus
} from '@/types';
import { Page } from '@/types/blocks';
import { DatabaseAdapter, createFirebaseAdapter } from './firebaseAdapter';
import { firebaseConfig } from '@/config/firebaseConfig';

// Utility: Recursively remove undefined fields from objects/arrays, preserve Date
export function sanitizeDeep<T>(value: T): T {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value.map(sanitizeDeep) as any;
  }
  if (value && typeof value === 'object') {
    const result: any = {};
    Object.entries(value).forEach(([key, val]) => {
      if (val !== undefined) {
        result[key] = sanitizeDeep(val);
      }
    });
    return result;
  }
  return value;
}

// Utility: Sanitize data for storage (removes undefined, preserves null/false/0)
export function sanitizeForStorage<T>(data: T): T {
  return sanitizeDeep(data);
}

// Helper: Build normalized habit log payload (NEVER include undefined)
export function buildHabitLogPayload(params: {
  id?: string;
  habitId: string;
  dateKey: string;
  completed: boolean;
  value?: number | boolean | null;
  userId?: string;
}): HabitLog {
  const now = new Date();
  
  const payload: any = {
    id: params.id || `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    habitId: params.habitId,
    dateKey: params.dateKey,
    completed: params.completed,
    createdAt: now,
    updatedAt: now
  };

  // Only include userId if provided
  if (params.userId) {
    payload.userId = params.userId;
  }

  // Only include value if it's defined (omit undefined completely)
  if (params.value !== undefined) {
    payload.value = params.value;
  }

  return payload as HabitLog;
}

// No-op in-memory adapter for non-browser/server contexts
class MemoryAdapter implements DatabaseAdapter {
  private store: Record<string, any[]> = {};

  async init(): Promise<void> { return; }

  async create<T extends { id?: string }>(collection: string, data: T): Promise<T> {
    if (!this.store[collection]) this.store[collection] = [];
    if (!data.id) data.id = `${collection}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.store[collection].push(sanitizeForStorage(data));
    return data;
  }

  async read<T>(collection: string, id: string): Promise<T | null> {
    const items = this.store[collection] || [];
    return (items.find((item) => item.id === id) as T) || null;
  }

  async update<T extends { id: string }>(collection: string, data: T): Promise<T> {
    const items = this.store[collection] || [];
    const idx = items.findIndex((item) => item.id === data.id);
    if (idx >= 0) items[idx] = sanitizeForStorage(data);
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
const IDB_VERSION = 4; // Incremented for pages collection (Notion Editor)

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
      // TIMEOUT: Hard limit per IndexedDB open
      const timeout = setTimeout(() => {
        console.timeEnd('IDB_OPEN');
        reject(new Error('IDB_OPEN_TIMEOUT: IndexedDB open blocked or took too long (>1500ms)'));
      }, 1500);

      const request = indexedDB.open(this.dbName, this.version);

      // BLOCKED: Handle database locked by another tab/process
      request.onblocked = (event) => {
        console.timeEnd('IDB_OPEN');
        clearTimeout(timeout);
        reject(new Error('IDB_BLOCKED: Database locked by another tab. Close other tabs and retry.'));
      };

      request.onerror = () => {
        console.timeEnd('IDB_OPEN');
        clearTimeout(timeout);
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
        clearTimeout(timeout);
        this.db = request.result;
        
        // Handle version change after open (another tab upgraded)
        this.db.onversionchange = () => {
          console.log('⚠️ IDB: Database upgraded by another tab, closing connection');
          this.db?.close();
        };
        
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create object stores
        const stores = [
          'users', 'domains', 'goals', 'keyResults', 'projects', 'tasks',
          'timeBlocks', 'sessions', 'habits', 'habitLogs', 'metrics',
          'calendarEvents', 'deadlines', 'journalEntries', 'insights', 'achievements',
          'notes', 'noteTemplates', 'goalRoadmaps',
          'visionBoards', 'visionItems', 'mediaAssets', 'mediaBlobs',
          'pages', // Notion-like Block Editor pages
          'login_streaks' // Daily login streak tracking
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
              case 'notes':
                store.createIndex('userId', 'userId');
                store.createIndex('entityType', 'entityType');
                store.createIndex('entityId', 'entityId');
                store.createIndex('isPinned', 'isPinned');
                break;
              case 'noteTemplates':
                store.createIndex('userId', 'userId');
                store.createIndex('category', 'category');
                break;
              case 'goalRoadmaps':
                store.createIndex('userId', 'userId');
                store.createIndex('goalId', 'goalId');
                break;
              case 'visionBoards':
                store.createIndex('userId', 'userId');
                store.createIndex('linkedGoalId', 'linkedGoalId');
                store.createIndex('isActive', 'isActive');
                break;
              case 'visionItems':
                store.createIndex('userId', 'userId');
                store.createIndex('boardId', 'boardId');
                store.createIndex('type', 'type');
                store.createIndex('isPinned', 'isPinned');
                break;
              case 'mediaAssets':
                store.createIndex('userId', 'userId');
                store.createIndex('kind', 'kind');
                store.createIndex('storage', 'storage');
                break;
              case 'mediaBlobs':
                // Special store for guest blob storage - uses blobKey as id
                // No userId index needed since blob keys are already unique
                break;
              case 'pages':
                store.createIndex('userId', 'userId');
                store.createIndex('title', 'title');
                store.createIndex('linkedGoalIds', 'linkedGoalIds', { multiEntry: true });
                store.createIndex('linkedProjectIds', 'linkedProjectIds', { multiEntry: true });
                store.createIndex('linkedTaskIds', 'linkedTaskIds', { multiEntry: true });
                store.createIndex('tags', 'tags', { multiEntry: true });
                store.createIndex('isTemplate', 'isTemplate');
                store.createIndex('createdAt', 'createdAt');
                store.createIndex('updatedAt', 'updatedAt');
                break;
              case 'login_streaks':
                store.createIndex('userId', 'userId');
                store.createIndex('lastLoginDate', 'lastLoginDate');
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
    
    // Generate unique ID if not provided
    if (!data.id) {
      data.id = `${storeName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    return new Promise((resolve, reject) => {
      // Use PUT instead of ADD to allow overwrites
      const request = store.put(sanitizeForStorage(data));
      request.onsuccess = () => resolve(data);
      request.onerror = () => reject(request.error);
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
      const request = store.put(sanitizeForStorage(data));
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
    try {
      const store = await this.getStore(storeName);
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(`IndexedDB getAll error for ${storeName}:`, error);
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
    
    // Calculate focus minutes (session.duration is in seconds, convert to minutes)
    const focusMinutes = todaySessions
      .filter(session => session.tags.includes('focus'))
      .reduce((total, session) => total + (session.duration || 0), 0) / 60;

    // Calculate plan vs actual
    const plannedMinutes = timeBlocks.reduce((total, block) => 
      total + (block.endTime.getTime() - block.startTime.getTime()) / (1000 * 60), 0
    );
    // Follow CLAUDE.md rules - count ALL completed blocks
    const actualMinutes = timeBlocks
      .filter(block => block.status === 'completed')
      .reduce((total, block) => {
        // Use actualStartTime/actualEndTime if available, otherwise fallback to planned times
        if (block.actualStartTime && block.actualEndTime) {
          return total + (block.actualEndTime.getTime() - block.actualStartTime.getTime()) / (1000 * 60);
        } else {
          // Fallback to planned duration for completed blocks (CLAUDE.md rule)
          return total + (block.endTime.getTime() - block.startTime.getTime()) / (1000 * 60);
        }
      }, 0);
    const planVsActual = plannedMinutes > 0 ? (actualMinutes / plannedMinutes) * 100 : 0;

    // Get active streaks
    const habits = await this.getActiveHabits(userId);
    const activeStreaks = habits.filter(habit => habit.streakCount > 0).length;

    // Calculate key results progress from actual data
    const allKeyResults = await this.getAll<KeyResult>('keyResults');
    const userKeyResults = allKeyResults.filter(kr => kr.userId === userId && !kr.deleted);
    const keyResultsProgress = userKeyResults.length > 0
      ? userKeyResults.reduce((sum, kr) => sum + (kr.progress ?? 0), 0) / userKeyResults.length
      : 0;

    return {
      focusMinutes: Math.round(focusMinutes),
      planVsActual: Math.round(planVsActual),
      activeStreaks,
      keyResultsProgress: Math.round(keyResultsProgress),
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

    const allTimeBlocks = await this.getAll<TimeBlock>('timeBlocks');
    const userTimeBlocks = allTimeBlocks.filter(b => b.userId === userId && !b.deleted);

    let startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    if (userTimeBlocks.length > 0) {
      const earliestBlock = userTimeBlocks.reduce((earliest, block) => {
        const blockDate = new Date(block.startTime);
        return blockDate < earliest ? blockDate : earliest;
      }, new Date());

      const calculatedStartDate = new Date(earliestBlock);
      calculatedStartDate.setHours(0, 0, 0, 0);

      if (calculatedStartDate < startDate) {
        startDate = calculatedStartDate;
      }
    }

    const result = [];

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayStart = new Date(d);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(d);
      dayEnd.setHours(23, 59, 59, 999);

      // Filter time blocks for this day
      const dayTimeBlocks = allTimeBlocks.filter(block => {
        const blockStart = new Date(block.startTime);
        return (
          block.userId === userId &&
          !block.deleted && // Exclude soft-deleted blocks
          blockStart >= dayStart &&
          blockStart <= dayEnd
        );
      });

      // 🚨 DEBUG: Log per-day analysis
      if ((process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEBUG_ANALYTICS === '1') && dayTimeBlocks.length > 0) {
        console.log(`📊 Day ${d.toISOString().split('T')[0]}:`, {
          dayTimeBlocks: dayTimeBlocks.length,
          completedBlocks: dayTimeBlocks.filter(b => b.status === 'completed').length,
          sampleBlocks: dayTimeBlocks.slice(0, 2).map(b => ({
            title: b.title,
            status: b.status,
            startTime: b.startTime,
            endTime: b.endTime,
            actualStartTime: b.actualStartTime,
            actualEndTime: b.actualEndTime
          }))
        });
      }

      // Calculate planned hours
      const plannedMinutes = dayTimeBlocks.reduce((total, block) => {
        const startTime = new Date(block.startTime);
        const endTime = new Date(block.endTime);
        return total + (endTime.getTime() - startTime.getTime()) / (1000 * 60);
      }, 0);

      // Unified logic following CLAUDE.md Progress Rules
      let actualMinutes = dayTimeBlocks
        .filter(block => block.status === 'completed')
        .reduce((total, block) => {
          // Use actualStartTime/actualEndTime if available, otherwise fallback to planned times
          if (block.actualStartTime && block.actualEndTime) {
            const actualStart = new Date(block.actualStartTime);
            const actualEnd = new Date(block.actualEndTime);
            return total + (actualEnd.getTime() - actualStart.getTime()) / (1000 * 60);
          } else {
            // Fallback to planned duration for completed blocks (CLAUDE.md rule)
            const startTime = new Date(block.startTime);
            const endTime = new Date(block.endTime);
            return total + (endTime.getTime() - startTime.getTime()) / (1000 * 60);
          }
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

    // 🔧 FIX: Use TimeBlocks instead of Sessions (Sessions are rarely used)
    const allTimeBlocks = await this.getAll<TimeBlock>('timeBlocks');
    const periodTimeBlocks = allTimeBlocks.filter(block =>
      block.userId === userId &&
      !block.deleted &&
      block.status === 'completed' && // Only count completed blocks (actual time)
      new Date(block.startTime) >= startDate &&
      new Date(block.startTime) <= endDate
    );

    // 📊 DEBUG: Log time allocation context
    if (process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEBUG_ANALYTICS === '1') {
      console.log('📊 calculateTimeAllocation:', {
        userId,
        days,
        totalTimeBlocks: allTimeBlocks.length,
        userTimeBlocks: allTimeBlocks.filter(b => b.userId === userId).length,
        completedTimeBlocks: periodTimeBlocks.length,
        userDomains: userDomains.length,
        sampleBlocks: periodTimeBlocks.slice(0, 3).map(b => ({
          id: b.id,
          domainId: b.domainId,
          title: b.title,
          startTime: b.startTime,
          endTime: b.endTime
        }))
      });
    }

    // Default colors for domains
    const defaultColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#f97316'];

    const domainHours = new Map<string, number>();

    // Calculate hours per domain from completed time blocks
    for (const block of periodTimeBlocks) {
      const domain = userDomains.find(d => d.id === block.domainId);
      const domainName = domain?.name || 'Uncategorized';

      // Calculate actual duration in hours
      const startTime = new Date(block.actualStartTime || block.startTime);
      const endTime = new Date(block.actualEndTime || block.endTime);
      const durationMs = endTime.getTime() - startTime.getTime();
      const hours = durationMs / (1000 * 60 * 60);

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

  // ========== USER STATISTICS FOR BADGES ==========

  async getUserStats(userId: string): Promise<{
    maxStreak: number;
    totalFocusMinutes: number;
    goalsCompleted: number;
    goalsCreated: number;
    totalSessions: number;
    timeBlocksCreated: number;
    daysTracked: number;
    earlySessionsCount: number;
    eveningSessionsCount: number;
    weeklyFocusMinutes: number;
  }> {
    try {
      // Calculate days tracked (unique days with any activity)
      const allTimeBlocks = await this.getAll<TimeBlock>('timeBlocks');
      const allSessions = await this.getAll<Session>('sessions');
      const allHabitLogs = await this.getAll('habitLogs');
      
      const userTimeBlocks = allTimeBlocks.filter(tb => tb.userId === userId);
      const userSessions = allSessions.filter(s => s.userId === userId);
      const userHabitLogs = allHabitLogs.filter((hl: any) => hl.userId === userId);
      
      // Collect unique dates with activity
      const activeDates = new Set<string>();
      
      userTimeBlocks.forEach(tb => {
        const date = new Date(tb.startTime).toISOString().split('T')[0];
        activeDates.add(date);
      });
      
      userSessions.forEach(s => {
        const date = new Date(s.startTime).toISOString().split('T')[0];
        activeDates.add(date);
      });
      
      userHabitLogs.forEach((hl: any) => {
        activeDates.add(hl.dateKey);
      });
      
      // Calculate focus time
      const totalFocusMinutes = userSessions
        .filter(s => s.status === 'completed' && s.tags.includes('focus'))
        .reduce((total, s) => total + (s.duration || 0), 0) / 60;
      
      // Calculate weekly focus (last 7 days)
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const weeklyFocusMinutes = userSessions
        .filter(s => s.status === 'completed' && 
                     s.tags.includes('focus') && 
                     new Date(s.startTime) >= weekAgo)
        .reduce((total, s) => total + (s.duration || 0), 0) / 60;
      
      // Calculate early sessions (before 8:00 AM)
      const earlySessionsCount = userSessions
        .filter(s => {
          const hour = new Date(s.startTime).getHours();
          return hour < 8;
        }).length;
      
      // Calculate evening sessions (after 6:00 PM)
      const eveningSessionsCount = userSessions
        .filter(s => {
          const hour = new Date(s.startTime).getHours();
          return hour >= 18;
        }).length;
      
      // Calculate consecutive habit streaks
      const allHabits = await this.getAll('habits');
      const userHabits = allHabits.filter((h: any) => h.userId === userId);
      
      // Helper function to check if two dates are consecutive days
      const isNextDay = (dateStr1: string, dateStr2: string): boolean => {
        const date1 = new Date(dateStr1);
        const date2 = new Date(dateStr2);
        const diffTime = date2.getTime() - date1.getTime();
        const diffDays = diffTime / (1000 * 60 * 60 * 24);
        return diffDays === 1;
      };
      
      let maxStreak = 0;
      for (const habit of userHabits) {
        const habitLogs = userHabitLogs
          .filter((hl: any) => hl.habitId === (habit as any).id)
          .sort((a: any, b: any) => a.dateKey.localeCompare(b.dateKey));
        
        if (habitLogs.length === 0) continue;
        
        let currentStreak = 0;
        let tempMaxStreak = 0;
        let lastDateKey: string | null = null;
        
        for (const log of habitLogs) {
          if ((log as any).completed) {
            // Check if this date continues the streak
            if (lastDateKey === null || isNextDay(lastDateKey, (log as any).dateKey)) {
              currentStreak++;
            } else {
              // Gap in dates, start new streak
              currentStreak = 1;
            }
            tempMaxStreak = Math.max(tempMaxStreak, currentStreak);
            lastDateKey = (log as any).dateKey;
          } else {
            // Incomplete day breaks the streak
            currentStreak = 0;
            lastDateKey = (log as any).dateKey;
          }
        }
        
        maxStreak = Math.max(maxStreak, tempMaxStreak);
      }
      
      // Calculate goals
      const allGoals = await this.getAll('goals');
      const userGoals = allGoals.filter((g: any) => g.userId === userId);
      const goalsCreated = userGoals.length;
      const goalsCompleted = userGoals.filter((g: any) => g.status === 'completed').length;
      
      return {
        maxStreak,
        totalFocusMinutes: Math.round(totalFocusMinutes),
        goalsCompleted,
        goalsCreated,
        totalSessions: userSessions.filter(s => s.status === 'completed').length,
        timeBlocksCreated: userTimeBlocks.length,
        daysTracked: activeDates.size,
        earlySessionsCount,
        eveningSessionsCount,
        weeklyFocusMinutes: Math.round(weeklyFocusMinutes)
      };
    } catch (error) {
      console.error('Error calculating user stats:', error);
      return {
        maxStreak: 0,
        totalFocusMinutes: 0,
        goalsCompleted: 0,
        goalsCreated: 0,
        totalSessions: 0,
        timeBlocksCreated: 0,
        daysTracked: 0,
        earlySessionsCount: 0,
        eveningSessionsCount: 0,
        weeklyFocusMinutes: 0
      };
    }
  }

  // ========== HIERARCHICAL ROLLUP SYSTEM ==========
  // Note: Main rollup implementation is in /lib/hierarchicalRollup.ts
  // This is automatically called by DataProvider when TimeBlocks are completed

  // ========== ACTIVITY RANKINGS ==========

  async calculateActivityRankings(userId: string, days: number = 7): Promise<Array<{
    activityName: string;
    plannedHours: number;
    actualHours: number;
    discrepancy: number;
    adherenceRate: number;
    domain: string;
    rank: 'most_done' | 'least_done' | 'overplanned' | 'underplanned';
  }>> {
    try {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
      
      const allTimeBlocks = await this.getAll<TimeBlock>('timeBlocks');
      const userTimeBlocks = allTimeBlocks.filter(block => 
        block.userId === userId &&
        new Date(block.startTime) >= startDate && 
        new Date(block.startTime) <= endDate
      );
      
      // Group by task/project name
      const activityMap = new Map<string, {
        plannedMinutes: number;
        actualMinutes: number;
        domain: string;
        blocks: TimeBlock[];
      }>();
      
      for (const block of userTimeBlocks) {
        const activityName = block.title || block.projectId || 'Unnamed Activity';
        const domain = block.type || 'General';
        
        const plannedMinutes = (new Date(block.endTime).getTime() - new Date(block.startTime).getTime()) / (1000 * 60);
        
        let actualMinutes = 0;
        if (block.status === 'completed') {
          // CLAUDE.md compliant calculation
          if (block.actualStartTime && block.actualEndTime) {
            actualMinutes = (new Date(block.actualEndTime).getTime() - new Date(block.actualStartTime).getTime()) / (1000 * 60);
          } else {
            // Fallback to planned duration for completed blocks (CLAUDE.md rule)
            actualMinutes = (new Date(block.endTime).getTime() - new Date(block.startTime).getTime()) / (1000 * 60);
          }
        }
        
        if (!activityMap.has(activityName)) {
          activityMap.set(activityName, {
            plannedMinutes: 0,
            actualMinutes: 0,
            domain,
            blocks: []
          });
        }
        
        const activity = activityMap.get(activityName)!;
        activity.plannedMinutes += plannedMinutes;
        activity.actualMinutes += actualMinutes;
        activity.blocks.push(block);
      }
      
      // Convert to rankings
      const activities = Array.from(activityMap.entries()).map(([name, data]) => {
        const plannedHours = data.plannedMinutes / 60;
        const actualHours = data.actualMinutes / 60;
        const discrepancy = actualHours - plannedHours;
        const adherenceRate = plannedHours > 0 ? (actualHours / plannedHours) * 100 : 0;
        
        let rank: 'most_done' | 'least_done' | 'overplanned' | 'underplanned';
        if (actualHours >= 2) {
          rank = 'most_done';
        } else if (actualHours < 0.5 && plannedHours > 1) {
          rank = 'least_done';
        } else if (discrepancy > 1) {
          rank = 'overplanned';
        } else if (discrepancy < -1) {
          rank = 'underplanned';
        } else {
          rank = actualHours > plannedHours ? 'most_done' : 'least_done';
        }
        
        return {
          activityName: name,
          plannedHours: Number(plannedHours.toFixed(1)),
          actualHours: Number(actualHours.toFixed(1)),
          discrepancy: Number(discrepancy.toFixed(1)),
          adherenceRate: Math.round(adherenceRate),
          domain: data.domain,
          rank
        };
      });
      
      // Sort by actual hours descending
      return activities.sort((a, b) => b.actualHours - a.actualHours);
    } catch (error) {
      console.error('Error calculating activity rankings:', error);
      return [];
    }
  }

  // ========== VISION BOARD BLOB STORAGE ==========
  
  async storeBlob(blobKey: string, blob: Blob): Promise<void> {
    const store = await this.getStore('mediaBlobs', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put({ id: blobKey, blob });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  async getBlob(blobKey: string): Promise<Blob | null> {
    const store = await this.getStore('mediaBlobs');
    return new Promise((resolve, reject) => {
      const request = store.get(blobKey);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.blob : null);
      };
      request.onerror = () => reject(request.error);
    });
  }
  
  async deleteBlob(blobKey: string): Promise<void> {
    const store = await this.getStore('mediaBlobs', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(blobKey);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
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

// ============================================================================
// 🔥 CRITICAL FIX: Main Database Wrapper with proper Firebase restoration
// ============================================================================
class LifeTrackerDB {

  /**
   * Returns the current adapter type as a string (for logging/debug only)
   */
  public getAdapterType(): string {
    // Expose adapter type for debug/logging
    // @ts-ignore: adapter is private, but this is for diagnostics only
    return this.adapter?.constructor?.name || 'Unknown';
  }
  private adapter: DatabaseAdapter;
  private useFirebase: boolean;
  private lastUserId: string | null = null;
  private _activeUserId: string | null = null;
  private _isInitialized: boolean = false;
  private _initPromise: Promise<void> | null = null;

  constructor() {
    this.useFirebase = false;
    this.adapter = new MemoryAdapter(); // Placeholder
    
    // 🔥 CRITICAL FIX: Restore Firebase mode SYNCHRONOUSLY in constructor
    // This ensures that even before init() is called, we're using the right adapter
    this.restoreFirebaseModeSync();
  }

  // 🔥 NEW: Synchronous restore of Firebase mode from sessionStorage
  private restoreFirebaseModeSync(): void {
    if (typeof window === 'undefined') {
      return; // Server-side, skip
    }

    const savedUserId = sessionStorage.getItem('firebase_userId');
    console.log('🔄 restoreFirebaseModeSync called:', {
      savedUserId
    });

    if (savedUserId) {
      const adapter = createFirebaseAdapter();
      if (adapter) {
        console.log('✅ Restoring Firebase mode SYNCHRONOUSLY from sessionStorage');
        this._activeUserId = savedUserId;
        this.lastUserId = savedUserId;
        this.adapter = adapter;
        this.useFirebase = true;
        adapter.setUserId(savedUserId);
        console.log('✅ Firebase mode restored:', {
          useFirebase: this.useFirebase,
          activeUserId: this._activeUserId,
          adapterType: this.adapter.constructor.name
        });
      } else {
        console.warn('⚠️ Firebase adapter not available, will use IndexedDB');
      }
    } else {
      console.log('ℹ️ No saved userId in sessionStorage, will use IndexedDB');
    }
  }

  private configureAdapter() {
    const inBrowser = typeof window !== 'undefined';

    console.log('🔧 configureAdapter called:', {
      inBrowser,
      hasApiKey: !!firebaseConfig?.apiKey,
      activeUserId: this._activeUserId,
      currentUseFirebase: this.useFirebase
    });

    if (!inBrowser) {
      console.warn('⚠️ Database initialized in non-browser context; using in-memory adapter.');
      this.useFirebase = false;
      this.adapter = new MemoryAdapter();
      return;
    }

    // 🔥 FIX: If already using Firebase (restored from session), don't override!
    if (this.useFirebase && this.adapter && this.adapter.constructor.name === 'FirebaseAdapter') {
      console.log('✅ Already using Firebase adapter, skipping reconfiguration');
      return;
    }

    // Default: IndexedDBAdapter for guest mode
    this.useFirebase = false;
    this.adapter = new IndexedDBAdapter();

    console.log(`🔌 Database configured with IndexedDB adapter (default)`);
  }

  async init(): Promise<void> {
    // Prevent multiple concurrent initializations
    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = this._doInit();
    return this._initPromise;
  }

  private async _doInit(): Promise<void> {
    console.time('DB_INIT');
    
    // 🔥 CRITICAL: If Firebase mode was restored in constructor, just init the adapter
    if (this.useFirebase && this.adapter && this.adapter.constructor.name === 'FirebaseAdapter') {
      console.log('🔥 Firebase mode already active, initializing Firebase adapter');
      try {
        await this.adapter.init();
        this._isInitialized = true;
        console.timeEnd('DB_INIT');
        console.log('✅ Firebase adapter initialized after restore');
        return;
      } catch (error) {
        console.error('❌ Firebase adapter init failed:', error);
        // Fall back to IndexedDB
        console.log('⚠️ Falling back to IndexedDB');
        this.useFirebase = false;
        this._activeUserId = null;
        this.adapter = new IndexedDBAdapter();
        sessionStorage.removeItem('firebase_userId');
      }
    }
    
    // If we're still using MemoryAdapter, configure properly
    if (this.adapter instanceof MemoryAdapter) {
      this.configureAdapter();
    }

    try {
      await this.adapter.init();
      this._isInitialized = true;
      console.timeEnd('DB_INIT');
    } catch (error: any) {
      console.timeEnd('DB_INIT');
      
      // Handle VersionError specifically
      if (error && error.name === 'VersionError') {
        console.error('IndexedDB VersionError detected:', error.message);
        
        if (typeof window !== 'undefined') {
          (window as any).__lifeTrackerDBError = {
            type: 'VersionError',
            message: error.message,
            canReset: !this.useFirebase
          };
        }
        
        console.warn('Database init failed but app will continue with limited functionality');
        return;
      }
      
      throw error;
    }
  }

  get isUsingFirebase(): boolean {
    return this.useFirebase;
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  getAdapterDebugInfo(): {
    useFirebase: boolean;
    adapterType: string;
    hasAdapter: boolean;
    adapterMethods: string[];
    userId?: string;
    isInitialized?: boolean;
    activeUserId?: string;
  } {
    const debugInfo: any = {
      useFirebase: this.useFirebase,
      adapterType: this.adapter?.constructor?.name || 'Unknown',
      hasAdapter: !!this.adapter,
      adapterMethods: this.adapter ? Object.getOwnPropertyNames(Object.getPrototypeOf(this.adapter)) : [],
      activeUserId: this._activeUserId,
      isInitialized: this._isInitialized
    };

    if (this.useFirebase && this.adapter) {
      if ('userId' in this.adapter) {
        debugInfo.userId = (this.adapter as any).userId;
      }
    }

    return debugInfo;
  }

  async switchToFirebase(userId: string): Promise<void> {
    console.log('🔥 switchToFirebase called:', {
      userId,
      currentUseFirebase: this.useFirebase,
      currentActiveUserId: this._activeUserId
    });

    // If already using Firebase with same userId, skip
    if (this.useFirebase && this._activeUserId === userId && this.adapter && this.adapter.constructor.name === 'FirebaseAdapter') {
      console.log('✅ Already using Firebase with same userId, skipping switch');
      return;
    }

    const adapter = createFirebaseAdapter();
    if (!adapter) {
      throw new Error('Cannot switch to Firebase - adapter not initialized');
    }

    // Atomic state update
    this._activeUserId = userId;
    this.lastUserId = userId;
    this.adapter = adapter;
    adapter.setUserId(userId);

    // Persist to sessionStorage for refresh survival
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('firebase_userId', userId);
      console.log('💾 userId persisted to sessionStorage');
    }

    // Init adapter
    await this.adapter.init();

    // Set flag AFTER everything is ready
    this.useFirebase = true;
    this._isInitialized = true;

    console.log('✅ Switched to Firebase adapter:', {
      userId,
      useFirebase: this.useFirebase,
      adapterType: this.adapter.constructor.name
    });

    // Verify invariants
    this.checkInvariants(userId);
  }
  
  private checkInvariants(expectedUserId: string): void {
    const adapterInfo = this.getAdapterDebugInfo();
    const adapterUserId = adapterInfo.userId;
    
    console.log('🔍 INVARIANT CHECK:', {
      expectedUserId,
      dbIsUsingFirebase: this.isUsingFirebase,
      dbActiveUserId: this._activeUserId,
      firebaseAdapterUserId: adapterUserId
    });
    
    if (this.isUsingFirebase && adapterUserId !== expectedUserId) {
      const error = `INVARIANT VIOLATED: userId mismatch - expected ${expectedUserId}, got ${adapterUserId}`;
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
      this._activeUserId = null;
      
      // Clear persisted userId
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('firebase_userId');
      }
      
      await this.adapter.init();
      console.log('Switched to IndexedDB adapter');
    }
  }

  // 🔥 NEW: Ensure adapter is ready before any operation
  private async ensureReady(): Promise<void> {
    if (!this._isInitialized) {
      await this.init();
    }
  }

  // Delegate all methods to the current adapter
  async create<T extends { id?: string }>(storeName: string, data: T): Promise<T> {
    await this.ensureReady();
    
    // Invariant check for Firebase mode
    if (this.isUsingFirebase) {
      const adapterInfo = this.getAdapterDebugInfo();
      if (!adapterInfo.userId || adapterInfo.userId !== this._activeUserId) {
        throw new Error(`Cannot create - Firebase adapter userId not set or mismatch`);
      }
    }
    
    console.log(`📝 db.create(${storeName}):`, {
      useFirebase: this.useFirebase,
      adapterType: this.adapter?.constructor?.name,
      dataId: data.id,
      dataUserId: (data as any).userId
    });
    
    try {
      const result = await this.adapter.create(storeName, data);
      console.log(`✅ db.create SUCCESS for ${storeName}:`, result.id);
      return result;
    } catch (error) {
      console.error(`❌ db.create ERROR for ${storeName}:`, error);
      throw error;
    }
  }

  async read<T>(storeName: string, id: string): Promise<T | null> {
    await this.ensureReady();
    return this.adapter.read(storeName, id);
  }

  async update<T extends { id: string }>(storeName: string, data: T): Promise<T> {
    await this.ensureReady();
    return this.adapter.update(storeName, data);
  }

  async delete(storeName: string, id: string): Promise<void> {
    await this.ensureReady();
    return this.adapter.delete(storeName, id);
  }

  async getAll<T>(storeName: string): Promise<T[]> {
    await this.ensureReady();
    
    // Invariant check for Firebase mode
    if (this.isUsingFirebase) {
      const adapterInfo = this.getAdapterDebugInfo();
      if (!adapterInfo.userId || adapterInfo.userId !== this._activeUserId) {
        throw new Error(`Cannot getAll - Firebase adapter userId not set or mismatch`);
      }
    }
    
    // Console logs disabled
    
    try {
      const result = await this.adapter.getAll(storeName);
      // console.log disabled to prevent spam
      return result as T[];
    } catch (error) {
      console.error(`❌ db.getAll ERROR for ${storeName}:`, error);
      throw error;
    }
  }

  async getByIndex<T>(storeName: string, indexName: string, value: any): Promise<T[]> {
    await this.ensureReady();
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

  // Specific methods for common queries
  async getActiveSessions(userId: string): Promise<Session[]> {
    return this.getByIndex<Session>('sessions', 'status', 'active');
  }

  async getTodayTimeBlocks(userId: string): Promise<TimeBlock[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const allTimeBlocks = await this.getAll<TimeBlock>('timeBlocks');
    
    const todayBlocks = allTimeBlocks.filter(block => {
      if (block.userId !== userId) return false;
      
      const startTime = this.toDateSafe(block.startTime);
      if (!startTime) return false;
      return startTime >= today && startTime < tomorrow;
    });

    return todayBlocks;
  }

  async getTimeBlocksForDate(userId: string, date: Date): Promise<TimeBlock[]> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const allTimeBlocks = await this.getAll<TimeBlock>('timeBlocks');
    
    const dateBlocks = allTimeBlocks.filter(block => {
      if (block.userId !== userId) return false;
      
      const startTime = this.toDateSafe(block.startTime);
      if (!startTime) return false;
      return startTime >= dayStart && startTime < dayEnd;
    });

    return dateBlocks;
  }

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

    const sessions = await this.getByIndex<Session>('sessions', 'userId', userId);
    const todaySessions = sessions.filter(session => 
      session.startTime >= today && session.startTime < tomorrow && session.status === 'completed'
    );

    const allTimeBlocks = await this.getAll<TimeBlock>('timeBlocks');
    const timeBlocks = allTimeBlocks.filter(block => 
      block.userId === userId && 
      new Date(block.startTime) >= today && 
      new Date(block.startTime) < tomorrow
    );
    
    const focusMinutes = todaySessions
      .filter(session => session.tags.includes('focus'))
      .reduce((total, session) => total + (session.duration || 0), 0) / 60;

    const plannedMinutes = timeBlocks.reduce((total, block) => 
      total + (block.endTime.getTime() - block.startTime.getTime()) / (1000 * 60), 0
    );
    // Follow CLAUDE.md rules - count ALL completed blocks  
    const actualMinutes = timeBlocks
      .filter(block => block.status === 'completed')
      .reduce((total, block) => {
        // Use actualStartTime/actualEndTime if available, otherwise fallback to planned times
        if (block.actualStartTime && block.actualEndTime) {
          return total + (block.actualEndTime.getTime() - block.actualStartTime.getTime()) / (1000 * 60);
        } else {
          // Fallback to planned duration for completed blocks (CLAUDE.md rule)
          return total + (block.endTime.getTime() - block.startTime.getTime()) / (1000 * 60);
        }
      }, 0);
    const planVsActual = plannedMinutes > 0 ? (actualMinutes / plannedMinutes) * 100 : 0;

    const habits = await this.getActiveHabits(userId);
    const activeStreaks = habits.filter(habit => habit.streakCount > 0).length;

    const allKeyResults = await this.getAll<KeyResult>('keyResults');
    const userKeyResults = allKeyResults.filter(kr => kr.userId === userId && !kr.deleted);
    const keyResultsProgress = userKeyResults.length > 0
      ? userKeyResults.reduce((sum, kr) => sum + (kr.progress ?? 0), 0) / userKeyResults.length
      : 0;

    return {
      focusMinutes: Math.round(focusMinutes),
      planVsActual: Math.round(planVsActual),
      activeStreaks,
      keyResultsProgress: Math.round(keyResultsProgress),
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

      const allTimeBlocks = await this.getAll<TimeBlock>('timeBlocks');
      const dayTimeBlocks = allTimeBlocks.filter(block => 
        block.userId === userId &&
        new Date(block.startTime) >= dayStart && 
        new Date(block.startTime) <= dayEnd
      );

      const plannedMinutes = dayTimeBlocks.reduce((total, block) => {
        const startTime = new Date(block.startTime);
        const endTime = new Date(block.endTime);
        return total + (endTime.getTime() - startTime.getTime()) / (1000 * 60);
      }, 0);

      // Use the unified calculation from above (no duplication needed)
      
      const allSessions = await this.getAll<Session>('sessions');
      const daySessions = allSessions.filter(session => 
        session.userId === userId &&
        new Date(session.startTime) >= dayStart &&
        new Date(session.startTime) <= dayEnd &&
        session.status === 'completed' &&
        session.duration
      );
      
      const sessionMinutes = daySessions.reduce((total, session) => {
        return total + (session.duration || 0) / 60;
      }, 0);
      
      // Calculate actual minutes from completed time blocks
      let actualMinutes = dayTimeBlocks
        .filter(block => block.status === 'completed')
        .reduce((total, block) => {
          const startTime = new Date(block.actualStartTime || block.startTime);
          const endTime = new Date(block.actualEndTime || block.endTime);
          return total + (endTime.getTime() - startTime.getTime()) / (1000 * 60);
        }, 0);
      
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

    const allDomains = await this.getAll<Domain>('domains');
    const userDomains = allDomains.filter(d => d.userId === userId);

    // 🔧 FIX: Use TimeBlocks instead of Sessions (Sessions are rarely used)
    const allTimeBlocks = await this.getAll<TimeBlock>('timeBlocks');
    const periodTimeBlocks = allTimeBlocks.filter(block =>
      block.userId === userId &&
      !block.deleted &&
      block.status === 'completed' && // Only count completed blocks (actual time)
      new Date(block.startTime) >= startDate &&
      new Date(block.startTime) <= endDate
    );

    const defaultColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#f97316'];

    const domainHours = new Map<string, number>();

    for (const block of periodTimeBlocks) {
      const domain = userDomains.find(d => d.id === block.domainId);
      const domainName = domain?.name || 'Uncategorized';

      // Calculate actual duration in hours
      const startTime = new Date(block.actualStartTime || block.startTime);
      const endTime = new Date(block.actualEndTime || block.endTime);
      const durationMs = endTime.getTime() - startTime.getTime();
      const hours = durationMs / (1000 * 60 * 60);

      domainHours.set(domainName, (domainHours.get(domainName) || 0) + hours);
    }

    const result = Array.from(domainHours.entries()).map(([domain, hours], index) => ({
      domain,
      hours: Number(hours.toFixed(1)),
      color: userDomains.find(d => d.name === domain)?.color || defaultColors[index % defaultColors.length]
    }));

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

      const allSessions = await this.getAll<Session>('sessions');
      const daySessions = allSessions.filter(session => 
        session.userId === userId &&
        new Date(session.startTime) >= dayStart &&
        new Date(session.startTime) <= dayEnd &&
        session.status === 'completed'
      );

      const focusMinutes = daySessions
        .filter(session => session.tags.includes('focus'))
        .reduce((total, session) => total + (session.duration || 0), 0) / 60;

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
      return [];
    }

    const correlations = [];

    const moodFocusCorr = this.calculatePearsonCorrelation(
      focusTrend.map(d => d.mood),
      focusTrend.map(d => d.focusMinutes)
    );

    const energyFocusCorr = this.calculatePearsonCorrelation(
      focusTrend.map(d => d.energy),
      focusTrend.map(d => d.focusMinutes)
    );

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
    const planVsActual = await this.calculatePlanVsActualData(userId, 7);
    const timeAllocation = await this.calculateTimeAllocation(userId, 7);
    const focusTrend = await this.calculateFocusTrend(userId, 7);

    const highlights = [];
    const challenges = [];
    const insights = [];
    const nextWeekGoals = [];

    const avgAdherence = planVsActual.reduce((sum, day) => sum + day.adherence, 0) / planVsActual.length;
    if (avgAdherence >= 90) {
      highlights.push('Excellent planning adherence this week');
    } else if (avgAdherence < 70) {
      challenges.push('Low planning adherence - consider more realistic time blocks');
      nextWeekGoals.push('Improve time estimation accuracy');
    }

    const totalFocusHours = focusTrend.reduce((sum, day) => sum + day.focusMinutes, 0) / 60;
    if (totalFocusHours >= 20) {
      highlights.push('Strong focus time this week');
    } else if (totalFocusHours < 10) {
      challenges.push('Limited focused work time');
      nextWeekGoals.push('Schedule more deep focus blocks');
    }

    const topDomain = timeAllocation[0];
    if (topDomain && topDomain.hours > timeAllocation.reduce((sum, d) => sum + d.hours, 0) * 0.6) {
      insights.push(`${topDomain.domain} dominated this week - consider better balance`);
      nextWeekGoals.push('Diversify time allocation across domains');
    }

    if (highlights.length === 0) highlights.push('Keep building consistent habits');
    if (challenges.length === 0) challenges.push('Continue monitoring time allocation');
    if (insights.length === 0) insights.push('Track mood and energy for better patterns');
    if (nextWeekGoals.length === 0) nextWeekGoals.push('Maintain current momentum');

    return { highlights, challenges, insights, nextWeekGoals };
  }

  // ============================================================================
  // VISION BOARD CRUD OPERATIONS
  // ============================================================================

  // Vision Board operations
  async createVisionBoard(data: Omit<VisionBoard, 'id' | 'createdAt' | 'updatedAt'>): Promise<VisionBoard> {
    const now = new Date();
    const visionBoard: VisionBoard = {
      ...data,
      id: `visionBoard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: now,
      updatedAt: now
    };
    return this.create('visionBoards', visionBoard);
  }

  async getVisionBoards(userId: string): Promise<VisionBoard[]> {
    return this.getByIndex<VisionBoard>('visionBoards', 'userId', userId);
  }

  async getVisionBoard(id: string): Promise<VisionBoard | null> {
    return this.read<VisionBoard>('visionBoards', id);
  }

  async updateVisionBoard(data: VisionBoard): Promise<VisionBoard> {
    const updated = { ...data, updatedAt: new Date() };
    return this.update('visionBoards', updated);
  }

  async deleteVisionBoard(id: string): Promise<void> {
    // First delete all vision items in this board
    const items = await this.getByIndex<VisionItem>('visionItems', 'boardId', id);
    for (const item of items) {
      await this.deleteVisionItem(item.id);
    }
    
    // Then delete the board itself
    await this.delete('visionBoards', id);
  }

  // Vision Item operations  
  async createVisionItem(data: Omit<VisionItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<VisionItem> {
    const now = new Date();
    const visionItem: VisionItem = {
      ...data,
      id: `visionItem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: now,
      updatedAt: now
    };
    return this.create('visionItems', visionItem);
  }

  async getVisionItems(boardId: string): Promise<VisionItem[]> {
    return this.getByIndex<VisionItem>('visionItems', 'boardId', boardId);
  }

  async getVisionItem(id: string): Promise<VisionItem | null> {
    return this.read<VisionItem>('visionItems', id);
  }

  async updateVisionItem(data: VisionItem): Promise<VisionItem> {
    const updated = { ...data, updatedAt: new Date() };
    return this.update('visionItems', updated);
  }

  async deleteVisionItem(id: string): Promise<void> {
    // Get the item to check for asset cleanup
    const item = await this.read<VisionItem>('visionItems', id);
    if (item?.assetId) {
      await this.deleteMediaAsset(item.assetId);
    }
    
    await this.delete('visionItems', id);
  }

  // Media Asset operations
  async createMediaAsset(data: Omit<MediaAsset, 'id' | 'createdAt' | 'updatedAt'>): Promise<MediaAsset> {
    const now = new Date();
    const mediaAsset: MediaAsset = {
      ...data,
      id: `mediaAsset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: now,
      updatedAt: now
    };
    return this.create('mediaAssets', mediaAsset);
  }

  async getMediaAsset(id: string): Promise<MediaAsset | null> {
    return this.read<MediaAsset>('mediaAssets', id);
  }

  async getMediaAssets(userId: string): Promise<MediaAsset[]> {
    return this.getByIndex<MediaAsset>('mediaAssets', 'userId', userId);
  }

  async deleteMediaAsset(id: string): Promise<void> {
    const asset = await this.read<MediaAsset>('mediaAssets', id);
    
    // Clean up blob storage for guest users
    if (asset?.storage === 'indexeddb' && asset.blobKey) {
      await this.deleteBlob(asset.blobKey);
    }
    
    await this.delete('mediaAssets', id);
  }

  // Blob storage operations (delegated to IndexedDB adapter)
  async storeBlob(blobKey: string, blob: Blob): Promise<void> {
    if (this.adapter instanceof IndexedDBAdapter) {
      return (this.adapter as any).storeBlob(blobKey, blob);
    }
    throw new Error('Blob storage only available in IndexedDB mode');
  }

  async getBlob(blobKey: string): Promise<Blob | null> {
    if (this.adapter instanceof IndexedDBAdapter) {
      return (this.adapter as any).getBlob(blobKey);
    }
    throw new Error('Blob storage only available in IndexedDB mode');
  }

  async deleteBlob(blobKey: string): Promise<void> {
    if (this.adapter instanceof IndexedDBAdapter) {
      return (this.adapter as any).deleteBlob(blobKey);
    }
    throw new Error('Blob storage only available in IndexedDB mode');
  }

  // Advanced Vision Board queries
  async getActiveVisionBoards(userId: string): Promise<VisionBoard[]> {
    const boards = await this.getVisionBoards(userId);
    return boards.filter(board => board.isActive);
  }

  async getVisionBoardsByGoal(goalId: string): Promise<VisionBoard[]> {
    return this.getByIndex<VisionBoard>('visionBoards', 'linkedGoalId', goalId);
  }

  async getPinnedVisionItems(boardId: string): Promise<VisionItem[]> {
    const items = await this.getVisionItems(boardId);
    return items.filter(item => item.isPinned);
  }

  async resetLocalDatabase(): Promise<void> {
    if (this.useFirebase) {
      throw new Error('Database reset not available in logged mode - data is stored in Firebase');
    }

    if (!(this.adapter instanceof IndexedDBAdapter)) {
      throw new Error('Reset only available for IndexedDB adapter');
    }

    await (this.adapter as any).resetDatabase();
    
    this.configureAdapter();
    await this.init();
  }

  getDatabaseError(): { type: string; message: string; canReset: boolean } | null {
    if (typeof window === 'undefined') return null;
    return (window as any).__lifeTrackerDBError || null;
  }

  clearDatabaseError(): void {
    if (typeof window !== 'undefined') {
      delete (window as any).__lifeTrackerDBError;
    }
  }

  // ============================================================================
  // 🧠 NOTION-LIKE PAGES CRUD OPERATIONS
  // ============================================================================

  // Page operations
  async createPage(data: Omit<Page, 'id' | 'createdAt' | 'updatedAt'>): Promise<Page> {
    const now = new Date();
    const page: Page = {
      ...data,
      id: `page-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: now,
      updatedAt: now
    };
    
    console.log('📝 Creating page:', {
      id: page.id,
      title: page.title,
      userId: page.userId,
      blocksCount: page.blocks.length
    });
    
    return this.create('pages', page);
  }

  async getPages(userId: string): Promise<Page[]> {
    console.log('📖 Getting pages for userId:', userId);
    return this.getByIndex<Page>('pages', 'userId', userId);
  }

  async getPage(id: string): Promise<Page | null> {
    console.log('📄 Getting page:', id);
    return this.read<Page>('pages', id);
  }

  async updatePage(data: Page): Promise<Page> {
    const updated = { ...data, updatedAt: new Date() };
    
    console.log('✏️ Updating page:', {
      id: updated.id,
      title: updated.title,
      blocksCount: updated.blocks.length
    });
    
    return this.update('pages', updated);
  }

  async deletePage(id: string): Promise<void> {
    console.log('🗑️ Deleting page:', id);
    await this.delete('pages', id);
  }

  // Advanced Page queries
  async getPagesByTag(userId: string, tag: string): Promise<Page[]> {
    const pages = await this.getPages(userId);
    return pages.filter(page => page.tags?.includes(tag));
  }

  async getTemplatePages(userId: string): Promise<Page[]> {
    const pages = await this.getPages(userId);
    return pages.filter(page => page.isTemplate);
  }

  async getPagesByGoal(goalId: string): Promise<Page[]> {
    return this.getByIndex<Page>('pages', 'linkedGoalIds', goalId);
  }

  async getPagesByProject(projectId: string): Promise<Page[]> {
    return this.getByIndex<Page>('pages', 'linkedProjectIds', projectId);
  }

  async getPagesByTask(taskId: string): Promise<Page[]> {
    return this.getByIndex<Page>('pages', 'linkedTaskIds', taskId);
  }

  async searchPages(userId: string, query: string): Promise<Page[]> {
    const pages = await this.getPages(userId);
    const lowercaseQuery = query.toLowerCase();
    
    return pages.filter(page => 
      page.title.toLowerCase().includes(lowercaseQuery) ||
      page.tags?.some(tag => tag.toLowerCase().includes(lowercaseQuery))
    );
  }

  async getRecentPages(userId: string, limit: number = 10): Promise<Page[]> {
    const pages = await this.getPages(userId);
    return pages
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, limit);
  }

  // Page statistics
  async getPageStats(userId: string): Promise<{
    totalPages: number;
    templatesCount: number;
    tagsCount: number;
    averageBlocksPerPage: number;
    lastUpdated: Date | null;
  }> {
    const pages = await this.getPages(userId);
    
    const totalPages = pages.length;
    const templatesCount = pages.filter(p => p.isTemplate).length;
    
    const allTags = new Set<string>();
    pages.forEach(page => page.tags?.forEach(tag => allTags.add(tag)));
    const tagsCount = allTags.size;
    
    const totalBlocks = pages.reduce((sum, page) => sum + page.blocks.length, 0);
    const averageBlocksPerPage = totalPages > 0 ? Math.round(totalBlocks / totalPages) : 0;
    
    const lastUpdated = pages.length > 0 
      ? pages.reduce((latest, page) => 
          new Date(page.updatedAt) > new Date(latest) ? page.updatedAt : latest, 
          pages[0].updatedAt
        )
      : null;

    return {
      totalPages,
      templatesCount,
      tagsCount,
      averageBlocksPerPage,
      lastUpdated
    };
  }

  // Helper for auto-saving pages with debounce
  async savePage(page: Page): Promise<Page> {
    // This method ensures the page exists first
    const existing = await this.getPage(page.id);
    
    if (existing) {
      console.log('💾 Updating existing page:', page.id);
      return this.updatePage(page);
    } else {
      console.log('💾 Creating new page:', page.id);
      const { id, createdAt, updatedAt, ...pageData } = page;
      return this.createPage(pageData);
    }
  }
}

export const db = new LifeTrackerDB();