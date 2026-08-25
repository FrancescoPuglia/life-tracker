import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UserPlanningPreferences } from '../../src/domain/types';
import {
  REPORT_EMAIL_CLAIM_LEASE_MS,
  FirestoreScientificReportArchiveRepository,
  FirestoreScientificReportEmailDeliveryRepository,
  ScientificReportEmailDeliveryService,
  buildScientificExecutionReport,
  composeScientificReportEmail,
  reportEmailSendAuthorityHash,
  type PrepareReportEmailDeliveryInput,
  type EmailProvider,
  type ScientificExecutionReport,
  type ScientificReportInput,
} from '../../src/reports';

const PROJECT_ID = 'demo-life-tracker-report-email-delivery';
const FROM = { email: 'reports@example.test', name: 'Life Tracker Reports' } as const;
const TO = { email: 'francesco@example.test', name: 'Francesco' } as const;
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
let sequence = 0;

function uid(label: string): string {
  sequence += 1;
  return `report-email-${label}-${Date.now()}-${sequence}`;
}

function report(owner: string, generatedAt: string): ScientificExecutionReport {
  const input: ScientificReportInput = {
    uid: owner,
    reportType: 'daily',
    localDate: '2026-08-25',
    timezone: 'Europe/Rome',
    locale: 'en-GB',
    generatedAt,
    preferences: PREFERENCES,
    coverage: {
      goals: 'complete', projects: 'complete', tasks: 'complete', timeBlocks: 'complete',
      sessions: 'complete', habits: 'complete', habitLogs: 'complete',
    },
    records: {
      goals: [], projects: [], tasks: [], timeBlocks: [], sessions: [], habits: [], habitLogs: [],
    },
  };
  return buildScientificExecutionReport(input);
}

