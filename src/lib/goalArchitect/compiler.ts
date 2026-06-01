// src/lib/goalArchitect/compiler.ts
// AST → typed normalized AST → GoalArchitectureDraft.
//
// The compiler is the seam between the loose parser output and the strict
// domain model in `types.ts`. It is responsible for:
//   • Generating deterministic ids via `createDraftId`.
//   • Resolving task → project links via `matchProjectTitle`.
//   • Running the full validator and surfacing its issues + the parser's.
//   • Producing a consistent `summary` and final `status`.

import { createDraftId, createIssueId, normalizeForId } from './ids';
import {
  normalizeKeyResultUnitToken,
  normalizePriorityToken,
  parseDateToken,
} from './normalizer';
import { calculateGoalArchitectureSummary } from './summary';
import {
  GOAL_ARCHITECT_DRAFT_VERSION,
  type GoalArchitectIssue,
  type GoalArchitectureDraft,
  type GoalDraft,
  type KeyResultDraft,
  type KeyResultUnit,
  type ProjectDraft,
  type TaskDraft,
} from './types';
import {
  validateGoalArchitectureDraft,
  isValidISODate,
} from './validation';
import type {
  GoalArchitectParseIssue,
  GoalArchitectParsedAst,
  NormalizedGoalArchitectAst,
  NormalizedGoalNode,
  NormalizedKeyResultNode,
  NormalizedProjectNode,
  NormalizedTaskNode,
} from './parserTypes';

// ============================================================================
// AST → NORMALIZED AST
// ============================================================================

export function normalizeGoalArchitectAst(
  ast: GoalArchitectParsedAst,
): NormalizedGoalArchitectAst {
  const issues = [...ast.issues];
  const goal = ast.goal ? normalizeGoal(ast.goal.title, ast.goal, issues) : undefined;
  const projects = ast.projects.map((p) => normalizeProject(p, issues));
  const tasks = ast.tasks.map((t) => normalizeTask(t, issues));
  const keyResults = ast.keyResults.map((kr) => normalizeKeyResult(kr, issues));
  return {
    sourceText: ast.sourceText,
    normalizedText: ast.normalizedText,
    goal,
    projects,
    tasks,
    keyResults,
    issues,
    confidence: ast.confidence,
  };
}

function normalizeGoal(
  title: string | undefined,
  raw: GoalArchitectParsedAst['goal'],
  issues: GoalArchitectParseIssue[],
): NormalizedGoalNode {
  const r = raw ?? { confidence: 0 };
  const priority = normalizePriorityToken(r.priority);
  if (r.priority && !priority) {
    issues.push({
      code: 'invalid_priority',
      severity: 'warning',
      message: `Priorità Goal non riconosciuta: "${r.priority}".`,
    });
  }
  let dueDateISO = r.dueDateISO;
  if (dueDateISO && !isValidISODate(dueDateISO)) {
    const reparsed = parseDateToken(dueDateISO);
    if (reparsed) dueDateISO = reparsed;
    else {
      issues.push({
        code: 'invalid_due_date',
        severity: 'warning',
        message: `Data Goal non interpretabile: "${dueDateISO}".`,
      });
      dueDateISO = undefined;
    }
  }
  return {
    title,
    description: r.description,
    targetHours: validHours(r.targetHours),
    dueDateISO,
    priority,
    sourceText: r.sourceText,
    confidence: r.confidence,
  };
}

function normalizeProject(
  raw: GoalArchitectParsedAst['projects'][number],
  issues: GoalArchitectParseIssue[],
): NormalizedProjectNode {
  const priority = normalizePriorityToken(raw.priority);
  if (raw.priority && !priority) {
    issues.push({
      code: 'invalid_priority',
      severity: 'warning',
      message: `Priorità Project non riconosciuta: "${raw.priority}".`,
      segment: raw.sourceText,
    });
  }
  let dueDateISO = raw.dueDateISO;
  if (dueDateISO && !isValidISODate(dueDateISO)) {
    const reparsed = parseDateToken(dueDateISO);
    dueDateISO = reparsed;
  }
  return {
    title: raw.title,
    targetHours: validHours(raw.targetHours),
    dueDateISO,
    priority,
    sourceText: raw.sourceText,
    confidence: raw.confidence,
  };
}

