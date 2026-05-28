// src/lib/weeklyPlanner/index.ts
// Public surface of the Weekly Planning Intelligence deterministic core.
// Everything else (UI, persistence, commit) lives in separate prompts.

export * from './types';
export { parseWeeklyIntent } from './parser';
export { mapIntentToGoal, mapIntentsToGoals } from './goalMapper';
export { expandRoutineIntents } from './routineEngine';
export { detectConflicts } from './conflicts';
export type { ConflictDetectionResult } from './conflicts';
export { scorePlanRealism } from './scoring';
export { generateWeeklyDraft } from './scheduler';

// Re-export selected time utilities that any UI consumer will need (so
// nothing reaches in via deep imports later).
export {
  addMinutesToTime,
  compareTime,
  computeEndTime,
  minutesToTime,
  normalizeTime,
  timeToMinutes,
  weekdayName,
} from './timeUtils';

// Prompt 4: draft persistence + commit pipeline.
export {
  buildWeeklyDraftStorageKey,
  deleteWeeklyPlanDraft,
  isWeeklyPlanDraftLike,
  listWeeklyPlanDraftKeys,
  loadWeeklyPlanDraft,
  saveWeeklyPlanDraft,
} from './draftStore';
export type {
  DraftStoreParams,
  SaveDraftParams,
} from './draftStore';

export {
  commitWeeklyPlanDraft,
  draftBlockToTimeBlockInput,
  getCommittableBlocks,
  getDateISOForWeekDay,
  isDraftBlockCommittable,
  isDuplicateDraftBlock,
  validateDraftForCommit,
  wpiKey,
} from './commitDraft';
export type {
  BlockedReasonType,
  CommitBlockedReason,
  CommitCreatedItem,
  CommitDraftInput,
  CommitDraftResult,
  CommitSkippedItem,
  CommitStatus,
  CommitTimeBlockInput,
  CommitValidationResult,
  CreateTimeBlockFn,
  ExistingTimeBlockSnapshot,
  SkipReason,
  TimeBlockKind,
} from './commitDraft';

// Prompt 5: WPI plan-vs-actual analytics.
export {
  calculateWpiWeeklyAnalytics,
  extractWpiKey,
  findMatchingDraftForWeek,
  getTimeBlockDurationMinutes,
  getWeekRange,
  groupWpiTimeBlocksByDraft,
  isCompletedStatus,
  isMissedStatus,
  isPartialStatus,
  isPendingStatus,
  isTimeBlockInWeek,
  isWpiTimeBlock,
  parseWpiKey,
} from './analytics';
export type {
  CalibrationLabel,
  CalculateWpiWeeklyAnalyticsParams,
  FindMatchingDraftParams,
  WpiAnalyticsResult,
  WpiDayAnalytics,
  WpiParsedKey,
  WpiRealismCalibration,
  WpiTimeBlockGroup,
  WpiTimeBlockSnapshot,
  WpiWeeklyAnalytics,
} from './analytics';
