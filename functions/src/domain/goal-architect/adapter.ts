interface GoalArchitectModules {
  validateGoalArchitectureDraft(draft: GoalArchitectureDraftLike): {
    status: string;
    canCommit: boolean;
    issues: readonly Readonly<Record<string, unknown>>[];
    summary: Readonly<Record<string, unknown>>;
  };
  normalizeForId(value: string): string;
}

interface GoalArchitectCommitModule {
  validateDraftForGoalArchitectCommit(input: Readonly<Record<string, unknown>>): {
    canCommit: boolean;
    blockedReasons: readonly Readonly<Record<string, unknown>>[];
  };
}

export interface GoalArchitectureDraftLike {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly createdAtISO: string;
  readonly updatedAtISO: string;
  readonly sourceText: string;
  readonly goal: Readonly<Record<string, unknown>>;
  readonly projects: readonly Readonly<Record<string, unknown>>[];
  readonly tasks: readonly Readonly<Record<string, unknown>>[];
  readonly keyResults: readonly Readonly<Record<string, unknown>>[];
  readonly issues: readonly Readonly<Record<string, unknown>>[];
  readonly summary: Readonly<Record<string, unknown>>;
  readonly confidence: Readonly<Record<string, unknown>>;
}

const sharedValidators = require('../../../.generated/shared-validators.cjs') as {
  readonly goalArchitectValidation: Pick<GoalArchitectModules, 'validateGoalArchitectureDraft'>;
  readonly goalArchitectIds: Pick<GoalArchitectModules, 'normalizeForId'>;
  readonly goalArchitectCommit: GoalArchitectCommitModule;
};
const validationModule = sharedValidators.goalArchitectValidation;
const idsModule = sharedValidators.goalArchitectIds;
const commitModule = sharedValidators.goalArchitectCommit;

export interface GoalArchitectValidationResult {
  readonly conflicts: readonly string[];
  readonly warnings: readonly string[];
}

export function validateWithGoalArchitect(
  draft: GoalArchitectureDraftLike,
  existing: Readonly<{
    goals: readonly Readonly<Record<string, unknown>>[];
    projects: readonly Readonly<Record<string, unknown>>[];
    tasks: readonly Readonly<Record<string, unknown>>[];
    keyResults: readonly Readonly<Record<string, unknown>>[];
  }>,
): GoalArchitectValidationResult {
  const validation = validationModule.validateGoalArchitectureDraft(draft);
  const commit = commitModule.validateDraftForGoalArchitectCommit({
    draft,
    existingGoals: existing.goals,
    existingProjects: existing.projects,
    existingTasks: existing.tasks,
    existingKeyResults: existing.keyResults,
    createGoal: async () => 'validated-goal',
    createProject: async () => 'validated-project',
    createTask: async () => 'validated-task',
    createKeyResult: async () => 'validated-key-result',
  });
  const conflicts = [
    ...validation.issues.filter((issue) => issue.severity === 'error').map(issueMessage),
    ...commit.blockedReasons.map(issueMessage),
  ];
  const warnings = validation.issues
    .filter((issue) => issue.severity !== 'error')
    .map(issueMessage);
  return { conflicts: [...new Set(conflicts)], warnings: [...new Set(warnings)] };
}

export function normalizeGoalArchitectTitle(value: string): string {
  return idsModule.normalizeForId(value);
}

function issueMessage(issue: Readonly<Record<string, unknown>>): string {
  return typeof issue.message === 'string' ? issue.message : 'Goal Architect validation failed.';
}
