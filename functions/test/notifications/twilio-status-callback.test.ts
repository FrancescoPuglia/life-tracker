import twilio from 'twilio';
import { defineSecret } from 'firebase-functions/params';
import { describe, expect, it } from 'vitest';
import type {
  ProviderDeliveryStatusRecordInput,
  ProviderDeliveryStatusRecordResult,
  ProviderDeliveryStatusRepository,
} from '../../src/notifications/delivery';
import { createTwilioSignatureValidator } from '../../src/notifications/twilio-provider';
import {
  createTwilioStatusCallbackFunction,
  createTwilioStatusCallbackHandler,
  TWILIO_STATUS_CALLBACK_MAX_BODY_BYTES,
  type TwilioStatusCallbackLogger,
} from '../../src/notifications/twilio-status-callback';

const ACCOUNT_SID = `AC${'a'.repeat(32)}`;
const MESSAGE_SID = `SM${'b'.repeat(32)}`;
const ATTEMPT_ID = 'c'.repeat(64);
const JOB_ID = 'd'.repeat(64);
const AUTH_TOKEN = 'test-auth-token-value-1234';
const NOW = new Date('2026-08-25T10:00:00.000Z');
const CALLBACK_BASE_URL =
  'https://europe-west1-example.cloudfunctions.net/twilioWhatsAppStatusCallback';
const EXACT_URL = `${CALLBACK_BASE_URL}?attemptId=${ATTEMPT_ID}&jobId=${JOB_ID}`;

