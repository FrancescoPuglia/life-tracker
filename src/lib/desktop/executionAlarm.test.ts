import { describe, expect, it } from 'vitest';
import type { DesktopReminderDispatch } from '../../../packages/notification-contract';
import type { Goal, Project, Task, TimeBlock } from '@/types';
import {
  BrowserExecutionAlarmPreferencesStore,
  BrowserExecutionAlarmStateStore,
  defaultExecutionAlarmPreferences,
  executionAlarmPresentation,
  normalizeExecutionAlarmPreferences,
  resolveExecutionAlarmContext,
  shouldDispatchExecutionAlarm,
  type ExecutionAlarmSignal,
} from './executionAlarm';
import { createOriginalExecutionAlarmWav } from './executionAlarmSound';

const UID = 'owner-1';

describe('Execution Alarm policy and persistence', () => {
  it('uses strict owner-local defaults and rejects unknown policy fields', () => {
    expect(defaultExecutionAlarmPreferences()).toMatchObject({
      mode: 'normal',
      soundEnabled: true,
      snoozeMinutes: 5,
      muted: false,
    });
    expect(() => normalizeExecutionAlarmPreferences({
      ...defaultExecutionAlarmPreferences(),
      bearerToken: 'never',
    })).toThrow(/invalid/i);
  });

  it('keeps alarm modes owner-scoped and fails safely on corrupt local data', () => {
    const storage = new MemoryStorage();
    const store = new BrowserExecutionAlarmPreferencesStore(storage);
    store.save(UID, { ...defaultExecutionAlarmPreferences(), mode: 'strong' });
    expect(store.load(UID).mode).toBe('strong');
    expect(store.load('owner-2').mode).toBe('normal');

    storage.setItem('life-tracker.execution-alarm.preferences.owner-2', '{broken');
    expect(store.load('owner-2')).toEqual(defaultExecutionAlarmPreferences());
  });

  it('resolves a unique live TimeBlock and reuses existing task/project/goal priority truth', () => {
    const context = resolveExecutionAlarmContext(
      dispatch(),
      [timeBlock()],
      [task()],
      [project()],
      [goal()],
    );
    expect(context).toEqual({
      timeBlockId: 'block-1',
      taskId: 'task-1',
      goalTitle: 'Ship V3',
      projectTitle: 'Alarm',
      priority: 'critical',
    });
    expect(shouldDispatchExecutionAlarm({
      ...defaultExecutionAlarmPreferences(),
      mode: 'critical_only',
    }, context)).toBe(true);
  });

  it('fails closed for ambiguous cached matches in critical-only mode', () => {
    const context = resolveExecutionAlarmContext(
      dispatch(),
      [timeBlock(), { ...timeBlock(), id: 'block-2' }],
      [task()],
      [project()],
      [goal()],
    );
    expect(context.timeBlockId).toBeNull();
    expect(shouldDispatchExecutionAlarm({
      ...defaultExecutionAlarmPreferences(),
      mode: 'critical_only',
    }, context)).toBe(true);
    expect(executionAlarmPresentation(dispatch(), {
      ...defaultExecutionAlarmPreferences(),
      mode: 'critical_only',
    }, context)).toBe('normal');
  });

  it('suppresses off/muted signals and keeps persistent UI limited to at-start semantics', () => {
    const context = resolveExecutionAlarmContext(dispatch(), [timeBlock()], [task()], [project()], [goal()]);
    expect(shouldDispatchExecutionAlarm({
      ...defaultExecutionAlarmPreferences(),
      mode: 'off',
    }, context)).toBe(false);
    expect(shouldDispatchExecutionAlarm({
      ...defaultExecutionAlarmPreferences(),
      mode: 'strong',
      muted: true,
    }, context)).toBe(false);
    expect(executionAlarmPresentation(dispatch(), {
      ...defaultExecutionAlarmPreferences(),
      mode: 'strong',
    }, context)).toBe('strong');
    expect(executionAlarmPresentation({ ...dispatch(), kind: 'offset', offsetMinutes: 15 }, {
      ...defaultExecutionAlarmPreferences(),
      mode: 'strong',
    }, context)).toBeNull();
  });

  it('persists one deterministic occurrence across restart, snoozes, and removes it on acknowledgement', () => {
    const storage = new MemoryStorage();
    const store = new BrowserExecutionAlarmStateStore(storage);
    const now = new Date('2026-08-26T10:00:00.000Z');
    const active = store.activate(UID, signal(), now);
    expect(store.load(UID, now)?.occurrenceId).toBe('a'.repeat(64));

    const snoozed = store.snooze(UID, active, 10, now);
    expect(snoozed.snoozedUntil).toBe('2026-08-26T10:10:00.000Z');
    expect(store.load(UID, new Date('2026-08-26T10:05:00.000Z'))?.snoozedUntil).toBe(
      '2026-08-26T10:10:00.000Z',
    );

    store.acknowledge(UID);
    expect(store.load(UID, now)).toBeNull();
  });

  it('generates a finite original PCM WAV rather than an unbounded media loop', () => {
    const wav = createOriginalExecutionAlarmWav();
    const view = new DataView(wav);
    expect(readAscii(view, 0, 4)).toBe('RIFF');
    expect(readAscii(view, 8, 4)).toBe('WAVE');
    expect(readAscii(view, 36, 4)).toBe('data');
    expect(view.getUint32(24, true)).toBe(22_050);
    expect(wav.byteLength).toBeGreaterThan(90_000);
    expect(wav.byteLength).toBeLessThan(110_000);
  });
});

