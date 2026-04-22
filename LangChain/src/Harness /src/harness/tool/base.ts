import type { ToolDefinition, ToolExecutor, ToolResult } from '../../types/index.js';

/**
 * Tool 基类
 * 所有内置 Tools 都需要继承此类
 */
export abstract class BaseTool {
  abstract name: string;
  abstract description: string;
  abstract parameters: ToolDefinition['parameters'];
  
  permissions: string[] = [];
  localOnly: boolean = true;

  abstract execute(params: Record<string, unknown>): Promise<ToolResult>;

  toDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      handler: `${this.constructor.name}.execute`,
      permissions: this.permissions,
      local_only: this.localOnly,
    };
  }

  protected success(data: unknown): ToolResult {
    return { success: true, data };
  }

  protected error(message: string): ToolResult {
    return { success: false, error: message };
  }
}

/**
 * Tool 类型定义（用于类型检查）
 */
export type Tool = BaseTool;

export type { ToolDefinition, ToolExecutor, ToolResult };
