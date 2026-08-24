import * as functionsLogger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import type {
  ReconcileReminderInput,
  ReconcileReminderResult,
} from './reconciliation-service';
import type {
  ReminderReconciliationSource,
  ReminderReconciliationTarget,
} from './repository';

export const REMINDER_TRIGGER_REGION = 'europe-west1' as const;
export const MAX_PREFERENCE_RECONCILIATION_BLOCKS = 100;
export const MAX_DEFERRED_REFILL_JOBS_PER_RUN = 100;
export const REMINDER_RECONCILIATION_CONCURRENCY = 4;
export const DEFERRED_REMINDER_REFILL_SCHEDULE = '0 */6 * * *' as const;

const TIME_BLOCK_DOCUMENT = 'users/{uid}/timeBlocks/{timeBlockId}' as const;
const NOTIFICATION_PREFERENCES_DOCUMENT =
  'users/{uid}/notificationPreferences/default' as const;
const USER_PROFILE_DOCUMENT = 'users/{uid}' as const;
const MAXIMUM_QUEUE_HORIZON_MS = 30 * 24 * 60 * 60 * 1_000;

export interface ReminderReconciliationExecutor {
  reconcile(input: ReconcileReminderInput): Promise<ReconcileReminderResult>;
}

export interface ReminderReconciliationTriggerLogger {
  info(message: string, metadata: Readonly<Record<string, string | number | boolean>>): void;
  warn(message: string, metadata: Readonly<Record<string, string | number | boolean>>): void;
  error(message: string, metadata: Readonly<Record<string, string | number | boolean>>): void;
}

export interface ReminderReconciliationTriggerDependencies {
  readonly source: ReminderReconciliationSource;
  readonly reconciliation: ReminderReconciliationExecutor;
  readonly now?: () => Date;
  readonly logger?: ReminderReconciliationTriggerLogger;
}

export interface DeferredReminderRefillDependencies
  extends ReminderReconciliationTriggerDependencies {
  readonly maximumScheduleHorizonMs: number;
}

interface EventWithParams {
  readonly params?: Readonly<Record<string, unknown>>;
  readonly data?: unknown;
}

export class ReminderReconciliationTriggerRetryError extends Error {
  readonly code:
    | 'REMINDER_TIME_BLOCK_RECONCILIATION_FAILED'
    | 'REMINDER_OWNER_RECONCILIATION_FAILED'
    | 'REMINDER_DEFERRED_REFILL_FAILED'
    | 'REMINDER_PREFERENCE_BATCH_OVERFLOW'
    | 'REMINDER_DEFERRED_BACKLOG_REMAINS';

  constructor(code: ReminderReconciliationTriggerRetryError['code']) {
    super('Reminder reconciliation requires a bounded retry.');
    this.name = 'ReminderReconciliationTriggerRetryError';
    this.code = code;
  }
}

/**
 * The event snapshot is deliberately ignored. Every invocation rereads the
 * current owner-scoped TimeBlock and preferences, and the repository applies
 * an authority-version precondition in its write transaction.
 */
export function createTimeBlockReminderReconciliationHandler(
  dependencies: ReminderReconciliationTriggerDependencies,
) {
  const logger = dependencies.logger ?? functionsLogger;
  return async (event: EventWithParams): Promise<void> => {
    const identity = timeBlockEventIdentity(event.params);
    if (!identity) {
      logger.warn('Malformed TimeBlock reminder event was acknowledged safely.', {
        code: 'REMINDER_TIME_BLOCK_EVENT_INVALID',
      });
      return;
    }
    try {
      const now = serverInstant(dependencies.now);
      const result = await reconcileCurrentTarget(dependencies, identity, now);
      logger.info('TimeBlock reminders reconciled.', {
        code: 'REMINDER_TIME_BLOCK_RECONCILED',
        desiredJobCount: result.desiredJobCount,
        deferredCount: result.deferredCount,
      });
    } catch {
      logger.error('TimeBlock reminder reconciliation requested a retry.', {
        code: 'REMINDER_TIME_BLOCK_RECONCILIATION_FAILED',
      });
      throw new ReminderReconciliationTriggerRetryError(
        'REMINDER_TIME_BLOCK_RECONCILIATION_FAILED',
      );
    }
  };
}

