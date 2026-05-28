// src/lib/weeklyPlanner/analytics.ts
// Plan-vs-actual analytics for the Weekly Planning Intelligence feature.
//
// Identifies real TimeBlocks created by the feature via the `WPI_KEY` line
// stamped into their notes by `commitDraft.draftBlockToTimeBlockInput` and
// computes a deterministic weekly report (completion rate, calibration vs
// realism score, day breakdown, etc.).
//
// Pure module — no React, no DataProvider, no DB. Inputs are plain
// snapshots provided by the caller; the localStorage lookup goes through
// `loadWeeklyPlanDraft` from `./draftStore`, which itself is SSR-safe.

import { loadWeeklyPlanDraft } from './draftStore';
import type { WeekDay, WeeklyPlanDraft } from './types';

// ============================================================================
// PUBLIC TYPES
// ============================================================================

export interface WpiTimeBlockSnapshot {
  id: string;
  // Title is optional so the analytics layer accepts the same snapshot shape
  // that the commit module already passes around for duplicate detection.
  // Analytics never reads `title` for math — it only surfaces it in debug logs.
  title?: string;
  startTime: Date | string;
  endTime: Date | string;
  status?: string;
  type?: string;
  notes?: string;
  taskId?: string;
  projectId?: string;
  goalId?: string;
}

export interface WpiParsedKey {
  key: string;
  draftId: string;
  blockId: string;
}

export interface WpiDayAnalytics {
  day: WeekDay;
  blockCount: number;
  plannedMinutes: number;
  completedMinutes: number;
  completionRate: number;
}

export interface WpiWeeklyAnalytics {
  weekStartISO: string;
  draftId?: string;
  generatedBlocks: number;
  completedBlocks: number;
  plannedBlocks: number;
  missedBlocks: number;
  partialBlocks: number;
  unknownStatusBlocks: number;
  totalPlannedMinutes: number;
  completedMinutes: number;
  completionRate: number;
  minuteCompletionRate: number;
  goalLinkedBlocks: number;
  projectLinkedBlocks: number;
  taskLinkedBlocks: number;
  goalCoverageRate: number;
  averageBlockMinutes: number;
  dayBreakdown: Record<WeekDay, WpiDayAnalytics>;
  statusBreakdown: Record<string, number>;
  notes: string[];
}

export type CalibrationLabel =
  | 'well_calibrated'
  | 'overestimated'
  | 'underestimated'
  | 'insufficient_data';

export interface WpiRealismCalibration {
  predictedScore?: number;
  actualCompletionRate: number;
  calibrationGap?: number;
  label: CalibrationLabel;
  message: string;
}

export interface WpiTimeBlockGroup {
  draftId: string;
  blocks: Array<{ snapshot: WpiTimeBlockSnapshot; parsed: WpiParsedKey }>;
}

export interface WpiAnalyticsResult {
  weekly: WpiWeeklyAnalytics;
  calibration: WpiRealismCalibration;
  wpiBlocks: WpiTimeBlockSnapshot[];
  matchedDraft?: WeeklyPlanDraft;
  hasDraft: boolean;
}

// ============================================================================
// WPI KEY PARSING
// ============================================================================

// Matches the line stamped by commitDraft.ts:
//   WPI_KEY: wpi:${draft.id}:${block.id}
const WPI_KEY_LINE_RE = /WPI_KEY:\s*(wpi:[A-Za-z0-9_.\-]+:[A-Za-z0-9_.\-]+)/;
const WPI_KEY_PARSE_RE = /^wpi:([^:\s]+):([^:\s]+)$/;

export function extractWpiKey(notes?: string): string | null {
  if (!notes) return null;
  const m = notes.match(WPI_KEY_LINE_RE);
  return m ? m[1] : null;
}

export function parseWpiKey(key: string): WpiParsedKey | null {
  const m = key.match(WPI_KEY_PARSE_RE);
  if (!m) return null;
  return { key, draftId: m[1], blockId: m[2] };
}

export function isWpiTimeBlock(block: { notes?: string }): boolean {
  return extractWpiKey(block.notes) !== null;
}

export function groupWpiTimeBlocksByDraft(
  blocks: ReadonlyArray<WpiTimeBlockSnapshot>,
): Record<string, WpiTimeBlockGroup> {
  const out: Record<string, WpiTimeBlockGroup> = {};
  for (const b of blocks) {
    const key = extractWpiKey(b.notes);
    if (!key) continue;
    const parsed = parseWpiKey(key);
    if (!parsed) continue;
    if (!out[parsed.draftId]) {
      out[parsed.draftId] = { draftId: parsed.draftId, blocks: [] };
    }
    out[parsed.draftId].blocks.push({ snapshot: b, parsed });
  }
  return out;
}

// ============================================================================
// WEEK / TIME HELPERS
// ============================================================================

export function getWeekRange(weekStartISO: string): { start: Date; end: Date } {
  const parts = weekStartISO.split('-').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`getWeekRange: invalid weekStartISO "${weekStartISO}"`);
  }
  const [y, m, d] = parts;
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 7, 0, 0, 0, 0); // half-open
  return { start, end };
}

