import type { AuthContext } from '../domain/types';
import type {
  StoredScientificReportArchive,
} from './archive';
import type { EmailMailbox } from './email-provider';
import type {
  ScientificReportEmailDeliveryServiceResult,
} from './email-delivery';
import { buildScientificExecutionReport } from './report-builder';
import type {
  ScientificReportScheduleCandidate,
  ScientificReportScheduleSuppressionReason,
} from './scheduling';
import type {
  ScientificExecutionReport,
  ScientificReportInput,
} from './types';
import type {
  WeeklyInterpretationServiceResult,
  WeeklyStrategicInterpretation,
} from './weekly-interpretation';

export const REPORT_RUN_STORAGE_SCHEMA_VERSION = 'scientific-report-run-v1' as const;
export const REPORT_RUN_GENERATION_CLAIM_LEASE_MS = 10 * 60_000;
export const REPORT_RUN_DELIVERY_CLAIM_LEASE_MS = 15 * 60_000;
export const REPORT_RUN_MAX_GENERATION_ATTEMPTS = 3;
export const REPORT_RUN_MAX_DELIVERY_ATTEMPTS = 5;

export type ScientificReportRunState =
  | 'generating'
  | 'generation_retryable'
  | 'archived'
  | 'delivery_authorized'
  | 'delivery_retryable'
  | 'completed'
  | 'suppressed'
  | 'failed';

export type ScientificReportRunFailureCode =
  | 'source_unavailable'
  | 'generation_invalid'
  | 'archive_conflict'
  | 'generation_attempts_exhausted'
  | 'delivery_service_unavailable'
  | 'delivery_rejected'
  | 'delivery_uncertain'
  | 'delivery_terminal_failure'
  | 'delivery_attempts_exhausted'
  | 'archive_missing';

export type ScientificReportRunDeliveryOutcome = 'accepted' | 'already_sent';

export interface StoredScientificReportRun {
  readonly schemaVersion: typeof REPORT_RUN_STORAGE_SCHEMA_VERSION;
  readonly id: string;
  readonly userId: string;
  readonly reportId: string;
  readonly reportType: 'daily' | 'weekly';
  readonly localDate: string;
  readonly localStartDate: string;
  readonly scheduledFor: string;
  readonly expectedScheduleVersion: string;
  readonly recipientAuthorityHash: string;
  readonly state: ScientificReportRunState;
  readonly generationAttemptCount: number;
  readonly currentGenerationClaimId: string | null;
  readonly lastGenerationClaimId: string | null;
  readonly generatedAt: string;
  readonly generationClaimExpiresAt: string | null;
  readonly deliveryAttemptCount: number;
  readonly currentDeliveryClaimId: string | null;
  readonly lastDeliveryClaimId: string | null;
  readonly deliveryClaimExpiresAt: string | null;
  readonly nextAttemptAt: string | null;
  readonly archiveArtifactHash: string | null;
  readonly archiveMetricHash: string | null;
  readonly deliveryOutcome: ScientificReportRunDeliveryOutcome | null;
  readonly suppressionReason: ScientificReportScheduleSuppressionReason | null;
  readonly failureCode: ScientificReportRunFailureCode | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export type ClaimScientificReportRunResult =
  | Readonly<{
    action: 'generate';
    claimId: string;
    generatedAt: string;
    reportId: string;
    timezone: string;
    locale: string;
  }>
  | Readonly<{ action: 'resume_delivery'; reportId: string }>
  | Readonly<{ action: 'retry_later'; stage: 'generation' | 'delivery'; notBefore: string }>
  | Readonly<{
    action: 'no_op';
    reason: ScientificReportScheduleSuppressionReason | 'already_completed' | 'terminal_failure';
  }>;

export type CommitScientificReportRunResult =
  | Readonly<{
    action: 'archived';
    archive: StoredScientificReportArchive;
    idempotentReplay: boolean;
  }>
  | Readonly<{
    action: 'suppressed';
    reason: ScientificReportScheduleSuppressionReason;
  }>
  | Readonly<{ action: 'failed'; reason: 'archive_conflict' | 'generation_invalid' }>;

export type RecordScientificReportRunFailureResult =
  | Readonly<{ action: 'retry_later'; stage: 'generation' | 'delivery'; notBefore: string }>
  | Readonly<{ action: 'failed'; reason: ScientificReportRunFailureCode }>;

export type AuthorizeScientificReportRunDeliveryResult =
  | Readonly<{ action: 'deliver'; claimId: string; recipient: EmailMailbox }>
  | Readonly<{ action: 'retry_later'; notBefore: string }>
  | Readonly<{
    action: 'suppressed';
    reason: ScientificReportScheduleSuppressionReason;
  }>
  | Readonly<{ action: 'no_op'; reason: 'already_completed' | 'terminal_failure' }>;

export type FinalizeScientificReportRunDeliveryResult =
  | Readonly<{
    action: 'completed';
    delivery: ScientificReportRunDeliveryOutcome;
  }>
  | Readonly<{ action: 'retry_later'; notBefore: string }>
  | Readonly<{ action: 'failed'; reason: ScientificReportRunFailureCode }>;

export interface ScientificReportRunRepository {
  claimGeneration(
    candidate: ScientificReportScheduleCandidate,
    now: string,
  ): Promise<ClaimScientificReportRunResult>;

