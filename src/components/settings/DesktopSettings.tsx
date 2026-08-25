'use client';

import { useCallback, useEffect, useState } from 'react';
import { AI_BACKEND_BUILD_ID } from '@/lib/ai/backendConfig';
import {
  DEPLOYMENT_ENVIRONMENT,
  RUNTIME_TARGET,
} from '@/lib/runtimeEnvironment';
import {
  desktopNativeBridge,
  type DesktopNativeBridge,
  type DesktopNativeStatus,
} from '@/lib/desktop/nativeBridge';
import { DESKTOP_REMINDER_REFRESH_EVENT } from '@/lib/desktop/reminderCoordinator';
import {
  defaultNotificationPreferences,
  normalizeEditableNotificationPreferences,
  notificationPreferencesStore,
  type EditableNotificationPreferences,
  type NotificationPreferencesStore,
} from '@/lib/notifications/preferences';

const UNAVAILABLE_STATUS: DesktopNativeStatus = {
  available: false,
  notificationPermission: 'unavailable',
  autostartEnabled: null,
};

interface DesktopSettingsProps {
  readonly userId: string;
  readonly bridge?: DesktopNativeBridge;
  readonly preferencesStore?: NotificationPreferencesStore;
}

export default function DesktopSettings({
  userId,
  bridge = desktopNativeBridge,
  preferencesStore = notificationPreferencesStore,
}: DesktopSettingsProps) {
  const [status, setStatus] = useState<DesktopNativeStatus>(UNAVAILABLE_STATUS);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<EditableNotificationPreferences>(
    defaultNotificationPreferences,
  );
  const [offsetText, setOffsetText] = useState('15');
  const [preferencesLoading, setPreferencesLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setStatus(await bridge.readStatus());
      setError(null);
    } catch {
      setStatus(UNAVAILABLE_STATUS);
      setError('Native Desktop status is unavailable. Restart Life Tracker and try again.');
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    setPreferencesLoading(true);
    void preferencesStore.load(userId)
      .then((value) => {
        if (disposed) return;
        setPreferences(value);
        setOffsetText(value.reminderOffsetsMinutes.join(', '));
        setError(null);
      })
      .catch(() => {
        if (!disposed) {
          setError('Reminder preferences could not be loaded. Tracking data was not changed.');
        }
      })
      .finally(() => {
        if (!disposed) setPreferencesLoading(false);
      });
    return () => { disposed = true; };
  }, [preferencesStore, userId]);

  const run = async (name: string, action: () => Promise<void>) => {
    setBusyAction(name);
    setMessage(null);
    setError(null);
    try {
      await action();
    } catch {
      setError(name === 'reminder-policy'
        ? 'The reminder policy is invalid or unavailable. No tracking data was changed.'
        : 'The native Desktop action failed safely. No tracking data was changed.');
    } finally {
      setBusyAction(null);
    }
  };

  const requestNotifications = () => run('permission', async () => {
    const notificationPermission = await bridge.requestNotificationPermission();
    setStatus((current) => ({ ...current, notificationPermission }));
    setMessage(notificationPermission === 'granted'
      ? 'Native notifications are enabled.'
      : 'Notification permission was not granted. You can keep using Life Tracker without it.');
    window.dispatchEvent(new Event(DESKTOP_REMINDER_REFRESH_EVENT));
  });

  const testNotifications = () => run('test', async () => {
    await bridge.sendTestNotification();
    setMessage('Test notification sent. Clicking it only opens and focuses Life Tracker.');
  });

  const changeAutostart = (enabled: boolean) => run('autostart', async () => {
    const authoritativeState = await bridge.setAutostart(enabled);
    setStatus((current) => ({ ...current, autostartEnabled: authoritativeState }));
    setMessage(authoritativeState
      ? 'Life Tracker will start when you sign in to Windows.'
      : 'Windows autostart is disabled.');
  });

  const saveReminderPolicy = () => run('reminder-policy', async () => {
    const reminderOffsetsMinutes = offsetText
      .split(',')
      .map((value) => Number(value.trim()));
    const normalized = normalizeEditableNotificationPreferences({
      ...preferences,
      reminderOffsetsMinutes,
    });
    await preferencesStore.save(userId, normalized);
    setPreferences(normalized);
    setOffsetText(normalized.reminderOffsetsMinutes.join(', '));
    setMessage('Reminder policy saved. Future TimeBlocks will be reconciled safely.');
    window.dispatchEvent(new Event(DESKTOP_REMINDER_REFRESH_EVENT));
  });

  return (
    <section className="space-y-6" aria-labelledby="desktop-settings-title">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 id="desktop-settings-title" className="text-xl font-bold text-slate-900">
          Desktop
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Native Windows features are optional. Core tracking continues if they are unavailable.
        </p>

        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <StatusItem label="Runtime" value={RUNTIME_TARGET} />
          <StatusItem label="Environment" value={DEPLOYMENT_ENVIRONMENT} />
          <StatusItem
            label="Native bridge"
            value={loading ? 'checking' : status.available ? 'available' : 'unavailable'}
          />
        </dl>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Windows notifications</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Permission is requested only when you choose Enable. A notification never marks a
              TimeBlock or Session complete.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase text-slate-700">
            {status.notificationPermission}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {status.notificationPermission !== 'granted' && (
            <button
              type="button"
              onClick={requestNotifications}
              disabled={!status.available || busyAction !== null}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyAction === 'permission' ? 'Checking…' : 'Enable native notifications'}
            </button>
          )}
          <button
            type="button"
            onClick={testNotifications}
            disabled={status.notificationPermission !== 'granted' || busyAction !== null}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyAction === 'test' ? 'Sending…' : 'Send test notification'}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900">Reminder policy</h3>
        <p className="mt-1 text-sm text-slate-600">
          The backend creates version-bound jobs and rereads the current TimeBlock before display.
          Moved, completed, cancelled, or deleted blocks are suppressed.
        </p>

        <fieldset disabled={preferencesLoading || busyAction !== null} className="mt-5 space-y-5">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={preferences.desktopEnabled}
              onChange={(event) => setPreferences((current) => ({
                ...current,
                desktopEnabled: event.target.checked,
              }))}
              className="mt-1 h-4 w-4"
            />
            <span>
              <span className="block font-semibold text-slate-900">Scheduled Desktop reminders</span>
              <span className="block text-sm text-slate-600">
                Requires native permission above and Life Tracker running in the tray.
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm font-semibold text-slate-800">
              Timezone
              <input
                aria-label="Reminder timezone"
                value={preferences.timezone}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  timezone: event.target.value,
                }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Minutes before (comma-separated)
              <input
                aria-label="Reminder offsets"
                inputMode="numeric"
                value={offsetText}
                onChange={(event) => setOffsetText(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Maximum per block
              <input
                aria-label="Maximum reminders per block"
                type="number"
                min={1}
                max={8}
                value={preferences.maxRemindersPerBlock}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  maxRemindersPerBlock: Number(event.target.value),
                }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={preferences.atStartEnabled}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  atStartEnabled: event.target.checked,
                }))}
              />
              Notify at block start
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={preferences.missedStart.enabled}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  missedStart: { ...current.missedStart, enabled: event.target.checked },
                }))}
              />
              Missed-start warning
            </label>
          </div>

          <label className="block max-w-xs text-sm font-semibold text-slate-800">
            Missed-start delay (minutes)
            <input
              aria-label="Missed-start delay"
              type="number"
              min={1}
              max={240}
              value={preferences.missedStart.afterMinutes}
              onChange={(event) => setPreferences((current) => ({
                ...current,
                missedStart: {
                  ...current.missedStart,
                  afterMinutes: Number(event.target.value),
                },
              }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={preferences.quietHours.enabled}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  quietHours: { ...current.quietHours, enabled: event.target.checked },
                }))}
              />
              Quiet hours
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Quiet from
              <input
                aria-label="Quiet hours start"
                type="time"
                value={preferences.quietHours.start}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  quietHours: { ...current.quietHours, start: event.target.value },
                }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Quiet until
              <input
                aria-label="Quiet hours end"
                type="time"
                value={preferences.quietHours.end}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  quietHours: { ...current.quietHours, end: event.target.value },
                }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={saveReminderPolicy}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busyAction === 'reminder-policy' ? 'Saving…' : 'Save reminder policy'}
          </button>
        </fieldset>

        <p className="mt-4 text-xs text-slate-500">
          WhatsApp and email remain off until their backend providers are configured and verified.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={status.autostartEnabled === true}
            disabled={!status.available || busyAction !== null}
            onChange={(event) => void changeAutostart(event.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="block text-lg font-bold text-slate-900">Start with Windows</span>
            <span className="mt-1 block text-sm text-slate-600">
              Uses the official installed-app autostart entry. Closing the window keeps Life
              Tracker available in the system tray; Quit exits it completely.
            </span>
          </span>
        </label>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900">Cloud connection</h3>
        <p className="mt-1 break-all font-mono text-xs text-slate-600">{AI_BACKEND_BUILD_ID}</p>
        <p className="mt-2 text-xs text-slate-500">
          This is public build routing metadata, not a credential. Provider secrets remain backend-only.
        </p>
      </div>

      {message && <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
    </section>
  );
}

function StatusItem({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-slate-900">{value}</dd>
    </div>
  );
}
