import type { StoredScientificReportArchive } from './archive';
import {
  reportEmailSendAuthorityHash,
  validateReportEmailSendRequest,
  type ComposedScientificReportEmail,
  type EmailMailbox,
  type EmailProvider,
  type EmailProviderRejectionReason,
  type EmailProviderRetryReason,
  type EmailProviderSendResult,
} from './email-provider';
import {
  composeScientificReportEmail,
  type ComposeScientificReportEmailInput,
} from './report-email-template';

export const REPORT_EMAIL_DELIVERY_CONTROL_SCHEMA_VERSION =
  'report-email-delivery-control-v1' as const;
export const REPORT_EMAIL_DELIVERY_ATTEMPT_SCHEMA_VERSION =
  'report-email-delivery-attempt-v1' as const;
export const REPORT_EMAIL_MAX_PROVIDER_ATTEMPTS = 3;
export const REPORT_EMAIL_CLAIM_LEASE_MS = 10 * 60_000;
export const REPORT_EMAIL_RETRY_WINDOW_MS = 12 * 60 * 60_000;

export type ReportEmailDeliveryControlState =
  | 'claimed'
  | 'retryable'
  | 'sent'
  | 'failed'
  | 'uncertain';

export type ReportEmailDeliveryAttemptState =
  | 'claimed'
  | 'accepted'
  | 'rejected'
  | 'retryable'
  | 'uncertain';

export interface StoredReportEmailDeliveryControl {
  readonly schemaVersion: typeof REPORT_EMAIL_DELIVERY_CONTROL_SCHEMA_VERSION;
  readonly id: string;
  readonly userId: string;
  readonly reportId: string;
  readonly reportArtifactHash: string;
  readonly metricHash: string;
  readonly emailContentHash: string;
  readonly sendAuthorityHash: string;
  readonly idempotencyKey: string;
  readonly provider: 'resend';
  readonly state: ReportEmailDeliveryControlState;
  readonly attemptCount: number;
  readonly currentAttemptId: string;
  readonly firstAttemptAt: string;
  readonly lastAttemptAt: string;
  readonly retryDeadline: string;
  readonly nextAttemptAt: string | null;
  readonly providerMessageId: string | null;
  readonly failureCode: string | null;
  readonly updatedAt: string;
}

export interface StoredReportEmailDeliveryAttempt {
  readonly schemaVersion: typeof REPORT_EMAIL_DELIVERY_ATTEMPT_SCHEMA_VERSION;
  readonly id: string;
  readonly userId: string;
  readonly reportId: string;
  readonly attemptNumber: number;
  readonly provider: 'resend';
  readonly emailContentHash: string;
  readonly sendAuthorityHash: string;
  readonly idempotencyKey: string;
  readonly state: ReportEmailDeliveryAttemptState;
  readonly claimedAt: string;
  readonly finalizedAt: string | null;
  readonly nextAttemptAt: string | null;
  readonly providerMessageId: string | null;
  readonly reason: string | null;
}

export interface PrepareReportEmailDeliveryInput {
  readonly uid: string;
  readonly reportId: string;
  readonly reportArtifactHash: string;
  readonly metricHash: string;
  readonly emailContentHash: string;
  readonly sendAuthorityHash: string;
  readonly idempotencyKey: string;
  readonly provider: 'resend';
  readonly now: string;
}

export type ReportEmailDeliveryNoOpReason =
  | 'already_sent'
  | 'terminal_failure'
  | 'delivery_uncertain'
  | 'attempts_exhausted';

export type PrepareReportEmailDeliveryResult =
  | Readonly<{
    action: 'send';
    attemptId: string;
    attemptNumber: number;
  }>
  | Readonly<{
    action: 'retry_later';
    notBefore: string;
  }>
  | Readonly<{
    action: 'no_op';
    reason: ReportEmailDeliveryNoOpReason;
  }>;

export type ReportEmailDeliveryFinalization =
  | Readonly<{ outcome: 'accepted'; providerMessageId: string }>
  | Readonly<{ outcome: 'rejected'; reason: EmailProviderRejectionReason }>
  | Readonly<{ outcome: 'retryable'; reason: EmailProviderRetryReason }>
  | Readonly<{ outcome: 'uncertain'; reason: 'transport_unknown' | 'worker_recovered_claim' }>;

export interface FinalizeReportEmailDeliveryInput {
  readonly uid: string;
  readonly reportId: string;
  readonly attemptId: string;
  readonly sendAuthorityHash: string;
  readonly now: string;
  readonly result: ReportEmailDeliveryFinalization;
}

export type FinalizeReportEmailDeliveryResult =
  | Readonly<{ state: 'sent' }>
  | Readonly<{ state: 'failed' }>
  | Readonly<{ state: 'uncertain' }>
  | Readonly<{ state: 'retryable'; notBefore: string }>
  | Readonly<{ state: 'attempts_exhausted' }>;

