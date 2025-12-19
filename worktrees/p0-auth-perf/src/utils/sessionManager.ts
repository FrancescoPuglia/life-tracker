import { Session, TimeBlock } from '@/types';
import { db } from '@/lib/database';

export class SessionManager {
  private static instance: SessionManager;
  private currentSession: Session | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private lastActivity: Date = new Date();
  private readonly IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  constructor() {
    this.setupIdleDetection();
  }

  private setupIdleDetection() {
    // Only run in browser environment
    if (typeof window === 'undefined') return;
    
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    
    const resetIdleTimer = () => {
      this.lastActivity = new Date();
      
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
      }
      
      this.idleTimer = setTimeout(() => {
        this.handleIdle();
      }, this.IDLE_THRESHOLD_MS);
    };

    events.forEach(event => {
      document.addEventListener(event, resetIdleTimer, true);
    });

    resetIdleTimer();
  }

  private async handleIdle() {
    if (this.currentSession && this.currentSession.status === 'active') {
      const idleStartTime = new Date(this.lastActivity.getTime() + this.IDLE_THRESHOLD_MS);
      
      // Ask user what to do about idle time
      const action = await this.promptIdleAction(idleStartTime);
      
      switch (action) {
        case 'pause':
          await this.pauseSession();
          break;
        case 'stop':
          await this.stopSession();
          break;
        case 'continue':
          // Do nothing, continue the session
          break;
        case 'subtract':
          // Subtract idle time from session
          if (this.currentSession) {
            this.currentSession.endTime = idleStartTime;
            await this.updateSession(this.currentSession);
          }
          break;
      }
    }
  }

  private async promptIdleAction(idleStartTime: Date): Promise<'pause' | 'stop' | 'continue' | 'subtract'> {
    // Only run in browser environment
    if (typeof window === 'undefined') {
      return 'continue';
    }
    
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
      modal.innerHTML = `
        <div class="bg-white rounded-lg p-6 max-w-md">
          <h3 class="text-lg font-semibold mb-4">Idle Time Detected</h3>
          <p class="text-gray-600 mb-4">
            You've been idle since ${idleStartTime.toLocaleTimeString()}. 
            What would you like to do with your current session?
          </p>
          <div class="flex flex-col space-y-2">
            <button id="pause-btn" class="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700">
              Pause Session
            </button>
            <button id="stop-btn" class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
              Stop Session
            </button>
            <button id="continue-btn" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Continue Session
            </button>
            <button id="subtract-btn" class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
              Subtract Idle Time
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const cleanup = () => document.body.removeChild(modal);

      modal.querySelector('#pause-btn')?.addEventListener('click', () => {
        cleanup();
        resolve('pause');
      });

      modal.querySelector('#stop-btn')?.addEventListener('click', () => {
        cleanup();
        resolve('stop');
      });

      modal.querySelector('#continue-btn')?.addEventListener('click', () => {
        cleanup();
        resolve('continue');
      });

      modal.querySelector('#subtract-btn')?.addEventListener('click', () => {
        cleanup();
        resolve('subtract');
      });
    });
  }

  // 🚀 ENHANCED: Support TimeBlock integration
  async startSession(
    taskId?: string, 
    timeBlockId?: string, 
    domainId: string = 'default',
    userId?: string
  ): Promise<Session> {
    if (!userId) {
      throw new Error('userId is required to start a session');
    }

    if (this.currentSession && this.currentSession.status === 'active') {
      throw new Error('A session is already active. Stop or pause the current session first.');
    }

    // 🎯 INTELLIGENCE: Auto-detect domain from timeblock
    if (timeBlockId) {
      const timeBlocks = await db.getAll<TimeBlock>('timeBlocks');
      const timeBlock = timeBlocks.find(tb => tb.id === timeBlockId);
      if (timeBlock) {
        domainId = timeBlock.domainId;
        
        // 🚀 UPDATE: Mark timeblock as in progress
        await db.update('timeBlocks', {
          ...timeBlock,
          status: 'in_progress',
          actualStartTime: new Date(),
          updatedAt: new Date()
        });
      }
    }

    const session: Session = {
      id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timeBlockId, // 🚀 NEW: Link to timeblock
      taskId,
      projectId: undefined, // Will be set from timeblock if available
      domainId,
      userId,
      startTime: new Date(),
      status: 'active',
      tags: timeBlockId ? ['timeblock-session'] : [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.currentSession = session;
    await db.create('sessions', session);
    
    console.log(`🚀 SESSION: Started${timeBlockId ? ` for TimeBlock ${timeBlockId}` : ''}`);
    this.lastActivity = new Date();
    return session;
  }

  async pauseSession(): Promise<Session | null> {
    if (!this.currentSession || this.currentSession.status !== 'active') {
      throw new Error('No active session to pause.');
    }

    const now = new Date();
    const duration = Math.floor((now.getTime() - this.currentSession.startTime.getTime()) / 1000);

    this.currentSession.status = 'paused';
    this.currentSession.endTime = now;
    this.currentSession.duration = duration;
    this.currentSession.updatedAt = now;

    await this.updateSession(this.currentSession);
    return this.currentSession;
  }

  async resumeSession(): Promise<Session | null> {
    if (!this.currentSession || this.currentSession.status !== 'paused') {
      throw new Error('No paused session to resume.');
    }

    // Create a new session entry for the resumed portion
    const resumedSession: Session = {
      ...this.currentSession,
      id: `session-${Date.now()}`,
      startTime: new Date(),
      endTime: undefined,
      duration: undefined,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.currentSession = resumedSession;
    await db.create('sessions', resumedSession);
    
    this.lastActivity = new Date();
    return resumedSession;
  }

  // 🚀 ENHANCED: Update linked TimeBlock on completion
  async stopSession(notes?: string): Promise<Session | null> {
    if (!this.currentSession) {
      throw new Error('No session to stop.');
    }

    const now = new Date();
    const duration = this.currentSession.duration || 
      Math.floor((now.getTime() - this.currentSession.startTime.getTime()) / 1000);

    this.currentSession.status = 'completed';
    this.currentSession.endTime = now;
    this.currentSession.duration = duration;
    this.currentSession.notes = notes;
    this.currentSession.updatedAt = now;

    await this.updateSession(this.currentSession);
    
    // 🎯 INTELLIGENCE: Complete linked TimeBlock
    if (this.currentSession.timeBlockId) {
      const timeBlocks = await db.getAll<TimeBlock>('timeBlocks');
      const timeBlock = timeBlocks.find(tb => tb.id === this.currentSession!.timeBlockId);
      
      if (timeBlock) {
        const actualDurationMin = duration / 60; // Convert to minutes
        const plannedDurationMin = (timeBlock.endTime.getTime() - timeBlock.startTime.getTime()) / (1000 * 60);
        
        const status = actualDurationMin >= plannedDurationMin * 0.8 ? 'completed' : 'overrun';
        
        await db.update('timeBlocks', {
          ...timeBlock,
          status,
          actualEndTime: now,
          actualStartTime: timeBlock.actualStartTime || this.currentSession!.startTime,
          updatedAt: now
        });
        
        console.log(`🎯 TIMEBLOCK: ${status} - ${actualDurationMin.toFixed(1)}min (planned: ${plannedDurationMin.toFixed(1)}min)`);
      }
    }
    
    const completedSession = this.currentSession;
    this.currentSession = null;
    
    console.log(`🚀 SESSION: Completed - ${(duration/60).toFixed(1)} minutes`);
    return completedSession;
  }

  async addSessionTags(tags: string[]): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session to add tags to.');
    }

    this.currentSession.tags = [...new Set([...this.currentSession.tags, ...tags])];
    this.currentSession.updatedAt = new Date();
    
    await this.updateSession(this.currentSession);
  }

  async removeSessionTags(tags: string[]): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session to remove tags from.');
    }

    this.currentSession.tags = this.currentSession.tags.filter(tag => !tags.includes(tag));
    this.currentSession.updatedAt = new Date();
    
    await this.updateSession(this.currentSession);
  }

  async logMoodAndEnergy(mood?: number, energy?: number): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session to log mood and energy.');
    }

    if (mood !== undefined) this.currentSession.mood = mood;
    if (energy !== undefined) this.currentSession.energy = energy;
    this.currentSession.updatedAt = new Date();
    
    await this.updateSession(this.currentSession);
  }

  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  private async updateSession(session: Session): Promise<void> {
    await db.update('sessions', session);
  }

  async getSessionHistory(userId: string, days: number = 7): Promise<Session[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const allSessions = await db.getByIndex<Session>('sessions', 'userId', userId);
    return allSessions.filter(session => 
      session.startTime >= startDate && session.status === 'completed'
    );
  }

  async getTodayStats(userId: string): Promise<{
    totalMinutes: number;
    focusMinutes: number;
    sessionCount: number;
    averageSessionLength: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const sessions = await db.getByIndex<Session>('sessions', 'userId', userId);
    const todaySessions = sessions.filter(session => 
      session.startTime >= today && 
      session.startTime < tomorrow && 
      session.status === 'completed'
    );

    const totalMinutes = todaySessions.reduce((total, session) => 
      total + (session.duration || 0), 0) / 60;
    
    const focusMinutes = todaySessions
      .filter(session => session.tags.includes('focus'))
      .reduce((total, session) => total + (session.duration || 0), 0) / 60;

    const averageSessionLength = todaySessions.length > 0 ? 
      totalMinutes / todaySessions.length : 0;

    return {
      totalMinutes: Math.round(totalMinutes),
      focusMinutes: Math.round(focusMinutes),
      sessionCount: todaySessions.length,
      averageSessionLength: Math.round(averageSessionLength),
    };
  }
}