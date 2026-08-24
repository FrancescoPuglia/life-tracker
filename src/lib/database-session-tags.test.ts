import { describe, expect, it } from 'vitest';
import { hasSessionTag, sanitizeForStorage } from './database';

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

describe('storage sanitization', () => {
  it('removes undefined fields without flattening SDK-owned atomic values', () => {
    class AtomicValue {
      constructor(readonly value: string) {}
    }
    const atomic = new AtomicValue('preserve-me');
    const date = new Date('2026-08-24T08:00:00.000Z');

    const sanitized = sanitizeForStorage({
      atomic,
      date,
      omitted: undefined,
      nested: { kept: false, omitted: undefined },
    });

    expect(sanitized.atomic).toBe(atomic);
    expect(sanitized.date).toBe(date);
    expect(sanitized).not.toHaveProperty('omitted');
    expect(sanitized.nested).toEqual({ kept: false });
  });
});