function normalizeTask(
  raw: GoalArchitectParsedAst['tasks'][number],
  issues: GoalArchitectParseIssue[],
): NormalizedTaskNode {
  const priority = normalizePriorityToken(raw.priority);
  if (raw.priority && !priority) {
    issues.push({
      code: 'invalid_priority',
      severity: 'warning',
      message: `Priorità Task non riconosciuta: "${raw.priority}".`,
      segment: raw.sourceText,
    });
  }
  let dueDateISO = raw.dueDateISO;
  if (dueDateISO && !isValidISODate(dueDateISO)) {
    const reparsed = parseDateToken(dueDateISO);
    dueDateISO = reparsed;
  }
  return {
    title: raw.title,
    projectTitle: raw.projectTitle,
    estimatedHours: validHours(raw.estimatedHours),
    dueDateISO,
    priority,
    sourceText: raw.sourceText,
    confidence: raw.confidence,
  };
}

function normalizeKeyResult(
  raw: GoalArchitectParsedAst['keyResults'][number],
  issues: GoalArchitectParseIssue[],
): NormalizedKeyResultNode {
  const unit: KeyResultUnit | undefined = normalizeKeyResultUnitToken(raw.unit);
  const customUnit = !unit && raw.unit ? raw.unit : undefined;
  if (raw.unit && !unit) {
    issues.push({
      code: 'unsupported_kr_unit',
      severity: 'info',
      message: `Unità Key Result non riconosciuta: "${raw.unit}" — verrà preservata come custom.`,
      segment: raw.sourceText,
    });
  }
  return {
    title: raw.title,
    targetValue: validHours(raw.targetValue),
    currentValue: validHours(raw.currentValue),
    unit: unit ?? (customUnit ? 'custom' : undefined),
    customUnit,
    sourceText: raw.sourceText,
    confidence: raw.confidence,
  };
}

function validHours(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  if (value < 0) return undefined;
  return value;
}

// ============================================================================
// PROJECT TITLE MATCHER
// ============================================================================

export function matchProjectTitle(
  projectTitle: string,
  projects: ReadonlyArray<ProjectDraft>,
): ProjectDraft | undefined {
  if (!projectTitle) return undefined;
  const target = normalizeForId(projectTitle);
  if (target.length === 0) return undefined;

  const exact = projects.filter((p) => normalizeForId(p.title) === target);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;

  const startsWith = projects.filter((p) => {
    const norm = normalizeForId(p.title);
    return norm.startsWith(target) || target.startsWith(norm);
  });
  if (startsWith.length === 1) return startsWith[0];

  const contains = projects.filter((p) =>
    normalizeForId(p.title).includes(target),
  );
  if (contains.length === 1) return contains[0];

  return undefined;
}

// ============================================================================
// COMPILE NORMALIZED AST → DRAFT
// ============================================================================

const COMPILER_CREATED_AT_ISO = '2026-01-01T00:00:00.000Z';

export interface CompileOptions {
  /** Override the creation/update timestamp — default keeps ids deterministic. */
  nowISO?: string;
}