  getArchive(uid: string, reportId: string): Promise<StoredScientificReportArchive | null>;

  commitGeneratedReport(input: Readonly<{
    candidate: ScientificReportScheduleCandidate;
    claimId: string;
    report: ScientificExecutionReport;
    now: string;
  }>): Promise<CommitScientificReportRunResult>;

  recordGenerationFailure(input: Readonly<{
    candidate: ScientificReportScheduleCandidate;
    claimId: string;
    reason: Extract<ScientificReportRunFailureCode, 'source_unavailable' | 'generation_invalid'>;
    now: string;
  }>): Promise<RecordScientificReportRunFailureResult>;

  authorizeDelivery(input: Readonly<{
    candidate: ScientificReportScheduleCandidate;
    reportId: string;
    archiveArtifactHash: string;
    archiveMetricHash: string;
    now: string;
  }>): Promise<AuthorizeScientificReportRunDeliveryResult>;

  finalizeDelivery(input: Readonly<{
    candidate: ScientificReportScheduleCandidate;
    reportId: string;
    claimId: string;
    now: string;
    result: ScientificReportEmailDeliveryServiceResult;
  }>): Promise<FinalizeScientificReportRunDeliveryResult>;

  recordDeliveryInvocationFailure(input: Readonly<{
    candidate: ScientificReportScheduleCandidate;
    reportId: string;
    claimId: string;
    now: string;
  }>): Promise<RecordScientificReportRunFailureResult>;
}

export interface ScientificReportRunSource {
  load(
    context: AuthContext,
    request: Readonly<{
      reportType: 'daily' | 'weekly';
      localDate: string;
      locale: string;
    }>,
  ): Promise<ScientificReportInput>;
}

export interface ScientificReportRunEmailDeliveryService {
  deliver(input: Readonly<{
    uid: string;
    reportId: string;
    to: EmailMailbox;
    now: string;
    interpretation?: WeeklyStrategicInterpretation | null;
  }>): Promise<ScientificReportEmailDeliveryServiceResult>;
}

export interface ScientificReportRunInterpretationService {
  resolve(
    uid: string,
    archive: StoredScientificReportArchive,
    now: string,
  ): Promise<WeeklyInterpretationServiceResult>;
}

export type ScientificReportRunServiceResult =
  | Readonly<{
    outcome: 'completed';
    reportId: string;
    archiveReused: boolean;
    delivery: ScientificReportRunDeliveryOutcome;
  }>
  | Readonly<{
    outcome: 'retry_later';
    stage: 'generation' | 'delivery';
    notBefore: string;
  }>
  | Readonly<{
    outcome: 'no_op';
    reason:
      | ScientificReportScheduleSuppressionReason
      | 'already_completed'
      | 'terminal_failure';
  }>
  | Readonly<{
    outcome: 'failed';
    stage: 'generation' | 'delivery';
    reason: ScientificReportRunFailureCode;
  }>;

export type ScientificReportRunBuilder = (
  input: ScientificReportInput,
) => ScientificExecutionReport;

/**
 * No provider is called until the repository has atomically committed an
 * immutable archive and re-authorized the current in-memory recipient.
 */
export class ScientificReportRunService {
  constructor(
    private readonly repository: ScientificReportRunRepository,
    private readonly source: ScientificReportRunSource,
    private readonly delivery: ScientificReportRunEmailDeliveryService,
    private readonly builder: ScientificReportRunBuilder = buildScientificExecutionReport,
    private readonly interpretation?: ScientificReportRunInterpretationService,
  ) {}

