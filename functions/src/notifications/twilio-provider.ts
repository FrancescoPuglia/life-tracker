import twilio from 'twilio';
import type {
  MessagingProvider,
  MessagingRejectionReason,
  MessagingReminderRequest,
  MessagingSendResult,
  ReminderDeliveryMessageData,
} from './delivery';

export const TWILIO_SDK_VERSION = '6.1.0' as const;
export const TWILIO_REQUEST_TIMEOUT_MS = 10_000;
export const TWILIO_REMINDER_VALIDITY_PERIOD_SECONDS = 10 * 60;

export type TwilioWhatsAppContentMode =
  | Readonly<{ kind: 'session_text' }>
  | Readonly<{ kind: 'content_template'; contentSid: string }>;

export interface TwilioWhatsAppProviderConfig {
  /** One server-owned Life Tracker owner. Client/model input cannot redirect delivery. */
  readonly allowedUid: string;
  readonly fromE164: string;
  readonly toE164: string;
  readonly statusCallbackBaseUrl: string;
  readonly content: TwilioWhatsAppContentMode;
}

export interface TwilioMessageCreateOptions {
  readonly to: string;
  readonly from: string;
  readonly statusCallback: string;
  readonly validityPeriod: number;
  readonly body?: string;
  readonly contentSid?: string;
  readonly contentVariables?: string;
}

export interface TwilioMessageCreateResult {
  readonly sid: string;
  readonly status: string;
  readonly errorCode?: number | null;
}

export interface TwilioMessageCreator {
  create(options: TwilioMessageCreateOptions): Promise<TwilioMessageCreateResult>;
}

export interface TwilioSignatureValidator {
  validate(
    signature: string,
    exactUrl: string,
    parameters: Readonly<Record<string, string | readonly string[]>>,
  ): boolean;
}

interface TwilioSdkClientOptions {
  readonly autoRetry: false;
  readonly maxRetries: 0;
  readonly timeout: number;
  readonly lazyLoading: true;
}

interface TwilioSdkClient {
  readonly messages: TwilioMessageCreator;
}

export type TwilioSdkFactory = (
  accountSid: string,
  authToken: string,
  options: TwilioSdkClientOptions,
) => TwilioSdkClient;

/**
 * Provider-specific transport. It receives only a server-created client and
 * fixed owner/sender/recipient configuration; no credential or destination is
 * accepted through ReminderJob, Firestore user content, or a task payload.
 */
export class TwilioWhatsAppProvider implements MessagingProvider {
  private readonly config: NormalizedTwilioWhatsAppProviderConfig;

  constructor(
    private readonly client: TwilioMessageCreator,
    config: TwilioWhatsAppProviderConfig,
  ) {
    this.config = normalizeConfig(config);
  }

  async sendReminder(request: MessagingReminderRequest): Promise<MessagingSendResult> {
    let normalizedRequest: MessagingReminderRequest;
    try {
      normalizedRequest = normalizeReminderRequest(request, this.config.allowedUid);
    } catch {
      return Object.freeze({ outcome: 'rejected', reason: 'provider_rejected' });
    }
    try {
      const response = await this.client.create(messageCreateOptions(
        normalizedRequest,
        this.config,
      ));
      return normalizeCreateResult(response);
    } catch (error) {
      return providerFailure(error);
    }
  }
}

export function createTwilioSdkMessageCreator(
  accountSid: string,
  authToken: string,
  factory: TwilioSdkFactory = twilio,
): TwilioMessageCreator {
  assertAccountSid(accountSid);
  assertAuthToken(authToken);
  return factory(accountSid, authToken, Object.freeze({
    autoRetry: false,
    maxRetries: 0,
    timeout: TWILIO_REQUEST_TIMEOUT_MS,
    lazyLoading: true,
  })).messages;
}

export function createTwilioSignatureValidator(authToken: string): TwilioSignatureValidator {
  assertAuthToken(authToken);
  return Object.freeze({
    validate: (
      signature: string,
      exactUrl: string,
      parameters: Readonly<Record<string, string | readonly string[]>>,
    ) => {
      if (
        typeof signature !== 'string'
        || signature.length < 1
        || signature.length > 512
        || !validCanonicalHttpsUrl(exactUrl, true)
        || !validSignatureParameters(parameters)
      ) {
        return false;
      }
      try {
        return twilio.validateRequest(
          authToken,
          signature,
          exactUrl,
          parameters as Record<string, string | readonly string[]>,
        );
      } catch {
        return false;
      }
    },
  });
}

