// src/lib/weeklyPlanner/parser.ts
// Deterministic NL → ParsedIntent[] (Italian primary + English aliases).
// No regex on the moon — small, debuggable, prioritized rules.

import type {
  ActivityType,
  EnergyLevel,
  Flexibility,
  ParsedIntent,
  Recurrence,
  TimeWindow,
  WeekDay,
  WeeklyIntentRaw,
} from './types';
import { createStableId, normalizeTime } from './timeUtils';

// ============================================================================
// DICTIONARIES
// ============================================================================

interface DayPattern {
  readonly regex: RegExp;
  readonly day: WeekDay;
}

// `\b` won't work around accented chars like `ì` (regex word-boundary is
// only defined for ASCII word chars). We bracket with explicit lookaround
// for "letter or start/end".
const DAY_PATTERNS: ReadonlyArray<DayPattern> = [
  { regex: /(?:^|[^\p{L}])(luned[ìi]|monday|mon)(?![\p{L}])/iu, day: 0 },
  { regex: /(?:^|[^\p{L}])(marted[ìi]|tuesday|tue)(?![\p{L}])/iu, day: 1 },
  { regex: /(?:^|[^\p{L}])(mercoled[ìi]|wednesday|wed)(?![\p{L}])/iu, day: 2 },
  { regex: /(?:^|[^\p{L}])(gioved[ìi]|thursday|thu)(?![\p{L}])/iu, day: 3 },
  { regex: /(?:^|[^\p{L}])(venerd[ìi]|friday|fri)(?![\p{L}])/iu, day: 4 },
  { regex: /(?:^|[^\p{L}])(sabato|saturday|sat)(?![\p{L}])/iu, day: 5 },
  { regex: /(?:^|[^\p{L}])(domenica|sunday|sun)(?![\p{L}])/iu, day: 6 },
];

interface ActivityRule {
  readonly type: ActivityType;
  readonly keywords: ReadonlyArray<string>;
}

/**
 * Order matters: most-specific domain first. Once a keyword matches the
 * search stops — so `chess` cannot be shadowed by `routine` even if the
 * sentence contains "studio la Catalana ogni mattina".
 */
const ACTIVITY_RULES: ReadonlyArray<ActivityRule> = [
  {
    type: 'chess',
    keywords: [
      'catalana',
      'catalan',
      'sveshnikov',
      'benko',
      'scacchi',
      'chess',
      'chessable',
      'endgame',
      'finali',
      'tactics',
      'tattica',
    ],
  },
  {
    type: 'exercise',
    keywords: [
      'palestra',
      'gym',
      'allenamento',
      'workout',
      'fitness',
      'corsa',
    ],
  },
  {
    type: 'career',
    keywords: [
      'candidature',
      'candidatura',
      'applications',
      'application',
      'cv',
      'linkedin',
      'github',
      'portfolio',
      'job search',
      'carriera',
      'career',
    ],
  },
  {
    type: 'deep_work',
    keywords: ['deep work', 'lavoro profondo', 'focus session'],
  },
  {
    type: 'reading',
    keywords: [
      'leggere',
      'reading',
      'book',
      'libro',
      'anki',
      'notebooklm',
    ],
  },
  {
    type: 'routine',
    keywords: [
      'mi sveglio',
      'svegliarmi',
      'svegliare',
      'sveglia',
      'wake up',
      'morning routine',
      'routine mattina',
      'routine',
    ],
  },
];

// ============================================================================
// PUBLIC API
// ============================================================================

export function parseWeeklyIntent(raw: WeeklyIntentRaw): ParsedIntent[] {
  const segments = splitIntoSegments(raw.text);
  const intents: ParsedIntent[] = [];
  for (let i = 0; i < segments.length; i++) {
    const intent = parseSegment(segments[i], i);
    if (intent) intents.push(intent);
  }
  return intents;
}

// ============================================================================
// SEGMENTATION
// ============================================================================

