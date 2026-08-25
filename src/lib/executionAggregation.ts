import type { Session, TimeBlock } from '@/types';
import {
  dateEpoch,
  intervalOverlapMs,
  parseCompletedSessionEvidence,
  proportionalSessionMinutes,
  validExecutionInterval,
  type ExecutionInterval,
} from './executionEvidence';

export type ExecutionAvailability = 'complete' | 'partial';

export interface ExecutionWindowAggregate {
  readonly plannedMinutes: number;
  /** Known authoritative actual time; a lower bound when availability is partial. */
  readonly actualMinutes: number;
  readonly actualSourceCount: number;
  readonly blocksMissingActualCount: number;
  readonly openSessionCount: number;
  readonly invalidActualSourceCount: number;
  readonly invalidPlannedBlockCount: number;
  readonly availability: ExecutionAvailability;
  readonly actualMinutesByDomainId: ReadonlyMap<string | null, number>;
}

export interface ExecutionWindowInput {
  readonly ownerUid: string;
  readonly start: Date;
  readonly end: Date;
  readonly timeBlocks: ReadonlyArray<TimeBlock>;
  readonly sessions: ReadonlyArray<Session>;
}

export interface BlockExecutionRecord {
  readonly blockId: string;
  /** Null means the block is marked executed but has no trustworthy duration evidence. */
  readonly actualMinutes: number | null;
  readonly source: 'completed_sessions' | 'explicit_block_actual' | 'missing';
  readonly sourceCount: number;
}

export interface BlockExecutionInput {
  readonly ownerUid: string;
  readonly timeBlocks: ReadonlyArray<TimeBlock>;
  readonly sessions: ReadonlyArray<Session>;
}

/**
 * Resolve all-history execution evidence per TimeBlock for hierarchy/OKR
 * views. Completed Sessions remain primary even when a linked block failed to
 * transition out of planned/in-progress state. A block marked executed but
 * lacking both a valid Session and explicit actual interval is represented as
 * missing, never as its planned duration.
 */
export function collectBlockExecutionRecords(
  input: BlockExecutionInput,
): ReadonlyMap<string, BlockExecutionRecord> {
  if (!input.ownerUid) throw new Error('Block execution collection requires an authenticated owner.');
  const ownerBlocks = input.timeBlocks.filter((block) => (
    block.userId === input.ownerUid
    && block.deleted !== true
    && block.type !== 'break'
    && block.type !== 'buffer'
  ));
  const blockById = new Map(ownerBlocks.map((block) => [block.id, block]));
  const sessionMinutesByBlockId = new Map<string, { minutes: number; count: number }>();

  for (const session of input.sessions) {
    if (session.userId !== input.ownerUid || session.deleted === true) continue;
    const evidence = parseCompletedSessionEvidence(session);
    if (!evidence?.timeBlockId || !blockById.has(evidence.timeBlockId)) continue;
    const current = sessionMinutesByBlockId.get(evidence.timeBlockId) ?? { minutes: 0, count: 0 };
    current.minutes += evidence.netMinutes;
    current.count += 1;
    sessionMinutesByBlockId.set(evidence.timeBlockId, current);
  }

  const records = new Map<string, BlockExecutionRecord>();
  for (const block of ownerBlocks) {
    const sessionEvidence = sessionMinutesByBlockId.get(block.id);
    if (sessionEvidence) {
      records.set(block.id, Object.freeze({
        blockId: block.id,
        actualMinutes: sessionEvidence.minutes,
        source: 'completed_sessions',
        sourceCount: sessionEvidence.count,
      }));
      continue;
    }
    if (!executedBlock(block)) continue;
    const explicit = validExecutionInterval(block.actualStartTime, block.actualEndTime);
    records.set(block.id, Object.freeze(explicit
      ? {
          blockId: block.id,
          actualMinutes: (explicit.end - explicit.start) / 60_000,
          source: 'explicit_block_actual' as const,
          sourceCount: 1,
        }
      : {
          blockId: block.id,
          actualMinutes: null,
          source: 'missing' as const,
          sourceCount: 0,
        }));
  }
  return records;
}

/**
 * Provider-neutral, deterministic execution aggregation used by legacy UI
 * analytics and rollups. Sessions are primary; explicit block actual
 * intervals are accepted only when no valid linked Session exists. Planned
 * TimeBlock windows are never actual execution.
 */
