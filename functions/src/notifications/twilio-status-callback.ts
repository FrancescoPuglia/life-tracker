import * as functionsLogger from 'firebase-functions/logger';
import type { SecretParam } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import type {
  ProviderDeliveryStatusRecordInput,
  ProviderDeliveryStatusRepository,
} from './delivery';
import type { TwilioSignatureValidator } from './twilio-provider';
import { twilioStatusCallbackUrl } from './twilio-provider';

export const TWILIO_STATUS_CALLBACK_REGION = 'europe-west1' as const;
export const TWILIO_STATUS_CALLBACK_MAX_BODY_BYTES = 64 * 1_024;
export const TWILIO_PROVIDER_DELIVERY_STATUSES = [
  'accepted',
  'queued',
  'sending',
  'sent',
  'delivered',
  'read',
  'undelivered',
  'failed',
  'canceled',
] as const;

export type TwilioProviderDeliveryStatus =
  (typeof TWILIO_PROVIDER_DELIVERY_STATUSES)[number];

export interface TwilioStatusCallbackLogger {
  info(message: string, metadata: Readonly<Record<string, string | number | null>>): void;
  warn(message: string, metadata: Readonly<Record<string, string | number | null>>): void;
  error(message: string, metadata: Readonly<Record<string, string | number | null>>): void;
}

export interface TwilioStatusCallbackDependencies {
  readonly validator: TwilioSignatureValidator;
  readonly repository: ProviderDeliveryStatusRepository;
  readonly expectedAccountSid: string;
  readonly callbackBaseUrl: string;
  readonly now?: () => Date;
  readonly logger?: TwilioStatusCallbackLogger;
}

export interface TwilioStatusCallbackFunctionDependencies
  extends TwilioStatusCallbackDependencies {
  readonly secrets?: readonly SecretParam[];
}

interface HttpRequestLike {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
  readonly rawBody?: Uint8Array;
  get?(name: string): string | undefined;
}

interface HttpResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): HttpResponseLike;
  send(body?: string): void;
}

export function createTwilioStatusCallbackHandler(
  dependencies: TwilioStatusCallbackDependencies,
) {
  assertAccountSid(dependencies.expectedAccountSid);
  // This also enforces canonical HTTPS/no-query configuration without
  // exposing a separate, looser URL parser at the public edge.
  twilioStatusCallbackUrl(dependencies.callbackBaseUrl, 'a'.repeat(64), 'b'.repeat(64));
  const logger = dependencies.logger ?? functionsLogger;
  return async (request: HttpRequestLike, response: HttpResponseLike): Promise<void> => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      send(response, 405, 'Method Not Allowed');
      return;
    }
    if (!isFormEncoded(contentType(request))) {
      send(response, 415, 'Unsupported Media Type');
      return;
    }
    if (
      !request.rawBody
      || request.rawBody.byteLength < 1
      || request.rawBody.byteLength > TWILIO_STATUS_CALLBACK_MAX_BODY_BYTES
    ) {
      send(response, 413, 'Payload Too Large');
      return;
    }

    let identity: Readonly<{ attemptId: string; jobId: string }>;
    let parameters: Readonly<Record<string, string | readonly string[]>>;
    let exactUrl: string;
    try {
      identity = callbackIdentity(request.query);
      parameters = formParameters(request.body);
      exactUrl = twilioStatusCallbackUrl(
        dependencies.callbackBaseUrl,
        identity.attemptId,
        identity.jobId,
      );
    } catch {
      send(response, 400, 'Bad Request');
      return;
    }

    const signature = header(request, 'x-twilio-signature');
    if (
      !signature
      || !dependencies.validator.validate(signature, exactUrl, parameters)
    ) {
      logger.warn('Twilio status callback signature was rejected.', {
        code: 'TWILIO_STATUS_SIGNATURE_INVALID',
      });
      send(response, 403, 'Forbidden');
      return;
    }

    let callback: ProviderDeliveryStatusRecordInput;
    try {
      callback = normalizedCallback(
        identity,
        parameters,
        dependencies.expectedAccountSid,
        serverInstant(dependencies.now),
      );
    } catch {
      logger.warn('Signed Twilio status callback payload was rejected.', {
        code: 'TWILIO_STATUS_PAYLOAD_INVALID',
        attemptId: identity.attemptId,
      });
      send(response, 400, 'Bad Request');
      return;
    }

    try {
      const result = await dependencies.repository.recordProviderDeliveryStatus(callback);
      logger.info('Twilio status callback processed safely.', {
        code: 'TWILIO_STATUS_CALLBACK_PROCESSED',
        attemptId: callback.attemptId,
        status: callback.status,
        result,
      });
      send(response, 200, 'OK');
    } catch {
      logger.error('Twilio status callback persistence requires retry.', {
        code: 'TWILIO_STATUS_PERSISTENCE_FAILED',
        attemptId: callback.attemptId,
      });
      send(response, 500, 'Internal Server Error');
    }
  };
}

export function createTwilioStatusCallbackFunction(
  dependencies: TwilioStatusCallbackFunctionDependencies,
) {
  const secrets = dependencies.secrets ? [...dependencies.secrets] : [];
  const handler = createTwilioStatusCallbackHandler(dependencies);
  return onRequest({
    region: TWILIO_STATUS_CALLBACK_REGION,
    invoker: 'public',
    ingressSettings: 'ALLOW_ALL',
    timeoutSeconds: 15,
    memory: '256MiB',
    minInstances: 0,
    maxInstances: 2,
    concurrency: 10,
    cors: false,
    secrets,
  }, async (request, response) => {
    await handler(
      request as unknown as HttpRequestLike,
      response as unknown as HttpResponseLike,
    );
  });
}

