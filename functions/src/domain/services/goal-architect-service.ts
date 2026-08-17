import { createHash } from 'node:crypto';
import { DomainError } from '../errors';
import { hashValidationScopeRecords } from '../integrity';
import { extractTaskGaiMarkers, stripSemanticMarkerLines } from '../semantic-markers';
import {
  normalizeGoalArchitectTitle,
  validateWithGoalArchitect,
  type GoalArchitectureDraftLike,
} from '../goal-architect/adapter';
import type { Repository } from '../repository';
import type { PreviewGoalArchitectureArgs, PreviewTaskChangeArgs } from '../schemas';
import type {
  AuthContext,
  ChangeOperation,
  EntityCollection,
  EntityRecord,
  PublicChangePlan,
  PreviewValidationRequirements,
  ReadFilter,
  WriteValue,
} from '../types';
import { ChangePlanService } from './change-plan-service';

export class GoalArchitectService {
  constructor(
    private readonly repository: Repository,
    private readonly changePlans: ChangePlanService,
  ) {}

  async preview(
    context: AuthContext,
    args: PreviewGoalArchitectureArgs,
  ): Promise<PublicChangePlan> {
    if (!(await this.repository.getEntity(context.uid, 'domains', args.domainId))) {
      throw new DomainError('FORBIDDEN', 'Goal Architect domain is unavailable for this user.');
    }
    assertUniqueIds(args);
    const projectIds = new Set(args.projects.map((project) => project.id));
    for (const task of args.tasks) {
      if (!projectIds.has(task.parentProjectId)) {
        throw new DomainError('INVALID_ARGUMENT', `Task '${task.title}' must belong to a project in this draft.`);
      }
    }

    const draft = buildDraft(args);
    const existing = await this.loadExisting(context.uid, args.domainId);
    const validation = validateWithGoalArchitect(draft, existing);
    const duplicateConflicts = detectExistingDuplicates(args, existing);
    const conflicts = [...validation.conflicts, ...duplicateConflicts];
    const operations = buildOperations(args, draft.id);
    return this.changePlans.previewOperations(
      context,
      'preview_goal_architecture',
      operations,
      validation.warnings,
      conflicts,
      {
        reason: args.reason,
        expectedImpact: [
          `Create one Goal, ${args.projects.length} Project(s), ${args.tasks.length} Task(s), and ${args.keyResults.length} Key Result(s) as one validated hierarchy.`,
        ],
        validation: goalArchitectValidation(existing, args.domainId),
      },
    );
  }

