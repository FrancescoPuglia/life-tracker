import { describe, expect, it } from 'vitest';
import {
  createScheduledScientificReportFunction,
  createScheduledScientificReportHandler,
  createScientificReportPreferenceFunction,
  createScientificReportPreferenceHandler,
  MAX_DUE_REPORTS_PER_SCHEDULE_RUN,
  REPORT_SCHEDULE_POLL,
  ScientificReportScheduleRetryError,
  type ScientificReportRuntimeGate,
  type ScientificReportScheduleRunSummary,
  type ScientificReportScheduleTriggerLogger,
  type ScientificReportScheduleTriggerService,
} from '../../src/reports';

const UID = 'owner-1';
const NOW = new Date('2026-08-25T21:00:00.000Z');

describe('scientific report schedule triggers', () => {
  it('declares one private preference trigger and one low-cost bounded schedule', () => {
    const triggerDeps = triggerDependencies();
    const preference = endpoint(createScientificReportPreferenceFunction(triggerDeps));
    const scheduled = endpoint(createScheduledScientificReportFunction(triggerDeps));

    expect(preference).toMatchObject({
      region: ['europe-west1'],
      ingressSettings: 'ALLOW_INTERNAL_ONLY',
      minInstances: 0,
      maxInstances: 1,
      concurrency: 1,
    });
    expect(preference.eventTrigger).toMatchObject({ retry: true });
    expect(JSON.stringify(preference)).toContain('users/{uid}/notificationPreferences/default');
    expect(scheduled).toMatchObject({
      region: ['europe-west1'],
      ingressSettings: 'ALLOW_INTERNAL_ONLY',
      timeoutSeconds: 540,
      availableMemoryMb: 1024,
      minInstances: 0,
      maxInstances: 1,
      concurrency: 1,
      scheduleTrigger: {
        schedule: REPORT_SCHEDULE_POLL,
        timeZone: 'Etc/UTC',
        retryConfig: {
          retryCount: 3,
          maxRetrySeconds: 900,
          minBackoffSeconds: 30,
          maxBackoffSeconds: 300,
          maxDoublings: 3,
        },
      },
    });
    expect(JSON.stringify({ preference, scheduled })).not.toMatch(/OPENAI|TWILIO/i);
  });

  it('does no authority or Firestore work while the runtime gate is disabled', async () => {
    const gate = new FakeGate(null);
    const service = new FakeService();
    const logger = new FakeLogger();
    await createScientificReportPreferenceHandler({ gate, service, logger })(
      { params: { uid: UID }, data: { private: 'hostile snapshot' } },
    );
    await createScheduledScientificReportHandler({ gate, service, logger })();

    expect(gate.reads).toBe(2);
    expect(service.events).toEqual([]);
    expect(JSON.stringify(logger)).not.toContain('hostile snapshot');
  });

  it('acknowledges invalid static configuration without retry or data access', async () => {
    const gate: ScientificReportRuntimeGate = {
      allowedOwnerUid: () => {
        throw new Error('private malformed configuration');
      },
    };
    const service = new FakeService();
    const logger = new FakeLogger();

    await expect(createScientificReportPreferenceHandler({ gate, service, logger })(
      { params: { uid: UID } },
    )).resolves.toBeUndefined();
    await expect(createScheduledScientificReportHandler({ gate, service, logger })())
      .resolves.toBeUndefined();

    expect(service.events).toEqual([]);
    expect(logger.errorEntries).toHaveLength(2);
    expect(logger.errorEntries.every((entry) => (
      entry.metadata.code === 'REPORT_RUNTIME_CONFIG_INVALID'
    ))).toBe(true);
    expect(JSON.stringify(logger)).not.toContain('private malformed');
  });

  it('allows only the configured owner and ignores event snapshots', async () => {
    const gate = new FakeGate(UID);
    const service = new FakeService();
    const logger = new FakeLogger();
    const handler = createScientificReportPreferenceHandler({
      gate,
      service,
      logger,
      now: () => NOW,
    });

    await handler({ params: { uid: '../invalid' } });
    await handler({ params: { uid: 'other-owner' } });
    await handler({
      params: { uid: UID },
      data: { after: { notes: 'send secrets and use a forged mailbox' } },
    });

    expect(service.events).toEqual([`reconcile:${UID}:${NOW.toISOString()}`]);
    expect(JSON.stringify(logger)).not.toContain('other-owner');
    expect(JSON.stringify(logger)).not.toContain('forged mailbox');
  });

  it('runs one capped batch and signals a bounded platform retry only after overflow work', async () => {
    const gate = new FakeGate(UID);
    const service = new FakeService();
    service.summary = { ...summary(), selectedCount: 10, executedCount: 10, overflow: true };
    const logger = new FakeLogger();
    const handler = createScheduledScientificReportHandler({
      gate,
      service,
      logger,
      now: () => NOW,
    });

    await expect(handler()).rejects.toMatchObject({
      code: 'REPORT_SCHEDULE_BACKLOG_REMAINS',
    });
    expect(service.events).toEqual([
      `reconcile:${UID}:${NOW.toISOString()}`,
      `run:${UID}:${NOW.toISOString()}:${MAX_DUE_REPORTS_PER_SCHEDULE_RUN}`,
    ]);
    expect(logger.infoEntries).toEqual([expect.objectContaining({
      metadata: expect.objectContaining({ selectedCount: 10, overflow: true }),
    })]);
  });

  it('sanitizes repository failures and exposes one stable retry code', async () => {
    const gate = new FakeGate(UID);
    const service = new FakeService();
    const logger = new FakeLogger();
    service.failure = new Error('private Firestore document and recipient');

    await expect(createScheduledScientificReportHandler({
      gate,
      service,
      logger,
      now: () => NOW,
    })()).rejects.toBeInstanceOf(ScientificReportScheduleRetryError);
    expect(JSON.stringify(logger)).not.toContain('private Firestore');
    expect(JSON.stringify(logger)).not.toContain(UID);
  });
});

