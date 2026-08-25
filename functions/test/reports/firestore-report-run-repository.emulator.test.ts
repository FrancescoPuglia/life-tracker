import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FirestoreRepository } from '../../src/domain/firestore-repository';
import type { UserPlanningPreferences } from '../../src/domain/types';
import { normalizeNotificationPreferences } from '../../src/notifications/domain';
import { decodeStoredReportRun } from '../../src/reports/firestore-report-run-repository';
import {
  FirestoreScientificReportEmailDeliveryRepository,
  FirestoreScientificReportRunRepository,
  ScientificReportEmailDeliveryService,
  ScientificReportRunService,
  ScientificReportSourceLoader,
  buildScientificExecutionReport,
  deriveScientificReportSchedulePolicy,
  planDueScientificReportRuns,
  type EmailProvider,
  type ScientificReportInput,
  type ScientificReportScheduleCandidate,
} from '../../src/reports';

const PROJECT_ID = 'demo-life-tracker-report-runs';
const NOW = '2026-08-25T21:00:00.000Z';
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
let uidSequence = 0;

function uniqueUid(label: string): string {
  uidSequence += 1;
  return `run-${label}-${Date.now()}-${uidSequence}`;
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'Firestore scientific report run transactions',
  () => {
    let app: App;
    let firestore: Firestore;

    beforeAll(() => {
      app = initializeApp({ projectId: PROJECT_ID }, `report-runs-${Date.now()}`);
      firestore = getFirestore(app);
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    it('serializes concurrent generation claims and recovers an expired lease with one stable instant', async () => {
      const uid = uniqueUid('claim');
      const candidate = await seedAuthority(firestore, uid);
      const repository = new FirestoreScientificReportRunRepository(firestore);

      const concurrent = await Promise.all([
        repository.claimGeneration(candidate, NOW),
        repository.claimGeneration(candidate, NOW),
      ]);
      const first = concurrent.find((result) => result.action === 'generate');
      const blocked = concurrent.find((result) => result.action === 'retry_later');
      expect(first).toMatchObject({ action: 'generate', generatedAt: NOW });
      expect(blocked).toMatchObject({ action: 'retry_later', stage: 'generation' });

      const recovered = await repository.claimGeneration(
        candidate,
        '2026-08-25T21:10:00.001Z',
      );
      expect(recovered).toMatchObject({
        action: 'generate',
        generatedAt: NOW,
      });
      expect(recovered.action === 'generate' && recovered.claimId)
        .not.toBe(first?.action === 'generate' ? first.claimId : null);
      const snapshot = await firestore.doc(`users/${uid}/reportRuns/${candidate.id}`).get();
      expect(decodeStoredReportRun(uid, snapshot)).toMatchObject({
        state: 'generating',
        generationAttemptCount: 2,
        generatedAt: NOW,
      });
      expect(JSON.stringify(snapshot.data())).not.toContain(RECIPIENT);
    }, 30_000);

    it('does not claim before due, outside the bounded catch-up window, or from legacy recipient-less authority', async () => {
      const uid = uniqueUid('timing');
      const candidate = await seedAuthority(firestore, uid);
      const repository = new FirestoreScientificReportRunRepository(firestore);
      await expect(repository.claimGeneration(
        candidate,
        '2026-08-25T20:29:59.999Z',
      )).resolves.toEqual({
        action: 'retry_later',
        stage: 'generation',
        notBefore: candidate.scheduledFor,
      });
      await expect(repository.claimGeneration(
        candidate,
        '2026-08-27T08:30:00.001Z',
      )).resolves.toEqual({
        action: 'no_op',
        reason: 'outside_catch_up_window',
      });
      expect((await firestore.doc(`users/${uid}/reportRuns/${candidate.id}`).get()).exists)
        .toBe(false);

      const legacyUid = uniqueUid('legacy');
      const legacyCandidate = await seedAuthority(firestore, legacyUid);
      const legacyRef = firestore.doc(`users/${legacyUid}/notificationPreferences/default`);
      const legacy = (await legacyRef.get()).data()!;
      delete legacy.reportRecipient;
      await legacyRef.set({ ...legacy, schemaVersion: 'notification-preferences-v1' });
      await expect(repository.claimGeneration(legacyCandidate, NOW)).resolves.toEqual({
        action: 'no_op', reason: 'email_disabled',
      });
      expect((await firestore.doc(
        `users/${legacyUid}/reportRuns/${legacyCandidate.id}`,
      ).get()).exists).toBe(false);
    }, 30_000);

    it('atomically suppresses stale recipient authority without creating an archive', async () => {
      const uid = uniqueUid('stale');
      const candidate = await seedAuthority(firestore, uid);
      const repository = new FirestoreScientificReportRunRepository(firestore);
      const claim = await repository.claimGeneration(candidate, NOW);
      if (claim.action !== 'generate') throw new Error('Expected a generation claim.');
      await firestore.doc(`users/${uid}/notificationPreferences/default`).update({
        reportRecipient: 'changed@example.test',
        updatedAt: Timestamp.fromDate(new Date('2026-08-25T21:00:01.000Z')),
      });

      await expect(repository.commitGeneratedReport({
        candidate,
        claimId: claim.claimId,
        report: report(uid, candidate, claim.generatedAt),
        now: '2026-08-25T21:00:02.000Z',
      })).resolves.toEqual({ action: 'suppressed', reason: 'recipient_changed' });
      const [run, archive, marker] = await Promise.all([
        firestore.doc(`users/${uid}/reportRuns/${candidate.id}`).get(),
        firestore.doc(`users/${uid}/reportArchives/${claim.reportId}`).get(),
        firestore.doc(`users/${uid}/reportIdempotency/${claim.reportId}`).get(),
      ]);
      expect(decodeStoredReportRun(uid, run)).toMatchObject({
        state: 'suppressed',
        suppressionReason: 'recipient_changed',
        archiveArtifactHash: null,
      });
      expect(archive.exists).toBe(false);
      expect(marker.exists).toBe(false);
    }, 30_000);

    it('suppresses a new same-period authority instead of retrying or duplicating an in-flight run', async () => {
      const uid = uniqueUid('same-period-change');
      const original = await seedAuthority(firestore, uid);
      const repository = new FirestoreScientificReportRunRepository(firestore);
      const claim = await repository.claimGeneration(original, NOW);
      if (claim.action !== 'generate') throw new Error('Expected a generation claim.');
      await firestore.doc(`users/${uid}/notificationPreferences/default`).update({
        reportRecipient: 'changed@example.test',
        updatedAt: Timestamp.fromDate(new Date('2026-08-25T21:00:01.000Z')),
      });
      const changedPreferences = normalizeNotificationPreferences(uid, {
        userId: uid,
        timezone: 'Europe/Rome',
        locale: 'it-IT',
        emailEnabled: true,
        reportRecipient: 'changed@example.test',
        dailyReport: { enabled: true, localTime: '22:30' },
        weeklyReport: { enabled: false, isoWeekday: 7, localTime: '20:30' },
      }, 'Europe/Rome');
      const changed = planDueScientificReportRuns(
        deriveScientificReportSchedulePolicy(changedPreferences),
        NOW,
      )[0]!;
      expect(changed.id).toBe(original.id);
      expect(changed.recipientAuthorityHash).not.toBe(original.recipientAuthorityHash);

      await expect(repository.claimGeneration(
        changed,
        '2026-08-25T21:00:02.000Z',
      )).resolves.toEqual({ action: 'no_op', reason: 'recipient_changed' });
      expect(decodeStoredReportRun(
        uid,
        await firestore.doc(`users/${uid}/reportRuns/${original.id}`).get(),
      )).toMatchObject({ state: 'suppressed', suppressionReason: 'recipient_changed' });
      await expect(repository.commitGeneratedReport({
        candidate: original,
        claimId: claim.claimId,
        report: report(uid, original, claim.generatedAt),
        now: '2026-08-25T21:00:03.000Z',
      })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await firestore.doc(
        `users/${uid}/reportArchives/${claim.reportId}`,
      ).get()).exists).toBe(false);
    }, 30_000);

    it('atomically archives, exactly replays, rejects conflicting content, and finalizes one delivery claim', async () => {
      const uid = uniqueUid('archive');
      const candidate = await seedAuthority(firestore, uid);
      const repository = new FirestoreScientificReportRunRepository(firestore);
      const claim = await repository.claimGeneration(candidate, NOW);
      if (claim.action !== 'generate') throw new Error('Expected a generation claim.');
      const generated = report(uid, candidate, claim.generatedAt);
      const first = await repository.commitGeneratedReport({
        candidate, claimId: claim.claimId, report: generated, now: '2026-08-25T21:00:01.000Z',
      });
      expect(first).toMatchObject({ action: 'archived', idempotentReplay: false });
      const replay = await repository.commitGeneratedReport({
        candidate, claimId: claim.claimId, report: generated, now: '2026-08-25T21:00:02.000Z',
      });
      expect(replay).toMatchObject({ action: 'archived', idempotentReplay: true });

      await expect(repository.commitGeneratedReport({
        candidate,
        claimId: claim.claimId,
        report: report(uid, candidate, claim.generatedAt, 30),
        now: '2026-08-25T21:00:03.000Z',
      })).rejects.toMatchObject({ code: 'CONFLICT' });
      if (first.action !== 'archived') throw new Error('Expected an archive.');
      const authorizations = await Promise.all([
        repository.authorizeDelivery({
          candidate,
          reportId: first.archive.id,
          archiveArtifactHash: first.archive.artifactHash,
          archiveMetricHash: first.archive.metricHash,
          now: '2026-08-25T21:00:04.000Z',
        }),
        repository.authorizeDelivery({
          candidate,
          reportId: first.archive.id,
          archiveArtifactHash: first.archive.artifactHash,
          archiveMetricHash: first.archive.metricHash,
          now: '2026-08-25T21:00:04.000Z',
        }),
      ]);
      const authorized = authorizations.find((result) => result.action === 'deliver');
      expect(authorized).toMatchObject({
        action: 'deliver',
        recipient: { email: RECIPIENT, name: null },
      });
      expect(authorizations.filter((result) => result.action === 'retry_later')).toHaveLength(1);
      if (authorized?.action !== 'deliver') throw new Error('Expected a delivery claim.');
      await expect(repository.finalizeDelivery({
        candidate,
        reportId: first.archive.id,
        claimId: authorized.claimId,
        now: '2026-08-25T21:00:05.000Z',
        result: { outcome: 'accepted' },
      })).resolves.toEqual({ action: 'completed', delivery: 'accepted' });
      await expect(repository.finalizeDelivery({
        candidate,
        reportId: first.archive.id,
        claimId: authorized.claimId,
        now: '2026-08-25T21:00:06.000Z',
        result: { outcome: 'accepted' },
      })).resolves.toEqual({ action: 'completed', delivery: 'accepted' });
      await expect(repository.finalizeDelivery({
        candidate,
        reportId: first.archive.id,
        claimId: authorized.claimId,
        now: '2026-08-25T21:00:07.000Z',
        result: { outcome: 'no_op', reason: 'already_sent' },
      })).rejects.toMatchObject({ code: 'CONFLICT' });
    }, 30_000);

    it('bounds safe generation retries and persists terminal exhaustion', async () => {
      const uid = uniqueUid('generation-failure');
      const candidate = await seedAuthority(firestore, uid);
      const repository = new FirestoreScientificReportRunRepository(firestore);
      const times = [
        NOW,
        '2026-08-25T21:05:00.000Z',
        '2026-08-25T21:15:00.000Z',
      ];
      for (let index = 0; index < times.length; index += 1) {
        const at = times[index]!;
        const claim = await repository.claimGeneration(candidate, at);
        expect(claim.action).toBe('generate');
        if (claim.action !== 'generate') throw new Error('Expected a generation claim.');
        if (index === 0) {
          await expect(repository.recordGenerationFailure({
            candidate,
            claimId: claim.claimId,
            reason: 'source_unavailable',
            now: '2026-08-25T20:59:59.999Z',
          })).rejects.toMatchObject({ code: 'INTERNAL' });
          expect(decodeStoredReportRun(
            uid,
            await firestore.doc(`users/${uid}/reportRuns/${candidate.id}`).get(),
          )).toMatchObject({ state: 'generating', generationAttemptCount: 1 });
        }
        const failure = await repository.recordGenerationFailure({
          candidate,
          claimId: claim.claimId,
          reason: 'source_unavailable',
          now: at,
        });
        expect(failure.action).toBe(index === 2 ? 'failed' : 'retry_later');
      }
      await expect(repository.claimGeneration(
        candidate,
        '2026-08-25T21:30:00.000Z',
      )).resolves.toEqual({ action: 'no_op', reason: 'terminal_failure' });
      const run = decodeStoredReportRun(
        uid,
        await firestore.doc(`users/${uid}/reportRuns/${candidate.id}`).get(),
      );
      expect(run).toMatchObject({
        state: 'failed',
        generationAttemptCount: 3,
        failureCode: 'generation_attempts_exhausted',
      });
    }, 30_000);

    it('recovers a crash after provider acceptance without a second external message', async () => {
      const uid = uniqueUid('provider-crash');
      const candidate = await seedAuthority(firestore, uid);
      const runRepository = new FirestoreScientificReportRunRepository(firestore);
      const loader = new ScientificReportSourceLoader(
        new FirestoreRepository(firestore),
        () => new Date(NOW),
      );
      const source = {
        calls: 0,
        async load(...args: Parameters<typeof loader.load>) {
          this.calls += 1;
          return loader.load(...args);
        },
      };
      const emailProvider: EmailProvider & { calls: number } = {
        id: 'resend',
        calls: 0,
        async sendReportEmail() {
          this.calls += 1;
          return {
            outcome: 'accepted',
            provider: 'resend',
            providerMessageId: 'provider-message-1',
          };
        },
      };
      const durableDelivery = new ScientificReportEmailDeliveryService(
        new FirestoreScientificReportEmailDeliveryRepository(firestore),
        emailProvider,
        { email: 'reports@example.test', name: 'Life Tracker Reports' },
      );
      const crashAfterAccepted = {
        async deliver(input: Parameters<typeof durableDelivery.deliver>[0]) {
          const result = await durableDelivery.deliver(input);
          if (result.outcome === 'accepted') throw new Error('simulated worker loss');
          return result;
        },
      };
      const crashingService = new ScientificReportRunService(
        runRepository,
        source,
        crashAfterAccepted,
      );

      const concurrent = await Promise.all([
        crashingService.execute(candidate, NOW),
        crashingService.execute(candidate, NOW),
      ]);
      expect(concurrent.every((result) => (
        result.outcome === 'retry_later' && result.stage === 'delivery'
      ))).toBe(true);
      const notBefore = concurrent.map((result) => (
        result.outcome === 'retry_later' ? result.notBefore : null
      ));
      expect(notBefore).toContain('2026-08-25T21:10:00.000Z');
      expect(notBefore.every((value) => (
        value === '2026-08-25T21:10:00.000Z'
        || value === '2026-08-25T21:15:00.000Z'
      ))).toBe(true);
      expect(source.calls).toBe(1);
      expect(emailProvider.calls).toBe(1);

      const recovered = await new ScientificReportRunService(
        runRepository,
        source,
        durableDelivery,
      ).execute(candidate, '2026-08-25T21:10:00.000Z');
      expect(recovered).toMatchObject({
        outcome: 'completed',
        archiveReused: true,
        delivery: 'already_sent',
      });
      expect(source.calls).toBe(1);
      expect(emailProvider.calls).toBe(1);
      const runSnapshot = await firestore.doc(`users/${uid}/reportRuns/${candidate.id}`).get();
      expect(decodeStoredReportRun(uid, runSnapshot)).toMatchObject({
        state: 'completed',
        deliveryAttemptCount: 2,
        deliveryOutcome: 'already_sent',
      });
      expect(JSON.stringify(runSnapshot.data())).not.toContain(RECIPIENT);
    }, 60_000);
  },
);

async function seedAuthority(
  firestore: Firestore,
  uid: string,
): Promise<ScientificReportScheduleCandidate> {
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
    firestore.doc(`users/${uid}/notificationPreferences/default`).set({
      schemaVersion: 'notification-preferences-v2',
      id: 'default',
      userId: uid,
      timezone: 'Europe/Rome',
      locale: 'it-IT',
      emailEnabled: true,
      reportRecipient: RECIPIENT,
      dailyReport: { enabled: true, localTime: '22:30' },
      weeklyReport: { enabled: false, isoWeekday: 7, localTime: '20:30' },
      createdAt: Timestamp.fromDate(new Date(NOW)),
      updatedAt: Timestamp.fromDate(new Date(NOW)),
    }),
  ]);
  const preferences = normalizeNotificationPreferences(uid, {
    userId: uid,
    timezone: 'Europe/Rome',
    locale: 'it-IT',
    emailEnabled: true,
    reportRecipient: RECIPIENT,
    dailyReport: { enabled: true, localTime: '22:30' },
    weeklyReport: { enabled: false, isoWeekday: 7, localTime: '20:30' },
  }, 'Europe/Rome');
  return planDueScientificReportRuns(
    deriveScientificReportSchedulePolicy(preferences),
    NOW,
  )[0]!;
}

