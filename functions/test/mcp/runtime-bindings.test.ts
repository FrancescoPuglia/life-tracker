import { describe, expect, it } from 'vitest';
import {
  lifeTrackerMcp,
  resolveMcpRuntimeConfig,
  type McpRuntimeParameters,
} from '../../src/mcp/runtime-bindings';

describe('private MCP runtime binding', () => {
  it('exports one bounded public edge with no provider secret binding', () => {
    const metadata = endpoint(lifeTrackerMcp);

    expect(metadata).toMatchObject({
      region: ['europe-west1'],
      timeoutSeconds: 60,
      availableMemoryMb: 512,
      concurrency: 20,
      maxInstances: 2,
      platform: 'gcfv2',
    });
    expect(JSON.stringify(metadata)).not.toMatch(
      /OPENAI_API_KEY|TWILIO_AUTH_TOKEN|RESEND_API_KEY|secretEnvironment/i,
    );
  });

  it('fails closed at the kill switch before reading owner or public configuration', () => {
    const parameters = fakeParameters({ enabled: 'false' });

    expect(() => resolveMcpRuntimeConfig(parameters.values)).toThrow('disabled');
    expect(parameters.reads).toEqual({
      enabled: 1,
      ownerUid: 0,
      canonicalBaseUrl: 0,
      firebaseWebConfig: 0,
    });
  });

  it('resolves an exact owner, HTTPS endpoint, and project-bound public Firebase config', () => {
    const parameters = fakeParameters();

    expect(resolveMcpRuntimeConfig(parameters.values, 'life-tracker-12000')).toEqual({
      ownerUid: 'firebase-owner',
      canonicalBaseUrl: 'https://mcp.example',
      firebaseWebConfig: {
        apiKey: 'AIza-test-public-firebase-key',
        authDomain: 'life-tracker-12000.firebaseapp.com',
        projectId: 'life-tracker-12000',
        appId: '1:123:web:test',
      },
    });
    expect(parameters.reads).toEqual({
      enabled: 1,
      ownerUid: 1,
      canonicalBaseUrl: 1,
      firebaseWebConfig: 1,
    });
  });

  it.each([
    { ownerUid: 'not-configured' },
    { ownerUid: 'forged owner' },
    { canonicalBaseUrl: 'http://mcp.example' },
    { canonicalBaseUrl: 'https://invalid.example' },
    { canonicalBaseUrl: 'https://mcp.example/lifeTrackerMcp' },
    { firebaseWebConfig: '{}' },
  ])('rejects unresolved or malformed runtime configuration %#', (override) => {
    const parameters = fakeParameters(override);
    expect(() => resolveMcpRuntimeConfig(parameters.values)).toThrow();
  });

  it('rejects a Firebase web project different from the deployed project', () => {
    const parameters = fakeParameters();
    expect(() => resolveMcpRuntimeConfig(parameters.values, 'other-project'))
      .toThrow('project binding');
  });
});

class RuntimeReader {
  reads = 0;

  constructor(private readonly content: string) {}

  value(): string {
    this.reads += 1;
    return this.content;
  }
}

function fakeParameters(overrides: Partial<Record<keyof McpRuntimeParameters, string>> = {}) {
  const raw = {
    enabled: 'true',
    ownerUid: 'firebase-owner',
    canonicalBaseUrl: 'https://mcp.example',
    firebaseWebConfig: JSON.stringify({
      apiKey: 'AIza-test-public-firebase-key',
      authDomain: 'life-tracker-12000.firebaseapp.com',
      projectId: 'life-tracker-12000',
      appId: '1:123:web:test',
    }),
    ...overrides,
  };
  const readers = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, new RuntimeReader(value)]),
  ) as Record<keyof McpRuntimeParameters, RuntimeReader>;
  const reads = {} as Record<keyof McpRuntimeParameters, number>;
  Object.defineProperties(reads, Object.fromEntries(
    Object.entries(readers).map(([key, reader]) => [key, {
      enumerable: true,
      get: () => reader.reads,
    }]),
  ));
  return { values: readers as McpRuntimeParameters, reads };
}

function endpoint(value: unknown): Record<string, unknown> {
  return (value as { __endpoint: Record<string, unknown> }).__endpoint;
}