export function compileGoalArchitectureDraft(
  ast: NormalizedGoalArchitectAst,
  options: CompileOptions = {},
): GoalArchitectureDraft {
  const nowISO = options.nowISO ?? COMPILER_CREATED_AT_ISO;
  const goalTitle = ast.goal?.title ?? 'Untitled Goal';
  const goalId = ast.goal?.title ? createDraftId('goal', ast.goal.title) : '';
  const draftId = createDraftId('goal', `${goalTitle}__architecture`);

  const compilerIssues: GoalArchitectIssue[] = [];

  // ----- PROJECTS -------------------------------------------------------------
  const projects: ProjectDraft[] = ast.projects.map((p) => ({
    id: createDraftId('project', p.title, goalId || undefined),
    title: p.title,
    targetHours: p.targetHours,
    dueDateISO: p.dueDateISO,
    priority: p.priority,
    parentGoalId: goalId,
    taskIds: [],
    sourceText: p.sourceText,
    confidence: { overall: p.confidence },
  }));

  // ----- TASKS ----------------------------------------------------------------
  const tasks: TaskDraft[] = [];
  for (const t of ast.tasks) {
    let parentProjectId: string | undefined;
    if (t.projectTitle) {
      const match = matchProjectTitle(t.projectTitle, projects);
      if (match) {
        parentProjectId = match.id;
      } else {
        compilerIssues.push({
          id: createIssueId('orphan_task', undefined, 'parentProjectId'),
          code: 'orphan_task',
          severity: 'warning',
          entityKind: 'task',
          field: 'parentProjectId',
          message: `Task '${t.title}' menziona il progetto '${t.projectTitle}' ma non è stato trovato.`,
          suggestion: 'Verifica che il nome del Project corrisponda esattamente.',
        });
      }
    }
    const id = createDraftId(
      'task',
      t.title,
      parentProjectId ?? (goalId || undefined),
    );
    const task: TaskDraft = {
      id,
      title: t.title,
      estimatedHours: t.estimatedHours,
      dueDateISO: t.dueDateISO,
      priority: t.priority,
      parentGoalId: goalId,
      parentProjectId,
      sourceText: t.sourceText,
      confidence: { overall: t.confidence },
    };
    tasks.push(task);
    if (parentProjectId) {
      const proj = projects.find((p) => p.id === parentProjectId);
      if (proj) proj.taskIds.push(id);
    }
  }

  // ----- KEY RESULTS ----------------------------------------------------------
  const keyResults: KeyResultDraft[] = ast.keyResults.map((kr) => ({
    id: createDraftId('key_result', kr.title, goalId || undefined),
    title: kr.title,
    targetValue: kr.targetValue,
    currentValue: kr.currentValue ?? 0,
    unit: kr.unit,
    customUnit: kr.customUnit,
    parentGoalId: goalId,
    sourceText: kr.sourceText,
    confidence: { overall: kr.confidence },
  }));

  // ----- GOAL -----------------------------------------------------------------
  const goal: GoalDraft | null = ast.goal?.title
    ? {
        id: goalId,
        title: ast.goal.title,
        description: ast.goal.description,
        targetHours: ast.goal.targetHours,
        dueDateISO: ast.goal.dueDateISO,
        priority: ast.goal.priority,
        projectIds: projects.map((p) => p.id),
        directTaskIds: tasks.filter((t) => !t.parentProjectId).map((t) => t.id),
        keyResultIds: keyResults.map((kr) => kr.id),
        sourceText: ast.goal.sourceText,
        confidence: { overall: ast.goal.confidence },
      }
    : null;

  // ----- DRAFT SHELL ----------------------------------------------------------
  const shell: GoalArchitectureDraft = {
    id: draftId,
    version: GOAL_ARCHITECT_DRAFT_VERSION,
    status: 'draft',
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
    sourceText: ast.sourceText,
    goal,
    projects,
    tasks,
    keyResults,
    issues: [],
    summary: emptySummary(),
    confidence: { overall: ast.confidence },
  };

  // ----- VALIDATE + MERGE ISSUES ---------------------------------------------
  const validation = validateGoalArchitectureDraft(shell);
  const parserIssues = convertParseIssues(ast.issues);
  const mergedIssues = dedupeIssues([
    ...validation.issues,
    ...compilerIssues,
    ...parserIssues,
  ]);
  const summary = calculateGoalArchitectureSummary(shell, {
    issues: mergedIssues,
  });
  const status: GoalArchitectureDraft['status'] = !goal
    ? 'invalid'
    : summary.errorCount > 0
      ? 'invalid'
      : 'valid';

  return {
    ...shell,
    status,
    issues: mergedIssues,
    summary,
  };
}

function emptySummary(): GoalArchitectureDraft['summary'] {
  return {
    goalCount: 0,
    projectCount: 0,
    taskCount: 0,
    keyResultCount: 0,
    totalProjectTargetHours: 0,
    totalTaskEstimatedHours: 0,
    orphanTaskCount: 0,
    orphanKeyResultCount: 0,
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
    isStructurallyValid: false,
    canCommit: false,
  };
}

const PARSE_TO_DOMAIN_CODE: Record<string, GoalArchitectIssue['code']> = {
  missing_goal: 'missing_goal',
  empty_input: 'missing_goal',
  unparsed_target_date: 'invalid_due_date',
  unparsed_total_hours: 'invalid_hours',
  invalid_priority: 'invalid_priority',
  invalid_due_date: 'invalid_due_date',
  unsupported_kr_unit: 'unsupported_field',
  empty_projects_section: 'inconsistent_structure',
  empty_goal: 'missing_title',
  unparsed_text: 'inconsistent_structure',
};

function convertParseIssues(
  parseIssues: ReadonlyArray<GoalArchitectParseIssue>,
): GoalArchitectIssue[] {
  const out: GoalArchitectIssue[] = [];
  for (const pi of parseIssues) {
    const code = PARSE_TO_DOMAIN_CODE[pi.code] ?? 'inconsistent_structure';
    out.push({
      id: createIssueId(code, undefined, pi.code),
      code,
      severity: pi.severity,
      message: pi.message,
      suggestion: pi.suggestion,
    });
  }
  return out;
}

/**
 * Two issues are duplicates when they share `code`, `severity`, `entityId`
 * and `field`. The first occurrence wins so the validator's authoritative
 * message survives over a parser-side rewording.
 */
function dedupeIssues(issues: ReadonlyArray<GoalArchitectIssue>): GoalArchitectIssue[] {
  const seen = new Set<string>();
  const out: GoalArchitectIssue[] = [];
  for (const i of issues) {
    const key = `${i.code}|${i.severity}|${i.entityId ?? ''}|${i.field ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}
