import twilio from 'twilio';
import { describe, expect, it } from 'vitest';
import type {
  MessagingReminderRequest,
  MessagingSendResult,
} from '../../src/notifications/delivery';
import {
  createTwilioSdkMessageCreator,
  createTwilioSignatureValidator,
  formatTwilioReminderMessage,
  TWILIO_REMINDER_VALIDITY_PERIOD_SECONDS,
  TWILIO_REQUEST_TIMEOUT_MS,
  TwilioWhatsAppProvider,
  twilioStatusCallbackUrl,
  type TwilioMessageCreateOptions,
  type TwilioMessageCreateResult,
  type TwilioMessageCreator,
  type TwilioSdkFactory,
  type TwilioWhatsAppProviderConfig,
} from '../../src/notifications/twilio-provider';

const UID = 'owner-1';
const JOB_ID = 'a'.repeat(64);
const ATTEMPT_ID = 'b'.repeat(64);
const IDEMPOTENCY_KEY = 'c'.repeat(64);
const MESSAGE_SID = `SM${'d'.repeat(32)}`;
const ACCOUNT_SID = `AC${'e'.repeat(32)}`;
const CONTENT_SID = `HX${'f'.repeat(32)}`;
const CALLBACK_BASE_URL =
  'https://europe-west1-example.cloudfunctions.net/twilioWhatsAppStatusCallback';

describe('TwilioWhatsAppProvider', () => {
  it('sends one deterministic session message to a server-bound WhatsApp destination', async () => {
    const client = new FakeTwilioMessageCreator({
      sid: MESSAGE_SID,
      status: 'queued',
      errorCode: null,
    });
    const provider = new TwilioWhatsAppProvider(client, config({
      content: { kind: 'session_text' },
    }));

    await expect(provider.sendReminder(request())).resolves.toEqual({
      outcome: 'accepted',
      providerMessageId: MESSAGE_SID,
    });
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]).toMatchObject({
      to: 'whatsapp:+393331112222',
      from: 'whatsapp:+14155238886',
      statusCallback: `${CALLBACK_BASE_URL}?attemptId=${ATTEMPT_ID}&jobId=${JOB_ID}`,
      validityPeriod: TWILIO_REMINDER_VALIDITY_PERIOD_SECONDS,
      body: expect.stringContaining('Deep work'),
    });
    expect(client.requests[0]).not.toHaveProperty('contentSid');
    expect(client.requests[0]).not.toHaveProperty('contentVariables');
    expect(JSON.stringify(client.requests)).not.toContain(UID);
    expect(JSON.stringify(client.requests)).not.toContain(IDEMPOTENCY_KEY);
    expect(JSON.stringify(client.requests)).not.toContain('hostile Note');
  });

  it('uses ContentSid and exactly three deterministic variables without Body', async () => {
    const client = new FakeTwilioMessageCreator({ sid: MESSAGE_SID, status: 'accepted' });
    const provider = new TwilioWhatsAppProvider(client, config({
      content: { kind: 'content_template', contentSid: CONTENT_SID },
    }));

    await provider.sendReminder(request({
      message: {
        ...message(),
        title: '  Deep\nwork\u0000  ',
      },
    }));

    const sent = client.requests[0]!;
    expect(sent).not.toHaveProperty('body');
    expect(sent.contentSid).toBe(CONTENT_SID);
    expect(JSON.parse(sent.contentVariables ?? '')).toEqual({
      1: 'Deep work',
      2: expect.stringContaining('12:00'),
      3: '60 min',
    });
  });

  it('rejects forged ownership or malformed identity before the provider call', async () => {
    const client = new FakeTwilioMessageCreator({ sid: MESSAGE_SID, status: 'queued' });
    const provider = new TwilioWhatsAppProvider(client, config());

    await expect(provider.sendReminder(request({ uid: 'other-owner' }))).resolves.toEqual({
      outcome: 'rejected',
      reason: 'provider_rejected',
    });
    await expect(provider.sendReminder(request({ jobId: '../other' }))).resolves.toEqual({
      outcome: 'rejected',
      reason: 'provider_rejected',
    });
    expect(client.requests).toEqual([]);
  });

  it.each([
    [{ status: 400, code: 21211 }, { outcome: 'rejected', reason: 'invalid_recipient' }],
    [{ status: 400, code: 63015 }, { outcome: 'rejected', reason: 'invalid_recipient' }],
    [{ status: 400, code: 63016 }, { outcome: 'rejected', reason: 'template_unavailable' }],
    [{ status: 400, code: 63042 }, { outcome: 'rejected', reason: 'template_unavailable' }],
    [{ status: 429, code: 20429 }, { outcome: 'rejected', reason: 'provider_unavailable' }],
    [{ status: 401, code: 20_003 }, { outcome: 'rejected', reason: 'provider_rejected' }],
    [{ status: 500, code: 20_500 }, { outcome: 'uncertain', reason: 'transport_unknown' }],
    [{ code: 'ETIMEDOUT' }, { outcome: 'uncertain', reason: 'provider_timeout' }],
    [new Error('private provider transport detail'), {
      outcome: 'uncertain', reason: 'transport_unknown',
    }],
  ] as const)('maps a bounded provider failure without leaking raw details', async (failure, result) => {
    const client = new FakeTwilioMessageCreator(failure);
    const provider = new TwilioWhatsAppProvider(client, config());

    await expect(provider.sendReminder(request())).resolves.toEqual(result);
    expect(JSON.stringify(result)).not.toContain('private provider transport detail');
  });

  it.each([
    [{ sid: MESSAGE_SID, status: 'failed', errorCode: 63016 }, {
      outcome: 'rejected', reason: 'template_unavailable',
    }],
    [{ sid: MESSAGE_SID, status: 'undelivered', errorCode: 63003 }, {
      outcome: 'rejected', reason: 'invalid_recipient',
    }],
    [{ sid: MESSAGE_SID, status: 'mystery' }, {
      outcome: 'uncertain', reason: 'transport_unknown',
    }],
    [{ sid: 'invalid', status: 'queued' }, {
      outcome: 'uncertain', reason: 'transport_unknown',
    }],
  ] as const)('normalizes a synchronous Twilio result %s', async (response, expected) => {
    const client = new FakeTwilioMessageCreator(response);
    const provider = new TwilioWhatsAppProvider(client, config());

    await expect(provider.sendReminder(request())).resolves.toEqual(expected);
  });

  it('pins one non-retrying SDK call with a ten-second timeout', () => {
    let captured: unknown[] | null = null;
    const messages = new FakeTwilioMessageCreator({ sid: MESSAGE_SID, status: 'queued' });
    const factory: TwilioSdkFactory = (accountSid, authToken, options) => {
      captured = [accountSid, authToken, structuredClone(options)];
      return { messages };
    };

    expect(createTwilioSdkMessageCreator(
      ACCOUNT_SID,
      'test-auth-token-value-1234',
      factory,
    )).toBe(messages);
    expect(captured).toEqual([
      ACCOUNT_SID,
      'test-auth-token-value-1234',
      {
        autoRetry: false,
        maxRetries: 0,
        timeout: TWILIO_REQUEST_TIMEOUT_MS,
        lazyLoading: true,
      },
    ]);
  });

  it('validates the exact HTTPS callback URL and every evolving form parameter', () => {
    const authToken = 'test-auth-token-value-1234';
    const exactUrl = twilioStatusCallbackUrl(CALLBACK_BASE_URL, ATTEMPT_ID, JOB_ID);
    const parameters = {
      AccountSid: ACCOUNT_SID,
      MessageSid: MESSAGE_SID,
      MessageStatus: 'delivered',
      FutureTwilioField: 'must remain in signature input',
    };
    const signature = twilio.getExpectedTwilioSignature(authToken, exactUrl, parameters);
    const validator = createTwilioSignatureValidator(authToken);

    expect(validator.validate(signature, exactUrl, parameters)).toBe(true);
    expect(validator.validate(signature, exactUrl, {
      ...parameters,
      MessageStatus: 'read',
    })).toBe(false);
    expect(validator.validate(signature, exactUrl, {
      AccountSid: ACCOUNT_SID,
      MessageSid: MESSAGE_SID,
      MessageStatus: 'delivered',
    })).toBe(false);
    expect(validator.validate(signature, exactUrl.replace('https:', 'http:'), parameters))
      .toBe(false);
  });

  it('rejects unsafe provider configuration before retaining a client', () => {
    const client = new FakeTwilioMessageCreator({ sid: MESSAGE_SID, status: 'queued' });
    const invalid = [
      config({ allowedUid: '../other' }),
      config({ fromE164: '14155238886' }),
      config({ toE164: '+14155238886' }),
      config({ statusCallbackBaseUrl: 'http://example.test/callback' }),
      config({ statusCallbackBaseUrl: `${CALLBACK_BASE_URL}?token=value` }),
      config({ content: { kind: 'content_template', contentSid: 'bad' } }),
    ];

    for (const value of invalid) {
      expect(() => new TwilioWhatsAppProvider(client, value)).toThrow();
    }
  });

  it('formats only bounded display fields and validates time semantics', () => {
    expect(formatTwilioReminderMessage({
      ...message(),
      title: ' Focus\nblock\u0000 ',
    })).toMatchObject({
      title: 'Focus block',
      startsAt: expect.stringContaining('12:00'),
      duration: '60 min',
      body: expect.stringContaining('Focus block'),
    });
    expect(() => formatTwilioReminderMessage({
      ...message(),
      timezone: 'Not/AZone',
    })).toThrow('timezone');
    expect(() => formatTwilioReminderMessage({
      ...message(),
      plannedMinutes: 0,
    })).toThrow('duration');
  });
});

