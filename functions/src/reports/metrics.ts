import { createHash } from 'node:crypto';
import { canonicalJson } from '../domain/integrity';
import type { EntityRecord } from '../domain/types';
import {
  enumeratePeriodDates,
  fourWeekPeriods,
  instantEpochMilliseconds,
  localDateForEpoch,
  localEndOfDayEpoch,
  localHourForEpoch,
  localWeekdayForEpoch,
  reportPeriodFromDates,
  timeOfDayBucket,
  weekdayLabel,
} from './period';
import type {
  CompletionBucketMetric,
  DatasetCoverage,
  DailyMetricPoint,
  FourWeekTrendPoint,
  GoalAllocationMetric,
  MetricAvailability,
  MetricUnit,
  ReportDataQuality,
  ReportPeriod,
  ReportSourceCoverage,
  ScientificMetric,
  ScientificMetricBundle,
  ScientificReportInput,
  ScientificReportRecords,
  TimeOfDayBucket,
} from './types';
import { REPORT_FORMULA_VERSION, REPORT_METRIC_SCHEMA_VERSION } from './types';

const MAX_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const SESSION_DURATION_TOLERANCE_SECONDS = 60;
const DISPLAY_LABEL_LIMIT = 120;

interface Interval {
  readonly start: number;
  readonly end: number;
}

interface MutableQuality {
  invalidTimestampCount: number;
  invalidDurationCount: number;
  openSessionCount: number;
  completedSessionMissingDurationCount: number;
  explicitBlockActualCount: number;
  blocksMissingActualCount: number;
  taskCompletionTimestampFallbackCount: number;
  unattributedActualMinutes: number;
  missingGoalReferenceCount: number;
  duplicateHabitLogCount: number;
  unsupportedHabitCadenceCount: number;
  flags: Set<string>;
}

interface GoalShare {
  readonly goalId: string | null;
  readonly share: number;
}

interface Lookup {
  readonly goals: Map<string, EntityRecord>;
  readonly projects: Map<string, EntityRecord>;
  readonly tasks: Map<string, EntityRecord>;
  readonly blocks: Map<string, EntityRecord>;
}

interface MutableDay {
  plannedMinutes: number;
  actualMinutes: number;
  completedBlocks: number;
  eligibleBlocks: number;
  completedTasks: number;
}

interface MutableCompletionBucket {
  completed: number;
  eligible: number;
  missingCount: number;
}

interface ParsedSession {
  readonly record: EntityRecord;
  readonly interval: Interval;
  readonly netMinutes: number;
  readonly timeBlockId: string | null;
}

interface AggregateResult {
  readonly plannedMinutes: number;
  readonly actualMinutes: number;
  readonly actualSourceCount: number;
  readonly deepWorkMinutes: number;
  readonly eligibleBlocks: number;
  readonly completedBlocks: number;
  readonly plannedTasks: number;
  readonly completedPlannedTasks: number;
  readonly carryoverTasks: number;
  readonly startDelays: readonly number[];
  readonly overrunMinutes: number;
  readonly estimationAbsoluteErrors: readonly number[];
  readonly estimationPlannedMinutes: number;
  readonly daily: ReadonlyMap<string, MutableDay>;
  readonly plannedByGoal: ReadonlyMap<string | null, number>;
  readonly actualByGoal: ReadonlyMap<string | null, number>;
  readonly completionByTimeOfDay: ReadonlyMap<TimeOfDayBucket, MutableCompletionBucket>;
  readonly completionByWeekday: ReadonlyMap<number, MutableCompletionBucket>;
  readonly habitExpected: number;
  readonly habitCompleted: number;
}

function emptyQuality(): MutableQuality {
  return {
    invalidTimestampCount: 0,
    invalidDurationCount: 0,
    openSessionCount: 0,
    completedSessionMissingDurationCount: 0,
    explicitBlockActualCount: 0,
    blocksMissingActualCount: 0,
    taskCompletionTimestampFallbackCount: 0,
    unattributedActualMinutes: 0,
    missingGoalReferenceCount: 0,
    duplicateHabitLogCount: 0,
    unsupportedHabitCadenceCount: 0,
    flags: new Set(),
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value.length >= 1 && value.length <= 256
    ? value
    : null;
}

function asIdList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(asId).filter((item): item is string => item !== null)));
}

function sanitizeLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, DISPLAY_LABEL_LIMIT) : fallback;
}

function overlapMs(interval: Interval, period: Interval): number {
  return Math.max(0, Math.min(interval.end, period.end) - Math.max(interval.start, period.start));
}

function periodInterval(period: ReportPeriod): Interval {
  const start = instantEpochMilliseconds(period.from);
  const end = instantEpochMilliseconds(period.to);
  if (start === null || end === null || start >= end) throw new Error('Invalid resolved report period.');
  return { start, end };
}

function round(value: number, decimals = 2): number {
  const scale = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator > 0 ? round(numerator / denominator * 100) : null;
}

function worstAvailability(...values: readonly MetricAvailability[]): MetricAvailability {
  if (values.includes('unavailable')) return 'unavailable';
  if (values.includes('partial')) return 'partial';
  return 'available';
}

function datasetAvailability(...coverage: readonly DatasetCoverage[]): MetricAvailability {
  if (coverage.every((value) => value === 'unavailable')) return 'unavailable';
  return coverage.every((value) => value === 'complete') ? 'available' : 'partial';
}

function degradeAvailability(
  availability: MetricAvailability,
  shouldDegrade: boolean,
): MetricAvailability {
  return shouldDegrade && availability === 'available' ? 'partial' : availability;
}

function metric(args: Readonly<{
  id: string;
  value: number | null;
  unit: MetricUnit;
  availability: MetricAvailability;
  numerator?: number | null;
  denominator?: number | null;
  sampleSize?: number;
  missingCount?: number;
  formula: string;
  source: string;
}>): ScientificMetric {
  return {
    id: args.id,
    value: args.value === null ? null : round(args.value),
    unit: args.unit,
    availability: args.availability,
    numerator: args.numerator === undefined ? null : args.numerator,
    denominator: args.denominator === undefined ? null : args.denominator,
    sampleSize: args.sampleSize ?? 0,
    missingCount: args.missingCount ?? 0,
    formula: args.formula,
    source: args.source,
  };
}

function normalizeCoverage(input: ScientificReportInput, quality: MutableQuality): ReportSourceCoverage {
  const sessions = input.records.sessions === null
    ? 'unavailable'
    : input.coverage.sessions;
  const habitLogs = input.records.habitLogs === null
    ? 'unavailable'
    : input.coverage.habitLogs;
  if (sessions !== input.coverage.sessions) quality.flags.add('sessions_dataset_unavailable');
  if (habitLogs !== input.coverage.habitLogs) quality.flags.add('habit_logs_dataset_unavailable');
  return { ...input.coverage, sessions, habitLogs };
}

