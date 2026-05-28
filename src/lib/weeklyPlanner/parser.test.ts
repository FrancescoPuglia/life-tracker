// src/lib/weeklyPlanner/parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseWeeklyIntent } from './parser';

const RAW = {
  id: 'raw-1',
  weekStartISO: '2026-01-05',
  createdAtISO: '2026-01-04T20:00:00.000Z',
} as const;

describe('parseWeeklyIntent', () => {
  it('extracts at least five intents from the canonical example', () => {
    const intents = parseWeeklyIntent({
      ...RAW,
      text: 'Mi sveglio ogni giorno alle 7. Lunedì studio la Catalana per 2 ore. Martedì Sveshnikov 90 minuti. Palestra 4 volte a settimana. Leggere ogni sera 30 minuti.',
    });
    expect(intents.length).toBeGreaterThanOrEqual(5);
  });

  it('parses the wake-up routine: daily 07:00', () => {
    const [intent] = parseWeeklyIntent({
      ...RAW,
      text: 'Mi sveglio ogni giorno alle 7.',
    });
    expect(intent.activityType).toBe('routine');
    expect(intent.recurrence).toBe('daily');
    expect(intent.preferredTime).toBe('07:00');
  });

  it('parses Lunedì Catalana 2 ore → chess, Monday, 120 min', () => {
    const [intent] = parseWeeklyIntent({
      ...RAW,
      text: 'Lunedì studio la Catalana per 2 ore.',
    });
    expect(intent.activityType).toBe('chess');
    expect(intent.preferredDays).toContain(0);
    expect(intent.durationMinutes).toBe(120);
  });

  it('parses Martedì Sveshnikov 90 minuti → chess, Tuesday, 90 min', () => {
    const [intent] = parseWeeklyIntent({
      ...RAW,
      text: 'Martedì Sveshnikov 90 minuti.',
    });
    expect(intent.activityType).toBe('chess');
    expect(intent.preferredDays).toContain(1);
    expect(intent.durationMinutes).toBe(90);
  });

  it('parses Palestra 4 volte a settimana → exercise, x_times_weekly=4', () => {
    const [intent] = parseWeeklyIntent({
      ...RAW,
      text: 'Palestra 4 volte a settimana.',
    });
    expect(intent.activityType).toBe('exercise');
    expect(intent.recurrence).toBe('x_times_weekly');
    expect(intent.timesPerWeek).toBe(4);
  });

  it('parses Leggere ogni sera 30 minuti → reading, daily, evening', () => {
    const [intent] = parseWeeklyIntent({
      ...RAW,
      text: 'Leggere ogni sera 30 minuti.',
    });
    expect(intent.activityType).toBe('reading');
    expect(intent.recurrence).toBe('daily');
    expect(intent.preferredTimeWindow).toBe('evening');
    expect(intent.durationMinutes).toBe(30);
  });

  it('accepts English aliases (every day / monday / 2 hours)', () => {
    const [intent] = parseWeeklyIntent({
      ...RAW,
      text: 'Monday Catalan 2 hours every day at 7',
    });
    expect(intent.activityType).toBe('chess');
    expect(intent.preferredDays).toContain(0);
    expect(intent.recurrence).toBe('daily');
    expect(intent.preferredTime).toBe('07:00');
    expect(intent.durationMinutes).toBe(120);
  });

  it('returns deterministic ids for identical input', () => {
    const a = parseWeeklyIntent({
      ...RAW,
      text: 'Lunedì studio la Catalana per 2 ore.',
    });
    const b = parseWeeklyIntent({
      ...RAW,
      text: 'Lunedì studio la Catalana per 2 ore.',
    });
    expect(a[0].id).toBe(b[0].id);
  });

  it('skips empty / noise-only segments', () => {
    const intents = parseWeeklyIntent({
      ...RAW,
      text: '...   ; ;  ',
    });
    expect(intents).toHaveLength(0);
  });

  it('confidence reflects completeness', () => {
    const [strong] = parseWeeklyIntent({
      ...RAW,
      text: 'Lunedì studio la Catalana per 2 ore.',
    });
    const [weak] = parseWeeklyIntent({
      ...RAW,
      text: 'Catalana',
    });
    expect(strong.confidence).toBeGreaterThan(weak.confidence);
  });

  it('marks intents with explicit time as fixed, otherwise flexible', () => {
    const [fixed] = parseWeeklyIntent({
      ...RAW,
      text: 'Lunedì Catalana alle 15:00 per 2 ore.',
    });
    const [flex] = parseWeeklyIntent({
      ...RAW,
      text: 'Lunedì Catalana per 2 ore.',
    });
    expect(fixed.flexibility).toBe('fixed');
    expect(flex.flexibility).toBe('flexible');
  });
});
