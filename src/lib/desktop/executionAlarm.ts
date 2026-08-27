import type { DesktopReminderDispatch } from '../../../packages/notification-contract';
import type { Goal, Priority, Project, Task, TimeBlock } from '@/types';

export const EXECUTION_ALARM_SIGNAL_EVENT = 'life-tracker:execution-alarm-signal' as const;
export const EXECUTION_ALARM_STOP_EVENT = 'life-tracker:execution-alarm-stop' as const;
export const EXECUTION_ALARM_PREFERENCES_EVENT =
  'life-tracker:execution-alarm-preferences' as const;

export const EXECUTION_ALARM_MAX_AUDIBLE_MS = 90_000;
export const EXECUTION_ALARM_ESCALATION_MS = Object.freeze([
  0,
  6_000,
  12_000,
  18_000,
  24_000,
  30_000,
  45_000,
  60_000,
  75_000,
  90_000,
] as const);

const PREFERENCES_SCHEMA_VERSION = 'execution-alarm-preferences-v1' as const;
const STATE_SCHEMA_VERSION = 'execution-alarm-state-v1' as const;
const MAX_RESTORABLE_AGE_MS = 12 * 60 * 60 * 1_000;

export type ExecutionAlarmMode = 'off' | 'normal' | 'strong' | 'critical_only';
export type ExecutionAlarmPresentation = 'normal' | 'strong' | 'test';

export interface ExecutionAlarmPreferences {
  readonly schemaVersion: typeof PREFERENCES_SCHEMA_VERSION;
  readonly mode: ExecutionAlarmMode;
  readonly soundEnabled: boolean;
  readonly snoozeMinutes: 5 | 10 | 15;
  readonly muted: boolean;
}

export interface ExecutionAlarmContext {
  readonly timeBlockId: string | null;
  readonly taskId: string | null;
  readonly goalTitle: string | null;
  readonly projectTitle: string | null;
  readonly priority: Priority | null;
}

export interface ExecutionAlarmSignal {
  readonly dispatch: DesktopReminderDispatch;
  readonly context: ExecutionAlarmContext;
  readonly presentation: ExecutionAlarmPresentation;
}

export interface PersistedExecutionAlarmState {
  readonly schemaVersion: typeof STATE_SCHEMA_VERSION;
  readonly uid: string;
  readonly occurrenceId: string;
  readonly attemptId: string;
  readonly blockId: string | null;
  readonly trigger: 'at_start' | 'missed_start';
  readonly scheduledInstant: string;
  readonly acknowledged: boolean;
  readonly snoozedUntil: string | null;
  readonly updatedAt: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function defaultExecutionAlarmPreferences(): ExecutionAlarmPreferences {
  return Object.freeze({
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    mode: 'normal',
    soundEnabled: true,
    snoozeMinutes: 5,
    muted: false,
  });
}

export function normalizeExecutionAlarmPreferences(value: unknown): ExecutionAlarmPreferences {
  const source = record(value, 'Execution Alarm preferences');
  exact(
    source,
    ['mode', 'muted', 'schemaVersion', 'snoozeMinutes', 'soundEnabled'],
    'Execution Alarm preferences',
  );
  if (source.schemaVersion !== PREFERENCES_SCHEMA_VERSION) invalid('Execution Alarm schema');
  if (!['off', 'normal', 'strong', 'critical_only'].includes(String(source.mode))) {
    invalid('Execution Alarm mode');
  }
  if (typeof source.soundEnabled !== 'boolean' || typeof source.muted !== 'boolean') {
    invalid('Execution Alarm sound state');
  }
  if (![5, 10, 15].includes(Number(source.snoozeMinutes))) {
    invalid('Execution Alarm snooze interval');
  }
  return Object.freeze({
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    mode: source.mode as ExecutionAlarmMode,
    soundEnabled: source.soundEnabled,
    snoozeMinutes: source.snoozeMinutes as 5 | 10 | 15,
    muted: source.muted,
  });
}

export class BrowserExecutionAlarmPreferencesStore {
  constructor(private readonly storage: StorageLike | null = browserStorage()) {}

