import type { Session } from '@/types';

export const MAX_EXECUTION_INTERVAL_MS = 24 * 60 * 60 * 1_000;

const SESSION_DURATION_TOLERANCE_SECONDS = 5;

export interface ExecutionInterval {
  readonly start: number;
  readonly end: number;
}

export interface CompletedSessionEvidence {
  readonly interval: ExecutionInterval;
  /** Net tracked time. This may be shorter than the wall-clock interval. */
  readonly netMinutes: number;
  readonly timeBlockId: string | null;
}

/**
 * Parse the only authoritative Session shape used by execution analytics.
 * Duration is persisted in seconds. When both duration and endTime exist,
 * duration is the net tracked value and may be shorter than wall time because
 * paused time is excluded.
 */
export function parseCompletedSessionEvidence(
  session: Session,
): CompletedSessionEvidence | null {
  if (session.status !== 'completed' || session.deleted === true) return null;
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
  if (wallSeconds <= 0 || wallSeconds > MAX_EXECUTION_INTERVAL_MS / 1_000) return null;
  if (netMinutes === null) netMinutes = wallSeconds / 60;
  if (
    netMinutes < 0
    || netMinutes * 60 > wallSeconds + SESSION_DURATION_TOLERANCE_SECONDS
    || netMinutes > MAX_EXECUTION_INTERVAL_MS / 60_000
  ) {
    return null;
  }
  return Object.freeze({
    interval: Object.freeze({ start, end }),
    netMinutes,
    timeBlockId: typeof session.timeBlockId === 'string' && session.timeBlockId.length > 0
      ? session.timeBlockId
      : null,
  });
}

export function validExecutionInterval(
  rawStart: unknown,
  rawEnd: unknown,
): ExecutionInterval | null {
  const start = dateEpoch(rawStart);
  const end = dateEpoch(rawEnd);
  if (
    start === null
    || end === null
    || end <= start
    || end - start > MAX_EXECUTION_INTERVAL_MS
  ) {
    return null;
  }
  return Object.freeze({ start, end });
}

export function dateEpoch(value: unknown): number | null {
  if (!(value instanceof Date)) return null;
  const epoch = value.getTime();
  return Number.isFinite(epoch) ? epoch : null;
}

export function intervalOverlapMs(
  left: ExecutionInterval,
  right: ExecutionInterval,
): number {
  return Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
}

export function proportionalSessionMinutes(
  evidence: CompletedSessionEvidence,
  window: ExecutionInterval,
): number {
  const overlap = intervalOverlapMs(evidence.interval, window);
  const wallMs = evidence.interval.end - evidence.interval.start;
  return overlap > 0 && wallMs > 0 ? evidence.netMinutes * overlap / wallMs : 0;
}
