import type {
  CreateEmailOptions,
  CreateEmailRequestOptions,
  CreateEmailResponse,
} from 'resend';
import {
  validateComposedScientificReportEmail,
  validateEmailMailbox,
  type EmailMailbox,
  type EmailProvider,
  type EmailProviderRejectionReason,
  type EmailProviderSendResult,
  type ReportEmailSendRequest,
} from './email-provider';

export interface ResendEmailClient {
  readonly emails: Readonly<{
    send(
      payload: CreateEmailOptions,
      options?: CreateEmailRequestOptions,
    ): Promise<CreateEmailResponse>;
  }>;
}

/**
 * Provider mapping only. Secret retrieval and client construction belong in a
 * future named backend binding so the credential is never available to other
 * Functions or to the browser/Desktop bundle.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly id = 'resend' as const;

  constructor(private readonly client: ResendEmailClient) {}

  async sendReportEmail(request: ReportEmailSendRequest): Promise<EmailProviderSendResult> {
    if (!request || typeof request !== 'object') return rejected('invalid_message');
    try {
      validateEmailMailbox(request.from, 'Sender');
    } catch {
      return rejected('provider_configuration');
    }
    try {
      validateEmailMailbox(request.to, 'Recipient');
    } catch {
      return rejected('invalid_recipient');
    }
    try {
      validateComposedScientificReportEmail(request.email);
    } catch {
      return rejected('invalid_message');
    }

    let response: CreateEmailResponse;
    try {
      response = await this.client.emails.send({
        from: formatMailbox(request.from),
        to: [formatMailbox(request.to)],
        subject: request.email.subject,
        html: request.email.html,
        text: request.email.text,
        attachments: request.email.attachments.map((attachment) => ({
          filename: attachment.filename,
          content: Buffer.from(attachment.content),
          contentType: attachment.contentType,
          contentId: attachment.contentId,
        })),
        tags: [
          { name: 'report_type', value: request.email.reportType },
          { name: 'report_schema', value: 'v1' },
        ],
      }, {
        idempotencyKey: request.email.idempotencyKey,
      });
    } catch {
      return Object.freeze({
        outcome: 'uncertain',
        provider: this.id,
        reason: 'transport_unknown',
      });
    }

    if (response.error) return mapResendError(response.error.name);
    if (
      !response.data
      || typeof response.data.id !== 'string'
      || !/^[A-Za-z0-9_-]{1,256}$/.test(response.data.id)
    ) {
      return Object.freeze({
        outcome: 'uncertain',
        provider: this.id,
        reason: 'transport_unknown',
      });
    }
    return Object.freeze({
      outcome: 'accepted',
      provider: this.id,
      providerMessageId: response.data.id,
    });
  }
}

function formatMailbox(mailbox: EmailMailbox): string {
  return mailbox.name ? `${mailbox.name} <${mailbox.email}>` : mailbox.email;
}

function rejected(reason: EmailProviderRejectionReason): EmailProviderSendResult {
  return Object.freeze({ outcome: 'rejected', provider: 'resend', reason });
}

function mapResendError(name: string): EmailProviderSendResult {
  switch (name) {
    case 'rate_limit_exceeded':
      return Object.freeze({
        outcome: 'retry_later',
        provider: 'resend',
        reason: 'rate_limited',
      });
    case 'concurrent_idempotent_requests':
      return Object.freeze({
        outcome: 'retry_later',
        provider: 'resend',
        reason: 'idempotency_in_progress',
      });
    case 'application_error':
    case 'internal_server_error':
      return Object.freeze({
        outcome: 'uncertain',
        provider: 'resend',
        reason: 'transport_unknown',
      });
    case 'invalid_idempotent_request':
    case 'invalid_idempotency_key':
      return rejected('idempotency_conflict');
    case 'missing_api_key':
    case 'restricted_api_key':
    case 'invalid_api_key':
    case 'invalid_from_address':
    case 'invalid_access':
      return rejected('provider_configuration');
    case 'monthly_quota_exceeded':
    case 'daily_quota_exceeded':
      return rejected('provider_quota_exhausted');
    case 'security_error':
      return rejected('provider_security_rejection');
    case 'invalid_attachment':
    case 'missing_required_field':
      return rejected('invalid_message');
    case 'validation_error':
    case 'invalid_parameter':
    case 'invalid_region':
    case 'not_found':
    case 'method_not_allowed':
    default:
      return rejected('provider_rejected');
  }
}
