import { buildAuthenticatedAiContext } from './ai-context';
import { DomainError } from './errors';
import { ToolExecutor } from './executor';
import { ToolRegistry } from './registry';
import type { Repository } from './repository';
import {
  analyticsArgsSchema,
  previewChangesArgsSchema,
  previewGoalArchitectureArgsSchema,
  previewTimeBlockChangeArgsSchema,
  readArgsSchema,
  replaceDayScheduleArgsSchema,
  replaceWeekScheduleArgsSchema,
  stateArgsSchema,
} from './schemas';
import { ChangePlanService, type ChangePlanServiceOptions } from './services/change-plan-service';
import { GoalArchitectService } from './services/goal-architect-service';
import { ReadService } from './services/read-service';
import { SchedulingService } from './services/scheduling-service';
import { TOOL_CONTRACTS } from './tool-definitions';
import type { AuthContext, EntityCollection } from './types';

export interface LifeTrackerDomain {
  readonly read: ReadService;
  readonly changePlans: ChangePlanService;
  readonly scheduling: SchedulingService;
  readonly goalArchitect: GoalArchitectService;
  readonly registry: ToolRegistry;
  readonly executor: ToolExecutor;
  readonly buildAuthenticatedAiContext: (context: AuthContext) => ReturnType<typeof buildAuthenticatedAiContext>;
}

const READ_TOOL_COLLECTIONS: Readonly<Record<string, EntityCollection>> = {
  get_goals: 'goals',
  get_key_results: 'keyResults',
  get_projects: 'projects',
  get_tasks: 'tasks',
  get_timeblocks: 'timeBlocks',
  get_sessions: 'sessions',
  get_habits: 'habits',
  get_habit_logs: 'habitLogs',
  get_notes: 'notes',
  get_goal_roadmaps: 'goalRoadmaps',
  get_domains: 'domains',
};

export function createLifeTrackerDomain(
  repository: Repository,
  options: ChangePlanServiceOptions = {},
): LifeTrackerDomain {
  const read = new ReadService(repository);
  const changePlans = new ChangePlanService(repository, options);
  const scheduling = new SchedulingService(repository, changePlans);
  const goalArchitect = new GoalArchitectService(repository, changePlans);
  const registry = new ToolRegistry();
  const contracts = new Map(TOOL_CONTRACTS.map((contract) => [contract.name, contract]));
  const register = (name: string, handler: (args: unknown, context: AuthContext) => Promise<unknown>) => {
    const contract = contracts.get(name);
    if (!contract) throw new Error(`Missing contract for ${name}`);
    registry.register(contract, handler);
  };

  for (const [name, collection] of Object.entries(READ_TOOL_COLLECTIONS)) {
    register(name, async (args, context) => read.list(context, collection, readArgsSchema.parse(args)));
  }
  register('get_life_tracker_state', async (args, context) => read.state(context, stateArgsSchema.parse(args)));
  register('analyze_period', async (args, context) => read.analytics(context, analyticsArgsSchema.parse(args)));
  register('planned_vs_actual', async (args, context) => read.analytics(context, analyticsArgsSchema.parse(args)));
  register('get_kpis', async (args, context) => read.kpis(context, analyticsArgsSchema.parse(args)));
  register('goal_alignment', async (args, context) => read.goalAlignment(context, analyticsArgsSchema.parse(args)));
  register('detect_schedule_conflicts', async (args, context) => read.detectScheduleConflicts(context, analyticsArgsSchema.parse(args)));
  register('preview_changes', async (args, context) => {
    const parsed = previewChangesArgsSchema.parse(args);
    if (parsed.operations.some((operation) => operation.collection === 'timeBlocks' && operation.op !== 'delete')) {
      throw new DomainError(
        'FORBIDDEN',
        'TimeBlock create, update, and move proposals must use the deterministic scheduling tool.',
      );
    }
    return changePlans.previewChanges(context, parsed);
  });
  register('preview_timeblock_change', async (args, context) =>
    scheduling.previewTimeBlockChange(context, previewTimeBlockChangeArgsSchema.parse(args)));
  register('preview_goal_architecture', async (args, context) => goalArchitect.preview(context, previewGoalArchitectureArgsSchema.parse(args)));
  register('replace_day_schedule', async (args, context) => scheduling.replaceDaySchedule(context, replaceDayScheduleArgsSchema.parse(args)));
  register('replace_week_schedule', async (args, context) => scheduling.replaceWeekSchedule(context, replaceWeekScheduleArgsSchema.parse(args)));

  return {
    read,
    changePlans,
    scheduling,
    goalArchitect,
    registry,
    executor: new ToolExecutor(registry),
    buildAuthenticatedAiContext: (context) => buildAuthenticatedAiContext(repository, context),
  };
}
