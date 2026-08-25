import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { defineString } from 'firebase-functions/params';
import * as functionsLogger from 'firebase-functions/logger';
import { onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';
import { createLifeTrackerDomain } from '../domain/factory';
import { FirestoreRepository } from '../domain/firestore-repository';
import { FirestoreScientificReportArchiveRepository } from '../reports/firestore-archive-repository';
import {
  parseMcpFirebaseWebConfig,
  type McpFirebaseWebConfig,
} from './auth-page';
import { AdminFirebaseMcpIdentityVerifier } from './firebase-identity';
import { FirestoreMcpOAuthRepository } from './firestore-oauth-repository';
import { createLifeTrackerMcpHttpApp } from './http-app';
import {
  LifeTrackerMcpOAuthService,
  normalizeMcpCanonicalBaseUrl,
} from './oauth-service';
import { FirestoreMcpReadRateLimiter } from './rate-limiter';
import { LifeTrackerMcpReadService } from './read-service';
import { ReadOnlyMcpDomainAdapter } from './read-only-adapter';

export interface McpRuntimeStringValue {
  value(): string;
}

export interface McpRuntimeParameters {
  readonly enabled: McpRuntimeStringValue;
  readonly ownerUid: McpRuntimeStringValue;
  readonly canonicalBaseUrl: McpRuntimeStringValue;
  readonly firebaseWebConfig: McpRuntimeStringValue;
}

export interface ResolvedMcpRuntimeConfig {
  readonly ownerUid: string;
  readonly canonicalBaseUrl: string;
  readonly firebaseWebConfig: McpFirebaseWebConfig;
}

const MCP_READ_RUNTIME_ENABLED = defineString('MCP_READ_RUNTIME_ENABLED', {
  default: 'false',
  description: 'Explicit kill switch. Only the exact value true enables private MCP reads.',
});
const MCP_OWNER_UID = defineString('MCP_OWNER_UID', {
  default: 'not-configured',
  description: 'The sole Firebase UID permitted to link this private personal MCP server.',
});
const MCP_CANONICAL_BASE_URL = defineString('MCP_CANONICAL_BASE_URL', {
  default: 'https://invalid.example',
  description: 'Exact public HTTPS origin of the deployed MCP service, without any path.',
});
const MCP_FIREBASE_WEB_CONFIG = defineString('MCP_FIREBASE_WEB_CONFIG', {
  default: '{}',
  description: 'Public Firebase web configuration JSON used only by the OAuth consent page.',
});

const runtimeParameters: McpRuntimeParameters = Object.freeze({
  enabled: MCP_READ_RUNTIME_ENABLED,
  ownerUid: MCP_OWNER_UID,
  canonicalBaseUrl: MCP_CANONICAL_BASE_URL,
  firebaseWebConfig: MCP_FIREBASE_WEB_CONFIG,
});

let cachedHttpApp: ReturnType<typeof createLifeTrackerMcpHttpApp> | undefined;

export const lifeTrackerMcp = onRequest({
  region: 'europe-west1',
  timeoutSeconds: 60,
  memory: '512MiB',
  concurrency: 20,
  maxInstances: 2,
  cors: false,
  invoker: 'public',
}, async (request, response) => {
  if (runtimeParameters.enabled.value() !== 'true') {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.status(503).json({ error: 'mcp_read_access_disabled' });
    return;
  }
  try {
    const app = cachedHttpApp ??= createProductionMcpHttpApp(
      resolveMcpRuntimeConfig(runtimeParameters),
    );
    await invokeExpress(app, request, response);
  } catch {
    functionsLogger.error('Life Tracker MCP runtime initialization failed safely.', {
      code: 'MCP_RUNTIME_INITIALIZATION_FAILED',
    });
    if (!response.headersSent) {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.status(500).json({ error: 'mcp_request_failed' });
    }
  }
});

export function resolveMcpRuntimeConfig(
  parameters: McpRuntimeParameters,
  expectedProjectId?: string,
): ResolvedMcpRuntimeConfig {
  if (parameters.enabled.value() !== 'true') {
    throw new Error('MCP read runtime is disabled.');
  }
  const ownerUid = runtimeString(parameters.ownerUid, 'MCP owner UID', 128);
  if (ownerUid === 'not-configured' || !/^[A-Za-z0-9:_-]{1,128}$/.test(ownerUid)) {
    throw new Error('MCP owner UID configuration is invalid.');
  }
  const rawCanonicalBaseUrl = runtimeString(
    parameters.canonicalBaseUrl,
    'MCP canonical base URL',
    2_048,
  );
  const canonicalBaseUrl = normalizeMcpCanonicalBaseUrl(rawCanonicalBaseUrl);
  if (canonicalBaseUrl === 'https://invalid.example') {
    throw new Error('MCP canonical base URL configuration is invalid.');
  }
  const firebaseWebConfig = parseMcpFirebaseWebConfig(
    runtimeString(parameters.firebaseWebConfig, 'MCP Firebase web configuration', 4_096),
  );
  if (expectedProjectId && firebaseWebConfig.projectId !== expectedProjectId) {
    throw new Error('MCP Firebase project binding is invalid.');
  }
  return Object.freeze({ ownerUid, canonicalBaseUrl, firebaseWebConfig });
}

function createProductionMcpHttpApp(config: ResolvedMcpRuntimeConfig) {
  const app = getApps()[0] ?? initializeApp();
  const firestore = getFirestore(app);
  const auth = getAuth(app);
  const projectId = app.options.projectId
    ?? process.env.GCLOUD_PROJECT
    ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId || config.firebaseWebConfig.projectId !== projectId) {
    throw new Error('MCP Firebase project binding is invalid.');
  }
  const domain = createLifeTrackerDomain(new FirestoreRepository(firestore));
  const reads = new LifeTrackerMcpReadService(
    new ReadOnlyMcpDomainAdapter(domain.registry, domain.executor, true),
    new FirestoreScientificReportArchiveRepository(firestore),
  );
  const oauth = new LifeTrackerMcpOAuthService(
    new FirestoreMcpOAuthRepository(firestore, config.ownerUid),
    new AdminFirebaseMcpIdentityVerifier(auth),
    config.ownerUid,
    config.canonicalBaseUrl,
  );
  return createLifeTrackerMcpHttpApp({
    oauth,
    reads,
    firebaseWebConfig: config.firebaseWebConfig,
    rateLimiter: new FirestoreMcpReadRateLimiter(firestore),
    logger: functionsLogger,
  });
}

function runtimeString(
  parameter: McpRuntimeStringValue,
  label: string,
  maximum: number,
): string {
  const value = parameter.value();
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new Error(`${label} is invalid.`);
  return value;
}

function invokeExpress(
  app: ReturnType<typeof createLifeTrackerMcpHttpApp>,
  request: Request,
  response: Response,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const complete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    response.once('finish', complete);
    response.once('close', complete);
    try {
      app(request, response);
    } catch (error) {
      reject(error);
    }
  });
}
