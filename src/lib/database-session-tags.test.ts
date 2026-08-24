import { describe, expect, it } from 'vitest';
import { hasSessionTag } from './database';

describe('persisted Session tag normalization', () => {
  it('recognizes an exact string tag', () => {
    expect(hasSessionTag({ tags: ['focus', 'deep'] }, 'focus')).toBe(true);
    expect(hasSessionTag({ tags: ['deep'] }, 'focus')).toBe(false);
  });

  it.each([
    {},
    { tags: null },
    { tags: 'focus' },
    { tags: { focus: true } },
    { tags: [null, 1, false] },
  ])('treats missing or malformed persisted tags as untagged', (session) => {
    expect(hasSessionTag(session, 'focus')).toBe(false);
  });
});
