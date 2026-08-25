import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/domain/errors';
import { InMemoryRepository } from '../../src/domain/in-memory-repository';
import type { AuthContext, UserPlanningPreferences } from '../../src/domain/types';
import { ScientificReportSourceLoader } from '../../src/reports/source-loader';

const UID = 'owner-a';
const OTHER_UID = 'owner-b';
const TIMEZONE = 'Europe/Rome';
const CONTEXT: AuthContext = { uid: UID, requestId: 'report-source-test' };
const PREFERENCES: UserPlanningPreferences = {
  source: 'persisted',
  defaultsApplied: [],
  timezone: TIMEZONE,
  workingHours: { start: '07:00', end: '22:00' },
  maxDailyPlannedMinutes: 600,
  maxWeeklyPlannedMinutes: 3_000,
  minBufferMinutes: 15,
  maxConsecutiveHighEnergyBlocks: 2,
};

function instant(localDate: string, time: string): string {
  return Temporal.PlainDate.from(localDate)
    .toZonedDateTime({
      timeZone: TIMEZONE,
      plainTime: Temporal.PlainTime.from(time),
    })
    .toInstant()
    .toString();
}

function baseRecord(id: string, values: Readonly<Record<string, unknown>> = {}) {
  return {
    id,
    createdAt: instant('2026-08-01', '08:00'),
    updatedAt: instant('2026-08-01', '08:00'),
    ...values,
  };
}

describe('ScientificReportSourceLoader', () => {
  it('loads only the authenticated owner through the four-week and tomorrow horizons', async () => {
    const repository = new InMemoryRepository();
    repository.setPlanningPreferencesForTest(UID, PREFERENCES);
    repository.seed(UID, 'goals', [baseRecord('goal-owner', { title: 'Owner goal' })]);
    repository.seed(OTHER_UID, 'goals', [baseRecord('goal-other', { title: 'Other goal' })]);
    repository.seed(UID, 'projects', [baseRecord('project-owner', { goalId: 'goal-owner' })]);
    repository.seed(UID, 'tasks', [baseRecord('task-owner', { projectId: 'project-owner' })]);
    repository.seed(UID, 'habits', [baseRecord('habit-owner', { frequency: 'daily' })]);
    repository.seed(UID, 'sessions', [
      baseRecord('session-history', {
        startTime: instant('2026-08-04', '09:00'),
        endTime: instant('2026-08-04', '10:00'),
        status: 'completed',
        duration: 3_600,
      }),
      baseRecord('session-too-old', {
        startTime: instant('2026-07-01', '09:00'),
        endTime: instant('2026-07-01', '10:00'),
        status: 'completed',
        duration: 3_600,
      }),
    ]);
    repository.seed(UID, 'habitLogs', [
      baseRecord('habit-log-history', { habitId: 'habit-owner', date: instant('2026-08-04', '08:00') }),
      baseRecord('habit-log-too-old', { habitId: 'habit-owner', date: instant('2026-07-01', '08:00') }),
    ]);
    repository.seed(UID, 'timeBlocks', [
      baseRecord('block-current', {
        startTime: instant('2026-08-25', '09:00'),
        endTime: instant('2026-08-25', '10:00'),
      }),
      baseRecord('block-tomorrow', {
        startTime: instant('2026-08-26', '09:00'),
        endTime: instant('2026-08-26', '10:00'),
      }),
      baseRecord('block-actual-in-horizon', {
        startTime: instant('2026-10-01', '09:00'),
        endTime: instant('2026-10-01', '10:00'),
        actualStartTime: instant('2026-08-25', '14:00'),
        actualEndTime: instant('2026-08-25', '14:30'),
      }),
      baseRecord('block-far-future', {
        startTime: instant('2026-10-02', '09:00'),
        endTime: instant('2026-10-02', '10:00'),
      }),
    ]);

    const loader = new ScientificReportSourceLoader(
      repository,
      () => new Date('2026-08-25T20:30:00.000Z'),
    );
    const input = await loader.load(CONTEXT, {
      reportType: 'daily',
      localDate: '2026-08-25',
      locale: 'it-IT',
    });

    expect(input.uid).toBe(UID);
    expect(input.timezone).toBe(TIMEZONE);
    expect(input.preferences).toEqual(PREFERENCES);
    expect(input.generatedAt).toBe('2026-08-25T20:30:00.000Z');
    expect(input.records.goals.map(({ id }) => id)).toEqual(['goal-owner']);
    expect(input.records.projects.map(({ id }) => id)).toEqual(['project-owner']);
    expect(input.records.tasks.map(({ id }) => id)).toEqual(['task-owner']);
    expect(input.records.habits.map(({ id }) => id)).toEqual(['habit-owner']);
    expect(input.records.sessions?.map(({ id }) => id)).toEqual(['session-history']);
    expect(input.records.habitLogs?.map(({ id }) => id)).toEqual(['habit-log-history']);
    expect(input.records.timeBlocks.map(({ id }) => id)).toEqual([
      'block-current',
      'block-tomorrow',
      'block-actual-in-horizon',
    ]);
    expect(Object.values(input.coverage).every((value) => value === 'complete')).toBe(true);
  });

  it('marks a source truncated at its hard limit instead of presenting partial data as complete', async () => {
    const repository = new InMemoryRepository();
    repository.seed(UID, 'tasks', Array.from({ length: 5_001 }, (_, index) => (
      baseRecord(`task-${String(index).padStart(4, '0')}`)
    )));
    const loader = new ScientificReportSourceLoader(repository);

    const input = await loader.load(CONTEXT, {
      reportType: 'weekly',
      localDate: '2026-08-25',
      locale: 'en-GB',
    });

    expect(input.records.tasks).toHaveLength(5_000);
    expect(input.coverage.tasks).toBe('truncated');
    expect(input.timezone).toBe('Europe/Rome');
    expect(input.preferences.source).toBe('product_default');
  });

  it('rejects an invalid identity before reading owner state', async () => {
    const repository = new InMemoryRepository();
    const loader = new ScientificReportSourceLoader(repository);

    await expect(loader.load(
      { uid: '../owner-b', requestId: 'invalid-owner' },
      { reportType: 'daily', localDate: '2026-08-25', locale: 'en' },
    )).rejects.toMatchObject({ code: 'UNAUTHENTICATED' } satisfies Partial<DomainError>);
  });
});
