'use client';

import { useState, useEffect } from 'react';
import { useSync, SyncStatus } from '@/lib/syncManager';

export default function SyncStatusIndicator() {
  const [status, setStatus] = useState<SyncStatus>({
    isOnline: true,
    isSyncing: false,
    lastSyncTime: null,
    pendingChanges: 0,
    error: null,
  });
  
  const sync = useSync();

  useEffect(() => {
    const unsubscribe = sync.onStatusChange(setStatus);
    return unsubscribe;
  }, [sync]);

  const handleForceSync = async () => {
    if (status.isOnline && !status.isSyncing) {
      try {
        await sync.forceSync();
      } catch (error) {
        console.error('Force sync failed:', error);
      }
    }
  };

  const getStatusIcon = () => {
    if (status.error) return '⚠️';
    if (status.isSyncing) return '⏳';
    if (!status.isOnline) return '📱';
    return '☁️';
  };

  const getStatusText = () => {
    if (status.error) return 'Sync Error';
    if (status.isSyncing) return 'Syncing...';
    if (!status.isOnline) return 'Offline';
    if (status.lastSyncTime) {
      const timeSince = Date.now() - status.lastSyncTime.getTime();
      const minutesAgo = Math.floor(timeSince / (1000 * 60));
      if (minutesAgo < 1) return 'Just synced';
      if (minutesAgo < 60) return `${minutesAgo}m ago`;
      const hoursAgo = Math.floor(minutesAgo / 60);
      return `${hoursAgo}h ago`;
    }
    return 'Ready';
  };

  const getStatusColor = () => {
    if (status.error) return 'text-red-400';
    if (status.isSyncing) return 'text-blue-400';
    if (!status.isOnline) return 'text-yellow-400';
    return 'text-green-400';
  };

  return (
    <button
      onClick={handleForceSync}
      disabled={!status.isOnline || status.isSyncing}
      className={`flex items-center space-x-2 px-3 py-1 rounded-lg bg-white/10 border border-white/20 transition-all hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed ${getStatusColor()}`}
      title={status.error || `Last sync: ${status.lastSyncTime ? status.lastSyncTime.toLocaleString() : 'Never'}`}
    >
      <span className={status.isSyncing ? 'animate-spin' : ''}>{getStatusIcon()}</span>
      <span className="text-xs">{getStatusText()}</span>
      {status.pendingChanges > 0 && (
        <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
          {status.pendingChanges}
        </span>
      )}
    </button>
  );
}