import type { SecretParam } from 'firebase-functions/params';
import * as functionsLogger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import type {
  ScientificReportScheduleManifestService,
  ScientificReportScheduleRunSummary,
} from './schedule-manifest';

export const REPORT_SCHEDULE_REGION = 'europe-west1' as const;
export const REPORT_SCHEDULE_POLL = '*/5 * * * *' as const;
export const MAX_DUE_REPORTS_PER_SCHEDULE_RUN = 10;

const NOTIFICATION_PREFERENCES_DOCUMENT =
  'users/{uid}/notificationPreferences/default' as const;

export interface ScientificReportRuntimeGate {
  /** Null is the exact default-off state and must be resolved before any data read. */
  allowedOwnerUid(): string | null;
}

export interface ScientificReportScheduleTriggerService {
  reconcileOwner(uid: string, now: string): Promise<Readonly<{ activeCount: number }>>;
  runDue(uid: string, now: string, maximum: number): Promise<ScientificReportScheduleRunSummary>;
}

export interface ScientificReportScheduleTriggerLogger {
  info(message: string, metadata: Readonly<Record<string, string | number | boolean>>): void;
  warn(message: string, metadata: Readonly<Record<string, string | number | boolean>>): void;
  error(message: string, metadata: Readonly<Record<string, string | number | boolean>>): void;
}

export interface ScientificReportScheduleTriggerDependencies {
  readonly gate: ScientificReportRuntimeGate;
  readonly service: ScientificReportScheduleTriggerService;
  readonly now?: () => Date;
  readonly logger?: ScientificReportScheduleTriggerLogger;
}

interface PreferenceEvent {
  readonly params?: Readonly<Record<string, unknown>>;
  readonly data?: unknown;
}

export class ScientificReportScheduleRetryError extends Error {
  readonly code:
    | 'REPORT_MANIFEST_RECONCILIATION_FAILED'
    | 'REPORT_SCHEDULE_EXECUTION_FAILED'
    | 'REPORT_SCHEDULE_BACKLOG_REMAINS';

  constructor(code: ScientificReportScheduleRetryError['code']) {
    super('Scientific report scheduling requires a bounded retry.');
    this.name = 'ScientificReportScheduleRetryError';
    this.code = code;
  }
}

export function createScientificReportPreferenceHandler(
  dependencies: ScientificReportScheduleTriggerDependencies,
) {
  const logger = dependencies.logger ?? functionsLogger;
  return async (event: PreferenceEvent): Promise<void> => {
    const allowedUid = safelyResolveAllowedOwner(dependencies.gate, logger);
    if (allowedUid === undefined) return;
    if (allowedUid === null) {
      logger.info('Scientific report scheduling is disabled.', {
        code: 'REPORT_SCHEDULE_DISABLED',
      });
      return;
    }
    const uid = eventUid(event.params);
    if (!uid) {
      logger.warn('Malformed report preference event was acknowledged safely.', {
        code: 'REPORT_PREFERENCE_EVENT_INVALID',
      });
      return;
    }
    if (uid !== allowedUid) {
      logger.info('Non-authorized report preference event was ignored.', {
        code: 'REPORT_PREFERENCE_OWNER_IGNORED',
      });
      return;
    }
    try {
      const result = await dependencies.service.reconcileOwner(uid, serverInstant(dependencies.now));
      logger.info('Scientific report schedule authority reconciled.', {
        code: 'REPORT_SCHEDULE_RECONCILED',
        activeCount: result.activeCount,
      });
    } catch {
      logger.error('Scientific report manifest reconciliation requested a retry.', {
        code: 'REPORT_MANIFEST_RECONCILIATION_FAILED',
      });
      throw new ScientificReportScheduleRetryError('REPORT_MANIFEST_RECONCILIATION_FAILED');
    }
  };
}

