import { Session, TimeBlock } from '@/types';
import { db, hasSessionTag } from '@/lib/database';
import {
  completeSessionAt,
  pauseSessionAt,
  resumeSessionAt,
  timeBlockStatusAfterSession,
} from '@/lib/sessionTiming';

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
          this.lastActivity = new Date();
          break;
        case 'subtract':
          await this.subtractIdleTime(idleStartTime);
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

    if (
      this.currentSession
      && (this.currentSession.status === 'active' || this.currentSession.status === 'paused')
    ) {
      throw new Error('A session is already in progress. Resume or stop it before starting another.');
    }

    const now = new Date();
    let linkedTimeBlock: TimeBlock | null = null;

    // Derive linkage only from the authenticated owner's persisted TimeBlock.
    if (timeBlockId) {
      const timeBlocks = await db.getAll<TimeBlock>('timeBlocks');
      linkedTimeBlock = timeBlocks.find((timeBlock) => (
        timeBlock.id === timeBlockId
        && timeBlock.userId === userId
        && !timeBlock.deleted
      )) ?? null;
      if (!linkedTimeBlock) {
        throw new Error('The linked TimeBlock is unavailable for this owner.');
      }
      if (linkedTimeBlock.status === 'completed' || linkedTimeBlock.status === 'cancelled') {
        throw new Error('The linked TimeBlock cannot start a Session.');
      }
      domainId = linkedTimeBlock.domainId;
    }

    const session: Session = {
      id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timeBlockId,
      taskId: linkedTimeBlock?.taskId ?? taskId,
      projectId: linkedTimeBlock?.projectId,
      domainId,
      userId,
      startTime: now,
      status: 'active',
      activeSegmentStartedAt: now,
      tags: timeBlockId ? ['timeblock-session'] : [],
      createdAt: now,
      updatedAt: now,
    };

    await db.create('sessions', session);
    this.currentSession = session;

    // Session creation is the execution authority. A secondary TimeBlock
    // status failure must not erase or hide an already persisted Session.
    if (linkedTimeBlock) {
      try {
        await db.update('timeBlocks', {
          ...linkedTimeBlock,
          status: 'in_progress',
          actualStartTime: linkedTimeBlock.actualStartTime ?? now,
          updatedAt: now,
        });
      } catch {
        console.warn('The linked TimeBlock status could not be synchronized after Session start.');
      }
    }

    this.lastActivity = new Date();
    return session;
  }

  async pauseSession(): Promise<Session | null> {
    if (!this.currentSession || this.currentSession.status !== 'active') {
      throw new Error('No active session to pause.');
    }

    const paused = pauseSessionAt(this.currentSession, new Date());
    await this.updateSession(paused);
    this.currentSession = paused;
    return paused;
  }

  async resumeSession(): Promise<Session | null> {
    if (!this.currentSession || this.currentSession.status !== 'paused') {
      throw new Error('No paused session to resume.');
    }

    const resumedSession = resumeSessionAt(this.currentSession, new Date());
    await this.updateSession(resumedSession);
    this.currentSession = resumedSession;
    this.lastActivity = new Date();
    return resumedSession;
  }

  // 🚀 ENHANCED: Update linked TimeBlock on completion
  async stopSession(notes?: string): Promise<Session | null> {
    if (!this.currentSession) {
      throw new Error('No session to stop.');
    }

    const now = new Date();
    const completedSession = completeSessionAt(this.currentSession, now, notes);
    await this.updateSession(completedSession);
    this.currentSession = null;

    if (completedSession.timeBlockId) {
      try {
        const timeBlocks = await db.getAll<TimeBlock>('timeBlocks');
        const timeBlock = timeBlocks.find((candidate) => (
          candidate.id === completedSession.timeBlockId
          && candidate.userId === completedSession.userId
          && !candidate.deleted
        ));
        if (
          timeBlock
          && timeBlock.status !== 'completed'
          && timeBlock.status !== 'cancelled'
        ) {
          await db.update('timeBlocks', {
            ...timeBlock,
            status: timeBlockStatusAfterSession(timeBlock, completedSession.duration ?? 0),
            actualEndTime: now,
            actualStartTime: timeBlock.actualStartTime ?? completedSession.startTime,
            updatedAt: now,
          });
        }
      } catch {
        console.warn('The linked TimeBlock status could not be synchronized after Session completion.');
      }
    }

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

  restoreCurrentSession(session: Session | null, ownerUid: string): Session | null {
    if (!ownerUid) throw new Error('Authenticated owner is required to restore a session.');
    if (session === null) {
      this.currentSession = null;
      return null;
    }
    if (
      session.userId !== ownerUid
      || session.deleted === true
      || (session.status !== 'active' && session.status !== 'paused')
      || !(session.startTime instanceof Date)
      || !Number.isFinite(session.startTime.getTime())
    ) {
      throw new Error('Persisted session cannot be restored for this owner.');
    }
    this.currentSession = session;
    return this.currentSession;
  }

  private async updateSession(session: Session): Promise<void> {
    await db.update('sessions', session);
  }

  private async subtractIdleTime(idleStartTime: Date): Promise<void> {
    if (!this.currentSession || this.currentSession.status !== 'active') {
      throw new Error('No active Session can subtract idle time.');
    }
    const paused = pauseSessionAt(this.currentSession, idleStartTime);
    await this.updateSession(paused);
    this.currentSession = paused;

    const resumed = resumeSessionAt(paused, new Date());
    await this.updateSession(resumed);
    this.currentSession = resumed;
    this.lastActivity = new Date();
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
      .filter(session => hasSessionTag(session, 'focus'))
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
