import { BaseAgent } from "./baseAgent.ts";
import { AgentState } from "../../types/index.ts";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

/**
 * SimpleAgent - 最简单的Agent实现
 * 
 * 设计理念：
 * 1. 单次LLM调用
 * 2. LLM自己决定是否需要工具
 * 3. 如果需要工具，调用工具并返回结果
 * 
 * 这是对Router→Planner→Supervisor架构的简化
 */
export class SimpleAgent extends BaseAgent {
  constructor() {
    super({
      id: "simple-agent",
      name: "SimpleAgent",
      // 注册所有可用工具（注意：工具名要和实际定义一致）
      toolNames: ["read_file", "write_file", "file_edit", "bash"],
      systemPrompt: `你是知识管理助手。

可用工具：
${"TODO: will be dynamically injected"}

工具选择指南：
- read_file: 读取文件
  参数: { "filePath": "文件路径" }
  
- write_file: 写入文件
  参数: { "filePath": "文件路径", "content": "文件内容" }
  
- file_edit: 编辑文件
  参数: { "filePath": "文件路径", "oldText": "旧文本", "newText": "新文本" }
  
- bash: 执行shell命令
  参数: { "command": "shell命令" }

示例：
用户: "创建test.txt，内容是Hello"
输出: {
  "needTool": true,
  "toolName": "write_file",
  "toolParams": {"filePath": "test.txt", "content": "Hello"},
  "response": "已创建文件"
}

你的工作方式：
1. 分析用户问题
2. 根据上面的指南选择合适的工具
3. 输出JSON格式的结果

输出格式（严格JSON）：
{
  "thinking": "你的分析过程",
  "needTool": true/false,
  "toolName": "工具名称（如果needTool为true）",
  "toolParams": {参数对象（如果needTool为true）},
  "response": "给用户的回复"
}

注意：
- 只有真正需要操作时才使用工具
- 简单问答直接回复
- 参数要准确完整`
    });
  }

  async execute(input: string): Promise<any> {
    this.setState(AgentState.RUNNING);

    try {
      // 步骤1：动态构建System Prompt（包含最新的工具描述）
      const systemContent = this.systemPrompt.replace(
        "TODO: will be dynamically injected",
        this.getToolDescriptions()
      );

      // 步骤2：构建消息
      const messages = [
        new SystemMessage(systemContent),
        new HumanMessage(input)
      ];

      // 步骤3：调用LLM
      console.log("[SimpleAgent] 调用LLM...");
      const response = await this.llm.invoke(messages);
      const content = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);

      // 步骤4：解析结果
      const parsed = this.parseResult(content);
      console.log("[SimpleAgent] LLM分析:", parsed.thinking);

      // 步骤5：如果需要工具，调用工具
      if (parsed.needTool && parsed.toolName) {
        console.log(`[SimpleAgent] 调用工具: ${parsed.toolName}`);
        console.log(`[SimpleAgent] 工具参数:`, JSON.stringify(parsed.toolParams, null, 2));
        const toolResult = await this.callTool(parsed.toolName, parsed.toolParams || {});
        console.log(`[SimpleAgent] 工具结果:`, toolResult);

        return {
          type: "tool_call",
          thinking: parsed.thinking,
          toolName: parsed.toolName,
          toolResult: toolResult,
          response: parsed.response
        };
      }

      // 步骤6：不需要工具，直接返回
      return {
        type: "direct_response",
        thinking: parsed.thinking,
        response: parsed.response || content
      };

    } catch (error) {
      await this.handleError(error as Error);
      throw error;
    } finally {
      this.setState(AgentState.COMPLETED);
    }
  }

  /**
   * 解析LLM返回的JSON
   */
  private parseResult(content: string): {
    thinking: string;
    needTool: boolean;
    toolName?: string;
    toolParams?: Record<string, any>;
    response?: string;
  } {
    try {
      // 提取JSON部分
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // 如果没有JSON格式，认为是直接回复
        return {
          thinking: "直接回复用户",
          needTool: false,
          response: content
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        thinking: parsed.thinking || "",
        needTool: parsed.needTool || false,
        toolName: parsed.toolName,
        toolParams: parsed.toolParams,
        response: parsed.response
      };
    } catch (error) {
      // 解析失败，返回原始内容
      console.error("[SimpleAgent] JSON解析失败:", error);
      return {
        thinking: "解析失败，返回原始内容",
        needTool: false,
        response: content
      };
    }
  }
}