describe('Twilio status callback boundary', () => {
  it('validates all form fields and records one signed WhatsApp status', async () => {
    const repository = new FakeRepository('recorded');
    const logger = new FakeLogger();
    const body = callbackBody({
      FutureTwilioField: 'included in signature validation',
      ChannelStatusMessage: 'untrusted provider detail must not persist or log',
    });
    const handler = callbackHandler(repository, logger);
    const response = new FakeResponse();

    await handler(signedRequest(body), response);

    expect(response).toMatchObject({ statusCode: 200, body: 'OK' });
    expect(repository.inputs).toEqual([{
      attemptId: ATTEMPT_ID,
      jobId: JOB_ID,
      provider: 'twilio_whatsapp',
      providerMessageId: MESSAGE_SID,
      status: 'delivered',
      providerFailureCode: null,
      observedAt: NOW.toISOString(),
    }]);
    expect(JSON.stringify({ repository, logger })).not.toContain('ChannelStatusMessage');
    expect(JSON.stringify({ repository, logger })).not.toContain('untrusted provider detail');
    expect(logger.infoEntries[0]?.metadata).toEqual({
      code: 'TWILIO_STATUS_CALLBACK_PROCESSED',
      attemptId: ATTEMPT_ID,
      status: 'delivered',
      result: 'recorded',
    });
  });

  it('maps WhatsApp EventType READ to a monotonic read status', async () => {
    const repository = new FakeRepository('recorded');
    const handler = callbackHandler(repository);
    const body = callbackBody({ MessageStatus: 'delivered', EventType: 'READ' });

    await handler(signedRequest(body), new FakeResponse());

    expect(repository.inputs[0]?.status).toBe('read');
  });

  it('accepts duplicate and out-of-order repository outcomes without provider retry', async () => {
    for (const outcome of ['duplicate', 'out_of_order', 'unknown'] as const) {
      const repository = new FakeRepository(outcome);
      const response = new FakeResponse();

      await callbackHandler(repository)(signedRequest(callbackBody()), response);

      expect(response.statusCode).toBe(200);
      expect(repository.inputs).toHaveLength(1);
    }
  });

  it('rejects missing, altered, or incompletely validated signatures before persistence', async () => {
    const repository = new FakeRepository('recorded');
    const logger = new FakeLogger();
    const handler = callbackHandler(repository, logger);
    const body = callbackBody({ FutureTwilioField: 'signed' });
    const cases = [
      signedRequest(body, { headers: { 'content-type': formContentType() } }),
      signedRequest({ ...body, MessageStatus: 'read' }, {
        headers: signedHeaders(body),
      }),
      signedRequest(body, {
        body: Object.fromEntries(
          Object.entries(body).filter(([key]) => key !== 'FutureTwilioField'),
        ),
      }),
    ];

    for (const request of cases) {
      const response = new FakeResponse();
      await handler(request, response);
      expect(response.statusCode).toBe(403);
    }
    expect(repository.inputs).toEqual([]);
    expect(logger.warnEntries).toHaveLength(cases.length);
  });

  it('rejects a correctly signed callback from a different Twilio account', async () => {
    const repository = new FakeRepository('recorded');
    const body = callbackBody({ AccountSid: `AC${'e'.repeat(32)}` });
    const response = new FakeResponse();

    await callbackHandler(repository)(signedRequest(body), response);

    expect(response.statusCode).toBe(400);
    expect(repository.inputs).toEqual([]);
  });

  it.each([
    [{ MessageStatus: 'mystery' }, 400],
    [{ MessageSid: '../forged' }, 400],
    [{ ChannelPrefix: 'sms' }, 400],
    [{ ErrorCode: 'not-a-code' }, 400],
    [{ ErrorCode: ['63016', '63015'] }, 400],
  ] as const)('rejects signed malformed callback fields %s', async (overrides, status) => {
    const repository = new FakeRepository('recorded');
    const body = callbackBody(overrides as Record<string, unknown>);
    const response = new FakeResponse();

    await callbackHandler(repository)(signedRequest(body), response);

    expect(response.statusCode).toBe(status);
    expect(repository.inputs).toEqual([]);
  });

  it('normalizes a bounded numeric Twilio ErrorCode', async () => {
    const repository = new FakeRepository('recorded');
    const body = callbackBody({ MessageStatus: 'undelivered', ErrorCode: '63016' });

    await callbackHandler(repository)(signedRequest(body), new FakeResponse());

    expect(repository.inputs[0]).toMatchObject({
      status: 'undelivered',
      providerFailureCode: '63016',
    });
  });

  it.each([
    { name: 'a non-POST request', overrides: { method: 'GET' }, status: 405 },
    {
      name: 'a non-form content type',
      overrides: { headers: { 'content-type': 'application/json' } },
      status: 415,
    },
    { name: 'a missing raw body', overrides: { rawBody: undefined }, status: 413 },
    { name: 'an empty raw body', overrides: { rawBody: new Uint8Array() }, status: 413 },
    {
      name: 'an oversized raw body',
      overrides: { rawBody: new Uint8Array(TWILIO_STATUS_CALLBACK_MAX_BODY_BYTES + 1) },
      status: 413,
    },
    {
      name: 'an extra callback query field',
      overrides: { query: { attemptId: ATTEMPT_ID, jobId: JOB_ID, extra: 'value' } },
      status: 400,
    },
    {
      name: 'an invalid callback identity',
      overrides: { query: { attemptId: '../other', jobId: JOB_ID } },
      status: 400,
    },
    { name: 'a missing parsed form', overrides: { body: null }, status: 400 },
  ] as const)('fails closed at the HTTP boundary for $name', async ({ overrides, status }) => {
    const repository = new FakeRepository('recorded');
    const response = new FakeResponse();
    const request = signedRequest(callbackBody(), overrides as Record<string, unknown>);

    await callbackHandler(repository)(request, response);

    expect(response.statusCode).toBe(status);
    expect(repository.inputs).toEqual([]);
    expect(response.headers['Cache-Control']).toBe('no-store');
  });

  it('returns a sanitized 500 so Twilio can retry a transient persistence failure', async () => {
    const repository = new FakeRepository(new Error('private Firestore path and document'));
    const logger = new FakeLogger();
    const response = new FakeResponse();

    await callbackHandler(repository, logger)(signedRequest(callbackBody()), response);

    expect(response).toMatchObject({ statusCode: 500, body: 'Internal Server Error' });
    expect(JSON.stringify(logger)).not.toContain('private Firestore');
  });

  it('declares the intentional public edge with no CORS and a bound secret', () => {
    const secret = defineSecret('TWILIO_AUTH_TOKEN');
    const fn = createTwilioStatusCallbackFunction({
      ...dependencies(new FakeRepository('recorded')),
      secrets: [secret],
    });
    const endpoint = (fn as unknown as {
      __endpoint: {
        region: string[];
        ingressSettings: string;
        timeoutSeconds: number;
        minInstances: number;
        maxInstances: number;
        concurrency: number;
        secretEnvironmentVariables: Array<{ key: string }>;
      };
    }).__endpoint;

    expect(endpoint).toMatchObject({
      region: ['europe-west1'],
      ingressSettings: 'ALLOW_ALL',
      timeoutSeconds: 15,
      minInstances: 0,
      maxInstances: 2,
      concurrency: 10,
      secretEnvironmentVariables: [{ key: 'TWILIO_AUTH_TOKEN' }],
    });
    expect(JSON.stringify(endpoint)).not.toContain(AUTH_TOKEN);
  });
});

