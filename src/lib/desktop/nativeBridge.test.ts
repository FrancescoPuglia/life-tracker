import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDesktopNativeBridge,
  detectTauriDesktop,
} from './nativeBridge';

describe('Desktop native bridge', () => {
  const dependencies = {
    isPermissionGranted: vi.fn(async () => false),
    requestPermission: vi.fn(async () => 'granted' as NotificationPermission),
    sendNotification: vi.fn(),
    onAction: vi.fn(),
    isAutostartEnabled: vi.fn(async () => false),
    enableAutostart: vi.fn(async () => undefined),
    disableAutostart: vi.fn(async () => undefined),
    currentWindow: vi.fn(),
    browserPermission: vi.fn(() => 'default' as NotificationPermission),
  };
  const appWindow = {
    isMinimized: vi.fn(async () => true),
    isVisible: vi.fn(async () => false),
    unminimize: vi.fn(async () => undefined),
    show: vi.fn(async () => undefined),
    setFocus: vi.fn(async () => undefined),
  };
  const unregister = vi.fn(async () => undefined);
  let actionCallback: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.isPermissionGranted.mockResolvedValue(false);
    dependencies.isAutostartEnabled.mockResolvedValue(false);
    dependencies.browserPermission.mockReturnValue('default');
    dependencies.currentWindow.mockReturnValue(appWindow);
    dependencies.onAction.mockImplementation(async (callback: () => void) => {
      actionCallback = callback;
      return { unregister };
    });
    actionCallback = undefined;
  });

  it('requires both a Desktop build and the private Tauri runtime marker', () => {
    expect(detectTauriDesktop('desktop', { __TAURI_INTERNALS__: {} })).toBe(true);
    expect(detectTauriDesktop('web', { __TAURI_INTERNALS__: {} })).toBe(false);
    expect(detectTauriDesktop('desktop', {})).toBe(false);
    expect(detectTauriDesktop('desktop', null)).toBe(false);
  });

  it('returns an unavailable status without importing or invoking native APIs', async () => {
    const loadDependencies = vi.fn(async () => dependencies);
    const bridge = createDesktopNativeBridge({
      runtime: 'web',
      hasTauriInternals: () => true,
      loadDependencies,
    });

    await expect(bridge.readStatus()).resolves.toEqual({
      available: false,
      notificationPermission: 'unavailable',
      autostartEnabled: null,
    });
    expect(loadDependencies).not.toHaveBeenCalled();
  });

  it('requests permission only through an explicit call and sends no domain mutation', async () => {
    const bridge = availableBridge();
    await expect(bridge.readStatus()).resolves.toMatchObject({
      notificationPermission: 'prompt',
      autostartEnabled: false,
    });
    expect(dependencies.requestPermission).not.toHaveBeenCalled();

    await expect(bridge.requestNotificationPermission()).resolves.toBe('granted');
    dependencies.isPermissionGranted.mockResolvedValue(true);
    await bridge.sendTestNotification();

    expect(dependencies.requestPermission).toHaveBeenCalledTimes(1);
    expect(dependencies.sendNotification).toHaveBeenCalledWith({
      title: 'Life Tracker',
      body: expect.stringContaining('notifications are ready'),
      autoCancel: true,
      extra: { kind: 'settings-test' },
    });
  });

  it('fails closed when a notification is attempted without permission', async () => {
    await expect(availableBridge().sendTestNotification()).rejects.toThrow(
      'permission is not granted',
    );
    expect(dependencies.sendNotification).not.toHaveBeenCalled();
  });

  it('sends only a bounded display reminder and exposes no completion action', async () => {
    dependencies.isPermissionGranted.mockResolvedValue(true);
    const jobId = 'a'.repeat(64);
    const attemptId = 'b'.repeat(64);

    await availableBridge().sendReminderNotification({
      jobId,
      attemptId,
      body: 'Deep work starts in 15 min at 10:00. Planned: 60 min.',
    });

    expect(dependencies.sendNotification).toHaveBeenCalledWith({
      title: 'Life Tracker reminder',
      body: expect.stringContaining('Deep work'),
      autoCancel: true,
      extra: { kind: 'reminder', jobId, attemptId },
    });
    expect(JSON.stringify(dependencies.sendNotification.mock.calls)).not.toMatch(/complete|done/i);
  });

  it('rejects malformed native reminder identity or control characters', async () => {
    dependencies.isPermissionGranted.mockResolvedValue(true);
    await expect(availableBridge().sendReminderNotification({
      jobId: '../other',
      attemptId: 'b'.repeat(64),
      body: 'hostile\u0000body',
    })).rejects.toThrow(/invalid/);
    expect(dependencies.sendNotification).not.toHaveBeenCalled();
  });

  it('rereads the authoritative autostart state after changing it', async () => {
    dependencies.isAutostartEnabled
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const bridge = availableBridge();

    await expect(bridge.setAutostart(true)).resolves.toBe(true);
    await expect(bridge.setAutostart(false)).resolves.toBe(false);
    expect(dependencies.enableAutostart).toHaveBeenCalledTimes(1);
    expect(dependencies.disableAutostart).toHaveBeenCalledTimes(1);
  });

  it('notification interaction only restores and focuses the app window', async () => {
    const bridge = availableBridge();
    const unsubscribe = await bridge.subscribeToNotificationClicks();
    expect(actionCallback).toBeTypeOf('function');

    actionCallback?.();
    await vi.waitFor(() => expect(appWindow.setFocus).toHaveBeenCalledTimes(1));
    expect(appWindow.unminimize).toHaveBeenCalledTimes(1);
    expect(appWindow.show).toHaveBeenCalledTimes(1);

    await unsubscribe();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  function availableBridge() {
    return createDesktopNativeBridge({
      runtime: 'desktop',
      hasTauriInternals: () => true,
      loadDependencies: async () => dependencies,
    });
  }
});
