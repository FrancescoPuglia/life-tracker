import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const nullableIdSchema = idSchema.nullable();
const isoDateTimeSchema = z.string().datetime({ offset: true });
const nullableIsoDateTimeSchema = isoDateTimeSchema.nullable();

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
    collection: z.enum(['goals', 'keyResults', 'projects', 'tasks', 'timeBlocks', 'habits', 'notes', 'domains']),
    id: idSchema,
    patch: z.array(publicPatchSchema).max(30),
  })
  .strict();

export const previewChangesArgsSchema = z
  .object({
    operations: z.array(publicChangeOperationSchema).min(1).max(100),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const planActionArgsSchema = z
  .object({
    planId: idSchema,
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

const draftPrioritySchema = z.enum(['critical', 'high', 'medium', 'low']);
const nullableDescriptionSchema = z.string().max(20_000).nullable();
const nullableCalendarOrInstantSchema = z.string().max(64).nullable();

const goalArchitectGoalSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(240),
  description: nullableDescriptionSchema,
  targetHours: z.number().min(0.25).max(1_000_000),
  dueDateISO: z.string().max(64),
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
  estimatedHours: z.number().min(1 / 60).max(24_000),
  dueDateISO: nullableCalendarOrInstantSchema,
  priority: draftPrioritySchema,
  parentProjectId: idSchema,
}).strict();

const goalArchitectKeyResultSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(240),
  description: nullableDescriptionSchema,
  targetValue: z.number().finite(),
  currentValue: z.number().finite(),
  unit: z.enum(['percent', 'hours', 'days', 'sessions', 'courses', 'videos', 'studies', 'tasks', 'books', 'custom']),
  customUnit: z.string().trim().min(1).max(64).nullable(),
}).strict();

export const previewGoalArchitectureArgsSchema = z.object({
  domainId: idSchema,
  reason: z.string().trim().min(1).max(500),
  goal: goalArchitectGoalSchema,
  projects: z.array(goalArchitectProjectSchema).min(1).max(20),
  tasks: z.array(goalArchitectTaskSchema).min(1).max(80),
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
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().trim().min(1).max(100),
    blocks: z.array(scheduleBlockSchema).max(96),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const replaceWeekScheduleArgsSchema = z
  .object({
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().trim().min(1).max(100),
    blocks: z.array(scheduleBlockSchema).max(100),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type PreviewChangesArgs = z.infer<typeof previewChangesArgsSchema>;
export type PlanActionArgs = z.infer<typeof planActionArgsSchema>;
export type PreviewGoalArchitectureArgs = z.infer<typeof previewGoalArchitectureArgsSchema>;
export type ReplaceDayScheduleArgs = z.infer<typeof replaceDayScheduleArgsSchema>;
export type ReplaceWeekScheduleArgs = z.infer<typeof replaceWeekScheduleArgsSchema>;