export function isTimeBlockInWeek(
  block: { startTime: Date | string },
  weekStartISO: string,
): boolean {
  const { start, end } = getWeekRange(weekStartISO);
  const t = toDate(block.startTime);
  if (!t) return false;
  return t.getTime() >= start.getTime() && t.getTime() < end.getTime();
}

export function getTimeBlockDurationMinutes(block: {
  startTime: Date | string;
  endTime: Date | string;
}): number {
  const s = toDate(block.startTime);
  const e = toDate(block.endTime);
  if (!s || !e) return 0;
  const diff = e.getTime() - s.getTime();
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return Math.round(diff / 60000);
}

// ----- Status helpers (single source of truth, used by UI too) --------------

export function isCompletedStatus(status: string | undefined): boolean {
  // `overrun` is "ran past its planned end" — it still ran, so we count it
  // as completed for the purposes of "did the user actually do this?".
  return status === 'completed' || status === 'overrun';
}
export function isMissedStatus(status: string | undefined): boolean {
  return status === 'cancelled';
}
export function isPartialStatus(_status: string | undefined): boolean {
  // The current `TimeBlockStatus` union has no `partial`. Reserved.
  return false;
}
export function isPendingStatus(status: string | undefined): boolean {
  return status === 'planned' || status === 'in_progress';
}

// ============================================================================
// DRAFT MATCHING (uses the existing localStorage store from Prompt 4)
// ============================================================================

export interface FindMatchingDraftParams {
  userIdOrLocal: string;
  weekStartISO: string;
  draftIdsInPlay?: ReadonlyArray<string>;
}

/**
 * Returns the locally-saved draft for the given week, but only if its id
 * still matches at least one WPI block created in the same week. This
 * prevents "Apples vs Oranges" calibration when the user has re-generated
 * a fresh draft after already committing an earlier one.
 */
export function findMatchingDraftForWeek(
  params: FindMatchingDraftParams,
): WeeklyPlanDraft | undefined {
  const loaded = loadWeeklyPlanDraft({
    userIdOrLocal: params.userIdOrLocal,
    weekStartISO: params.weekStartISO,
  });
  if (!loaded) return undefined;
  if (params.draftIdsInPlay && params.draftIdsInPlay.length > 0) {
    return params.draftIdsInPlay.includes(loaded.id) ? loaded : undefined;
  }
  return loaded;
}

// ============================================================================
// ANALYTICS CALCULATION
// ============================================================================

export interface CalculateWpiWeeklyAnalyticsParams {
  allTimeBlocks: ReadonlyArray<WpiTimeBlockSnapshot>;
  weekStartISO: string;
  matchedDraft?: WeeklyPlanDraft;
}

