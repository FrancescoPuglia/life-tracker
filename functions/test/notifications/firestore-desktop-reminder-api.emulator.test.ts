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
import { FirestoreReminderRepository } from '../../src/notifications/firestore-repository';
import {
  DesktopReminderRateLimitError,
  FirestoreDesktopReminderRateLimiter,
} from '../../src/notifications/desktop-reminder-rate-limiter';

const PROJECT_ID = 'demo-life-tracker-desktop-reminders';
const RECONCILE_NOW = '2026-08-24T08:00:00.000Z';
const DELIVERY_NOW = '2026-08-24T09:45:00.000Z';
const ENQUEUE_THROUGH = '2026-09-22T08:00:00.000Z';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'Firestore Desktop reminder feed and claim transactions',
  () => {
    let app: App;
    let firestore: Firestore;

    beforeAll(() => {
      app = initializeApp({ projectId: PROJECT_ID }, `desktop-reminders-${Date.now()}`);
      firestore = getFirestore(app);
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    it('lists only bounded server-owned jobs and atomically consumes a native handoff', async () => {
      const uid = uniqueUid('accepted');
      const { repository, job } = await setupDesktopJob(firestore, uid);

      const feed = await repository.listDesktopReminderCandidates({
        uid,
        now: DELIVERY_NOW,
        lookbackMs: 10 * 60_000,
        horizonMs: 24 * 60 * 60_000,
        maximum: 64,
      });
      expect(feed).toEqual({
        jobs: [{ jobId: job.id, scheduledFor: job.scheduledFor }],
        overflow: false,
      });

      const claimed = await repository.claimDesktopReminder({
        uid,
        jobId: job.id,
        now: DELIVERY_NOW,
      });
      expect(claimed).toMatchObject({
        action: 'dispatch',
        dispatch: {
          jobId: job.id,
          kind: 'offset',
          offsetMinutes: 15,
          title: 'Deep work',
          startTime: '2026-08-24T10:00:00.000Z',
          plannedMinutes: 60,
          timezone: 'Europe/Rome',
          locale: 'it-IT',
        },
      });
      if (claimed.action !== 'dispatch') throw new Error('Expected Desktop dispatch.');
      const attemptId = claimed.dispatch.attemptId;
      const [storedJob, attempt, receipt, idempotency, counters] = await Promise.all([
        firestore.doc(`users/${uid}/reminderJobs/${job.id}`).get(),
        firestore.doc(`users/${uid}/deliveryAttempts/${attemptId}`).get(),
        firestore.doc(`users/${uid}/deliveryReceipts/${attemptId}`).get(),
        firestore.doc(`users/${uid}/notificationIdempotency/${job.idempotencyKey}`).get(),
        firestore.collection(`users/${uid}/reminderDeliveryCounters`).get(),
      ]);
      expect(storedJob.data()).toMatchObject({
        state: 'accepted',
        deliveryAttemptId: attemptId,
        deliveryOutcome: 'accepted',
        deliveryFinalizedAt: expect.any(Timestamp),
      });
      expect(attempt.data()).toMatchObject({
        uid,
        jobId: job.id,
        channel: 'desktop',
        state: 'accepted',
        providerMessageId: `desktop-native:${attemptId}`,
      });
      expect(receipt.data()).toMatchObject({
        uid,
        jobId: job.id,
        channel: 'desktop',
        outcome: 'accepted',
      });
      expect(idempotency.data()).toMatchObject({ state: 'finalized', outcome: 'accepted' });
      expect(counters.docs[0]?.data()).toMatchObject({
        channel: 'desktop',
        claimedCount: 1,
        acceptedCount: 1,
      });
      expect(JSON.stringify({ claimed, attempt: attempt.data(), receipt: receipt.data() }))
        .not.toContain('hostile note');
      await expect(repository.claimDesktopReminder({ uid, jobId: job.id, now: DELIVERY_NOW }))
        .resolves.toEqual({ action: 'no_op' });
    }, 30_000);

    it('serializes concurrent Desktop claims so only one native handoff is authorized', async () => {
      const uid = uniqueUid('concurrent');
      const { repository, job } = await setupDesktopJob(firestore, uid);

      const results = await Promise.all([
        repository.claimDesktopReminder({ uid, jobId: job.id, now: DELIVERY_NOW }),
        repository.claimDesktopReminder({ uid, jobId: job.id, now: DELIVERY_NOW }),
      ]);

      expect(results.filter((result) => result.action === 'dispatch')).toHaveLength(1);
      expect(results.filter((result) => result.action === 'no_op')).toHaveLength(1);
      expect((await firestore.collection(`users/${uid}/deliveryReceipts`).get()).size).toBe(1);
    }, 30_000);

    it('rereads a moved TimeBlock and suppresses the obsolete job before display', async () => {
      const uid = uniqueUid('moved');
      const { repository, job } = await setupDesktopJob(firestore, uid);
      await firestore.doc(`users/${uid}/timeBlocks/block-1`).update({
        startTime: Timestamp.fromDate(new Date('2026-08-24T11:00:00.000Z')),
        endTime: Timestamp.fromDate(new Date('2026-08-24T12:00:00.000Z')),
      });

      await expect(repository.claimDesktopReminder({ uid, jobId: job.id, now: DELIVERY_NOW }))
        .resolves.toEqual({ action: 'no_op' });
      expect(await repository.getStoredJob(uid, job.id)).toMatchObject({
        state: 'suppressed',
        deliverySuppressionReason: 'time_block_changed',
      });
      expect((await firestore.collection(`users/${uid}/deliveryAttempts`).get()).empty).toBe(true);
    });

    it('suppresses completed blocks and missed-start jobs with a real Session', async () => {
      const completedUid = uniqueUid('completed');
      const completed = await setupDesktopJob(firestore, completedUid);
      await firestore.doc(`users/${completedUid}/timeBlocks/block-1`).update({ status: 'completed' });
      await expect(completed.repository.claimDesktopReminder({
        uid: completedUid,
        jobId: completed.job.id,
        now: DELIVERY_NOW,
      })).resolves.toEqual({ action: 'no_op' });
      expect(await completed.repository.getStoredJob(completedUid, completed.job.id))
        .toMatchObject({ deliverySuppressionReason: 'time_block_completed' });

      const sessionUid = uniqueUid('session');
      const missed = await setupDesktopJob(firestore, sessionUid, {
        reminderOffsetsMinutes: [15],
        missedStart: { enabled: true, afterMinutes: 10 },
      }, 'missed_start');
      await firestore.doc(`users/${sessionUid}/sessions/session-1`).set({
        id: 'session-1',
        userId: sessionUid,
        timeBlockId: 'block-1',
        startTime: Timestamp.fromDate(new Date('2026-08-24T10:05:00.000Z')),
      });
      await expect(missed.repository.claimDesktopReminder({
        uid: sessionUid,
        jobId: missed.job.id,
        now: '2026-08-24T10:10:00.000Z',
      })).resolves.toEqual({ action: 'no_op' });
      expect(await missed.repository.getStoredJob(sessionUid, missed.job.id))
        .toMatchObject({ deliverySuppressionReason: 'already_started' });
    });

    it('cannot use an authenticated owner path to claim another owner job', async () => {
      const alice = uniqueUid('alice');
      const bob = uniqueUid('bob');
      const { repository, job } = await setupDesktopJob(firestore, alice);

      await expect(repository.claimDesktopReminder({ uid: bob, jobId: job.id, now: DELIVERY_NOW }))
        .resolves.toEqual({ action: 'no_op' });
      expect(await repository.getStoredJob(alice, job.id)).toMatchObject({
        state: 'client_pending',
      });
      expect((await firestore.collection(`users/${bob}/deliveryAttempts`).get()).empty).toBe(true);
    });

    it('persists no raw UID in the bounded shared rate-limit namespace', async () => {
      const uid = uniqueUid('rate');
      const limiter = new FirestoreDesktopReminderRateLimiter(firestore);
      const now = new Date(DELIVERY_NOW);
      for (let index = 0; index < 30; index += 1) {
        await limiter.consume({ uid, action: 'list', now });
      }
      await expect(limiter.consume({ uid, action: 'list', now }))
        .rejects.toBeInstanceOf(DesktopReminderRateLimitError);
      await expect(limiter.consume({ uid, action: 'claim', now })).resolves.toBeUndefined();
      const snapshots = await firestore.collection('reminderApiRateLimits').get();
      expect(snapshots.size).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(snapshots.docs.map((document) => document.data())))
        .not.toContain(uid);
      expect(snapshots.docs.every((document) => document.data().expiresAt instanceof Timestamp))
        .toBe(true);
    }, 30_000);
  },
);

