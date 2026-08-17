import { describe, expect, it } from 'vitest';
import {
  parseLifePlanActionResponse,
  parseLifePlanPreview,
  resolveLifeTrackerAiBackendBaseUrl,
  type LifePlanPreview,
} from './index';

describe('shared Life Tracker AI contract', () => {
  it('binds the bearer-token backend to the exact Firebase project Function', () => {
    const projectId = 'life-tracker-12000';
    const canonical = 'https://europe-west1-life-tracker-12000.cloudfunctions.net/lifeTrackerAiApi';
    expect(resolveLifeTrackerAiBackendBaseUrl(`${canonical}/`, projectId)).toBe(canonical);
    expect(resolveLifeTrackerAiBackendBaseUrl('https://attacker.example/lifeTrackerAiApi', projectId)).toBeNull();
    expect(resolveLifeTrackerAiBackendBaseUrl(
      'https://europe-west1-other-project.cloudfunctions.net/lifeTrackerAiApi',
      projectId,
    )).toBeNull();
    expect(resolveLifeTrackerAiBackendBaseUrl(`${canonical}?redirect=attacker`, projectId)).toBeNull();
  });

  it('allows only the project-bound Functions emulator path when explicitly enabled', () => {
    const emulator = 'http://127.0.0.1:5001/life-tracker-test/europe-west1/lifeTrackerAiApi';
    expect(resolveLifeTrackerAiBackendBaseUrl(emulator, 'life-tracker-test')).toBeNull();
    expect(resolveLifeTrackerAiBackendBaseUrl(emulator, 'life-tracker-test', true)).toBe(emulator);
    expect(resolveLifeTrackerAiBackendBaseUrl(
      'http://127.0.0.1:5001/other/europe-west1/lifeTrackerAiApi',
      'life-tracker-test',
      true,
    )).toBeNull();
    expect(resolveLifeTrackerAiBackendBaseUrl(
      'http://attacker.example:5001/life-tracker-test/europe-west1/lifeTrackerAiApi',
      'life-tracker-test',
      true,
    )).toBeNull();
  });

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

  it('requires successful actions to be verified with an exactly bound rollback', () => {
    const response = validActionResponse();
    expect(() => parseLifePlanActionResponse({
      ...response,
      verified: false,
      receipt: { ...response.receipt, verified: false },
    })).toThrow();
    expect(() => parseLifePlanActionResponse({
      ...response,
      receipt: { ...response.receipt, rollbackExpiresAt: '2030-01-09T09:01:00.000Z' },
    })).toThrow();
    expect(() => parseLifePlanActionResponse({
      ...response,
      status: 'rolled_back',
      rollback: undefined,
      receipt: {
        ...response.receipt,
        status: 'rolled_back',
        rollbackAvailable: true,
      },
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
