import { createHash } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import type { Firestore } from 'firebase-admin/firestore';
import type {
  WeeklyReviewPipelineState,
  WeeklyReviewSendResponse,
  WeeklyReviewStatusResponse,
} from '../../../packages/report-contract';
import type { StoredScientificReportArchive } from './archive';
import { REPORT_EMAIL_TEMPLATE_VERSION, reportEmailIdempotencyKey } from './email-provider';
import { decodeStoredScientificReportArchiveSnapshot } from './firestore-archive-repository';
import { deriveFirestoreScientificReportSchedulePolicy } from './firestore-schedule-authority';
import type { FirestoreScientificReportRunRepository } from './firestore-report-run-repository';
import type { FirestoreScientificReportScheduleManifestRepository } from './firestore-schedule-manifest-repository';
import type { FirestoreWeeklyInterpretationRepository } from './firestore-weekly-interpretation-repository';
import { reportIdempotencyKey } from './report-builder';
import type { ScientificReportRunService, ScientificReportRunServiceResult } from './report-run';
import type { ScientificReportScheduleCandidate } from './scheduling';
import type { WeeklyReviewApiService } from './weekly-review-api';

type StatusBody = Omit<WeeklyReviewStatusResponse, 'schemaVersion' | 'action'>;
type SendBody = Omit<WeeklyReviewSendResponse, 'schemaVersion' | 'action'>;

/**
 * Authenticated, owner-path-only control surface for the existing report run.
 * It never accepts a mailbox or user ID from the caller and never bypasses the
 * schedule/recipient authority transactions used by the scheduler.
 */
export class FirestoreWeeklyReviewApiService implements WeeklyReviewApiService {
  constructor(
    private readonly firestore: Firestore,
    private readonly manifests: FirestoreScientificReportScheduleManifestRepository,
    private readonly runs: FirestoreScientificReportRunRepository,
    private readonly interpretations: FirestoreWeeklyInterpretationRepository,
    private readonly runner: ScientificReportRunService,
  ) {}

  async status(uid: string, now: string): Promise<StatusBody> {
    const policy = await this.loadPolicy(uid);
    const archive = await this.latestWeeklyArchive(uid);
    const pipelineState = archive
      ? await this.archivePipelineState(uid, archive)
      : 'NOT_DUE';
    return Object.freeze({
      pipelineState,
      schedule: Object.freeze({
        enabled: policy.emailEnabled && policy.weeklyReport.enabled,
        isoWeekday: policy.weeklyReport.isoWeekday,
        localTime: policy.weeklyReport.localTime,
        timezone: policy.timezone,
        nextRunAt: policy.emailEnabled && policy.weeklyReport.enabled
          ? nextWeeklyOccurrence(
            now,
            policy.timezone,
            policy.weeklyReport.isoWeekday,
            policy.weeklyReport.localTime,
          )
          : null,
      }),
      latest: archive
        ? Object.freeze({
          reportId: archive.id,
          period: archive.localStartDate,
          deliveryState: pipelineState,
          providerAcceptedAt: archive.delivery.sentAt,
        })
        : null,
    });
  }

  async sendTest(uid: string, now: string): Promise<SendBody> {
    return this.executeCurrentWeekly(uid, now, null);
  }

  async retryDelivery(uid: string, reportId: string, now: string): Promise<SendBody> {
    const archive = await this.runs.getArchive(uid, reportId);
    if (!archive || archive.type !== 'weekly') return emptyResult(now, 'failed', 'FAILED');
    if (archive.delivery.state === 'sent') {
      return resultForArchive(now, archive, 'already_accepted', 'PROVIDER_ACCEPTED');
    }
    return this.executeCurrentWeekly(uid, now, reportId);
  }

  private async executeCurrentWeekly(
    uid: string,
    now: string,
    expectedReportId: string | null,
  ): Promise<SendBody> {
    await this.manifests.reconcileOwner(uid, now);
    const target = Object.freeze({ uid, reportType: 'weekly' as const });
    const loaded = await this.manifests.loadDueCandidate(target, now);
    if (loaded.action === 'no_op') {
      const latest = await this.latestWeeklyArchive(uid);
      if (latest?.delivery.state === 'sent' && (!expectedReportId || latest.id === expectedReportId)) {
        return resultForArchive(now, latest, 'already_accepted', 'PROVIDER_ACCEPTED');
      }
      if (latest && (!expectedReportId || latest.id === expectedReportId)) {
        const state = await this.archivePipelineState(uid, latest);
        return resultForArchive(
          now,
          latest,
          state === 'RETRY_PENDING' ? 'retry_pending' : 'failed',
          state,
        );
      }
      return emptyResult(now, 'not_due', 'NOT_DUE');
    }

    const candidateReportId = reportIdempotencyKey(
      uid,
      'weekly',
      loaded.candidate.localStartDate,
    );
    if (expectedReportId && expectedReportId !== candidateReportId) {
      return emptyResult(now, 'failed', 'FAILED');
    }

    let execution: ScientificReportRunServiceResult;
    try {
      execution = await this.runner.execute(loaded.candidate, now);
    } catch (error) {
      await this.manifests.recordInvocationFailure({
        target,
        candidate: loaded.candidate,
        now,
      });
      throw error;
    }
    await this.manifests.recordRunResult({
      target,
      candidate: loaded.candidate,
      result: execution,
      now,
    });
    const archive = await this.runs.getArchive(uid, candidateReportId);
    return mapExecution(now, archive, loaded.candidate, execution);
  }

