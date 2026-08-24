import { describe, expect, it } from 'vitest';
import { ReminderDeliveryService } from '../../src/notifications/delivery-service';
import type {
  FinalizeReminderDeliveryInput,
  MessagingProvider,
  MessagingReminderRequest,
  MessagingSendResult,
  PrepareReminderDeliveryInput,
  ReminderDeliveryPreparation,
  ReminderDeliveryRepository,
} from '../../src/notifications/delivery';
import type { ReminderJob } from '../../src/notifications/domain';

const UID = 'owner-1';
const JOB_ID = 'a'.repeat(64);
const ATTEMPT_ID = 'b'.repeat(64);
const NOW = '2026-08-24T09:45:00.000Z';

describe('ReminderDeliveryService', () => {
  it('returns an authority no-op without contacting the provider', async () => {
    const repository = new FakeDeliveryRepository({
      action: 'no_op',
      reason: 'time_block_changed',
    });
    const provider = new FakeMessagingProvider({
      outcome: 'accepted',
      providerMessageId: 'unused',
    });

    await expect(service(repository, provider).deliver(input())).resolves.toEqual({
      outcome: 'no_op',
      reason: 'time_block_changed',
    });
    expect(provider.requests).toEqual([]);
    expect(repository.finalizations).toEqual([]);
  });

  it('returns a non-mutating retry decision without contacting the provider', async () => {
    const repository = new FakeDeliveryRepository({
      action: 'retry_later',
      notBefore: '2026-08-24T09:46:00.000Z',
    });
    const provider = new FakeMessagingProvider({
      outcome: 'accepted',
      providerMessageId: 'unused',
    });

    await expect(service(repository, provider).deliver(input())).resolves.toEqual({
      outcome: 'retry_later',
      notBefore: '2026-08-24T09:46:00.000Z',
    });
    expect(provider.requests).toEqual([]);
  });

  it('sends one claimed provider-neutral message and finalizes acceptance', async () => {
    const repository = new FakeDeliveryRepository(sendPreparation());
    const provider = new FakeMessagingProvider({
      outcome: 'accepted',
      providerMessageId: 'provider-message-1',
    });

    await expect(service(repository, provider).deliver(input())).resolves.toEqual({
      outcome: 'accepted',
    });
    expect(provider.requests).toEqual([{
      uid: UID,
      jobId: JOB_ID,
      attemptId: ATTEMPT_ID,
      idempotencyKey: 'c'.repeat(64),
      message: message(),
    }]);
    expect(repository.finalizations).toEqual([{
      uid: UID,
      jobId: JOB_ID,
      attemptId: ATTEMPT_ID,
      now: NOW,
      result: { outcome: 'accepted', providerMessageId: 'provider-message-1' },
    }]);
  });

  it.each([
    [{ outcome: 'rejected', reason: 'provider_rejected' }, 'rejected'],
    [{ outcome: 'uncertain', reason: 'provider_timeout' }, 'uncertain'],
  ] as const)('finalizes a bounded provider %s result', async (providerResult, outcome) => {
    const repository = new FakeDeliveryRepository(sendPreparation());
    const provider = new FakeMessagingProvider(providerResult);

    await expect(service(repository, provider).deliver(input())).resolves.toMatchObject({ outcome });
    expect(repository.finalizations[0]?.result).toEqual(providerResult);
    expect(provider.requests).toHaveLength(1);
  });

  it('turns a thrown provider call into uncertainty without leaking or retrying it', async () => {
    const repository = new FakeDeliveryRepository(sendPreparation());
    const provider = new FakeMessagingProvider(new Error('private provider response'));

    await expect(service(repository, provider).deliver(input())).resolves.toEqual({
      outcome: 'uncertain',
      reason: 'transport_unknown',
    });
    expect(repository.finalizations[0]?.result).toEqual({
      outcome: 'uncertain',
      reason: 'transport_unknown',
    });
    expect(JSON.stringify(repository.finalizations)).not.toContain('private provider response');
    expect(provider.requests).toHaveLength(1);
  });

  it('never calls the provider again after a claimed attempt survives a finalization failure', async () => {
    const repository = new FakeDeliveryRepository(sendPreparation());
    repository.failNextFinalization = true;
    const provider = new FakeMessagingProvider({
      outcome: 'accepted',
      providerMessageId: 'accepted-but-finalize-failed',
    });
    const delivery = service(repository, provider);

    await expect(delivery.deliver(input())).rejects.toThrow('simulated persistence failure');
    repository.preparation = {
      action: 'recover_uncertain',
      uid: UID,
      jobId: JOB_ID,
      attemptId: ATTEMPT_ID,
    };
    await expect(delivery.deliver(input())).resolves.toEqual({
      outcome: 'uncertain',
      reason: 'worker_recovered_claim',
    });

    expect(provider.requests).toHaveLength(1);
    expect(repository.finalizations.at(-1)?.result).toEqual({
      outcome: 'uncertain',
      reason: 'worker_recovered_claim',
    });
  });

  it('converts an invalid provider message identity into uncertainty', async () => {
    const repository = new FakeDeliveryRepository(sendPreparation());
    const provider = new FakeMessagingProvider({ outcome: 'accepted', providerMessageId: '' });

    await expect(service(repository, provider).deliver(input())).resolves.toEqual({
      outcome: 'uncertain',
      reason: 'transport_unknown',
    });
    expect(repository.finalizations[0]?.result).toEqual({
      outcome: 'uncertain',
      reason: 'transport_unknown',
    });
  });
});

