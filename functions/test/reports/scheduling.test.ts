import { describe, expect, it } from 'vitest';
import { normalizeNotificationPreferences } from '../../src/notifications/domain';
import {
  authorizeScientificReportScheduleCandidate,
  deriveScientificReportSchedulePolicy,
  planDueScientificReportRuns,
  reportScheduleVersion,
  type ScientificReportSchedulePolicy,
} from '../../src/reports/scheduling';

const UID = 'owner-1';

describe('scientific report schedule policy', () => {
  it('is opt-in and requires validated recipient authority', () => {
    const defaults = policy({});
    expect(planDueScientificReportRuns(defaults, '2026-08-25T21:00:00.000Z')).toEqual([]);

    const malformed = policy({
      emailEnabled: true,
      reportRecipient: 'invalid\nrecipient@example.com',
      dailyReport: { enabled: true, localTime: '22:30' },
    });
    expect(malformed).toMatchObject({
      emailEnabled: false,
      recipient: null,
      dailyReport: { enabled: false },
    });
    expect(planDueScientificReportRuns(malformed, '2026-08-25T21:00:00.000Z')).toEqual([]);
  });

  it('permits a preconfigured recipient while delivery is disabled', () => {
    const disabled = policy({ reportRecipient: 'francesco@example.com' });
    expect(disabled).toMatchObject({ emailEnabled: false });
    expect(planDueScientificReportRuns(disabled, '2026-08-25T21:00:00.000Z')).toEqual([]);
  });

  it('rejects forged policy owners and invalid scheduler instants', () => {
    const enabled = dailyPolicy();
    expect(() => planDueScientificReportRuns(
      { ...enabled, uid: 'forged/owner' } as ScientificReportSchedulePolicy,
      '2026-08-25T21:00:00.000Z',
    )).toThrow(/owner/i);
    expect(() => planDueScientificReportRuns(enabled, 'not-an-instant')).toThrow(/instant/i);
  });

  it('distinguishes disabled, recipient-stale, schedule-stale, and forged candidates', () => {
    const candidate = planDueScientificReportRuns(
      dailyPolicy(),
      '2026-08-25T21:00:00.000Z',
    )[0]!;
    expect(authorizeScientificReportScheduleCandidate(dailyPolicy(), candidate).action)
      .toBe('allow');
    expect(authorizeScientificReportScheduleCandidate(
      policy({ reportRecipient: 'francesco@example.com' }),
      candidate,
    )).toEqual({ action: 'suppress', reason: 'email_disabled' });
    expect(authorizeScientificReportScheduleCandidate(policy({
      emailEnabled: true,
      reportRecipient: 'other@example.com',
      dailyReport: { enabled: true, localTime: '22:30' },
    }), candidate)).toEqual({ action: 'suppress', reason: 'recipient_changed' });
    expect(authorizeScientificReportScheduleCandidate(policy({
      emailEnabled: true,
      reportRecipient: 'francesco@example.com',
      dailyReport: { enabled: true, localTime: '21:30' },
    }), candidate)).toEqual({ action: 'suppress', reason: 'schedule_changed' });
    expect(() => authorizeScientificReportScheduleCandidate(dailyPolicy(), {
      ...candidate,
      scheduledFor: '2026-08-25T20:31:00.000Z',
    })).toThrow(/occurrence|identity/i);
  });
});

