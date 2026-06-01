// src/lib/goalArchitect/draftStore.ts
// Local-only draft persistence for the Goal Architect feature.
//
// Storage key:
//   goal-architect-draft:${userIdOrLocal}:${draftIdOrSlug ?? 'active'}
//
// SSR-safe: when `window` is undefined every operation is a no-op that
// returns a sentinel (`false` / `null` / `[]`). The UI never crashes if the
// blob is corrupted — `loadGoalArchitectureDraft` returns `null` and lets
// the caller restart from scratch.
//
// Constraints:
//   • NO IndexedDB. NO Firebase. NO DataProvider. NO migrations.
//   • Pure: no React imports.
//   • Touched localStorage only — every other persistence path is forbidden.

import type { GoalArchitectureDraft } from './types';

// ============================================================================
// KEY HELPER
// ============================================================================

export const GOAL_ARCHITECT_KEY_PREFIX = 'goal-architect-draft';
const ACTIVE_SLOT = 'active';

/**
 * Build a stable storage key. When `draftIdOrSlug` is omitted the caller is
 * referring to the "single active draft" slot for that user — the common
 * case for the UI, where one user is iterating on one architecture at a
 * time. Pass `draft.id` explicitly to keep multiple drafts side by side.
 */
export function buildGoalArchitectDraftStorageKey(
  userIdOrLocal: string | undefined,
  draftIdOrSlug?: string,
): string {
  const safeUser =
    typeof userIdOrLocal === 'string' && userIdOrLocal.trim().length > 0
      ? userIdOrLocal.trim()
      : 'local';
  const safeSlot =
    typeof draftIdOrSlug === 'string' && draftIdOrSlug.trim().length > 0
      ? draftIdOrSlug.trim()
      : ACTIVE_SLOT;
  return `${GOAL_ARCHITECT_KEY_PREFIX}:${safeUser}:${safeSlot}`;
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
    // SecurityError, denied access in private mode, etc.
    return null;
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

export function saveGoalArchitectureDraft(
  key: string,
  draft: GoalArchitectureDraft,
): boolean {
  const storage = safeLocalStorage();
  if (!storage) return false;
  if (!draft) return false;
  if (typeof key !== 'string' || key.length === 0) return false;
  try {
    storage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    // Quota exceeded, JSON cyclic, or denied — caller treats as "not saved".
    return false;
  }
}

export function loadGoalArchitectureDraft(
  key: string,
): GoalArchitectureDraft | null {
  const storage = safeLocalStorage();
  if (!storage) return null;
  if (typeof key !== 'string' || key.length === 0) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isGoalArchitectureDraftLike(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function deleteGoalArchitectureDraft(key: string): boolean {
  const storage = safeLocalStorage();
  if (!storage) return false;
  if (typeof key !== 'string' || key.length === 0) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function listGoalArchitectureDraftKeys(
  userIdOrLocal?: string,
): string[] {
  const storage = safeLocalStorage();
  if (!storage) return [];
  try {
    const filter =
      typeof userIdOrLocal === 'string' && userIdOrLocal.trim().length > 0
        ? `${GOAL_ARCHITECT_KEY_PREFIX}:${userIdOrLocal.trim()}:`
        : `${GOAL_ARCHITECT_KEY_PREFIX}:`;
    const out: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(filter)) out.push(k);
    }
    return out;
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
 * Shallow shape check — we trust anything produced by `parseGoalArchitecture`
 * but defend against a corrupted blob. The fields below are the ones the UI
 * reads on first render; if any are missing we treat the blob as garbage.
 */
export function isGoalArchitectureDraftLike(
  value: unknown,
): value is GoalArchitectureDraft {
  if (!isObjectRecord(value)) return false;
  if (typeof value.id !== 'string') return false;
  if (typeof value.version !== 'number') return false;
  if (typeof value.status !== 'string') return false;
  if (typeof value.createdAtISO !== 'string') return false;
  if (typeof value.updatedAtISO !== 'string') return false;
  // `goal` is `GoalDraft | null` — we only check that it's not undefined.
  if (!('goal' in value)) return false;
  const g = (value as { goal: unknown }).goal;
  if (g !== null && !isObjectRecord(g)) return false;
  if (!Array.isArray(value.projects)) return false;
  if (!Array.isArray(value.tasks)) return false;
  if (!Array.isArray(value.keyResults)) return false;
  if (!Array.isArray(value.issues)) return false;
  if (!isObjectRecord(value.summary)) return false;
  if (!isObjectRecord(value.confidence)) return false;
  return true;
}
