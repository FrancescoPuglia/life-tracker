// src/lib/goalArchitect/ids.ts
// Deterministic id helpers for the Goal Architect domain.
//
// Constraints:
//   • No `crypto` dependency (works in browser, node, and edge runtimes).
//   • No `Math.random` — same input → same id, always.
//   • No `Date.now` inside id derivation — the *content* drives the hash,
//     not the wall clock.
//   • Diacritics are stripped, whitespace is collapsed, casing is lowered.
//   • Empty/whitespace input is tolerated (no throws); the helpers fall back
//     to deterministic placeholders so the draft layer can still display a
//     stable id for a half-built entity.

import type { DraftEntityKind, GoalArchitectIssueCode } from './types';

// ----------------------------------------------------------------------------
// LOW-LEVEL NORMALIZATION
// ----------------------------------------------------------------------------

const EMPTY_SLUG = 'untitled';

/**
 * Lowercase, strip diacritics, collapse whitespace, drop non-alnum (keeping
 * `-`). The result is safe to embed in an id segment. Empty input collapses
 * to `EMPTY_SLUG` rather than `''` so downstream concatenation can't produce
 * malformed ids like `project__abcd`.
 */
export function normalizeForId(input: string): string {
  if (typeof input !== 'string') return EMPTY_SLUG;
  const trimmed = input.trim();
  if (trimmed.length === 0) return EMPTY_SLUG;

  // U+0300–U+036F is the Unicode "Combining Diacritical Marks" block. After
  // NFKD decomposition, stripping them removes accents (à → a, ñ → n, etc.).
  const noDiacritics = trimmed
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

  const lowered = noDiacritics.toLowerCase();
  const collapsedSpaces = lowered.replace(/\s+/g, ' ').trim();
  const dashed = collapsedSpaces.replace(/\s/g, '-');
  // Keep letters, digits and `-`. Drop the rest.
  const cleaned = dashed.replace(/[^a-z0-9-]/g, '');
  // Collapse runs of dashes that the punctuation strip may have produced.
  const dedashed = cleaned.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return dedashed.length === 0 ? EMPTY_SLUG : dedashed;
}

/**
 * Title-oriented slugifier. Identical to `normalizeForId` semantically; kept
 * as a separate export so call sites read clearly at parser/UI layer.
 */
export function slugifyDraftTitle(input: string): string {
  return normalizeForId(input);
}

/**
 * djb2 (xor variant) hash → base36. Deterministic, dependency-free, fast.
 * Matches the spirit of `weeklyPlanner.timeUtils.createStableId` so the two
 * modules behave alike.
 */
export function stableHash(input: string): string {
  const s = typeof input === 'string' ? input : '';
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) ^ s.charCodeAt(i);
    hash = hash | 0; // force int32
  }
  return (hash >>> 0).toString(36);
}

// ----------------------------------------------------------------------------
// DOMAIN IDS
// ----------------------------------------------------------------------------

const KIND_PREFIX: Record<DraftEntityKind, string> = {
  goal: 'goal',
  project: 'project',
  task: 'task',
  key_result: 'kr',
};

/**
 * Build a deterministic id like `project_goal-scacchi_aperture_xxxx`.
 * - `parentId` is included when present so two same-titled children under
 *   different parents don't collide.
 * - A 5-char hash suffix disambiguates duplicates within the same parent
 *   (the *content* differs even if the slug doesn't — sourceText typically).
 */
export function createDraftId(
  kind: DraftEntityKind,
  title: string,
  parentId?: string,
): string {
  const prefix = KIND_PREFIX[kind];
  const slug = slugifyDraftTitle(title);
  const parent = parentId ? normalizeForId(parentId) : '';
  const hash = stableHash(`${prefix}|${parent}|${slug}`);
  const parts = parent ? [prefix, parent, slug, hash] : [prefix, slug, hash];
  return parts.join('_');
}

/**
 * Issue ids stay readable: code + entity + field. A short content hash
 * guarantees uniqueness in case the same code fires twice on different
 * fields of the same entity.
 */
export function createIssueId(
  code: GoalArchitectIssueCode,
  entityId?: string,
  field?: string,
): string {
  const entity = entityId ? normalizeForId(entityId) : 'none';
  const fieldSlug = field ? normalizeForId(field) : 'none';
  const hash = stableHash(`${code}|${entity}|${fieldSlug}`);
  return `issue_${code}_${entity}_${fieldSlug}_${hash}`;
}