export function twilioStatusCallbackUrl(
  baseUrl: string,
  attemptId: string,
  jobId: string,
): string {
  if (!validCanonicalHttpsUrl(baseUrl, false)) {
    throw new Error('Twilio status callback base URL is invalid.');
  }
  assertHash(attemptId, 'Twilio callback attempt ID');
  assertHash(jobId, 'Twilio callback job ID');
  const url = new URL(baseUrl);
  url.searchParams.set('attemptId', attemptId);
  url.searchParams.set('jobId', jobId);
  return url.toString();
}

export function formatTwilioReminderMessage(
  message: ReminderDeliveryMessageData,
): Readonly<{ title: string; startsAt: string; duration: string; body: string }> {
  const value = normalizeMessage(message);
  const startsAt = new Intl.DateTimeFormat(value.locale, {
    timeZone: value.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value.startTime));
  const duration = `${value.plannedMinutes} min`;
  const body = [
    `Life Tracker reminder: ${value.title} begins at ${startsAt}.`,
    `Planned duration: ${duration}.`,
  ].join(' ');
  if ([...body].length > 600) throw new Error('Twilio reminder body is too long.');
  return Object.freeze({ title: value.title, startsAt, duration, body });
}

interface NormalizedTwilioWhatsAppProviderConfig {
  readonly allowedUid: string;
  readonly from: string;
  readonly to: string;
  readonly statusCallbackBaseUrl: string;
  readonly content: TwilioWhatsAppContentMode;
}

function normalizeConfig(
  config: TwilioWhatsAppProviderConfig,
): NormalizedTwilioWhatsAppProviderConfig {
  assertUid(config.allowedUid);
  const fromE164 = normalizeE164(config.fromE164, 'Twilio WhatsApp sender');
  const toE164 = normalizeE164(config.toE164, 'Twilio WhatsApp recipient');
  if (fromE164 === toE164) throw new Error('Twilio sender and recipient must differ.');
  if (!validCanonicalHttpsUrl(config.statusCallbackBaseUrl, false)) {
    throw new Error('Twilio status callback base URL is invalid.');
  }
  let content: TwilioWhatsAppContentMode;
  if (config.content.kind === 'session_text') {
    content = Object.freeze({ kind: 'session_text' });
  } else if (config.content.kind === 'content_template') {
    if (!/^HX[0-9a-fA-F]{32}$/.test(config.content.contentSid)) {
      throw new Error('Twilio Content SID is invalid.');
    }
    content = Object.freeze({
      kind: 'content_template',
      contentSid: config.content.contentSid,
    });
  } else {
    throw new Error('Twilio WhatsApp content mode is invalid.');
  }
  return Object.freeze({
    allowedUid: config.allowedUid,
    from: `whatsapp:${fromE164}`,
    to: `whatsapp:${toE164}`,
    statusCallbackBaseUrl: config.statusCallbackBaseUrl,
    content,
  });
}

function normalizeReminderRequest(
  request: MessagingReminderRequest,
  allowedUid: string,
): MessagingReminderRequest {
  if (request.uid !== allowedUid) throw new Error('Twilio reminder owner is not configured.');
  assertUid(request.uid);
  assertHash(request.jobId, 'Twilio reminder job ID');
  assertHash(request.attemptId, 'Twilio reminder attempt ID');
  assertHash(request.idempotencyKey, 'Twilio reminder idempotency key');
  return Object.freeze({
    uid: request.uid,
    jobId: request.jobId,
    attemptId: request.attemptId,
    idempotencyKey: request.idempotencyKey,
    message: normalizeMessage(request.message),
  });
}

function messageCreateOptions(
  request: MessagingReminderRequest,
  config: NormalizedTwilioWhatsAppProviderConfig,
): TwilioMessageCreateOptions {
  const formatted = formatTwilioReminderMessage(request.message);
  const common = {
    to: config.to,
    from: config.from,
    statusCallback: twilioStatusCallbackUrl(
      config.statusCallbackBaseUrl,
      request.attemptId,
      request.jobId,
    ),
    validityPeriod: TWILIO_REMINDER_VALIDITY_PERIOD_SECONDS,
  } as const;
  if (config.content.kind === 'session_text') {
    return Object.freeze({ ...common, body: formatted.body });
  }
  return Object.freeze({
    ...common,
    contentSid: config.content.contentSid,
    contentVariables: JSON.stringify({
      1: formatted.title,
      2: formatted.startsAt,
      3: formatted.duration,
    }),
  });
}