describe('deterministic due report planning', () => {
  it('plans the current Daily period after its local due time without leaking the mailbox', () => {
    const enabled = dailyPolicy();
    const first = planDueScientificReportRuns(enabled, '2026-08-25T21:00:00.000Z');
    const second = planDueScientificReportRuns(enabled, '2026-08-25T21:00:00.000Z');

    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      uid: UID,
      reportType: 'daily',
      localDate: '2026-08-25',
      localStartDate: '2026-08-25',
      scheduledFor: '2026-08-25T20:30:00.000Z',
    });
    expect(first[0]?.id).toMatch(/^report_run_[0-9a-f]{48}$/);
    expect(first[0]?.expectedScheduleVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(first[0]?.recipientAuthorityHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(first)).not.toContain('francesco@example.com');
  });

  it('selects the preceding Daily occurrence before today\'s due time', () => {
    expect(planDueScientificReportRuns(
      dailyPolicy(),
      '2026-08-25T19:00:00.000Z',
    )[0]).toMatchObject({
      localDate: '2026-08-24',
      localStartDate: '2026-08-24',
      scheduledFor: '2026-08-24T20:30:00.000Z',
    });
  });

  it('plans at most one Daily and one Weekly occurrence with Monday week identity', () => {
    const enabled = policy({
      emailEnabled: true,
      reportRecipient: 'francesco@example.com',
      dailyReport: { enabled: true, localTime: '22:30' },
      weeklyReport: { enabled: true, isoWeekday: 7, localTime: '20:30' },
    });

    expect(planDueScientificReportRuns(enabled, '2026-08-30T21:00:00.000Z')).toMatchObject([
      {
        reportType: 'daily',
        localDate: '2026-08-30',
        localStartDate: '2026-08-30',
        scheduledFor: '2026-08-30T20:30:00.000Z',
      },
      {
        reportType: 'weekly',
        localDate: '2026-08-30',
        localStartDate: '2026-08-24',
        scheduledFor: '2026-08-30T18:30:00.000Z',
      },
    ]);
  });

  it('uses the last completed calendar week for a Monday-Saturday delivery day', () => {
    const monday = policy({
      emailEnabled: true,
      reportRecipient: 'francesco@example.com',
      weeklyReport: { enabled: true, isoWeekday: 1, localTime: '20:30' },
    });

    expect(planDueScientificReportRuns(monday, '2026-08-31T21:00:00.000Z')[0]).toMatchObject({
      reportType: 'weekly',
      localDate: '2026-08-30',
      localStartDate: '2026-08-24',
      scheduledFor: '2026-08-31T18:30:00.000Z',
    });
  });

  it('uses one compatible instant through spring gaps and autumn duplicates', () => {
    const dstPolicy = policy({
      emailEnabled: true,
      reportRecipient: 'francesco@example.com',
      dailyReport: { enabled: true, localTime: '02:30' },
    });

    const spring = planDueScientificReportRuns(dstPolicy, '2026-03-29T01:31:00.000Z')[0];
    expect(spring).toMatchObject({
      localDate: '2026-03-29',
      scheduledFor: '2026-03-29T01:30:00.000Z',
    });

    const autumnFirst = planDueScientificReportRuns(dstPolicy, '2026-10-25T00:31:00.000Z')[0];
    const autumnSecond = planDueScientificReportRuns(dstPolicy, '2026-10-25T01:45:00.000Z')[0];
    expect(autumnFirst).toMatchObject({
      localDate: '2026-10-25',
      scheduledFor: '2026-10-25T00:30:00.000Z',
    });
    expect(autumnSecond).toEqual(autumnFirst);
  });

  it('keeps period identity stable while schedule and recipient authority change', () => {
    const original = dailyPolicy();
    const rescheduled = policy({
      emailEnabled: true,
      reportRecipient: 'francesco@example.com',
      dailyReport: { enabled: true, localTime: '21:30' },
    });
    const recipientChanged = policy({
      emailEnabled: true,
      reportRecipient: 'other@example.com',
      dailyReport: { enabled: true, localTime: '22:30' },
    });
    const now = '2026-08-25T21:00:00.000Z';
    const [first] = planDueScientificReportRuns(original, now);
    const [moved] = planDueScientificReportRuns(rescheduled, now);
    const [retargeted] = planDueScientificReportRuns(recipientChanged, now);

    expect(moved?.id).toBe(first?.id);
    expect(retargeted?.id).toBe(first?.id);
    expect(moved?.scheduledFor).not.toBe(first?.scheduledFor);
    expect(moved?.expectedScheduleVersion).not.toBe(first?.expectedScheduleVersion);
    expect(retargeted?.expectedScheduleVersion).not.toBe(first?.expectedScheduleVersion);
    expect(retargeted?.recipientAuthorityHash).not.toBe(first?.recipientAuthorityHash);
    expect(reportScheduleVersion(original, 'daily')).toBe(first?.expectedScheduleVersion);
  });
});

function dailyPolicy(): ScientificReportSchedulePolicy {
  return policy({
    emailEnabled: true,
    reportRecipient: 'francesco@example.com',
    dailyReport: { enabled: true, localTime: '22:30' },
  });
}

function policy(overrides: Record<string, unknown>): ScientificReportSchedulePolicy {
  return deriveScientificReportSchedulePolicy(normalizeNotificationPreferences(UID, {
    userId: UID,
    ...overrides,
  }, 'Europe/Rome'));
}
