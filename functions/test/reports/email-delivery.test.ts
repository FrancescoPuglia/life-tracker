import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { UserPlanningPreferences } from '../../src/domain/types';
import {
  ScientificReportEmailDeliveryService,
  buildScientificExecutionReport,
  composeScientificReportEmail,
  createStoredScientificReportArchive,
  reportEmailSendAuthorityHash,
  type ComposedScientificReportEmail,
  type EmailProvider,
  type FinalizeReportEmailDeliveryInput,
  type FinalizeReportEmailDeliveryResult,
  type PrepareReportEmailDeliveryInput,
  type PrepareReportEmailDeliveryResult,
  type ScientificReportEmailDeliveryRepository,
  type StoredScientificReportArchive,
} from '../../src/reports';

const UID = 'email-delivery-owner';
const REPORT_TIME = '2026-08-25T20:30:00.000Z';
const PREFERENCES: UserPlanningPreferences = {
  source: 'persisted',
  defaultsApplied: [],
  timezone: 'Europe/Rome',
  workingHours: { start: '07:00', end: '22:00' },
  maxDailyPlannedMinutes: 600,
  maxWeeklyPlannedMinutes: 3_000,
  minBufferMinutes: 15,
  maxConsecutiveHighEnergyBlocks: 2,
};
const FROM = { email: 'reports@example.test', name: 'Life Tracker Reports' } as const;
const TO = { email: 'francesco@example.test', name: 'Francesco' } as const;

let storedArchive: StoredScientificReportArchive;
let composedEmail: ComposedScientificReportEmail;

beforeAll(async () => {
  const report = buildScientificExecutionReport({
    uid: UID,
    reportType: 'daily',
    localDate: '2026-08-25',
    timezone: 'Europe/Rome',
    locale: 'en-GB',
    generatedAt: REPORT_TIME,
    preferences: PREFERENCES,
    coverage: {
      goals: 'complete',
      projects: 'complete',
      tasks: 'complete',
      timeBlocks: 'complete',
      sessions: 'complete',
      habits: 'complete',
      habitLogs: 'complete',
    },
    records: {
      goals: [], projects: [], tasks: [], timeBlocks: [], sessions: [], habits: [], habitLogs: [],
    },
  });
  storedArchive = createStoredScientificReportArchive(UID, report, REPORT_TIME);
  composedEmail = await composeScientificReportEmail({ uid: UID, archive: storedArchive });
});

class FakeRepository implements ScientificReportEmailDeliveryRepository {
  readonly events: string[] = [];
  preparation: PrepareReportEmailDeliveryResult = {
    action: 'send', attemptId: `email_attempt_${'a'.repeat(48)}`, attemptNumber: 1,
  };
  finalResult: FinalizeReportEmailDeliveryResult = { state: 'sent' };
  preparedInput: PrepareReportEmailDeliveryInput | null = null;
  finalizedInput: FinalizeReportEmailDeliveryInput | null = null;

  constructor(readonly archive: StoredScientificReportArchive | null = storedArchive) {}

  async getArchive(): Promise<StoredScientificReportArchive | null> {
    this.events.push('archive');
    return this.archive;
  }

  async prepareEmailDelivery(
    input: PrepareReportEmailDeliveryInput,
  ): Promise<PrepareReportEmailDeliveryResult> {
    this.events.push('claim');
    this.preparedInput = input;
    return this.preparation;
  }

  async finalizeEmailDelivery(
    input: FinalizeReportEmailDeliveryInput,
  ): Promise<FinalizeReportEmailDeliveryResult> {
    this.events.push('finalize');
    this.finalizedInput = input;
    return this.finalResult;
  }
}

function provider(
  result: Awaited<ReturnType<EmailProvider['sendReportEmail']>> = {
    outcome: 'accepted', provider: 'resend', providerMessageId: 'provider-message-1',
  },
): EmailProvider & { calls: number } {
  return {
    id: 'resend',
    calls: 0,
    async sendReportEmail() {
      this.calls += 1;
      return result;
    },
  };
}

function service(repository: FakeRepository, emailProvider: EmailProvider) {
  return new ScientificReportEmailDeliveryService(
    repository,
    emailProvider,
    FROM,
    async () => composedEmail,
  );
}

