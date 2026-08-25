'use client';

import { useEffect } from 'react';
import { desktopNativeBridge } from '@/lib/desktop/nativeBridge';
import { getDesktopReminderApiClient } from '@/lib/desktop/reminderApiClient';
import {
  DESKTOP_REMINDER_REFRESH_EVENT,
  DesktopReminderCoordinator,
} from '@/lib/desktop/reminderCoordinator';
import { browserDesktopReminderLocalStore } from '@/lib/desktop/reminderLocalStore';

export default function DesktopReminderRuntime({ uid }: { readonly uid: string }) {
  useEffect(() => {
    if (!desktopNativeBridge.isAvailable()) return undefined;
    const coordinator = new DesktopReminderCoordinator({
      uid,
      api: getDesktopReminderApiClient(),
      bridge: desktopNativeBridge,
      localStore: browserDesktopReminderLocalStore(),
      logger: { warn: (message) => console.warn(`[DesktopReminder] ${message}`) },
    });
    const refresh = () => coordinator.refreshNow();
    const visibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    let disposed = false;
    let unsubscribeClicks: (() => Promise<void>) | undefined;

    coordinator.start();
    window.addEventListener('online', refresh);
    window.addEventListener(DESKTOP_REMINDER_REFRESH_EVENT, refresh);
    document.addEventListener('visibilitychange', visibility);
    void desktopNativeBridge.subscribeToNotificationClicks()
      .then((unsubscribe) => {
        if (disposed) void unsubscribe().catch(() => undefined);
        else unsubscribeClicks = unsubscribe;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      coordinator.stop();
      window.removeEventListener('online', refresh);
      window.removeEventListener(DESKTOP_REMINDER_REFRESH_EVENT, refresh);
      document.removeEventListener('visibilitychange', visibility);
      if (unsubscribeClicks) void unsubscribeClicks().catch(() => undefined);
    };
  }, [uid]);

  return null;
}
