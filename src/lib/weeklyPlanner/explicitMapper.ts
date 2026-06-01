// src/lib/weeklyPlanner/explicitMapper.ts
// Deterministic explicit Goal/Project/Task resolver.
//
// When a weekly-intent line uses the explicit markers — e.g.
//   "Martedì 08:00-08:10 Goal DOMINARE LA MATTINA Project Risveglio ...
//    Task Bere acqua calda con limone e sale rosa"
// — we must NOT fall back to fuzzy keyword matching (which leaks chess
// tactical blocks into physical training, careers into the wrong task, etc).
// Instead we resolve each level strictly and scope every search to the parent
// that already resolved: project only inside the matched goal, task only
// inside the matched project. A miss surfaces the precise level that failed
// (unresolved_goal / unresolved_project / unresolved_task) with close
// candidates — never a wrong fallback.
//
// No DB, no AI, no `any`, no new dependencies.

import type {
  ExplicitMappingInfo,
  GoalLike,
  GoalMappingCandidate,
  MappingStatus,
  ParsedIntent,
  ProjectLike,
  TaskLike,
} from './types';

// ============================================================================
// SYNTAX EXTRACTION
// ============================================================================

export interface ExplicitEntityNames {
  /** Everything before the `Goal` marker (day + time + optional title). */
  prefix: string;
  goalName: string;
  projectName?: string;
  taskName?: string;
}

interface MarkerHit {
  kind: 'goal' | 'project' | 'task';
  markerStart: number;
  valueStart: number;
}

// A marker is the word goal/project/task, optionally followed by `:`. We also
// strip surrounding bracket/pipe punctuation up front so the three supported
// forms collapse to one shape:
//   1) Goal X Project Y Task Z
//   2) Goal: X | Project: Y | Task: Z
//   3) [Goal: X] [Project: Y] [Task: Z]
const MARKER_RE = /\b(goal|project|task)\b\s*:?\s*/gi;

/**
 * Returns the explicit Goal/Project/Task names if the segment uses explicit
 * syntax, otherwise null. A line is "explicit" iff it contains a `Goal`
 * marker — that is the deliberate opt-in token.
 */
export function extractExplicitEntities(
  segment: string,
): ExplicitEntityNames | null {
  // Normalize bracket/pipe punctuation to plain whitespace so all three
  // supported syntaxes reduce to "Goal X Project Y Task Z". Index alignment
  // with the original is preserved because we replace char-for-char.
  const normalized = segment.replace(/[[\]|]/g, ' ');

  const hits: MarkerHit[] = [];
  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(normalized)) !== null) {
    const raw = m[1].toLowerCase();
    const kind: MarkerHit['kind'] =
      raw === 'goal' ? 'goal' : raw === 'project' ? 'project' : 'task';
    hits.push({
      kind,
      markerStart: m.index,
      valueStart: m.index + m[0].length,
    });
  }

  const goal = hits.find((h) => h.kind === 'goal');
  if (!goal) return null;

  const project = hits.find(
    (h) => h.kind === 'project' && h.markerStart >= goal.valueStart,
  );
  const projectStart = project?.valueStart ?? goal.valueStart;
  const task = hits.find(
    (h) => h.kind === 'task' && h.markerStart >= projectStart,
  );

  const goalEnd = project
    ? project.markerStart
    : task
      ? task.markerStart
      : normalized.length;
  const goalName = normalized.slice(goal.valueStart, goalEnd).trim();
  if (!goalName) return null;

  let projectName: string | undefined;
  if (project) {
    const projEnd = task ? task.markerStart : normalized.length;
    projectName = normalized.slice(project.valueStart, projEnd).trim() || undefined;
  }

  let taskName: string | undefined;
  if (task) {
    taskName = normalized.slice(task.valueStart).trim() || undefined;
  }

  const prefix = normalized.slice(0, goal.markerStart).trim();

  return { prefix, goalName, projectName, taskName };
}

// ============================================================================
// ENTITY RESOLUTION
// ============================================================================

/**
 * Resolve an explicit ParsedIntent (intent.isExplicit === true) into a
 * deterministic mapping. Scopes project search to the matched goal and task
 * search to the matched project — no cross-goal fallback is ever possible.
 */