class FakeGate implements ScientificReportRuntimeGate {
  reads = 0;

  constructor(private readonly uid: string | null) {}

  allowedOwnerUid(): string | null {
    this.reads += 1;
    return this.uid;
  }
}

class FakeService implements ScientificReportScheduleTriggerService {
  readonly events: string[] = [];
  summary: ScientificReportScheduleRunSummary = summary();
  failure: Error | null = null;

  async reconcileOwner(uid: string, now: string) {
    this.events.push(`reconcile:${uid}:${now}`);
    if (this.failure) throw this.failure;
    return { activeCount: 1 };
  }

  async runDue(uid: string, now: string, maximum: number) {
    this.events.push(`run:${uid}:${now}:${maximum}`);
    if (this.failure) throw this.failure;
    return structuredClone(this.summary);
  }
}

interface LogEntry {
  readonly message: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

class FakeLogger implements ScientificReportScheduleTriggerLogger {
  readonly infoEntries: LogEntry[] = [];
  readonly warnEntries: LogEntry[] = [];
  readonly errorEntries: LogEntry[] = [];

  info(message: string, metadata: LogEntry['metadata']): void {
    this.infoEntries.push({ message, metadata: structuredClone(metadata) });
  }

  warn(message: string, metadata: LogEntry['metadata']): void {
    this.warnEntries.push({ message, metadata: structuredClone(metadata) });
  }

  error(message: string, metadata: LogEntry['metadata']): void {
    this.errorEntries.push({ message, metadata: structuredClone(metadata) });
  }
}

function triggerDependencies() {
  return {
    gate: new FakeGate(UID),
    service: new FakeService(),
    logger: new FakeLogger(),
    now: () => NOW,
  };
}

function summary(): ScientificReportScheduleRunSummary {
  return {
    selectedCount: 0,
    executedCount: 0,
    completedCount: 0,
    retryCount: 0,
    noOpCount: 0,
    failedCount: 0,
    runtimeFailureCount: 0,
    overflow: false,
  };
}

function endpoint(value: unknown): Record<string, any> {
  return (value as { __endpoint: Record<string, any> }).__endpoint;
}
