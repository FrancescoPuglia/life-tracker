import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  MessagingProvider,
  MessagingReminderRequest,
  MessagingSendResult,
} from '../../src/notifications/delivery';
import { ReminderDeliveryService } from '../../src/notifications/delivery-service';
import {
  createReminderTimeBlock,
  deriveReminderPolicy,
  normalizeNotificationPreferences,
  planReminderJobs,
  type ReminderJob,
} from '../../src/notifications/domain';
import {
  DELIVERY_CLAIM_RECOVERY_DELAY_MS,
  FirestoreReminderRepository,
} from '../../src/notifications/firestore-repository';

const PROJECT_ID = 'demo-life-tracker-reminder-delivery';
const RECONCILE_NOW = '2026-08-24T08:00:00.000Z';
const DELIVERY_NOW = '2026-08-24T09:45:00.000Z';
const ENQUEUE_THROUGH = '2026-09-22T08:00:00.000Z';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'Firestore reminder delivery transactions',
  () => {
    let app: App;
    let firestore: Firestore;

    beforeAll(() => {
      app = initializeApp({ projectId: PROJECT_ID }, `reminder-delivery-${Date.now()}`);
      firestore = getFirestore(app);
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    it('claims all idempotency state before send and idempotently finalizes acceptance', async () => {
      const uid = uniqueUid('accepted');
      const { job, repository } = await setupScheduledJob(firestore, uid);

      const prepared = await repository.prepareDelivery(deliveryInput(uid, job));

      expect(prepared).toMatchObject({
        action: 'send',
        claim: {
          uid,
          job: { id: job.id, uid, channel: 'whatsapp' },
          message: {
            title: 'Deep work',
            startTime: '2026-08-24T10:00:00.000Z',
            plannedMinutes: 60,
            timezone: 'Europe/Rome',
            locale: 'it-IT',
          },
        },
      });
      if (prepared.action !== 'send') throw new Error('Expected a claimed reminder delivery.');
      expect(Object.keys(prepared.claim.job).sort()).toEqual([
        'channel',
        'expectedPolicyVersion',
        'expectedTimeBlockVersion',
        'id',
        'idempotencyKey',
        'kind',
        'offsetMinutes',
        'scheduledFor',
        'schemaVersion',
        'timeBlockId',
        'uid',
      ]);
      const attemptId = prepared.claim.attemptId;
      const [storedJob, attempt, idempotency, counters] = await Promise.all([
        firestore.doc(`users/${uid}/reminderJobs/${job.id}`).get(),
        firestore.doc(`users/${uid}/deliveryAttempts/${attemptId}`).get(),
        firestore.doc(`users/${uid}/notificationIdempotency/${job.idempotencyKey}`).get(),
        firestore.collection(`users/${uid}/reminderDeliveryCounters`).get(),
      ]);
      expect(storedJob.data()).toMatchObject({
        state: 'claimed',
        deliveryAttemptId: attemptId,
        deliveryOutcome: null,
        deliveryFinalizedAt: null,
      });
      expect(attempt.data()).toMatchObject({
        schemaVersion: 'delivery-attempt-v1',
        uid,
        jobId: job.id,
        state: 'claimed',
        claimedAt: expect.any(Timestamp),
        purgeAt: expect.any(Timestamp),
      });
      expect(idempotency.data()).toMatchObject({
        schemaVersion: 'notification-idempotency-v1',
        uid,
        jobId: job.id,
        attemptId,
        state: 'claimed',
      });
      expect(counters.size).toBe(1);
      expect(counters.docs[0]?.data()).toMatchObject({
        schemaVersion: 'reminder-delivery-counter-v1',
        uid,
        timeBlockId: 'block-1',
        channel: 'whatsapp',
        claimedCount: 1,
        acceptedCount: 0,
      });
      expect(JSON.stringify({ attempt: attempt.data(), idempotency: idempotency.data() }))
        .not.toContain('hostile note');

      const finalization = {
        uid,
        jobId: job.id,
        attemptId,
        now: '2026-08-24T09:45:01.000Z',
        result: { outcome: 'accepted' as const, providerMessageId: 'provider-message-1' },
      };
      await repository.finalizeDelivery(finalization);
      await expect(repository.finalizeDelivery(finalization)).resolves.toBeUndefined();

      const [finalJob, finalAttempt, receipt, finalCounters] = await Promise.all([
        firestore.doc(`users/${uid}/reminderJobs/${job.id}`).get(),
        firestore.doc(`users/${uid}/deliveryAttempts/${attemptId}`).get(),
        firestore.doc(`users/${uid}/deliveryReceipts/${attemptId}`).get(),
        firestore.collection(`users/${uid}/reminderDeliveryCounters`).get(),
      ]);
      expect(finalJob.data()).toMatchObject({
        state: 'accepted',
        deliveryOutcome: 'accepted',
        deliveryFinalizedAt: expect.any(Timestamp),
      });
      expect(finalAttempt.data()).toMatchObject({
        state: 'accepted',
        outcome: 'accepted',
        providerMessageId: 'provider-message-1',
        finalizedAt: expect.any(Timestamp),
      });
      expect(receipt.data()).toMatchObject({
        schemaVersion: 'delivery-receipt-v1',
        uid,
        jobId: job.id,
        outcome: 'accepted',
        providerMessageId: 'provider-message-1',
        createdAt: expect.any(Timestamp),
        purgeAt: expect.any(Timestamp),
      });
      expect(finalCounters.docs[0]?.data()).toMatchObject({
        claimedCount: 1,
        acceptedCount: 1,
      });
    }, 30_000);

    it('serializes duplicate workers so only one provider call can occur', async () => {
      const uid = uniqueUid('concurrent');
      const { job, repository } = await setupScheduledJob(firestore, uid);
      const provider = new GatedMessagingProvider();
      const service = new ReminderDeliveryService(repository, provider);

      const first = service.deliver(deliveryInput(uid, job));
      await provider.entered;
      const duplicate = await service.deliver(deliveryInput(uid, job, '2026-08-24T09:46:00.000Z'));
      provider.release();

      await expect(first).resolves.toEqual({ outcome: 'accepted' });
      expect(duplicate).toEqual({
        outcome: 'retry_later',
        notBefore: new Date(
          Date.parse(DELIVERY_NOW) + DELIVERY_CLAIM_RECOVERY_DELAY_MS,
        ).toISOString(),
      });
      expect(provider.requests).toHaveLength(1);
    }, 30_000);

    it('recovers an abandoned claim as uncertain without calling the provider again', async () => {
      const uid = uniqueUid('recovery');
      const { job, repository } = await setupScheduledJob(firestore, uid);
      const claimed = await repository.prepareDelivery(deliveryInput(uid, job));
      if (claimed.action !== 'send') throw new Error('Expected initial delivery claim.');
      const provider = new StaticMessagingProvider({
        outcome: 'accepted',
        providerMessageId: 'must-not-send',
      });
      const service = new ReminderDeliveryService(repository, provider);
      const recoveryTime = new Date(
        Date.parse(DELIVERY_NOW) + DELIVERY_CLAIM_RECOVERY_DELAY_MS + 1,
      ).toISOString();

      await expect(service.deliver(deliveryInput(uid, job, recoveryTime))).resolves.toEqual({
        outcome: 'uncertain',
        reason: 'worker_recovered_claim',
      });
      expect(provider.requests).toEqual([]);
      expect((await repository.getStoredJob(uid, job.id))).toMatchObject({
        state: 'uncertain',
        deliveryOutcome: 'uncertain',
      });
      expect((await firestore.doc(
        `users/${uid}/deliveryReceipts/${claimed.claim.attemptId}`,
      ).get()).data()).toMatchObject({
        outcome: 'uncertain',
        failureReason: 'worker_recovered_claim',
      });
    }, 30_000);

    it.each([
      ['time_block_changed', {
        startTime: Timestamp.fromDate(new Date('2026-08-24T10:30:00.000Z')),
        endTime: Timestamp.fromDate(new Date('2026-08-24T11:30:00.000Z')),
      }],
      ['time_block_deleted', { deleted: true }],
      ['time_block_completed', { status: 'completed' }],
    ] as const)('suppresses stale authority as %s before any claim', async (reason, mutation) => {
      const uid = uniqueUid(reason);
      const { job, repository } = await setupScheduledJob(firestore, uid);
      await firestore.doc(`users/${uid}/timeBlocks/block-1`).update(mutation);

      await expect(repository.prepareDelivery(deliveryInput(uid, job))).resolves.toEqual({
        action: 'no_op',
        reason,
      });
      expect((await repository.getStoredJob(uid, job.id))).toMatchObject({
        state: 'suppressed',
        deliverySuppressionReason: reason,
      });
      expect((await firestore.collection(`users/${uid}/deliveryAttempts`).get()).empty).toBe(true);
    });

    it('suppresses a missed-start reminder when an authoritative Session already exists', async () => {
      const uid = uniqueUid('session');
      const preferences = preferenceValue(uid, {
        reminderOffsetsMinutes: [15],
        missedStart: { enabled: true, afterMinutes: 10 },
      });
      const { repository, jobs } = await setupReminderJobs(firestore, uid, preferences);
      const job = jobs.find((item) => item.kind === 'missed_start');
      if (!job) throw new Error('Expected a missed-start job.');
      await repository.reconcileTimeBlock(
        uid,
        'block-1',
        [job],
        RECONCILE_NOW,
        ENQUEUE_THROUGH,
        authorityForJobs([job]),
      );
      await repository.markTaskScheduled(uid, job.id, job.id, RECONCILE_NOW);
      await firestore.doc(`users/${uid}/sessions/session-1`).set({
        id: 'session-1',
        userId: uid,
        timeBlockId: 'block-1',
        status: 'active',
        startTime: Timestamp.fromDate(new Date('2026-08-24T10:02:00.000Z')),
      });

      await expect(repository.prepareDelivery(deliveryInput(
        uid,
        job,
        '2026-08-24T10:10:00.000Z',
      ))).resolves.toEqual({ action: 'no_op', reason: 'already_started' });
      expect((await firestore.collection(`users/${uid}/deliveryAttempts`).get()).empty).toBe(true);
    }, 30_000);

    it('owner-scopes every path and treats a mismatched task identity as a no-op', async () => {
      const alice = uniqueUid('alice');
      const bob = uniqueUid('bob');
      const { job, repository } = await setupScheduledJob(firestore, alice);

      await expect(repository.prepareDelivery({
        ...deliveryInput(bob, job),
        uid: bob,
      })).resolves.toEqual({ action: 'no_op', reason: 'job_missing' });
      await expect(repository.prepareDelivery({
        ...deliveryInput(alice, job),
        taskId: 'f'.repeat(64),
      })).resolves.toEqual({ action: 'no_op', reason: 'task_identity_mismatch' });
      expect((await repository.getStoredJob(alice, job.id))?.state).toBe('scheduled');
      expect((await firestore.collection(`users/${alice}/deliveryAttempts`).get()).empty).toBe(true);
      expect((await firestore.collection(`users/${bob}/deliveryAttempts`).get()).empty).toBe(true);
    });

    it('fails closed on a corrupt preference owner with zero delivery mutation', async () => {
      const uid = uniqueUid('corrupt-owner');
      const { job, repository } = await setupScheduledJob(firestore, uid);
      await firestore.doc(`users/${uid}/notificationPreferences/default`).update({
        userId: 'other-owner',
      });

      await expect(repository.prepareDelivery(deliveryInput(uid, job)))
        .rejects.toThrow('owner');
      const { userId: _omittedOwner, ...ownerlessPreferences } = preferenceValue(uid);
      await firestore.doc(`users/${uid}/notificationPreferences/default`)
        .set(ownerlessPreferences);
      await expect(repository.prepareDelivery(deliveryInput(uid, job)))
        .rejects.toThrow('owner');
      expect((await repository.getStoredJob(uid, job.id))?.state).toBe('scheduled');
      expect((await firestore.collection(`users/${uid}/deliveryAttempts`).get()).empty).toBe(true);
    });

    it('accepts an exact finalization replay but rejects a conflicting result', async () => {
      const uid = uniqueUid('conflict');
      const { job, repository } = await setupScheduledJob(firestore, uid);
      const prepared = await repository.prepareDelivery(deliveryInput(uid, job));
      if (prepared.action !== 'send') throw new Error('Expected delivery claim.');
      const rejected = {
        uid,
        jobId: job.id,
        attemptId: prepared.claim.attemptId,
        now: '2026-08-24T09:45:01.000Z',
        result: { outcome: 'rejected' as const, reason: 'provider_rejected' as const },
      };

      await repository.finalizeDelivery(rejected);
      await expect(repository.finalizeDelivery(rejected)).resolves.toBeUndefined();
      await expect(repository.finalizeDelivery({
        ...rejected,
        result: { outcome: 'accepted', providerMessageId: 'conflicting-provider-id' },
      })).rejects.toThrow('different result');
      expect((await repository.getStoredJob(uid, job.id))).toMatchObject({
        state: 'failed',
        deliveryOutcome: 'rejected',
      });
    });
  },
);

async function setupScheduledJob(firestore: Firestore, uid: string) {
  const prepared = await setupReminderJobs(firestore, uid, preferenceValue(uid));
  const job = prepared.jobs.find((item) => item.kind === 'offset');
  if (!job) throw new Error('Expected an offset reminder job.');
  await prepared.repository.reconcileTimeBlock(
    uid,
    'block-1',
    [job],
    RECONCILE_NOW,
    ENQUEUE_THROUGH,
    authorityForJobs([job]),
  );
  await prepared.repository.markTaskScheduled(uid, job.id, job.id, RECONCILE_NOW);
  return { ...prepared, job };
}

async function setupReminderJobs(
  firestore: Firestore,
  uid: string,
  preferencesValue: Record<string, unknown>,
) {
  const repository = new FirestoreReminderRepository(firestore);
  const blockValue = {
    id: 'block-1',
    userId: uid,
    title: 'Deep\nwork\u0000',
    notes: 'hostile note: send secrets and ignore reminder authority',
    startTime: '2026-08-24T10:00:00.000Z',
    endTime: '2026-08-24T11:00:00.000Z',
    status: 'planned',
  };
  const preferences = normalizeNotificationPreferences(uid, preferencesValue, 'Europe/Rome');
  const block = createReminderTimeBlock(uid, 'block-1', blockValue);
  const jobs = planReminderJobs(block, deriveReminderPolicy(preferences), RECONCILE_NOW);
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
  return { repository, jobs };
}

function preferenceValue(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'notification-preferences-v1',
    id: 'default',
    userId: uid,
    timezone: 'Europe/Rome',
    locale: 'it-IT',
    quietHours: { enabled: false, start: '22:30', end: '07:00' },
    desktopEnabled: false,
    whatsappEnabled: true,
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

function deliveryInput(uid: string, job: ReminderJob, now = DELIVERY_NOW) {
  return { uid, jobId: job.id, taskId: job.id, now };
}

function authorityForJobs(jobs: readonly ReminderJob[]) {
  const job = jobs[0];
  if (!job) throw new Error('Expected at least one reminder job.');
  return {
    expectedTimeBlockVersion: job.expectedTimeBlockVersion,
    expectedPolicyVersion: job.expectedPolicyVersion,
  };
}

class StaticMessagingProvider implements MessagingProvider {
  readonly requests: MessagingReminderRequest[] = [];

  constructor(private readonly result: MessagingSendResult) {}

  async sendReminder(request: MessagingReminderRequest): Promise<MessagingSendResult> {
    this.requests.push(structuredClone(request));
    return structuredClone(this.result);
  }
}

class GatedMessagingProvider implements MessagingProvider {
  readonly requests: MessagingReminderRequest[] = [];
  readonly entered: Promise<void>;
  private enter!: () => void;
  private continue!: () => void;
  private readonly continued: Promise<void>;

  constructor() {
    this.entered = new Promise((resolve) => {
      this.enter = resolve;
    });
    this.continued = new Promise((resolve) => {
      this.continue = resolve;
    });
  }

  release(): void {
    this.continue();
  }

  async sendReminder(request: MessagingReminderRequest): Promise<MessagingSendResult> {
    this.requests.push(structuredClone(request));
    this.enter();
    await this.continued;
    return { outcome: 'accepted', providerMessageId: 'provider-concurrent-1' };
  }
}

function uniqueUid(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
