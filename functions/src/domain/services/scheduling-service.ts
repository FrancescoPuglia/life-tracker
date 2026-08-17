import { createHash } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { DomainError } from '../errors';
import { hashPlanningPreferences, hashValidationScopeRecords } from '../integrity';
import type { Repository } from '../repository';
import type {
  ReplaceDayScheduleArgs,
  ReplaceWeekScheduleArgs,
  PreviewTimeBlockChangeArgs,
  ScheduleBlockInput,
} from '../schemas';
import type {
  AuthContext,
  ChangeOperation,
  EntityRecord,
  PublicChangePlan,
  ReadFilter,
  ScalarPatchValue,
  UserPlanningPreferences,
  PreviewValidationRequirements,
} from '../types';
import { isActiveScheduleTimeBlock, isProtectedTimeBlock } from '../timeblock-policy';
import { extractWpiMarkers, stripSemanticMarkerLines } from '../semantic-markers';
import type { WpiBlock, WpiDraft } from '../scheduling/wpi-adapter';
import { validateWithWeeklyPlanningIntelligence } from '../scheduling/wpi-adapter';
import { ChangePlanService } from './change-plan-service';

const MAX_EXISTING_BLOCKS = 2_000;
const INTERNAL_PAGE_SIZE = 200;
const MAX_PLAN_OPERATIONS = 100;
const MAX_EXISTING_SCAN_PAGES = 10;
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
    const preferences = await this.authoritativePreferences(context.uid, args.timezone);
    return this.previewRange(
      context,
      'replace_day_schedule',
      date,
      date.add({ days: 1 }),
      args.timezone,
      args.blocks,
      args.reason,
      preferences,
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
    const preferences = await this.authoritativePreferences(context.uid, args.timezone);
    return this.previewRange(
      context,
      'replace_week_schedule',
      start,
      start.add({ days: 7 }),
      args.timezone,
      args.blocks,
      args.reason,
      preferences,
    );
  }

  async previewTimeBlockChange(
    context: AuthContext,
    args: PreviewTimeBlockChangeArgs,
  ): Promise<PublicChangePlan> {
    assertTimeZone(args.timezone);
    const preferences = await this.authoritativePreferences(context.uid, args.timezone);
    let start: Temporal.Instant;
    try {
      start = Temporal.Instant.from(args.block.start);
    } catch {
      throw new DomainError('INVALID_ARGUMENT', 'Invalid TimeBlock start instant.');
    }
    const date = start.toZonedDateTimeISO(args.timezone).toPlainDate();
    const range = instantRange(date, date.add({ days: 1 }), args.timezone);
    const capacityRange = weekInstantRange(date, args.timezone);
    const proposed = normalizeBlock(
      args.block,
      args.timezone,
      date,
      date.add({ days: 1 }),
      'preview_timeblock_change',
    );
    const existing = await this.readExisting(context.uid, range.from, range.to);
    const capacityExisting = capacityRange.from === range.from && capacityRange.to === range.to
      ? existing
      : await this.readExisting(context.uid, capacityRange.from, capacityRange.to);
    // A move may cross a calendar-day boundary, so the target entity cannot
    // be discovered solely through the proposed day's bounded schedule scan.
    // Resolve it directly through the same UID-scoped repository path.
    const current = await this.repository.getEntity(context.uid, 'timeBlocks', proposed.id);
    if (args.action === 'create' && current) {
      throw new DomainError('CONFLICT', 'The TimeBlock already exists; request an update instead.');
    }
    if (args.action !== 'create' && !current) {
      throw new DomainError('NOT_FOUND', 'The TimeBlock is unavailable for this user.');
    }
    if (current && isProtectedTimeBlock(current)) {
      throw new DomainError('FORBIDDEN', 'Executed, in-progress, fixed, or locked TimeBlocks cannot be changed by AI.');
    }
    if (current && !isActiveScheduleTimeBlock(current)) {
      throw new DomainError('FORBIDDEN', 'Cancelled TimeBlock history cannot be changed or reactivated by AI.');
    }
    if (current) assertSingleCalendarDayBlock(current, args.timezone);
    if (
      args.action === 'move'
      && current
      && current.startTime === args.block.start
      && current.endTime === args.block.end
    ) {
      throw new DomainError('INVALID_ARGUMENT', 'A move must change the TimeBlock interval.');
    }
    if (
      args.action === 'update'
      && current
      && (current.startTime !== args.block.start || current.endTime !== args.block.end)
    ) {
      throw new DomainError('INVALID_ARGUMENT', 'Changing TimeBlock times requires the explicit move action.');
    }

    const additionalValidationRanges: ScheduleValidationRange[] = [];
    if (args.action === 'move' && current) {
      let sourceDate: Temporal.PlainDate;
      try {
        if (typeof current.startTime !== 'string') throw new Error('missing start');
        sourceDate = Temporal.Instant.from(current.startTime)
          .toZonedDateTimeISO(args.timezone)
          .toPlainDate();
      } catch {
        throw new DomainError('CONFLICT', 'The existing TimeBlock has an invalid source interval.');
      }
      if (sourceDate.toString() !== date.toString()) {
        const sourceRange = instantRange(sourceDate, sourceDate.add({ days: 1 }), args.timezone);
        if (sourceRange.from !== capacityRange.from || sourceRange.to !== capacityRange.to) {
          additionalValidationRanges.push({
            existing: await this.readExisting(context.uid, sourceRange.from, sourceRange.to),
            from: sourceRange.from,
            to: sourceRange.to,
          });
        }
      }
    }

    const commitments = existing.filter((record) => (
      record.id !== proposed.id && isActiveScheduleTimeBlock(record)
    ));
    const capacityCommitments = capacityExisting.filter((record) => (
      record.id !== proposed.id && isActiveScheduleTimeBlock(record)
    ));
    const protectedCommitments = commitments.filter(isProtectedTimeBlock);
    const mutableCommitments = commitments.filter((record) => !isProtectedTimeBlock(record));
    const conflicts = [
      ...detectProtectedConflicts([proposed], protectedCommitments),
      ...detectExistingConflicts([proposed], mutableCommitments),
      ...(!hasEntityMapping(proposed.input) && !UNMAPPED_SAFE_TYPES.has(proposed.input.type)
        ? [`Productive block '${proposed.input.title}' requires a Goal, Project, or Task mapping.`]
        : []),
    ];
    const draft = buildWpiDraft(
      'preview_timeblock_change',
      date,
      args.timezone,
      [proposed],
      capacityCommitments,
    );
    const wpi = validateWithWeeklyPlanningIntelligence(draft, {
      earliestHour: preferences.workingHours?.start ?? '07:00',
      latestHour: preferences.workingHours?.end ?? '22:00',
      maxDailyPlannedMinutes: preferences.maxDailyPlannedMinutes,
      maxWeeklyPlannedMinutes: preferences.maxWeeklyPlannedMinutes,
      minBufferMinutes: preferences.minBufferMinutes,
      maxConsecutiveHighEnergyBlocks: preferences.maxConsecutiveHighEnergyBlocks,
    });
    conflicts.push(...wpi.conflicts);
    const operation: ChangeOperation = {
      op: args.action === 'create' ? 'create' : 'update',
      collection: 'timeBlocks',
      id: proposed.id,
      values: scheduleValues(args.block, wpi.generatedNotes[proposed.id], current),
    };
    return this.changePlans.previewOperations(
      context,
      'preview_timeblock_change',
      [operation],
      [...new Set(wpi.warnings)],
      [...new Set(conflicts)],
      {
        reason: args.reason,
        assumptions: preferenceAssumptions(preferences),
        expectedImpact: [`${args.action} TimeBlock '${args.block.title}' within ${args.timezone}.`],
        validation: scheduleValidation(
          capacityExisting,
          capacityRange.from,
          capacityRange.to,
          preferences,
          additionalValidationRanges,
        ),
      },
    );
  }

  private async previewRange(
    context: AuthContext,
    tool: 'replace_day_schedule' | 'replace_week_schedule',
    startDate: Temporal.PlainDate,
    endDate: Temporal.PlainDate,
    timezone: string,
    inputs: readonly ScheduleBlockInput[],
    reason: string,
    preferences: UserPlanningPreferences,
  ): Promise<PublicChangePlan> {
    const range = instantRange(startDate, endDate, timezone);
    const normalized = inputs.map((input) => normalizeBlock(input, timezone, startDate, endDate, tool));
    const existing = await this.readExisting(context.uid, range.from, range.to);
    const capacityRange = weekInstantRange(startDate, timezone);
    const capacityExisting = capacityRange.from === range.from && capacityRange.to === range.to
      ? existing
      : await this.readExisting(context.uid, capacityRange.from, capacityRange.to);
    const existingById = new Map(existing.map((record) => [record.id, record]));
    const activeExisting = existing.filter(isActiveScheduleTimeBlock);
    const protectedBlocks = activeExisting.filter(isProtectedTimeBlock);
    const mutableBlocks = activeExisting.filter((record) => !isProtectedTimeBlock(record));
    for (const record of mutableBlocks) assertBlockWhollyContained(record, range.from, range.to);
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
      if (protectedMatch && isProtectedTimeBlock(protectedMatch)) {
        conflicts.push(`Protected time block '${block.id}' cannot be replaced.`);
      }
      if (protectedMatch && !isActiveScheduleTimeBlock(protectedMatch)) {
        conflicts.push(`Cancelled time block '${block.id}' is immutable history and its ID cannot be reused.`);
      }
    }

    const targetIds = new Set(activeExisting.map((record) => record.id));
    const unchangedCapacityCommitments = capacityExisting.filter((record) =>
      isActiveScheduleTimeBlock(record)
      && (isProtectedTimeBlock(record) || !targetIds.has(record.id)));
    const draft = buildWpiDraft(tool, startDate, timezone, normalized, unchangedCapacityCommitments);
    const wpi = validateWithWeeklyPlanningIntelligence(draft, {
      earliestHour: preferences.workingHours?.start ?? '07:00',
      latestHour: preferences.workingHours?.end ?? '22:00',
      maxDailyPlannedMinutes: preferences.maxDailyPlannedMinutes,
      maxWeeklyPlannedMinutes: preferences.maxWeeklyPlannedMinutes,
      minBufferMinutes: preferences.minBufferMinutes,
      maxConsecutiveHighEnergyBlocks: preferences.maxConsecutiveHighEnergyBlocks,
    });
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
      if (current && isProtectedTimeBlock(current)) continue;
      if (current && !isActiveScheduleTimeBlock(current)) continue;
      const generatedNotes = wpi.generatedNotes[block.id];
      const values = scheduleValues(block.input, generatedNotes, current);
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
      {
        reason,
        assumptions: preferenceAssumptions(preferences),
        expectedImpact: [`Replace ${tool === 'replace_day_schedule' ? 'one day' : 'one week'} within ${timezone}.`],
        validation: scheduleValidation(
          capacityExisting,
          capacityRange.from,
          capacityRange.to,
          preferences,
        ),
      },
    );
  }

  private async authoritativePreferences(uid: string, requestedTimezone: string): Promise<UserPlanningPreferences> {
    const preferences = await this.repository.getUserPlanningPreferences(uid);
    if (requestedTimezone !== preferences.timezone) {
      throw new DomainError('INVALID_ARGUMENT', 'Requested timezone does not match the authenticated user preference.');
    }
    return preferences;
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
    let pages = 0;
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
      pages += 1;
      if (cursor && pages >= MAX_EXISTING_SCAN_PAGES) {
        throw new DomainError('LIMIT_EXCEEDED', 'Schedule scan limit exceeded; narrow the replacement range.');
      }
    } while (cursor);
    return output;
  }
}