  async execute(
    candidate: ScientificReportScheduleCandidate,
    now: string,
  ): Promise<ScientificReportRunServiceResult> {
    const claim = await this.repository.claimGeneration(candidate, now);
    if (claim.action === 'retry_later') return retryResult(claim);
    if (claim.action === 'no_op') {
      return Object.freeze({ outcome: 'no_op', reason: claim.reason });
    }

    let reportId = claim.reportId;
    let archive: StoredScientificReportArchive;
    let archiveReused = claim.action === 'resume_delivery';
    if (claim.action === 'resume_delivery') {
      const existing = await this.repository.getArchive(candidate.uid, claim.reportId);
      if (!existing) {
        return Object.freeze({
          outcome: 'failed',
          stage: 'generation',
          reason: 'archive_missing',
        });
      }
      archive = existing;
    } else {
      const existing = await this.repository.getArchive(candidate.uid, claim.reportId);
      let report: ScientificExecutionReport;
      if (existing) {
        archiveReused = true;
        report = existing.report;
      } else {
        let input: ScientificReportInput;
        try {
          input = await this.source.load(
            trustedReportContext(candidate.uid, candidate.id),
            {
              reportType: candidate.reportType,
              localDate: candidate.localDate,
              locale: claim.locale,
            },
          );
        } catch {
          return this.generationFailure(candidate, claim.claimId, 'source_unavailable', now);
        }
        try {
          assertSourceAuthority(input, candidate, claim.timezone, claim.locale);
          report = this.builder({ ...input, generatedAt: claim.generatedAt });
        } catch {
          return this.generationFailure(candidate, claim.claimId, 'generation_invalid', now);
        }
      }

      const committed = await this.repository.commitGeneratedReport({
        candidate,
        claimId: claim.claimId,
        report,
        now,
      });
      if (committed.action === 'suppressed') {
        return Object.freeze({ outcome: 'no_op', reason: committed.reason });
      }
      if (committed.action === 'failed') {
        return Object.freeze({ outcome: 'failed', stage: 'generation', reason: committed.reason });
      }
      archive = committed.archive;
      reportId = archive.id;
      archiveReused ||= committed.idempotentReplay;
    }

    let strategicInterpretation: WeeklyStrategicInterpretation | null = null;
    if (archive.type === 'weekly' && this.interpretation) {
      let resolved: WeeklyInterpretationServiceResult;
      try {
        resolved = await this.interpretation.resolve(candidate.uid, archive, now);
      } catch {
        return Object.freeze({
          outcome: 'retry_later',
          stage: 'delivery',
          notBefore: new Date(Date.parse(now) + 5 * 60_000).toISOString(),
        });
      }
      if (resolved.outcome === 'retry_later') {
        return Object.freeze({
          outcome: 'retry_later',
          stage: 'delivery',
          notBefore: resolved.notBefore,
        });
      }
      strategicInterpretation = resolved.interpretation;
    }

    const authorization = await this.repository.authorizeDelivery({
      candidate,
      reportId,
      archiveArtifactHash: archive.artifactHash,
      archiveMetricHash: archive.metricHash,
      now,
    });
    if (authorization.action === 'retry_later') {
      return Object.freeze({
        outcome: 'retry_later',
        stage: 'delivery',
        notBefore: authorization.notBefore,
      });
    }
    if (authorization.action === 'suppressed') {
      return Object.freeze({ outcome: 'no_op', reason: authorization.reason });
    }
    if (authorization.action === 'no_op') {
      return Object.freeze({ outcome: 'no_op', reason: authorization.reason });
    }

    let result: ScientificReportEmailDeliveryServiceResult;
    try {
      result = await this.delivery.deliver({
        uid: candidate.uid,
        reportId,
        to: authorization.recipient,
        now,
        ...(strategicInterpretation ? { interpretation: strategicInterpretation } : {}),
      });
    } catch {
      const failure = await this.repository.recordDeliveryInvocationFailure({
        candidate,
        reportId,
        claimId: authorization.claimId,
        now,
      });
      return failure.action === 'retry_later'
        ? retryResult(failure)
        : Object.freeze({
          outcome: 'failed',
          stage: 'delivery',
          reason: failure.reason,
        });
    }

    const finalized = await this.repository.finalizeDelivery({
      candidate,
      reportId,
      claimId: authorization.claimId,
      now,
      result,
    });
    if (finalized.action === 'completed') {
      return Object.freeze({
        outcome: 'completed',
        reportId,
        archiveReused,
        delivery: finalized.delivery,
      });
    }
    if (finalized.action === 'retry_later') {
      return Object.freeze({
        outcome: 'retry_later',
        stage: 'delivery',
        notBefore: finalized.notBefore,
      });
    }
    return Object.freeze({
      outcome: 'failed',
      stage: 'delivery',
      reason: finalized.reason,
    });
  }

  private async generationFailure(
    candidate: ScientificReportScheduleCandidate,
    claimId: string,
    reason: Extract<ScientificReportRunFailureCode, 'source_unavailable' | 'generation_invalid'>,
    now: string,
  ): Promise<ScientificReportRunServiceResult> {
    const failure = await this.repository.recordGenerationFailure({
      candidate,
      claimId,
      reason,
      now,
    });
    return failure.action === 'retry_later'
      ? retryResult(failure)
      : Object.freeze({ outcome: 'failed', stage: 'generation', reason: failure.reason });
  }
}

function trustedReportContext(uid: string, runId: string): AuthContext {
  return Object.freeze({ uid, requestId: `report-run:${runId}` });
}

function assertSourceAuthority(
  input: ScientificReportInput,
  candidate: ScientificReportScheduleCandidate,
  expectedTimezone: string,
  expectedLocale: string,
): void {
  if (
    input.uid !== candidate.uid
    || input.reportType !== candidate.reportType
    || input.localDate !== candidate.localDate
    || input.timezone !== expectedTimezone
    || input.preferences.timezone !== expectedTimezone
    || input.locale !== expectedLocale
  ) {
    throw new Error('Scientific report source authority changed during generation.');
  }
}

function retryResult(input: Readonly<{
  stage: 'generation' | 'delivery';
  notBefore: string;
}>): ScientificReportRunServiceResult {
  return Object.freeze({
    outcome: 'retry_later',
    stage: input.stage,
    notBefore: input.notBefore,
  });
}
