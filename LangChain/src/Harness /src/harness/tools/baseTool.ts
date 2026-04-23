import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

interface ToolMetadata {
  category: string; // 分类：base/filesystem/domain
  permissions?: string[]; // 权限声明
  dangerous?: boolean; // 危险标记
  localOnly?: boolean; // 是否仅本地执行
  version?: string; // 版本
}

abstract class BaseTool<T extends z.ZodObject<any>> extends StructuredTool {
  name: string;
  description: string;
  schema: T;
  toolMetadata: ToolMetadata;

  constructor(config: {
    name: string;
    description: string;
    schema: T;
    metadata: ToolMetadata;
  }) {
    super();
    this.name = config.name;
    this.description = config.description;
    this.schema = config.schema;
    this.toolMetadata = config.metadata;
  }

  // 子类实现具体逻辑
  abstract _call(args: z.infer<T>): Promise<string>;

  // 统一的调用入口（添加日志、权限检查）
  async call(args: z.infer<T>): Promise<string> {
    // 1. 参数验证
    const validated = this.schema.parse(args);

    // 2. 日志记录
    this.logCall(validated);

    // 3. 执行
    try {
      const result = await this._call(validated);
      this.logResult(result);
      return result;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }

  // 日志方法
  protected logCall(args: any): void {
    console.log(
      `[${this.name}] Called with:`,
      JSON.stringify(args).slice(0, 100),
    );
  }

  protected logResult(result: string): void {
    console.log(`[${this.name}] Result:`, result.slice(0, 100));
  }
}


export { BaseTool };