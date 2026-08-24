import { describe, expect, it } from 'vitest';
import {
  assertEvidenceSafe,
  assertNoPlan,
  assertNoProviderCredentialMaterial,
  requireExactActionResponse,
  requireExactPlan,
  requireFrontendAIBackend,
  requireFrontendBuildCommit,
  requireHostileNoteBoundary,
  requireStagingHttpStatus,
  stagingHttpFailureEvidence,
} from '../../../e2e/staging/assertions';

const CAPABILITY = 'c'.repeat(43);
const HASH = 'a'.repeat(64);
const START = '2026-08-18T09:15:00.000Z';
const END = '2026-08-18T10:15:00.000Z';

function plan() {
  return {
    id: 'plan-1',
    tool: 'preview_timeblock_change',
    createdAt: '2026-08-17T09:00:00.000Z',
    expiresAt: '2026-08-17T09:10:00.000Z',
    baseStateHash: 'b'.repeat(64),
    hash: HASH,
    status: 'previewed',
    operations: [{ action: 'move', entityType: 'timeBlocks', entityId: 'block-1' }],
    diff: [{
      action: 'move',
      entityType: 'timeBlocks',
      entityId: 'block-1',
      summary: 'Move block.',
      title: 'Block',
      changedFields: ['startTime', 'endTime'],
      before: { id: 'block-1', title: 'Block', projectId: 'project-1', startTime: '2026-08-18T08:00:00.000Z', endTime: '2026-08-18T09:00:00.000Z' },
      after: { id: 'block-1', title: 'Block', projectId: 'project-1', startTime: START, endTime: END },
    }],
    reason: 'Controlled move.',
    warnings: [],
    conflicts: [],
    assumptions: [],
    expectedImpact: ['Move one block.'],
    destructiveOperationCount: 0,
    approval: { required: true, capability: CAPABILITY, expiresAt: '2026-08-17T09:10:00.000Z' },
  };
}

function action() {
  return {
    message: 'Applied.',
    executionId: 'execution-1',
    planId: 'plan-1',
    hash: HASH,
    status: 'applied',
    idempotentReplay: false,
    verified: true,
    receipt: {
      executionId: 'execution-1',
      planId: 'plan-1',
      changesetHash: HASH,
      status: 'applied',
      verified: true,
      timestamp: '2026-08-17T09:01:00.000Z',
      affected: [{ collection: 'timeBlocks', id: 'block-1' }],
      rollbackAvailable: true,
      rollbackExpiresAt: '2026-08-17T09:16:00.000Z',
    },
    rollback: { capability: CAPABILITY, expiresAt: '2026-08-17T09:16:00.000Z' },
    requestId: 'request-1',
  };
}