function normalizeCreateResult(response: TwilioMessageCreateResult): MessagingSendResult {
  if (!response || typeof response !== 'object') {
    return Object.freeze({ outcome: 'uncertain', reason: 'transport_unknown' });
  }
  if (!/^SM[0-9a-fA-F]{32}$/.test(response.sid)) {
    return Object.freeze({ outcome: 'uncertain', reason: 'transport_unknown' });
  }
  if (
    response.status === 'accepted'
    || response.status === 'queued'
    || response.status === 'sending'
    || response.status === 'sent'
    || response.status === 'delivered'
    || response.status === 'read'
  ) {
    return Object.freeze({ outcome: 'accepted', providerMessageId: response.sid });
  }
  if (
    response.status === 'failed'
    || response.status === 'undelivered'
    || response.status === 'canceled'
  ) {
    return Object.freeze({
      outcome: 'rejected',
      reason: rejectionReason(response.errorCode),
    });
  }
  return Object.freeze({ outcome: 'uncertain', reason: 'transport_unknown' });
}

function providerFailure(error: unknown): MessagingSendResult {
  const record = plainRecord(error);
  const status = integer(record?.status);
  const code = integer(record?.code);
  const transportCode = typeof record?.code === 'string' ? record.code : null;
  if (transportCode && ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNABORTED'].includes(transportCode)) {
    return Object.freeze({ outcome: 'uncertain', reason: 'provider_timeout' });
  }
  if (status !== null && status >= 400 && status < 500) {
    return Object.freeze({
      outcome: 'rejected',
      reason: status === 429 ? 'provider_unavailable' : rejectionReason(code),
    });
  }
  return Object.freeze({ outcome: 'uncertain', reason: 'transport_unknown' });
}

function rejectionReason(code: number | null | undefined): MessagingRejectionReason {
  if (code === 21211 || code === 63003 || code === 63015) return 'invalid_recipient';
  if (
    code === 63016
    || code === 63040
    || code === 63041
    || code === 63042
    || code === 63049
  ) {
    return 'template_unavailable';
  }
  return 'provider_rejected';
}

function normalizeMessage(message: ReminderDeliveryMessageData): ReminderDeliveryMessageData {
  const title = normalizedTitle(message.title);
  const startTime = canonicalInstant(message.startTime, 'Twilio reminder start time');
  if (
    !Number.isInteger(message.plannedMinutes)
    || message.plannedMinutes < 1
    || message.plannedMinutes > 24 * 60
  ) {
    throw new Error('Twilio reminder duration is invalid.');
  }
  if (!validTimezone(message.timezone)) throw new Error('Twilio reminder timezone is invalid.');
  if (!validLocale(message.locale)) throw new Error('Twilio reminder locale is invalid.');
  return Object.freeze({
    title,
    startTime,
    plannedMinutes: message.plannedMinutes,
    timezone: message.timezone,
    locale: message.locale,
  });
}

function normalizedTitle(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Twilio reminder title is invalid.');
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const title = [...normalized].slice(0, 160).join('');
  if (!title) throw new Error('Twilio reminder title is invalid.');
  return title;
}

function validCanonicalHttpsUrl(value: unknown, allowQuery: boolean): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.port === ''
      && !url.hostname.includes('_')
      && url.hash === ''
      && (allowQuery || url.search === '')
      && url.toString() === value;
  } catch {
    return false;
  }
}

function validSignatureParameters(
  value: Readonly<Record<string, string | readonly string[]>>,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length > 128) return false;
  return keys.every((key) => {
    if (key.length < 1 || key.length > 128) return false;
    const parameter = value[key];
    if (typeof parameter === 'string') return parameter.length <= 8_192;
    return Array.isArray(parameter)
      && parameter.length <= 32
      && parameter.every((item) => typeof item === 'string' && item.length <= 8_192);
  });
}

function assertAccountSid(value: string): void {
  if (!/^AC[0-9a-fA-F]{32}$/.test(value)) throw new Error('Twilio Account SID is invalid.');
}

function assertAuthToken(value: string): void {
  if (typeof value !== 'string' || value.length < 16 || value.length > 256) {
    throw new Error('Twilio auth token is invalid.');
  }
}

function assertUid(value: string): void {
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(value)) throw new Error('Twilio owner UID is invalid.');
}

function assertHash(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} is invalid.`);
}

function normalizeE164(value: string, label: string): string {
  if (!/^\+[1-9][0-9]{7,14}$/.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function canonicalInstant(value: string, label: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid.`);
  return date.toISOString();
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function validLocale(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 2 || value.length > 35) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function integer(value: unknown): number | null {
  return Number.isInteger(value) ? value as number : null;
}
