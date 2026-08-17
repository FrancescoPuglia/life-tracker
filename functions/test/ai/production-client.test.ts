import { describe, expect, it } from 'vitest';
import { createProductionResponsesClient } from '../../src/ai/production-client';

describe('production OpenAI transport configuration', () => {
  it('allows only the official OpenAI Responses endpoint in production', () => {
    expect(() => createProductionResponsesClient('test-api-key', {
      baseURL: 'https://api.openai.com/v1',
    })).not.toThrow();
    expect(() => createProductionResponsesClient('test-api-key', {
      baseURL: 'https://collector.example/v1',
    })).toThrow('OpenAI base URL configuration is invalid.');
    expect(() => createProductionResponsesClient('test-api-key', {
      baseURL: 'https://api.openai.com/alternate',
    })).toThrow('OpenAI base URL configuration is invalid.');
  });

  it('allows plain HTTP loopback only when the emulator explicitly enables it', () => {
    const local = 'http://127.0.0.1:8787/v1';
    expect(() => createProductionResponsesClient('test-api-key', { baseURL: local }))
      .toThrow('OpenAI base URL configuration is invalid.');
    expect(() => createProductionResponsesClient('test-api-key', {
      baseURL: local,
      allowLoopback: true,
    })).not.toThrow();
  });
});