function signal(): ExecutionAlarmSignal {
  return {
    dispatch: dispatch(),
    context: {
      timeBlockId: 'block-1',
      taskId: 'task-1',
      goalTitle: 'Ship V3',
      projectTitle: 'Alarm',
      priority: 'critical',
    },
    presentation: 'strong',
  };
}

function dispatch(): DesktopReminderDispatch {
  return {
    jobId: 'a'.repeat(64),
    attemptId: 'b'.repeat(64),
    kind: 'at_start',
    offsetMinutes: 0,
    scheduledFor: '2026-08-26T10:00:00.000Z',
    startTime: '2026-08-26T10:00:00.000Z',
    title: 'Deep work',
    plannedMinutes: 60,
    timezone: 'Europe/Rome',
    locale: 'it-IT',
  };
}

function timeBlock(): TimeBlock {
  return {
    id: 'block-1', userId: UID, domainId: 'work', title: 'Deep work',
    taskId: 'task-1', projectId: 'project-1', goalId: 'goal-1',
    startTime: new Date('2026-08-26T10:00:00.000Z'),
    endTime: new Date('2026-08-26T11:00:00.000Z'), status: 'planned', type: 'deep',
    createdAt: new Date(), updatedAt: new Date(),
  };
}

function task(): Task {
  return {
    id: 'task-1', userId: UID, domainId: 'work', title: 'Implement', projectId: 'project-1',
    goalId: 'goal-1', status: 'pending', priority: 'high', estimatedMinutes: 60,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

function project(): Project {
  return {
    id: 'project-1', userId: UID, domainId: 'work', name: 'Alarm', goalId: 'goal-1',
    status: 'active', priority: 'medium', createdAt: new Date(), updatedAt: new Date(),
  };
}

function goal(): Goal {
  return {
    id: 'goal-1', userId: UID, domainId: 'work', title: 'Ship V3', status: 'active',
    priority: 'critical', targetDate: new Date(), timeAllocationTarget: 5, keyResults: [],
    category: 'important_not_urgent', complexity: 'complex',
    createdAt: new Date(), updatedAt: new Date(),
  };
}

function readAscii(view: DataView, offset: number, length: number): string {
  return Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(offset + index))).join('');
}

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
