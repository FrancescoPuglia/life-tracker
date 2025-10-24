import { 
  User, Domain, Goal, KeyResult, Project, Task, TimeBlock, Session, 
  Habit, HabitLog, Metric, CalendarEvent, Deadline, JournalEntry, 
  Insight, Achievement, KPI, DashboardState 
} from '@/types';

class LifeTrackerDB {
  private db: IDBDatabase | null = null;
  private dbName = 'LifeTrackerDB';
  private version = 1;

  async init(): Promise<void> {
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

  async create<T extends { id: string }>(storeName: string, data: T): Promise<T> {
    const store = await this.getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.add(data);
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
    const store = await this.getStore(storeName);
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
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
}

export const db = new LifeTrackerDB();