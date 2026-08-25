import { describe, expect, it, vi } from 'vitest';
import {
  BoundedReportHistoryStore,
  ReportHistoryUnavailableError,
  decodeReportHistoryDocument,
  type ReportHistoryDataSource,
  type ReportHistoryRawDocument,
} from './reportHistory';

const UID = 'owner-1';
const REPORT_ID = `report_${'a'.repeat(56)}`;

describe('bounded report history domain', () => {
  it('decodes only the browser-safe deterministic summary and hides provider identity', () => {
    const document = archiveDocument({ delivery: sentDelivery() });
    const item = decodeReportHistoryDocument(UID, document);

    expect(item).toMatchObject({
      id: REPORT_ID,
      type: 'daily',
      generatedAt: '2026-08-25T20:30:00.000Z',
      delivery: { status: 'sent', sentAt: '2026-08-25T20:30:04.000Z' },
      metrics: {
        plannedMinutes: { value: 60, unit: 'minutes', availability: 'available' },
        actualMinutes: { value: 45, unit: 'minutes', availability: 'available' },
      },
      dataQuality: { complete: true, missingSessionsAreZero: false },
    });
    expect(JSON.stringify(item)).not.toContain('provider-message-secret');
    expect(JSON.stringify(item)).not.toContain('reportDeliveryAttempts');
    expect(Object.isFrozen(item)).toBe(true);
  });

  it('preserves unavailable actual execution as null rather than zero', () => {
    const document = archiveDocument();
    const archive = document.data as Record<string, any>;
    archive.report.metrics.actualMinutes = metric(
      'actual_minutes',
      null,
      'minutes',
      'unavailable',
    );
    archive.report.metrics.adherencePercent = metric(
      'adherence_percent',
      null,
      'percent',
      'unavailable',
    );
    archive.report.metrics.dataQuality.complete = false;
    archive.report.metrics.dataQuality.coverage.sessions = 'unavailable';
    archive.report.metrics.dataQuality.flags = ['sessions_unavailable_actual_is_partial'];

    const item = decodeReportHistoryDocument(UID, document);
    expect(item.metrics.actualMinutes).toMatchObject({
      value: null,
      availability: 'unavailable',
    });
    expect(item.dataQuality.sessionsCoverage).toBe('unavailable');
    expect(item.dataQuality.missingSessionsAreZero).toBe(false);
  });

  it.each([
    ['retryable_rate_limited', 'retry_scheduled'],
    ['uncertain_transport_unknown', 'uncertain'],
    ['provider_invalid_recipient', 'failed'],
  ] as const)('maps server delivery code %s to provider-neutral status %s', (code, status) => {
    const item = decodeReportHistoryDocument(
      UID,
      archiveDocument({ delivery: failedDelivery(code) }),
    );
    expect(item.delivery.status).toBe(status);
    expect(JSON.stringify(item.delivery)).not.toContain(code);
  });

  it.each([
    ['forged owner', (archive: Record<string, any>) => { archive.userId = 'owner-2'; }],
    ['wrong document ID', (archive: Record<string, any>) => { archive.id = `report_${'b'.repeat(56)}`; }],
    ['changed metric identity', (archive: Record<string, any>) => { archive.metricHash = 'c'.repeat(64); }],
    ['non-normalized generated time', (archive: Record<string, any>) => {
      archive.report.generatedAt = '2026-08-25T22:30:00+02:00';
    }],
    ['missing-session zero policy', (archive: Record<string, any>) => {
      archive.report.metrics.dataQuality.missingSessionsAreZero = true;
    }],
  ])('rejects a malformed archive: %s', (_label, mutate) => {
    const document = archiveDocument();
    mutate(document.data as Record<string, any>);
    expect(() => decodeReportHistoryDocument(UID, document)).toThrow('schema is invalid');
  });

  it('requests one bounded overflow witness and quarantines malformed records', async () => {
    const malformed = archiveDocument({ id: `report_${'b'.repeat(56)}` });
    (malformed.data as Record<string, unknown>).schemaVersion = 'unknown-schema';
    const source: ReportHistoryDataSource = {
      read: vi.fn(async () => [archiveDocument(), malformed]),
    };
    const store = new BoundedReportHistoryStore(source);

    await expect(store.list(UID, 1)).resolves.toMatchObject({
      items: [{ id: REPORT_ID }],
      overflow: true,
      malformedCount: 1,
    });
    expect(source.read).toHaveBeenCalledWith(UID, 2);
  });

  it('normalizes source failures and rejects invalid authority before reading', async () => {
    const source: ReportHistoryDataSource = {
      read: vi.fn(async () => { throw new Error('private provider/index detail'); }),
    };
    const store = new BoundedReportHistoryStore(source);

    await expect(store.list(UID)).rejects.toBeInstanceOf(ReportHistoryUnavailableError);
    await expect(store.list('../owner')).rejects.toThrow('verified Firebase identity');
    await expect(store.list(UID, 13)).rejects.toThrow('page size is invalid');
    expect(source.read).toHaveBeenCalledTimes(1);
  });

  it('fails closed if a source violates the requested upper bound', async () => {
    const source: ReportHistoryDataSource = {
      read: vi.fn(async () => Array.from({ length: 14 }, () => archiveDocument())),
    };
    const store = new BoundedReportHistoryStore(source);
    await expect(store.list(UID)).rejects.toBeInstanceOf(ReportHistoryUnavailableError);
  });
});