  load(uid: string): ExecutionAlarmPreferences {
    assertUid(uid);
    if (!this.storage) return defaultExecutionAlarmPreferences();
    try {
      const raw = this.storage.getItem(preferencesKey(uid));
      return raw ? normalizeExecutionAlarmPreferences(JSON.parse(raw)) : defaultExecutionAlarmPreferences();
    } catch {
      return defaultExecutionAlarmPreferences();
    }
  }

  save(uid: string, value: ExecutionAlarmPreferences): ExecutionAlarmPreferences {
    assertUid(uid);
    const normalized = normalizeExecutionAlarmPreferences(value);
    this.storage?.setItem(preferencesKey(uid), JSON.stringify(normalized));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(EXECUTION_ALARM_PREFERENCES_EVENT, {
        detail: normalized,
      }));
    }
    return normalized;
  }
}

export class BrowserExecutionAlarmStateStore {
  constructor(private readonly storage: StorageLike | null = browserStorage()) {}

  load(uid: string, now = new Date()): PersistedExecutionAlarmState | null {
    assertUid(uid);
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(stateKey(uid));
      if (!raw) return null;
      const parsed = normalizePersistedState(JSON.parse(raw), uid);
      const updatedAtMs = Date.parse(parsed.updatedAt);
      if (
        parsed.acknowledged
        || !Number.isFinite(updatedAtMs)
        || now.getTime() - updatedAtMs > MAX_RESTORABLE_AGE_MS
      ) {
        this.storage.removeItem(stateKey(uid));
        return null;
      }
      return parsed;
    } catch {
      this.storage.removeItem(stateKey(uid));
      return null;
    }
  }

  activate(uid: string, signal: ExecutionAlarmSignal, now = new Date()): PersistedExecutionAlarmState {
    assertUid(uid);
    const normalized = normalizeSignal(signal);
    const state = Object.freeze({
      schemaVersion: STATE_SCHEMA_VERSION,
      uid,
      occurrenceId: normalized.dispatch.jobId,
      attemptId: normalized.dispatch.attemptId,
      blockId: normalized.context.timeBlockId,
      trigger: normalized.dispatch.kind === 'missed_start' ? 'missed_start' : 'at_start',
      scheduledInstant: normalized.dispatch.scheduledFor,
      acknowledged: false,
      snoozedUntil: null,
      updatedAt: now.toISOString(),
    });
    // Test alarms and unmatched legacy dispatches remain intentionally
    // ephemeral. Durable restart state is limited to a validated TimeBlock ID.
    if (state.blockId !== null) this.storage?.setItem(stateKey(uid), JSON.stringify(state));
    return state;
  }

  snooze(
    uid: string,
    state: PersistedExecutionAlarmState,
    minutes: 5 | 10 | 15,
    now = new Date(),
  ): PersistedExecutionAlarmState {
    assertUid(uid);
    if (![5, 10, 15].includes(minutes)) invalid('Execution Alarm snooze interval');
    const current = normalizePersistedState(state, uid);
    const next = Object.freeze({
      ...current,
      acknowledged: false,
      snoozedUntil: new Date(now.getTime() + minutes * 60_000).toISOString(),
      updatedAt: now.toISOString(),
    });
    if (next.blockId !== null) this.storage?.setItem(stateKey(uid), JSON.stringify(next));
    return next;
  }

  acknowledge(uid: string): void {
    assertUid(uid);
    this.storage?.removeItem(stateKey(uid));
  }
}

export const executionAlarmPreferencesStore = new BrowserExecutionAlarmPreferencesStore();
export const executionAlarmStateStore = new BrowserExecutionAlarmStateStore();

