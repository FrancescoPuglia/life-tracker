import type { AuthContext } from './types';
import type { OpenAIFunctionTool, ToolContract } from './tool-definitions';
import { toOpenAITool } from './tool-definitions';

export type ToolHandler = (args: unknown, context: AuthContext) => Promise<unknown>;

export interface RegisteredTool {
  readonly contract: ToolContract;
  readonly handler: ToolHandler;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(contract: ToolContract, handler: ToolHandler): void {
    if (this.tools.has(contract.name)) throw new Error(`Duplicate tool registration: ${contract.name}`);
    this.tools.set(contract.name, { contract, handler });
  }

  resolve(name: string): RegisteredTool | null {
    return this.tools.get(name) ?? null;
  }

  definitions(kinds: ReadonlySet<ToolContract['kind']> = new Set(['read', 'proposal'])): readonly OpenAIFunctionTool[] {
    return [...this.tools.values()]
      .filter(({ contract }) => kinds.has(contract.kind))
      .map(({ contract }) => toOpenAITool(contract));
  }

  names(kinds: ReadonlySet<ToolContract['kind']> = new Set(['read', 'proposal'])): readonly string[] {
    return [...this.tools.values()]
      .filter(({ contract }) => kinds.has(contract.kind))
      .map(({ contract }) => contract.name);
  }
}
