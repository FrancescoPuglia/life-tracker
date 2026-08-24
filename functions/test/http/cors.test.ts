import { describe, expect, it } from 'vitest';
import { LIFE_TRACKER_DESKTOP_ORIGIN, parseAllowedOrigins } from '../../src/http/cors';

describe('CORS configuration', () => {
  it('accepts explicit HTTPS and loopback development origins', () => {
    expect([...parseAllowedOrigins(
      `https://francescopuglia.github.io,${LIFE_TRACKER_DESKTOP_ORIGIN},http://localhost:3000,http://127.0.0.1:3001`,
    )]).toEqual([
      'https://francescopuglia.github.io',
      'https://tauri.localhost',
      'http://localhost:3000',
      'http://127.0.0.1:3001',
    ]);
  });

  it.each([
    '*',
    '',
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com/path',
    'http://tauri.localhost',
  ])('rejects unsafe origin configuration %#', (value) => {
    expect(() => parseAllowedOrigins(value)).toThrow();
  });
});
