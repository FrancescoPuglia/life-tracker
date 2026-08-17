import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CapabilityIssuer } from '../../src/domain/capabilities';
import {
  FirestoreRepository,
  type FirestoreRepositoryVerificationHooks,
} from '../../src/domain/firestore-repository';
import { createLifeTrackerDomain } from '../../src/domain/factory';
import { ChangePlanService } from '../../src/domain/services/change-plan-service';
import { FirestoreRateLimiter } from '../../src/http/rate-limiter';
import type { PreviewGoalArchitectureArgs, ScheduleBlockInput } from '../../src/domain/schemas';
import type { AuthContext } from '../../src/domain/types';

const PROJECT_ID = 'demo-life-tracker-functions';
const TEST_CAPABILITY_SECRET = 'test-only-capability-secret-that-is-longer-than-thirty-two-bytes';
const START = '2026-08-17T08:00:00.000Z';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('FirestoreRepository emulator transactions', () => {
  let app: App;
  let firestore: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID }, `repository-${Date.now()}`);
    firestore = getFirestore(app);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  it('applies once, verifies persisted state, and returns the same execution on retry/concurrency', async () => {
    const uid = uniqueUid('idempotent');
    await seedSchedule(firestore, uid);
    const { service } = serviceFor(firestore, ['plan-idempotent', 'execution-first', 'execution-retry-a', 'execution-retry-b']);
    const preview = await previewTitle(service, uid, 'Deep work moved');

    const [first, concurrent] = await Promise.all([
      service.applyPlan(context(uid, 'apply-a'), {
        planId: preview.id,
        approvalCapability: preview.approval.capability,
        idempotencyKey: 'same-request-key-0000000001',
      }),
      service.applyPlan(context(uid, 'apply-b'), {
        planId: preview.id,
        approvalCapability: preview.approval.capability,
        idempotencyKey: 'same-request-key-0000000001',
      }),
    ]);

    expect(first.executionId).toBe(concurrent.executionId);
    expect([first.idempotentReplay, concurrent.idempotentReplay].sort()).toEqual([false, true]);
    expect(first.verified).toBe(true);
    expect(concurrent.verified).toBe(true);
    expect(first.rollback?.capability).toBe(concurrent.rollback?.capability);
    const persisted = await firestore.doc(`users/${uid}/timeBlocks/block-1`).get();
    expect(persisted.data()?.title).toBe('Deep work moved');
    expect(persisted.data()?._version).toBe(1);

    const executions = await firestore.collection('aiExecutions').where('uid', '==', uid).get();
    expect(executions.size).toBe(1);
    const approval = await firestore.doc(`aiApprovals/${uid}_${preview.id}`).get();
    expect(approval.data()?.status).toBe('consumed');
    expect(JSON.stringify(approval.data())).not.toContain(preview.approval.capability);
    const audit = await firestore.doc(`aiAuditLogs/${uid}_${first.executionId}`).get();
    expect(audit.data()?.metadata).toMatchObject({
      changesetHash: preview.hash,
      baseStateHash: preview.baseStateHash,
      resultStateHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      executionId: first.executionId,
      idempotencyKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      rollbackStatus: 'available',
      verified: true,
    });
  }, 30_000);

  it('binds approval to the owner and exact plan and rejects cross-user entity probing', async () => {
    const alice = uniqueUid('alice');
    const bob = uniqueUid('bob');
    await seedSchedule(firestore, alice);
    await seedSchedule(firestore, bob);
    await firestore.doc(`users/${alice}/timeBlocks/alice-only-block`).set({
      id: 'alice-only-block',
      userId: alice,
      domainId: 'domain-1',
      title: 'Alice private block',
      startTime: Timestamp.fromDate(new Date('2026-08-17T12:00:00.000Z')),
      endTime: Timestamp.fromDate(new Date('2026-08-17T13:00:00.000Z')),
      status: 'planned',
      type: 'buffer',
      createdAt: Timestamp.fromDate(new Date('2026-08-16T08:00:00.000Z')),
      updatedAt: Timestamp.fromDate(new Date('2026-08-16T08:00:00.000Z')),
    });
    const { service } = serviceFor(firestore, ['plan-alice', 'plan-bob', 'execution-bob']);
    const alicePreview = await previewTitle(service, alice, 'Alice proposed title');
    const bobPreview = await previewTitle(service, bob, 'Bob proposed title');

    await expect(service.applyPlan(context(bob, 'wrong-owner'), {
      planId: alicePreview.id,
      approvalCapability: alicePreview.approval.capability,
      idempotencyKey: 'wrong-owner-key-000000001',
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(service.applyPlan(context(bob, 'wrong-plan'), {
      planId: bobPreview.id,
      approvalCapability: alicePreview.approval.capability,
      idempotencyKey: 'wrong-plan-key-0000000001',
    })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });

    await expect(service.previewChanges(context(bob, 'probe'), {
      operations: [{
        op: 'update',
        collection: 'timeBlocks',
        id: 'alice-only-block',
        patch: [{ field: 'title', value: 'Probe' }],
      }],
      reason: 'Cross-user entity probe',
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect((await firestore.doc(`users/${alice}/timeBlocks/block-1`).get()).data()?.title).toBe('Original block');
    expect((await firestore.doc(`users/${alice}/timeBlocks/alice-only-block`).get()).data()?.title).toBe('Alice private block');
    expect((await firestore.doc(`users/${bob}/timeBlocks/block-1`).get()).data()?.title).toBe('Original block');
  });

  it('rejects a stale preview after a direct client-style edit with zero planned mutation', async () => {
    const uid = uniqueUid('stale');
    await seedSchedule(firestore, uid);
    const { service } = serviceFor(firestore, ['plan-stale', 'execution-stale']);
    const preview = await previewTitle(service, uid, 'AI title that must not land');

    await firestore.doc(`users/${uid}/timeBlocks/block-1`).update({
      title: 'Human edit after preview',
      updatedAt: Timestamp.fromDate(new Date('2026-08-17T08:05:00.000Z')),
    });
    await expect(service.applyPlan(context(uid, 'stale-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'stale-apply-key-000000001',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });

    const persisted = await firestore.doc(`users/${uid}/timeBlocks/block-1`).get();
    expect(persisted.data()?.title).toBe('Human edit after preview');
    expect(persisted.data()?._version).toBeUndefined();
    const approval = await firestore.doc(`aiApprovals/${uid}_${preview.id}`).get();
    expect(approval.data()?.status).toBe('pending');
    expect((await firestore.collection('aiExecutions').where('uid', '==', uid).get()).empty).toBe(true);
  });

  it('consumes approval once and refuses a different-key replay', async () => {
    const uid = uniqueUid('approval-replay');
    await seedSchedule(firestore, uid);
    const { service } = serviceFor(firestore, ['plan-replay', 'execution-replay', 'execution-second']);
    const preview = await previewTitle(service, uid, 'Applied once');
    await service.applyPlan(context(uid, 'first'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'approval-first-key-00000001',
    });
    await expect(service.applyPlan(context(uid, 'second'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'approval-other-key-00000001',
    })).rejects.toMatchObject({ code: 'APPROVAL_REPLAYED' });
    expect((await firestore.doc(`users/${uid}/timeBlocks/block-1`).get()).data()?._version).toBe(1);
  });

  it('binds idempotent apply/rollback replays to the exact capability and current execution state', async () => {
    const uid = uniqueUid('capability-replay');
    await seedSchedule(firestore, uid);
    const { service } = serviceFor(firestore, ['plan-capability', 'execution-capability', 'execution-replay']);
    const preview = await previewTitle(service, uid, 'Capability title');
    const applyInput = {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'emulator-capability-apply-001',
    };
    const applied = await service.applyPlan(context(uid, 'capability-apply'), applyInput);
    await expect(service.applyPlan(context(uid, 'capability-wrong-apply'), {
      ...applyInput,
      approvalCapability: 'x'.repeat(43),
    })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });

    const rollbackInput = {
      executionId: applied.executionId,
      rollbackCapability: applied.rollback?.capability ?? '',
      idempotencyKey: 'emulator-capability-rollback-01',
    };
    await service.rollbackExecution(context(uid, 'capability-rollback'), rollbackInput);
    await expect(service.rollbackExecution(context(uid, 'capability-wrong-rollback'), {
      ...rollbackInput,
      rollbackCapability: 'y'.repeat(43),
    })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });

    const applyReplay = await service.applyPlan(context(uid, 'apply-after-rollback'), applyInput);
    expect(applyReplay).toMatchObject({
      executionId: applied.executionId,
      status: 'rolled_back',
      idempotentReplay: true,
      receipt: { status: 'rolled_back', rollbackAvailable: false },
    });
    expect(applyReplay.rollback).toBeUndefined();
  }, 30_000);

  it('rejects a phantom schedule block with zero partial writes in a multi-entity replacement', async () => {
    const uid = uniqueUid('schedule-phantom');
    await seedHierarchy(firestore, uid);
    const { domain } = domainFor(firestore, ['plan-schedule-phantom', 'execution-schedule-phantom']);
    const preview = await domain.scheduling.replaceDaySchedule(context(uid, 'schedule-preview'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [scheduleBlock({ id: 'ai-new-block' })],
      reason: 'Atomic schedule replacement with scope guard.',
    });
    expect(preview.operations).toEqual(expect.arrayContaining([
      { action: 'delete', entityType: 'timeBlocks', entityId: 'block-1' },
      { action: 'create', entityType: 'timeBlocks', entityId: 'ai-new-block' },
    ]));
    const createdAt = Timestamp.fromDate(new Date('2026-08-17T08:05:00.000Z'));
    await firestore.doc(`users/${uid}/timeBlocks/human-phantom`).set({
      id: 'human-phantom',
      userId: uid,
      domainId: 'domain-1',
      title: 'New locked commitment',
      startTime: Timestamp.fromDate(new Date('2026-08-17T08:30:00.000Z')),
      endTime: Timestamp.fromDate(new Date('2026-08-17T09:30:00.000Z')),
      status: 'planned',
      type: 'meeting',
      locked: true,
      createdAt,
      updatedAt: createdAt,
    });

    await expect(domain.changePlans.applyPlan(context(uid, 'schedule-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'emulator-schedule-phantom-key',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    expect((await firestore.doc(`users/${uid}/timeBlocks/block-1`).get()).exists).toBe(true);
    expect((await firestore.doc(`users/${uid}/timeBlocks/ai-new-block`).get()).exists).toBe(false);
    expect((await firestore.doc(`users/${uid}/timeBlocks/human-phantom`).get()).exists).toBe(true);
  }, 30_000);

  it('guards Goal Architect duplicate scopes and refuses rollback over a newer dependent child', async () => {
    const uid = uniqueUid('goal-scope');
    await seedDomain(firestore, uid);
    const { domain } = domainFor(firestore, [
      'plan-goal-a',
      'plan-goal-b',
      'execution-goal-a',
      'execution-goal-b',
    ]);
    const first = await domain.goalArchitect.preview(context(uid, 'goal-preview-a'), goalDraft());
    const second = await domain.goalArchitect.preview(context(uid, 'goal-preview-b'), goalDraft({
      goalId: 'goal-copy',
      projectId: 'project-copy',
      taskId: 'task-copy',
      keyResultIds: ['kr-copy-1', 'kr-copy-2'],
    }));
    const applied = await domain.changePlans.applyPlan(context(uid, 'goal-apply-a'), {
      planId: first.id,
      approvalCapability: first.approval.capability,
      idempotencyKey: 'emulator-goal-first-key-001',
    });
    await expect(domain.changePlans.applyPlan(context(uid, 'goal-apply-b'), {
      planId: second.id,
      approvalCapability: second.approval.capability,
      idempotencyKey: 'emulator-goal-second-key-01',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    expect((await firestore.doc(`users/${uid}/goals/goal-copy`).get()).exists).toBe(false);

    const timestamp = Timestamp.fromDate(new Date('2026-08-17T08:20:00.000Z'));
    await firestore.doc(`users/${uid}/tasks/human-dependent`).set({
      id: 'human-dependent',
      userId: uid,
      title: 'New human child',
      projectId: 'project-new',
      goalId: 'goal-new',
      domainId: 'domain-1',
      status: 'pending',
      priority: 'medium',
      estimatedMinutes: 30,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await expect(domain.changePlans.rollbackExecution(context(uid, 'goal-rollback'), {
      executionId: applied.executionId,
      rollbackCapability: applied.rollback?.capability ?? '',
      idempotencyKey: 'emulator-dependent-rollback-01',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    expect((await firestore.doc(`users/${uid}/projects/project-new`).get()).exists).toBe(true);
    expect((await firestore.doc(`users/${uid}/tasks/human-dependent`).get()).exists).toBe(true);
  }, 30_000);

  it('atomically applies and rolls back a complete Goal Architect hierarchy', async () => {
    const uid = uniqueUid('goal-rollback-success');
    await seedDomain(firestore, uid);
    const { domain } = domainFor(firestore, ['plan-goal-rollback', 'execution-goal-rollback']);
    const preview = await domain.goalArchitect.preview(context(uid, 'goal-rollback-preview'), goalDraft());
    const applied = await domain.changePlans.applyPlan(context(uid, 'goal-rollback-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'emulator-goal-rollback-apply',
    });
    for (const path of [
      'goals/goal-new',
      'projects/project-new',
      'tasks/task-new',
      'keyResults/kr-new-1',
      'keyResults/kr-new-2',
    ]) {
      expect((await firestore.doc(`users/${uid}/${path}`).get()).exists).toBe(true);
    }
    const rolledBack = await domain.changePlans.rollbackExecution(context(uid, 'goal-rollback-action'), {
      executionId: applied.executionId,
      rollbackCapability: applied.rollback?.capability ?? '',
      idempotencyKey: 'emulator-goal-rollback-key-01',
    });
    expect(rolledBack).toMatchObject({ status: 'rolled_back', verified: true });
    for (const path of [
      'goals/goal-new',
      'projects/project-new',
      'tasks/task-new',
      'keyResults/kr-new-1',
      'keyResults/kr-new-2',
    ]) {
      expect((await firestore.doc(`users/${uid}/${path}`).get()).exists).toBe(false);
    }
  }, 30_000);

  it('aborts every write when a multi-entity schedule transaction hits an audit conflict', async () => {
    const uid = uniqueUid('schedule-atomic-failure');
    await seedHierarchy(firestore, uid);
    const { domain } = domainFor(firestore, ['plan-schedule-failure', 'execution-schedule-failure']);
    const preview = await domain.scheduling.replaceDaySchedule(context(uid, 'schedule-failure-preview'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [scheduleBlock({ id: 'replacement-after-failure' })],
      reason: 'Prove a failed atomic replacement leaves the calendar intact.',
    });
    await firestore.doc(`aiAuditLogs/${uid}_execution-schedule-failure`).set({
      uid,
      actorUid: uid,
      sentinel: true,
    });
    await expect(domain.changePlans.applyPlan(context(uid, 'schedule-failure-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'emulator-schedule-failure-key',
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await firestore.doc(`users/${uid}/timeBlocks/block-1`).get()).exists).toBe(true);
    expect((await firestore.doc(`users/${uid}/timeBlocks/replacement-after-failure`).get()).exists).toBe(false);
    expect((await firestore.doc(`aiApprovals/${uid}_${preview.id}`).get()).data()?.status).toBe('pending');
  }, 30_000);

  it('rejects a schedule after persisted planning preferences change', async () => {
    const uid = uniqueUid('schedule-preference-drift');
    await seedHierarchy(firestore, uid);
    const { domain } = domainFor(firestore, ['plan-preference-drift', 'execution-preference-drift']);
    const preview = await domain.scheduling.replaceDaySchedule(context(uid, 'preference-preview'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [scheduleBlock({ id: 'preference-guarded-block' })],
      reason: 'Bind the preview to current planning constraints.',
    });
    await firestore.doc(`users/${uid}`).set({
      uid,
      preferences: {
        timezone: 'Europe/Rome',
        workingHours: { start: '08:00', end: '18:00' },
        maxDailyPlannedMinutes: 480,
        maxWeeklyPlannedMinutes: 2_400,
        minBufferMinutes: 30,
        maxConsecutiveHighEnergyBlocks: 2,
      },
    });
    await expect(domain.changePlans.applyPlan(context(uid, 'preference-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'emulator-preference-drift-key',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    expect((await firestore.doc(`users/${uid}/timeBlocks/block-1`).get()).exists).toBe(true);
    expect((await firestore.doc(`users/${uid}/timeBlocks/preference-guarded-block`).get()).exists).toBe(false);
  }, 30_000);

  it('preserves an executed overrun TimeBlock through replacement and rejects a focused move', async () => {
    const uid = uniqueUid('overrun-protection');
    await seedHierarchy(firestore, uid);
    await firestore.doc(`users/${uid}/timeBlocks/block-1`).update({ status: 'overrun' });
    const { domain } = domainFor(firestore, ['plan-overrun', 'execution-overrun']);
    const preview = await domain.scheduling.replaceDaySchedule(context(uid, 'overrun-preview'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [scheduleBlock({ id: 'overrun-safe-replacement' })],
      reason: 'Executed history must not be deleted by replanning.',
    });
    expect(preview.operations.some((operation) => operation.entityId === 'block-1')).toBe(false);

    await domain.changePlans.applyPlan(context(uid, 'overrun-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'emulator-overrun-apply-key-01',
    });
    expect((await firestore.doc(`users/${uid}/timeBlocks/block-1`).get()).data()).toMatchObject({
      status: 'overrun',
      title: 'Original block',
    });

    await expect(domain.scheduling.previewTimeBlockChange(context(uid, 'overrun-move'), {
      action: 'move',
      timezone: 'Europe/Rome',
      block: scheduleBlock({
        id: 'block-1',
        title: 'Original block',
        start: '2026-08-17T10:00:00.000Z',
        end: '2026-08-17T11:00:00.000Z',
      }),
      reason: 'Attempt to move executed history.',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }, 30_000);

  it('binds a cross-day move to both calendar scopes and refuses unsafe rollback into a filled source slot', async () => {
    const uid = uniqueUid('cross-day-rollback');
    await seedHierarchy(firestore, uid);
    const createdAt = Timestamp.fromDate(new Date('2026-08-16T08:00:00.000Z'));
    await firestore.doc(`users/${uid}/timeBlocks/cross-day-block`).set({
      id: 'cross-day-block',
      userId: uid,
      domainId: 'domain-1',
      taskId: 'task-1',
      projectId: 'project-1',
      goalId: 'goal-1',
      title: 'Cross-day block',
      startTime: Timestamp.fromDate(new Date('2026-08-17T07:00:00.000Z')),
      endTime: Timestamp.fromDate(new Date('2026-08-17T08:00:00.000Z')),
      status: 'planned',
      type: 'deep',
      flexibility: 'flexible',
      createdAt,
      updatedAt: createdAt,
    });
    const { domain } = domainFor(firestore, ['plan-cross-day', 'execution-cross-day']);
    const preview = await domain.scheduling.previewTimeBlockChange(context(uid, 'cross-day-preview'), {
      action: 'move',
      timezone: 'Europe/Rome',
      block: scheduleBlock({
        id: 'cross-day-block',
        title: 'Cross-day block',
        start: '2026-08-18T07:00:00.000Z',
        end: '2026-08-18T08:00:00.000Z',
      }),
      reason: 'Move one block to tomorrow.',
    });
    const applied = await domain.changePlans.applyPlan(context(uid, 'cross-day-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'emulator-cross-day-apply-key',
    });
    await firestore.doc(`users/${uid}/timeBlocks/human-source-fill`).set({
      id: 'human-source-fill',
      userId: uid,
      domainId: 'domain-1',
      title: 'Human source-slot edit',
      startTime: Timestamp.fromDate(new Date('2026-08-17T07:15:00.000Z')),
      endTime: Timestamp.fromDate(new Date('2026-08-17T07:45:00.000Z')),
      status: 'planned',
      type: 'meeting',
      locked: true,
      createdAt,
      updatedAt: createdAt,
    });

    await expect(domain.changePlans.rollbackExecution(context(uid, 'cross-day-rollback'), {
      executionId: applied.executionId,
      rollbackCapability: applied.rollback?.capability ?? '',
      idempotencyKey: 'emulator-cross-day-rollback-key',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    expect((await firestore.doc(`users/${uid}/timeBlocks/cross-day-block`).get()).data()?.startTime.toDate().toISOString())
      .toBe('2026-08-18T07:00:00.000Z');
    expect((await firestore.doc(`users/${uid}/timeBlocks/human-source-fill`).get()).exists).toBe(true);
  }, 30_000);

  it('recovers idempotently when apply and rollback commit before post-write verification fails', async () => {
    const uid = uniqueUid('post-commit-recovery');
    await seedSchedule(firestore, uid);
    const failures = { applied: 1, rolled_back: 1 };
    const hooks: FirestoreRepositoryVerificationHooks = {
      beforeVerification: (status) => {
        if (failures[status] > 0) {
          failures[status] -= 1;
          throw new Error(`Injected ${status} verification outage.`);
        }
      },
    };
    const { service } = serviceFor(
      firestore,
      ['plan-post-commit', 'execution-post-commit', 'execution-retry'],
      hooks,
    );
    const preview = await previewTitle(service, uid, 'Committed before verification');
    const applyInput = {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'post-commit-apply-key-000001',
    };

    await expect(service.applyPlan(context(uid, 'post-commit-apply'), applyInput))
      .rejects.toMatchObject({ code: 'COMMITTED_UNVERIFIED' });
    expect((await firestore.doc(`users/${uid}/timeBlocks/block-1`).get()).data()).toMatchObject({
      title: 'Committed before verification',
      _version: 1,
    });
    const recovered = await service.applyPlan(context(uid, 'post-commit-apply-retry'), applyInput);
    const recoveredAgain = await service.applyPlan(context(uid, 'post-commit-apply-retry-2'), applyInput);
    expect(recovered).toMatchObject({ verified: true, idempotentReplay: true });
    expect(recoveredAgain.executionId).toBe(recovered.executionId);
    expect(recoveredAgain.rollback?.capability).toBe(recovered.rollback?.capability);

    const rollbackInput = {
      executionId: recovered.executionId,
      rollbackCapability: recovered.rollback?.capability ?? '',
      idempotencyKey: 'post-commit-rollback-key-001',
    };
    await expect(service.rollbackExecution(context(uid, 'post-commit-rollback'), rollbackInput))
      .rejects.toMatchObject({ code: 'COMMITTED_UNVERIFIED' });
    expect((await firestore.doc(`users/${uid}/timeBlocks/block-1`).get()).data()?.title).toBe('Original block');
    const rollbackRecovered = await service.rollbackExecution(
      context(uid, 'post-commit-rollback-retry'),
      rollbackInput,
    );
    expect(rollbackRecovered).toMatchObject({
      executionId: recovered.executionId,
      status: 'rolled_back',
      verified: true,
      idempotentReplay: true,
    });
    expect((await firestore.collection('aiExecutions').where('uid', '==', uid).get()).size).toBe(1);
  }, 30_000);

  it('fails closed when a server-owned rollback snapshot value no longer matches its hash', async () => {
    const uid = uniqueUid('snapshot-integrity');
    await seedSchedule(firestore, uid);
    const { service } = serviceFor(firestore, ['plan-snapshot-integrity', 'execution-snapshot-integrity']);
    const preview = await previewTitle(service, uid, 'Must not apply from a corrupt snapshot');
    const snapshotRef = firestore.doc(`aiSnapshots/${uid}_${preview.id}`);
    const snapshot = await snapshotRef.get();
    const entries = (snapshot.data()?.entries as Array<Record<string, unknown>>).map((entry) =>
      entry.id === 'block-1'
        ? { ...entry, value: { ...(entry.value as Record<string, unknown>), title: 'Tampered snapshot' } }
        : entry);
    await snapshotRef.update({ entries });

    await expect(service.applyPlan(context(uid, 'snapshot-integrity-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'snapshot-integrity-apply-key',
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await firestore.doc(`users/${uid}/timeBlocks/block-1`).get()).data()?.title).toBe('Original block');
    expect((await firestore.doc(`aiApprovals/${uid}_${preview.id}`).get()).data()?.status).toBe('pending');
  }, 30_000);

  it('includes point records exactly at a bounded range lower edge', async () => {
    const uid = uniqueUid('point-boundary');
    const repository = new FirestoreRepository(firestore);
    const from = '2026-08-17T00:00:00.000Z';
    const before = Timestamp.fromDate(new Date('2026-08-16T23:59:59.000Z'));
    const atBoundary = Timestamp.fromDate(new Date(from));
    await Promise.all([
      firestore.doc(`users/${uid}/habitLogs/log-before`).set({
        id: 'log-before', userId: uid, habitId: 'habit-1', date: before,
        completed: true, createdAt: before, updatedAt: before,
      }),
      firestore.doc(`users/${uid}/habitLogs/log-boundary`).set({
        id: 'log-boundary', userId: uid, habitId: 'habit-1', date: atBoundary,
        completed: true, createdAt: atBoundary, updatedAt: atBoundary,
      }),
    ]);
    const page = await repository.listEntities(uid, 'habitLogs', {
      filter: {
        query: null,
        from,
        to: '2026-08-18T00:00:00.000Z',
        status: null,
        domainId: null,
        projectId: null,
        goalId: null,
        taskId: null,
      },
      cursor: null,
      limit: 10,
    });
    expect(page.items.map((item) => item.id)).toEqual(['log-boundary']);
  }, 30_000);

  it('rolls back once, verifies restoration, denies wrong-user rollback, and refuses newer edits', async () => {
    const owner = uniqueUid('rollback-owner');
    const other = uniqueUid('rollback-other');
    await seedSchedule(firestore, owner);
    const { service } = serviceFor(firestore, [
      'plan-rollback',
      'execution-rollback',
      'plan-later-change',
      'execution-later-change',
    ]);
    const preview = await previewTitle(service, owner, 'Temporary title');
    const applied = await service.applyPlan(context(owner, 'apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'rollback-apply-key-00000001',
    });
    expect(applied.rollback).toBeDefined();

    await expect(service.rollbackExecution(context(other, 'wrong-user'), {
      executionId: applied.executionId,
      rollbackCapability: applied.rollback?.capability ?? '',
      idempotencyKey: 'wrong-user-rollback-000001',
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const rolledBack = await service.rollbackExecution(context(owner, 'rollback'), {
      executionId: applied.executionId,
      rollbackCapability: applied.rollback?.capability ?? '',
      idempotencyKey: 'rollback-once-key-00000001',
    });
    expect(rolledBack.status).toBe('rolled_back');
    expect(rolledBack.verified).toBe(true);
    expect((await firestore.doc(`users/${owner}/timeBlocks/block-1`).get()).data()?.title).toBe('Original block');

    const replay = await service.rollbackExecution(context(owner, 'rollback-retry'), {
      executionId: applied.executionId,
      rollbackCapability: applied.rollback?.capability ?? '',
      idempotencyKey: 'rollback-once-key-00000001',
    });
    expect(replay.idempotentReplay).toBe(true);

    const secondPreview = await previewTitle(service, owner, 'Second AI edit');
    const secondApplied = await service.applyPlan(context(owner, 'second-apply'), {
      planId: secondPreview.id,
      approvalCapability: secondPreview.approval.capability,
      idempotencyKey: 'second-apply-key-000000001',
    });
    await firestore.doc(`users/${owner}/timeBlocks/block-1`).update({
      title: 'Newer human edit',
      updatedAt: Timestamp.fromDate(new Date('2026-08-17T08:15:00.000Z')),
    });
    await expect(service.rollbackExecution(context(owner, 'unsafe-rollback'), {
      executionId: secondApplied.executionId,
      rollbackCapability: secondApplied.rollback?.capability ?? '',
      idempotencyKey: 'unsafe-rollback-key-000001',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    expect((await firestore.doc(`users/${owner}/timeBlocks/block-1`).get()).data()?.title).toBe('Newer human edit');
  });

  it('keeps all entity writes unapplied when an audit write in the transaction conflicts', async () => {
    const uid = uniqueUid('audit-failure');
    await seedSchedule(firestore, uid);
    const { service } = serviceFor(firestore, ['plan-audit-failure', 'execution-audit-failure']);
    const preview = await previewTitle(service, uid, 'Must remain unapplied');
    await firestore.doc(`aiAuditLogs/${uid}_execution-audit-failure`).set({
      uid,
      actorUid: uid,
      sentinel: true,
    });

    await expect(service.applyPlan(context(uid, 'audit-conflict'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'audit-conflict-key-0000001',
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await firestore.doc(`users/${uid}/timeBlocks/block-1`).get()).data()?.title).toBe('Original block');
    expect((await firestore.doc(`aiApprovals/${uid}_${preview.id}`).get()).data()?.status).toBe('pending');
  });

  it('reads persisted preferences and makes the Europe/Rome product fallback explicit', async () => {
    const fallbackUid = uniqueUid('prefs-fallback');
    const persistedUid = uniqueUid('prefs-persisted');
    const partialUid = uniqueUid('prefs-partial');
    const repository = new FirestoreRepository(firestore);
    expect(await repository.getUserPlanningPreferences(fallbackUid)).toMatchObject({
      source: 'product_default',
      defaultsApplied: expect.arrayContaining(['timezone', 'workingHours']),
      timezone: 'Europe/Rome',
      workingHours: { start: '07:00', end: '22:00' },
    });

    await firestore.doc(`users/${persistedUid}`).set({
      uid: persistedUid,
      preferences: {
        timezone: 'America/New_York',
        workingHours: { start: '08:30', end: '16:30' },
        maxDailyPlannedMinutes: 480,
        maxWeeklyPlannedMinutes: 2_400,
        minBufferMinutes: 20,
        maxConsecutiveHighEnergyBlocks: 3,
      },
    });
    expect(await repository.getUserPlanningPreferences(persistedUid)).toEqual({
      source: 'persisted',
      defaultsApplied: [],
      timezone: 'America/New_York',
      workingHours: { start: '08:30', end: '16:30' },
      maxDailyPlannedMinutes: 480,
      maxWeeklyPlannedMinutes: 2_400,
      minBufferMinutes: 20,
      maxConsecutiveHighEnergyBlocks: 3,
    });

    await firestore.doc(`users/${partialUid}`).set({
      uid: partialUid,
      preferences: { timezone: 'Invalid/Zone', maxDailyPlannedMinutes: 480 },
    });
    expect(await repository.getUserPlanningPreferences(partialUid)).toMatchObject({
      source: 'persisted_with_defaults',
      timezone: 'Europe/Rome',
      maxDailyPlannedMinutes: 480,
      defaultsApplied: expect.arrayContaining([
        'timezone',
        'workingHours',
        'maxWeeklyPlannedMinutes',
      ]),
    });
  });

  it('enforces a shared per-user rate limit transaction under concurrency', async () => {
    const limiter = new FirestoreRateLimiter(firestore);
    const uid = uniqueUid('rate-limit');
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => limiter.consume({
      uid,
      bucket: 'chat',
      limit: 5,
      windowMs: 60_000,
      now: new Date(START),
    })));

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
    const rejected = attempts.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected).toHaveLength(7);
    expect(rejected.every((result) => result.reason?.code === 'RATE_LIMITED')).toBe(true);
    await expect(limiter.consume({
      uid: uniqueUid('rate-limit-other'),
      bucket: 'chat',
      limit: 5,
      windowMs: 60_000,
      now: new Date(START),
    })).resolves.toBeUndefined();
  }, 30_000);
});

function serviceFor(
  firestore: Firestore,
  ids: readonly string[],
  verificationHooks: FirestoreRepositoryVerificationHooks = {},
) {
  let index = 0;
  const repository = new FirestoreRepository(firestore, verificationHooks);
  const service = new ChangePlanService(repository, {
    clock: () => new Date(START),
    idFactory: () => ids[index++] ?? `fallback-${index}`,
    capabilityIssuer: new CapabilityIssuer(TEST_CAPABILITY_SECRET),
  });
  return { repository, service };
}

function domainFor(firestore: Firestore, ids: readonly string[]) {
  let index = 0;
  const repository = new FirestoreRepository(firestore);
  const domain = createLifeTrackerDomain(repository, {
    clock: () => new Date(START),
    idFactory: () => ids[index++] ?? `fallback-domain-${index}`,
    capabilityIssuer: new CapabilityIssuer(TEST_CAPABILITY_SECRET),
  });
  return { repository, domain };
}

async function previewTitle(service: ChangePlanService, uid: string, title: string) {
  return service.previewChanges(context(uid, `preview-${title}`), {
    operations: [{
      op: 'update',
      collection: 'timeBlocks',
      id: 'block-1',
      patch: [{ field: 'title', value: title }],
    }],
    reason: `Preview ${title}`,
  });
}

async function seedSchedule(firestore: Firestore, uid: string): Promise<void> {
  const createdAt = Timestamp.fromDate(new Date('2026-08-16T08:00:00.000Z'));
  await Promise.all([
    firestore.doc(`users/${uid}/domains/domain-1`).set({
      id: 'domain-1',
      userId: uid,
      name: 'Work',
      color: '#336699',
      icon: 'briefcase',
      createdAt,
      updatedAt: createdAt,
    }),
    firestore.doc(`users/${uid}/timeBlocks/block-1`).set({
      id: 'block-1',
      userId: uid,
      domainId: 'domain-1',
      title: 'Original block',
      startTime: Timestamp.fromDate(new Date('2026-08-17T09:00:00.000Z')),
      endTime: Timestamp.fromDate(new Date('2026-08-17T10:00:00.000Z')),
      status: 'planned',
      type: 'buffer',
      createdAt,
      updatedAt: createdAt,
    }),
  ]);
}

async function seedDomain(firestore: Firestore, uid: string): Promise<void> {
  const createdAt = Timestamp.fromDate(new Date('2026-08-16T08:00:00.000Z'));
  await firestore.doc(`users/${uid}/domains/domain-1`).set({
    id: 'domain-1',
    userId: uid,
    name: 'Work',
    color: '#336699',
    icon: 'briefcase',
    createdAt,
    updatedAt: createdAt,
  });
}

async function seedHierarchy(firestore: Firestore, uid: string): Promise<void> {
  await seedSchedule(firestore, uid);
  const createdAt = Timestamp.fromDate(new Date('2026-08-16T08:00:00.000Z'));
  await Promise.all([
    firestore.doc(`users/${uid}/goals/goal-1`).set({
      id: 'goal-1', userId: uid, title: 'Outcome', domainId: 'domain-1', status: 'active',
      createdAt, updatedAt: createdAt,
    }),
    firestore.doc(`users/${uid}/projects/project-1`).set({
      id: 'project-1', userId: uid, name: 'Result', goalId: 'goal-1', domainId: 'domain-1', status: 'active',
      createdAt, updatedAt: createdAt,
    }),
    firestore.doc(`users/${uid}/tasks/task-1`).set({
      id: 'task-1', userId: uid, title: 'Action', projectId: 'project-1', goalId: 'goal-1', domainId: 'domain-1', status: 'pending',
      createdAt, updatedAt: createdAt,
    }),
  ]);
}

function scheduleBlock(overrides: Partial<ScheduleBlockInput> = {}): ScheduleBlockInput {
  return {
    id: 'ai-new-block',
    title: 'Guarded deep work',
    start: '2026-08-17T11:00:00.000Z',
    end: '2026-08-17T12:00:00.000Z',
    type: 'deep',
    status: 'planned',
    taskId: 'task-1',
    projectId: 'project-1',
    goalId: 'goal-1',
    domainId: 'domain-1',
    notes: null,
    activityType: 'deep_work',
    energyLevel: 'high',
    flexibility: 'flexible',
    ...overrides,
  };
}

function goalDraft(ids: {
  goalId?: string;
  projectId?: string;
  taskId?: string;
  keyResultIds?: readonly [string, string];
} = {}): PreviewGoalArchitectureArgs {
  const goalId = ids.goalId ?? 'goal-new';
  const projectId = ids.projectId ?? 'project-new';
  return {
    domainId: 'domain-1',
    reason: 'Create an emulator-tested deterministic hierarchy.',
    goal: {
      id: goalId,
      title: 'Ship the verified release',
      description: null,
      targetHours: 100,
      dueDateISO: '2026-12-31T00:00:00.000Z',
      priority: 'high',
      timeAllocationTarget: 5,
      category: 'important_not_urgent',
      complexity: 'moderate',
    },
    projects: [{
      id: projectId,
      title: 'Release candidate ready',
      description: null,
      targetHours: 50,
      dueDateISO: null,
      priority: 'high',
    }],
    tasks: [{
      id: ids.taskId ?? 'task-new',
      title: 'Run the release checklist',
      description: null,
      estimatedHours: 2,
      dueDateISO: null,
      priority: 'high',
      parentProjectId: projectId,
    }],
    keyResults: (ids.keyResultIds ?? ['kr-new-1', 'kr-new-2']).map((id, index) => ({
      id,
      title: `Verified evidence ${index + 1}`,
      description: null,
      targetValue: 100,
      currentValue: 0,
      unit: 'percent' as const,
      customUnit: null,
    })),
  };
}

function context(uid: string, requestId: string): AuthContext {
  return { uid, requestId };
}

function uniqueUid(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
