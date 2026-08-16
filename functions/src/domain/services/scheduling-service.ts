import { createHash } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { DomainError } from '../errors';
import type { Repository } from '../repository';
import type {
  ReplaceDayScheduleArgs,
  ReplaceWeekScheduleArgs,
  ScheduleBlockInput,
} from '../schemas';
import type {
  AuthContext,
  ChangeOperation,
  EntityRecord,
  PublicChangePlan,
  ReadFilter,
  ScalarPatchValue,
} from '../types';
import type { WpiBlock, WpiDraft } from '../scheduling/wpi-adapter';
import { validateWithWeeklyPlanningIntelligence } from '../scheduling/wpi-adapter';
import { ChangePlanService } from './change-plan-service';

const MAX_EXISTING_BLOCKS = 2_000;
const INTERNAL_PAGE_SIZE = 200;
const MAX_PLAN_OPERATIONS = 100;
const UNMAPPED_SAFE_TYPES = new Set(['break', 'buffer', 'travel', 'admin']);

interface NormalizedBlock {
  readonly input: ScheduleBlockInput;
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly localDate: string;
}

export class SchedulingService {
  constructor(
    private readonly repository: Repository,
    private readonly changePlans: ChangePlanService,
  ) {}

  async replaceDaySchedule(
    context: AuthContext,
    args: ReplaceDayScheduleArgs,
  ): Promise<PublicChangePlan> {
    const date = parseDate(args.date);
    assertTimeZone(args.timezone);
    return this.previewRange(
      context,
      'replace_day_schedule',
      date,
      date.add({ days: 1 }),
      args.timezone,
      args.blocks,
    );
  }

  async replaceWeekSchedule(
    context: AuthContext,
    args: ReplaceWeekScheduleArgs,
  ): Promise<PublicChangePlan> {
    const start = parseDate(args.weekStart);
    if (start.dayOfWeek !== 1) {
      throw new DomainError('INVALID_ARGUMENT', 'weekStart must be a Monday calendar date.');
    }
    assertTimeZone(args.timezone);
    return this.previewRange(
      context,
      'replace_week_schedule',
      start,
      start.add({ days: 7 }),
      args.timezone,
      args.blocks,
    );
  }

  private async previewRange(
    context: AuthContext,
    tool: 'replace_day_schedule' | 'replace_week_schedule',
    startDate: Temporal.PlainDate,
    endDate: Temporal.PlainDate,
    timezone: string,
    inputs: readonly ScheduleBlockInput[],
  ): Promise<PublicChangePlan> {
    const range = instantRange(startDate, endDate, timezone);
    const normalized = inputs.map((input) => normalizeBlock(input, timezone, startDate, endDate, tool));
    const existing = await this.readExisting(context.uid, range.from, range.to);
    const existingById = new Map(existing.map((record) => [record.id, record]));
    const protectedBlocks = existing.filter(isProtected);
    const mutableBlocks = existing.filter((record) => !isProtected(record));
    const warnings: string[] = protectedBlocks.length
      ? [`Preserved ${protectedBlocks.length} completed, in-progress, or protected time block(s).`]
      : [];
    const conflicts: string[] = [];

    conflicts.push(...detectIntervalConflicts(normalized));
    conflicts.push(...detectProtectedConflicts(normalized, protectedBlocks));
    for (const block of normalized) {
      if (!hasEntityMapping(block.input) && !UNMAPPED_SAFE_TYPES.has(block.input.type)) {
        conflicts.push(`Productive block '${block.input.title}' requires a Goal, Project, or Task mapping.`);
      }
      const protectedMatch = existingById.get(block.id);
      if (protectedMatch && isProtected(protectedMatch)) {
        conflicts.push(`Protected time block '${block.id}' cannot be replaced.`);
      }
    }

    const draft = buildWpiDraft(tool, startDate, timezone, normalized);
    const wpi = validateWithWeeklyPlanningIntelligence(draft);
    conflicts.push(...wpi.conflicts);
    warnings.push(...wpi.warnings);

    const proposedIds = new Set(normalized.map((block) => block.id));
    const operations: ChangeOperation[] = [];
    for (const record of mutableBlocks) {
      if (!proposedIds.has(record.id)) {
        operations.push({ op: 'delete', collection: 'timeBlocks', id: record.id, values: {} });
      }
    }
    for (const block of normalized) {
      const current = existingById.get(block.id);
      if (current && isProtected(current)) continue;
      const generatedNotes = wpi.generatedNotes[block.id];
      const values = scheduleValues(block.input, generatedNotes);
      operations.push({
        op: current ? 'update' : 'create',
        collection: 'timeBlocks',
        id: block.id,
        values,
      });
    }
    if (operations.length > MAX_PLAN_OPERATIONS) {
      throw new DomainError(
        'LIMIT_EXCEEDED',
        `Schedule replacement would require ${operations.length} operations; maximum is ${MAX_PLAN_OPERATIONS}.`,
      );
    }
    if (!operations.length) {
      throw new DomainError('CONFLICT', 'The proposed schedule does not change any mutable blocks.');
    }
    return this.changePlans.previewOperations(
      context,
      tool,
      operations,
      [...new Set(warnings)],
      [...new Set(conflicts)],
    );
  }

