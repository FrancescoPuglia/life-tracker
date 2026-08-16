import type { AuthContext } from '../domain/types';

export type HeaderValue = string | readonly string[] | undefined;

export interface HttpRequestLike {
  readonly method?: string;
  readonly path?: string;
  readonly url?: string;
  readonly headers: Readonly<Record<string, HeaderValue>>;
  readonly body?: unknown;
  readonly rawBody?: Buffer;
}

export interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  setHeader(name: string, value: string): void;
  json(value: unknown): void;
  send(value?: unknown): void;
  end(): void;
}

export interface VerifiedIdentity {
  readonly uid: string;
}

export interface TokenVerifier {
  verifyBearerToken(token: string): Promise<VerifiedIdentity>;
}

export interface RateLimitRequest {
  readonly uid: string;
  readonly bucket: 'chat' | 'apply' | 'rollback';
  readonly limit: number;
  readonly windowMs: number;
  readonly now: Date;
}

export interface RateLimiter {
  consume(request: RateLimitRequest): Promise<void>;
}

export interface ChatRequest {
  readonly message: string;
  readonly mode: 'ask' | 'plan' | 'analyze' | 'coach';
  readonly history: readonly Readonly<{ role: 'user' | 'assistant'; content: string }>[];
}

export interface ApplyRequest {
  readonly approvalCapability: string;
  readonly idempotencyKey: string;
}

export interface RollbackRequest {
  readonly rollbackCapability: string;
  readonly idempotencyKey: string;
}

export interface ApiApplication {
  chat(context: AuthContext, request: ChatRequest): Promise<Readonly<Record<string, unknown>>>;
  applyPlan(
    context: AuthContext,
    planId: string,
    request: ApplyRequest,
  ): Promise<Readonly<Record<string, unknown>>>;
  rollbackExecution(
    context: AuthContext,
    executionId: string,
    request: RollbackRequest,
  ): Promise<Readonly<Record<string, unknown>>>;
}