function plus(instant: string, milliseconds: number): string {
  return new Date(Date.parse(instant) + milliseconds).toISOString();
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'Firestore report email claim/finalization transactions',
  () => {
    let app: App;
    let firestore: Firestore;

    beforeAll(() => {
      app = initializeApp({ projectId: PROJECT_ID }, `report-email-delivery-${Date.now()}`);
      firestore = getFirestore(app);
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    async function fixture(label: string, now = '2026-08-25T20:30:00.000Z') {
      const owner = uid(label);
      const artifact = report(owner, now);
      const archiveRepository = new FirestoreScientificReportArchiveRepository(firestore);
      const saved = await archiveRepository.saveGeneratedReport(owner, artifact, now);
      const email = await composeScientificReportEmail({ uid: owner, archive: saved.archive });
      const sendAuthorityHash = reportEmailSendAuthorityHash({ from: FROM, to: TO, email });
      const input: PrepareReportEmailDeliveryInput = {
        uid: owner,
        reportId: saved.archive.id,
        reportArtifactHash: saved.archive.artifactHash,
        metricHash: saved.archive.metricHash,
        emailContentHash: email.contentHash,
        sendAuthorityHash,
        idempotencyKey: email.idempotencyKey,
        provider: 'resend',
        now,
      };
      return { owner, artifact, archive: saved.archive, email, input };
    }

    it('serializes concurrent claims to one send and persists an idempotent accepted finalization', async () => {
      const item = await fixture('concurrent');
      const repository = new FirestoreScientificReportEmailDeliveryRepository(firestore);
      const beforeReport = JSON.stringify(item.archive.report);

      const claims = await Promise.all([
        repository.prepareEmailDelivery(item.input),
        repository.prepareEmailDelivery(item.input),
      ]);
      expect(claims.filter(({ action }) => action === 'send')).toHaveLength(1);
      expect(claims.filter(({ action }) => action === 'retry_later')).toHaveLength(1);
      const claim = claims.find((value) => value.action === 'send');
      if (!claim || claim.action !== 'send') throw new Error('Missing send claim.');

      const finalization = {
        uid: item.owner,
        reportId: item.archive.id,
        attemptId: claim.attemptId,
        sendAuthorityHash: item.input.sendAuthorityHash,
        now: plus(item.input.now, 1_000),
        result: { outcome: 'accepted', providerMessageId: 'resend-message-1' } as const,
      };
      await expect(repository.finalizeEmailDelivery(finalization)).resolves.toEqual({ state: 'sent' });
      await expect(repository.finalizeEmailDelivery(finalization)).resolves.toEqual({ state: 'sent' });
      await expect(repository.prepareEmailDelivery({
        ...item.input,
        now: plus(item.input.now, 2_000),
      })).resolves.toEqual({ action: 'no_op', reason: 'already_sent' });

      const [archive, control, attempts] = await Promise.all([
        repository.getArchive(item.owner, item.archive.id),
        firestore.doc(`users/${item.owner}/reportEmailDelivery/${item.archive.id}`).get(),
        firestore.collection(`users/${item.owner}/reportDeliveryAttempts`).get(),
      ]);
      expect(archive?.delivery).toMatchObject({
        state: 'sent', provider: 'resend', providerMessageId: 'resend-message-1',
      });
      expect(JSON.stringify(archive?.report)).toBe(beforeReport);
      expect(control.data()).toMatchObject({
        schemaVersion: 'report-email-delivery-control-v1',
        userId: item.owner,
        state: 'sent',
        attemptCount: 1,
        providerMessageId: 'resend-message-1',
        updatedAt: expect.any(Timestamp),
      });
      expect(attempts.size).toBe(1);
      expect(attempts.docs[0]?.data()).toMatchObject({
        state: 'accepted', attemptNumber: 1, providerMessageId: 'resend-message-1',
      });
      expect(JSON.stringify(control.data())).not.toContain(FROM.email);
      expect(JSON.stringify(control.data())).not.toContain(TO.email);
      expect(JSON.stringify(attempts.docs[0]?.data())).not.toContain(TO.email);

      await expect(repository.prepareEmailDelivery({
        ...item.input,
        sendAuthorityHash: 'b'.repeat(64),
        now: plus(item.input.now, 3_000),
      })).rejects.toMatchObject({ code: 'CONFLICT' });
    }, 30_000);

    it('permits exactly one provider invocation across concurrent full services', async () => {
      const item = await fixture('service-concurrent');
      const repository = new FirestoreScientificReportEmailDeliveryRepository(firestore);
      let providerCalls = 0;
      const provider: EmailProvider = {
        id: 'resend',
        async sendReportEmail() {
          providerCalls += 1;
          return {
            outcome: 'accepted',
            provider: 'resend',
            providerMessageId: 'service-concurrent-message',
          };
        },
      };
      const composer = async () => item.email;
      const first = new ScientificReportEmailDeliveryService(repository, provider, FROM, composer);
      const second = new ScientificReportEmailDeliveryService(repository, provider, FROM, composer);

      const results = await Promise.all([
        first.deliver({ uid: item.owner, reportId: item.archive.id, to: TO, now: item.input.now }),
        second.deliver({ uid: item.owner, reportId: item.archive.id, to: TO, now: item.input.now }),
      ]);

      expect(providerCalls).toBe(1);
      expect(results.filter(({ outcome }) => outcome === 'accepted')).toHaveLength(1);
      expect(results.filter(({ outcome }) => outcome !== 'accepted')).toHaveLength(1);
      expect((await repository.getArchive(item.owner, item.archive.id))?.delivery).toMatchObject({
        state: 'sent', providerMessageId: 'service-concurrent-message',
      });
      expect((await firestore.collection(
        `users/${item.owner}/reportDeliveryAttempts`,
      ).get()).size).toBe(1);
    }, 30_000);

    it('allows only bounded definite retries and terminates after three provider attempts', async () => {
      const item = await fixture('retry');
      const repository = new FirestoreScientificReportEmailDeliveryRepository(firestore);
      let claim = await repository.prepareEmailDelivery(item.input);
      if (claim.action !== 'send') throw new Error('Missing first send claim.');

      let finalized = await repository.finalizeEmailDelivery({
        uid: item.owner,
        reportId: item.archive.id,
        attemptId: claim.attemptId,
        sendAuthorityHash: item.input.sendAuthorityHash,
        now: plus(item.input.now, 1_000),
        result: { outcome: 'retryable', reason: 'rate_limited' },
      });
      if (finalized.state !== 'retryable') throw new Error('Missing retry schedule.');
      await expect(repository.prepareEmailDelivery({
        ...item.input, now: plus(finalized.notBefore, -1),
      })).resolves.toEqual({ action: 'retry_later', notBefore: finalized.notBefore });

      claim = await repository.prepareEmailDelivery({ ...item.input, now: finalized.notBefore });
      if (claim.action !== 'send' || claim.attemptNumber !== 2) {
        throw new Error('Missing second send claim.');
      }
      finalized = await repository.finalizeEmailDelivery({
        uid: item.owner,
        reportId: item.archive.id,
        attemptId: claim.attemptId,
        sendAuthorityHash: item.input.sendAuthorityHash,
        now: plus(finalized.notBefore, 1_000),
        result: { outcome: 'retryable', reason: 'rate_limited' },
      });
      if (finalized.state !== 'retryable') throw new Error('Missing second retry schedule.');

      claim = await repository.prepareEmailDelivery({ ...item.input, now: finalized.notBefore });
      if (claim.action !== 'send' || claim.attemptNumber !== 3) {
        throw new Error('Missing third send claim.');
      }
      const exhausted = await repository.finalizeEmailDelivery({
        uid: item.owner,
        reportId: item.archive.id,
        attemptId: claim.attemptId,
        sendAuthorityHash: item.input.sendAuthorityHash,
        now: plus(finalized.notBefore, 1_000),
        result: { outcome: 'retryable', reason: 'rate_limited' },
      });
      expect(exhausted).toEqual({ state: 'attempts_exhausted' });
      await expect(repository.prepareEmailDelivery({
        ...item.input, now: plus(finalized.notBefore, 2_000),
      })).resolves.toEqual({ action: 'no_op', reason: 'terminal_failure' });

      const [archive, attempts] = await Promise.all([
        repository.getArchive(item.owner, item.archive.id),
        firestore.collection(`users/${item.owner}/reportDeliveryAttempts`).get(),
      ]);
      expect(archive?.delivery).toMatchObject({
        state: 'failed', failureCode: 'retry_attempts_exhausted',
      });
      expect(attempts.size).toBe(3);
      expect(JSON.stringify(archive?.report)).toBe(JSON.stringify(item.archive.report));
    }, 30_000);

    it('turns an expired claimed worker into terminal uncertainty without another attempt', async () => {
      const item = await fixture('abandoned');
      const repository = new FirestoreScientificReportEmailDeliveryRepository(firestore);
      const claim = await repository.prepareEmailDelivery(item.input);
      expect(claim).toMatchObject({ action: 'send', attemptNumber: 1 });
      const recoveredAt = plus(item.input.now, REPORT_EMAIL_CLAIM_LEASE_MS);
      await expect(repository.prepareEmailDelivery({
        ...item.input, now: recoveredAt,
      })).resolves.toEqual({ action: 'no_op', reason: 'delivery_uncertain' });
      await expect(repository.prepareEmailDelivery({
        ...item.input, now: plus(recoveredAt, 60_000),
      })).resolves.toEqual({ action: 'no_op', reason: 'delivery_uncertain' });

      const [archive, control, attempts] = await Promise.all([
        repository.getArchive(item.owner, item.archive.id),
        firestore.doc(`users/${item.owner}/reportEmailDelivery/${item.archive.id}`).get(),
        firestore.collection(`users/${item.owner}/reportDeliveryAttempts`).get(),
      ]);
      expect(archive?.delivery).toMatchObject({
        state: 'failed', failureCode: 'uncertain_worker_recovered_claim',
      });
      expect(control.data()).toMatchObject({
        state: 'uncertain', failureCode: 'uncertain_worker_recovered_claim',
      });
      expect(attempts.size).toBe(1);
      expect(attempts.docs[0]?.data()).toMatchObject({
        state: 'uncertain', reason: 'worker_recovered_claim',
      });
    }, 30_000);

    it('makes rejected and ambiguous outcomes terminal without modifying report content', async () => {
      const repository = new FirestoreScientificReportEmailDeliveryRepository(firestore);
      for (const [label, result, failureCode] of [
        ['rejected', { outcome: 'rejected', reason: 'invalid_recipient' }, 'provider_invalid_recipient'],
        ['uncertain', { outcome: 'uncertain', reason: 'transport_unknown' }, 'uncertain_transport_unknown'],
      ] as const) {
        const item = await fixture(label);
        const claim = await repository.prepareEmailDelivery(item.input);
        if (claim.action !== 'send') throw new Error('Missing outcome claim.');
        await repository.finalizeEmailDelivery({
          uid: item.owner,
          reportId: item.archive.id,
          attemptId: claim.attemptId,
          sendAuthorityHash: item.input.sendAuthorityHash,
          now: plus(item.input.now, 1_000),
          result,
        });
        await expect(repository.prepareEmailDelivery({
          ...item.input, now: plus(item.input.now, 2_000),
        })).resolves.toEqual({
          action: 'no_op',
          reason: label === 'uncertain' ? 'delivery_uncertain' : 'terminal_failure',
        });
        const archive = await repository.getArchive(item.owner, item.archive.id);
        expect(archive?.delivery).toMatchObject({ state: 'failed', failureCode });
        expect(JSON.stringify(archive?.report)).toBe(JSON.stringify(item.archive.report));
      }
    }, 30_000);

    it('rejects cross-owner preparation and forged finalization without changing the claim', async () => {
      const item = await fixture('forged');
      const repository = new FirestoreScientificReportEmailDeliveryRepository(firestore);
      await expect(repository.prepareEmailDelivery({
        ...item.input,
        uid: uid('other'),
      })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const claim = await repository.prepareEmailDelivery(item.input);
      if (claim.action !== 'send') throw new Error('Missing forged-test claim.');
      await expect(repository.finalizeEmailDelivery({
        uid: item.owner,
        reportId: item.archive.id,
        attemptId: claim.attemptId,
        sendAuthorityHash: 'c'.repeat(64),
        now: plus(item.input.now, 1_000),
        result: { outcome: 'accepted', providerMessageId: 'forged-message' },
      })).rejects.toMatchObject({ code: 'CONFLICT' });

      const [archive, attempt] = await Promise.all([
        repository.getArchive(item.owner, item.archive.id),
        firestore.doc(`users/${item.owner}/reportDeliveryAttempts/${claim.attemptId}`).get(),
      ]);
      expect(archive?.delivery.state).toBe('pending');
      expect(attempt.data()).toMatchObject({ state: 'claimed', finalizedAt: null });
    }, 30_000);
  },
);
