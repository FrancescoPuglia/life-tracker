// src/lib/weeklyPlanner/routineEngine.test.ts
import { describe, it, expect } from 'vitest';
import { expandRoutineIntents } from './routineEngine';
import {
  DEFAULT_PLANNING_CONSTRAINTS,
  DEFAULT_SCHEDULING_PREFERENCES,
  type ParsedIntent,
} from './types';

function intent(over: Partial<ParsedIntent>): ParsedIntent {
  return {
    id: 'i',
    label: 'Test',
    sourceText: '',
    activityType: 'task',
    preferredDays: [],
    priority: 50,
    flexibility: 'flexible',
    energyLevel: 'medium',
    confidence: 1,
    ...over,
  };
}

describe('expandRoutineIntents', () => {
  it('daily → 7 blocks (Mon..Sun)', () => {
    const blocks = expandRoutineIntents(
      [
        intent({
          id: 'daily',
          activityType: 'routine',
          recurrence: 'daily',
          preferredTime: '07:00',
          durationMinutes: 30,
        }),
      ],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
      DEFAULT_SCHEDULING_PREFERENCES,
    );
    expect(blocks).toHaveLength(7);
    expect(new Set(blocks.map((b) => b.day))).toEqual(
      new Set([0, 1, 2, 3, 4, 5, 6]),
    );
  });

  it('weekdays → 5 blocks (Mon..Fri)', () => {
    const blocks = expandRoutineIntents(
      [
        intent({
          id: 'wd',
          activityType: 'career',
          recurrence: 'weekdays',
          durationMinutes: 60,
        }),
      ],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
      DEFAULT_SCHEDULING_PREFERENCES,
    );
    expect(blocks).toHaveLength(5);
    expect(blocks.map((b) => b.day).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('4x weekly → Mon, Tue, Thu, Sat', () => {
    const blocks = expandRoutineIntents(
      [
        intent({
          id: 'x4',
          activityType: 'exercise',
          recurrence: 'x_times_weekly',
          timesPerWeek: 4,
        }),
      ],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
      DEFAULT_SCHEDULING_PREFERENCES,
    );
    expect(blocks.map((b) => b.day).sort()).toEqual([0, 1, 3, 5]);
  });

  it('explicit day list → exactly those days', () => {
    const blocks = expandRoutineIntents(
      [
        intent({
          id: 'mon',
          activityType: 'chess',
          recurrence: 'weekly',
          preferredDays: [0],
          durationMinutes: 120,
        }),
      ],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
      DEFAULT_SCHEDULING_PREFERENCES,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].day).toBe(0);
    expect(blocks[0].durationMinutes).toBe(120);
  });

  it('reading evening defaults to 21:00 when no explicit time given', () => {
    const blocks = expandRoutineIntents(
      [
        intent({
          id: 'r',
          activityType: 'reading',
          recurrence: 'daily',
          preferredTimeWindow: 'evening',
          durationMinutes: 30,
          sourceText: 'Leggere ogni sera 30 minuti',
        }),
      ],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
      DEFAULT_SCHEDULING_PREFERENCES,
    );
    expect(blocks.every((b) => b.startTime === '21:00')).toBe(true);
    expect(blocks.every((b) => b.endTime === '21:30')).toBe(true);
  });

  it('career morning defaults to 09:00', () => {
    const blocks = expandRoutineIntents(
      [
        intent({
          id: 'c',
          activityType: 'career',
          recurrence: 'daily',
          preferredTimeWindow: 'morning',
          durationMinutes: 90,
          sourceText: 'Career deep work ogni mattina 90 minuti',
        }),
      ],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
      DEFAULT_SCHEDULING_PREFERENCES,
    );
    expect(blocks.every((b) => b.startTime === '09:00')).toBe(true);
  });

  it('wake-up routine defaults to 07:00 when no preferredTime', () => {
    const blocks = expandRoutineIntents(
      [
        intent({
          id: 'wake',
          activityType: 'routine',
          recurrence: 'daily',
          sourceText: 'Mi sveglio ogni giorno',
        }),
      ],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
      DEFAULT_SCHEDULING_PREFERENCES,
    );
    expect(blocks.every((b) => b.startTime === '07:00')).toBe(true);
  });

  it('marks daily/weekdays/x_times_weekly as isRoutine; once/weekly as not', () => {
    const blocks = expandRoutineIntents(
      [
        intent({
          id: 'd',
          activityType: 'routine',
          recurrence: 'daily',
          sourceText: 'Mi sveglio',
        }),
        intent({
          id: 'w',
          activityType: 'chess',
          recurrence: 'weekly',
          preferredDays: [0],
        }),
      ],
      [],
      DEFAULT_PLANNING_CONSTRAINTS,
      DEFAULT_SCHEDULING_PREFERENCES,
    );
    expect(blocks.filter((b) => b.intentId === 'd').every((b) => b.isRoutine)).toBe(true);
    expect(blocks.filter((b) => b.intentId === 'w').every((b) => !b.isRoutine)).toBe(true);
  });

  it('attaches the matching mapping to each block', () => {
    const blocks = expandRoutineIntents(
      [
        intent({
          id: 'i1',
          activityType: 'chess',
          recurrence: 'weekly',
          preferredDays: [0],
          durationMinutes: 60,
        }),
      ],
      [
        {
          intentId: 'i1',
          status: 'mapped',
          taskId: 't_catalan',
          confidence: 0.9,
          reason: 'fixture',
          matchedKeywords: [],
        },
      ],
      DEFAULT_PLANNING_CONSTRAINTS,
      DEFAULT_SCHEDULING_PREFERENCES,
    );
    expect(blocks[0].mapping?.taskId).toBe('t_catalan');
  });
});
