// src/lib/goalArchitect/parseGoalArchitecture.ts
// Public facade: natural-language string → GoalArchitectureDraft.
//
// Pipeline: parse → normalize → compile → validate. Never throws — any
// unexpected internal error becomes an `inconsistent_structure` issue on an
// otherwise-empty invalid draft, so callers in the UI can always render
// something safe.

import {
  compileGoalArchitectureDraft,
  normalizeGoalArchitectAst,
} from './compiler';
import { createDraftId, createIssueId } from './ids';
import { parseGoalArchitectText } from './parser';
import { calculateGoalArchitectureSummary } from './summary';
import {
  GOAL_ARCHITECT_DRAFT_VERSION,
  type GoalArchitectureDraft,
} from './types';

const FALLBACK_TIMESTAMP_ISO = '2026-01-01T00:00:00.000Z';

export function parseGoalArchitecture(input: string): GoalArchitectureDraft {
  try {
    const ast = parseGoalArchitectText(input);
    const normalized = normalizeGoalArchitectAst(ast);
    return compileGoalArchitectureDraft(normalized);
  } catch (err) {
    return buildErrorDraft(input, err);
  }
}

function buildErrorDraft(input: string, err: unknown): GoalArchitectureDraft {
  const message =
    err instanceof Error ? err.message : 'Errore sconosciuto durante il parsing.';
  const shell: GoalArchitectureDraft = {
    id: createDraftId('goal', 'parse-error'),
    version: GOAL_ARCHITECT_DRAFT_VERSION,
    status: 'invalid',
    createdAtISO: FALLBACK_TIMESTAMP_ISO,
    updatedAtISO: FALLBACK_TIMESTAMP_ISO,
    sourceText: typeof input === 'string' ? input : '',
    goal: null,
    projects: [],
    tasks: [],
    keyResults: [],
    issues: [
      {
        id: createIssueId('inconsistent_structure', undefined, 'parser'),
        code: 'inconsistent_structure',
        severity: 'error',
        message: `Errore interno del parser: ${message}`,
      },
    ],
    summary: {
      goalCount: 0,
      projectCount: 0,
      taskCount: 0,
      keyResultCount: 0,
      totalProjectTargetHours: 0,
      totalTaskEstimatedHours: 0,
      orphanTaskCount: 0,
      orphanKeyResultCount: 0,
      errorCount: 1,
      warningCount: 0,
      infoCount: 0,
      isStructurallyValid: false,
      canCommit: false,
    },
    confidence: { overall: 0 },
  };
  shell.summary = calculateGoalArchitectureSummary(shell, {
    issues: shell.issues,
  });
  return shell;
}
