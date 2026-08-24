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

  it('does not persist a proposal after the Responses execution is aborted', async () => {
    const harness = createHarness(['plan-aborted']);
    const controller = new AbortController();
    const capture = harness.repository.captureSnapshot.bind(harness.repository);
    vi.spyOn(harness.repository, 'captureSnapshot').mockImplementation(async (...args) => {
      const snapshot = await capture(...args);
      controller.abort();
      return snapshot;
    });
    const controlledContext: AuthContext = {
      ...context(UID, 'aborted-preview'),
      executionControl: {
        deadlineAtMs: Date.now() + 60_000,
        signal: controller.signal,
      },
    };

    await expect(harness.service.previewChanges(controlledContext, {
      operations: [{
        op: 'update',
        collection: 'timeBlocks',
        id: 'block-1',
        patch: [{ field: 'title', value: 'Must never persist' }],
      }],
      reason: 'Abort between snapshot and preview persistence.',
    })).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(await harness.repository.getPlan(UID, 'plan-aborted')).toBeNull();
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

  it('binds every idempotent replay to its capability and returns authoritative rollback state', async () => {
    const harness = createHarness(['plan-capability', 'execution-capability', 'execution-replay']);
    const preview = await updateTitlePreview(harness.service, UID, 'Capability-bound title');
    const applyInput = {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'capability-bound-apply-key-01',
    };
    const applied = await harness.service.applyPlan(context(UID, 'apply-capability'), applyInput);

    await expect(harness.service.applyPlan(context(UID, 'apply-wrong-capability'), {
      ...applyInput,
      approvalCapability: 'x'.repeat(43),
    })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });

    const rollbackInput = {
      executionId: applied.executionId,
      rollbackCapability: applied.rollback?.capability ?? '',
      idempotencyKey: 'capability-bound-rollback-01',
    };
    await harness.service.rollbackExecution(context(UID, 'rollback-capability'), rollbackInput);
    await expect(harness.service.rollbackExecution(context(UID, 'rollback-wrong-capability'), {
      ...rollbackInput,
      rollbackCapability: 'y'.repeat(43),
    })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });

    const applyReplay = await harness.service.applyPlan(context(UID, 'apply-after-rollback'), applyInput);
    expect(applyReplay).toMatchObject({
      executionId: applied.executionId,
      status: 'rolled_back',
      idempotentReplay: true,
      receipt: { status: 'rolled_back', rollbackAvailable: false },
    });
    expect(applyReplay.rollback).toBeUndefined();
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

  it('detects non-finite content drift even when canonical JSON would alias it to null', async () => {
    const harness = createHarness(['plan-non-finite-drift', 'execution-non-finite-drift']);
    harness.repository.seed(UID, 'notes', [{
      id: 'drift-note',
      userId: UID,
      domainId: 'domain-1',
      title: 'Original note',
      entityType: 'global',
      entityId: null,
      docJson: { type: 'doc', score: null, content: [] },
      tags: [],
      isPinned: false,
    }]);
    const preview = await harness.service.previewChanges(context(UID, 'non-finite-drift-preview'), {
      operations: [{
        op: 'update',
        collection: 'notes',
        id: 'drift-note',
        patch: [{ field: 'title', value: 'AI title' }],
      }],
      reason: 'Bind the exact Note content.',
    });
    harness.repository.mutateWithoutVersionForTest(UID, 'notes', 'drift-note', {
      docJson: { type: 'doc', score: Number.NaN, content: [] },
    });

    await expect(harness.service.applyPlan(context(UID, 'non-finite-drift-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'non-finite-drift-apply-01',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    const current = await harness.repository.getEntity(UID, 'notes', 'drift-note');
    expect(current?.title).toBe('Original note');
    expect((current?.docJson as { score?: unknown }).score).toBeNaN();
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

  it('refuses rollback over a newer non-finite edit that canonical JSON would alias to null', async () => {
    const harness = createHarness(['plan-non-finite-rollback', 'execution-non-finite-rollback']);
    harness.repository.seed(UID, 'notes', [{
      id: 'rollback-note',
      userId: UID,
      domainId: 'domain-1',
      title: 'Original note',
      entityType: 'global',
      entityId: null,
      docJson: { type: 'doc', score: null, content: [] },
      tags: [],
      isPinned: false,
    }]);
    const preview = await harness.service.previewChanges(context(UID, 'non-finite-rollback-preview'), {
      operations: [{
        op: 'update',
        collection: 'notes',
        id: 'rollback-note',
        patch: [{ field: 'title', value: 'Applied title' }],
      }],
      reason: 'Protect a later user edit from rollback.',
    });
    const applied = await harness.service.applyPlan(context(UID, 'non-finite-rollback-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'non-finite-rollback-apply-01',
    });
    harness.repository.mutateWithoutVersionForTest(UID, 'notes', 'rollback-note', {
      docJson: { type: 'doc', score: Number.NaN, content: [] },
    });

    await expect(harness.service.rollbackExecution(context(UID, 'non-finite-rollback-action'), {
      executionId: applied.executionId,
      rollbackCapability: applied.rollback?.capability ?? '',
      idempotencyKey: 'non-finite-rollback-action-01',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    const current = await harness.repository.getEntity(UID, 'notes', 'rollback-note');
    expect(current?.title).toBe('Applied title');
    expect((current?.docJson as { score?: unknown }).score).toBeNaN();
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

  it('canonicalizes every accepted writable instant before the preview hash is created', async () => {
    const harness = createHarness(['plan-canonical-time']);
    const preview = await harness.service.previewChanges(context(UID, 'canonical-time'), {
      operations: [{
        op: 'update',
        collection: 'timeBlocks',
        id: 'block-1',
        patch: [
          { field: 'startTime', value: '2026-08-17T14:00:00+02:00' },
          { field: 'endTime', value: '2026-08-17T15:00:00+02:00' },
        ],
      }],
      reason: 'Canonicalize equivalent offset instants.',
    });

    expect(preview.diff[0]?.after).toMatchObject({
      startTime: '2026-08-17T12:00:00.000Z',
      endTime: '2026-08-17T13:00:00.000Z',
    });
    expect((await harness.repository.getPlan(UID, preview.id))?.operations[0]?.values).toMatchObject({
      startTime: '2026-08-17T12:00:00.000Z',
      endTime: '2026-08-17T13:00:00.000Z',
    });
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

  it('rejects mutation of a TimeBlock that already has linked Session evidence', async () => {
    const harness = createHarness();
    harness.repository.seed(UID, 'sessions', [{
      id: 'session-for-block',
      timeBlockId: 'block-1',
      status: 'completed',
      startTime: '2026-08-17T09:05:00.000Z',
      endTime: '2026-08-17T09:55:00.000Z',
    }]);

    await expect(updateTitlePreview(harness.service, UID, 'Rewrite executed block'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await harness.repository.getEntity(UID, 'timeBlocks', 'block-1'))?.title)
      .toBe('Original block');
  });

  it('rejects a lossy preview before it can hide an over-limit field mutation', async () => {
    const harness = createHarness(['plan-lossy-preview']);
    const projectedNotes = 'a'.repeat(8_000);
    const protectedSuffix = 'KEEP-ME';
    harness.repository.seed(UID, 'timeBlocks', [{
      id: 'block-1',
      userId: UID,
      domainId: 'domain-1',
      title: 'Original block',
      notes: `${projectedNotes}${protectedSuffix}`,
      startTime: '2026-08-17T09:00:00.000Z',
      endTime: '2026-08-17T10:00:00.000Z',
      status: 'planned',
      type: 'buffer',
    }]);

    await expect(harness.service.previewChanges(context(UID, 'lossy-preview'), {
      operations: [{
        op: 'update',
        collection: 'timeBlocks',
        id: 'block-1',
        patch: [
          { field: 'notes', value: projectedNotes },
          { field: 'startTime', value: '2026-08-17T11:00:00.000Z' },
          { field: 'endTime', value: '2026-08-17T12:00:00.000Z' },
        ],
      }],
      reason: 'Reproduce a lossy approval preview.',
    })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });

    expect(await harness.repository.getPlan(UID, 'plan-lossy-preview')).toBeNull();
    expect(await harness.repository.listAuditEventsForUser(UID)).toEqual([]);
    expect(await harness.repository.getEntity(UID, 'timeBlocks', 'block-1')).toMatchObject({
      notes: `${projectedNotes}${protectedSuffix}`,
      startTime: '2026-08-17T09:00:00.000Z',
      endTime: '2026-08-17T10:00:00.000Z',
    });
  });

  it('rejects deletion when the complete material entity cannot fit the approval preview', async () => {
    const harness = createHarness(['plan-lossy-delete']);
    const protectedSuffix = 'DELETE-ME-ONLY-WITH-EXACT-PREVIEW';
    harness.repository.seed(UID, 'notes', [{
      id: 'long-note',
      userId: UID,
      domainId: 'domain-1',
      title: 'Long note',
      entityType: 'global',
      entityId: null,
      docJson: `${'a'.repeat(8_000)}${protectedSuffix}`,
      tags: [],
      isPinned: false,
    }]);

    await expect(harness.service.previewChanges(context(UID, 'lossy-delete'), {
      operations: [{
        op: 'delete',
        collection: 'notes',
        id: 'long-note',
        patch: [],
      }],
      reason: 'Delete only after an exact preview.',
    })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });

    expect(await harness.repository.getPlan(UID, 'plan-lossy-delete')).toBeNull();
    expect(await harness.repository.listAuditEventsForUser(UID)).toEqual([]);
    expect((await harness.repository.getEntity(UID, 'notes', 'long-note'))?.docJson)
      .toContain(protectedSuffix);
  });

  it('includes every known semantic field in a destructive approval preview', async () => {
    const harness = createHarness(['plan-complete-delete']);
    harness.repository.seed(UID, 'notes', [{
      id: 'templated-note',
      userId: UID,
      domainId: 'domain-1',
      title: 'Templated note',
      entityType: 'global',
      entityId: null,
      docJson: { type: 'doc', content: [] },
      templateId: 'valuable-template',
      tags: [],
      isPinned: false,
    }]);

    const preview = await harness.service.previewChanges(context(UID, 'complete-delete'), {
      operations: [{
        op: 'delete',
        collection: 'notes',
        id: 'templated-note',
        patch: [],
      }],
      reason: 'Show the complete destructive change.',
    });
    expect(preview.diff[0]?.before).toHaveProperty('templateId', 'valuable-template');
    expect(preview.diff[0]?.changedFields).toContain('templateId');
    expect((await harness.repository.getEntity(UID, 'notes', 'templated-note'))?.templateId)
      .toBe('valuable-template');
  });

  it('fails closed when a deleted entity contains an unknown semantic field', async () => {
    const harness = createHarness(['plan-unknown-delete']);
    harness.repository.seed(UID, 'notes', [{
      id: 'future-note',
      userId: UID,
      domainId: 'domain-1',
      title: 'Future note',
      entityType: 'global',
      entityId: null,
      docJson: { type: 'doc', content: [] },
      futureSemanticField: 'must-not-disappear-silently',
      tags: [],
      isPinned: false,
    }]);

    await expect(harness.service.previewChanges(context(UID, 'unknown-delete'), {
      operations: [{
        op: 'delete',
        collection: 'notes',
        id: 'future-note',
        patch: [],
      }],
      reason: 'Unknown fields require an explicit product contract.',
    })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });

    expect(await harness.repository.getPlan(UID, 'plan-unknown-delete')).toBeNull();
    expect(await harness.repository.listAuditEventsForUser(UID)).toEqual([]);
    expect((await harness.repository.getEntity(UID, 'notes', 'future-note'))?.futureSemanticField)
      .toBe('must-not-disappear-silently');
  });

  it('rejects a delete preview that would alias a non-finite number to null', async () => {
    const harness = createHarness(['plan-non-finite-delete']);
    harness.repository.seed(UID, 'notes', [{
      id: 'non-finite-note',
      userId: UID,
      domainId: 'domain-1',
      title: 'Non-finite note',
      entityType: 'global',
      entityId: null,
      docJson: { type: 'doc', score: Number.NaN, content: [] },
      tags: [],
      isPinned: false,
    }]);

    await expect(harness.service.previewChanges(context(UID, 'non-finite-delete'), {
      operations: [{
        op: 'delete',
        collection: 'notes',
        id: 'non-finite-note',
        patch: [],
      }],
      reason: 'Reproduce non-finite numeric projection loss.',
    })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });

    expect(await harness.repository.getPlan(UID, 'plan-non-finite-delete')).toBeNull();
    expect(await harness.repository.listAuditEventsForUser(UID)).toEqual([]);
    const original = await harness.repository.getEntity(UID, 'notes', 'non-finite-note');
    expect((original?.docJson as { score?: unknown }).score).toBeNaN();
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
