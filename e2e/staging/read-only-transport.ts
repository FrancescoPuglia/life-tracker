const READ_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;

/**
 * Retry a transport exception once only for semantically read-only evidence
 * calls. HTTP responses are never retried, and mutation/provider paths must
 * not use this helper.
 */
export async function fetchReadOnlyWithRetry(
  input: string | URL | Request,
  init: RequestInit = {},
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchImplementation(input, {
        ...init,
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
    } catch {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error('Staging read-only transport failed after its bounded retry.');
      }
    }
  }
  throw new Error('Staging read-only transport failed after its bounded retry.');
}
