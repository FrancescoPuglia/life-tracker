import { createHash } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AI_MODEL_PRICE_CATALOG_VERSION,
  AI_MODEL_ROUTING_SCHEMA_VERSION,
  parseLifeTrackerAiRoutingPolicy,
  routedExecutionProfile,
} from '../../src/ai/model-routing';
import type { UserPlanningPreferences } from '../../src/domain/types';
import {
  FirestoreScientificReportArchiveRepository,
  FirestoreWeeklyInterpretationRepository,
  WeeklyStrategicInterpretationService,
  buildScientificExecutionReport,
  buildWeeklyInterpretationMetricContext,
  createWeeklyStrategicInterpretation,
  type ScientificReportInput,
  type WeeklyInterpretationProviderResult,
} from '../../src/reports';

const PROJECT_ID = 'demo-life-tracker-weekly-interpretation';
const NOW = '2026-08-25T20:00:00.000Z';
const PREFERENCES: UserPlanningPreferences = {
  source: 'persisted', defaultsApplied: [], timezone: 'Europe/Rome',
  workingHours: { start: '07:00', end: '22:00' },
  maxDailyPlannedMinutes: 600, maxWeeklyPlannedMinutes: 3_000,
  minBufferMinutes: 15, maxConsecutiveHighEnergyBlocks: 2,
};
let sequence = 0;

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'Firestore at-most-once weekly interpretation transactions',
  () => {
    let app: App;
    let firestore: Firestore;

    beforeAll(() => {
      app = initializeApp({ projectId: PROJECT_ID }, `weekly-interpretation-${Date.now()}`);
      firestore = getFirestore(app);
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    it('persists one stable default-off decision and never later opens a provider claim', async () => {
      const { uid, archive } = await savedArchive(firestore, 'skip');
      const repository = new FirestoreWeeklyInterpretationRepository(firestore);

      await expect(repository.settleSkipped({
        uid, archive, reason: 'routing_disabled', now: NOW,
      })).resolves.toEqual({ action: 'stable', interpretation: null, state: 'skipped' });
      await expect(repository.claim({
        uid,
        archive,
        profile: profile(),
        claimId: claimId('a'),
        now: '2026-08-25T20:01:00.000Z',
      })).resolves.toEqual({ action: 'stable', interpretation: null, state: 'skipped' });

      const snapshot = await firestore.doc(`users/${uid}/reportInterpretations/${archive.id}`).get();
      expect(snapshot.data()).toMatchObject({
        schemaVersion: 'weekly-strategic-interpretation-control-v1',
        id: archive.id,
        userId: uid,
        state: 'skipped',
        attemptCount: 0,
        skipReason: 'routing_disabled',
        createdAt: expect.any(Timestamp),
        updatedAt: expect.any(Timestamp),
      });
    }, 30_000);

    it('serializes concurrent claims so only one caller may invoke the provider', async () => {
      const { uid, archive } = await savedArchive(firestore, 'concurrent');
      const repository = new FirestoreWeeklyInterpretationRepository(firestore);
      const results = await Promise.all([
        repository.claim({ uid, archive, profile: profile(), claimId: claimId('b'), now: NOW }),
        repository.claim({ uid, archive, profile: profile(), claimId: claimId('c'), now: NOW }),
      ]);

      expect(results.filter((result) => result.action === 'generate')).toHaveLength(1);
      expect(results.filter((result) => result.action === 'retry_later')).toHaveLength(1);
      expect((await repository.getControl(uid, archive.id))).toMatchObject({
        state: 'claimed', attemptCount: 1, interpretation: null,
      });
    }, 30_000);

    it('permits one provider invocation across concurrent full service resolutions', async () => {
      const { uid, archive } = await savedArchive(firestore, 'concurrent-service');
      const repository = new FirestoreWeeklyInterpretationRepository(firestore);
      let releaseGeneration: () => void = () => {};
      let markStarted: () => void = () => {};
      const generationReleased = new Promise<void>((resolve) => { releaseGeneration = resolve; });
      const generationStarted = new Promise<void>((resolve) => { markStarted = resolve; });
      const generate = vi.fn(async () => {
        markStarted();
        await generationReleased;
        return providerResult(uid, archive);
      });
      const service = new WeeklyStrategicInterpretationService(
        repository,
        () => profile(),
        () => ({ generate }),
      );
      const first = service.resolve(uid, archive, NOW);
      await generationStarted;
      try {
        await expect(service.resolve(uid, archive, NOW)).resolves.toEqual({
          outcome: 'retry_later',
          notBefore: '2026-08-25T20:10:00.000Z',
        });
      } finally {
        releaseGeneration();
      }
      const completed = await first;
      expect(completed.outcome).toBe('ready');
      if (completed.outcome !== 'ready') throw new Error('Expected completed interpretation.');
      expect(completed.interpretation).not.toBeNull();
      await expect(service.resolve(
        uid,
        archive,
        '2026-08-25T20:01:00.000Z',
      )).resolves.toMatchObject({ outcome: 'ready', state: 'complete' });
      expect(generate).toHaveBeenCalledTimes(1);
    }, 30_000);

    it('finalizes one immutable metric-bound artifact and replays it without another claim', async () => {
      const { uid, archive } = await savedArchive(firestore, 'complete');
      const repository = new FirestoreWeeklyInterpretationRepository(firestore);
      const claim = await repository.claim({
        uid, archive, profile: profile(), claimId: claimId('d'), now: NOW,
      });
      if (claim.action !== 'generate') throw new Error('Expected generation claim.');
      const context = buildWeeklyInterpretationMetricContext(uid, archive);
      const interpretation = createWeeklyStrategicInterpretation(
        uid, archive, profile(), context, providerResult(uid, archive), NOW,
      );

      await expect(repository.finalizeSuccess({
        uid, archive, claimId: claim.claimId, interpretation, now: NOW,
      })).resolves.toEqual({ action: 'stable', interpretation, state: 'complete' });
      await expect(repository.claim({
        uid,
        archive,
        profile: profile(),
        claimId: claimId('e'),
        now: '2026-08-25T20:20:00.000Z',
      })).resolves.toEqual({ action: 'stable', interpretation, state: 'complete' });
      expect(await repository.getControl(uid, archive.id)).toMatchObject({
        state: 'complete', attemptCount: 1, interpretation,
      });
    }, 30_000);

    it('settles an explicit provider failure and an expired claim without any retry authority', async () => {
      const failed = await savedArchive(firestore, 'failed');
      const repository = new FirestoreWeeklyInterpretationRepository(firestore);
      const failedClaim = await repository.claim({
        ...failed, profile: profile(), claimId: claimId('f'), now: NOW,
      });
      if (failedClaim.action !== 'generate') throw new Error('Expected failure claim.');
      await expect(repository.finalizeFailure({
        ...failed,
        claimId: failedClaim.claimId,
        failureCode: 'provider_result_uncertain' as 'provider_unavailable',
        now: NOW,
      })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(repository.finalizeFailure({
        ...failed,
        claimId: failedClaim.claimId,
        failureCode: 'provider_unavailable',
        now: NOW,
      })).resolves.toEqual({ action: 'stable', interpretation: null, state: 'failed' });
      await expect(repository.claim({
        ...failed,
        profile: profile(),
        claimId: claimId('g'),
        now: '2026-08-25T21:00:00.000Z',
      })).resolves.toEqual({ action: 'stable', interpretation: null, state: 'failed' });

      const expired = await savedArchive(firestore, 'uncertain');
      await repository.claim({
        ...expired, profile: profile(), claimId: claimId('h'), now: NOW,
      });
      await expect(repository.claim({
        ...expired,
        profile: profile(),
        claimId: claimId('i'),
        now: '2026-08-25T20:11:00.000Z',
      })).resolves.toEqual({ action: 'stable', interpretation: null, state: 'uncertain' });
      expect(await repository.getControl(expired.uid, expired.archive.id)).toMatchObject({
        state: 'uncertain',
        attemptCount: 1,
        failureCode: 'provider_result_uncertain',
        claimId: null,
      });
    }, 30_000);

    it('derives every path from owner/archive authority and rejects missing or forged state', async () => {
      const owner = await savedArchive(firestore, 'owner');
      const other = uniqueUid('other');
      const repository = new FirestoreWeeklyInterpretationRepository(firestore);

      await expect(repository.claim({
        uid: other,
        archive: { ...owner.archive, userId: other },
        profile: profile(),
        claimId: claimId('j'),
        now: NOW,
      })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(repository.claim({
        ...owner,
        archive: { ...owner.archive, metricHash: 'f'.repeat(64) },
        profile: profile(),
        claimId: claimId('k'),
        now: NOW,
      })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await repository.getControl(other, owner.archive.id)).toBeNull();
      expect((await firestore.collection(`users/${other}/reportInterpretations`).get()).empty)
        .toBe(true);
    }, 30_000);
  },
);

async function savedArchive(firestore: Firestore, label: string) {
  const uid = uniqueUid(label);
  const report = buildScientificExecutionReport(input(uid));
  if (report.type !== 'weekly') throw new Error('Expected Weekly report.');
  const saved = await new FirestoreScientificReportArchiveRepository(firestore)
    .saveGeneratedReport(uid, report, NOW);
  return { uid, archive: saved.archive };
}

function uniqueUid(label: string) {
  sequence += 1;
  return `weekly-${label}-${Date.now()}-${sequence}`;
}

function input(uid: string): ScientificReportInput {
  return {
    uid, reportType: 'weekly', localDate: '2026-08-25', timezone: 'Europe/Rome',
    locale: 'en', generatedAt: NOW, preferences: PREFERENCES,
    coverage: {
      goals: 'complete', projects: 'complete', tasks: 'complete', timeBlocks: 'complete',
      sessions: 'complete', habits: 'complete', habitLogs: 'complete',
    },
    records: {
      goals: [], projects: [], tasks: [], timeBlocks: [], sessions: [], habits: [], habitLogs: [],
    },
  };
}

function profile() {
  return routedExecutionProfile(parseLifeTrackerAiRoutingPolicy(JSON.stringify({
    schemaVersion: AI_MODEL_ROUTING_SCHEMA_VERSION,
    evaluationReceiptId: `model_eval_${'b'.repeat(64)}`,
    evaluatedAt: NOW,
    priceCatalogVersion: AI_MODEL_PRICE_CATALOG_VERSION,
    routes: {
      ask: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
      coach: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
      analyze: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
      plan: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
      weekly_strategic_review: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
    },
  })), 'weekly_strategic_review');
}

function claimId(label: string) {
  const digest = createHash('sha256').update(`weekly-interpretation-test\0${label}`).digest('hex');
  return `weekly_interpretation_claim_${digest.slice(0, 48)}`;
}

function providerResult(
  uid: string,
  archive: Awaited<ReturnType<typeof savedArchive>>['archive'],
): WeeklyInterpretationProviderResult {
  const metricIds = buildWeeklyInterpretationMetricContext(uid, archive)
    .scalarMetrics.slice(0, 2).map((metric) => metric.id);
  return {
    providerResponseId: 'response_weekly_emulator',
    providerModel: 'gpt-5.6-luna',
    inputTokens: 1_000, cachedInputTokens: 100, outputTokens: 120,
    reasoningTokens: 20, totalTokens: 1_120, latencyMs: 900,
    draft: {
      summary: 'The available evidence supports one cautious scheduling experiment while preserving uncertainty.',
      strongestPattern: {
        kind: 'INFERENCE',
        text: 'Execution appears more stable where planned work has clearer completion evidence.',
        metricIds, confidence: 'moderate',
        uncertainty: 'The available sample is limited and some execution evidence may be incomplete.',
      },
      largestUncertainty: {
        kind: 'INFERENCE',
        text: 'Incomplete execution capture limits how confidently the weekly pattern can be interpreted.',
        metricIds, confidence: 'low',
        uncertainty: 'Missing or partial Session evidence may change the apparent pattern.',
      },
      nextWeekExperiment: {
        kind: 'RECOMMENDATION',
        text: 'Keep one scheduling variable stable and capture every completed Session before comparing again.',
        metricIds, confidence: 'moderate',
        uncertainty: 'The experiment may be inconclusive if execution capture remains incomplete.',
      },
    },
  };
}