function makeLookup(records: ScientificReportRecords): Lookup {
  return {
    goals: new Map(records.goals.map((record) => [record.id, record])),
    projects: new Map(records.projects.map((record) => [record.id, record])),
    tasks: new Map(records.tasks.map((record) => [record.id, record])),
    blocks: new Map(records.timeBlocks.map((record) => [record.id, record])),
  };
}

function normalizedExplicitShares(
  value: unknown,
  lookup: Lookup,
  quality: MutableQuality,
): readonly GoalShare[] {
  const record = asRecord(value);
  if (!record) return [];
  const entries: Array<readonly [string, number]> = [];
  for (const [goalId, rawWeight] of Object.entries(record)) {
    const weight = asFiniteNumber(rawWeight);
    if (!asId(goalId) || weight === null || weight <= 0 || weight > 100) continue;
    if (!lookup.goals.has(goalId)) {
      quality.missingGoalReferenceCount += 1;
      continue;
    }
    entries.push([goalId, weight]);
  }
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  return total > 0
    ? entries.map(([goalId, weight]) => ({ goalId, share: weight / total }))
    : [];
}

function directGoalShares(
  record: EntityRecord,
  lookup: Lookup,
  quality: MutableQuality,
): readonly GoalShare[] {
  const explicit = normalizedExplicitShares(
    record.goalAllocation ?? record.goalContribution,
    lookup,
    quality,
  );
  if (explicit.length) return explicit;

  const ids = asIdList(record.goalIds);
  if (ids.length) {
    const valid = ids.filter((id) => {
      if (lookup.goals.has(id)) return true;
      quality.missingGoalReferenceCount += 1;
      return false;
    });
    if (valid.length) return valid.map((goalId) => ({ goalId, share: 1 / valid.length }));
  }

  const goalId = asId(record.goalId);
  if (goalId) {
    if (lookup.goals.has(goalId)) return [{ goalId, share: 1 }];
    quality.missingGoalReferenceCount += 1;
  }
  return [];
}

function resolveGoalShares(
  record: EntityRecord,
  lookup: Lookup,
  quality: MutableQuality,
  linkedBlock: EntityRecord | null = null,
): readonly GoalShare[] {
  const direct = directGoalShares(record, lookup, quality);
  if (direct.length) return direct;

  if (linkedBlock) {
    const blockShares = directGoalShares(linkedBlock, lookup, quality);
    if (blockShares.length) return blockShares;
  }

  const taskId = asId(record.taskId) ?? (linkedBlock ? asId(linkedBlock.taskId) : null);
  const task = taskId ? lookup.tasks.get(taskId) ?? null : null;
  if (task) {
    const taskShares = directGoalShares(task, lookup, quality);
    if (taskShares.length) return taskShares;
  }

  const projectId = asId(record.projectId)
    ?? (linkedBlock ? asId(linkedBlock.projectId) : null)
    ?? (task ? asId(task.projectId) : null);
  const project = projectId ? lookup.projects.get(projectId) ?? null : null;
  if (project) {
    const projectShares = directGoalShares(project, lookup, quality);
    if (projectShares.length) return projectShares;
  }
  return [{ goalId: null, share: 1 }];
}

function addGoalMinutes(
  target: Map<string | null, number>,
  shares: readonly GoalShare[],
  minutes: number,
): void {
  for (const item of shares) {
    target.set(item.goalId, (target.get(item.goalId) ?? 0) + minutes * item.share);
  }
}