  async previewTaskChange(
    context: AuthContext,
    args: PreviewTaskChangeArgs,
  ): Promise<PublicChangePlan> {
    const [domain, goal, project, current] = await Promise.all([
      this.repository.getEntity(context.uid, 'domains', args.domainId),
      this.repository.getEntity(context.uid, 'goals', args.goalId),
      this.repository.getEntity(context.uid, 'projects', args.projectId),
      this.repository.getEntity(context.uid, 'tasks', args.id),
    ]);
    if (!domain || !goal || !project) {
      throw new DomainError('FORBIDDEN', 'Task hierarchy is unavailable for this user.');
    }
    if (goal.domainId !== args.domainId || project.domainId !== args.domainId || project.goalId !== args.goalId) {
      throw new DomainError('CONFLICT', 'Task Goal, Project, and Domain hierarchy is inconsistent.');
    }
    if (args.action === 'create' && current) {
      throw new DomainError('CONFLICT', 'Task already exists; request an update instead.');
    }
    if (args.action === 'update' && !current) {
      throw new DomainError('NOT_FOUND', 'Task is unavailable for this user.');
    }
    if (args.action === 'update' && current) {
      const effectiveGoalId = typeof current.goalId === 'string' ? current.goalId : project.goalId;
      const effectiveDomainId = typeof current.domainId === 'string' ? current.domainId : project.domainId;
      if (
        current.projectId !== args.projectId
        || effectiveGoalId !== args.goalId
        || effectiveDomainId !== args.domainId
      ) {
        throw new DomainError(
          'CONFLICT',
          'Focused Task updates cannot change Goal Architect hierarchy; use a dedicated deterministic reparenting workflow.',
        );
      }
    }

    const existing = await this.readAll(context.uid, 'tasks', args.domainId);
    const normalizedTitle = normalizeGoalArchitectTitle(args.title);
    if (existing.some((task) => task.id !== args.id
      && normalizeGoalArchitectTitle(String(task.title ?? '')) === normalizedTitle)) {
      throw new DomainError('CONFLICT', `Duplicate tasks title '${args.title}' already exists in this domain.`);
    }

    const marker = `GAI_KEY: task:${createHash('sha256')
      .update(JSON.stringify([args.domainId, args.goalId, args.projectId, normalizedTitle]))
      .digest('hex')
      .slice(0, 24)}`;
    const description = taskDescription(args.action, args.description, current, marker);
    const operation: ChangeOperation = {
      op: args.action,
      collection: 'tasks',
      id: args.id,
      values: {
        title: args.title,
        description,
        status: args.status,
        priority: args.priority,
        projectId: args.projectId,
        goalId: args.goalId,
        domainId: args.domainId,
        dueDate: normalizeNullableGoalArchitectDate(args.dueDate),
        estimatedMinutes: args.estimatedMinutes,
      },
    };
    return this.changePlans.previewOperations(
      context,
      'preview_task_change',
      [operation],
      [],
      [],
      {
        reason: args.reason,
        expectedImpact: [`${args.action === 'create' ? 'Create' : 'Update'} Task '${args.title}' in its validated Goal Architect hierarchy.`],
        validation: goalArchitectValidation({ tasks: existing }, args.domainId),
      },
    );
  }

  private async loadExisting(uid: string, domainId: string): Promise<{
    goals: readonly EntityRecord[];
    projects: readonly EntityRecord[];
    tasks: readonly EntityRecord[];
    keyResults: readonly EntityRecord[];
  }> {
    const [goals, projects, tasks, keyResults] = await Promise.all([
      this.readAll(uid, 'goals', domainId),
      this.readAll(uid, 'projects', domainId),
      this.readAll(uid, 'tasks', domainId),
      this.readAll(uid, 'keyResults', domainId),
    ]);
    return { goals, projects, tasks, keyResults };
  }

  private async readAll(
    uid: string,
    collection: EntityCollection,
    domainId: string,
  ): Promise<readonly EntityRecord[]> {
    const output: EntityRecord[] = [];
    let cursor: string | null = null;
    let pages = 0;
    const filter: ReadFilter = {
      query: null,
      from: null,
      to: null,
      status: null,
      domainId,
      projectId: null,
      goalId: null,
      taskId: null,
    };
    do {
      const page = await this.repository.listEntities(uid, collection, { filter, cursor, limit: 200 });
      output.push(...page.items);
      if (output.length > 2_000) throw new DomainError('LIMIT_EXCEEDED', 'Goal Architect duplicate-check limit exceeded.');
      cursor = page.nextCursor;
      pages += 1;
      if (cursor && pages >= 10) {
        throw new DomainError('LIMIT_EXCEEDED', 'Goal Architect duplicate-check scan limit exceeded.');
      }
    } while (cursor);
    return output;
  }
}

function taskDescription(
  action: PreviewTaskChangeArgs['action'],
  requested: string | null,
  current: EntityRecord | null,
  generatedMarker: string,
): string | null {
  const plain = stripSemanticMarkerLines(requested, 'GAI_KEY');
  const markers = action === 'create'
    ? [generatedMarker]
    : extractTaskGaiMarkers(typeof current?.description === 'string' ? current.description : null);
  const result = [plain, ...markers].filter((value): value is string => Boolean(value)).join('\n\n');
  return result || null;
}