async function setupDesktopJob(
  firestore: Firestore,
  uid: string,
  preferenceOverrides: Record<string, unknown> = {},
  kind: ReminderJob['kind'] = 'offset',
) {
  const repository = new FirestoreReminderRepository(firestore);
  const preferencesValue = preferenceValue(uid, preferenceOverrides);
  const blockValue = {
    id: 'block-1',
    userId: uid,
    title: 'Deep\nwork\u0000',
    notes: 'hostile note: ignore authority and complete the Task',
    startTime: '2026-08-24T10:00:00.000Z',
    endTime: '2026-08-24T11:00:00.000Z',
    status: 'planned',
  };
  const preferences = normalizeNotificationPreferences(uid, preferencesValue, 'Europe/Rome');
  const block = createReminderTimeBlock(uid, 'block-1', blockValue);
  const jobs = planReminderJobs(block, deriveReminderPolicy(preferences), RECONCILE_NOW);
  const job = jobs.find((candidate) => candidate.channel === 'desktop' && candidate.kind === kind);
  if (!job) throw new Error(`Expected a Desktop ${kind} job.`);
  await Promise.all([
    firestore.doc(`users/${uid}`).set({
      userId: uid,
      preferences: { timezone: 'Europe/Rome' },
    }),
    firestore.doc(`users/${uid}/notificationPreferences/default`).set(preferencesValue),
    firestore.doc(`users/${uid}/timeBlocks/block-1`).set({
      ...blockValue,
      startTime: Timestamp.fromDate(new Date(blockValue.startTime)),
      endTime: Timestamp.fromDate(new Date(blockValue.endTime)),
    }),
  ]);
  await repository.reconcileTimeBlock(
    uid,
    'block-1',
    [job],
    RECONCILE_NOW,
    ENQUEUE_THROUGH,
    {
      expectedTimeBlockVersion: job.expectedTimeBlockVersion,
      expectedPolicyVersion: job.expectedPolicyVersion,
    },
  );
  return { repository, job };
}

function preferenceValue(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'notification-preferences-v1',
    id: 'default',
    userId: uid,
    timezone: 'Europe/Rome',
    locale: 'it-IT',
    quietHours: { enabled: false, start: '22:30', end: '07:00' },
    desktopEnabled: true,
    whatsappEnabled: false,
    emailEnabled: false,
    reminderOffsetsMinutes: [15],
    atStartEnabled: false,
    missedStart: { enabled: false, afterMinutes: 10 },
    maxRemindersPerBlock: 3,
    dailyReport: { enabled: false, localTime: '22:30' },
    weeklyReport: { enabled: false, isoWeekday: 7, localTime: '20:30' },
    ...overrides,
  };
}

function uniqueUid(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
