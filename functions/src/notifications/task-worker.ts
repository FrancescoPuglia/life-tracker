import {
  onTaskDispatched,
  type Request,
  type TaskQueueFunction,
  type TaskQueueOptions,
} from 'firebase-functions/v2/tasks';
import type { SecretParam } from 'firebase-functions/params';
import { REMINDER_TASK_REGION } from './cloud-tasks-queue';
import type { ReminderDeliveryServiceResult } from './delivery';
import { parseReminderTaskPayload } from './domain';

export const REMINDER_TASK_MAX_ATTEMPTS = 5;
export const REMINDER_TASK_MAX_RETRY_SECONDS = 15 * 60;

export const REMINDER_TASK_QUEUE_OPTIONS: TaskQueueOptions = Object.freeze({
  region: REMINDER_TASK_REGION,
  invoker: 'private',
  ingressSettings: 'ALLOW_INTERNAL_ONLY',
  timeoutSeconds: 45,
  memory: '256MiB',
  minInstances: 0,
  maxInstances: 1,
  concurrency: 1,
  retryConfig: Object.freeze({
    maxAttempts: REMINDER_TASK_MAX_ATTEMPTS,
    maxRetrySeconds: REMINDER_TASK_MAX_RETRY_SECONDS,
    minBackoffSeconds: 30,
    maxBackoffSeconds: 300,
    maxDoublings: 3,
  }),
  rateLimits: Object.freeze({
    maxConcurrentDispatches: 1,
    maxDispatchesPerSecond: 1,
  }),
});

export interface ReminderDeliveryExecutor {
  deliver(input: {
    readonly uid: string;
    readonly jobId: string;
    readonly taskId: string;
    readonly now: string;
  }): Promise<ReminderDeliveryServiceResult>;
}

export interface ReminderTaskWorkerLogger {
  info(message: string, metadata: Readonly<Record<string, string | number | null>>): void;
  warn(message: string, metadata: Readonly<Record<string, string | number | null>>): void;
  error(message: string, metadata: Readonly<Record<string, string | number | null>>): void;
}

export interface ReminderTaskWorkerDependencies {
  readonly delivery: ReminderDeliveryExecutor;
  readonly now?: () => Date;
  readonly logger?: ReminderTaskWorkerLogger;
}

export interface ReminderTaskFunctionDependencies extends ReminderTaskWorkerDependencies {
  readonly secrets?: readonly SecretParam[];
}

export class ReminderTaskRetryError extends Error {
  readonly code: 'REMINDER_TASK_NOT_READY' | 'REMINDER_DELIVERY_EXECUTION_FAILED';
  readonly notBefore: string | null;

  constructor(
    code: ReminderTaskRetryError['code'],
    notBefore: string | null = null,
  ) {
    super('Reminder task requires a bounded retry.');
    this.name = 'ReminderTaskRetryError';
    this.code = code;
    this.notBefore = notBefore;
  }
}

export function createReminderTaskHandler(
  dependencies: ReminderTaskWorkerDependencies,
): (request: Request<unknown>) => Promise<void> {
  const clock = dependencies.now ?? (() => new Date());
  const taskLogger = dependencies.logger ?? NOOP_LOGGER;

  return async (request: Request<unknown>): Promise<void> => {
    let task: ValidatedReminderTaskRequest;
    try {
      task = validateReminderTaskRequest(request);
    } catch {
      taskLogger.warn('Reminder task rejected before delivery.', Object.freeze({
        code: 'REMINDER_TASK_INVALID',
      }));
      return;
    }

    let result: ReminderDeliveryServiceResult;
    try {
      const now = clock();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
        throw new Error('Invalid worker clock.');
      }
      result = await dependencies.delivery.deliver({
        uid: task.uid,
        jobId: task.jobId,
        taskId: task.taskId,
        now: now.toISOString(),
      });
    } catch {
      taskLogger.error('Reminder delivery execution requires retry.', Object.freeze({
        code: 'REMINDER_DELIVERY_EXECUTION_FAILED',
        taskId: task.taskId,
        retryCount: task.retryCount,
      }));
      throw new ReminderTaskRetryError('REMINDER_DELIVERY_EXECUTION_FAILED');
    }

    if (result.outcome === 'retry_later') {
      const notBefore = canonicalInstant(result.notBefore);
      taskLogger.info('Reminder task is not ready for delivery.', Object.freeze({
        code: 'REMINDER_TASK_NOT_READY',
        taskId: task.taskId,
        retryCount: task.retryCount,
        notBefore,
      }));
      throw new ReminderTaskRetryError('REMINDER_TASK_NOT_READY', notBefore);
    }

    taskLogger.info('Reminder task completed safely.', completionMetadata(
      task.taskId,
      task.retryCount,
      result,
    ));
  };
}

export function createPrivateReminderTaskFunction(
  dependencies: ReminderTaskFunctionDependencies,
): TaskQueueFunction<unknown> {
  // Outside the emulator, Firebase's task wrapper requires a bearer token
  // before this handler runs. Internal ingress and private IAM remain the
  // deployment authority; task payload fields never substitute for them.
  return onTaskDispatched<unknown>(
    {
      ...REMINDER_TASK_QUEUE_OPTIONS,
      secrets: dependencies.secrets ? [...dependencies.secrets] : [],
    },
    createReminderTaskHandler(dependencies),
  );
}

interface ValidatedReminderTaskRequest {
  readonly uid: string;
  readonly jobId: string;
  readonly taskId: string;
  readonly retryCount: number;
}

function validateReminderTaskRequest(request: Request<unknown>): ValidatedReminderTaskRequest {
  const source = plainRecord(request);
  const payload = parseReminderTaskPayload(source.data);
  if (source.id !== payload.jobId) {
    throw new Error('Reminder task identity does not match its payload.');
  }
  if (
    typeof source.queueName !== 'string'
    || source.queueName.length < 1
    || source.queueName.length > 200
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(source.queueName)
  ) {
    throw new Error('Reminder task queue identity is invalid.');
  }
  const retryCount = boundedContextCount(source.retryCount, 'retry count');
  boundedContextCount(source.executionCount, 'execution count');
  if (
    typeof source.scheduledTime !== 'string'
    || !Number.isFinite(Date.parse(source.scheduledTime))
  ) {
    throw new Error('Reminder task schedule context is invalid.');
  }
  return Object.freeze({
    uid: payload.uid,
    jobId: payload.jobId,
    taskId: payload.jobId,
    retryCount,
  });
}

function boundedContextCount(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1_000) {
    throw new Error(`Reminder task ${label} is invalid.`);
  }
  return value as number;
}

function canonicalInstant(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ReminderTaskRetryError('REMINDER_DELIVERY_EXECUTION_FAILED');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ReminderTaskRetryError('REMINDER_DELIVERY_EXECUTION_FAILED');
  }
  return date.toISOString();
}

function completionMetadata(
  taskId: string,
  retryCount: number,
  result: Exclude<ReminderDeliveryServiceResult, { outcome: 'retry_later' }>,
): Readonly<Record<string, string | number | null>> {
  return Object.freeze({
    code: 'REMINDER_TASK_COMPLETED',
    taskId,
    retryCount,
    outcome: result.outcome,
    reason: 'reason' in result ? result.reason : null,
  });
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Reminder task request is invalid.');
  }
  return value as Record<string, unknown>;
}

const NOOP_LOGGER: ReminderTaskWorkerLogger = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});
