import { RUNTIME_TARGET, type LifeTrackerRuntime } from '@/lib/runtimeEnvironment';

export type DesktopNotificationPermission =
  | 'granted'
  | 'denied'
  | 'prompt'
  | 'unavailable';

export interface DesktopNativeStatus {
  readonly available: boolean;
  readonly notificationPermission: DesktopNotificationPermission;
  readonly autostartEnabled: boolean | null;
}

export interface DesktopReminderNotification {
  readonly jobId: string;
  readonly attemptId: string;
  readonly body: string;
}

export interface DesktopNativeBridge {
  isAvailable(): boolean;
  readStatus(): Promise<DesktopNativeStatus>;
  requestNotificationPermission(): Promise<DesktopNotificationPermission>;
  sendTestNotification(): Promise<void>;
  sendReminderNotification(notification: DesktopReminderNotification): Promise<void>;
  setAutostart(enabled: boolean): Promise<boolean>;
  focusWindow(): Promise<void>;
  subscribeToNotificationClicks(): Promise<() => Promise<void>>;
  subscribeToExecutionAlarmStops(callback: () => void): Promise<() => Promise<void>>;
}

interface NativeWindow {
  isMinimized(): Promise<boolean>;
  isVisible(): Promise<boolean>;
  unminimize(): Promise<void>;
  show(): Promise<void>;
  setFocus(): Promise<void>;
}

interface NotificationListener {
  unregister(): Promise<void>;
}

interface NativeDependencies {
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<NotificationPermission>;
  sendNotification(options: {
    title: string;
    body: string;
    autoCancel: boolean;
    extra: Readonly<Record<string, string>>;
  }): void;
  onAction(callback: () => void): Promise<NotificationListener>;
  onExecutionAlarmStop(callback: () => void): Promise<() => Promise<void>>;
  isAutostartEnabled(): Promise<boolean>;
  enableAutostart(): Promise<void>;
  disableAutostart(): Promise<void>;
  currentWindow(): NativeWindow;
  browserPermission(): NotificationPermission | undefined;
}

interface BridgeOptions {
  readonly runtime: LifeTrackerRuntime;
  readonly hasTauriInternals: () => boolean;
  readonly loadDependencies: () => Promise<NativeDependencies>;
}

export function detectTauriDesktop(
  runtime: LifeTrackerRuntime,
  candidate: unknown,
): boolean {
  if (runtime !== 'desktop' || candidate === null || typeof candidate !== 'object') {
    return false;
  }
  return '__TAURI_INTERNALS__' in candidate;
}

export function createDesktopNativeBridge(options: BridgeOptions): DesktopNativeBridge {
  const isAvailable = () => options.runtime === 'desktop' && options.hasTauriInternals();

  const load = async (): Promise<NativeDependencies> => {
    if (!isAvailable()) throw new Error('Desktop native integration is unavailable.');
    return options.loadDependencies();
  };

  const readNotificationPermission = async (
    dependencies: NativeDependencies,
  ): Promise<DesktopNotificationPermission> => {
    if (await dependencies.isPermissionGranted()) return 'granted';
    return dependencies.browserPermission() === 'denied' ? 'denied' : 'prompt';
  };

  const focusWindow = async (): Promise<void> => {
    const dependencies = await load();
    const appWindow = dependencies.currentWindow();
    if (await appWindow.isMinimized()) await appWindow.unminimize();
    if (!(await appWindow.isVisible())) await appWindow.show();
    await appWindow.setFocus();
  };

  return {
    isAvailable,

    async readStatus() {
      if (!isAvailable()) {
        return {
          available: false,
          notificationPermission: 'unavailable',
          autostartEnabled: null,
        };
      }
      const dependencies = await load();
      const [notificationPermission, autostartEnabled] = await Promise.all([
        readNotificationPermission(dependencies),
        dependencies.isAutostartEnabled(),
      ]);
      return { available: true, notificationPermission, autostartEnabled };
    },

    async requestNotificationPermission() {
      const dependencies = await load();
      if (await dependencies.isPermissionGranted()) return 'granted';
      const result = await dependencies.requestPermission();
      if (result === 'granted') return 'granted';
      return result === 'denied' ? 'denied' : 'prompt';
    },

    async sendTestNotification() {
      const dependencies = await load();
      if (!(await dependencies.isPermissionGranted())) {
        throw new Error('Desktop notification permission is not granted.');
      }
      dependencies.sendNotification({
        title: 'Life Tracker',
        body: 'Desktop notifications are ready. Click to return to Life Tracker.',
        autoCancel: true,
        extra: { kind: 'settings-test' },
      });
    },

    async sendReminderNotification(notification) {
      const dependencies = await load();
      if (!(await dependencies.isPermissionGranted())) {
        throw new Error('Desktop notification permission is not granted.');
      }
      if (
        !/^[a-f0-9]{64}$/.test(notification.jobId)
        || !/^[a-f0-9]{64}$/.test(notification.attemptId)
        || typeof notification.body !== 'string'
        || notification.body.length < 1
        || notification.body.length > 500
        || /[\u0000-\u001f\u007f]/u.test(notification.body)
      ) {
        throw new Error('Desktop reminder notification is invalid.');
      }
      dependencies.sendNotification({
        title: 'Life Tracker reminder',
        body: notification.body,
        autoCancel: true,
        extra: {
          kind: 'reminder',
          jobId: notification.jobId,
          attemptId: notification.attemptId,
        },
      });
    },

    async setAutostart(enabled) {
      const dependencies = await load();
      if (enabled) await dependencies.enableAutostart();
      else await dependencies.disableAutostart();
      return dependencies.isAutostartEnabled();
    },

    focusWindow,

    async subscribeToNotificationClicks() {
      const dependencies = await load();
      const listener = await dependencies.onAction(() => {
        void focusWindow().catch(() => undefined);
      });
      return () => listener.unregister();
    },

    async subscribeToExecutionAlarmStops(callback) {
      const dependencies = await load();
      return dependencies.onExecutionAlarmStop(callback);
    },
  };
}

async function loadTauriDependencies(): Promise<NativeDependencies> {
  const [notification, autostart, windowApi, eventApi] = await Promise.all([
    import('@tauri-apps/plugin-notification'),
    import('@tauri-apps/plugin-autostart'),
    import('@tauri-apps/api/window'),
    import('@tauri-apps/api/event'),
  ]);

  return {
    isPermissionGranted: notification.isPermissionGranted,
    requestPermission: notification.requestPermission,
    sendNotification: notification.sendNotification,
    onAction: (callback) => notification.onAction(callback),
    onExecutionAlarmStop: async (callback) => {
      const unlisten = await eventApi.listen('life-tracker://stop-execution-alarm', callback);
      return async () => { unlisten(); };
    },
    isAutostartEnabled: autostart.isEnabled,
    enableAutostart: autostart.enable,
    disableAutostart: autostart.disable,
    currentWindow: windowApi.getCurrentWindow,
    browserPermission: () => (
      typeof window.Notification === 'undefined' ? undefined : window.Notification.permission
    ),
  };
}

export const desktopNativeBridge = createDesktopNativeBridge({
  runtime: RUNTIME_TARGET,
  hasTauriInternals: () => (
    typeof window !== 'undefined' && detectTauriDesktop(RUNTIME_TARGET, window)
  ),
  loadDependencies: loadTauriDependencies,
});
