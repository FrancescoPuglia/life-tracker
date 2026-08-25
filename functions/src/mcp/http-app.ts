import { randomUUID, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { isDomainError } from '../domain/errors';
import {
  createMcpAuthorizationPage,
  type McpFirebaseWebConfig,
} from './auth-page';
import { LifeTrackerMcpOAuthService } from './oauth-service';
import type { McpReadRateLimiter } from './rate-limiter';
import { NOOP_MCP_READ_RATE_LIMITER } from './rate-limiter';
import { LifeTrackerMcpReadService } from './read-service';
import { createLifeTrackerMcpServer } from './server';
import { MCP_READ_SCOPE } from './tool-contracts';

const MAX_JSON_BODY = '64kb';
const MAX_FORM_BODY = '16kb';
const CSRF_COOKIE = '__Host-lt_mcp_csrf';

const authorizeSchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1).max(512),
  redirect_uri: z.string().url().max(2_048),
  scope: z.literal(MCP_READ_SCOPE),
  state: z.string().min(16).max(512),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal('S256'),
  resource: z.string().url().max(2_048),
}).strict();

const completeSchema = z.object({
  pendingId: z.string().regex(/^ltmcp_pd_[A-Za-z0-9_-]{43}$/),
  firebaseIdToken: z.string().min(20).max(16_384),
}).strict();

const denySchema = z.object({
  pendingId: z.string().regex(/^ltmcp_pd_[A-Za-z0-9_-]{43}$/),
}).strict();

const authorizationCodeTokenSchema = z.object({
  grant_type: z.literal('authorization_code'),
  client_id: z.string().min(1).max(512),
  code: z.string().regex(/^ltmcp_cd_[A-Za-z0-9_-]{43}$/),
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  redirect_uri: z.string().url().max(2_048),
  resource: z.string().url().max(2_048),
}).strict();

const refreshTokenSchema = z.object({
  grant_type: z.literal('refresh_token'),
  client_id: z.string().min(1).max(512),
  refresh_token: z.string().regex(/^ltmcp_rt_[A-Za-z0-9_-]{43}$/),
  scope: z.literal(MCP_READ_SCOPE).optional(),
  resource: z.string().url().max(2_048),
}).strict();

const revokeSchema = z.object({
  client_id: z.string().min(1).max(512),
  token: z.string().min(1).max(256),
  token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
}).strict();

export interface McpHttpLogger {
  error(message: string, metadata: Readonly<Record<string, unknown>>): void;
}

export interface LifeTrackerMcpHttpDependencies {
  readonly oauth: LifeTrackerMcpOAuthService;
  readonly reads: LifeTrackerMcpReadService;
  readonly firebaseWebConfig: McpFirebaseWebConfig;
  readonly rateLimiter?: McpReadRateLimiter;
  readonly logger?: McpHttpLogger;
  readonly requestId?: () => string;
}

