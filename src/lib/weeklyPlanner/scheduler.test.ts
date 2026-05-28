// src/lib/weeklyPlanner/scheduler.test.ts
import { describe, it, expect } from 'vitest';
import { generateWeeklyDraft } from './scheduler';
import type { GoalLike, ProjectLike, TaskLike } from './types';

const GOALS: GoalLike[] = [
  { id: 'g_chess', title: 'Chess Mastery' },
  { id: 'g_career', title: 'Career 2026' },
  { id: 'g_physique', title: 'Model Physique' },
  { id: 'g_intel', title: 'Intelligence Engine' },
];
const PROJECTS: ProjectLike[] = [
  { id: 'p_openings', title: 'Openings', goalId: 'g_chess' },
  { id: 'p_jobs', title: 'Job Applications', goalId: 'g_career' },
  { id: 'p_strength', title: 'Strength Training', goalId: 'g_physique' },
  { id: 'p_reading', title: 'Reading', goalId: 'g_intel' },
];
const TASKS: TaskLike[] = [
  { id: 't_catalan', title: 'Catalan Course', projectId: 'p_openings', goalId: 'g_chess' },
  { id: 't_svesh', title: 'Sveshnikov Course', projectId: 'p_openings', goalId: 'g_chess' },
];

const RAW = {
  id: 'raw-end2end',
  weekStartISO: '2026-01-05',
  createdAtISO: '2026-01-04T20:00:00.000Z',
} as const;

describe('generateWeeklyDraft', () => {
  it('produces a complete WeeklyPlanDraft from a realistic intent', () => {
    const { draft } = generateWeeklyDraft({
      raw: {
        ...RAW,
        text: 'Ogni giorno sveglia alle 7. Career deep work ogni mattina 90 minuti. Lunedì Catalana 2 ore. Martedì Sveshnikov 90 minuti. Palestra 4 volte a settimana. Leggere ogni sera 30 minuti.',
      },
      goals: GOALS,
      projects: PROJECTS,
      tasks: TASKS,
    });

    expect(draft.status).toBe('draft');
    expect(draft.parsedIntents.length).toBeGreaterThanOrEqual(5);
    expect(draft.blocks.length).toBeGreaterThan(0);
    expect(draft.realismScore).toBeDefined();
    expect(draft.realismScore.overallScore).toBeGreaterThanOrEqual(0);
    expect(draft.realismScore.overallScore).toBeLessThanOrEqual(100);

    for (const b of draft.blocks) {
      expect(b.intentId).toBeTruthy();
      expect(b.startTime).toMatch(/^\d{2}:\d{2}$/);
      expect(b.endTime).toMatch(/^\d{2}:\d{2}$/);
      expect(b.durationMinutes).toBeGreaterThan(0);
    }
  });

  it('respects working hours: no block before 07:00 or past 22:00', () => {
    const { draft } = generateWeeklyDraft({
      raw: {
        ...RAW,
        text: 'Ogni giorno sveglia alle 7. Career deep work ogni mattina 90 minuti. Leggere ogni sera 30 minuti.',
      },
      goals: GOALS,
      projects: PROJECTS,
      tasks: TASKS,
    });
    for (const b of draft.blocks) {
      expect(b.startTime >= '07:00').toBe(true);
      expect(b.endTime <= '22:00').toBe(true);
    }
  });

  it('chess intents map to Catalan/Sveshnikov tasks', () => {
    const { draft } = generateWeeklyDraft({
      raw: {
        ...RAW,
        text: 'Lunedì Catalana 2 ore. Martedì Sveshnikov 90 minuti.',
      },
      goals: GOALS,
      projects: PROJECTS,
      tasks: TASKS,
    });
    const catalana = draft.blocks.find((b) => b.day === 0);
    const sveshnikov = draft.blocks.find((b) => b.day === 1);
    expect(catalana?.mapping?.taskId).toBe('t_catalan');
    expect(sveshnikov?.mapping?.taskId).toBe('t_svesh');
  });

  it('slides flexible blocks past placed ones to avoid overlap', () => {
    const { draft } = generateWeeklyDraft({
      raw: {
        ...RAW,
        text: 'Lunedì Catalana 2 ore. Lunedì Sveshnikov 2 ore.',
      },
      goals: GOALS,
      projects: PROJECTS,
      tasks: TASKS,
    });
    const monday = draft.blocks.filter((b) => b.day === 0);
    expect(monday.length).toBe(2);
    // Sorted by start time; second must start after first ends.
    expect(monday[1].startTime >= monday[0].endTime).toBe(true);
  });

  it('is deterministic: same input → same draft id and block times', () => {
    const opts = {
      raw: {
        ...RAW,
        text: 'Lunedì Catalana 2 ore. Palestra 4 volte a settimana.',
      },
      goals: GOALS,
      projects: PROJECTS,
      tasks: TASKS,
    };
    const a = generateWeeklyDraft(opts);
    const b = generateWeeklyDraft(opts);
    expect(a.draft.id).toBe(b.draft.id);
    expect(a.draft.blocks.map((x) => `${x.day}:${x.startTime}-${x.endTime}`)).toEqual(
      b.draft.blocks.map((x) => `${x.day}:${x.startTime}-${x.endTime}`),
    );
  });

  it('never creates or returns a real TimeBlock (status stays "draft")', () => {
    const { draft } = generateWeeklyDraft({
      raw: { ...RAW, text: 'Lunedì Catalana 2 ore.' },
      goals: GOALS,
      projects: PROJECTS,
      tasks: TASKS,
    });
    expect(draft.status).toBe('draft');
  });
});
