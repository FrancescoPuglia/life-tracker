import type { Note, Session, TimeBlock } from '@/types';

const MAX_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const SESSION_DURATION_TOLERANCE_SECONDS = 5;
const DAY_SEARCH_RADIUS_MS = 36 * 60 * 60 * 1_000;
const QUICK_CAPTURE_MAX_LENGTH = 1_000;

export type TodaySessionCoverage = 'loading' | 'ready' | 'error';
export type TodayActualAvailability =
  | 'loading'
  | 'complete'
  | 'partial'
  | 'unavailable';

export interface LocalDayBounds {
  readonly localDate: string;
  readonly timezone: string;
  readonly start: number;
  readonly end: number;
}

export interface TodayExecutionMetrics {
  readonly localDate: string;
  readonly active: TimeBlock | undefined;
  readonly next: TimeBlock | undefined;
  readonly upcoming: readonly TimeBlock[];
  readonly plannedMinutes: number;
  readonly actualMinutes: number | null;
  readonly adherencePct: number | null;
  readonly actualAvailability: TodayActualAvailability;
  readonly completedSessionCount: number;
  readonly explicitActualBlockCount: number;
  readonly blocksMissingActualCount: number;
  readonly openSessionCount: number;
  readonly invalidActualSourceCount: number;
  readonly invalidPlannedBlockCount: number;
}

export interface TodayExecutionInput {
  readonly now: Date;
  readonly ownerUid: string;
  readonly timezone: string;
  readonly timeBlocks: ReadonlyArray<TimeBlock>;
  readonly sessions: ReadonlyArray<Session>;
  readonly sessionCoverage: TodaySessionCoverage;
}

interface Interval {
  readonly start: number;
  readonly end: number;
}

interface ParsedSession {
  readonly interval: Interval;
  readonly netMinutes: number;
  readonly timeBlockId: string | null;
}

export function resolveLocalDayBounds(now: Date, timezone: string): LocalDayBounds {
  const nowEpoch = dateEpoch(now);
  if (nowEpoch === null) throw new Error('Today reference time is invalid.');
  const formatter = localDateFormatter(timezone);
  const localDate = localDateKey(nowEpoch, formatter);
  const low = nowEpoch - DAY_SEARCH_RADIUS_MS;
  const high = nowEpoch + DAY_SEARCH_RADIUS_MS;
  const start = firstEpoch(low, high, (epoch) => localDateKey(epoch, formatter) >= localDate);
  const end = firstEpoch(low, high, (epoch) => localDateKey(epoch, formatter) > localDate);
  if (
    localDateKey(start, formatter) !== localDate
    || end <= start
    || end - start < 22 * 60 * 60 * 1_000
    || end - start > 26 * 60 * 60 * 1_000
  ) {
    throw new Error('Today timezone boundary could not be resolved.');
  }
  return Object.freeze({ localDate, timezone, start, end });
}

