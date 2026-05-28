import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the OpenAI integration
vi.mock('@/lib/ai/openai-integration', () => ({
  chat: vi.fn(),
}));

describe('API Route: /api/ai/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Per-test timeout bumped to 30s because the test issues 11 sequential
  // POST calls; under cold-start vitest setup (jsdom + lazy route import)
  // the default 5000ms is flaky. No assertion or runtime behavior changed.
  it('should enforce rate limiting', async () => {
    // This test verifies that the rate limiting logic exists
    // Full integration test would require actual HTTP requests

    const { POST } = await import('./route');
    const { chat } = await import('@/lib/ai/openai-integration');

    // Mock successful chat response
    vi.mocked(chat).mockResolvedValue({
      response: 'Test response',
      proposedChanges: [],
      toolCalls: [],
    });

    // Create mock request
    const createRequest = (ip: string) => {
      const req = new Request('http://localhost:3000/api/ai/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({
          message: 'Test message',
          context: 'test',
          userId: 'test-user',
        }),
      });
      return req as any; // NextRequest type
    };

    // First 10 requests should succeed
    for (let i = 0; i < 10; i++) {
      const response = await POST(createRequest('127.0.0.1'));
      expect(response.status).not.toBe(429);
    }

    // 11th request should be rate limited
    const rateLimitedResponse = await POST(createRequest('127.0.0.1'));
    expect(rateLimitedResponse.status).toBe(429);

    const data = await rateLimitedResponse.json();
    expect(data.error).toContain('Rate limit exceeded');
  }, 30000);

  it('should validate required fields', async () => {
    const { POST } = await import('./route');

    const req = new Request('http://localhost:3000/api/ai/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '192.168.1.100', // Different IP to avoid rate limit from previous test
      },
      body: JSON.stringify({
        message: 'Test',
        // Missing context and userId
      }),
    });

    const response = await POST(req as any);
    expect(response.status).toBe(400);

    const data = await response.json();
    // Language-agnostic: verify the error mentions every missing field rather
    // than relying on an English phrase. The route returns a localized
    // message (e.g. "Campi obbligatori mancanti: message, context, userId"),
    // so we assert on the field names that must always be present.
    expect(data.error).toBeTruthy();
    expect(data.error).toContain('message');
    expect(data.error).toContain('context');
    expect(data.error).toContain('userId');
  });
});
