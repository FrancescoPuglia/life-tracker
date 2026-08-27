import {
  HttpsError,
  onCall,
  type CallableFunction,
  type CallableOptions,
  type CallableRequest,
} from 'firebase-functions/v2/https';
import {
  WEEKLY_REVIEW_API_SCHEMA_VERSION,
  parseWeeklyReviewApiRequest,
  type WeeklyReviewApiResponse,
  type WeeklyReviewSendResponse,
  type WeeklyReviewStatusResponse,
} from '../../../packages/report-contract';
import type { ScientificReportRuntimeGate } from './schedule-trigger';

export const WEEKLY_REVIEW_CALLABLE_OPTIONS = Object.freeze({
  region: 'europe-west1',
  ingressSettings: 'ALLOW_ALL' as const,
  invoker: 'public' as const,
  timeoutSeconds: 540,
  memory: '1GiB' as const,
  minInstances: 0,
  maxInstances: 1,
  concurrency: 1,
  enforceAppCheck: false,
  cors: Object.freeze([
    'https://tauri.localhost',
    'http://127.0.0.1:3000',
    'http://localhost:3000',
  ]),
});

export interface WeeklyReviewApiService {
  status(uid: string, now: string): Promise<Omit<WeeklyReviewStatusResponse, 'schemaVersion' | 'action'>>;
  sendTest(uid: string, now: string): Promise<Omit<WeeklyReviewSendResponse, 'schemaVersion' | 'action'>>;
  retryDelivery(
    uid: string,
    reportId: string,
    now: string,
  ): Promise<Omit<WeeklyReviewSendResponse, 'schemaVersion' | 'action'>>;
}

export interface WeeklyReviewApiLogger {
  warn(message: string, metadata: Readonly<Record<string, string>>): void;
  error(message: string, metadata: Readonly<Record<string, string>>): void;
}

export interface WeeklyReviewApiDependencies {
  readonly gate: ScientificReportRuntimeGate;
  readonly service: WeeklyReviewApiService;
  readonly now?: () => Date;
  readonly logger?: WeeklyReviewApiLogger;
}

export interface WeeklyReviewCallableRequest {
  readonly data: unknown;
  readonly auth?: Readonly<{ uid: string }>;
}

export function createWeeklyReviewCallableHandler(dependencies: WeeklyReviewApiDependencies) {
  const clock = dependencies.now ?? (() => new Date());
  const logger = dependencies.logger ?? NOOP_LOGGER;
  return async (request: WeeklyReviewCallableRequest): Promise<WeeklyReviewApiResponse> => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication is required.');
    let parsed: ReturnType<typeof parseWeeklyReviewApiRequest>;
    try {
      parsed = parseWeeklyReviewApiRequest(request.data);
    } catch {
      throw new HttpsError('invalid-argument', 'Weekly review request is invalid.');
    }

    let allowedUid: string | null;
    try {
      allowedUid = dependencies.gate.allowedOwnerUid();
    } catch {
      logger.error('Weekly review runtime configuration failed closed.', Object.freeze({
        code: 'WEEKLY_REVIEW_RUNTIME_INVALID',
      }));
      throw new HttpsError('failed-precondition', 'Weekly review runtime is unavailable.');
    }
    if (allowedUid === null) {
      throw new HttpsError('failed-precondition', 'Weekly review runtime is disabled.');
    }
    if (uid !== allowedUid) {
      logger.warn('Weekly review owner mismatch was denied.', Object.freeze({
        code: 'WEEKLY_REVIEW_OWNER_DENIED',
      }));
      throw new HttpsError('permission-denied', 'Weekly review access is denied.');
    }

    const now = clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new HttpsError('internal', 'Weekly review request failed.');
    }
    const occurredAt = now.toISOString();
    try {
      if (parsed.action === 'status') {
        return Object.freeze({
          schemaVersion: WEEKLY_REVIEW_API_SCHEMA_VERSION,
          action: 'status',
          ...(await dependencies.service.status(uid, occurredAt)),
        });
      }
      if (parsed.action === 'send_test') {
        return Object.freeze({
          schemaVersion: WEEKLY_REVIEW_API_SCHEMA_VERSION,
          action: 'send_test',
          ...(await dependencies.service.sendTest(uid, occurredAt)),
        });
      }
      return Object.freeze({
        schemaVersion: WEEKLY_REVIEW_API_SCHEMA_VERSION,
        action: 'retry_delivery',
        ...(await dependencies.service.retryDelivery(uid, parsed.reportId!, occurredAt)),
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('Weekly review API failed safely.', Object.freeze({
        code: 'WEEKLY_REVIEW_API_INTERNAL',
        action: parsed.action,
      }));
      throw new HttpsError('internal', 'Weekly review request failed.');
    }
  };
}

export function createWeeklyReviewCallableFunction(
  dependencies: WeeklyReviewApiDependencies & Readonly<{
    secrets?: Readonly<NonNullable<CallableOptions['secrets']>>;
  }>,
): CallableFunction<unknown, Promise<WeeklyReviewApiResponse>> {
  const handler = createWeeklyReviewCallableHandler(dependencies);
  return onCall<unknown, Promise<WeeklyReviewApiResponse>>(
    {
      ...WEEKLY_REVIEW_CALLABLE_OPTIONS,
      cors: [...WEEKLY_REVIEW_CALLABLE_OPTIONS.cors],
      ...(dependencies.secrets ? { secrets: [...dependencies.secrets] } : {}),
    },
    (request: CallableRequest<unknown>) => handler(request),
  );
}

const NOOP_LOGGER: WeeklyReviewApiLogger = Object.freeze({
  warn: () => undefined,
  error: () => undefined,
});