class FakeTwilioMessageCreator implements TwilioMessageCreator {
  readonly requests: TwilioMessageCreateOptions[] = [];

  constructor(private readonly result: TwilioMessageCreateResult | unknown) {}

  async create(options: TwilioMessageCreateOptions): Promise<TwilioMessageCreateResult> {
    this.requests.push(structuredClone(options));
    if (!isCreateResult(this.result)) throw this.result;
    return structuredClone(this.result);
  }
}

function isCreateResult(value: unknown): value is TwilioMessageCreateResult {
  return Boolean(value && typeof value === 'object' && 'sid' in value && 'status' in value);
}

function config(
  overrides: Partial<TwilioWhatsAppProviderConfig> = {},
): TwilioWhatsAppProviderConfig {
  return {
    allowedUid: UID,
    fromE164: '+14155238886',
    toE164: '+393331112222',
    statusCallbackBaseUrl: CALLBACK_BASE_URL,
    content: { kind: 'session_text' },
    ...overrides,
  };
}

function request(
  overrides: Partial<MessagingReminderRequest> = {},
): MessagingReminderRequest {
  return {
    uid: UID,
    jobId: JOB_ID,
    attemptId: ATTEMPT_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    message: message(),
    ...overrides,
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

function assertMessagingResult(_value: MessagingSendResult): void {
  // Compile-time assertion used to keep table literals aligned with the provider contract.
}

void assertMessagingResult;
