import type { ReminderJob, ReminderSuppressionReason } from './domain';

export const DELIVERY_ATTEMPT_SCHEMA_VERSION = 'delivery-attempt-v1' as const;
export const DELIVERY_RECEIPT_SCHEMA_VERSION = 'delivery-receipt-v1' as const;
export const NOTIFICATION_IDEMPOTENCY_SCHEMA_VERSION = 'notification-idempotency-v1' as const;

export interface ReminderDeliveryMessageData {
  /** Untrusted display data only; never authorization or provider instructions. */
  readonly title: string;
  readonly startTime: string;
  readonly plannedMinutes: number;
  readonly timezone: string;
  readonly locale: string;
}

export interface ReminderDeliveryClaim {
  readonly uid: string;
  readonly job: ReminderJob;
  readonly attemptId: string;
  readonly message: ReminderDeliveryMessageData;
}

export type ReminderDeliveryNoOpReason =
  | ReminderSuppressionReason
  | 'job_missing'
  | 'job_not_scheduled'
  | 'job_already_finalized'
  | 'task_identity_mismatch';

export type ReminderDeliveryPreparation =
  | Readonly<{ action: 'send'; claim: ReminderDeliveryClaim }>
  | Readonly<{ action: 'retry_later'; notBefore: string }>
  | Readonly<{ action: 'recover_uncertain'; uid: string; jobId: string; attemptId: string }>
  | Readonly<{ action: 'no_op'; reason: ReminderDeliveryNoOpReason }>;

export interface PrepareReminderDeliveryInput {
  readonly uid: string;
  readonly jobId: string;
  readonly taskId: string;
  readonly now: string;
}

export type MessagingRejectionReason =
  | 'invalid_recipient'
  | 'provider_rejected'
  | 'template_unavailable'
  | 'provider_unavailable';

export type MessagingUncertaintyReason =
  | 'provider_timeout'
  | 'transport_unknown'
  | 'worker_recovered_claim';

export type MessagingSendResult =
  | Readonly<{ outcome: 'accepted'; providerMessageId: string }>
  | Readonly<{ outcome: 'rejected'; reason: MessagingRejectionReason }>
  | Readonly<{ outcome: 'uncertain'; reason: Exclude<MessagingUncertaintyReason, 'worker_recovered_claim'> }>;

export interface MessagingReminderRequest {
  readonly uid: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly idempotencyKey: string;
  readonly message: ReminderDeliveryMessageData;
}

export interface MessagingProvider {
  sendReminder(request: MessagingReminderRequest): Promise<MessagingSendResult>;
}

export type ReminderDeliveryFinalization =
  | Readonly<{
    outcome: 'accepted';
    providerMessageId: string;
  }>
  | Readonly<{
    outcome: 'rejected';
    reason: MessagingRejectionReason;
  }>
  | Readonly<{
    outcome: 'uncertain';
    reason: MessagingUncertaintyReason;
  }>;

export interface FinalizeReminderDeliveryInput {
  readonly uid: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly now: string;
  readonly result: ReminderDeliveryFinalization;
}

export interface ReminderDeliveryRepository {
  /** Atomically evaluates current authority and consumes idempotency before send. */
  prepareDelivery(input: PrepareReminderDeliveryInput): Promise<ReminderDeliveryPreparation>;

  /** Idempotent finalization; provider errors/messages are never accepted as raw data. */
  finalizeDelivery(input: FinalizeReminderDeliveryInput): Promise<void>;
}

export type ReminderDeliveryServiceResult =
  | Readonly<{ outcome: 'accepted' }>
  | Readonly<{ outcome: 'rejected'; reason: MessagingRejectionReason }>
  | Readonly<{ outcome: 'uncertain'; reason: MessagingUncertaintyReason }>
  | Readonly<{ outcome: 'retry_later'; notBefore: string }>
  | Readonly<{ outcome: 'no_op'; reason: ReminderDeliveryNoOpReason }>;
