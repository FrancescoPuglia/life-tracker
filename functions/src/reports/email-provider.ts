import { createHash } from 'node:crypto';
import { canonicalJson } from '../domain/integrity';

export const REPORT_EMAIL_SCHEMA_VERSION = 'scientific-report-email-v1' as const;
export const REPORT_EMAIL_TEMPLATE_VERSION = 'life-tracker-report-email-2026-08-25' as const;
export const REPORT_EMAIL_MAX_HTML_BYTES = 600_000;
export const REPORT_EMAIL_MAX_TEXT_BYTES = 300_000;
export const REPORT_EMAIL_MAX_ATTACHMENTS = 10;
export const REPORT_EMAIL_MAX_ATTACHMENT_BYTES = 1_000_000;
export const REPORT_EMAIL_MAX_TOTAL_ATTACHMENT_BYTES = 10_000_000;

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const REPORT_ID_PATTERN = /^report_[0-9a-f]{56}$/;
const CHART_ID_PATTERN = /^chart_[0-9a-f]{48}$/;
const CONTENT_ID_PATTERN = /^chart_[0-9a-f]{48}@life-tracker-report$/;
const EMAIL_PATTERN = /^[^\s@<>]{1,64}@[^\s@<>]{1,185}$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ACTIVE_HTML_PATTERN = /<(?:script|iframe|object|embed|form|input|button|video|audio|link)\b|\burl\s*\(/i;

export type EmailProviderId = 'resend';

export interface EmailMailbox {
  readonly email: string;
  readonly name: string | null;
}

export interface ReportEmailAttachment {
  readonly chartId: string;
  readonly filename: string;
  readonly contentId: string;
  readonly contentType: 'image/png';
  readonly byteLength: number;
  readonly contentHash: string;
  readonly content: Buffer;
}

export interface ComposedScientificReportEmail {
  readonly schemaVersion: typeof REPORT_EMAIL_SCHEMA_VERSION;
  readonly templateVersion: typeof REPORT_EMAIL_TEMPLATE_VERSION;
  readonly reportId: string;
  readonly reportType: 'daily' | 'weekly';
  readonly reportArtifactHash: string;
  readonly metricHash: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly attachments: readonly ReportEmailAttachment[];
  readonly contentHash: string;
  /** Stable across retries and template changes; durable state remains authoritative. */
  readonly idempotencyKey: string;
}

export interface ReportEmailSendRequest {
  readonly from: EmailMailbox;
  readonly to: EmailMailbox;
  readonly email: ComposedScientificReportEmail;
}

export type EmailProviderRejectionReason =
  | 'invalid_message'
  | 'invalid_recipient'
  | 'provider_configuration'
  | 'provider_quota_exhausted'
  | 'provider_security_rejection'
  | 'idempotency_conflict'
  | 'provider_rejected';

export type EmailProviderRetryReason =
  | 'rate_limited'
  | 'idempotency_in_progress';

export type EmailProviderSendResult =
  | Readonly<{
    outcome: 'accepted';
    provider: EmailProviderId;
    providerMessageId: string;
  }>
  | Readonly<{
    outcome: 'rejected';
    provider: EmailProviderId;
    reason: EmailProviderRejectionReason;
  }>
  | Readonly<{
    outcome: 'retry_later';
    provider: EmailProviderId;
    reason: EmailProviderRetryReason;
  }>
  | Readonly<{
    outcome: 'uncertain';
    provider: EmailProviderId;
    reason: 'transport_unknown';
  }>;

export interface EmailProvider {
  readonly id: EmailProviderId;
  sendReportEmail(request: ReportEmailSendRequest): Promise<EmailProviderSendResult>;
}

export class ReportEmailValidationError extends Error {
  readonly code = 'REPORT_EMAIL_INVALID';

  constructor(message = 'Report email is invalid.') {
    super(message);
    this.name = 'ReportEmailValidationError';
  }
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fail(message: string): never {
  throw new ReportEmailValidationError(message);
}

export function validateEmailMailbox(mailbox: EmailMailbox, label: string): void {
  if (
    !mailbox
    || typeof mailbox !== 'object'
    || typeof mailbox.email !== 'string'
    || mailbox.email.length > 254
    || !EMAIL_PATTERN.test(mailbox.email)
    || /[\r\n\u0000]/.test(mailbox.email)
  ) {
    fail(`${label} email address is invalid.`);
  }
  const domain = mailbox.email.slice(mailbox.email.lastIndexOf('@') + 1);
  if (
    domain.length < 3
    || domain.startsWith('.')
    || domain.endsWith('.')
    || !domain.includes('.')
  ) {
    fail(`${label} email address is invalid.`);
  }
  if (
    mailbox.name !== null
    && (
      typeof mailbox.name !== 'string'
      || mailbox.name.length < 1
      || mailbox.name.length > 100
      || /[\r\n\u0000<>"\\]/.test(mailbox.name)
    )
  ) {
    fail(`${label} display name is invalid.`);
  }
}

function validateAttachment(attachment: ReportEmailAttachment): void {
  if (
    !attachment
    || typeof attachment !== 'object'
    || !Buffer.isBuffer(attachment.content)
    || !CHART_ID_PATTERN.test(attachment.chartId)
    || !CONTENT_ID_PATTERN.test(attachment.contentId)
    || attachment.contentId !== `${attachment.chartId}@life-tracker-report`
    || typeof attachment.filename !== 'string'
    || !/^chart-[a-z0-9-]{1,80}\.png$/.test(attachment.filename)
    || attachment.contentType !== 'image/png'
    || !Number.isInteger(attachment.byteLength)
    || attachment.byteLength < PNG_SIGNATURE.length
    || attachment.byteLength > REPORT_EMAIL_MAX_ATTACHMENT_BYTES
    || attachment.byteLength !== attachment.content.length
    || !HASH_PATTERN.test(attachment.contentHash)
    || sha256(attachment.content) !== attachment.contentHash
    || !attachment.content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    fail('Report email attachment is invalid.');
  }
}

function emailContentAuthority(email: Omit<ComposedScientificReportEmail, 'contentHash'>) {
  return {
    schemaVersion: email.schemaVersion,
    templateVersion: email.templateVersion,
    reportId: email.reportId,
    reportType: email.reportType,
    reportArtifactHash: email.reportArtifactHash,
    metricHash: email.metricHash,
    subject: email.subject,
    html: email.html,
    text: email.text,
    attachments: email.attachments.map((attachment) => ({
      chartId: attachment.chartId,
      filename: attachment.filename,
      contentId: attachment.contentId,
      contentType: attachment.contentType,
      byteLength: attachment.byteLength,
      contentHash: attachment.contentHash,
    })),
    idempotencyKey: email.idempotencyKey,
  };
}

export function reportEmailContentHash(
  email: Omit<ComposedScientificReportEmail, 'contentHash'>,
): string {
  return sha256(canonicalJson(emailContentAuthority(email)));
}

export function validateComposedScientificReportEmail(
  email: ComposedScientificReportEmail,
): void {
  if (
    !email
    || typeof email !== 'object'
    || email.schemaVersion !== REPORT_EMAIL_SCHEMA_VERSION
    || email.templateVersion !== REPORT_EMAIL_TEMPLATE_VERSION
    || !REPORT_ID_PATTERN.test(email.reportId)
    || (email.reportType !== 'daily' && email.reportType !== 'weekly')
    || !HASH_PATTERN.test(email.reportArtifactHash)
    || !HASH_PATTERN.test(email.metricHash)
    || typeof email.subject !== 'string'
    || email.subject.length < 1
    || email.subject.length > 200
    || /[\r\n\u0000]/.test(email.subject)
    || typeof email.html !== 'string'
    || Buffer.byteLength(email.html, 'utf8') < 100
    || Buffer.byteLength(email.html, 'utf8') > REPORT_EMAIL_MAX_HTML_BYTES
    || typeof email.text !== 'string'
    || Buffer.byteLength(email.text, 'utf8') < 100
    || Buffer.byteLength(email.text, 'utf8') > REPORT_EMAIL_MAX_TEXT_BYTES
    || /\u0000/.test(email.text)
    || !Array.isArray(email.attachments)
    || email.attachments.length < 1
    || email.attachments.length > REPORT_EMAIL_MAX_ATTACHMENTS
    || !HASH_PATTERN.test(email.contentHash)
    || email.idempotencyKey !== `life-tracker-report/${email.reportId}`
  ) {
    fail('Composed report email identity or bounds are invalid.');
  }
  if (ACTIVE_HTML_PATTERN.test(email.html)) {
    fail('Composed report email contains active content.');
  }
  const externalUrls = email.html.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  if (externalUrls.length > 0) {
    fail('Composed report email contains an external resource URL.');
  }
  const contentIds = new Set<string>();
  let totalAttachmentBytes = 0;
  for (const attachment of email.attachments) {
    validateAttachment(attachment);
    if (contentIds.has(attachment.contentId)) fail('Report email attachment is duplicated.');
    contentIds.add(attachment.contentId);
    totalAttachmentBytes += attachment.byteLength;
    const reference = `cid:${attachment.contentId}`;
    if (email.html.split(reference).length !== 2) {
      fail('Report email attachment reference is invalid.');
    }
  }
  if (totalAttachmentBytes > REPORT_EMAIL_MAX_TOTAL_ATTACHMENT_BYTES) {
    fail('Report email attachments exceed their safe total size.');
  }
  const cidReferences = email.html.match(/cid:[a-z0-9_@.-]+/gi) ?? [];
  if (
    cidReferences.length !== contentIds.size
    || cidReferences.some((reference) => !contentIds.has(reference.slice(4)))
  ) {
    fail('Report email contains an unbound inline attachment reference.');
  }
  const { contentHash: _contentHash, ...withoutHash } = email;
  if (reportEmailContentHash(withoutHash) !== email.contentHash) {
    fail('Report email content hash is invalid.');
  }
}

export function validateReportEmailSendRequest(request: ReportEmailSendRequest): void {
  if (!request || typeof request !== 'object') fail('Report email request is invalid.');
  validateEmailMailbox(request.from, 'Sender');
  validateEmailMailbox(request.to, 'Recipient');
  validateComposedScientificReportEmail(request.email);
}

/** One-way authority persisted for a delivery claim; mailbox values are not stored. */
export function reportEmailSendAuthorityHash(request: ReportEmailSendRequest): string {
  validateReportEmailSendRequest(request);
  return sha256(canonicalJson({
    schemaVersion: REPORT_EMAIL_SCHEMA_VERSION,
    from: request.from,
    to: request.to,
    reportId: request.email.reportId,
    reportType: request.email.reportType,
    contentHash: request.email.contentHash,
    idempotencyKey: request.email.idempotencyKey,
  }));
}
