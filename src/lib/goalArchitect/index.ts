// src/lib/goalArchitect/index.ts
// Public API surface for the Goal Architect Intelligence domain.
// Later prompts (parser, UI, commit pipeline) import only from here.

export {
  GOAL_ARCHITECT_DRAFT_VERSION,
  isDraftEntityKind,
  isDraftPriority,
  isKeyResultUnit,
} from './types';
export type {
  DraftConfidence,
  DraftEntityKind,
  DraftPriority,
  FieldConfidence,
  GoalArchitectDraftStatus,
  GoalArchitectIssue,
  GoalArchitectIssueCode,
  GoalArchitectSeverity,
  GoalArchitectureDraft,
  GoalArchitectureSummary,
  GoalArchitectureValidationResult,
  GoalDraft,
  KeyResultDraft,
  KeyResultUnit,
  ProjectDraft,
  TaskDraft,
} from './types';

export {
  createDraftId,
  createIssueId,
  normalizeForId,
  slugifyDraftTitle,
  stableHash,
} from './ids';

export {
  detectDuplicateTitles,
  detectSimilarTitles,
  isValidISODate,
  normalizePriority,
  validateGoalArchitectureDraft,
  validateGoalDraft,
  validateHoursConsistency,
  validateKeyResultDraft,
  validateProjectDraft,
  validateTaskDraft,
} from './validation';

export {
  calculateGoalArchitectureSummary,
  calculateTotalProjectTargetHours,
  calculateTotalTaskEstimatedHours,
  countIssuesBySeverity,
  findOrphanKeyResults,
  findOrphanTasks,
} from './summary';
export type { IssueSeverityCounts } from './summary';

export {
  createAllGoalArchitectFixtures,
  createChessGoalDraftFixture,
  createIntelligenceEngineGoalDraftFixture,
  createModelPhysiqueGoalDraftFixture,
  createPresenceUpgradeGoalDraftFixture,
  createWorkGoalDraftFixture,
} from './fixtures';
export type { GoalArchitectFixtureSuite } from './fixtures';

// ---------------------------------------------------------------------------
// Parser & compiler (Prompt 2)
// ---------------------------------------------------------------------------

export type {
  GoalArchitectParseIssue,
  GoalArchitectParseIssueSeverity,
  GoalArchitectParsedAst,
  NormalizedGoalArchitectAst,
  NormalizedGoalNode,
  NormalizedKeyResultNode,
  NormalizedProjectNode,
  NormalizedTaskNode,
  ParsedGoalNode,
  ParsedKeyResultNode,
  ParsedProjectNode,
  ParsedTaskNode,
  ParsedTextSpan,
} from './parserTypes';

export {
  extractInlineDate,
  extractInlineHours,
  extractInlinePriority,
  normalizeInputText,
  normalizeKeyResultUnitToken,
  normalizePriorityToken,
  normalizeSectionLabel,
  normalizeWhitespace,
  parseDateToken,
  parseHoursToken,
  removeKnownMetadataFromTitle,
  splitListItems,
  stripAccents,
} from './normalizer';

export {
  detectUnparsedSegments,
  parseGoalArchitectText,
  parseGoalClause,
  parseKeyResultClauses,
  parseProjectClauses,
  parseTaskClauses,
} from './parser';

export {
  compileGoalArchitectureDraft,
  matchProjectTitle,
  normalizeGoalArchitectAst,
} from './compiler';
export type { CompileOptions } from './compiler';

export { parseGoalArchitecture } from './parseGoalArchitecture';

export {
  createAllGoalArchitectParserInputTexts,
  createChessGoalArchitectInputText,
  createIntelligenceEngineGoalArchitectInputText,
  createModelPhysiqueGoalArchitectInputText,
  createPresenceUpgradeGoalArchitectInputText,
  createWorkGoalArchitectInputText,
} from './parserFixtures';
export type { GoalArchitectParserInputTexts } from './parserFixtures';

export { hasGaiKeyMarker, stripGaiKeyMarker } from './displayHelpers';

// ---------------------------------------------------------------------------
// Draft persistence & safe commit (Prompt 4)
// ---------------------------------------------------------------------------

export {
  GOAL_ARCHITECT_KEY_PREFIX,
  buildGoalArchitectDraftStorageKey,
  deleteGoalArchitectureDraft,
  isGoalArchitectureDraftLike,
  listGoalArchitectureDraftKeys,
  loadGoalArchitectureDraft,
  saveGoalArchitectureDraft,
} from './draftStore';

export {
  commitGoalArchitectureDraft,
  draftGoalToCreateGoalPayload,
  draftKeyResultToCreateKeyResultPayload,
  draftProjectToCreateProjectPayload,
  draftTaskToCreateTaskPayload,
  findDuplicateGoal,
  findDuplicateKeyResult,
  findDuplicateProject,
  findDuplicateTask,
  gaiKey,
  isDraftCommittable,
  validateDraftForGoalArchitectCommit,
} from './commitGoalArchitectureDraft';
export type {
  CommitGoalPayload,
  CommitKeyResultPayload,
  CommitProjectPayload,
  CommitTaskPayload,
  CreateGoalFn,
  CreateKeyResultFn,
  CreateProjectFn,
  CreateTaskFn,
  DuplicateMatch,
  ExistingGoalSnapshot,
  ExistingKeyResultSnapshot,
  ExistingProjectSnapshot,
  ExistingTaskSnapshot,
  GoalArchitectBlockedCode,
  GoalArchitectBlockedReason,
  GoalArchitectCommitCreated,
  GoalArchitectCommitDuplicate,
  GoalArchitectCommitError,
  GoalArchitectCommitInput,
  GoalArchitectCommitResult,
  GoalArchitectCommitSkipped,
  GoalArchitectCommitStatus,
  GoalArchitectCommitValidationResult,
} from './commitGoalArchitectureDraft';