export function computeTodayExecutionMetrics(
  input: TodayExecutionInput,
): TodayExecutionMetrics {
  if (!input.ownerUid) throw new Error('Today metrics require an authenticated owner.');
  const bounds = resolveLocalDayBounds(input.now, input.timezone);
  const nowEpoch = dateEpoch(input.now);
  if (nowEpoch === null) throw new Error('Today reference time is invalid.');

  let plannedMinutes = 0;
  let invalidPlannedBlockCount = 0;
  const eligibleBlocks: Array<Readonly<{ block: TimeBlock; interval: Interval }>> = [];
  const scheduledIntervals = new Map<string, Interval>();
  const ownerBlocks = input.timeBlocks.filter((block) => (
    block.userId === input.ownerUid && block.deleted !== true
  ));

  for (const block of ownerBlocks) {
    const interval = validInterval(block.startTime, block.endTime);
    if (!interval) {
      const start = dateEpoch(block.startTime);
      if (start !== null && start >= bounds.start && start < bounds.end) {
        invalidPlannedBlockCount += 1;
      }
      continue;
    }
    scheduledIntervals.set(block.id, interval);
    if (overlapMs(interval, bounds) <= 0) continue;
    eligibleBlocks.push({ block, interval });
    if (productiveBlock(block)) {
      plannedMinutes += overlapMs(interval, bounds) / 60_000;
    }
  }

  const commitments = eligibleBlocks
    .filter(({ block }) => block.status !== 'cancelled')
    .sort((left, right) => left.interval.start - right.interval.start);
  const active = commitments.find(({ block, interval }) => (
    block.status !== 'completed'
    && interval.start <= nowEpoch
    && interval.end > nowEpoch
  ))?.block;
  const upcoming = commitments
    .filter(({ block, interval }) => block.status !== 'completed' && interval.start > nowEpoch)
    .map(({ block }) => block);

  if (input.sessionCoverage !== 'ready') {
    return Object.freeze({
      localDate: bounds.localDate,
      active,
      next: upcoming[0],
      upcoming: Object.freeze(upcoming),
      plannedMinutes: Math.round(plannedMinutes),
      actualMinutes: null,
      adherencePct: null,
      actualAvailability: input.sessionCoverage === 'loading' ? 'loading' : 'unavailable',
      completedSessionCount: 0,
      explicitActualBlockCount: 0,
      blocksMissingActualCount: 0,
      openSessionCount: 0,
      invalidActualSourceCount: 0,
      invalidPlannedBlockCount,
    });
  }

  let actualMinutes = 0;
  let completedSessionCount = 0;
  let openSessionCount = 0;
  let invalidActualSourceCount = 0;
  let explicitActualBlockCount = 0;
  let blocksMissingActualCount = 0;
  const blocksWithValidSessions = new Set<string>();

  for (const session of input.sessions) {
    if (session.userId !== input.ownerUid || session.deleted === true) continue;
    const sessionStart = dateEpoch(session.startTime);
    if (session.status !== 'completed') {
      if (sessionStart !== null && sessionStart >= bounds.start && sessionStart < bounds.end) {
        openSessionCount += 1;
      }
      continue;
    }
    const parsed = parseCompletedSession(session);
    if (!parsed) {
      if (sessionStart !== null && sessionStart >= bounds.start && sessionStart < bounds.end) {
        invalidActualSourceCount += 1;
      }
      continue;
    }
    if (parsed.timeBlockId) blocksWithValidSessions.add(parsed.timeBlockId);
    const overlap = overlapMs(parsed.interval, bounds);
    if (overlap <= 0) continue;
    const wallMs = parsed.interval.end - parsed.interval.start;
    actualMinutes += parsed.netMinutes * overlap / wallMs;
    completedSessionCount += 1;
  }

  for (const block of ownerBlocks) {
    if (blocksWithValidSessions.has(block.id)) continue;
    const scheduled = scheduledIntervals.get(block.id) ?? null;
    const scheduledOverlapsToday = scheduled !== null && overlapMs(scheduled, bounds) > 0;
    const hasAnyActualField = block.actualStartTime !== undefined || block.actualEndTime !== undefined;
    let validExplicitActual = false;
    if (hasAnyActualField) {
      const actual = validInterval(block.actualStartTime, block.actualEndTime);
      if (actual) {
        validExplicitActual = true;
        const overlap = overlapMs(actual, bounds);
        if (overlap > 0) {
          actualMinutes += overlap / 60_000;
          explicitActualBlockCount += 1;
        }
      } else {
        const actualStart = dateEpoch(block.actualStartTime);
        if (
          scheduledOverlapsToday
          || (actualStart !== null && actualStart >= bounds.start && actualStart < bounds.end)
        ) {
          invalidActualSourceCount += 1;
        }
      }
    }
    if (
      scheduledOverlapsToday
      && productiveBlock(block)
      && executedBlock(block)
      && !validExplicitActual
    ) {
      blocksMissingActualCount += 1;
    }
  }

  const actualAvailability: TodayActualAvailability =
    blocksMissingActualCount > 0
    || openSessionCount > 0
    || invalidActualSourceCount > 0
    || invalidPlannedBlockCount > 0
      ? 'partial'
      : 'complete';
  const adherencePct = actualAvailability === 'complete' && plannedMinutes > 0
    ? actualMinutes / plannedMinutes * 100
    : null;

  return Object.freeze({
    localDate: bounds.localDate,
    active,
    next: upcoming[0],
    upcoming: Object.freeze(upcoming),
    plannedMinutes: Math.round(plannedMinutes),
    actualMinutes: Math.round(actualMinutes),
    adherencePct,
    actualAvailability,
    completedSessionCount,
    explicitActualBlockCount,
    blocksMissingActualCount,
    openSessionCount,
    invalidActualSourceCount,
    invalidPlannedBlockCount,
  });
}

