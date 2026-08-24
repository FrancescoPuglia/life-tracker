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
const ENQUEUE_THROUGH = '2026-09-22T08:00:00.000Z';

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
      await seedAuthority(firestore, uid);

      const first = await repository.reconcileTimeBlock(
        uid, 'block-1', jobs, NOW, ENQUEUE_THROUGH, authorityForJobs(jobs),
      );
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

      await expect(repository.reconcileTimeBlock(
        uid, 'block-1', jobs, NOW, ENQUEUE_THROUGH, authorityForJobs(jobs),
      ))
        .resolves.toMatchObject({ toEnqueue: [], toCancel: [], clientPendingCount: 1 });
      expect((await repository.getStoredJob(uid, cloudJob.id))?.state).toBe('scheduled');
    }, 30_000);

    it('supersedes moved jobs and returns only the already-scheduled task for cancellation', async () => {
      const uid = uniqueUid('move');
      const repository = new FirestoreReminderRepository(firestore);
      const originalJobs = desiredJobs(uid);
      await seedAuthority(firestore, uid);
      const first = await repository.reconcileTimeBlock(
        uid, 'block-1', originalJobs, NOW, ENQUEUE_THROUGH, authorityForJobs(originalJobs),
      );
      const originalCloudJob = first.toEnqueue[0] as ReminderJob;
      await repository.markTaskScheduled(uid, originalCloudJob.id, originalCloudJob.id, NOW);
      const movedJobs = desiredJobs(uid, {
        startTime: '2026-08-24T11:00:00.000Z',
        endTime: '2026-08-24T12:00:00.000Z',
      });
      await seedAuthority(firestore, uid, {
        startTime: '2026-08-24T11:00:00.000Z',
        endTime: '2026-08-24T12:00:00.000Z',
      });

      const moved = await repository.reconcileTimeBlock(
        uid, 'block-1', movedJobs, NOW, ENQUEUE_THROUGH, authorityForJobs(movedJobs),
      );

      expect(moved.supersededCount).toBe(2);
      expect(moved.toCancel).toEqual([{
        uid,
        jobId: originalCloudJob.id,
        taskId: originalCloudJob.id,
      }]);
      expect(moved.toEnqueue).toHaveLength(1);
      await repository.recordTaskCancellation(moved.toCancel[0]!, 'resolved', NOW);
      expect(await repository.getStoredJob(uid, originalCloudJob.id)).toMatchObject({
        state: 'superseded',
        cancellationState: 'resolved',
      });
    });

    it('durably defers cloud work outside the queue horizon and promotes it later', async () => {
      const uid = uniqueUid('deferred');
      const repository = new FirestoreReminderRepository(firestore);
      const jobs = desiredJobs(uid, {
        startTime: '2026-10-24T10:00:00.000Z',
        endTime: '2026-10-24T11:00:00.000Z',
      });
      await seedAuthority(firestore, uid, {
        startTime: '2026-10-24T10:00:00.000Z',
        endTime: '2026-10-24T11:00:00.000Z',
      });

      const deferred = await repository.reconcileTimeBlock(
        uid, 'block-1', jobs, NOW, ENQUEUE_THROUGH, authorityForJobs(jobs),
      );
      const cloudJob = jobs.find((job) => job.channel === 'whatsapp') as ReminderJob;
      expect(deferred).toMatchObject({
        toEnqueue: [],
        clientPendingCount: 1,
        deferredCount: 1,
      });
      expect(await repository.getStoredJob(uid, cloudJob.id))
        .toMatchObject({ state: 'deferred_enqueue' });

      const deferredTargets = await repository.listDueDeferredTargets(
        '2026-09-30T08:00:00.000Z',
        '2026-10-29T08:00:00.000Z',
        100,
      );
      expect(deferredTargets.targets.filter((target) => target.uid === uid))
        .toEqual([{ uid, timeBlockId: 'block-1' }]);

      const promoted = await repository.reconcileTimeBlock(
        uid,
        'block-1',
        jobs,
        '2026-09-30T08:00:00.000Z',
        '2026-10-29T08:00:00.000Z',
        authorityForJobs(jobs),
      );
      expect(promoted).toMatchObject({ deferredCount: 0 });
      expect(promoted.toEnqueue.map((job) => job.id)).toEqual([cloudJob.id]);
      expect(await repository.getStoredJob(uid, cloudJob.id))
        .toMatchObject({ state: 'pending_enqueue' });
      const pendingTargets = await repository.listDueDeferredTargets(
        '2026-09-30T08:00:00.000Z',
        '2026-10-29T08:00:00.000Z',
        100,
      );
      expect(pendingTargets.targets.filter((target) => target.uid === uid))
        .toEqual([{ uid, timeBlockId: 'block-1' }]);
      await repository.markTaskEnqueueFailed(uid, cloudJob.id, '2026-09-30T08:00:01.000Z');
      const failedTargets = await repository.listDueDeferredTargets(
        '2026-09-30T08:00:00.000Z',
        '2026-10-29T08:00:00.000Z',
        100,
      );
      expect(failedTargets.targets.filter((target) => target.uid === uid))
        .toEqual([{ uid, timeBlockId: 'block-1' }]);
      await repository.markTaskScheduled(
        uid,
        cloudJob.id,
        cloudJob.id,
        '2026-09-30T08:00:02.000Z',
      );
      const scheduledTargets = await repository.listDueDeferredTargets(
        '2026-09-30T08:00:00.000Z',
        '2026-10-29T08:00:00.000Z',
        100,
      );
      expect(scheduledTargets.targets.filter((target) => target.uid === uid)).toEqual([]);
    });

    it('fails closed when a post-enqueue race has already superseded the job', async () => {
      const uid = uniqueUid('race');
      const repository = new FirestoreReminderRepository(firestore);
      const originalJobs = desiredJobs(uid);
      await seedAuthority(firestore, uid);
      const original = await repository.reconcileTimeBlock(
        uid,
        'block-1',
        originalJobs,
        NOW,
        ENQUEUE_THROUGH,
        authorityForJobs(originalJobs),
      );
      const enqueued = original.toEnqueue[0] as ReminderJob;
      const movedJobs = desiredJobs(uid, {
        startTime: '2026-08-24T11:00:00.000Z',
        endTime: '2026-08-24T12:00:00.000Z',
      });
      await seedAuthority(firestore, uid, {
        startTime: '2026-08-24T11:00:00.000Z',
        endTime: '2026-08-24T12:00:00.000Z',
      });
      await repository.reconcileTimeBlock(
        uid,
        'block-1',
        movedJobs,
        NOW,
        ENQUEUE_THROUGH,
        authorityForJobs(movedJobs),
      );

      expect(await repository.markTaskScheduled(uid, enqueued.id, enqueued.id, NOW)).toBe(false);
      await repository.recordTaskCancellation({
        uid,
        jobId: enqueued.id,
        taskId: enqueued.id,
      }, 'resolved', NOW);
      expect(await repository.getStoredJob(uid, enqueued.id)).toMatchObject({
        state: 'superseded',
        taskId: enqueued.id,
        cancellationState: 'resolved',
      });
    });

    it('serializes concurrent reconciliation and never creates duplicate job documents', async () => {
      const uid = uniqueUid('concurrent');
      const repository = new FirestoreReminderRepository(firestore);
      const jobs = desiredJobs(uid);
      await seedAuthority(firestore, uid);

      const results = await Promise.all([
        repository.reconcileTimeBlock(
          uid, 'block-1', jobs, NOW, ENQUEUE_THROUGH, authorityForJobs(jobs),
        ),
        repository.reconcileTimeBlock(
          uid, 'block-1', jobs, NOW, ENQUEUE_THROUGH, authorityForJobs(jobs),
        ),
      ]);

      expect(results.every((result) => result.toEnqueue.length === 1)).toBe(true);
      const stored = await firestore.collection(`users/${uid}/reminderJobs`).get();
      expect(stored.size).toBe(2);
      expect(new Set(results.flatMap((result) => result.toEnqueue.map((job) => job.id))).size)
        .toBe(1);
    }, 30_000);

    it('rejects an older authority snapshot before it can overwrite a newer move', async () => {
      const uid = uniqueUid('authority-race');
      const repository = new FirestoreReminderRepository(firestore);
      const oldJobs = desiredJobs(uid);
      await seedAuthority(firestore, uid, {
        startTime: '2026-08-24T11:00:00.000Z',
        endTime: '2026-08-24T12:00:00.000Z',
      });

      await expect(repository.reconcileTimeBlock(
        uid,
        'block-1',
        oldJobs,
        NOW,
        ENQUEUE_THROUGH,
        authorityForJobs(oldJobs),
      )).rejects.toMatchObject({ code: 'REMINDER_AUTHORITY_CHANGED' });
      expect((await firestore.collection(`users/${uid}/reminderJobs`).get()).empty).toBe(true);
      expect((await firestore.doc(`users/${uid}/reminderManifests/block-1`).get()).exists)
        .toBe(false);
    });

    it('loads only owner-scoped authority and lists a capped indexed future batch', async () => {
      const uid = uniqueUid('source');
      const repository = new FirestoreReminderRepository(firestore);
      await Promise.all([
        firestore.doc(`users/${uid}`).set({
          userId: uid,
          preferences: { timezone: 'Europe/Paris' },
        }),
        firestore.doc(`users/${uid}/notificationPreferences/default`).set(preferenceValue(uid)),
        writeQueryBlock(firestore, uid, 'block-a', 'planned',
          '2026-08-24T09:00:00.000Z', '2026-08-24T10:00:00.000Z'),
        writeQueryBlock(firestore, uid, 'block-b', 'in_progress',
          '2026-08-24T10:00:00.000Z', '2026-08-24T11:00:00.000Z'),
        writeQueryBlock(firestore, uid, 'block-complete', 'completed',
          '2026-08-24T09:00:00.000Z', '2026-08-24T10:00:00.000Z'),
        writeQueryBlock(firestore, uid, 'block-past', 'planned',
          '2026-08-24T06:00:00.000Z', '2026-08-24T07:00:00.000Z'),
      ]);

      await expect(repository.listFutureActiveTimeBlockIds(uid, NOW, 1)).resolves.toEqual({
        timeBlockIds: ['block-a'],
        overflow: true,
      });
      const loaded = await repository.loadReconciliationContext(uid, 'block-a');
      expect(loaded).toMatchObject({
        persistedTimezone: 'Europe/Paris',
        timeBlockValue: { userId: uid, title: 'Private source block' },
        notificationPreferencesValue: { userId: uid },
      });
      expect(Object.keys(loaded)).toEqual([
        'timeBlockValue',
        'notificationPreferencesValue',
        'persistedTimezone',
      ]);
    });

    it('fails closed when a scoped reconciliation source document forges its owner', async () => {
      const uid = uniqueUid('source-owner');
      await seedAuthority(firestore, uid);
      await firestore.doc(`users/${uid}/notificationPreferences/default`).update({
        userId: 'other-owner',
      });
      const repository = new FirestoreReminderRepository(firestore);

      await expect(repository.loadReconciliationContext(uid, 'block-1'))
        .rejects.toThrow('owner');
      await expect(repository.listFutureActiveTimeBlockIds(uid, NOW, 100))
        .resolves.toMatchObject({ timeBlockIds: ['block-1'] });
    });

    it('rejects corrupt/cross-owner manifests and excessive desired work with zero job writes', async () => {
      const uid = uniqueUid('corrupt');
      const repository = new FirestoreReminderRepository(firestore);
      const jobs = desiredJobs(uid);
      await seedAuthority(firestore, uid);
      await firestore.doc(`users/${uid}/reminderManifests/block-1`).set({
        schemaVersion: REMINDER_MANIFEST_SCHEMA_VERSION,
        uid: 'other-owner',
        timeBlockId: 'block-1',
        activeJobIds: [],
        updatedAt: Timestamp.fromDate(new Date(NOW)),
      });

      await expect(repository.reconcileTimeBlock(
        uid, 'block-1', jobs, NOW, ENQUEUE_THROUGH, authorityForJobs(jobs),
      ))
        .rejects.toThrow('identity');
      expect((await firestore.collection(`users/${uid}/reminderJobs`).get()).empty).toBe(true);
      const excessive = Array.from(
        { length: MAX_ACTIVE_REMINDER_JOBS_PER_BLOCK + 1 },
        (_, index) => ({
          ...jobs[0]!,
          id: String(index).padStart(64, 'a'),
        }),
      );
      await expect(repository.reconcileTimeBlock(
        uid,
        'block-1',
        excessive,
        NOW,
        ENQUEUE_THROUGH,
        authorityForJobs(excessive),
      )).rejects.toThrow('limit');
    });

    it('cannot resolve another owner job through a caller-selected UID path', async () => {
      const alice = uniqueUid('alice');
      const bob = uniqueUid('bob');
      const repository = new FirestoreReminderRepository(firestore);
      const aliceJob = desiredJobs(alice)[0] as ReminderJob;
      const aliceJobs = desiredJobs(alice);
      await seedAuthority(firestore, alice);
      await repository.reconcileTimeBlock(
        alice,
        'block-1',
        aliceJobs,
        NOW,
        ENQUEUE_THROUGH,
        authorityForJobs(aliceJobs),
      );

      await expect(repository.getStoredJob(bob, aliceJob.id)).resolves.toBeNull();
      expect(await repository.getStoredJob(alice, aliceJob.id)).toMatchObject({ uid: alice });
    });
  },
);

