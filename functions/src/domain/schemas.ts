import { z } from 'zod';
import type { PublicChangeOperation } from './types';

const idSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const nullableIdSchema = idSchema.nullable();
const isoDateTimeSchema = z.string().datetime({ offset: true });
const nullableIsoDateTimeSchema = isoDateTimeSchema.nullable();
const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
const calendarOrInstantSchema = z.union([calendarDateSchema, isoDateTimeSchema]);

export const readFilterSchema = z
  .object({
    query: z.string().trim().max(200).nullable(),
    from: nullableIsoDateTimeSchema,
    to: nullableIsoDateTimeSchema,
    status: z.string().trim().max(64).nullable(),
    domainId: nullableIdSchema,
    projectId: nullableIdSchema,
    goalId: nullableIdSchema,
    taskId: nullableIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && Date.parse(value.from) >= Date.parse(value.to)) {
      context.addIssue({ code: 'custom', message: 'filter.from must be before filter.to' });
    }
    if (value.from && value.to) {
      const days = (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000;
      if (days > 366) context.addIssue({ code: 'custom', message: 'Date range cannot exceed 366 days' });
    }
  });

export const readArgsSchema = z
  .object({
    filter: readFilterSchema,
    cursor: z.string().max(1024).nullable(),
    limit: z.number().int().min(1).max(50),
  })
  .strict();

export type ReadArgs = z.infer<typeof readArgsSchema>;

export const stateArgsSchema = z.object({
  scope: z.enum(['today', 'week', '30_days', 'range']),
  from: nullableIsoDateTimeSchema,
  to: nullableIsoDateTimeSchema,
  perCollectionLimit: z.number().int().min(1).max(25),
  includeNotes: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.scope === 'range' && (!value.from || !value.to)) {
    context.addIssue({ code: 'custom', message: 'range scope requires from and to' });
  }
  if (value.scope !== 'range' && (value.from || value.to)) {
    context.addIssue({ code: 'custom', message: 'from and to are only valid for range scope' });
  }
  if (value.from && value.to) {
    const range = Date.parse(value.to) - Date.parse(value.from);
    if (range <= 0) context.addIssue({ code: 'custom', message: 'from must be before to' });
    if (range > 366 * 86_400_000) {
      context.addIssue({ code: 'custom', message: 'State range cannot exceed 366 days' });
    }
  }
});

export const analyticsArgsSchema = z
  .object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const range = Date.parse(value.to) - Date.parse(value.from);
    if (range <= 0) context.addIssue({ code: 'custom', message: 'from must be before to' });
    if (range > 366 * 86_400_000) {
      context.addIssue({ code: 'custom', message: 'Analytics range cannot exceed 366 days' });
    }
  });

const patchValueSchema = z.union([
  z.string().max(20_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(256)).max(100),
]);

export const publicPatchSchema = z
  .object({
    field: z.string().trim().min(1).max(64),
    value: patchValueSchema,
  })
  .strict();

export const publicChangeOperationSchema = z
  .object({
    op: z.enum(['create', 'update', 'delete']),
    // Hierarchy and calendar mutations have dedicated deterministic tools.
    collection: z.enum(['habits', 'notes', 'domains']),
    id: idSchema,
    patch: z.array(publicPatchSchema).max(30),
  })
  .strict();

export const previewChangesArgsSchema = z
  .object({
    operations: z.array(publicChangeOperationSchema).min(1).max(10),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

const draftPrioritySchema = z.enum(['critical', 'high', 'medium', 'low']);
const nullableDescriptionSchema = z.string().max(20_000).nullable();
const nullableCalendarOrInstantSchema = calendarOrInstantSchema.nullable();

const goalArchitectGoalSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(240),
  description: nullableDescriptionSchema,
  targetHours: z.number().min(0.25).max(1_000_000),
  dueDateISO: calendarOrInstantSchema,
  priority: draftPrioritySchema,
  timeAllocationTarget: z.number().min(0).max(168),
  category: z.enum(['urgent_important', 'important_not_urgent', 'urgent_not_important', 'neither']),
  complexity: z.enum(['simple', 'moderate', 'complex', 'expert']),
}).strict();

const goalArchitectProjectSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(240),
  description: nullableDescriptionSchema,
  targetHours: z.number().min(0.25).max(1_000_000),
  dueDateISO: nullableCalendarOrInstantSchema,
  priority: draftPrioritySchema,
}).strict();

const goalArchitectTaskSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(240),
  description: nullableDescriptionSchema,
  estimatedHours: z.number().min(1 / 60).max(24),
  dueDateISO: nullableCalendarOrInstantSchema,
  priority: draftPrioritySchema,
  parentProjectId: idSchema,
}).strict();