class FakeRepository implements ProviderDeliveryStatusRepository {
  readonly inputs: ProviderDeliveryStatusRecordInput[] = [];

  constructor(private readonly result: ProviderDeliveryStatusRecordResult | Error) {}

  async recordProviderDeliveryStatus(
    input: ProviderDeliveryStatusRecordInput,
  ): Promise<ProviderDeliveryStatusRecordResult> {
    this.inputs.push(structuredClone(input));
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

class FakeLogger implements TwilioStatusCallbackLogger {
  readonly infoEntries: LogEntry[] = [];
  readonly warnEntries: LogEntry[] = [];
  readonly errorEntries: LogEntry[] = [];

  info(message: string, metadata: Readonly<Record<string, string | number | null>>): void {
    this.infoEntries.push({ message, metadata: structuredClone(metadata) });
  }

  warn(message: string, metadata: Readonly<Record<string, string | number | null>>): void {
    this.warnEntries.push({ message, metadata: structuredClone(metadata) });
  }

  error(message: string, metadata: Readonly<Record<string, string | number | null>>): void {
    this.errorEntries.push({ message, metadata: structuredClone(metadata) });
  }
}

interface LogEntry {
  readonly message: string;
  readonly metadata: Readonly<Record<string, string | number | null>>;
}

class FakeResponse {
  readonly headers: Record<string, string> = {};
  statusCode = 200;
  body = '';

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  send(body = ''): void {
    this.body = body;
  }
}

function callbackHandler(
  repository: ProviderDeliveryStatusRepository,
  logger = new FakeLogger(),
) {
  return createTwilioStatusCallbackHandler(dependencies(repository, logger));
}

function dependencies(
  repository: ProviderDeliveryStatusRepository,
  logger = new FakeLogger(),
) {
  return {
    validator: createTwilioSignatureValidator(AUTH_TOKEN),
    repository,
    expectedAccountSid: ACCOUNT_SID,
    callbackBaseUrl: CALLBACK_BASE_URL,
    now: () => NOW,
    logger,
  };
}

function callbackBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    AccountSid: ACCOUNT_SID,
    MessageSid: MESSAGE_SID,
    MessageStatus: 'delivered',
    ChannelPrefix: 'whatsapp',
    ErrorCode: '',
    ...overrides,
  };
}

function signedRequest(
  signatureBody: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  const body = (overrides.body ?? signatureBody) as Record<string, unknown>;
  return {
    method: 'POST',
    headers: signedHeaders(signatureBody),
    query: { attemptId: ATTEMPT_ID, jobId: JOB_ID },
    body,
    rawBody: Buffer.from('form-body-not-used-for-signature-validation'),
    ...overrides,
  } as never;
}

function signedHeaders(body: Record<string, unknown>) {
  return {
    'content-type': formContentType(),
    'x-twilio-signature': twilio.getExpectedTwilioSignature(
      AUTH_TOKEN,
      EXACT_URL,
      body,
    ),
  };
}

function formContentType(): string {
  return 'application/x-www-form-urlencoded; charset=utf-8';
}
