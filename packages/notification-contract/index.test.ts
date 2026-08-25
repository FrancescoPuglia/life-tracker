import { describe, expect, it } from 'vitest';
import {
  DESKTOP_REMINDER_API_SCHEMA_VERSION,
  desktopReminderClaimRequest,
  desktopReminderListRequest,
  parseDesktopReminderApiRequest,
  parseDesktopReminderApiResponse,
} from './index';

const JOB_ID = 'a'.repeat(64);
const ATTEMPT_ID = 'b'.repeat(64);

describe('Desktop reminder shared contract', () => {
  it('creates and parses exact list and owner-free claim requests', () => {
    expect(parseDesktopReminderApiRequest(desktopReminderListRequest()))
      .toEqual(desktopReminderListRequest());
    expect(parseDesktopReminderApiRequest(desktopReminderClaimRequest(JOB_ID)))
      .toEqual(desktopReminderClaimRequest(JOB_ID));
    expect(() => parseDesktopReminderApiRequest({
      ...desktopReminderClaimRequest(JOB_ID),
      uid: 'spoofed-owner',
    })).toThrow(/invalid/);
  });

  it('parses a bounded list and rejects duplicates or unknown fields', () => {
    const response = {
      schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
      action: 'list',
      serverNow: '2026-08-25T09:00:00.000Z',
      refreshAfterMs: 60_000,
      overflow: false,
      jobs: [{ jobId: JOB_ID, scheduledFor: '2026-08-25T09:15:00.000Z' }],
    };
    expect(parseDesktopReminderApiResponse(response)).toEqual(response);
    expect(() => parseDesktopReminderApiResponse({
      ...response,
      jobs: [...response.jobs, ...response.jobs],
    })).toThrow(/identities/);
    expect(() => parseDesktopReminderApiResponse({ ...response, redirect: 'https://attacker' }))
      .toThrow(/invalid/);
  });

  it('parses only a safe normalized native dispatch shape', () => {
    const response = dispatchResponse();
    expect(parseDesktopReminderApiResponse(response)).toEqual(response);
    expect(() => parseDesktopReminderApiResponse({
      ...response,
      dispatch: { ...response.dispatch, taskStatus: 'completed' },
    })).toThrow(/invalid/);
    expect(() => parseDesktopReminderApiResponse({
      ...response,
      dispatch: { ...response.dispatch, kind: 'at_start', offsetMinutes: 15 },
    })).toThrow(/kind and offset/);
  });

  it('rejects oversized or malformed server data before native display', () => {
    const response = dispatchResponse();
    expect(() => parseDesktopReminderApiResponse({
      ...response,
      dispatch: { ...response.dispatch, title: 'x'.repeat(161) },
    })).toThrow(/title/);
    expect(() => parseDesktopReminderApiResponse({
      ...response,
      dispatch: { ...response.dispatch, timezone: 'Not/AZone' },
    })).toThrow(/timezone/);
  });
});

function dispatchResponse() {
  return {
    schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
    action: 'claim' as const,
    status: 'dispatch' as const,
    dispatch: {
      jobId: JOB_ID,
      attemptId: ATTEMPT_ID,
      kind: 'offset' as const,
      offsetMinutes: 15,
      scheduledFor: '2026-08-25T09:45:00.000Z',
      title: 'Deep work',
      startTime: '2026-08-25T10:00:00.000Z',
      plannedMinutes: 60,
      timezone: 'Europe/Rome',
      locale: 'it-IT',
    },
  };
}
