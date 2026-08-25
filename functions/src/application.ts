import type { ResponsesRunner } from './ai/responses-adapter';
import type { LifeTrackerDomain } from './domain/factory';
import type { AuthContext } from './domain/types';
import type {
  ApiApplication,
  ApplyRequest,
  ChatRequest,
  RollbackRequest,
} from './http/types';

/** Transport-neutral application boundary shared by HTTPS and a future MCP adapter. */
export class LifeTrackerApiApplication implements ApiApplication {
  constructor(
    private readonly domain: LifeTrackerDomain,
    private readonly responses: ResponsesRunner | (() => ResponsesRunner),
  ) {}

  async chat(context: AuthContext, request: ChatRequest): Promise<Readonly<Record<string, unknown>>> {
    const authenticatedContext = await this.domain.buildAuthenticatedAiContext(context);
    const result = await this.responsesAdapter().run({
      auth: context,
      message: request.message,
      mode: request.mode,
      history: request.history,
      authenticatedContext,
    });
    return { ...result };
  }

  async applyPlan(
    context: AuthContext,
    planId: string,
    request: ApplyRequest,
  ): Promise<Readonly<Record<string, unknown>>> {
    const result = await this.domain.changePlans.applyPlan(context, {
      planId,
      approvalCapability: request.approvalCapability,
      idempotencyKey: request.idempotencyKey,
    });
    return {
      message: result.status === 'rolled_back'
        ? 'This exact plan was already rolled back; the authoritative verified receipt is returned.'
        : result.idempotentReplay
          ? 'This exact plan was already applied; the original verified receipt is returned.'
          : 'Plan applied and verified against authoritative Firestore state.',
      executionId: result.executionId,
      planId: result.planId,
      hash: result.hash,
      status: result.status,
      idempotentReplay: result.idempotentReplay,
      verified: result.verified,
      receipt: result.receipt,
      ...(result.rollback ? { rollback: result.rollback } : {}),
    };
  }

  async rollbackExecution(
    context: AuthContext,
    executionId: string,
    request: RollbackRequest,
  ): Promise<Readonly<Record<string, unknown>>> {
    const result = await this.domain.changePlans.rollbackExecution(context, {
      executionId,
      rollbackCapability: request.rollbackCapability,
      idempotencyKey: request.idempotencyKey,
    });
    return {
      message: result.idempotentReplay
        ? 'This rollback was already completed; the original verified receipt is returned.'
        : 'Rollback completed and verified against authoritative Firestore state.',
      executionId: result.executionId,
      planId: result.planId,
      hash: result.hash,
      status: result.status,
      idempotentReplay: result.idempotentReplay,
      verified: result.verified,
      receipt: result.receipt,
    };
  }

  private responsesAdapter(): ResponsesRunner {
    return typeof this.responses === 'function' ? this.responses() : this.responses;
  }
}
