import type {
  MessagingProvider,
  MessagingSendResult,
  ReminderDeliveryClaim,
  ReminderDeliveryFinalization,
  ReminderDeliveryRepository,
  ReminderDeliveryServiceResult,
} from './delivery';

/**
 * At-most-once external delivery. The repository claim is durable before the
 * provider call. After that claim, every ambiguous failure is finalized as
 * uncertain and no automatic path can invoke the provider again.
 */
export class ReminderDeliveryService {
  constructor(
    private readonly repository: ReminderDeliveryRepository,
    private readonly provider: MessagingProvider,
  ) {}

  async deliver(input: {
    readonly uid: string;
    readonly jobId: string;
    readonly taskId: string;
    readonly now: string;
  }): Promise<ReminderDeliveryServiceResult> {
    const preparation = await this.repository.prepareDelivery(input);
    if (preparation.action === 'no_op') {
      return Object.freeze({ outcome: 'no_op', reason: preparation.reason });
    }
    if (preparation.action === 'retry_later') {
      return Object.freeze({ outcome: 'retry_later', notBefore: preparation.notBefore });
    }
    if (preparation.action === 'recover_uncertain') {
      const result: ReminderDeliveryFinalization = Object.freeze({
        outcome: 'uncertain',
        reason: 'worker_recovered_claim',
      });
      await this.repository.finalizeDelivery({
        uid: preparation.uid,
        jobId: preparation.jobId,
        attemptId: preparation.attemptId,
        now: input.now,
        result,
      });
      return result;
    }

    const providerResult = await this.sendOnce(preparation.claim);
    const finalization = normalizeFinalization(providerResult);
    await this.repository.finalizeDelivery({
      uid: preparation.claim.uid,
      jobId: preparation.claim.job.id,
      attemptId: preparation.claim.attemptId,
      now: input.now,
      result: finalization,
    });
    if (finalization.outcome === 'accepted') return Object.freeze({ outcome: 'accepted' });
    if (finalization.outcome === 'rejected') {
      return Object.freeze({ outcome: 'rejected', reason: finalization.reason });
    }
    return Object.freeze({ outcome: 'uncertain', reason: finalization.reason });
  }

  private async sendOnce(claim: ReminderDeliveryClaim): Promise<MessagingSendResult> {
    try {
      return await this.provider.sendReminder(Object.freeze({
        uid: claim.uid,
        jobId: claim.job.id,
        attemptId: claim.attemptId,
        idempotencyKey: claim.job.idempotencyKey,
        message: claim.message,
      }));
    } catch {
      return Object.freeze({ outcome: 'uncertain', reason: 'transport_unknown' });
    }
  }
}

function normalizeFinalization(result: MessagingSendResult): ReminderDeliveryFinalization {
  if (result.outcome === 'accepted') {
    if (
      typeof result.providerMessageId !== 'string'
      || result.providerMessageId.length < 1
      || result.providerMessageId.length > 256
    ) {
      return Object.freeze({ outcome: 'uncertain', reason: 'transport_unknown' });
    }
    return Object.freeze({
      outcome: 'accepted',
      providerMessageId: result.providerMessageId,
    });
  }
  if (result.outcome === 'rejected') {
    return Object.freeze({ outcome: 'rejected', reason: result.reason });
  }
  return Object.freeze({ outcome: 'uncertain', reason: result.reason });
}