export function createLifeTrackerMcpHttpApp(
  dependencies: LifeTrackerMcpHttpDependencies,
) {
  const app = express();
  const rateLimiter = dependencies.rateLimiter ?? NOOP_MCP_READ_RATE_LIMITER;
  const requestId = dependencies.requestId ?? (() => randomUUID());
  const canonical = new URL(dependencies.oauth.issuer);
  const expectedOrigin = canonical.origin;
  const cookiePath = canonical.pathname;

  app.disable('x-powered-by');
  app.use((request, response, next) => {
    const id = requestId();
    response.locals.requestId = id;
    response.setHeader('X-Request-Id', id);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.get('/health', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({
      status: 'ok',
      service: 'life-tracker-private-mcp',
      oauth: 'required',
      readToolCount: dependencies.reads.names().length,
      writeToolCount: 0,
      scope: MCP_READ_SCOPE,
    });
  });

  app.get('/.well-known/oauth-protected-resource', (_request, response) => {
    response.setHeader('Cache-Control', 'public, max-age=300');
    response.status(200).json(dependencies.oauth.protectedResourceMetadata());
  });

  app.get('/.well-known/oauth-authorization-server', (_request, response) => {
    response.setHeader('Cache-Control', 'public, max-age=300');
    response.status(200).json(dependencies.oauth.authorizationServerMetadata());
  });

  app.get('/authorize', async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const parsed = authorizeSchema.safeParse(request.query);
    if (!parsed.success) {
      sendAuthorizationError(request, response, dependencies.oauth);
      return;
    }
    try {
      const pending = await dependencies.oauth.beginAuthorization({
        clientId: parsed.data.client_id,
        redirectUri: parsed.data.redirect_uri,
        state: parsed.data.state,
        scopes: [parsed.data.scope],
        codeChallenge: parsed.data.code_challenge,
        resource: parsed.data.resource,
      });
      const page = createMcpAuthorizationPage({
        firebaseConfig: dependencies.firebaseWebConfig,
        pendingId: pending.pendingId,
        csrfToken: pending.csrfToken,
        completeUrl: `${dependencies.oauth.issuer}/authorize/complete`,
        denyUrl: `${dependencies.oauth.issuer}/authorize/deny`,
        expiresAt: pending.expiresAt,
      });
      response.setHeader('Content-Security-Policy', page.contentSecurityPolicy);
      response.setHeader('Set-Cookie', csrfCookie(pending.csrfToken, cookiePath, 600));
      response.status(200).type('html').send(page.html);
    } catch (error) {
      logSafe(dependencies, response, request.path, error);
      sendAuthorizationError(request, response, dependencies.oauth);
    }
  });

  app.post(
    '/authorize/complete',
    express.json({ limit: MAX_JSON_BODY, strict: true }),
    async (request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      try {
        assertSameOrigin(request, expectedOrigin);
        const body = completeSchema.parse(request.body);
        const csrfToken = assertCsrf(request);
        const redirectUrl = await dependencies.oauth.completeAuthorization({
          pendingId: body.pendingId,
          csrfToken,
          firebaseIdToken: body.firebaseIdToken,
        });
        response.setHeader('Set-Cookie', csrfCookie('', cookiePath, 0));
        response.status(200).json({ redirectUrl });
      } catch (error) {
        logSafe(dependencies, response, request.path, error);
        sendPrivateError(response, error);
      }
    },
  );

  app.post(
    '/authorize/deny',
    express.json({ limit: MAX_JSON_BODY, strict: true }),
    async (request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      try {
        assertSameOrigin(request, expectedOrigin);
        const body = denySchema.parse(request.body);
        const csrfToken = assertCsrf(request);
        const redirectUrl = await dependencies.oauth.denyAuthorization({
          pendingId: body.pendingId,
          csrfToken,
        });
        response.setHeader('Set-Cookie', csrfCookie('', cookiePath, 0));
        response.status(200).json({ redirectUrl });
      } catch (error) {
        logSafe(dependencies, response, request.path, error);
        sendPrivateError(response, error);
      }
    },
  );

  app.post(
    '/token',
    express.urlencoded({ extended: false, limit: MAX_FORM_BODY }),
    async (request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      try {
        const codeGrant = authorizationCodeTokenSchema.safeParse(request.body);
        if (codeGrant.success) {
          const tokens = await dependencies.oauth.exchangeAuthorizationCode({
            clientId: codeGrant.data.client_id,
            code: codeGrant.data.code,
            codeVerifier: codeGrant.data.code_verifier,
            redirectUri: codeGrant.data.redirect_uri,
            resource: codeGrant.data.resource,
          });
          response.status(200).json(tokens);
          return;
        }
        const refreshGrant = refreshTokenSchema.safeParse(request.body);
        if (refreshGrant.success) {
          const tokens = await dependencies.oauth.exchangeRefreshToken({
            clientId: refreshGrant.data.client_id,
            refreshToken: refreshGrant.data.refresh_token,
            scopes: refreshGrant.data.scope ? [refreshGrant.data.scope] : null,
            resource: refreshGrant.data.resource,
          });
          response.status(200).json(tokens);
          return;
        }
        sendOAuthError(response, 'invalid_request', 400);
      } catch (error) {
        logSafe(dependencies, response, request.path, error);
        sendOAuthError(response, oauthErrorCode(error, 'invalid_grant'), 400);
      }
    },
  );

  app.post(
    '/revoke',
    express.urlencoded({ extended: false, limit: MAX_FORM_BODY }),
    async (request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      try {
        const body = revokeSchema.parse(request.body);
        await dependencies.oauth.revokeToken(body.token, body.client_id);
        response.status(200).json({});
      } catch (error) {
        logSafe(dependencies, response, request.path, error);
        if (isDomainError(error) && error.code === 'UNAUTHENTICATED') {
          sendOAuthError(response, 'invalid_client', 401);
          return;
        }
        sendOAuthError(response, 'invalid_request', 400);
      }
    },
  );

  app.all(
    '/mcp',
    async (request, response, next) => {
      try {
        const token = bearerToken(request.headers.authorization);
        const auth = await dependencies.oauth.verifyAccessToken(token);
        (request as Request & { auth?: AuthInfo }).auth = auth;
        next();
      } catch (error) {
        logSafe(dependencies, response, request.path, error);
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('WWW-Authenticate', dependencies.oauth.challenge());
        response.status(401).json({ error: 'invalid_token' });
      }
    },
    express.json({ limit: MAX_JSON_BODY, strict: false }),
    async (request, response) => {
      const auth = (request as Request & { auth?: AuthInfo }).auth;
      const uid = auth?.extra?.uid;
      if (typeof uid !== 'string') {
        response.setHeader('WWW-Authenticate', dependencies.oauth.challenge());
        response.status(401).json({ error: 'invalid_token' });
        return;
      }
      try {
        await rateLimiter.consume(uid, new Date());
      } catch (error) {
        logSafe(dependencies, response, request.path, error);
        response.setHeader('Retry-After', retryAfter(error));
        response.status(429).json({
          jsonrpc: '2.0',
          id: mcpRequestId(request.body),
          error: { code: -32000, message: 'Too many Life Tracker read requests.' },
        });
        return;
      }
      const server = createLifeTrackerMcpServer(
        dependencies.reads,
        dependencies.oauth.challenge(),
        () => String(response.locals.requestId),
      );
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
      });
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        void server.close();
      };
      response.on('close', close);
      try {
        // SDK 1.30's exact-optional TypeScript declarations disagree between
        // its Node transport wrapper and shared Transport interface; the
        // runtime class implements that interface directly.
        await server.connect(transport as unknown as Transport);
        await transport.handleRequest(request, response, request.body);
      } catch (error) {
        logSafe(dependencies, response, request.path, error);
        if (!response.headersSent) {
          response.status(500).json({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32603, message: 'MCP request failed safely.' },
          });
        }
      } finally {
        if (response.writableEnded) close();
      }
    },
  );

  app.use((_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.status(404).json({ error: 'not_found' });
  });

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    logSafe(dependencies, response, request.path, error);
    if (response.headersSent) return;
    response.setHeader('Cache-Control', 'no-store');
    const status = isBodyTooLarge(error) ? 413 : 400;
    response.status(status).json({ error: status === 413 ? 'request_too_large' : 'invalid_request' });
  });

  return app;
}

