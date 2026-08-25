import type { Session, TimeBlock } from '@/types';

const MAX_SESSION_SECONDS = 24 * 60 * 60;
const WALL_CLOCK_TOLERANCE_SECONDS = 5;

/**
 * Return deterministic net elapsed time for the persisted Session lifecycle.
 * `duration` is accumulated active time; `activeSegmentStartedAt` marks only
 * the currently running segment. The original `startTime` is never replaced,
 * so completed Sessions retain a truthful wall-clock interval for reports.
 */
export function sessionElapsedSeconds(session: Session, at: Date): number | null {
  const start = dateEpoch(session.startTime);
  const atEpoch = dateEpoch(at);
  if (start === null || atEpoch === null || atEpoch < start) return null;

  const persisted = durationSeconds(session.duration);
  if (session.duration !== undefined && persisted === null) return null;

  if (session.status === 'paused' || session.status === 'completed') {
    const end = dateEpoch(session.endTime);
    if (end !== null && (end < start || end > atEpoch)) return null;
    if (persisted !== null) return withinWallClock(persisted, start, end ?? atEpoch);
    if (end === null) return null;
    return boundedSeconds((end - start) / 1_000);
  }

  if (session.status !== 'active') return null;
  const accumulated = persisted ?? 0;
  let segmentStart = dateEpoch(session.activeSegmentStartedAt);
  if (segmentStart === null) {
    // Backward compatibility for pre-lifecycle active Sessions. An active
    // record with accumulated duration but no segment marker is ambiguous and
    // must fail closed instead of double-counting time.
    if (accumulated !== 0) return null;
    segmentStart = start;
  }
  if (segmentStart < start || segmentStart > atEpoch) return null;
  const total = accumulated + Math.floor((atEpoch - segmentStart) / 1_000);
  return withinWallClock(total, start, atEpoch);
}

export function pauseSessionAt(session: Session, at: Date): Session {
  if (session.status !== 'active') throw new Error('Only an active Session can be paused.');
  const duration = sessionElapsedSeconds(session, at);
  if (duration === null) throw new Error('Active Session timing is invalid.');
  return {
    ...session,
    status: 'paused',
    endTime: at,
    duration,
    activeSegmentStartedAt: null,
    updatedAt: at,
  };
}

export function resumeSessionAt(session: Session, at: Date): Session {
  if (session.status !== 'paused') throw new Error('Only a paused Session can be resumed.');
  const duration = sessionElapsedSeconds(session, at);
  if (duration === null) throw new Error('Paused Session timing is invalid.');
  return {
    ...session,
    // Resume the same durable Session. A second document would strand the
    // paused segment and make restart restore it after the new segment stops.
    status: 'active',
    duration,
    activeSegmentStartedAt: at,
    updatedAt: at,
  };
}

export function completeSessionAt(session: Session, at: Date, notes?: string): Session {
  if (session.status !== 'active' && session.status !== 'paused') {
    throw new Error('Only an active or paused Session can be completed.');
  }
  const duration = sessionElapsedSeconds(session, at);
  if (duration === null) throw new Error('Session timing is invalid.');
  return {
    ...session,
    status: 'completed',
    endTime: at,
    duration,
    activeSegmentStartedAt: null,
    notes,
    updatedAt: at,
  };
}

/**
 * Select at most one resumable owner Session. Old clients created a second
 * record on resume; when that later record exists for the same TimeBlock, the
 * earlier open record is a superseded segment and must never resurrect.
 */
export function selectRestorableSession(
  ownerUid: string,
  sessions: ReadonlyArray<Session>,
): Session | null {
  if (!ownerUid) throw new Error('Authenticated owner is required to restore a Session.');
  const ownerSessions = sessions.filter((session) => session.userId === ownerUid && !session.deleted);
  const candidates = ownerSessions.filter(isResumableSession).filter((candidate) => {
    if (!candidate.timeBlockId) return true;
    const candidateUpdated = dateEpoch(candidate.updatedAt);
    if (candidateUpdated === null) return true;
    return !ownerSessions.some((other) => {
      const otherCreated = dateEpoch(other.createdAt);
      return other.id !== candidate.id
        && other.timeBlockId === candidate.timeBlockId
        && otherCreated !== null
        && otherCreated > candidateUpdated;
    });
  });
  if (candidates.length > 1) {
    throw new Error('Multiple resumable Sessions require recovery.');
  }
  return candidates[0] ?? null;
}

export function timeBlockStatusAfterSession(
  block: Pick<TimeBlock, 'startTime' | 'endTime'>,
  actualSeconds: number,
): 'in_progress' | 'completed' | 'overrun' {
  const start = dateEpoch(block.startTime);
  const end = dateEpoch(block.endTime);
  const actual = durationSeconds(actualSeconds);
  if (start === null || end === null || end <= start || actual === null) {
    throw new Error('TimeBlock execution timing is invalid.');
  }
  const plannedSeconds = (end - start) / 1_000;
  if (actual > plannedSeconds) return 'overrun';
  if (actual >= plannedSeconds * 0.8) return 'completed';
  return 'in_progress';
}

function isResumableSession(session: Session): boolean {
  return (
    (session.status === 'active' || session.status === 'paused')
    && dateEpoch(session.startTime) !== null
    && dateEpoch(session.createdAt) !== null
    && dateEpoch(session.updatedAt) !== null
  );
}

function durationSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return boundedSeconds(value);
}

function boundedSeconds(value: number): number | null {
  const seconds = Math.floor(value);
  return seconds >= 0 && seconds <= MAX_SESSION_SECONDS ? seconds : null;
}

function withinWallClock(seconds: number, start: number, end: number): number | null {
  const bounded = boundedSeconds(seconds);
  if (bounded === null) return null;
  const wallSeconds = (end - start) / 1_000;
  return wallSeconds >= 0
    && wallSeconds <= MAX_SESSION_SECONDS
    && bounded <= wallSeconds + WALL_CLOCK_TOLERANCE_SECONDS
      ? bounded
      : null;
}

function dateEpoch(value: unknown): number | null {
  if (!(value instanceof Date)) return null;
  const epoch = value.getTime();
  return Number.isFinite(epoch) ? epoch : null;
}
