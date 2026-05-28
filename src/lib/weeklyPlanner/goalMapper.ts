// src/lib/weeklyPlanner/goalMapper.ts
// Maps a ParsedIntent onto an existing Goal/Project/Task fixture by
// (1) shared activity domain, (2) overlapping domain keywords, (3) raw
// token overlap. No fuzzy library, no embeddings — just normalized
// substring matching with synonym groups.

import type {
  ActivityType,
  GoalLike,
  GoalMappingCandidate,
  MappingStatus,
  ParsedIntent,
  ProjectLike,
  TaskLike,
} from './types';

// ============================================================================
// DOMAIN KEYWORDS
// ============================================================================

const DOMAIN_KEYWORDS: Record<string, ReadonlyArray<string>> = {
  chess: [
    'catalan',
    'catalana',
    'sveshnikov',
    'benko',
    'chess',
    'scacchi',
    'chessable',
    'endgame',
    'finali',
    'tactics',
    'tattica',
    'openings',
    'aperture',
    'mastery',
  ],
  career: [
    'candidature',
    'candidatura',
    'application',
    'applications',
    'cv',
    'linkedin',
    'github',
    'portfolio',
    'carriera',
    'career',
    'job',
    'jobs',
    'lavoro',
    'interview',
    'update',
  ],
  exercise: [
    'palestra',
    'gym',
    'workout',
    'allenamento',
    'fitness',
    'strength',
    'cardio',
    'exercise',
    'training',
    'fisico',
    'physique',
  ],
  reading: [
    'leggere',
    'reading',
    'lettura',
    'book',
    'libro',
    'anki',
    'notebooklm',
    'studio',
    'study',
    'intelligence',
    'engine',
    'knowledge',
  ],
};

/**
 * Bidirectional synonym groups for cross-language equivalences that simple
 * substring matching misses (e.g. "candidature" ⇄ "applications", "palestra"
 * ⇄ "gym"). A group is satisfied iff one token from the intent and one from
 * the entity both belong to it.
 */
const SYNONYM_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ['candidature', 'candidatura', 'application', 'applications'],
  ['palestra', 'gym'],
  ['leggere', 'reading', 'lettura', 'read'],
  ['scacchi', 'chess'],
  ['lavoro', 'job', 'jobs', 'career', 'carriera'],
  ['fisico', 'physique', 'fitness'],
];

const STOPWORDS: ReadonlySet<string> = new Set([
  'per',
  'con',
  'una',
  'uno',
  'del',
  'della',
  'dei',
  'delle',
  'sul',
  'sulla',
  'mia',
  'mio',
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'una',
  'tutti',
  'ogni',
  'every',
  'each',
  'volte',
  'times',
  'settimana',
  'week',
  'min',
  'minuti',
  'minutes',
  'ora',
  'ore',
  'hour',
  'hours',
  'alle',
  'alla',
  'allo',
  'all',
]);

// ============================================================================
// PUBLIC API
// ============================================================================

export function mapIntentToGoal(
  intent: ParsedIntent,
  goals: ReadonlyArray<GoalLike>,
  projects: ReadonlyArray<ProjectLike>,
  tasks: ReadonlyArray<TaskLike>,
): GoalMappingCandidate {
  // Maintenance shortcut — wake-up routines, self-care etc. legitimately
  // have no goal. We mark them explicitly so the UI can render them as OK.
  if (intent.activityType === 'routine' || intent.activityType === 'maintenance') {
    return {
      intentId: intent.id,
      status: 'maintenance',
      confidence: 0.5,
      reason: 'Routine personale: nessun goal richiesto',
      matchedKeywords: [],
    };
  }

  const domainKeys = getDomainKeysFor(intent.activityType);

  const bestTask = findBestMatch(intent, tasks, domainKeys);
  const bestProject = findBestMatch(intent, projects, domainKeys);
  const bestGoal = findBestMatch(intent, goals, domainKeys);

  // Pick the winner by score first, with task > project > goal only as a
  // tiebreaker. A weak task match must not win over a strong project match
  // (otherwise "candidature" snaps to "CV Update" instead of "Job Applications").
  const THRESHOLD = 0.5;
  const ranked = rankCandidates(bestTask, bestProject, bestGoal);
  const winner = ranked.find((c) => c.score >= THRESHOLD);

  if (!winner) {
    return {
      intentId: intent.id,
      status: 'unmapped',
      confidence: 0,
      reason: 'Nessun goal/project/task corrispondente trovato',
      matchedKeywords: [],
    };
  }

  if (winner.kind === 'task') {
    const t = winner.entity as TaskLike;
    const projectId = t.projectId;
    const goalId =
      t.goalId ??
      (projectId
        ? projects.find((p) => p.id === projectId)?.goalId
        : undefined);
    return buildCandidate({
      intent,
      score: winner.score,
      matched: winner.matched,
      taskId: t.id,
      projectId,
      goalId,
      label: t.title,
      kind: 'task',
    });
  }

  if (winner.kind === 'project') {
    const p = winner.entity as ProjectLike;
    return buildCandidate({
      intent,
      score: winner.score,
      matched: winner.matched,
      projectId: p.id,
      goalId: p.goalId,
      label: p.title,
      kind: 'project',
    });
  }

  const g = winner.entity as GoalLike;
  return buildCandidate({
    intent,
    score: winner.score,
    matched: winner.matched,
    goalId: g.id,
    label: g.title,
    kind: 'goal',
  });
}

type RankedKind = 'task' | 'project' | 'goal';
interface RankedCandidate {
  kind: RankedKind;
  score: number;
  matched: string[];
  entity: TaskLike | ProjectLike | GoalLike;
}

