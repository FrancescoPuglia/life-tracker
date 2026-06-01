// src/lib/weeklyPlanner/explicitMapper.test.ts
import { describe, it, expect } from 'vitest';
import { parseWeeklyIntent } from './parser';
import { mapIntentToGoal } from './goalMapper';
import { extractExplicitEntities } from './explicitMapper';
import type {
  GoalLike,
  GoalMappingCandidate,
  ProjectLike,
  TaskLike,
  WeeklyIntentRaw,
} from './types';

// Fixtures mirror the user's real OKR structure (titles intentionally longer
// than the explicit query, to exercise the contains/prefix matching tiers).
const GOALS: GoalLike[] = [
  { id: 'g_morning', title: 'DOMINARE LA MATTINA - Morning Mastery System' },
  { id: 'g_chess', title: 'CHESS MASTERY ELO 2100' },
  { id: 'g_career', title: 'Career 2026' },
  { id: 'g_physique', title: 'MODEL PHYSIQUE — Corpo estetico forte e definito' },
];

const PROJECTS: ProjectLike[] = [
  // Morning
  { id: 'p_risveglio', title: 'Risveglio Idratazione e Luce Solare', goalId: 'g_morning' },
  { id: 'p_yoga', title: 'Yoga Mobilità e Postura Mattutina', goalId: 'g_morning' },
  { id: 'p_wimhof', title: 'Respirazione Wim Hof e Bagno Freddo', goalId: 'g_morning' },
  // Chess
  { id: 'p_calcolo', title: 'CALCOLO E VISUALIZZAZIONE', goalId: 'g_chess' },
  { id: 'p_tattica', title: 'TATTICA', goalId: 'g_chess' },
  // Career
  { id: 'p_networking', title: 'Networking e STAR Stories', goalId: 'g_career' },
  { id: 'p_career_cmd', title: 'Career Command Center', goalId: 'g_career' },
  // Physique
  { id: 'p_dorso', title: 'Dorso Tricipiti e Collo A', goalId: 'g_physique' },
  { id: 'p_gambe', title: 'Gambe Complete Quadricipiti Glutei Femorali Polpacci', goalId: 'g_physique' },
  { id: 'p_spalle', title: 'Spalle Complete Collo B Core e Trapezio', goalId: 'g_physique' },
];

const TASKS: TaskLike[] = [
  { id: 't_acqua', title: 'Bere acqua calda con limone e sale rosa', projectId: 'p_risveglio', goalId: 'g_morning' },
  { id: 't_yoga', title: 'Completare sequenza yoga mattutina breve', projectId: 'p_yoga', goalId: 'g_morning' },
  { id: 't_wimhof', title: 'Fare 1-3 round di respirazione Wim Hof in sicurezza', projectId: 'p_wimhof', goalId: 'g_morning' },
  { id: 't_tattica', title: 'Esercizi tattici scacchistici', projectId: 'p_tattica', goalId: 'g_chess' },
  // NOTE: p_calcolo intentionally has NO task → exercises unresolved_task.
  { id: 't_dorso', title: 'Completare sessione Mercoledì Dorso Tricipiti e Collo A', projectId: 'p_dorso', goalId: 'g_physique' },
  { id: 't_gambe', title: 'Completare sessione Giovedì Gambe Complete', projectId: 'p_gambe', goalId: 'g_physique' },
  { id: 't_spalle', title: 'Completare sessione Venerdì Spalle Collo B e Core', projectId: 'p_spalle', goalId: 'g_physique' },
  { id: 't_star', title: 'Creare STAR Stories Master Bank', projectId: 'p_networking', goalId: 'g_career' },
  { id: 't_career_decoy', title: 'Configurare il sistema centrale di tracciamento lavoro', projectId: 'p_career_cmd', goalId: 'g_career' },
];

const RAW: Omit<WeeklyIntentRaw, 'text'> = {
  id: 'raw',
  weekStartISO: '2026-01-05',
  createdAtISO: '2026-01-04T00:00:00.000Z',
};

function mapLine(text: string): GoalMappingCandidate {
  const [intent] = parseWeeklyIntent({ ...RAW, text });
  expect(intent).toBeDefined();
  return mapIntentToGoal(intent, GOALS, PROJECTS, TASKS);
}

// ============================================================================
// SYNTAX EXTRACTION
// ============================================================================

