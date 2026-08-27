import { createHash } from 'node:crypto';
import { canonicalJson } from '../domain/integrity';
import type { LifeTrackerAiExecutionProfile } from '../ai/model-routing';
import {
  REPORT_ARCHIVE_SCHEMA_VERSION,
  scientificReportArtifactHash,
  validateScientificExecutionReport,
  type StoredScientificReportArchive,
} from './archive';
import type {
  CompletionBucketMetric,
  DailyMetricPoint,
  FourWeekTrendPoint,
  ScientificMetric,
  WeeklyExecutionReport,
} from './types';

export const WEEKLY_INTERPRETATION_SCHEMA_VERSION =
  'weekly-strategic-interpretation-v2' as const;
export const WEEKLY_INTERPRETATION_OUTPUT_SCHEMA_VERSION =
  'weekly-strategic-interpretation-output-v2' as const;
export const WEEKLY_INTERPRETATION_PROMPT_VERSION =
  'life-tracker-weekly-executive-review-v3.1-2026-08-27' as const;
export const WEEKLY_INTERPRETATION_METRIC_CONTEXT_SCHEMA_VERSION =
  'weekly-strategic-metric-context-v1' as const;
export const WEEKLY_INTERPRETATION_CONTROL_SCHEMA_VERSION =
  'weekly-strategic-interpretation-control-v1' as const;
export const WEEKLY_INTERPRETATION_CLAIM_LEASE_MS = 10 * 60_000;

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const UID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/u;
const REPORT_ID_PATTERN = /^report_[0-9a-f]{56}$/u;
const INTERPRETATION_ID_PATTERN = /^weekly_interpretation_[0-9a-f]{48}$/u;
const CLAIM_ID_PATTERN = /^weekly_interpretation_claim_[0-9a-f]{48}$/u;
const RESPONSE_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;
const NUMBER_WORD = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)';
const FORBIDDEN_EXACT_QUANTITY_PATTERN = new RegExp(
  `\\b${NUMBER_WORD}(?:[- ]+${NUMBER_WORD})*[- ]+(?:percent(?:age)?|minutes?|hours?|blocks?|tasks?|sessions?|days?|weeks?|habits?|goals?|points?|samples?)\\b`,
  'iu',
);
const FORBIDDEN_NARRATIVE_PATTERN = /(?:\p{N}|https?:\/\/|<|>|\b(?:percent(?:age)?|half|halves|quarter|quarters|fraction|twice|double|triple|caus(?:e|es|ed|al|ation)|because|due to|leads? to|result(?:s|ed)? in|drives?|determines?|responsible for|diagnos(?:e|ed|is)|medical|psychological|mental health|depression|anxiety|burnout|disorder|syndrome|disease|illness|clinical|therapy|treatment|medication|prescription|symptom|adhd|bipolar|autis(?:m|tic)|ocd|ptsd|insomnia)\b)/iu;

const SCALAR_METRIC_KEYS = [
  'plannedMinutes',
  'actualMinutes',
  'adherencePercent',
  'varianceMinutes',
  'taskCompletionPercent',
  'timeBlockCompletionPercent',
  'goalAlignmentIndex',
  'deepWorkMinutes',
  'habitAdherencePercent',
  'carryoverTasks',
  'startDelayMeanMinutes',
  'overrunMinutes',
  'estimationErrorMeanAbsoluteMinutes',
  'estimationErrorPercent',
  'capacityUtilizationPercent',
  'weeklyExecutionIndex',
  'scheduleVolatility',
] as const;

export type WeeklyInterpretationConfidence = 'low' | 'moderate' | 'high';
export type WeeklyInterpretationStatementKind = 'INFERENCE' | 'RECOMMENDATION';

export interface WeeklyInterpretationMetricFact {
  readonly id: string;
  readonly value: number | null;
  readonly unit: ScientificMetric['unit'];
  readonly availability: ScientificMetric['availability'];
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly sampleSize: number;
  readonly missingCount: number;
}

export interface WeeklyInterpretationCompletionFact {
  readonly key: string;
  readonly completed: number;
  readonly eligible: number;
  readonly completionPercent: number | null;
  readonly missingCount: number;
}

export interface WeeklyInterpretationDailyFact {
  readonly localDate: string;
  readonly plannedMinutes: number;
  readonly actualMinutes: number | null;
  readonly actualAvailability: DailyMetricPoint['actualAvailability'];
  readonly completedBlocks: number;
  readonly eligibleBlocks: number;
  readonly completedTasks: number;
}

