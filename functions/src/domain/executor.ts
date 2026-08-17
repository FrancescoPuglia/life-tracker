import { DomainError } from './errors';
import { assertExecutionActive } from './policy';
import type { ToolRegistry } from './registry';
import type { AuthContext } from './types';

const MAX_TOOL_OUTPUT_BYTES = 256_000;

export class ToolExecutor {
  constructor(private readonly registry: ToolRegistry) {}

  async execute(name: string, rawArgs: unknown, context: AuthContext): Promise<unknown> {
    assertExecutionActive(context);
    const tool = this.registry.resolve(name);
    if (!tool) throw new DomainError('UNKNOWN_TOOL', `Unknown tool '${name}'.`);
    const parsed = tool.contract.schema.safeParse(rawArgs);
    if (!parsed.success) {
      throw new DomainError('INVALID_ARGUMENT', `Invalid arguments for '${name}'.`, {
        issues: parsed.error.issues.slice(0, 20).map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
        })),
      });
    }
    const output = await tool.handler(parsed.data, context);
    assertExecutionActive(context);
    if (Buffer.byteLength(JSON.stringify(output), 'utf8') > MAX_TOOL_OUTPUT_BYTES) {
      throw new DomainError('LIMIT_EXCEEDED', `Tool '${name}' output exceeds the safe limit.`);
    }
    return output;
  }

  async executeJson(name: string, json: string, context: AuthContext): Promise<unknown> {
    let args: unknown;
    try {
      args = JSON.parse(json) as unknown;
    } catch {
      throw new DomainError('INVALID_ARGUMENT', `Tool '${name}' arguments are not valid JSON.`);
    }
    return this.execute(name, args, context);
  }
}
