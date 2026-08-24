import { describe, expect, it } from 'vitest';
import { canonicalJson, hashEntityState } from '../../src/domain/integrity';
import type { EntityRecord } from '../../src/domain/types';

describe('canonical integrity encoding', () => {
  it('preserves the existing canonical encoding for ordinary JSON values', () => {
    expect(canonicalJson({ z: [true, null, 1.5], a: 'value' }))
      .toBe('{"a":"value","z":[true,null,1.5]}');
  });

  it('distinguishes every non-finite number, null, and signed zero', () => {
    const values = [null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -0];
    expect(new Set(values.map((value) => canonicalJson({ value })))).toHaveLength(values.length);
  });

  it('binds nested non-finite entity state without JSON null collisions', () => {
    const record = (score: number | null): EntityRecord => ({
      id: 'note-1',
      userId: 'owner-user',
      _version: 1,
      createdAt: '2026-08-17T08:00:00.000Z',
      updatedAt: '2026-08-17T08:00:00.000Z',
      docJson: { type: 'doc', score, content: [] },
    });

    const hashes = [
      record(null),
      record(Number.NaN),
      record(Number.POSITIVE_INFINITY),
      record(Number.NEGATIVE_INFINITY),
    ].map(hashEntityState);
    expect(new Set(hashes)).toHaveLength(hashes.length);
  });
});
