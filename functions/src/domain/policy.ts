import { z } from 'zod';
import { DomainError } from './errors';
import type {
  AuthContext,
  EntityCollection,
  PublicChangeOperation,
  ScalarPatchValue,
  WritableEntityCollection,
  WriteValue,
} from './types';

const FIREBASE_UID = /^[A-Za-z0-9:_-]{1,128}$/;
const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function assertAuthenticated(context: AuthContext): void {
  if (!FIREBASE_UID.test(context.uid)) {
    throw new DomainError('UNAUTHENTICATED', 'A verified Firebase identity is required.');
  }
  if (!context.requestId || context.requestId.length > 128) {
    throw new DomainError('INVALID_ARGUMENT', 'A valid request identifier is required.');
  }
}

export function assertExecutionActive(context: AuthContext): void {
  const control = context.executionControl;
  if (control && (control.signal.aborted || Date.now() >= control.deadlineAtMs)) {
    throw new DomainError('INTERNAL', 'AI request timed out.');
  }
}

export function assertEntityId(id: string): void {
  if (!ENTITY_ID.test(id) || id.includes('/')) {
    throw new DomainError('INVALID_ARGUMENT', 'Invalid entity identifier.');
  }
}

const nullableId = z.string().regex(ENTITY_ID).nullable();
const nullableDateTime = z.string().datetime({ offset: true }).nullable();
const shortText = z.string().trim().min(1).max(240);
const longText = z.string().max(20_000);

const FIELD_SCHEMAS: Readonly<
  Record<WritableEntityCollection, Readonly<Record<string, z.ZodType>>>
> = {
  goals: {
    title: shortText,
    description: longText.nullable(),
    status: z.enum(['active', 'completed', 'paused', 'at_risk', 'archived']),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    targetDate: nullableDateTime.unwrap(),
    domainId: nullableId.unwrap(),
    deadline: nullableDateTime,
    targetHours: z.number().min(0).max(1_000_000).nullable(),
    timeAllocationTarget: z.number().min(0).max(168),
    category: z.enum(['urgent_important', 'important_not_urgent', 'urgent_not_important', 'neither']),
    complexity: z.enum(['simple', 'moderate', 'complex', 'expert']),
    estimatedHours: z.number().min(0).max(1_000_000).nullable(),
    keyResults: z.array(z.never()).length(0),
  },
  keyResults: {
    title: shortText,
    description: longText.nullable(),
    goalId: nullableId.unwrap(),
    domainId: nullableId.unwrap(),
    targetValue: z.number().finite(),
    currentValue: z.number().finite(),
    unit: z.string().trim().min(1).max(64).nullable(),
    progress: z.number().min(0).max(100).nullable(),
    status: z.enum(['active', 'completed', 'at_risk']),
  },
  projects: {
    name: shortText,
    description: longText.nullable(),
    status: z.enum(['active', 'completed', 'paused', 'at_risk', 'archived']),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    goalId: nullableId.unwrap(),
    domainId: nullableId.unwrap(),
    dueDate: nullableDateTime,
    weeklyHoursTarget: z.number().min(0).max(168).nullable(),
    totalHoursTarget: z.number().min(0).max(1_000_000).nullable(),
  },
  tasks: {
    title: shortText,
    description: longText.nullable(),
    status: z.enum(['pending', 'todo', 'in_progress', 'completed', 'blocked', 'cancelled']),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    projectId: nullableId.unwrap(),
    goalId: nullableId,
    domainId: nullableId.unwrap(),
    dueDate: nullableDateTime,
    estimatedMinutes: z.number().int().min(1).max(1440),
    completedAt: nullableDateTime,
    ifThenPlan: longText.nullable(),
    why: longText.nullable(),
  },
  timeBlocks: {
    title: shortText,
    startTime: z.string().datetime({ offset: true }),
    endTime: z.string().datetime({ offset: true }),
    type: z.enum(['work', 'break', 'buffer', 'travel', 'meeting', 'focus', 'admin', 'deep', 'shallow']),
    status: z.enum(['planned', 'in_progress', 'completed', 'cancelled', 'overrun']),
    taskId: nullableId,
    projectId: nullableId,
    goalId: nullableId,
    domainId: nullableId.unwrap(),
    notes: longText.nullable(),
    flexibility: z.enum(['fixed', 'flexible']),
  },
  habits: {
    name: shortText,
    description: longText.nullable(),
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    targetValue: z.number().min(0).max(1_000_000).nullable(),
    unit: z.string().trim().min(1).max(64).nullable(),
    domainId: nullableId.unwrap(),
    isActive: z.boolean(),
    streakCount: z.number().int().min(0).max(1_000_000),
    bestStreak: z.number().int().min(0).max(1_000_000),
  },
  notes: {
    title: shortText,
    entityType: z.enum(['goal', 'project', 'task', 'global']),
    entityId: nullableId,
    tags: z.array(z.string().trim().min(1).max(64)).max(30),
    isPinned: z.boolean(),
    domainId: nullableId.unwrap(),
  },
  domains: {
    name: shortText,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    icon: z.string().trim().min(1).max(100),
  },
};

const FORBIDDEN_FIELDS = new Set([
  'uid',
  'userId',
  'ownerUid',
  'createdBy',
  'createdAt',
  'updatedAt',
  '_version',
  'version',
  'role',
  'permissions',
  'serverOnly',
]);

export function validateWritableField(
  collection: WritableEntityCollection,
  field: string,
  value: WriteValue,
): WriteValue {
  if (FORBIDDEN_FIELDS.has(field)) {
    throw new DomainError('FORBIDDEN', `Field '${field}' cannot be written.`);
  }
  const schema = FIELD_SCHEMAS[collection][field];
  if (!schema) {
    throw new DomainError('INVALID_ARGUMENT', `Field '${field}' is not writable for ${collection}.`);
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new DomainError('INVALID_ARGUMENT', `Invalid value for ${collection}.${field}.`);
  }
  return result.data as WriteValue;
}

export function normalizePublicOperation(
  operation: PublicChangeOperation,
): Readonly<Record<string, ScalarPatchValue>> {
  assertEntityId(operation.id);
  const values: Record<string, ScalarPatchValue> = {};
  for (const entry of operation.patch) {
    if (Object.prototype.hasOwnProperty.call(values, entry.field)) {
      throw new DomainError('INVALID_ARGUMENT', `Duplicate patch field '${entry.field}'.`);
    }
    values[entry.field] = validateWritableField(
      operation.collection,
      entry.field,
      entry.value,
    ) as ScalarPatchValue;
  }
  if (operation.op === 'delete' && operation.patch.length !== 0) {
    throw new DomainError('INVALID_ARGUMENT', 'Delete operations cannot contain a patch.');
  }
  if (operation.op !== 'delete' && operation.patch.length === 0) {
    throw new DomainError('INVALID_ARGUMENT', `${operation.op} requires at least one field.`);
  }
  return values;
}

export const REFERENCE_FIELDS = Object.freeze({
  domainId: 'domains',
  goalId: 'goals',
  projectId: 'projects',
  taskId: 'tasks',
} satisfies Readonly<Record<string, EntityCollection>>);
