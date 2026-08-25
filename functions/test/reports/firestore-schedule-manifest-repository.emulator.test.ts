import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FirestoreRepository } from '../../src/domain/firestore-repository';
import type { UserPlanningPreferences } from '../../src/domain/types';
import {
  FirestoreScientificReportEmailDeliveryRepository,
  FirestoreScientificReportRunRepository,
  FirestoreScientificReportScheduleManifestRepository,
  ScientificReportEmailDeliveryService,
  ScientificReportRunService,
  ScientificReportScheduleManifestService,
  ScientificReportSourceLoader,
  decodeStoredScientificReportScheduleManifest,
  type EmailProvider,
} from '../../src/reports';

const PROJECT_ID = 'demo-life-tracker-report-manifests';
const DAILY_NOW = '2026-08-25T21:00:00.000Z';
const SUNDAY_NOW = '2026-08-30T21:00:00.000Z';
const RECIPIENT = 'francesco@example.test';
const PLANNING_PREFERENCES: UserPlanningPreferences = {
  source: 'persisted',
  defaultsApplied: [],
  timezone: 'Europe/Rome',
  workingHours: { start: '07:00', end: '22:00' },
  maxDailyPlannedMinutes: 600,
  maxWeeklyPlannedMinutes: 3_000,
  minBufferMinutes: 15,
  maxConsecutiveHighEnergyBlocks: 2,
};
let sequence = 0;

