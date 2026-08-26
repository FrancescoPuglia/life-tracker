'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { useSync, type SyncStatus } from '@/lib/syncManager';

export default function SyncStatusIndicator() {
  const [status, setStatus] = useState<SyncStatus>({
    isOnline: true,
    isSyncing: false,
    lastSyncTime: null,
    pendingChanges: 0,
    error: null,
  });
  const sync = useSync();

  useEffect(() => sync.onStatusChange(setStatus), [sync]);

  const handleForceSync = async () => {
    if (!status.isOnline || status.isSyncing) return;
    try {
      await sync.forceSync();
    } catch (error) {
      console.error('Force sync failed:', error);
    }
  };

  const label = status.error
    ? 'Errore sync'
    : status.isSyncing
      ? 'Sincronizzo…'
      : !status.isOnline
        ? 'Offline'
        : status.pendingChanges > 0
          ? `${status.pendingChanges} in attesa`
          : 'Sincronizzato';
  const Icon = status.error
    ? AlertTriangle
    : status.isSyncing
      ? RefreshCw
      : status.isOnline
        ? Cloud
        : CloudOff;
  const tone = status.error
    ? 'text-red-700'
    : !status.isOnline
      ? 'text-amber-700'
      : 'text-emerald-700';

  return (
    <button
      type="button"
      onClick={handleForceSync}
      disabled={!status.isOnline || status.isSyncing}
      className={`hidden min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70 lg:flex ${tone}`}
      title={status.error || `Ultima sincronizzazione: ${status.lastSyncTime ? status.lastSyncTime.toLocaleString('it-IT') : 'non disponibile'}`}
      aria-label={`Stato sincronizzazione: ${label}`}
    >
      <Icon size={15} className={status.isSyncing ? 'animate-spin' : ''} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
