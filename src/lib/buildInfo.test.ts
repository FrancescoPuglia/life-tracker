import { describe, expect, it } from 'vitest';
import { LOCAL_BUILD_ID, resolveBuildId } from './buildInfo';

describe('frontend build provenance', () => {
  it('accepts an exact lowercase Git commit', () => {
    const commit = 'a'.repeat(40);
    expect(resolveBuildId(commit)).toBe(commit);
  });

  it.each([undefined, '', 'ABCDEF', 'a'.repeat(39), 'a'.repeat(41), 'not-a-commit'])
  ('fails closed to a non-authoritative local label for %s', (value) => {
    expect(resolveBuildId(value)).toBe(LOCAL_BUILD_ID);
  });
});
