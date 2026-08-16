import type { z } from 'zod';
import {
  analyticsArgsSchema,
  planActionArgsSchema,
  previewChangesArgsSchema,
  previewGoalArchitectureArgsSchema,
  readArgsSchema,
  replaceDayScheduleArgsSchema,
  replaceWeekScheduleArgsSchema,
} from './schemas';

export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ToolContract<TSchema extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly schema: TSchema;
  readonly parameters: JsonSchema;
}

export interface OpenAIFunctionTool {
  readonly type: 'function';
  readonly name: string;
  readonly description: string;
  readonly strict: true;
  readonly parameters: JsonSchema;
}

const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] });
const string = (maxLength: number, extra: JsonSchema = {}): JsonSchema => ({
  type: 'string',
  maxLength,
  ...extra,
});
const strictObject = (properties: Readonly<Record<string, JsonSchema>>): JsonSchema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const id = string(128, { pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' });
const nullableId = nullable(id);
const dateTime = string(64, { format: 'date-time' });

const readFilter = strictObject({
  query: nullable(string(200)),
  from: nullable(dateTime),
  to: nullable(dateTime),
  status: nullable(string(64)),
  domainId: nullableId,
  projectId: nullableId,
  goalId: nullableId,
  taskId: nullableId,
});

const readParameters = strictObject({
  filter: readFilter,
  cursor: nullable(string(1024)),
  limit: { type: 'integer', minimum: 1, maximum: 50 },
});

const patchValue: JsonSchema = {
  anyOf: [
    string(20_000),
    { type: 'number' },
    { type: 'boolean' },
    { type: 'null' },
    { type: 'array', items: string(256), maxItems: 100 },
  ],
};

const patchEntry = strictObject({ field: string(64), value: patchValue });
const publicOperation = strictObject({
  op: { type: 'string', enum: ['create', 'update', 'delete'] },
  collection: {
    type: 'string',
    enum: ['goals', 'keyResults', 'projects', 'tasks', 'timeBlocks', 'habits', 'notes', 'domains'],
  },
  id,
  patch: { type: 'array', items: patchEntry, maxItems: 30 },
});

const planActionParameters = strictObject({
  planId: id,
  idempotencyKey: string(200, { minLength: 16 }),
});

const scheduleBlock = strictObject({
  id: nullableId,
  title: string(240, { minLength: 1 }),
  start: dateTime,
  end: dateTime,
  type: {
    type: 'string',
    enum: ['work', 'break', 'buffer', 'travel', 'meeting', 'focus', 'admin', 'deep', 'shallow'],
  },
  status: { type: 'string', enum: ['planned'] },
  taskId: nullableId,
  projectId: nullableId,
  goalId: nullableId,
  domainId: id,
  notes: nullable(string(20_000)),
  activityType: {
    type: 'string',
    enum: [
      'routine', 'task', 'event', 'deep_work', 'exercise', 'reading',
      'career', 'chess', 'maintenance', 'unknown',
    ],
  },
  energyLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
  flexibility: { type: 'string', enum: ['fixed', 'flexible'] },
});

const priority = { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } as const;
const nullableDescription = nullable(string(20_000));
const nullableDate = nullable(string(64));
const goalArchitectGoal = strictObject({
  id,
  title: string(240, { minLength: 1 }),
  description: nullableDescription,
  targetHours: { type: 'number', minimum: 0.25, maximum: 1_000_000 },
  dueDateISO: string(64, { minLength: 1 }),
  priority,
  timeAllocationTarget: { type: 'number', minimum: 0, maximum: 168 },
  category: { type: 'string', enum: ['urgent_important', 'important_not_urgent', 'urgent_not_important', 'neither'] },
  complexity: { type: 'string', enum: ['simple', 'moderate', 'complex', 'expert'] },
});
const goalArchitectProject = strictObject({
  id,
  title: string(240, { minLength: 1 }),
  description: nullableDescription,
  targetHours: { type: 'number', minimum: 0.25, maximum: 1_000_000 },
  dueDateISO: nullableDate,
  priority,
});
const goalArchitectTask = strictObject({
  id,
  title: string(240, { minLength: 1 }),
  description: nullableDescription,
  estimatedHours: { type: 'number', minimum: 0.0166666667, maximum: 24_000 },
  dueDateISO: nullableDate,
  priority,
  parentProjectId: id,
});
const goalArchitectKeyResult = strictObject({
  id,
  title: string(240, { minLength: 1 }),
  description: nullableDescription,
  targetValue: { type: 'number' },
  currentValue: { type: 'number' },
  unit: { type: 'string', enum: ['percent', 'hours', 'days', 'sessions', 'courses', 'videos', 'studies', 'tasks', 'books', 'custom'] },
  customUnit: nullable(string(64, { minLength: 1 })),
});

const readContracts: readonly ToolContract[] = [
  ['list_goals', 'Read a bounded page of the authenticated user\'s goals.'],
  ['list_projects', 'Read a bounded page of the authenticated user\'s projects.'],
  ['list_tasks', 'Read a bounded page of the authenticated user\'s tasks.'],
  ['list_time_blocks', 'Read a bounded page of the authenticated user\'s time blocks.'],
  ['list_habits', 'Read a bounded page of the authenticated user\'s habits.'],
  ['list_sessions', 'Read real, persisted sessions for the authenticated user.'],
  ['list_notes', 'Read a bounded page of the authenticated user\'s notes.'],
  ['list_domains', 'Read real, persisted domains for the authenticated user.'],
].map(([name, description]) => ({ name, description, schema: readArgsSchema, parameters: readParameters }));

export const TOOL_CONTRACTS: readonly ToolContract[] = [
  ...readContracts,
  {
    name: 'get_analytics',
    description: 'Compute bounded analytics from the authenticated user\'s persisted sessions and time blocks.',
    schema: analyticsArgsSchema,
    parameters: strictObject({ from: dateTime, to: dateTime }),
  },
  {
    name: 'preview_changes',
    description: 'Validate allowed changes and return an immutable preview. This never writes domain entities.',
    schema: previewChangesArgsSchema,
    parameters: strictObject({
      operations: { type: 'array', items: publicOperation, minItems: 1, maxItems: 100 },
      reason: string(500, { minLength: 1 }),
    }),
  },
  {
    name: 'preview_goal_architecture',
    description: 'Validate a complete Goal Architect draft and create one atomic preview. Never commits directly.',
    schema: previewGoalArchitectureArgsSchema,
    parameters: strictObject({
      domainId: id,
      reason: string(500, { minLength: 1 }),
      goal: goalArchitectGoal,
      projects: { type: 'array', items: goalArchitectProject, minItems: 1, maxItems: 20 },
      tasks: { type: 'array', items: goalArchitectTask, minItems: 1, maxItems: 80 },
      keyResults: { type: 'array', items: goalArchitectKeyResult, minItems: 2, maxItems: 5 },
    }),
  },
  {
    name: 'replace_day_schedule',
    description: 'Create a conflict-checked preview for replacing one day. Apply separately with apply_plan.',
    schema: replaceDayScheduleArgsSchema,
    parameters: strictObject({
      date: string(10, { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
      timezone: string(100, { minLength: 1 }),
      blocks: { type: 'array', items: scheduleBlock, maxItems: 96 },
      reason: string(500, { minLength: 1 }),
    }),
  },
  {
    name: 'replace_week_schedule',
    description: 'Create a WPI-compatible conflict-checked weekly preview. Apply separately with apply_plan.',
    schema: replaceWeekScheduleArgsSchema,
    parameters: strictObject({
      weekStart: string(10, { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
      timezone: string(100, { minLength: 1 }),
      blocks: { type: 'array', items: scheduleBlock, maxItems: 100 },
      reason: string(500, { minLength: 1 }),
    }),
  },
  {
    name: 'apply_plan',
    description: 'Atomically apply a valid, unexpired preview using a required idempotency key.',
    schema: planActionArgsSchema,
    parameters: planActionParameters,
  },
  {
    name: 'rollback_plan',
    description: 'Safely roll back an applied plan when no incompatible later changes exist.',
    schema: planActionArgsSchema,
    parameters: planActionParameters,
  },
];

export function toOpenAITool(contract: ToolContract): OpenAIFunctionTool {
  return {
    type: 'function',
    name: contract.name,
    description: contract.description,
    strict: true,
    parameters: contract.parameters,
  };
}
