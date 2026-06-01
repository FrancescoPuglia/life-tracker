// src/lib/goalArchitect/compiler.test.ts

import { describe, expect, it } from 'vitest';
import {
  compileGoalArchitectureDraft,
  matchProjectTitle,
  normalizeGoalArchitectAst,
} from './compiler';
import { parseGoalArchitectText } from './parser';

function compileFromText(input: string) {
  return compileGoalArchitectureDraft(
    normalizeGoalArchitectAst(parseGoalArchitectText(input)),
  );
}

describe('matchProjectTitle', () => {
  const projects = [
    {
      id: 'p1',
      title: 'Aperture',
      parentGoalId: 'g',
      taskIds: [],
    },
    {
      id: 'p2',
      title: 'Calcolo e Visualizzazione',
      parentGoalId: 'g',
      taskIds: [],
    },
    {
      id: 'p3',
      title: 'Strategia',
      parentGoalId: 'g',
      taskIds: [],
    },
  ];

  it('returns exact normalized match', () => {
    expect(matchProjectTitle('aperture', projects)?.id).toBe('p1');
    expect(matchProjectTitle('Calcolo e Visualizzazione', projects)?.id).toBe(
      'p2',
    );
  });

  it('falls back to startsWith when unambiguous', () => {
    expect(matchProjectTitle('Calcolo', projects)?.id).toBe('p2');
  });

  it('returns undefined for unknown', () => {
    expect(matchProjectTitle('Nonexistent', projects)).toBeUndefined();
  });

  it('returns undefined when ambiguous', () => {
    const ambiguous = [
      ...projects,
      { id: 'p4', title: 'Apertura', parentGoalId: 'g', taskIds: [] },
    ];
    // 'aper' is a prefix of both 'aperture' and 'apertura'
    expect(matchProjectTitle('aper', ambiguous)).toBeUndefined();
  });
});

describe('compileGoalArchitectureDraft', () => {
  it('compiles parsed AST into a valid draft', () => {
    const draft = compileFromText(
      'Crea il Goal Scacchi. Target date: 31/12/2026. Total hours: 300. Projects: Aperture 70h, Tattica 60h, Strategia 60h, Calcolo e Visualizzazione 80h, Finali 30h. Nel progetto Aperture crea questi task: Catalana 20h critical, Sveshnikov 25h critical, Benko 15h high.',
    );
    expect(draft.goal?.title).toBe('Scacchi');
    expect(draft.projects.length).toBe(5);
    expect(draft.tasks.length).toBe(3);
    expect(draft.status).toBe('valid');
  });

  it('generates deterministic ids', () => {
    const a = compileFromText(
      'Goal: Scacchi. Projects: Aperture 70h. Nel progetto Aperture crea questi task: Catalana 10h.',
    );
    const b = compileFromText(
      'Goal: Scacchi. Projects: Aperture 70h. Nel progetto Aperture crea questi task: Catalana 10h.',
    );
    expect(a.goal?.id).toBe(b.goal?.id);
    expect(a.projects[0].id).toBe(b.projects[0].id);
    expect(a.tasks[0].id).toBe(b.tasks[0].id);
  });

  it('links tasks to projects by exact normalized title', () => {
    const draft = compileFromText(
      'Goal: Scacchi. Projects: Aperture 70h. Nel progetto Aperture crea questi task: Catalana 10h critical.',
    );
    expect(draft.projects[0].taskIds.length).toBe(1);
    expect(draft.tasks[0].parentProjectId).toBe(draft.projects[0].id);
  });

  it('creates a direct task when no projectTitle is provided', () => {
    const draft = compileFromText(
      'Goal: X. Projects: A 10h. Tasks: Generic 5h critical.',
    );
    const direct = draft.tasks.find((t) => t.title === 'Generic');
    expect(direct).toBeDefined();
    expect(direct?.parentProjectId).toBeUndefined();
    expect(draft.goal?.directTaskIds).toContain(direct?.id);
  });

  it('emits an orphan_task warning when task references a missing project', () => {
    const draft = compileFromText(
      'Goal: X. Projects: Real 10h. Nel progetto Phantom crea questi task: Ghost 5h.',
    );
    const orphan = draft.issues.some(
      (i) => i.code === 'orphan_task' && i.severity === 'warning',
    );
    expect(orphan).toBe(true);
  });

  it('populates project.taskIds, goal.projectIds, goal.keyResultIds', () => {
    const draft = compileFromText(
      'Goal: X. Projects: A 10h, B 20h. Nel progetto A crea questi task: Alpha 5h. Key Results: 5 books, 10 sessions.',
    );
    expect(draft.goal?.projectIds.length).toBe(2);
    expect(draft.goal?.keyResultIds.length).toBe(2);
    expect(draft.projects[0].taskIds.length).toBe(1);
  });

  it('integrates the validator and the summary', () => {
    const draft = compileFromText(
      'Goal: Scacchi. Target date: 31/12/2026. Total hours: 300. Projects: Aperture 70h, Tattica 60h, Strategia 60h, Calcolo 80h, Finali 30h.',
    );
    expect(draft.summary.projectCount).toBe(5);
    expect(draft.summary.errorCount).toBe(0);
    expect(draft.summary.canCommit).toBe(true);
  });

  it('marks status as invalid when no goal was identified', () => {
    const draft = compileFromText('Random text without any goal');
    expect(draft.goal).toBeNull();
    expect(draft.status).toBe('invalid');
    expect(draft.summary.canCommit).toBe(false);
  });
});
