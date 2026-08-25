import { describe, expect, it } from 'vitest';
import {
  createMcpAuthorizationPage,
  parseMcpFirebaseWebConfig,
  type McpFirebaseWebConfig,
} from '../../src/mcp/auth-page';

const FIREBASE_CONFIG: McpFirebaseWebConfig = Object.freeze({
  apiKey: 'AIza-test-public-firebase-key',
  authDomain: 'life-tracker-12000.firebaseapp.com',
  projectId: 'life-tracker-12000',
  appId: '1:123:web:test',
});

describe('MCP Firebase consent page', () => {
  it('accepts only an exact public Firebase web configuration bound to its project', () => {
    expect(parseMcpFirebaseWebConfig(JSON.stringify(FIREBASE_CONFIG))).toEqual(FIREBASE_CONFIG);

    for (const value of [
      '{}',
      'not-json',
      JSON.stringify({ ...FIREBASE_CONFIG, authDomain: 'attacker.example' }),
      JSON.stringify({ ...FIREBASE_CONFIG, projectId: 'other-project' }),
      JSON.stringify({ ...FIREBASE_CONFIG, apiKey: 'provider-secret' }),
      JSON.stringify({ ...FIREBASE_CONFIG, appId: '</script><script>alert(1)</script>' }),
      JSON.stringify({ ...FIREBASE_CONFIG, serviceAccount: 'forbidden' }),
    ]) {
      expect(() => parseMcpFirebaseWebConfig(value)).toThrow(
        'MCP Firebase web configuration is invalid.',
      );
    }
  });

  it('renders one nonce-bound, non-cacheable-friendly read-only consent surface', () => {
    const page = createMcpAuthorizationPage(validPageInput());
    const nonce = page.contentSecurityPolicy.match(/script-src 'nonce-([A-Za-z0-9_-]+)'/)?.[1];

    expect(nonce).toBeTruthy();
    expect(page.contentSecurityPolicy).toContain("default-src 'none'");
    expect(page.contentSecurityPolicy).toContain("object-src 'none'");
    expect(page.contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(page.contentSecurityPolicy).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(page.html).toContain(`script type="module" nonce="${nonce}"`);
    expect(page.html).toContain(`style nonce="${nonce}"`);
    expect(page.html).toContain('Read-only access:');
    expect(page.html).toContain('No tool can create, update, delete, apply, or roll back data.');
    expect(page.html).toContain('browserSessionPersistence');
    expect(page.html).toContain('activeUser.getIdToken(true)');
    expect(page.html).toContain("credentials: 'same-origin'");
    expect(page.html).not.toMatch(/OPENAI_API_KEY|TWILIO_AUTH_TOKEN|RESEND_API_KEY|serviceAccount/);
  });

  it('rejects injected config, malformed opaque state, and endpoint substitution', () => {
    expect(() => createMcpAuthorizationPage(validPageInput({
      firebaseConfig: {
        ...FIREBASE_CONFIG,
        apiKey: 'AIza0123456789abcdef</script>',
      },
    }))).toThrow('MCP Firebase web configuration is invalid.');
    expect(() => createMcpAuthorizationPage(validPageInput({
      pendingId: `ltmcp_pd_${'a'.repeat(42)}<`,
    }))).toThrow('MCP authorization page state is invalid.');
    expect(() => createMcpAuthorizationPage(validPageInput({
      completeUrl: 'https://attacker.example/authorize/complete',
    }))).toThrow('MCP authorization endpoint is invalid.');
    expect(() => createMcpAuthorizationPage(validPageInput({
      denyUrl: 'https://mcp.example/not-deny',
    }))).toThrow('MCP authorization endpoint is invalid.');
    expect(() => createMcpAuthorizationPage(validPageInput({
      expiresAt: '</script><img src=x onerror=alert(1)>',
    }))).toThrow('MCP authorization page state is invalid.');
  });
});

function validPageInput(overrides: Partial<Parameters<typeof createMcpAuthorizationPage>[0]> = {}) {
  return {
    firebaseConfig: FIREBASE_CONFIG,
    pendingId: `ltmcp_pd_${'p'.repeat(43)}`,
    csrfToken: `ltmcp_cs_${'c'.repeat(43)}`,
    completeUrl: 'https://mcp.example/authorize/complete',
    denyUrl: 'https://mcp.example/authorize/deny',
    expiresAt: '2026-08-25T10:10:00.000Z',
    ...overrides,
  };
}