  private async readExisting(uid: string, from: string, to: string): Promise<readonly EntityRecord[]> {
    const filter: ReadFilter = {
      query: null,
      from,
      to,
      status: null,
      domainId: null,
      projectId: null,
      goalId: null,
      taskId: null,
    };
    const output: EntityRecord[] = [];
    let cursor: string | null = null;
    do {
      const page = await this.repository.listEntities(uid, 'timeBlocks', {
        filter,
        cursor,
        limit: INTERNAL_PAGE_SIZE,
      });
      output.push(...page.items);
      if (output.length > MAX_EXISTING_BLOCKS) {
        throw new DomainError('LIMIT_EXCEEDED', 'Too many existing blocks in the requested range.');
      }
      cursor = page.nextCursor;
    } while (cursor);
    return output;
  }
}

function parseDate(value: string): Temporal.PlainDate {
  try {
    const parsed = Temporal.PlainDate.from(value);
    if (parsed.toString() !== value) throw new Error('non-canonical');
    return parsed;
  } catch {
    throw new DomainError('INVALID_ARGUMENT', 'Invalid calendar date.');
  }
}

function assertTimeZone(timezone: string): void {
  try {
    Temporal.ZonedDateTime.from({
      timeZone: timezone,
      year: 2024,
      month: 1,
      day: 15,
      hour: 12,
    });
  } catch {
    throw new DomainError('INVALID_ARGUMENT', 'Invalid IANA timezone.');
  }
}

function instantRange(
  start: Temporal.PlainDate,
  end: Temporal.PlainDate,
  timezone: string,
): Readonly<{ from: string; to: string }> {
  const midnight = Temporal.PlainTime.from('00:00');
  return {
    from: start.toZonedDateTime({ timeZone: timezone, plainTime: midnight }).toInstant().toString(),
    to: end.toZonedDateTime({ timeZone: timezone, plainTime: midnight }).toInstant().toString(),
  };
}

function normalizeBlock(
  input: ScheduleBlockInput,
  timezone: string,
  rangeStart: Temporal.PlainDate,
  rangeEnd: Temporal.PlainDate,
  tool: string,
): NormalizedBlock {
  try {
    const start = Temporal.Instant.from(input.start);
    const end = Temporal.Instant.from(input.end);
    if (Temporal.Instant.compare(start, end) >= 0) throw new Error('non-positive');
    if (end.since(start).total({ unit: 'hours' }) > 24) throw new Error('too-long');
    const localStart = start.toZonedDateTimeISO(timezone);
    const localEnd = end.toZonedDateTimeISO(timezone);
    const localDate = localStart.toPlainDate();
    if (Temporal.PlainDate.compare(localDate, rangeStart) < 0 || Temporal.PlainDate.compare(localDate, rangeEnd) >= 0) {
      throw new Error('outside-range');
    }
    // Replacement semantics are calendar-day based; cross-midnight blocks need
    // an explicit preview for each affected day instead of an ambiguous delete.
    if (!localEnd.toPlainDate().equals(localDate)) throw new Error('cross-day');
    const id = input.id ?? deterministicBlockId(tool, input);
    return {
      input,
      id,
      startMs: Number(start.epochMilliseconds),
      endMs: Number(end.epochMilliseconds),
      localDate: localDate.toString(),
    };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('INVALID_ARGUMENT', `Invalid interval for schedule block '${input.title}'.`);
  }
}

function detectIntervalConflicts(blocks: readonly NormalizedBlock[]): readonly string[] {
  const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
  const conflicts: string[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous && current && previous.endMs > current.startMs) {
      conflicts.push(`Blocks '${previous.input.title}' and '${current.input.title}' overlap.`);
    }
  }
  return conflicts;
}

function detectProtectedConflicts(
  proposed: readonly NormalizedBlock[],
  protectedBlocks: readonly EntityRecord[],
): readonly string[] {
  const conflicts: string[] = [];
  for (const block of proposed) {
    for (const existing of protectedBlocks) {
      if (typeof existing.startTime !== 'string' || typeof existing.endTime !== 'string') continue;
      const start = Date.parse(existing.startTime);
      const end = Date.parse(existing.endTime);
      if (block.startMs < end && start < block.endMs) {
        conflicts.push(`Block '${block.input.title}' overlaps protected block '${String(existing.title ?? existing.id)}'.`);
      }
    }
  }
  return conflicts;
}

