import { BaseAgent } from "./baseAgent.ts";
import { AgentState } from "../../types/index.ts";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

/**
 * 子任务定义
 */
export interface SubTask {
  id: string;
  description: string;
  assignedTo: string; // Worker名称
  params?: Record<string, any>;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
}

/**
 * 执行计划
 */
interface ExecutionPlan {
  thinking: string;
  needSplit: boolean;
  subtasks: SubTask[];
  directResponse?: string;
}

/**
 * MainAgent - 系统唯一入口
 * 
 * 设计理念（来自Claude推荐）：
 * 1. 合并旧架构的Router+Planner+Supervisor
 * 2. 一次LLM调用完成分析和规划
 * 3. 动态执行子任务并汇总结果
 * 
 * 这是Orchestrator-Workers模式的简化实现
 */
export class MainAgent extends BaseAgent {
  constructor() {
    super({
      id: "main-agent",
      name: "MainAgent",
      systemPrompt: `你是任务编排器。负责分析用户任务并决定执行策略。

可用的Workers：
- NoteWorker: 处理笔记相关操作（创建、搜索、编辑笔记）
- TaskWorker: 处理待办事项（提取、创建、管理待办）
- SearchWorker: 搜索知识库和笔记
- FileWorker: 处理文件操作（读取、写入、编辑）

你的工作方式：
1. 分析用户任务复杂度
2. 判断是否需要拆解为子任务
3. 如果拆解，为每个子任务分配合适的Worker

输出格式（严格JSON）：
{
  "thinking": "分析过程",
  "needSplit": true/false,
  "subtasks": [
    {
      "id": "task-1",
      "description": "任务描述",
      "assignedTo": "Worker名称",
      "params": {参数},
      "status": "pending"
    }
  ],
  "directResponse": "如果不需拆解，直接回复"
}

示例：
用户: "整理会议笔记并提取待办"
输出: {
  "thinking": "需要两步：先整理笔记，再提取待办",
  "needSplit": true,
  "subtasks": [
    {"id": "task-1", "description": "整理会议笔记", "assignedTo": "NoteWorker", "status": "pending"},
    {"id": "task-2", "description": "从笔记提取待办", "assignedTo": "TaskWorker", "status": "pending"}
  ]
}

用户: "你好"
输出: {
  "thinking": "简单问候，不需要拆解",
  "needSplit": false,
  "directResponse": "你好！有什么可以帮你的？",
  "subtasks": []
}`
    });
  }

  /**
   * 主入口
   */
  async execute(input: string): Promise<any> {
    this.setState(AgentState.RUNNING);

    try {
      // 步骤1：分析任务
      console.log("[MainAgent] 分析任务...");
      const plan = await this.analyzeTask(input);
      
      // 步骤2：根据分析结果执行
      if (plan.needSplit && plan.subtasks.length > 0) {
        // 执行子任务
        console.log(`[MainAgent] 执行${plan.subtasks.length}个子任务...`);
        const results = await this.executeSubtasks(plan.subtasks);
        
        // 汇总结果
        return {
          type: "orchestrated",
          thinking: plan.thinking,
          subtasks: plan.subtasks,
          results: results
        };
      } else {
        // 直接回复
        console.log("[MainAgent] 直接回复");
        return {
          type: "direct",
          thinking: plan.thinking,
          response: plan.directResponse
        };
      }

    } catch (error) {
      await this.handleError(error as Error);
      throw error;
    } finally {
      this.setState(AgentState.COMPLETED);
    }
  }

  /**
   * 分析任务（内部方法）
   */
  private async analyzeTask(input: string): Promise<ExecutionPlan> {
    const messages = [
      new SystemMessage(this.systemPrompt),
      new HumanMessage(input)
    ];

    const response = await this.llm.invoke(messages);
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    return this.parsePlan(content);
  }

  /**
   * 解析执行计划
   */
  private parsePlan(content: string): ExecutionPlan {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          thinking: "无法解析，直接回复",
          needSplit: false,
          subtasks: [],
          directResponse: content
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        thinking: parsed.thinking || "",
        needSplit: parsed.needSplit || false,
        subtasks: (parsed.subtasks || []).map((task: any, index: number) => ({
          id: task.id || `task-${index + 1}`,
          description: task.description || "",
          assignedTo: task.assignedTo || "Unknown",
          params: task.params,
          status: "pending" as const
        })),
        directResponse: parsed.directResponse
      };
    } catch (error) {
      console.error("[MainAgent] 解析失败:", error);
      return {
        thinking: "解析失败",
        needSplit: false,
        subtasks: [],
        directResponse: content
      };
    }
  }

  /**
   * 执行子任务（当前为模拟执行）
   */
  private async executeSubtasks(subtasks: SubTask[]): Promise<string[]> {
    const results: string[] = [];

    for (const task of subtasks) {
      task.status = "running";
      console.log(`[MainAgent] 执行: ${task.description} (${task.assignedTo})`);

      // TODO: 后续接入真实Worker
      // 当前模拟执行
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const result = `[${task.assignedTo}] 已完成: ${task.description}`;
      task.status = "completed";
      task.result = result;
      results.push(result);
      
      console.log(`[MainAgent] 完成: ${task.description}`);
    }

    return results;
  }
}
