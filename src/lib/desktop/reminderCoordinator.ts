import type { DesktopReminderDispatch } from '../../../packages/notification-contract';
import type { DesktopNativeBridge } from './nativeBridge';
import type { DesktopReminderApiClient } from './reminderApiClient';
import type { DesktopReminderLocalStore } from './reminderLocalStore';

const MINIMUM_TIMER_MS = 250;
const FALLBACK_REFRESH_MS = 60_000;
const DUE_TOLERANCE_MS = 1_000;
export const DESKTOP_REMINDER_REFRESH_EVENT =
  'life-tracker:desktop-reminders-refresh' as const;

export interface DesktopReminderCoordinatorLogger {
  warn(message: string): void;
}

export interface DesktopReminderCoordinatorDependencies {
  readonly uid: string;
  readonly api: DesktopReminderApiClient;
  readonly bridge: DesktopNativeBridge;
  readonly localStore: DesktopReminderLocalStore;
  readonly isOnline?: () => boolean;
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  readonly logger?: DesktopReminderCoordinatorLogger;
}

export class DesktopReminderCoordinator {
  private readonly isOnline: () => boolean;
  private readonly setTimer: NonNullable<DesktopReminderCoordinatorDependencies['setTimer']>;
  private readonly clearTimer: NonNullable<DesktopReminderCoordinatorDependencies['clearTimer']>;
  private readonly logger: DesktopReminderCoordinatorLogger;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private running: Promise<void> | null = null;
  private rerunRequested = false;

  constructor(private readonly dependencies: DesktopReminderCoordinatorDependencies) {
    assertUid(dependencies.uid);
    this.isOnline = dependencies.isOnline ?? (() => (
      typeof navigator === 'undefined' || navigator.onLine
    ));
    this.setTimer = dependencies.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = dependencies.clearTimer ?? ((timer) => clearTimeout(timer));
    this.logger = dependencies.logger ?? { warn: () => undefined };
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.refreshNow();
  }

  stop(): void {
    this.active = false;
    this.rerunRequested = false;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  refreshNow(): void {
    if (!this.active) return;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.running) {
      this.rerunRequested = true;
      return;
    }
    this.running = this.runOnce()
      .catch(() => {
        this.logger.warn('Desktop reminder refresh failed safely.');
        this.schedule(FALLBACK_REFRESH_MS);
      })
      .finally(() => {
        this.running = null;
        if (this.active && this.rerunRequested) {
          this.rerunRequested = false;
          this.refreshNow();
        }
      });
  }

  private async runOnce(): Promise<void> {
    if (!this.active) return;
    if (!this.dependencies.bridge.isAvailable() || !this.isOnline()) {
      this.schedule(FALLBACK_REFRESH_MS);
      return;
    }
    const status = await this.dependencies.bridge.readStatus();
    if (!this.active) return;
    if (!status.available || status.notificationPermission !== 'granted') {
      this.schedule(FALLBACK_REFRESH_MS);
      return;
    }

    const feed = await this.dependencies.api.list();
    if (!this.active) return;
    const serverNowMs = Date.parse(feed.serverNow);
    let nextDelay = feed.overflow
      ? Math.min(feed.refreshAfterMs, 5_000)
      : feed.refreshAfterMs;

    for (const candidate of feed.jobs) {
      if (!this.active) return;
      if (this.dependencies.localStore.has(this.dependencies.uid, candidate.jobId)) continue;
      const untilDue = Date.parse(candidate.scheduledFor) - serverNowMs;
      if (untilDue > DUE_TOLERANCE_MS) {
        nextDelay = Math.min(nextDelay, untilDue);
        continue;
      }
      const result = await this.dependencies.api.claim(candidate.jobId);
      if (!this.active) return;
      if (result.status === 'not_ready') {
        nextDelay = Math.min(
          nextDelay,
          Math.max(MINIMUM_TIMER_MS, Date.parse(result.notBefore) - serverNowMs),
        );
        continue;
      }
      if (result.status !== 'dispatch') continue;

      // Persist before invoking the native edge. A crash can lose one reminder,
      // but neither a restart nor an ambiguous native call can duplicate it.
      this.dependencies.localStore.mark({
        uid: this.dependencies.uid,
        jobId: result.dispatch.jobId,
        attemptId: result.dispatch.attemptId,
        consumedAt: feed.serverNow,
      });
      try {
        await this.dependencies.bridge.sendReminderNotification({
          jobId: result.dispatch.jobId,
          attemptId: result.dispatch.attemptId,
          body: formatDesktopReminderBody(result.dispatch),
        });
      } catch {
        this.logger.warn('Desktop reminder native dispatch failed after durable consumption.');
      }
    }
    this.schedule(nextDelay);
  }

  private schedule(delayMs: number): void {
    if (!this.active || this.timer !== null) return;
    const bounded = Math.max(
      MINIMUM_TIMER_MS,
      Math.min(Number.isFinite(delayMs) ? delayMs : FALLBACK_REFRESH_MS, FALLBACK_REFRESH_MS),
    );
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.refreshNow();
    }, bounded);
  }
}

export function formatDesktopReminderBody(dispatch: DesktopReminderDispatch): string {
  const start = new Intl.DateTimeFormat(dispatch.locale, {
    timeZone: dispatch.timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dispatch.startTime));
  if (dispatch.kind === 'offset') {
    return `${dispatch.title} begins at ${start}. Planned: ${dispatch.plannedMinutes} min.`;
  }
  if (dispatch.kind === 'at_start') {
    return `${dispatch.title} begins at ${start}. Planned: ${dispatch.plannedMinutes} min.`;
  }
  return `${dispatch.title} was scheduled for ${start}. If you begin, start a Session in Life Tracker.`;
}

function assertUid(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error('Desktop reminder owner identity is invalid.');
  }
}
