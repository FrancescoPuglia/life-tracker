// src/lib/goalArchitect/parser.ts
// Rule-based parser: natural-language text → GoalArchitectParsedAst.
//
// Strategy:
//   1. Normalize whitespace / quotes / dashes (preserve newlines).
//   2. Find every header occurrence (goal, total-hours, target-date,
//      projects, tasks, key-results, project-task clause) and sort by start.
//   3. For each header, slice the content until the next header (or up to
//      a period/newline for inline headers like goal/total-hours/target-date).
//   4. Extract fields from each item using deterministic tokenizers.
//
// No AI, no fetch, no `any`.

import {
  extractInlineHours,
  extractInlinePriority,
  normalizeInputText,
  normalizeKeyResultUnitToken,
  parseDateToken,
  parseHoursToken,
  removeKnownMetadataFromTitle,
  splitListItems,
} from './normalizer';
import type {
  GoalArchitectParseIssue,
  GoalArchitectParsedAst,
  ParsedGoalNode,
  ParsedKeyResultNode,
  ParsedProjectNode,
  ParsedTaskNode,
} from './parserTypes';

// ============================================================================
// HEADER PATTERNS
// ============================================================================

type HeaderKind =
  | 'goal_inline'
  | 'goal_verb'
  | 'total_hours'
  | 'target_date'
  | 'projects'
  | 'tasks'
  | 'key_results'
  | 'project_tasks';

interface HeaderMatch {
  kind: HeaderKind;
  start: number;
  contentStart: number;
  /** Project title for `project_tasks` clauses; undefined otherwise. */
  projectName?: string;
}

interface HeaderRule {
  kind: HeaderKind;
  regex: RegExp;
  /** Optional capture group whose contents become `projectName`. */
  projectGroup?: number;
}

// All patterns operate on accent-stripped lowercase text — built once.
// `^|[\s.;:!?\-(]` is the manual word boundary that also matches accented
// chars on the left side. `(?=\W|$)` provides the right boundary.
const HEADER_RULES: ReadonlyArray<HeaderRule> = [
  // `goal:` / `obiettivo:` / `objective:`
  {
    kind: 'goal_inline',
    regex: /(?:^|[\s.;:!?])(goal|obiettivo|objective)\s*:\s*/g,
  },
  // `crea il goal NAME` / `crea goal NAME` / `crea obiettivo NAME`
  // `create (a|the) goal NAME` / `create objective NAME`
  {
    kind: 'goal_verb',
    regex:
      /(?:^|[\s.;])(?:crea(?:re)?(?:\s+(?:il|un|nuovo))?\s+(?:goal|obiettivo)|create(?:\s+(?:a|the|new))?\s+(?:goal|objective))\s+/gi,
  },
  // `total hours:` / `ore totali:` / `target hours:` / `monte ore:`
  // `il goal totale deve avere` is a longer verbose form
  {
    kind: 'total_hours',
    regex:
      /(?:^|[\s.;])(?:total\s+hours|ore\s+totali|target\s+hours|monte\s+ore|il\s+goal\s+totale\s+deve\s+avere)\s*:?\s*/g,
  },
  // `target date:` / `scadenza:` / `deadline:` / `due date:`
  {
    kind: 'target_date',
    regex:
      /(?:^|[\s.;])(?:target\s+date|scadenza|deadline|due\s+date|data\s+di\s+scadenza)\s*:?\s*/g,
  },
  // `projects:` / `progetti:` / `i progetti sono:` / `voglio N progetti:`
  {
    kind: 'projects',
    regex:
      /(?:^|[\s.;\n])(?:projects?|progetti|i\s+progetti\s+sono|voglio\s+\d+\s+progetti|i\s+seguenti\s+progetti)\s*:\s*/g,
  },
  // `tasks:` / `task:` / `attività:` — general task list (no project context)
  {
    kind: 'tasks',
    regex: /(?:^|[\s.;\n])(?:tasks?|attivita|attività)\s*:\s*/g,
  },
  // `key results:` / `kr:` / `risultati chiave:` / `okr:`
  {
    kind: 'key_results',
    regex:
      /(?:^|[\s.;\n])(?:key\s+results?|kr|risultati\s+chiave|okr)\s*:\s*/g,
  },
  // `nel progetto <NAME> crea (questi) task[i]:` / `aggiungi i task:`
  // English: `in project <NAME> create tasks:` / `tasks for project <NAME>:`
  {
    kind: 'project_tasks',
    regex:
      /(?:^|[\s.;\n])nel\s+progetto\s+([^\n:]+?)\s+(?:crea(?:re)?|aggiungi|metti)\s+(?:questi\s+|i\s+|gli\s+)?task[ia]?\s*:\s*/gi,
    projectGroup: 1,
  },
  {
    kind: 'project_tasks',
    regex:
      /(?:^|[\s.;\n])in\s+(?:the\s+)?project\s+([^\n:]+?)\s+(?:create|add)\s+(?:these\s+|the\s+)?tasks?\s*:\s*/gi,
    projectGroup: 1,
  },
  {
    kind: 'project_tasks',
    regex:
      /(?:^|[\s.;\n])tasks?\s+for\s+(?:the\s+)?project\s+([^\n:]+?)\s*:\s*/gi,
    projectGroup: 1,
  },
];