export function resolveExecutionAlarmContext(
  dispatch: DesktopReminderDispatch,
  timeBlocks: readonly TimeBlock[],
  tasks: readonly Task[],
  projects: readonly Project[],
  goals: readonly Goal[],
): ExecutionAlarmContext {
  const startMs = Date.parse(dispatch.startTime);
  const normalizedTitle = normalizeTitle(dispatch.title);
  const matches = timeBlocks.filter((block) => (
    !block.deleted
    && block.status !== 'completed'
    && block.status !== 'cancelled'
    && Math.abs(block.startTime.getTime() - startMs) <= 1_000
    && normalizeTitle(block.title) === normalizedTitle
  ));
  if (matches.length !== 1) return emptyContext();

  const block = matches[0];
  const taskIds = [block.taskId, ...(block.taskIds ?? [])].filter(Boolean) as string[];
  const task = taskIds.length > 0 ? tasks.find((candidate) => taskIds.includes(candidate.id)) : undefined;
  const projectId = block.projectId ?? task?.projectId;
  const project = projectId ? projects.find((candidate) => candidate.id === projectId) : undefined;
  const goalIds = [
    block.goalId,
    ...(block.goalIds ?? []),
    task?.goalId,
    ...(task?.goalIds ?? []),
    project?.goalId,
  ].filter(Boolean) as string[];
  const goal = goals.find((candidate) => goalIds.includes(candidate.id));
  return Object.freeze({
    timeBlockId: block.id,
    taskId: task?.id ?? block.taskId ?? null,
    goalTitle: goal?.title ?? null,
    projectTitle: project?.name ?? null,
    priority: strongestPriority([task?.priority, project?.priority, goal?.priority]),
  });
}

export function shouldDispatchExecutionAlarm(
  preferences: ExecutionAlarmPreferences,
  _context: ExecutionAlarmContext,
): boolean {
  if (preferences.muted || preferences.mode === 'off') return false;
  return true;
}

export function executionAlarmPresentation(
  dispatch: DesktopReminderDispatch,
  preferences: ExecutionAlarmPreferences,
  context: ExecutionAlarmContext,
): ExecutionAlarmPresentation | null {
  if (dispatch.kind === 'offset') return null;
  if (preferences.mode === 'critical_only') {
    return context.priority === 'critical' || context.priority === 'high' ? 'strong' : 'normal';
  }
  return preferences.mode === 'normal' ? 'normal' : 'strong';
}

export function dispatchExecutionAlarmSignal(signal: ExecutionAlarmSignal): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EXECUTION_ALARM_SIGNAL_EVENT, {
    detail: normalizeSignal(signal),
  }));
}

export function isExecutionAlarmSignal(value: unknown): value is ExecutionAlarmSignal {
  try {
    normalizeSignal(value);
    return true;
  } catch {
    return false;
  }
}

function normalizePersistedState(value: unknown, uid: string): PersistedExecutionAlarmState {
  const source = record(value, 'Execution Alarm state');
  exact(
    source,
    [
      'acknowledged', 'attemptId', 'blockId', 'occurrenceId', 'scheduledInstant',
      'schemaVersion', 'snoozedUntil', 'trigger', 'uid', 'updatedAt',
    ],
    'Execution Alarm state',
  );
  if (source.schemaVersion !== STATE_SCHEMA_VERSION || source.uid !== uid) {
    invalid('Execution Alarm state identity');
  }
  if (typeof source.acknowledged !== 'boolean') invalid('Execution Alarm acknowledgement');
  if (!/^[a-f0-9]{64}$/.test(String(source.occurrenceId))) invalid('Execution Alarm occurrence ID');
  if (!/^[a-f0-9]{64}$/.test(String(source.attemptId))) invalid('Execution Alarm attempt ID');
  if (!['at_start', 'missed_start'].includes(String(source.trigger))) {
    invalid('Execution Alarm persisted trigger');
  }
  const snoozedUntil = source.snoozedUntil === null
    ? null
    : instant(source.snoozedUntil, 'Execution Alarm snooze');
  return Object.freeze({
    schemaVersion: STATE_SCHEMA_VERSION,
    uid,
    occurrenceId: String(source.occurrenceId),
    attemptId: String(source.attemptId),
    blockId: nullableId(source.blockId, 'Execution Alarm TimeBlock ID'),
    trigger: source.trigger as 'at_start' | 'missed_start',
    scheduledInstant: instant(source.scheduledInstant, 'Execution Alarm scheduled instant'),
    acknowledged: source.acknowledged,
    snoozedUntil,
    updatedAt: instant(source.updatedAt, 'Execution Alarm update time'),
  });
}