export interface WeeklyInterpretationTrendFact {
  readonly weekStartDate: string;
  readonly weekEndDate: string;
  readonly plannedMinutes: number;
  readonly actualMinutes: number | null;
  readonly actualAvailability: FourWeekTrendPoint['actualAvailability'];
  readonly adherencePercent: number | null;
  readonly blockCompletionPercent: number | null;
}

export interface WeeklyInterpretationMetricContext {
  readonly schemaVersion: typeof WEEKLY_INTERPRETATION_METRIC_CONTEXT_SCHEMA_VERSION;
  readonly reportId: string;
  readonly reportArtifactHash: string;
  readonly metricHash: string;
  readonly period: Readonly<{
    localStartDate: string;
    localEndDate: string;
    timezone: string;
    dayCount: number;
  }>;
  readonly scalarMetrics: readonly WeeklyInterpretationMetricFact[];
  readonly completionByTimeOfDay: readonly WeeklyInterpretationCompletionFact[];
  readonly completionByWeekday: readonly WeeklyInterpretationCompletionFact[];
  readonly daily: readonly WeeklyInterpretationDailyFact[];
  readonly fourWeekTrend: readonly WeeklyInterpretationTrendFact[];
  readonly dataQuality: Readonly<{
    complete: boolean;
    invalidTimestampCount: number;
    invalidDurationCount: number;
    openSessionCount: number;
    completedSessionMissingDurationCount: number;
    blocksMissingActualCount: number;
    unattributedActualMinutes: number;
    missingGoalReferenceCount: number;
    missingSessionsAreZero: false;
  }>;
  readonly contextHash: string;
}

export interface WeeklyInterpretationStatement {
  readonly kind: WeeklyInterpretationStatementKind;
  readonly text: string;
  readonly metricIds: readonly string[];
  readonly confidence: WeeklyInterpretationConfidence;
  readonly uncertainty: string;
}

export interface WeeklyInterpretationDraft {
  readonly summary: string;
  readonly biggestWin: WeeklyInterpretationStatement;
  readonly biggestMiss: WeeklyInterpretationStatement;
  readonly priorityMismatch: WeeklyInterpretationStatement;
  readonly strongestPattern: WeeklyInterpretationStatement;
  readonly largestUncertainty: WeeklyInterpretationStatement;
  readonly topCorrections: readonly [
    WeeklyInterpretationStatement,
    WeeklyInterpretationStatement,
    WeeklyInterpretationStatement,
  ];
  readonly nextWeekExperiment: WeeklyInterpretationStatement;
}

export interface WeeklyInterpretationProviderResult {
  readonly providerResponseId: string;
  readonly providerModel: string;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly latencyMs: number;
  readonly draft: WeeklyInterpretationDraft;
}

export interface WeeklyStrategicInterpretation {
  readonly schemaVersion: typeof WEEKLY_INTERPRETATION_SCHEMA_VERSION;
  readonly id: string;
  readonly ownerHash: string;
  readonly reportId: string;
  readonly reportArtifactHash: string;
  readonly metricHash: string;
  readonly metricContextHash: string;
  readonly promptVersion: typeof WEEKLY_INTERPRETATION_PROMPT_VERSION;
  readonly outputSchemaVersion: typeof WEEKLY_INTERPRETATION_OUTPUT_SCHEMA_VERSION;
  readonly workload: 'weekly_strategic_review';
  readonly model: string;
  readonly reasoningEffort: string;
  readonly routingConfigId: string;
  readonly evaluationReceiptId: string;
  readonly providerResponseId: string;
  readonly providerModel: string;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly latencyMs: number;
  readonly summaryKind: 'INFERENCE';
  readonly summary: string;
  readonly biggestWin: WeeklyInterpretationStatement;
  readonly biggestMiss: WeeklyInterpretationStatement;
  readonly priorityMismatch: WeeklyInterpretationStatement;
  readonly strongestPattern: WeeklyInterpretationStatement;
  readonly largestUncertainty: WeeklyInterpretationStatement;
  readonly topCorrections: WeeklyInterpretationDraft['topCorrections'];
  readonly nextWeekExperiment: WeeklyInterpretationStatement;
  readonly untrustedTextPolicy: 'metrics_are_data_not_instructions';
  readonly generatedAt: string;
  readonly artifactHash: string;
}

export type WeeklyInterpretationControlState =
  | 'skipped'
  | 'claimed'
  | 'complete'
  | 'failed'
  | 'uncertain';

export type WeeklyInterpretationSkipReason =
  | 'routing_disabled'
  | 'routing_invalid';