function nextLocalDate(localDate: string): string {
  const [yearRaw, monthRaw, dayRaw] = localDate.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [
    String(next.getUTCFullYear()).padStart(4, '0'),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function splitIntervalByLocalDay(
  interval: Interval,
  totalMinutes: number,
  period: ReportPeriod,
  visit: (localDate: string, minutes: number) => void,
): void {
  const fullMs = interval.end - interval.start;
  if (fullMs <= 0 || totalMinutes <= 0) return;
  for (const localDate of enumeratePeriodDates(period)) {
    const bounds = periodInterval(reportPeriodFromDates(
      'daily',
      localDate,
      nextLocalDate(localDate),
      period.timezone,
    ));
    const overlap = overlapMs(interval, bounds);
    if (overlap > 0) visit(localDate, totalMinutes * overlap / fullMs);
  }
}

function validInterval(
  rawStart: unknown,
  rawEnd: unknown,
  quality: MutableQuality,
): Interval | null {
  const start = instantEpochMilliseconds(rawStart);
  const end = instantEpochMilliseconds(rawEnd);
  if (start === null || end === null) {
    quality.invalidTimestampCount += 1;
    return null;
  }
  if (end <= start || end - start > MAX_INTERVAL_MS) {
    quality.invalidDurationCount += 1;
    return null;
  }
  return { start, end };
}

function parseCompletedSession(
  record: EntityRecord,
  quality: MutableQuality,
): ParsedSession | null {
  const start = instantEpochMilliseconds(record.startTime);
  if (start === null) {
    quality.invalidTimestampCount += 1;
    return null;
  }
  const durationSeconds = asFiniteNumber(record.duration);
  if (durationSeconds !== null && durationSeconds < 0) {
    quality.invalidDurationCount += 1;
    return null;
  }
  const explicitEnd = instantEpochMilliseconds(record.endTime);
  if (record.endTime !== undefined && record.endTime !== null && explicitEnd === null) {
    quality.invalidTimestampCount += 1;
  }
  let end: number | null = explicitEnd;
  let netMinutes: number | null = durationSeconds !== null && durationSeconds >= 0
    ? durationSeconds / 60
    : null;
  if (end === null && netMinutes !== null) end = start + netMinutes * 60_000;
  if (end === null) {
    quality.completedSessionMissingDurationCount += 1;
    return null;
  }
  const wallSeconds = (end - start) / 1_000;
  if (wallSeconds <= 0 || wallSeconds > MAX_INTERVAL_MS / 1_000) {
    quality.invalidDurationCount += 1;
    return null;
  }
  if (netMinutes === null) netMinutes = wallSeconds / 60;
  if (
    netMinutes < 0
    || netMinutes * 60 > wallSeconds + SESSION_DURATION_TOLERANCE_SECONDS
    || netMinutes > MAX_INTERVAL_MS / 60_000
  ) {
    quality.invalidDurationCount += 1;
    return null;
  }
  return {
    record,
    interval: { start, end },
    netMinutes,
    timeBlockId: asId(record.timeBlockId),
  };
}

function addActualSource(
  args: Readonly<{
    interval: Interval;
    fullMinutes: number;
    shares: readonly GoalShare[];
    deepWork: boolean;
    period: ReportPeriod;
    periodBounds: Interval;
    daily: Map<string, MutableDay>;
    actualByGoal: Map<string | null, number>;
    quality: MutableQuality;
  }>,
): Readonly<{ minutes: number; deepMinutes: number }> {
  const fullMs = args.interval.end - args.interval.start;
  const clippedMs = overlapMs(args.interval, args.periodBounds);
  if (fullMs <= 0 || clippedMs <= 0 || args.fullMinutes <= 0) {
    return { minutes: 0, deepMinutes: 0 };
  }
  const minutes = args.fullMinutes * clippedMs / fullMs;
  addGoalMinutes(args.actualByGoal, args.shares, minutes);
  if (args.shares.some((share) => share.goalId === null)) {
    args.quality.unattributedActualMinutes += minutes
      * args.shares.filter((share) => share.goalId === null).reduce((sum, share) => sum + share.share, 0);
  }
  splitIntervalByLocalDay(args.interval, args.fullMinutes, args.period, (localDate, dayMinutes) => {
    const day = args.daily.get(localDate);
    if (day) day.actualMinutes += dayMinutes;
  });
  return { minutes, deepMinutes: args.deepWork ? minutes : 0 };
}

function sessionIsDeepWork(session: EntityRecord, block: EntityRecord | null): boolean {
  const tags = Array.isArray(session.tags)
    ? session.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.toLowerCase())
    : [];
  if (tags.some((tag) => tag === 'deep' || tag === 'deep_work' || tag === 'focus')) return true;
  const type = typeof block?.type === 'string' ? block.type.toLowerCase() : '';
  return type === 'deep' || type === 'focus';
}

function blockIsDeepWork(block: EntityRecord): boolean {
  const type = typeof block.type === 'string' ? block.type.toLowerCase() : '';
  return type === 'deep' || type === 'focus';
}

function productiveBlock(record: EntityRecord): boolean {
  if (record.deleted === true || record.status === 'cancelled') return false;
  return record.type !== 'break' && record.type !== 'buffer';
}

function executedBlock(record: EntityRecord): boolean {
  return record.status === 'completed' || record.status === 'overrun';
}

function initializeDays(period: ReportPeriod): Map<string, MutableDay> {
  return new Map(enumeratePeriodDates(period).map((localDate) => [localDate, {
    plannedMinutes: 0,
    actualMinutes: 0,
    completedBlocks: 0,
    eligibleBlocks: 0,
    completedTasks: 0,
  }]));
}

function initializeTimeBuckets(): Map<TimeOfDayBucket, MutableCompletionBucket> {
  return new Map<TimeOfDayBucket, MutableCompletionBucket>([
    ['night', { completed: 0, eligible: 0, missingCount: 0 }],
    ['morning', { completed: 0, eligible: 0, missingCount: 0 }],
    ['afternoon', { completed: 0, eligible: 0, missingCount: 0 }],
    ['evening', { completed: 0, eligible: 0, missingCount: 0 }],
  ]);
}

function initializeWeekdays(): Map<number, MutableCompletionBucket> {
  return new Map(Array.from({ length: 7 }, (_, index) => [index + 1, {
    completed: 0,
    eligible: 0,
    missingCount: 0,
  }]));
}

function addPlannedInterval(
  block: EntityRecord,
  interval: Interval,
  period: ReportPeriod,
  bounds: Interval,
  daily: Map<string, MutableDay>,
  shares: readonly GoalShare[],
  plannedByGoal: Map<string | null, number>,
): number {
  const clippedMs = overlapMs(interval, bounds);
  if (clippedMs <= 0) return 0;
  const minutes = clippedMs / 60_000;
  addGoalMinutes(plannedByGoal, shares, minutes);
  splitIntervalByLocalDay(interval, (interval.end - interval.start) / 60_000, period, (date, dayMinutes) => {
    const day = daily.get(date);
    if (day) day.plannedMinutes += dayMinutes;
  });
  return minutes;
}

function completedAtForTask(record: EntityRecord, quality: MutableQuality): number | null {
  const explicit = instantEpochMilliseconds(record.completedAt);
  if (explicit !== null) return explicit;
  if (record.status !== 'completed') return null;
  const fallback = instantEpochMilliseconds(record.updatedAt);
  if (fallback !== null) {
    quality.taskCompletionTimestampFallbackCount += 1;
    quality.flags.add('legacy_task_completion_timestamp_fallback');
  }
  return fallback;
}

function localDateInsidePeriod(localDate: string, period: ReportPeriod): boolean {
  return localDate >= period.localStartDate && localDate < period.localEndDate;
}

function calculateHabitAdherence(
  input: ScientificReportInput,
  period: ReportPeriod,
  quality: MutableQuality,
): Readonly<{ expected: number; completed: number }> {
  if (input.records.habitLogs === null) return { expected: 0, completed: 0 };
  const dates = enumeratePeriodDates(period);
  const expectedKeys = new Set<string>();
  const supportedHabits = new Map<string, string>();
  for (const habit of input.records.habits) {
    if (habit.deleted === true || habit.isActive !== true) continue;
    const frequency = typeof habit.frequency === 'string' ? habit.frequency : '';
    if (frequency === 'daily') {
      for (const date of dates) expectedKeys.add(`${habit.id}:${date}`);
      supportedHabits.set(habit.id, frequency);
      continue;
    }
    if (frequency === 'weekly' && period.type === 'weekly') {
      expectedKeys.add(`${habit.id}:${period.localStartDate}`);
      supportedHabits.set(habit.id, frequency);
      continue;
    }
    if (frequency === 'monthly') {
      // A Daily/Weekly source window cannot prove whether the occurrence was
      // completed earlier in the full calendar month. Exclude rather than
      // manufacture a denominator until a full-cadence read is available.
      quality.unsupportedHabitCadenceCount += 1;
      continue;
    }
    quality.unsupportedHabitCadenceCount += 1;
  }

  const completedKeys = new Set<string>();
  const seenLogDates = new Set<string>();
  for (const log of input.records.habitLogs) {
    if (log.completed !== true) continue;
    const habitId = asId(log.habitId);
    const frequency = habitId ? supportedHabits.get(habitId) : null;
    if (!habitId || !frequency) continue;
    const epoch = instantEpochMilliseconds(log.date);
    if (epoch === null) {
      quality.invalidTimestampCount += 1;
      continue;
    }
    const localDate = localDateForEpoch(epoch, period.timezone);
    if (!localDateInsidePeriod(localDate, period)) continue;
    const duplicateKey = `${habitId}:${localDate}`;
    if (seenLogDates.has(duplicateKey)) quality.duplicateHabitLogCount += 1;
    seenLogDates.add(duplicateKey);
    const expectedKey = frequency === 'daily'
      ? duplicateKey
      : frequency === 'weekly'
        ? `${habitId}:${period.localStartDate}`
        : `${habitId}:${localDate.slice(0, 7)}`;
    if (expectedKeys.has(expectedKey)) completedKeys.add(expectedKey);
  }
  return { expected: expectedKeys.size, completed: completedKeys.size };
}

function aggregatePeriod(
  input: ScientificReportInput,
  period: ReportPeriod,
  coverage: ReportSourceCoverage,
  quality: MutableQuality,
): AggregateResult {
  const records = input.records;
  const lookup = makeLookup(records);
  const bounds = periodInterval(period);
  const daily = initializeDays(period);
  const plannedByGoal = new Map<string | null, number>();
  const actualByGoal = new Map<string | null, number>();
  const completionByTimeOfDay = initializeTimeBuckets();
  const completionByWeekday = initializeWeekdays();
  const linkedSessionMinutes = new Map<string, number>();
  const linkedSessionStarts = new Map<string, number>();
  const blocksWithValidSessions = new Set<string>();
  const scheduledTaskIds = new Set<string>();
  let plannedMinutes = 0;
  let actualMinutes = 0;
  let actualSourceCount = 0;
  let deepWorkMinutes = 0;
  let eligibleBlocks = 0;
  let completedBlocks = 0;
  const startDelays: number[] = [];
  let overrunMinutes = 0;
  const estimationAbsoluteErrors: number[] = [];
  let estimationPlannedMinutes = 0;

  // Completed Sessions are the primary execution source. Open/paused Sessions
  // are explicitly excluded and counted as a data-quality signal.
  for (const session of records.sessions ?? []) {
    const start = instantEpochMilliseconds(session.startTime);
    if (session.status !== 'completed') {
      if (start !== null && start >= bounds.start && start < bounds.end) quality.openSessionCount += 1;
      continue;
    }
    const parsed = parseCompletedSession(session, quality);
    if (!parsed) continue;
    if (parsed.timeBlockId) {
      blocksWithValidSessions.add(parsed.timeBlockId);
      linkedSessionMinutes.set(
        parsed.timeBlockId,
        (linkedSessionMinutes.get(parsed.timeBlockId) ?? 0) + parsed.netMinutes,
      );
      const existingStart = linkedSessionStarts.get(parsed.timeBlockId);
      if (existingStart === undefined || parsed.interval.start < existingStart) {
        linkedSessionStarts.set(parsed.timeBlockId, parsed.interval.start);
      }
    }
    const linkedBlock = parsed.timeBlockId ? lookup.blocks.get(parsed.timeBlockId) ?? null : null;
    const shares = resolveGoalShares(session, lookup, quality, linkedBlock);
    const contribution = addActualSource({
      interval: parsed.interval,
      fullMinutes: parsed.netMinutes,
      shares,
      deepWork: sessionIsDeepWork(session, linkedBlock),
      period,
      periodBounds: bounds,
      daily,
      actualByGoal,
      quality,
    });
    actualMinutes += contribution.minutes;
    deepWorkMinutes += contribution.deepMinutes;
    if (overlapMs(parsed.interval, bounds) > 0) actualSourceCount += 1;
  }

  for (const block of records.timeBlocks) {
    if (block.deleted === true) continue;
    const interval = validInterval(block.startTime, block.endTime, quality);
    if (!interval) continue;
    const startsInside = interval.start >= bounds.start && interval.start < bounds.end;
    const shares = resolveGoalShares(block, lookup, quality);

    if (productiveBlock(block)) {
      const planned = addPlannedInterval(
        block,
        interval,
        period,
        bounds,
        daily,
        shares,
        plannedByGoal,
      );
      plannedMinutes += planned;
      if (planned > 0) {
        const taskId = asId(block.taskId);
        if (taskId) scheduledTaskIds.add(taskId);
      }
      if (startsInside) {
        eligibleBlocks += 1;
        const completed = executedBlock(block);
        if (completed) completedBlocks += 1;
        const localDate = localDateForEpoch(interval.start, period.timezone);
        const day = daily.get(localDate);
        if (day) {
          day.eligibleBlocks += 1;
          if (completed) day.completedBlocks += 1;
        }
        const timeBucket = timeOfDayBucket(localHourForEpoch(interval.start, period.timezone));
        const timeStats = completionByTimeOfDay.get(timeBucket);
        if (timeStats) {
          timeStats.eligible += 1;
          if (completed) timeStats.completed += 1;
        }
        const weekday = localWeekdayForEpoch(interval.start, period.timezone);
        const weekdayStats = completionByWeekday.get(weekday);
        if (weekdayStats) {
          weekdayStats.eligible += 1;
          if (completed) weekdayStats.completed += 1;
        }
      }
    }

    // If one or more completed Sessions exist for this block, their sum is the
    // only actual source. Otherwise an explicit actual interval is accepted.
    let measuredActualMinutes = linkedSessionMinutes.get(block.id) ?? null;
    let measuredStart = linkedSessionStarts.get(block.id) ?? null;
    if (!blocksWithValidSessions.has(block.id)) {
      const hasAnyActualField = block.actualStartTime !== undefined || block.actualEndTime !== undefined;
      if (hasAnyActualField) {
        const actualInterval = validInterval(block.actualStartTime, block.actualEndTime, quality);
        if (actualInterval) {
          quality.explicitBlockActualCount += 1;
          measuredActualMinutes = (actualInterval.end - actualInterval.start) / 60_000;
          measuredStart = actualInterval.start;
          const contribution = addActualSource({
            interval: actualInterval,
            fullMinutes: measuredActualMinutes,
            shares,
            deepWork: blockIsDeepWork(block),
            period,
            periodBounds: bounds,
            daily,
            actualByGoal,
            quality,
          });
          actualMinutes += contribution.minutes;
          deepWorkMinutes += contribution.deepMinutes;
          if (overlapMs(actualInterval, bounds) > 0) actualSourceCount += 1;
        }
      } else if (executedBlock(block) && overlapMs(interval, bounds) > 0) {
        quality.blocksMissingActualCount += 1;
      }
    }

    if (startsInside && measuredActualMinutes !== null && measuredStart !== null) {
      const plannedFullMinutes = (interval.end - interval.start) / 60_000;
      startDelays.push((measuredStart - interval.start) / 60_000);
      const error = measuredActualMinutes - plannedFullMinutes;
      estimationAbsoluteErrors.push(Math.abs(error));
      estimationPlannedMinutes += plannedFullMinutes;
      if (error > 0) overrunMinutes += error;
    }
  }

  let plannedTasks = 0;
  let completedPlannedTasks = 0;
  let carryoverTasks = 0;
  for (const task of records.tasks) {
    if (task.deleted === true) continue;
    const dueEpoch = instantEpochMilliseconds(task.dueDate ?? task.deadline);
    const dueLocalDate = dueEpoch === null ? null : localDateForEpoch(dueEpoch, period.timezone);
    const dueInside = dueLocalDate !== null && localDateInsidePeriod(dueLocalDate, period);
    const planned = dueInside || scheduledTaskIds.has(task.id);
    const completedAt = completedAtForTask(task, quality);
    if (completedAt !== null && completedAt >= bounds.start && completedAt < bounds.end) {
      const completedDate = localDateForEpoch(completedAt, period.timezone);
      const day = daily.get(completedDate);
      if (day) day.completedTasks += 1;
    }
    if (!planned) continue;
    plannedTasks += 1;
    const onTimeForDueDate = dueLocalDate === null
      || completedAt !== null && completedAt <= localEndOfDayEpoch(dueLocalDate, period.timezone);
    const fulfilled = completedAt !== null && completedAt < bounds.end && onTimeForDueDate;
    if (fulfilled) completedPlannedTasks += 1;
    else carryoverTasks += 1;
  }

  const habits = calculateHabitAdherence(input, period, quality);
  if (coverage.sessions === 'unavailable') quality.flags.add('sessions_unavailable_actual_is_partial');
  if (coverage.timeBlocks !== 'complete') quality.flags.add('timeblocks_coverage_incomplete');
  if (coverage.tasks !== 'complete') quality.flags.add('tasks_coverage_incomplete');
  if (coverage.habitLogs !== 'complete') quality.flags.add('habit_logs_coverage_incomplete');

  return {
    plannedMinutes,
    actualMinutes,
    actualSourceCount,
    deepWorkMinutes,
    eligibleBlocks,
    completedBlocks,
    plannedTasks,
    completedPlannedTasks,
    carryoverTasks,
    startDelays,
    overrunMinutes,
    estimationAbsoluteErrors,
    estimationPlannedMinutes,
    daily,
    plannedByGoal,
    actualByGoal,
    completionByTimeOfDay,
    completionByWeekday,
    habitExpected: habits.expected,
    habitCompleted: habits.completed,
  };
}

function completionBuckets<Key extends string | number>(
  values: ReadonlyMap<Key, MutableCompletionBucket>,
  label: (key: Key) => string,
): readonly CompletionBucketMetric[] {
  return Array.from(values.entries()).map(([key, item]) => ({
    key: String(key),
    label: label(key),
    completed: item.completed,
    eligible: item.eligible,
    completionPercent: percentage(item.completed, item.eligible),
    missingCount: item.missingCount,
  }));
}

function goalAllocations(
  input: ScientificReportInput,
  period: ReportPeriod,
  aggregate: AggregateResult,
  actualAvailability: MetricAvailability,
  actualKnown: boolean,
): readonly GoalAllocationMetric[] {
  const goalById = new Map(input.records.goals.map((goal) => [goal.id, goal]));
  const ids = new Set<string | null>([
    ...aggregate.plannedByGoal.keys(),
    ...aggregate.actualByGoal.keys(),
  ]);
  for (const goal of input.records.goals) {
    const targetHours = asFiniteNumber(goal.timeAllocationTarget);
    if (targetHours !== null && targetHours > 0) ids.add(goal.id);
  }
  const plannedTotal = aggregate.plannedMinutes;
  const actualTotal = actualKnown ? aggregate.actualMinutes : 0;
  return Array.from(ids).map((goalId) => {
    const goal = goalId ? goalById.get(goalId) ?? null : null;
    const targetHours = goal ? asFiniteNumber(goal.timeAllocationTarget) : null;
    const targetMinutes = targetHours !== null && targetHours >= 0 && targetHours <= 168
      ? targetHours * 60 * period.dayCount / 7
      : null;
    const planned = aggregate.plannedByGoal.get(goalId) ?? 0;
    const actual = actualKnown ? aggregate.actualByGoal.get(goalId) ?? 0 : null;
    return {
      goalId,
      label: goalId === null
        ? 'Unassigned'
        : sanitizeLabel(goal?.title, 'Untitled goal'),
      labelIsUntrustedData: true as const,
      targetMinutes: targetMinutes === null ? null : round(targetMinutes),
      plannedMinutes: round(planned),
      actualMinutes: actual === null ? null : round(actual),
      actualAvailability,
      plannedSharePercent: percentage(planned, plannedTotal),
      actualSharePercent: actual === null ? null : percentage(actual, actualTotal),
    };
  }).sort((left, right) => {
    if ((left.goalId === null) !== (right.goalId === null)) return left.goalId === null ? 1 : -1;
    return (right.actualMinutes ?? 0) - (left.actualMinutes ?? 0)
      || right.plannedMinutes - left.plannedMinutes
      || String(left.goalId).localeCompare(String(right.goalId));
  });
}

function goalAlignment(
  allocations: readonly GoalAllocationMetric[],
  actualAvailability: MetricAvailability,
): ScientificMetric {
  const targetTotal = allocations.reduce((sum, item) => sum + (item.targetMinutes ?? 0), 0);
  const actualTotal = allocations.reduce((sum, item) => sum + (item.actualMinutes ?? 0), 0);
  if (targetTotal <= 0 || actualTotal <= 0 || actualAvailability === 'unavailable') {
    return metric({
      id: 'goal_alignment_index',
      value: null,
      unit: 'index',
      availability: 'unavailable',
      sampleSize: allocations.filter((item) => item.targetMinutes !== null).length,
      formula: '100 × (1 − 0.5 × Σ|actual_share − target_share|)',
      source: 'goal.timeAllocationTarget and deterministic actual goal attribution',
    });
  }
  const distance = allocations.reduce((sum, item) => {
    const targetShare = (item.targetMinutes ?? 0) / targetTotal;
    const actualShare = (item.actualMinutes ?? 0) / actualTotal;
    return sum + Math.abs(targetShare - actualShare);
  }, 0);
  return metric({
    id: 'goal_alignment_index',
    value: Math.max(0, Math.min(100, (1 - distance / 2) * 100)),
    unit: 'index',
    availability: actualAvailability,
    numerator: actualTotal,
    denominator: targetTotal,
    sampleSize: allocations.length,
    formula: '100 × (1 − 0.5 × Σ|actual_share − target_share|)',
    source: 'goal.timeAllocationTarget and deterministic actual goal attribution',
  });
}

function executionIndex(
  reportType: ScientificReportInput['reportType'],
  metrics: Readonly<{
    planned: ScientificMetric;
    actual: ScientificMetric;
    blockCompletion: ScientificMetric;
    taskCompletion: ScientificMetric;
    habitAdherence: ScientificMetric;
  }>,
): ScientificMetric {
  if (reportType !== 'weekly') {
    return metric({
      id: 'weekly_execution_index',
      value: null,
      unit: 'index',
      availability: 'unavailable',
      formula: 'Weighted normalized composite; weekly reports only',
      source: 'deterministic weekly components',
    });
  }
  const components: Array<Readonly<{ weight: number; value: number; availability: MetricAvailability; sample: number }>> = [];
  if (
    metrics.planned.value !== null
    && metrics.planned.value > 0
    && metrics.actual.value !== null
  ) {
    components.push({
      weight: 0.30,
      value: Math.min(100, metrics.actual.value / metrics.planned.value * 100),
      availability: worstAvailability(metrics.planned.availability, metrics.actual.availability),
      sample: metrics.actual.sampleSize,
    });
  }
  if (metrics.blockCompletion.value !== null) {
    components.push({ weight: 0.40, value: metrics.blockCompletion.value, availability: metrics.blockCompletion.availability, sample: metrics.blockCompletion.sampleSize });
  }
  if (metrics.taskCompletion.value !== null) {
    components.push({ weight: 0.20, value: metrics.taskCompletion.value, availability: metrics.taskCompletion.availability, sample: metrics.taskCompletion.sampleSize });
  }
  if (metrics.habitAdherence.value !== null) {
    components.push({ weight: 0.10, value: metrics.habitAdherence.value, availability: metrics.habitAdherence.availability, sample: metrics.habitAdherence.sampleSize });
  }
  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  if (components.length < 2 || totalWeight <= 0) {
    return metric({
      id: 'weekly_execution_index',
      value: null,
      unit: 'index',
      availability: 'unavailable',
      sampleSize: components.reduce((sum, item) => sum + item.sample, 0),
      formula: '30% capped time fulfillment + 40% block completion + 20% task fulfillment + 10% habit adherence; available components renormalized',
      source: 'deterministic weekly metric components',
    });
  }
  return metric({
    id: 'weekly_execution_index',
    value: components.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight,
    unit: 'index',
    availability: components.some((item) => item.availability !== 'available') ? 'partial' : 'available',
    sampleSize: components.reduce((sum, item) => sum + item.sample, 0),
    formula: '30% capped time fulfillment + 40% block completion + 20% task fulfillment + 10% habit adherence; available components renormalized',
    source: 'deterministic weekly metric components',
  });
}

function buildDataQuality(
  coverage: ReportSourceCoverage,
  quality: MutableQuality,
): ReportDataQuality {
  for (const [name, status] of Object.entries(coverage)) {
    if (status !== 'complete') quality.flags.add(`${name}_${status}`);
  }
  quality.flags.add('schedule_history_unavailable');
  if (quality.invalidTimestampCount > 0) quality.flags.add('invalid_timestamps_excluded');
  if (quality.invalidDurationCount > 0) quality.flags.add('invalid_durations_excluded');
  if (quality.openSessionCount > 0) quality.flags.add('open_sessions_excluded');
  if (quality.completedSessionMissingDurationCount > 0) {
    quality.flags.add('completed_sessions_missing_duration');
  }
  if (quality.blocksMissingActualCount > 0) quality.flags.add('completed_blocks_missing_actual');
  if (quality.missingGoalReferenceCount > 0) quality.flags.add('missing_goal_references');
  if (quality.duplicateHabitLogCount > 0) quality.flags.add('duplicate_habit_logs_deduplicated');
  if (quality.unsupportedHabitCadenceCount > 0) {
    quality.flags.add('monthly_or_out_of_scope_habit_cadence_excluded');
  }
  return {
    coverage,
    complete: Object.values(coverage).every((value) => value === 'complete')
      && quality.invalidTimestampCount === 0
      && quality.invalidDurationCount === 0
      && quality.completedSessionMissingDurationCount === 0
      && quality.blocksMissingActualCount === 0
      && quality.openSessionCount === 0
      && quality.taskCompletionTimestampFallbackCount === 0
      && quality.missingGoalReferenceCount === 0
      && quality.unsupportedHabitCadenceCount === 0,
    flags: Array.from(quality.flags).sort(),
    invalidTimestampCount: quality.invalidTimestampCount,
    invalidDurationCount: quality.invalidDurationCount,
    openSessionCount: quality.openSessionCount,
    completedSessionMissingDurationCount: quality.completedSessionMissingDurationCount,
    explicitBlockActualCount: quality.explicitBlockActualCount,
    blocksMissingActualCount: quality.blocksMissingActualCount,
    taskCompletionTimestampFallbackCount: quality.taskCompletionTimestampFallbackCount,
    unattributedActualMinutes: round(quality.unattributedActualMinutes),
    missingGoalReferenceCount: quality.missingGoalReferenceCount,
    duplicateHabitLogCount: quality.duplicateHabitLogCount,
    unsupportedHabitCadenceCount: quality.unsupportedHabitCadenceCount,
    scheduleHistoryAvailable: false,
    actualSource: 'completed_sessions_and_explicit_actual_intervals',
    missingSessionsAreZero: false,
  };
}

function trendPoints(
  input: ScientificReportInput,
  coverage: ReportSourceCoverage,
  period: ReportPeriod,
  actualAvailability: MetricAvailability,
): readonly FourWeekTrendPoint[] {
  return fourWeekPeriods(period).map((week) => {
    const result = aggregatePeriod(input, week, coverage, emptyQuality());
    return {
      weekStartDate: week.localStartDate,
      weekEndDate: week.localEndDate,
      plannedMinutes: round(result.plannedMinutes),
      actualMinutes: actualAvailability === 'available' || result.actualSourceCount > 0
        ? round(result.actualMinutes)
        : null,
      actualAvailability,
      adherencePercent: actualAvailability === 'available' || result.actualSourceCount > 0
        ? percentage(result.actualMinutes, result.plannedMinutes)
        : null,
      blockCompletionPercent: percentage(result.completedBlocks, result.eligibleBlocks),
    };
  });
}

export function computeScientificMetricBundle(
  input: ScientificReportInput,
  period: ReportPeriod,
): ScientificMetricBundle {
  const quality = emptyQuality();
  if (period.timezone !== input.timezone) quality.flags.add('timezone_fallback_applied');
  const coverage = normalizeCoverage(input, quality);
  const aggregate = aggregatePeriod(input, period, coverage, quality);
  const plannedAvailability = degradeAvailability(
    datasetAvailability(coverage.timeBlocks),
    quality.invalidTimestampCount > 0 || quality.invalidDurationCount > 0,
  );
  const actualAvailability = degradeAvailability(
    datasetAvailability(coverage.sessions, coverage.timeBlocks),
    quality.invalidTimestampCount > 0
      || quality.invalidDurationCount > 0
      || quality.completedSessionMissingDurationCount > 0
      || quality.blocksMissingActualCount > 0
      || quality.openSessionCount > 0,
  );
  const taskAvailability = degradeAvailability(
    datasetAvailability(coverage.tasks, coverage.timeBlocks),
    quality.taskCompletionTimestampFallbackCount > 0,
  );
  const habitAvailability = datasetAvailability(coverage.habits, coverage.habitLogs);
  const goalAvailability = datasetAvailability(
    coverage.goals,
    coverage.projects,
    coverage.tasks,
    coverage.timeBlocks,
    coverage.sessions,
  );
  const plannedValue = plannedAvailability === 'unavailable' ? null : aggregate.plannedMinutes;
  const actualValue = actualAvailability === 'available' || aggregate.actualSourceCount > 0
    ? aggregate.actualMinutes
    : null;

  const planned = metric({
    id: 'planned_minutes',
    value: plannedValue,
    unit: 'minutes',
    availability: plannedAvailability,
    numerator: plannedValue,
    sampleSize: aggregate.eligibleBlocks,
    missingCount: quality.invalidTimestampCount + quality.invalidDurationCount,
    formula: 'Σ eligible TimeBlock overlap minutes in [period.from, period.to)',
    source: 'authoritative TimeBlocks; deleted/cancelled/break/buffer excluded',
  });
  const actual = metric({
    id: 'actual_minutes',
    value: actualValue,
    unit: 'minutes',
    availability: actualAvailability,
    numerator: actualValue,
    sampleSize: aggregate.actualSourceCount,
    missingCount: quality.completedSessionMissingDurationCount + quality.blocksMissingActualCount,
    formula: 'Σ completed Session net minutes + explicit block actual intervals only when no valid linked Session exists',
    source: 'persisted Sessions and explicit actualStartTime/actualEndTime; planned windows are never actual fallback',
  });
  const adherenceAvailability = plannedValue !== null && plannedValue > 0 && actualValue !== null
    ? worstAvailability(plannedAvailability, actualAvailability)
    : 'unavailable';
  const adherence = metric({
    id: 'adherence_percent',
    value: plannedValue !== null && actualValue !== null ? percentage(actualValue, plannedValue) : null,
    unit: 'percent',
    availability: adherenceAvailability,
    numerator: actualValue,
    denominator: plannedValue,
    sampleSize: aggregate.eligibleBlocks,
    missingCount: actual.missingCount,
    formula: 'actual_minutes ÷ planned_minutes × 100; null when planned_minutes = 0',
    source: 'deterministic planned and actual metrics',
  });
  const variance = metric({
    id: 'variance_minutes',
    value: plannedValue !== null && actualValue !== null ? actualValue - plannedValue : null,
    unit: 'minutes',
    availability: plannedValue !== null && actualValue !== null
      ? worstAvailability(plannedAvailability, actualAvailability)
      : 'unavailable',
    numerator: actualValue,
    denominator: plannedValue,
    sampleSize: aggregate.eligibleBlocks,
    missingCount: actual.missingCount,
    formula: 'actual_minutes − planned_minutes',
    source: 'deterministic planned and actual metrics',
  });
  const blockCompletion = metric({
    id: 'timeblock_completion_percent',
    value: percentage(aggregate.completedBlocks, aggregate.eligibleBlocks),
    unit: 'percent',
    availability: aggregate.eligibleBlocks > 0 ? plannedAvailability : 'unavailable',
    numerator: aggregate.completedBlocks,
    denominator: aggregate.eligibleBlocks,
    sampleSize: aggregate.eligibleBlocks,
    formula: 'completed-or-overrun productive blocks starting in period ÷ eligible productive blocks starting in period × 100',
    source: 'authoritative TimeBlock status',
  });
  const taskCompletion = metric({
    id: 'task_completion_percent',
    value: percentage(aggregate.completedPlannedTasks, aggregate.plannedTasks),
    unit: 'percent',
    availability: aggregate.plannedTasks > 0 ? taskAvailability : 'unavailable',
    numerator: aggregate.completedPlannedTasks,
    denominator: aggregate.plannedTasks,
    sampleSize: aggregate.plannedTasks,
    missingCount: quality.taskCompletionTimestampFallbackCount,
    formula: 'planned tasks fulfilled by period end (and by local due-day end when due in period) ÷ planned tasks × 100',
    source: 'Task dueDate/completedAt plus TimeBlock task linkage; legacy updatedAt fallback is flagged',
  });
  const deepWork = metric({
    id: 'deep_work_minutes',
    value: actualValue === null ? null : aggregate.deepWorkMinutes,
    unit: 'minutes',
    availability: actualAvailability,
    numerator: actualValue === null ? null : aggregate.deepWorkMinutes,
    sampleSize: actual.sampleSize,
    missingCount: actual.missingCount,
    formula: 'actual minutes with Session tag deep/deep_work/focus or linked TimeBlock type deep/focus',
    source: 'completed Sessions and explicit actual intervals',
  });
  const habitAdherence = metric({
    id: 'habit_adherence_percent',
    value: percentage(aggregate.habitCompleted, aggregate.habitExpected),
    unit: 'percent',
    availability: aggregate.habitExpected > 0 ? habitAvailability : 'unavailable',
    numerator: aggregate.habitCompleted,
    denominator: aggregate.habitExpected,
    sampleSize: aggregate.habitExpected,
    missingCount: 0,
    formula: 'unique completed expected habit occurrences ÷ expected occurrences × 100; duplicates cannot inflate numerator',
    source: 'active Habits and completed HabitLogs in persisted timezone',
  });
  const carryover = metric({
    id: 'carryover_tasks',
    value: aggregate.carryoverTasks,
    unit: 'count',
    availability: taskAvailability,
    numerator: aggregate.carryoverTasks,
    denominator: aggregate.plannedTasks,
    sampleSize: aggregate.plannedTasks,
    missingCount: quality.taskCompletionTimestampFallbackCount,
    formula: 'planned tasks not fulfilled by period end, including late/cancelled/open outcomes',
    source: 'Task due/completion and TimeBlock linkage',
  });
  const delayMean = aggregate.startDelays.length
    ? aggregate.startDelays.reduce((sum, value) => sum + value, 0) / aggregate.startDelays.length
    : null;
  const startDelay = metric({
    id: 'start_delay_mean_minutes',
    value: delayMean,
    unit: 'minutes',
    availability: delayMean === null ? 'unavailable' : actualAvailability,
    numerator: delayMean === null ? null : aggregate.startDelays.reduce((sum, value) => sum + value, 0),
    denominator: aggregate.startDelays.length,
    sampleSize: aggregate.startDelays.length,
    missingCount: Math.max(0, aggregate.completedBlocks - aggregate.startDelays.length),
    formula: 'mean(earliest measured actual start − planned start) for measurable blocks starting in period',
    source: 'earliest linked completed Session start, else explicit block actualStartTime',
  });
  const overrun = metric({
    id: 'overrun_minutes',
    value: aggregate.estimationAbsoluteErrors.length ? aggregate.overrunMinutes : null,
    unit: 'minutes',
    availability: aggregate.estimationAbsoluteErrors.length ? actualAvailability : 'unavailable',
    numerator: aggregate.estimationAbsoluteErrors.length ? aggregate.overrunMinutes : null,
    sampleSize: aggregate.estimationAbsoluteErrors.length,
    missingCount: Math.max(0, aggregate.completedBlocks - aggregate.estimationAbsoluteErrors.length),
    formula: 'Σ max(0, measured block actual minutes − planned block minutes)',
    source: 'linked completed Sessions or explicit block actual interval',
  });
  const absoluteErrorTotal = aggregate.estimationAbsoluteErrors.reduce((sum, value) => sum + value, 0);
  const estimationAbsolute = metric({
    id: 'estimation_error_mean_absolute_minutes',
    value: aggregate.estimationAbsoluteErrors.length
      ? absoluteErrorTotal / aggregate.estimationAbsoluteErrors.length
      : null,
    unit: 'minutes',
    availability: aggregate.estimationAbsoluteErrors.length ? actualAvailability : 'unavailable',
    numerator: aggregate.estimationAbsoluteErrors.length ? absoluteErrorTotal : null,
    denominator: aggregate.estimationAbsoluteErrors.length,
    sampleSize: aggregate.estimationAbsoluteErrors.length,
    missingCount: Math.max(0, aggregate.completedBlocks - aggregate.estimationAbsoluteErrors.length),
    formula: 'mean(|measured block actual minutes − planned block minutes|)',
    source: 'measurable blocks starting in period',
  });
  const estimationPercent = metric({
    id: 'estimation_error_percent',
    value: percentage(absoluteErrorTotal, aggregate.estimationPlannedMinutes),
    unit: 'percent',
    availability: aggregate.estimationPlannedMinutes > 0 ? actualAvailability : 'unavailable',
    numerator: absoluteErrorTotal,
    denominator: aggregate.estimationPlannedMinutes,
    sampleSize: aggregate.estimationAbsoluteErrors.length,
    missingCount: estimationAbsolute.missingCount,
    formula: 'Σ|actual − planned| ÷ Σ planned × 100 across measurable blocks',
    source: 'measurable blocks starting in period',
  });
  const capacityMinutes = input.reportType === 'weekly'
    ? input.preferences.maxWeeklyPlannedMinutes
    : input.preferences.maxDailyPlannedMinutes;
  const capacity = metric({
    id: 'capacity_utilization_percent',
    value: plannedValue === null ? null : percentage(plannedValue, capacityMinutes),
    unit: 'percent',
    availability: plannedValue === null ? 'unavailable' : plannedAvailability,
    numerator: plannedValue,
    denominator: capacityMinutes,
    sampleSize: aggregate.eligibleBlocks,
    formula: 'planned_minutes ÷ persisted report-period planning capacity × 100',
    source: `UserPlanningPreferences.${input.reportType === 'weekly' ? 'maxWeeklyPlannedMinutes' : 'maxDailyPlannedMinutes'} (${input.preferences.source})`,
  });
  const allocations = goalAllocations(
    input,
    period,
    aggregate,
    actualAvailability,
    actualValue !== null,
  );
  const alignment = goalAlignment(allocations, worstAvailability(goalAvailability, actualAvailability));
  const weeklyIndex = executionIndex(input.reportType, {
    planned,
    actual,
    blockCompletion,
    taskCompletion,
    habitAdherence,
  });
  const scheduleVolatility = metric({
    id: 'schedule_volatility',
    value: null,
    unit: 'count',
    availability: 'unavailable',
    formula: 'Requires persisted schedule-version/reschedule history; current entity schema has no defensible denominator',
    source: 'NOT AVAILABLE — updatedAt is not treated as reschedule evidence',
  });
  const dataQuality = buildDataQuality(coverage, quality);
  const daily: DailyMetricPoint[] = Array.from(aggregate.daily.entries()).map(([localDate, item]) => ({
    localDate,
    plannedMinutes: round(item.plannedMinutes),
    actualMinutes: actualValue === null ? null : round(item.actualMinutes),
    actualAvailability,
    completedBlocks: item.completedBlocks,
    eligibleBlocks: item.eligibleBlocks,
    completedTasks: item.completedTasks,
  }));
  const timeBuckets = completionBuckets(
    aggregate.completionByTimeOfDay,
    (key) => String(key).replace(/^./, (letter) => letter.toUpperCase()),
  );
  const weekdayBuckets = completionBuckets(
    aggregate.completionByWeekday,
    (key) => weekdayLabel(Number(key)),
  );
  const fourWeekTrend = trendPoints(input, coverage, period, actualAvailability);
  const deterministicContent = {
    schemaVersion: REPORT_METRIC_SCHEMA_VERSION,
    formulaVersion: REPORT_FORMULA_VERSION,
    period,
    plannedMinutes: planned,
    actualMinutes: actual,
    adherencePercent: adherence,
    varianceMinutes: variance,
    taskCompletionPercent: taskCompletion,
    timeBlockCompletionPercent: blockCompletion,
    goalAlignmentIndex: alignment,
    deepWorkMinutes: deepWork,
    habitAdherencePercent: habitAdherence,
    carryoverTasks: carryover,
    startDelayMeanMinutes: startDelay,
    overrunMinutes: overrun,
    estimationErrorMeanAbsoluteMinutes: estimationAbsolute,
    estimationErrorPercent: estimationPercent,
    capacityUtilizationPercent: capacity,
    weeklyExecutionIndex: weeklyIndex,
    scheduleVolatility,
    daily,
    goalAllocation: allocations,
    completionByTimeOfDay: timeBuckets,
    completionByWeekday: weekdayBuckets,
    fourWeekTrend,
    dataQuality,
  } as const;
  return {
    ...deterministicContent,
    metricHash: createHash('sha256').update(canonicalJson(deterministicContent)).digest('hex'),
  };
}