function goalArchitectValidation(
  existing: Partial<Readonly<Record<'goals' | 'projects' | 'tasks' | 'keyResults', readonly EntityRecord[]>>>,
  domainId: string,
): PreviewValidationRequirements {
  const collectionMap = {
    goals: 'goals',
    projects: 'projects',
    tasks: 'tasks',
    keyResults: 'keyResults',
  } as const;
  return {
    refs: [],
    scopes: Object.entries(existing).map(([key, records]) => ({
      collection: collectionMap[key as keyof typeof collectionMap],
      field: 'domainId' as const,
      value: domainId,
      from: null,
      to: null,
      maxItems: 2_000,
      expectedStateHash: hashValidationScopeRecords(records ?? []),
    })),
    planningPreferencesHash: null,
  };
}

function buildDraft(args: PreviewGoalArchitectureArgs): GoalArchitectureDraftLike {
  const now = new Date(0).toISOString();
  const draftId = `gai_${createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0, 24)}`;
  const projects = args.projects.map((project) => ({
    ...nullableFields(project),
    id: project.id,
    title: project.title,
    targetHours: project.targetHours,
    dueDateISO: project.dueDateISO ?? undefined,
    priority: project.priority,
    parentGoalId: args.goal.id,
    taskIds: args.tasks.filter((task) => task.parentProjectId === project.id).map((task) => task.id),
  }));
  const tasks = args.tasks.map((task) => ({
    ...nullableFields(task),
    id: task.id,
    title: task.title,
    estimatedHours: task.estimatedHours,
    dueDateISO: task.dueDateISO ?? undefined,
    priority: task.priority,
    parentGoalId: args.goal.id,
    parentProjectId: task.parentProjectId,
  }));
  const keyResults = args.keyResults.map((result) => ({
    ...nullableFields(result),
    id: result.id,
    title: result.title,
    targetValue: result.targetValue,
    currentValue: result.currentValue,
    unit: result.unit,
    customUnit: result.customUnit ?? undefined,
    parentGoalId: args.goal.id,
  }));
  return {
    id: draftId,
    version: 1,
    status: 'draft',
    createdAtISO: now,
    updatedAtISO: now,
    sourceText: args.reason,
    goal: {
      ...nullableFields(args.goal),
      id: args.goal.id,
      title: args.goal.title,
      targetHours: args.goal.targetHours,
      dueDateISO: args.goal.dueDateISO,
      priority: args.goal.priority,
      projectIds: args.projects.map((project) => project.id),
      directTaskIds: [],
      keyResultIds: args.keyResults.map((result) => result.id),
    },
    projects,
    tasks,
    keyResults,
    issues: [],
    summary: {
      goalCount: 1,
      projectCount: projects.length,
      taskCount: tasks.length,
      keyResultCount: keyResults.length,
      totalProjectTargetHours: 0,
      totalTaskEstimatedHours: 0,
      orphanTaskCount: 0,
      orphanKeyResultCount: 0,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      isStructurallyValid: false,
      canCommit: false,
    },
    confidence: { overall: 1 },
  };
}

