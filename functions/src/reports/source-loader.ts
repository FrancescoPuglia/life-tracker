import { DomainError } from '../domain/errors';
import { assertAuthenticated } from '../domain/policy';
import type { Repository } from '../domain/repository';
import type {
  AuthContext,
  EntityCollection,
  EntityRecord,
  ReadFilter,
} from '../domain/types';
import {
  fourWeekPeriods,
  instantEpochMilliseconds,
  nextDailyPeriod,
  resolveReportPeriod,
} from './period';
import type {
  DatasetCoverage,
  ScientificReportInput,
  ScientificReportType,
} from './types';
import { REPORT_DATASET_LIMITS } from './types';

const REPORT_SOURCE_PAGE_SIZE = 200;
const REPORT_SOURCE_MAX_PAGES = 50;

interface LoadedDataset {
  readonly items: readonly EntityRecord[];
  readonly coverage: DatasetCoverage;
}

export interface ScientificReportSourceRequest {
  readonly reportType: ScientificReportType;
  readonly localDate: string;
  readonly locale: string;
}

function emptyFilter(): ReadFilter {
  return {
    query: null,
    from: null,
    to: null,
    status: null,
    domainId: null,
    projectId: null,
    goalId: null,
    taskId: null,
  };
}

function intervalOverlaps(
  rawStart: unknown,
  rawEnd: unknown,
  from: number,
  to: number,
): boolean {
  const start = instantEpochMilliseconds(rawStart);
  const end = instantEpochMilliseconds(rawEnd);
  return start !== null && end !== null && start < end && start < to && end > from;
}

function timeBlockTouchesHorizon(record: EntityRecord, from: string, to: string): boolean {
  const fromEpoch = instantEpochMilliseconds(from);
  const toEpoch = instantEpochMilliseconds(to);
  if (fromEpoch === null || toEpoch === null) throw new DomainError('INTERNAL', 'Report horizon is invalid.');
  return intervalOverlaps(record.startTime, record.endTime, fromEpoch, toEpoch)
    || intervalOverlaps(record.actualStartTime, record.actualEndTime, fromEpoch, toEpoch);
}

/**
 * Bounded owner-scoped source loader. It delegates every entity path to the
 * verified Secure AI Repository, so callers can choose only an allowlisted
 * collection and never an arbitrary Firestore path.
 */
export class ScientificReportSourceLoader {
  constructor(
    private readonly repository: Repository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async load(
    context: AuthContext,
    request: ScientificReportSourceRequest,
  ): Promise<ScientificReportInput> {
    assertAuthenticated(context);
    const preferences = await this.repository.getUserPlanningPreferences(context.uid);
    const period = resolveReportPeriod(request.reportType, request.localDate, preferences.timezone);
    const weeks = fourWeekPeriods(period);
    const firstWeek = weeks[0];
    if (!firstWeek) throw new DomainError('INTERNAL', 'Report trend horizon is empty.');
    const horizonFrom = firstWeek.from;
    const horizonTo = request.reportType === 'daily' ? nextDailyPeriod(period).to : period.to;
    const ranged = { ...emptyFilter(), from: horizonFrom, to: horizonTo };

    const [goals, projects, tasks, timeBlocks, sessions, habits, habitLogs] = await Promise.all([
      this.readBounded(context.uid, 'goals', emptyFilter(), REPORT_DATASET_LIMITS.goals),
      this.readBounded(context.uid, 'projects', emptyFilter(), REPORT_DATASET_LIMITS.projects),
      this.readBounded(context.uid, 'tasks', emptyFilter(), REPORT_DATASET_LIMITS.tasks),
      // Read the bounded collection before filtering locally so a block whose
      // planned interval is outside the horizon but explicit actual interval is
      // inside cannot disappear from Actual. Truncation stays explicit.
      this.readBounded(context.uid, 'timeBlocks', emptyFilter(), REPORT_DATASET_LIMITS.timeBlocks),
      this.readBounded(context.uid, 'sessions', ranged, REPORT_DATASET_LIMITS.sessions),
      this.readBounded(context.uid, 'habits', emptyFilter(), REPORT_DATASET_LIMITS.habits),
      this.readBounded(context.uid, 'habitLogs', ranged, REPORT_DATASET_LIMITS.habitLogs),
    ]);

    return {
      uid: context.uid,
      reportType: request.reportType,
      localDate: request.localDate,
      timezone: preferences.timezone,
      locale: request.locale,
      generatedAt: this.clock().toISOString(),
      preferences,
      coverage: {
        goals: goals.coverage,
        projects: projects.coverage,
        tasks: tasks.coverage,
        timeBlocks: timeBlocks.coverage,
        sessions: sessions.coverage,
        habits: habits.coverage,
        habitLogs: habitLogs.coverage,
      },
      records: {
        goals: goals.items,
        projects: projects.items,
        tasks: tasks.items,
        timeBlocks: timeBlocks.items.filter((record) => (
          timeBlockTouchesHorizon(record, horizonFrom, horizonTo)
        )),
        sessions: sessions.items,
        habits: habits.items,
        habitLogs: habitLogs.items,
      },
    };
  }

  private async readBounded(
    uid: string,
    collection: EntityCollection,
    filter: ReadFilter,
    maximum: number,
  ): Promise<LoadedDataset> {
    const items: EntityRecord[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const remaining = maximum - items.length;
      if (remaining <= 0) return { items, coverage: 'truncated' };
      const page = await this.repository.listEntities(uid, collection, {
        filter,
        cursor,
        limit: Math.min(REPORT_SOURCE_PAGE_SIZE, remaining),
      });
      items.push(...page.items);
      cursor = page.nextCursor;
      pages += 1;
      if (pages >= REPORT_SOURCE_MAX_PAGES && cursor !== null) {
        return { items, coverage: 'truncated' };
      }
    } while (cursor !== null);
    return { items, coverage: 'complete' };
  }
}
