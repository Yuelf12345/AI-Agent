/**
 * HarnessToolRegistry - 统一工具注册器
 *
 * 合并了旧 ToolRegistry（分类、描述、args 接口）和
 * EnhancedToolRegistry（Retry/Timeout/Cache）的所有功能。
 *
 * 这是 Harness Agent 的唯一工具注册入口。
 *
 * 使用方式：
 *   import { harnessToolRegistry } from "./registry.ts";
 *
 *   // 调用工具（两种参数格式兼容）
 *   await harnessToolRegistry.invoke({ name: "read_file", args: { filePath: "test.txt" } });
 *   await harnessToolRegistry.invoke({ name: "read_file", parameters: { filePath: "test.txt" } });
 *
 *   // 获取工具描述（用于 LLM System Prompt）
 *   harnessToolRegistry.getDescriptions();
 */

import { StructuredTool } from "@langchain/core/tools";
import { BaseTool } from "./baseTool.ts";
import { EnhancedToolRegistry, type ToolCallConfig } from "./enhancedTool.ts";
import { FileReadTool, FileWriteTool, FileEditTool, BashTool } from "./fileTool.ts";

/**
 * 统一工具注册器
 *
 * 基于 EnhancedToolRegistry，增加旧 ToolRegistry 的功能：
 *   - 分类索引（category）
 *   - 工具描述列表（getDescriptions，用于 System Prompt）
 *   - invoke 兼容两种参数格式（args / parameters）
 */
export class HarnessToolRegistry extends EnhancedToolRegistry {
  private categories: Map<string, string[]> = new Map();

  /**
   * 注册工具及其增强配置
   * 同时维护分类索引
   */
  override register(tool: BaseTool<any>, config?: ToolCallConfig): void {
    super.register(tool, config);

    // 维护分类索引
    const category = tool.toolMetadata.category;
    if (!this.categories.has(category)) {
      this.categories.set(category, []);
    }
    this.categories.get(category)!.push(tool.name);
  }

  /**
   * 批量注册工具
   */
  override registerAll(tools: BaseTool<any>[], defaultConfig?: ToolCallConfig): void {
    for (const tool of tools) {
      this.register(tool, defaultConfig);
    }
  }

  /**
   * 增强版工具调用（兼容 args 和 parameters 两种格式）
   *
   * 旧格式: { name, args }
   * 新格式: { name, parameters }
   */
  async invokeCompat(toolCall: {
    name: string;
    args?: Record<string, any>;
    parameters?: Record<string, any>;
  }): Promise<string> {
    const params = toolCall.args ?? toolCall.parameters ?? {};
    return super.invoke({ name: toolCall.name, parameters: params });
  }

  /**
   * 按分类获取工具列表
   */
  getByCategory(category: string): BaseTool<any>[] {
    const names = this.categories.get(category) || [];
    return names
      .map((n) => this.get(n))
      .filter((t): t is BaseTool<any> => t !== undefined);
  }

  /**
   * 获取所有工具（LangChain 兼容格式）
   */
  getAllStructuredTools(): StructuredTool[] {
    return this.getAllTools() as unknown as StructuredTool[];
  }

  /**
   * 获取工具描述列表（用于 System Prompt）
   */
  getDescriptions(category?: string): string {
    let tools = this.getAllTools();

    if (category) {
      tools = this.getByCategory(category);
    }

    if (tools.length === 0) {
      return "(no tools available)";
    }

    return tools
      .map((t) => {
        let line = `  - ${t.name}: ${t.description}`;
        if (t.toolMetadata.dangerous) {
          line += " ⚠️";
        }
        return line;
      })
      .join("\n");
  }

  /**
   * 列出所有工具名
   */
  list(): string[] {
    return this.getAllTools().map((t) => t.name);
  }

  /**
   * 列出所有分类
   */
  listCategories(): string[] {
    return Array.from(this.categories.keys());
  }
}

// ==================== 全局单例 + 预注册基础工具 ====================

/**
 * 全局统一工具注册器
 *
 * 预注册了基础工具及其增强配置：
 *   - read_file: 缓存 30s, 超时 10s
 *   - write_file: 重试 2次, 超时 15s
 *   - file_edit:  重试 2次, 超时 15s
 *   - bash:       超时 30s（危险操作，不缓存）
 */
export const harnessToolRegistry = new HarnessToolRegistry();

harnessToolRegistry.register(new FileReadTool(), {
  timeout: { timeoutMs: 10000 },
  enableCache: true,
  cache: { ttlMs: 30000 },
});

harnessToolRegistry.register(new FileWriteTool(), {
  timeout: { timeoutMs: 15000 },
  retry: { maxRetries: 2 },
});

harnessToolRegistry.register(new FileEditTool(), {
  timeout: { timeoutMs: 15000 },
  retry: { maxRetries: 2 },
});

harnessToolRegistry.register(new BashTool(), {
  timeout: { timeoutMs: 30000 },
});

/**
 * @deprecated 使用 harnessToolRegistry 代替
 * 保留旧名以兼容现有代码，后续版本将移除
 */
export const toolRegistry = harnessToolRegistry;

/**
 * @deprecated 使用 HarnessToolRegistry 代替
 * 保留旧名以兼容现有代码，后续版本将移除
 */
export { HarnessToolRegistry as ToolRegistry };