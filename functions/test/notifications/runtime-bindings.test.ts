import { describe, expect, it, vi } from 'vitest';
import type {
  FinalizeReminderDeliveryInput,
  PrepareReminderDeliveryInput,
  ReminderDeliveryPreparation,
  ReminderDeliveryRepository,
} from '../../src/notifications/delivery';
import {
  createLazyTwilioReminderDeliveryExecutor,
  desktopReminderApi,
  deliverReminderTask,
  reconcileNotificationPreferenceReminders,
  reconcileTimeBlockReminders,
  reconcileUserProfileReminders,
  refillDeferredReminders,
  twilioWhatsAppStatusCallback,
  type TwilioReminderRuntimeParameters,
} from '../../src/notifications/runtime-bindings';
import type {
  TwilioMessageCreateOptions,
  TwilioMessageCreator,
} from '../../src/notifications/twilio-provider';

const UID = 'owner-1';
const JOB_ID = 'a'.repeat(64);
const ATTEMPT_ID = 'b'.repeat(64);
const PROVIDER_MESSAGE_ID = `SM${'c'.repeat(32)}`;
const ACCOUNT_SID = `AC${'d'.repeat(32)}`;

describe('notification runtime bindings', () => {
  it('exports the exact private/internal functions and one signature-authenticated public edge', () => {
    const taskEndpoint = endpoint(deliverReminderTask);
    const callbackEndpoint = endpoint(twilioWhatsAppStatusCallback);
    const desktopEndpoint = endpoint(desktopReminderApi);

    expect(taskEndpoint).toMatchObject({
      region: ['europe-west1'],
      ingressSettings: 'ALLOW_INTERNAL_ONLY',
      timeoutSeconds: 45,
      minInstances: 0,
      maxInstances: 1,
      concurrency: 1,
      secretEnvironmentVariables: [{ key: 'TWILIO_AUTH_TOKEN' }],
      taskQueueTrigger: { invoker: ['private'] },
    });
    expect(callbackEndpoint).toMatchObject({
      region: ['europe-west1'],
      ingressSettings: 'ALLOW_ALL',
      timeoutSeconds: 15,
      minInstances: 0,
      maxInstances: 2,
      concurrency: 10,
      secretEnvironmentVariables: [{ key: 'TWILIO_AUTH_TOKEN' }],
    });
    expect(desktopEndpoint).toMatchObject({
      region: ['europe-west1'],
      ingressSettings: 'ALLOW_ALL',
      timeoutSeconds: 15,
      minInstances: 0,
      maxInstances: 2,
      concurrency: 20,
      callableTrigger: {},
    });
    expect(JSON.stringify(desktopEndpoint)).not.toMatch(/OPENAI|TWILIO|RESEND|secretEnvironment/i);
    for (const fn of [
      reconcileTimeBlockReminders,
      reconcileNotificationPreferenceReminders,
      reconcileUserProfileReminders,
      refillDeferredReminders,
    ]) {
      expect(endpoint(fn)).toMatchObject({
        region: ['europe-west1'],
        ingressSettings: 'ALLOW_INTERNAL_ONLY',
        minInstances: 0,
      });
    }
    expect(JSON.stringify({ taskEndpoint, callbackEndpoint }))
      .not.toContain('test-auth-token');
  });

  it('does not read any runtime parameter or secret while constructing the lazy executor', () => {
    const parameters = fakeParameters();
    const repository = new FakeDeliveryRepository([]);
    const creator = vi.fn<() => TwilioMessageCreator>();

    createLazyTwilioReminderDeliveryExecutor(repository, parameters.values, creator);

    expect(totalReads(parameters.reads)).toBe(0);
    expect(creator).not.toHaveBeenCalled();
    expect(repository.prepareInputs).toEqual([]);
  });

  it('keeps WhatsApp disabled by default before reading identity, destination, or secret', async () => {
    const parameters = fakeParameters({ enabled: 'false' });
    const repository = new FakeDeliveryRepository([]);
    const creator = vi.fn<() => TwilioMessageCreator>();
    const delivery = createLazyTwilioReminderDeliveryExecutor(
      repository,
      parameters.values,
      creator,
    );

    await expect(delivery.deliver(deliveryInput())).rejects.toThrow('disabled');

    expect(parameters.reads.enabled).toBe(1);
    expect(totalReads(parameters.reads)).toBe(1);
    expect(creator).not.toHaveBeenCalled();
    expect(repository.prepareInputs).toEqual([]);
  });

  it('fails closed on malformed non-secret configuration before reading the auth token', async () => {
    const parameters = fakeParameters({ ownerUid: '' });
    const repository = new FakeDeliveryRepository([]);
    const creator = vi.fn<() => TwilioMessageCreator>();
    const delivery = createLazyTwilioReminderDeliveryExecutor(
      repository,
      parameters.values,
      creator,
    );

    await expect(delivery.deliver(deliveryInput())).rejects.toThrow('owner UID');

    expect(parameters.reads.authToken).toBe(0);
    expect(creator).not.toHaveBeenCalled();
    expect(repository.prepareInputs).toEqual([]);
  });

  it('reads fixed configuration once and binds one provider send to the claimed owner', async () => {
    const parameters = fakeParameters();
    const repository = new FakeDeliveryRepository([
      sendPreparation(),
      { action: 'no_op', reason: 'job_already_finalized' },
    ]);
    const messageCreator = new FakeMessageCreator();
    const creator = vi.fn((accountSid: string, authToken: string) => {
      expect(accountSid).toBe(ACCOUNT_SID);
      expect(authToken).toBe('not-a-real-test-auth-token');
      return messageCreator;
    });
    const delivery = createLazyTwilioReminderDeliveryExecutor(
      repository,
      parameters.values,
      creator,
    );

    await expect(delivery.deliver(deliveryInput())).resolves.toEqual({ outcome: 'accepted' });
    await expect(delivery.deliver(deliveryInput())).resolves.toEqual({
      outcome: 'no_op',
      reason: 'job_already_finalized',
    });

    expect(creator).toHaveBeenCalledTimes(1);
    expect(parameters.reads.contentSid).toBe(0);
    for (const key of [
      'enabled',
      'ownerUid',
      'accountSid',
      'authToken',
      'fromE164',
      'toE164',
      'statusCallbackBaseUrl',
      'contentMode',
    ] as const) {
      expect(parameters.reads[key]).toBe(1);
    }
    expect(messageCreator.requests).toHaveLength(1);
    expect(messageCreator.requests[0]).toMatchObject({
      from: 'whatsapp:+14155238886',
      to: 'whatsapp:+393331112222',
    });
    expect(repository.finalizations).toEqual([expect.objectContaining({
      uid: UID,
      jobId: JOB_ID,
      attemptId: ATTEMPT_ID,
      result: { outcome: 'accepted', providerMessageId: PROVIDER_MESSAGE_ID },
    })]);
  });
});