function report(
  uid: string,
  candidate: ScientificReportScheduleCandidate,
  generatedAt: string,
  plannedMinutes = 0,
) {
  return buildScientificExecutionReport(reportInput(
    uid,
    candidate,
    generatedAt,
    plannedMinutes,
  ));
}

function reportInput(
  uid: string,
  candidate: ScientificReportScheduleCandidate,
  generatedAt: string,
  plannedMinutes: number,
): ScientificReportInput {
  return {
    uid,
    reportType: candidate.reportType,
    localDate: candidate.localDate,
    timezone: 'Europe/Rome',
    locale: 'it-IT',
    generatedAt,
    preferences: PLANNING_PREFERENCES,
    coverage: {
      goals: 'complete', projects: 'complete', tasks: 'complete', timeBlocks: 'complete',
      sessions: 'complete', habits: 'complete', habitLogs: 'complete',
    },
    records: {
      goals: [], projects: [], tasks: [],
      timeBlocks: plannedMinutes > 0 ? [{
        id: 'block-1',
        _version: 1,
        createdAt: '2026-08-25T07:00:00.000Z',
        updatedAt: '2026-08-25T07:00:00.000Z',
        startTime: '2026-08-25T08:00:00.000Z',
        endTime: new Date(Date.parse('2026-08-25T08:00:00.000Z') + plannedMinutes * 60_000)
          .toISOString(),
        status: 'planned',
        title: 'Focus',
      }] : [],
      sessions: [], habits: [], habitLogs: [],
    },
  };
}
