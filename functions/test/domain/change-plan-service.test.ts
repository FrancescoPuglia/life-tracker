import { parseLifePlanPreview } from '../../../packages/ai-contract';
import { describe, expect, it, vi } from 'vitest';
import { CapabilityIssuer } from '../../src/domain/capabilities';
import { InMemoryRepository } from '../../src/domain/in-memory-repository';
import { ChangePlanService } from '../../src/domain/services/change-plan-service';
import type { AuthContext } from '../../src/domain/types';

const UID = 'owner-user';
const OTHER_UID = 'other-user';
const CAPABILITY_SECRET = 'unit-test-capability-secret-with-at-least-thirty-two-bytes';
const START = new Date('2026-08-17T08:00:00.000Z');

describe('ChangePlanService authorization and lifecycle', () => {
  it('emits the shared exact preview contract and does not expose owner identity', async () => {
    const harness = createHarness();
    const preview = await updateTitlePreview(harness.service, UID, 'Proposed title');

    expect(parseLifePlanPreview(preview)).toEqual(preview);
    expect(JSON.stringify(preview)).not.toContain(UID);
    expect(preview.diff[0]).toMatchObject({
      action: 'update',
      entityType: 'timeBlocks',
      entityId: 'block-1',
      changedFields: ['title'],
      before: { title: 'Original block' },
      after: { title: 'Proposed title' },
    });
  });

  it('applies atomically once and makes same-key network/concurrent retries idempotent', async () => {
    const harness = createHarness(['plan-1', 'execution-a', 'execution-b']);
    const preview = await updateTitlePreview(harness.service, UID, 'Applied title');
    const input = {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'same-apply-request-00000001',
    };

    const [left, right] = await Promise.all([
      harness.service.applyPlan(context(UID, 'request-a'), input),
      harness.service.applyPlan(context(UID, 'request-b'), input),
    ]);

    expect(left.executionId).toBe(right.executionId);
    expect([left.idempotentReplay, right.idempotentReplay].sort()).toEqual([false, true]);
    expect((await harness.repository.getEntity(UID, 'timeBlocks', 'block-1'))?.title).toBe('Applied title');
    expect((await harness.repository.listAuditEventsForUser(UID)).filter((event) => event.action === 'apply')).toHaveLength(1);
    await expect(harness.service.applyPlan(context(UID, 'request-c'), {
      ...input,
      idempotencyKey: 'different-apply-key-000001',
    })).rejects.toMatchObject({ code: 'APPROVAL_REPLAYED' });
    await expect(harness.service.getPlan(context(UID, 'refetch-applied'), preview.id))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('binds approval to owner, exact plan, capability, and expiry', async () => {
    const harness = createHarness(['plan-owner', 'plan-other', 'execution-invalid']);
    seedUser(harness.repository, OTHER_UID);
    const ownerPreview = await updateTitlePreview(harness.service, UID, 'Owner proposal');
    const otherPreview = await updateTitlePreview(harness.service, OTHER_UID, 'Other proposal');

    await expect(harness.service.applyPlan(context(OTHER_UID, 'owner-probe'), {
      planId: ownerPreview.id,
      approvalCapability: ownerPreview.approval.capability,
      idempotencyKey: 'wrong-owner-request-000001',
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(harness.service.applyPlan(context(OTHER_UID, 'plan-swap'), {
      planId: otherPreview.id,
      approvalCapability: ownerPreview.approval.capability,
      idempotencyKey: 'wrong-plan-request-0000001',
    })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });

    harness.now = new Date('2026-08-17T08:16:00.000Z');
    await expect(harness.service.getPlan(context(UID, 'refetch-expired'), ownerPreview.id))
      .rejects.toMatchObject({ code: 'EXPIRED' });
    await expect(harness.service.applyPlan(context(UID, 'expired'), {
      planId: ownerPreview.id,
      approvalCapability: ownerPreview.approval.capability,
      idempotencyKey: 'expired-request-key-000001',
    })).rejects.toMatchObject({ code: 'EXPIRED' });
    expect((await harness.repository.getEntity(UID, 'timeBlocks', 'block-1'))?.title).toBe('Original block');
  });

  it('detects content drift even when a legacy client preserves _version and applies zero operations', async () => {
    const harness = createHarness(['plan-stale', 'execution-stale']);
    const preview = await harness.service.previewChanges(context(UID, 'preview-stale'), {
      operations: [
        {
          op: 'update',
          collection: 'timeBlocks',
          id: 'block-1',
          patch: [{ field: 'title', value: 'AI title' }],
        },
        {
          op: 'create',
          collection: 'timeBlocks',
          id: 'block-2',
          patch: [
            { field: 'title', value: 'AI-created block' },
            { field: 'domainId', value: 'domain-1' },
            { field: 'startTime', value: '2026-08-17T11:00:00.000Z' },
            { field: 'endTime', value: '2026-08-17T12:00:00.000Z' },
            { field: 'status', value: 'planned' },
            { field: 'type', value: 'buffer' },
          ],
        },
      ],
      reason: 'Atomic stale-state test.',
    });
    harness.repository.mutateWithoutVersionForTest(UID, 'timeBlocks', 'block-1', {
      title: 'Newer human edit',
    });

    await expect(harness.service.applyPlan(context(UID, 'stale-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'stale-apply-request-00001',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    expect((await harness.repository.getEntity(UID, 'timeBlocks', 'block-1'))?.title).toBe('Newer human edit');
    expect(await harness.repository.getEntity(UID, 'timeBlocks', 'block-2')).toBeNull();
  });

  it('rolls back with owner-bound one-time capability and refuses to overwrite newer edits', async () => {
    const harness = createHarness(['plan-rollback', 'execution-rollback', 'plan-newer', 'execution-newer']);
    const preview = await updateTitlePreview(harness.service, UID, 'Temporary title');
    const applied = await harness.service.applyPlan(context(UID, 'apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'rollback-apply-key-000001',
    });

    await expect(harness.service.rollbackExecution(context(OTHER_UID, 'other-user'), {
      executionId: applied.executionId,
      rollbackCapability: applied.rollback?.capability ?? '',
      idempotencyKey: 'wrong-user-rollback-000001',
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const rollbackInput = {
      executionId: applied.executionId,
      rollbackCapability: applied.rollback?.capability ?? '',
      idempotencyKey: 'rollback-request-key-000001',
    };
    const rolledBack = await harness.service.rollbackExecution(context(UID, 'rollback'), rollbackInput);
    expect(rolledBack.status).toBe('rolled_back');
    expect((await harness.repository.getEntity(UID, 'timeBlocks', 'block-1'))?.title).toBe('Original block');
    expect((await harness.service.rollbackExecution(context(UID, 'rollback-retry'), rollbackInput)).idempotentReplay).toBe(true);

    const newerPreview = await updateTitlePreview(harness.service, UID, 'Second AI title');
    const newerApplied = await harness.service.applyPlan(context(UID, 'apply-newer'), {
      planId: newerPreview.id,
      approvalCapability: newerPreview.approval.capability,
      idempotencyKey: 'newer-apply-key-00000001',
    });
    harness.repository.mutateForTest(UID, 'timeBlocks', 'block-1', { title: 'Human title after AI' });
    await expect(harness.service.rollbackExecution(context(UID, 'unsafe-rollback'), {
      executionId: newerApplied.executionId,
      rollbackCapability: newerApplied.rollback?.capability ?? '',
      idempotencyKey: 'unsafe-rollback-key-000001',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    expect((await harness.repository.getEntity(UID, 'timeBlocks', 'block-1'))?.title).toBe('Human title after AI');
  });

  it('normalizes cross-user entity IDs as unavailable without reading the other namespace', async () => {
    const harness = createHarness();
    harness.repository.seed(UID, 'tasks', [{ id: 'alice-only-task', title: 'Private A task' }]);

    await expect(harness.service.previewChanges(context(OTHER_UID, 'entity-probe'), {
      operations: [{
        op: 'update',
        collection: 'tasks',
        id: 'alice-only-task',
        patch: [{ field: 'title', value: 'Probe' }],
      }],
      reason: 'Probe another namespace.',
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await harness.repository.getEntity(UID, 'tasks', 'alice-only-task'))?.title).toBe('Private A task');
  });

  it('preserves the authoritative rejection when supplemental rejection auditing is unavailable', async () => {
    const harness = createHarness(['plan-audit-failure', 'execution-audit-failure']);
    const preview = await updateTitlePreview(harness.service, UID, 'AI title');
    harness.repository.mutateForTest(UID, 'timeBlocks', 'block-1', { title: 'Newer human title' });
    vi.spyOn(harness.repository, 'recordAudit').mockRejectedValueOnce(new Error('audit unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(harness.service.applyPlan(context(UID, 'audit-failure-request'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'audit-failure-apply-00001',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    expect(log).toHaveBeenCalledWith(
      'Life Tracker rejection audit could not be persisted.',
      expect.objectContaining({
        requestId: 'audit-failure-request',
        action: 'apply',
        code: 'AUDIT_WRITE_FAILED',
      }),
    );
    expect((await harness.repository.getEntity(UID, 'timeBlocks', 'block-1'))?.title)
      .toBe('Newer human title');
    log.mockRestore();
  });

  it('refuses hierarchical AI deletes so a proposal cannot create orphans', async () => {
    const harness = createHarness();
    harness.repository.seed(UID, 'goals', [{
      id: 'protected-goal',
      title: 'Meaningful outcome',
      domainId: 'domain-1',
    }]);

    await expect(harness.service.previewChanges(context(UID, 'delete-goal'), {
      operations: [{ op: 'delete', collection: 'goals', id: 'protected-goal', patch: [] }],
      reason: 'Delete a hierarchy root.',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await harness.repository.getEntity(UID, 'goals', 'protected-goal')).not.toBeNull();
  });

  it('classifies a TimeBlock time change as a human-visible move', async () => {
    const harness = createHarness();
    const preview = await harness.service.previewChanges(context(UID, 'move-block'), {
      operations: [{
        op: 'update',
        collection: 'timeBlocks',
        id: 'block-1',
        patch: [
          { field: 'startTime', value: '2026-08-17T10:00:00.000Z' },
          { field: 'endTime', value: '2026-08-17T11:00:00.000Z' },
        ],
      }],
      reason: 'Move the block.',
    });

    expect(preview.operations[0]?.action).toBe('move');
    expect(preview.diff[0]?.action).toBe('move');
    expect(preview.diff[0]?.summary).toMatch(/^Move /);
  });

  it('fails closed for protected blocks, invalid intervals, and unmapped productive blocks', async () => {
    const harness = createHarness();
    harness.repository.seed(UID, 'timeBlocks', [{
      id: 'locked-update',
      userId: UID,
      domainId: 'domain-1',
      title: 'Fixed meeting',
      startTime: '2026-08-18T09:00:00.000Z',
      endTime: '2026-08-18T10:00:00.000Z',
      status: 'planned',
      type: 'meeting',
      locked: true,
    }]);
    await expect(harness.service.previewChanges(context(UID, 'locked-update'), {
      operations: [{
        op: 'update',
        collection: 'timeBlocks',
        id: 'locked-update',
        patch: [{ field: 'title', value: 'AI rewrite' }],
      }],
      reason: 'Protected mutation must fail.',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(harness.service.previewChanges(context(UID, 'invalid-interval'), {
      operations: [{
        op: 'create',
        collection: 'timeBlocks',
        id: 'invalid-interval',
        patch: [
          { field: 'title', value: 'Invalid' },
          { field: 'domainId', value: 'domain-1' },
          { field: 'startTime', value: '2026-08-18T11:00:00.000Z' },
          { field: 'endTime', value: '2026-08-18T10:00:00.000Z' },
          { field: 'status', value: 'planned' },
          { field: 'type', value: 'buffer' },
        ],
      }],
      reason: 'Invalid geometry must fail.',
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    await expect(harness.service.previewChanges(context(UID, 'unmapped-focus'), {
      operations: [{
        op: 'create',
        collection: 'timeBlocks',
        id: 'unmapped-focus',
        patch: [
          { field: 'title', value: 'Unmapped focus' },
          { field: 'domainId', value: 'domain-1' },
          { field: 'startTime', value: '2026-08-18T11:00:00.000Z' },
          { field: 'endTime', value: '2026-08-18T12:00:00.000Z' },
          { field: 'status', value: 'planned' },
          { field: 'type', value: 'focus' },
        ],
      }],
      reason: 'Unmapped productive work must fail.',
    })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses a preview that cannot be returned within the bounded public contract', async () => {
    const harness = createHarness();
    const longBefore = 'a'.repeat(20_000);
    const longAfter = 'b'.repeat(20_000);
    const operations = Array.from({ length: 20 }, (_, index) => {
      const id = `large-block-${index}`;
      harness.repository.seed(UID, 'timeBlocks', [{
        id,
        userId: UID,
        domainId: 'domain-1',
        title: `Large ${index}`,
        notes: longBefore,
        startTime: '2026-08-18T09:00:00.000Z',
        endTime: '2026-08-18T10:00:00.000Z',
        status: 'planned',
        type: 'buffer',
      }]);
      return {
        op: 'update' as const,
        collection: 'timeBlocks' as const,
        id,
        patch: [{ field: 'notes', value: longAfter }],
      };
    });

    await expect(harness.service.previewChanges(context(UID, 'oversized-preview'), {
      operations,
      reason: 'This preview must fail before persistence.',
    })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(await harness.repository.listAuditEventsForUser(UID)).toEqual([]);
  });
});

function createHarness(ids: readonly string[] = ['plan-default', 'execution-default']) {
  const repository = new InMemoryRepository();
  seedUser(repository, UID);
  let idIndex = 0;
  const harness = {
    now: START,
    repository,
    service: undefined as unknown as ChangePlanService,
  };
  harness.service = new ChangePlanService(repository, {
    clock: () => harness.now,
    idFactory: () => ids[idIndex++] ?? `generated-${idIndex}`,
    capabilityIssuer: new CapabilityIssuer(CAPABILITY_SECRET),
  });
  return harness;
}

function seedUser(repository: InMemoryRepository, uid: string): void {
  repository.seed(uid, 'domains', [{ id: 'domain-1', name: 'Work', color: '#336699', icon: 'briefcase' }]);
  repository.seed(uid, 'timeBlocks', [{
    id: 'block-1',
    userId: uid,
    domainId: 'domain-1',
    title: 'Original block',
    startTime: '2026-08-17T09:00:00.000Z',
    endTime: '2026-08-17T10:00:00.000Z',
    status: 'planned',
    type: 'buffer',
  }]);
}

function updateTitlePreview(service: ChangePlanService, uid: string, title: string) {
  return service.previewChanges(context(uid, `preview-${title}`), {
    operations: [{
      op: 'update',
      collection: 'timeBlocks',
      id: 'block-1',
      patch: [{ field: 'title', value: title }],
    }],
    reason: `Preview ${title}.`,
  });
}

function context(uid: string, requestId: string): AuthContext {
  return { uid, requestId };
}