export type WeeklyInterpretationFailureCode =
  | 'provider_unavailable'
  | 'provider_invalid'
  | 'provider_result_uncertain';

export interface StoredWeeklyInterpretationControl {
  readonly schemaVersion: typeof WEEKLY_INTERPRETATION_CONTROL_SCHEMA_VERSION;
  readonly id: string;
  readonly userId: string;
  readonly reportId: string;
  readonly reportArtifactHash: string;
  readonly metricHash: string;
  readonly state: WeeklyInterpretationControlState;
  readonly attemptCount: 0 | 1;
  readonly profileHash: string | null;
  readonly claimId: string | null;
  readonly claimExpiresAt: string | null;
  readonly skipReason: WeeklyInterpretationSkipReason | null;
  readonly failureCode: WeeklyInterpretationFailureCode | null;
  readonly interpretation: WeeklyStrategicInterpretation | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type WeeklyInterpretationStableResult = Readonly<{
  action: 'stable';
  interpretation: WeeklyStrategicInterpretation | null;
  state: Exclude<WeeklyInterpretationControlState, 'claimed'>;
}>;

export type WeeklyInterpretationClaimResult =
  | Readonly<{ action: 'generate'; claimId: string }>
  | WeeklyInterpretationStableResult
  | Readonly<{ action: 'retry_later'; notBefore: string }>;

export interface WeeklyInterpretationRepository {
  settleSkipped(input: Readonly<{
    uid: string;
    archive: StoredScientificReportArchive;
    reason: WeeklyInterpretationSkipReason;
    now: string;
  }>): Promise<WeeklyInterpretationStableResult | Readonly<{
    action: 'retry_later';
    notBefore: string;
  }>>;

  claim(input: Readonly<{
    uid: string;
    archive: StoredScientificReportArchive;
    profile: LifeTrackerAiExecutionProfile;
    claimId: string;
    now: string;
  }>): Promise<WeeklyInterpretationClaimResult>;

  finalizeSuccess(input: Readonly<{
    uid: string;
    archive: StoredScientificReportArchive;
    claimId: string;
    interpretation: WeeklyStrategicInterpretation;
    now: string;
  }>): Promise<WeeklyInterpretationStableResult>;

  finalizeFailure(input: Readonly<{
    uid: string;
    archive: StoredScientificReportArchive;
    claimId: string;
    failureCode: Exclude<WeeklyInterpretationFailureCode, 'provider_result_uncertain'>;
    now: string;
  }>): Promise<WeeklyInterpretationStableResult>;
}

export interface WeeklyInterpretationGenerator {
  generate(input: Readonly<{
    uid: string;
    archive: StoredScientificReportArchive;
    profile: LifeTrackerAiExecutionProfile;
    context: WeeklyInterpretationMetricContext;
    idempotencyKey: string;
  }>): Promise<WeeklyInterpretationProviderResult>;
}

export type WeeklyInterpretationProfileResolver = () => LifeTrackerAiExecutionProfile | null;
export type WeeklyInterpretationGeneratorFactory = (
  profile: LifeTrackerAiExecutionProfile,
) => WeeklyInterpretationGenerator;

export type WeeklyInterpretationServiceResult =
  | Readonly<{
    outcome: 'ready';
    interpretation: WeeklyStrategicInterpretation | null;
    state: Exclude<WeeklyInterpretationControlState, 'claimed'>;
  }>
  | Readonly<{ outcome: 'retry_later'; notBefore: string }>;

/**
 * A report gets at most one external interpretation attempt. Provider failure
 * settles deterministic-only; an expired claim settles uncertainty and is
 * never reissued. Archive metrics remain the only numerical authority.
 */
export class WeeklyStrategicInterpretationService {
  constructor(
    private readonly repository: WeeklyInterpretationRepository,
    private readonly resolveProfile: WeeklyInterpretationProfileResolver,
    private readonly createGenerator: WeeklyInterpretationGeneratorFactory,
  ) {}