export function resolveExplicitMapping(
  intent: ParsedIntent,
  goals: ReadonlyArray<GoalLike>,
  projects: ReadonlyArray<ProjectLike>,
  tasks: ReadonlyArray<TaskLike>,
): GoalMappingCandidate {
  const reqGoal = intent.explicitGoalName ?? '';
  const reqProject = intent.explicitProjectName;
  const reqTask = intent.explicitTaskName;

  const info: ExplicitMappingInfo = {
    requestedGoal: reqGoal || undefined,
    requestedProject: reqProject,
    requestedTask: reqTask,
    goalMatched: false,
    projectMatched: false,
    taskMatched: false,
  };

  // ---- 1) Goal -----------------------------------------------------------
  const goalMatch = resolveEntity(reqGoal, goals);
  if (!goalMatch) {
    info.goalCandidates = goals.map((g) => g.title);
    return explicitCandidate({
      intent,
      status: 'unresolved_goal',
      reason: `Goal esplicito "${reqGoal}" non trovato`,
      info,
    });
  }
  info.goalMatched = true;
  info.matchedGoalTitle = goalMatch.title;
  const goalId = goalMatch.id;

  // Goal-only explicit line → map at the goal level.
  if (!reqProject) {
    return explicitCandidate({
      intent,
      status: 'mapped',
      goalId,
      reason: 'Explicit Goal mapping',
      info,
    });
  }

  // ---- 2) Project (scoped to the matched goal) ---------------------------
  const goalProjects = projects.filter((p) => p.goalId === goalId);
  const projectMatch = resolveEntity(reqProject, goalProjects);
  if (!projectMatch) {
    info.projectCandidates = goalProjects.map((p) => p.title);
    return explicitCandidate({
      intent,
      status: 'unresolved_project',
      goalId,
      reason: `Project esplicito "${reqProject}" non trovato nel goal "${goalMatch.title}"`,
      info,
    });
  }
  info.projectMatched = true;
  info.matchedProjectTitle = projectMatch.title;
  const projectId = projectMatch.id;

  // Goal+Project explicit line → map at the project level.
  if (!reqTask) {
    return explicitCandidate({
      intent,
      status: 'mapped',
      goalId,
      projectId,
      reason: 'Explicit Goal/Project mapping',
      info,
    });
  }

  // ---- 3) Task (scoped to the matched project) ---------------------------
  const projectTasks = tasks.filter((t) => t.projectId === projectId);
  const taskMatch = resolveEntity(reqTask, projectTasks);
  if (!taskMatch) {
    info.taskCandidates = projectTasks.map((t) => t.title);
    return explicitCandidate({
      intent,
      status: 'unresolved_task',
      goalId,
      projectId,
      reason: `Task esplicito "${reqTask}" non trovato nel project "${projectMatch.title}"`,
      info,
    });
  }
  info.taskMatched = true;
  info.matchedTaskTitle = taskMatch.title;

  return explicitCandidate({
    intent,
    status: 'mapped',
    goalId,
    projectId,
    taskId: taskMatch.id,
    reason: 'Explicit Goal/Project/Task mapping',
    info,
  });
}

// ============================================================================
// MATCHING PRIMITIVES
// ============================================================================

interface NamedEntity {
  id: string;
  title: string;
}

/**
 * Match `query` against a set of entities by normalized title. Tiers, in
 * priority order: exact > prefix (either direction) > substring (either
 * direction). The best non-empty tier must contain exactly one entity to be
 * accepted; ambiguity (>1) returns null rather than guessing.
 */
function resolveEntity<T extends NamedEntity>(
  query: string,
  entities: ReadonlyArray<T>,
): T | null {
  const q = normalizeName(query);
  if (!q) return null;

  const exact: T[] = [];
  const prefix: T[] = [];
  const contains: T[] = [];

  for (const e of entities) {
    const t = normalizeName(e.title);
    if (!t) continue;
    if (t === q) {
      exact.push(e);
    } else if (t.startsWith(q) || q.startsWith(t)) {
      prefix.push(e);
    } else if (t.includes(q) || q.includes(t)) {
      contains.push(e);
    }
  }

  const tier = exact.length > 0 ? exact : prefix.length > 0 ? prefix : contains;
  return tier.length === 1 ? tier[0] : null;
}

/**
 * lowercase → strip accents → strip punctuation → collapse whitespace → trim.
 * Shared shape with the goalMapper normalizer but kept local so the explicit
 * resolver has no hidden coupling.
 */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// CANDIDATE BUILDING
// ============================================================================

interface ExplicitCandidateArgs {
  intent: ParsedIntent;
  status: MappingStatus;
  goalId?: string;
  projectId?: string;
  taskId?: string;
  reason: string;
  info: ExplicitMappingInfo;
}

function explicitCandidate(args: ExplicitCandidateArgs): GoalMappingCandidate {
  const matchedKeywords: string[] = [];
  if (args.info.requestedGoal) matchedKeywords.push(`goal:${args.info.requestedGoal}`);
  if (args.info.requestedProject)
    matchedKeywords.push(`project:${args.info.requestedProject}`);
  if (args.info.requestedTask)
    matchedKeywords.push(`task:${args.info.requestedTask}`);

  return {
    intentId: args.intent.id,
    status: args.status,
    goalId: args.goalId,
    projectId: args.projectId,
    taskId: args.taskId,
    confidence: args.status === 'mapped' ? 1 : 0,
    reason: args.reason,
    matchedKeywords,
    explicit: args.info,
  };
}
