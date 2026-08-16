import OpenAI from 'openai';
import type { ResponsesClientLike } from './responses-adapter';

type ResponseResult = Awaited<ReturnType<ResponsesClientLike['responses']['create']>>;

/** OpenAI SDK ownership stays inside the deployable backend package. */
export function createProductionResponsesClient(apiKey: string): ResponsesClientLike {
  const client = new OpenAI({
    apiKey,
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