function splitIntoSegments(text: string): string[] {
  // Hard separators: . ; \n
  // Soft separators: "e poi" / "and then" / "poi quindi"
  // Commas are intentionally NOT separators — "Lunedì, martedì palestra"
  // must stay a single intent with two days.
  return text
    .split(/[\.\n;]+|\b(?:e poi|and then|poi quindi)\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ============================================================================
// SEGMENT → INTENT
// ============================================================================

interface RecurrenceExtraction {
  recurrence?: Recurrence;
  timesPerWeek?: number;
  preferredTimeWindow?: TimeWindow;
}

function parseSegment(segment: string, index: number): ParsedIntent | null {
  const lower = segment.toLowerCase();

  const { type: activityType, keyword: matchedKeyword } =
    classifyActivity(lower);
  const preferredDays = extractDays(lower);
  const recurrenceInfo = extractRecurrence(lower);
  const preferredTime = extractTime(lower);
  const durationMinutes = extractDuration(lower);

  // Drop segments with zero signal — punctuation noise or stopword soup.
  const isEmpty =
    activityType === 'unknown' &&
    preferredDays.length === 0 &&
    !recurrenceInfo.recurrence &&
    !preferredTime &&
    durationMinutes === undefined;
  if (isEmpty) return null;

  const recurrence: Recurrence =
    recurrenceInfo.recurrence ??
    (preferredDays.length > 0 ? 'weekly' : 'once');

  const energyLevel = inferEnergyLevel(activityType);
  const priority = inferPriority(activityType);
  const flexibility: Flexibility = preferredTime ? 'fixed' : 'flexible';
  const label = buildLabel(segment, matchedKeyword, activityType);
  const confidence = computeConfidence({
    activityType,
    preferredDays,
    recurrence,
    preferredTime,
    durationMinutes,
  });

  return {
    id: createStableId('intent', segment, index),
    label,
    sourceText: segment.trim(),
    activityType,
    preferredDays,
    preferredTime,
    preferredTimeWindow: recurrenceInfo.preferredTimeWindow,
    durationMinutes,
    recurrence,
    timesPerWeek: recurrenceInfo.timesPerWeek,
    priority,
    flexibility,
    energyLevel,
    confidence,
  };
}

// ============================================================================
// FIELD EXTRACTORS
// ============================================================================

function extractDays(text: string): WeekDay[] {
  const days: WeekDay[] = [];
  for (const { regex, day } of DAY_PATTERNS) {
    if (regex.test(text) && !days.includes(day)) {
      days.push(day);
    }
  }
  return days.sort((a, b) => a - b);
}

function extractRecurrence(text: string): RecurrenceExtraction {
  // X volte a settimana / X times per week / X x/week
  const xMatch = text.match(
    /(\d+)\s*(?:volte\s*a\s*settimana|x\s*\/?\s*week|times?\s*(?:per|a)\s*week)/i,
  );
  if (xMatch) {
    return {
      recurrence: 'x_times_weekly',
      timesPerWeek: parseInt(xMatch[1], 10),
    };
  }

  if (/\b(giorni\s*feriali|weekdays)\b/i.test(text)) {
    return { recurrence: 'weekdays' };
  }

  if (/\b(ogni\s*mattina|every\s*morning)\b/i.test(text)) {
    return { recurrence: 'daily', preferredTimeWindow: 'morning' };
  }
  if (/\b(ogni\s*pomeriggio|every\s*afternoon)\b/i.test(text)) {
    return { recurrence: 'daily', preferredTimeWindow: 'afternoon' };
  }
  if (/\b(ogni\s*sera|every\s*evening)\b/i.test(text)) {
    return { recurrence: 'daily', preferredTimeWindow: 'evening' };
  }
  if (/\b(ogni\s*notte|every\s*night)\b/i.test(text)) {
    return { recurrence: 'daily', preferredTimeWindow: 'night' };
  }

  if (/\b(ogni\s*giorno|tutti\s*i\s*giorni|daily|every\s*day)\b/i.test(text)) {
    return { recurrence: 'daily' };
  }

  return {};
}

function extractTime(text: string): string | undefined {
  // "alle 07:00" / "at 7:30" / "alle 07.00"
  let m = text.match(/(?:alle|at)\s*(\d{1,2})[:\.](\d{1,2})\b/i);
  if (m) return normalizeTime(`${m[1]}:${m[2]}`);

  // "dalle 9 alle 11" / "from 9 to 11" → take start
  m = text.match(
    /(?:dalle|from)\s*(\d{1,2})(?:[:\.](\d{1,2}))?\s*(?:alle|to)\s*(\d{1,2})(?:[:\.](\d{1,2}))?/i,
  );
  if (m) return normalizeTime(`${m[1]}:${m[2] ?? '00'}`);

  // "alle 7" / "at 7"
  m = text.match(/(?:alle|at)\s*(\d{1,2})\b/i);
  if (m) return normalizeTime(`${m[1]}:00`);

  return undefined;
}

function extractDuration(text: string): number | undefined {
  // "30 minuti", "30 min", "30 minutes"
  const minutesMatch = text.match(/(\d+)\s*(?:minuti|minutes?|min)\b/i);
  if (minutesMatch) return parseInt(minutesMatch[1], 10);

  // "1 ora", "2 ore", "1 hour", "2 hours", "1.5h"
  const hoursMatch = text.match(/(\d+(?:[\.,]\d+)?)\s*(?:ore?|hours?|h)\b/i);
  if (hoursMatch) {
    const v = parseFloat(hoursMatch[1].replace(',', '.'));
    return Math.round(v * 60);
  }

  return undefined;
}

// ============================================================================
// CLASSIFICATION
// ============================================================================

interface ClassificationResult {
  type: ActivityType;
  keyword?: string;
}

function classifyActivity(text: string): ClassificationResult {
  for (const rule of ACTIVITY_RULES) {
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        return { type: rule.type, keyword: kw };
      }
    }
  }
  return { type: 'unknown' };
}

