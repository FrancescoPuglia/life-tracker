import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DesktopReminderRuntime from './DesktopReminderRuntime';

const mocks = vi.hoisted(() => ({
  available: true,
  start: vi.fn(),
  stop: vi.fn(),
  refreshNow: vi.fn(),
  unsubscribe: vi.fn(async () => undefined),
  subscribe: vi.fn(),
  subscribeAlarm: vi.fn(),
  unsubscribeAlarm: vi.fn(async () => undefined),
  getApi: vi.fn(() => ({ list: vi.fn(), claim: vi.fn() })),
  getStore: vi.fn(() => ({ has: vi.fn(), mark: vi.fn() })),
  construct: vi.fn(),
  resolveContext: vi.fn(() => ({
    timeBlockId: null,
    taskId: null,
    goalTitle: null,
    projectTitle: null,
    priority: null,
  })),
  shouldDispatch: vi.fn(() => true),
  presentation: vi.fn(() => null),
  signal: vi.fn(),
}));

vi.mock('@/providers/DataProvider', () => ({
  useDataContext: () => ({ timeBlocks: [], tasks: [], projects: [], goals: [] }),
}));

vi.mock('@/lib/desktop/nativeBridge', () => ({
  desktopNativeBridge: {
    isAvailable: () => mocks.available,
    subscribeToNotificationClicks: mocks.subscribe,
    subscribeToExecutionAlarmStops: mocks.subscribeAlarm,
  },
}));

vi.mock('@/lib/desktop/executionAlarm', () => ({
  EXECUTION_ALARM_STOP_EVENT: 'life-tracker:execution-alarm-stop',
  dispatchExecutionAlarmSignal: mocks.signal,
  executionAlarmPreferencesStore: { load: vi.fn(() => ({ mode: 'normal' })) },
  executionAlarmPresentation: mocks.presentation,
  resolveExecutionAlarmContext: mocks.resolveContext,
  shouldDispatchExecutionAlarm: mocks.shouldDispatch,
}));

vi.mock('@/lib/desktop/reminderApiClient', () => ({
  getDesktopReminderApiClient: mocks.getApi,
}));

vi.mock('@/lib/desktop/reminderLocalStore', () => ({
  browserDesktopReminderLocalStore: mocks.getStore,
}));

vi.mock('@/lib/desktop/reminderCoordinator', () => ({
  DESKTOP_REMINDER_REFRESH_EVENT: 'life-tracker:desktop-reminders-refresh',
  DesktopReminderCoordinator: class {
    constructor(input: unknown) {
      mocks.construct(input);
    }
    start = mocks.start;
    stop = mocks.stop;
    refreshNow = mocks.refreshNow;
  },
}));

describe('Desktop reminder runtime glue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.available = true;
    mocks.subscribe.mockResolvedValue(mocks.unsubscribe);
    mocks.subscribeAlarm.mockResolvedValue(mocks.unsubscribeAlarm);
  });

  it('starts only in Tauri and refreshes on online and policy events', async () => {
    const view = render(<DesktopReminderRuntime uid="owner-1" />);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.construct).toHaveBeenCalledWith(expect.objectContaining({ uid: 'owner-1' }));

    act(() => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('life-tracker:desktop-reminders-refresh'));
    });
    expect(mocks.refreshNow).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.subscribeAlarm).toHaveBeenCalledTimes(1));

    view.unmount();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.unsubscribe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.unsubscribeAlarm).toHaveBeenCalledTimes(1));
  });

  it('does not construct a callable client in the Web runtime', () => {
    mocks.available = false;
    render(<DesktopReminderRuntime uid="owner-1" />);

    expect(mocks.construct).not.toHaveBeenCalled();
    expect(mocks.getApi).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.subscribeAlarm).not.toHaveBeenCalled();
  });
});
