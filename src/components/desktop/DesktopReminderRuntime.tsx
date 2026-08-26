'use client';

import { useEffect, useRef } from 'react';
import { useDataContext } from '@/providers/DataProvider';
import { desktopNativeBridge } from '@/lib/desktop/nativeBridge';
import { getDesktopReminderApiClient } from '@/lib/desktop/reminderApiClient';
import {
  DESKTOP_REMINDER_REFRESH_EVENT,
  DesktopReminderCoordinator,
} from '@/lib/desktop/reminderCoordinator';
import { browserDesktopReminderLocalStore } from '@/lib/desktop/reminderLocalStore';
import {
  dispatchExecutionAlarmSignal,
  EXECUTION_ALARM_STOP_EVENT,
  executionAlarmPreferencesStore,
  executionAlarmPresentation,
  resolveExecutionAlarmContext,
  shouldDispatchExecutionAlarm,
} from '@/lib/desktop/executionAlarm';

export default function DesktopReminderRuntime({ uid }: { readonly uid: string }) {
  const data = useDataContext();
  const dataRef = useRef({
    timeBlocks: data.timeBlocks,
    tasks: data.tasks,
    projects: data.projects,
    goals: data.goals,
  });
  dataRef.current = {
    timeBlocks: data.timeBlocks,
    tasks: data.tasks,
    projects: data.projects,
    goals: data.goals,
  };

  useEffect(() => {
    if (!desktopNativeBridge.isAvailable()) return undefined;
    const coordinator = new DesktopReminderCoordinator({
      uid,
      api: getDesktopReminderApiClient(),
      bridge: desktopNativeBridge,
      localStore: browserDesktopReminderLocalStore(),
      onClaimedDispatch: (dispatch) => {
        const preferences = executionAlarmPreferencesStore.load(uid);
        const context = resolveExecutionAlarmContext(
          dispatch,
          dataRef.current.timeBlocks,
          dataRef.current.tasks,
          dataRef.current.projects,
          dataRef.current.goals,
        );
        if (!shouldDispatchExecutionAlarm(preferences, context)) return false;
        const presentation = executionAlarmPresentation(dispatch, preferences);
        if (presentation) dispatchExecutionAlarmSignal({ dispatch, context, presentation });
        return true;
      },
      logger: { warn: (message) => console.warn(`[DesktopReminder] ${message}`) },
    });
    const refresh = () => coordinator.refreshNow();
    const visibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    let disposed = false;
    let unsubscribeClicks: (() => Promise<void>) | undefined;
    let unsubscribeAlarmStops: (() => Promise<void>) | undefined;

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
    void desktopNativeBridge.subscribeToExecutionAlarmStops(() => {
      window.dispatchEvent(new Event(EXECUTION_ALARM_STOP_EVENT));
    })
      .then((unsubscribe) => {
        if (disposed) void unsubscribe().catch(() => undefined);
        else unsubscribeAlarmStops = unsubscribe;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      coordinator.stop();
      window.removeEventListener('online', refresh);
      window.removeEventListener(DESKTOP_REMINDER_REFRESH_EVENT, refresh);
      document.removeEventListener('visibilitychange', visibility);
      if (unsubscribeClicks) void unsubscribeClicks().catch(() => undefined);
      if (unsubscribeAlarmStops) void unsubscribeAlarmStops().catch(() => undefined);
    };
  }, [uid]);

  return null;
}
