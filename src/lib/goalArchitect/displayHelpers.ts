// src/lib/goalArchitect/displayHelpers.ts
// Pure helpers that adapt Goal Architect committed entities for primary UI
// rendering — without touching the underlying data.

const GAI_KEY_LINE_RE = /\n*GAI_KEY:[^\n]*\n?/g;

/**
 * Remove the trailing `GAI_KEY: gai:<draftId>:<kind>:<id>` marker that the
 * commit pipeline embeds in entity `description` fields.
 *
 * The marker exists for idempotency (see commitGoalArchitectureDraft.ts) and
 * must be preserved at the storage layer — but it should never appear in
 * cards rendered to end users. Callers pipe the persisted description
 * through this helper just before rendering.
 *
 * Safe for any string input: returns the input as-is when there is no
 * marker, returns an empty string for non-string input.
 */
export function stripGaiKeyMarker(description: string | undefined | null): string {
  if (typeof description !== 'string') return '';
  if (description.length === 0) return '';
  if (description.indexOf('GAI_KEY:') === -1) return description;
  return description.replace(GAI_KEY_LINE_RE, '').trim();
}

/**
 * True when the description carries a Goal Architect GAI_KEY marker.
 * Useful for "Show details" toggles that want to reveal the marker.
 */
export function hasGaiKeyMarker(description: string | undefined | null): boolean {
  if (typeof description !== 'string') return false;
  return description.includes('GAI_KEY:');
}
