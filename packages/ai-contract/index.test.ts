import { describe, expect, it } from 'vitest';
import {
  parseLifePlanActionResponse,
  parseLifePlanPreview,
  type LifePlanPreview,
} from './index';

describe('shared Life Tracker AI contract', () => {
  it('accepts the exact immutable preview returned by the backend', () => {
    const plan = validPlan();
    expect(parseLifePlanPreview(plan)).toEqual(plan);
  });

  it('fails closed on unknown fields or a diff that is not the approved operation', () => {
    expect(() => parseLifePlanPreview({ ...validPlan(), userId: 'other-user' })).toThrow();
    const mismatched = validPlan();
    expect(() => parseLifePlanPreview({
      ...mismatched,
      diff: [{ ...mismatched.diff[0], entityId: 'different-task' }],
    })).toThrow();
    expect(() => parseLifePlanPreview({
      ...validPlan(),
      diff: [{ ...validPlan().diff[0], before: { title: 'x'.repeat(600_000) } }],
    })).toThrow(/size|string/);
  });

  it('represents a TimeBlock move as a first-class human-visible action', () => {
    const plan = validPlan();
    const moved = {
      ...plan,
      operations: [{ ...plan.operations[0], action: 'move' as const, entityType: 'timeBlocks' }],
      diff: [{ ...plan.diff[0], action: 'move' as const, entityType: 'timeBlocks' }],
    };
    expect(parseLifePlanPreview(moved)).toEqual(moved);
  });

  it('requires the execution response and receipt to describe the same mutation', () => {
    const response = validActionResponse();
    expect(parseLifePlanActionResponse(response)).toEqual(response);
    expect(() => parseLifePlanActionResponse({
      ...response,
      planId: 'different-plan',
    })).toThrow();
  });
});

function validPlan(): LifePlanPreview {
  return {
    id: 'plan_123',
    tool: 'preview_changes',
    createdAt: '2030-01-01T09:00:00.000Z',
    expiresAt: '2030-01-01T09:15:00.000Z',
    baseStateHash: 'a'.repeat(64),
    hash: 'b'.repeat(64),
    status: 'previewed',
    operations: [{ action: 'update', entityType: 'tasks', entityId: 'task_123' }],
    diff: [{
      action: 'update',
      entityType: 'tasks',
      entityId: 'task_123',
      summary: 'Update “Prepare report”: title.',
      title: 'Prepare report',
      changedFields: ['title'],
      before: { title: 'Draft report' },
      after: { title: 'Prepare report' },
    }],
    reason: 'User requested the update.',
    warnings: [],
    conflicts: [],
    assumptions: [],
    expectedImpact: ['One task title changes.'],
    destructiveOperationCount: 0,
    approval: {
      required: true,
      capability: 'a'.repeat(43),
      expiresAt: '2030-01-01T09:15:00.000Z',
    },
  };
}

function validActionResponse() {
  return {
    message: 'Plan applied and verified.',
    executionId: 'execution_123',
    planId: 'plan_123',
    hash: 'b'.repeat(64),
    status: 'applied' as const,
    idempotentReplay: false,
    verified: true,
    receipt: {
      executionId: 'execution_123',
      planId: 'plan_123',
      changesetHash: 'b'.repeat(64),
      status: 'applied' as const,
      verified: true,
      timestamp: '2030-01-01T09:01:00.000Z',
      affected: [{ collection: 'tasks', id: 'task_123' }],
      rollbackAvailable: true,
      rollbackExpiresAt: '2030-01-08T09:01:00.000Z',
    },
    rollback: {
      capability: 'r'.repeat(43),
      expiresAt: '2030-01-08T09:01:00.000Z',
    },
  };
}
