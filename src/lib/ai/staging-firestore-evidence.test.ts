import { describe, expect, it } from 'vitest';
import { firestoreDocumentFieldsHash } from '../../../e2e/staging/firestore-evidence';

describe('live staging Firestore evidence hashing', () => {
  it('treats equivalent Firestore timestamp serializations as the same instant', () => {
    const withMilliseconds = {
      fields: {
        title: { stringValue: 'bounded fixture' },
        startTime: { timestampValue: '2026-08-24T08:00:00.000Z' },
      },
    };
    const canonicalFirestoreResponse = {
      fields: {
        startTime: { timestampValue: '2026-08-24T08:00:00Z' },
        title: { stringValue: 'bounded fixture' },
      },
    };

    expect(firestoreDocumentFieldsHash(withMilliseconds))
      .toBe(firestoreDocumentFieldsHash(canonicalFirestoreResponse));
  });

  it('still detects a different instant or non-timestamp field', () => {
    const baseline = {
      fields: {
        title: { stringValue: 'bounded fixture' },
        startTime: { timestampValue: '2026-08-24T08:00:00Z' },
      },
    };

    expect(firestoreDocumentFieldsHash(baseline)).not.toBe(firestoreDocumentFieldsHash({
      fields: {
        title: { stringValue: 'bounded fixture' },
        startTime: { timestampValue: '2026-08-24T08:01:00Z' },
      },
    }));
    expect(firestoreDocumentFieldsHash(baseline)).not.toBe(firestoreDocumentFieldsHash({
      fields: {
        title: { stringValue: 'changed fixture' },
        startTime: { timestampValue: '2026-08-24T08:00:00Z' },
      },
    }));
  });

  it('rejects an invalid Firestore timestamp instead of masking it', () => {
    expect(() => firestoreDocumentFieldsHash({
      fields: { startTime: { timestampValue: 'not-a-timestamp' } },
    })).toThrow('Staging Firestore evidence contained an invalid timestamp.');
  });
});
