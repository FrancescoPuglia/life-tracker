import OpenAI from 'openai';
import type { ResponsesClientLike } from './responses-adapter';

type ResponseResult = Awaited<ReturnType<ResponsesClientLike['responses']['create']>>;

/** OpenAI SDK ownership stays inside the deployable backend package. */
export function createProductionResponsesClient(
  apiKey: string,
  options: Readonly<{ baseURL?: string; allowLoopback?: boolean }> = {},
): ResponsesClientLike {
  const client = new OpenAI({
    apiKey,
    ...(options.baseURL
      ? { baseURL: validateProviderBaseUrl(options.baseURL, options.allowLoopback === true) }
      : {}),
    maxRetries: 1,
    timeout: 30_000,
  });
  return {
    responses: {
      async create(request, options): Promise<ResponseResult> {
        const response = await client.responses.create(
          request as OpenAI.Responses.ResponseCreateParamsNonStreaming,
          options?.signal ? { signal: options.signal } : undefined,
        );
        return response as unknown as ResponseResult;
      },
    },
  };
}

export function validateProviderBaseUrl(value: string, allowLoopback: boolean): string {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  const officialOpenAi = url.protocol === 'https:'
    && url.hostname === 'api.openai.com'
    && !url.port
    && (url.pathname === '/v1' || url.pathname === '/v1/');
  const localEmulator = allowLoopback
    && url.protocol === 'http:'
    && loopback
    && (url.pathname === '/v1' || url.pathname === '/v1/');
  if (
    (!officialOpenAi && !localEmulator)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error('OpenAI base URL configuration is invalid.');
  }
  return url.toString().replace(/\/$/, '');
}