describe('extractExplicitEntities', () => {
  it('plain form: Goal X Project Y Task Z', () => {
    const e = extractExplicitEntities(
      'Martedì 08:00-08:10 Goal DOMINARE LA MATTINA Project Risveglio Idratazione e Luce Solare Task Bere acqua calda con limone e sale rosa',
    );
    expect(e).not.toBeNull();
    expect(e?.goalName).toBe('DOMINARE LA MATTINA');
    expect(e?.projectName).toBe('Risveglio Idratazione e Luce Solare');
    expect(e?.taskName).toBe('Bere acqua calda con limone e sale rosa');
    expect(e?.prefix).toBe('Martedì 08:00-08:10');
  });

  it('pipe + colon form', () => {
    const e = extractExplicitEntities(
      'Martedì 08:00-08:10 Goal: DOMINARE LA MATTINA | Project: Risveglio Idratazione e Luce Solare | Task: Bere acqua calda con limone e sale rosa',
    );
    expect(e?.goalName).toBe('DOMINARE LA MATTINA');
    expect(e?.projectName).toBe('Risveglio Idratazione e Luce Solare');
    expect(e?.taskName).toBe('Bere acqua calda con limone e sale rosa');
  });

  it('bracket form', () => {
    const e = extractExplicitEntities(
      'Martedì 08:00-08:10 [Goal: DOMINARE LA MATTINA] [Project: Risveglio Idratazione e Luce Solare] [Task: Bere acqua calda con limone e sale rosa]',
    );
    expect(e?.goalName).toBe('DOMINARE LA MATTINA');
    expect(e?.projectName).toBe('Risveglio Idratazione e Luce Solare');
    expect(e?.taskName).toBe('Bere acqua calda con limone e sale rosa');
  });

  it('returns null for natural-language lines', () => {
    expect(extractExplicitEntities('Lunedì Catalana 2 ore')).toBeNull();
    expect(extractExplicitEntities('Palestra 4 volte a settimana')).toBeNull();
  });
});

// ============================================================================
// PARSER — explicit time + day + flags
// ============================================================================

describe('parser explicit branch', () => {
  it('extracts day, start time and duration from the range', () => {
    const [intent] = parseWeeklyIntent({
      ...RAW,
      text: 'Martedì 08:00-08:10 Goal DOMINARE LA MATTINA Project Risveglio Idratazione e Luce Solare Task Bere acqua calda con limone e sale rosa',
    });
    expect(intent.isExplicit).toBe(true);
    expect(intent.preferredDays).toEqual([1]); // Tuesday
    expect(intent.preferredTime).toBe('08:00');
    expect(intent.durationMinutes).toBe(10);
    expect(intent.flexibility).toBe('fixed');
    expect(intent.explicitGoalName).toBe('DOMINARE LA MATTINA');
  });
});

// ============================================================================
// THE 10 REQUIRED CASES
// ============================================================================