export const previewTaskChangeArgsSchema = z.object({
  action: z.enum(['create', 'update']),
  id: idSchema,
  title: z.string().trim().min(1).max(240),
  description: nullableDescriptionSchema,
  status: z.enum(['pending', 'todo', 'in_progress', 'completed', 'blocked', 'cancelled']),
  priority: draftPrioritySchema,
  projectId: idSchema,
  goalId: idSchema,
  domainId: idSchema,
  dueDate: nullableCalendarOrInstantSchema,
  estimatedMinutes: z.number().int().min(1).max(1440),
  reason: z.string().trim().min(1).max(500),
}).strict();

const goalArchitectKeyResultSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(240),
  description: nullableDescriptionSchema,
  targetValue: z.number().finite(),
  currentValue: z.number().finite(),
  unit: z.enum(['percent', 'hours', 'days', 'sessions', 'courses', 'videos', 'studies', 'tasks', 'books', 'custom']),
  customUnit: z.string().trim().min(1).max(64).nullable(),
}).strict().superRefine((value, context) => {
  if (value.unit === 'custom' && !value.customUnit) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customUnit'],
      message: 'customUnit is required when unit is custom.',
    });
  }
  if (value.unit !== 'custom' && value.customUnit !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customUnit'],
      message: 'customUnit must be null for a standard unit.',
    });
  }
});

export const previewGoalArchitectureArgsSchema = z.object({
  domainId: idSchema,
  reason: z.string().trim().min(1).max(500),
  goal: goalArchitectGoalSchema,
  projects: z.array(goalArchitectProjectSchema).min(1).max(20),
  // 1 Goal + 20 Projects + 74 Tasks + 5 Key Results = 100 operations,
  // matching the transactional lifecycle's hard plan bound.
  tasks: z.array(goalArchitectTaskSchema).min(1).max(74),
  keyResults: z.array(goalArchitectKeyResultSchema).min(2).max(5),
}).strict();

export const scheduleBlockSchema = z
  .object({
    id: idSchema.nullable(),
    title: z.string().trim().min(1).max(240),
    start: isoDateTimeSchema,
    end: isoDateTimeSchema,
    type: z.enum(['work', 'break', 'buffer', 'travel', 'meeting', 'focus', 'admin', 'deep', 'shallow']),
    status: z.literal('planned'),
    taskId: nullableIdSchema,
    projectId: nullableIdSchema,
    goalId: nullableIdSchema,
    domainId: idSchema,
    notes: z.string().max(20_000).nullable(),
    activityType: z.enum([
      'routine',
      'task',
      'event',
      'deep_work',
      'exercise',
      'reading',
      'career',
      'chess',
      'maintenance',
      'unknown',
    ]),
    energyLevel: z.enum(['low', 'medium', 'high']),
    flexibility: z.enum(['fixed', 'flexible']),
  })
  .strict();

export type ScheduleBlockInput = z.infer<typeof scheduleBlockSchema>;

export const replaceDayScheduleArgsSchema = z
  .object({
    date: calendarDateSchema,
    timezone: z.string().trim().min(1).max(100),
    blocks: z.array(scheduleBlockSchema).max(96),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const previewTimeBlockChangeArgsSchema = z
  .object({
    action: z.enum(['create', 'update', 'move']),
    timezone: z.string().trim().min(1).max(100),
    block: scheduleBlockSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action !== 'create' && value.block.id === null) {
      context.addIssue({ code: 'custom', message: 'Updating or moving a time block requires its id' });
    }
  });

export const replaceWeekScheduleArgsSchema = z
  .object({
    weekStart: calendarDateSchema,
    timezone: z.string().trim().min(1).max(100),
    blocks: z.array(scheduleBlockSchema).max(100),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

/**
 * Internal service input remains collection-complete for deterministic tests
 * and non-model adapters. The model-facing Zod/JSON schema above is narrower
 * and cannot select hierarchy or calendar collections.
 */
export interface PreviewChangesArgs {
  readonly operations: readonly PublicChangeOperation[];
  readonly reason: string;
}
export type StateArgs = z.infer<typeof stateArgsSchema>;
export type PreviewGoalArchitectureArgs = z.infer<typeof previewGoalArchitectureArgsSchema>;
export type ReplaceDayScheduleArgs = z.infer<typeof replaceDayScheduleArgsSchema>;
export type ReplaceWeekScheduleArgs = z.infer<typeof replaceWeekScheduleArgsSchema>;
export type PreviewTimeBlockChangeArgs = z.infer<typeof previewTimeBlockChangeArgsSchema>;
export type PreviewTaskChangeArgs = z.infer<typeof previewTaskChangeArgsSchema>;
