import { describe, expect, it } from 'vitest';
import { CapabilityIssuer } from '../../src/domain/capabilities';
import { createLifeTrackerDomain } from '../../src/domain/factory';
import { InMemoryRepository } from '../../src/domain/in-memory-repository';
import type { PreviewGoalArchitectureArgs } from '../../src/domain/schemas';
import type { AuthContext } from '../../src/domain/types';

const UID = 'goal-owner';
const OTHER_UID = 'goal-other';
const CAPABILITY_SECRET = 'goal-architect-test-capability-secret-over-thirty-two-bytes';

describe('Goal Architect deterministic backend adapter', () => {
  it('previews and atomically applies a hierarchy with real parent IDs and zero orphans', async () => {
    const { repository, domain } = harness(['plan-goal', 'execution-goal', 'execution-retry']);
    const preview = await domain.goalArchitect.preview(context(UID, 'preview'), validDraft());

    expect(preview.conflicts).toEqual([]);
    expect(preview.operations).toEqual(expect.arrayContaining([
      { action: 'create', entityType: 'goals', entityId: 'goal-new' },
      { action: 'create', entityType: 'projects', entityId: 'project-new' },
      { action: 'create', entityType: 'tasks', entityId: 'task-new' },
      { action: 'create', entityType: 'keyResults', entityId: 'kr-new-1' },
      { action: 'create', entityType: 'keyResults', entityId: 'kr-new-2' },
    ]));
    const applyInput = {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'goal-apply-idempotency-0001',
    };
    const applied = await domain.changePlans.applyPlan(context(UID, 'apply'), applyInput);
    const replay = await domain.changePlans.applyPlan(context(UID, 'retry'), applyInput);
    expect(replay.executionId).toBe(applied.executionId);
    expect(replay.idempotentReplay).toBe(true);

    const goal = await repository.getEntity(UID, 'goals', 'goal-new');
    const project = await repository.getEntity(UID, 'projects', 'project-new');
    const task = await repository.getEntity(UID, 'tasks', 'task-new');
    const keyResult = await repository.getEntity(UID, 'keyResults', 'kr-new-1');
    expect(project).toMatchObject({ goalId: goal?.id, domainId: 'domain-1' });
    expect(task).toMatchObject({ projectId: project?.id, goalId: goal?.id, domainId: 'domain-1' });
    expect(keyResult).toMatchObject({ goalId: goal?.id, domainId: 'domain-1' });
    expect(String(goal?.description)).toContain('GAI_KEY: gai:');
    expect(String(project?.description)).toContain('GAI_KEY: gai:');
    expect(String(task?.description)).toContain('GAI_KEY: gai:');
  });

  it('surfaces semantic duplicates with new IDs and prevents approval', async () => {
    const { domain } = harness(['plan-first', 'execution-first', 'plan-duplicate']);
    const first = await domain.goalArchitect.preview(context(UID, 'preview-first'), validDraft());
    await domain.changePlans.applyPlan(context(UID, 'apply-first'), {
      planId: first.id,
      approvalCapability: first.approval.capability,
      idempotencyKey: 'goal-first-apply-key-00001',
    });
    const duplicate = validDraft({
      goalId: 'goal-copy',
      projectId: 'project-copy',
      taskId: 'task-copy',
      keyResultIds: ['kr-copy-1', 'kr-copy-2'],
    });
    const preview = await domain.goalArchitect.preview(context(UID, 'preview-copy'), duplicate);
    expect(preview.conflicts.some((message) => /Duplicate goals title/i.test(message))).toBe(true);
    await expect(domain.changePlans.applyPlan(context(UID, 'apply-copy'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'goal-copy-apply-key-000001',
    })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects the second of two equivalent previews when the duplicate scope changes', async () => {
    const { repository, domain } = harness([
      'plan-concurrent-a',
      'plan-concurrent-b',
      'execution-concurrent-a',
      'execution-concurrent-b',
    ]);
    const first = await domain.goalArchitect.preview(context(UID, 'preview-concurrent-a'), validDraft());
    const secondDraft = validDraft({
      goalId: 'goal-concurrent-b',
      projectId: 'project-concurrent-b',
      taskId: 'task-concurrent-b',
      keyResultIds: ['kr-concurrent-b1', 'kr-concurrent-b2'],
    });
    const second = await domain.goalArchitect.preview(context(UID, 'preview-concurrent-b'), secondDraft);
    expect(first.conflicts).toEqual([]);
    expect(second.conflicts).toEqual([]);

    await domain.changePlans.applyPlan(context(UID, 'apply-concurrent-a'), {
      planId: first.id,
      approvalCapability: first.approval.capability,
      idempotencyKey: 'concurrent-ga-first-key-001',
    });
    await expect(domain.changePlans.applyPlan(context(UID, 'apply-concurrent-b'), {
      planId: second.id,
      approvalCapability: second.approval.capability,
      idempotencyKey: 'concurrent-ga-second-key-01',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    expect(await repository.getEntity(UID, 'goals', 'goal-concurrent-b')).toBeNull();
    expect(await repository.getEntity(UID, 'tasks', 'task-concurrent-b')).toBeNull();
  });

  it('refuses rollback when a newer human child depends on an AI-created parent', async () => {
    const { repository, domain } = harness(['plan-dependent-rollback', 'execution-dependent-rollback']);
    const preview = await domain.goalArchitect.preview(context(UID, 'dependent-preview'), validDraft());
    const applied = await domain.changePlans.applyPlan(context(UID, 'dependent-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'dependent-apply-key-00001',
    });
    repository.seed(UID, 'tasks', [{
      id: 'human-new-child',
      title: 'Human follow-up',
      projectId: 'project-new',
      goalId: 'goal-new',
      domainId: 'domain-1',
      status: 'pending',
      priority: 'medium',
      estimatedMinutes: 30,
    }]);
    await expect(domain.changePlans.rollbackExecution(context(UID, 'dependent-rollback'), {
      executionId: applied.executionId,
      rollbackCapability: applied.rollback?.capability ?? '',
      idempotencyKey: 'dependent-rollback-key-001',
    })).rejects.toMatchObject({ code: 'STATE_CHANGED' });
    expect(await repository.getEntity(UID, 'projects', 'project-new')).not.toBeNull();
    expect(await repository.getEntity(UID, 'tasks', 'human-new-child')).not.toBeNull();
  });

  it('rejects orphan task references before a proposal is persisted', async () => {
    const { domain } = harness();
    const draft = validDraft();
    await expect(domain.goalArchitect.preview(context(UID, 'orphan'), {
      ...draft,
      tasks: [{ ...draft.tasks[0]!, parentProjectId: 'placeholder-parent' }],
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('preserves the existing Goal Architect calendar-date contract as Firestore-ready instants', async () => {
    const { repository, domain } = harness(['plan-calendar-date', 'execution-calendar-date']);
    const draft = validDraft();
    const preview = await domain.goalArchitect.preview(context(UID, 'calendar-date-preview'), {
      ...draft,
      goal: { ...draft.goal, dueDateISO: '2026-12-31' },
      projects: [{ ...draft.projects[0]!, dueDateISO: '2026-11-30' }],
      tasks: [{ ...draft.tasks[0]!, dueDateISO: '2026-09-01' }],
    });

    const applied = await domain.changePlans.applyPlan(context(UID, 'calendar-date-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'calendar-date-apply-key-0001',
    });

    expect(applied.verified).toBe(true);
    expect(await repository.getEntity(UID, 'goals', 'goal-new')).toMatchObject({
      targetDate: '2026-12-31T00:00:00.000Z',
    });
    expect(await repository.getEntity(UID, 'projects', 'project-new')).toMatchObject({
      dueDate: '2026-11-30T00:00:00.000Z',
    });
    expect(await repository.getEntity(UID, 'tasks', 'task-new')).toMatchObject({
      dueDate: '2026-09-01T00:00:00.000Z',
    });
  });

  it('denies cross-user domain selection without revealing its contents', async () => {
    const { repository, domain } = harness();
    repository.seed(UID, 'domains', [{ id: 'private-domain', name: 'Private', color: '#000000', icon: 'lock' }]);
    await expect(domain.goalArchitect.preview(context(OTHER_UID, 'cross-user'), {
      ...validDraft(),
      domainId: 'private-domain',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('routes focused task creation through Goal Architect hierarchy and duplicate checks', async () => {
    const { repository, domain } = harness(['plan-task', 'execution-task']);
    repository.seed(UID, 'goals', [{
      id: 'goal-existing', title: 'Existing goal', domainId: 'domain-1', status: 'active', priority: 'high',
    }]);
    repository.seed(UID, 'projects', [{
      id: 'project-existing', name: 'Existing project', goalId: 'goal-existing', domainId: 'domain-1', status: 'active', priority: 'high',
    }]);
    const preview = await domain.goalArchitect.previewTaskChange(context(UID, 'task-preview'), {
      action: 'create',
      id: 'task-focused',
      title: 'Concrete focused action',
      description: null,
      status: 'pending',
      priority: 'high',
      projectId: 'project-existing',
      goalId: 'goal-existing',
      domainId: 'domain-1',
      dueDate: null,
      estimatedMinutes: 45,
      reason: 'Create a focused task.',
    });
    await domain.changePlans.applyPlan(context(UID, 'task-apply'), {
      planId: preview.id,
      approvalCapability: preview.approval.capability,
      idempotencyKey: 'focused-task-apply-key-001',
    });
    expect(await repository.getEntity(UID, 'tasks', 'task-focused')).toMatchObject({
      projectId: 'project-existing',
      goalId: 'goal-existing',
      domainId: 'domain-1',
      description: expect.stringContaining('GAI_KEY: task:'),
    });
  });
});

function harness(ids: readonly string[] = ['plan-default', 'execution-default']) {
  const repository = new InMemoryRepository();
  repository.seed(UID, 'domains', [{ id: 'domain-1', name: 'Work', color: '#123456', icon: 'briefcase' }]);
  let index = 0;
  const domain = createLifeTrackerDomain(repository, {
    clock: () => new Date('2026-08-16T12:00:00.000Z'),
    idFactory: () => ids[index++] ?? `generated-${index}`,
    capabilityIssuer: new CapabilityIssuer(CAPABILITY_SECRET),
  });
  return { repository, domain };
}

function validDraft(ids: {
  goalId?: string;
  projectId?: string;
  taskId?: string;
  keyResultIds?: readonly [string, string];
} = {}): PreviewGoalArchitectureArgs {
  const goalId = ids.goalId ?? 'goal-new';
  const projectId = ids.projectId ?? 'project-new';
  const taskId = ids.taskId ?? 'task-new';
  const keyResultIds = ids.keyResultIds ?? ['kr-new-1', 'kr-new-2'];
  return {
    domainId: 'domain-1',
    reason: 'Create a deterministic hierarchy.',
    goal: {
      id: goalId,
      title: 'Publish the first product release',
      description: 'A meaningful outcome.',
      targetHours: 100,
      dueDateISO: '2026-12-31T23:00:00.000Z',
      priority: 'high',
      timeAllocationTarget: 5,
      category: 'important_not_urgent',
      complexity: 'moderate',
    },
    projects: [{
      id: projectId,
      title: 'Release candidate ready',
      description: 'A finite contributing result.',
      targetHours: 50,
      dueDateISO: '2026-11-30T23:00:00.000Z',
      priority: 'high',
    }],
    tasks: [{
      id: taskId,
      title: 'Write release checklist',
      description: 'A concrete action.',
      estimatedHours: 2,
      dueDateISO: '2026-09-01T12:00:00.000Z',
      priority: 'high',
      parentProjectId: projectId,
    }],
    keyResults: [
      {
        id: keyResultIds[0],
        title: 'All release gates pass',
        description: 'Measurable evidence one.',
        targetValue: 100,
        currentValue: 0,
        unit: 'percent',
        customUnit: null,
      },
      {
        id: keyResultIds[1],
        title: 'Ten pilot sessions completed',
        description: 'Measurable evidence two.',
        targetValue: 10,
        currentValue: 0,
        unit: 'sessions',
        customUnit: null,
      },
    ],
  };
}

function context(uid: string, requestId: string): AuthContext {
  return { uid, requestId };
}