export function createOwnerReminderReconciliationHandler(
  dependencies: ReminderReconciliationTriggerDependencies,
) {
  const logger = dependencies.logger ?? functionsLogger;
  return async (event: EventWithParams): Promise<void> => {
    const uid = ownerEventIdentity(event.params);
    if (!uid) {
      logger.warn('Malformed reminder-preference event was acknowledged safely.', {
        code: 'REMINDER_OWNER_EVENT_INVALID',
      });
      return;
    }
    try {
      const now = serverInstant(dependencies.now);
      const batch = await dependencies.source.listFutureActiveTimeBlockIds(
        uid,
        now,
        MAX_PREFERENCE_RECONCILIATION_BLOCKS,
      );
      assertTimeBlockBatch(batch.timeBlockIds);
      if (batch.overflow) {
        logger.error('Reminder preference reconciliation exceeded its safe batch.', {
          code: 'REMINDER_PREFERENCE_BATCH_OVERFLOW',
          maximum: MAX_PREFERENCE_RECONCILIATION_BLOCKS,
        });
        throw new ReminderReconciliationTriggerRetryError(
          'REMINDER_PREFERENCE_BATCH_OVERFLOW',
        );
      }
      await reconcileTargets(
        dependencies,
        batch.timeBlockIds.map((timeBlockId) => ({ uid, timeBlockId })),
        now,
      );
      logger.info('Reminder preference authority reconciled.', {
        code: 'REMINDER_OWNER_RECONCILED',
        timeBlockCount: batch.timeBlockIds.length,
      });
    } catch (error) {
      if (error instanceof ReminderReconciliationTriggerRetryError) throw error;
      logger.error('Reminder preference reconciliation requested a retry.', {
        code: 'REMINDER_OWNER_RECONCILIATION_FAILED',
      });
      throw new ReminderReconciliationTriggerRetryError(
        'REMINDER_OWNER_RECONCILIATION_FAILED',
      );
    }
  };
}

export function createDeferredReminderRefillHandler(
  dependencies: DeferredReminderRefillDependencies,
) {
  const logger = dependencies.logger ?? functionsLogger;
  const horizon = validQueueHorizon(dependencies.maximumScheduleHorizonMs);
  return async (): Promise<void> => {
    try {
      const now = serverInstant(dependencies.now);
      const enqueueThrough = new Date(Date.parse(now) + horizon).toISOString();
      const batch = await dependencies.source.listDueDeferredTargets(
        now,
        enqueueThrough,
        MAX_DEFERRED_REFILL_JOBS_PER_RUN,
      );
      const targets = validatedTargets(batch.targets);
      await reconcileTargets(dependencies, targets, now);
      logger.info('Deferred reminder horizon refill completed.', {
        code: 'REMINDER_DEFERRED_REFILL_COMPLETED',
        timeBlockCount: targets.length,
        overflow: batch.overflow,
      });
      if (batch.overflow) {
        throw new ReminderReconciliationTriggerRetryError(
          'REMINDER_DEFERRED_BACKLOG_REMAINS',
        );
      }
    } catch (error) {
      if (error instanceof ReminderReconciliationTriggerRetryError) throw error;
      logger.error('Deferred reminder horizon refill requested a retry.', {
        code: 'REMINDER_DEFERRED_REFILL_FAILED',
      });
      throw new ReminderReconciliationTriggerRetryError(
        'REMINDER_DEFERRED_REFILL_FAILED',
      );
    }
  };
}

export function createTimeBlockReminderReconciliationFunction(
  dependencies: ReminderReconciliationTriggerDependencies,
) {
  return onDocumentWritten({
    document: TIME_BLOCK_DOCUMENT,
    region: REMINDER_TRIGGER_REGION,
    retry: true,
    ingressSettings: 'ALLOW_INTERNAL_ONLY',
    invoker: 'private',
    timeoutSeconds: 120,
    memory: '256MiB',
    minInstances: 0,
    maxInstances: 2,
    concurrency: 4,
  }, createTimeBlockReminderReconciliationHandler(dependencies));
}

export function createNotificationPreferencesReminderReconciliationFunction(
  dependencies: ReminderReconciliationTriggerDependencies,
) {
  return onDocumentWritten({
    document: NOTIFICATION_PREFERENCES_DOCUMENT,
    region: REMINDER_TRIGGER_REGION,
    retry: true,
    ingressSettings: 'ALLOW_INTERNAL_ONLY',
    invoker: 'private',
    timeoutSeconds: 300,
    memory: '256MiB',
    minInstances: 0,
    maxInstances: 1,
    concurrency: 1,
  }, createOwnerReminderReconciliationHandler(dependencies));
}

export function createUserProfileReminderReconciliationFunction(
  dependencies: ReminderReconciliationTriggerDependencies,
) {
  return onDocumentWritten({
    document: USER_PROFILE_DOCUMENT,
    region: REMINDER_TRIGGER_REGION,
    retry: true,
    ingressSettings: 'ALLOW_INTERNAL_ONLY',
    invoker: 'private',
    timeoutSeconds: 300,
    memory: '256MiB',
    minInstances: 0,
    maxInstances: 1,
    concurrency: 1,
  }, createOwnerReminderReconciliationHandler(dependencies));
}