const INLINE_HEADER_KINDS: ReadonlySet<HeaderKind> = new Set<HeaderKind>([
  'goal_inline',
  'goal_verb',
  'total_hours',
  'target_date',
]);

// ============================================================================
// PUBLIC API
// ============================================================================

export function parseGoalArchitectText(input: string): GoalArchitectParsedAst {
  const sourceText = typeof input === 'string' ? input : '';
  const normalizedText = normalizeInputText(sourceText);
  const issues: GoalArchitectParseIssue[] = [];

  if (normalizedText.length === 0) {
    issues.push({
      code: 'empty_input',
      severity: 'error',
      message: 'Il testo di input è vuoto.',
    });
    return {
      sourceText,
      normalizedText,
      projects: [],
      tasks: [],
      keyResults: [],
      issues,
      confidence: 0,
    };
  }

  const headers = findAllHeaders(normalizedText);
  const slices = sliceHeaders(normalizedText, headers);

  let goal: ParsedGoalNode | undefined;
  const projects: ParsedProjectNode[] = [];
  const tasks: ParsedTaskNode[] = [];
  const keyResults: ParsedKeyResultNode[] = [];

  for (const s of slices) {
    switch (s.kind) {
      case 'goal_inline':
      case 'goal_verb': {
        const node = buildGoalNode(s.content, s.kind, issues);
        if (node) goal = mergeGoal(goal, node);
        break;
      }
      case 'total_hours': {
        const hours = parseHoursToken(s.content) ?? parseRawNumber(s.content);
        if (hours !== undefined && hours > 0) {
          goal = mergeGoal(goal, {
            confidence: 0.9,
            targetHours: hours,
            sourceText: s.content,
          });
        } else {
          issues.push({
            code: 'unparsed_total_hours',
            severity: 'warning',
            message: `Impossibile interpretare il totale ore: "${s.content}".`,
            segment: s.content,
          });
        }
        break;
      }
      case 'target_date': {
        const iso = parseDateToken(s.content);
        if (iso) {
          goal = mergeGoal(goal, {
            confidence: 0.9,
            dueDateISO: iso,
            sourceText: s.content,
          });
        } else {
          issues.push({
            code: 'unparsed_target_date',
            severity: 'warning',
            message: `Data di scadenza non interpretabile: "${s.content}".`,
            segment: s.content,
          });
        }
        break;
      }
      case 'projects': {
        const items = splitListItems(s.content);
        if (items.length === 0) {
          issues.push({
            code: 'empty_projects_section',
            severity: 'warning',
            message: 'Sezione "Projects" vuota o non interpretabile.',
            segment: s.content,
          });
        }
        for (const raw of items) {
          const proj = buildProjectNode(raw);
          if (proj) projects.push(proj);
        }
        break;
      }
      case 'tasks': {
        const items = splitListItems(s.content);
        for (const raw of items) {
          const t = buildTaskNode(raw, undefined, 0.8);
          if (t) tasks.push(t);
        }
        break;
      }
      case 'project_tasks': {
        const projectName = s.projectName?.trim();
        const items = splitListItems(s.content);
        for (const raw of items) {
          const t = buildTaskNode(raw, projectName, 0.9);
          if (t) tasks.push(t);
        }
        break;
      }
      case 'key_results': {
        const items = splitListItems(s.content);
        for (const raw of items) {
          const kr = buildKeyResultNode(raw);
          if (kr) keyResults.push(kr);
        }
        break;
      }
    }
  }

  if (!goal || !goal.title) {
    issues.push({
      code: 'missing_goal',
      severity: 'error',
      message: 'Nessun Goal identificato nel testo.',
      suggestion: 'Inizia con "Goal: …" oppure "Crea il Goal …".',
    });
  }

  const confidence = computeAstConfidence(goal, projects, tasks, keyResults);

  const ast: GoalArchitectParsedAst = {
    sourceText,
    normalizedText,
    goal,
    projects,
    tasks,
    keyResults,
    issues,
    confidence,
  };
  issues.push(...detectUnparsedSegments(normalizedText, ast));
  return ast;
}