function sendAuthorizationError(
  request: Request,
  response: Response,
  oauth: LifeTrackerMcpOAuthService,
): void {
  const clientId = queryString(request.query.client_id);
  const redirectUri = queryString(request.query.redirect_uri);
  const state = queryString(request.query.state);
  const redirect = clientId && redirectUri
    ? oauth.authorizationErrorRedirect({
      clientId,
      redirectUri,
      ...(state ? { state } : {}),
      error: request.query.scope === MCP_READ_SCOPE ? 'invalid_request' : 'invalid_scope',
    })
    : null;
  if (redirect) {
    response.redirect(302, redirect);
    return;
  }
  response.status(400).json({ error: 'invalid_request' });
}

function assertSameOrigin(request: Request, expectedOrigin: string): void {
  if (request.headers.origin !== expectedOrigin) {
    throw new Error('origin rejected');
  }
}

function assertCsrf(request: Request): string {
  const header = request.headers['x-life-tracker-csrf'];
  const cookie = cookieValue(request.headers.cookie, CSRF_COOKIE);
  if (typeof header !== 'string' || !cookie || !safeEqual(header, cookie)) {
    throw new Error('csrf rejected');
  }
  return header;
}

function csrfCookie(value: string, path: string, maxAgeSeconds: number): string {
  return `${CSRF_COOKIE}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header || header.length > 4_096) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function bearerToken(header: string | undefined): string {
  if (!header || header.length > 512 || !header.startsWith('Bearer ')) {
    throw new Error('bearer rejected');
  }
  const token = header.slice('Bearer '.length);
  if (/\s/.test(token)) throw new Error('bearer rejected');
  return token;
}

function safeEqual(left: string, right: string): boolean {
  const first = Buffer.from(left, 'utf8');
  const second = Buffer.from(right, 'utf8');
  return first.length === second.length && timingSafeEqual(first, second);
}

function sendPrivateError(response: Response, error: unknown): void {
  const status = isDomainError(error)
    ? error.code === 'FORBIDDEN' ? 403 : error.code === 'UNAUTHENTICATED' ? 401 : 400
    : 403;
  response.status(status).json({ error: status === 401 ? 'authentication_required' : 'request_rejected' });
}

function sendOAuthError(response: Response, code: string, status: number): void {
  response.status(status).json({
    error: code,
    error_description: 'The OAuth request was rejected.',
  });
}

function oauthErrorCode(error: unknown, fallback: string): string {
  if (!isDomainError(error)) return fallback;
  if (error.code === 'FORBIDDEN') return 'invalid_target';
  if (error.code === 'INVALID_ARGUMENT') return 'invalid_request';
  return fallback;
}

function queryString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function mcpRequestId(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return (value as { id?: unknown }).id ?? null;
}

function retryAfter(error: unknown): string {
  const value = isDomainError(error) ? error.details?.retryAfterSeconds : undefined;
  return String(typeof value === 'number' ? Math.max(1, Math.min(3_600, Math.ceil(value))) : 60);
}

function isBodyTooLarge(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { type?: unknown }).type === 'entity.too.large');
}

function logSafe(
  dependencies: LifeTrackerMcpHttpDependencies,
  response: Response,
  path: string,
  error: unknown,
): void {
  if (!dependencies.logger) return;
  dependencies.logger.error('Life Tracker MCP request failed safely.', {
    requestId: response.locals.requestId,
    path: safePath(path),
    code: isDomainError(error) ? error.code : 'INTERNAL',
  });
}

function safePath(path: string): string {
  return [
    '/authorize',
    '/authorize/complete',
    '/authorize/deny',
    '/token',
    '/revoke',
    '/mcp',
  ].includes(path) ? path : 'other';
}
