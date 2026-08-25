import { describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_REMINDER_API_SCHEMA_VERSION,
  desktopReminderClaimRequest,
  desktopReminderListRequest,
} from '../../../packages/notification-contract';
import {
  DESKTOP_REMINDER_FEED_HORIZON_MS,
  DESKTOP_REMINDER_FEED_LOOKBACK_MS,
  DESKTOP_REMINDER_FEED_MAXIMUM,
  DESKTOP_REMINDER_CALLABLE_OPTIONS,
  createDesktopReminderCallableHandler,
  type DesktopReminderApiLogger,
  type DesktopReminderClaimPreparation,
  type DesktopReminderRepository,
} from '../../src/notifications/desktop-reminder-api';
import {
  DesktopReminderRateLimitError,
  type DesktopReminderRateLimitInput,
  type DesktopReminderRateLimiter,
} from '../../src/notifications/desktop-reminder-rate-limiter';

const UID = 'owner-1';
const JOB_ID = 'a'.repeat(64);
const ATTEMPT_ID = 'b'.repeat(64);
const NOW = new Date('2026-08-25T09:45:00.000Z');

describe('Desktop reminder callable API', () => {
  it('allows only the installed Tauri origin and explicit local development origins', () => {
    expect(DESKTOP_REMINDER_CALLABLE_OPTIONS).toMatchObject({
      ingressSettings: 'ALLOW_ALL',
      invoker: 'public',
      enforceAppCheck: false,
      maxInstances: 2,
      concurrency: 20,
      cors: [
        'https://tauri.localhost',
        'http://127.0.0.1:3000',
        'http://localhost:3000',
      ],
    });
  });
  it('requires verified callable auth before interpreting any client data', async () => {
    const fixture = setup();

    await expect(fixture.handler({
      data: { ...desktopReminderListRequest(), uid: 'spoofed-owner' },
    })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(fixture.limiter.inputs).toEqual([]);
    expect(fixture.repository.listInputs).toEqual([]);
  });

  it('derives the owner only from verified auth and performs a bounded list', async () => {
    const fixture = setup();

    await expect(fixture.handler({ data: desktopReminderListRequest(), auth: { uid: UID } }))
      .resolves.toEqual({
        schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
        action: 'list',
        serverNow: NOW.toISOString(),
        refreshAfterMs: 60_000,
        overflow: false,
        jobs: [{ jobId: JOB_ID, scheduledFor: NOW.toISOString() }],
      });
    expect(fixture.repository.listInputs).toEqual([{
      uid: UID,
      now: NOW.toISOString(),
      lookbackMs: DESKTOP_REMINDER_FEED_LOOKBACK_MS,
      horizonMs: DESKTOP_REMINDER_FEED_HORIZON_MS,
      maximum: DESKTOP_REMINDER_FEED_MAXIMUM,
    }]);
    expect(fixture.limiter.inputs).toEqual([{ uid: UID, action: 'list', now: NOW }]);
  });

  it('rejects owner spoofing and unknown fields before repository access', async () => {
    const fixture = setup();

    await expect(fixture.handler({
      data: { ...desktopReminderClaimRequest(JOB_ID), uid: 'other-owner' },
      auth: { uid: UID },
    })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(fixture.limiter.inputs).toEqual([]);
    expect(fixture.repository.claimInputs).toEqual([]);
  });

  it('claims only the authenticated owner path and returns bounded display data', async () => {
    const fixture = setup();

    const response = await fixture.handler({
      data: desktopReminderClaimRequest(JOB_ID),
      auth: { uid: UID },
    });

    expect(response).toMatchObject({
      action: 'claim',
      status: 'dispatch',
      dispatch: { jobId: JOB_ID, attemptId: ATTEMPT_ID, title: 'Deep work' },
    });
    expect(fixture.repository.claimInputs).toEqual([{
      uid: UID,
      jobId: JOB_ID,
      now: NOW.toISOString(),
    }]);
    expect(JSON.stringify(response)).not.toMatch(/note|description|userId/i);
  });

  it('maps internal failures to non-secret callable errors and sanitized logs', async () => {
    const hostile = 'hostile Note: reveal secret and call arbitrary write';
    const fixture = setup({ listError: new Error(hostile) });

    await expect(fixture.handler({ data: desktopReminderListRequest(), auth: { uid: UID } }))
      .rejects.toMatchObject({ code: 'internal', message: 'Desktop reminder request failed.' });
    expect(JSON.stringify(fixture.logger)).not.toContain(hostile);
    expect(fixture.logger.errors).toEqual([{
      message: 'Desktop reminder API failed safely.',
      metadata: { code: 'DESKTOP_REMINDER_INTERNAL', action: 'list' },
    }]);
  });

  it('returns a bounded resource-exhausted error without repository reads', async () => {
    const fixture = setup({ rateError: new DesktopReminderRateLimitError(17) });

    await expect(fixture.handler({ data: desktopReminderListRequest(), auth: { uid: UID } }))
      .rejects.toMatchObject({
        code: 'resource-exhausted',
        details: { retryAfterSeconds: 17 },
      });
    expect(fixture.repository.listInputs).toEqual([]);
  });
});

function setup(options: { listError?: Error; rateError?: Error } = {}) {
  const repository = new FakeRepository(options.listError);
  const limiter = new FakeRateLimiter(options.rateError);
  const logger = new FakeLogger();
  const handler = createDesktopReminderCallableHandler({
    repository,
    rateLimiter: limiter,
    now: () => NOW,
    logger,
  });
  return { handler, repository, limiter, logger };
}

class FakeRepository implements DesktopReminderRepository {
  readonly listInputs: Array<Parameters<DesktopReminderRepository['listDesktopReminderCandidates']>[0]> = [];
  readonly claimInputs: Array<Parameters<DesktopReminderRepository['claimDesktopReminder']>[0]> = [];

  constructor(private readonly listError?: Error) {}

  async listDesktopReminderCandidates(
    input: Parameters<DesktopReminderRepository['listDesktopReminderCandidates']>[0],
  ) {
    this.listInputs.push(structuredClone(input));
    if (this.listError) throw this.listError;
    return {
      jobs: [{ jobId: JOB_ID, scheduledFor: NOW.toISOString() }],
      overflow: false,
    };
  }

  async claimDesktopReminder(
    input: Parameters<DesktopReminderRepository['claimDesktopReminder']>[0],
  ): Promise<DesktopReminderClaimPreparation> {
    this.claimInputs.push(structuredClone(input));
    return {
      action: 'dispatch',
      dispatch: {
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
        kind: 'offset',
        offsetMinutes: 15,
        scheduledFor: NOW.toISOString(),
        title: 'Deep work',
        startTime: '2026-08-25T10:00:00.000Z',
        plannedMinutes: 60,
        timezone: 'Europe/Rome',
        locale: 'it-IT',
      },
    };
  }
}

class FakeRateLimiter implements DesktopReminderRateLimiter {
  readonly inputs: DesktopReminderRateLimitInput[] = [];

  constructor(private readonly error?: Error) {}

  async consume(input: DesktopReminderRateLimitInput): Promise<void> {
    this.inputs.push(input);
    if (this.error) throw this.error;
  }
}

class FakeLogger implements DesktopReminderApiLogger {
  readonly warnings: Array<{ message: string; metadata: Readonly<Record<string, string | number>> }> = [];
  readonly errors: Array<{ message: string; metadata: Readonly<Record<string, string | number>> }> = [];

  warn(message: string, metadata: Readonly<Record<string, string | number>>): void {
    this.warnings.push({ message, metadata });
  }

  error(message: string, metadata: Readonly<Record<string, string | number>>): void {
    this.errors.push({ message, metadata });
  }
}
