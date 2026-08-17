const CANONICAL_WPI_KEY_LINE = /^[ \t]*WPI_KEY:\s*(wpi:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+)[ \t]*$/i;

/**
 * Semantic provenance is accepted only from a complete standalone metadata
 * line. Inline user-authored text must never become WPI authority.
 */
export function extractCanonicalWpiKeys(notes: string | undefined): readonly string[] {
  if (!notes) return [];
  const keys: string[] = [];
  for (const line of notes.split(/\r\n|\n|\r/)) {
    const match = CANONICAL_WPI_KEY_LINE.exec(line);
    if (match?.[1]) keys.push(match[1]);
  }
  return [...new Set(keys)];
}

export function extractCanonicalWpiKey(notes: string | undefined): string | null {
  return extractCanonicalWpiKeys(notes)[0] ?? null;
}

export function containsCanonicalWpiKey(notes: string | undefined, key: string): boolean {
  return extractCanonicalWpiKeys(notes).includes(key);
}