class RuntimeReader {
  reads = 0;

  constructor(private readonly content: string) {}

  value(): string {
    this.reads += 1;
    return this.content;
  }
}

function fakeParameters(overrides: Partial<Record<keyof TwilioReminderRuntimeParameters, string>> = {}) {
  const raw = {
    enabled: 'true',
    ownerUid: UID,
    accountSid: ACCOUNT_SID,
    authToken: 'not-a-real-test-auth-token',
    fromE164: '+14155238886',
    toE164: '+393331112222',
    statusCallbackBaseUrl:
      'https://europe-west1-example.cloudfunctions.net/twilioWhatsAppStatusCallback',
    contentMode: 'session_text',
    contentSid: 'not-configured',
    ...overrides,
  };
  const readers = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, new RuntimeReader(value)]),
  ) as Record<keyof TwilioReminderRuntimeParameters, RuntimeReader>;
  const reads = {} as Record<keyof TwilioReminderRuntimeParameters, number>;
  Object.defineProperties(reads, Object.fromEntries(
    Object.entries(readers).map(([key, reader]) => [key, {
      enumerable: true,
      get: () => reader.reads,
    }]),
  ));
  return {
    values: readers as TwilioReminderRuntimeParameters,
    reads,
  };
}

function totalReads(reads: Record<keyof TwilioReminderRuntimeParameters, number>): number {
  return Object.values(reads).reduce((total, value) => total + value, 0);
}

class FakeMessageCreator implements TwilioMessageCreator {
  readonly requests: TwilioMessageCreateOptions[] = [];

  async create(options: TwilioMessageCreateOptions) {
    this.requests.push(structuredClone(options));
    return { sid: PROVIDER_MESSAGE_ID, status: 'queued' };
  }
}

class FakeDeliveryRepository implements ReminderDeliveryRepository {
  readonly prepareInputs: PrepareReminderDeliveryInput[] = [];
  readonly finalizations: FinalizeReminderDeliveryInput[] = [];

  constructor(private readonly preparations: ReminderDeliveryPreparation[]) {}

  async prepareDelivery(input: PrepareReminderDeliveryInput) {
    this.prepareInputs.push(structuredClone(input));
    const next = this.preparations.shift();
    if (!next) throw new Error('Unexpected preparation call.');
    return structuredClone(next);
  }

  async finalizeDelivery(input: FinalizeReminderDeliveryInput): Promise<void> {
    this.finalizations.push(structuredClone(input));
  }
}

function sendPreparation(): ReminderDeliveryPreparation {
  return {
    action: 'send',
    claim: {
      uid: UID,
      attemptId: ATTEMPT_ID,
      job: {
        schemaVersion: 'reminder-job-v1',
        id: JOB_ID,
        uid: UID,
        timeBlockId: 'block-1',
        channel: 'whatsapp',
        kind: 'offset',
        offsetMinutes: 15,
        scheduledFor: '2026-08-25T10:00:00.000Z',
        expectedTimeBlockVersion: 'e'.repeat(64),
        expectedPolicyVersion: 'f'.repeat(64),
        idempotencyKey: '1'.repeat(64),
      },
      message: {
        title: 'Deep work',
        startTime: '2026-08-25T10:00:00.000Z',
        plannedMinutes: 60,
        timezone: 'Europe/Rome',
        locale: 'it-IT',
      },
    },
  };
}

function deliveryInput() {
  return {
    uid: UID,
    jobId: JOB_ID,
    taskId: JOB_ID,
    now: '2026-08-25T09:45:00.000Z',
  };
}

function endpoint(value: unknown): Record<string, unknown> {
  return (value as { __endpoint: Record<string, unknown> }).__endpoint;
}