interface ScheduleValidationRange {
  readonly existing: readonly EntityRecord[];
  readonly from: string;
  readonly to: string;
}

function scheduleValidation(
  existing: readonly EntityRecord[],
  from: string,
  to: string,
  preferences: UserPlanningPreferences,
  additionalRanges: readonly ScheduleValidationRange[] = [],
): PreviewValidationRequirements {
  return {
    refs: [],
    scopes: [
      { existing, from, to },
      ...additionalRanges,
    ].map((range) => ({
        collection: 'timeBlocks' as const,
        field: null,
        value: null,
        from: range.from,
        to: range.to,
        maxItems: MAX_EXISTING_BLOCKS,
        expectedStateHash: hashValidationScopeRecords(range.existing),
      })),
    planningPreferencesHash: hashPlanningPreferences(preferences),
  };
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

function weekInstantRange(
  date: Temporal.PlainDate,
  timezone: string,
): Readonly<{ from: string; to: string }> {
  const monday = date.subtract({ days: date.dayOfWeek - 1 });
  return instantRange(monday, monday.add({ days: 7 }), timezone);
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

function detectExistingConflicts(
  proposed: readonly NormalizedBlock[],
  existingBlocks: readonly EntityRecord[],
): readonly string[] {
  const conflicts: string[] = [];
  for (const block of proposed) {
    for (const existing of existingBlocks) {
      if (typeof existing.startTime !== 'string' || typeof existing.endTime !== 'string') {
        conflicts.push(`Existing block '${existing.id}' has an invalid interval.`);
        continue;
      }
      const start = Date.parse(existing.startTime);
      const end = Date.parse(existing.endTime);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
        conflicts.push(`Existing block '${existing.id}' has an invalid interval.`);
      } else if (block.startMs < end && start < block.endMs) {
        conflicts.push(`Block '${block.input.title}' overlaps existing block '${String(existing.title ?? existing.id)}'.`);
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
  capacityCommitments: readonly EntityRecord[],
): WpiDraft {
  const monday = rangeStart.subtract({ days: rangeStart.dayOfWeek - 1 });
  const proposedWpiBlocks: WpiBlock[] = blocks.map((block) => {
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
      startInstant: block.input.start,
      endInstant: block.input.end,
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
  // Unchanged commitments are never emitted as operations, but they still
  // consume real daily/weekly capacity. Include bounded, read-only
  // representations in WPI validation so a day-level preview cannot make a
  // nearly-full persisted week appear feasible.
  const wpiBlocks = [
    ...proposedWpiBlocks,
    ...capacityCommitments.flatMap((record) => commitmentWpiBlocks(record, timezone, monday)),
  ];
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

function commitmentWpiBlocks(
  record: EntityRecord,
  timezone: string,
  monday: Temporal.PlainDate,
): readonly WpiBlock[] {
  if (typeof record.startTime !== 'string' || typeof record.endTime !== 'string') return [];
  try {
    const weekStart = monday
      .toZonedDateTime({ timeZone: timezone, plainTime: Temporal.PlainTime.from('00:00') })
      .toInstant();
    const weekEnd = monday.add({ days: 7 })
      .toZonedDateTime({ timeZone: timezone, plainTime: Temporal.PlainTime.from('00:00') })
      .toInstant();
    const recordStart = Temporal.Instant.from(record.startTime);
    const recordEnd = Temporal.Instant.from(record.endTime);
    let cursor = Temporal.Instant.compare(recordStart, weekStart) < 0 ? weekStart : recordStart;
    const end = Temporal.Instant.compare(recordEnd, weekEnd) > 0 ? weekEnd : recordEnd;
    const output: WpiBlock[] = [];
    let segment = 0;
    while (Temporal.Instant.compare(cursor, end) < 0 && segment < 8) {
      const localStart = cursor.toZonedDateTimeISO(timezone);
      const nextMidnight = localStart.toPlainDate().add({ days: 1 })
        .toZonedDateTime({ timeZone: timezone, plainTime: Temporal.PlainTime.from('00:00') })
        .toInstant();
      const segmentEnd = Temporal.Instant.compare(end, nextMidnight) < 0 ? end : nextMidnight;
      const localEnd = segmentEnd.toZonedDateTimeISO(timezone);
      const dayOffset = monday.until(localStart.toPlainDate(), { largestUnit: 'days' }).days;
      if (dayOffset >= 0 && dayOffset <= 6) {
        const id = `protected_${record.id}_${segment}`;
        output.push({
          id,
          intentId: `intent_${id}`,
          label: String(record.title ?? record.name ?? 'Protected commitment').slice(0, 240),
          day: dayOffset as WpiBlock['day'],
          startTime: hhmm(localStart),
          // WPI does not accept 24:00. Exact overlap protection remains in
          // detectProtectedConflicts; 23:59 is only its calendar display edge.
          endTime: Temporal.Instant.compare(segmentEnd, nextMidnight) === 0 ? '23:59' : hhmm(localEnd),
          startInstant: cursor.toString(),
          endInstant: segmentEnd.toString(),
          durationMinutes: Math.max(1, Math.round(segmentEnd.since(cursor).total({ unit: 'minutes' }))),
          activityType: 'maintenance',
          energyLevel: 'low',
          flexibility: 'fixed',
          mapping: {
            intentId: `intent_${id}`,
            status: 'maintenance',
            confidence: 1,
            reason: 'Authoritative unchanged Life Tracker commitment',
            matchedKeywords: [],
          },
          confidence: 1,
          sourceText: `protected:${record.id}`,
          isRoutine: false,
        });
      }
      cursor = segmentEnd;
      segment += 1;
    }
    return output;
  } catch {
    throw new DomainError('CONFLICT', `Protected time block '${record.id}' has an invalid interval.`);
  }
}

function hhmm(value: Temporal.ZonedDateTime): string {
  return `${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`;
}

function scheduleValues(
  input: ScheduleBlockInput,
  generatedNotes: string | undefined,
  current: EntityRecord | null | undefined,
): Readonly<Record<string, ScalarPatchValue>> {
  const requestedNotes = stripSemanticMarkerLines(input.notes, 'WPI_KEY');
  const generatedBody = stripSemanticMarkerLines(generatedNotes, 'WPI_KEY');
  const existingMarkers = extractWpiMarkers(typeof current?.notes === 'string' ? current.notes : null);
  const generatedMarkers = extractWpiMarkers(generatedNotes);
  const trustedMarkers = existingMarkers.length ? existingMarkers : generatedMarkers;
  const notes = [requestedNotes, generatedBody, ...trustedMarkers]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .join('\n\n');
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
    notes: notes || null,
    flexibility: input.flexibility,
  };
}

function assertSingleCalendarDayBlock(record: EntityRecord, timezone: string): void {
  try {
    if (typeof record.startTime !== 'string' || typeof record.endTime !== 'string') throw new Error('missing');
    const start = Temporal.Instant.from(record.startTime);
    const end = Temporal.Instant.from(record.endTime);
    if (Temporal.Instant.compare(start, end) >= 0) throw new Error('geometry');
    if (!start.toZonedDateTimeISO(timezone).toPlainDate()
      .equals(end.toZonedDateTimeISO(timezone).toPlainDate())) {
      throw new DomainError(
        'CONFLICT',
        'A mutable cross-calendar TimeBlock requires the manual scheduling workflow.',
      );
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('CONFLICT', 'The existing TimeBlock has an invalid interval.');
  }
}

function assertBlockWhollyContained(record: EntityRecord, from: string, to: string): void {
  try {
    if (typeof record.startTime !== 'string' || typeof record.endTime !== 'string') throw new Error('missing');
    const start = Temporal.Instant.from(record.startTime);
    const end = Temporal.Instant.from(record.endTime);
    if (
      Temporal.Instant.compare(start, end) >= 0
      || Temporal.Instant.compare(start, Temporal.Instant.from(from)) < 0
      || Temporal.Instant.compare(end, Temporal.Instant.from(to)) > 0
    ) {
      throw new DomainError(
        'CONFLICT',
        'A mutable TimeBlock crossing the requested calendar boundary requires the manual scheduling workflow.',
      );
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('CONFLICT', 'The existing TimeBlock has an invalid interval.');
  }
}

function hasEntityMapping(input: ScheduleBlockInput): boolean {
  return Boolean(input.taskId || input.projectId || input.goalId);
}

function preferenceAssumptions(preferences: UserPlanningPreferences): readonly string[] {
  if (preferences.source === 'persisted') return [];
  return [preferences.source === 'product_default'
    ? 'No persisted planning preferences were found; explicit Life Tracker product defaults were used.'
    : `Invalid or missing persisted planning fields used explicit product defaults: ${preferences.defaultsApplied.join(', ')}.`];
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
