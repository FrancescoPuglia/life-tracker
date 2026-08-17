import { describe, expect, it, vi } from 'vitest';
import { LifeTrackerApiApplication } from '../src/application';
import type { LifeTrackerDomain } from '../src/domain/factory';
import type { AuthContext, PlanActionResult } from '../src/domain/types';

describe('LifeTrackerApiApplication action receipts', () => {
  it('describes an authoritative rolled-back apply replay without claiming it is applied', async () => {
    const result: PlanActionResult = {
      executionId: 'execution-1',
      planId: 'plan-1',
      hash: 'a'.repeat(64),
      status: 'rolled_back',
      idempotentReplay: true,
      verified: true,
      affected: [{ collection: 'tasks', id: 'task-1' }],
      receipt: {
        executionId: 'execution-1',
        planId: 'plan-1',
        changesetHash: 'a'.repeat(64),
        status: 'rolled_back',
        verified: true,
        timestamp: '2026-08-17T08:00:00.000Z',
        affected: [{ collection: 'tasks', id: 'task-1' }],
        rollbackAvailable: false,
        rollbackExpiresAt: null,
      },
    };
    const applyPlan = vi.fn().mockResolvedValue(result);
    const domain = { changePlans: { applyPlan } } as unknown as LifeTrackerDomain;
    const application = new LifeTrackerApiApplication(domain, () => {
      throw new Error('Responses adapter is not used by this action test.');
    });
    const context: AuthContext = {
      uid: 'firebase-user',
      requestId: 'request-1',
    };

    const response = await application.applyPlan(context, 'plan-1', {
      approvalCapability: 'a'.repeat(43),
      idempotencyKey: 'idem_1234567890123456',
    });

    expect(response).toMatchObject({
      status: 'rolled_back',
      idempotentReplay: true,
      message: expect.stringMatching(/already rolled back/i),
    });
    expect(String(response.message)).not.toMatch(/already applied/i);
  });
});
