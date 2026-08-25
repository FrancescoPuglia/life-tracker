import { describe, expect, it, vi } from 'vitest';
import { DESKTOP_REMINDER_API_SCHEMA_VERSION } from '../../../packages/notification-contract';
import { createDesktopReminderApiClient } from './reminderApiClient';

const JOB_ID = 'a'.repeat(64);

describe('Desktop reminder API client', () => {
  it('sends an owner-free exact request and validates the list response', async () => {
    const call = vi.fn(async () => ({
      schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
      action: 'list',
      serverNow: '2026-08-25T09:00:00.000Z',
      refreshAfterMs: 60_000,
      overflow: false,
      jobs: [{ jobId: JOB_ID, scheduledFor: '2026-08-25T09:15:00.000Z' }],
    }));

    await expect(createDesktopReminderApiClient(call).list())
      .resolves.toMatchObject({ action: 'list', jobs: [{ jobId: JOB_ID }] });
    expect(call).toHaveBeenCalledWith({
      schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
      action: 'list',
    });
    expect(JSON.stringify(call.mock.calls)).not.toContain('uid');
  });

  it('rejects a dispatch redirected to a different job identity', async () => {
    const call = vi.fn(async () => ({
      schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
      action: 'claim',
      status: 'dispatch',
      dispatch: {
        jobId: 'b'.repeat(64),
        attemptId: 'c'.repeat(64),
        kind: 'at_start',
        offsetMinutes: 0,
        scheduledFor: '2026-08-25T09:00:00.000Z',
        title: 'Deep work',
        startTime: '2026-08-25T09:00:00.000Z',
        plannedMinutes: 60,
        timezone: 'Europe/Rome',
        locale: 'it-IT',
      },
    }));

    await expect(createDesktopReminderApiClient(call).claim(JOB_ID))
      .rejects.toThrow(/identity/);
  });

  it('fails closed on malformed callable data', async () => {
    const call = vi.fn(async () => ({
      schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
      action: 'claim',
      status: 'dispatch',
      dispatch: { jobId: JOB_ID, arbitraryWrite: true },
    }));

    await expect(createDesktopReminderApiClient(call).claim(JOB_ID))
      .rejects.toThrow(/invalid/);
  });
});
