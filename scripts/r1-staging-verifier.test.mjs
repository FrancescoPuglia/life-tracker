import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { verifyR1StagingBoundary } from './r1-staging-verifier.mjs';

const ENDPOINT =
  'https://europe-west1-life-tracker-staging.cloudfunctions.net/lifeTrackerAiApi/v1/health';
const BASELINE_RELEASE_ID =
  'sha256:5bfec76cae50f689f2d3da0fc445044364d96294e8ddafb6d9a4a0415a8a33b4';
const BASELINE_CONFIG_ID =
  'sha256:16636fe0025aa4db11ce7d875dfc341e3fc2d69f817945321c7812aff82393a9';
const DESKTOP_RELEASE_ID =
  'sha256:8bec8a4cea3b148f56f9fdd3b6643edcd1f64ac0dd05eb3f9f35c0eb9b342a06';
const DESKTOP_CONFIG_ID =
  'sha256:6ef03a915ff73a9d688bd416fd13a622b9effc9c5573963d39eb85d563e50a7f';

describe('R1 staging read-only verifier', () => {
  it('proves the baseline GET and authenticated-POST preflight allow/deny matrix', async () => {
    const calls = [];
    const receipt = await verifyR1StagingBoundary('baseline', {
      fetchImplementation: fakeFetch('baseline', calls),
    });

    assert.deepEqual(receipt, {
      status: 'PASS',
      profile: 'baseline',
      endpoint: ENDPOINT,
      allowedOriginCount: 2,
      deniedOriginCount: 6,
      requestCount: 16,
      releaseId: BASELINE_RELEASE_ID,
      runtimeConfigId: BASELINE_CONFIG_ID,
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      promptVersion: 'life-tracker-secure-v1',
      schemaVersion: 'life-plan-v1',
    });
    assert.equal(calls.length, 16);
    assert.equal(calls.every((call) => call.url === ENDPOINT), true);
    assert.equal(calls.every((call) => ['GET', 'OPTIONS'].includes(call.method)), true);
    assert.equal(calls.every((call) => call.authorization === null), true);
    assert.equal(calls.every((call) => call.body === null), true);
  });

  it('proves the post-deploy Desktop origin and keeps every near-match denied', async () => {
    const receipt = await verifyR1StagingBoundary('desktop', {
      fetchImplementation: fakeFetch('desktop'),
    });

    assert.equal(receipt.status, 'PASS');
    assert.equal(receipt.allowedOriginCount, 3);
    assert.equal(receipt.deniedOriginCount, 5);
    assert.equal(receipt.releaseId, DESKTOP_RELEASE_ID);
    assert.equal(receipt.runtimeConfigId, DESKTOP_CONFIG_ID);
  });

  it('fails closed on a fingerprint mismatch or a denied-origin CORS leak', async () => {
    await assert.rejects(
      verifyR1StagingBoundary('baseline', {
        fetchImplementation: fakeFetch('baseline', [], { releaseId: DESKTOP_RELEASE_ID }),
      }),
      /health authority does not match/,
    );
    await assert.rejects(
      verifyR1StagingBoundary('baseline', {
        fetchImplementation: fakeFetch('baseline', [], { leakDeniedOrigin: true }),
      }),
      /forbidden CORS header/,
    );
  });

  it('bounds response size and retries only one transport exception', async () => {
    await assert.rejects(
      verifyR1StagingBoundary('baseline', {
        fetchImplementation: fakeFetch('baseline', [], { declaredLength: 9_000 }),
      }),
      /exceeds the safe bound/,
    );

    let first = true;
    const delegated = fakeFetch('baseline');
    const receipt = await verifyR1StagingBoundary('baseline', {
      fetchImplementation: async (...args) => {
        if (first) {
          first = false;
          throw new TypeError('synthetic transport failure');
        }
        return delegated(...args);
      },
    });
    assert.equal(receipt.requestCount, 17);
  });

  it('rejects an invalid profile or unsafe timeout before any request', async () => {
    let calls = 0;
    const fetchImplementation = async () => {
      calls += 1;
      throw new Error('must not run');
    };
    await assert.rejects(
      verifyR1StagingBoundary('unknown', { fetchImplementation }),
      /profile is invalid/,
    );
    await assert.rejects(
      verifyR1StagingBoundary('baseline', { fetchImplementation, timeoutMs: 999 }),
      /timeout is invalid/,
    );
    assert.equal(calls, 0);
  });
});

function fakeFetch(profileName, calls = [], overrides = {}) {
  const desktop = profileName === 'desktop';
  const allowed = new Set([
    'http://127.0.0.1:3300',
    'https://life-tracker-staging.web.app',
    ...(desktop ? ['https://tauri.localhost'] : []),
  ]);
  return async (url, init = {}) => {
    const headers = new Headers(init.headers);
    const origin = headers.get('origin');
    const method = init.method ?? 'GET';
    calls.push({
      url,
      method,
      authorization: headers.get('authorization'),
      body: init.body ?? null,
    });
    assert.equal(url, ENDPOINT);
    assert.equal(typeof origin, 'string');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);

    if (!allowed.has(origin)) {
      const deniedHeaders = overrides.leakDeniedOrigin
        ? { 'Access-Control-Allow-Origin': origin }
        : undefined;
      return new Response('{"error":{"code":"FORBIDDEN"}}', {
        status: 403,
        headers: deniedHeaders,
      });
    }

    if (method === 'OPTIONS') {
      assert.equal(headers.get('access-control-request-method'), 'POST');
      assert.equal(
        headers.get('access-control-request-headers'),
        'authorization,content-type,x-request-id',
      );
      return new Response(null, {
        status: 204,
        headers: allowedHeaders(origin, true),
      });
    }

    assert.equal(method, 'GET');
    const releaseId = overrides.releaseId
      ?? (desktop ? DESKTOP_RELEASE_ID : BASELINE_RELEASE_ID);
    const configId = desktop ? DESKTOP_CONFIG_ID : BASELINE_CONFIG_ID;
    const body = JSON.stringify({
      status: 'ok',
      service: 'life-tracker-ai',
      releaseId,
      runtimeConfig: {
        configId,
        model: 'gpt-5.6-sol',
        reasoningEffort: 'medium',
        promptVersion: 'life-tracker-secure-v1',
        schemaVersion: 'life-plan-v1',
      },
      requestId: '123e4567-e89b-42d3-a456-426614174000',
    });
    const responseHeaders = allowedHeaders(origin, false);
    responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
    if (overrides.declaredLength) {
      responseHeaders.set('Content-Length', String(overrides.declaredLength));
    }
    return new Response(body, { status: 200, headers: responseHeaders });
  };
}

function allowedHeaders(origin, preflight) {
  const headers = new Headers({
    'Access-Control-Allow-Origin': origin,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  });
  if (preflight) {
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
    headers.set('Access-Control-Max-Age', '600');
  }
  return headers;
}