export function parseGoalClause(text: string): ParsedGoalNode | undefined {
  const ast = parseGoalArchitectText(text);
  return ast.goal;
}

export function parseProjectClauses(text: string): ParsedProjectNode[] {
  return parseGoalArchitectText(text).projects;
}

export function parseTaskClauses(text: string): ParsedTaskNode[] {
  return parseGoalArchitectText(text).tasks;
}

export function parseKeyResultClauses(text: string): ParsedKeyResultNode[] {
  return parseGoalArchitectText(text).keyResults;
}

// ============================================================================
// HEADER SCANNING
// ============================================================================

function findAllHeaders(text: string): HeaderMatch[] {
  const matches: HeaderMatch[] = [];
  for (const rule of HEADER_RULES) {
    // Header keywords are ASCII (plus the `attività` variant we list
    // explicitly), so a case-insensitive regex on the original text is
    // enough — running it on a lowercased copy would change indices when
    // unicode normalization expands characters and would force us to
    // capture lowercased project names.
    const flags = rule.regex.flags.includes('i')
      ? rule.regex.flags
      : `${rule.regex.flags}i`;
    const re = new RegExp(rule.regex.source, flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // Avoid zero-length match infinite loop.
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      const start = m.index;
      const contentStart = m.index + m[0].length;
      matches.push({
        kind: rule.kind,
        start,
        contentStart,
        projectName:
          rule.projectGroup !== undefined ? m[rule.projectGroup] : undefined,
      });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  return dedupeOverlapping(matches);
}

/**
 * If two headers overlap (e.g. `tasks:` regex matching inside a
 * `nel progetto X crea task:` clause), keep the earlier-starting one and
 * drop matches whose start lies inside the previous header's content range
 * up to its content start.
 */
function dedupeOverlapping(matches: HeaderMatch[]): HeaderMatch[] {
  const out: HeaderMatch[] = [];
  for (const m of matches) {
    const prev = out[out.length - 1];
    if (prev && m.start < prev.contentStart) continue;
    out.push(m);
  }
  return out;
}

interface HeaderSlice {
  kind: HeaderKind;
  content: string;
  projectName?: string;
}

function sliceHeaders(text: string, headers: HeaderMatch[]): HeaderSlice[] {
  const out: HeaderSlice[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const next = headers[i + 1];
    const endLimit = next ? next.start : text.length;
    let slice = text.slice(h.contentStart, endLimit);
    if (INLINE_HEADER_KINDS.has(h.kind)) {
      const stopIdx = slice.search(/[\.\n]/);
      if (stopIdx >= 0) slice = slice.slice(0, stopIdx);
    }
    out.push({
      kind: h.kind,
      content: slice.trim(),
      projectName: h.projectName,
    });
  }
  return out;
}

// ============================================================================
// NODE BUILDERS
// ============================================================================

function buildGoalNode(
  content: string,
  kind: HeaderKind,
  issues: GoalArchitectParseIssue[],
): ParsedGoalNode | undefined {
  const rawTitle = content.trim();
  if (!rawTitle) {
    issues.push({
      code: 'empty_goal',
      severity: 'warning',
      message: 'Goal segnalato ma senza titolo.',
    });
    return undefined;
  }
  // Goal title may carry inline date or hours — keep title clean.
  const inlineHours = parseHoursToken(rawTitle);
  const inlineDate = parseDateToken(rawTitle);
  const inlinePriority = extractInlinePriority(rawTitle);
  const cleaned = removeKnownMetadataFromTitle(rawTitle);
  return {
    title: cleaned || rawTitle,
    targetHours: inlineHours,
    dueDateISO: inlineDate,
    priority: inlinePriority,
    sourceText: rawTitle,
    confidence: kind === 'goal_inline' ? 0.95 : 0.85,
  };
}

function buildProjectNode(raw: string): ParsedProjectNode | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const hours = extractInlineHours(trimmed);
  const priority = extractInlinePriority(trimmed);
  const date = parseDateToken(trimmed);
  const title = removeKnownMetadataFromTitle(trimmed);
  if (!title) return undefined;
  let confidence = 0.85;
  if (hours === undefined) confidence -= 0.1;
  if (!title.replace(/\W/g, '')) return undefined;
  return {
    title,
    targetHours: hours,
    priority,
    dueDateISO: date,
    sourceText: trimmed,
    confidence: clamp01(confidence),
  };
}

function buildTaskNode(
  raw: string,
  projectTitle: string | undefined,
  baseConfidence: number,
): ParsedTaskNode | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const hours = extractInlineHours(trimmed);
  const priority = extractInlinePriority(trimmed);
  const date = parseDateToken(trimmed);
  const title = removeKnownMetadataFromTitle(trimmed);
  if (!title) return undefined;
  let confidence = baseConfidence;
  if (hours === undefined) confidence -= 0.1;
  if (!projectTitle) confidence -= 0.05;
  return {
    title,
    projectTitle,
    estimatedHours: hours,
    priority,
    dueDateISO: date,
    sourceText: trimmed,
    confidence: clamp01(confidence),
  };
}