export interface ScientificReportEmailDeliveryRepository {
  getArchive(uid: string, reportId: string): Promise<StoredScientificReportArchive | null>;
  prepareEmailDelivery(
    input: PrepareReportEmailDeliveryInput,
  ): Promise<PrepareReportEmailDeliveryResult>;
  finalizeEmailDelivery(
    input: FinalizeReportEmailDeliveryInput,
  ): Promise<FinalizeReportEmailDeliveryResult>;
}

export type ScientificReportEmailDeliveryServiceResult =
  | Readonly<{ outcome: 'accepted' }>
  | Readonly<{ outcome: 'rejected'; reason: EmailProviderRejectionReason }>
  | Readonly<{ outcome: 'retry_later'; notBefore: string }>
  | Readonly<{ outcome: 'uncertain'; reason: 'transport_unknown' }>
  | Readonly<{
    outcome: 'no_op';
    reason: ReportEmailDeliveryNoOpReason | 'report_missing';
  }>;

export type ScientificReportEmailComposer = (
  input: ComposeScientificReportEmailInput,
) => Promise<ComposedScientificReportEmail>;

/** Claim-before-send orchestration. The provider is never called without a durable claim. */
export class ScientificReportEmailDeliveryService {
  constructor(
    private readonly repository: ScientificReportEmailDeliveryRepository,
    private readonly provider: EmailProvider,
    private readonly from: EmailMailbox,
    private readonly composer: ScientificReportEmailComposer = composeScientificReportEmail,
  ) {}

  async deliver(input: Readonly<{
    uid: string;
    reportId: string;
    to: EmailMailbox;
    now: string;
  }>): Promise<ScientificReportEmailDeliveryServiceResult> {
    const archive = await this.repository.getArchive(input.uid, input.reportId);
    if (!archive) return Object.freeze({ outcome: 'no_op', reason: 'report_missing' });
    const email = await this.composer({ uid: input.uid, archive });
    const request = Object.freeze({ from: this.from, to: input.to, email });
    validateReportEmailSendRequest(request);
    const sendAuthorityHash = reportEmailSendAuthorityHash(request);
    const preparation = await this.repository.prepareEmailDelivery({
      uid: input.uid,
      reportId: archive.id,
      reportArtifactHash: archive.artifactHash,
      metricHash: archive.metricHash,
      emailContentHash: email.contentHash,
      sendAuthorityHash,
      idempotencyKey: email.idempotencyKey,
      provider: this.provider.id,
      now: input.now,
    });
    if (preparation.action === 'no_op') {
      return Object.freeze({ outcome: 'no_op', reason: preparation.reason });
    }
    if (preparation.action === 'retry_later') {
      return Object.freeze({ outcome: 'retry_later', notBefore: preparation.notBefore });
    }

    const providerResult = await this.sendOnce(request);
    const finalization = normalizeProviderResult(providerResult, this.provider.id);
    const stored = await this.repository.finalizeEmailDelivery({
      uid: input.uid,
      reportId: archive.id,
      attemptId: preparation.attemptId,
      sendAuthorityHash,
      now: input.now,
      result: finalization,
    });
    if (stored.state === 'sent') return Object.freeze({ outcome: 'accepted' });
    if (stored.state === 'retryable') {
      return Object.freeze({ outcome: 'retry_later', notBefore: stored.notBefore });
    }
    if (stored.state === 'uncertain') {
      return Object.freeze({ outcome: 'uncertain', reason: 'transport_unknown' });
    }
    if (stored.state === 'attempts_exhausted') {
      return Object.freeze({ outcome: 'no_op', reason: 'attempts_exhausted' });
    }
    if (finalization.outcome === 'rejected') {
      return Object.freeze({ outcome: 'rejected', reason: finalization.reason });
    }
    return Object.freeze({ outcome: 'no_op', reason: 'terminal_failure' });
  }

  private async sendOnce(
    request: Parameters<EmailProvider['sendReportEmail']>[0],
  ): Promise<EmailProviderSendResult> {
    try {
      return await this.provider.sendReportEmail(request);
    } catch {
      return Object.freeze({
        outcome: 'uncertain',
        provider: this.provider.id,
        reason: 'transport_unknown',
      });
    }
  }
}

function normalizeProviderResult(
  result: EmailProviderSendResult,
  expectedProvider: EmailProvider['id'],
): ReportEmailDeliveryFinalization {
  if (!result || result.provider !== expectedProvider) {
    return Object.freeze({ outcome: 'uncertain', reason: 'transport_unknown' });
  }
  if (result.outcome === 'accepted') {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(result.providerMessageId)) {
      return Object.freeze({ outcome: 'uncertain', reason: 'transport_unknown' });
    }
    return Object.freeze({ outcome: 'accepted', providerMessageId: result.providerMessageId });
  }
  if (result.outcome === 'rejected') {
    return Object.freeze({ outcome: 'rejected', reason: result.reason });
  }
  if (result.outcome === 'retry_later') {
    return Object.freeze({ outcome: 'retryable', reason: result.reason });
  }
  return Object.freeze({ outcome: 'uncertain', reason: 'transport_unknown' });
}
