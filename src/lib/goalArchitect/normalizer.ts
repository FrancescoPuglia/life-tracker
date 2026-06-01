// src/lib/goalArchitect/normalizer.ts
// Pure token-level normalization helpers used by the parser and the compiler.
//
// All helpers are deterministic and side-effect free. They never throw on
// malformed input — they return `undefined` so the parser can attach a
// warning instead.

import { normalizePriority } from './validation';
import type { DraftPriority, KeyResultUnit } from './types';

// ============================================================================
// TEXT NORMALIZATION
// ============================================================================

/**
 * Trim, collapse runs of horizontal whitespace, normalize quotes/dashes,
 * preserve newlines so the parser can use them as list boundaries.
 */
export function normalizeInputText(input: string): string {
  if (typeof input !== 'string') return '';
  const stripped = input
    // Curly quotes / dashes → ASCII equivalents (so regex stays simple).
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, '-');
  // Collapse only horizontal whitespace, leave \n untouched.
  return stripped
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/[ \t\f\v]*\n[ \t\f\v]*/g, '\n')
    .trim();
}

/**
 * NFKD decomposition + strip combining marks. Mirrors `ids.normalizeForId`
 * but does NOT lowercase — the parser uses this for case-insensitive matching
 * while still rendering titles in their original case.
 */
export function stripAccents(input: string): string {
  if (typeof input !== 'string') return '';
  return input.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

export function normalizeWhitespace(input: string): string {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, ' ').trim();
}

export function normalizeSectionLabel(input: string): string {
  return stripAccents(normalizeWhitespace(input))
    .toLowerCase()
    .replace(/\s*:\s*$/, '')
    .trim();
}

// ============================================================================
// HOURS
// ============================================================================

const MINUTES_RE = /(\d+(?:[.,]\d+)?)\s*(?:minuti|minutes?|mins?)\b/i;
const HOURS_RE = /(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|ore|ora|h)\b/i;

/**
 * Returns the duration encoded by the first hour/minute token, in HOURS.
 *   "10h"        → 10
 *   "10 ore"     → 10
 *   "1 ora"      → 1
 *   "1.5h"       → 1.5
 *   "1,5h"       → 1.5
 *   "90 minuti"  → 1.5
 *   "300"        → undefined  (no unit ⇒ refuse to guess)
 */
export function parseHoursToken(input: string): number | undefined {
  if (typeof input !== 'string') return undefined;
  const minMatch = input.match(MINUTES_RE);
  if (minMatch) {
    const v = toFloat(minMatch[1]);
    if (v === undefined) return undefined;
    return v / 60;
  }
  const hMatch = input.match(HOURS_RE);
  if (hMatch) {
    const v = toFloat(hMatch[1]);
    if (v === undefined) return undefined;
    return v;
  }
  return undefined;
}

