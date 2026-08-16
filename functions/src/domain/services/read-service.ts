import { DomainError } from '../errors';
import { assertAuthenticated } from '../policy';
import type { Repository } from '../repository';
import type { AnalyticsArgs, ReadArgs } from '../schemas-internal';
import { sanitizeEntity } from '../sanitize';
import type { AuthContext, EntityCollection, EntityRecord, ReadFilter } from '../types';

const MAX_ANALYTICS_RECORDS = 5_000;
const INTERNAL_PAGE_SIZE = 100;

export interface AnalyticsResult {
  readonly from: string;
  readonly to: string;
  readonly sessions: {
    readonly count: number;
    readonly completedCount: number;
    readonly totalMinutes: number;
  };
  readonly timeBlocks: {
    readonly count: number;
    readonly completedCount: number;
    readonly plannedMinutes: number;
  };
}

export class ReadService {
  constructor(private readonly repository: Repository) {}

  async list(
    context: AuthContext,
    collection: EntityCollection,
    args: ReadArgs,
  ): Promise<Readonly<{ items: readonly Readonly<Record<string, unknown>>[]; nextCursor: string | null }>> {
    assertAuthenticated(context);
    const page = await this.repository.listEntities(context.uid, collection, args);
    return {
      items: page.items.map((item) => sanitizeEntity(collection, item)),
      nextCursor: page.nextCursor,
    };
  }

  async analytics(context: AuthContext, args: AnalyticsArgs): Promise<AnalyticsResult> {
    assertAuthenticated(context);
    const filter: ReadFilter = {
      query: null,
      from: args.from,
      to: args.to,
      status: null,
      domainId: null,
      projectId: null,
      goalId: null,
      taskId: null,
    };
    const [sessions, timeBlocks] = await Promise.all([
      this.readBounded(context.uid, 'sessions', filter),
      this.readBounded(context.uid, 'timeBlocks', filter),
    ]);

    const sessionMinutes = sessions.reduce((sum, record) => sum + durationMinutes(record), 0);
    const blockMinutes = timeBlocks.reduce((sum, record) => sum + durationMinutes(record), 0);
    return {
      from: args.from,
      to: args.to,
      sessions: {
        count: sessions.length,
        completedCount: sessions.filter((item) => item.status === 'completed').length,
        totalMinutes: sessionMinutes,
      },
      timeBlocks: {
        count: timeBlocks.length,
        completedCount: timeBlocks.filter((item) => item.status === 'completed').length,
        plannedMinutes: blockMinutes,
      },
    };
  }

  private async readBounded(
    uid: string,
    collection: EntityCollection,
    filter: ReadFilter,
  ): Promise<readonly EntityRecord[]> {
    const output: EntityRecord[] = [];
    let cursor: string | null = null;
    do {
      const page = await this.repository.listEntities(uid, collection, {
        filter,
        cursor,
        limit: INTERNAL_PAGE_SIZE,
      });
      output.push(...page.items);
      if (output.length > MAX_ANALYTICS_RECORDS) {
        throw new DomainError('LIMIT_EXCEEDED', 'Analytics record limit exceeded; use a smaller date range.');
      }
      cursor = page.nextCursor;
    } while (cursor);
    return output;
  }
}

function durationMinutes(record: EntityRecord): number {
  if (typeof record.durationMinutes === 'number' && Number.isFinite(record.durationMinutes)) {
    return Math.max(0, Math.min(record.durationMinutes, 7 * 24 * 60));
  }
  if (typeof record.startTime === 'string' && typeof record.endTime === 'string') {
    const duration = (Date.parse(record.endTime) - Date.parse(record.startTime)) / 60_000;
    return Number.isFinite(duration) ? Math.max(0, Math.min(duration, 7 * 24 * 60)) : 0;
  }
  return 0;
}