function buildWpiDraft(
  tool: string,
  rangeStart: Temporal.PlainDate,
  timezone: string,
  blocks: readonly NormalizedBlock[],
): WpiDraft {
  const monday = rangeStart.subtract({ days: rangeStart.dayOfWeek - 1 });
  const wpiBlocks: WpiBlock[] = blocks.map((block) => {
    const localDate = Temporal.PlainDate.from(block.localDate);
    const day = monday.until(localDate, { largestUnit: 'days' }).days as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const start = Temporal.Instant.from(block.input.start).toZonedDateTimeISO(timezone);
    const end = Temporal.Instant.from(block.input.end).toZonedDateTimeISO(timezone);
    const mapped = hasEntityMapping(block.input);
    return {
      id: block.id,
      intentId: `intent_${block.id}`,
      label: block.input.title,
      day,
      // Absolute durations were already validated with Temporal. UTC clock
      // values preserve geometry for WPI's pure half-open overlap detector.
      startTime: `${String(start.hour).padStart(2, '0')}:${String(start.minute).padStart(2, '0')}`,
      endTime: `${String(end.hour).padStart(2, '0')}:${String(end.minute).padStart(2, '0')}`,
      durationMinutes: Math.round((block.endMs - block.startMs) / 60_000),
      activityType: block.input.activityType,
      energyLevel: block.input.energyLevel,
      flexibility: block.input.flexibility,
      mapping: mapped
        ? {
            intentId: `intent_${block.id}`,
            status: 'mapped',
            goalId: block.input.goalId ?? undefined,
            projectId: block.input.projectId ?? undefined,
            taskId: block.input.taskId ?? undefined,
            confidence: 1,
            reason: 'Explicit authenticated scheduling tool reference',
            matchedKeywords: [],
          }
        : { intentId: `intent_${block.id}`, status: 'maintenance', confidence: 1, reason: 'Calendar-only block', matchedKeywords: [] },
      confidence: 1,
      sourceText: `${tool}:${block.id}`,
      isRoutine: block.input.activityType === 'routine',
    };
  });
  const parsedIntents = wpiBlocks.map((block) => ({
    id: block.intentId,
    label: block.label,
    sourceText: block.sourceText,
    activityType: block.activityType,
    preferredDays: [block.day],
    preferredTime: block.startTime,
    durationMinutes: block.durationMinutes,
    recurrence: 'once',
    priority: 1,
    flexibility: block.flexibility,
    energyLevel: block.energyLevel,
    confidence: 1,
  }));
  return {
    id: deterministicDraftId(tool, rangeStart.toString(), blocks),
    weekStartISO: monday.toString(),
    sourceIntent: {
      id: `source_${tool}`,
      text: 'Authenticated AI schedule preview',
      weekStartISO: monday.toString(),
      createdAtISO: new Date(0).toISOString(),
    },
    parsedIntents,
    blocks: wpiBlocks,
    conflicts: [],
    warnings: [],
    realismScore: {
      overallScore: 100,
      totalPlannedMinutes: wpiBlocks.reduce((sum, block) => sum + block.durationMinutes, 0),
      dailyLoadMinutes: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
      weeklyOverloadPenalty: 0,
      dailyOverloadPenalty: 0,
      contextSwitchPenalty: 0,
      conflictPenalty: 0,
      recoveryPenalty: 0,
      goalCoverageScore: 100,
      notes: [],
    },
    generatedAtISO: new Date(0).toISOString(),
    status: 'draft',
  };
}

function scheduleValues(
  input: ScheduleBlockInput,
  generatedNotes: string | undefined,
): Readonly<Record<string, ScalarPatchValue>> {
  return {
    title: input.title,
    startTime: input.start,
    endTime: input.end,
    type: input.type,
    status: input.status,
    taskId: input.taskId,
    projectId: input.projectId,
    goalId: input.goalId,
    domainId: input.domainId,
    notes: input.notes ?? generatedNotes ?? null,
  };
}

function hasEntityMapping(input: ScheduleBlockInput): boolean {
  return Boolean(input.taskId || input.projectId || input.goalId);
}

function isProtected(record: EntityRecord): boolean {
  return record.protected === true || record.status === 'completed' || record.status === 'in_progress';
}

function deterministicBlockId(tool: string, input: ScheduleBlockInput): string {
  const hash = createHash('sha256')
    .update(JSON.stringify([tool, input.title, input.start, input.end, input.taskId, input.projectId, input.goalId]))
    .digest('hex')
    .slice(0, 24);
  return `ai_${hash}`;
}

function deterministicDraftId(
  tool: string,
  start: string,
  blocks: readonly NormalizedBlock[],
): string {
  return `ai_draft_${createHash('sha256')
    .update(JSON.stringify([tool, start, blocks.map((block) => block.id)]))
    .digest('hex')
    .slice(0, 20)}`;
}
