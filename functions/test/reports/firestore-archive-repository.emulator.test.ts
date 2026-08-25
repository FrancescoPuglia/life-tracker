import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/domain/errors';
import { FirestoreRepository } from '../../src/domain/firestore-repository';
import type { UserPlanningPreferences } from '../../src/domain/types';
import {
  FirestoreScientificReportArchiveRepository,
  ScientificReportSourceLoader,
  buildScientificExecutionReport,
} from '../../src/reports';
import type { ScientificExecutionReport, ScientificReportInput } from '../../src/reports';

const PROJECT_ID = 'demo-life-tracker-report-archive';
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
let uidSequence = 0;

function uniqueUid(label: string): string {
  uidSequence += 1;
  return `report-${label}-${Date.now()}-${uidSequence}`;
}

function report(
  uid: string,
  localDate: string,
  generatedAt: string,
  plannedMinutes = 0,
): ScientificExecutionReport {
  const input: ScientificReportInput = {
    uid,
    reportType: 'daily',
    localDate,
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
      goals: [],
      projects: [],
      tasks: [],
      timeBlocks: plannedMinutes > 0 ? [{
        id: 'block-a',
        _version: 1,
        createdAt: `${localDate}T06:00:00.000Z`,
        updatedAt: `${localDate}T06:00:00.000Z`,
        title: 'Focus block',
        startTime: `${localDate}T07:00:00.000Z`,
        endTime: new Date(Date.parse(`${localDate}T07:00:00.000Z`) + plannedMinutes * 60_000)
          .toISOString(),
        status: 'planned',
        type: 'deep',
      }] : [],
      sessions: [],
      habits: [],
      habitLogs: [],
    },
  };
  return buildScientificExecutionReport(input);
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'Firestore scientific report archive transactions',
  () => {
    let app: App;
    let firestore: Firestore;

    beforeAll(() => {
      app = initializeApp({ projectId: PROJECT_ID }, `report-archive-${Date.now()}`);
      firestore = getFirestore(app);
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    it('atomically creates a minimal archive and marker, then replays the same content', async () => {
      const uid = uniqueUid('replay');
      const repository = new FirestoreScientificReportArchiveRepository(firestore);
      const firstReport = report(uid, '2026-08-25', '2026-08-25T20:30:00.000Z', 60);

      const first = await repository.saveGeneratedReport(
        uid,
        firstReport,
        '2026-08-25T20:30:01.000Z',
      );
      const retryReport = report(uid, '2026-08-25', '2026-08-25T20:31:00.000Z', 60);
      const retry = await repository.saveGeneratedReport(
        uid,
        retryReport,
        '2026-08-25T20:31:01.000Z',
      );

      expect(first.idempotentReplay).toBe(false);
      expect(retry.idempotentReplay).toBe(true);
      expect(retry.archive).toEqual(first.archive);
      const [archive, marker, archives, markers] = await Promise.all([
        firestore.doc(`users/${uid}/reportArchives/${firstReport.id}`).get(),
        firestore.doc(`users/${uid}/reportIdempotency/${firstReport.id}`).get(),
        firestore.collection(`users/${uid}/reportArchives`).get(),
        firestore.collection(`users/${uid}/reportIdempotency`).get(),
      ]);
      expect(archive.data()).toMatchObject({
        schemaVersion: 'scientific-report-archive-v1',
        id: firstReport.id,
        userId: uid,
        metricHash: firstReport.metrics.metricHash,
        delivery: {
          schemaVersion: 'report-delivery-state-v1',
          state: 'not_attempted',
          provider: null,
        },
        generatedAt: expect.any(Timestamp),
        createdAt: expect.any(Timestamp),
        updatedAt: expect.any(Timestamp),
      });
      expect(marker.data()).toMatchObject({
        schemaVersion: 'scientific-report-idempotency-v1',
        id: firstReport.id,
        userId: uid,
        metricHash: firstReport.metrics.metricHash,
        createdAt: expect.any(Timestamp),
      });
      expect(archive.data()?.report.generatedAt).toBe('2026-08-25T20:30:00.000Z');
      expect(JSON.stringify(archive.data()?.report)).not.toContain(uid);
      expect(archives.size).toBe(1);
      expect(markers.size).toBe(1);
    }, 30_000);

    it('loads the authenticated owner source through the verified Firestore repository', async () => {
      const uid = uniqueUid('source-owner');
      const otherUid = uniqueUid('source-other');
      const createdAt = Timestamp.fromDate(new Date('2026-08-01T08:00:00.000Z'));
      await Promise.all([
        firestore.doc(`users/${uid}`).set({ uid, preferences: {
          timezone: 'Europe/Rome',
          workingHours: { start: '07:00', end: '22:00' },
          maxDailyPlannedMinutes: 600,
          maxWeeklyPlannedMinutes: 3_000,
          minBufferMinutes: 15,
          maxConsecutiveHighEnergyBlocks: 2,
        } }),
        firestore.doc(`users/${uid}/goals/goal-owner`).set({
          id: 'goal-owner', userId: uid, title: 'Owner goal', createdAt, updatedAt: createdAt,
        }),
        firestore.doc(`users/${otherUid}/goals/goal-other`).set({
          id: 'goal-other', userId: otherUid, title: 'Other goal', createdAt, updatedAt: createdAt,
        }),
        firestore.doc(`users/${uid}/sessions/session-owner`).set({
          id: 'session-owner', userId: uid, status: 'completed', duration: 3_600,
          startTime: Timestamp.fromDate(new Date('2026-08-04T07:00:00.000Z')),
          endTime: Timestamp.fromDate(new Date('2026-08-04T08:00:00.000Z')),
          createdAt,
          updatedAt: createdAt,
        }),
        firestore.doc(`users/${uid}/timeBlocks/block-tomorrow`).set({
          id: 'block-tomorrow', userId: uid, title: 'Tomorrow', status: 'planned', type: 'work',
          startTime: Timestamp.fromDate(new Date('2026-08-26T07:00:00.000Z')),
          endTime: Timestamp.fromDate(new Date('2026-08-26T08:00:00.000Z')),
          createdAt,
          updatedAt: createdAt,
        }),
        firestore.doc(`users/${uid}/timeBlocks/block-explicit-actual`).set({
          id: 'block-explicit-actual', userId: uid, title: 'Moved plan', status: 'completed', type: 'work',
          startTime: Timestamp.fromDate(new Date('2026-10-01T07:00:00.000Z')),
          endTime: Timestamp.fromDate(new Date('2026-10-01T08:00:00.000Z')),
          actualStartTime: Timestamp.fromDate(new Date('2026-08-25T12:00:00.000Z')),
          actualEndTime: Timestamp.fromDate(new Date('2026-08-25T12:30:00.000Z')),
          createdAt,
          updatedAt: createdAt,
        }),
      ]);
      const loader = new ScientificReportSourceLoader(
        new FirestoreRepository(firestore),
        () => new Date('2026-08-25T20:30:00.000Z'),
      );

      const input = await loader.load(
        { uid, requestId: 'firestore-report-source' },
        { reportType: 'daily', localDate: '2026-08-25', locale: 'it-IT' },
      );

      expect(input.uid).toBe(uid);
      expect(input.preferences.source).toBe('persisted');
      expect(input.records.goals.map(({ id }) => id)).toEqual(['goal-owner']);
      expect(input.records.sessions?.map(({ id }) => id)).toEqual(['session-owner']);
      expect(input.records.timeBlocks.map(({ id }) => id).sort()).toEqual([
        'block-explicit-actual',
        'block-tomorrow',
      ]);
      expect(JSON.stringify(input.records)).not.toContain('goal-other');
      expect(Object.values(input.coverage).every((coverage) => coverage === 'complete')).toBe(true);
    }, 30_000);

    it('rejects changed content for the same owner/type/local-date identity', async () => {
      const uid = uniqueUid('conflict');
      const repository = new FirestoreScientificReportArchiveRepository(firestore);
      const firstReport = report(uid, '2026-08-25', '2026-08-25T20:30:00.000Z', 60);
      await repository.saveGeneratedReport(uid, firstReport, '2026-08-25T20:30:01.000Z');

      const changed = report(uid, '2026-08-25', '2026-08-25T20:31:00.000Z', 90);
      await expect(repository.saveGeneratedReport(
        uid,
        changed,
        '2026-08-25T20:31:01.000Z',
      )).rejects.toMatchObject({ code: 'CONFLICT' } satisfies Partial<DomainError>);
      expect((await firestore.collection(`users/${uid}/reportArchives`).get()).size).toBe(1);
      expect((await firestore.collection(`users/${uid}/reportIdempotency`).get()).size).toBe(1);
    }, 30_000);

    it('serializes concurrent creation so exactly one caller creates the report', async () => {
      const uid = uniqueUid('concurrent');
      const repository = new FirestoreScientificReportArchiveRepository(firestore);
      const artifact = report(uid, '2026-08-25', '2026-08-25T20:30:00.000Z', 60);

      const results = await Promise.all([
        repository.saveGeneratedReport(uid, artifact, '2026-08-25T20:30:01.000Z'),
        repository.saveGeneratedReport(uid, artifact, '2026-08-25T20:30:01.000Z'),
      ]);

      expect(results.map(({ idempotentReplay }) => idempotentReplay).sort()).toEqual([false, true]);
      expect((await firestore.collection(`users/${uid}/reportArchives`).get()).size).toBe(1);
      expect((await firestore.collection(`users/${uid}/reportIdempotency`).get()).size).toBe(1);
    }, 30_000);

    it('keeps get/list owner-scoped, bounded, and newest-first', async () => {
      const uid = uniqueUid('history');
      const otherUid = uniqueUid('other');
      const repository = new FirestoreScientificReportArchiveRepository(firestore);
      const older = report(uid, '2026-08-24', '2026-08-24T20:30:00.000Z');
      const newer = report(uid, '2026-08-25', '2026-08-25T20:30:00.000Z');
      await repository.saveGeneratedReport(uid, older, '2026-08-24T20:30:01.000Z');
      await repository.saveGeneratedReport(uid, newer, '2026-08-25T20:30:01.000Z');

      await expect(repository.getArchive(uid, newer.id)).resolves.toMatchObject({ id: newer.id });
      await expect(repository.getArchive(otherUid, newer.id)).resolves.toBeNull();
      const page = await repository.listArchiveSummaries(uid, 1);
      expect(page.overflow).toBe(true);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.id).toBe(newer.id);
      await expect(repository.listArchiveSummaries(otherUid, 10)).resolves.toEqual({
        items: [],
        overflow: false,
      });
      await expect(repository.listArchiveSummaries(uid, 101)).rejects.toMatchObject({
        code: 'LIMIT_EXCEEDED',
      });
    }, 30_000);

    it('fails closed on orphaned or incoherent idempotency state without writing an archive', async () => {
      const uid = uniqueUid('orphan');
      const repository = new FirestoreScientificReportArchiveRepository(firestore);
      const artifact = report(uid, '2026-08-25', '2026-08-25T20:30:00.000Z');
      await firestore.doc(`users/${uid}/reportIdempotency/${artifact.id}`).set({
        schemaVersion: 'scientific-report-idempotency-v1',
        id: artifact.id,
        userId: uid,
        reportId: artifact.id,
        reportType: 'daily',
        localStartDate: '2026-08-25',
        metricHash: artifact.metrics.metricHash,
        artifactHash: '0'.repeat(64),
        createdAt: Timestamp.fromDate(new Date('2026-08-25T20:30:01.000Z')),
      });

      await expect(repository.saveGeneratedReport(
        uid,
        artifact,
        '2026-08-25T20:30:01.000Z',
      )).rejects.toMatchObject({ code: 'INTERNAL' } satisfies Partial<DomainError>);
      await expect(
        firestore.doc(`users/${uid}/reportArchives/${artifact.id}`).get(),
      ).resolves.toMatchObject({ exists: false });
    }, 30_000);
  },
);
