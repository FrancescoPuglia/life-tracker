import { DomainError } from '../domain/errors';
import type { ToolExecutor } from '../domain/executor';
import type { ToolRegistry } from '../domain/registry';
import type { OpenAIFunctionTool } from '../domain/tool-definitions';
import type { AuthContext } from '../domain/types';

/**
 * Transport-neutral MCP seam that reuses the authenticated domain registry.
 * It deliberately implements no network/auth transport: a future remote MCP
 * endpoint must first supply a verified AuthContext. Write/proposal tools are
 * excluded even when the feature flag is enabled.
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
    return this.registry.definitions(this.readKinds);
  }

  async execute(
    context: AuthContext,
    name: string,
    args: unknown,
  ): Promise<unknown> {
    this.assertEnabled();
    const registered = this.registry.resolve(name);
    if (!registered || registered.contract.kind !== 'read') {
      throw new DomainError('UNKNOWN_TOOL', 'MCP capability is unavailable.');
    }
    return this.executor.execute(name, args, context);
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new DomainError('FORBIDDEN', 'MCP read access is disabled.');
    }
  }
}