function normalizedCallback(
  identity: Readonly<{ attemptId: string; jobId: string }>,
  parameters: Readonly<Record<string, string | readonly string[]>>,
  expectedAccountSid: string,
  observedAt: string,
): ProviderDeliveryStatusRecordInput {
  if (single(parameters.AccountSid, 'AccountSid') !== expectedAccountSid) {
    throw new Error('Twilio callback account is invalid.');
  }
  const providerMessageId = single(parameters.MessageSid, 'MessageSid');
  if (!/^SM[0-9a-fA-F]{32}$/.test(providerMessageId)) {
    throw new Error('Twilio callback Message SID is invalid.');
  }
  const channelPrefix = parameters.ChannelPrefix;
  if (channelPrefix !== undefined && single(channelPrefix, 'ChannelPrefix') !== 'whatsapp') {
    throw new Error('Twilio callback channel is invalid.');
  }
  const eventType = parameters.EventType === undefined
    ? null
    : single(parameters.EventType, 'EventType');
  const rawStatus = eventType === 'READ'
    ? 'read'
    : single(parameters.MessageStatus, 'MessageStatus').toLowerCase();
  if (!isProviderStatus(rawStatus)) throw new Error('Twilio callback status is invalid.');
  return Object.freeze({
    attemptId: identity.attemptId,
    jobId: identity.jobId,
    provider: 'twilio_whatsapp',
    providerMessageId,
    status: rawStatus,
    providerFailureCode: errorCode(parameters.ErrorCode),
    observedAt,
  });
}

function callbackIdentity(
  query: Readonly<Record<string, unknown>> | undefined,
): Readonly<{ attemptId: string; jobId: string }> {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw new Error('Twilio callback query is invalid.');
  }
  const keys = Object.keys(query).sort();
  if (keys.length !== 2 || keys[0] !== 'attemptId' || keys[1] !== 'jobId') {
    throw new Error('Twilio callback query is invalid.');
  }
  const attemptId = query.attemptId;
  const jobId = query.jobId;
  if (
    typeof attemptId !== 'string'
    || typeof jobId !== 'string'
    || !/^[a-f0-9]{64}$/.test(attemptId)
    || !/^[a-f0-9]{64}$/.test(jobId)
  ) {
    throw new Error('Twilio callback identity is invalid.');
  }
  return Object.freeze({ attemptId, jobId });
}

function formParameters(
  body: unknown,
): Readonly<Record<string, string | readonly string[]>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Twilio callback form is invalid.');
  }
  const prototype = Object.getPrototypeOf(body);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Twilio callback form is invalid.');
  }
  const output: Record<string, string | readonly string[]> = {};
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length < 1 || keys.length > 128) throw new Error('Twilio callback form is invalid.');
  for (const key of keys) {
    if (
      key.length < 1
      || key.length > 128
      || key === '__proto__'
      || key === 'prototype'
      || key === 'constructor'
    ) {
      throw new Error('Twilio callback form key is invalid.');
    }
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.length <= 8_192) {
      output[key] = value;
    } else if (
      Array.isArray(value)
      && value.length <= 32
      && value.every((item) => typeof item === 'string' && item.length <= 8_192)
    ) {
      output[key] = Object.freeze([...value]) as readonly string[];
    } else {
      throw new Error('Twilio callback form value is invalid.');
    }
  }
  return Object.freeze(output);
}

function single(value: string | readonly string[] | undefined, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 8_192) {
    throw new Error(`Twilio callback ${label} is invalid.`);
  }
  return value;
}

function errorCode(value: string | readonly string[] | undefined): string | null {
  if (value === undefined || value === '') return null;
  const normalized = single(value, 'ErrorCode');
  if (!/^[0-9]{1,6}$/.test(normalized)) throw new Error('Twilio callback ErrorCode is invalid.');
  const number = Number(normalized);
  if (!Number.isSafeInteger(number) || number < 0 || number > 999_999) {
    throw new Error('Twilio callback ErrorCode is invalid.');
  }
  return normalized;
}

function isProviderStatus(value: string): value is TwilioProviderDeliveryStatus {
  return (TWILIO_PROVIDER_DELIVERY_STATUSES as readonly string[]).includes(value);
}

function serverInstant(now: (() => Date) | undefined): string {
  const date = (now ?? (() => new Date()))();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error('Twilio callback server clock is invalid.');
  }
  return date.toISOString();
}

function header(request: HttpRequestLike, name: string): string | null {
  const fromGetter = request.get?.(name);
  if (typeof fromGetter === 'string' && fromGetter.length > 0) return fromGetter;
  const value = request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function contentType(request: HttpRequestLike): string | null {
  return header(request, 'content-type');
}

function isFormEncoded(value: string | null): boolean {
  return value !== null
    && /^application\/x-www-form-urlencoded(?:\s*;\s*charset=[A-Za-z0-9._-]+)?$/i.test(value);
}

function assertAccountSid(value: string): void {
  if (!/^AC[0-9a-fA-F]{32}$/.test(value)) {
    throw new Error('Twilio callback Account SID is invalid.');
  }
}

function send(response: HttpResponseLike, status: number, body: string): void {
  response.status(status).send(body);
}
