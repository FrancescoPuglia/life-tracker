// src/lib/weeklyPlanner/timeUtils.ts
// Pure helpers for HH:mm arithmetic and deterministic id generation.
// No Date objects, no timezone math — all reasoning is in "minutes since
// midnight". This keeps the engine fully deterministic and independent of
// any locale / DST quirks.

import type { WeekDay } from './types';

const HHMM_RE = /^(\d{1,2})[:\.](\d{1,2})$/;
const H_ONLY_RE = /^(\d{1,2})$/;

/**
 * Parses a "HH:mm" (or "H:m", "H", "H.MM") string into minutes since midnight.
 * Throws on invalid input rather than returning NaN — the engine guarantees
 * its own inputs, and silent NaN propagation would mask bugs.
 */
export function timeToMinutes(t: string): number {
  const norm = normalizeTime(t);
  const m = norm.match(HHMM_RE);
  if (!m) {
    throw new Error(`timeToMinutes: invalid time string "${t}"`);
  }
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) {
    throw new Error(`timeToMinutes: out-of-range time "${t}"`);
  }
  return h * 60 + mm;
}

export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function addMinutesToTime(t: string, m: number): string {
  return minutesToTime(timeToMinutes(t) + m);
}

export function compareTime(a: string, b: string): number {
  return timeToMinutes(a) - timeToMinutes(b);
}

export function computeEndTime(start: string, durationMinutes: number): string {
  return addMinutesToTime(start, durationMinutes);
}

/**
 * Accepts "7", "07", "7:5", "07:05", "07.05" — returns canonical "HH:mm".
 * Used by the parser so user input like "alle 7" still produces "07:00".
 */
export function normalizeTime(t: string): string {
  const raw = t.trim();
  const hOnly = raw.match(H_ONLY_RE);
  if (hOnly) {
    return `${String(parseInt(hOnly[1], 10)).padStart(2, '0')}:00`;
  }
  const hm = raw.match(HHMM_RE);
  if (hm) {
    const h = parseInt(hm[1], 10);
    const mm = parseInt(hm[2], 10);
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  return raw;
}

// ============================================================================
// SLOT GEOMETRY
// ============================================================================

export interface PlacedSlot {
  startMinutes: number;
  endMinutes: number;
}

/**
 * Is [start, end] free given the existing placed slots and the buffer rule
 * (no two placed intervals may be closer than `bufferMinutes`)?
 *
 * The condition is symmetric:
 *   freeBefore: newEnd + buffer <= other.start
 *   freeAfter:  newStart >= other.end + buffer
 */
export function isSlotAvailable(
  startMinutes: number,
  endMinutes: number,
  placed: ReadonlyArray<PlacedSlot>,
  bufferMinutes: number,
): boolean {
  for (const p of placed) {
    const freeBefore = endMinutes + bufferMinutes <= p.startMinutes;
    const freeAfter = startMinutes >= p.endMinutes + bufferMinutes;
    if (!freeBefore && !freeAfter) return false;
  }
  return true;
}

/**
 * Find the earliest start time (in minutes) ≥ preferredStart where a slot
 * of `durationMinutes` fits without violating the buffer rule.
 * Returns null when no fit exists before `latestMinutes`.
 */
export function findNextAvailableSlot(
  preferredStart: number,
  durationMinutes: number,
  placed: ReadonlyArray<PlacedSlot>,
  earliestMinutes: number,
  latestMinutes: number,
  bufferMinutes: number,
): number | null {
  let candidate = Math.max(preferredStart, earliestMinutes);

  // Iterate at most O(n) — each collision slides past one placed slot.
  // Cap the loop to placed.length + 1 to avoid pathological inputs.
  for (let i = 0; i <= placed.length + 1; i++) {
    const end = candidate + durationMinutes;
    if (end > latestMinutes) return null;
    if (isSlotAvailable(candidate, end, placed, bufferMinutes)) {
      return candidate;
    }
    // Slide past the first conflicting placed slot.
    let nextCandidate = candidate;
    for (const p of placed) {
      if (
        !(end + bufferMinutes <= p.startMinutes) &&
        !(candidate >= p.endMinutes + bufferMinutes)
      ) {
        nextCandidate = Math.max(nextCandidate, p.endMinutes + bufferMinutes);
      }
    }
    if (nextCandidate <= candidate) return null; // no progress, give up
    candidate = nextCandidate;
  }
  return null;
}

// ============================================================================
// DETERMINISTIC ID GENERATION
// ============================================================================

/**
 * djb2 hash (xor variant) → base36 string. Stable, fast, dependency-free.
 * Two calls with the same content + index always return the same id.
 * Math.random is forbidden in the core (would make tests non-deterministic).
 */
export function createStableId(
  prefix: string,
  content: string,
  index = 0,
): string {
  const s = `${content}::${index}`;
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) ^ s.charCodeAt(i);
    hash = hash | 0; // force int32
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

// ============================================================================
// MISC
// ============================================================================

export function allWeekDays(): WeekDay[] {
  return [0, 1, 2, 3, 4, 5, 6];
}

export function weekdayName(d: WeekDay): string {
  return [
    'lunedì',
    'martedì',
    'mercoledì',
    'giovedì',
    'venerdì',
    'sabato',
    'domenica',
  ][d];
}

export function emptyDailyRecord<T>(zero: T): Record<WeekDay, T> {
  return { 0: zero, 1: zero, 2: zero, 3: zero, 4: zero, 5: zero, 6: zero };
}
