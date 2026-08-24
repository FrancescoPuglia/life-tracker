import { describe, expect, it } from 'vitest';
import { sanitizeChangeEntity, sanitizeEntity } from '../../src/domain/sanitize';

describe('model-facing entity sanitization', () => {
  it('drops prototype-mutation keys from nested untrusted document content', () => {
    const hostile = JSON.parse(
      '{"safe":"visible","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true}}',
    ) as Record<string, unknown>;

    const sanitized = sanitizeEntity('notes', {
      id: 'note-1',
      title: 'Untrusted note',
      docJson: hostile,
      _version: 0,
      createdAt: '2026-08-16T12:00:00.000Z',
      updatedAt: '2026-08-16T12:00:00.000Z',
    });
    const docJson = sanitized.docJson as Record<string, unknown>;

    expect(docJson).toEqual({ safe: 'visible' });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('normalizes signed zero so an approval guard can detect transport loss', () => {
    const sanitized = sanitizeChangeEntity('notes', {
      id: 'note-signed-zero',
      title: 'Signed zero',
      docJson: { score: -0 },
      _version: 0,
      createdAt: '2026-08-16T12:00:00.000Z',
      updatedAt: '2026-08-16T12:00:00.000Z',
    }, ['docJson']);

    expect((sanitized.docJson as { score: number }).score).toBe(0);
    expect(Object.is((sanitized.docJson as { score: number }).score, -0)).toBe(false);
  });
});
