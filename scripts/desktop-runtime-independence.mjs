const anonymousRepositoryRuntimeRules = Object.freeze([
  {
    label: 'GitHub Pages runtime URL',
    pattern: /https?:\/\/[^\s"'`]+\.github\.io(?:[/:?#]|$)/iu,
  },
  {
    label: 'raw GitHub repository asset URL',
    pattern: /https?:\/\/raw\.githubusercontent\.com(?:[/:?#]|$)/iu,
  },
  {
    label: 'GitHub repository release URL',
    pattern: /https?:\/\/github\.com\/[^/\s"'`]+\/[^/\s"'`]+\/releases(?:[/?#]|$)/iu,
  },
  {
    label: 'GitHub repository content URL',
    pattern: /https?:\/\/(?:github\.com\/[^/\s"'`]+\/[^/\s"'`]+\/(?:archive|blob|raw)|codeload\.github\.com)(?:[/?#]|$)/iu,
  },
  {
    label: 'GitHub repository API URL',
    pattern: /https?:\/\/api\.github\.com\/repos(?:[/?#]|$)/iu,
  },
  {
    label: 'GitHub-hosted object URL',
    pattern: /https?:\/\/(?:objects|github-releases|release-assets)\.githubusercontent\.com(?:[/:?#]|$)/iu,
  },
]);

/**
 * Detect anonymous GitHub/Pages runtime dependencies without returning matched
 * content. Paths and line numbers are sufficient evidence and avoid echoing a
 * future signed asset URL or other query material into CI logs.
 *
 * @param {Array<{ path: string, text: string }>} entries
 * @returns {Array<{ path: string, line: number, label: string }>}
 */
export function findAnonymousRepositoryRuntimeReferences(entries) {
  const findings = [];
  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.text !== 'string') {
      throw new TypeError('Runtime scan entries require string path and text fields.');
    }
    for (const rule of anonymousRepositoryRuntimeRules) {
      const match = rule.pattern.exec(entry.text);
      if (!match) continue;
      findings.push({
        path: entry.path,
        line: lineNumberAt(entry.text, match.index),
        label: rule.label,
      });
    }
  }
  return findings;
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}
