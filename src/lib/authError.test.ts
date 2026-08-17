import { describe, expect, it, vi } from 'vitest';
import { normalizeAuthError } from './authError';

describe('normalizeAuthError', () => {
  it('does not log or propagate provider token response data', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = normalizeAuthError({
      code: 'auth/provider-specific-failure',
      message: 'provider detail must not escape',
      customData: {
        _tokenResponse: {
          oauthAccessToken: 'synthetic-sensitive-access-token',
          oauthIdToken: 'synthetic-sensitive-id-token',
          pendingToken: 'synthetic-sensitive-pending-token',
        },
      },
    } as Parameters<typeof normalizeAuthError>[0]);

    expect(error.message).toBe('Authentication failed');
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    consoleError.mockRestore();
    consoleLog.mockRestore();
  });

  it('maps allowlisted Firebase codes without using the provider message', () => {
    expect(normalizeAuthError({ code: 'auth/network-request-failed' }).message)
      .toBe('Network error. Check your internet connection');
  });
});
