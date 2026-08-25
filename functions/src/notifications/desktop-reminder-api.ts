import { HttpsError, onCall, type CallableRequest, type CallableFunction } from 'firebase-functions/v2/https';
import {
  DESKTOP_REMINDER_API_SCHEMA_VERSION,
  type DesktopReminderApiResponse,
  type DesktopReminderCandidate,
  type DesktopReminderDispatch,
  parseDesktopReminderApiRequest,
} from '../../../packages/notification-contract';
import {
  DesktopReminderRateLimitError,
  type DesktopReminderRateLimiter,
} from './desktop-reminder-rate-limiter';

export const DESKTOP_REMINDER_CALLABLE_OPTIONS = Object.freeze({
  region: 'europe-west1',
  ingressSettings: 'ALLOW_ALL' as const,
  invoker: 'public' as const,
  timeoutSeconds: 15,
  memory: '256MiB' as const,
  minInstances: 0,
  maxInstances: 2,
  concurrency: 20,
  enforceAppCheck: false,
  cors: Object.freeze([
    'https://tauri.localhost',
    'http://127.0.0.1:3000',
    'http://localhost:3000',
  ]),
});

export const DESKTOP_REMINDER_FEED_LOOKBACK_MS = 10 * 60_000;
export const DESKTOP_REMINDER_FEED_HORIZON_MS = 24 * 60 * 60_000;
export const DESKTOP_REMINDER_FEED_MAXIMUM = 64;
export const DESKTOP_REMINDER_REFRESH_AFTER_MS = 60_000;

export interface DesktopReminderCandidateBatch {
  readonly jobs: readonly DesktopReminderCandidate[];
  readonly overflow: boolean;
}

export type DesktopReminderClaimPreparation =
  | Readonly<{ action: 'dispatch'; dispatch: DesktopReminderDispatch }>
  | Readonly<{ action: 'retry_later'; notBefore: string }>
  | Readonly<{ action: 'no_op' }>;

export interface DesktopReminderRepository {
  listDesktopReminderCandidates(input: {
    readonly uid: string;
    readonly now: string;
    readonly lookbackMs: number;
    readonly horizonMs: number;
    readonly maximum: number;
  }): Promise<DesktopReminderCandidateBatch>;

  claimDesktopReminder(input: {
    readonly uid: string;
    readonly jobId: string;
    readonly now: string;
  }): Promise<DesktopReminderClaimPreparation>;
}

export interface DesktopReminderApiLogger {
  warn(message: string, metadata: Readonly<Record<string, string | number>>): void;
  error(message: string, metadata: Readonly<Record<string, string | number>>): void;
}

export interface DesktopReminderApiDependencies {
  readonly repository: DesktopReminderRepository;
  readonly rateLimiter: DesktopReminderRateLimiter;
  readonly now?: () => Date;
  readonly logger?: DesktopReminderApiLogger;
}

export interface DesktopReminderCallableRequest {
  readonly data: unknown;
  readonly auth?: Readonly<{ uid: string }>;
}

export function createDesktopReminderCallableHandler(
  dependencies: DesktopReminderApiDependencies,
): (request: DesktopReminderCallableRequest) => Promise<DesktopReminderApiResponse> {
  const clock = dependencies.now ?? (() => new Date());
  const apiLogger = dependencies.logger ?? NOOP_LOGGER;

  return async (request): Promise<DesktopReminderApiResponse> => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required.');

    let parsed: ReturnType<typeof parseDesktopReminderApiRequest>;
    try {
      parsed = parseDesktopReminderApiRequest(request.data);
    } catch {
      throw new HttpsError('invalid-argument', 'Desktop reminder request is invalid.');
    }

    const now = clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      apiLogger.error('Desktop reminder API clock failed safely.', Object.freeze({
        code: 'DESKTOP_REMINDER_CLOCK_INVALID',
      }));
      throw new HttpsError('internal', 'Desktop reminder request failed.');
    }
    const timestamp = now.toISOString();

    try {
      await dependencies.rateLimiter.consume({ uid, action: parsed.action, now });
      if (parsed.action === 'list') {
        const batch = await dependencies.repository.listDesktopReminderCandidates({
          uid,
          now: timestamp,
          lookbackMs: DESKTOP_REMINDER_FEED_LOOKBACK_MS,
          horizonMs: DESKTOP_REMINDER_FEED_HORIZON_MS,
          maximum: DESKTOP_REMINDER_FEED_MAXIMUM,
        });
        return Object.freeze({
          schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
          action: 'list',
          serverNow: timestamp,
          refreshAfterMs: DESKTOP_REMINDER_REFRESH_AFTER_MS,
          overflow: batch.overflow,
          jobs: Object.freeze([...batch.jobs]),
        });
      }

      const preparation = await dependencies.repository.claimDesktopReminder({
        uid,
        jobId: parsed.jobId,
        now: timestamp,
      });
      if (preparation.action === 'dispatch') {
        return Object.freeze({
          schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
          action: 'claim',
          status: 'dispatch',
          dispatch: preparation.dispatch,
        });
      }
      if (preparation.action === 'retry_later') {
        return Object.freeze({
          schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
          action: 'claim',
          status: 'not_ready',
          notBefore: preparation.notBefore,
        });
      }
      return Object.freeze({
        schemaVersion: DESKTOP_REMINDER_API_SCHEMA_VERSION,
        action: 'claim',
        status: 'no_op',
      });
    } catch (error) {
      if (error instanceof DesktopReminderRateLimitError) {
        apiLogger.warn('Desktop reminder API request was rate limited.', Object.freeze({
          code: 'DESKTOP_REMINDER_RATE_LIMITED',
          action: parsed.action,
          retryAfterSeconds: error.retryAfterSeconds,
        }));
        throw new HttpsError(
          'resource-exhausted',
          'Desktop reminder request rate exceeded.',
          { retryAfterSeconds: error.retryAfterSeconds },
        );
      }
      if (error instanceof HttpsError) throw error;
      apiLogger.error('Desktop reminder API failed safely.', Object.freeze({
        code: 'DESKTOP_REMINDER_INTERNAL',
        action: parsed.action,
      }));
      throw new HttpsError('internal', 'Desktop reminder request failed.');
    }
  };
}

export function createDesktopReminderCallableFunction(
  dependencies: DesktopReminderApiDependencies,
): CallableFunction<unknown, Promise<DesktopReminderApiResponse>> {
  const handler = createDesktopReminderCallableHandler(dependencies);
  return onCall<unknown, Promise<DesktopReminderApiResponse>>(
    {
      ...DESKTOP_REMINDER_CALLABLE_OPTIONS,
      cors: [...DESKTOP_REMINDER_CALLABLE_OPTIONS.cors],
    },
    (request: CallableRequest<unknown>) => handler(request),
  );
}

const NOOP_LOGGER: DesktopReminderApiLogger = Object.freeze({
  warn: () => undefined,
  error: () => undefined,
});
