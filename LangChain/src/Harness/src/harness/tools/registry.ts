import { StructuredTool } from "@langchain/core/tools";
import { BaseTool } from "./baseTool.ts";
import { FileReadTool, FileWriteTool, FileEditTool, BashTool } from "./fileTool.ts";

/**
 * 工具注册表
 * 统一管理所有工具的注册、发现和调用
 */
class ToolRegistry {
  private tools: Map<string, BaseTool<any>> = new Map();
  private categories: Map<string, string[]> = new Map();

  /**
   * 注册单个工具
   */
  register(tool: BaseTool<any>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" already registered`);
    }

    this.tools.set(tool.name, tool);

    // 按分类索引
    const category = tool.toolMetadata.category;
    if (!this.categories.has(category)) {
      this.categories.set(category, []);
    }
    this.categories.get(category)!.push(tool.name);
  }

  /**
   * 批量注册工具
   */
  registerAll(tools: BaseTool<any>[]): void {
    tools.forEach((tool) => this.register(tool));
  }

  /**
   * 获取工具
   */
  get(name: string): BaseTool<any> | undefined {
    return this.tools.get(name);
  }

  /**
   * 按分类获取工具列表
   */
  getByCategory(category: string): BaseTool<any>[] {
    const names = this.categories.get(category) || [];
    return names.map((n) => this.tools.get(n)!).filter(Boolean);
  }

  /**
   * 获取所有工具（LangChain 兼容格式）
   */
  getAllTools(): StructuredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取工具描述列表（用于 System Prompt）
   */
  getDescriptions(category?: string): string {
    let tools = Array.from(this.tools.values());

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
   * 执行工具调用
   */
  async invoke(toolCall: {
    name: string;
    args: Record<string, any>;
  }): Promise<string> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return `Error: Unknown tool "${toolCall.name}". Available: ${Array.from(this.tools.keys()).join(", ")}`;
    }

    return tool.call(toolCall.args);
  }

  /**
   * 列出所有工具名
   */
  list(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 列出所有分类
   */
  listCategories(): string[] {
    return Array.from(this.categories.keys());
  }
}

// 全局单例
export const toolRegistry = new ToolRegistry();

// 自动注册基础工具
toolRegistry.registerAll([
  new FileReadTool(),
  new FileWriteTool(),
  new FileEditTool(),
  new BashTool(),
]);

export { ToolRegistry };