  private async loadPolicy(uid: string) {
    const [user, preferences] = await Promise.all([
      this.firestore.doc(`users/${uid}`).get(),
      this.firestore.doc(`users/${uid}/notificationPreferences/default`).get(),
    ]);
    return deriveFirestoreScientificReportSchedulePolicy(uid, user, preferences);
  }

  private async latestWeeklyArchive(uid: string): Promise<StoredScientificReportArchive | null> {
    const snapshot = await this.firestore.collection(`users/${uid}/reportArchives`)
      .orderBy('generatedAt', 'desc')
      .limit(20)
      .get();
    for (const document of snapshot.docs) {
      const archive = decodeStoredScientificReportArchiveSnapshot(uid, document);
      if (archive.type === 'weekly') return archive;
    }
    return null;
  }

  private async archivePipelineState(
    uid: string,
    archive: StoredScientificReportArchive,
  ): Promise<WeeklyReviewPipelineState> {
    if (archive.delivery.state === 'sent') return 'PROVIDER_ACCEPTED';
    if (archive.delivery.state === 'pending') return 'SENDING';
    if (archive.delivery.state === 'failed') {
      return archive.delivery.failureCode?.startsWith('retryable_') === true
        ? 'RETRY_PENDING'
        : 'FAILED';
    }
    const interpretation = await this.interpretations.getControl(uid, archive.id);
    if (interpretation?.state === 'claimed') return 'INTERPRETING';
    return interpretation ? 'COMPOSED' : 'ARCHIVED';
  }
}

function mapExecution(
  now: string,
  archive: StoredScientificReportArchive | null,
  candidate: ScientificReportScheduleCandidate,
  execution: ScientificReportRunServiceResult,
): SendBody {
  if (execution.outcome === 'completed') {
    if (!archive || archive.delivery.state !== 'sent') {
      return archive
        ? resultForArchive(now, archive, 'failed', 'FAILED')
        : emptyResult(now, 'failed', 'FAILED');
    }
    return resultForArchive(
      now,
      archive,
      execution.delivery === 'already_sent' ? 'already_accepted' : 'provider_accepted',
      'PROVIDER_ACCEPTED',
    );
  }
  if (execution.outcome === 'retry_later') {
    return archive
      ? resultForArchive(now, archive, 'retry_pending', 'RETRY_PENDING')
      : Object.freeze({
        ...emptyResult(now, 'retry_pending', 'RETRY_PENDING'),
        period: candidate.localStartDate,
      });
  }
  if (archive) {
    const state: WeeklyReviewPipelineState = archive.delivery.state === 'sent'
      ? 'PROVIDER_ACCEPTED'
      : 'FAILED';
    return resultForArchive(
      now,
      archive,
      state === 'PROVIDER_ACCEPTED' ? 'already_accepted' : 'failed',
      state,
    );
  }
  return emptyResult(
    now,
    execution.outcome === 'no_op' ? 'not_due' : 'failed',
    execution.outcome === 'no_op' ? 'NOT_DUE' : 'FAILED',
  );
}

function resultForArchive(
  now: string,
  archive: StoredScientificReportArchive,
  outcome: SendBody['outcome'],
  pipelineState: WeeklyReviewPipelineState,
): SendBody {
  const key = reportEmailIdempotencyKey(
    archive.id,
    archive.artifactHash,
    REPORT_EMAIL_TEMPLATE_VERSION,
  );
  return Object.freeze({
    outcome,
    pipelineState,
    reportId: archive.id,
    archiveId: archive.id,
    period: archive.localStartDate,
    providerMessageId: archive.delivery.providerMessageId,
    idempotencyKeyHash: sha256(key),
    occurredAt: normalizedInstant(now),
  });
}

function emptyResult(
  now: string,
  outcome: SendBody['outcome'],
  pipelineState: WeeklyReviewPipelineState,
): SendBody {
  return Object.freeze({
    outcome,
    pipelineState,
    reportId: null,
    archiveId: null,
    period: null,
    providerMessageId: null,
    idempotencyKeyHash: null,
    occurredAt: normalizedInstant(now),
  });
}

function nextWeeklyOccurrence(
  now: string,
  timezone: string,
  isoWeekday: number,
  localTime: string,
): string {
  const instant = Temporal.Instant.from(normalizedInstant(now));
  const local = instant.toZonedDateTimeISO(timezone);
  let date = local.toPlainDate().add({ days: (isoWeekday - local.dayOfWeek + 7) % 7 });
  let occurrence = date
    .toPlainDateTime(Temporal.PlainTime.from(localTime))
    .toZonedDateTime(timezone, { disambiguation: 'compatible' })
    .toInstant();
  if (Temporal.Instant.compare(occurrence, instant) <= 0) {
    date = date.add({ days: 7 });
    occurrence = date
      .toPlainDateTime(Temporal.PlainTime.from(localTime))
      .toZonedDateTime(timezone, { disambiguation: 'compatible' })
      .toInstant();
  }
  return new Date(Number(occurrence.epochMilliseconds)).toISOString();
}

function normalizedInstant(value: string): string {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new Error('Weekly review time is invalid.');
  return new Date(epoch).toISOString();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
