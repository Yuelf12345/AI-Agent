import { llmService } from "../../services/llm.ts";
import type { PlannerResult, SubTask } from "../../types/index.ts";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

/**
 * 可用的Worker Agent列表
 */
const AVAILABLE_AGENTS = [
  { name: "NoteAgent", capability: "笔记管理：创建、搜索、编辑笔记" },
  { name: "TaskAgent", capability: "待办管理：提取、创建、管理待办事项" },
  { name: "SearchAgent", capability: "知识搜索：搜索笔记和本地知识库" },
  { name: "FileAgent", capability: "文件管理：读取、编辑文件" },
];

/**
 * Planner组件
 * 职责：将复杂任务拆解为子任务序列
 */
export class Planner {
  private llm: any;

  private systemPrompt = `你是一个任务规划专家。将用户的复杂任务拆解为子任务序列。

可用的Worker Agent：
${AVAILABLE_AGENTS.map((a) => `- ${a.name}: ${a.capability}`).join("\n")}

拆解原则：
1. 每个子任务应该是一个原子操作
2. 标明子任务之间的依赖关系
3. 为每个子任务分配合适的Agent
4. 按执行顺序排列子任务

请严格按照以下JSON格式返回：
{
  "subtasks": [
    {
      "id": "task-1",
      "description": "任务描述",
      "assignedAgent": "Agent名称",
      "dependencies": [],
      "status": "pending"
    }
  ],
  "reasoning": "规划理由"
}`;

  constructor() {
    this.llm = llmService.getModel();
  }

  /**
   * 规划任务
   * @param input 复杂任务描述
   * @returns PlannerResult 规划结果
   */
  async plan(input: string): Promise<PlannerResult> {
    const messages = [
      new SystemMessage(this.systemPrompt),
      new HumanMessage(`用户任务：${input}`),
    ];

    const response = await this.llm.invoke(messages);
    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    const result = this.parseResult(content);
    return result;
  }

  /**
   * 解析LLM返回结果
   */
  private parseResult(content: string): PlannerResult {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("无法解析规划结果");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // 确保每个子任务都有必要的字段
      const subtasks: SubTask[] = (parsed.subtasks || []).map(
        (task: any, index: number) => ({
          id: task.id || `task-${index + 1}`,
          description: task.description || "",
          assignedAgent: task.assignedAgent || "UnknownAgent",
          dependencies: task.dependencies || [],
          params: task.params,
          status: "pending" as const,
        }),
      );

      return {
        subtasks,
        reasoning: parsed.reasoning || "",
      };
    } catch (error) {
      // 解析失败，返回空计划
      return {
        subtasks: [],
        reasoning: "规划解析失败，请重试",
      };
    }
  }
}
