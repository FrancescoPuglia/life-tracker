import { describe, expect, it, vi } from 'vitest';
import { fetchReadOnlyWithRetry } from '../../../e2e/staging/read-only-transport';

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

  it('fails with a fixed safe message after exactly two transport exceptions', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError('sensitive transport detail');
    });
    const fetchMock = fetchSpy as unknown as typeof fetch;

    await expect(fetchReadOnlyWithRetry('https://staging.example/read', {}, fetchMock))
      .rejects.toThrow('Staging read-only transport failed after its bounded retry.');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
