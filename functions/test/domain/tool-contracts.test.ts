import { describe, expect, it } from 'vitest';
import { TOOL_CONTRACTS, type JsonSchema } from '../../src/domain/tool-definitions';

const readArgs = {
  filter: {
    query: null,
    from: null,
    to: null,
    status: null,
    domainId: null,
    projectId: null,
    goalId: null,
    taskId: null,
  },
  cursor: null,
  limit: 20,
};
const period = {
  from: '2026-08-01T00:00:00.000Z',
  to: '2026-08-08T00:00:00.000Z',
};

const validByName: Readonly<Record<string, unknown>> = {
  get_goals: readArgs,
  get_key_results: readArgs,
  get_projects: readArgs,
  get_tasks: readArgs,
  get_timeblocks: readArgs,
  get_sessions: readArgs,
  get_habits: readArgs,
  get_habit_logs: readArgs,
  get_notes: readArgs,
  get_goal_roadmaps: readArgs,
  get_domains: readArgs,
  get_life_tracker_state: {
    scope: 'week',
    from: null,
    to: null,
    perCollectionLimit: 20,
    includeNotes: true,
  },
  analyze_period: period,
  planned_vs_actual: period,
  get_kpis: period,
  goal_alignment: period,
  detect_schedule_conflicts: period,
  preview_changes: {
    operations: [{
      op: 'update',
      collection: 'domains',
      id: 'domain-1',
      patch: [{ field: 'name', value: 'A safe domain name' }],
    }],
    reason: 'User requested this change.',
  },
  preview_task_change: {
    action: 'create',
    id: 'task-new',
    title: 'A concrete action',
    description: null,
    status: 'pending',
    priority: 'high',
    projectId: 'project-1',
    goalId: 'goal-1',
    domainId: 'domain-1',
    dueDate: null,
    estimatedMinutes: 60,
    reason: 'Create one validated task.',
  },
  preview_timeblock_change: {
    action: 'move',
    timezone: 'Europe/Rome',
    block: {
      id: 'block-1',
      title: 'Focused work',
      start: '2026-08-17T08:00:00.000Z',
      end: '2026-08-17T09:00:00.000Z',
      type: 'focus',
      status: 'planned',
      taskId: 'task-1',
      projectId: 'project-1',
      goalId: 'goal-1',
      domainId: 'domain-1',
      notes: null,
      activityType: 'deep_work',
      energyLevel: 'high',
      flexibility: 'flexible',
    },
    reason: 'Move one exact block with deterministic validation.',
  },
  preview_goal_architecture: {
    domainId: 'domain-1',
    reason: 'Create a bounded hierarchy.',
    goal: {
      id: 'goal-1',
      title: 'Meaningful outcome',
      description: null,
      targetHours: 100,
      dueDateISO: '2026-12-31T23:00:00.000Z',
      priority: 'high',
      timeAllocationTarget: 5,
      category: 'important_not_urgent',
      complexity: 'moderate',
    },
    projects: [{
      id: 'project-1',
      title: 'Finite result',
      description: null,
      targetHours: 50,
      dueDateISO: null,
      priority: 'high',
    }],
    tasks: [{
      id: 'task-1',
      title: 'Concrete action',
      description: null,
      estimatedHours: 2,
      dueDateISO: null,
      priority: 'high',
      parentProjectId: 'project-1',
    }],
    keyResults: [
      {
        id: 'kr-1',
        title: 'Measure one',
        description: null,
        targetValue: 100,
        currentValue: 0,
        unit: 'percent',
        customUnit: null,
      },
      {
        id: 'kr-2',
        title: 'Measure two',
        description: null,
        targetValue: 10,
        currentValue: 0,
        unit: 'sessions',
        customUnit: null,
      },
    ],
  },
  replace_day_schedule: {
    date: '2026-08-17',
    timezone: 'Europe/Rome',
    blocks: [],
    reason: 'Draft the day.',
  },
  replace_week_schedule: {
    weekStart: '2026-08-17',
    timezone: 'Europe/Rome',
    blocks: [],
    reason: 'Draft the week.',
  },
};

