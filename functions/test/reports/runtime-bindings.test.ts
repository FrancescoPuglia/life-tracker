import { describe, expect, it, vi } from 'vitest';
import type {
  FinalizeReportEmailDeliveryInput,
  PrepareReportEmailDeliveryInput,
  ScientificReportEmailDeliveryRepository,
} from '../../src/reports/email-delivery';
import {
  createLazyResendScientificReportDeliveryService,
  createScientificReportRuntimeGate,
  deliverScheduledScientificReports,
  reconcileScientificReportSchedules,
  type ScientificReportRuntimeParameters,
} from '../../src/reports/runtime-bindings';
import type { ResendEmailClient } from '../../src/reports/resend-email-provider';

const UID = 'owner-1';
const REPORT_ID = `report_${'a'.repeat(56)}`;

describe('scientific report runtime bindings', () => {
  it('exports only one secret-bound scheduled endpoint and a secret-free preference trigger', () => {
    const scheduled = endpoint(deliverScheduledScientificReports);
    const preference = endpoint(reconcileScientificReportSchedules);

    expect(scheduled).toMatchObject({
      region: ['europe-west1'],
      ingressSettings: 'ALLOW_INTERNAL_ONLY',
      minInstances: 0,
      maxInstances: 1,
      concurrency: 1,
      secretEnvironmentVariables: [{ key: 'RESEND_API_KEY' }],
      scheduleTrigger: { schedule: '*/5 * * * *', timeZone: 'Etc/UTC' },
    });
    expect(preference).toMatchObject({
      region: ['europe-west1'],
      ingressSettings: 'ALLOW_INTERNAL_ONLY',
      minInstances: 0,
      maxInstances: 1,
      concurrency: 1,
    });
    expect(JSON.stringify(preference)).not.toMatch(/secretEnvironment|OPENAI|TWILIO|RESEND/i);
    expect(JSON.stringify(scheduled)).not.toMatch(/OPENAI|TWILIO/i);
  });

  it('reads only the kill switch in the exact default-off state', () => {
    const parameters = fakeParameters({ enabled: 'false' });
    const gate = createScientificReportRuntimeGate(parameters.values);

    expect(gate.allowedOwnerUid()).toBeNull();
    expect(parameters.reads.enabled).toBe(1);
    expect(totalReads(parameters.reads)).toBe(1);
  });

  it('rejects the unresolved owner sentinel before any sender or secret read', () => {
    const parameters = fakeParameters({ ownerUid: 'not-configured' });
    const gate = createScientificReportRuntimeGate(parameters.values);

    expect(() => gate.allowedOwnerUid()).toThrow('owner UID');
    expect(parameters.reads.enabled).toBe(1);
    expect(parameters.reads.ownerUid).toBe(1);
    expect(parameters.reads.fromEmail).toBe(0);
    expect(parameters.reads.resendApiKey).toBe(0);
  });

  it('rejects a forged owner before reading sender configuration or secret', async () => {
    const parameters = fakeParameters();
    const repository = new FakeEmailRepository();
    const factory = vi.fn<() => ResendEmailClient>();
    const delivery = createLazyResendScientificReportDeliveryService(
      repository,
      parameters.values,
      factory,
    );

    await expect(delivery.deliver({
      uid: 'other-owner',
      reportId: REPORT_ID,
      to: { email: 'recipient@example.test', name: null },
      now: '2026-08-25T21:00:00.000Z',
    })).rejects.toThrow('owner');
    expect(parameters.reads.enabled).toBe(1);
    expect(parameters.reads.ownerUid).toBe(1);
    expect(parameters.reads.fromEmail).toBe(0);
    expect(parameters.reads.resendApiKey).toBe(0);
    expect(factory).not.toHaveBeenCalled();
    expect(repository.getCalls).toBe(0);
  });

  it('validates non-secret sender authority before reading the Resend secret', async () => {
    const parameters = fakeParameters({ fromEmail: 'not-configured' });
    const repository = new FakeEmailRepository();
    const factory = vi.fn<() => ResendEmailClient>();
    const delivery = createLazyResendScientificReportDeliveryService(
      repository,
      parameters.values,
      factory,
    );

    await expect(delivery.deliver(deliveryInput())).rejects.toThrow('sender');
    expect(parameters.reads.resendApiKey).toBe(0);
    expect(factory).not.toHaveBeenCalled();
    expect(repository.getCalls).toBe(0);
  });

  it('constructs one client lazily for the fixed owner and never invokes it without an archive', async () => {
    const parameters = fakeParameters();
    const repository = new FakeEmailRepository();
    const send = vi.fn();
    const factory = vi.fn((): ResendEmailClient => ({ emails: { send } }));
    const delivery = createLazyResendScientificReportDeliveryService(
      repository,
      parameters.values,
      factory,
    );

    await expect(delivery.deliver(deliveryInput())).resolves.toEqual({
      outcome: 'no_op', reason: 'report_missing',
    });
    await expect(delivery.deliver(deliveryInput())).resolves.toEqual({
      outcome: 'no_op', reason: 'report_missing',
    });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(repository.getCalls).toBe(2);
    expect(send).not.toHaveBeenCalled();
    expect(parameters.reads.enabled).toBe(2);
    expect(parameters.reads.ownerUid).toBe(2);
    expect(parameters.reads.fromEmail).toBe(1);
    expect(parameters.reads.fromName).toBe(1);
    expect(parameters.reads.resendApiKey).toBe(1);
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

function fakeParameters(
  overrides: Partial<Record<keyof ScientificReportRuntimeParameters, string>> = {},
) {
  const raw = {
    enabled: 'true',
    ownerUid: UID,
    fromEmail: 'reports@example.test',
    fromName: 'Life Tracker Reports',
    resendApiKey: 'not-a-real-resend-test-key-value',
    ...overrides,
  };
  const readers = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, new RuntimeReader(value)]),
  ) as Record<keyof ScientificReportRuntimeParameters, RuntimeReader>;
  const reads = {} as Record<keyof ScientificReportRuntimeParameters, number>;
  Object.defineProperties(reads, Object.fromEntries(
    Object.entries(readers).map(([key, reader]) => [key, {
      enumerable: true,
      get: () => reader.reads,
    }]),
  ));
  return {
    values: readers as ScientificReportRuntimeParameters,
    reads,
  };
}

function totalReads(reads: Record<keyof ScientificReportRuntimeParameters, number>): number {
  return Object.values(reads).reduce((total, value) => total + value, 0);
}

class FakeEmailRepository implements ScientificReportEmailDeliveryRepository {
  getCalls = 0;

  async getArchive() {
    this.getCalls += 1;
    return null;
  }

  async prepareEmailDelivery(_input: PrepareReportEmailDeliveryInput): Promise<never> {
    throw new Error('Unexpected email preparation.');
  }

  async finalizeEmailDelivery(_input: FinalizeReportEmailDeliveryInput): Promise<never> {
    throw new Error('Unexpected email finalization.');
  }
}

function deliveryInput() {
  return {
    uid: UID,
    reportId: REPORT_ID,
    to: { email: 'recipient@example.test', name: null },
    now: '2026-08-25T21:00:00.000Z',
  };
}

function endpoint(value: unknown): Record<string, unknown> {
  return (value as { __endpoint: Record<string, unknown> }).__endpoint;
}