function uniqueUid(label: string): string {
  sequence += 1;
  return `manifest-${label}-${Date.now()}-${sequence}`;
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'Firestore scientific report schedule manifests',
  () => {
    let app: App;
    let firestore: Firestore;

    beforeAll(() => {
      app = initializeApp({ projectId: PROJECT_ID }, `report-manifests-${Date.now()}`);
      firestore = getFirestore(app);
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    it('materializes exactly two mailbox-free manifests and queries only the allowed owner', async () => {
      const uid = uniqueUid('owner');
      const otherUid = uniqueUid('other');
      await Promise.all([
        seedAuthority(firestore, uid, { weeklyEnabled: true }, SUNDAY_NOW),
        seedAuthority(firestore, otherUid, { weeklyEnabled: true }, SUNDAY_NOW),
      ]);
      const repository = new FirestoreScientificReportScheduleManifestRepository(firestore);
      await expect(repository.reconcileOwner(uid, SUNDAY_NOW)).resolves.toEqual({ activeCount: 2 });
      await repository.reconcileOwner(otherUid, SUNDAY_NOW);

      await expect(repository.listDue(uid, SUNDAY_NOW, 10)).resolves.toEqual({
        targets: [
          { uid, reportType: 'weekly' },
          { uid, reportType: 'daily' },
        ],
        overflow: false,
      });
      await expect(repository.listDue(uniqueUid('absent'), SUNDAY_NOW, 10)).resolves.toEqual({
        targets: [], overflow: false,
      });
      await expect(repository.listDue(uid, SUNDAY_NOW, 21)).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });

      const dailySnapshot = await manifestRef(firestore, uid, 'daily').get();
      const weeklySnapshot = await manifestRef(firestore, uid, 'weekly').get();
      expect(decodeStoredScientificReportScheduleManifest(uid, 'daily', dailySnapshot))
        .toMatchObject({
          state: 'active',
          availableAt: '2026-08-30T20:30:00.000Z',
          candidate: { localStartDate: '2026-08-30' },
        });
      expect(decodeStoredScientificReportScheduleManifest(uid, 'weekly', weeklySnapshot))
        .toMatchObject({
          state: 'active',
          availableAt: '2026-08-30T18:30:00.000Z',
          candidate: { localStartDate: '2026-08-24' },
        });
      expect(JSON.stringify({ daily: dailySnapshot.data(), weekly: weeklySnapshot.data() }))
        .not.toContain(RECIPIENT);
    }, 30_000);

    it('reconciles changed recipient authority before execution and disables both schedules exactly', async () => {
      const uid = uniqueUid('stale');
      await seedAuthority(firestore, uid, {}, DAILY_NOW);
      const repository = new FirestoreScientificReportScheduleManifestRepository(firestore);
      await repository.reconcileOwner(uid, DAILY_NOW);
      const before = decodeStoredScientificReportScheduleManifest(
        uid,
        'daily',
        await manifestRef(firestore, uid, 'daily').get(),
      );
      await preferenceRef(firestore, uid).update({
        reportRecipient: 'changed@example.test',
        updatedAt: Timestamp.fromDate(new Date('2026-08-25T21:00:01.000Z')),
      });

      await expect(repository.loadDueCandidate(
        { uid, reportType: 'daily' },
        '2026-08-25T21:00:02.000Z',
      )).resolves.toEqual({ action: 'no_op' });
      const after = decodeStoredScientificReportScheduleManifest(
        uid,
        'daily',
        await manifestRef(firestore, uid, 'daily').get(),
      );
      expect(after.candidate?.recipientAuthorityHash)
        .not.toBe(before.candidate?.recipientAuthorityHash);
      await expect(repository.loadDueCandidate(
        { uid, reportType: 'daily' },
        '2026-08-25T21:00:03.000Z',
      )).resolves.toMatchObject({ action: 'execute' });

      await preferenceRef(firestore, uid).update({
        emailEnabled: false,
        updatedAt: Timestamp.fromDate(new Date('2026-08-25T21:00:04.000Z')),
      });
      await expect(repository.reconcileOwner(
        uid,
        '2026-08-25T21:00:05.000Z',
      )).resolves.toEqual({ activeCount: 0 });
      expect(decodeStoredScientificReportScheduleManifest(
        uid,
        'daily',
        await manifestRef(firestore, uid, 'daily').get(),
      )).toMatchObject({ state: 'disabled', candidate: null, availableAt: null });
      await expect(repository.listDue(
        uid,
        '2026-08-25T21:00:05.000Z',
        10,
      )).resolves.toEqual({ targets: [], overflow: false });
    }, 30_000);

    it('advances a completed Daily period and never regresses it on an unrelated preference write', async () => {
      const uid = uniqueUid('advance');
      await seedAuthority(firestore, uid, {}, DAILY_NOW);
      const repository = new FirestoreScientificReportScheduleManifestRepository(firestore);
      await repository.reconcileOwner(uid, DAILY_NOW);
      const loaded = await repository.loadDueCandidate({ uid, reportType: 'daily' }, DAILY_NOW);
      if (loaded.action !== 'execute') throw new Error('Expected a due Daily report.');
      await expect(repository.recordRunResult({
        target: { uid, reportType: 'daily' },
        candidate: loaded.candidate,
        result: completedResult(),
        now: '2026-08-25T21:00:01.000Z',
      })).resolves.toEqual({ action: 'advanced' });
      const advanced = decodeStoredScientificReportScheduleManifest(
        uid,
        'daily',
        await manifestRef(firestore, uid, 'daily').get(),
      );
      expect(advanced).toMatchObject({
        state: 'active',
        availableAt: '2026-08-26T20:30:00.000Z',
        candidate: { localStartDate: '2026-08-26' },
        lastResultCode: 'completed',
      });

      await preferenceRef(firestore, uid).update({
        reminderOffsetsMinutes: [30],
        updatedAt: Timestamp.fromDate(new Date('2026-08-25T21:00:02.000Z')),
      });
      await repository.reconcileOwner(uid, '2026-08-25T21:00:03.000Z');
      expect(decodeStoredScientificReportScheduleManifest(
        uid,
        'daily',
        await manifestRef(firestore, uid, 'daily').get(),
      ).candidate?.localStartDate).toBe('2026-08-26');
    }, 30_000);

    it('maps an unconsumed Weekly period to a changed day and skips duplicate-period delivery', async () => {
      const uid = uniqueUid('weekly-change');
      await seedAuthority(firestore, uid, { weeklyEnabled: true }, SUNDAY_NOW);
      const repository = new FirestoreScientificReportScheduleManifestRepository(firestore);
      await repository.reconcileOwner(uid, SUNDAY_NOW);
      await preferenceRef(firestore, uid).update({
        'weeklyReport.isoWeekday': 1,
        updatedAt: Timestamp.fromDate(new Date('2026-08-30T21:00:01.000Z')),
      });
      await repository.reconcileOwner(uid, '2026-08-30T21:00:02.000Z');
      const mapped = decodeStoredScientificReportScheduleManifest(
        uid,
        'weekly',
        await manifestRef(firestore, uid, 'weekly').get(),
      );
      expect(mapped).toMatchObject({
        availableAt: '2026-08-31T18:30:00.000Z',
        candidate: { localStartDate: '2026-08-24' },
      });
      const loaded = await repository.loadDueCandidate(
        { uid, reportType: 'weekly' },
        '2026-08-31T19:00:00.000Z',
      );
      if (loaded.action !== 'execute') throw new Error('Expected a due Weekly report.');
      await repository.recordRunResult({
        target: { uid, reportType: 'weekly' },
        candidate: loaded.candidate,
        result: completedResult(),
        now: '2026-08-31T19:00:01.000Z',
      });
      expect(decodeStoredScientificReportScheduleManifest(
        uid,
        'weekly',
        await manifestRef(firestore, uid, 'weekly').get(),
      )).toMatchObject({
        availableAt: '2026-09-07T18:30:00.000Z',
        candidate: { localStartDate: '2026-08-31' },
      });
    }, 30_000);

    it('persists bounded runtime backoff and skips only the exhausted report period', async () => {
      const uid = uniqueUid('runtime-failure');
      await seedAuthority(firestore, uid, {}, DAILY_NOW);
      const repository = new FirestoreScientificReportScheduleManifestRepository(firestore);
      await repository.reconcileOwner(uid, DAILY_NOW);
      const loaded = await repository.loadDueCandidate({ uid, reportType: 'daily' }, DAILY_NOW);
      if (loaded.action !== 'execute') throw new Error('Expected a due Daily report.');
      await expect(repository.recordInvocationFailure({
        target: { uid, reportType: 'daily' },
        candidate: loaded.candidate,
        now: '2026-08-25T20:59:59.999Z',
      })).rejects.toMatchObject({ code: 'INTERNAL' });
      expect(decodeStoredScientificReportScheduleManifest(
        uid,
        'daily',
        await manifestRef(firestore, uid, 'daily').get(),
      )).toMatchObject({ runtimeFailureCount: 0 });
      const times = [
        DAILY_NOW,
        '2026-08-25T21:05:00.000Z',
        '2026-08-25T21:15:00.000Z',
        '2026-08-25T21:30:00.000Z',
        '2026-08-25T21:50:00.000Z',
      ];
      for (let index = 0; index < times.length; index += 1) {
        const result = await repository.recordInvocationFailure({
          target: { uid, reportType: 'daily' },
          candidate: loaded.candidate,
          now: times[index]!,
        });
        expect(result.action).toBe(index === 4 ? 'advanced' : 'retry_scheduled');
      }
      expect(decodeStoredScientificReportScheduleManifest(
        uid,
        'daily',
        await manifestRef(firestore, uid, 'daily').get(),
      )).toMatchObject({
        runtimeFailureCount: 0,
        lastResultCode: 'runtime_attempts_exhausted',
        candidate: { localStartDate: '2026-08-26' },
      });
    }, 30_000);

    it('serializes concurrent full schedule runs to one source load and one provider call', async () => {
      const uid = uniqueUid('concurrent');
      await seedAuthority(firestore, uid, {}, DAILY_NOW);
      const manifestRepository = new FirestoreScientificReportScheduleManifestRepository(firestore);
      await manifestRepository.reconcileOwner(uid, DAILY_NOW);
      const loader = new ScientificReportSourceLoader(
        new FirestoreRepository(firestore),
        () => new Date(DAILY_NOW),
      );
      const source = {
        calls: 0,
        async load(...args: Parameters<typeof loader.load>) {
          this.calls += 1;
          return loader.load(...args);
        },
      };
      const provider: EmailProvider & { calls: number } = {
        id: 'resend',
        calls: 0,
        async sendReportEmail() {
          this.calls += 1;
          return {
            outcome: 'accepted',
            provider: 'resend',
            providerMessageId: 'manifest-provider-message-1',
          };
        },
      };
      const runService = new ScientificReportRunService(
        new FirestoreScientificReportRunRepository(firestore),
        source,
        new ScientificReportEmailDeliveryService(
          new FirestoreScientificReportEmailDeliveryRepository(firestore),
          provider,
          { email: 'reports@example.test', name: 'Life Tracker Reports' },
        ),
      );
      const service = new ScientificReportScheduleManifestService(
        manifestRepository,
        runService,
      );

      const results = await Promise.all([
        service.runDue(uid, DAILY_NOW, 10),
        service.runDue(uid, DAILY_NOW, 10),
      ]);
      expect(results.reduce((total, result) => total + result.completedCount, 0)).toBe(1);
      expect(results.reduce((total, result) => (
        total + result.retryCount + result.noOpCount
      ), 0)).toBe(1);
      expect(source.calls).toBe(1);
      expect(provider.calls).toBe(1);
      const manifestSnapshot = await manifestRef(firestore, uid, 'daily').get();
      expect(decodeStoredScientificReportScheduleManifest(uid, 'daily', manifestSnapshot))
        .toMatchObject({ candidate: { localStartDate: '2026-08-26' } });
      expect(JSON.stringify(manifestSnapshot.data())).not.toContain(RECIPIENT);
    }, 60_000);
  },
);