function rankCandidates(
  t: ScoreResult<TaskLike> | null,
  p: ScoreResult<ProjectLike> | null,
  g: ScoreResult<GoalLike> | null,
): RankedCandidate[] {
  const order: Record<RankedKind, number> = { task: 0, project: 1, goal: 2 };
  const list: RankedCandidate[] = [];
  if (t) list.push({ kind: 'task', score: t.score, matched: t.matched, entity: t.entity });
  if (p) list.push({ kind: 'project', score: p.score, matched: p.matched, entity: p.entity });
  if (g) list.push({ kind: 'goal', score: g.score, matched: g.matched, entity: g.entity });
  list.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return order[a.kind] - order[b.kind];
  });
  return list;
}

export function mapIntentsToGoals(
  intents: ReadonlyArray<ParsedIntent>,
  goals: ReadonlyArray<GoalLike>,
  projects: ReadonlyArray<ProjectLike>,
  tasks: ReadonlyArray<TaskLike>,
): GoalMappingCandidate[] {
  return intents.map((i) => mapIntentToGoal(i, goals, projects, tasks));
}

// ============================================================================
// SCORING
// ============================================================================

interface ScoreResult<T> {
  entity: T;
  score: number;
  matched: string[];
}

interface NamedEntity {
  id: string;
  title: string;
  description?: string;
}

function findBestMatch<T extends NamedEntity>(
  intent: ParsedIntent,
  entities: ReadonlyArray<T>,
  domainKeys: ReadonlyArray<string>,
): ScoreResult<T> | null {
  let best: ScoreResult<T> | null = null;
  for (const e of entities) {
    const { score, matched } = computeMatchScore(intent, e, domainKeys);
    if (score > 0 && (!best || score > best.score)) {
      best = { entity: e, score, matched };
    }
  }
  return best;
}

interface RawScore {
  score: number;
  matched: string[];
}

function computeMatchScore(
  intent: ParsedIntent,
  entity: NamedEntity,
  domainKeys: ReadonlyArray<string>,
): RawScore {
  const matched: string[] = [];
  let score = 0;

  const intentText = normalize(`${intent.label} ${intent.sourceText}`);
  const entityText = normalize(`${entity.title} ${entity.description ?? ''}`);

  if (intentText.length === 0 || entityText.length === 0) {
    return { score: 0, matched: [] };
  }

  // (1) Same activity domain → strong anchor.
  const entityInDomain = domainKeys.some((k) => entityText.includes(k));
  if (domainKeys.length > 0 && entityInDomain) {
    score += 0.6;
    matched.push('[domain_anchor]');
  }

  // (2) Shared domain keyword → specific token in both texts.
  for (const dk of domainKeys) {
    if (intentText.includes(dk) && entityText.includes(dk)) {
      if (!matched.includes(dk)) {
        matched.push(dk);
        score += 0.4;
      }
    }
  }

  // (3) Synonym bridge — distinguishes "candidature → Job Applications"
  // from "candidature → CV Update" when neither shares an explicit token.
  for (const group of SYNONYM_GROUPS) {
    const intentHits = group.filter((w) => intentText.includes(w));
    const entityHits = group.filter((w) => entityText.includes(w));
    if (intentHits.length > 0 && entityHits.length > 0) {
      const tag = `[syn:${group[0]}]`;
      if (!matched.includes(tag)) {
        matched.push(tag);
        score += 0.4;
      }
    }
  }

  // (4) Generic token overlap (low weight, capped to avoid runaway scores).
  const intentTokens = tokens(intentText);
  const entityTokens = tokens(entityText);
  let tokenHits = 0;
  for (const it of intentTokens) {
    for (const et of entityTokens) {
      if (tokensMatch(it, et)) {
        if (!matched.includes(it)) matched.push(it);
        tokenHits++;
        break;
      }
    }
  }
  score += Math.min(0.4, tokenHits * 0.2);

  return { score, matched };
}

function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.includes(a)) return true;
  if (b.length >= 4 && a.includes(b)) return true;
  return false;
}

// ============================================================================
// HELPERS
// ============================================================================

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(normalized: string): string[] {
  return normalized
    .split(' ')
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

function getDomainKeysFor(t: ActivityType): ReadonlyArray<string> {
  switch (t) {
    case 'chess':
      return DOMAIN_KEYWORDS.chess;
    case 'career':
    case 'deep_work':
      return DOMAIN_KEYWORDS.career;
    case 'exercise':
      return DOMAIN_KEYWORDS.exercise;
    case 'reading':
      return DOMAIN_KEYWORDS.reading;
    default:
      return [];
  }
}

interface CandidateArgs {
  intent: ParsedIntent;
  score: number;
  matched: string[];
  taskId?: string;
  projectId?: string;
  goalId?: string;
  label: string;
  kind: 'task' | 'project' | 'goal';
}

function buildCandidate(args: CandidateArgs): GoalMappingCandidate {
  const confidence = Math.min(1, args.score);
  const status: MappingStatus =
    confidence >= 0.8 ? 'mapped' : confidence >= 0.5 ? 'needs_review' : 'unmapped';
  const reasonPrefix =
    status === 'mapped'
      ? 'Match alto'
      : status === 'needs_review'
        ? 'Match parziale'
        : 'Match debole';
  return {
    intentId: args.intent.id,
    status,
    taskId: args.taskId,
    projectId: args.projectId,
    goalId: args.goalId,
    confidence,
    reason: `${reasonPrefix} su ${args.kind} "${args.label}"`,
    matchedKeywords: args.matched,
  };
}
