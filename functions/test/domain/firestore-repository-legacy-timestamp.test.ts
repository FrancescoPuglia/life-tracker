import { describe, expect, it } from 'vitest';
import { decodeLegacyEntityTimestamp } from '../../src/domain/firestore-repository';

describe('legacy entity timestamp compatibility', () => {
  it('canonicalizes the exact historical seconds/nanoseconds map shape', () => {
    expect(decodeLegacyEntityTimestamp({
      seconds: 1_777_374_000,
      nanoseconds: 123_000_000,
    })).toBe('2026-04-28T11:00:00.123Z');
  });

  it('uses the established epoch fallback for an unresolved historical serverTimestamp sentinel', () => {
    expect(decodeLegacyEntityTimestamp({ _methodName: 'serverTimestamp' }))
      .toBe('1970-01-01T00:00:00.000Z');
  });

  it.each([
    [{ seconds: 1, nanoseconds: 1 }],
    [{ seconds: 1, nanoseconds: -1 }],
    [{ seconds: 1, nanoseconds: 1_000_000_000 }],
    [{ seconds: 1, nanoseconds: 0, extra: true }],
    [{ seconds: '1', nanoseconds: 0 }],
    [{ _methodName: 'deleteField' }],
    ['2026-04-28T06:20:00.123Z'],
  ])('rejects malformed or broader legacy representations: %j', (value) => {
    expect(decodeLegacyEntityTimestamp(value)).toBeNull();
  });
});