function normalizeSignal(value: unknown): ExecutionAlarmSignal {
  const source = record(value, 'Execution Alarm signal');
  exact(source, ['context', 'dispatch', 'presentation'], 'Execution Alarm signal');
  if (!['normal', 'strong', 'test'].includes(String(source.presentation))) {
    invalid('Execution Alarm presentation');
  }
  const dispatch = normalizeDispatch(source.dispatch);
  const contextSource = record(source.context, 'Execution Alarm context');
  exact(
    contextSource,
    ['goalTitle', 'priority', 'projectTitle', 'taskId', 'timeBlockId'],
    'Execution Alarm context',
  );
  const priority = contextSource.priority;
  if (priority !== null && !['critical', 'high', 'medium', 'low'].includes(String(priority))) {
    invalid('Execution Alarm priority');
  }
  return Object.freeze({
    dispatch,
    context: Object.freeze({
      timeBlockId: nullableId(contextSource.timeBlockId, 'TimeBlock ID'),
      taskId: nullableId(contextSource.taskId, 'Task ID'),
      goalTitle: nullableText(contextSource.goalTitle, 160, 'Goal title'),
      projectTitle: nullableText(contextSource.projectTitle, 160, 'Project title'),
      priority: priority as Priority | null,
    }),
    presentation: source.presentation as ExecutionAlarmPresentation,
  });
}

function normalizeDispatch(value: unknown): DesktopReminderDispatch {
  const source = record(value, 'Execution Alarm dispatch');
  exact(source, [
    'attemptId', 'jobId', 'kind', 'locale', 'offsetMinutes', 'plannedMinutes',
    'scheduledFor', 'startTime', 'timezone', 'title',
  ], 'Execution Alarm dispatch');
  if (!/^[a-f0-9]{64}$/.test(String(source.jobId))) invalid('Execution Alarm job ID');
  if (!/^[a-f0-9]{64}$/.test(String(source.attemptId))) invalid('Execution Alarm attempt ID');
  if (!['offset', 'at_start', 'missed_start'].includes(String(source.kind))) {
    invalid('Execution Alarm dispatch kind');
  }
  const title = text(source.title, 1, 160, 'Execution Alarm title');
  const plannedMinutes = Number(source.plannedMinutes);
  if (!Number.isInteger(plannedMinutes) || plannedMinutes < 1 || plannedMinutes > 10_080) {
    invalid('Execution Alarm duration');
  }
  return Object.freeze({
    jobId: String(source.jobId),
    attemptId: String(source.attemptId),
    kind: source.kind as DesktopReminderDispatch['kind'],
    offsetMinutes: source.offsetMinutes === null ? null : Number(source.offsetMinutes),
    scheduledFor: instant(source.scheduledFor, 'Execution Alarm schedule'),
    title,
    startTime: instant(source.startTime, 'Execution Alarm start'),
    plannedMinutes,
    timezone: text(source.timezone, 1, 100, 'Execution Alarm timezone'),
    locale: text(source.locale, 2, 35, 'Execution Alarm locale'),
  });
}

function strongestPriority(values: readonly (Priority | undefined)[]): Priority | null {
  const ranks: Record<Priority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  return values
    .filter((value): value is Priority => Boolean(value))
    .sort((left, right) => ranks[right] - ranks[left])[0] ?? null;
}

function emptyContext(): ExecutionAlarmContext {
  return Object.freeze({
    timeBlockId: null,
    taskId: null,
    goalTitle: null,
    projectTitle: null,
    priority: null,
  });
}

function preferencesKey(uid: string): string {
  return `life-tracker.execution-alarm.preferences.${uid}`;
}

function stateKey(uid: string): string {
  return `life-tracker.execution-alarm.state.${uid}`;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('it-IT');
}

function assertUid(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) invalid('Execution Alarm owner');
}

function nullableId(value: unknown, label: string): string | null {
  if (value === null) return null;
  return text(value, 1, 256, label);
}

function nullableText(value: unknown, maximum: number, label: string): string | null {
  if (value === null) return null;
  return text(value, 1, maximum, label);
}

function text(value: unknown, minimum: number, maximum: number, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < minimum
    || value.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) invalid(label);
  return value;
}

function instant(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 64) invalid(label);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) invalid(label);
  return date.toISOString();
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(label);
  return value as Record<string, unknown>;
}

function exact(source: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(source).sort().join(',') !== [...keys].sort().join(',')) invalid(label);
}

function invalid(label: string): never {
  throw new Error(`${label} is invalid.`);
}