describe('strict domain tool contracts', () => {
  it('contains only focused read and proposal capabilities', () => {
    const names = TOOL_CONTRACTS.map((contract) => contract.name);
    expect(names).toEqual(expect.arrayContaining([
      'get_life_tracker_state',
      'get_goals',
      'get_key_results',
      'get_projects',
      'get_tasks',
      'get_timeblocks',
      'get_sessions',
      'get_habits',
      'get_habit_logs',
      'get_notes',
      'get_goal_roadmaps',
      'get_kpis',
      'analyze_period',
      'planned_vs_actual',
      'goal_alignment',
      'detect_schedule_conflicts',
      'preview_timeblock_change',
      'preview_task_change',
    ]));
    expect(names).not.toEqual(expect.arrayContaining([
      'apply_plan',
      'rollback_plan',
      'firestore_query',
      'arbitrary_query',
      'read_collection',
      'write_collection',
      'execute_code',
    ]));
    expect(new Set(names).size).toBe(names.length);
    expect(TOOL_CONTRACTS.every((contract) => contract.kind === 'read' || contract.kind === 'proposal')).toBe(true);
  });

  it('keeps hierarchy and calendar mutations off the generic proposal surface', () => {
    const generic = TOOL_CONTRACTS.find((contract) => contract.name === 'preview_changes');
    for (const collection of ['goals', 'keyResults', 'projects', 'tasks', 'timeBlocks']) {
      expect(generic?.schema.safeParse({
        operations: [{
          op: 'update',
          collection,
          id: 'entity-1',
          patch: [{ field: 'title', value: 'Bypass' }],
        }],
        reason: 'Attempt deterministic-validator bypass.',
      }).success).toBe(false);
    }
  });

  it.each(TOOL_CONTRACTS)('$name accepts a valid fixture and rejects unknown identity fields', (contract) => {
    const valid = validByName[contract.name];
    expect(valid, `missing valid fixture for ${contract.name}`).toBeDefined();
    expect(contract.schema.safeParse(valid).success).toBe(true);
    expect(contract.schema.safeParse({ ...(valid as Record<string, unknown>), userId: 'victim' }).success).toBe(false);
    expect(JSON.stringify(contract.parameters)).not.toMatch(/userId|uid|collectionPath|documentPath/);
  });

  it('marks every JSON Schema object strict with every property required', () => {
    for (const contract of TOOL_CONTRACTS) {
      expect(() => assertStrictObjects(contract.parameters, contract.name)).not.toThrow();
    }
  });

  it('rejects malformed dates, oversized ranges, and unknown nested properties', () => {
    const analytics = TOOL_CONTRACTS.find((contract) => contract.name === 'analyze_period');
    expect(analytics?.schema.safeParse({ from: 'not-a-date', to: period.to }).success).toBe(false);
    expect(analytics?.schema.safeParse({
      from: '2020-01-01T00:00:00.000Z',
      to: '2026-01-01T00:00:00.000Z',
    }).success).toBe(false);

    const read = TOOL_CONTRACTS.find((contract) => contract.name === 'get_tasks');
    expect(read?.schema.safeParse({
      ...readArgs,
      filter: { ...readArgs.filter, arbitrary: 'no' },
    }).success).toBe(false);

    const goalArchitect = TOOL_CONTRACTS.find((contract) => contract.name === 'preview_goal_architecture');
    const validGoalArchitect = validByName.preview_goal_architecture as Record<string, unknown>;
    expect(goalArchitect?.schema.safeParse({
      ...validGoalArchitect,
      goal: {
        ...(validGoalArchitect.goal as Record<string, unknown>),
        dueDateISO: '2026-02-31',
      },
    }).success).toBe(false);

    const schedule = TOOL_CONTRACTS.find((contract) => contract.name === 'replace_day_schedule');
    expect(schedule?.schema.safeParse({
      ...(validByName.replace_day_schedule as Record<string, unknown>),
      date: '2026-02-31',
    }).success).toBe(false);

    const timeBlock = TOOL_CONTRACTS.find((contract) => contract.name === 'preview_timeblock_change');
    const validTimeBlock = validByName.preview_timeblock_change as Record<string, unknown>;
    expect(timeBlock?.schema.safeParse({
      ...validTimeBlock,
      action: 'move',
      block: { ...(validTimeBlock.block as Record<string, unknown>), id: null },
    }).success).toBe(false);
  });
});

function assertStrictObjects(schema: JsonSchema, path: string): void {
  if (schema.type === 'object') {
    const properties = schema.properties as Record<string, JsonSchema> | undefined;
    if (!properties || schema.additionalProperties !== false) {
      throw new Error(`${path} is not a strict object`);
    }
    const required = schema.required;
    if (!Array.isArray(required) || required.length !== Object.keys(properties).length) {
      throw new Error(`${path} does not require every property`);
    }
    if ([...required].sort().join(',') !== Object.keys(properties).sort().join(',')) {
      throw new Error(`${path} required/property mismatch`);
    }
    for (const [name, child] of Object.entries(properties)) assertStrictObjects(child, `${path}.${name}`);
  }
  if (Array.isArray(schema.anyOf)) {
    for (const [index, child] of schema.anyOf.entries()) {
      assertStrictObjects(child as JsonSchema, `${path}.anyOf[${index}]`);
    }
  }
  if (schema.items && typeof schema.items === 'object') {
    assertStrictObjects(schema.items as JsonSchema, `${path}[]`);
  }
}
