import { describe, expect, it, vi } from 'vitest';
import { DESKTOP_REMINDER_API_SCHEMA_VERSION } from '../../../packages/notification-contract';
import type { DesktopNativeBridge } from './nativeBridge';
import type { DesktopReminderApiClient } from './reminderApiClient';
import {
  DesktopReminderCoordinator,
  formatDesktopReminderBody,
} from './reminderCoordinator';
import type {
  DesktopReminderConsumption,
  DesktopReminderLocalStore,
} from './reminderLocalStore';

const UID = 'owner-1';
const JOB_ID = 'a'.repeat(64);
const ATTEMPT_ID = 'b'.repeat(64);
const SERVER_NOW = '2026-08-25T09:45:00.000Z';

describe('Desktop reminder coordinator', () => {
  it('does not request permission or call the backend while permission is denied', async () => {
    const fixture = setup({ permission: 'denied' });
    fixture.coordinator.start();
    await flush();

    expect(fixture.bridge.requestNotificationPermission).not.toHaveBeenCalled();
    expect(fixture.api.list).not.toHaveBeenCalled();
    expect(fixture.scheduler.delay).toBe(60_000);
  });

  it('fails closed offline without consuming or displaying a reminder', async () => {
    const fixture = setup({ online: false });
    fixture.coordinator.start();
    await flush();

    expect(fixture.api.list).not.toHaveBeenCalled();
    expect(fixture.api.claim).not.toHaveBeenCalled();
    expect(fixture.bridge.sendReminderNotification).not.toHaveBeenCalled();
  });

  it('keeps tracking usable when the authenticated backend is unavailable', async () => {
    const fixture = setup();
    fixture.api.list.mockRejectedValue(new Error('expired auth or backend unavailable'));
    fixture.coordinator.start();
    await flush();

    expect(fixture.api.claim).not.toHaveBeenCalled();
    expect(fixture.bridge.sendReminderNotification).not.toHaveBeenCalled();
    expect(fixture.scheduler.delay).toBe(60_000);
  });

  it('uses server time to wake for a future reminder', async () => {
    const fixture = setup({
      jobs: [{ jobId: JOB_ID, scheduledFor: '2026-08-25T09:45:30.000Z' }],
    });
    fixture.coordinator.start();
    await flush();

    expect(fixture.api.claim).not.toHaveBeenCalled();
    expect(fixture.scheduler.delay).toBe(30_000);
  });

  it('claims authority before native display and persists consumption first', async () => {
    const fixture = setup({ jobs: [{ jobId: JOB_ID, scheduledFor: SERVER_NOW }] });
    fixture.bridge.sendReminderNotification.mockImplementation(async () => {
      expect(fixture.store.has(UID, JOB_ID)).toBe(true);
    });
    fixture.coordinator.start();
    await flush();

    expect(fixture.api.claim).toHaveBeenCalledWith(JOB_ID);
    expect(fixture.bridge.sendReminderNotification).toHaveBeenCalledWith({
      jobId: JOB_ID,
      attemptId: ATTEMPT_ID,
      body: 'Deep work begins at 12:00. Planned: 60 min.',
    });
  });

  it('never reclaims a locally consumed job after restart', async () => {
    const fixture = setup({ jobs: [{ jobId: JOB_ID, scheduledFor: SERVER_NOW }] });
    fixture.store.mark({
      uid: UID,
      jobId: JOB_ID,
      attemptId: ATTEMPT_ID,
      consumedAt: SERVER_NOW,
    });
    fixture.coordinator.start();
    await flush();

    expect(fixture.api.claim).not.toHaveBeenCalled();
    expect(fixture.bridge.sendReminderNotification).not.toHaveBeenCalled();
  });

  it('does not retry an ambiguous native failure after durable consumption', async () => {
    const fixture = setup({ jobs: [{ jobId: JOB_ID, scheduledFor: SERVER_NOW }] });
    fixture.bridge.sendReminderNotification.mockRejectedValue(new Error('native edge failed'));
    fixture.coordinator.start();
    await flush();
    expect(fixture.store.has(UID, JOB_ID)).toBe(true);

    fixture.scheduler.fire();
    await flush();
    expect(fixture.api.claim).toHaveBeenCalledTimes(1);
    expect(fixture.bridge.sendReminderNotification).toHaveBeenCalledTimes(1);
  });

  it('describes missed starts as Session actions and never as completion', () => {
    const body = formatDesktopReminderBody({
      ...dispatch(),
      kind: 'missed_start',
      offsetMinutes: -10,
    });
    expect(body).toContain('start a Session');
    expect(body).not.toMatch(/done|complete/i);
  });
});

