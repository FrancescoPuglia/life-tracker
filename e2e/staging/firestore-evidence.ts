import { createHash } from 'node:crypto';

/** Hash Firestore fields while treating equivalent RFC 3339 timestamps as one instant. */
export function firestoreDocumentFieldsHash(document: unknown): string {
  const source = objectRecord(document, 'document');
  const fields = objectRecord(source.fields, 'document.fields');
  return createHash('sha256')
    .update(canonicalJson(normalizeFirestoreValue(fields)))
    .digest('hex');
}

function normalizeFirestoreValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeFirestoreValue);
  if (value === null || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length === 1 && typeof source.timestampValue === 'string') {
    const timestamp = new Date(source.timestampValue);
    if (Number.isNaN(timestamp.valueOf())) {
      throw new Error('Staging Firestore evidence contained an invalid timestamp.');
    }
    return { timestampValue: timestamp.toISOString() };
  }
  return Object.fromEntries(Object.entries(source).map(([key, nested]) => [
    key,
    normalizeFirestoreValue(nested),
  ]));
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected object at ${label}.`);
  }
  return value as Record<string, unknown>;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(',')}}`;
}