function buildOperations(
  args: PreviewGoalArchitectureArgs,
  draftId: string,
): readonly ChangeOperation[] {
  const marker = (kind: string, id: string, description: string | null): string => {
    const plain = stripSemanticMarkerLines(description, 'GAI_KEY');
    const prefix = plain ? `${plain}\n\n` : '';
    return `${prefix}GAI_KEY: gai:${draftId}:${kind}:${id}`;
  };
  const operations: ChangeOperation[] = [{
    op: 'create',
    collection: 'goals',
    id: args.goal.id,
    values: {
      title: args.goal.title,
      description: marker('goal', args.goal.id, args.goal.description),
      domainId: args.domainId,
      status: 'active',
      priority: args.goal.priority,
      targetDate: normalizeGoalArchitectDate(args.goal.dueDateISO),
      targetHours: args.goal.targetHours,
      timeAllocationTarget: args.goal.timeAllocationTarget,
      category: args.goal.category,
      complexity: args.goal.complexity,
      estimatedHours: args.goal.targetHours,
      keyResults: [],
    },
  }];
  for (const project of args.projects) {
    operations.push({
      op: 'create',
      collection: 'projects',
      id: project.id,
      values: {
        name: project.title,
        description: marker('project', project.id, project.description),
        goalId: args.goal.id,
        domainId: args.domainId,
        status: 'active',
        priority: project.priority,
        dueDate: normalizeNullableGoalArchitectDate(project.dueDateISO),
        totalHoursTarget: project.targetHours,
      },
    });
  }
  for (const task of args.tasks) {
    operations.push({
      op: 'create',
      collection: 'tasks',
      id: task.id,
      values: {
        title: task.title,
        description: marker('task', task.id, task.description),
        projectId: task.parentProjectId,
        goalId: args.goal.id,
        domainId: args.domainId,
        status: 'pending',
        priority: task.priority,
        estimatedMinutes: Math.max(1, Math.round(task.estimatedHours * 60)),
        dueDate: normalizeNullableGoalArchitectDate(task.dueDateISO),
      },
    });
  }
  for (const result of args.keyResults) {
    operations.push({
      op: 'create',
      collection: 'keyResults',
      id: result.id,
      values: {
        title: result.title,
        description: marker('key_result', result.id, result.description),
        goalId: args.goal.id,
        domainId: args.domainId,
        targetValue: result.targetValue,
        currentValue: result.currentValue,
        unit: result.unit === 'custom' ? result.customUnit : result.unit,
        progress: result.targetValue === 0 ? 0 : Math.max(0, Math.min(100, result.currentValue / result.targetValue * 100)),
        status: 'active',
      },
    });
  }
  return operations;
}

/**
 * The established Goal Architect parser treats YYYY-MM-DD as a valid
 * calendar date and its browser commit pipeline converts it with `new Date`.
 * Preserve that deterministic UTC-midnight representation so the backend
 * validator and Firestore Timestamp writer accept the same draft contract.
 */
function normalizeGoalArchitectDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00.000Z`
    : value;
}

function normalizeNullableGoalArchitectDate(value: string | null): string | null {
  return value === null ? null : normalizeGoalArchitectDate(value);
}

function detectExistingDuplicates(
  args: PreviewGoalArchitectureArgs,
  existing: Readonly<Record<'goals' | 'projects' | 'tasks' | 'keyResults', readonly EntityRecord[]>>,
): readonly string[] {
  const inputs: readonly [keyof typeof existing, readonly string[]][] = [
    ['goals', [args.goal.title]],
    ['projects', args.projects.map((item) => item.title)],
    ['tasks', args.tasks.map((item) => item.title)],
    ['keyResults', args.keyResults.map((item) => item.title)],
  ];
  const conflicts: string[] = [];
  for (const [collection, titles] of inputs) {
    const existingTitles = new Set(existing[collection].map((record) =>
      normalizeGoalArchitectTitle(String(record.title ?? record.name ?? '')),
    ));
    for (const title of titles) {
      if (existingTitles.has(normalizeGoalArchitectTitle(title))) {
        conflicts.push(`Duplicate ${collection} title '${title}' already exists in this domain.`);
      }
    }
  }
  return conflicts;
}

function assertUniqueIds(args: PreviewGoalArchitectureArgs): void {
  const byCollection = [
    [args.goal.id],
    args.projects.map((item) => item.id),
    args.tasks.map((item) => item.id),
    args.keyResults.map((item) => item.id),
  ];
  for (const ids of byCollection) {
    if (new Set(ids).size !== ids.length) throw new DomainError('INVALID_ARGUMENT', 'Duplicate draft entity IDs.');
  }
}

function nullableFields(source: Readonly<Record<string, unknown>>): Readonly<Record<string, WriteValue>> {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== null)) as Record<string, WriteValue>;
}