export function createDeferredReminderRefillFunction(
  dependencies: DeferredReminderRefillDependencies,
) {
  return onSchedule({
    schedule: DEFERRED_REMINDER_REFILL_SCHEDULE,
    timeZone: 'Etc/UTC',
    region: REMINDER_TRIGGER_REGION,
    retryCount: 3,
    maxRetrySeconds: 900,
    minBackoffSeconds: 30,
    maxBackoffSeconds: 300,
    maxDoublings: 3,
    ingressSettings: 'ALLOW_INTERNAL_ONLY',
    invoker: 'private',
    timeoutSeconds: 300,
    memory: '256MiB',
    minInstances: 0,
    maxInstances: 1,
    concurrency: 1,
  }, createDeferredReminderRefillHandler(dependencies));
}

async function reconcileCurrentTarget(
  dependencies: ReminderReconciliationTriggerDependencies,
  target: ReminderReconciliationTarget,
  now: string,
): Promise<ReconcileReminderResult> {
  const context = await dependencies.source.loadReconciliationContext(
    target.uid,
    target.timeBlockId,
  );
  return dependencies.reconciliation.reconcile({
    uid: target.uid,
    timeBlockId: target.timeBlockId,
    timeBlockValue: context.timeBlockValue,
    notificationPreferencesValue: context.notificationPreferencesValue,
    persistedTimezone: context.persistedTimezone,
    now,
  });
}

async function reconcileTargets(
  dependencies: ReminderReconciliationTriggerDependencies,
  targets: readonly ReminderReconciliationTarget[],
  now: string,
): Promise<void> {
  let next = 0;
  let failed = false;
  const workerCount = Math.min(REMINDER_RECONCILIATION_CONCURRENCY, targets.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < targets.length) {
      const target = targets[next];
      next += 1;
      if (!target) continue;
      try {
        await reconcileCurrentTarget(dependencies, target, now);
      } catch {
        failed = true;
      }
    }
  }));
  if (failed) throw new Error('One or more bounded reminder reconciliations failed.');
}

function timeBlockEventIdentity(
  params: Readonly<Record<string, unknown>> | undefined,
): ReminderReconciliationTarget | null {
  const uid = params?.uid;
  const timeBlockId = params?.timeBlockId;
  return validUid(uid) && validDocumentId(timeBlockId)
    ? Object.freeze({ uid, timeBlockId })
    : null;
}

function ownerEventIdentity(
  params: Readonly<Record<string, unknown>> | undefined,
): string | null {
  return validUid(params?.uid) ? params.uid : null;
}

function assertTimeBlockBatch(timeBlockIds: readonly string[]): void {
  if (timeBlockIds.length > MAX_PREFERENCE_RECONCILIATION_BLOCKS) {
    throw new Error('Reminder TimeBlock batch exceeds the safe limit.');
  }
  const seen = new Set<string>();
  for (const timeBlockId of timeBlockIds) {
    if (!validDocumentId(timeBlockId) || seen.has(timeBlockId)) {
      throw new Error('Reminder TimeBlock batch identity is invalid.');
    }
    seen.add(timeBlockId);
  }
}

function validatedTargets(
  targets: readonly ReminderReconciliationTarget[],
): readonly ReminderReconciliationTarget[] {
  if (targets.length > MAX_DEFERRED_REFILL_JOBS_PER_RUN) {
    throw new Error('Deferred reminder target batch exceeds the safe limit.');
  }
  const unique = new Map<string, ReminderReconciliationTarget>();
  for (const target of targets) {
    if (!validUid(target.uid) || !validDocumentId(target.timeBlockId)) {
      throw new Error('Deferred reminder target identity is invalid.');
    }
    unique.set(`${target.uid}\u0000${target.timeBlockId}`, Object.freeze({ ...target }));
  }
  return Object.freeze([...unique.values()]);
}

function serverInstant(now: (() => Date) | undefined): string {
  const date = (now ?? (() => new Date()))();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error('Reminder reconciliation server clock is invalid.');
  }
  return date.toISOString();
}

function validQueueHorizon(value: number): number {
  if (!Number.isInteger(value) || value < 60_000 || value > MAXIMUM_QUEUE_HORIZON_MS) {
    throw new Error('Reminder reconciliation queue horizon is invalid.');
  }
  return value;
}

function validUid(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
}

function validDocumentId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
