const WPI_MARKER_PATTERN = /^[ \t]*WPI_KEY:\s*(wpi:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+)\s*$/gim;
const TASK_GAI_MARKER_PATTERN = /^[ \t]*GAI_KEY:\s*((?:task:[a-f0-9]{24})|(?:gai:[A-Za-z0-9_.-]+:task:[A-Za-z0-9_.-]+))\s*$/gim;

export function stripSemanticMarkerLines(
  value: string | null | undefined,
  marker: 'WPI_KEY' | 'GAI_KEY',
): string {
  if (!value) return '';
  // Reserved semantic markers are server metadata. Remove the token and the
  // remainder of its line even when hostile input embeds it inline; valid
  // authoritative markers are extracted separately before this sanitizer.
  const pattern = new RegExp(`${marker}\\s*:[^\\r\\n]*`, 'gi');
  return value
    .replace(pattern, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractWpiMarkers(value: string | null | undefined): readonly string[] {
  return extractMarkers(value, WPI_MARKER_PATTERN, 'WPI_KEY');
}

export function extractTaskGaiMarkers(value: string | null | undefined): readonly string[] {
  return extractMarkers(value, TASK_GAI_MARKER_PATTERN, 'GAI_KEY');
}

function extractMarkers(
  value: string | null | undefined,
  pattern: RegExp,
  prefix: 'WPI_KEY' | 'GAI_KEY',
): readonly string[] {
  if (!value) return [];
  pattern.lastIndex = 0;
  const markers: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const payload = match[1];
    if (payload) markers.push(`${prefix}: ${payload}`);
  }
  pattern.lastIndex = 0;
  return [...new Set(markers)];
}
