import { describe, expect, it, vi } from 'vitest';
import {
  discardResponseBody,
  fetchDeterministicFixtureWithRetry,
  fetchReadOnlyWithRetry,
  stagingTransportFailureEvidence,
} from '../../../e2e/staging/read-only-transport';

describe('live staging read-only transport', () => {
  it('retries one transport exception and returns the next response', async () => {
    const fetchSpy = vi.fn()
      .mockRejectedValueOnce(new TypeError('transient transport failure'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const fetchMock = fetchSpy as unknown as typeof fetch;

    const response = await fetchReadOnlyWithRetry('https://staging.example/read', {}, fetchMock);

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const firstSignal = fetchSpy.mock.calls[0]?.[1]?.signal;
    const secondSignal = fetchSpy.mock.calls[1]?.[1]?.signal;
    expect(firstSignal).toBeInstanceOf(AbortSignal);
    expect(secondSignal).toBeInstanceOf(AbortSignal);
    expect(firstSignal).not.toBe(secondSignal);
  });

  it('does not retry an HTTP failure response', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 503 }));
    const fetchMock = fetchSpy as unknown as typeof fetch;

    const response = await fetchReadOnlyWithRetry('https://staging.example/read', {}, fetchMock);

    expect(response.status).toBe(503);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fails with a fixed safe tuple after exactly two transport exceptions', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError('sensitive transport detail');
    });
    const fetchMock = fetchSpy as unknown as typeof fetch;

    let failure: unknown;
    try {
      await fetchReadOnlyWithRetry('https://staging.example/read', {}, fetchMock);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: 'StagingTransportFailure',
      message: 'Staging transport failed safely.',
    });
    expect(stagingTransportFailureEvidence(failure)).toEqual({
      operation: 'read_only',
      kind: 'network',
      attempts: 2,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('bounds deterministic fixture retries and never retries an HTTP response', async () => {
    const fetchSpy = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const fetchMock = fetchSpy as unknown as typeof fetch;
    const init = { method: 'PATCH', body: '{"fields":{}}' };

    const response = await fetchDeterministicFixtureWithRetry(
      'https://staging.example/document',
      init,
      fetchMock,
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.map((call) => call[0])).toEqual([
      'https://staging.example/document',
      'https://staging.example/document',
    ]);
    expect(fetchSpy.mock.calls.map((call) => call[1]?.body)).toEqual([init.body, init.body]);

    const httpSpy = vi.fn(async () => new Response('{}', { status: 503 }));
    const httpResponse = await fetchDeterministicFixtureWithRetry(
      'https://staging.example/document',
      init,
      httpSpy as unknown as typeof fetch,
    );
    expect(httpResponse.status).toBe(503);
    expect(httpSpy).toHaveBeenCalledTimes(1);
  });

  it('cancels an unread status-only response body', async () => {
    const response = new Response('{"discard":"me"}', { status: 403 });

    await discardResponseBody(response);

    expect(response.bodyUsed).toBe(true);
  });
});
