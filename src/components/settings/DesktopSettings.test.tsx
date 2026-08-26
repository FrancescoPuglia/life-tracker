import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DesktopNativeBridge,
  DesktopNativeStatus,
  DesktopNotificationPermission,
} from '@/lib/desktop/nativeBridge';
import { defaultNotificationPreferences } from '@/lib/notifications/preferences';
import type { NotificationPreferencesStore } from '@/lib/notifications/preferences';
import DesktopSettings from './DesktopSettings';

describe('Desktop settings', () => {
  const bridge: DesktopNativeBridge = {
    isAvailable: vi.fn(() => true),
    readStatus: vi.fn(async (): Promise<DesktopNativeStatus> => ({
      available: true,
      notificationPermission: 'prompt',
      autostartEnabled: false,
    })),
    requestNotificationPermission: vi.fn(
      async (): Promise<DesktopNotificationPermission> => 'granted',
    ),
    sendTestNotification: vi.fn(async () => undefined),
    sendReminderNotification: vi.fn(async () => undefined),
    setAutostart: vi.fn(async (enabled) => enabled),
    focusWindow: vi.fn(async () => undefined),
    subscribeToNotificationClicks: vi.fn(async () => async () => undefined),
    subscribeToExecutionAlarmStops: vi.fn(async () => async () => undefined),
  };
  const preferencesStore: NotificationPreferencesStore = {
    load: vi.fn(async () => defaultNotificationPreferences()),
    save: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not request native notification permission on mount', async () => {
    renderSettings();
    await screen.findByText('prompt');
    expect(bridge.requestNotificationPermission).not.toHaveBeenCalled();
  });

  it('requests permission only after the user action and enables a safe test', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Enable native notifications' }));
    await screen.findByText('Native notifications are enabled.');

    fireEvent.click(screen.getByRole('button', { name: 'Send test notification' }));
    await screen.findByText(/clicking it only opens and focuses/i);
    expect(bridge.sendTestNotification).toHaveBeenCalledTimes(1);
  });

  it('persists and reflects the authoritative autostart state', async () => {
    renderSettings();
    const checkbox = await screen.findByRole('checkbox', { name: /Start with Windows/i });
    fireEvent.click(checkbox);
    await waitFor(() => expect(bridge.setAutostart).toHaveBeenCalledWith(true));
    expect(checkbox).toBeChecked();
  });

  it('normalizes native failures and never displays provider details', async () => {
    vi.mocked(bridge.requestNotificationPermission).mockRejectedValueOnce(
      new Error('secret provider detail'),
    );
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Enable native notifications' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('failed safely');
    expect(alert).not.toHaveTextContent('secret provider detail');
  });

  it('validates and persists an owner-scoped Desktop reminder policy', async () => {
    renderSettings();
    const enabled = await screen.findByRole('checkbox', { name: /Scheduled Desktop reminders/i });
    await waitFor(() => expect(enabled).not.toBeDisabled());
    fireEvent.click(enabled);
    fireEvent.change(screen.getByLabelText('Reminder offsets'), { target: { value: '60, 15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save notification preferences' }));

    await screen.findByText(/Notification and report preferences saved/);
    expect(preferencesStore.save).toHaveBeenCalledWith('owner-1', expect.objectContaining({
      desktopEnabled: true,
      reminderOffsetsMinutes: [60, 15],
      whatsappEnabled: false,
      emailEnabled: false,
    }));
  });

  it('rejects malformed reminder input without a Firestore write', async () => {
    renderSettings();
    const offsets = await screen.findByLabelText('Reminder offsets');
    await waitFor(() => expect(offsets).not.toBeDisabled());
    fireEvent.change(offsets, { target: { value: '15, arbitrary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save notification preferences' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or unavailable');
    expect(preferencesStore.save).not.toHaveBeenCalled();
  });

  it('persists a validated recipient and configurable Daily/Weekly schedules', async () => {
    renderSettings();
    const emailEnabled = await screen.findByRole('checkbox', { name: 'Enable email reports' });
    await waitFor(() => expect(emailEnabled).not.toBeDisabled());
    fireEvent.click(emailEnabled);
    fireEvent.change(screen.getByLabelText('Report recipient'), {
      target: { value: 'francesco@example.com' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Daily Report' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Weekly Report' }));
    fireEvent.change(screen.getByLabelText('Daily Report time'), { target: { value: '21:45' } });
    fireEvent.change(screen.getByLabelText('Weekly Report day'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Weekly Report time'), { target: { value: '19:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save notification preferences' }));

    await screen.findByText(/Notification and report preferences saved/);
    expect(preferencesStore.save).toHaveBeenCalledWith('owner-1', expect.objectContaining({
      emailEnabled: true,
      reportRecipient: 'francesco@example.com',
      dailyReport: { enabled: true, localTime: '21:45' },
      weeklyReport: { enabled: true, isoWeekday: 6, localTime: '19:15' },
    }));
  });

  it('does not persist enabled email reports without a recipient', async () => {
    renderSettings();
    const emailEnabled = await screen.findByRole('checkbox', { name: 'Enable email reports' });
    await waitFor(() => expect(emailEnabled).not.toBeDisabled());
    fireEvent.click(emailEnabled);
    fireEvent.click(screen.getByRole('button', { name: 'Save notification preferences' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or unavailable');
    expect(preferencesStore.save).not.toHaveBeenCalled();
  });

  function renderSettings() {
    return render(
      <DesktopSettings
        userId="owner-1"
        bridge={bridge}
        preferencesStore={preferencesStore}
      />,
    );
  }
});