async function seedAuthority(
  firestore: Firestore,
  uid: string,
  options: Readonly<{ weeklyEnabled?: boolean }>,
  now: string,
): Promise<void> {
  await Promise.all([
    firestore.doc(`users/${uid}`).set({
      uid,
      preferences: {
        timezone: PLANNING_PREFERENCES.timezone,
        workingHours: PLANNING_PREFERENCES.workingHours,
        maxDailyPlannedMinutes: PLANNING_PREFERENCES.maxDailyPlannedMinutes,
        maxWeeklyPlannedMinutes: PLANNING_PREFERENCES.maxWeeklyPlannedMinutes,
        minBufferMinutes: PLANNING_PREFERENCES.minBufferMinutes,
        maxConsecutiveHighEnergyBlocks: PLANNING_PREFERENCES.maxConsecutiveHighEnergyBlocks,
      },
    }),
    preferenceRef(firestore, uid).set({
      schemaVersion: 'notification-preferences-v2',
      id: 'default',
      userId: uid,
      timezone: 'Europe/Rome',
      locale: 'it-IT',
      emailEnabled: true,
      reportRecipient: RECIPIENT,
      reminderOffsetsMinutes: [15],
      dailyReport: { enabled: true, localTime: '22:30' },
      weeklyReport: {
        enabled: options.weeklyEnabled === true,
        isoWeekday: 7,
        localTime: '20:30',
      },
      createdAt: Timestamp.fromDate(new Date(now)),
      updatedAt: Timestamp.fromDate(new Date(now)),
    }),
  ]);
}

function preferenceRef(firestore: Firestore, uid: string) {
  return firestore.doc(`users/${uid}/notificationPreferences/default`);
}

function manifestRef(firestore: Firestore, uid: string, reportType: 'daily' | 'weekly') {
  return firestore.doc(`users/${uid}/reportScheduleManifests/${reportType}`);
}

function completedResult() {
  return {
    outcome: 'completed',
    reportId: `report_${'b'.repeat(56)}`,
    archiveReused: false,
    delivery: 'accepted',
  } as const;
}
