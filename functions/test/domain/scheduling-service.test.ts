import { describe, expect, it } from 'vitest';
import { CapabilityIssuer } from '../../src/domain/capabilities';
import { createLifeTrackerDomain } from '../../src/domain/factory';
import { InMemoryRepository } from '../../src/domain/in-memory-repository';
import type { ReplaceDayScheduleArgs, ScheduleBlockInput } from '../../src/domain/schemas';
import type { AuthContext } from '../../src/domain/types';

const UID = 'schedule-owner';
const OTHER_UID = 'schedule-other';
const CAPABILITY_SECRET = 'schedule-test-capability-secret-at-least-thirty-two-bytes';

describe('Weekly Planning Intelligence backend adapter', () => {
  it('creates an empty-week draft, preserves WPI_KEY semantics, and applies once on retry', async () => {
    const { repository, domain } = harness(['plan-empty', 'execution-empty', 'execution-retry']);
    const plan = await domain.scheduling.replaceWeekSchedule(context(UID, 'preview'), {
      weekStart: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({
        id: null,
        start: '2026-08-17T07:00:00.000Z',
        end: '2026-08-17T08:00:00.000Z',
      })],
      reason: 'Plan an empty week.',
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]?.action).toBe('create');
    const input = {
      planId: plan.id,
      approvalCapability: plan.approval.capability,
      idempotencyKey: 'same-week-apply-key-000001',
    };
    const applied = await domain.changePlans.applyPlan(context(UID, 'apply'), input);
    const replay = await domain.changePlans.applyPlan(context(UID, 'retry'), input);
    expect(replay.executionId).toBe(applied.executionId);
    expect(replay.idempotentReplay).toBe(true);
    const createdId = plan.operations[0]?.entityId ?? '';
    const created = await repository.getEntity(UID, 'timeBlocks', createdId);
    expect(created?.notes).toMatch(/WPI_KEY: wpi:/);
  });

  it('never deletes or moves fixed blocks and blocks a proposed overlap visibly', async () => {
    const { repository, domain } = harness();
    repository.seed(UID, 'timeBlocks', [{
      id: 'locked-block',
      title: 'Fixed commitment',
      domainId: 'domain-1',
      startTime: '2026-08-17T08:00:00.000Z',
      endTime: '2026-08-17T09:00:00.000Z',
      status: 'planned',
      type: 'meeting',
      locked: true,
    }]);
    const plan = await domain.scheduling.replaceDaySchedule(context(UID, 'locked-preview'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({
        id: 'new-overlap',
        start: '2026-08-17T08:30:00.000Z',
        end: '2026-08-17T09:30:00.000Z',
      })],
      reason: 'Try an overlapping schedule.',
    });

    expect(plan.operations.some((operation) => operation.entityId === 'locked-block')).toBe(false);
    expect(plan.conflicts.some((message) => /protected block/i.test(message))).toBe(true);
    expect(plan.warnings.some((message) => /Preserved 1/i.test(message))).toBe(true);
    await expect(domain.changePlans.applyPlan(context(UID, 'blocked-apply'), {
      planId: plan.id,
      approvalCapability: plan.approval.capability,
      idempotencyKey: 'blocked-overlap-key-000001',
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await repository.getEntity(UID, 'timeBlocks', 'locked-block'))?.startTime).toBe('2026-08-17T08:00:00.000Z');
  });

  it('preserves executed overrun blocks and rejects focused AI changes to them', async () => {
    const { repository, domain } = harness();
    repository.seed(UID, 'timeBlocks', [{
      id: 'executed-overrun',
      title: 'Executed session history',
      domainId: 'domain-1',
      startTime: '2026-08-17T08:00:00.000Z',
      endTime: '2026-08-17T09:00:00.000Z',
      status: 'overrun',
      type: 'deep',
      taskId: 'task-1',
      projectId: 'project-1',
      goalId: 'goal-1',
    }]);

    const replacement = await domain.scheduling.replaceDaySchedule(context(UID, 'overrun-replace'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({
        id: 'later-block',
        start: '2026-08-17T10:00:00.000Z',
        end: '2026-08-17T11:00:00.000Z',
      })],
      reason: 'Executed history must survive replanning.',
    });
    expect(replacement.operations.some((operation) => operation.entityId === 'executed-overrun')).toBe(false);
    expect(replacement.warnings.some((warning) => /Preserved 1/i.test(warning))).toBe(true);

    await expect(domain.scheduling.previewTimeBlockChange(context(UID, 'overrun-move'), {
      action: 'move',
      timezone: 'Europe/Rome',
      block: block({
        id: 'executed-overrun',
        start: '2026-08-17T09:00:00.000Z',
        end: '2026-08-17T10:00:00.000Z',
      }),
      reason: 'Attempt to move executed history.',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('protects TimeBlocks carrying authoritative actual execution timestamps', async () => {
    const { repository, domain } = harness();
    repository.seed(UID, 'timeBlocks', [{
      id: 'actual-history',
      title: 'Executed before status sync',
      domainId: 'domain-1',
      startTime: '2026-08-17T08:00:00.000Z',
      endTime: '2026-08-17T09:00:00.000Z',
      actualStartTime: '2026-08-17T08:05:00.000Z',
      actualEndTime: '2026-08-17T08:55:00.000Z',
      status: 'planned',
      type: 'deep',
      taskId: 'task-1',
      projectId: 'project-1',
      goalId: 'goal-1',
    }]);

    const replacement = await domain.scheduling.replaceDaySchedule(context(UID, 'actual-replace'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({ id: 'later-actual-safe', start: '2026-08-17T10:00:00.000Z', end: '2026-08-17T11:00:00.000Z' })],
      reason: 'Explicit actual execution evidence must survive replanning.',
    });
    expect(replacement.operations.some((operation) => operation.entityId === 'actual-history')).toBe(false);

    await expect(domain.scheduling.previewTimeBlockChange(context(UID, 'actual-move'), {
      action: 'move',
      timezone: 'Europe/Rome',
      block: block({
        id: 'actual-history',
        start: '2026-08-17T09:00:00.000Z',
        end: '2026-08-17T10:00:00.000Z',
      }),
      reason: 'Attempt to move trusted execution history.',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('persists an approved fixed proposal as a protected commitment for later replanning', async () => {
    const { repository, domain } = harness(['plan-fixed-create', 'execution-fixed-create', 'plan-replan']);
    const first = await domain.scheduling.replaceDaySchedule(context(UID, 'fixed-create'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({
        id: 'fixed-created',
        start: '2026-08-17T08:00:00.000Z',
        end: '2026-08-17T09:00:00.000Z',
        flexibility: 'fixed',
      })],
      reason: 'Create one fixed commitment.',
    });
    await domain.changePlans.applyPlan(context(UID, 'fixed-apply'), {
      planId: first.id,
      approvalCapability: first.approval.capability,
      idempotencyKey: 'fixed-roundtrip-apply-key-01',
    });
    expect(await repository.getEntity(UID, 'timeBlocks', 'fixed-created')).toMatchObject({
      flexibility: 'fixed',
    });

    const replan = await domain.scheduling.replaceDaySchedule(context(UID, 'fixed-replan'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({
        id: 'later-flexible',
        start: '2026-08-17T10:00:00.000Z',
        end: '2026-08-17T11:00:00.000Z',
      })],
      reason: 'Replan without moving the fixed commitment.',
    });
    expect(replan.operations.some((operation) => operation.entityId === 'fixed-created')).toBe(false);
    expect(replan.warnings.some((warning) => /Preserved 1/i.test(warning))).toBe(true);
  });

  it('detects a protected interval that begins before the calendar range', async () => {
    const { repository, domain } = harness();
    repository.seed(UID, 'timeBlocks', [{
      id: 'cross-midnight-locked',
      title: 'Overnight commitment',
      domainId: 'domain-1',
      startTime: '2026-08-16T21:30:00.000Z',
      endTime: '2026-08-16T22:30:00.000Z',
      status: 'planned',
      type: 'meeting',
      locked: true,
    }]);
    const preview = await domain.scheduling.replaceDaySchedule(context(UID, 'boundary-preview'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({
        id: 'boundary-overlap',
        start: '2026-08-16T22:15:00.000Z',
        end: '2026-08-16T23:00:00.000Z',
      })],
      reason: 'The overnight lock must remain visible.',
    });
    expect(preview.conflicts.some((conflict) => /protected block/i.test(conflict))).toBe(true);
    expect(preview.operations.some((operation) => operation.entityId === 'cross-midnight-locked')).toBe(false);
  });

  it('rejects a preview when a different-id overlapping block appears before apply', async () => {
    const { repository, domain } = harness(['plan-phantom', 'execution-phantom']);
    const preview = await domain.scheduling.replaceDaySchedule(context(UID, 'phantom-preview'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({
        id: 'ai-proposed',
        start: '2026-08-17T08:00:00.000Z',
        end: '2026-08-17T09:00:00.000Z',
      })],
      reason: 'Create a guarded schedule.',
    });
    repository.seed(UID, 'timeBlocks', [{
      id: 'human-phantom',
      title: 'New human commitment',
      domainId: 'domain-1',
      startTime: '2026-08-17T08:30:00.000Z',
      endTime: '2026-08-17T09:30:00.000Z',
      status: 'planned',
      type: 'meeting',
      locked: true,
    }]);

    await expect(domain.changePlans.applyPlan(context(UID, 'phantom-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'phantom-scope-apply-key-001',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    expect(await repository.getEntity(UID, 'timeBlocks', 'ai-proposed')).toBeNull();
    expect(await repository.getEntity(UID, 'timeBlocks', 'human-phantom')).not.toBeNull();
  });

  it('rejects a schedule preview after authoritative planning preferences change', async () => {
    const { repository, domain } = harness(['plan-preference-drift', 'execution-preference-drift']);
    const preview = await domain.scheduling.replaceDaySchedule(context(UID, 'preference-preview'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({ id: 'preference-guarded' })],
      reason: 'Guard the current planning constraints.',
    });
    repository.setPlanningPreferencesForTest(UID, {
      source: 'persisted',
      defaultsApplied: [],
      timezone: 'Europe/Rome',
      workingHours: { start: '08:00', end: '18:00' },
      maxDailyPlannedMinutes: 480,
      maxWeeklyPlannedMinutes: 2_400,
      minBufferMinutes: 30,
      maxConsecutiveHighEnergyBlocks: 2,
    });
    await expect(domain.changePlans.applyPlan(context(UID, 'preference-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'preference-drift-key-0001',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    expect(await repository.getEntity(UID, 'timeBlocks', 'preference-guarded')).toBeNull();
  });

  it('surfaces overlap and persisted capacity constraints from the authoritative WPI engine', async () => {
    const { repository, domain } = harness();
    repository.setPlanningPreferencesForTest(UID, {
      source: 'persisted',
      defaultsApplied: [],
      timezone: 'Europe/Rome',
      workingHours: { start: '08:00', end: '18:00' },
      maxDailyPlannedMinutes: 120,
      maxWeeklyPlannedMinutes: 300,
      minBufferMinutes: 15,
      maxConsecutiveHighEnergyBlocks: 2,
    });
    const plan = await domain.scheduling.replaceDaySchedule(context(UID, 'capacity-preview'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [
        block({ id: 'first', start: '2026-08-17T07:00:00.000Z', end: '2026-08-17T08:30:00.000Z' }),
        block({ id: 'second', start: '2026-08-17T08:00:00.000Z', end: '2026-08-17T09:30:00.000Z' }),
      ],
      reason: 'Show deterministic conflicts.',
    });

    expect(plan.conflicts.some((message) => /sovrappongono|overlap/i.test(message))).toBe(true);
    expect(plan.warnings.some((message) => /sovraccarico|overload/i.test(message))).toBe(true);
    expect(plan.assumptions).toEqual([]);
  });

  it('grounds a day preview in the full persisted week and binds that capacity scope', async () => {
    const { repository, domain } = harness(['plan-full-week-capacity', 'execution-full-week-capacity']);
    repository.setPlanningPreferencesForTest(UID, {
      source: 'persisted',
      defaultsApplied: [],
      timezone: 'Europe/Rome',
      workingHours: { start: '07:00', end: '22:00' },
      maxDailyPlannedMinutes: 600,
      maxWeeklyPlannedMinutes: 300,
      minBufferMinutes: 0,
      maxConsecutiveHighEnergyBlocks: 4,
    });
    repository.seed(UID, 'timeBlocks', [{
      id: 'tuesday-existing-capacity',
      title: 'Existing Tuesday workload',
      domainId: 'domain-1',
      startTime: '2026-08-18T07:00:00.000Z',
      endTime: '2026-08-18T11:00:00.000Z',
      status: 'planned',
      type: 'deep',
      taskId: 'task-1',
      projectId: 'project-1',
      goalId: 'goal-1',
    }]);

    const plan = await domain.scheduling.replaceDaySchedule(context(UID, 'full-week-capacity-preview'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({
        id: 'monday-capacity',
        start: '2026-08-17T07:00:00.000Z',
        end: '2026-08-17T09:00:00.000Z',
      })],
      reason: 'A day preview must account for the rest of the week.',
    });
    expect(plan.warnings.some((message) => /settimana sovraccarica|weekly overload/i.test(message))).toBe(true);
    expect(plan.operations.some((operation) => operation.entityId === 'tuesday-existing-capacity')).toBe(false);

    repository.mutateForTest(UID, 'timeBlocks', 'tuesday-existing-capacity', { title: 'Human changed Tuesday' });
    await expect(domain.changePlans.applyPlan(context(UID, 'full-week-capacity-apply'), {
      planId: plan.id,
      approvalCapability: plan.approval.capability,
      idempotencyKey: 'full-week-capacity-key-001',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    expect(await repository.getEntity(UID, 'timeBlocks', 'monday-capacity')).toBeNull();
  });

  it('enforces the persisted minimum buffer through the shared WPI validator', async () => {
    const { repository, domain } = harness();
    repository.setPlanningPreferencesForTest(UID, {
      source: 'persisted',
      defaultsApplied: [],
      timezone: 'Europe/Rome',
      workingHours: { start: '07:00', end: '22:00' },
      maxDailyPlannedMinutes: 600,
      maxWeeklyPlannedMinutes: 3_000,
      minBufferMinutes: 15,
      maxConsecutiveHighEnergyBlocks: 3,
    });
    const plan = await domain.scheduling.replaceDaySchedule(context(UID, 'buffer-preview'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [
        block({ id: 'buffer-first', start: '2026-08-17T07:00:00.000Z', end: '2026-08-17T08:00:00.000Z' }),
        block({ id: 'buffer-second', start: '2026-08-17T08:05:00.000Z', end: '2026-08-17T09:00:00.000Z' }),
      ],
      reason: 'The persisted buffer must be authoritative.',
    });
    expect(plan.conflicts.some((message) => /buffer insufficiente/i.test(message))).toBe(true);
  });

  it('persists a WPI semantic marker for calendar-only maintenance blocks', async () => {
    const { repository, domain } = harness(['plan-maintenance', 'execution-maintenance']);
    const plan = await domain.scheduling.replaceDaySchedule(context(UID, 'maintenance-preview'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({
        id: 'maintenance-buffer',
        type: 'buffer',
        activityType: 'maintenance',
        energyLevel: 'low',
        taskId: null,
        projectId: null,
        goalId: null,
      })],
      reason: 'Create a bounded calendar buffer.',
    });
    await domain.changePlans.applyPlan(context(UID, 'maintenance-apply'), {
      planId: plan.id,
      approvalCapability: plan.approval.capability,
      idempotencyKey: 'maintenance-wpi-key-00001',
    });
    expect((await repository.getEntity(UID, 'timeBlocks', 'maintenance-buffer'))?.notes)
      .toMatch(/WPI_KEY: wpi:/);
  });

  it('counts protected commitments toward capacity without emitting mutations for them', async () => {
    const { repository, domain } = harness();
    repository.setPlanningPreferencesForTest(UID, {
      source: 'persisted',
      defaultsApplied: [],
      timezone: 'Europe/Rome',
      workingHours: { start: '08:00', end: '18:00' },
      maxDailyPlannedMinutes: 120,
      maxWeeklyPlannedMinutes: 600,
      minBufferMinutes: 0,
      maxConsecutiveHighEnergyBlocks: 3,
    });
    repository.seed(UID, 'timeBlocks', [{
      id: 'fixed-capacity',
      title: 'Fixed capacity',
      domainId: 'domain-1',
      startTime: '2026-08-17T06:00:00.000Z',
      endTime: '2026-08-17T07:30:00.000Z',
      status: 'planned',
      type: 'meeting',
      locked: true,
    }]);

    const plan = await domain.scheduling.replaceDaySchedule(context(UID, 'fixed-capacity-preview'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({
        id: 'capacity-addition',
        start: '2026-08-17T08:00:00.000Z',
        end: '2026-08-17T09:00:00.000Z',
      })],
      reason: 'Prove protected commitments consume capacity.',
    });

    expect(plan.operations.some((operation) => operation.entityId === 'fixed-capacity')).toBe(false);
    expect(plan.warnings.some((message) => /150 minuti.*120/i.test(message))).toBe(true);
  });

  it('preserves cancelled history without treating it as an active conflict or capacity commitment', async () => {
    const { repository, domain } = harness();
    repository.setPlanningPreferencesForTest(UID, {
      source: 'persisted',
      defaultsApplied: [],
      timezone: 'Europe/Rome',
      workingHours: { start: '07:00', end: '22:00' },
      maxDailyPlannedMinutes: 60,
      maxWeeklyPlannedMinutes: 600,
      minBufferMinutes: 0,
      maxConsecutiveHighEnergyBlocks: 3,
    });
    repository.seed(UID, 'timeBlocks', [{
      id: 'cancelled-history',
      title: 'Cancelled historical slot',
      domainId: 'domain-1',
      startTime: '2026-08-17T07:00:00.000Z',
      endTime: '2026-08-17T09:00:00.000Z',
      status: 'cancelled',
      type: 'deep',
      taskId: 'task-1',
      projectId: 'project-1',
      goalId: 'goal-1',
    }]);

    const plan = await domain.scheduling.replaceDaySchedule(context(UID, 'cancelled-history-preview'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({
        id: 'replacement-in-cancelled-slot',
        start: '2026-08-17T07:00:00.000Z',
        end: '2026-08-17T08:00:00.000Z',
      })],
      reason: 'Cancelled history must not reserve live capacity.',
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.warnings.some((message) => /overload|sovraccarico/i.test(message))).toBe(false);
    expect(plan.operations.some((operation) => operation.entityId === 'cancelled-history')).toBe(false);
    expect(await repository.getEntity(UID, 'timeBlocks', 'cancelled-history')).not.toBeNull();

    await expect(domain.scheduling.previewTimeBlockChange(context(UID, 'cancelled-history-focused'), {
      action: 'update',
      timezone: 'Europe/Rome',
      block: block({
        id: 'cancelled-history',
        start: '2026-08-17T07:00:00.000Z',
        end: '2026-08-17T09:00:00.000Z',
      }),
      reason: 'Cancelled history must remain immutable.',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(domain.scheduling.replaceDaySchedule(context(UID, 'cancelled-history-reuse'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({
        id: 'cancelled-history',
        start: '2026-08-17T07:00:00.000Z',
        end: '2026-08-17T08:00:00.000Z',
      })],
      reason: 'A replacement cannot reactivate a cancelled identifier.',
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await repository.getEntity(UID, 'timeBlocks', 'cancelled-history'))?.status).toBe('cancelled');
  });

  it('clips a long-running protected commitment to the requested WPI week for capacity', async () => {
    const { repository, domain } = harness();
    repository.setPlanningPreferencesForTest(UID, {
      source: 'persisted',
      defaultsApplied: [],
      timezone: 'Europe/Rome',
      workingHours: { start: '00:00', end: '23:59' },
      maxDailyPlannedMinutes: 120,
      maxWeeklyPlannedMinutes: 600,
      minBufferMinutes: 0,
      maxConsecutiveHighEnergyBlocks: 3,
    });
    repository.seed(UID, 'timeBlocks', [{
      id: 'long-protected',
      title: 'Long protected commitment',
      domainId: 'domain-1',
      startTime: '2026-08-01T00:00:00.000Z',
      endTime: '2026-08-17T07:30:00.000Z',
      status: 'planned',
      type: 'meeting',
      locked: true,
    }]);
    const preview = await domain.scheduling.replaceDaySchedule(context(UID, 'long-protected-preview'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({
        id: 'post-long-commitment',
        start: '2026-08-17T08:00:00.000Z',
        end: '2026-08-17T09:00:00.000Z',
      })],
      reason: 'Count the overlapping portion of a long protected commitment.',
    });
    expect(preview.warnings.some((message) => /sovraccarico|overload/i.test(message))).toBe(true);
  });

  it('rejects incompatible Task/Project hierarchy references', async () => {
    const { repository, domain } = harness();
    repository.seed(UID, 'projects', [{
      id: 'project-2',
      name: 'Different project',
      goalId: 'goal-1',
      domainId: 'domain-1',
    }]);
    await expect(domain.scheduling.replaceDaySchedule(context(UID, 'incompatible-mapping'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({ projectId: 'project-2', taskId: 'task-1' })],
      reason: 'Invalid hierarchy mapping.',
    })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('routes a focused move through WPI, preserves other commitments, and exposes no replacement deletes', async () => {
    const { repository, domain } = harness();
    repository.seed(UID, 'timeBlocks', [
      {
        id: 'move-me',
        title: 'Move me',
        domainId: 'domain-1',
        taskId: 'task-1',
        projectId: 'project-1',
        goalId: 'goal-1',
        startTime: '2026-08-17T07:00:00.000Z',
        endTime: '2026-08-17T08:00:00.000Z',
        status: 'planned',
        type: 'deep',
      },
      {
        id: 'other-commitment',
        title: 'Other commitment',
        domainId: 'domain-1',
        startTime: '2026-08-17T10:00:00.000Z',
        endTime: '2026-08-17T11:00:00.000Z',
        status: 'planned',
        type: 'buffer',
      },
    ]);

    const plan = await domain.scheduling.previewTimeBlockChange(context(UID, 'focused-move'), {
      action: 'move',
      timezone: 'Europe/Rome',
      block: block({
        id: 'move-me',
        title: 'Move me',
        start: '2026-08-17T08:00:00.000Z',
        end: '2026-08-17T09:00:00.000Z',
      }),
      reason: 'Move one block only.',
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.operations).toEqual([
      { action: 'move', entityType: 'timeBlocks', entityId: 'move-me' },
    ]);
    expect(plan.operations.some((operation) => operation.entityId === 'other-commitment')).toBe(false);
  });

  it('supports a focused move across calendar days without treating the owned source as missing', async () => {
    const { repository, domain } = harness();
    repository.seed(UID, 'timeBlocks', [{
      id: 'cross-day-move',
      title: 'Cross-day move',
      domainId: 'domain-1',
      taskId: 'task-1',
      projectId: 'project-1',
      goalId: 'goal-1',
      startTime: '2026-08-17T07:00:00.000Z',
      endTime: '2026-08-17T08:00:00.000Z',
      status: 'planned',
      type: 'deep',
    }]);

    const plan = await domain.scheduling.previewTimeBlockChange(context(UID, 'cross-day-preview'), {
      action: 'move',
      timezone: 'Europe/Rome',
      block: block({
        id: 'cross-day-move',
        title: 'Cross-day move',
        start: '2026-08-18T07:00:00.000Z',
        end: '2026-08-18T08:00:00.000Z',
      }),
      reason: 'Move this exact block to tomorrow.',
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.operations).toEqual([
      { action: 'move', entityType: 'timeBlocks', entityId: 'cross-day-move' },
    ]);
    expect(plan.diff[0]).toMatchObject({
      before: { startTime: '2026-08-17T07:00:00.000Z' },
      after: { startTime: '2026-08-18T07:00:00.000Z' },
    });
  });

  it('fails closed when a mutable existing block crosses a replacement or move calendar boundary', async () => {
    const { repository, domain } = harness();
    repository.seed(UID, 'timeBlocks', [{
      id: 'mutable-overnight',
      title: 'Mutable overnight block',
      domainId: 'domain-1',
      taskId: 'task-1',
      projectId: 'project-1',
      goalId: 'goal-1',
      // Sunday 23:30 -> Monday 00:30 in Europe/Rome.
      startTime: '2026-08-16T21:30:00.000Z',
      endTime: '2026-08-16T22:30:00.000Z',
      status: 'planned',
      type: 'deep',
    }]);

    await expect(domain.scheduling.replaceDaySchedule(context(UID, 'overnight-replace'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block({ id: 'replacement-after-overnight' })],
      reason: 'Do not partially own an overnight interval.',
    })).rejects.toMatchObject({ code: 'CONFLICT' });

    await expect(domain.scheduling.previewTimeBlockChange(context(UID, 'overnight-move'), {
      action: 'move',
      timezone: 'Europe/Rome',
      block: block({
        id: 'mutable-overnight',
        start: '2026-08-18T07:00:00.000Z',
        end: '2026-08-18T08:00:00.000Z',
      }),
      reason: 'Cross-calendar sources require manual scheduling.',
    })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('preserves the authoritative WPI marker and strips model-supplied marker lines on move', async () => {
    const { repository, domain } = harness(['plan-marker-move', 'execution-marker-move']);
    repository.seed(UID, 'timeBlocks', [{
      id: 'wpi-origin',
      title: 'WPI origin',
      domainId: 'domain-1',
      taskId: 'task-1',
      projectId: 'project-1',
      goalId: 'goal-1',
      startTime: '2026-08-17T07:00:00.000Z',
      endTime: '2026-08-17T08:00:00.000Z',
      status: 'planned',
      type: 'deep',
      notes: 'Original note\n\nWPI_KEY: wpi:original-draft:original-block',
    }]);
    const preview = await domain.scheduling.previewTimeBlockChange(context(UID, 'marker-move'), {
      action: 'move',
      timezone: 'Europe/Rome',
      block: block({
        id: 'wpi-origin',
        title: 'WPI origin',
        start: '2026-08-17T08:00:00.000Z',
        end: '2026-08-17T09:00:00.000Z',
        notes: 'Updated note WPI_KEY: wpi:forged-draft:forged-block',
      }),
      reason: 'Keep the original semantic replay key.',
    });
    expect(preview.diff[0]?.after?.notes).toContain('WPI_KEY: wpi:original-draft:original-block');
    expect(preview.diff[0]?.after?.notes).not.toContain('forged-draft');

    await domain.changePlans.applyPlan(context(UID, 'marker-move-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'marker-preservation-apply-01',
    });
    const persisted = await repository.getEntity(UID, 'timeBlocks', 'wpi-origin');
    expect(persisted?.notes).toContain('WPI_KEY: wpi:original-draft:original-block');
    expect(persisted?.notes).not.toContain('forged-draft');
  });

  it('blocks a focused change that overlaps any existing commitment or targets a locked block', async () => {
    const { repository, domain } = harness();
    repository.seed(UID, 'timeBlocks', [
      {
        id: 'existing',
        title: 'Existing',
        domainId: 'domain-1',
        startTime: '2026-08-17T08:00:00.000Z',
        endTime: '2026-08-17T09:00:00.000Z',
        status: 'planned',
        type: 'buffer',
      },
      {
        id: 'locked-focused',
        title: 'Locked',
        domainId: 'domain-1',
        startTime: '2026-08-17T10:00:00.000Z',
        endTime: '2026-08-17T11:00:00.000Z',
        status: 'planned',
        type: 'meeting',
        locked: true,
      },
    ]);

    const conflict = await domain.scheduling.previewTimeBlockChange(context(UID, 'focused-conflict'), {
      action: 'create',
      timezone: 'Europe/Rome',
      block: block({
        id: 'overlap',
        start: '2026-08-17T08:30:00.000Z',
        end: '2026-08-17T09:30:00.000Z',
      }),
      reason: 'Overlap must remain a preview conflict.',
    });
    expect(conflict.conflicts.some((message) => /overlaps existing block/i.test(message))).toBe(true);
    await expect(domain.changePlans.applyPlan(context(UID, 'focused-conflict-apply'), {
      planId: conflict.id,
      approvalCapability: conflict.approval.capability,
      idempotencyKey: 'focused-conflict-key-0001',
    })).rejects.toMatchObject({ code: 'CONFLICT' });

    const lockedConflict = await domain.scheduling.previewTimeBlockChange(
      context(UID, 'focused-locked-conflict'),
      {
        action: 'create',
        timezone: 'Europe/Rome',
        block: block({
          id: 'overlap-locked',
          start: '2026-08-17T10:30:00.000Z',
          end: '2026-08-17T11:30:00.000Z',
        }),
        reason: 'Locked overlap must be classified as protected.',
      },
    );
    expect(lockedConflict.conflicts.some((message) => /overlaps protected block/i.test(message))).toBe(true);

    await expect(domain.scheduling.previewTimeBlockChange(context(UID, 'locked-focused'), {
      action: 'move',
      timezone: 'Europe/Rome',
      block: block({
        id: 'locked-focused',
        start: '2026-08-17T11:00:00.000Z',
        end: '2026-08-17T12:00:00.000Z',
      }),
      reason: 'Locked move must fail.',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('uses absolute instants across the Europe/Rome DST fallback without corrupting duration', async () => {
    const { domain } = harness();
    const plan = await domain.scheduling.replaceDaySchedule(context(UID, 'dst-preview'), {
      date: '2026-10-25',
      timezone: 'Europe/Rome',
      blocks: [block({
        id: 'dst-block',
        // 02:30 CEST -> 03:30 CET is two elapsed hours on fallback day.
        start: '2026-10-25T00:30:00.000Z',
        end: '2026-10-25T02:30:00.000Z',
      })],
      reason: 'DST-safe preview.',
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.diff[0]?.after).toMatchObject({
      startTime: '2026-10-25T00:30:00.000Z',
      endTime: '2026-10-25T02:30:00.000Z',
    });
  });

  it('enforces buffers by elapsed instants across the Europe/Rome spring-forward gap', async () => {
    const { repository, domain } = harness();
    repository.setPlanningPreferencesForTest(UID, {
      source: 'persisted',
      defaultsApplied: [],
      timezone: 'Europe/Rome',
      workingHours: { start: '00:00', end: '23:59' },
      maxDailyPlannedMinutes: 600,
      maxWeeklyPlannedMinutes: 3_000,
      minBufferMinutes: 15,
      maxConsecutiveHighEnergyBlocks: 3,
    });
    const plan = await domain.scheduling.replaceDaySchedule(context(UID, 'dst-buffer-preview'), {
      date: '2026-03-29',
      timezone: 'Europe/Rome',
      blocks: [
        block({
          id: 'before-spring-gap',
          start: '2026-03-29T00:00:00.000Z',
          end: '2026-03-29T00:55:00.000Z',
        }),
        block({
          id: 'after-spring-gap',
          start: '2026-03-29T01:05:00.000Z',
          end: '2026-03-29T02:05:00.000Z',
        }),
      ],
      reason: 'A 10-minute elapsed gap must not look like a 70-minute wall-clock gap.',
    });
    expect(plan.conflicts.some((message) => /10 minuti su 15/i.test(message))).toBe(true);
  });

  it('does not invent an overlap across the Europe/Rome repeated fallback hour', async () => {
    const { repository, domain } = harness();
    repository.setPlanningPreferencesForTest(UID, {
      source: 'persisted',
      defaultsApplied: [],
      timezone: 'Europe/Rome',
      workingHours: { start: '00:00', end: '23:59' },
      maxDailyPlannedMinutes: 600,
      maxWeeklyPlannedMinutes: 3_000,
      minBufferMinutes: 15,
      maxConsecutiveHighEnergyBlocks: 3,
    });
    const plan = await domain.scheduling.replaceDaySchedule(context(UID, 'dst-repeat-preview'), {
      date: '2026-10-25',
      timezone: 'Europe/Rome',
      blocks: [
        block({
          id: 'before-repeat',
          start: '2026-10-25T00:00:00.000Z',
          end: '2026-10-25T00:55:00.000Z',
        }),
        block({
          id: 'after-repeat',
          start: '2026-10-25T01:10:00.000Z',
          end: '2026-10-25T02:10:00.000Z',
        }),
      ],
      reason: 'A repeated local hour must retain its 15-minute elapsed buffer.',
    });
    expect(plan.conflicts).toEqual([]);
  });

  it('rejects timezone and cross-user hierarchy references rather than trusting model input', async () => {
    const { domain } = harness();
    await expect(domain.scheduling.replaceDaySchedule(context(UID, 'timezone-mismatch'), {
      date: '2026-08-17',
      timezone: 'America/New_York',
      blocks: [block()],
      reason: 'Wrong timezone.',
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    await expect(domain.scheduling.replaceDaySchedule(context(OTHER_UID, 'entity-probe'), {
      date: '2026-08-17',
      timezone: 'Europe/Rome',
      blocks: [block()],
      reason: 'Probe owner references.',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

function harness(ids: readonly string[] = ['plan-default', 'execution-default']) {
  const repository = new InMemoryRepository();
  seedHierarchy(repository, UID);
  let index = 0;
  const domain = createLifeTrackerDomain(repository, {
    clock: () => new Date('2026-08-16T12:00:00.000Z'),
    idFactory: () => ids[index++] ?? `generated-${index}`,
    capabilityIssuer: new CapabilityIssuer(CAPABILITY_SECRET),
  });
  return { repository, domain };
}

function seedHierarchy(repository: InMemoryRepository, uid: string): void {
  repository.seed(uid, 'domains', [{ id: 'domain-1', name: 'Work', color: '#123456', icon: 'briefcase' }]);
  repository.seed(uid, 'goals', [{ id: 'goal-1', title: 'Outcome', domainId: 'domain-1' }]);
  repository.seed(uid, 'projects', [{ id: 'project-1', name: 'Result', goalId: 'goal-1', domainId: 'domain-1' }]);
  repository.seed(uid, 'tasks', [{ id: 'task-1', title: 'Action', projectId: 'project-1', goalId: 'goal-1', domainId: 'domain-1' }]);
}

function block(overrides: Partial<ScheduleBlockInput> = {}): ScheduleBlockInput {
  return {
    id: 'scheduled-block',
    title: 'Deep work',
    start: '2026-08-17T07:00:00.000Z',
    end: '2026-08-17T08:00:00.000Z',
    type: 'deep',
    status: 'planned',
    taskId: 'task-1',
    projectId: 'project-1',
    goalId: 'goal-1',
    domainId: 'domain-1',
    notes: 'User-visible schedule note.',
    activityType: 'deep_work',
    energyLevel: 'high',
    flexibility: 'flexible',
    ...overrides,
  };
}

function context(uid: string, requestId: string): AuthContext {
  return { uid, requestId };
}