function toFloat(raw: string): number | undefined {
  const n = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

// ============================================================================
// DATES
// ============================================================================

const ITALIAN_MONTHS: Record<string, number> = {
  gennaio: 1,
  febbraio: 2,
  marzo: 3,
  aprile: 4,
  maggio: 5,
  giugno: 6,
  luglio: 7,
  agosto: 8,
  settembre: 9,
  ottobre: 10,
  novembre: 11,
  dicembre: 12,
};

const ENGLISH_MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const ALL_MONTHS: Record<string, number> = { ...ITALIAN_MONTHS, ...ENGLISH_MONTHS };

const MONTH_NAMES = Object.keys(ALL_MONTHS).sort((a, b) => b.length - a.length);
const MONTH_PATTERN = MONTH_NAMES.join('|');

const ISO_DATE_RE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;
const DMY_SLASH_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
const DMY_DASH_RE = /\b(\d{1,2})-(\d{1,2})-(\d{4})\b/;
const DAY_MONTH_YEAR_RE = new RegExp(
  `\\b(\\d{1,2})\\s+(${MONTH_PATTERN})\\s+(\\d{4})\\b`,
  'i',
);
const MONTH_YEAR_RE = new RegExp(
  `(?:\\b(?:entro|by|in|nel(?:\\s+mese\\s+di)?)\\s+)?(${MONTH_PATTERN})\\s+(\\d{4})\\b`,
  'i',
);
const END_OF_YEAR_RE =
  /\b(?:end\s+of|entro\s+fine|fine\s+(?:dell['\s]?anno\s+)?|by\s+end\s+of)\s+(\d{4})\b/i;
const FIN_ANNO_BARE_RE = /\bfine\s+(\d{4})\b/i;

/**
 * Resolves the first recognizable date token in `input` to `YYYY-MM-DD`.
 * Order matters — try the most explicit forms first.
 */
export function parseDateToken(input: string): string | undefined {
  if (typeof input !== 'string') return undefined;
  const lower = stripAccents(input).toLowerCase();

  // 1. ISO `YYYY-MM-DD`
  const iso = lower.match(ISO_DATE_RE);
  if (iso) return safeIso(+iso[1], +iso[2], +iso[3]);

  // 2. `DD/MM/YYYY`
  const slash = lower.match(DMY_SLASH_RE);
  if (slash) return safeIso(+slash[3], +slash[2], +slash[1]);

  // 3. `DD-MM-YYYY` (only when it's not the ISO form — ISO is matched first)
  const dash = lower.match(DMY_DASH_RE);
  if (dash) return safeIso(+dash[3], +dash[2], +dash[1]);

  // 4. `31 dicembre 2026` / `31 December 2026`
  const dmy = lower.match(DAY_MONTH_YEAR_RE);
  if (dmy) {
    const month = ALL_MONTHS[dmy[2].toLowerCase()];
    return safeIso(+dmy[3], month, +dmy[1]);
  }

  // 5. `end of 2026` / `entro fine 2026` / `fine 2026`
  const endYear = lower.match(END_OF_YEAR_RE) ?? lower.match(FIN_ANNO_BARE_RE);
  if (endYear) {
    const y = +endYear[1];
    return safeIso(y, 12, 31);
  }

  // 6. `entro dicembre 2026` / `by December 2026` / `dicembre 2026`
  const monthYear = lower.match(MONTH_YEAR_RE);
  if (monthYear) {
    const month = ALL_MONTHS[monthYear[1].toLowerCase()];
    const year = +monthYear[2];
    const last = lastDayOfMonth(year, month);
    return safeIso(year, month, last);
  }

  return undefined;
}

function safeIso(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return undefined;
  }
  if (year < 1900 || year > 2200) return undefined;
  if (month < 1 || month > 12) return undefined;
  if (day < 1 || day > 31) return undefined;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return undefined;
  }
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
function pad4(n: number): string {
  return n.toString().padStart(4, '0');
}
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ============================================================================
// PRIORITY
// ============================================================================

const EXTRA_PRIORITY_ALIASES: Record<string, DraftPriority> = {
  critico: 'critical',
  critica: 'critical',
  importante: 'high',
  importantissimo: 'critical',
  importantissima: 'critical',
  prioritario: 'high',
  prioritaria: 'high',
  basso: 'low',
  medio: 'medium',
  alto: 'high',
};

export function normalizePriorityToken(
  input: string | undefined,
): DraftPriority | undefined {
  if (input === undefined || input === null) return undefined;
  const primary = normalizePriority(input);
  if (primary) return primary;
  const key = stripAccents(String(input)).trim().toLowerCase();
  return EXTRA_PRIORITY_ALIASES[key];
}

// ============================================================================
// KEY RESULT UNITS
// ============================================================================

const KR_UNIT_ALIASES: Record<string, KeyResultUnit> = {
  percent: 'percent',
  percento: 'percent',
  percentuale: 'percent',
  '%': 'percent',
  hours: 'hours',
  hour: 'hours',
  hrs: 'hours',
  hr: 'hours',
  ore: 'hours',
  ora: 'hours',
  h: 'hours',
  days: 'days',
  day: 'days',
  giorni: 'days',
  giorno: 'days',
  sessions: 'sessions',
  session: 'sessions',
  sessioni: 'sessions',
  sessione: 'sessions',
  sedute: 'sessions',
  seduta: 'sessions',
  courses: 'courses',
  course: 'courses',
  corsi: 'courses',
  corso: 'courses',
  videos: 'videos',
  video: 'videos',
  studies: 'studies',
  study: 'studies',
  studi: 'studies',
  studio: 'studies',
  tasks: 'tasks',
  task: 'tasks',
  books: 'books',
  book: 'books',
  libri: 'books',
  libro: 'books',
};

export function normalizeKeyResultUnitToken(
  input: string | undefined,
): KeyResultUnit | undefined {
  if (input === undefined || input === null) return undefined;
  const key = stripAccents(String(input)).trim().toLowerCase();
  if (key.length === 0) return undefined;
  if (key === '%') return 'percent';
  return KR_UNIT_ALIASES[key];
}

// ============================================================================
// LIST SPLITTING
// ============================================================================

const LIST_MARKER_RE = /^[-*•·]/;

/**
 * Splits a list section into items. If the input is multi-line with bullet
 * markers (`-`, `*`, `•`), each marked line becomes one item — that preserves
 * commas inside item titles like `ONU, FAO, WFP`. Otherwise the input is
 * comma/semicolon-separated.
 */
export function splitListItems(input: string): string[] {
  if (typeof input !== 'string') return [];
  const lines = input
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const markedLines = lines.filter((l) => LIST_MARKER_RE.test(l));
  if (markedLines.length >= 1 && markedLines.length === lines.length) {
    return markedLines
      .map((l) => l.replace(LIST_MARKER_RE, '').trim())
      .filter((l) => l.length > 0);
  }

  if (markedLines.length >= 2) {
    return markedLines
      .map((l) => l.replace(LIST_MARKER_RE, '').trim())
      .filter((l) => l.length > 0);
  }

  const joined = lines.join(' ');
  return joined
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ============================================================================
// TITLE CLEANUP
// ============================================================================

const TRAILING_HOURS_RE = /\s+\d+(?:[.,]\d+)?\s*(?:hours?|hrs?|ore|ora|h|minuti|minutes?|mins?|min)\b[.,;:!?\s]*$/i;
const LEADING_HOURS_RE = /^\s*\d+(?:[.,]\d+)?\s*(?:hours?|hrs?|ore|ora|h|minuti|minutes?|mins?|min)\b\s*/i;
const TRAILING_PRIORITY_RE = /\s+(critical|critico|critica|urgente|high|alta|alto|medium|media|medio|low|bassa|basso|importante)\b[.,;:!?\s]*$/i;
const LEADING_PRIORITY_RE = /^\s*(critical|critico|critica|urgente|high|alta|alto|medium|media|medio|low|bassa|basso|importante)\b\s*[:\-]?\s*/i;

/**
 * Strip recognizable metadata (hours / priority / inline date marker) from
 * either end of `input`. Run repeatedly until stable — items can carry
 * multiple metadata tokens like `"Sveshnikov 15h critical"`.
 */
export function removeKnownMetadataFromTitle(input: string): string {
  if (typeof input !== 'string') return '';
  let current = input.trim();
  for (let i = 0; i < 6; i++) {
    let next = current;
    next = next.replace(TRAILING_HOURS_RE, '');
    next = next.replace(LEADING_HOURS_RE, '');
    next = next.replace(TRAILING_PRIORITY_RE, '');
    next = next.replace(LEADING_PRIORITY_RE, '');
    next = next.replace(/[.,;:!?\-\s]+$/g, '');
    next = next.trim();
    if (next === current) break;
    current = next;
  }
  return current.replace(/\s+/g, ' ').trim();
}

// ============================================================================
// INLINE EXTRACTORS — used by parser to read priority/date from an item
// ============================================================================

const PRIORITY_TOKEN_RE =
  /\b(critical|critico|critica|urgente|high|alta|alto|medium|media|medio|low|bassa|basso|importante)\b/i;

export function extractInlinePriority(input: string): string | undefined {
  const m = input.match(PRIORITY_TOKEN_RE);
  if (!m) return undefined;
  return m[1];
}

export function extractInlineHours(input: string): number | undefined {
  return parseHoursToken(input);
}

export function extractInlineDate(input: string): string | undefined {
  return parseDateToken(input);
}
