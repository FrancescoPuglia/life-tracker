import { buildAuthenticatedAiContext } from './ai-context';
import { ToolExecutor } from './executor';
import { ToolRegistry } from './registry';
import type { Repository } from './repository';
import {
  analyticsArgsSchema,
  planActionArgsSchema,
  previewChangesArgsSchema,
  previewGoalArchitectureArgsSchema,
  readArgsSchema,
  replaceDayScheduleArgsSchema,
  replaceWeekScheduleArgsSchema,
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
  list_goals: 'goals',
  list_projects: 'projects',
  list_tasks: 'tasks',
  list_time_blocks: 'timeBlocks',
  list_habits: 'habits',
  list_sessions: 'sessions',
  list_notes: 'notes',
  list_domains: 'domains',
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
  register('get_analytics', async (args, context) => read.analytics(context, analyticsArgsSchema.parse(args)));
  register('preview_changes', async (args, context) => changePlans.previewChanges(context, previewChangesArgsSchema.parse(args)));
  register('preview_goal_architecture', async (args, context) => goalArchitect.preview(context, previewGoalArchitectureArgsSchema.parse(args)));
  register('replace_day_schedule', async (args, context) => scheduling.replaceDaySchedule(context, replaceDayScheduleArgsSchema.parse(args)));
  register('replace_week_schedule', async (args, context) => scheduling.replaceWeekSchedule(context, replaceWeekScheduleArgsSchema.parse(args)));
  register('apply_plan', async (args, context) => changePlans.applyPlan(context, planActionArgsSchema.parse(args)));
  register('rollback_plan', async (args, context) => changePlans.rollbackPlan(context, planActionArgsSchema.parse(args)));

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