export function createScheduledScientificReportHandler(
  dependencies: ScientificReportScheduleTriggerDependencies,
) {
  const logger = dependencies.logger ?? functionsLogger;
  return async (): Promise<void> => {
    const allowedUid = safelyResolveAllowedOwner(dependencies.gate, logger);
    if (allowedUid === undefined) return;
    if (allowedUid === null) {
      logger.info('Scientific report scheduling is disabled.', {
        code: 'REPORT_SCHEDULE_DISABLED',
      });
      return;
    }
    let summary: ScientificReportScheduleRunSummary;
    try {
      const now = serverInstant(dependencies.now);
      // Exact-owner reconciliation makes first deployment and missed Eventarc
      // delivery self-healing without scanning any other user's preferences.
      await dependencies.service.reconcileOwner(allowedUid, now);
      summary = await dependencies.service.runDue(
        allowedUid,
        now,
        MAX_DUE_REPORTS_PER_SCHEDULE_RUN,
      );
    } catch {
      logger.error('Scientific report schedule execution requested a retry.', {
        code: 'REPORT_SCHEDULE_EXECUTION_FAILED',
      });
      throw new ScientificReportScheduleRetryError('REPORT_SCHEDULE_EXECUTION_FAILED');
    }
    logger.info('Scientific report schedule batch completed.', {
      code: 'REPORT_SCHEDULE_BATCH_COMPLETED',
      selectedCount: summary.selectedCount,
      executedCount: summary.executedCount,
      completedCount: summary.completedCount,
      retryCount: summary.retryCount,
      noOpCount: summary.noOpCount,
      failedCount: summary.failedCount,
      runtimeFailureCount: summary.runtimeFailureCount,
      overflow: summary.overflow,
    });
    if (summary.overflow) {
      throw new ScientificReportScheduleRetryError('REPORT_SCHEDULE_BACKLOG_REMAINS');
    }
  };
}

export function createScientificReportPreferenceFunction(
  dependencies: ScientificReportScheduleTriggerDependencies,
) {
  return onDocumentWritten({
    document: NOTIFICATION_PREFERENCES_DOCUMENT,
    region: REPORT_SCHEDULE_REGION,
    retry: true,
    ingressSettings: 'ALLOW_INTERNAL_ONLY',
    invoker: 'private',
    timeoutSeconds: 60,
    memory: '256MiB',
    minInstances: 0,
    maxInstances: 1,
    concurrency: 1,
  }, createScientificReportPreferenceHandler(dependencies));
}

export function createScheduledScientificReportFunction(
  dependencies: ScientificReportScheduleTriggerDependencies & Readonly<{
    secrets?: readonly SecretParam[];
  }>,
) {
  return onSchedule({
    schedule: REPORT_SCHEDULE_POLL,
    timeZone: 'Etc/UTC',
    region: REPORT_SCHEDULE_REGION,
    retryCount: 3,
    maxRetrySeconds: 900,
    minBackoffSeconds: 30,
    maxBackoffSeconds: 300,
    maxDoublings: 3,
    ingressSettings: 'ALLOW_INTERNAL_ONLY',
    invoker: 'private',
    timeoutSeconds: 540,
    memory: '1GiB',
    minInstances: 0,
    maxInstances: 1,
    concurrency: 1,
    ...(dependencies.secrets ? { secrets: [...dependencies.secrets] } : {}),
  }, createScheduledScientificReportHandler(dependencies));
}

function eventUid(params: Readonly<Record<string, unknown>> | undefined): string | null {
  const uid = params?.uid;
  if (typeof uid !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(uid)) return null;
  return uid;
}

/** Invalid static configuration is not transient; acknowledge without retry churn. */
function safelyResolveAllowedOwner(
  gate: ScientificReportRuntimeGate,
  logger: ScientificReportScheduleTriggerLogger,
): string | null | undefined {
  try {
    return gate.allowedOwnerUid();
  } catch {
    logger.error('Scientific report runtime configuration is invalid.', {
      code: 'REPORT_RUNTIME_CONFIG_INVALID',
    });
    return undefined;
  }
}

function serverInstant(clock: (() => Date) | undefined): string {
  const value = (clock ?? (() => new Date()))();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error('Scientific report scheduler clock is invalid.');
  }
  return value.toISOString();
}

export type { ScientificReportScheduleManifestService };
