// src/lib/goalArchitect/parser.test.ts

import { describe, expect, it } from 'vitest';
import { parseGoalArchitectText } from './parser';

describe('parseGoalArchitectText — goal headers', () => {
  it('parses "Goal: NAME"', () => {
    const ast = parseGoalArchitectText('Goal: Scacchi — Chess Mastery.');
    expect(ast.goal?.title).toBe('Scacchi - Chess Mastery');
    expect(ast.goal?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('parses "Crea il Goal NAME"', () => {
    const ast = parseGoalArchitectText('Crea il Goal Model Physique.');
    expect(ast.goal?.title).toBe('Model Physique');
  });

  it('parses "Obiettivo: NAME"', () => {
    const ast = parseGoalArchitectText('Obiettivo: Lavoro — Career Command 2026.');
    expect(ast.goal?.title).toContain('Lavoro');
  });
});

describe('parseGoalArchitectText — projects', () => {
  it('parses comma-separated projects with hours', () => {
    const input = 'Goal: Test. Projects: A 10h, B 20h, C 30h.';
    const ast = parseGoalArchitectText(input);
    expect(ast.projects.map((p) => p.title)).toEqual(['A', 'B', 'C']);
    expect(ast.projects.map((p) => p.targetHours)).toEqual([10, 20, 30]);
  });

  it('lowers confidence when hours are missing', () => {
    const input = 'Goal: Test. Projects: A, B, C.';
    const ast = parseGoalArchitectText(input);
    expect(ast.projects.length).toBe(3);
    for (const p of ast.projects) {
      expect(p.targetHours).toBeUndefined();
      expect(p.confidence).toBeLessThan(0.85);
    }
  });

  it('parses bullet-style project list and preserves embedded commas', () => {
    const input = [
      'Goal: Lavoro',
      'Projects:',
      '- Career Command Center 40h',
      '- ONU, FAO, WFP, IFAD, UNV, UNOPS 60h',
    ].join('\n');
    const ast = parseGoalArchitectText(input);
    expect(ast.projects.map((p) => p.title)).toEqual([
      'Career Command Center',
      'ONU, FAO, WFP, IFAD, UNV, UNOPS',
    ]);
  });
});

describe('parseGoalArchitectText — tasks', () => {
  it('parses tasks under a specific project', () => {
    const input = [
      'Goal: Scacchi',
      'Projects: Aperture 70h',
      'Nel progetto Aperture crea questi task: Catalana 10h critical, Sveshnikov 15h critical, Benko 10h high.',
    ].join('\n');
    const ast = parseGoalArchitectText(input);
    expect(ast.tasks.length).toBe(3);
    expect(ast.tasks.map((t) => t.title)).toEqual([
      'Catalana',
      'Sveshnikov',
      'Benko',
    ]);
    expect(ast.tasks.every((t) => t.projectTitle === 'Aperture')).toBe(true);
    expect(ast.tasks.map((t) => t.priority)).toEqual([
      'critical',
      'critical',
      'high',
    ]);
  });

  it('parses an English project-task clause', () => {
    const input = [
      'Goal: Chess',
      'Projects: Openings',
      'In project Openings create tasks: Catalan 10h critical, Sicilian 15h high.',
    ].join('\n');
    const ast = parseGoalArchitectText(input);
    expect(ast.tasks.length).toBe(2);
    expect(ast.tasks.every((t) => t.projectTitle === 'Openings')).toBe(true);
  });

  it('parses a top-level Tasks: list', () => {
    const input = 'Goal: X. Tasks: Alpha 5h, Beta 6h critical.';
    const ast = parseGoalArchitectText(input);
    expect(ast.tasks.map((t) => t.title)).toEqual(['Alpha', 'Beta']);
    expect(ast.tasks[0].estimatedHours).toBe(5);
    expect(ast.tasks[1].priority).toBe('critical');
  });
});

describe('parseGoalArchitectText — key results', () => {
  it('parses KR with number + unit', () => {
    const input = 'Goal: X. Key Results: Read 5 books, Complete 10 courses, reach 80%.';
    const ast = parseGoalArchitectText(input);
    expect(ast.keyResults.length).toBe(3);
    expect(ast.keyResults[0].targetValue).toBe(5);
    expect(ast.keyResults[0].unit).toBe('books');
    expect(ast.keyResults[1].targetValue).toBe(10);
    expect(ast.keyResults[1].unit).toBe('courses');
    expect(ast.keyResults[2].targetValue).toBe(80);
    expect(ast.keyResults[2].unit).toBe('%');
  });

  it('parses Italian KR with verb prefix', () => {
    const input =
      'Goal: Scacchi. KR: completare 20 giorni Cognitive Chess Training, completare 100 studi, raggiungere 2100 Elo.';
    const ast = parseGoalArchitectText(input);
    expect(ast.keyResults.length).toBe(3);
    expect(ast.keyResults[0].targetValue).toBe(20);
    expect(ast.keyResults[1].targetValue).toBe(100);
    expect(ast.keyResults[2].targetValue).toBe(2100);
  });

  it('lowers confidence when unit is missing', () => {
    const input = 'Goal: X. KR: raggiungere 2100 Elo.';
    const ast = parseGoalArchitectText(input);
    expect(ast.keyResults.length).toBe(1);
    expect(ast.keyResults[0].targetValue).toBe(2100);
    // Elo is not a known unit alias.
    expect(ast.keyResults[0].confidence).toBeLessThan(0.8);
  });
});

describe('parseGoalArchitectText — global metadata', () => {
  it('extracts target date and total hours into the goal', () => {
    const input =
      'Crea il Goal Scacchi. Target date: 31/12/2026. Total hours: 300.';
    const ast = parseGoalArchitectText(input);
    expect(ast.goal?.title).toBe('Scacchi');
    expect(ast.goal?.dueDateISO).toBe('2026-12-31');
    expect(ast.goal?.targetHours).toBe(300);
  });

  it('survives without total hours / target date', () => {
    const ast = parseGoalArchitectText('Goal: Scacchi.');
    expect(ast.goal?.title).toBe('Scacchi');
    expect(ast.goal?.targetHours).toBeUndefined();
    expect(ast.goal?.dueDateISO).toBeUndefined();
  });

  it('does not crash on a second total hours mention', () => {
    const input =
      'Goal: X. Total hours: 100. Total hours: 200.'; // ambiguous — last wins or first wins, just must not throw
    expect(() => parseGoalArchitectText(input)).not.toThrow();
  });
});

describe('parseGoalArchitectText — degenerate inputs', () => {
  it('returns an empty-input issue for empty string', () => {
    const ast = parseGoalArchitectText('');
    expect(ast.issues.some((i) => i.code === 'empty_input')).toBe(true);
    expect(ast.goal).toBeUndefined();
  });

  it('reports missing_goal when text has no goal header', () => {
    const ast = parseGoalArchitectText('Just some random sentence.');
    expect(ast.issues.some((i) => i.code === 'missing_goal')).toBe(true);
  });

  it('never throws on random text', () => {
    const inputs = [
      'asdf',
      '{}{}{}{}',
      '...',
      '\n\n\n',
      'Goal:',
      'Tasks: ,,, ;;; ',
    ];
    for (const i of inputs) {
      expect(() => parseGoalArchitectText(i)).not.toThrow();
    }
  });

  it('reports unparsed_text info when nothing is recognized', () => {
    const ast = parseGoalArchitectText('giornata pioggia caffe lunedi');
    expect(ast.issues.some((i) => i.code === 'unparsed_text')).toBe(true);
  });
});