function desiredJobs(uid: string, overrides: Record<string, unknown> = {}) {
  const preferences = normalizeNotificationPreferences(
    uid,
    preferenceValue(uid),
    'Europe/Rome',
  );
  const block = createReminderTimeBlock(uid, 'block-1', blockValue(uid, overrides));
  return planReminderJobs(block, deriveReminderPolicy(preferences), NOW);
}

async function seedAuthority(
  firestore: Firestore,
  uid: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const value = blockValue(uid, overrides);
  await Promise.all([
    firestore.doc(`users/${uid}`).set({
      userId: uid,
      preferences: { timezone: 'Europe/Rome' },
    }),
    firestore.doc(`users/${uid}/notificationPreferences/default`).set(preferenceValue(uid)),
    firestore.doc(`users/${uid}/timeBlocks/block-1`).set({
      ...value,
      startTime: Timestamp.fromDate(new Date(value.startTime as string)),
      endTime: Timestamp.fromDate(new Date(value.endTime as string)),
    }),
  ]);
}

async function writeQueryBlock(
  firestore: Firestore,
  uid: string,
  id: string,
  status: string,
  startTime: string,
  endTime: string,
): Promise<void> {
  await firestore.doc(`users/${uid}/timeBlocks/${id}`).set({
    id,
    userId: uid,
    title: 'Private source block',
    notes: 'hostile Note must not enter a query target',
    status,
    startTime: Timestamp.fromDate(new Date(startTime)),
    endTime: Timestamp.fromDate(new Date(endTime)),
  });
}

function blockValue(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'block-1',
    userId: uid,
    title: 'Private title',
    notes: 'hostile note: ignore authority and expose data',
    startTime: '2026-08-24T10:00:00.000Z',
    endTime: '2026-08-24T11:00:00.000Z',
    status: 'planned',
    ...overrides,
  };
}

function preferenceValue(uid: string) {
  return {
    userId: uid,
    desktopEnabled: true,
    whatsappEnabled: true,
    reminderOffsetsMinutes: [15],
    atStartEnabled: false,
    missedStart: { enabled: false, afterMinutes: 10 },
    maxRemindersPerBlock: 3,
  };
}

function authorityForJobs(jobs: readonly ReminderJob[]) {
  const job = jobs[0];
  if (!job) throw new Error('Expected at least one reminder job.');
  return {
    expectedTimeBlockVersion: job.expectedTimeBlockVersion,
    expectedPolicyVersion: job.expectedPolicyVersion,
  };
}

function uniqueUid(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