export function calculateWpiWeeklyAnalytics(
  params: CalculateWpiWeeklyAnalyticsParams,
): WpiAnalyticsResult {
  const wpiBlocks = params.allTimeBlocks.filter(
    (b) => isWpiTimeBlock(b) && isTimeBlockInWeek(b, params.weekStartISO),
  );

  // ---- accumulators -------------------------------------------------------
  let totalPlannedMinutes = 0;
  let completedMinutes = 0;
  let completedBlocks = 0;
  let missedBlocks = 0;
  let plannedBlocks = 0;
  let unknownStatusBlocks = 0;
  let goalLinkedBlocks = 0;
  let projectLinkedBlocks = 0;
  let taskLinkedBlocks = 0;

  const statusBreakdown: Record<string, number> = {};
  const dayBreakdown: Record<WeekDay, WpiDayAnalytics> = emptyDayBreakdown();

  for (const b of wpiBlocks) {
    const duration = getTimeBlockDurationMinutes(b);
    totalPlannedMinutes += duration;

    const dayIdx = weekDayOf(b.startTime, params.weekStartISO);
    if (dayIdx !== null) {
      const slot = dayBreakdown[dayIdx];
      slot.blockCount++;
      slot.plannedMinutes += duration;
      if (isCompletedStatus(b.status)) slot.completedMinutes += duration;
    }

    const statusKey = b.status ?? 'unknown';
    statusBreakdown[statusKey] = (statusBreakdown[statusKey] ?? 0) + 1;

    if (isCompletedStatus(b.status)) {
      completedBlocks++;
      completedMinutes += duration;
    } else if (isMissedStatus(b.status)) {
      missedBlocks++;
    } else if (isPendingStatus(b.status)) {
      plannedBlocks++;
    } else {
      unknownStatusBlocks++;
    }

    if (b.goalId) goalLinkedBlocks++;
    if (b.projectId) projectLinkedBlocks++;
    if (b.taskId) taskLinkedBlocks++;
  }

  // Per-day completion rate (post-loop because we need finalized sums).
  for (let d = 0; d < 7; d++) {
    const day = d as WeekDay;
    const slot = dayBreakdown[day];
    slot.completionRate =
      slot.plannedMinutes > 0 ? slot.completedMinutes / slot.plannedMinutes : 0;
  }

  const generatedBlocks = wpiBlocks.length;
  const completionRate =
    generatedBlocks > 0 ? completedBlocks / generatedBlocks : 0;
  const minuteCompletionRate =
    totalPlannedMinutes > 0 ? completedMinutes / totalPlannedMinutes : 0;
  const goalCoverageRate =
    generatedBlocks > 0 ? goalLinkedBlocks / generatedBlocks : 0;
  const averageBlockMinutes =
    generatedBlocks > 0 ? totalPlannedMinutes / generatedBlocks : 0;

  // ---- explainability notes ----------------------------------------------
  const notes: string[] = [];
  notes.push(
    'Le metriche misurano solo i TimeBlock con WPI_KEY (creati dalla Weekly Planning Intelligence).',
  );
  if (params.matchedDraft) {
    notes.push(
      `Bozza originale: ${params.matchedDraft.id} · realism score predetto ${params.matchedDraft.realismScore.overallScore}/100.`,
    );
  } else if (generatedBlocks > 0) {
    notes.push(
      'Bozza originale non più disponibile in localStorage: analytics calcolate solo dai TimeBlock taggati.',
    );
  }
  notes.push(
    'Il modello TimeBlock non ha uno status "partial": i blocchi parzialmente completati non sono separabili in questo MVP.',
  );
  if (unknownStatusBlocks > 0) {
    notes.push(
      `${unknownStatusBlocks} blocchi hanno status sconosciuto e non sono conteggiati come completati o mancati.`,
    );
  }

  const calibration = computeCalibration({
    predictedScore: params.matchedDraft?.realismScore.overallScore,
    completionRate,
    generatedBlocks,
    hasDraft: !!params.matchedDraft,
  });

  const weekly: WpiWeeklyAnalytics = {
    weekStartISO: params.weekStartISO,
    draftId: params.matchedDraft?.id,
    generatedBlocks,
    completedBlocks,
    plannedBlocks,
    missedBlocks,
    partialBlocks: 0,
    unknownStatusBlocks,
    totalPlannedMinutes,
    completedMinutes,
    completionRate,
    minuteCompletionRate,
    goalLinkedBlocks,
    projectLinkedBlocks,
    taskLinkedBlocks,
    goalCoverageRate,
    averageBlockMinutes,
    dayBreakdown,
    statusBreakdown,
    notes,
  };

  return {
    weekly,
    calibration,
    wpiBlocks,
    matchedDraft: params.matchedDraft,
    hasDraft: !!params.matchedDraft,
  };
}

// ============================================================================
// CALIBRATION
// ============================================================================

interface CalibrationInput {
  predictedScore?: number;
  completionRate: number;
  generatedBlocks: number;
  hasDraft: boolean;
}

function computeCalibration(input: CalibrationInput): WpiRealismCalibration {
  if (input.generatedBlocks < 3) {
    return {
      predictedScore: input.predictedScore,
      actualCompletionRate: input.completionRate,
      label: 'insufficient_data',
      message:
        'Servono almeno 3 blocchi WPI nella settimana per misurare la calibrazione.',
    };
  }
  if (!input.hasDraft || input.predictedScore === undefined) {
    return {
      actualCompletionRate: input.completionRate,
      label: 'insufficient_data',
      message:
        'Bozza originale non disponibile: il realism score predetto non è confrontabile.',
    };
  }
  const actualPct = Math.round(input.completionRate * 100);
  const gap = actualPct - input.predictedScore;
  let label: CalibrationLabel;
  let message: string;
  if (Math.abs(gap) <= 15) {
    label = 'well_calibrated';
    message = 'La previsione era coerente con il comportamento reale.';
  } else if (gap < -15) {
    label = 'overestimated';
    message = "Il piano era troppo ottimistico rispetto all'esecuzione reale.";
  } else {
    label = 'underestimated';
    message = 'Hai eseguito meglio di quanto il piano stimasse.';
  }
  return {
    predictedScore: input.predictedScore,
    actualCompletionRate: input.completionRate,
    calibrationGap: gap,
    label,
    message,
  };
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function emptyDayBreakdown(): Record<WeekDay, WpiDayAnalytics> {
  const out = {} as Record<WeekDay, WpiDayAnalytics>;
  for (let d = 0; d < 7; d++) {
    const day = d as WeekDay;
    out[day] = {
      day,
      blockCount: 0,
      plannedMinutes: 0,
      completedMinutes: 0,
      completionRate: 0,
    };
  }
  return out;
}

function toDate(v: Date | string): Date | null {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function weekDayOf(t: Date | string, weekStartISO: string): WeekDay | null {
  const { start } = getWeekRange(weekStartISO);
  const d = toDate(t);
  if (!d) return null;
  const diffDays = Math.floor(
    (d.getTime() - start.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays < 0 || diffDays > 6) return null;
  return diffDays as WeekDay;
}
