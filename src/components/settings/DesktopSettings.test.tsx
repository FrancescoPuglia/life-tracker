import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DesktopNativeBridge,
  DesktopNativeStatus,
  DesktopNotificationPermission,
} from '@/lib/desktop/nativeBridge';
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
    setAutostart: vi.fn(async (enabled) => enabled),
    focusWindow: vi.fn(async () => undefined),
    subscribeToNotificationClicks: vi.fn(async () => async () => undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not request native notification permission on mount', async () => {
    render(<DesktopSettings bridge={bridge} />);
    await screen.findByText('prompt');
    expect(bridge.requestNotificationPermission).not.toHaveBeenCalled();
  });

  it('requests permission only after the user action and enables a safe test', async () => {
    render(<DesktopSettings bridge={bridge} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enable native notifications' }));
    await screen.findByText('Native notifications are enabled.');

    fireEvent.click(screen.getByRole('button', { name: 'Send test notification' }));
    await screen.findByText(/clicking it only opens and focuses/i);
    expect(bridge.sendTestNotification).toHaveBeenCalledTimes(1);
  });

  it('persists and reflects the authoritative autostart state', async () => {
    render(<DesktopSettings bridge={bridge} />);
    const checkbox = await screen.findByRole('checkbox', { name: /Start with Windows/i });
    fireEvent.click(checkbox);
    await waitFor(() => expect(bridge.setAutostart).toHaveBeenCalledWith(true));
    expect(checkbox).toBeChecked();
  });

  it('normalizes native failures and never displays provider details', async () => {
    vi.mocked(bridge.requestNotificationPermission).mockRejectedValueOnce(
      new Error('secret provider detail'),
    );
    render(<DesktopSettings bridge={bridge} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enable native notifications' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('failed safely');
    expect(alert).not.toHaveTextContent('secret provider detail');
  });
});
