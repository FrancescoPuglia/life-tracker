// src/lib/weeklyPlanner/draftStore.ts
// Local-only draft persistence. SSR-safe wrapper around localStorage with a
// runtime type guard so a corrupted blob can never crash the UI.
//
// Storage key:
//   weekly-plan-draft:${userIdOrLocal}:${weekStartISO}
//
// Constraints (Prompt 4):
//   - NO IndexedDB. NO Firebase. NO migrations.
//   - Pure: no React, no DataProvider imports.

import type { WeeklyPlanDraft } from './types';

const KEY_PREFIX = 'weekly-plan-draft';

// ============================================================================
// KEY HELPER
// ============================================================================

export function buildWeeklyDraftStorageKey(
  userIdOrLocal: string,
  weekStartISO: string,
): string {
  const safeUser = userIdOrLocal.trim() === '' ? 'local' : userIdOrLocal.trim();
  return `${KEY_PREFIX}:${safeUser}:${weekStartISO}`;
}

// ============================================================================
// SAFE STORAGE ACCESS
// ============================================================================

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    const w = window as { localStorage?: Storage };
    return w.localStorage ?? null;
  } catch {
    // SecurityError, quota exceeded on read of property, etc.
    return null;
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

export interface DraftStoreParams {
  userIdOrLocal: string;
  weekStartISO: string;
}

export interface SaveDraftParams extends DraftStoreParams {
  draft: WeeklyPlanDraft;
}

export function saveWeeklyPlanDraft(params: SaveDraftParams): boolean {
  const storage = safeLocalStorage();
  if (!storage) return false;
  // Defensive: never save garbage if the upstream produced a null/undefined.
  if (!params.draft) return false;
  try {
    const key = buildWeeklyDraftStorageKey(
      params.userIdOrLocal,
      params.weekStartISO,
    );
    storage.setItem(key, JSON.stringify(params.draft));
    return true;
  } catch {
    // Quota exceeded, JSON cyclic, or denied — caller treats as "not saved".
    return false;
  }
}

export function loadWeeklyPlanDraft(
  params: DraftStoreParams,
): WeeklyPlanDraft | null {
  const storage = safeLocalStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(
      buildWeeklyDraftStorageKey(params.userIdOrLocal, params.weekStartISO),
    );
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isWeeklyPlanDraftLike(parsed)) return null;
    return parsed;
  } catch {
    // JSON.parse error or anything else → treat as "no draft".
    return null;
  }
}

export function deleteWeeklyPlanDraft(params: DraftStoreParams): boolean {
  const storage = safeLocalStorage();
  if (!storage) return false;
  try {
    storage.removeItem(
      buildWeeklyDraftStorageKey(params.userIdOrLocal, params.weekStartISO),
    );
    return true;
  } catch {
    return false;
  }
}

export function listWeeklyPlanDraftKeys(): string[] {
  const storage = safeLocalStorage();
  if (!storage) return [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(`${KEY_PREFIX}:`)) keys.push(k);
    }
    return keys;
  } catch {
    return [];
  }
}

// ============================================================================
// RUNTIME TYPE GUARD
// ============================================================================

function isObjectRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deliberately shallow — we only verify the shape the UI relies on. Anything
 * else (blocks/conflicts/etc.) is shape-trusted because it was produced by
 * the engine; if it's been hand-edited or corrupted we'll fail soft.
 */
export function isWeeklyPlanDraftLike(value: unknown): value is WeeklyPlanDraft {
  if (!isObjectRecord(value)) return false;
  if (typeof value.id !== 'string') return false;
  if (typeof value.weekStartISO !== 'string') return false;
  if (typeof value.generatedAtISO !== 'string') return false;
  if (value.status !== 'draft') return false;
  if (!Array.isArray(value.blocks)) return false;
  if (!Array.isArray(value.parsedIntents)) return false;
  if (!Array.isArray(value.conflicts)) return false;
  if (!Array.isArray(value.warnings)) return false;
  if (!isObjectRecord(value.realismScore)) return false;
  if (!isObjectRecord(value.sourceIntent)) return false;
  return true;
}