function setup(options: {
  permission?: 'granted' | 'denied' | 'prompt';
  online?: boolean;
  jobs?: ReadonlyArray<{ jobId: string; scheduledFor: string }>;
} = {}) {
  const store = new MemoryLocalStore();
  const api: { list: ReturnType<typeof vi.fn>; claim: ReturnType<typeof vi.fn> } = {
    list: vi.fn(async () => ({
      schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
      action: 'list' as const,
      serverNow: SERVER_NOW,
      refreshAfterMs: 60_000,
      overflow: false,
      jobs: options.jobs ?? [],
    })),
    claim: vi.fn(async () => ({
      schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
      action: 'claim' as const,
      status: 'dispatch' as const,
      dispatch: dispatch(),
    })),
  };
  const bridge: DesktopNativeBridge & {
    requestNotificationPermission: ReturnType<typeof vi.fn>;
    sendReminderNotification: ReturnType<typeof vi.fn>;
  } = {
    isAvailable: () => true,
    readStatus: vi.fn(async () => ({
      available: true,
      notificationPermission: options.permission ?? 'granted',
      autostartEnabled: false,
    })),
    requestNotificationPermission: vi.fn(async () => 'granted' as const),
    sendTestNotification: vi.fn(async () => undefined),
    sendReminderNotification: vi.fn(async () => undefined),
    setAutostart: vi.fn(async () => false),
    focusWindow: vi.fn(async () => undefined),
    subscribeToNotificationClicks: vi.fn(async () => async () => undefined),
  };
  const scheduler = new ManualScheduler();
  const coordinator = new DesktopReminderCoordinator({
    uid: UID,
    api: api as unknown as DesktopReminderApiClient,
    bridge,
    localStore: store,
    isOnline: () => options.online ?? true,
    setTimer: scheduler.set,
    clearTimer: scheduler.clear,
  });
  return { coordinator, api, bridge, store, scheduler };
}

function dispatch() {
  return {
    jobId: JOB_ID,
    attemptId: ATTEMPT_ID,
    kind: 'offset' as const,
    offsetMinutes: 15,
    scheduledFor: SERVER_NOW,
    title: 'Deep work',
    startTime: '2026-08-25T10:00:00.000Z',
    plannedMinutes: 60,
    timezone: 'Europe/Rome',
    locale: 'it-IT',
  };
}

class MemoryLocalStore implements DesktopReminderLocalStore {
  private readonly keys = new Set<string>();

  has(uid: string, jobId: string): boolean {
    return this.keys.has(`${uid}:${jobId}`);
  }

  mark(record: DesktopReminderConsumption): void {
    this.keys.add(`${record.uid}:${record.jobId}`);
  }
}

class ManualScheduler {
  callback: (() => void) | null = null;
  delay: number | null = null;
  readonly set = (callback: () => void, delay: number) => {
    this.callback = callback;
    this.delay = delay;
    return 1 as unknown as ReturnType<typeof setTimeout>;
  };
  readonly clear = () => {
    this.callback = null;
    this.delay = null;
  };

  fire(): void {
    const callback = this.callback;
    this.callback = null;
    this.delay = null;
    callback?.();
  }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}
