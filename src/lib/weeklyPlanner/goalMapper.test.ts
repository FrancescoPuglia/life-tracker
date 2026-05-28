// src/lib/weeklyPlanner/goalMapper.test.ts
import { describe, it, expect } from 'vitest';
import { mapIntentsToGoals, mapIntentToGoal } from './goalMapper';
import { parseWeeklyIntent } from './parser';
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
  {
    id: 't_catalan',
    title: 'Catalan Course',
    projectId: 'p_openings',
    goalId: 'g_chess',
  },
  {
    id: 't_svesh',
    title: 'Sveshnikov Course',
    projectId: 'p_openings',
    goalId: 'g_chess',
  },
  {
    id: 't_cv',
    title: 'CV Update',
    projectId: 'p_jobs',
    goalId: 'g_career',
  },
];

const RAW = {
  id: 'raw',
  weekStartISO: '2026-01-05',
  createdAtISO: '2026-01-04T00:00:00.000Z',
} as const;

describe('mapIntentToGoal', () => {
  it('Catalana → Catalan Course / Openings / Chess Mastery', () => {
    const [intent] = parseWeeklyIntent({
      ...RAW,
      text: 'Lunedì studio la Catalana per 2 ore.',
    });
    const m = mapIntentToGoal(intent, GOALS, PROJECTS, TASKS);
    expect(m.taskId).toBe('t_catalan');
    expect(m.projectId).toBe('p_openings');
    expect(m.goalId).toBe('g_chess');
    expect(m.status).toBe('mapped');
  });

  it('Sveshnikov → Sveshnikov Course / Openings / Chess Mastery', () => {
    const [intent] = parseWeeklyIntent({
      ...RAW,
      text: 'Martedì Sveshnikov 90 minuti.',
    });
    const m = mapIntentToGoal(intent, GOALS, PROJECTS, TASKS);
    expect(m.taskId).toBe('t_svesh');
    expect(m.projectId).toBe('p_openings');
    expect(m.goalId).toBe('g_chess');
  });

  it('Palestra → Strength Training (project) / Model Physique (goal)', () => {
    const [intent] = parseWeeklyIntent({
      ...RAW,
      text: 'Palestra 4 volte a settimana.',
    });
    const m = mapIntentToGoal(intent, GOALS, PROJECTS, TASKS);
    expect(m.projectId).toBe('p_strength');
    expect(m.goalId).toBe('g_physique');
    expect(m.status === 'mapped' || m.status === 'needs_review').toBe(true);
  });

  it('Applications → Job Applications / Career 2026', () => {
    const [intent] = parseWeeklyIntent({
      ...RAW,
      text: 'Applications LinkedIn ogni mattina 30 minuti.',
    });
    const m = mapIntentToGoal(intent, GOALS, PROJECTS, TASKS);
    expect(m.projectId).toBe('p_jobs');
    expect(m.goalId).toBe('g_career');
    expect(m.status).toBe('mapped');
  });

  it('Candidature (Italian) also maps to Job Applications via synonym', () => {
    const [intent] = parseWeeklyIntent({
      ...RAW,
      text: 'Candidature ogni mattina 30 minuti.',
    });
    const m = mapIntentToGoal(intent, GOALS, PROJECTS, TASKS);
    expect(m.projectId).toBe('p_jobs');
    expect(m.goalId).toBe('g_career');
  });

  it('Leggere → Reading (project) / Intelligence Engine (goal)', () => {
    const [intent] = parseWeeklyIntent({
      ...RAW,
      text: 'Leggere ogni sera 30 minuti.',
    });
    const m = mapIntentToGoal(intent, GOALS, PROJECTS, TASKS);
    expect(m.projectId).toBe('p_reading');
    expect(m.goalId).toBe('g_intel');
  });

  it('Wake-up routine is marked as maintenance, not unmapped', () => {
    const [intent] = parseWeeklyIntent({
      ...RAW,
      text: 'Mi sveglio ogni giorno alle 7.',
    });
    const m = mapIntentToGoal(intent, GOALS, PROJECTS, TASKS);
    expect(m.status).toBe('maintenance');
    expect(m.goalId).toBeUndefined();
  });

  it('intent with no matching goal is unmapped (not mis-mapped)', () => {
    const [intent] = parseWeeklyIntent({
      ...RAW,
      text: 'Lunedì laundry alle 14.',
    });
    const m = mapIntentToGoal(intent, GOALS, PROJECTS, TASKS);
    expect(m.status).toBe('unmapped');
    expect(m.goalId).toBeUndefined();
  });
});

describe('mapIntentsToGoals (batch)', () => {
  it('returns one mapping per intent in the same order', () => {
    const intents = parseWeeklyIntent({
      ...RAW,
      text: 'Lunedì Catalana per 2 ore. Palestra 4 volte a settimana.',
    });
    const mappings = mapIntentsToGoals(intents, GOALS, PROJECTS, TASKS);
    expect(mappings).toHaveLength(intents.length);
    expect(mappings[0].intentId).toBe(intents[0].id);
    expect(mappings[1].intentId).toBe(intents[1].id);
  });
});
