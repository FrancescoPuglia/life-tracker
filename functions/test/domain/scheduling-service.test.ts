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
