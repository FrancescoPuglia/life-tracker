import { pathToFileURL } from 'node:url';

const STAGING_HEALTH_URL =
  'https://europe-west1-life-tracker-staging.cloudfunctions.net/lifeTrackerAiApi/v1/health';
const MAX_RESPONSE_BYTES = 8 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TRANSPORT_ATTEMPTS = 2;

const BASELINE_RELEASE_ID =
  'sha256:5bfec76cae50f689f2d3da0fc445044364d96294e8ddafb6d9a4a0415a8a33b4';
const BASELINE_CONFIG_ID =
  'sha256:16636fe0025aa4db11ce7d875dfc341e3fc2d69f817945321c7812aff82393a9';
const DESKTOP_RELEASE_ID =
  'sha256:8bec8a4cea3b148f56f9fdd3b6643edcd1f64ac0dd05eb3f9f35c0eb9b342a06';
const DESKTOP_CONFIG_ID =
  'sha256:6ef03a915ff73a9d688bd416fd13a622b9effc9c5573963d39eb85d563e50a7f';

const LOCAL_VERIFICATION_ORIGIN = 'http://127.0.0.1:3300';
const STAGING_HOSTING_ORIGIN = 'https://life-tracker-staging.web.app';
const DESKTOP_ORIGIN = 'https://tauri.localhost';
const DENIED_ORIGINS = Object.freeze([
  'http://tauri.localhost',
  'https://evil.tauri.localhost',
  'https://tauri.localhost:443',
  'https://francescopuglia.github.io',
  'https://attacker.invalid',
]);

const PROFILES = Object.freeze({
  baseline: Object.freeze({
    releaseId: BASELINE_RELEASE_ID,
    configId: BASELINE_CONFIG_ID,
    allowedOrigins: Object.freeze([
      LOCAL_VERIFICATION_ORIGIN,
      STAGING_HOSTING_ORIGIN,
    ]),
    deniedOrigins: Object.freeze([DESKTOP_ORIGIN, ...DENIED_ORIGINS]),
  }),
  desktop: Object.freeze({
    releaseId: DESKTOP_RELEASE_ID,
    configId: DESKTOP_CONFIG_ID,
    allowedOrigins: Object.freeze([
      LOCAL_VERIFICATION_ORIGIN,
      STAGING_HOSTING_ORIGIN,
      DESKTOP_ORIGIN,
    ]),
    deniedOrigins: DENIED_ORIGINS,
  }),
});

/**
 * Prove the public, provider-free R1 health/CORS boundary. This function never
 * sends authentication, request content, a provider call, or a mutation.
 *
 * @param {'baseline' | 'desktop'} profileName
 * @param {{ fetchImplementation?: typeof fetch, timeoutMs?: number }} options
 */
export async function verifyR1StagingBoundary(profileName, options = {}) {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error('R1 staging verifier profile is invalid.');
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  if (typeof fetchImplementation !== 'function') {
    throw new Error('R1 staging verifier requires a fetch implementation.');
  }
  const timeoutMs = validTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let requestCount = 0;

  for (const origin of profile.allowedOrigins) {
    const health = await safeFetch(fetchImplementation, origin, 'GET', timeoutMs);
    requestCount += health.attempts;
    await requireAllowedHealth(health.response, origin, profile);

    const preflight = await safeFetch(fetchImplementation, origin, 'OPTIONS', timeoutMs);
    requestCount += preflight.attempts;
    await requireAllowedPreflight(preflight.response, origin);
  }

  for (const origin of profile.deniedOrigins) {
    const health = await safeFetch(fetchImplementation, origin, 'GET', timeoutMs);
    requestCount += health.attempts;
    await requireDenied(health.response);

    const preflight = await safeFetch(fetchImplementation, origin, 'OPTIONS', timeoutMs);
    requestCount += preflight.attempts;
    await requireDenied(preflight.response);
  }

  return Object.freeze({
    status: 'PASS',
    profile: profileName,
    endpoint: STAGING_HEALTH_URL,
    allowedOriginCount: profile.allowedOrigins.length,
    deniedOriginCount: profile.deniedOrigins.length,
    requestCount,
    releaseId: profile.releaseId,
    runtimeConfigId: profile.configId,
    model: 'gpt-5.6-sol',
    reasoningEffort: 'medium',
    promptVersion: 'life-tracker-secure-v1',
    schemaVersion: 'life-plan-v1',
  });
}