describe('claim-before-send scientific report email service', () => {
  it('durably claims before one provider call and finalizes the exact content authority', async () => {
    const repository = new FakeRepository();
    const emailProvider = provider();
    const originalSend = emailProvider.sendReportEmail.bind(emailProvider);
    emailProvider.sendReportEmail = async (request) => {
      repository.events.push('send');
      return originalSend(request);
    };

    const result = await service(repository, emailProvider).deliver({
      uid: UID, reportId: storedArchive.id, to: TO, now: REPORT_TIME,
    });

    expect(result).toEqual({ outcome: 'accepted' });
    expect(repository.events).toEqual(['archive', 'claim', 'send', 'finalize']);
    expect(emailProvider.calls).toBe(1);
    expect(repository.preparedInput).toMatchObject({
      uid: UID,
      reportId: storedArchive.id,
      reportArtifactHash: storedArchive.artifactHash,
      metricHash: storedArchive.metricHash,
      emailContentHash: composedEmail.contentHash,
      idempotencyKey: composedEmail.idempotencyKey,
      provider: 'resend',
    });
    expect(repository.preparedInput?.sendAuthorityHash).toMatch(/^[0-9a-f]{64}$/);
    expect(repository.finalizedInput).toMatchObject({
      uid: UID,
      reportId: storedArchive.id,
      attemptId: `email_attempt_${'a'.repeat(48)}`,
      sendAuthorityHash: repository.preparedInput?.sendAuthorityHash,
      result: { outcome: 'accepted', providerMessageId: 'provider-message-1' },
    });
  });

  it('uses a one-way envelope authority that changes with the recipient', () => {
    const first = reportEmailSendAuthorityHash({ from: FROM, to: TO, email: composedEmail });
    const second = reportEmailSendAuthorityHash({
      from: FROM,
      to: { email: 'another@example.test', name: null },
      email: composedEmail,
    });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain(FROM.email);
    expect(first).not.toContain(TO.email);
  });

  it.each([
    [{ action: 'no_op', reason: 'already_sent' }, { outcome: 'no_op', reason: 'already_sent' }],
    [{ action: 'no_op', reason: 'delivery_uncertain' }, { outcome: 'no_op', reason: 'delivery_uncertain' }],
    [{ action: 'retry_later', notBefore: '2026-08-25T20:35:00.000Z' },
      { outcome: 'retry_later', notBefore: '2026-08-25T20:35:00.000Z' }],
  ] as const)('does not call the provider when preparation returns %o', async (preparation, expected) => {
    const repository = new FakeRepository();
    repository.preparation = preparation;
    const emailProvider = provider();
    await expect(service(repository, emailProvider).deliver({
      uid: UID, reportId: storedArchive.id, to: TO, now: REPORT_TIME,
    })).resolves.toEqual(expected);
    expect(emailProvider.calls).toBe(0);
    expect(repository.finalizedInput).toBeNull();
  });

  it('persists retryable provider state and returns the repository-controlled backoff', async () => {
    const repository = new FakeRepository();
    repository.finalResult = { state: 'retryable', notBefore: '2026-08-25T20:35:00.000Z' };
    const emailProvider = provider({
      outcome: 'retry_later', provider: 'resend', reason: 'rate_limited',
    });
    const result = await service(repository, emailProvider).deliver({
      uid: UID, reportId: storedArchive.id, to: TO, now: REPORT_TIME,
    });
    expect(result).toEqual({
      outcome: 'retry_later', notBefore: '2026-08-25T20:35:00.000Z',
    });
    expect(repository.finalizedInput?.result).toEqual({
      outcome: 'retryable', reason: 'rate_limited',
    });
  });

  it('turns thrown or mismatched provider results into a terminal uncertain claim', async () => {
    const repository = new FakeRepository();
    repository.finalResult = { state: 'uncertain' };
    const sendReportEmail = vi.fn(async () => {
      throw new Error('private transport detail');
    });
    const result = await service(repository, { id: 'resend', sendReportEmail }).deliver({
      uid: UID, reportId: storedArchive.id, to: TO, now: REPORT_TIME,
    });
    expect(result).toEqual({ outcome: 'uncertain', reason: 'transport_unknown' });
    expect(repository.finalizedInput?.result).toEqual({
      outcome: 'uncertain', reason: 'transport_unknown',
    });
    expect(JSON.stringify(result)).not.toContain('private transport');
  });

  it('fails before a claim/provider call for an invalid recipient', async () => {
    const repository = new FakeRepository();
    const emailProvider = provider();
    await expect(service(repository, emailProvider).deliver({
      uid: UID,
      reportId: storedArchive.id,
      to: { email: 'invalid', name: null },
      now: REPORT_TIME,
    })).rejects.toThrow('Recipient email address is invalid');
    expect(repository.preparedInput).toBeNull();
    expect(emailProvider.calls).toBe(0);
  });

  it('does not compose, claim, or send when the owner-scoped archive is absent', async () => {
    const repository = new FakeRepository(null);
    const emailProvider = provider();
    const composer = vi.fn(async () => composedEmail);
    const delivery = new ScientificReportEmailDeliveryService(
      repository, emailProvider, FROM, composer,
    );
    await expect(delivery.deliver({
      uid: UID, reportId: storedArchive.id, to: TO, now: REPORT_TIME,
    })).resolves.toEqual({ outcome: 'no_op', reason: 'report_missing' });
    expect(composer).not.toHaveBeenCalled();
    expect(repository.preparedInput).toBeNull();
    expect(emailProvider.calls).toBe(0);
  });
});
