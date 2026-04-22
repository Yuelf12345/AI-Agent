import type { ToolDefinition, ToolResult } from '../../types/index.js';
import { BaseTool } from './base.js';

/**
 * Tool 注册中心
 * 负责管理所有可用的 Tools
 */
export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();
  private handlers: Map<string, (params: Record<string, unknown>) => Promise<ToolResult>> = new Map();

  /**
   * 注册一个 Tool
   */
  register(tool: BaseTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
    this.handlers.set(tool.name, tool.execute.bind(tool));
    console.log(`[ToolRegistry] Registered tool: ${tool.name}`);
  }

  /**
   * 批量注册 Tools
   */
  registerAll(tools: BaseTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 获取 Tool
   */
  get(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  /**
   * 检查 Tool 是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取所有已注册的 Tool 名称
   */
  list(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 获取所有 Tool 定义（用于 LLM）
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => tool.toDefinition());
  }

  /**
   * 执行 Tool
   */
  async execute(name: string, params: Record<string, unknown>): Promise<ToolResult> {
    const handler = this.handlers.get(name);
    if (!handler) {
      return { success: false, error: `Tool "${name}" not found` };
    }

    try {
      const result = await handler(params);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: `Tool execution failed: ${message}` };
    }
  }

  /**
   * 移除 Tool
   */
  unregister(name: string): boolean {
    if (!this.tools.has(name)) {
      return false;
    }
    this.tools.delete(name);
    this.handlers.delete(name);
    return true;
  }

  /**
   * 清空所有 Tools
   */
  clear(): void {
    this.tools.clear();
    this.handlers.clear();
  }
}

// 全局单例
export const toolRegistry = new ToolRegistry();

export default ToolRegistry;
