// src/lib/goalArchitect/parseGoalArchitecture.test.ts

import { describe, expect, it } from 'vitest';
import { parseGoalArchitecture } from './parseGoalArchitecture';
import {
  createAllGoalArchitectParserInputTexts,
  createChessGoalArchitectInputText,
  createPresenceUpgradeGoalArchitectInputText,
  createWorkGoalArchitectInputText,
} from './parserFixtures';

describe('parseGoalArchitecture — degenerate inputs', () => {
  it('returns an invalid draft for empty input', () => {
    const draft = parseGoalArchitecture('');
    expect(draft.status).toBe('invalid');
    expect(draft.goal).toBeNull();
    expect(draft.issues.some((i) => i.code === 'missing_goal')).toBe(true);
  });

  it('returns an invalid draft for whitespace-only input', () => {
    const draft = parseGoalArchitecture('   \n\t   ');
    expect(draft.status).toBe('invalid');
    expect(draft.goal).toBeNull();
  });

  it('never throws on random text', () => {
    const inputs = [
      'asdfqwerty',
      '!!!',
      'Goal:',
      'Tasks: ,,,;;;',
      '\n\n\n',
      ' Goal:   Test  ',
    ];
    for (const i of inputs) {
      expect(() => parseGoalArchitecture(i)).not.toThrow();
    }
  });
});

describe('parseGoalArchitecture — structured minimal inputs', () => {
  it('parses an Italian structured input', () => {
    const draft = parseGoalArchitecture(
      'Crea il Goal Scacchi. Target date: 31/12/2026. Total hours: 300. Progetti: Aperture 70h, Tattica 60h, Strategia 60h, Calcolo 80h, Finali 30h.',
    );
    expect(draft.goal?.title).toBe('Scacchi');
    expect(draft.goal?.targetHours).toBe(300);
    expect(draft.goal?.dueDateISO).toBe('2026-12-31');
    expect(draft.projects.length).toBe(5);
    expect(draft.summary.canCommit).toBe(true);
  });

  it('parses an English structured input', () => {
    const draft = parseGoalArchitecture(
      'Goal: Chess Mastery. Target date: 2026-12-31. Total hours: 300. Projects: Openings 70h, Tactics 60h, Strategy 60h, Calculation 80h, Endgames 30h.',
    );
    expect(draft.goal?.title).toBe('Chess Mastery');
    expect(draft.projects.length).toBe(5);
    expect(draft.summary.canCommit).toBe(true);
  });

  it('produces deterministic ids for repeated parses', () => {
    const input =
      'Goal: Scacchi. Projects: Aperture 70h. Nel progetto Aperture crea questi task: Catalana 10h.';
    const a = parseGoalArchitecture(input);
    const b = parseGoalArchitecture(input);
    expect(a.goal?.id).toBe(b.goal?.id);
    expect(a.projects[0].id).toBe(b.projects[0].id);
    expect(a.tasks[0].id).toBe(b.tasks[0].id);
  });
});

describe('parseGoalArchitecture — parser fixtures', () => {
  it('parses all five fixture texts into non-empty drafts', () => {
    const inputs = createAllGoalArchitectParserInputTexts();
    for (const [name, text] of Object.entries(inputs)) {
      const draft = parseGoalArchitecture(text);
      expect(draft.goal, `${name} goal`).not.toBeNull();
      expect(draft.projects.length, `${name} projects`).toBeGreaterThanOrEqual(
        4,
      );
    }
  });

  it('Chess fixture exposes Calcolo / Tattica / Aperture / Strategia / Finali', () => {
    const draft = parseGoalArchitecture(createChessGoalArchitectInputText());
    const titles = draft.projects.map((p) => p.title);
    expect(titles).toContain('Calcolo e Visualizzazione');
    expect(titles).toContain('Tattica');
    expect(titles).toContain('Aperture');
    expect(titles).toContain('Strategia');
    expect(titles).toContain('Finali');
  });

  it('Chess fixture binds Catalana / Sveshnikov / Benko under Aperture', () => {
    const draft = parseGoalArchitecture(createChessGoalArchitectInputText());
    const aperture = draft.projects.find((p) => p.title === 'Aperture');
    expect(aperture).toBeDefined();
    const apertureTasks = draft.tasks.filter(
      (t) => t.parentProjectId === aperture?.id,
    );
    const joined = apertureTasks.map((t) => t.title).join(' | ');
    expect(joined).toContain('Catalana');
    expect(joined).toContain('Sveshnikov');
    expect(joined).toContain('Benko');
  });

  it('Work fixture creates the ONU/FAO project verbatim', () => {
    const draft = parseGoalArchitecture(createWorkGoalArchitectInputText());
    const titles = draft.projects.map((p) => p.title);
    const found = titles.find((t) => t.includes('ONU') && t.includes('FAO'));
    expect(found).toBeDefined();
  });

  it('Presence Upgrade fixture surfaces the Paul McKenna task', () => {
    const draft = parseGoalArchitecture(
      createPresenceUpgradeGoalArchitectInputText(),
    );
    const found = draft.tasks.find((t) => /paul\s+mckenna/i.test(t.title));
    expect(found).toBeDefined();
  });

  it('Chess fixture is committable end-to-end', () => {
    const draft = parseGoalArchitecture(createChessGoalArchitectInputText());
    expect(draft.summary.errorCount).toBe(0);
    expect(draft.status).toBe('valid');
    expect(draft.summary.canCommit).toBe(true);
  });
});