class FakeDeliveryRepository implements ReminderDeliveryRepository {
  readonly preparations: PrepareReminderDeliveryInput[] = [];
  readonly finalizations: FinalizeReminderDeliveryInput[] = [];
  failNextFinalization = false;

  constructor(public preparation: ReminderDeliveryPreparation) {}

  async prepareDelivery(inputValue: PrepareReminderDeliveryInput) {
    this.preparations.push(structuredClone(inputValue));
    return structuredClone(this.preparation);
  }

  async finalizeDelivery(inputValue: FinalizeReminderDeliveryInput): Promise<void> {
    this.finalizations.push(structuredClone(inputValue));
    if (this.failNextFinalization) {
      this.failNextFinalization = false;
      throw new Error('simulated persistence failure');
    }
  }
}

class FakeMessagingProvider implements MessagingProvider {
  readonly requests: MessagingReminderRequest[] = [];

  constructor(private readonly result: MessagingSendResult | Error) {}

  async sendReminder(request: MessagingReminderRequest): Promise<MessagingSendResult> {
    this.requests.push(structuredClone(request));
    if (this.result instanceof Error) throw this.result;
    return structuredClone(this.result);
  }
}

function service(repository: ReminderDeliveryRepository, provider: MessagingProvider) {
  return new ReminderDeliveryService(repository, provider);
}

function input() {
  return { uid: UID, jobId: JOB_ID, taskId: JOB_ID, now: NOW };
}

function sendPreparation(): ReminderDeliveryPreparation {
  return {
    action: 'send',
    claim: {
      uid: UID,
      job: job(),
      attemptId: ATTEMPT_ID,
      message: message(),
    },
  };
}

function job(): ReminderJob {
  return {
    schemaVersion: 'reminder-job-v1',
    id: JOB_ID,
    uid: UID,
    timeBlockId: 'block-1',
    channel: 'whatsapp',
    kind: 'offset',
    offsetMinutes: 15,
    scheduledFor: NOW,
    expectedTimeBlockVersion: 'd'.repeat(64),
    expectedPolicyVersion: 'e'.repeat(64),
    idempotencyKey: 'c'.repeat(64),
  };
}

function message() {
  return {
    title: 'Deep work',
    startTime: '2026-08-24T10:00:00.000Z',
    plannedMinutes: 60,
    timezone: 'Europe/Rome',
    locale: 'it-IT',
  };
}
