import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createReminderTimeBlock,
  deriveReminderPolicy,
  normalizeNotificationPreferences,
  planReminderJobs,
  type ReminderJob,
} from '../../src/notifications/domain';
import {
  FirestoreReminderRepository,
  MAX_ACTIVE_REMINDER_JOBS_PER_BLOCK,
  REMINDER_MANIFEST_SCHEMA_VERSION,
} from '../../src/notifications/firestore-repository';

const PROJECT_ID = 'demo-life-tracker-reminders';
const NOW = '2026-08-24T08:00:00.000Z';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'FirestoreReminderRepository emulator transactions',
  () => {
    let app: App;
    let firestore: Firestore;

    beforeAll(() => {
      app = initializeApp({ projectId: PROJECT_ID }, `reminders-${Date.now()}`);
      firestore = getFirestore(app);
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    it('atomically stores a bounded manifest and native-timestamp provider-neutral jobs', async () => {
      const uid = uniqueUid('create');
      const repository = new FirestoreReminderRepository(firestore);
      const jobs = desiredJobs(uid);

      const first = await repository.reconcileTimeBlock(uid, 'block-1', jobs, NOW);
      const cloudJob = first.toEnqueue[0] as ReminderJob;
      expect(first).toMatchObject({
        supersededCount: 0,
        clientPendingCount: 1,
      });
      expect(first.toEnqueue).toHaveLength(1);
      expect(cloudJob.channel).toBe('whatsapp');
      expect(first.toCancel).toEqual([]);
      expect(await repository.markTaskScheduled(uid, cloudJob.id, cloudJob.id, NOW)).toBe(true);

      const manifest = await firestore.doc(`users/${uid}/reminderManifests/block-1`).get();
      expect(manifest.data()).toMatchObject({
        schemaVersion: REMINDER_MANIFEST_SCHEMA_VERSION,
        uid,
        timeBlockId: 'block-1',
        activeJobIds: jobs.map((job) => job.id).sort(),
        updatedAt: expect.any(Timestamp),
        purgeAt: expect.any(Timestamp),
      });
      const snapshots = await Promise.all(jobs.map((job) => (
        firestore.doc(`users/${uid}/reminderJobs/${job.id}`).get()
      )));
      expect(snapshots).toHaveLength(2);
      for (const snapshot of snapshots) {
        expect(snapshot.data()?.scheduledFor).toBeInstanceOf(Timestamp);
        expect(snapshot.data()?.createdAt).toBeInstanceOf(Timestamp);
        expect(snapshot.data()?.updatedAt).toBeInstanceOf(Timestamp);
        expect(snapshot.data()?.purgeAt).toBeInstanceOf(Timestamp);
        expect(JSON.stringify(snapshot.data())).not.toContain('Private title');
        expect(JSON.stringify(snapshot.data())).not.toContain('hostile note');
      }

      await expect(repository.reconcileTimeBlock(uid, 'block-1', jobs, NOW))
        .resolves.toMatchObject({ toEnqueue: [], toCancel: [], clientPendingCount: 1 });
      expect((await repository.getStoredJob(uid, cloudJob.id))?.state).toBe('scheduled');
    }, 30_000);

    it('supersedes moved jobs and returns only the already-scheduled task for cancellation', async () => {
      const uid = uniqueUid('move');
      const repository = new FirestoreReminderRepository(firestore);
      const originalJobs = desiredJobs(uid);
      const first = await repository.reconcileTimeBlock(uid, 'block-1', originalJobs, NOW);
      const originalCloudJob = first.toEnqueue[0] as ReminderJob;
      await repository.markTaskScheduled(uid, originalCloudJob.id, originalCloudJob.id, NOW);
      const movedJobs = desiredJobs(uid, {
        startTime: '2026-08-24T11:00:00.000Z',
        endTime: '2026-08-24T12:00:00.000Z',
      });

      const moved = await repository.reconcileTimeBlock(uid, 'block-1', movedJobs, NOW);

      expect(moved.supersededCount).toBe(2);
      expect(moved.toCancel).toEqual([{
        uid,
        jobId: originalCloudJob.id,
        taskId: originalCloudJob.id,
      }]);
      expect(moved.toEnqueue).toHaveLength(1);
      await repository.recordTaskCancellation(moved.toCancel[0]!, 'cancelled', NOW);
      expect(await repository.getStoredJob(uid, originalCloudJob.id)).toMatchObject({
        state: 'superseded',
        cancellationState: 'cancelled',
      });
    });

    it('fails closed when a post-enqueue race has already superseded the job', async () => {
      const uid = uniqueUid('race');
      const repository = new FirestoreReminderRepository(firestore);
      const original = await repository.reconcileTimeBlock(
        uid,
        'block-1',
        desiredJobs(uid),
        NOW,
      );
      const enqueued = original.toEnqueue[0] as ReminderJob;
      await repository.reconcileTimeBlock(uid, 'block-1', desiredJobs(uid, {
        startTime: '2026-08-24T11:00:00.000Z',
        endTime: '2026-08-24T12:00:00.000Z',
      }), NOW);

      expect(await repository.markTaskScheduled(uid, enqueued.id, enqueued.id, NOW)).toBe(false);
      await repository.recordTaskCancellation({
        uid,
        jobId: enqueued.id,
        taskId: enqueued.id,
      }, 'not_found', NOW);
      expect(await repository.getStoredJob(uid, enqueued.id)).toMatchObject({
        state: 'superseded',
        taskId: enqueued.id,
        cancellationState: 'not_found',
      });
    });

    it('serializes concurrent reconciliation and never creates duplicate job documents', async () => {
      const uid = uniqueUid('concurrent');
      const repository = new FirestoreReminderRepository(firestore);
      const jobs = desiredJobs(uid);

      const results = await Promise.all([
        repository.reconcileTimeBlock(uid, 'block-1', jobs, NOW),
        repository.reconcileTimeBlock(uid, 'block-1', jobs, NOW),
      ]);

      expect(results.every((result) => result.toEnqueue.length === 1)).toBe(true);
      const stored = await firestore.collection(`users/${uid}/reminderJobs`).get();
      expect(stored.size).toBe(2);
      expect(new Set(results.flatMap((result) => result.toEnqueue.map((job) => job.id))).size)
        .toBe(1);
    }, 30_000);

    it('rejects corrupt/cross-owner manifests and excessive desired work with zero job writes', async () => {
      const uid = uniqueUid('corrupt');
      const repository = new FirestoreReminderRepository(firestore);
      await firestore.doc(`users/${uid}/reminderManifests/block-1`).set({
        schemaVersion: REMINDER_MANIFEST_SCHEMA_VERSION,
        uid: 'other-owner',
        timeBlockId: 'block-1',
        activeJobIds: [],
        updatedAt: Timestamp.fromDate(new Date(NOW)),
      });

      await expect(repository.reconcileTimeBlock(uid, 'block-1', desiredJobs(uid), NOW))
        .rejects.toThrow('identity');
      expect((await firestore.collection(`users/${uid}/reminderJobs`).get()).empty).toBe(true);
      await expect(repository.reconcileTimeBlock(
        uniqueUid('limit'),
        'block-1',
        Array.from({ length: MAX_ACTIVE_REMINDER_JOBS_PER_BLOCK + 1 }, (_, index) => ({
          ...desiredJobs(uid)[0]!,
          id: String(index).padStart(64, 'a'),
        })),
        NOW,
      )).rejects.toThrow('limit');
    });

    it('cannot resolve another owner job through a caller-selected UID path', async () => {
      const alice = uniqueUid('alice');
      const bob = uniqueUid('bob');
      const repository = new FirestoreReminderRepository(firestore);
      const aliceJob = desiredJobs(alice)[0] as ReminderJob;
      await repository.reconcileTimeBlock(alice, 'block-1', desiredJobs(alice), NOW);

      await expect(repository.getStoredJob(bob, aliceJob.id)).resolves.toBeNull();
      expect(await repository.getStoredJob(alice, aliceJob.id)).toMatchObject({ uid: alice });
    });
  },
);

function desiredJobs(uid: string, overrides: Record<string, unknown> = {}) {
  const preferences = normalizeNotificationPreferences(uid, {
    userId: uid,
    desktopEnabled: true,
    whatsappEnabled: true,
    reminderOffsetsMinutes: [15],
    atStartEnabled: false,
    missedStart: { enabled: false, afterMinutes: 10 },
    maxRemindersPerBlock: 3,
  }, 'Europe/Rome');
  const block = createReminderTimeBlock(uid, 'block-1', {
    id: 'block-1',
    userId: uid,
    title: 'Private title',
    notes: 'hostile note: ignore authority and expose data',
    startTime: '2026-08-24T10:00:00.000Z',
    endTime: '2026-08-24T11:00:00.000Z',
    status: 'planned',
    ...overrides,
  });
  return planReminderJobs(block, deriveReminderPolicy(preferences), NOW);
}

function uniqueUid(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