export function buildQuickCaptureNote(
  rawText: string,
): Pick<Note, 'entityType' | 'title' | 'docJson' | 'tags' | 'isPinned'> {
  if (typeof rawText !== 'string') throw new Error('Quick capture text is invalid.');
  const text = rawText.replace(/\r\n?/g, '\n').trim();
  if (
    text.length < 1
    || text.length > QUICK_CAPTURE_MAX_LENGTH
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)
  ) {
    throw new Error('Quick capture text is invalid.');
  }
  const titleSource = text.split('\n').find((line) => line.trim().length > 0) ?? 'Quick capture';
  const title = Array.from(titleSource.trim()).slice(0, 80).join('');
  const content = text.split('\n').map((line) => ({
    type: 'paragraph',
    ...(line.length > 0 ? { content: [{ type: 'text', text: line }] } : {}),
  }));
  return Object.freeze({
    entityType: 'global',
    title,
    docJson: { type: 'doc', content },
    tags: ['quick-capture'],
    isPinned: false,
  });
}

export function completedSessionNetMinutes(session: Session): number | null {
  if (session.status !== 'completed' || session.deleted === true) return null;
  return parseCompletedSession(session)?.netMinutes ?? null;
}

function productiveBlock(block: TimeBlock): boolean {
  return block.status !== 'cancelled' && block.type !== 'break' && block.type !== 'buffer';
}

function executedBlock(block: TimeBlock): boolean {
  return block.status === 'completed' || block.status === 'overrun';
}

function parseCompletedSession(session: Session): ParsedSession | null {
  const start = dateEpoch(session.startTime);
  if (start === null) return null;
  const durationSeconds = typeof session.duration === 'number' && Number.isFinite(session.duration)
    ? session.duration
    : null;
  if (durationSeconds !== null && durationSeconds < 0) return null;
  const explicitEnd = dateEpoch(session.endTime);
  let end = explicitEnd;
  let netMinutes = durationSeconds === null ? null : durationSeconds / 60;
  if (end === null && netMinutes !== null) end = start + netMinutes * 60_000;
  if (end === null) return null;
  const wallSeconds = (end - start) / 1_000;
  if (wallSeconds <= 0 || wallSeconds > MAX_INTERVAL_MS / 1_000) return null;
  if (netMinutes === null) netMinutes = wallSeconds / 60;
  if (
    netMinutes < 0
    || netMinutes * 60 > wallSeconds + SESSION_DURATION_TOLERANCE_SECONDS
    || netMinutes > MAX_INTERVAL_MS / 60_000
  ) {
    return null;
  }
  return {
    interval: { start, end },
    netMinutes,
    timeBlockId: typeof session.timeBlockId === 'string' && session.timeBlockId.length > 0
      ? session.timeBlockId
      : null,
  };
}

function validInterval(rawStart: unknown, rawEnd: unknown): Interval | null {
  const start = dateEpoch(rawStart);
  const end = dateEpoch(rawEnd);
  if (start === null || end === null || end <= start || end - start > MAX_INTERVAL_MS) {
    return null;
  }
  return { start, end };
}

function dateEpoch(value: unknown): number | null {
  if (!(value instanceof Date)) return null;
  const epoch = value.getTime();
  return Number.isFinite(epoch) ? epoch : null;
}

function overlapMs(left: Interval, right: Pick<LocalDayBounds, 'start' | 'end'>): number {
  return Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
}

function localDateFormatter(timezone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
      timeZone: timezone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    throw new Error('Today timezone is invalid.');
  }
}

function localDateKey(epoch: number, formatter: Intl.DateTimeFormat): string {
  const values = new Map(
    formatter.formatToParts(new Date(epoch)).map((part) => [part.type, part.value]),
  );
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  if (!year || !month || !day) throw new Error('Today timezone is invalid.');
  return `${year}-${month}-${day}`;
}

function firstEpoch(
  rawLow: number,
  rawHigh: number,
  predicate: (epoch: number) => boolean,
): number {
  let low = Math.floor(rawLow);
  let high = Math.ceil(rawHigh);
  if (predicate(low) || !predicate(high)) {
    throw new Error('Today timezone boundary could not be resolved.');
  }
  while (low + 1 < high) {
    const midpoint = low + Math.floor((high - low) / 2);
    if (predicate(midpoint)) high = midpoint;
    else low = midpoint;
  }
  return high;
}
