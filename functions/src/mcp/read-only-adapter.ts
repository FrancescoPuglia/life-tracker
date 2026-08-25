import { DomainError } from '../domain/errors';
import type { ToolExecutor } from '../domain/executor';
import type { ToolRegistry } from '../domain/registry';
import type { OpenAIFunctionTool } from '../domain/tool-definitions';
import type { AuthContext } from '../domain/types';

export const MCP_DOMAIN_READ_TOOL_NAMES = Object.freeze([
  'get_life_tracker_state',
  'get_goals',
  'get_projects',
  'get_tasks',
  'get_timeblocks',
  'get_sessions',
  'get_habits',
  'get_kpis',
  'planned_vs_actual',
  'analyze_period',
  'goal_alignment',
] as const);

export type McpDomainReadToolName = (typeof MCP_DOMAIN_READ_TOOL_NAMES)[number];

const MCP_DOMAIN_READ_TOOL_ALLOWLIST = new Set<string>(MCP_DOMAIN_READ_TOOL_NAMES);
const MAX_MCP_RANGE_MS = 90 * 86_400_000;
const MAX_MCP_PAGE_SIZE = 10;
const MAX_MCP_STATE_COLLECTION_SIZE = 10;

/**
 * Transport-neutral MCP seam that reuses the authenticated domain registry.
 * Network OAuth is enforced outside this class; callers must first supply the
 * verified Firebase-derived AuthContext. Write/proposal tools remain excluded
 * even when the remote feature flag is enabled.
 */
export class ReadOnlyMcpDomainAdapter {
  private readonly readKinds = new Set<'read' | 'proposal'>(['read']);

  constructor(
    private readonly registry: ToolRegistry,
    private readonly executor: ToolExecutor,
    private readonly enabled: boolean,
  ) {}

  definitions(): readonly OpenAIFunctionTool[] {
    this.assertEnabled();
    return this.registry.definitions(this.readKinds)
      .filter((definition) => MCP_DOMAIN_READ_TOOL_ALLOWLIST.has(definition.name));
  }

  async execute(
    context: AuthContext,
    name: string,
    args: unknown,
  ): Promise<unknown> {
    this.assertEnabled();
    const registered = this.registry.resolve(name);
    if (
      !MCP_DOMAIN_READ_TOOL_ALLOWLIST.has(name)
      || !registered
      || registered.contract.kind !== 'read'
    ) {
      throw new DomainError('UNKNOWN_TOOL', 'MCP capability is unavailable.');
    }
    assertMcpReadPolicy(name, args);
    return this.executor.execute(name, args, context);
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new DomainError('FORBIDDEN', 'MCP read access is disabled.');
    }
  }
}

function assertMcpReadPolicy(name: string, args: unknown): void {
  if (!isRecord(args)) {
    throw new DomainError('INVALID_ARGUMENT', 'MCP read arguments are invalid.');
  }
  if (name === 'get_life_tracker_state') {
    if (args.includeNotes !== false) {
      throw new DomainError('FORBIDDEN', 'MCP state reads never include Notes.');
    }
    if (
      typeof args.perCollectionLimit !== 'number'
      || args.perCollectionLimit > MAX_MCP_STATE_COLLECTION_SIZE
    ) {
      throw new DomainError('LIMIT_EXCEEDED', 'MCP state collection limit exceeded.');
    }
    assertBoundedRange(args.from, args.to);
    return;
  }
  if (
    name === 'get_kpis'
    || name === 'planned_vs_actual'
    || name === 'analyze_period'
    || name === 'goal_alignment'
  ) {
    assertBoundedRange(args.from, args.to, true);
    return;
  }
  const filter = isRecord(args.filter) ? args.filter : null;
  if (!filter || filter.query !== null) {
    throw new DomainError('INVALID_ARGUMENT', 'MCP list reads do not accept free-text queries.');
  }
  if (typeof args.limit !== 'number' || args.limit > MAX_MCP_PAGE_SIZE) {
    throw new DomainError('LIMIT_EXCEEDED', 'MCP page limit exceeded.');
  }
  assertBoundedRange(filter.from, filter.to);
}

function assertBoundedRange(from: unknown, to: unknown, required = false): void {
  if (from === null && to === null && !required) return;
  if (typeof from !== 'string' || typeof to !== 'string') {
    throw new DomainError('INVALID_ARGUMENT', 'MCP date ranges require from and to.');
  }
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new DomainError('INVALID_ARGUMENT', 'MCP date range is invalid.');
  }
  if (end - start > MAX_MCP_RANGE_MS) {
    throw new DomainError('LIMIT_EXCEEDED', 'MCP date range cannot exceed 90 days.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