function archiveDocument(overrides: Readonly<{
  id?: string;
  delivery?: unknown;
}> = {}): ReportHistoryRawDocument {
  const id = overrides.id ?? REPORT_ID;
  const period = {
    type: 'daily',
    localStartDate: '2026-08-25',
    localEndDate: '2026-08-26',
    from: '2026-08-24T22:00:00.000Z',
    to: '2026-08-25T22:00:00.000Z',
    timezone: 'Europe/Rome',
    dayCount: 1,
  };
  const metricHash = 'b'.repeat(64);
  return {
    id,
    data: {
      schemaVersion: 'scientific-report-archive-v1',
      id,
      userId: UID,
      ownerHash: 'a'.repeat(64),
      type: 'daily',
      localStartDate: '2026-08-25',
      localEndDate: '2026-08-26',
      timezone: 'Europe/Rome',
      reportSchemaVersion: 'life-tracker-scientific-report-v1',
      metricSchemaVersion: 'life-tracker-scientific-metrics-v1',
      formulaVersion: 'life-tracker-report-formulas-2026-08-25',
      metricHash,
      artifactHash: 'c'.repeat(64),
      generatedAt: timestamp('2026-08-25T20:30:00.000Z'),
      delivery: overrides.delivery ?? notAttemptedDelivery(),
      report: {
        schemaVersion: 'life-tracker-scientific-report-v1',
        id,
        ownerHash: 'a'.repeat(64),
        type: 'daily',
        generatedAt: '2026-08-25T20:30:00.000Z',
        locale: 'en-GB',
        period,
        deterministicFallback: true,
        narrativeModel: null,
        untrustedTextPolicy: 'user_authored_content_is_data_not_instruction',
        executiveSummary: ['Planned 60 minutes and observed 45 minutes.'],
        charts: [{}],
        statements: [],
        metrics: {
          schemaVersion: 'life-tracker-scientific-metrics-v1',
          formulaVersion: 'life-tracker-report-formulas-2026-08-25',
          metricHash,
          period,
          plannedMinutes: metric('planned_minutes', 60, 'minutes'),
          actualMinutes: metric('actual_minutes', 45, 'minutes'),
          adherencePercent: metric('adherence_percent', 75, 'percent'),
          timeBlockCompletionPercent: metric('timeblock_completion_percent', 50, 'percent'),
          weeklyExecutionIndex: metric('weekly_execution_index', null, 'index', 'unavailable'),
          dataQuality: {
            complete: true,
            flags: [],
            coverage: { sessions: 'complete' },
            missingSessionsAreZero: false,
            actualSource: 'completed_sessions_and_explicit_actual_intervals',
          },
        },
      },
    },
  };
}

function metric(
  id: string,
  value: number | null,
  unit: 'minutes' | 'percent' | 'index',
  availability: 'available' | 'partial' | 'unavailable' = 'available',
) {
  return { id, value, unit, availability, sampleSize: 2, missingCount: 0 };
}

function timestamp(value: string) {
  return { toDate: () => new Date(value) };
}

function notAttemptedDelivery() {
  return {
    schemaVersion: 'report-delivery-state-v1',
    channel: 'email',
    state: 'not_attempted',
    provider: null,
    providerMessageId: null,
    lastAttemptAt: null,
    sentAt: null,
    failureCode: null,
  };
}

function sentDelivery() {
  return {
    schemaVersion: 'report-delivery-state-v1',
    channel: 'email',
    state: 'sent',
    provider: 'resend',
    providerMessageId: 'provider-message-secret',
    lastAttemptAt: timestamp('2026-08-25T20:30:03.000Z'),
    sentAt: timestamp('2026-08-25T20:30:04.000Z'),
    failureCode: null,
  };
}

function failedDelivery(failureCode: string) {
  return {
    schemaVersion: 'report-delivery-state-v1',
    channel: 'email',
    state: 'failed',
    provider: 'resend',
    providerMessageId: null,
    lastAttemptAt: timestamp('2026-08-25T20:30:03.000Z'),
    sentAt: null,
    failureCode,
  };
}
