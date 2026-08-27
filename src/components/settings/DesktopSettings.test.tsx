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
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('applies and persists the global theme without server connectivity', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('radio', { name: /Scuro/i }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('life-tracker.appearance.v1')).toContain('"mode":"dark"');
  });

  it('does not request native notification permission on mount', async () => {
    renderSettings();
    await screen.findByText('DA CONFIGURARE');
    expect(bridge.requestNotificationPermission).not.toHaveBeenCalled();
  });

  it('requests permission only after the user action and enables a safe test', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Abilita notifiche' }));
    await screen.findByText('Notifiche native abilitate.');

    fireEvent.click(screen.getByRole('button', { name: 'Invia notifica di test' }));
    await screen.findByText(/clic apre soltanto Life Tracker/i);
    expect(bridge.sendTestNotification).toHaveBeenCalledTimes(1);
  });

  it('persists and reflects the authoritative autostart state', async () => {
    renderSettings();
    const checkbox = await screen.findByRole('checkbox', { name: /Avvia con Windows/i });
    fireEvent.click(checkbox);
    await waitFor(() => expect(bridge.setAutostart).toHaveBeenCalledWith(true));
    expect(checkbox).toBeChecked();
  });

  it('normalizes native failures and never displays provider details', async () => {
    vi.mocked(bridge.requestNotificationPermission).mockRejectedValueOnce(
      new Error('secret provider detail'),
    );
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Abilita notifiche' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('chiusa in sicurezza');
    expect(alert).not.toHaveTextContent('secret provider detail');
  });

  it('validates and persists an owner-scoped Desktop reminder policy', async () => {
    renderSettings();
    const enabled = await screen.findByRole('checkbox', { name: /Avvisi Desktop pianificati/i });
    await waitFor(() => expect(enabled).not.toBeDisabled());
    fireEvent.click(enabled);
    fireEvent.change(screen.getByLabelText('Reminder offsets'), { target: { value: '60, 15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva avvisi e review' }));

    await screen.findByText(/Preferenze di avvisi e review salvate/);
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
    fireEvent.click(screen.getByRole('button', { name: 'Salva avvisi e review' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('non sono valide o disponibili');
    expect(preferencesStore.save).not.toHaveBeenCalled();
  });

  it('persists a validated recipient and configurable Daily/Weekly schedules', async () => {
    renderSettings();
    const emailEnabled = await screen.findByRole('checkbox', { name: 'Abilita invio email' });
    await waitFor(() => expect(emailEnabled).not.toBeDisabled());
    fireEvent.click(emailEnabled);
    fireEvent.change(screen.getByLabelText('Report recipient'), {
      target: { value: 'francesco@example.com' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Review giornaliera' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Weekly Executive Review' }));
    fireEvent.change(screen.getByLabelText('Daily Report time'), { target: { value: '21:45' } });
    fireEvent.change(screen.getByLabelText('Weekly Report day'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Weekly Report time'), { target: { value: '19:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva avvisi e review' }));

    await screen.findByText(/Preferenze di avvisi e review salvate/);
    expect(preferencesStore.save).toHaveBeenCalledWith('owner-1', expect.objectContaining({
      emailEnabled: true,
      reportRecipient: 'francesco@example.com',
      dailyReport: { enabled: true, localTime: '21:45' },
      weeklyReport: { enabled: true, isoWeekday: 6, localTime: '19:15' },
    }));
  });

  it('does not persist enabled email reports without a recipient', async () => {
    renderSettings();
    const emailEnabled = await screen.findByRole('checkbox', { name: 'Abilita invio email' });
    await waitFor(() => expect(emailEnabled).not.toBeDisabled());
    fireEvent.click(emailEnabled);
    fireEvent.click(screen.getByRole('button', { name: 'Salva avvisi e review' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('non sono valide o disponibili');
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