async function safeFetch(fetchImplementation, origin, method, timeoutMs) {
  for (let attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
    try {
      const headers = method === 'OPTIONS'
        ? {
            Origin: origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'authorization,content-type,x-request-id',
          }
        : { Origin: origin, Accept: 'application/json' };
      const response = await fetchImplementation(STAGING_HEALTH_URL, {
        method,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { response, attempts: attempt };
    } catch (error) {
      if (attempt < MAX_TRANSPORT_ATTEMPTS && isRetryableTransportError(error)) continue;
      throw new Error('R1 staging verifier transport failed safely.');
    }
  }
  throw new Error('R1 staging verifier transport failed safely.');
}

async function requireAllowedHealth(response, origin, profile) {
  requireStatus(response, 200);
  requireHeader(response, 'access-control-allow-origin', origin);
  requireHeader(response, 'cache-control', 'no-store');
  requireHeader(response, 'x-content-type-options', 'nosniff');
  requireTokenHeader(response, 'vary', 'origin');
  requireAbsentHeader(response, 'access-control-allow-credentials');
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new Error('R1 staging health content type is invalid.');
  }
  const body = await readBoundedJson(response);
  requireExactKeys(body, ['releaseId', 'requestId', 'runtimeConfig', 'service', 'status']);
  if (
    body.status !== 'ok'
    || body.service !== 'life-tracker-ai'
    || body.releaseId !== profile.releaseId
    || typeof body.requestId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)
  ) {
    throw new Error('R1 staging health authority does not match the reviewed profile.');
  }
  requireExactKeys(body.runtimeConfig, [
    'configId',
    'model',
    'promptVersion',
    'reasoningEffort',
    'schemaVersion',
  ]);
  if (
    body.runtimeConfig.configId !== profile.configId
    || body.runtimeConfig.model !== 'gpt-5.6-sol'
    || body.runtimeConfig.reasoningEffort !== 'medium'
    || body.runtimeConfig.promptVersion !== 'life-tracker-secure-v1'
    || body.runtimeConfig.schemaVersion !== 'life-plan-v1'
  ) {
    throw new Error('R1 staging runtime configuration does not match the reviewed profile.');
  }
}

async function requireAllowedPreflight(response, origin) {
  requireStatus(response, 204);
  requireHeader(response, 'access-control-allow-origin', origin);
  requireHeader(response, 'cache-control', 'no-store');
  requireHeader(response, 'x-content-type-options', 'nosniff');
  requireTokenHeader(response, 'vary', 'origin');
  requireTokenHeader(response, 'access-control-allow-methods', 'post');
  requireTokenHeader(response, 'access-control-allow-headers', 'authorization');
  requireTokenHeader(response, 'access-control-allow-headers', 'content-type');
  requireTokenHeader(response, 'access-control-allow-headers', 'x-request-id');
  requireHeader(response, 'access-control-max-age', '600');
  requireAbsentHeader(response, 'access-control-allow-credentials');
  await discardBody(response);
}

async function requireDenied(response) {
  requireStatus(response, 403);
  requireAbsentHeader(response, 'access-control-allow-origin');
  requireAbsentHeader(response, 'access-control-allow-credentials');
  await discardBody(response);
}

function requireStatus(response, expected) {
  if (!(response instanceof Response) || response.status !== expected) {
    throw new Error('R1 staging response status does not match the reviewed profile.');
  }
}

function requireHeader(response, name, expected) {
  if (response.headers.get(name) !== expected) {
    throw new Error('R1 staging response header does not match the reviewed profile.');
  }
}

function requireAbsentHeader(response, name) {
  if (response.headers.get(name) !== null) {
    throw new Error('R1 staging response exposed a forbidden CORS header.');
  }
}

function requireTokenHeader(response, name, expectedToken) {
  const tokens = (response.headers.get(name) ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!tokens.includes(expectedToken.toLowerCase())) {
    throw new Error('R1 staging response header token is missing.');
  }
}

async function readBoundedJson(response) {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) {
    throw new Error('R1 staging health response exceeds the safe bound.');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error('R1 staging health response exceeds the safe bound.');
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error('R1 staging health response is invalid JSON.');
  }
}

function requireExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('R1 staging health response shape is invalid.');
  }
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('R1 staging health response shape is invalid.');
  }
}

async function discardBody(response) {
  if (!response.body || response.bodyUsed) return;
  try {
    await response.body.cancel();
  } catch {
    // Status and headers are the complete denied/preflight evidence surface.
  }
}

function isRetryableTransportError(error) {
  return error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError');
}

function validTimeout(value) {
  if (!Number.isInteger(value) || value < 1_000 || value > 60_000) {
    throw new Error('R1 staging verifier timeout is invalid.');
  }
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const profileName = process.argv[2];
  verifyR1StagingBoundary(profileName)
    .then((receipt) => process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'R1 staging verification failed.'}\n`);
      process.exitCode = 1;
    });
}