const KR_LEADING_VERB_RE =
  /^(?:completare|completa|complete|raggiungere|raggiungi|reach|hit|leggere|leggi|read|fare|do|achieve)\s+/i;
const KR_TRAILING_PERCENT_RE = /(\d+(?:[.,]\d+)?)\s*%/;
const KR_NUMBER_UNIT_RE =
  /(\d+(?:[.,]\d+)?)\s*([A-Za-zÀ-ÿ]+)/;
const KR_BARE_NUMBER_RE = /(\d+(?:[.,]\d+)?)/;

function buildKeyResultNode(raw: string): ParsedKeyResultNode | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  let targetValue: number | undefined;
  let unitToken: string | undefined;

  const pct = trimmed.match(KR_TRAILING_PERCENT_RE);
  if (pct) {
    targetValue = parseFloat(pct[1].replace(',', '.'));
    unitToken = '%';
  } else {
    const nu = trimmed.match(KR_NUMBER_UNIT_RE);
    if (nu) {
      targetValue = parseFloat(nu[1].replace(',', '.'));
      unitToken = nu[2];
    } else {
      const bare = trimmed.match(KR_BARE_NUMBER_RE);
      if (bare) {
        targetValue = parseFloat(bare[1].replace(',', '.'));
      }
    }
  }

  // Title = full item with leading verb stripped (keeps user phrasing).
  const title = trimmed.replace(KR_LEADING_VERB_RE, '').trim() || trimmed;
  let confidence = 0.8;
  if (targetValue === undefined) confidence -= 0.1;
  if (!unitToken) confidence -= 0.1;
  else if (!normalizeKeyResultUnitToken(unitToken)) confidence -= 0.1;
  if (!Number.isFinite(targetValue ?? NaN)) targetValue = undefined;
  return {
    title,
    targetValue,
    unit: unitToken,
    sourceText: trimmed,
    confidence: clamp01(confidence),
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function mergeGoal(
  prev: ParsedGoalNode | undefined,
  next: Partial<ParsedGoalNode> & { confidence: number },
): ParsedGoalNode {
  if (!prev) {
    return {
      confidence: next.confidence,
      title: next.title,
      description: next.description,
      targetHours: next.targetHours,
      dueDateISO: next.dueDateISO,
      priority: next.priority,
      sourceText: next.sourceText,
    };
  }
  return {
    title: next.title ?? prev.title,
    description: next.description ?? prev.description,
    targetHours: next.targetHours ?? prev.targetHours,
    dueDateISO: next.dueDateISO ?? prev.dueDateISO,
    priority: next.priority ?? prev.priority,
    sourceText: prev.sourceText ?? next.sourceText,
    confidence: Math.max(prev.confidence, next.confidence),
  };
}

function parseRawNumber(input: string): number | undefined {
  const m = input.match(/^\s*(\d+(?:[.,]\d+)?)\s*$/);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function computeAstConfidence(
  goal: ParsedGoalNode | undefined,
  projects: ParsedProjectNode[],
  tasks: ParsedTaskNode[],
  keyResults: ParsedKeyResultNode[],
): number {
  const values: number[] = [];
  if (goal) values.push(goal.confidence);
  for (const p of projects) values.push(p.confidence);
  for (const t of tasks) values.push(t.confidence);
  for (const kr of keyResults) values.push(kr.confidence);
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return clamp01(sum / values.length);
}

// ============================================================================
// UNPARSED-SEGMENT DETECTION
// ============================================================================

export function detectUnparsedSegments(
  input: string,
  ast: GoalArchitectParsedAst,
): GoalArchitectParseIssue[] {
  // Cheap heuristic — if no header was found but there's a substantial chunk
  // of text, surface an info issue so reviewers know the parser ignored it.
  if (
    !ast.goal &&
    ast.projects.length === 0 &&
    ast.tasks.length === 0 &&
    ast.keyResults.length === 0 &&
    input.trim().length > 0
  ) {
    return [
      {
        code: 'unparsed_text',
        severity: 'info',
        message: 'Nessuna sezione riconosciuta nel testo.',
        suggestion:
          'Usa intestazioni esplicite come "Goal:", "Projects:", "Tasks:", "Key Results:".',
      },
    ];
  }
  return [];
}
