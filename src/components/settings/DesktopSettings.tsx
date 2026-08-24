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

const UNAVAILABLE_STATUS: DesktopNativeStatus = {
  available: false,
  notificationPermission: 'unavailable',
  autostartEnabled: null,
};

interface DesktopSettingsProps {
  readonly bridge?: DesktopNativeBridge;
}

export default function DesktopSettings({
  bridge = desktopNativeBridge,
}: DesktopSettingsProps) {
  const [status, setStatus] = useState<DesktopNativeStatus>(UNAVAILABLE_STATUS);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    if (!bridge.isAvailable()) return undefined;
    let disposed = false;
    let unsubscribe: (() => Promise<void>) | undefined;
    void bridge.subscribeToNotificationClicks()
      .then((cleanup) => {
        if (disposed) void cleanup().catch(() => undefined);
        else unsubscribe = cleanup;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      if (unsubscribe) void unsubscribe().catch(() => undefined);
    };
  }, [bridge]);

  const run = async (name: string, action: () => Promise<void>) => {
    setBusyAction(name);
    setMessage(null);
    setError(null);
    try {
      await action();
    } catch {
      setError('The native Desktop action failed safely. No tracking data was changed.');
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
