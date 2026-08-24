const READ_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;

export type StagingTransportOperation = 'read_only' | 'fixture_seed';
export type StagingTransportKind = 'timeout' | 'network';

export interface SafeStagingTransportFailure {
  readonly operation: StagingTransportOperation;
  readonly kind: StagingTransportKind;
  readonly attempts: number;
}

export class StagingTransportFailure extends Error {
  readonly evidence: SafeStagingTransportFailure;

  constructor(evidence: SafeStagingTransportFailure) {
    super('Staging transport failed safely.');
    this.name = 'StagingTransportFailure';
    this.evidence = evidence;
  }
}

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
  return fetchWithBoundedTransportRetry('read_only', input, init, fetchImplementation);
}

/**
 * Retry only the exact deterministic fixture PATCH after a transport exception.
 * Callers must keep the URL, method, body, and bearer token identical and prove
 * the resulting document through a separate read. HTTP responses are final.
 */
export async function fetchDeterministicFixtureWithRetry(
  input: string | URL | Request,
  init: RequestInit,
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  return fetchWithBoundedTransportRetry('fixture_seed', input, init, fetchImplementation);
}

/** Release an Undici connection for status-only responses without retaining data. */
export async function discardResponseBody(response: Response): Promise<void> {
  if (!response.body || response.bodyUsed) return;
  try {
    await response.body.cancel();
  } catch {
    // Evidence callers only need the already-received status. Cleanup reports
    // the operation outcome separately and never serializes response content.
  }
}

export function stagingTransportFailureEvidence(error: unknown): SafeStagingTransportFailure | null {
  return error instanceof StagingTransportFailure ? error.evidence : null;
}

export function retryableStagingTransportKind(error: unknown): StagingTransportKind | null {
  if (error instanceof TypeError) return 'network';
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  return null;
}

async function fetchWithBoundedTransportRetry(
  operation: StagingTransportOperation,
  input: string | URL | Request,
  init: RequestInit,
  fetchImplementation: typeof fetch,
): Promise<Response> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchImplementation(input, {
        ...init,
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
    } catch (error) {
      const kind = retryableStagingTransportKind(error);
      if (kind !== null && attempt < MAX_ATTEMPTS) continue;
      throw new StagingTransportFailure({
        operation,
        kind: kind ?? 'network',
        attempts: attempt,
      });
    }
  }
  throw new StagingTransportFailure({ operation, kind: 'network', attempts: MAX_ATTEMPTS });
}
