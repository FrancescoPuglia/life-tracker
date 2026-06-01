// src/lib/goalArchitect/fixtures.test.ts

import { describe, expect, it } from 'vitest';
import {
  createAllGoalArchitectFixtures,
  createChessGoalDraftFixture,
  createIntelligenceEngineGoalDraftFixture,
  createModelPhysiqueGoalDraftFixture,
  createPresenceUpgradeGoalDraftFixture,
  createWorkGoalDraftFixture,
} from './fixtures';
import { validateGoalArchitectureDraft } from './validation';
import type { GoalArchitectureDraft } from './types';

const FIXTURES: Array<{
  name: string;
  build: () => GoalArchitectureDraft;
}> = [
  { name: 'work', build: createWorkGoalDraftFixture },
  { name: 'chess', build: createChessGoalDraftFixture },
  { name: 'modelPhysique', build: createModelPhysiqueGoalDraftFixture },
  { name: 'intelligenceEngine', build: createIntelligenceEngineGoalDraftFixture },
  { name: 'presenceUpgrade', build: createPresenceUpgradeGoalDraftFixture },
];

describe('Goal Architect fixtures', () => {
  it.each(FIXTURES)('builds the $name fixture', ({ build }) => {
    const draft = build();
    expect(draft.goal).not.toBeNull();
    expect(draft.projects.length).toBeGreaterThanOrEqual(1);
    expect(draft.tasks.length).toBeGreaterThanOrEqual(1);
    expect(draft.keyResults.length).toBeGreaterThanOrEqual(2);
  });

  it.each(FIXTURES)('produces deterministic ids for $name', ({ build }) => {
    const a = build();
    const b = build();
    expect(a.goal?.id).toBe(b.goal?.id);
    expect(a.projects.map((p) => p.id)).toEqual(b.projects.map((p) => p.id));
    expect(a.tasks.map((t) => t.id)).toEqual(b.tasks.map((t) => t.id));
  });

  it.each(FIXTURES)('passes validation without errors for $name', ({ build }) => {
    const result = validateGoalArchitectureDraft(build());
    expect(result.summary.errorCount).toBe(0);
    expect(result.canCommit).toBe(true);
    expect(result.status).toBe('valid');
  });

  it.each(FIXTURES)('summary counts match draft contents for $name', ({ build }) => {
    const draft = build();
    expect(draft.summary.goalCount).toBe(1);
    expect(draft.summary.projectCount).toBe(draft.projects.length);
    expect(draft.summary.taskCount).toBe(draft.tasks.length);
    expect(draft.summary.keyResultCount).toBe(draft.keyResults.length);
  });

  it('createAllGoalArchitectFixtures returns all five drafts', () => {
    const suite = createAllGoalArchitectFixtures();
    expect(Object.keys(suite).sort()).toEqual(
      ['chess', 'intelligenceEngine', 'modelPhysique', 'presenceUpgrade', 'work'].sort(),
    );
    expect(suite.work.goal?.title).toContain('LAVORO');
    expect(suite.chess.goal?.title).toContain('SCACCHI');
    expect(suite.modelPhysique.goal?.title).toContain('MODEL PHYSIQUE');
    expect(suite.intelligenceEngine.goal?.title).toContain('INTELLIGENCE ENGINE');
    expect(suite.presenceUpgrade.goal?.title).toContain('PRESENCE UPGRADE');
  });

  it('chess fixture exposes the 5 expected projects', () => {
    const draft = createChessGoalDraftFixture();
    const titles = draft.projects.map((p) => p.title);
    expect(titles).toEqual([
      'Calcolo e Visualizzazione',
      'Tattica',
      'Aperture',
      'Strategia',
      'Finali',
    ]);
  });

  it('chess fixture has Catalana / Sveshnikov / Benko under Aperture', () => {
    const draft = createChessGoalDraftFixture();
    const aperture = draft.projects.find((p) => p.title === 'Aperture');
    expect(aperture).toBeDefined();
    const apertureTasks = draft.tasks.filter(
      (t) => t.parentProjectId === aperture?.id,
    );
    const taskTitles = apertureTasks.map((t) => t.title).join(' | ');
    expect(taskTitles).toContain('Catalana');
    expect(taskTitles).toContain('Sveshnikov');
    expect(taskTitles).toContain('Benko');
  });
});