export function aggregateExecutionWindow(
  input: ExecutionWindowInput,
): ExecutionWindowAggregate {
  if (!input.ownerUid) throw new Error('Execution aggregation requires an authenticated owner.');
  const window = validWindow(input.start, input.end);
  if (!window) throw new Error('Execution aggregation window is invalid.');

  const ownerBlocks = input.timeBlocks.filter((block) => block.userId === input.ownerUid);
  const blockById = new Map(ownerBlocks.map((block) => [block.id, block]));
  const blocksWithValidSessions = new Set<string>();
  const parsedSessions: Array<Readonly<{
    session: Session;
    evidence: NonNullable<ReturnType<typeof parseCompletedSessionEvidence>>;
  }>> = [];
  let openSessionCount = 0;
  let invalidActualSourceCount = 0;

  for (const session of input.sessions) {
    if (session.userId !== input.ownerUid || session.deleted === true) continue;
    const start = dateEpoch(session.startTime);
    if (session.status !== 'completed') {
      if (start !== null && start >= window.start && start < window.end) openSessionCount += 1;
      continue;
    }
    const evidence = parseCompletedSessionEvidence(session);
    if (!evidence) {
      if (start === null || start >= window.start && start < window.end) {
        invalidActualSourceCount += 1;
      }
      continue;
    }
    parsedSessions.push({ session, evidence });
    if (evidence.timeBlockId) blocksWithValidSessions.add(evidence.timeBlockId);
  }

  let plannedMinutes = 0;
  let actualMinutes = 0;
  let actualSourceCount = 0;
  let blocksMissingActualCount = 0;
  let invalidPlannedBlockCount = 0;
  const actualMinutesByDomainId = new Map<string | null, number>();

  const addActual = (domainId: string | null, minutes: number) => {
    if (minutes <= 0) return;
    actualMinutes += minutes;
    actualSourceCount += 1;
    actualMinutesByDomainId.set(
      domainId,
      (actualMinutesByDomainId.get(domainId) ?? 0) + minutes,
    );
  };

  for (const { session, evidence } of parsedSessions) {
    const linkedBlock = evidence.timeBlockId ? blockById.get(evidence.timeBlockId) ?? null : null;
    if (linkedBlock?.type === 'break' || linkedBlock?.type === 'buffer') continue;
    const minutes = proportionalSessionMinutes(evidence, window);
    const domainId = nonEmptyId(session.domainId) ?? nonEmptyId(linkedBlock?.domainId);
    addActual(domainId, minutes);
  }

  for (const block of ownerBlocks) {
    if (block.deleted === true) continue;
    const scheduled = validExecutionInterval(block.startTime, block.endTime);
    if (!scheduled) {
      const start = dateEpoch(block.startTime);
      if (start === null || start >= window.start && start < window.end) {
        invalidPlannedBlockCount += 1;
      }
      continue;
    }
    if (!productiveBlock(block)) continue;
    const plannedOverlap = intervalOverlapMs(scheduled, window);
    if (plannedOverlap > 0) plannedMinutes += plannedOverlap / 60_000;
    if (!executedBlock(block) || blocksWithValidSessions.has(block.id)) continue;

    const explicit = validExecutionInterval(block.actualStartTime, block.actualEndTime);
    if (explicit) {
      addActual(nonEmptyId(block.domainId), intervalOverlapMs(explicit, window) / 60_000);
      continue;
    }
    if (block.actualStartTime !== undefined || block.actualEndTime !== undefined) {
      const actualStart = dateEpoch(block.actualStartTime);
      if (plannedOverlap > 0 || actualStart === null || actualStart >= window.start && actualStart < window.end) {
        invalidActualSourceCount += 1;
      }
    }
    if (plannedOverlap > 0) blocksMissingActualCount += 1;
  }

  const availability: ExecutionAvailability =
    blocksMissingActualCount > 0
    || openSessionCount > 0
    || invalidActualSourceCount > 0
    || invalidPlannedBlockCount > 0
      ? 'partial'
      : 'complete';
  return Object.freeze({
    plannedMinutes,
    actualMinutes,
    actualSourceCount,
    blocksMissingActualCount,
    openSessionCount,
    invalidActualSourceCount,
    invalidPlannedBlockCount,
    availability,
    actualMinutesByDomainId,
  });
}

function validWindow(startValue: Date, endValue: Date): ExecutionInterval | null {
  const start = dateEpoch(startValue);
  const end = dateEpoch(endValue);
  return start !== null && end !== null && end > start ? { start, end } : null;
}

function productiveBlock(block: TimeBlock): boolean {
  return block.status !== 'cancelled' && block.type !== 'break' && block.type !== 'buffer';
}

function executedBlock(block: TimeBlock): boolean {
  return block.status === 'completed' || block.status === 'overrun';
}

function nonEmptyId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