describe('explicit mapping — required cases', () => {
  it('1) Morning · Risveglio · acqua → fully mapped', () => {
    const m = mapLine(
      'Martedì 08:00-08:10 Goal DOMINARE LA MATTINA Project Risveglio Idratazione e Luce Solare Task Bere acqua calda con limone e sale rosa',
    );
    expect(m.status).toBe('mapped');
    expect(m.goalId).toBe('g_morning');
    expect(m.projectId).toBe('p_risveglio');
    expect(m.taskId).toBe('t_acqua');
    expect(m.confidence).toBe(1);
    expect(m.reason).toBe('Explicit Goal/Project/Task mapping');
  });

  it('2) Morning · Yoga · sequenza yoga → fully mapped', () => {
    const m = mapLine(
      'Martedì 08:10-08:35 Goal DOMINARE LA MATTINA Project Yoga Mobilità e Postura Mattutina Task Completare sequenza yoga mattutina breve',
    );
    expect(m.goalId).toBe('g_morning');
    expect(m.projectId).toBe('p_yoga');
    expect(m.taskId).toBe('t_yoga');
    expect(m.status).toBe('mapped');
  });

  it('3) Morning · Wim Hof · respirazione → fully mapped', () => {
    const m = mapLine(
      'Martedì 08:35-08:50 Goal DOMINARE LA MATTINA Project Respirazione Wim Hof e Bagno Freddo Task Fare 1-3 round di respirazione Wim Hof in sicurezza',
    );
    expect(m.goalId).toBe('g_morning');
    expect(m.projectId).toBe('p_wimhof');
    expect(m.taskId).toBe('t_wimhof');
    expect(m.status).toBe('mapped');
  });

  it('4) Chess · CALCOLO · task missing → unresolved_task, never goal-only or physical', () => {
    const m = mapLine(
      'Martedì 15:30-16:10 Goal CHESS MASTERY ELO 2100 Project CALCOLO E VISUALIZZAZIONE Task Visualizzazione scacchistica alla cieca',
    );
    expect(m.status).toBe('unresolved_task');
    expect(m.goalId).toBe('g_chess');
    expect(m.projectId).toBe('p_calcolo');
    expect(m.taskId).toBeUndefined();
    // Never leaks into a physical-training task.
    expect(m.taskId).not.toBe('t_dorso');
    expect(m.explicit?.taskMatched).toBe(false);
  });

  it('5) Chess · TATTICA · esercizi tattici → mapped, never physical training', () => {
    const m = mapLine(
      'Martedì 16:10-16:40 Goal CHESS MASTERY ELO 2100 Project TATTICA Task Esercizi tattici scacchistici',
    );
    expect(m.status).toBe('mapped');
    expect(m.goalId).toBe('g_chess');
    expect(m.projectId).toBe('p_tattica');
    expect(m.taskId).toBe('t_tattica');
    expect(m.goalId).not.toBe('g_physique');
  });

  it('6) Physique · Dorso (Mercoledì) → fully mapped', () => {
    const m = mapLine(
      'Mercoledì 20:00-21:30 Goal MODEL PHYSIQUE Project Dorso Tricipiti e Collo A Task Completare sessione Mercoledì Dorso Tricipiti e Collo A',
    );
    expect(m.goalId).toBe('g_physique');
    expect(m.projectId).toBe('p_dorso');
    expect(m.taskId).toBe('t_dorso');
    expect(m.status).toBe('mapped');
  });

  it('7) Physique · Gambe (Giovedì) → fully mapped', () => {
    const m = mapLine(
      'Giovedì 20:00-21:30 Goal MODEL PHYSIQUE Project Gambe Complete Quadricipiti Glutei Femorali Polpacci Task Completare sessione Giovedì Gambe Complete',
    );
    expect(m.goalId).toBe('g_physique');
    expect(m.projectId).toBe('p_gambe');
    expect(m.taskId).toBe('t_gambe');
    expect(m.status).toBe('mapped');
  });

  it('8) Physique · Spalle (Venerdì) → fully mapped', () => {
    const m = mapLine(
      'Venerdì 20:00-21:30 Goal MODEL PHYSIQUE Project Spalle Complete Collo B Core e Trapezio Task Completare sessione Venerdì Spalle Collo B e Core',
    );
    expect(m.goalId).toBe('g_physique');
    expect(m.projectId).toBe('p_spalle');
    expect(m.taskId).toBe('t_spalle');
    expect(m.status).toBe('mapped');
  });

  it('9) Career · Networking · STAR Bank → maps to STAR task, NOT the decoy', () => {
    const m = mapLine(
      'Giovedì 17:30-19:30 Goal Career 2026 Project Networking e STAR Stories Task Creare STAR Stories Master Bank',
    );
    expect(m.status).toBe('mapped');
    expect(m.goalId).toBe('g_career');
    expect(m.projectId).toBe('p_networking');
    expect(m.taskId).toBe('t_star');
    expect(m.taskId).not.toBe('t_career_decoy');
  });

  it('10) Invalid explicit goal → unresolved_goal warning, no random fallback', () => {
    const m = mapLine(
      'Lunedì 09:00-10:00 Goal GOAL INESISTENTE Project Progetto Fantasma Task Task Fantasma',
    );
    expect(m.status).toBe('unresolved_goal');
    expect(m.goalId).toBeUndefined();
    expect(m.projectId).toBeUndefined();
    expect(m.taskId).toBeUndefined();
    expect(m.explicit?.goalMatched).toBe(false);
  });

  it('explicit project miss → unresolved_project with candidates, no wrong project', () => {
    const m = mapLine(
      'Martedì 15:30-16:10 Goal CHESS MASTERY ELO 2100 Project Progetto Inesistente Task Qualcosa',
    );
    expect(m.status).toBe('unresolved_project');
    expect(m.goalId).toBe('g_chess');
    expect(m.projectId).toBeUndefined();
    expect(m.explicit?.projectCandidates).toContain('TATTICA');
  });
});

// ============================================================================
// REGRESSION — natural language still flows through keyword fallback
// ============================================================================

describe('non-explicit lines are untouched', () => {
  it('does not flag natural-language intents as explicit', () => {
    const [intent] = parseWeeklyIntent({
      ...RAW,
      text: 'Palestra 4 volte a settimana',
    });
    expect(intent.isExplicit).toBeFalsy();
    expect(intent.explicitGoalName).toBeUndefined();
  });
});
