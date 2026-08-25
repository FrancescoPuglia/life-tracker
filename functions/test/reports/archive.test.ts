import { describe, expect, it } from 'vitest';
import type { EntityRecord, UserPlanningPreferences } from '../../src/domain/types';
import {
  REPORT_ARCHIVE_MAX_REPORT_BYTES,
  buildScientificExecutionReport,
  createReportArchiveIdempotencyRecord,
  createStoredScientificReportArchive,
  scientificReportArtifactHash,
  validateScientificExecutionReport,
} from '../../src/reports';
import type {
  ScientificExecutionReport,
  ScientificReportInput,
} from '../../src/reports';

const UID = 'archive-owner';
const PREFERENCES: UserPlanningPreferences = {
  source: 'persisted',
  defaultsApplied: [],
  timezone: 'Europe/Rome',
  workingHours: { start: '07:00', end: '22:00' },
  maxDailyPlannedMinutes: 600,
  maxWeeklyPlannedMinutes: 3_000,
  minBufferMinutes: 15,
  maxConsecutiveHighEnergyBlocks: 2,
};

function record(id: string, values: Readonly<Record<string, unknown>> = {}): EntityRecord {
  return {
    id,
    _version: 1,
    createdAt: '2026-08-01T08:00:00.000Z',
    updatedAt: '2026-08-01T08:00:00.000Z',
    ...values,
  };
}

function report(generatedAt = '2026-08-25T20:30:00.000Z'): ScientificExecutionReport {
  const input: ScientificReportInput = {
    uid: UID,
    reportType: 'daily',
    localDate: '2026-08-25',
    timezone: 'Europe/Rome',
    locale: 'it-IT',
    generatedAt,
    preferences: PREFERENCES,
    coverage: {
      goals: 'complete',
      projects: 'complete',
      tasks: 'complete',
      timeBlocks: 'complete',
      sessions: 'complete',
      habits: 'complete',
      habitLogs: 'complete',
    },
    records: {
      goals: [record('goal-a', { title: 'Goal A', timeAllocationTarget: 5 })],
      projects: [],
      tasks: [],
      timeBlocks: [record('block-a', {
        title: 'Focus block',
        goalId: 'goal-a',
        startTime: '2026-08-25T07:00:00.000Z',
        endTime: '2026-08-25T08:00:00.000Z',
        status: 'planned',
        type: 'deep',
      })],
      sessions: [],
      habits: [],
      habitLogs: [],
    },
  };
  return buildScientificExecutionReport(input);
}

describe('scientific report archive contract', () => {
  it('creates minimal owner-bound versioned metadata without raw UID inside the report artifact', () => {
    const artifact = report();
    const archive = createStoredScientificReportArchive(
      UID,
      artifact,
      '2026-08-25T20:30:01.000Z',
    );
    const marker = createReportArchiveIdempotencyRecord(archive);

    expect(archive).toMatchObject({
      schemaVersion: 'scientific-report-archive-v1',
      id: artifact.id,
      userId: UID,
      ownerHash: artifact.ownerHash,
      type: 'daily',
      localStartDate: '2026-08-25',
      metricHash: artifact.metrics.metricHash,
      artifactHash: scientificReportArtifactHash(artifact),
      delivery: {
        schemaVersion: 'report-delivery-state-v1',
        channel: 'email',
        state: 'not_attempted',
        provider: null,
      },
    });
    expect(marker).toMatchObject({
      schemaVersion: 'scientific-report-idempotency-v1',
      id: artifact.id,
      userId: UID,
      metricHash: artifact.metrics.metricHash,
      artifactHash: archive.artifactHash,
    });
    expect(JSON.stringify(archive.report)).not.toContain(UID);
    expect(JSON.stringify(archive)).not.toContain('providerSecret');
  });

  it('uses a stable artifact identity across scheduler retries with a new generation instant', () => {
    const first = report('2026-08-25T20:30:00.000Z');
    const retry = report('2026-08-25T20:31:00.000Z');

    expect(first.id).toBe(retry.id);
    expect(first.metrics.metricHash).toBe(retry.metrics.metricHash);
    expect(scientificReportArtifactHash(first)).toBe(scientificReportArtifactHash(retry));
  });

  it('rejects modified metrics and chart data whose deterministic hashes no longer match', () => {
    const metricTamper = structuredClone(report()) as ScientificExecutionReport;
    (metricTamper.metrics.plannedMinutes as { value: number | null }).value = 999;
    expect(() => validateScientificExecutionReport(UID, metricTamper)).toThrow(
      'metric hash does not match',
    );

    const chartTamper = structuredClone(report()) as ScientificExecutionReport;
    const firstChart = chartTamper.charts[0];
    if (!firstChart) throw new Error('Expected a chart fixture.');
    (firstChart.points[0]?.values[0] as { value: number | null }).value = 999;
    expect(() => validateScientificExecutionReport(UID, chartTamper)).toThrow(
      'chart hash does not match',
    );
  });

  it('rejects non-finite and oversized artifacts before they reach Firestore', () => {
    const nonFinite = structuredClone(report()) as ScientificExecutionReport;
    (nonFinite.metrics.plannedMinutes as { value: number | null }).value = Number.NaN;
    expect(() => createStoredScientificReportArchive(
      UID,
      nonFinite,
      '2026-08-25T20:30:01.000Z',
    )).toThrow('non-finite');

    const oversized = {
      ...structuredClone(report()),
      executiveSummary: ['x'.repeat(REPORT_ARCHIVE_MAX_REPORT_BYTES)],
    } as ScientificExecutionReport;
    expect(() => createStoredScientificReportArchive(
      UID,
      oversized,
      '2026-08-25T20:30:01.000Z',
    )).toThrow('safe archive size');
  });
});