function inferEnergyLevel(t: ActivityType): EnergyLevel {
  switch (t) {
    case 'chess':
    case 'deep_work':
    case 'career':
    case 'exercise':
      return 'high';
    case 'reading':
    case 'task':
    case 'event':
      return 'medium';
    case 'routine':
    case 'maintenance':
      return 'low';
    case 'unknown':
    default:
      return 'medium';
  }
}

function inferPriority(t: ActivityType): number {
  switch (t) {
    case 'career':
      return 90;
    case 'chess':
    case 'deep_work':
      return 80;
    case 'event':
      return 75;
    case 'exercise':
      return 70;
    case 'task':
      return 65;
    case 'reading':
      return 60;
    case 'routine':
      return 50;
    case 'maintenance':
      return 40;
    case 'unknown':
    default:
      return 30;
  }
}

function buildLabel(
  segment: string,
  keyword: string | undefined,
  type: ActivityType,
): string {
  if (keyword) {
    return capitalize(keyword);
  }
  if (type !== 'unknown') return capitalize(type.replace(/_/g, ' '));
  const trimmed = segment.trim().replace(/\s+/g, ' ').slice(0, 60);
  return trimmed || 'Attività';
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ============================================================================
// CONFIDENCE
// ============================================================================

interface ConfidenceArgs {
  activityType: ActivityType;
  preferredDays: WeekDay[];
  recurrence?: Recurrence;
  preferredTime?: string;
  durationMinutes?: number;
}

function computeConfidence(args: ConfidenceArgs): number {
  let score = 0;
  if (args.activityType !== 'unknown') score += 0.4;
  const hasWhen = args.preferredDays.length > 0 || !!args.recurrence;
  if (hasWhen) score += 0.3;
  if (args.preferredTime) score += 0.15;
  if (args.durationMinutes !== undefined) score += 0.15;
  return Math.min(1, Math.max(0, score));
}