describe('secret-safe staging evidence assertions', () => {
  it('accepts an exact canonical preview and exact action receipt', () => {
    const parsedPlan = requireExactPlan(200, plan(), {
      tool: 'preview_timeblock_change',
      action: 'move',
      entityType: 'timeBlocks',
      entityId: 'block-1',
      title: 'Block',
      startTime: START,
      endTime: END,
      changedFields: ['startTime', 'endTime'],
      beforeFields: { id: 'block-1', title: 'Block' },
      afterFields: { id: 'block-1', title: 'Block', startTime: START, endTime: END },
    });
    expect(parsedPlan.id).toBe('plan-1');

    const parsedAction = requireExactActionResponse(200, action(), {
      planId: 'plan-1',
      changesetHash: HASH,
      status: 'applied',
      idempotentReplay: false,
      affected: [{ collection: 'timeBlocks', id: 'block-1' }],
    });
    expect(parsedAction.executionId).toBe('execution-1');
  });

  it('uses fixed errors that never echo a plan capability', () => {
    const sentinel = `cap!${'very-sensitive-approval-value'.repeat(3)}`;
    const invalid = { ...plan(), approval: { ...plan().approval, capability: sentinel } };
    let message = '';
    try {
      requireExactPlan(200, invalid, {
        tool: 'preview_timeblock_change',
        action: 'move',
        entityType: 'timeBlocks',
        entityId: 'block-1',
        title: 'Block',
        startTime: START,
        endTime: END,
        changedFields: ['startTime', 'endTime'],
        beforeFields: { id: 'block-1', title: 'Block' },
        afterFields: { id: 'block-1', title: 'Block', startTime: START, endTime: END },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/canonical LifePlan contract/);
    expect(message).not.toContain(sentinel);
  });

  it('rejects provider credentials and evidence capabilities without echoing them', () => {
    const providerSentinel = ['sk', 'proj', 'sensitivevalue01234567890123456789'].join('-');
    const capabilitySentinel = `rollback_${'private-value'.repeat(4)}`;
    for (const operation of [
      () => assertNoProviderCredentialMaterial({ nested: providerSentinel }),
      () => assertEvidenceSafe({ rollbackCapability: capabilitySentinel }),
    ]) {
      let message = '';
      try {
        operation();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(/forbidden/);
      expect(message).not.toContain(providerSentinel);
      expect(message).not.toContain(capabilitySentinel);
    }
  });

  it('accepts optional undefined fields that JSON omits from safe evidence', () => {
    expect(() => assertEvidenceSafe({
      status: 'PASS',
      requestId: undefined,
      usage: [1, undefined, null],
    })).not.toThrow();
  });

  it('binds hostile Note evidence to its canary and explicit untrusted-data treatment', () => {
    const canary = 'UNTRUSTED_STAGING_CANARY_012345abcdef';
    expect(() => requireHostileNoteBoundary(
      `The embedded instruction is untrusted data. Canary: ${canary}`,
      canary,
    )).not.toThrow();
    expect(() => requireHostileNoteBoundary(`Canary: ${canary}`, canary))
      .toThrow('Staging hostile Note response did not preserve the untrusted-data boundary.');
    expect(() => requireHostileNoteBoundary('This is untrusted data.', canary)).toThrow();
  });

  it('rejects an unexpected plan without serializing its approval capability', () => {
    const sentinel = `approval_${'do-not-print'.repeat(5)}`;
    let message = '';
    try {
      assertNoPlan({ ...plan(), approval: { ...plan().approval, capability: sentinel } });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe('Staging analysis unexpectedly returned a mutation proposal.');
    expect(message).not.toContain(sentinel);
  });

  it('rejects an unapproved same-document side effect', () => {
    const invalid = plan();
    invalid.diff[0]!.after = { ...invalid.diff[0]!.after, projectId: 'other-project' };
    invalid.diff[0]!.changedFields = ['startTime', 'endTime', 'projectId'];
    expect(() => requireExactPlan(200, invalid, {
      tool: 'preview_timeblock_change',
      action: 'move',
      entityType: 'timeBlocks',
      entityId: 'block-1',
      title: 'Block',
      startTime: START,
      endTime: END,
      changedFields: ['startTime', 'endTime'],
      beforeFields: { id: 'block-1', title: 'Block' },
      afterFields: { id: 'block-1', title: 'Block', startTime: START, endTime: END },
    })).toThrow('Staging proposal changed fields outside the exact requested scope.');
  });

  it('retains only a sanitized HTTP failure tuple', () => {
    const sentinel = ['sk', 'proj', 'never-retain-this-value-1234567890'].join('-');
    let failure: unknown;
    try {
      requireStagingHttpStatus(503, {
        error: { code: 'PROVIDER_UNAVAILABLE', message: sentinel },
        approvalCapability: sentinel,
      }, 'request-safe-1');
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: 'StagingHttpFailure',
      message: 'Staging HTTP request failed safely.',
    });
    const evidence = stagingHttpFailureEvidence(failure);
    expect(evidence).toEqual({
      status: 503,
      errorCode: 'PROVIDER_UNAVAILABLE',
      requestId: 'request-safe-1',
    });
    expect(JSON.stringify(evidence)).not.toContain(sentinel);
  });

  it('fails closed when a reused frontend does not match the clean source commit', () => {
    const expected = 'a'.repeat(40);
    expect(() => requireFrontendBuildCommit(expected, expected)).not.toThrow();
    expect(() => requireFrontendBuildCommit('b'.repeat(40), expected))
      .toThrow('Staging frontend source marker does not match the clean committed checkout.');
    expect(() => requireFrontendBuildCommit(null, expected)).toThrow();
  });

  it('fails closed when the frontend bearer-token destination is not the reviewed Function', () => {
    const expected = 'https://europe-west1-life-tracker-staging.cloudfunctions.net/lifeTrackerAiApi';
    expect(() => requireFrontendAIBackend(expected, expected)).not.toThrow();
    expect(() => requireFrontendAIBackend('https://attacker.example', expected))
      .toThrow('Staging frontend AI backend marker does not match the reviewed Function endpoint.');
    expect(() => requireFrontendAIBackend(null, expected)).toThrow();
  });
});