  async resolve(
    uid: string,
    archive: StoredScientificReportArchive,
    now: string,
  ): Promise<WeeklyInterpretationServiceResult> {
    validateWeeklyArchive(uid, archive);
    const normalizedNow = normalizedInstant(now, 'Interpretation resolution time');
    let profile: LifeTrackerAiExecutionProfile | null;
    let skipReason: WeeklyInterpretationSkipReason = 'routing_disabled';
    try {
      profile = this.resolveProfile();
      if (profile) validateWeeklyProfile(profile);
    } catch {
      profile = null;
      skipReason = 'routing_invalid';
    }
    if (!profile) {
      return serviceResult(await this.repository.settleSkipped({
        uid,
        archive,
        reason: skipReason,
        now: normalizedNow,
      }));
    }

    const claimId = weeklyInterpretationClaimId(uid, archive, profile, normalizedNow);
    const claimed = await this.repository.claim({
      uid,
      archive,
      profile,
      claimId,
      now: normalizedNow,
    });
    if (claimed.action !== 'generate') return serviceResult(claimed);

    const context = buildWeeklyInterpretationMetricContext(uid, archive);
    let providerResult: WeeklyInterpretationProviderResult;
    try {
      providerResult = await this.createGenerator(profile).generate({
        uid,
        archive,
        profile,
        context,
        idempotencyKey: weeklyInterpretationProviderIdempotencyKey(archive, profile),
      });
    } catch {
      return serviceResult(await this.repository.finalizeFailure({
        uid,
        archive,
        claimId: claimed.claimId,
        failureCode: 'provider_unavailable',
        now: normalizedNow,
      }));
    }

    let interpretation: WeeklyStrategicInterpretation;
    try {
      interpretation = createWeeklyStrategicInterpretation(
        uid,
        archive,
        profile,
        context,
        providerResult,
        normalizedNow,
      );
    } catch {
      return serviceResult(await this.repository.finalizeFailure({
        uid,
        archive,
        claimId: claimed.claimId,
        failureCode: 'provider_invalid',
        now: normalizedNow,
      }));
    }
    return serviceResult(await this.repository.finalizeSuccess({
      uid,
      archive,
      claimId: claimed.claimId,
      interpretation,
      now: normalizedNow,
    }));
  }
}

export function buildWeeklyInterpretationMetricContext(
  uid: string,
  archive: StoredScientificReportArchive,
): WeeklyInterpretationMetricContext {
  const report = validateWeeklyArchive(uid, archive);
  const withoutHash = {
    schemaVersion: WEEKLY_INTERPRETATION_METRIC_CONTEXT_SCHEMA_VERSION,
    reportId: report.id,
    reportArtifactHash: archive.artifactHash,
    metricHash: report.metrics.metricHash,
    period: Object.freeze({
      localStartDate: report.period.localStartDate,
      localEndDate: report.period.localEndDate,
      timezone: report.period.timezone,
      dayCount: report.period.dayCount,
    }),
    scalarMetrics: Object.freeze(SCALAR_METRIC_KEYS.map((key) => metricFact(report.metrics[key]))),
    completionByTimeOfDay: completionFacts(report.metrics.completionByTimeOfDay),
    completionByWeekday: completionFacts(report.metrics.completionByWeekday),
    daily: Object.freeze(report.metrics.daily.map(dailyFact)),
    fourWeekTrend: Object.freeze(report.metrics.fourWeekTrend.map(trendFact)),
    dataQuality: Object.freeze({
      complete: report.metrics.dataQuality.complete,
      invalidTimestampCount: report.metrics.dataQuality.invalidTimestampCount,
      invalidDurationCount: report.metrics.dataQuality.invalidDurationCount,
      openSessionCount: report.metrics.dataQuality.openSessionCount,
      completedSessionMissingDurationCount:
        report.metrics.dataQuality.completedSessionMissingDurationCount,
      blocksMissingActualCount: report.metrics.dataQuality.blocksMissingActualCount,
      unattributedActualMinutes: report.metrics.dataQuality.unattributedActualMinutes,
      missingGoalReferenceCount: report.metrics.dataQuality.missingGoalReferenceCount,
      missingSessionsAreZero: false as const,
    }),
  } as const;
  return Object.freeze({
    ...withoutHash,
    contextHash: sha256(withoutHash),
  });
}

export function createWeeklyStrategicInterpretation(
  uid: string,
  archive: StoredScientificReportArchive,
  profile: LifeTrackerAiExecutionProfile,
  context: WeeklyInterpretationMetricContext,
  provider: WeeklyInterpretationProviderResult,
  generatedAt: string,
): WeeklyStrategicInterpretation {
  const report = validateWeeklyArchive(uid, archive);
  validateWeeklyProfile(profile);
  const expectedContext = buildWeeklyInterpretationMetricContext(uid, archive);
  if (canonicalJson(context) !== canonicalJson(expectedContext)) {
    throw new Error('Weekly interpretation metric context is invalid.');
  }
  const allowedMetricIds = new Set(context.scalarMetrics.map((metric) => metric.id));
  const draft = validateWeeklyInterpretationDraft(provider.draft, allowedMetricIds);
  const usage = validateProviderResult(provider, profile);
  const instant = normalizedInstant(generatedAt, 'Weekly interpretation generation time');
  const id = weeklyInterpretationId(archive, profile);
  const withoutHash = {
    schemaVersion: WEEKLY_INTERPRETATION_SCHEMA_VERSION,
    id,
    ownerHash: report.ownerHash,
    reportId: report.id,
    reportArtifactHash: archive.artifactHash,
    metricHash: report.metrics.metricHash,
    metricContextHash: context.contextHash,
    promptVersion: WEEKLY_INTERPRETATION_PROMPT_VERSION,
    outputSchemaVersion: WEEKLY_INTERPRETATION_OUTPUT_SCHEMA_VERSION,
    workload: 'weekly_strategic_review' as const,
    model: profile.model,
    reasoningEffort: profile.reasoningEffort,
    routingConfigId: profile.routingConfigId!,
    evaluationReceiptId: profile.evaluationReceiptId!,
    providerResponseId: provider.providerResponseId,
    providerModel: provider.providerModel,
    ...usage,
    summaryKind: 'INFERENCE' as const,
    summary: draft.summary,
    biggestWin: draft.biggestWin,
    biggestMiss: draft.biggestMiss,
    priorityMismatch: draft.priorityMismatch,
    strongestPattern: draft.strongestPattern,
    largestUncertainty: draft.largestUncertainty,
    topCorrections: draft.topCorrections,
    nextWeekExperiment: draft.nextWeekExperiment,
    untrustedTextPolicy: 'metrics_are_data_not_instructions' as const,
    generatedAt: instant,
  };
  return Object.freeze({
    ...withoutHash,
    artifactHash: sha256(withoutHash),
  });
}

export function validateWeeklyStrategicInterpretation(
  uid: string,
  archive: StoredScientificReportArchive,
  input: unknown,
): WeeklyStrategicInterpretation {
  validateWeeklyArchive(uid, archive);
  const value = exactRecord(input, [
    'artifactHash', 'biggestMiss', 'biggestWin', 'cachedInputTokens', 'evaluationReceiptId', 'generatedAt', 'id',
    'inputTokens', 'largestUncertainty', 'latencyMs', 'metricContextHash', 'metricHash',
    'model', 'nextWeekExperiment', 'outputSchemaVersion', 'outputTokens', 'ownerHash',
    'priorityMismatch', 'promptVersion', 'providerModel', 'providerResponseId', 'reasoningEffort',
    'reasoningTokens', 'reportArtifactHash', 'reportId', 'routingConfigId', 'schemaVersion',
    'strongestPattern', 'summary', 'summaryKind', 'topCorrections', 'totalTokens', 'untrustedTextPolicy', 'workload',
  ], 'Stored weekly interpretation');
  const artifact = input as WeeklyStrategicInterpretation;
  const context = buildWeeklyInterpretationMetricContext(uid, archive);
  const allowedMetricIds = new Set(context.scalarMetrics.map((metric) => metric.id));
  validateWeeklyInterpretationDraft({
    summary: artifact.summary,
    biggestWin: artifact.biggestWin,
    biggestMiss: artifact.biggestMiss,
    priorityMismatch: artifact.priorityMismatch,
    strongestPattern: artifact.strongestPattern,
    largestUncertainty: artifact.largestUncertainty,
    topCorrections: artifact.topCorrections,
    nextWeekExperiment: artifact.nextWeekExperiment,
  }, allowedMetricIds);
  const profile: LifeTrackerAiExecutionProfile = {
    workload: 'weekly_strategic_review',
    model: artifact.model,
    reasoningEffort: artifact.reasoningEffort as LifeTrackerAiExecutionProfile['reasoningEffort'],
    timeoutMs: 20_000,
    maxTurns: 1,
    maxToolCalls: 0,
    maxOutputTokens: 900,
    maxTotalToolOutputBytes: 0,
    routingConfigId: artifact.routingConfigId,
    evaluationReceiptId: artifact.evaluationReceiptId,
  };
  validateWeeklyProfile(profile);
  validateProviderResult({
    providerResponseId: artifact.providerResponseId,
    providerModel: artifact.providerModel,
    inputTokens: artifact.inputTokens,
    cachedInputTokens: artifact.cachedInputTokens,
    outputTokens: artifact.outputTokens,
    reasoningTokens: artifact.reasoningTokens,
    totalTokens: artifact.totalTokens,
    latencyMs: artifact.latencyMs,
    draft: {
      summary: artifact.summary,
      biggestWin: artifact.biggestWin,
      biggestMiss: artifact.biggestMiss,
      priorityMismatch: artifact.priorityMismatch,
      strongestPattern: artifact.strongestPattern,
      largestUncertainty: artifact.largestUncertainty,
      topCorrections: artifact.topCorrections,
      nextWeekExperiment: artifact.nextWeekExperiment,
    },
  }, profile);
  const generatedAt = normalizedInstant(artifact.generatedAt, 'Stored interpretation time');
  const { artifactHash, ...withoutHash } = value;
  if (
    artifact.schemaVersion !== WEEKLY_INTERPRETATION_SCHEMA_VERSION
    || !INTERPRETATION_ID_PATTERN.test(artifact.id)
    || artifact.id !== weeklyInterpretationId(archive, profile)
    || artifact.ownerHash !== archive.ownerHash
    || artifact.reportId !== archive.id
    || artifact.reportArtifactHash !== archive.artifactHash
    || artifact.metricHash !== archive.metricHash
    || artifact.metricContextHash !== context.contextHash
    || artifact.promptVersion !== WEEKLY_INTERPRETATION_PROMPT_VERSION
    || artifact.outputSchemaVersion !== WEEKLY_INTERPRETATION_OUTPUT_SCHEMA_VERSION
    || artifact.workload !== 'weekly_strategic_review'
    || artifact.summaryKind !== 'INFERENCE'
    || artifact.untrustedTextPolicy !== 'metrics_are_data_not_instructions'
    || artifact.generatedAt !== generatedAt
    || typeof artifactHash !== 'string'
    || !HASH_PATTERN.test(artifactHash)
    || artifactHash !== sha256(withoutHash)
  ) {
    throw new Error('Stored weekly interpretation authority is invalid.');
  }
  return input as WeeklyStrategicInterpretation;
}

export function weeklyInterpretationProfileHash(
  profile: LifeTrackerAiExecutionProfile,
): string {
  validateWeeklyProfile(profile);
  return sha256({
    workload: profile.workload,
    model: profile.model,
    reasoningEffort: profile.reasoningEffort,
    maxOutputTokens: profile.maxOutputTokens,
    routingConfigId: profile.routingConfigId,
    evaluationReceiptId: profile.evaluationReceiptId,
    promptVersion: WEEKLY_INTERPRETATION_PROMPT_VERSION,
    outputSchemaVersion: WEEKLY_INTERPRETATION_OUTPUT_SCHEMA_VERSION,
  });
}

export function weeklyInterpretationId(
  archive: StoredScientificReportArchive,
  profile: LifeTrackerAiExecutionProfile,
): string {
  const digest = sha256({
    reportId: archive.id,
    reportArtifactHash: archive.artifactHash,
    metricHash: archive.metricHash,
    profileHash: weeklyInterpretationProfileHash(profile),
  });
  return `weekly_interpretation_${digest.slice(0, 48)}`;
}

export function weeklyInterpretationClaimId(
  uid: string,
  archive: StoredScientificReportArchive,
  profile: LifeTrackerAiExecutionProfile,
  now: string,
): string {
  if (!UID_PATTERN.test(uid)) throw new Error('Weekly interpretation owner is invalid.');
  const digest = sha256({
    uid,
    reportId: archive.id,
    profileHash: weeklyInterpretationProfileHash(profile),
    now: normalizedInstant(now, 'Weekly interpretation claim time'),
  });
  return `weekly_interpretation_claim_${digest.slice(0, 48)}`;
}

export function weeklyInterpretationProviderIdempotencyKey(
  archive: StoredScientificReportArchive,
  profile: LifeTrackerAiExecutionProfile,
): string {
  return `life-tracker-weekly-interpretation/${weeklyInterpretationId(archive, profile)}`;
}

export function validateWeeklyInterpretationClaimId(value: string): void {
  if (!CLAIM_ID_PATTERN.test(value)) throw new Error('Weekly interpretation claim ID is invalid.');
}

function validateWeeklyArchive(
  uid: string,
  archive: StoredScientificReportArchive,
): WeeklyExecutionReport {
  if (!UID_PATTERN.test(uid) || !archive || typeof archive !== 'object') {
    throw new Error('Weekly interpretation owner/archive is invalid.');
  }
  const report = validateScientificExecutionReport(uid, archive.report, 'INTERNAL');
  if (
    report.type !== 'weekly'
    || archive.schemaVersion !== REPORT_ARCHIVE_SCHEMA_VERSION
    || archive.id !== report.id
    || archive.userId !== uid
    || archive.ownerHash !== report.ownerHash
    || archive.type !== 'weekly'
    || archive.metricHash !== report.metrics.metricHash
    || !HASH_PATTERN.test(archive.artifactHash)
    || archive.artifactHash !== scientificReportArtifactHash(report)
  ) {
    throw new Error('Weekly interpretation archive authority is invalid.');
  }
  return report;
}

function validateWeeklyProfile(profile: LifeTrackerAiExecutionProfile): void {
  if (
    profile.workload !== 'weekly_strategic_review'
    || typeof profile.model !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(profile.model)
    || !['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(profile.reasoningEffort)
    || profile.timeoutMs !== 20_000
    || profile.maxTurns !== 1
    || profile.maxToolCalls !== 0
    || profile.maxOutputTokens !== 900
    || profile.maxTotalToolOutputBytes !== 0
    || typeof profile.routingConfigId !== 'string'
    || !/^sha256:[0-9a-f]{64}$/u.test(profile.routingConfigId)
    || typeof profile.evaluationReceiptId !== 'string'
    || !/^model_eval_[0-9a-f]{64}$/u.test(profile.evaluationReceiptId)
  ) {
    throw new Error('Weekly interpretation route profile is invalid.');
  }
}

function validateProviderResult(
  input: WeeklyInterpretationProviderResult,
  profile: LifeTrackerAiExecutionProfile,
) {
  if (
    !input
    || typeof input !== 'object'
    || !RESPONSE_ID_PATTERN.test(input.providerResponseId)
    || input.providerModel !== profile.model
  ) {
    throw new Error('Weekly interpretation provider identity is invalid.');
  }
  const inputTokens = boundedInteger(input.inputTokens, 1, 200_000, 'input tokens');
  const cachedInputTokens = boundedInteger(
    input.cachedInputTokens,
    0,
    inputTokens,
    'cached input tokens',
  );
  const outputTokens = boundedInteger(
    input.outputTokens,
    1,
    profile.maxOutputTokens,
    'output tokens',
  );
  const reasoningTokens = boundedInteger(
    input.reasoningTokens,
    0,
    outputTokens,
    'reasoning tokens',
  );
  const totalTokens = boundedInteger(
    input.totalTokens,
    inputTokens + outputTokens,
    inputTokens + outputTokens,
    'total tokens',
  );
  const latencyMs = boundedInteger(input.latencyMs, 0, profile.timeoutMs + 5_000, 'latency');
  return Object.freeze({
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    latencyMs,
  });
}

function validateWeeklyInterpretationDraft(
  input: WeeklyInterpretationDraft,
  allowedMetricIds: ReadonlySet<string>,
): WeeklyInterpretationDraft {
  exactRecord(input, [
    'biggestMiss', 'biggestWin', 'largestUncertainty', 'nextWeekExperiment',
    'priorityMismatch', 'strongestPattern', 'summary', 'topCorrections',
  ], 'Weekly interpretation output');
  const biggestWin = statement(input.biggestWin, 'INFERENCE', allowedMetricIds, 'biggest win');
  const biggestMiss = statement(input.biggestMiss, 'INFERENCE', allowedMetricIds, 'biggest miss');
  const priorityMismatch = statement(
    input.priorityMismatch,
    'INFERENCE',
    allowedMetricIds,
    'priority mismatch',
  );
  const strongestPattern = statement(
    input.strongestPattern,
    'INFERENCE',
    allowedMetricIds,
    'strongest pattern',
  );
  const largestUncertainty = statement(
    input.largestUncertainty,
    'INFERENCE',
    allowedMetricIds,
    'largest uncertainty',
  );
  const nextWeekExperiment = statement(
    input.nextWeekExperiment,
    'RECOMMENDATION',
    allowedMetricIds,
    'next-week experiment',
  );
  if (!Array.isArray(input.topCorrections) || input.topCorrections.length !== 3) {
    throw new Error('Weekly interpretation top corrections are invalid.');
  }
  const topCorrections = Object.freeze(input.topCorrections.map((correction, index) => statement(
    correction,
    'RECOMMENDATION',
    allowedMetricIds,
    `top correction ${index + 1}`,
  ))) as WeeklyInterpretationDraft['topCorrections'];
  return Object.freeze({
    summary: safeNarrative(input.summary, 'summary', 40, 600),
    biggestWin,
    biggestMiss,
    priorityMismatch,
    strongestPattern,
    largestUncertainty,
    topCorrections,
    nextWeekExperiment,
  });
}

function statement(
  input: WeeklyInterpretationStatement,
  expectedKind: WeeklyInterpretationStatementKind,
  allowedMetricIds: ReadonlySet<string>,
  label: string,
): WeeklyInterpretationStatement {
  exactRecord(input, ['confidence', 'kind', 'metricIds', 'text', 'uncertainty'], label);
  if (input.kind !== expectedKind) throw new Error(`Weekly interpretation ${label} kind is invalid.`);
  if (
    input.confidence !== 'low'
    && input.confidence !== 'moderate'
    && input.confidence !== 'high'
  ) {
    throw new Error(`Weekly interpretation ${label} confidence is invalid.`);
  }
  if (!Array.isArray(input.metricIds) || input.metricIds.length < 1 || input.metricIds.length > 6) {
    throw new Error(`Weekly interpretation ${label} metric references are invalid.`);
  }
  const metricIds = input.metricIds.map((metricId) => {
    if (typeof metricId !== 'string' || !allowedMetricIds.has(metricId)) {
      throw new Error(`Weekly interpretation ${label} metric reference is invalid.`);
    }
    return metricId;
  });
  if (new Set(metricIds).size !== metricIds.length) {
    throw new Error(`Weekly interpretation ${label} metric references are duplicated.`);
  }
  return Object.freeze({
    kind: expectedKind,
    text: safeNarrative(input.text, `${label} text`, 20, 500),
    metricIds: Object.freeze(metricIds),
    confidence: input.confidence,
    uncertainty: safeNarrative(input.uncertainty, `${label} uncertainty`, 20, 400),
  });
}

function safeNarrative(value: unknown, label: string, minimum: number, maximum: number): string {
  if (
    typeof value !== 'string'
    || value !== value.trim()
    || value.length < minimum
    || value.length > maximum
    || /\p{C}/u.test(value)
    || FORBIDDEN_NARRATIVE_PATTERN.test(value)
    || FORBIDDEN_EXACT_QUANTITY_PATTERN.test(value)
  ) {
    throw new Error(`Weekly interpretation ${label} is invalid.`);
  }
  return value;
}

function metricFact(metric: ScientificMetric): WeeklyInterpretationMetricFact {
  return Object.freeze({
    id: metric.id,
    value: metric.value,
    unit: metric.unit,
    availability: metric.availability,
    numerator: metric.numerator,
    denominator: metric.denominator,
    sampleSize: metric.sampleSize,
    missingCount: metric.missingCount,
  });
}

function completionFacts(
  values: readonly CompletionBucketMetric[],
): readonly WeeklyInterpretationCompletionFact[] {
  return Object.freeze(values.map((value) => Object.freeze({
    key: value.key,
    completed: value.completed,
    eligible: value.eligible,
    completionPercent: value.completionPercent,
    missingCount: value.missingCount,
  })));
}

function dailyFact(value: DailyMetricPoint): WeeklyInterpretationDailyFact {
  return Object.freeze({
    localDate: value.localDate,
    plannedMinutes: value.plannedMinutes,
    actualMinutes: value.actualMinutes,
    actualAvailability: value.actualAvailability,
    completedBlocks: value.completedBlocks,
    eligibleBlocks: value.eligibleBlocks,
    completedTasks: value.completedTasks,
  });
}

function trendFact(value: FourWeekTrendPoint): WeeklyInterpretationTrendFact {
  return Object.freeze({
    weekStartDate: value.weekStartDate,
    weekEndDate: value.weekEndDate,
    plannedMinutes: value.plannedMinutes,
    actualMinutes: value.actualMinutes,
    actualAvailability: value.actualAvailability,
    adherencePercent: value.adherencePercent,
    blockCompletionPercent: value.blockCompletionPercent,
  });
}

function serviceResult(
  value: WeeklyInterpretationClaimResult | WeeklyInterpretationStableResult | Readonly<{
    action: 'retry_later';
    notBefore: string;
  }>,
): WeeklyInterpretationServiceResult {
  if (value.action === 'retry_later') {
    return Object.freeze({ outcome: 'retry_later', notBefore: value.notBefore });
  }
  if (value.action === 'generate') {
    throw new Error('Weekly interpretation generation did not settle.');
  }
  return Object.freeze({
    outcome: 'ready',
    interpretation: value.interpretation,
    state: value.state,
  });
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} is invalid.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields are invalid.`);
  }
  return value as Record<string, unknown>;
}

function normalizedInstant(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Weekly interpretation ${label} are invalid.`);
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
