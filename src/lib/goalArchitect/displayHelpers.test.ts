// src/lib/goalArchitect/displayHelpers.test.ts

import { describe, expect, it } from 'vitest';
import { hasGaiKeyMarker, stripGaiKeyMarker } from './displayHelpers';

describe('stripGaiKeyMarker', () => {
  it('removes a trailing GAI_KEY line and surrounding blank lines', () => {
    const input = 'My description here\n\nGAI_KEY: gai:draft-1:goal:goal-x_abc';
    expect(stripGaiKeyMarker(input)).toBe('My description here');
  });

  it('removes the marker even when it appears alone', () => {
    const input = 'GAI_KEY: gai:draft-1:goal:goal-x_abc';
    expect(stripGaiKeyMarker(input)).toBe('');
  });

  it('preserves a multi-line description before the marker', () => {
    const input = 'Line 1\nLine 2\nLine 3\n\nGAI_KEY: gai:draft-1:project:proj-y_def';
    expect(stripGaiKeyMarker(input)).toBe('Line 1\nLine 2\nLine 3');
  });

  it('returns the input unchanged when no marker is present', () => {
    expect(stripGaiKeyMarker('Plain description')).toBe('Plain description');
  });

  it('returns "" for undefined / null / non-string input', () => {
    expect(stripGaiKeyMarker(undefined)).toBe('');
    expect(stripGaiKeyMarker(null)).toBe('');
    expect(stripGaiKeyMarker('')).toBe('');
  });
});

describe('hasGaiKeyMarker', () => {
  it('returns true when the marker is present', () => {
    expect(hasGaiKeyMarker('foo\nGAI_KEY: gai:x:goal:y')).toBe(true);
  });

  it('returns false otherwise', () => {
    expect(hasGaiKeyMarker('foo')).toBe(false);
    expect(hasGaiKeyMarker('')).toBe(false);
    expect(hasGaiKeyMarker(undefined)).toBe(false);
  });
});
