import { db } from './database';
import { authManager } from './auth';

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: Date | null;
  pendingChanges: number;
  error: string | null;
}

class SyncManager {
  private static instance: SyncManager;
  private listeners: ((status: SyncStatus) => void)[] = [];
  private status: SyncStatus = {
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isSyncing: false,
    lastSyncTime: null,
    pendingChanges: 0,
    error: null,
  };
  private syncInterval: NodeJS.Timeout | null = null;

  static getInstance(): SyncManager {
    if (!SyncManager.instance) {
      SyncManager.instance = new SyncManager();
    }
    return SyncManager.instance;
  }

  constructor() {
    this.initializeNetworkListeners();
    this.startPeriodicSync();
  }

  private initializeNetworkListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', this.handleOnline.bind(this));
    window.addEventListener('offline', this.handleOffline.bind(this));

    // Initial check
    this.updateOnlineStatus(navigator.onLine);
  }

  private async handleOnline() {
    console.log('Network back online - starting sync');
    this.updateOnlineStatus(true);
    
    try {
      await db.enableOnline();
      await this.syncWithCloud();
    } catch (error) {
      console.error('Failed to sync after going online:', error);
      this.updateStatus({ error: 'Failed to sync with cloud' });
    }
  }

  private async handleOffline() {
    console.log('Network offline - enabling offline mode');
    this.updateOnlineStatus(false);
    
    try {
      await db.enableOffline();
    } catch (error) {
      console.error('Failed to enable offline mode:', error);
    }
  }

  private updateOnlineStatus(isOnline: boolean) {
    this.updateStatus({ isOnline, error: null });
  }

  private updateStatus(updates: Partial<SyncStatus>) {
    this.status = { ...this.status, ...updates };
    this.notifyListeners();
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.status));
  }

  onStatusChange(listener: (status: SyncStatus) => void): () => void {
    this.listeners.push(listener);
    
    // Immediately call with current status
    listener(this.status);
    
    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  async syncWithCloud(): Promise<void> {
    if (!this.status.isOnline || this.status.isSyncing) {
      return;
    }

    const user = authManager.getCurrentUser();
    if (!user) {
      console.log('No user authenticated - skipping sync');
      return;
    }

    this.updateStatus({ isSyncing: true, error: null });

    try {
      // If we're using IndexedDB, switch to Firebase for sync
      if (!db.isUsingFirebase) {
        await db.switchToFirebase(user.uid);
      }

      // For now, the sync is implicit through Firestore's offline capabilities
      // In a more complex scenario, you might need to manually sync pending changes
      
      console.log('Sync completed successfully');
      this.updateStatus({ 
        isSyncing: false, 
        lastSyncTime: new Date(),
        pendingChanges: 0 
      });
      
    } catch (error) {
      console.error('Sync failed:', error);
      this.updateStatus({ 
        isSyncing: false, 
        error: error instanceof Error ? error.message : 'Sync failed' 
      });
      
      // Fallback to offline mode if sync fails
      try {
        await db.switchToIndexedDB();
      } catch (fallbackError) {
        console.error('Failed to fallback to IndexedDB:', fallbackError);
      }
    }
  }

  private startPeriodicSync() {
    // Sync every 5 minutes when online
    this.syncInterval = setInterval(() => {
      if (this.status.isOnline && authManager.isSignedIn()) {
        this.syncWithCloud();
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  async forcSync(): Promise<void> {
    if (!this.status.isOnline) {
      throw new Error('Cannot sync while offline');
    }
    
    await this.syncWithCloud();
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  destroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline.bind(this));
      window.removeEventListener('offline', this.handleOffline.bind(this));
    }

    this.listeners = [];
  }
}

export const syncManager = SyncManager.getInstance();

// Hook-like function for React components
export const useSync = () => {
  return {
    syncWithCloud: syncManager.syncWithCloud.bind(syncManager),
    forceSync: syncManager.forcSync.bind(syncManager),
    onStatusChange: syncManager.onStatusChange.bind(syncManager),
    getStatus: syncManager.getStatus.bind(syncManager),
  };
};